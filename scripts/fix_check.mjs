// Checks for the review fix pass (spend guard races, billing on failure, mock, think tags, IP keys).
// Offline: node:sqlite stand-in for D1, fake fetch. node scripts/fix_check.mjs
import { d1 } from './_d1.mjs';
import { guard } from '../functions/_lib/budget.js';
import { chat } from '../functions/_lib/ai.js';
import { ask, clean } from '../functions/_lib/agent.js';
import { ipKey, writeAllowed } from '../functions/_lib/http.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ', m); } else { fail++; console.log('  FAIL', m); } };
const ENV = { AI_ENABLED: '1', NEBIUS_API_KEY: 'k', AI_TOKENS_TOTAL: '1000000', AI_TOKENS_DAY: '1000000', AI_TOKENS_IP_DAY: '1000000',
  AI_CALLS_IP_DAY: '15', AI_MAX_TOKENS: '600', AI_BASE_URL: 'https://example.invalid/v1/', AI_MODEL: 'm', IP_SALT: 's' };
const usage = (db, k) => db.raw.prepare('SELECT tokens, calls FROM usage WHERE k = ?').get(k) || { tokens: 0, calls: 0 };
const reply = (content, extra = {}) => new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop', ...extra }], usage: { total_tokens: 100 } }));

console.log('C1: caps hold under parallel requests');
{
  const db = d1();
  const rs = await Promise.all(Array.from({ length: 40 }, () => guard(ENV, db, 'ipA', 10)));
  const granted = rs.filter((r) => r.ok).length;
  ok(granted === 15, `40 parallel guards from one IP with a cap of 15: ${granted} granted`);
  const db2 = d1();
  const rs2 = await Promise.all(Array.from({ length: 40 }, (_, i) => guard({ ...ENV, AI_TOKENS_TOTAL: '1000' }, db2, `ip${i}`, 100)));
  ok(rs2.filter((r) => r.ok).length === 10 && usage(db2, 'total').tokens === 1000, `total cap 1000 at 100 each: ${rs2.filter((r) => r.ok).length} granted, ${usage(db2, 'total').tokens} booked`);
  const db3 = d1();
  const rs3 = await Promise.all(Array.from({ length: 30 }, (_, i) => guard({ ...ENV, AI_TOKENS_DAY: '500' }, db3, `ip${i}`, 100)));
  ok(rs3.filter((r) => r.ok).length === 5 && usage(db3, 'total').tokens === 500, 'a refused day cap leaves the total untouched (refund)');
}

console.log('C2: failures that may be billed stay booked');
{
  const db = d1();
  globalThis.fetch = async () => new Response('bad key', { status: 401 });
  await chat(ENV, db, 'ip', { messages: [{ role: 'user', content: 'a' }], max_tokens: 100 });
  ok(usage(db, 'total').tokens === 0, '401 (rejected before generation): reservation released');
  globalThis.fetch = async () => new Response('oops', { status: 500 });
  await chat(ENV, db, 'ip', { messages: [{ role: 'user', content: 'b' }], max_tokens: 100 });
  const after500 = usage(db, 'total').tokens;
  ok(after500 > 0, `500: estimate stays booked (${after500})`);
  globalThis.fetch = async () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }); };
  await chat(ENV, db, 'ip', { messages: [{ role: 'user', content: 'c' }], max_tokens: 100 });
  ok(usage(db, 'total').tokens > after500, 'timeout: estimate stays booked');
}

console.log('I1: per-person token cap and whole-question headroom');
{
  const db = d1();
  let calls = 0;
  globalThis.fetch = async () => { calls++; return reply('x'); };
  const env = { ...ENV, AI_TOKENS_IP_DAY: '2000' };
  const r = await ask(env, db, 'ipB', 'Will potatoes work?', { farm: { name: 'F' }, climate: { t: 1 } });
  ok(r.paused === 'ip' && calls === 0, `question that cannot finish within the person's budget is refused before any call (${r.paused}, ${calls} calls)`);
  const env2 = { ...ENV };
  const big = { farm: { name: 'F' }, climate: { blob: 'y'.repeat(11000) } };
  let sent = [];
  globalThis.fetch = async (u, init) => {
    const b = JSON.parse(init.body); sent.push(b);
    if (sent.length < 4) return new Response(JSON.stringify({ choices: [{ message: { content: null, tool_calls: Array.from({ length: 6 }, (_, i) => ({ id: `c${sent.length}${i}`, type: 'function', function: { name: 'get_climate', arguments: '{}' } })) }, finish_reason: 'tool_calls' }], usage: { total_tokens: 100 } }));
    return reply('done');
  };
  await ask(env2, d1(), 'ipC', 'q', big);
  const toolChars = sent.at(-1).messages.filter((m) => m.role === 'tool').reduce((s, m) => s + m.content.length, 0);
  ok(toolChars <= 12000, `tool output per question is capped (${toolChars} chars)`);
  const a1 = sent[1].messages.find((m) => m.role === 'assistant');
  const answered = sent[1].messages.filter((m) => m.role === 'tool').length;
  ok(a1.tool_calls.length === answered, `assistant message lists only the tool calls that get answers (${a1.tool_calls.length} vs ${answered})`);
  const lastReq = sent.at(-1);
  ok(lastReq.tool_choice === 'auto' && Array.isArray(lastReq.tools), 'last round keeps tools with tool_choice auto (Nebius lists no "none")');
  ok(/do not call any more tools/i.test(lastReq.messages.at(-1).content || ''), 'last round tells the model to answer now');
}

console.log('I2: mock is strict and never cached');
{
  const db = d1();
  const r = await chat({ ...ENV, AI_MOCK: '0', NEBIUS_API_KEY: '' }, db, 'ip', { messages: [{ role: 'user', content: 'z' }] });
  ok(r.paused === 'nokey', `AI_MOCK "0" is not mock: ${r.paused}`);
  await chat({ ...ENV, AI_MOCK: '1' }, db, 'ip', { messages: [{ role: 'user', content: 'm' }] });
  ok(db.raw.prepare('SELECT COUNT(*) AS n FROM cache').get().n === 0, 'mock replies are not cached');
}

console.log('I3: reasoning never leaks, empty or cut answers not cached');
{
  ok(clean('<think>secret plan') === '', 'unclosed think block stripped');
  ok(clean('<think>a</think>Answer') === 'Answer', 'closed think block stripped');
  const db = d1();
  globalThis.fetch = async () => reply('half an answ', { finish_reason: 'length' });
  await chat(ENV, db, 'ip', { messages: [{ role: 'user', content: 'cut' }] });
  globalThis.fetch = async () => reply('');
  await chat(ENV, db, 'ip', { messages: [{ role: 'user', content: 'empty' }] });
  ok(db.raw.prepare('SELECT COUNT(*) AS n FROM cache').get().n === 0, 'truncated and empty replies not cached');
}

console.log('I5, I6: IP keys');
{
  const req = (ip, host = 'crossfarm.pages.dev') => new Request(`https://${host}/api/x`, { headers: { 'CF-Connecting-IP': ip } });
  ok((await ipKey(req('1.2.3.4'), {})) === null, 'no IP_SALT outside localhost: refused (null)');
  ok(typeof (await ipKey(req('1.2.3.4', '127.0.0.1:8788'), {})) === 'string', 'no IP_SALT on localhost: allowed');
  const a = await ipKey(req('2001:db8:1:2:aaaa::1'), { IP_SALT: 's' });
  const b = await ipKey(req('2001:db8:1:2:ffff:1:2:3'), { IP_SALT: 's' });
  const c = await ipKey(req('2001:db8:1:3::1'), { IP_SALT: 's' });
  ok(a === b && a !== c, 'IPv6 keyed on its /64');
}

console.log('writeAllowed holds under parallel writes');
{
  const db = d1();
  const rs = await Promise.all(Array.from({ length: 40 }, () => writeAllowed(db, 'ipW')));
  ok(rs.filter(Boolean).length === 20, `40 parallel writes, limit 20: ${rs.filter(Boolean).length} allowed`);
}

console.log('overall deadline');
{
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 60));
    return new Response(JSON.stringify({ choices: [{ message: { content: null, tool_calls: [{ id: `x${calls}`, type: 'function', function: { name: 'get_soil', arguments: '{}' } }] } }], usage: { total_tokens: 10 } }));
  };
  const r = await ask({ ...ENV, AI_QUESTION_MS: '100' }, d1(), 'ipD', 'q', { farm: {} });
  ok(r.paused === 'deadline' && calls <= 2, `no new round starts after the question deadline (${r.paused}, ${calls} calls)`);
}

console.log('demo people are always labelled');
{
  const { demoNote } = await import('../functions/_lib/agent.js');
  const field = { threads: [{ who: 'Reto Gerber (demo thread, fictional person)' }, { who: 'Claire Fournier (demo thread, fictional person)' }, { who: 'Anna Real' }] };
  const a1 = demoNote('Ask Reto Gerber in Kerzers about inoculants.', field);
  ok(/Reto Gerber/.test(a1.split('\n').pop()) && /fictional/i.test(a1), 'unlabelled demo person gets a note');
  const a2 = demoNote('Claire Fournier (demo thread) wrote about soy.', field);
  ok(a2 === 'Claire Fournier (demo thread) wrote about soy.', 'already labelled: unchanged');
  ok(demoNote('Ask Anna Real.', field) === 'Ask Anna Real.', 'real posters untouched');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

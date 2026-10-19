// Spend guard and model client, offline: fake D1, fake fetch. node scripts/ai_check.mjs
import { guard } from '../functions/_lib/budget.js';
import { chat } from '../functions/_lib/ai.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ', m); } else { fail++; console.log('  FAIL', m); } };

// Real SQL through node:sqlite (scripts/_d1.mjs); U() reads a usage counter
import { d1 } from './_d1.mjs';
const fakeDb = d1;
const U = (db, k) => db.raw.prepare('SELECT tokens, calls FROM usage WHERE k = ?').get(k) || { tokens: 0, calls: 0 };

const ENV = { AI_ENABLED: '1', NEBIUS_API_KEY: 'test-key', AI_TOKENS_TOTAL: '10000', AI_TOKENS_DAY: '5000', AI_CALLS_IP_DAY: '15', AI_TOKENS_IP_DAY: '1000000', AI_MAX_TOKENS: '600', AI_BASE_URL: 'https://example.invalid/v1/', AI_MODEL: 'm' };
let fetches = 0;
globalThis.fetch = async (url, init) => {
  fetches++;
  return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'hello' } }], usage: { total_tokens: 120 } }), { status: 200 });
};
const MSG = (t) => ({ model: 'm', messages: [{ role: 'user', content: t }], max_tokens: 100 });

console.log('guard');
{
  const db = fakeDb();
  ok((await guard({ ...ENV, AI_ENABLED: undefined }, db, 'ip1', 100)).reason === 'off', 'AI_ENABLED unset: off');
  ok((await guard({ ...ENV, AI_ENABLED: '0' }, db, 'ip1', 100)).reason === 'off', 'AI_ENABLED "0": off');
  ok((await guard({ ...ENV, NEBIUS_API_KEY: '' }, db, 'ip1', 100)).reason === 'nokey', 'no key: nokey');
  ok((await guard({ ...ENV, AI_TOKENS_DAY: '50' }, db, 'ip1', 100)).reason === 'day', 'estimate over day cap: day');
  ok((await guard({ ...ENV, AI_TOKENS_TOTAL: '50' }, db, 'ip1', 100)).reason === 'total', 'estimate over total cap: total');
  ok((await guard({ ...ENV, AI_TOKENS_TOTAL: 'abc' }, db, 'ip1', 100)).reason === 'total', 'unreadable cap counts as zero, not unlimited');
  const g = await guard(ENV, db, 'ip1', 1000);
  ok(g.ok === true, 'within caps: ok');
  ok(U(db, 'total').tokens === 1000, 'reservation booked against total before the call');
  await g.settle(300);
  ok(U(db, 'total').tokens === 300, `settle replaces reservation with actual usage (got ${U(db, 'total').tokens})`);
  for (let i = 0; i < 15; i++) await (await guard(ENV, db, "ip2", 10)).settle(10);
  ok((await guard(ENV, db, 'ip2', 10)).reason === 'ip', '16th call from one IP on one day: ip');
  ok((await guard(ENV, db, 'ip3', 10)).ok, 'another IP still allowed');
}

console.log('chat');
{
  const db = fakeDb();
  fetches = 0;
  const off = await chat({ ...ENV, AI_ENABLED: undefined }, db, 'ip', MSG('a'));
  ok(off.paused === 'off' && fetches === 0, 'off: paused, fetch never called');
  const r1 = await chat(ENV, db, 'ip', MSG('same question'));
  ok(r1.message?.content === 'hello' && !r1.cached && fetches === 1, 'first call goes to the model');
  const spent = U(db, 'total').tokens;
  ok(spent === 120, `actual usage recorded (got ${spent})`);
  const r2 = await chat(ENV, db, 'ip', MSG('same question'));
  ok(r2.cached === true && fetches === 1 && U(db, 'total').tokens === spent, 'identical call served from cache at zero cost');
  globalThis.fetch = async () => { fetches++; return new Response('nope', { status: 401 }); };
  const bad = await chat(ENV, db, 'ip', MSG('other'));
  ok(bad.paused === 'error', 'provider error: paused, not thrown');
  ok(U(db, 'total').tokens === spent, 'failed call releases its reservation');
  fetches = 0;
  const mock = await chat({ ...ENV, AI_MOCK: '1', NEBIUS_API_KEY: '' }, db, 'ip', { ...MSG('x'), tools: [{ type: 'function', function: { name: 'get_soil', parameters: {} } }] });
  ok(fetches === 0 && mock.message?.tool_calls?.[0]?.function?.name === 'get_soil', 'mock: first round calls the first tool, no network');
  let sent;
  globalThis.fetch = async (url, init) => { sent = JSON.parse(init.body); return new Response(JSON.stringify({ choices: [{ message: { content: 'k' } }], usage: { total_tokens: 9 } })); };
  const capped = await chat({ ...ENV, AI_MAX_TOKENS: '50' }, fakeDb(), 'ip', { ...MSG('y'), max_tokens: 5000 });
  ok(capped.message && sent?.max_tokens === 50, `max_tokens clamped to AI_MAX_TOKENS (sent ${sent?.max_tokens})`);
  const xdb = fakeDb();
  await chat(ENV, xdb, 'ip', { ...MSG('z'), extra: { chat_template_kwargs: { enable_thinking: false } } });
  ok(sent?.chat_template_kwargs?.enable_thinking === false, 'extra request fields reach the provider');
  sent = null;
  await chat(ENV, xdb, 'ip', MSG('z'));
  ok(sent !== null, 'a call without the extra fields is not served from the other call\'s cache');
}

console.log('translate');
{
  const { onRequestPost } = await import('../functions/api/translate.js');
  const TENV = { ...ENV, IP_SALT: 'salt' };
  const req = (text) => new Request('https://x.test/api/translate', { method: 'POST', headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '10.9.9.9' }, body: JSON.stringify({ text, to: 'de' }) });
  let sent;
  globalThis.fetch = async (url, init) => { sent = JSON.parse(init.body); return new Response(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '' } }], usage: { total_tokens: 100 } })); };
  const empty = await (await onRequestPost({ request: req('When did you start irrigating?'), env: { ...TENV, DB: fakeDb() } })).json();
  ok(empty.paused && !('text' in empty), `empty model output is reported as unavailable, never as an empty translation (got ${JSON.stringify(empty)})`);
  ok(sent?.chat_template_kwargs?.enable_thinking === false, 'translation asks the model not to reason first');
  ok(sent?.max_tokens >= 200, `translation leaves room for the answer (max_tokens ${sent?.max_tokens})`);
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: 'Wann habt ihr angefangen zu bewässern?' } }], usage: { total_tokens: 40 } }));
  const good = await (await onRequestPost({ request: req('When did you start irrigating?'), env: { ...TENV, DB: fakeDb() } })).json();
  ok(good.text === 'Wann habt ihr angefangen zu bewässern?', 'a real translation comes back as text');
}

console.log('grounding');
{
  const { ungrounded, runTool } = await import('../functions/_lib/agent.js');
  ok(ungrounded('pH 6.1 and 74 out of 100', ['{"ph":6.1}', '{"now":74}']).length === 0, 'numbers present in tool results pass');
  ok(JSON.stringify(ungrounded('pH 7.9 here', ['{"ph":6.1}'])) === '[7.9]', 'invented number is flagged');
  ok(ungrounded('about 1.4 °C warmer', ['{"dTemp":1.43}']).length === 0, 'rounded to one decimal passes');
  ok(ungrounded('rain falls 12%', ['{"dRain":-0.12}']).length === 0, 'share shown as percent passes');
  ok(ungrounded('1. Check soil\n2. Ask farmers in Limburg', ['{}']).length === 0, 'list markers ignored');
  const field = { crops: [{ id: 'potato', name: 'Potato', now: 74 }], soil: null };
  ok(runTool('get_crop_scores', { crop: 'Potato' }, field)[0]?.now === 74, 'crop lookup by name');
  ok(runTool('get_soil', {}, field).missing, 'missing soil says so instead of inventing');
  ok(runTool('rm_rf', {}, field).error, 'unknown tool returns an error object');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

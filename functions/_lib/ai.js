// Model client for Nebius Token Factory (OpenAI-compatible Chat Completions).
// Every call: cache lookup, then guard(), then the request, then settle with real usage.
import { guard, estimate, cap } from './budget.js';
import { sha } from './http.js';

// Provider answers that mean the request was refused before any generation (not billed)
const REJECTED = new Set([400, 401, 403, 404, 422, 429]);

// extra: further request fields for the provider (e.g. chat_template_kwargs); part of the cache key
export async function chat(env, db, ip, { model, messages, tools, tool_choice, max_tokens = 400, timeoutMs = 25000, extra = null }) {
  if (env.AI_ENABLED !== '1') return { paused: 'off' };
  const mock = env.AI_MOCK === '1';
  const maxTokens = Math.min(max_tokens, cap(env.AI_MAX_TOKENS) || 1);
  const m = model || env.AI_MODEL;
  const key = await sha(JSON.stringify([m, messages, tools || null, tool_choice || null, maxTokens, extra]));
  if (!mock) {
    const hit = await db.prepare('SELECT body FROM cache WHERE k = ?').bind(key).first();
    if (hit) return { ...JSON.parse(hit.body), cached: true };
  }

  const est = estimate(messages, tools, maxTokens);
  const g = await guard(env, db, ip, est);
  if (!g.ok) return { paused: g.reason };

  let out;
  try {
    out = mock ? fake(messages, tools, tool_choice) : await call(env, m, messages, tools, tool_choice, maxTokens, timeoutMs, extra);
  } catch (e) {
    // Refused up front: release. Timeout, 5xx, broken reply: it may have been billed, keep it booked.
    await g.settle(e.rejected ? 0 : est);
    console.log('model call failed:', String(e?.message || e).slice(0, 200));
    return { paused: 'error' };
  }
  await g.settle(out.usage?.total_tokens ?? est);
  const choice = out.choices?.[0] || {};
  const res = { message: choice.message || { role: 'assistant', content: '' }, finish: choice.finish_reason || null, usage: out.usage || null };
  const complete = res.finish !== 'length' && (res.message.tool_calls?.length || String(res.message.content || '').trim());
  if (!mock && complete) {
    await db.prepare('INSERT OR REPLACE INTO cache (k, created, body) VALUES (?, ?, ?)').bind(key, Date.now(), JSON.stringify(res)).run();
    // the privacy notice promises at most 90 days
    await db.prepare('DELETE FROM cache WHERE created < ?').bind(Date.now() - 90 * 864e5).run();
  }
  return { ...res, cached: false };
}

async function call(env, model, messages, tools, tool_choice, maxTokens, timeoutMs, extra) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), Math.max(1000, timeoutMs));
  try {
    const r = await fetch(new URL('chat/completions', env.AI_BASE_URL), {
      method: 'POST',
      signal: ctl.signal,
      headers: { authorization: `Bearer ${env.NEBIUS_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ...(extra || {}), model, messages, tools, tool_choice, max_tokens: maxTokens, temperature: 0.2 }),
    });
    if (!r.ok) throw Object.assign(new Error(`provider ${r.status}`), { rejected: REJECTED.has(r.status) });
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

// Offline stand-in for local development and checks (AI_MOCK=1 only): calls up to two of the
// offered tools, then answers by quoting the tool results. Never touches the network, never cached.
function fake(messages, tools, tool_choice) {
  const done = new Set(messages.filter((x) => x.role === 'tool').map((x) => x.name));
  const next = (tools || []).map((t) => t.function.name).find((n) => !done.has(n));
  const told = /do not call any more tools/i.test(messages.at(-1)?.content || '');
  if (next && done.size < 2 && !told) {
    return { choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null,
      tool_calls: [{ id: `call_${next}`, type: 'function', function: { name: next, arguments: '{}' } }] } }], usage: { total_tokens: 50 } };
  }
  const facts = messages.filter((x) => x.role === 'tool').map((x) => x.content).join(' ');
  const last = [...messages].reverse().find((x) => x.role === 'user')?.content || '';
  const text = tools ? `(Mock answer) From your field data: ${facts.slice(0, 280)}` : `(Mock translation) ${String(last).split('\n').pop()}`;
  return { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: text } }], usage: { total_tokens: 80 } };
}

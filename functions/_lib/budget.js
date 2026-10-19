// Spend guard for the assistant. Every model call must pass guard() first.
//
// Hard rules (the key is tied to a real payment method):
//  - nothing is called unless AI_ENABLED is exactly "1" and a key is set
//  - caps are read from env; a missing or unreadable cap counts as 0, never as unlimited
//  - a reservation is one conditional UPDATE per counter ("only if still under the cap"),
//    so parallel requests cannot overshoot; a later refusal refunds the earlier counters
//  - after the call, settle() replaces the estimate with the real usage; a call that may
//    have been billed (timeout, 5xx, unreadable reply) keeps its estimate booked
import { today } from './http.js';

export const cap = (v) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

const keysFor = (ip) => {
  const d = today();
  return { total: 'total', day: `day:${d}`, ip: `ip:${d}:${ip}` };
};

const ensure = (db, keys) =>
  db.batch(Object.values(keys).map((k) => db.prepare('INSERT OR IGNORE INTO usage (k, tokens, calls) VALUES (?, 0, 0)').bind(k)));

async function take(db, k, est, maxTokens, maxCalls) {
  const r = maxCalls == null
    ? await db.prepare('UPDATE usage SET tokens = tokens + ?, calls = calls + 1 WHERE k = ? AND tokens + ? <= ?').bind(est, k, est, maxTokens).run()
    : await db.prepare('UPDATE usage SET tokens = tokens + ?, calls = calls + 1 WHERE k = ? AND tokens + ? <= ? AND calls < ?').bind(est, k, est, maxTokens, maxCalls).run();
  return (r.meta?.changes ?? 0) > 0;
}
const adjust = (db, k, tokens, calls = 0) =>
  db.prepare('UPDATE usage SET tokens = tokens + ?, calls = calls + ? WHERE k = ?').bind(tokens, calls, k).run();

export function preconditions(env, ip) {
  if (env.AI_ENABLED !== '1') return 'off';
  if (env.AI_MOCK !== '1' && !env.NEBIUS_API_KEY) return 'nokey';
  if (!ip) return 'config';
  return null;
}

export async function guard(env, db, ip, estimate) {
  const pre = preconditions(env, ip);
  if (pre) return { ok: false, reason: pre };
  const keys = keysFor(ip);
  await ensure(db, keys);
  if (!(await take(db, keys.total, estimate, cap(env.AI_TOKENS_TOTAL)))) return { ok: false, reason: 'total' };
  if (!(await take(db, keys.day, estimate, cap(env.AI_TOKENS_DAY)))) {
    await adjust(db, keys.total, -estimate, -1);
    return { ok: false, reason: 'day' };
  }
  if (!(await take(db, keys.ip, estimate, cap(env.AI_TOKENS_IP_DAY), cap(env.AI_CALLS_IP_DAY)))) {
    await adjust(db, keys.total, -estimate, -1);
    await adjust(db, keys.day, -estimate, -1);
    return { ok: false, reason: 'ip' };
  }
  let settled = false;
  return {
    ok: true,
    // used = tokens the provider reported; 0 releases the reservation (only for definite rejections)
    async settle(used) {
      if (settled) return;
      settled = true;
      const diff = Math.max(0, Math.round(used || 0)) - estimate;
      for (const k of Object.values(keys)) await adjust(db, k, diff);
    },
  };
}

// Tokens still available to this person right now (the smallest of the three caps).
// A read, not a reservation: used to refuse a question that could not finish anyway.
export async function headroom(env, db, ip) {
  const keys = keysFor(ip);
  const get = async (k) => (await db.prepare('SELECT tokens, calls FROM usage WHERE k = ?').bind(k).first()) || { tokens: 0, calls: 0 };
  const [t, d, i] = [await get(keys.total), await get(keys.day), await get(keys.ip)];
  const left = {
    total: cap(env.AI_TOKENS_TOTAL) - t.tokens,
    day: cap(env.AI_TOKENS_DAY) - d.tokens,
    ip: cap(env.AI_TOKENS_IP_DAY) - i.tokens,
  };
  const calls = cap(env.AI_CALLS_IP_DAY) - i.calls;
  const [reason, tokens] = Object.entries(left).sort((a, b) => a[1] - b[1])[0];
  return { tokens, reason, calls };
}

// Rough token estimate: about 2.5 characters per token for JSON-heavy prompts, plus the answer budget
export const estimate = (messages, tools, maxTokens) =>
  Math.ceil((JSON.stringify(messages).length + JSON.stringify(tools || []).length) / 2.5) + maxTokens;

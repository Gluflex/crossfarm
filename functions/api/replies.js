import { json, bad, body, clip, ipKey, writeAllowed, lang, notConfigured } from '../_lib/http.js';

const ROLES = ['Farmer', 'Agronomist', 'Crossfarm'];
export const reserved = (who) => /crossfarm/i.test(String(who || ''));

export async function onRequestPost({ request, env }) {
  const b = await body(request);
  if (!b) return bad('invalid json');
  const text = clip(b.text, 2000);
  if (!text) return bad('answer is empty');
  const thread = await env.DB.prepare('SELECT id, token FROM threads WHERE id = ? AND hidden = 0').bind(clip(b.thread, 40)).first();
  if (!thread) return bad('no such thread', 404);
  const role = ROLES.includes(b.role) ? b.role : 'Farmer';
  // The Crossfarm data answer is the app's own voice: only the asker's device (holding the
  // thread's edit token) may post it, once per thread. Nobody else may use the name.
  if (role === 'Crossfarm') {
    if (!b.token || b.token !== thread.token) return bad('not allowed', 403);
    const has = await env.DB.prepare("SELECT 1 AS x FROM replies WHERE thread = ? AND role = 'Crossfarm'").bind(thread.id).first();
    if (has) return bad('already answered', 409);
  } else if (reserved(b.who)) {
    return bad('that name is reserved');
  }
  const ip = await ipKey(request, env);
  if (!ip) return notConfigured();
  if (!(await writeAllowed(env.DB, ip))) return bad('too many posts today', 429);
  const who = role === 'Crossfarm' ? 'Crossfarm' : clip(b.who, 60) || 'Farmer';
  const id = 'r' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  const token = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO replies (id, thread, created, who, place, role, text, lang, token) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, thread.id, Date.now(), who, role === 'Crossfarm' ? '' : clip(b.place, 80), role, text, role === 'Crossfarm' ? 'en' : lang(b.lang), token).run();
  return json({ id, token });
}

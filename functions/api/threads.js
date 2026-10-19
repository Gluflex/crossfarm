import { json, bad, body, clip, ipKey, writeAllowed, notConfigured, lang } from '../_lib/http.js';

const round1 = (v) => (v === null || v === '' || v === undefined || !Number.isFinite(+v) ? null : Math.round(+v * 10) / 10);

// Newest 200 visible threads with their visible answers. Edit tokens never leave the server.
export async function onRequestGet({ env }) {
  const { results: ts } = await env.DB.prepare(
    `SELECT id, created, who, place, lat, lon, crop, q, body, context, lang, routed, helpful
       FROM threads WHERE hidden = 0 ORDER BY created DESC LIMIT 200`).all();
  const { results: rs } = await env.DB.prepare(
    `SELECT id, thread, created, who, place, role, text, lang FROM replies
      WHERE hidden = 0 AND thread IN (SELECT id FROM threads WHERE hidden = 0 ORDER BY created DESC LIMIT 200)
      ORDER BY created`).all();
  const by = {};
  for (const r of rs) (by[r.thread] ||= []).push(r);
  return json({ threads: ts.map((t) => ({ ...t, answers: by[t.id] || [] })) });
}

export async function onRequestPost({ request, env }) {
  const b = await body(request);
  if (!b) return bad('invalid json');
  const q = clip(b.q, 200);
  if (!q) return bad('question is empty');
  if (/crossfarm/i.test(String(b.who || ''))) return bad('that name is reserved');
  const ip = await ipKey(request, env);
  if (!ip) return notConfigured();
  if (!(await writeAllowed(env.DB, ip))) return bad('too many posts today', 429);
  const id = 't' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  const token = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO threads (id, created, who, place, lat, lon, crop, q, body, context, lang, routed, token)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
    id, Date.now(), clip(b.who, 60) || 'Farmer', clip(b.place, 80), round1(b.lat), round1(b.lon), clip(b.crop, 30),
    q, clip(b.body, 2000), clip(b.context, 300), lang(b.lang), b.routed ? 1 : 0, token).run();
  return json({ id, token });
}

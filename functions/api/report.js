import { json, bad, body, clip, ipKey, writeAllowed, notConfigured } from '../_lib/http.js';

const HIDE_AT = 3;   // reports from different people before a post is hidden for review
const TABLE = { thread: 'threads', reply: 'replies' };   // fixed names, never from input

export async function onRequestPost({ request, env }) {
  const b = await body(request);
  const kind = b?.kind === 'reply' ? 'reply' : b?.kind === 'thread' ? 'thread' : null;
  const target = clip(b?.target, 40);
  if (!kind || !target) return bad('kind and target required');
  const exists = await env.DB.prepare(`SELECT 1 AS x FROM ${TABLE[kind]} WHERE id = ? AND hidden = 0`).bind(target).first();
  if (!exists) return bad('no such post', 404);
  const ip = await ipKey(request, env);
  if (!ip) return notConfigured();
  if (!(await writeAllowed(env.DB, ip))) return bad('too many reports today', 429);
  await env.DB.prepare('INSERT OR IGNORE INTO reports (kind, target, created, ip) VALUES (?, ?, ?, ?)')
    .bind(kind, target, Date.now(), ip).run();
  const n = (await env.DB.prepare('SELECT COUNT(*) AS n FROM reports WHERE kind = ? AND target = ?').bind(kind, target).first()).n;
  if (n >= HIDE_AT) await env.DB.prepare(`UPDATE ${TABLE[kind]} SET hidden = 1 WHERE id = ?`).bind(target).run();
  return json({ ok: true });
}

import { json, bad, body, clip, ipKey, writeAllowed, notConfigured } from '../_lib/http.js';

const ROLES = ['farmer', 'adviser', 'researcher', 'other'];

// Pilot sign-up. Contact details are stored for the pilot only and no endpoint ever returns them.
export async function onRequestPost({ request, env }) {
  const b = await body(request);
  if (!b) return bad('invalid json');
  if (b.consent !== true) return bad('consent required');
  const contact = clip(b.contact, 120);
  if (!contact) return bad('contact required');
  const ip = await ipKey(request, env);
  if (!ip) return notConfigured();
  if (!(await writeAllowed(env.DB, ip))) return bad('too many sign-ups today', 429);
  await env.DB.prepare('INSERT INTO pilot (created, role, region, contact, note) VALUES (?, ?, ?, ?, ?)')
    .bind(Date.now(), ROLES.includes(b.role) ? b.role : 'other', clip(b.region, 80), contact, clip(b.note, 500)).run();
  return json({ ok: true });
}

// Small helpers shared by every /api function.

export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

export const bad = (msg, status = 400) => json({ error: msg }, status);

export async function sha(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// IPv6 users can rotate within their /64, so they are counted per /64
export function prefix64(ip) {
  if (!ip.includes(':')) return ip;
  const [h, t = ''] = ip.split('::');
  const hs = h ? h.split(':') : [], ts = t ? t.split(':') : [];
  const full = [...hs, ...Array(Math.max(0, 8 - hs.length - ts.length)).fill('0'), ...ts];
  return full.slice(0, 4).map((g) => g.toLowerCase().replace(/^0+(?=.)/, '')).join(':') + '::/64';
}

const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/;

// Salted hash of the caller's IP: enough to count per person, never stored raw.
// Without IP_SALT (a secret) the hash could be reversed, so outside local dev it returns null
// and callers refuse with 503.
export async function ipKey(request, env) {
  const host = new URL(request.url).hostname;
  if (!env.IP_SALT && !LOCAL.test(host)) return null;
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  return (await sha(`${env.IP_SALT || 'local-dev'}:${prefix64(ip)}`)).slice(0, 24);
}

export const notConfigured = () => json({ error: 'server not configured' }, 503);

export const clip = (s, n) => (s == null ? '' : String(s).trim().slice(0, n));

export const today = () => new Date().toISOString().slice(0, 10);

export async function body(request) {
  try { return await request.json(); } catch { return null; }
}

// Per-person write limit for community endpoints, reserved atomically
export async function writeAllowed(db, ip, limit = 20) {
  const k = `w:${today()}:${ip}`;
  await db.prepare('INSERT OR IGNORE INTO usage (k, tokens, calls) VALUES (?, 0, 0)').bind(k).run();
  const r = await db.prepare('UPDATE usage SET calls = calls + 1 WHERE k = ? AND calls < ?').bind(k, limit).run();
  return (r.meta?.changes ?? 0) > 0;
}

export const LANGS = ['en', 'de', 'fr', 'it', 'es', 'nl', 'pl', 'pt'];
export const lang = (l) => (LANGS.includes(String(l || '').slice(0, 2)) ? String(l).slice(0, 2) : 'en');

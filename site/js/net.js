// Calls to Crossfarm's own /api. POST when a body is given. Throws on network errors and non-2xx.
export async function api(path, body, ms = 12000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(path.replace(/^\//, ''), {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctl.signal,
    });
    const data = await r.json().catch(() => null);
    if (!r.ok) throw Object.assign(new Error(data?.error || `HTTP ${r.status}`), { status: r.status });
    return data;
  } finally {
    clearTimeout(t);
  }
}

export const uiLang = () => (navigator.language || 'en').slice(0, 2).toLowerCase();

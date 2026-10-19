import { json } from '../_lib/http.js';

// Public counters for the pilot: no personal data, only totals
export async function onRequestGet({ env }) {
  const one = async (sql) => (await env.DB.prepare(sql).first())?.n ?? 0;
  return json({
    questions: await one('SELECT COUNT(*) AS n FROM threads WHERE hidden = 0'),
    answers: await one("SELECT COUNT(*) AS n FROM replies WHERE hidden = 0 AND role != 'Crossfarm'"),
    routed: await one('SELECT COUNT(*) AS n FROM threads WHERE hidden = 0 AND routed = 1'),
    pilot: await one('SELECT COUNT(*) AS n FROM pilot'),
  });
}

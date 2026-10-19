// Checks the /api functions against a local `wrangler pages dev` (AI_MOCK=1, fresh local D1).
//   node scripts/api_check.mjs [base] [section...]     sections: stats ask community
// Start the server first: scripts\api_dev.cmd
const args = process.argv.slice(2);
const BASE = args[0]?.startsWith('http') ? args.shift() : 'http://127.0.0.1:8788';
const only = new Set(args);
let pass = 0, fail = 0;

function ok(cond, msg) {
  if (cond) { pass++; console.log('  ok  ', msg); } else { fail++; console.log('  FAIL', msg); }
}
async function call(path, body, ip = '10.0.0.1') {
  const r = await fetch(BASE + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', 'CF-Connecting-IP': ip },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try { data = await r.json(); } catch { /* not json */ }
  return { status: r.status, data };
}
const run = (name) => !only.size || only.has(name);
const uniq = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

if (run('stats')) {
  console.log('stats');
  const s = await call('/api/stats');
  ok(s.status === 200, `GET /api/stats is 200 (got ${s.status})`);
  for (const k of ['questions', 'answers', 'routed', 'pilot']) ok(Number.isInteger(s.data?.[k]), `stats.${k} is an integer`);
}

if (run('community')) {
  console.log('community');
  const ip = uniq();
  const before = (await call('/api/stats')).data;
  const t = await call('/api/threads', { who: 'Test farmer', place: 'Barneveld', lat: 52.14567, lon: 5.58321, crop: 'potato',
    q: '<b>Blight</b> early again? ' + 'x'.repeat(400), body: 'Details', lang: 'en', routed: 1 }, ip);
  ok(t.status === 200 && t.data?.id && t.data?.token, 'POST /api/threads returns id and token');
  const list = (await call('/api/threads')).data?.threads || [];
  const mine = list.find((x) => x.id === t.data?.id);
  ok(!!mine, 'new thread is listed');
  ok(mine && mine.lat === 52.1 && mine.lon === 5.6, `position rounded to 0.1 degree (got ${mine?.lat}, ${mine?.lon})`);
  ok(mine && mine.q.length === 200 && mine.q.startsWith('<b>Blight</b>'), 'question stored as text, truncated to 200');
  ok(mine && !('token' in mine), 'token never returned in the list');
  const r = await call('/api/replies', { thread: t.data?.id, who: 'Other farmer', place: 'Ede', role: 'Farmer', text: 'Carolus worked for us.' }, uniq());
  ok(r.status === 200 && r.data?.id, 'POST /api/replies works');
  const fake = await call('/api/replies', { thread: t.data?.id, who: 'Mallory', role: 'Crossfarm', text: 'invented advice' }, uniq());
  ok(fake.status === 403, `role Crossfarm without the thread's token is 403 (got ${fake.status})`);
  const named = await call('/api/replies', { thread: t.data?.id, who: 'CrossFarm team', role: 'Farmer', text: 'trust me' }, uniq());
  ok(named.status === 400, 'the name Crossfarm is reserved for other roles');
  const real = await call('/api/replies', { thread: t.data?.id, role: 'Crossfarm', token: t.data?.token, text: 'data answer' }, ip);
  const again = (await call('/api/threads')).data.threads.find((x) => x.id === t.data?.id);
  ok(real.status === 200 && again.answers.some((a) => a.role === 'Crossfarm' && a.who === 'Crossfarm' && a.lang === 'en'), 'asker posts the data answer with the token, stored as Crossfarm in English');
  const twice = await call('/api/replies', { thread: t.data?.id, role: 'Crossfarm', token: t.data?.token, text: 'again' }, ip);
  ok(twice.status === 409, 'only one data answer per thread');
  ok((await call('/api/report', { kind: 'thread', target: 'nope' }, uniq())).status === 404, 'report on an unknown post is 404');
  ok((await call('/api/replies', { thread: 'nope', who: 'x', text: 'y' }, uniq())).status === 404, 'reply to unknown thread is 404');
  const after = (await call('/api/stats')).data;
  ok(after.questions === before.questions + 1 && after.routed === before.routed + 1, 'stats count the question and the routing');
  ok(after.answers === before.answers + 1, 'stats count farmer answers, not the Crossfarm data answer');
  const rip = uniq().split('.').slice(0, 3).join('.');
  await call('/api/report', { kind: 'thread', target: t.data?.id }, `${rip}.1`);
  await call('/api/report', { kind: 'thread', target: t.data?.id }, `${rip}.1`);
  await call('/api/report', { kind: 'thread', target: t.data?.id }, `${rip}.2`);
  ok((await call('/api/threads')).data.threads.some((x) => x.id === t.data?.id), 'repeat report from the same person is not counted twice');
  await call('/api/report', { kind: 'thread', target: t.data?.id }, `${rip}.3`);
  ok(!(await call('/api/threads')).data.threads.some((x) => x.id === t.data?.id), 'three reports hide the thread');
  const p0 = await call('/api/pilot', { role: 'farmer', region: 'Seeland', contact: 'a@b.ch' }, uniq());
  ok(p0.status === 400, 'pilot sign-up without consent is 400');
  const p1 = await call('/api/pilot', { role: 'farmer', region: 'Seeland', contact: 'a@b.ch', consent: true }, uniq());
  ok(p1.status === 200 && p1.data?.ok, 'pilot sign-up with consent works');
  ok((await call('/api/stats')).data.pilot === before.pilot + 1, 'stats count the pilot sign-up');
  const flood = uniq();
  let last;
  for (let i = 0; i < 21; i++) last = await call('/api/pilot', { role: 'other', contact: 'x@y.z', consent: true }, flood);
  ok(last.status === 429, `21st write from one IP on one day is 429 (got ${last.status})`);
  ok((await call('/api/threads', { who: 'x', q: '' }, uniq())).status === 400, 'empty question is 400');
}

if (run('ask')) {
  console.log('ask (needs AI_MOCK=1 and AI_ENABLED=1 in .dev.vars)');
  const field = {
    farm: { name: 'Test farm', region: 'Gelderland', country: 'Netherlands', lat: 52.1, lon: 5.6, ha: 40, family: 'potato' },
    climate: { dTemp: 1.4, baseRain: 807, futureRain: 790, hot30: [2, 6] },
    soil: { ph: 6.1, texture: 'Sandy loam' },
    ndvi: null,
    crops: [{ id: 'potato', name: 'Potato', now: 74, later: 61, limit: 'Heatwaves' }],
    analogue: { novel: false, homeSigma: 2.3, regions: [{ name: 'Limburg', country: 'Belgium', km: 120, dir: 'south', sigma: 0.4 }] },
    threads: [{ who: 'Wim Claes', place: 'Peer, Limburg', crop: 'potato', q: 'Irrigating potatoes on sand', twin: true, sigma: 0.3 }],
  };
  const a = await call('/api/ask', { question: 'Will my potatoes still work in 2040?', field }, uniq());
  ok(a.status === 200 && typeof a.data?.answer === 'string' && a.data.answer.length > 0, 'POST /api/ask returns an answer');
  ok(Array.isArray(a.data?.used) && a.data.used.length >= 1, `answer used at least one tool (${a.data?.used})`);
  ok(['ok', 'unverified'].includes(a.data?.numbers), 'answer carries a number check');
  ok((await call('/api/ask', { question: '', field }, uniq())).status === 400, 'empty question is 400');
  const tr = await call('/api/translate', { text: 'x'.repeat(2001), to: 'de' }, uniq());
  ok(tr.status === 400, 'translate over 2,000 characters is 400');
  const t2 = await call('/api/translate', { text: 'Carolus worked for us.', to: 'nl' }, uniq());
  ok(t2.status === 200 && typeof t2.data?.text === 'string', 'translate returns text');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

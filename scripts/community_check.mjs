// Offline posts are sent once the server is reachable again. node scripts/community_check.mjs
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ', m); } else { fail++; console.log('  FAIL', m); } };

const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };

let up = false;
const db = { threads: [], replies: [] };
globalThis.fetch = async (path, init = {}) => {
  if (!up) throw new TypeError('offline');
  const body = init.body ? JSON.parse(init.body) : null;
  const res = (d, status = 200) => new Response(JSON.stringify(d), { status });
  if (path === 'api/threads' && !body) return res({ threads: db.threads.map((t) => ({ ...t, answers: db.replies.filter((r) => r.thread === t.id) })) });
  if (path === 'api/threads') { const id = 't' + db.threads.length; db.threads.push({ ...body, id, created: Date.now(), token: 'tok' + id }); return res({ id, token: 'tok' + id }); }
  if (path === 'api/replies') {
    const t = db.threads.find((x) => x.id === body.thread);
    if (body.role === 'Crossfarm' && body.token !== t.token) return res({ error: 'not allowed' }, 403);
    db.replies.push({ ...body, id: 'r' + db.replies.length, created: Date.now() });
    return res({ id: 'r' + db.replies.length, token: 'x' });
  }
  return res({}, 404);
};

const c = await import('../site/js/community.js');
const farm = { region: 'Seeland', lat: 46.98, lon: 7.2 };
const p = await c.ask(farm, 'soybean', 'Inoculant tips?', '', null, true);
await c.reply(p.id, farm, 'data answer text', 'Crossfarm');
ok(p.pending && c.threads(farm).find((t) => t.id === p.id)?.pending, 'offline: question saved on the device as pending');
up = true;
await c.sync();
ok(db.threads.length === 1 && db.threads[0].q === 'Inoculant tips?', 'back online: the question was sent');
ok(db.replies.some((r) => r.role === 'Crossfarm' && r.token === 'tokt0'), 'its data answer went along with the thread token');
ok(!c.threads(farm).some((t) => t.pending), 'nothing pending any more');
const mine = c.threads(farm).find((t) => t.id === 't0');
ok(mine?.mine === true, 'the sent question is marked as mine');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

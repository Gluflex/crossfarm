// A D1 stand-in on node:sqlite for offline checks: same SQL, same async shape
// (every call yields, so parallel requests interleave like they do against real D1).
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

const tick = () => new Promise((r) => setImmediate(r));

export function d1() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  const prepare = (sql) => {
    let args = [];
    const st = {
      bind(...a) { args = a; return st; },
      async first() { await tick(); return db.prepare(sql).get(...args) ?? null; },
      async all() { await tick(); return { results: db.prepare(sql).all(...args) }; },
      async run() { await tick(); const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; },
    };
    return st;
  };
  return {
    raw: db,
    prepare,
    async batch(stmts) { const out = []; for (const s of stmts) out.push(await s.run()); return out; },
  };
}

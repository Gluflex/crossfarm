// Headless check of site/js/analogues.js against the demo farm snapshots.
//   node scripts/analogue_check.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SITE = join(dirname(fileURLToPath(import.meta.url)), '..', 'site');
globalThis.fetch = async (p) => {
  const b = readFileSync(join(SITE, p));
  return { json: async () => JSON.parse(b.toString('utf8')), arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
};
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
const { analogues, placeSigma, _test } = await import('../site/js/analogues.js');
const community = await import('../site/js/community.js');
const { summarizeSoil } = await import('../site/js/engine.js');

// Maths self-checks
const near = (a, b, tol) => Math.abs(a - b) < tol || (() => { throw new Error(`${a} != ${b}`); })();
near(_test.normInv(0.975), 1.959964, 1e-5);
near(_test.normInv(0.5), 0, 1e-9);
near(_test.gammaP(0.5, 1.959964 ** 2 / 2), 0.95, 1e-6);       // chi with 1 dof: 1.96 sigma = 95 %
near(_test.gammaP(1, 2), 1 - Math.exp(-2), 1e-9);
const e = _test.eigen([[2, 1], [1, 2]]);
near(e[0].value, 3, 1e-9); near(e[1].value, 1, 1e-9);
console.log('maths ok');

const farms = JSON.parse(readFileSync(join(SITE, 'data', 'farms.json'), 'utf8'));
for (const f of farms) {
  const snap = JSON.parse(readFileSync(join(SITE, 'data', 'farms', `${f.id}.json`), 'utf8'));
  const soil = summarizeSoil(snap.soil);
  const a = await analogues(f, snap.daily, soil);
  const fmt = (r) => `${r.lat.toFixed(2)},${r.lon.toFixed(2)} ${r.sigma.toFixed(2)}s ${Math.round(r.km)}km ${r.dir}`;
  console.log(`${f.id.padEnd(11)} pcs ${a.v.pcs.length} home ${a.homeSigma.toFixed(2)}s novel ${a.novel} soilFilter ${a.soilFilter} agree ${a.agree}`);
  console.log('   +2C  ', a.regions.map(fmt).join(' | '));
  console.log('   model', a.modelRegions.map(fmt).join(' | '));
  const ts = community.threads(f).map((t) => [t.place, placeSigma(a, t.lat, t.lon)]).filter(([, s]) => s != null && s <= 2);
  console.log('   threads under 2s:', ts.map(([p, s]) => `${p} ${s.toFixed(2)}`).join(' | ') || 'none');
}

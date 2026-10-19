// Climate analogues: where in Europe and around the Mediterranean is today's climate
// what this field will have in the future? Method after Mahony et al. 2017 (Global Change
// Biology, doi:10.1111/gcb.13645) as used by Fitzpatrick & Dunn 2019 (Nature Communications,
// doi:10.1038/s41467-019-08540-3): twelve seasonal variables (Tmax, Tmin, rain for DJF, MAM,
// JJA, SON), distance measured in units of the field's own year-to-year variability
// (Mahalanobis distance on principal components), expressed as sigma. Below 2 sigma is a
// close match, above 4 sigma there is no match today (a novel climate).
//
// Grid: scripts/analogues.py bakes TerraClimate 1991-2020 normals, the TerraClimate +2 C
// pseudo-climate (ensemble median change of CMIP6 models) and SoilGrids topsoil into
// site/data/analogue-grid.{json,bin}.
import { BASE } from './engine.js';

export const CLOSE = 2, NOVEL = 4;
const VARS = ['tmax', 'tmin', 'ppt'];
const SEAS = ['djf', 'mam', 'jja', 'son'];
const KEYS = VARS.flatMap((v) => SEAS.map((s) => `${v}_${s}`));
const SEASON_OF = [0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 0];   // month index -> season; December counts toward next year's winter

// ---------------------------------------------------------------- grid

let gridP;
export function loadGrid() {
  if (!gridP) {
    gridP = Promise.all([
      fetch('data/analogue-grid.json').then((r) => r.json()),
      fetch('data/analogue-grid.bin').then((r) => r.arrayBuffer()),
    ]).then(([h, buf]) => {
      const n = h.cells, nf = h.fields.length;
      const idx = new Uint16Array(buf, 0, n);
      const raw = new Int16Array(buf, n * 2, n * nf);
      const col = {};
      h.fields.forEach(([name, scale], f) => {
        const a = new Float32Array(n);
        for (let i = 0; i < n; i++) { const v = raw[i * nf + f]; a[i] = v === h.missing ? NaN : v / scale; }
        col[name] = a;
      });
      const lat = new Float32Array(n), lon = new Float32Array(n), at = new Int32Array(h.rows * h.cols).fill(-1);
      for (let i = 0; i < n; i++) {
        const r = Math.floor(idx[i] / h.cols), c = idx[i] % h.cols;
        lat[i] = h.north - (r + 0.5) * h.step; lon[i] = h.west + (c + 0.5) * h.step;
        at[idx[i]] = i;
      }
      return { ...h, n, idx, col, lat, lon, at };
    });
  }
  return gridP;
}

// Nearest land cell to a point (coastal fields can fall in a sea cell)
export function cellAt(g, lat, lon) {
  const r0 = Math.floor((g.north - lat) / g.step), c0 = Math.floor((lon - g.west) / g.step);
  let best = -1, bd = Infinity;
  for (let ring = 0; ring <= 3 && best < 0; ring++) {
    for (let r = r0 - ring; r <= r0 + ring; r++) {
      for (let c = c0 - ring; c <= c0 + ring; c++) {
        if (r < 0 || c < 0 || r >= g.rows || c >= g.cols) continue;
        const i = g.at[r * g.cols + c];
        if (i < 0) continue;
        const d = km(lat, lon, g.lat[i], g.lon[i]);
        if (d < bd) { bd = d; best = i; }
      }
    }
  }
  return best;
}

const vecToday = (g, i) => KEYS.map((k) => g.col[k][i]);
const vecPlus2 = (g, i) => KEYS.map((k) => g.col[`${k}_2c`][i]);

// ---------------------------------------------------------------- the field's own variability

// Seasonal values per year from the model's daily series: 12 numbers per year
export function seasonalYears(daily, [a, b]) {
  const { time } = daily, X = daily.temperature_2m_max, N = daily.temperature_2m_min, P = daily.precipitation_sum;
  const ys = new Map();
  for (let i = 0; i < time.length; i++) {
    if (X[i] == null || N[i] == null) continue;
    let y = +time[i].slice(0, 4);
    const m = +time[i].slice(5, 7) - 1;
    if (m === 11) y += 1;
    if (y < a || y > b) continue;
    let s = ys.get(y);
    if (!s) { s = { x: [0, 0, 0, 0], n: [0, 0, 0, 0], p: [0, 0, 0, 0], k: [0, 0, 0, 0] }; ys.set(y, s); }
    const q = SEASON_OF[m];
    s.x[q] += X[i]; s.n[q] += N[i]; s.p[q] += P[i] || 0; s.k[q]++;
  }
  // only complete years (December of the year before is part of winter)
  return [...ys.entries()].filter(([, s]) => s.k.every((k) => k >= 89)).sort((p, q) => p[0] - q[0])
    .map(([, s]) => [...s.x.map((v, q) => v / s.k[q]), ...s.n.map((v, q) => v / s.k[q]), ...s.p]);
}

const meanVec = (rows) => rows[0].map((_, j) => rows.reduce((s, r) => s + r[j], 0) / rows.length);

// Symmetric eigen decomposition (Jacobi rotations); fine for a 12 x 12 matrix
function eigen(A) {
  const n = A.length, a = A.map((r) => [...r]), V = A.map((_, i) => A.map((__, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += a[i][j] ** 2;
    if (off < 1e-14) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(a[p][q]) < 1e-18) continue;
        const th = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = a[k][p], akq = a[k][q];
          a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p][k], aqk = a[q][k];
          a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = V[k][p], vkq = V[k][q];
          V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  return a.map((r, i) => ({ value: r[i], vector: V.map((row) => row[i]) })).sort((x, y) => y.value - x.value);
}

// Variability model: per-variable SD, then principal components of the standardised years.
// Components that each explain under 2 % of the variance are dropped: they would turn
// tiny, meaningless differences into large distances.
export function variability(years) {
  const mu = meanVec(years);
  const sd = mu.map((m, j) => Math.sqrt(years.reduce((s, r) => s + (r[j] - m) ** 2, 0) / (years.length - 1)) || 1);
  const Z = years.map((r) => r.map((v, j) => (v - mu[j]) / sd[j]));
  const C = mu.map((_, i) => mu.map((__, j) => Z.reduce((s, r) => s + r[i] * r[j], 0) / (Z.length - 1)));
  const eig = eigen(C);
  const total = eig.reduce((s, e) => s + Math.max(0, e.value), 0);
  const pcs = eig.filter((e) => e.value / total >= 0.02);
  return { sd, pcs, years: years.length };
}

// Distance between two climate vectors in sigma
export function sigma(v, a, b) {
  const z = a.map((x, j) => (x - b[j]) / v.sd[j]);
  let d2 = 0;
  for (const pc of v.pcs) {
    const p = pc.vector.reduce((s, w, j) => s + w * z[j], 0);
    d2 += (p * p) / pc.value;
  }
  // percentile of the chi distribution with k degrees of freedom, as a one-dimensional sigma
  const pct = gammaP(v.pcs.length / 2, d2 / 2);
  return pct >= 1 - 1e-12 ? 8 : Math.min(8, normInv((1 + pct) / 2));
}

// ---------------------------------------------------------------- the analysis

const FUTURE_MODEL = [2036, 2049];   // winters need the December before, so 2035 is incomplete

/**
 * Finds today's analogues of this field's future climate.
 * futures: ensemble = TerraClimate +2 C (CMIP6 ensemble median change);
 *          model    = the same cell plus the change in the app's own climate model (2040s)
 */
export async function analogues(farm, daily, soil) {
  const g = await loadGrid();
  const home = cellAt(g, farm.lat, farm.lon);
  if (home < 0) return null;
  const baseYears = seasonalYears(daily, [BASE[0] + 1, BASE[1]]);
  if (baseYears.length < 20) return null;
  const v = variability(baseYears);

  const today = vecToday(g, home);
  const ens = vecPlus2(g, home);
  const mb = meanVec(baseYears), mf = meanVec(seasonalYears(daily, FUTURE_MODEL));
  const model = today.map((x, j) => (j < 8 ? x + (mf[j] - mb[j]) : x * (mf[j] / mb[j])));

  const score = (target) => {
    const s = new Float32Array(g.n);
    for (let i = 0; i < g.n; i++) s[i] = sigma(v, vecToday(g, i), target);
    return s;
  };
  const sEns = score(ens), sModel = score(model);

  // Soil: same broad soil as the field (pH within 0.8, clay within 12 points, sand within 20)
  const fs = soil && soil.ph != null ? soil : null;
  const soilOk = (i) => {
    if (!fs) return true;
    const ph = g.col.ph[i], clay = g.col.clay[i], sand = g.col.sand[i];
    if (Number.isNaN(ph)) return false;
    return Math.abs(ph - fs.ph) <= 0.8 && Math.abs(clay - fs.clay) <= 12 && Math.abs(sand - fs.sand) <= 20;
  };
  let bestSoil = Infinity;
  if (fs) for (let i = 0; i < g.n; i++) if (sEns[i] < bestSoil && soilOk(i)) bestSoil = sEns[i];
  const soilFilter = !!fs && bestSoil <= CLOSE;

  const regions = pickRegions(g, sEns, soilFilter ? soilOk : () => true, farm);
  const modelRegions = pickRegions(g, sModel, soilFilter ? soilOk : () => true, farm);
  const agree = regions.filter((r) => modelRegions.some((m) => km(r.lat, r.lon, m.lat, m.lon) < 300)).length;

  return {
    home, g, v, sEns, sModel, regions, modelRegions, agree, soilFilter, soilKnown: !!fs,
    homeToday: today, homeFuture: ens, homeModel: model,
    homeSigma: sEns[home],        // how far the field's own future is from its own present
    best: regions[0]?.sigma ?? Math.min(...sEns),
    novel: (regions[0]?.sigma ?? 8) > NOVEL,
    dayHome: longestDay(farm.lat),
  };
}

// Greedy: best cell, then the next best at least 250 km from every region already picked
function pickRegions(g, s, ok, farm, max = 3) {
  const order = [...s.keys()].filter((i) => ok(i) && s[i] <= NOVEL).sort((a, b) => s[a] - s[b]);
  const out = [];
  for (const i of order) {
    if (out.length >= max) break;
    if (out.some((r) => km(r.lat, r.lon, g.lat[i], g.lon[i]) < 250)) continue;
    out.push({
      cell: i, sigma: s[i], lat: g.lat[i], lon: g.lon[i],
      km: km(farm.lat, farm.lon, g.lat[i], g.lon[i]), dir: bearing(farm.lat, farm.lon, g.lat[i], g.lon[i]),
      day: longestDay(g.lat[i]),
      soil: { ph: g.col.ph[i], clay: g.col.clay[i], sand: g.col.sand[i] },
      today: vecToday(g, i),
    });
  }
  return out;
}

// Sigma of a place's climate today against the field's future (for community posts)
export function placeSigma(a, lat, lon) {
  const i = cellAt(a.g, lat, lon);
  return i < 0 ? null : a.sEns[i];
}

// Summer and winter numbers for a vector (for display)
export function readVec(x) {
  return {
    summerMax: x[2], winterMin: x[4], summerRain: x[10], yearRain: x[8] + x[9] + x[10] + x[11],
  };
}

export const matchLabel = (s) => (s <= CLOSE ? 'Close match' : s <= NOVEL ? 'Partial match' : 'No match today');

// Hours of daylight on the longest day of the year
export function longestDay(lat) {
  const t = Math.tan((lat * Math.PI) / 180) * Math.tan((23.44 * Math.PI) / 180);
  return t >= 1 ? 24 : (24 / Math.PI) * Math.acos(-t);
}

// ---------------------------------------------------------------- maths helpers

export function km(a1, o1, a2, o2) {
  const r = Math.PI / 180, dA = (a2 - a1) * r, dO = (o2 - o1) * r;
  const h = Math.sin(dA / 2) ** 2 + Math.cos(a1 * r) * Math.cos(a2 * r) * Math.sin(dO / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}
function bearing(a1, o1, a2, o2) {
  const r = Math.PI / 180;
  const y = Math.sin((o2 - o1) * r) * Math.cos(a2 * r);
  const x = Math.cos(a1 * r) * Math.sin(a2 * r) - Math.sin(a1 * r) * Math.cos(a2 * r) * Math.cos((o2 - o1) * r);
  const deg = (Math.atan2(y, x) / r + 360) % 360;
  return ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'][Math.round(deg / 45) % 8];
}

// Regularised lower incomplete gamma P(a, x) (Numerical Recipes 6.2)
function gammaP(a, x) {
  if (x <= 0) return 0;
  const gln = lnGamma(a);
  if (x < a + 1) {
    let sum = 1 / a, del = sum, ap = a;
    for (let n = 0; n < 500; n++) { ap += 1; del *= x / ap; sum += del; if (Math.abs(del) < Math.abs(sum) * 1e-15) break; }
    return sum * Math.exp(-x + a * Math.log(x) - gln);
  }
  let b = x + 1 - a, c = 1 / 1e-300, d = 1 / b, h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a); b += 2;
    d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d; const del = d * c; h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return 1 - Math.exp(-x + a * Math.log(x) - gln) * h;
}
function lnGamma(x) {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x, tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (const ci of c) ser += ci / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}
// Inverse standard normal CDF (Acklam's rational approximation, ~1e-9)
function normInv(p) {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  if (p < pl) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > 1 - pl) { const q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  const q = p - 0.5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}
export const _test = { gammaP, normInv, eigen };

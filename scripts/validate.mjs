// Back-test of the climate-analogue method. Writes site/data/validation.json.
//   python scripts/validate.py            (once: TerraClimate 1961-1990 normals + yearly series)
//   python -I scripts/bastin_table.py     (once: Bastin et al. 2019 S2 Table)
//   python -I scripts/bastin_geocode.py   (once: city coordinates)
//   node scripts/validate.mjs
//
// 1. Observed shift: where did each field's observed 1991-2020 climate already exist in
//    1961-1990? (TerraClimate normals, same 12 seasonal variables and the same sigma code
//    as the app.) Compared with the app's predicted shift: where does the field's +2 C
//    climate exist today?
// 2. Published analogues: the app's +2 C analogue for the European cities of Bastin et
//    al. 2019 against the analogue city they publish (RCP4.5, 2050).
//
// Uses site/js/analogues.js unchanged (loadGrid, cellAt, variability, sigma, km,
// analogues). The search loop below is the same Mahalanobis distance as sigma(), kept
// as squared distance for speed; sigma() itself is called for every reported value.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = join(HERE, '..', 'site'), CACHE = join(HERE, '.cache');
const netFetch = globalThis.fetch;
globalThis.fetch = async (p) => {
  const b = readFileSync(join(SITE, p));
  return { json: async () => JSON.parse(b.toString('utf8')), arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
};
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
const A = await import('../site/js/analogues.js');
const { summarizeSoil } = await import('../site/js/engine.js');

const g = await A.loadGrid();
const KEYS = ['tmax', 'tmin', 'ppt'].flatMap((v) => ['djf', 'mam', 'jja', 'son'].map((s) => `${v}_${s}`));
const N = g.n;

// ---------------------------------------------------------------- inputs
const meta = JSON.parse(readFileSync(join(CACHE, 'validation-input.json'), 'utf8'));
const f32 = (f) => { const b = readFileSync(join(CACHE, f)); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4); };
const pastRaw = f32('validation-past.bin'), icvRaw = f32('validation-icv.bin');

// candidate matrices, cells x 12, rounded like the baked grid
const today = new Float64Array(N * 12), plus2 = new Float64Array(N * 12), past = new Float64Array(N * 12);
const pastOk = new Uint8Array(N);
for (let i = 0; i < N; i++) {
  let ok = 1;
  KEYS.forEach((k, j) => {
    today[i * 12 + j] = g.col[k][i]; plus2[i * 12 + j] = g.col[`${k}_2c`][i];
    const sc = j < 8 ? 10 : 1, v = pastRaw[i * 12 + j];
    past[i * 12 + j] = Math.round(v * sc) / sc;
    if (!Number.isFinite(v)) ok = 0;
  });
  pastOk[i] = ok;
}
const todayOk = new Uint8Array(N).fill(1);
const vecOf = (M, i) => Array.from(M.subarray(i * 12, i * 12 + 12));

// year-to-year variability at the nearest 1 degree node with data
const I = meta.icv, NY = I.years;
function icvYears(period, lat, lon) {
  const r0 = Math.round((I.lat0 - lat) / I.step), c0 = Math.round((lon - I.lon0) / I.step);
  for (let ring = 0; ring <= 2; ring++) {
    let best = null, bd = Infinity;
    for (let r = r0 - ring; r <= r0 + ring; r++) for (let c = c0 - ring; c <= c0 + ring; c++) {
      if (r < 0 || c < 0 || r >= I.rows || c >= I.cols) continue;
      const ys = [];
      for (let y = 0; y < NY; y++) {
        const row = [];
        for (let j = 0; j < 12; j++) row.push(icvRaw[(((period * NY + y) * 12 + j) * I.rows + r) * I.cols + c]);
        ys.push(row);
      }
      if (!ys.every((row) => row.every(Number.isFinite))) continue;
      const d = A.km(lat, lon, I.lat0 - r * I.step, I.lon0 + c * I.step);
      if (d < bd) { bd = d; best = ys; }
    }
    if (best) return best;
  }
  return null;
}

// ---------------------------------------------------------------- search
function searcher(v) {
  // rows of W / sd / sqrt(lambda): squared distance = sum over PCs of (W (x - t))^2
  const M = v.pcs.map((pc) => pc.vector.map((w, j) => w / v.sd[j] / Math.sqrt(pc.value)));
  return (target, C, ok, skip = -1) => {
    const mt = M.map((row) => row.reduce((s, w, j) => s + w * target[j], 0));
    let best = -1, bd = Infinity;
    for (let i = 0; i < N; i++) {
      if (!ok[i] || i === skip) continue;
      let d2 = 0;
      for (let k = 0; k < M.length; k++) {
        const row = M[k]; let p = -mt[k];
        for (let j = 0; j < 12; j++) p += row[j] * C[i * 12 + j];
        d2 += p * p;
        if (d2 >= bd) break;
      }
      if (d2 < bd) { bd = d2; best = i; }
    }
    return best;
  };
}

// The k best cells (for the robustness check: direction of their mean position)
function topK(v, target, C, ok, k) {
  const M = v.pcs.map((pc) => pc.vector.map((w, j) => w / v.sd[j] / Math.sqrt(pc.value)));
  const mt = M.map((row) => row.reduce((s, w, j) => s + w * target[j], 0));
  const best = [];      // [d2, i] sorted ascending
  for (let i = 0; i < N; i++) {
    if (!ok[i]) continue;
    const lim = best.length < k ? Infinity : best[k - 1][0];
    let d2 = 0;
    for (let q = 0; q < M.length && d2 < lim; q++) {
      const row = M[q]; let p = -mt[q];
      for (let j = 0; j < 12; j++) p += row[j] * C[i * 12 + j];
      d2 += p * p;
    }
    if (d2 >= lim) continue;
    best.push([d2, i]); best.sort((a, b) => a[0] - b[0]); if (best.length > k) best.pop();
  }
  return best.map((b) => b[1]);
}
// Mean displacement (east, north in km) from the field to a set of cells, as km and bearing
function meanShift(lat, lon, cells) {
  let e = 0, n = 0;
  for (const i of cells) {
    const d = A.km(lat, lon, g.lat[i], g.lon[i]), b = deg(lat, lon, g.lat[i], g.lon[i]) * Math.PI / 180;
    e += d * Math.sin(b); n += d * Math.cos(b);
  }
  e /= cells.length; n /= cells.length;
  return { km: Math.round(Math.hypot(e, n)), bearing: Math.round((Math.atan2(e, n) * 180 / Math.PI + 360) % 360) };
}

function deg(a1, o1, a2, o2) {
  const r = Math.PI / 180;
  const y = Math.sin((o2 - o1) * r) * Math.cos(a2 * r);
  const x = Math.cos(a1 * r) * Math.sin(a2 * r) - Math.sin(a1 * r) * Math.cos(a2 * r) * Math.cos((o2 - o1) * r);
  return (Math.atan2(y, x) / r + 360) % 360;
}
const compass = (b) => ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'][Math.round(b / 45) % 8];
const angDiff = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
const r1 = (x) => Math.round(x * 10) / 10, r2 = (x) => Math.round(x * 100) / 100;
const median = (xs) => { const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null; };

function shift(lat, lon, i, s) {
  const k = A.km(lat, lon, g.lat[i], g.lon[i]);
  return { cell: i, lat: r2(g.lat[i]), lon: r2(g.lon[i]), km: Math.round(k), bearing: Math.round(deg(lat, lon, g.lat[i], g.lon[i])), sigma: r2(s) };
}

// One test at one place: observed shift (present in the past grid) and predicted shift
// (+2 C in today's grid), both scaled by the same variability v
function test(home, lat, lon, v) {
  const find = searcher(v);
  const t = vecOf(today, home), f = vecOf(plus2, home);
  const ip = find(t, past, pastOk), ie = find(f, today, todayOk);
  return {
    past: shift(lat, lon, ip, A.sigma(v, vecOf(past, ip), t)),
    predicted: shift(lat, lon, ie, A.sigma(v, vecOf(today, ie), f)),
    pastStay: A.sigma(v, vecOf(past, home), t),       // the field's own 1961-1990 climate vs today
  };
}

const MIN_KM = 50;                  // shorter shifts have no meaningful direction on a 0.25 degree grid
const verdict = (o, p) => (o.km < MIN_KM || p.km < MIN_KM ? null : angDiff(o.bearing, p.bearing) < 45);

// ---------------------------------------------------------------- reverse geocode (farms only)
const geoFile = join(CACHE, 'validation-geocode.json');
const geoCache = existsSync(geoFile) ? JSON.parse(readFileSync(geoFile, 'utf8')) : {};
async function placeName(lat, lon) {
  const key = `${lat},${lon}`;
  if (!geoCache[key]) {
    try {
      const r = await netFetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`);
      const j = await r.json();
      const place = j.locality || j.city || j.principalSubdivision || '';
      const sub = j.principalSubdivision && j.principalSubdivision !== place ? j.principalSubdivision : '';
      geoCache[key] = [place, sub, j.countryName].filter(Boolean).join(', ');
    } catch { geoCache[key] = ''; }
  }
  const clean = (geoCache[key] || '').replace(/ \[[^\]]*\]/g, '').replace('United Kingdom of Great Britain and Northern Ireland', 'United Kingdom');
  return clean || `${Math.abs(lat).toFixed(2)} ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(2)} ${lon >= 0 ? 'E' : 'W'}`;
}

// ---------------------------------------------------------------- 1a. demo farms
const farms = JSON.parse(readFileSync(join(SITE, 'data', 'farms.json'), 'utf8'));
const farmOut = [];
for (const f of farms) {
  const snap = JSON.parse(readFileSync(join(SITE, 'data', 'farms', `${f.id}.json`), 'utf8'));
  const app = await A.analogues(f, snap.daily, summarizeSoil(snap.soil));   // exactly what the app shows
  const home = app.home;
  // variability as in the app (the model's own 1992-2020 seasons at the field)
  const t = test(home, f.lat, f.lon, app.v);
  // and with the observed TerraClimate 1991-2020 variability, as used for the sample
  const tTc = test(home, f.lat, f.lon, A.variability(icvYears(1, g.lat[home], g.lon[home])));
  const shown = app.regions[0];
  farmOut.push({
    id: f.id,
    past: { name: await placeName(t.past.lat, t.past.lon), lat: t.past.lat, lon: t.past.lon, km: t.past.km, bearing: t.past.bearing, dir: compass(t.past.bearing), sigma: t.past.sigma },
    predicted: { name: await placeName(t.predicted.lat, t.predicted.lon), lat: t.predicted.lat, lon: t.predicted.lon, km: t.predicted.km, bearing: t.predicted.bearing, dir: compass(t.predicted.bearing), sigma: t.predicted.sigma },
    agree: verdict(t.past, t.predicted),
    bearingDiff: Math.round(angDiff(t.past.bearing, t.predicted.bearing)),
    ownPastSigma: r2(t.pastStay),
    shown: shown ? { km: Math.round(shown.km), dir: shown.dir, sigma: r2(shown.sigma), soilFilter: app.soilFilter } : null,
    observedVariability: { pastKm: tTc.past.km, pastBearing: tTc.past.bearing, predictedKm: tTc.predicted.km, predictedBearing: tTc.predicted.bearing, agree: verdict(tTc.past, tTc.predicted) },
  });
  console.log(`${f.id.padEnd(11)} past ${t.past.km} km ${compass(t.past.bearing)} (${t.past.bearing}) ${t.past.sigma}s | +2C ${t.predicted.km} km ${compass(t.predicted.bearing)} (${t.predicted.bearing}) ${t.predicted.sigma}s | own past ${r2(t.pastStay)}s | agree ${verdict(t.past, t.predicted)} | TC-var: ${tTc.past.km} km ${tTc.past.bearing} vs ${tTc.predicted.km} km ${tTc.predicted.bearing}`);
}
writeFileSync(geoFile, JSON.stringify(geoCache, null, 1));

// ---------------------------------------------------------------- 1b. grid sample
// Every 4th row and column (1 degree), crude Europe mask (drops North Africa, the
// Levant, Anatolia, the Caucasus and Greenland; keeps Cyprus, Thrace, European Russia).
function europe(lat, lon) {
  if (lat < 34) return false;
  if (lon > 35.5 && lat < 37.5) return false;
  if (lat < 36 && lon > -18 && lon < -1.9) return false;
  if (lat < 37.45 && lon >= -1.9 && lon < 11.3) return false;
  if (lon > 40 && lat < 44) return false;
  if (lon > 26.7 && lat > 35.8 && lat < 41.4) return false;
  if (lon < -20 && lat > 66.5) return false;
  return true;
}
const rows = [];
const t0 = Date.now();
for (let i = 0; i < N; i++) {
  const r = Math.floor(g.idx[i] / g.cols), c = g.idx[i] % g.cols;
  if (r % 4 !== 1 || c % 4 !== 1 || !europe(g.lat[i], g.lon[i]) || !pastOk[i]) continue;
  const yearsToday = icvYears(1, g.lat[i], g.lon[i]), yearsPast = icvYears(0, g.lat[i], g.lon[i]);
  if (!yearsToday || !yearsPast) continue;
  const v = A.variability(yearsToday);
  const t = test(i, g.lat[i], g.lon[i], v);
  // sensitivity: the past search scaled by the 1961-1990 variability instead
  const vp = A.variability(yearsPast);
  const ip = searcher(vp)(vecOf(today, i), past, pastOk);
  const altPast = shift(g.lat[i], g.lon[i], ip, 0);
  // robustness: direction of the mean position of the 10 best cells in each search
  const tv = vecOf(today, i), fv = vecOf(plus2, i);
  const p10 = meanShift(g.lat[i], g.lon[i], topK(v, tv, past, pastOk, 10));
  const e10 = meanShift(g.lat[i], g.lon[i], topK(v, fv, today, todayOk, 10));
  // null model: the same average warming in every season, no rain change, no CMIP6 pattern
  const dT = fv.slice(0, 8).reduce((s, x, j) => s + x - tv[j], 0) / 8;
  const uv = tv.map((x, j) => (j < 8 ? x + dT : x));
  const iu = searcher(v)(uv, today, todayOk);
  const uni = shift(g.lat[i], g.lon[i], iu, 0);
  const u10 = meanShift(g.lat[i], g.lon[i], topK(v, uv, today, todayOk, 10));
  rows.push({ i, lat: g.lat[i], lon: g.lon[i], ...t, agree: verdict(t.past, t.predicted), agreeAlt: verdict(altPast, t.predicted),
    agree10: verdict(p10, e10), agreeUniform: verdict(t.past, uni), agreeUniform10: verdict(p10, u10),
    south: t.past.km < MIN_KM ? null : angDiff(t.past.bearing, 180) < 45 });
}
console.log(`sample ${rows.length} cells in ${((Date.now() - t0) / 1000).toFixed(0)} s`);

const share = (xs) => { const d = xs.filter((x) => x !== null); return { n: d.length, share: d.length ? r2(d.filter(Boolean).length / d.length) : null }; };
const ag = share(rows.map((r) => r.agree)), agAlt = share(rows.map((r) => r.agreeAlt)), south = share(rows.map((r) => r.south));
const ag10 = share(rows.map((r) => r.agree10)), agUni = share(rows.map((r) => r.agreeUniform)), agUni10 = share(rows.map((r) => r.agreeUniform10));
console.log(`robustness: top-10 mean position ${ag10.share} of ${ag10.n}; uniform-warming null ${agUni.share} of ${agUni.n}, top-10 ${agUni10.share} of ${agUni10.n}`);
const stay = rows.filter((r) => r.past.km < MIN_KM).length;
const lat0 = rows.filter((r) => r.agree !== null);
const bands = [[34, 45], [45, 55], [55, 72]].map(([a, b]) => {
  const s = lat0.filter((r) => r.lat >= a && r.lat < b);
  return { band: `${a} to ${b} N`, cells: s.length, agreeShare: s.length ? r2(s.filter((r) => r.agree).length / s.length) : null };
});
const ratio = median(lat0.map((r) => r.predicted.km / r.past.km));
console.log(`agree ${ag.share} of ${ag.n} (alt variability ${agAlt.share}); observed shift within 45 deg of due south ${south.share}; under ${MIN_KM} km ${stay}`);
console.log(`median observed shift ${median(rows.map((r) => r.past.km))} km, predicted ${median(rows.map((r) => r.predicted.km))} km, median ratio ${ratio && r2(ratio)}`);
console.log('bands', JSON.stringify(bands));

// ---------------------------------------------------------------- 2. published analogues
let published = null;
const bFile = join(CACHE, 'bastin', 's2-geo.json');
const EU = new Set('AD AL AT BA BE BG BY CH CY CZ DE DK EE ES FI FR GB GR HR HU IE IS IT LI LT LU LV MC MD ME MK MT NL NO PL PT RO RS RU SE SI SK SM UA VA XK AX FO GI IM JE GG TR'.split(' '));
const inGrid = (lat, lon) => lat >= 30 && lat <= 72 && lon >= -25 && lon <= 45;
const cityRows = [];
if (existsSync(bFile)) {
  const S2 = JSON.parse(readFileSync(bFile, 'utf8'));
  for (const c of S2) {
    if (c.lat == null || !EU.has(c.cc) || !inGrid(c.lat, c.lon)) continue;
    const home = A.cellAt(g, c.lat, c.lon);
    if (home < 0) continue;
    const yrs = icvYears(1, g.lat[home], g.lon[home]);
    if (!yrs) continue;
    const v = A.variability(yrs);
    const ie = searcher(v)(vecOf(plus2, home), today, todayOk);
    const our = { lat: g.lat[ie], lon: g.lon[ie] };
    const pub = c.analogues[0];
    const row = { city: c.city, cc: c.cc, ours: { lat: r2(our.lat), lon: r2(our.lon), km: Math.round(A.km(c.lat, c.lon, our.lat, our.lon)), bearing: Math.round(deg(c.lat, c.lon, our.lat, our.lon)) },
      published: pub.name, publishedInGrid: pub.lat != null && inGrid(pub.lat, pub.lon) };
    if (row.publishedInGrid) {
      row.kmToPublished = Math.round(A.km(our.lat, our.lon, pub.lat, pub.lon));
      row.homeToPublished = Math.round(A.km(c.lat, c.lon, pub.lat, pub.lon));
      row.bearingDiff = Math.round(angDiff(row.ours.bearing, deg(c.lat, c.lon, pub.lat, pub.lon)));
    }
    const top3 = c.analogues.filter((a) => a.lat != null && inGrid(a.lat, a.lon));
    if (top3.length) row.kmToNearestOfTop3 = Math.round(Math.min(...top3.map((a) => A.km(our.lat, our.lon, a.lat, a.lon))));
    cityRows.push(row);
  }
  const comp = cityRows.filter((r) => r.publishedInGrid);
  const closer = comp.filter((r) => r.kmToPublished < r.homeToPublished).length;
  const dirOk = comp.filter((r) => r.bearingDiff < 45).length;
  published = {
    cities: comp.length,
    citiesInArea: cityRows.length,
    outsideArea: cityRows.length - comp.length,
    medianKm: comp.length ? Math.round(median(comp.map((r) => r.kmToPublished))) : null,
    medianHomeKm: comp.length ? Math.round(median(comp.map((r) => r.homeToPublished))) : null,
    closerThanHome: closer,
    sameDirection: dirOk,
    source: 'Bastin et al. 2019, PLOS ONE 14(7): e0217592, S2 Table (first analogue city, RCP4.5, 2050). City coordinates: Open-Meteo geocoding (GeoNames).',
  };
  console.log('published', JSON.stringify(published));
  for (const r of cityRows) console.log(`  ${r.city.padEnd(14)} ours ${r.ours.km} km ${compass(r.ours.bearing)} | pub ${r.published} ${r.publishedInGrid ? `${r.kmToPublished} km off (home ${r.homeToPublished}, dir diff ${r.bearingDiff})` : 'outside map'}`);
}

// ---------------------------------------------------------------- output
const out = {
  made: '2026-10-19',
  method: 'Back-test with observed data. For each place we take its observed 1991 to 2020 climate (TerraClimate normals, the same twelve seasonal values the app uses) and look for the place where that climate already existed in 1961 to 1990. The line from the field to that place is the observed shift of its climate over thirty years. We then take the app\'s own prediction, the place whose climate today matches the field at +2 °C of global warming, and check whether both point the same way (bearings less than 45 degrees apart). Both searches use the app\'s own code (sigma, scaled by the field\'s year-to-year variability, after Mahony et al. 2017), climate only, without the soil filter. The five demo farms use the app\'s variability; the grid sample (one cell per degree across Europe, 1109 cells) uses the year-to-year variability of TerraClimate 1991 to 2020. Two baselines show how much agreement is built in: a prediction that always says due south, and a prediction with the same average warming in every season and no rain change. Separately, the app\'s +2 °C analogue for European cities is compared with the analogue city published by Bastin et al. 2019.',
  limits: 'This tests whether the direction of the predicted shift matches the direction climate has already moved. It does not test whether the predicted place is right, and it says nothing about whether farming advice is right. The observed shift is small: half the sampled cells are within 0.12 sigma of their own 1961 to 1990 climate, so the past match is the best of many close matches and single results are noisy (for three of the five demo farms the past match moves by hundreds of km when the variability source changes). Only the share over many cells is meaningful. Shifts under 50 km are left out because they have no direction on a 0.25 degree grid. Warming alone explains most of the agreement: the uniform-warming baseline agrees almost as often as the app (58 against 62 percent), so the test does not show that the CMIP6 pattern of change adds much. Neighbouring cells are not independent, so the shares carry no simple error bar. The +2 °C climate has not happened yet. The published comparison uses another method (19 bioclimatic variables, RCP4.5, 2050, three models) and covers only the 50 European cities whose published analogue lies inside the app\'s map. Both TerraClimate periods share the same WorldClim pattern and the 1961 to 1990 changes come from ERA5 reanalysis, which has fewer observations before 1979, so the test is not independent of the data the app uses.',
  minShiftKm: MIN_KM,
  farms: farmOut,
  sample: {
    cells: rows.length,
    compared: ag.n,
    underMinShift: stay,
    agreeShare: ag.share,
    agreeShareAltVariability: agAlt.share,
    agreeShareTop10: ag10.share,
    uniformWarmingShare: agUni.share,
    uniformWarmingShareTop10: agUni10.share,
    dueSouthShare: south.share,
    randomShare: 0.25,
    medianShiftKm: median(rows.map((r) => r.past.km)),
    medianPredictedKm: median(rows.map((r) => r.predicted.km)),
    medianRatio: ratio && r2(ratio),
    medianPastSigma: r2(median(rows.map((r) => r.past.sigma))),
    medianOwnPastSigma: r2(median(rows.map((r) => r.pastStay))),
    bands,
  },
  published,
  publishedCities: cityRows.map((r) => ({ city: r.city, ours: { km: r.ours.km, dir: compass(r.ours.bearing) }, published: r.published, kmApart: r.kmToPublished ?? null })),
  sources: [
    'Abatzoglou, J.T., Dobrowski, S.Z., Parks, S.A., Hegewisch, K.C. 2018. TerraClimate, a high-resolution global dataset of monthly climate and climatic water balance from 1958-2015. Scientific Data 5, 170191. https://doi.org/10.1038/sdata.2017.191 (TerraClimate v1.1 1961-1990 and 1991-2020 normals, monthly series, +2 C pseudo-climate: http://thredds.northwestknowledge.net:8080/thredds/catalog/TERRACLIMATE_ALL/catalog.html)',
    'Abatzoglou, J.T., Hegewisch, K.C., Yin, C., Kalashinkov, D.A. 2026. TerraClimate v1.1, an updated global climate and climatic water balance dataset with climate scenarios. Scientific Data (reference given in the TerraClimate v1.1 file metadata).',
    'Mahony, C.R., Cannon, A.J., Wang, T., Aitken, S.N. 2017. A closer look at novel climates: new methods and insights at continental to landscape scales. Global Change Biology 23, 3934-3955. https://doi.org/10.1111/gcb.13645',
    'Fitzpatrick, M.C., Dunn, R.R. 2019. Contemporary climatic analogs for 540 North American urban areas in the late 21st century. Nature Communications 10, 614. https://doi.org/10.1038/s41467-019-08540-3',
    'Bastin, J.-F., Clark, E., Elliott, T., Hart, S., van den Hoogen, J., Hordijk, I., Ma, H., Majumder, S., Manoli, G., Maschler, J., Mo, L., Routh, D., Yu, K., Zohner, C.M., Crowther, T.W. 2019. Understanding climate change from a global analysis of city analogues. PLOS ONE 14(7): e0217592. https://doi.org/10.1371/journal.pone.0217592 (S2 Table: https://doi.org/10.1371/journal.pone.0217592.s002)',
  ],
};
const json = JSON.stringify(out);
writeFileSync(join(SITE, 'data', 'validation.json'), json);
writeFileSync(join(CACHE, 'validation-sample.json'), JSON.stringify(rows.map((r) => ({ lat: r2(r.lat), lon: r2(r.lon), past: r.past, predicted: r.predicted, agree: r.agree }))));
console.log(`validation.json ${(json.length / 1024).toFixed(1)} KB`);

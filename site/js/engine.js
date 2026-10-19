// Turns raw climate, soil and NDVI data into the numbers and advice the app shows.
import { CROPS, cropById } from './crops.js';

export const BASE = [1991, 2020];
export const FUTURE = [2035, 2049];   // model data ends 2049; shown as "2040s"

const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);

// --- climate --------------------------------------------------------------

function yearStats(daily) {
  const { time } = daily;
  const T = daily.temperature_2m_mean, X = daily.temperature_2m_max;
  const N = daily.temperature_2m_min, P = daily.precipitation_sum;
  const years = new Map();
  let dry = 0;
  for (let i = 0; i < time.length; i++) {
    if (T[i] == null) continue;
    const y = +time[i].slice(0, 4), m = +time[i].slice(5, 7), doy = dayOfYear(time[i]);
    let s = years.get(y);
    if (!s) {
      s = { year: y, t: [], gs: [], p: 0, hot30: 0, hot35: 0, frost: 0, tmin: Infinity, gdd: 0,
        dryMax: 0, lastFrost: 0, firstFrost: 366, monthT: Array(12).fill(0), monthP: Array(12).fill(0), monthN: Array(12).fill(0), monthH: Array(12).fill(0) };
      years.set(y, s);
      dry = 0;
    }
    s.t.push(T[i]);
    if (m >= 4 && m <= 9) s.gs.push(T[i]);
    s.p += P[i] || 0;
    if (X[i] > 30) s.hot30++;
    if (X[i] > 35) { s.hot35++; s.monthH[m - 1]++; }
    if (N[i] < 0) {
      s.frost++;
      if (m < 7) s.lastFrost = doy; else if (doy < s.firstFrost) s.firstFrost = doy;
    }
    if (N[i] < s.tmin) s.tmin = N[i];
    s.gdd += Math.max(0, T[i] - 5);
    if (m >= 3 && m <= 9) {
      dry = (P[i] || 0) < 1 ? dry + 1 : 0;
      if (dry > s.dryMax) s.dryMax = dry;
    }
    s.monthT[m - 1] += T[i]; s.monthP[m - 1] += P[i] || 0; s.monthN[m - 1]++;
  }
  return [...years.values()].map((s) => ({
    year: s.year, temp: mean(s.t), gsT: mean(s.gs), rain: s.p, hot30: s.hot30, hot35: s.hot35, frost: s.frost,
    tmin: s.tmin, gdd: s.gdd, dryMax: s.dryMax, season: s.firstFrost - s.lastFrost,
    lastFrost: s.lastFrost,
    monthT: s.monthT.map((v, i) => v / (s.monthN[i] || 1)), monthP: s.monthP, monthH: s.monthH,
  }));
}

function dayOfYear(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  return Math.round((d - Date.UTC(d.getUTCFullYear(), 0, 1)) / 864e5) + 1;
}

function windowMean(ys, [a, b]) {
  const w = ys.filter((s) => s.year >= a && s.year <= b);
  const o = { years: w.length };
  for (const k of ['temp', 'gsT', 'rain', 'hot30', 'hot35', 'frost', 'gdd', 'dryMax', 'season', 'lastFrost']) {
    o[k] = mean(w.map((s) => s[k]));
  }
  o.monthT = Array.from({ length: 12 }, (_, i) => mean(w.map((s) => s.monthT[i])));
  o.monthP = Array.from({ length: 12 }, (_, i) => mean(w.map((s) => s.monthP[i])));
  o.monthH = Array.from({ length: 12 }, (_, i) => mean(w.map((s) => s.monthH[i])));
  o.tmins = w.map((s) => s.tmin);
  return o;
}

export function summarizeClimate(daily) {
  const years = yearStats(daily).filter((s) => s.year <= FUTURE[1]);
  const base = windowMean(years, BASE);
  const future = windowMean(years, FUTURE);
  return {
    years, base, future,
    dTemp: future.temp - base.temp,
    dRain: (future.rain - base.rain) / base.rain,
    dHot: future.hot30 - base.hot30,
    dSpring: future.lastFrost - base.lastFrost,   // negative = last frost earlier
    dSeason: future.season - base.season,
    // Summer (Jun to Aug) rain change, where most of the water stress lives
    dSummerRain: (sum3(future.monthP, 5) - sum3(base.monthP, 5)) / sum3(base.monthP, 5),
  };
}
const sum3 = (a, i) => a[i] + a[i + 1] + a[i + 2];

// --- soil -----------------------------------------------------------------

export function summarizeSoil(sg) {
  const layers = sg?.properties?.layers;
  if (!layers) return null;
  const val = (name) => {
    const l = layers.find((x) => x.name === name);
    if (!l) return null;
    const w = { '0-5cm': 5, '5-15cm': 10, '15-30cm': 15 };
    let s = 0, n = 0;
    for (const d of l.depths) {
      if (d.values.mean == null) continue;
      s += (d.values.mean / l.unit_measure.d_factor) * w[d.label]; n += w[d.label];
    }
    return n ? s / n : null;
  };
  const ph = val('phh2o'), clay = val('clay'), sand = val('sand'), silt = val('silt');
  const soc = val('soc'), nitrogen = val('nitrogen');
  if (ph == null && clay == null) return null;
  return { ph, clay, sand, silt, soc, nitrogen, texture: texture(sand, silt, clay) };
}

// USDA texture triangle, simplified to the classes farmers use day to day
function texture(sa, si, cl) {
  if (sa == null || cl == null) return 'Unknown';
  if (cl >= 40) return si >= 40 ? 'Silty clay' : 'Clay';
  if (cl >= 27) return sa > 45 ? 'Sandy clay loam' : si > 40 ? 'Silty clay loam' : 'Clay loam';
  if (sa >= 85) return 'Sand';
  if (sa >= 70) return 'Loamy sand';
  if (si >= 80) return 'Silt';
  if (si >= 50) return 'Silt loam';
  if (sa >= 52) return 'Sandy loam';
  return 'Loam';
}

// --- crop suitability -----------------------------------------------------

const trap = (v, [a, b, c, d]) => (v <= a || v >= d ? 0 : v < b ? (v - a) / (b - a) : v > c ? (d - v) / (d - c) : 1);

function factors(crop, clim, ph) {
  const temp = mean(crop.months.map((m) => clim.monthT[m - 1]));
  const hot = crop.months.reduce((s, m) => s + clim.monthH[m - 1], 0);
  const t = trap(temp, crop.t);
  const r = trap(clim.rain, crop.rain);
  // pH is fixable with lime, so it only shaves suitability, never zeroes it
  const p = ph == null ? 1 : 0.6 + 0.4 * trap(ph, crop.ph);
  const [ok, fail] = crop.heat;
  const h = hot <= ok ? 1 : hot >= fail ? 0 : 1 - (hot - ok) / (fail - ok);
  let f = 1;
  if (crop.frost != null) {
    const share = clim.tmins.filter((v) => v < crop.frost).length / clim.tmins.length;
    f = Math.max(0, 1 - share);
  }
  return [
    { k: 'temp', v: t, why: temp < crop.t[1] ? 'Season too cool' : 'Season too hot' },
    { k: 'rain', v: r, why: clim.rain < crop.rain[1] ? 'Too little rain' : 'Too wet' },
    { k: 'ph', v: p, why: ph < crop.ph[1] ? 'Soil too acidic' : 'Soil too alkaline' },
    { k: 'heat', v: h, why: 'Heatwaves above 35 °C' },
    { k: 'frost', v: f, why: 'Killing winter frost' },
  ];
}

function score(crop, clim, ph) {
  const fs = factors(crop, clim, ph);
  const by = Object.fromEntries(fs.map((x) => [x.k, x.v]));
  const s = by.temp * Math.pow(by.rain, 0.8) * by.ph * by.heat * by.frost;
  // Explain with the weakest climate factor; pH only when climate is fine
  const climate = fs.filter((x) => x.k !== 'ph').reduce((a, b) => (b.v < a.v ? b : a));
  const limit = climate.v < 0.9 ? climate : fs[2].v < 0.9 ? fs[2] : null;
  return { score: Math.round(100 * s), limit: limit ? limit.why : null, factors: by };
}

export function rankCrops(climate, soil) {
  const ph = soil?.ph ?? null;
  return CROPS.map((c) => {
    const now = score(c, climate.base, ph);
    const later = score(c, climate.future, ph);
    return { crop: c, now: now.score, later: later.score, delta: later.score - now.score, limit: later.limit, nowLimit: now.limit };
  }).sort((a, b) => b.later - a.later || b.now - a.now);
}

// --- NDVI -----------------------------------------------------------------

export function summarizeNdvi(nd) {
  if (!nd) return null;
  const peaks = nd.peaks.filter((p) => p.v != null);
  if (peaks.length < 5) return null;
  const hist = peaks.filter((p) => p.year < peaks[peaks.length - 1].year);
  const avg = mean(hist.map((p) => p.v));
  const latest = peaks[peaks.length - 1];
  // least-squares trend, per decade
  const xs = hist.map((p) => p.year), ys = hist.map((p) => p.v);
  const mx = mean(xs), my = mean(ys);
  const slope = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / xs.reduce((s, x) => s + (x - mx) ** 2, 0);
  const worst = hist.reduce((a, b) => (b.v < a.v ? b : a));
  return { avg, latest, anomaly: (latest.v - avg) / avg, trend: slope * 10, worst, peaks, months: nd.months, peakMonth: nd.peakMonth };
}

// --- advice ---------------------------------------------------------------

export function actions(farm, climate, soil, ndvi, ranking) {
  const out = [];
  const fam = ranking.find((r) => r.crop.id === farm.family);
  // Arable farms get an arable alternative; grassland only suggests grassland-compatible changes
  const best = ranking.find((r) => r.crop.id !== farm.family && (farm.family === 'grass' || r.crop.id !== 'grass'));

  if (fam && best && (fam.delta <= -10 || best.later > fam.later + 10)) {
    out.push({
      tone: 'warn', tag: 'Crop plan',
      title: `Trial ${best.crop.name.toLowerCase()} on a test strip`,
      body: `${fam.crop.name} drops from ${fam.now} to ${fam.later} out of 100 by the 2040s${fam.limit ? ` (${fam.limit.toLowerCase()})` : ''}. ${best.crop.name} reaches ${best.later}. A side-by-side strip shows whether that holds on your own soil.`,
      crop: best.crop.id,
    });
  } else if (fam) {
    out.push({
      tone: 'good', tag: 'Crop plan',
      title: `${fam.crop.name} stays viable here`,
      body: `Suitability ${fam.now} today, ${fam.later} in the 2040s. ${fam.crop.tip}`,
      crop: fam.crop.id,
    });
  }

  if (climate.dSummerRain < -0.08 || climate.future.dryMax > climate.base.dryMax + 3) {
    const dry = climate.future.dryMax > climate.base.dryMax + 3;
    const fact = climate.dSummerRain < -0.08
      ? `Jun to Aug rain drops ${Math.abs(Math.round(climate.dSummerRain * 100))}%${dry ? ` and the longest dry spell grows from ${Math.round(climate.base.dryMax)} to ${Math.round(climate.future.dryMax)} days` : ''}.`
      : `The longest dry spell grows from ${Math.round(climate.base.dryMax)} to ${Math.round(climate.future.dryMax)} days.`;
    out.push({
      tone: 'warn', tag: 'Water',
      title: dry && climate.dSummerRain >= -0.08 ? 'Plan for longer dry spells' : 'Prepare for drier summers',
      body: `${fact} Farmers who already work in this climate know which residue, cover and variety choices hold water: ask them in Community.`,
    });
  }

  if (climate.dHot > 3) {
    const early = Math.round(-climate.dSpring);
    out.push({
      tone: 'info', tag: 'Timing',
      title: 'Move sowing earlier',
      body: `Days above 30 °C rise from ${Math.round(climate.base.hot30)} to ${Math.round(climate.future.hot30)} a year${early > 0 ? ` and the last frost comes ${early} days earlier` : ''}. Earlier sowing moves flowering and grain fill ahead of the heat.`,
    });
  }

  if (soil?.ph != null && soil.ph < 5.6) {
    out.push({ tone: 'info', tag: 'Soil', title: 'Check the lime need',
      body: `Mapped topsoil pH is ${soil.ph.toFixed(1)}, below the range most field crops prefer. A soil test on your own parcels sets the lime rate; the 250 m map cannot.` });
  } else if (soil?.soc != null && soil.soc < 15) {
    out.push({ tone: 'info', tag: 'Soil', title: 'Build organic matter',
      body: `Mapped organic carbon is ${soil.soc.toFixed(0)} g/kg, on the low side for arable land. Keeping residues and a winter cover are the usual first steps.` });
  }

  if (ndvi && ndvi.anomaly < -0.07) {
    const first = ndvi.peaks.find((p) => p.v != null).year;
    out.push({ tone: 'warn', tag: 'Satellite',
      title: `Greenness ${pct(ndvi.anomaly)} vs. normal`,
      body: `NASA MODIS shows ${MONTH_NAMES[ndvi.peakMonth - 1]} ${ndvi.latest.year} at NDVI ${ndvi.latest.v.toFixed(2)}, against a ${first} to ${ndvi.latest.year - 1} average of ${ndvi.avg.toFixed(2)}. The pixels cover about 3 km around the field, so check which parcels look patchy.` });
  }
  return out.slice(0, 4);
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const pct = (x) => `${x > 0 ? '+' : x < 0 ? '−' : '±'}${Math.abs(Math.round(x * 100))}%`;
export const signed = (x, d = 1) => `${x > 0 ? '+' : x < 0 ? '−' : '±'}${Math.abs(x).toFixed(d)}`;
export { cropById };

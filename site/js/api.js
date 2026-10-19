// Live data sources. All are free, keyless and CORS-enabled:
//   Open-Meteo Climate API   CMIP6 HighResMIP daily, 1991–2050 (EC-Earth3P-HR)
//   ISRIC SoilGrids 2.0      250 m soil properties
//   NASA GIBS                MODIS Terra monthly NDVI tiles, decoded per pixel
// Demo farms ship a snapshot of the first two (scripts/prefetch.py) so the pitch
// never depends on rate limits; any other point is fetched live and cached.

// Open-Meteo weighs a request as (variables / 10) x (days / 14) calls against a
// 600-per-minute limit. Four variables over 59 years is ~615 and fails on its own,
// so the daily mean is derived from max and min instead of requested (~460).
const CLIMATE = (lat, lon) => 'https://climate-api.open-meteo.com/v1/climate'
  + `?latitude=${lat}&longitude=${lon}&start_date=1991-01-01&end_date=2049-12-31&models=EC_Earth3P_HR`
  + '&daily=temperature_2m_max,temperature_2m_min,precipitation_sum';
const SOIL = (lat, lon) => 'https://rest.isric.org/soilgrids/v2.0/properties/query'
  + `?lon=${lon}&lat=${lat}&property=phh2o&property=clay&property=sand&property=silt&property=soc&property=nitrogen`
  + '&depth=0-5cm&depth=5-15cm&depth=15-30cm&value=mean';
const NDVI_TILE = (date, z, x, y) => 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_L3_NDVI_Monthly'
  + `/default/${date}/GoogleMapsCompatible_Level7/${z}/${y}/${x}.png`;

const key = (kind, lat, lon) => `cf:${kind}:${lat.toFixed(3)},${lon.toFixed(3)}`;

function cached(k) {
  try { return JSON.parse(localStorage.getItem(k)); } catch { return null; }
}
function store(k, v) {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* quota: fine, just not cached */ }
}

async function getJSON(url, ms = 25000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error(`${r.status} ${url.split('?')[0]}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

export async function loadSnapshot(id) {
  return getJSON(`data/farms/${id}.json`);
}

export async function fetchClimate(lat, lon) {
  const k = key('clim2', lat, lon);
  const hit = cached(k);
  if (hit) return hit;
  const j = await getJSON(CLIMATE(lat, lon), 40000);
  const d = j.daily;
  d.temperature_2m_mean = d.temperature_2m_max.map((x, i) => (x == null || d.temperature_2m_min[i] == null
    ? null : Math.round(((x + d.temperature_2m_min[i]) / 2) * 10) / 10));
  const v = { elevation: j.elevation, daily: d };
  store(k, v);
  return v;
}

export async function fetchSoil(lat, lon) {
  const k = key('soil', lat, lon);
  const hit = cached(k);
  if (hit) return hit;
  const j = await getJSON(SOIL(lat, lon), 30000);
  store(k, j);
  return j;
}

// --- NASA MODIS NDVI, read straight from the rendered tile -----------------

let colormap;
async function lookup() {
  if (!colormap) {
    const rows = await getJSON('data/ndvi-colormap.json');
    colormap = new Map(rows.map(([r, g, b, v]) => [(r << 16) | (g << 8) | b, v]));
  }
  return colormap;
}

const tiles = new Map();   // url -> Promise<ImageData | null>
function tileData(url) {
  if (!tiles.has(url)) {
    tiles.set(url, new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      const t = setTimeout(() => resolve(null), 15000);
      img.onload = () => {
        clearTimeout(t);
        const c = document.createElement('canvas');
        c.width = c.height = 256;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        try { resolve(ctx.getImageData(0, 0, 256, 256)); } catch { resolve(null); }
      };
      img.onerror = () => { clearTimeout(t); resolve(null); };
      img.src = url;
    }));
  }
  return tiles.get(url);
}

// Mean NDVI of a 3×3 pixel window (≈ 3 km) around the farm; null if no data
const GIBS_GAPS = new Set(['2025-04-01']);   // missing from the MODIS monthly product
async function ndviAt(date, lat, lon) {
  if (GIBS_GAPS.has(date)) return null;
  const z = 7, n = 2 ** z;
  const px = ((lon + 180) / 360) * n * 256;
  const s = Math.sin((lat * Math.PI) / 180);
  const py = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n * 256;
  const cm = await lookup();
  const vals = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const gx = Math.floor(px) + dx, gy = Math.floor(py) + dy;
      const data = await tileData(NDVI_TILE(date, z, Math.floor(gx / 256), Math.floor(gy / 256)));
      if (!data) continue;
      const i = ((gy % 256) * 256 + (gx % 256)) * 4;
      if (data.data[i + 3] < 255) continue;           // transparent: cloud, water, no data
      const v = cm.get((data.data[i] << 16) | (data.data[i + 1] << 8) | data.data[i + 2]);
      if (v != null) vals.push(v);
    }
  }
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

const LATEST = [2026, 8];  // newest MODIS monthly composite on GIBS (Aug 2026)

// { months: [{date, v}] last 24 months, peakMonth, peaks: [{year, v}] that month 2001–2026 }
// The peak month comes from the farm's own last two years: April in Puglia, July in Ireland.
export async function fetchNdvi(lat, lon) {
  const k = key('ndvi3', lat, lon);
  const hit = cached(k);
  if (hit) return hit;
  const months = [];
  for (let i = 23; i >= 0; i--) {
    const d = new Date(Date.UTC(LATEST[0], LATEST[1] - 1 - i, 1));
    months.push(d.toISOString().slice(0, 10));
  }
  const m = await pool(months, 6, async (date) => ({ date, v: await ndviAt(date, lat, lon) }));
  const byMonth = Array.from({ length: 12 }, () => []);
  m.forEach((x) => x.v != null && byMonth[+x.date.slice(5, 7) - 1].push(x.v));
  const avg = byMonth.map((a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : -1));
  const peakMonth = avg.indexOf(Math.max(...avg)) + 1;
  const mm = String(peakMonth).padStart(2, '0');
  const last = peakMonth <= LATEST[1] ? LATEST[0] : LATEST[0] - 1;
  const years = [];
  for (let y = 2001; y <= last; y++) years.push(y);
  const p = await pool(years, 6, async (year) => ({ year, v: await ndviAt(`${year}-${mm}-01`, lat, lon) }));
  const v = { months: m, peakMonth, peaks: p };
  if (m.some((x) => x.v != null)) store(k, v);
  return v;
}

// Place names for a tapped point (BigDataCloud client endpoint: free, no key)
// Cached per point; one retry, because several parallel lookups sometimes fail together.
export async function reverseGeocode(lat, lon) {
  const k = `cf:geo1:${(+lat).toFixed(2)},${(+lon).toFixed(2)}`;
  const hit = cached(k);
  if (hit) return hit;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      if (attempt) await new Promise((r) => setTimeout(r, 800 + Math.random() * 700));
      const j = await getJSON(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`, 8000);
      const v = {
        region: j.locality || j.city || j.principalSubdivision || 'Your area',
        sub: j.principalSubdivision && j.principalSubdivision !== (j.locality || j.city) ? j.principalSubdivision : '',
        country: j.countryName || '',
        cc: j.countryCode || '',
      };
      if (v.region !== 'Your area') store(k, v);
      return v;
    } catch { /* retry once */ }
  }
  return { region: 'Your area', sub: '', country: '', cc: '' };
}

export async function searchPlace(q) {
  const j = await getJSON(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=en`, 8000);
  return (j.results || []).map((r) => ({
    name: r.name, region: r.admin1 || r.name, country: r.country, cc: r.country_code, lat: r.latitude, lon: r.longitude,
  }));
}

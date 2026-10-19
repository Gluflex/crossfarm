import { loadSnapshot, fetchClimate, fetchSoil, fetchNdvi, reverseGeocode, searchPlace } from './api.js';
import { summarizeClimate, summarizeSoil, summarizeNdvi, rankCrops, actions, pct, signed, BASE } from './engine.js';
import { CROPS, cropById } from './crops.js';
import * as community from './community.js';
import { analogues, loadGrid, placeSigma, matchLabel, readVec, CLOSE, NOVEL } from './analogues.js';
import { api, uiLang } from './net.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ph = (name, fill = false) => `<i class="${fill ? 'ph-fill' : 'ph'} ph-${name}" aria-hidden="true"></i>`;

const S2 = 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2021_3857/default/g/{z}/{y}/{x}.jpg';
const S2_ATTR = 'Sentinel-2 cloudless 2021 by <a href="https://s2maps.eu">EOX</a> (Copernicus Sentinel data)';
const NDVI_8DAY = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_NDVI_8Day/default/2026-07-20/GoogleMapsCompatible_Level9/{z}/{y}/{x}.png';
const BASE_LABEL = `${BASE[0]}-${BASE[1]}`;
const GROUP_ICON = { Cereal: 'grains', Legume: 'leaf', Oilseed: 'flower', Tuber: 'carrot', Root: 'carrot', Forage: 'cow', Perennial: 'tree' };
const cropIcon = (c) => ph(GROUP_ICON[c.group] || 'plant');

let FARMS = [];
const state = { farm: null, d: null, tab: 'farm', cropFilter: 'best', feed: 'future', anaSel: 0 };

// ---------------------------------------------------------------- helpers

function tileXY(lat, lon, z) {
  const n = 2 ** z;
  const s = Math.sin((lat * Math.PI) / 180);
  return [((lon + 180) / 360) * n * 256, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n * 256];
}
const tileUrl = (z, x, y) => S2.replace('{z}', z).replace('{x}', x).replace('{y}', y);
function thumbUrl(lat, lon, z) {
  const [px, py] = tileXY(lat, lon, z);
  return tileUrl(z, Math.floor(px / 256), Math.floor(py / 256));
}

// Fill an element with sharp Sentinel-2 tiles, the given point exactly in the middle
function mosaic(el, lat, lon, z) {
  $$('img.tile', el).forEach((i) => i.remove());
  const w = el.clientWidth || 390, h = el.clientHeight || 300;
  const [px, py] = tileXY(lat, lon, z);
  const left = px - w / 2, top = py - h / 2;
  const frag = document.createDocumentFragment();
  for (let ty = Math.floor(top / 256); ty <= Math.floor((top + h) / 256); ty++) {
    for (let tx = Math.floor(left / 256); tx <= Math.floor((left + w) / 256); tx++) {
      const img = new Image();
      img.className = 'tile';
      img.alt = '';
      img.src = tileUrl(z, tx, ty);
      img.style.cssText = `position:absolute;width:256px;height:256px;left:${tx * 256 - left}px;top:${ty * 256 - top}px`;
      frag.appendChild(img);
    }
  }
  el.prepend(frag);
}

function show(id) {
  $$('.screen').forEach((s) => s.classList.toggle('on', s.id === id));
  $('#tabbar').classList.toggle('on', id === 'main');
}

let toastT;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('on'), 2200);
}

// Muted, earthy avatar tones so the feed doesn't look like a rainbow
const COLORS = ['#5b6b4a', '#8a5a3c', '#3f5f73', '#6e5a7a', '#7a6a3a', '#4d6e64', '#82513f', '#55607a'];
function avatar(name) {
  if (name === 'Crossfarm') return `<div class="avatar logo-av"><svg viewBox="0 0 32 32"><use href="#logo"/></svg></div>`;
  if (name === 'You') return '<div class="avatar me">You</div>';
  const h = [...name].reduce((a, c) => a + c.charCodeAt(0), 0);
  const ini = name.replace(/^(Dr\.|Prof\.)\s*/, '').split(/\s+/).map((w) => w[0]).slice(0, 2).join('');
  return `<div class="avatar" style="background:${COLORS[h % COLORS.length]}">${esc(ini)}</div>`;
}

const fmtKm = (km) => (km == null ? '' : km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km).toLocaleString('en')} km`);
const deltaCls = (d) => (d > 0 ? 'pos' : d < 0 ? 'neg' : 'zero');
const deltaTxt = (d) => (d > 0 ? `+${d}` : d < 0 ? `−${-d}` : 'same');

// Dumbbell on a 0-100 scale: hollow dot = today, filled dot = 2040s
function db(now, later, h = 14) {
  const col = later < now ? 'var(--accent)' : later > now ? 'var(--up)' : 'var(--ink-2)';
  const at = (v) => `calc(5px + (100% - 10px) * ${v / 100})`;
  return `<div class="db" style="height:${h}px" role="img" aria-label="${now} today, ${later} in the 2040s">
    <i class="ax"></i><i class="seg" style="left:${at(Math.min(now, later))};width:calc((100% - 10px) * ${Math.abs(later - now) / 100});background:${col}"></i>
    <i class="d0" style="left:${at(now)}"></i><i class="d1" style="left:${at(later)};background:${col}"></i></div>`;
}

// ---------------------------------------------------------------- onboarding

function renderOnboard() {
  $('#farmList').innerHTML = FARMS.map((f) => `
    <button class="farm-row" data-farm="${f.id}">
      <div class="thumb" style="background-image:url('${thumbUrl(f.lat, f.lon, 14)}')"></div>
      <div><b>${esc(f.name)}</b><span>${esc(f.region)}, ${esc(cropById(f.family).name.toLowerCase())} since ${f.since}</span></div>
      <span class="cc">${f.cc}</span>
    </button>`).join('');
  $$('#farmList [data-farm]').forEach((b) => (b.onclick = () => start(FARMS.find((f) => f.id === b.dataset.farm))));
  requestAnimationFrame(() => mosaic($('#cover'), 41.47, 15.62, 13));
}

// ---------------------------------------------------------------- map picker

let pickMap, pickGeo = {};
function openPicker(center, zoom) {
  show('picker');
  $('#pickFamily').innerHTML = CROPS.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  if (!pickMap) {
    pickMap = L.map('pickmap', { zoomControl: false, attributionControl: true }).setView(center, zoom);
    pickMap.attributionControl.setPrefix(false);
    L.tileLayer(S2, { maxZoom: 18, maxNativeZoom: 15, attribution: S2_ATTR }).addTo(pickMap);
    let t;
    pickMap.on('moveend', () => {
      const c = pickMap.getCenter();
      $('#pickCoord').textContent = `${c.lat.toFixed(4)}° N, ${c.lng.toFixed(4)}° E`;
      clearTimeout(t);
      t = setTimeout(async () => {
        pickGeo = await reverseGeocode(c.lat, c.lng);
        $('#pickPlace').textContent = [pickGeo.region, pickGeo.country].filter(Boolean).join(', ');
      }, 400);
    });
  } else {
    pickMap.setView(center, zoom);
  }
  setTimeout(() => { pickMap.invalidateSize(); pickMap.fire('moveend'); }, 50);
}

function bindPicker() {
  $('#pickMap').onclick = () => openPicker([48.5, 9], 5);
  $('#locate').onclick = () => {
    if (!navigator.geolocation) return openPicker([48.5, 9], 5);
    navigator.geolocation.getCurrentPosition(
      (p) => openPicker([p.coords.latitude, p.coords.longitude], 15),
      () => { toast('Location unavailable, pick on the map'); openPicker([48.5, 9], 5); },
      { timeout: 8000 });
  };
  $('#pickBack').onclick = () => show('onboard');
  let st;
  $('#search').oninput = (e) => {
    clearTimeout(st);
    const q = e.target.value.trim();
    if (q.length < 2) { $('#results').hidden = true; return; }
    st = setTimeout(async () => {
      const rs = await searchPlace(q).catch(() => []);
      $('#results').hidden = !rs.length;
      $('#results').innerHTML = rs.map((r, i) => `<button data-i="${i}">${esc(r.name)} <span>${esc(r.region)}, ${esc(r.country)}</span></button>`).join('');
      $$('#results button').forEach((b) => (b.onclick = () => {
        const r = rs[+b.dataset.i];
        $('#results').hidden = true; $('#search').value = r.name; $('#search').blur();
        pickMap.setView([r.lat, r.lon], 14);
      }));
    }, 300);
  };
  $('#pickGo').onclick = () => {
    const c = pickMap.getCenter();
    if (c.lat < 34 || c.lat > 71.5 || c.lng < -25 || c.lng > 45) {
      toast('Crossfarm covers Europe for now');
      return;
    }
    start({
      id: 'custom', custom: true, lat: +c.lat.toFixed(4), lon: +c.lng.toFixed(4),
      name: $('#pickName').value.trim() || 'My farm',
      region: pickGeo.region || 'Your area', country: pickGeo.country || '', cc: pickGeo.cc || '',
      ha: +$('#pickHa').value || 40, family: $('#pickFamily').value, since: null,
    });
  };
}

// ---------------------------------------------------------------- scan

const STEPS = [
  ['img', 'Sentinel-2 imagery'],
  ['soil', 'Soil, ISRIC SoilGrids'],
  ['clim', 'Climate model to 2049'],
  ['ndvi', 'Crop greenness, NASA MODIS'],
  ['ana', 'Where that climate is today'],
  ['rank', `Suitability of ${CROPS.length} crops`],
];

async function start(farm) {
  state.farm = farm;
  localStorage.setItem('cf:farm', JSON.stringify(farm));
  show('scan');
  mosaic($('#scanBand'), farm.lat, farm.lon, 15);
  $('#scanTitle').textContent = 'Reading your land';
  $('#scanSub').textContent = `${farm.name}, ${farm.lat.toFixed(3)}° N ${farm.lon.toFixed(3)}° E`;
  $('#steps').innerHTML = STEPS.map(([k, t]) => `<li data-k="${k}">${ph('circle')}${t}<small></small></li>`).join('');
  const step = (k, cls, note = '') => {
    const li = $(`#steps [data-k="${k}"]`);
    li.className = cls;
    li.querySelector('i').className = { run: 'ph ph-circle-notch', done: 'ph-fill ph-check-circle', fail: 'ph ph-minus-circle' }[cls];
    li.querySelector('small').textContent = note;
  };
  const t0 = Date.now();
  STEPS.slice(0, 4).forEach(([k]) => step(k, 'run'));

  const img = new Promise((res) => { const i = new Image(); i.onload = i.onerror = res; i.src = thumbUrl(farm.lat, farm.lon, 15); })
    .then(async () => { await wait(500); step('img', 'done', '10 m pixels'); });
  const snap = farm.custom ? null : loadSnapshot(farm.id).catch(() => null);
  const soilP = (async () => {
    const s = (await snap)?.soil || await fetchSoil(farm.lat, farm.lon).catch(() => null);
    const soil = summarizeSoil(s);
    await wait(900);
    step('soil', soil ? 'done' : 'fail', soil ? `pH ${soil.ph.toFixed(1)}` : 'no data here');
    return soil;
  })();
  loadGrid().catch(() => null);   // 1.6 MB analogue grid, in parallel with the APIs
  const rawP = (async () => {
    const sn = await snap;
    return sn ? { daily: sn.daily, elevation: sn.elevation } : fetchClimate(farm.lat, farm.lon);
  })();
  const climP = (async () => {
    const c = await rawP;
    const climate = summarizeClimate(c.daily);
    climate.elevation = c.elevation;
    await wait(1400);
    step('clim', 'done', `${signed(climate.dTemp)} °C`);
    return climate;
  })();
  const anaP = (async () => {
    const [c, soil] = await Promise.all([rawP, soilP]);
    step('ana', 'run');
    let a = null;
    try {
      a = await analogues(farm, c.daily, soil);
      if (a) await nameRegions(a);
    } catch (e) { console.error(e); }
    await wait(600);
    step('ana', a ? 'done' : 'fail', !a ? 'no data here' : a.novel ? 'no match today' : a.regions[0].name);
    return a;
  })();
  const ndviP = (async () => {
    const n = summarizeNdvi(await fetchNdvi(farm.lat, farm.lon).catch(() => null));
    await wait(1700);
    step('ndvi', n ? 'done' : 'fail', n ? `${n.peaks.length} years` : 'no data here');
    return n;
  })();

  try {
    const [, soil, climate, ndvi, analogue] = await Promise.all([img, soilP, climP, ndviP, anaP]);
    step('rank', 'run');
    const ranking = rankCrops(climate, soil);
    await wait(Math.max(400, 2600 - (Date.now() - t0)));
    step('rank', 'done', ranking[0].crop.name);
    state.anaSel = 0;
    state.feed = analogue && !analogue.novel ? 'future' : 'near';
    state.d = { climate, soil, ndvi, ranking, analogue, actions: actions(farm, climate, soil, ndvi, ranking) };
    await wait(450);
    enterApp();
  } catch (e) {
    console.error(e);
    // Open-Meteo per-minute limit: wait it out once, visibly, then retry by itself
    if (/429/.test(e.message) && !farm.retried) {
      $('#scanTitle').textContent = 'Climate service is busy';
      for (let s = 60; s > 0; s--) {
        $('#scanSub').textContent = `Trying again in ${s} seconds`;
        await wait(1000);
      }
      return start({ ...farm, retried: true });
    }
    $('#scanTitle').textContent = 'Climate data did not load';
    $('#scanSub').innerHTML = 'The climate service limits requests per minute. <a href="#" id="retry">Try again</a> or <a href="#" id="back">open a demo farm</a>.';
    $('#retry').onclick = (ev) => { ev.preventDefault(); start(farm); };
    $('#back').onclick = (ev) => { ev.preventDefault(); show('onboard'); };
  }
}

// ---------------------------------------------------------------- app shell

function enterApp() {
  show('main');
  renderFarm(); renderClimate(); renderCrops(); renderCommunity();
  go(state.tab);
}

function go(tab) {
  state.tab = tab;
  $$('.tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === tab));
  $$('#tabbar button').forEach((b) => {
    const on = b.dataset.go === tab;
    b.classList.toggle('on', on);
    const i = b.querySelector('i');
    i.classList.toggle('ph-fill', on); i.classList.toggle('ph', !on);
  });
  if (tab === 'farm' && farmMap) setTimeout(() => farmMap.invalidateSize(), 30);
  if (tab === 'community' && state.d) setTimeout(mountAnalogueMap, 30);
}

const header = (title, sub, right = '') =>
  `<div class="top"><div class="t"><h1>${title}</h1>${sub ? `<p>${sub}</p>` : ''}</div>${right}
    <button class="icon-btn ask-ai" data-askai aria-label="Ask Crossfarm about this field">${ph('sparkle')}</button></div>`;

// ---------------------------------------------------------------- farm tab

const ACTION_ICON = { 'Crop plan': 'plant', Water: 'drop', Timing: 'calendar-blank', Soil: 'shovel', Satellite: 'globe-hemisphere-west' };

let farmMap;
function renderFarm() {
  const { farm } = state, { climate: c, soil, ndvi, actions: acts } = state.d;
  const fam = state.d.ranking.find((r) => r.crop.id === farm.family);
  const el = $('#tFarm');
  el.innerHTML = `
    ${header(esc(farm.name), `${esc(farm.region)}${farm.country ? ', ' + esc(farm.country) : ''}`,
      `<button class="icon-btn" id="switch" aria-label="Switch farm">${ph('arrows-left-right')}</button>`)}
    <div class="mapcard">
      <div class="map" id="farmMap"></div>
      <div class="map-tog" id="mapTog"><button class="on" data-l="sat">Satellite</button><button data-l="ndvi">Greenness</button></div>
      <div class="map-meta"><span id="mapInfo">${farm.ha} ha, ${farm.lat.toFixed(3)}° ${farm.lon.toFixed(3)}°</span>
        <span class="scale" id="mapLegend" hidden>bare<i></i>lush</span></div>
    </div>

    <div class="headline">
      <small>By the 2040s, compared with ${BASE_LABEL}</small>
      <div class="big"><b>${signed(c.dTemp)}°</b><span>warmer on average<br>at this field</span></div>
      <p class="lead">${headlineText(fam)}</p>
      ${stripes(c)}
      <div class="readout">
        <div><b>${pct(c.dSummerRain)}</b><span>${rainSplit() ? 'summer rain, models disagree' : 'summer rain'}</span></div>
        <div><b>${Math.round(c.base.hot30)} → ${Math.round(c.future.hot30)}</b><span>days over 30 °C</span></div>
        <div><b>${Math.abs(Math.round(c.dSpring))} days</b><span>${c.dSpring <= 0 ? 'earlier' : 'later'} last frost</span></div>
      </div>
    </div>

    ${twinCard()}

    <div class="sec"><h2>What to do</h2>
      <div class="actions">
        ${acts.map((a) => `
          <div class="action ${a.tone}">${ph(ACTION_ICON[a.tag] || 'info')}
            <div><b>${esc(a.title)}</b><p>${esc(a.body)}</p>
            ${a.crop ? `<button class="link" data-crop="${a.crop}">Compare ${esc(cropById(a.crop).name.toLowerCase())} ${ph('arrow-right')}</button>` : ''}</div>
          </div>`).join('')}
      </div>
    </div>

    <div class="sec"><h2>Your field</h2>
      <div class="panel cells">
        ${ndvi ? `<div class="cell"><h3>Greenness</h3><b>${ndvi.latest.v.toFixed(2)}<small>NDVI</small></b>
          <p>${MON[ndvi.peakMonth - 1]} ${ndvi.latest.year}, ${pct(ndvi.anomaly)} vs. usual</p>${sparkline(ndvi.months.map((m) => m.v), 140, 30)}</div>`
          : '<div class="cell"><h3>Greenness</h3><b>n/a</b><p>No MODIS pixel here</p></div>'}
        ${soil ? `<div class="cell"><h3>Soil</h3><b>${soil.ph.toFixed(1)}<small>pH</small></b>
          <p>${esc(soil.texture)}${soil.soc != null ? `, ${Math.round(soil.soc)} g/kg carbon` : ''}</p>
          <div class="texture"><i style="width:${soil.clay}%"></i><i style="width:${soil.silt}%"></i><i style="width:${soil.sand}%"></i></div>
          <div class="tex-legend">clay ${Math.round(soil.clay)}%, silt ${Math.round(soil.silt)}%, sand ${Math.round(soil.sand)}%</div></div>`
          : '<div class="cell"><h3>Soil</h3><b>n/a</b><p>No SoilGrids value here</p></div>'}
        <div class="cell"><h3>Rain per year</h3><b>${Math.round(c.base.rain)}<small>mm</small></b><p>${pct(c.dRain)} by the 2040s</p></div>
        <div class="cell"><h3>Longest dry spell</h3><b>${Math.round(c.future.dryMax)}<small>days</small></b><p>up from ${Math.round(c.base.dryMax)}, Mar to Sep</p></div>
      </div>
    </div>
    <p class="foot">Copernicus Sentinel-2 via EOX. ISRIC SoilGrids 2.0 (250 m). Open-Meteo CMIP6, EC-Earth3P-HR, high-emission scenario, bias-corrected to ERA5-Land. NASA MODIS NDVI via GIBS (1 km). TerraClimate. Elevation ${Math.round(c.elevation ?? 0)} m. <a href="#" id="methodFarm">Method and sources</a></p>`;

  $('#switch').onclick = () => { renderOnboard(); show('onboard'); };
  $$('[data-crop]', el).forEach((b) => (b.onclick = () => openCrop(b.dataset.crop)));
  if ($('#twinGo')) $('#twinGo').onclick = () => go('community');
  $('#methodFarm').onclick = (e) => { e.preventDefault(); openMethod(); };

  if (farmMap) { farmMap.remove(); farmMap = null; }
  // credits live in the footer below
  farmMap = L.map('farmMap', { zoomControl: false, attributionControl: false, scrollWheelZoom: 'center' })
    .setView([farm.lat, farm.lon], 14);
  L.tileLayer(S2, { maxZoom: 18, maxNativeZoom: 15 }).addTo(farmMap);
  const ndviLayer = L.tileLayer(NDVI_8DAY, { maxZoom: 18, maxNativeZoom: 9, opacity: 0.8 });
  const r = Math.sqrt((farm.ha * 1e4) / Math.PI);
  L.circle([farm.lat, farm.lon], { radius: r, color: '#fff', weight: 1.5, dashArray: '4 5', fill: false }).addTo(farmMap);
  L.marker([farm.lat, farm.lon], { icon: L.divIcon({ className: '', html: '<div class="farm-pin"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }) }).addTo(farmMap);
  $$('#mapTog button').forEach((b) => (b.onclick = () => {
    $$('#mapTog button').forEach((x) => x.classList.toggle('on', x === b));
    const on = b.dataset.l === 'ndvi';
    if (on) { ndviLayer.addTo(farmMap); farmMap.setZoom(11); } else { ndviLayer.remove(); farmMap.setZoom(14); }
    $('#mapLegend').hidden = !on;
    $('#mapInfo').textContent = on ? 'MODIS 250 m, July 2026' : `${farm.ha} ha, ${farm.lat.toFixed(3)}° ${farm.lon.toFixed(3)}°`;
  }));
}

// ---------------------------------------------------------------- climate analogues

// Place names for the matched regions (reverse geocoding, three small calls)
async function nameRegions(a) {
  const named = await Promise.all([...a.regions, ...a.modelRegions].map((r) => reverseGeocode(r.lat, r.lon)));
  [...a.regions, ...a.modelRegions].forEach((r, i) => {
    r.name = named[i].region === 'Your area' ? `${r.lat.toFixed(1)}° N ${r.lon.toFixed(1)}° E` : named[i].region;
    r.sub = named[i].sub;
    r.country = named[i].country;
  });
}

const sig = (s) => (s < 0.05 ? 'under 0.1σ' : `${s.toFixed(1)}σ`);
const place = (r) => [r.name, r.sub, r.country].filter(Boolean).map(esc).join(', ');
const away = (r) => (r.km < 60 ? 'close to home' : `${fmtKm(r.km)} ${r.dir}`);

function twinCard() {
  const a = state.d.analogue;
  if (!a) return '';
  const r = a.regions[0];
  const body = a.novel || !r
    ? `No place in Europe or around the Mediterranean has this field's +2 °C climate today (best match ${sig(a.best)}). Farmers here will be among the first to farm it.`
    : `At +2 °C of global warming, this field's climate is closest to today's climate around <b>${place(r)}</b>, ${away(r)}: ${sig(r.sigma)} apart, where the field itself today is ${sig(a.homeSigma)} away.`;
  return `<div class="sec"><h2>Your future climate, today</h2>
    <div class="twin panel">
      <p>${body}</p>
      ${a.novel ? '' : `<button class="link" id="twinGo">Ask farmers there ${ph('arrow-right')}</button>`}
    </div></div>`;
}

// Map of matches: cells coloured by sigma, drawn onto a canvas in Web Mercator rows
function analogueOverlay(a) {
  const g = a.g, W = g.cols;
  const merc = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  const yN = merc(g.north), yS = merc(g.north - g.rows * g.step);
  const H = Math.round(W * ((yN - yS) / ((g.cols * g.step * Math.PI) / 180)));
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d'), img = ctx.createImageData(W, H);
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#d4501a';
  const [R, G, B] = accent.match(/\w\w/g).map((h) => parseInt(h, 16));
  for (let y = 0; y < H; y++) {
    const lat = (Math.atan(Math.sinh(yN - ((y + 0.5) / H) * (yN - yS))) * 180) / Math.PI;
    const r = Math.floor((g.north - lat) / g.step);
    for (let x = 0; x < W; x++) {
      const i = g.at[r * g.cols + x];
      if (i < 0) continue;
      const s = a.sEns[i];
      const alpha = s <= CLOSE ? 225 : s <= NOVEL ? 55 : 0;
      if (!alpha) continue;
      const o = (y * W + x) * 4;
      img.data[o] = R; img.data[o + 1] = G; img.data[o + 2] = B; img.data[o + 3] = alpha;
    }
  }
  ctx.putImageData(img, 0, 0);
  return L.imageOverlay(cv.toDataURL(), [[g.north - g.rows * g.step, g.west], [g.north, g.west + g.cols * g.step]], { opacity: 0.85 });
}

// The app's single model against the CMIP6 ensemble median, same cell, same seasons
function opinions() {
  const a = state.d.analogue;
  if (!a) return null;
  const t = readVec(a.homeToday), e = readVec(a.homeFuture), m = readVec(a.homeModel);
  return {
    summerMax: [m.summerMax - t.summerMax, e.summerMax - t.summerMax],
    winterMin: [m.winterMin - t.winterMin, e.winterMin - t.winterMin],
    summerRain: [m.summerRain / t.summerRain - 1, e.summerRain / t.summerRain - 1],
    yearRain: [m.yearRain / t.yearRain - 1, e.yearRain / t.yearRain - 1],
  };
}
// Opposite signs, and neither change negligible
const split = ([x, y], eps) => Math.sign(x) !== Math.sign(y) && Math.abs(x) > eps && Math.abs(y) > eps;
const rainSplit = () => { const o = opinions(); return o && split(o.summerRain, 0.02); };

function secondOpinion() {
  const o = opinions();
  if (!o) return '';
  const deg = (v) => `${signed(v)}°`;
  const row = (label, [m, e], f, eps) => `<tr class="${split([m, e], eps) ? 'split' : ''}"><th>${label}</th><td>${f(m)}</td><td>${f(e)}</td></tr>`;
  const any = split(o.summerRain, 0.02) || split(o.yearRain, 0.02);
  return `<div class="sec"><h2>Second opinion</h2>
    <div class="panel ana-text">
      <table class="cmp">
        <thead><tr><th></th><td>This model<br>2040s</td><td>CMIP6 median<br>+2&nbsp;°C</td></tr></thead>
        <tbody>
          ${row('Summer days', o.summerMax, deg, 0.1)}
          ${row('Winter nights', o.winterMin, deg, 0.1)}
          ${row('Summer rain', o.summerRain, pct, 0.02)}
          ${row('Rain per year', o.yearRain, pct, 0.02)}
        </tbody></table>
      <p class="caveat">${ph('info')}<span>${any
        ? 'The two disagree on the direction of rain here. Treat the rain numbers above as unknown, and plan for both.'
        : 'Both agree on the direction of change here.'} TerraClimate 25 km cell, seasonal means.</span></p>
    </div></div>`;
}

function compareRows(a, r) {
  const t = readVec(a.homeToday), f = readVec(a.homeFuture), o = readVec(r.today);
  const row = (label, x, y, z, u) => `<tr><th>${label}</th><td>${x}</td><td>${y}</td><td><b>${z}</b></td></tr>`;
  const deg = (v) => `${v.toFixed(1)}°`, mm = (v) => `${Math.round(v)}`;
  return `<table class="cmp">
    <thead><tr><th></th><td>Your field<br>today</td><td>Your field<br>+2 °C</td><td>${esc(r.name)}<br>today</td></tr></thead>
    <tbody>
      ${row('Summer days, °C', deg(t.summerMax), deg(f.summerMax), deg(o.summerMax))}
      ${row('Winter nights, °C', deg(t.winterMin), deg(f.winterMin), deg(o.winterMin))}
      ${row('Summer rain, mm', mm(t.summerRain), mm(f.summerRain), mm(o.summerRain))}
      ${row('Rain per year, mm', mm(t.yearRain), mm(f.yearRain), mm(o.yearRain))}
    </tbody></table>`;
}

function soilNote(a, r) {
  const fs = state.d.soil;
  if (!fs || Number.isNaN(r.soil.ph)) return '';
  const same = Math.abs(r.soil.ph - fs.ph) <= 0.8 && Math.abs(r.soil.clay - fs.clay) <= 12 && Math.abs(r.soil.sand - fs.sand) <= 20;
  return `${same ? 'Similar soil' : 'Different soil'}: pH ${r.soil.ph.toFixed(1)}, clay ${Math.round(r.soil.clay)}% (yours ${fs.ph.toFixed(1)}, ${Math.round(fs.clay)}%)`;
}

function dayNote(a, r) {
  const d = Math.round((r.day - a.dayHome) * 60);
  if (Math.abs(d) < 20) return '';
  const hm = (h) => `${Math.floor(h)} h ${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
  return `Longest day ${hm(r.day)}, ${Math.abs(d)} min ${d < 0 ? 'shorter' : 'longer'} than yours: varieties tuned to daylength can behave differently`;
}

function analoguePanel() {
  const a = state.d.analogue;
  if (!a) return '';
  if (a.novel || !a.regions.length) {
    return `<div class="sec"><div class="panel ana-panel"><div class="ana-text">
      <h3>No match today</h3>
      <p>No place between Morocco and Scandinavia has this field's +2 °C climate today: the best match is ${sig(a.best)}, beyond the 4σ line for a novel climate. Nearby farmers are the best source until then.</p>
      <button class="link" data-method>How the match works ${ph('arrow-right')}</button></div></div></div>`;
  }
  const sel = a.regions[Math.min(state.anaSel, a.regions.length - 1)];
  const agree = a.agree === a.regions.length ? 'The app\'s own climate model (2040s) finds the same regions.'
    : a.agree ? `The app's own climate model (2040s) finds ${a.agree} of these ${a.regions.length} regions too.`
      : `The app's own climate model (2040s) points elsewhere: ${a.modelRegions.slice(0, 2).map(place).join(' and ')}. Treat the match as uncertain.`;
  return `<div class="sec">
    <div class="panel ana-panel">
      <div class="ana-map" id="anaMap"></div>
      <div class="ana-key"><span><i class="k1"></i>close match, under 2σ</span><span><i class="k2"></i>partial, 2 to 4σ</span></div>
      <div class="regions">
        ${a.regions.map((r, i) => `<button class="region ${i === state.anaSel ? 'on' : ''}" data-r="${i}">
          <span class="n">${i + 1}</span>
          <div><b>${place(r)}</b><span>${away(r)}, ${matchLabel(r.sigma).toLowerCase()} ${sig(r.sigma)}</span></div></button>`).join('')}
      </div>
      <div class="ana-text">
        ${compareRows(a, sel)}
        ${[soilNote(a, sel), dayNote(a, sel)].filter(Boolean).map((t) => `<p class="caveat">${ph('info')}<span>${esc(t)}</span></p>`).join('')}
        <p class="caveat">${ph('arrows-split')}<span>${agree}</span></p>
        <p class="caveat">${ph('ruler')}<span>For scale: this field today is ${sig(a.homeSigma)} from its own +2 °C climate.</span></p>
        <button class="link" data-method>How the match works ${ph('arrow-right')}</button>
      </div>
    </div></div>`;
}

let anaMap;
function mountAnalogueMap() {
  const a = state.d.analogue;
  if (anaMap) { anaMap.remove(); anaMap = null; }
  if (!a || a.novel || !$('#anaMap')) return;
  anaMap = L.map('anaMap', { zoomControl: false, attributionControl: false, scrollWheelZoom: false });
  L.tileLayer(S2, { maxZoom: 9, maxNativeZoom: 9, opacity: 0.45 }).addTo(anaMap);   // dimmed so the matches read
  analogueOverlay(a).addTo(anaMap);
  const pts = [[state.farm.lat, state.farm.lon], ...a.regions.map((r) => [r.lat, r.lon])];
  L.marker(pts[0], { icon: L.divIcon({ className: '', html: '<div class="farm-pin"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }) }).addTo(anaMap);
  a.regions.forEach((r, i) => L.marker([r.lat, r.lon], {
    icon: L.divIcon({ className: '', html: `<div class="ana-pin ${i === state.anaSel ? 'on' : ''}">${i + 1}</div>`, iconSize: [22, 22], iconAnchor: [11, 11] }),
  }).addTo(anaMap));
  anaMap.fitBounds(L.latLngBounds(pts).pad(0.35), { maxZoom: 6 });
}

function headlineText(fam) {
  if (!fam) return '';
  const name = fam.crop.name.toLowerCase();
  if (fam.delta <= -10) return `Your ${name} drops from ${fam.now} to ${fam.later} out of 100 for this climate.`;
  if (fam.delta >= 10) return `Your ${name} gains: ${fam.now} today, ${fam.later} out of 100 in the 2040s.`;
  return `Your ${name} holds at ${fam.later} out of 100, but the season around it shifts.`;
}

// Warming stripes: one bar per year, coloured by anomaly vs. the 1991-2020 mean
function stripes(c) {
  const ys = c.years;
  const col = (a) => {
    const t = Math.max(-1, Math.min(1, a / 1.6));
    const [a1, a2] = t < 0 ? [[47, 95, 138], [196, 210, 222]] : [[236, 214, 196], [196, 64, 18]];
    const k = t < 0 ? 1 + t : t;
    return `rgb(${a1.map((v, i) => Math.round(v + (a2[i] - v) * k)).join(',')})`;
  };
  const now = ((new Date().getFullYear() - ys[0].year + 0.5) / ys.length) * 100;
  return `<div class="stripes" role="img" aria-label="Yearly temperature ${ys[0].year} to ${ys[ys.length - 1].year}">${ys.map((y) => `<i style="background:${col(y.temp - c.base.temp)}"></i>`).join('')}</div>
    <div class="stripe-axis"><span>${ys[0].year}</span><span style="left:${now}%">${new Date().getFullYear()}</span><span>${ys[ys.length - 1].year}</span></div>`;
}

function sparkline(vals, w, h) {
  const v = vals.map((x) => x ?? null);
  const ok = v.filter((x) => x != null);
  if (ok.length < 2) return '';
  const lo = Math.min(...ok) - 0.02, hi = Math.max(...ok) + 0.02;
  const X = (i) => (i / (v.length - 1)) * w, Y = (x) => h - ((x - lo) / (hi - lo)) * h;
  let d = '', pen = false;
  v.forEach((x, i) => { if (x == null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${X(i).toFixed(1)},${Y(x).toFixed(1)}`; pen = true; });
  return `<svg class="chart" viewBox="0 0 ${w} ${h + 4}" style="margin-top:8px" aria-label="Greenness, last 24 months"><path d="${d}" fill="none" stroke="var(--up)" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}

// ---------------------------------------------------------------- climate tab

const MONTHS = 'JFMAMJJASOND'.split('');
function renderClimate() {
  const { climate: c, ndvi } = state.d;
  const row = (label, a, b, worse) => `<dt>${label}</dt><dd><s>${a}</s> → <span class="${worse ? 'chg' : ''}">${b}</span></dd>`;
  $('#tClimate').innerHTML = `
    ${header('Climate', `${BASE_LABEL} compared with the 2040s`)}
    <div class="sec" style="margin-top:0">
      <div class="panel">
        <div class="chart-block">
          <h3>Temperature<span>°C per month</span></h3>
          ${lineChart(c.base.monthT, c.future.monthT)}
          <div class="legend"><span><i style="background:var(--base)"></i>${BASE_LABEL}</span><span><i style="background:var(--accent)"></i>2040s</span></div>
        </div>
        <div class="chart-block">
          <h3>Rain<span>mm per month</span></h3>
          ${barChart(c.base.monthP, c.future.monthP)}
          <div class="legend"><span><i class="box" style="background:var(--rain-2)"></i>${BASE_LABEL}</span><span><i class="box" style="background:var(--rain)"></i>2040s</span></div>
        </div>
      </div>
    </div>
    <div class="sec">
      <div class="panel groups">
        <div><h3>${ph('sun')}Heat</h3><dl>
          ${row('Mean temperature', `${c.base.temp.toFixed(1)}°`, `${c.future.temp.toFixed(1)}°`, c.dTemp > 0)}
          ${row('Apr to Sep', `${c.base.gsT.toFixed(1)}°`, `${c.future.gsT.toFixed(1)}°`, c.future.gsT > c.base.gsT)}
          ${row('Days over 30 °C', Math.round(c.base.hot30), Math.round(c.future.hot30), c.future.hot30 > c.base.hot30)}
          ${row('Days over 35 °C', Math.round(c.base.hot35), Math.round(c.future.hot35), c.future.hot35 > c.base.hot35)}
        </dl></div>
        <div><h3>${ph('drop')}Water and frost</h3><dl>
          ${row('Rain per year', `${Math.round(c.base.rain)}`, `${Math.round(c.future.rain)} mm`, c.future.rain < c.base.rain)}
          ${row('Longest dry spell', Math.round(c.base.dryMax), `${Math.round(c.future.dryMax)} d`, c.future.dryMax > c.base.dryMax)}
          ${row('Frost days', Math.round(c.base.frost), Math.round(c.future.frost), false)}
          ${row('Frost-free season', Math.round(c.base.season), `${Math.round(c.future.season)} d`, false)}
        </dl></div>
      </div>
    </div>
    ${secondOpinion()}
    ${ndvi ? `<div class="sec"><h2>Greenness since 2001</h2>
      <div class="panel chart-block">
        <h3>Every ${MON_LONG[ndvi.peakMonth - 1]}<span>NDVI, 1 km pixels</span></h3>
        ${ndviBars(ndvi)}
        <p class="note">Weakest year ${ndvi.worst.year} at ${ndvi.worst.v.toFixed(2)}. ${ndvi.latest.year} at ${ndvi.latest.v.toFixed(2)}, the long-run average is ${ndvi.avg.toFixed(2)}.</p>
      </div></div>` : ''}
    <p class="foot">One climate model (EC-Earth3P-HR, CMIP6 HighResMIP) under a high-emission pathway, bias-corrected to ERA5-Land by Open-Meteo, averaged over ${BASE_LABEL} and 2035-2049. Read the direction more than the decimals.</p>`;
}

function lineChart(a, b) {
  const w = 320, h = 130, pl = 22, pb = 16;
  const all = [...a, ...b], lo = Math.floor(Math.min(...all) / 5) * 5, hi = Math.ceil(Math.max(...all) / 5) * 5;
  const X = (i) => pl + (i / 11) * (w - pl - 4), Y = (v) => (h - pb) - ((v - lo) / (hi - lo)) * (h - pb - 6);
  const path = (arr) => arr.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join('');
  const area = `${path(b)}L${X(11)},${Y(a[11])}${a.map((v, i) => `L${X(11 - i)},${Y(a[11 - i])}`).join('')}Z`;
  let grid = '';
  for (let v = lo; v <= hi; v += 5) grid += `<line x1="${pl}" x2="${w}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--grid)"/><text x="0" y="${Y(v) + 3.5}">${v}</text>`;
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" style="margin-top:12px">${grid}
    <path d="${area}" fill="var(--accent-soft)"/>
    <path d="${path(a)}" fill="none" stroke="var(--base)" stroke-width="1.8" stroke-dasharray="4 4"/>
    <path d="${path(b)}" fill="none" stroke="var(--accent)" stroke-width="2.4" stroke-linejoin="round"/>
    ${MONTHS.map((m, i) => `<text x="${X(i)}" y="${h - 2}" text-anchor="middle">${m}</text>`).join('')}</svg>`;
}

function barChart(a, b) {
  const w = 320, h = 120, pl = 22, pb = 16;
  const hi = Math.ceil(Math.max(...a, ...b) / 25) * 25;
  const step = (w - pl) / 12, bw = step * 0.32;
  const Y = (v) => (h - pb) - (v / hi) * (h - pb - 6);
  let g = '';
  for (let v = 0; v <= hi; v += hi / 2) g += `<line x1="${pl}" x2="${w}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--grid)"/><text x="0" y="${Y(v) + 3.5}">${Math.round(v)}</text>`;
  const bars = a.map((v, i) => {
    const x = pl + i * step + step / 2;
    return `<rect x="${x - bw - 1}" y="${Y(v)}" width="${bw}" height="${Y(0) - Y(v)}" rx="1.5" fill="var(--rain-2)"/>
            <rect x="${x + 1}" y="${Y(b[i])}" width="${bw}" height="${Y(0) - Y(b[i])}" rx="1.5" fill="var(--rain)"/>
            <text x="${x}" y="${h - 2}" text-anchor="middle">${MONTHS[i]}</text>`;
  }).join('');
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" style="margin-top:12px">${g}${bars}</svg>`;
}

function ndviBars(n) {
  const w = 320, h = 110, pb = 16;
  const ps = n.peaks;
  const vs = ps.filter((p) => p.v != null).map((p) => p.v);
  const lo = Math.max(0, Math.min(...vs) - 0.1), hi = Math.min(1, Math.max(...vs) + 0.03);
  const step = w / ps.length, bw = step * 0.6;
  const Y = (v) => (h - pb) - ((v - lo) / (hi - lo)) * (h - pb - 4);
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" style="margin-top:12px">
    ${ps.map((p, i) => p.v == null ? '' : `<rect x="${i * step + (step - bw) / 2}" y="${Y(p.v)}" width="${bw}" height="${Y(lo) - Y(p.v)}" rx="1.5"
      fill="${p.year === n.worst.year ? 'var(--accent)' : p === n.latest ? 'var(--ink)' : 'var(--up)'}" opacity="${p.year === n.worst.year || p === n.latest ? 1 : 0.45}"/>`).join('')}
    <line x1="0" x2="${w}" y1="${Y(n.avg)}" y2="${Y(n.avg)}" stroke="var(--ink-2)" stroke-dasharray="3 3" opacity=".6"/>
    ${ps.map((p, i) => ((p.year % 5 === 0 && ps.length - 1 - i > 2) || i === ps.length - 1 ? `<text x="${i * step + step / 2}" y="${h - 2}" text-anchor="middle">${p.year}</text>` : '')).join('')}
  </svg>`;
}

// ---------------------------------------------------------------- crops tab

function renderCrops() {
  const { farm } = state, { ranking } = state.d;
  const fam = ranking.find((r) => r.crop.id === farm.family);
  const lists = {
    best: ranking,
    rising: ranking.filter((r) => r.delta > 0).sort((a, b) => b.delta - a.delta),
    risk: ranking.filter((r) => r.delta < 0).sort((a, b) => a.delta - b.delta),
  };
  const list = lists[state.cropFilter];
  $('#tCrops').innerHTML = `
    ${header('Crops', 'Fit for this field, today and in the 2040s')}
    ${fam ? `<button class="fam" id="famCard" style="width:100%">
      <small>Grown here${farm.since ? ` since ${farm.since}` : ' by your family'}</small>
      <h2>${cropIcon(fam.crop)}${esc(fam.crop.name)}</h2>
      <div class="pair"><s>${fam.now}</s>${ph('arrow-right')}<b class="${deltaCls(fam.delta)}">${fam.later}</b></div>
      ${db(fam.now, fam.later, 18)}
      <p>${fam.limit ? `${esc(fam.limit)}.` : 'No major limit.'} Scores out of 100.</p>
    </button>` : ''}
    <div class="tabs" id="cropSeg" role="tablist">
      <button data-f="best">Best fit</button><button data-f="rising">Rising ${lists.rising.length}</button><button data-f="risk">Falling ${lists.risk.length}</button>
    </div>
    <div class="crops">
      ${list.length ? list.map((r) => cropRow(r, farm)).join('') : '<div class="empty">No crops in this list for your field.</div>'}
    </div>
    <p class="foot">Each score combines season temperature over the crop's own growing months, yearly rain, soil pH, days over 35 °C and winter frost, with ranges after FAO ECOCROP. Rain-fed: irrigation changes the picture for thirsty crops.</p>`;
  $$('#cropSeg button').forEach((b) => {
    b.classList.toggle('on', b.dataset.f === state.cropFilter);
    b.onclick = () => { state.cropFilter = b.dataset.f; renderCrops(); };
  });
  $$('#tCrops [data-c]').forEach((b) => (b.onclick = () => openCrop(b.dataset.c)));
  if (fam) $('#famCard').onclick = () => openCrop(fam.crop.id);
}

function cropRow(r, farm) {
  return `<button class="crop" data-c="${r.crop.id}">
    ${cropIcon(r.crop)}
    <div class="nm"><b>${esc(r.crop.name)}${r.crop.id === farm.family ? '<em>yours</em>' : ''}</b>
      <span>${r.limit ? esc(r.limit) : 'No major limit'}</span></div>
    ${db(r.now, r.later)}
    <div class="sc"><b>${r.later}</b><span class="${deltaCls(r.delta)}">${deltaTxt(r.delta)}</span></div>
  </button>`;
}

// ---------------------------------------------------------------- sheets

function openSheet(html, foot = '') {
  $('#sheetBody').innerHTML = html;
  $('#sheetFoot').innerHTML = foot;
  $('#sheetBody').scrollTop = 0;
  $('#scrim').classList.add('on');
  $('#sheet').classList.add('on');
  $$('[data-close]', $('#sheet')).forEach((b) => (b.onclick = closeSheet));
}
function closeSheet() {
  $('#scrim').classList.remove('on');
  $('#sheet').classList.remove('on');
}
const closeBtn = `<button class="icon-btn" data-close aria-label="Close">${ph('x')}</button>`;

const FACTORS = [['temp', 'Season heat'], ['rain', 'Rainfall'], ['ph', 'Soil pH'], ['heat', 'Heatwaves'], ['frost', 'Winter frost']];
function openCrop(id) {
  const r = state.d.ranking.find((x) => x.crop.id === id);
  const { climate: c, soil } = state.d;
  const crop = r.crop;
  const fnow = factorsFor(crop, c.base, soil), flater = factorsFor(crop, c.future, soil);
  const near = community.threads(state.farm).filter((t) => t.crop === id).length;
  openSheet(`
    <div class="sheet-h"><div><h2>${esc(crop.name)}</h2><p>${esc(crop.group)}, growing ${monthsLabel(crop.months)}</p></div>${closeBtn}</div>
    <div class="fam">
      <div class="pair" style="margin-top:0"><s>${r.now}</s>${ph('arrow-right')}<b class="${deltaCls(r.delta)}">${r.later}</b></div>
      <p>${r.limit ? `Main limit in the 2040s: ${esc(r.limit.toLowerCase())}.` : 'No major limit in the 2040s.'}</p>
    </div>
    <div class="sec" style="margin-top:20px"><h2>Why</h2></div>
    <div class="factor-key"><span><svg viewBox="0 0 12 12"><circle cx="6" cy="6" r="4.5" fill="none" stroke="var(--muted)" stroke-width="1.6"/></svg>today</span>
      <span><svg viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="var(--ink-2)"/></svg>2040s</span></div>
    <div class="factors">
      ${FACTORS.filter(([k]) => k !== 'frost' || crop.frost != null).map(([k, label]) => `
        <div class="factor"><span>${label}</span>${db(Math.round(fnow[k] * 100), Math.round(flater[k] * 100))}</div>`).join('')}
    </div>
    <div class="tip">${ph('lightbulb')}<span>${esc(crop.tip)}</span></div>
    <div class="pad"><button class="btn primary block" id="askCrop">${ph('chat-circle')}Ask about ${esc(crop.name.toLowerCase())}</button>
      ${near ? `<p style="font-size:13px;color:var(--muted);margin-top:8px;text-align:center">${near} discussion${near > 1 ? 's' : ''} already</p>` : ''}</div>`);
  $('#askCrop').onclick = () => { closeSheet(); state.feed = 'all'; state.feedCrop = id; go('community'); renderCommunity(); setTimeout(() => openAsk(id), 250); };
}

// Re-derive per-factor values for the detail sheet (same maths as engine.score)
function factorsFor(crop, clim, soil) {
  const trap = (v, [a, b, c, d]) => (v <= a || v >= d ? 0 : v < b ? (v - a) / (b - a) : v > c ? (d - v) / (d - c) : 1);
  const temp = crop.months.reduce((s, m) => s + clim.monthT[m - 1], 0) / crop.months.length;
  const hot = crop.months.reduce((s, m) => s + clim.monthH[m - 1], 0);
  const [ok, fail] = crop.heat;
  const share = crop.frost != null ? clim.tmins.filter((v) => v < crop.frost).length / clim.tmins.length : 0;
  return {
    temp: trap(temp, crop.t), rain: trap(clim.rain, crop.rain),
    ph: soil?.ph == null ? 1 : trap(soil.ph, crop.ph),
    heat: hot <= ok ? 1 : hot >= fail ? 0 : 1 - (hot - ok) / (fail - ok),
    frost: Math.max(0, 1 - share),
  };
}
const MON_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthsLabel = (ms) => (ms.length === 12 ? 'all year' : `${MON[ms[0] - 1]} to ${MON[ms[ms.length - 1] - 1]}`);

// ---------------------------------------------------------------- community

function renderCommunity() {
  const { farm } = state;
  const fam = farm.family;
  const top = state.d.ranking.slice(0, 4).map((r) => r.crop.id);
  const a = state.d.analogue;
  const future = a && !a.novel;
  let ts = threadsWithSigma();
  if (state.feed === 'future') {
    ts = ts.filter((t) => t.mine || (t.sigma != null && t.sigma <= NOVEL));
    ts.sort((x, y) => (x.mine ? -1 : y.mine ? 1 : x.sigma - y.sigma));
  }
  if (state.feed === 'near') ts.sort((x, y) => (x.mine ? -1 : y.mine ? 1 : x.km - y.km));
  if (state.feed === 'crops') ts = ts.filter((t) => t.crop === fam || top.includes(t.crop));
  if (state.feed === 'open') ts = ts.filter((t) => !t.solved);
  if (state.feed === 'all' && state.feedCrop) ts = ts.filter((t) => t.crop === state.feedCrop);
  const filterCrop = state.feed === 'all' && state.feedCrop ? cropById(state.feedCrop) : null;

  $('#tCommunity').innerHTML = `
    ${header('Community', future ? 'Ask the farmers who already farm your future climate' : 'Farmers across Europe')}
    ${analoguePanel()}
    <div style="margin-top:22px"></div>
    <button class="composer" id="composer"><span>${future ? 'Ask farmers in your future climate' : `Ask farmers near ${esc(farm.region)}`}</span><b>Ask</b></button>
    <div class="tabs" id="feedSeg" role="tablist">
      ${filterCrop ? `<button data-f="all" class="on">${esc(filterCrop.name)} ${ph('x')}</button>` : ''}
      ${future ? '<button data-f="future">Future climate</button>' : ''}<button data-f="near">Nearest</button><button data-f="crops">Your crops</button><button data-f="open">Open</button>
    </div>
    ${pilotLine()}
    <div class="posts">
      ${ts.length ? ts.map(postCard).join('') : `<div class="empty">${state.feed === 'future' ? 'No discussions from your future climate yet. Ask the first question.' : 'No discussions here yet. Ask the first question.'}</div>`}
    </div>
    <p class="foot">Threads marked "Demo, fictional" were written for this prototype. Questions and answers you post are public in Crossfarm, with the name you give and your place to about 10 km. <a href="#" data-sheet="privacy">Privacy</a>. Farmer, adviser or researcher? <a href="#" data-sheet="pilot">Join the pilot</a>.</p>`;

  $('#composer').onclick = () => openAsk(state.feedCrop || fam);
  $$('#feedSeg button').forEach((b) => {
    if (b.dataset.f !== 'all') b.classList.toggle('on', !filterCrop && b.dataset.f === state.feed);
    b.onclick = () => { state.feedCrop = null; state.feed = b.dataset.f === 'all' ? (future ? 'future' : 'near') : b.dataset.f; renderCommunity(); };
  });
  $$('#tCommunity [data-t]').forEach((b) => (b.onclick = () => openThread(b.dataset.t)));
  $$('#tCommunity [data-r]').forEach((b) => (b.onclick = () => { state.anaSel = +b.dataset.r; renderCommunity(); }));
  $$('#tCommunity [data-method]').forEach((b) => (b.onclick = () => openMethod()));
  // Leaflet measures its box: mount once the tab is visible
  if ($('.tab[data-tab="community"]').classList.contains('on')) mountAnalogueMap();
  else if (anaMap) { anaMap.remove(); anaMap = null; }
}

// Every thread with its climate distance: the poster's climate today vs. this field's +2 °C climate
function threadsWithSigma() {
  const a = state.d.analogue;
  return community.threads(state.farm).map((t) => {
    const sigma = a && !t.mine ? placeSigma(a, t.lat, t.lon) : null;
    // a twin is closer to this field's future than the field itself is today
    return { ...t, sigma, twin: sigma != null && sigma <= CLOSE && sigma < a.homeSigma };
  });
}

// Counters from the shared database, shown once there is something to count
function pilotLine() {
  const s = state.stats;
  if (!s || s.questions + s.pilot === 0) return '';
  const n = (v, one, many) => (v ? `${v} ${v === 1 ? one : many}` : '');
  const parts = [n(s.questions, 'question', 'questions'), n(s.answers, 'answer from a farmer', 'answers from farmers'), n(s.pilot, 'sign-up', 'sign-ups')].filter(Boolean);
  return `<p class="pilot-line">${ph('users-three')}<span>Pilot so far: ${parts.join(', ')}</span></p>`;
}

const whoOf = (t) => (t.mine ? 'You' : t.who);
const tags = (t) => [
  t.demo ? `<span class="tag">Demo, fictional</span>` : '',
  t.pending ? `<span class="tag pend">${ph('cloud-slash')}Saved on this device</span>` : '',
].join('');

function postCard(t) {
  const crop = cropById(t.crop);
  return `<button class="post" data-t="${t.id}">
    <div class="who">${avatar(whoOf(t))}<div><b>${esc(whoOf(t))}</b><span>${esc(t.place)}${t.mine ? '' : `, ${fmtKm(t.km)}`}</span></div><time>${t.ago}</time></div>
    ${t.twin ? `<div class="twin-tag">${ph('arrows-left-right')}Farms your future climate today, ${sig(t.sigma)}</div>` : ''}
    ${t.demo || t.pending ? `<div class="tags">${tags(t)}</div>` : ''}
    <h4>${esc(t.q)}</h4>
    ${t.body ? `<p>${esc(t.body)}</p>` : ''}
    ${t.context ? `<div class="ctx">${ph('chart-line-up')}<span>${esc(t.context)}</span></div>` : ''}
    <div class="meta">${crop ? `<span>${cropIcon(crop)}${esc(crop.name)}</span>` : ''}
      <span>${ph('chat-circle')}${t.answers.length}</span>
      <span>${ph('thumbs-up')}${t.helpful + (t.voted ? 1 : 0)}</span>
      ${t.solved ? `<span class="solved">${ph('check')}Solved</span>` : ''}</div>
  </button>`;
}

// A "Translate" link for text written in another language than this phone's
const trLink = (lang, key) => (lang && lang !== uiLang() ? `<button class="link tr" data-tr="${key}">${ph('translate')}Translate</button>` : '');

function openThread(id) {
  const t = community.threads(state.farm).find((x) => x.id === id);
  const crop = cropById(t.crop);
  const texts = { q: t.q, b: t.body || '' };
  t.answers.forEach((a, i) => (texts[`a${i}`] = a.text));
  openSheet(`
    <div class="sheet-h"><div class="who" style="flex:1">${avatar(whoOf(t))}<div><b>${esc(whoOf(t))}</b><span>${esc(t.place)}${t.mine ? '' : `, ${fmtKm(t.km)} away`}, ${t.ago}</span></div></div>${closeBtn}</div>
    <div style="padding:0 20px 6px">
      ${t.demo || t.pending ? `<div class="tags" style="margin:0 0 10px">${tags(t)}</div>` : ''}
      <h2 data-txt="q" style="font-size:22px;line-height:1.2;font-weight:700;font-stretch:112%;letter-spacing:-.015em">${esc(t.q)}</h2>
      ${t.body ? `<p data-txt="b" style="font-size:15px;color:var(--ink-2);margin-top:8px">${esc(t.body)}</p>` : ''}
      ${trLink(t.lang, 'q')}
      ${t.context ? `<div class="ctx">${ph('chart-line-up')}<span>${esc(t.context)}</span></div>` : ''}
      <div class="meta">${crop ? `<span>${cropIcon(crop)}${esc(crop.name)}</span>` : ''}</div>
      <div class="thread-acts">
        <button class="helpful ${t.voted ? 'on' : ''}" id="vote">${ph('thumbs-up', t.voted)}Helpful ${t.helpful + (t.voted ? 1 : 0)}</button>
        ${t.server && !t.mine ? `<button class="link quiet" data-report="thread:${t.id}">${ph('flag')}Report</button>` : ''}
      </div>
    </div>
    <div class="sec" style="margin-top:22px"><h2>${t.answers.length ? `${t.answers.length} answer${t.answers.length === 1 ? '' : 's'}` : 'No answers yet'}</h2>
      ${t.answers.map((a, i) => `
        <div class="answer"><div class="who">${avatar(a.mine ? 'You' : a.who)}<div><b>${esc(a.mine ? 'You' : a.who)}${a.role === 'Agronomist' ? '<span class="role">Agronomist</span>' : a.role === 'Crossfarm' ? `<span class="role">${t.mine ? 'From your data' : "From the asker's field data"}</span>` : ''}</b>
          ${a.place ? `<span>${esc(a.place)}</span>` : ''}</div><time>${a.ago}</time></div><p data-txt="a${i}">${esc(a.text)}</p>
          <div class="ans-acts">${trLink(a.lang, `a${i}`)}${a.pending ? `<span class="tag pend">${ph('cloud-slash')}Saved on this device</span>` : ''}
            ${a.server && !(a.role === 'Crossfarm' && t.mine) && !a.mine ? `<button class="link quiet" data-report="reply:${a.id}">${ph('flag')}Report</button>` : ''}</div></div>`).join('')
      || '<p class="empty" style="padding-top:0">Farmers near the asker will see this question first.</p>'}
    </div>`,
  `<div class="reply"><input id="replyIn" placeholder="Share what worked for you" aria-label="Your answer"><button id="replyGo" aria-label="Send">${ph('paper-plane-right')}</button></div>`);
  $('#vote').onclick = () => { community.toggleHelpful(id); openThread(id); renderCommunity(); };
  $$('[data-tr]', $('#sheet')).forEach((b) => (b.onclick = () => translateIn(b, texts)));
  $$('[data-report]', $('#sheet')).forEach((b) => (b.onclick = async () => {
    const [kind, target] = b.dataset.report.split(':');
    b.disabled = true;
    toast((await community.report(kind, target)) ? 'Thanks for the report. Posts reported by three people are hidden.' : 'Report did not go through. Try again later.');
  }));
  let sending = false;
  const send = async () => {
    const v = $('#replyIn').value.trim();
    if (!v || sending) return;
    sending = true;
    const r = await community.reply(id, state.farm, v);
    openThread(id); renderCommunity();
    toast(r.pending ? 'Saved on this device, not shared yet' : 'Answer posted');
  };
  $('#replyGo').onclick = send;
  $('#replyIn').onkeydown = (e) => { if (e.key === 'Enter') send(); };
}

// Swap a text for its translation (and back). Question and details translate together.
async function translateIn(btn, texts) {
  const keys = btn.dataset.tr === 'q' ? ['q', 'b'] : [btn.dataset.tr];
  const els = keys.map((k) => $(`[data-txt="${k}"]`, $('#sheet'))).filter(Boolean);
  if (btn.dataset.shown) {
    els.forEach((el, i) => (el.textContent = texts[keys[i]]));
    delete btn.dataset.shown;
    btn.innerHTML = `${ph('translate')}Translate`;
    return;
  }
  btn.disabled = true;
  btn.innerHTML = `${ph('circle-notch')}Translating`;
  try {
    const out = await Promise.all(els.map((el, i) => community.translate(texts[keys[i]], uiLang())));
    if (out.some((o) => o.paused || !String(o.text || '').trim())) throw new Error('paused');  // keep the original over a blank
    els.forEach((el, i) => (el.textContent = out[i].text));
    btn.dataset.shown = '1';
    btn.innerHTML = `${ph('translate')}Show original`;
  } catch {
    btn.innerHTML = `${ph('translate')}Translate`;
    toast('Translation is not available right now');
  }
  btn.disabled = false;
}

function openAsk(cropId, preset = '') {
  const { farm, d } = state;
  const a = d.analogue;
  const who = a && !a.novel
    ? `Farmers around ${a.regions.slice(0, 2).map((r) => esc(r.name)).join(' and ')} see it first: their climate today is your field at +2 °C.`
    : `Farmers near ${esc(farm.region)} see it first.`;
  openSheet(`
    <div class="sheet-h"><div><h2>Ask a question</h2><p>${who}</p></div>${closeBtn}</div>
    <div style="padding:0 20px">
      <label class="field"><small>Question</small><input id="askQ" placeholder="Who buys sorghum around here?" value="${esc(preset)}"></label>
      <label class="field"><small>Your name, shown with the question</small><input id="askN" placeholder="First name" value="${esc(community.myName())}" autocomplete="given-name"></label>
      <label class="field"><small>Details, optional</small><textarea id="askB" placeholder="Soil, field size, what you tried"></textarea></label>
      <label class="field"><small>Crop</small><select id="askC">${CROPS.map((c) => `<option value="${c.id}" ${c.id === cropId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
      <label class="check"><input type="checkbox" id="askCtx" checked>Attach my field data</label>
      <div class="ctx" id="ctxPrev"></div>
      <button class="btn primary block" id="askGo" style="margin-top:16px">Post question</button>
    </div>`);
  const ctxText = () => {
    const r = d.ranking.find((x) => x.crop.id === $('#askC').value);
    return `${r.crop.name} ${r.now} → ${r.later} here, ${signed(d.climate.dTemp)} °C by the 2040s${d.soil ? `, soil pH ${d.soil.ph.toFixed(1)}` : ''}`;
  };
  const upd = () => { $('#ctxPrev').innerHTML = `${ph('chart-line-up')}<span>${esc(ctxText())}</span>`; $('#ctxPrev').hidden = !$('#askCtx').checked; };
  $('#askC').onchange = upd; $('#askCtx').onchange = upd; upd();
  setTimeout(() => $('#askQ').focus(), 350);
  $('#askGo').onclick = async () => {
    const q = $('#askQ').value.trim();
    if (!q) { $('#askQ').focus(); toast('Write a question first'); return; }
    if ($('#askN').value.trim()) community.setName($('#askN').value);
    $('#askGo').disabled = true;
    const crop = $('#askC').value;
    const routed = !!(a && !a.novel);
    const p = await community.ask(farm, crop, q, $('#askB').value.trim(), $('#askCtx').checked ? ctxText() : null, routed);
    // the instant answer comes from the field data, not from a farmer: it is posted as Crossfarm
    await community.reply(p.id, farm, dataAnswer(crop), 'Crossfarm');
    state.feed = routed ? 'future' : 'near'; state.feedCrop = null;
    state.stats = await community.stats();
    renderCommunity(); go('community');
    openThread(p.id);
    toast(p.pending ? 'No connection: saved on this device' : routed ? 'Posted to your future climate' : `Posted near ${farm.region}`);
  };
}

function dataAnswer(cropId) {
  const { d, farm } = state;
  const r = d.ranking.find((x) => x.crop.id === cropId);
  const a = d.analogue;
  const ts = threadsWithSigma().filter((t) => t.crop === cropId && !t.mine);
  const twin = ts.filter((t) => t.twin).sort((x, y) => x.sigma - y.sigma)[0];
  const peers = ts.sort((x, y) => x.km - y.km)[0];
  const better = d.ranking.filter((x) => x.later > r.later + 10).slice(0, 2).map((x) => x.crop.name.toLowerCase());
  let txt = `${r.crop.name} on your field: ${r.now} out of 100 today, ${r.later} in the 2040s${r.limit ? ` (${r.limit.toLowerCase()})` : ''}.`;
  if (better.length) txt += `\nStronger fits here: ${better.join(' and ')}.`;
  if (a && !a.novel) txt += `\nYour +2 °C climate is today's climate around ${a.regions.map((x) => x.name).join(', ')}.`;
  const demo = (t) => (t.demo ? ' (demo thread)' : '');
  if (twin) txt += `\nAlready farming that climate: ${twin.who}, ${twin.place} (${sig(twin.sigma)})${demo(twin)}.`;
  else if (peers) txt += `\nNearest discussion on ${r.crop.name.toLowerCase()}: ${peers.who}, ${fmtKm(peers.km)} away${demo(peers)}.`;
  return txt;
}

// ---------------------------------------------------------------- Ask Crossfarm

// What the assistant may read: the numbers this app shows, rounded the way it shows them
function fieldContext() {
  const { farm, d } = state, c = d.climate, s = d.soil, n = d.ndvi, a = d.analogue;
  const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10);
  return {
    farm: { name: farm.name, region: farm.region, country: farm.country, lat: Math.round(farm.lat * 10) / 10, lon: Math.round(farm.lon * 10) / 10, ha: farm.ha,
      family: cropById(farm.family)?.name },
    climate: {
      periods: `baseline ${BASE_LABEL}, 2040s = 2035-2049 mean of one climate model (EC-Earth3P-HR), model output`,
      meanTempC: { baseline: r1(c.base.temp), '2040s': r1(c.future.temp), change: signed(c.dTemp) },
      aprToSepTempC: { baseline: r1(c.base.gsT), '2040s': r1(c.future.gsT) },
      rainPerYearMm: { baseline: Math.round(c.base.rain), '2040s': Math.round(c.future.rain), change: pct(c.dRain) },
      summerRainChange: pct(c.dSummerRain),
      summerRainModelsDisagree: !!rainSplit(),
      daysOver30C: { baseline: Math.round(c.base.hot30), '2040s': Math.round(c.future.hot30) },
      daysOver35C: { baseline: Math.round(c.base.hot35), '2040s': Math.round(c.future.hot35) },
      longestDrySpellMarToSepDays: { baseline: Math.round(c.base.dryMax), '2040s': Math.round(c.future.dryMax) },
      frostDays: { baseline: Math.round(c.base.frost), '2040s': Math.round(c.future.frost) },
      lastSpringFrost: `${Math.abs(Math.round(c.dSpring))} days ${c.dSpring <= 0 ? 'earlier' : 'later'} in the 2040s`,
      elevationM: Math.round(c.elevation ?? 0),
    },
    soil: s ? { pH: r1(s.ph), texture: s.texture, clayPct: Math.round(s.clay), siltPct: Math.round(s.silt), sandPct: Math.round(s.sand),
      organicCarbonGPerKg: s.soc != null ? Math.round(s.soc) : null, source: 'ISRIC SoilGrids 2.0, 250 m, modelled' } : null,
    ndvi: n ? { source: 'NASA MODIS NDVI, 1 km', latest: `${n.latest.v.toFixed(2)} in ${MON[n.peakMonth - 1]} ${n.latest.year}`,
      vsUsual: pct(n.anomaly), longRunAverage: n.avg.toFixed(2), weakestYear: `${n.worst.year} at ${n.worst.v.toFixed(2)}` } : null,
    crops: d.ranking.map((r) => ({ id: r.crop.id, name: r.crop.name, todayOutOf100: r.now, in2040sOutOf100: r.later, mainLimit: r.limit || 'none' })),
    analogue: a ? {
      method: 'TerraClimate 1991-2020 plus CMIP6 ensemble median change at +2 °C global warming; sigma distance, under 2 is a close match',
      novel: !!a.novel,
      fieldTodayFromItsOwnFutureSigma: r1(a.homeSigma),
      places: a.novel ? [] : a.regions.map((r) => ({ place: [r.name, r.sub, r.country].filter(Boolean).join(', '), km: Math.round(r.km), direction: r.dir, sigma: r1(r.sigma) })),
    } : null,
    threads: threadsWithSigma().filter((t) => !t.mine).sort((x, y) => (x.sigma ?? 99) - (y.sigma ?? 99)).slice(0, 10)
      .map((t) => ({ who: t.demo ? `${t.who} (demo thread, fictional person)` : t.who, place: t.place, crop: cropById(t.crop)?.name, question: t.q, farmsThisFieldsFutureClimate: t.twin,
        sigma: r1(t.sigma), answers: t.answers.length, demo: !!t.demo })),
  };
}

// Three questions this field raises, from its own data
function suggestions() {
  const { farm, d } = state;
  const fam = d.ranking.find((r) => r.crop.id === farm.family);
  const rising = d.ranking.filter((r) => r.delta > 0).sort((x, y) => y.delta - x.delta)[0];
  const a = d.analogue;
  return [
    fam && `Will ${fam.crop.name.toLowerCase()} still work here in the 2040s?`,
    rising && `Should I try ${rising.crop.name.toLowerCase()}?`,
    a && !a.novel ? `What do farmers around ${a.regions[0].name} do differently?` : 'What changes most on this field?',
  ].filter(Boolean);
}

const TOOL_LABEL = { get_climate: 'Climate', get_soil: 'Soil', get_greenness: 'Greenness', get_crop_scores: 'Crop scores',
  get_future_climate_places: 'Future climate places', find_farmer_discussions: 'Discussions' };

function openAI(preset = '') {
  const { farm } = state;
  openSheet(`
    <div class="sheet-h"><div><h2>Ask Crossfarm</h2><p>Answers from ${esc(farm.name)}'s own data: climate, soil, satellite, crops and farmers in its future climate.</p></div>${closeBtn}</div>
    <div style="padding:0 20px">
      <div class="sugg">${suggestions().map((s) => `<button class="chip" data-q="${esc(s)}">${esc(s)}</button>`).join('')}</div>
      <label class="field"><small>Your question, in any language</small><textarea id="aiQ" placeholder="Is it worth irrigating potatoes here?">${esc(preset)}</textarea></label>
      <button class="btn primary block" id="aiGo" style="margin-top:12px">${ph('sparkle')}Ask</button>
      <div id="aiOut" aria-live="polite"></div>
    </div>`);
  $$('#sheet [data-q]').forEach((b) => (b.onclick = () => { $('#aiQ').value = b.dataset.q; runAI(); }));
  $('#aiGo').onclick = runAI;
}

// The crop a question is about, else the family crop (for the fallback data answer)
const cropIn = (q) => (CROPS.find((c) => q.toLowerCase().includes(c.name.toLowerCase()))?.id) || state.farm.family;

// Models sometimes answer in Markdown; the sheet shows plain text
const plain = (t) => String(t).replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1').replace(/^#{1,6}\s*/gm, '');

async function runAI() {
  const q = $('#aiQ').value.trim();
  if (!q) { $('#aiQ').focus(); return; }
  const out = $('#aiOut');
  $('#aiGo').disabled = true;
  out.innerHTML = `<p class="ai-wait">${ph('circle-notch')}Reading this field's data</p>`;
  let r;
  try { r = await api('/api/ask', { question: q, field: fieldContext() }, 45000); } catch { r = { paused: 'offline' }; }
  if (!$('#aiOut')) return;   // sheet closed meanwhile
  $('#aiGo').disabled = false;
  const a = state.d.analogue;
  const where = a && !a.novel ? a.regions[0].name : state.farm.region;
  const handoff = `<button class="btn line block" id="aiPost" style="margin-top:14px">${ph('chats-circle')}Ask farmers around ${esc(where)}</button>`;
  if (r.paused || !r.answer) {
    out.innerHTML = `<div class="ai-ans">
      <p class="caveat">${ph('pause-circle')}<span>The assistant is paused right now. This answer comes straight from your field data.</span></p>
      <p class="ai-text">${esc(dataAnswer(cropIn(q)))}</p></div>${handoff}`;
  } else {
    out.innerHTML = `<div class="ai-ans">
      <p class="ai-text">${esc(plain(r.answer))}</p>
      ${r.used?.length ? `<div class="used">${ph('database')}<span>Used: ${r.used.map((u) => esc(TOOL_LABEL[u] || u)).join(', ')}</span></div>` : ''}
      ${r.numbers === 'unverified' ? `<p class="caveat warn">${ph('warning')}<span>Some numbers in this answer are not in your field data. Check them in the tabs before acting.</span></p>` : ''}
      <p class="caveat">${ph('info')}<span>Model output (NVIDIA Nemotron via Nebius). Crop scores are a screening, not a forecast.</span></p>
    </div>${handoff}`;
  }
  $('#aiPost').onclick = () => openAsk(cropIn(q), q);
}

// ---------------------------------------------------------------- pilot and privacy

function openPilot() {
  openSheet(`
    <div class="sheet-h"><div><h2>Join the pilot</h2><p>We are testing whether farmers in matching climates help each other. Join and we get in touch, nothing else.</p></div>${closeBtn}</div>
    <div style="padding:0 20px">
      <label class="field"><small>I am a</small><select id="plR"><option value="farmer">Farmer</option><option value="adviser">Adviser or extension service</option><option value="researcher">Researcher</option><option value="other">Other</option></select></label>
      <label class="field"><small>Region</small><input id="plG" value="${esc(state.farm?.region || '')}"></label>
      <label class="field"><small>Email or phone</small><input id="plC" autocomplete="email" placeholder="name@farm.ch"></label>
      <label class="field"><small>Anything we should know, optional</small><textarea id="plN" placeholder="Crops, farm size, what you would ask"></textarea></label>
      <label class="check"><input type="checkbox" id="plOk">Contact me about the Crossfarm pilot. My details are used for this only.</label>
      <button class="btn primary block" id="plGo" style="margin-top:16px">Join</button>
      <p class="foot" style="padding:12px 0 0"><a href="#" data-sheet="privacy">Privacy</a></p>
    </div>`);
  $('#plGo').onclick = async () => {
    if (!$('#plC').value.trim()) { $('#plC').focus(); toast('Add an email or phone number'); return; }
    if (!$('#plOk').checked) { toast('Tick the box to agree to be contacted'); return; }
    $('#plGo').disabled = true;
    try {
      await api('/api/pilot', { role: $('#plR').value, region: $('#plG').value, contact: $('#plC').value, note: $('#plN').value, consent: true });
      state.stats = await community.stats();
      closeSheet(); renderCommunity();
      toast('Thanks, we will be in touch');
    } catch {
      $('#plGo').disabled = false;
      toast('Did not go through. Check the connection and try again.');
    }
  };
}

// Privacy notice (Swiss revDSG / GDPR): wording für Anwalt prüfen before any paid use;
// postal address of Catarci Engineering still to add.
function openPrivacy() {
  openSheet(`
    <div class="sheet-h"><div><h2>Privacy</h2><p>What Crossfarm stores, and why</p></div>${closeBtn}</div>
    <div class="method">
      <h3>Who is responsible</h3>
      <p>Catarci Engineering, Leandro Catarci, Switzerland. Contact: leandro@catarci.ch.</p>
      <h3>Your field</h3>
      <p>The point you pick and the results stay on your phone. To compute them, the app asks public services for data at that point: Open-Meteo (climate), ISRIC SoilGrids (soil), NASA GIBS (satellite greenness), EOX (imagery), BigDataCloud (place names).</p>
      <h3>Questions and answers</h3>
      <p>What you post is public in Crossfarm: the name you give, the text, the crop, the field data you attach and your place rounded to about 10 km. Posts are stored with Cloudflare. A post reported by three people is hidden. Posts stay until you ask us to delete them.</p>
      <h3>Ask Crossfarm</h3>
      <p>Your question, the farm name and location, this field's summary numbers and the public discussions shown in the app are sent to Nebius, which runs the NVIDIA Nemotron model, to write the answer; Nebius may process it in data centres outside Switzerland and the EU. Answers are kept for up to 90 days so the same question is not computed twice. Your contact details are never sent.</p>
      <h3>Pilot sign-up</h3>
      <p>Your role, region and contact are stored only to contact you about the pilot, are never shown in the app, and are deleted when the pilot ends.</p>
      <h3>Your rights</h3>
      <p>Write to leandro@catarci.ch to see, correct or delete what you posted or signed up with. To limit abuse, the server counts posts and questions per day with a one-way scrambled form of your IP address; the address itself is not stored.</p>
    </div>`);
}

// ---------------------------------------------------------------- method

// Back-test of the analogue method (scripts/validate.*, site/data/validation.json). Absent file: nothing shown.
function validationBlock() {
  const v = state.validation, s = v?.sample;
  if (!s) return '';
  // Europe-wide only: a single farm's back-test is too unstable to show as evidence for that farm
  const pc = (x) => `${Math.round(x * 100)}%`;
  const pub = v.published;
  return `<h3>Checked against the past</h3>
    <p>For ${s.compared.toLocaleString('en')} places across Europe, the direction this method predicts matches the direction climate really moved between 1961 to 1990 and 1991 to 2020 in ${pc(s.agreeShare)} of cases (a random guess: ${pc(s.randomShare)}). A simple "same warming everywhere" guess scores ${pc(s.uniformWarmingShare)}, so this confirms the general direction, not the exact place. It does not test farming advice.</p>
    ${pub ? `<p>Against published city analogues (Bastin et al. 2019, a different method and scenario), the match lies a median ${pub.medianKm.toLocaleString('en')} km from the published city, closer to it than the city itself in ${pub.closerThanHome} of ${pub.cities} cases. Agreement with another model, not proof.</p>` : ''}`;
}

function openMethod() {
  const a = state.d.analogue;
  const v = a?.v;
  openSheet(`
    <div class="sheet-h"><div><h2>Method and sources</h2><p>What each number is, and what it cannot tell you</p></div>${closeBtn}</div>
    <div class="method">
      <h3>Future climate, today</h3>
      <p>For this field's 25 km cell, Crossfarm takes the 1991 to 2020 climate from TerraClimate and adds the change at +2 °C of global warming: the ensemble median of CMIP6 models, as published with TerraClimate. The world reaches +2 °C around 2041 to 2060 on intermediate emissions (IPCC AR6, Table SPM.1). It then searches every land cell between 30 and 72° N, 25° W and 45° E for the place whose climate today is closest.</p>
      <p>Closeness uses twelve numbers: average day and night temperature and rain for each season. Each difference is measured against how much this field's own climate varies from year to year${v ? ` (${v.years} years of the climate model, ${v.pcs.length} principal components)` : ''}. The result is a distance in sigma: under 2σ is a close match, above 4σ nothing matches today. For scale, a single ordinary year sits about 0.7σ from its own 30-year average, so two places under 0.7σ apart differ less than one year differs from the next. This is the sigma dissimilarity of Mahony et al. 2017, as used by Fitzpatrick and Dunn 2019.</p>
      <p>As a cross-check, the same search runs with the change from the app's own climate model (2035 to 2049). When both point to the same regions, the match is robust to the choice of model.</p>
      <h3>What the match leaves out</h3>
      <p>Climate only. Soil is shown for each match and used as a filter when a close match with similar soil exists (SoilGrids, pH within 0.8, clay within 12 points). Daylength differs with latitude. Markets, water rights, farm size and policy differ too: an analogue says whom to ask, not what to do. Whether farmers find these conversations useful has not been tested in Europe; that is what the <a href="#" data-sheet="pilot">pilot</a> is for.</p>
      ${validationBlock()}
      <h3>Ask Crossfarm</h3>
      <p>The assistant is NVIDIA Nemotron, run by Nebius. It can only read this field's numbers as the app shows them (climate, soil, greenness, crop scores, future-climate places, discussions) and fetches them step by step with tools. Every number in its answer is checked against that data, and the answer says so when one is not found. It does not know prices, yields or local rules.</p>
      <h3>Crop scores</h3>
      <p>Seventeen crops scored 0 to 100 from season temperature, yearly rain, soil pH, days over 35 °C and winter frost, with ranges simplified from FAO ECOCROP. One climate model (EC-Earth3P-HR, CMIP6 HighResMIP, high-emission scenario, bias-corrected to ERA5-Land by Open-Meteo). No water balance, no irrigation, no CO2 effect, no yields: read them as a screening, not a forecast.</p>
      <h3>Field data</h3>
      <p>Soil from ISRIC SoilGrids 2.0 (250 m, modelled). Greenness from NASA MODIS monthly NDVI (1 km pixels, a 3 by 3 window around the field). Imagery from Sentinel-2 cloudless (10 m).</p>
      <h3>Sources</h3>
      <ul class="refs">
        <li>Abatzoglou et al. 2018, TerraClimate, Scientific Data 5:170191</li>
        <li>Bastin et al. 2019, city analogues, PLOS ONE 14:e0217592</li>
        <li>Mahony et al. 2017, Global Change Biology 23:3934</li>
        <li>Fitzpatrick and Dunn 2019, Nature Communications 10:614</li>
        <li>Poggio et al. 2021, SoilGrids 2.0, SOIL 7:217</li>
        <li>Haarsma et al. 2016, HighResMIP, Geoscientific Model Development 9:4185</li>
        <li>IPCC 2021, AR6 WG1 Summary for Policymakers</li>
      </ul>
      <h3>Source code</h3>
      <p>Open source under the GNU AGPL-3.0: <a href="https://github.com/Gluflex/crossfarm" target="_blank" rel="noopener">github.com/Gluflex/crossfarm</a></p>
    </div>`);
}

// ---------------------------------------------------------------- boot

async function boot() {
  FARMS = await fetch('data/farms.json').then((r) => r.json());
  fetch('data/validation.json').then((r) => (r.ok ? r.json() : null)).then((v) => (state.validation = v)).catch(() => {});
  renderOnboard();
  bindPicker();
  $$('#tabbar button').forEach((b) => (b.onclick = () => go(b.dataset.go)));
  $('#scrim').onclick = closeSheet;
  // one handler for every "Ask Crossfarm" button, wherever a render puts it
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-askai]') && state.d) openAI();
    const l = e.target.closest('[data-sheet]');
    if (l) { e.preventDefault(); ({ pilot: openPilot, privacy: openPrivacy, method: openMethod })[l.dataset.sheet]?.(); }
  });
  community.sync().then(async () => {
    state.stats = await community.stats();
    if (state.d) renderCommunity();
  });
  const q = new URLSearchParams(location.search);
  const saved = JSON.parse(localStorage.getItem('cf:farm') || 'null');
  const want = q.get('farm') ? FARMS.find((f) => f.id === q.get('farm')) : saved;
  if (q.get('tab')) state.tab = q.get('tab');
  if (want) start(want); else show('onboard');
}
boot();

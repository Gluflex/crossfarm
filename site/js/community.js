// Community Q&A. Seed threads are illustrative demo content (fictional people), tagged demo.
// Questions and replies go to the shared /api/threads; unsent ones wait on the device.
import { api, uiLang } from './net.js';

const SEED = [
  { id: 's1', who: 'Giulia Mancini', place: 'Cerignola, Puglia', lat: 41.27, lon: 15.9, crop: 'durum', ago: '2 h',
    q: 'Durum yields down two seasons in a row. Who has tried sorghum here?',
    body: 'May heat hit us during grain fill in 2024 and again this year. 110 ha, no irrigation. Thinking of putting 15 ha into grain sorghum next spring. Where do you sell it?',
    helpful: 34, solved: true,
    answers: [
      { who: 'Antonio Ricci', place: 'San Severo, Puglia', role: 'Farmer', ago: '1 h', helpful: 21,
        text: 'We did 20 ha in 2025. Sown 10 May, harvested mid-September, 6.8 t/ha with zero irrigation. The feed mill in Lucera takes it at roughly 90% of the maize price.' },
      { who: 'Dr. Elena Costa', place: 'CREA Foggia', role: 'Agronomist', ago: '40 min', helpful: 15,
        text: 'Pick a medium-early hybrid (FAO 400 to 500). Keep it on the heavier clay parcels: they hold the water it needs in July.' },
    ] },
  { id: 's2', who: 'Seán Ó Briain', place: 'Cashel, Co. Tipperary', lat: 52.52, lon: -7.89, crop: 'grass', ago: '5 h',
    q: 'Swards burning off in June. Does multispecies really hold up?',
    body: 'Three dry Junes in a row on our dairy platform. Considering reseeding 10 ha with chicory, plantain and red clover. Worth the cost?',
    helpful: 27, solved: true,
    answers: [
      { who: 'Aoife Byrne', place: 'Fethard, Co. Tipperary', role: 'Farmer', ago: '4 h', helpful: 19,
        text: 'Reseeded 2023. Grew 2 t DM/ha more than the ryegrass paddocks last summer and we cut fertiliser N by half. Graze it tight in autumn or the chicory gets stemmy.' },
      { who: 'Teagasc advisor', place: 'Moorepark', role: 'Agronomist', ago: '3 h', helpful: 12,
        text: 'Trials show similar yields with about 50% less nitrogen. Sow April to July into a fine, firm seedbed.' },
    ] },
  { id: 's3', who: 'Annelies de Vries', place: 'Barneveld, Gelderland', lat: 52.14, lon: 5.58, crop: 'potato', ago: '1 d',
    q: 'Late blight arriving three weeks earlier every year',
    body: 'Warm wet Mays are bringing Phytophthora in early June now. Anyone switched to resistant varieties like Carolus or Sarpo Mira and found buyers for them?',
    helpful: 41, solved: false,
    answers: [
      { who: 'Kees Jansen', place: 'Ede, Gelderland', role: 'Farmer', ago: '20 h', helpful: 16,
        text: 'Carolus on 8 ha, 4 sprays instead of 14. The organic wholesaler took everything. Chip processors were less keen.' },
    ] },
  { id: 's4', who: 'Reto Gerber', place: 'Kerzers, Seeland', lat: 46.98, lon: 7.2, crop: 'soybean', ago: '1 d',
    q: 'First soybean year on the Grosses Moos. Inoculant tips?',
    body: 'Crossfarm shows soy suitability nearly doubling here by the 2040s. I want to try 3 ha next season. Which inoculant and which maturity group for 450 m?',
    helpful: 18, solved: true,
    answers: [
      { who: 'Martina Kälin', place: 'Agroscope Changins', role: 'Agronomist', ago: '22 h', helpful: 14,
        text: 'Maturity group 000 to 00. Use a peat-based Bradyrhizobium inoculant right before sowing and keep the seed out of the sun. Tofu buyers pay a premium for Swiss food-grade soy.' },
    ] },
  { id: 's5', who: 'Carmen Ruiz', place: 'Écija, Sevilla', lat: 37.54, lon: -5.08, crop: 'olive', ago: '2 d',
    q: 'Moving wheat ground to super-intensive olives: is the water there?',
    body: 'Our wheat is not paying any more. Considering hedge olives on 30 ha, but the irrigation allocation got cut again this year.',
    helpful: 23, solved: false,
    answers: [
      { who: 'José Morales', place: 'Palma del Río, Córdoba', role: 'Farmer', ago: '2 d', helpful: 11,
        text: 'Hedge systems need about 1,500 m³/ha. On rain only, go traditional spacing with Picual. Lower yield, but it survives 2023-type droughts.' },
    ] },
  { id: 's6', who: 'Jan Kowalczyk', place: 'Zamość, Lubelskie', lat: 50.72, lon: 23.25, crop: 'sunflower', ago: '3 d',
    q: 'Rapeseed or sunflower after another dry August?',
    body: 'Two failed rapeseed establishments. The neighbours are moving to sunflower. What price spread do you see?',
    helpful: 12, solved: false, answers: [] },
  { id: 's7', who: 'Marco Bianchi', place: 'Mantova, Lombardia', lat: 45.16, lon: 10.79, crop: 'maize', ago: '4 d',
    q: 'Po river too low to irrigate maize. What are you planting instead?',
    body: 'Water restrictions hit us in July again. Thinking soybean or sorghum on the lighter soils.',
    helpful: 30, solved: true,
    answers: [
      { who: 'Luca Ferri', place: 'Cremona', role: 'Farmer', ago: '3 d', helpful: 13,
        text: 'Sorghum on the sandier fields, maize only where we have wells. Silage sorghum held up fine in the digester.' },
    ] },
  // Threads from places whose climate today matches a demo farm's future (see analogues.js)
  { id: 's8', who: 'Karim Ben Salah', place: 'Le Kef, Tunisia', lat: 36.3, lon: 8.8, crop: 'durum', ago: '6 h',
    q: 'Which durum varieties still fill grain after a hot May?',
    body: 'We sow mid-November on the clay plain and harvest early June. Three springs in a row the heat arrived before grain fill was done.',
    helpful: 22, solved: true,
    answers: [
      { who: 'Hedi Trabelsi', place: 'Dahmani, Le Kef', role: 'Farmer', ago: '5 h', helpful: 12,
        text: 'Early varieties sown in the first rains, not after. We lose a little in a good year and keep the crop in a bad one. Stubble mulch helped more than anything else we tried.' },
    ] },
  { id: 's9', who: 'Paolo Murgia', place: 'Oristano, Sardinia', lat: 39.9, lon: 8.6, crop: 'durum', ago: '1 d',
    q: 'Direct drilling durum after a dry winter: worth it?',
    body: 'Two dry winters, poor establishment on ploughed fields. Neighbours who direct drill had better stands. Any long-term experience on heavy soils?',
    helpful: 15, solved: false, answers: [] },
  { id: 's10', who: 'Youssef El Amrani', place: 'Saïss plain, Meknès', lat: 33.9, lon: -5.55, crop: 'chickpea', ago: '2 d',
    q: 'Winter chickpea instead of spring: who sows in December?',
    body: 'Spring chickpea keeps running out of water in May. Winter sowing needs Ascochyta-tolerant seed. Where do you buy it?',
    helpful: 19, solved: true,
    answers: [
      { who: 'Fatima Zahra Idrissi', place: 'El Hajeb', role: 'Farmer', ago: '2 d', helpful: 9,
        text: 'December sowing for four seasons now. Tolerant varieties from the national seed programme, and one fungicide pass in a wet February. Yield is clearly ahead of spring sowing.' },
    ] },
  { id: 's11', who: 'Wim Claes', place: 'Peer, Limburg', lat: 51.13, lon: 5.45, crop: 'potato', ago: '9 h',
    q: 'Irrigating potatoes on sand: what is your trigger?',
    body: 'Groundwater pumping got restricted again this summer. We need to get more out of fewer passes. Tensiometers, a model, or gut feeling?',
    helpful: 26, solved: true,
    answers: [
      { who: 'Lotte Peeters', place: 'Lommel', role: 'Farmer', ago: '7 h', helpful: 14,
        text: 'Tensiometers at two depths in each block, and we irrigate from tuber set only. Before that the crop copes. Saved us passes we had always made by habit.' },
    ] },
  { id: 's12', who: 'Sophie Laborde', place: 'Mont-de-Marsan, Landes', lat: 43.9, lon: -0.5, crop: 'soybean', ago: '3 d',
    q: 'Swapping irrigated maize for soy on sandy soil',
    body: 'Water quotas keep shrinking. Soy needs less in August. Anyone done the switch on pure sand?',
    helpful: 17, solved: false, answers: [] },
  { id: 's13', who: 'Rhys Evans', place: 'Carmarthen, Wales', lat: 51.86, lon: -4.3, crop: 'grass', ago: '12 h',
    q: 'Grass growth stalls every July now. Red clover silage?',
    body: 'Dairy on 90 ha. The summer gap gets longer. Thinking about red clover for a summer cut. Persistence?',
    helpful: 21, solved: true,
    answers: [
      { who: 'Megan Price', place: 'Llandeilo', role: 'Farmer', ago: '10 h', helpful: 11,
        text: 'Three years from our red clover leys, then it thins out. Rotational grazing in spring, cut it in July. Bought far less feed last summer.' },
    ] },
  { id: 's14', who: 'Claire Fournier', place: 'Bresse, Saône-et-Loire', lat: 46.5, lon: 5.1, crop: 'soybean', ago: '1 d',
    q: 'Soy after maize: our first two years',
    body: 'Happy to share our notes for anyone further north considering it. Early maturity groups, inoculated seed, sold to a local feed mill.',
    helpful: 24, solved: true,
    answers: [
      { who: 'Thomas Girard', place: 'Louhans', role: 'Farmer', ago: '20 h', helpful: 8,
        text: 'Same here. Watch the harvest date: a wet September costs more than any pest.' },
    ] },
  { id: 's15', who: 'Dragan Marić', place: 'Gradiška, Posavina', lat: 45.1, lon: 17.25, crop: 'soybean', ago: '2 d',
    q: 'Selling non-GM soy into Swiss and German contracts',
    body: 'We grow 60 ha. The buyers want certified non-GM and traceability. How do you organise the paperwork?',
    helpful: 13, solved: false, answers: [] },
  { id: 's16', who: 'Markus Huber', place: 'Kaiserstuhl, Baden', lat: 48.1, lon: 7.65, crop: 'sugarbeet', ago: '4 d',
    q: 'Sugar beet on the Rhine plain: when did you start irrigating?',
    body: 'Beet used to manage on rain here. Since 2018 we lose sugar every dry August. Is irrigation paying for you?',
    helpful: 16, solved: true,
    answers: [
      { who: 'Julia Weber', place: 'Breisach', role: 'Farmer', ago: '3 d', helpful: 7,
        text: 'Only on the lighter parcels, and only from mid-July. On the loess it has not paid off yet.' },
    ] },
];

for (const t of SEED) { t.demo = true; t.lang = 'en'; }

// Server-backed since v4. Local storage keeps: own thread ids with edit tokens, posts and
// replies that could not be sent yet (pending), helpful votes, the last server copy, the name.

const KEY = 'cf:community';
const SKEY = 'cf:server1';
const me = () => {
  const s = JSON.parse(localStorage.getItem(KEY) || '{}');
  return { posts: [], replies: {}, helpful: {}, mine: {}, ...s };
};
const save = (s) => localStorage.setItem(KEY, JSON.stringify(s));

let server = JSON.parse(localStorage.getItem(SKEY) || '[]');
export let online = false;

export const myName = () => localStorage.getItem('cf:name') || '';
export const setName = (n) => localStorage.setItem('cf:name', n.trim().slice(0, 60));

function ago(ms) {
  const m = Math.max(0, Math.round((Date.now() - ms) / 60000));
  if (m < 2) return 'now';
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h` : `${Math.round(h / 24)} d`;
}

// Load the shared threads. Keeps the last copy for offline use.
export async function sync() {
  try {
    const r = await api('/api/threads');
    server = r.threads;
    localStorage.setItem(SKEY, JSON.stringify(server));
    online = true;
  } catch {
    online = false;
    return;
  }
  if (await flush()) await sync();
}

// Send what was saved while offline. Returns true when anything went out.
async function flush() {
  const s = me();
  let sent = false;
  for (const p of [...s.posts].reverse()) {
    if (!p.pending) continue;
    try {
      const r = await api('/api/threads', { who: p.who, place: p.place, lat: p.lat, lon: p.lon, crop: p.crop, q: p.q, body: p.body, context: p.context, lang: p.lang, routed: p.routed });
      s.mine[r.id] = r.token;
      s.posts = s.posts.filter((x) => x.id !== p.id);
      // its replies (usually the data answer) move along with it
      const rs = s.replies[p.id] || [];
      delete s.replies[p.id];
      for (const a of rs) await api('/api/replies', { thread: r.id, who: a.who, place: a.place, role: a.role, text: a.text, lang: a.lang, token: a.role === 'Crossfarm' ? r.token : undefined }).catch(() => {});
      sent = true;
    } catch { break; }
  }
  for (const id of Object.keys(s.replies)) {
    if (!server.some((t) => t.id === id)) continue;   // demo threads keep their answers on the device
    const keep = [];
    for (const a of s.replies[id]) {
      if (!a.pending) { keep.push(a); continue; }
      try {
        await api('/api/replies', { thread: id, who: a.who, place: a.place, role: a.role, text: a.text, lang: a.lang, token: a.role === 'Crossfarm' ? s.mine[id] : undefined });
        sent = true;
      } catch { keep.push(a); }
    }
    s.replies[id] = keep;
  }
  save(s);
  return sent;
}

export async function stats() {
  try { return await api('/api/stats'); } catch { return null; }
}

export function threads(farm) {
  const s = me();
  const fromServer = server.map((t) => ({
    ...t, ago: ago(t.created), solved: false, server: true, mine: !!s.mine[t.id],
    answers: t.answers.map((a) => ({ ...a, ago: ago(a.created), server: true })),
  }));
  const all = [...s.posts, ...fromServer, ...SEED].map((p) => ({
    ...p,
    answers: [...p.answers, ...(s.replies[p.id] || [])],
    km: farm ? distance(farm.lat, farm.lon, p.lat, p.lon) : null,
    voted: !!s.helpful[p.id],
  }));
  return all;
}

// Post a question. Returns the thread id; falls back to this device when the server is unreachable.
export async function ask(farm, crop, q, body, context, routed) {
  const who = myName() || 'Farmer';
  const post = { who, place: farm.region, lat: farm.lat, lon: farm.lon, crop, q, body, context, lang: uiLang(), routed: !!routed };
  const s = me();
  try {
    const r = await api('/api/threads', post);
    s.mine[r.id] = r.token;
    save(s);
    await sync();
    return { id: r.id, pending: false };
  } catch {
    const id = 'u' + Date.now();
    s.posts.unshift({ ...post, id, mine: true, pending: true, ago: 'now', helpful: 0, solved: false, answers: [] });
    save(s);
    return { id, pending: true };
  }
}

// Answer a thread. Demo threads and unsent posts keep their answers on this device.
export async function reply(id, farm, text, role = 'Farmer') {
  const who = role === 'Crossfarm' ? 'Crossfarm' : myName() || 'Farmer';
  const local = { who, place: role === 'Crossfarm' ? '' : farm.region, role, ago: 'now', helpful: 0, text, lang: role === 'Crossfarm' ? 'en' : uiLang() };
  const s = me();
  const onServer = server.some((t) => t.id === id);
  if (onServer) {
    try {
      await api('/api/replies', { thread: id, who, place: local.place, role, text, lang: local.lang, token: role === 'Crossfarm' ? s.mine[id] : undefined });
      await sync();
      return { pending: false };
    } catch { /* fall through to local */ }
  }
  (s.replies[id] ||= []).push({ ...local, mine: role !== 'Crossfarm', pending: true });
  save(s);
  return { pending: true };
}

export async function report(kind, id) {
  try { await api('/api/report', { kind, target: id }); return true; } catch { return false; }
}

export async function translate(text, to) {
  return api('/api/translate', { text, to }, 20000);
}

export function toggleHelpful(id) {
  const s = me();
  s.helpful[id] = !s.helpful[id];
  save(s);
  return s.helpful[id];
}

export function distance(a1, o1, a2, o2) {
  const r = Math.PI / 180;
  const h = Math.sin(((a2 - a1) * r) / 2) ** 2 + Math.cos(a1 * r) * Math.cos(a2 * r) * Math.sin(((o2 - o1) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

# Crossfarm

Your field's 2040s climate already exists somewhere today. Crossfarm finds
where (climate analogues from TerraClimate and the CMIP6 ensemble), and puts
you in touch with the farmers who already farm it. Around that: satellite,
soil and climate data for your field and a crop screening. Team Wageningen, hackathon
prototype (11.10.2026). English UI, Europe (EU + Switzerland) first.
Live: https://crossfarm.pages.dev

## Design

Field-instrument look, deliberately away from AI-template defaults: one type
family (Archivo, wide cut for headings), cool map-paper neutrals, signal
orange from the team poster as the only accent, Phosphor icons, hairlines
instead of card shadows, dumbbells (today → 2040s) instead of progress bars.
Light and dark follow the system setting. No em or en dashes in UI copy.

## What it does

1. **Pick a farm**: one of five demo farms (NL, IT, ES, IE, CH, one per team
   country) or any point in Europe on a Sentinel-2 map / by search / GPS.
2. **Scan**: pulls real data for that point, live:
   - Sentinel-2 cloudless imagery (EOX, 10 m)
   - ISRIC SoilGrids 2.0: pH, texture, organic carbon (250 m)
   - Open-Meteo Climate API: CMIP6 HighResMIP EC-Earth3P-HR daily, 1991–2049
   - NASA GIBS MODIS NDVI, decoded per pixel from the tile colours
     (`site/data/ndvi-colormap.json`): last 24 months plus the farm's own peak
     month for every year since 2001
3. **Farm**: climate headline (+°C by the 2040s, summer rain, hot days, warming
   stripes), a short action plan, soil and greenness cards.
4. **Climate**: monthly temperature and rain, then vs. 2040s; NDVI history.
5. **Crops**: 17 crops scored 0–100 today vs. 2040s (season temperature over
   each crop's own active months, rain, pH, heat days, frost; ranges after
   FAO ECOCROP, `site/js/crops.js`). Family crop on top.
6. **Your future climate, today** (climate analogues): where in Europe and
   around the Mediterranean is today's climate what this field will have at
   +2 °C of global warming? Map, three regions, a side-by-side table, soil and
   daylength notes, and a cross-check against the app's own model. See
   "Climate analogues" below.
7. **Community**: Q&A sorted by climate distance by default (the poster's
   climate today against this field's future), or by km. Questions carry the
   asker's field data, every new question gets an instant data answer. Posts
   are shared through a small backend (Cloudflare D1), with a display name and
   the place rounded to 0.1°; no accounts. Seed threads are illustrative demo
   content (fictional people) and carry a "Demo, fictional" tag. Unsent posts
   wait on the device. Report button, hidden at three reports.
8. **Ask Crossfarm**: an assistant on every tab (NVIDIA Nemotron via Nebius
   Token Factory). It answers a question about this field with tools over the
   data the app already computed, and every number in the answer is checked
   against that data. See "Ask Crossfarm" below.
9. **Translate**: posts and answers in another language than the phone's get a
   Translate link, so a Dutch farmer can read an Andalusian one.
10. **Pilot**: sign-up for farmers, advisers and researchers, and a public
   counter of questions, farmer answers and sign-ups.

Baseline is 1991–2020, "2040s" is the 2035–2049 mean (model data ends 2049).
Open-Meteo bias-corrects every model to ERA5-Land by default (linear, monthly);
our requests do not switch that off, so the good match with station normals
(Gelderland: 10.3 °C / 807 mm vs. about 10.5 °C / 830 mm observed) is built in
and validates nothing about the change.

## Why the analogues (the problem this solves)

Research note: `docs/research/2026-10-14-real-problem.md`. In short: crop
suitability under future climate is already covered, with ensembles and at
1 km, by FAO GAEZ v5, and a Horizon Europe project (ClimAurea, 2026 to 2029)
is funded to bring it to field level. What no European tool does is the step
the climate-services literature keeps pointing at: farmers act on experience
from other farmers (Wood et al. 2014), and climate information is "useful but
not usable" without it (Lemos et al. 2012). Crossfarm connects a farmer to the
farmers who already work in that farmer's future climate. The analogue method
is established (Mahony et al. 2017; Fitzpatrick and Dunn 2019); using it to
route farmer-to-farmer questions has hardly been evaluated (Chaudhary et al.
2023, one pilot with extension staff). That is the testable claim.

## Climate analogues

- **Grid**: `scripts/analogues.py` bakes `site/data/analogue-grid.{json,bin}`
  (1.4 MB, 23 120 land cells at 0.25°, 30 to 72° N, 25° W to 45° E):
  TerraClimate v1.1 1991–2020 normals (block mean of the 1/24° grid), the
  TerraClimate +2 °C pseudo-climate (ensemble median change of CMIP6 models,
  six sample years, 0.5°), and SoilGrids topsoil pH, clay, sand via WCS.
  TerraClimate is http only, so it is baked, never fetched by the app.
- **Match** (`site/js/analogues.js`): twelve seasonal variables (Tmax, Tmin,
  rain for DJF, MAM, JJA, SON). The field's future = its cell today + the
  +2 °C change. Distances are scaled by the field's own year-to-year
  variability (the model's 1992–2020 seasons at the exact point), rotated to
  principal components (each kept PC explains at least 2 %), Mahalanobis
  distance, then chi percentile to sigma (Mahony et al. 2017). Under 2σ close,
  over 4σ novel. A single ordinary year sits about 0.7σ from its own mean, so
  many matches come out near 0σ; the table shows the real differences.
- **Cross-check**: the same search with the app's own model change (2036 to
  2049 vs. 1992 to 2020); the panel says how many regions both agree on. The
  Climate tab's "Second opinion" puts both changes side by side and flags
  opposite signs.
- **Soil filter**: if a close match with similar soil exists (pH within 0.8,
  clay within 12 points, sand within 20), only similar-soil cells are ranked.
- **Community**: a post is tagged "farms your future climate" when its place
  is under 2σ from this field's future *and* closer to it than the field
  itself is today.
- Check: `node scripts/analogue_check.mjs` (maths self-tests, regions and
  matching seed threads for the five demo farms).

## Ask Crossfarm

```
phone (static PWA)                      Cloudflare Pages Functions            Nebius Token Factory
  fieldContext(): the numbers   ──POST /api/ask──▶  agent.js: tool loop  ──▶  Nemotron (chat completions,
  the app shows, about 5 KB                         (max 4 rounds)       ◀──   OpenAI-compatible)
                                                    budget.js: spend guard
  answer + tools used + number check  ◀──────────   cache (D1): same question, no cost
```

- **Tools** (`functions/_lib/agent.js`): `get_climate`, `get_soil`,
  `get_greenness`, `get_crop_scores`, `get_future_climate_places`,
  `find_farmer_discussions`. They return parts of the field context the phone
  sent; the model cannot fetch anything else.
- **Number check**: every number in the answer must appear in a tool result
  (rounding allowed), otherwise the answer is shown with a warning.
- **Fallback**: when the assistant is off, over budget or unreachable, the app
  shows the answer computed from the field data and says so.
- **Translation** (`/api/translate`) uses the same client and the same guard.

### How Crossfarm uses Nemotron and Token Factory

Nemotron is called at runtime through Token Factory's OpenAI-compatible
endpoint (`AI_BASE_URL`, model `AI_MODEL`, default
`nvidia/nemotron-3-super-120b-a12b`) with function calling: the model decides
which of the six tools it needs, Crossfarm runs them on the field's data and
returns the results, and the model writes a short answer in the farmer's own
language. A second model setting (`AI_MODEL_FAST`) is used for translating
farmer posts. Token Factory made this possible without running any GPU
ourselves; the whole backend is a few plain JS files.

### Spend guard

The API key is tied to a payment method, so the guard is in the server code
(`functions/_lib/budget.js`) and fails closed:

| Setting | Default | Meaning |
|---|---|---|
| `AI_ENABLED` | `0` | Nothing is ever called unless this is exactly `1` |
| `NEBIUS_API_KEY` | (secret) | No key, no call |
| `IP_SALT` | (secret) | Without it every write and question is refused (503) |
| `AI_TOKENS_TOTAL` | 1,500,000 | Hard total across all time; reached means off |
| `AI_TOKENS_DAY` | 250,000 | Per UTC day, everyone together |
| `AI_TOKENS_IP_DAY` | 60,000 | Per person per day |
| `AI_CALLS_IP_DAY` | 40 | Model calls per person per day (a question takes up to 4) |
| `AI_QUESTION_MS` | 40,000 | No new model round after this long |
| `AI_MAX_TOKENS` | 600 | Longest answer |

An unreadable cap counts as 0, not as unlimited. Each call reserves its estimate
with one conditional update per counter ("only if still under the cap"), so
parallel requests cannot overshoot, and settles to the provider's reported
usage afterwards. A call refused by the provider up front (400, 401, 403, 404,
422, 429) is released; a timeout, a 5xx or an unreadable reply stays booked,
because it may have been billed. A question that could not finish within the
remaining budget is refused before the first call. Identical prompts come from
the D1 cache at no cost (kept 90 days); mock replies (`AI_MOCK=1`, local only)
are never cached.

**Stop it now.** Counters are read on every call, so this works without a
deploy:
`npx wrangler d1 execute crossfarm --remote --command "UPDATE usage SET tokens = 999999999 WHERE k = 'total'"`.
Variable and secret changes only apply with the next deploy. The final stop
is revoking the key in the Nebius console; set a spending limit there too if
the console offers one, because it is the only cap outside this code.
Usage so far:
`npx wrangler d1 execute crossfarm --remote --command "SELECT * FROM usage WHERE k = 'total' OR k LIKE 'day:%'"`.

## API

| Method and path | Body | Returns |
|---|---|---|
| `GET /api/threads` | | newest 200 visible threads with answers |
| `POST /api/threads` | `who, place, lat, lon, crop, q, body, context, lang, routed` | `{id, token}` |
| `POST /api/replies` | `thread, who, place, role, text, lang` | `{id, token}` |
| `POST /api/report` | `kind: thread or reply, target` | `{ok}`; hidden at 3 reports |
| `POST /api/pilot` | `role, region, contact, note, consent: true` | `{ok}`; contact never returned |
| `GET /api/stats` | | `{questions, answers, routed, pilot}` |
| `POST /api/ask` | `question, field` | `{answer, used, numbers}` or `{paused}` |
| `POST /api/translate` | `text, to` | `{text}` or `{paused}` |

Writes are limited to 20 per person per day (salted hash of the IP, never the
IP itself). The Crossfarm data answer can only be posted by the asker's device (it holds the
thread's edit token), once per thread; nobody else can use the name.

Moderation (a post hides itself at three reports from different people):

```
npx wrangler d1 execute crossfarm --remote --command "SELECT kind, target, COUNT(*) AS n FROM reports GROUP BY kind, target ORDER BY n DESC"
npx wrangler d1 execute crossfarm --remote --command "SELECT id, who, q FROM threads WHERE hidden = 1"
npx wrangler d1 execute crossfarm --remote --command "UPDATE threads SET hidden = 0 WHERE id = '...'"
```

## Layout

```
site/                    everything that gets deployed
  index.html             app shell: onboarding, picker, scan, four tabs, sheet
  phone.html             desktop view: the app in a 390 x 844 phone frame
  js/app.js              screens, rendering, scan flow, boot (?farm=, ?tab=)
  js/engine.js           climate/soil/NDVI summaries, crop scoring, action plan
  js/crops.js            17 crops: active months, temperature, rain, pH, heat, frost
  js/api.js              Open-Meteo, SoilGrids, GIBS NDVI, geocoding, localStorage cache
  js/community.js        seed threads, own posts (localStorage cf:community)
  js/analogues.js        climate analogues: grid loader, sigma dissimilarity, regions
  data/analogue-grid.*   baked TerraClimate + SoilGrids grid (scripts/analogues.py)
  css/app.css            design tokens (light + dark) and all styles
  data/farms.json        the five demo farms
  data/farms/<id>.json   climate + soil snapshots from scripts/prefetch.py
  data/ndvi-colormap.json  GIBS NDVI palette, RGB to value
  js/net.js              calls to /api
  sw.js                  offline cache, bump VERSION per deploy (never caches /api)
functions/api/*.js       threads, replies, report, pilot, stats, ask, translate
functions/_lib/          http helpers, spend guard (budget.js), model client (ai.js), agent
schema.sql               D1 tables
wrangler.toml            Pages config, D1 binding, assistant caps
scripts/prefetch.py      refresh demo farm snapshots
scripts/analogues.py     bake the analogue grid (downloads ~100 MB once, cached in scripts/.cache)
scripts/analogue_check.mjs  headless check of the analogue maths and demo results
scripts/verify.py        Playwright click-through + screenshots
scripts/verify_custom.py live path: one custom field through scan and community
scripts/api_check.mjs    API checks against a local server (mock model)
scripts/ai_check.mjs     spend guard and number check, offline
docs/research/           research notes (why the analogues, validation)
scripts/hub_image.py     card image for the hackathon hub
dev.cmd                  local server + phone frame
```

## Development

Plain files in `site/`, no build step, ES modules.

Local: double-click `dev.cmd`. It serves the repo on http://127.0.0.1:8771/
and opens the app in a phone frame (390 × 844, `site/phone.html`) that reloads
on save. "reset demo" under the frame clears the chosen farm and own posts.
Deep links: `site/?frame=0&farm=foggia&tab=crops`.

Backend locally (app plus API, local D1, mock model, no cost): create
`.dev.vars` with `AI_MOCK=1` and `AI_ENABLED=1`, then run `scripts\api_dev.cmd`
(serves on http://127.0.0.1:8788/). Checks:

```
node scripts/ai_check.mjs
node scripts/api_check.mjs
node scripts/fix_check.mjs
```

Click-through test with screenshots to `docs/screens/`:

```
python scripts\verify.py [base-url] [farm-id] [light|dark]
```

Demo farm snapshots (so the pitch never waits on rate limits):

```
python scripts\prefetch.py            # all farms in site/data/farms.json
python scripts\prefetch.py foggia     # one farm
```

### Rate limits

Open-Meteo weighs a request as (variables / 10) × (days / 14) against 600 per
minute, 5000 per hour, 10 000 per day. One live farm costs about 460, so about
one new location per minute and ten per hour. Results are cached in
localStorage; on a 429 the scan screen counts down 60 s and retries once.
SoilGrids allows 5 requests per minute.

## Not yet

- Accounts (posts carry a display name only)
- Field boundaries and per-parcel Sentinel-2 NDVI (needs a Copernicus account)
- Irrigation scenarios, market prices
- Crop scores from more than one climate model (the analogues already use the
  CMIP6 ensemble median; the scores still use EC-Earth3P-HR alone)
- An evaluation with real farmers: do analogue-routed questions get more
  useful answers than nearest-neighbour ones? The pilot sign-up is the start.

## Licence and data

Code: GNU AGPL-3.0 (`LICENSE`), copyright Leandro Catarci and the Crossfarm
hackathon team. Anyone may use, change and share it; whoever runs a modified
version as an online service must offer its full source under the same
licence. For other terms, ask. The name Crossfarm is not licensed. Data keep
their own terms: TerraClimate (Abatzoglou et
al. 2018), ISRIC SoilGrids (CC BY 4.0), Open-Meteo, NASA GIBS, and the
Sentinel-2 cloudless mosaic by EOX (CC BY-NC-SA 4.0: non-commercial; a
commercial service needs a licence from EOX or another basemap).

## Deploy

Cloudflare Pages, project `crossfarm`, serving `site/`. Bump `VERSION` in
`site/sw.js` before every deploy, otherwise installed phones keep the old cache.

```
npx wrangler pages deploy site --project-name crossfarm --branch main --commit-dirty=true
```

Run it from the repo root so `functions/` is deployed with the site. Once, before
the first v4 deploy:

```
npx wrangler d1 create crossfarm                       # paste the id into wrangler.toml
npx wrangler d1 execute crossfarm --remote --file schema.sql
npx wrangler pages secret put IP_SALT --project-name crossfarm         # any long random string
npx wrangler pages secret put NEBIUS_API_KEY --project-name crossfarm  # only when the assistant should run
```

The assistant stays off until `AI_ENABLED = "1"` in `wrangler.toml` and a
redeploy.

The card on https://wageningen-hackathon.pages.dev uses a three-phone image
rendered from the light screenshots: run `scripts\verify.py`, then
`scripts\hub_image.py <hub>\public\images\crossfarm.jpg` (same Python).

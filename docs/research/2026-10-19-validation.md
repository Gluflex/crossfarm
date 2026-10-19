# Does the analogue method work? A back-test against observed climate

19.10.2026. Scripts: `scripts/validate.py` (inputs), `scripts/validate.mjs` (the test),
`scripts/bastin_table.py` and `scripts/bastin_geocode.py` (published analogues).
Result file: `site/data/validation.json` (14 KB).

## Short answer

Checked against the past, the app's predicted direction of change matches the direction
climate has already moved for about 6 in 10 places in Europe (62 % of 913 places;
a random direction would match 25 %). A plain "same warming everywhere" prediction
matches almost as often (58 %). So the test shows that the method points the way
warming has been moving. It does **not** show that the app's CMIP6 pattern or its
exact places are better than that simple guess, and it does not test any farming
advice. Single farm results are noisy. Only the share over many places means
anything.

Compared with a published study (Bastin et al. 2019, 2050 city analogues), the
app's analogue is closer to the published analogue city than the city itself is in
40 of 50 European cities. The median gap is 630 km, against 877 km from the city to
its published analogue. The two use different methods and scenarios, so this is
agreement, not proof.

## What was tested

**1. Observed-shift back-test (main test).**

- "Past": TerraClimate v1.1 monthly normals 1961 to 1990
  (`climatology/TerraClimate_19611990_{tmax,tmin,ppt}.nc`). "Today": the 1991 to 2020
  normals already baked into `site/data/analogue-grid.bin`. Both use the same
  sampling (every second 1/24° pixel, block mean to 0.25°) and the same twelve
  seasonal values (Tmax, Tmin, rain for DJF, MAM, JJA, SON).
- **Observed shift**: for each place, find the cell whose 1961 to 1990 climate is
  closest to the place's observed 1991 to 2020 climate. The line from the place to
  that cell is where its present climate "came from" over 30 years of real change.
- **Predicted shift**: the app's own search: the cell whose climate today is closest
  to the place at +2 °C (TerraClimate +2 °C pseudo-climate, CMIP6 ensemble median
  change).
- **Agreement**: the two bearings differ by less than 45 degrees. Shifts under 50 km
  are left out (no meaningful direction on a 0.25° grid).
- Both searches use the app's code unchanged (`site/js/analogues.js`: `variability`,
  `sigma`, `cellAt`, `km`). The search loop is the same Mahalanobis distance kept as
  squared distance for speed; reported sigma values come from `sigma()` itself. Climate
  only, no soil filter.
- Variability (the sigma scale): the five demo farms use exactly the variability the
  app builds (the model's 1992 to 2020 daily series at the farm). The grid sample uses
  the year-to-year variability of TerraClimate 1991 to 2020 (monthly files, one native
  pixel per 1° block), because no daily series is baked for every cell.
- **Sample**: one cell per degree (every fourth 0.25° row and column) across Europe,
  1109 cells. A rough box mask drops North Africa, the Levant, Anatolia, the Caucasus
  and Greenland; Cyprus, Turkish Thrace and European Russia stay in.
- **Baselines**, to see how much agreement is built in:
  - random direction: 25 % by construction (a 90 degree window out of 360)
  - always due south
  - uniform warming: the place's own average +2 °C temperature change added to all
    eight temperature values, rain unchanged, then the same search
- **Robustness**: (a) past search scaled by the 1961 to 1990 variability instead;
  (b) direction of the mean position of the 10 best cells instead of the single best.

**2. Published-analogue comparison (secondary).** Bastin et al. 2019 S2 Table (PLOS ONE
supplement, official journal file) lists, for 520 cities, the three cities whose
climate today is most similar to that city's 2050 climate (RCP4.5, three CMIP5
models, 19 WorldClim bioclimatic variables, Euclidean distance on four principal
components). The table has names only; coordinates come from Open-Meteo geocoding
(GeoNames, most populous match). 13 names were set by hand where that rule picks
the wrong place or finds nothing (for example Kiev, San Marino, Stanley). For European cities inside
the app's map (30 to 72° N, 25° W to 45° E) we compute the app's +2 °C analogue
(climate only, TerraClimate variability) and measure the distance to the published
first analogue city.

## Results

### Grid sample (1109 cells, 913 with a shift over 50 km in both searches)

| Measure | Value |
|---|---|
| App direction matches observed direction | **62 %** |
| Same, past search with 1961 to 1990 variability | 61 % |
| Same, mean position of the 10 best cells | 72 % |
| Baseline: random direction | 25 % |
| Baseline: always due south | 45 % |
| Baseline: uniform warming, best cell | 58 % |
| Baseline: uniform warming, 10 best cells | 67 % |
| Agreement by latitude: 34 to 45 N / 45 to 55 N / 55 to 72 N | 62 % / 62 % / 62 % |
| Cells whose past match is under 50 km away (left out) | 163 |
| Median observed shift (1961 to 1990 to 1991 to 2020) | 173 km |
| Median predicted shift (1991 to 2020 to +2 °C) | 342 km |
| Median ratio predicted / observed | 1.6 |
| Median sigma: place today vs. its own 1961 to 1990 climate | 0.12 σ |

The predicted shift is about 1.6 times the observed one. That has the expected sign:
the step from today to +2 °C of global warming is larger than the step already
observed since 1961 to 1990. This is a consistency check, not a test.

### Demo farms (app's own variability; climate only, no soil filter)

| Farm | Past match (climate of 1991 to 2020 found in 1961 to 1990) | Predicted +2 °C match | Bearing gap | Agree | Own past | App shows (soil filter on) | With TerraClimate variability |
|---|---|---|---|---|---|---|---|
| Gelderland | Charmont, Grand-Est, FR: 352 km south, 0.03 σ | Hallignicourt, Grand-Est, FR: 379 km south | 0° | yes | 0.43 σ | 105 km southwest | past 379 km S, predicted 105 km SSW: yes |
| Foggia | Kassandra, Central Macedonia, GR: 672 km east, 0.09 σ | Bargou, Siliana, TN: 790 km southwest | 122° | no | 1.01 σ | 814 km southwest | past 27 km: no direction |
| Cordoba | Bargou, Siliana, TN: 1307 km east, 0.02 σ | Tiberkanine, Ain Defla, DZ: 613 km east | 12° | yes | 0.37 σ | 613 km east | past 655 km S, predicted 590 km S: yes |
| Tipperary | Kilrush, Munster, IE: 121 km west, 0.08 σ | Llangadog, Wales, UK: 279 km east | 176° | no | 0.08 σ | 279 km east | past 12 km: no direction |
| Seeland | Friesenheim, Baden-Württemberg, DE: 162 km north, 0.00 σ | Banja Luka, BA: 806 km east | 84° | no | 0.90 σ | 806 km east | same as left: no |

"Own past" is how far the farm's own 1961 to 1990 climate is from its 1991 to 2020
climate. Every value is far below 2 σ: in sigma terms the observed change at each farm
is smaller than ordinary year-to-year swings. So the past match is the best of many
close matches and moves easily. For Foggia, Cordoba and Tipperary it moves by hundreds
of km when only the variability source changes. Do not show a single farm's back-test
as evidence. Tipperary has almost no observed shift (0.08 σ); Seeland's present
climate was found to the north, in the Upper Rhine plain, which in 1961 to 1990 was
warmer than the Swiss plateau.

### Published analogues (Bastin et al. 2019)

| Measure | Value |
|---|---|
| European cities in the S2 Table inside the app's map | 79 |
| Of those, published first analogue outside the map (e.g. Canberra, Dallas, Melbourne) | 29 |
| Cities compared | 50 |
| Median distance, app analogue to published analogue city | **630 km** |
| Median distance, city to its published analogue (baseline "stay home") | 877 km |
| App analogue closer to the published city than the city itself | 40 of 50 |
| App direction within 45° of the published direction | 29 of 50 (58 %) |

Close agreement: Istanbul (app analogue 10 km from Rome, the published one), Sofia
(45 km from Skopje), Belfast (49 km from Cardiff), Amsterdam, Rotterdam, The Hague
(towards Paris, 269 km short). Poor agreement: Adana, Andorra, Bern, Bursa, Dnipro,
Kharkiv, Munich, Zurich (the app finds a closer or differently placed match than the
published city). For London, Paris, Berlin and 26 others the published analogue lies
outside Europe and cannot be compared. Per-city rows are in `validation.json`
(`publishedCities`).

## Limits (must travel with the numbers)

- It tests **direction consistency with observed change**, not whether the predicted
  place is right, and not whether any farming advice is right.
- **Warming explains most of the agreement.** The uniform-warming baseline scores 58 %
  against the app's 62 % (67 % against 72 % with the 10 best cells). The test does not
  show that the CMIP6 pattern of change, or the rain changes, add much.
- **Single places are noisy.** Half the sampled cells are within 0.12 σ of their own
  1961 to 1990 climate, so
  the past match is one of many near-equal cells. Only aggregate shares mean anything.
- **No error bars.** Neighbouring cells share weather, so the 913 cells are not
  913 independent tests. A spatial block bootstrap was not done.
- **Not fully independent data.** Both TerraClimate periods are built on the same
  WorldClim spatial pattern. Their differences come from reanalysis (ERA5 in v1.1),
  which has fewer observations before 1979. No station records were used.
- **The +2 °C climate has not happened.** The back-test checks that the method behaves
  sensibly on a real 30-year change about half the size; it cannot verify the
  future.
- **The published comparison** uses another method, another scenario (RCP4.5, 2050,
  CMIP5) and other variables, and only covers cities whose analogue lies in the app's
  map. That favours cases with a European analogue. Geocoding by city name can pick
  the wrong place; obvious errors were fixed by hand, others may remain.
- Not tested: the soil filter, the app's "model" cross-check (the second opinion from
  the app's own climate model), the region picking (the 250 km spacing), and North
  Africa or the Middle East as focal places.

## Suggested wording for the app (next to the result)

> Checked against the past: for 913 places across Europe, the direction this method
> predicts matches the direction climate really moved between 1961 to 1990 and
> 1991 to 2020 in 62 % of cases (a random guess: 25 %). A simple "same warming
> everywhere" guess scores 58 %, so this confirms the general direction, not the exact
> place. It does not test farming advice.

Do not show the per-farm back-test as proof for that farm (see "Single places are
noisy").

## How to rerun

```
python scripts/validate.py              # once: about 370 OPeNDAP requests, about 45 min, cached in scripts/.cache
python -I scripts/bastin_table.py       # once: S2 Table from the PLOS supplement
python -I scripts/bastin_geocode.py     # once: city coordinates (Open-Meteo geocoding)
node scripts/validate.mjs               # seconds; writes site/data/validation.json
```

`validate.py` needs numpy (the system Python has it; the GearRadar venv does not).
The TerraClimate server drops connections now and then; `fetch()` in
`analogues.py` retries.

## Sources

- Abatzoglou, J.T., Dobrowski, S.Z., Parks, S.A., Hegewisch, K.C. 2018. TerraClimate,
  a high-resolution global dataset of monthly climate and climatic water balance from
  1958-2015. Scientific Data 5, 170191. https://doi.org/10.1038/sdata.2017.191
- Abatzoglou, J.T., Hegewisch, K.C., Yin, C., Kalashinkov, D.A. 2026. TerraClimate
  v1.1, an updated global climate and climatic water balance dataset with climate
  scenarios. Scientific Data. (Reference as given in the v1.1 file metadata; DOI not
  checked.)
- TerraClimate v1.1 files used: THREDDS catalogue
  http://thredds.northwestknowledge.net:8080/thredds/catalog/TERRACLIMATE_ALL/catalog.html
  (`climatology/TerraClimate_19611990_*.nc`, `climatology/TerraClimate_19912020_*.nc`,
  `data/TerraClimate_{tmax,tmin,ppt}_{1960..2020}.nc`, `data_plus2C/`)
- Mahony, C.R., Cannon, A.J., Wang, T., Aitken, S.N. 2017. A closer look at novel
  climates: new methods and insights at continental to landscape scales. Global Change
  Biology 23, 3934-3955. https://doi.org/10.1111/gcb.13645
- Fitzpatrick, M.C., Dunn, R.R. 2019. Contemporary climatic analogs for 540 North
  American urban areas in the late 21st century. Nature Communications 10, 614.
  https://doi.org/10.1038/s41467-019-08540-3
- Bastin, J.-F. et al. 2019. Understanding climate change from a global analysis of
  city analogues. PLOS ONE 14(7): e0217592.
  https://doi.org/10.1371/journal.pone.0217592 ; S2 Table:
  https://doi.org/10.1371/journal.pone.0217592.s002
- Open-Meteo geocoding API (GeoNames): https://open-meteo.com/en/docs/geocoding-api
- BigDataCloud reverse geocoding (place names for the demo farm matches):
  https://www.bigdatacloud.com/free-api/free-reverse-geocode-to-city-api

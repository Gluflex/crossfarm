// Crop suitability envelopes, simplified from FAO ECOCROP ranges for European conditions.
// Ranges are [absMin, optMin, optMax, absMax]:
//   t    mean temperature over the crop's active months (°C)
//   rain annual precipitation (mm), rain-fed
//   ph   topsoil pH (H2O); limes and acids are correctable, so pH weighs lightly
// months: active growth months (winter crops: spring regrowth to harvest)
// heat: [days with Tmax > 35 °C in those months tolerated, days at which the crop fails]
// frost: perennials only, coldest tolerated winter night (°C)
const SPRING = [3, 4, 5, 6], SUMMER = [5, 6, 7, 8, 9], ALL = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

export const CROPS = [
  { id: 'wheat', name: 'Winter wheat', group: 'Cereal', months: SPRING,
    t: [6, 9.5, 16, 21.5], rain: [250, 400, 1150, 1800], ph: [5.2, 6, 7.5, 8.5], heat: [2, 18],
    tip: 'Earlier-maturing varieties escape the June heat that now hits grain fill.' },
  { id: 'durum', name: 'Durum wheat', group: 'Cereal', months: SPRING,
    t: [8, 11, 17, 21.5], rain: [220, 350, 800, 1300], ph: [5.8, 6.5, 8, 8.7], heat: [3, 22],
    tip: 'Sow two weeks earlier and keep stubble mulch to hold winter moisture.' },
  { id: 'barley', name: 'Barley', group: 'Cereal', months: SPRING,
    t: [5, 9, 16.5, 22], rain: [220, 350, 1050, 1700], ph: [5.5, 6, 8, 8.8], heat: [3, 20],
    tip: 'Ripens a week or two before wheat, often just ahead of the first heatwave.' },
  { id: 'rapeseed', name: 'Rapeseed', group: 'Oilseed', months: SPRING,
    t: [6, 9, 14, 18.5], rain: [350, 500, 1150, 1800], ph: [5.5, 6, 7.5, 8.3], heat: [1, 12],
    tip: 'Dry Augusts make establishment the bottleneck: sow into moisture.' },
  { id: 'lentil', name: 'Lentil', group: 'Legume', months: SPRING,
    t: [7, 10, 16, 21], rain: [220, 300, 750, 1200], ph: [5.5, 6, 8, 8.5], heat: [2, 15],
    tip: 'Short-season pulse for dry plains; follows cereals well in rotation.' },
  { id: 'chickpea', name: 'Chickpea', group: 'Legume', months: SPRING,
    t: [9, 13, 19, 23], rain: [220, 300, 750, 1200], ph: [5.8, 6, 8, 8.8], heat: [5, 30],
    tip: 'High-value pulse with strong EU protein demand; hates wet feet.' },
  { id: 'maize', name: 'Grain maize', group: 'Cereal', months: SUMMER,
    t: [13, 17, 23, 27], rain: [400, 600, 1250, 1900], ph: [5.2, 5.8, 7.5, 8.5], heat: [8, 45],
    tip: 'Thirsty in July: only worth it where summer rain or irrigation is reliable.' },
  { id: 'sorghum', name: 'Sorghum', group: 'Cereal', months: SUMMER,
    t: [16, 20, 27, 32], rain: [250, 400, 900, 1500], ph: [5, 5.5, 8, 8.8], heat: [40, 120],
    tip: 'Uses about a third less water than maize; grain and silage markets are growing.' },
  { id: 'millet', name: 'Proso millet', group: 'Cereal', months: [5, 6, 7, 8],
    t: [14, 18, 25, 30], rain: [200, 300, 750, 1200], ph: [5, 5.5, 7.8, 8.5], heat: [30, 90],
    tip: 'Fast 70-90 day crop; useful as a catch crop after a failed spring.' },
  { id: 'sunflower', name: 'Sunflower', group: 'Oilseed', months: [4, 5, 6, 7, 8],
    t: [14, 17, 23, 27], rain: [280, 400, 900, 1500], ph: [5.7, 6, 7.5, 8.3], heat: [25, 80],
    tip: 'Deep taproot reaches water other crops cannot: a classic drought hedge.' },
  { id: 'soybean', name: 'Soybean', group: 'Legume', months: SUMMER,
    t: [15, 18, 23, 27], rain: [400, 550, 1100, 1700], ph: [5.5, 6, 7, 7.8], heat: [8, 40],
    tip: 'Fixes its own nitrogen. Inoculate seed where soy has never grown.' },
  { id: 'potato', name: 'Potato', group: 'Tuber', months: [4, 5, 6, 7, 8],
    t: [10, 13.5, 18, 22], rain: [400, 550, 1250, 1900], ph: [4.5, 5, 6.5, 7.5], heat: [2, 15],
    tip: 'Tuber set stops above ~29 °C soil temperature: plant earlier, ridge higher.' },
  { id: 'sugarbeet', name: 'Sugar beet', group: 'Root', months: [4, 5, 6, 7, 8, 9],
    t: [11, 14, 19, 23], rain: [400, 550, 1150, 1800], ph: [6, 6.5, 8, 8.5], heat: [3, 25],
    tip: 'Drought in August costs sugar yield; deep loosening helps rooting.' },
  { id: 'grass', name: 'Grassland', group: 'Forage', months: [3, 4, 5, 6, 7, 8, 9, 10],
    t: [7, 10, 16, 20], rain: [450, 700, 1300, 2200], ph: [4.8, 5.5, 7, 8], heat: [5, 30],
    tip: 'Deep-rooting herbs (chicory, plantain) keep swards green through dry spells.' },
  { id: 'grape', name: 'Grapevine', group: 'Perennial', months: [4, 5, 6, 7, 8, 9, 10],
    t: [12, 14.5, 21, 25], rain: [300, 450, 1000, 1600], ph: [5, 5.5, 8, 8.7], heat: [20, 70], frost: -18,
    tip: 'New sites open up northward; heat-tolerant varieties keep the south viable.' },
  { id: 'olive', name: 'Olive', group: 'Perennial', months: ALL,
    t: [12.5, 15, 19.5, 22], rain: [200, 350, 800, 1300], ph: [5.5, 6.5, 8.2, 8.8], heat: [60, 150], frost: -9,
    tip: 'Frost below −9 °C kills young trees: check the coldest night, not the average.' },
  { id: 'almond', name: 'Almond', group: 'Perennial', months: ALL,
    t: [13, 15.5, 20, 23], rain: [200, 300, 700, 1100], ph: [6, 6.5, 8.2, 8.8], heat: [50, 140], frost: -12,
    tip: 'Late-blooming varieties dodge the spring frosts that kill the harvest.' },
];

export const cropById = (id) => CROPS.find((c) => c.id === id);

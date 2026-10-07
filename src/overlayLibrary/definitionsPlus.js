/**
 * Overlay Library, second wave. Registered from ./definitions.js with that
 * module's builders, so every entry has the same shape as the first wave:
 *
 *  - more NASA GIBS layers (hazard risk, GOES/Himawari bands, TEMPO, OCO-2,
 *    currents, salinity, canopy height, settlements …), every name checked
 *    against the live GIBS capabilities document;
 *  - weather radar (NEXRAD via IEM, global RainViewer), Global Forest Watch,
 *    GBIF biodiversity density;
 *  - keyed rasters relayed by /api/overlay-tile (OpenWeatherMap, WAQI,
 *    OpenAIP, Thunderforest) — `requiresKey` lets the panel say "needs key";
 *  - live feeds: Amtrak, Baltic AIS, EMSC/GeoNet/USGS quakes, SPC storm
 *    reports, CNEOS fireballs, IODA outages, PeeringDB, CityBikes,
 *    iNaturalist, Windy webcams;
 *  - World Statistics: one World Bank choropleth per indicator.
 */
import {
  WORLD_INDICATORS,
  indicatorRamp,
  worldFeedId,
} from './worldIndicators.js';

const MIN = 60_000;
const SIXTHS = ['Lowest sixth', '2nd', '3rd', '4th', '5th', 'Highest sixth'];

export function addPlusDefinitions({
  add,
  gibs,
  tiles,
  feed,
  quakeStyle,
  quakeInfo,
}) {
  // ═══ NASA GIBS, second wave ════════════════════════════════════════════
  const G = (id, name, category, layer, description, opts) =>
    gibs(id, name, category, layer, description, opts);

  // Hazards
  G(
    'flood-modis-2day',
    'Flood Detection · MODIS 2-day',
    'hazards',
    'MODIS_Combined_Flood_2-Day',
    'Surface water beyond normal extent detected by MODIS over the last two days (NASA LANCE near-real-time flood product).',
  );
  G(
    'flood-viirs-2day',
    'Flood Detection · VIIRS 2-day',
    'hazards',
    'VIIRS_Combined_Flood_2-Day',
    'Near-real-time flood water from VIIRS (NOAA-20/Suomi NPP), composited over two days to see through cloud gaps.',
  );
  G(
    'goes-east-firetemp',
    'Fire Temperature RGB · GOES-East',
    'hazards',
    'GOES-East_ABI_FireTemp',
    'GOES-East fire-temperature RGB: hot active fires glow yellow-white, cooler burns red. Updates every 10 minutes over the Americas.',
    { time: 'default', maxLevel: 7 },
  );
  G(
    'goes-west-firetemp',
    'Fire Temperature RGB · GOES-West',
    'hazards',
    'GOES-West_ABI_FireTemp',
    'GOES-West fire-temperature RGB over the eastern Pacific, western Americas and Hawaii.',
    { maxLevel: 7 },
  );
  G(
    'pyrocb',
    'Fire-Storm Smoke (PyroCb)',
    'hazards',
    'OMPS_Aerosol_Index_PyroCumuloNimbus',
    'OMPS aerosol index tuned for pyrocumulonimbus — smoke injected high into the atmosphere by extreme wildfires.',
  );
  const NDH = [
    ['cyclone', 'Cyclone', '1980-2000'],
    ['drought', 'Drought', '1980-2000'],
    ['flood', 'Flood', '1985-2003'],
    ['volcano', 'Volcano', '1979-2000'],
  ];
  for (const [id, name, years] of NDH) {
    G(
      `ndh-${id}-hazard`,
      `${name} Hazard Frequency`,
      'hazards',
      `NDH_${name}_Hazard_Frequency_Distribution_${years}`,
      `How often ${name.toLowerCase()} hazards struck each place, ${years.replace('-', '–')} (Columbia CIESIN / World Bank Natural Disaster Hotspots via NASA SEDAC).`,
      { alpha: 0.7 },
    );
    G(
      `ndh-${id}-mortality`,
      `${name} Mortality Risk`,
      'hazards',
      `NDH_${name}_Mortality_Risks_Distribution_2000`,
      `Relative risk of ${name.toLowerCase()}-related deaths, by grid cell (Natural Disaster Hotspots, NASA SEDAC).`,
      { alpha: 0.7 },
    );
    G(
      `ndh-${id}-economic`,
      `${name} Economic Loss Risk`,
      'hazards',
      `NDH_${name}_Proportional_Economic_Loss_Risk_Deciles_2000`,
      `Deciles of ${name.toLowerCase()} economic-loss risk relative to local GDP (Natural Disaster Hotspots, NASA SEDAC).`,
      { alpha: 0.7 },
    );
  }
  G(
    'ndh-landslide-hazard',
    'Landslide Hazard',
    'hazards',
    'NDH_Landslide_Hazard_Distribution_2000',
    'Landslide hazard by grid cell from slope, soils, precipitation and seismicity (Natural Disaster Hotspots, NASA SEDAC).',
    { alpha: 0.7 },
  );

  // Weather
  G(
    'goes-west-airmass',
    'Air Mass RGB · GOES-West',
    'weather',
    'GOES-West_ABI_Air_Mass',
    'GOES-West air-mass RGB: jet streams, dry intrusions and storm development over the Pacific.',
    { maxLevel: 7 },
  );
  G(
    'himawari-airmass',
    'Air Mass RGB · Himawari',
    'weather',
    'Himawari_AHI_Air_Mass',
    'Himawari air-mass RGB over Asia and the western Pacific.',
    { maxLevel: 7 },
  );
  G(
    'goes-east-visible',
    'Visible 1 km · GOES-East',
    'weather',
    'GOES-East_ABI_Band2_Red_Visible_1km',
    'GOES-East red visible band at 1 km — the sharpest daytime cloud view over the Americas.',
    { maxLevel: 8 },
  );
  G(
    'goes-west-visible',
    'Visible 1 km · GOES-West',
    'weather',
    'GOES-West_ABI_Band2_Red_Visible_1km',
    'GOES-West red visible band at 1 km over the eastern Pacific.',
    { maxLevel: 8 },
  );
  G(
    'himawari-visible',
    'Visible 1 km · Himawari',
    'weather',
    'Himawari_AHI_Band3_Red_Visible_1km',
    'Himawari red visible band at 1 km over Asia–Pacific.',
    { maxLevel: 8 },
  );
  G(
    'goes-west-ir',
    'Infrared · GOES-West',
    'weather',
    'GOES-West_ABI_Band13_Clean_Infrared',
    'GOES-West clean longwave infrared (band 13): cloud-top temperature day and night.',
    { maxLevel: 7 },
  );
  G(
    'airs-precip',
    'Precipitation Estimate (AIRS)',
    'weather',
    'AIRS_Precipitation_Day',
    'Daily precipitation estimate from the AIRS sounder on Aqua.',
  );
  G(
    'gmi-precip',
    'Precipitation Rate (GPM GMI)',
    'weather',
    'GMI_Precipitation_Rate_Asc',
    'Instantaneous rain rate along GPM Microwave Imager swaths — sees rain under cloud tops.',
  );
  G(
    'cloud-top-height',
    'Cloud Top Height',
    'weather',
    'MODIS_Terra_Cloud_Top_Height_Day',
    'Height of cloud tops from MODIS Terra — tall convective towers stand out.',
  );
  G(
    'airs-air-temp-day',
    'Surface Air Temperature · Day',
    'weather',
    'AIRS_L3_Surface_Air_Temperature_Daily_Day',
    'Daily near-surface air temperature from AIRS daytime overpasses.',
  );
  G(
    'airs-air-temp-night',
    'Surface Air Temperature · Night',
    'weather',
    'AIRS_L3_Surface_Air_Temperature_Daily_Night',
    'Daily near-surface air temperature from AIRS night-time overpasses.',
  );
  G(
    'cygnss-wind',
    'Ocean Wind Speed (CYGNSS)',
    'weather',
    'CYGNSS_L3_Wind_Speed_Daily',
    'Daily ocean-surface wind speed from the CYGNSS constellation, which can see inside hurricanes.',
  );
  G(
    'amsr2-wind',
    'Ocean Wind Speed (AMSR2)',
    'weather',
    'AMSRU2_Wind_Speed_Day',
    'Ocean-surface wind speed from the AMSR2 microwave radiometer.',
  );
  G(
    'lightning-climatology',
    'Lightning Flash Rate (climatology)',
    'weather',
    'LIS_Very_High_Resolution_Lightning_Full_Climatology_LIS_Mean_Flash_Rate',
    'Long-term mean lightning flash rate from the space-borne Lightning Imaging Sensor — the planet’s thunderstorm hotspots.',
  );

  // Atmosphere
  G(
    'goes-east-dust',
    'Dust RGB · GOES-East',
    'atmosphere',
    'GOES-East_ABI_Dust',
    'GOES-East dust RGB: airborne dust glows magenta-pink, e.g. Saharan plumes crossing the Atlantic.',
    { maxLevel: 7 },
  );
  G(
    'goes-west-dust',
    'Dust RGB · GOES-West',
    'atmosphere',
    'GOES-West_ABI_Dust',
    'GOES-West dust RGB over the western Americas and Pacific.',
    { maxLevel: 7 },
  );
  G(
    'tempo-no2',
    'NO₂ Hourly · North America (TEMPO)',
    'atmosphere',
    'TEMPO_L3_NO2_Vertical_Column_Troposphere',
    'Hourly tropospheric nitrogen dioxide over North America from the geostationary TEMPO instrument — traffic and power-plant pollution.',
  );
  G(
    'tempo-formaldehyde',
    'Formaldehyde · North America (TEMPO)',
    'atmosphere',
    'TEMPO_L3_Formaldehyde_Vertical_Column',
    'Hourly formaldehyde column from TEMPO, a marker of fires and volatile organic emissions.',
  );
  G(
    'airs-co2',
    'Carbon Dioxide · monthly (AIRS)',
    'atmosphere',
    'AIRS_L3_Carbon_Dioxide_IR_Monthly',
    'Monthly mid-troposphere carbon dioxide from the AIRS sounder.',
  );
  G(
    'airs-methane',
    'Methane (AIRS, 400 hPa)',
    'atmosphere',
    'AIRS_L3_Methane_400hPa_Volume_Mixing_Ratio_Daily_Day',
    'Daily mid-troposphere methane from AIRS.',
  );
  G(
    'airs-co',
    'Carbon Monoxide (AIRS, 500 hPa)',
    'atmosphere',
    'AIRS_L2_Carbon_Monoxide_500hPa_Volume_Mixing_Ratio_Day',
    'Mid-troposphere carbon monoxide from AIRS — fire and pollution plumes travelling between continents.',
  );
  G(
    'maiac-aod',
    'Aerosol Optical Depth · 1 km (MAIAC)',
    'atmosphere',
    'MODIS_Combined_MAIAC_L2G_AerosolOpticalDepth',
    'High-resolution haze and smoke from the MAIAC algorithm on MODIS Terra and Aqua.',
  );
  G(
    'viirs-aod-deep-blue',
    'Aerosol Optical Depth (VIIRS Deep Blue)',
    'atmosphere',
    'VIIRS_SNPP_AOD_Deep_Blue_Land_Ocean',
    'Aerosol optical depth over land and ocean from VIIRS Deep Blue, including bright deserts.',
  );
  G(
    'olr',
    'Outgoing Longwave Radiation',
    'atmosphere',
    'AIRS_L3_All_Sky_Outgoing_Longwave_Radiation_Daily_Day',
    'Heat the Earth radiates to space (all-sky, AIRS) — low over deep convection, high over clear deserts.',
  );

  // Oceans
  G(
    'oscar-currents-zonal',
    'Ocean Currents · East–West (OSCAR)',
    'oceans',
    'OSCAR_Sea_Surface_Currents_Zonal',
    'Zonal (east–west) surface current speed from the OSCAR analysis — the Gulf Stream, Kuroshio and equatorial currents.',
  );
  G(
    'oscar-currents-meridional',
    'Ocean Currents · North–South (OSCAR)',
    'oceans',
    'OSCAR_Sea_Surface_Currents_Meridional',
    'Meridional (north–south) surface current speed from OSCAR.',
  );
  G(
    'smap-salinity',
    'Sea Surface Salinity (SMAP)',
    'oceans',
    'SMAP_L3_Sea_Surface_Salinity_CAP_8Day_RunningMean',
    '8-day sea-surface salinity from SMAP — river plumes, rain freshening and evaporation basins.',
  );
  G(
    'sea-ice-concentration',
    'Sea Ice Concentration (AMSR2)',
    'oceans',
    'AMSRU2_Sea_Ice_Concentration_12km',
    'Daily sea-ice concentration at 12.5 km from AMSR2.',
  );
  G(
    'water-mask',
    'Land / Water Mask',
    'oceans',
    'MODIS_Water_Mask',
    'Every lake, river and coastline MODIS can resolve, as a crisp land/water mask.',
  );
  G(
    'grand-reservoirs',
    'Reservoirs (GRanD)',
    'oceans',
    'GRanD_Reservoirs',
    'Large reservoirs behind the world’s dams from the Global Reservoir and Dam database.',
    { alpha: 0.9 },
  );

  // Land
  G(
    'gedi-canopy',
    'Forest Canopy Height (GEDI lidar)',
    'land',
    'GEDI_ISS_L3_Canopy_Height_Mean_RH100_201904-202303',
    'Mean tree-canopy height from the GEDI space lidar on the ISS (2019–2023).',
  );
  G(
    'mangroves',
    'Mangrove Forests',
    'land',
    'Mangrove_Forest_Distribution_2000',
    'Global mangrove forest extent (USGS, via NASA SEDAC).',
    { alpha: 0.9 },
  );
  G(
    'croplands',
    'Croplands',
    'land',
    'Agricultural_Lands_Croplands_2000',
    'Share of each grid cell used for crops (NASA SEDAC).',
  );
  G(
    'pastures',
    'Pastures',
    'land',
    'Agricultural_Lands_Pastures_2000',
    'Share of each grid cell used as pasture (NASA SEDAC).',
  );
  G(
    'anthromes',
    'Human-Shaped Biomes (Anthromes)',
    'land',
    'Anthropogenic_Biomes_of_the_World_2001-2006',
    'Anthropogenic biomes: dense settlements, villages, croplands, rangelands and wildlands (NASA SEDAC).',
  );
  G(
    'srtm-color',
    'Elevation Color (SRTM)',
    'land',
    'SRTM_Color_Index',
    'Shuttle Radar Topography Mission elevation, color-coded.',
  );
  G(
    'aster-shaded',
    'Shaded Relief Color (ASTER)',
    'land',
    'ASTER_GDEM_Color_Shaded_Relief',
    'ASTER global elevation model as color shaded relief.',
  );

  // Energy, imagery, places
  G(
    'grand-dams',
    'Large Dams (GRanD)',
    'energy',
    'GRanD_Dams',
    'Locations of the world’s large dams from the Global Reservoir and Dam database.',
    { alpha: 1 },
  );
  G(
    'viirs-dnb',
    'Night Imagery · Suomi NPP (latest)',
    'imagery',
    'VIIRS_SNPP_DayNightBand',
    'Last night’s Day/Night Band imagery from Suomi NPP — city lights, fires, fishing fleets and moonlit clouds.',
  );
  G(
    'noaa20-dnb',
    'Night Imagery · NOAA-20 (latest)',
    'imagery',
    'VIIRS_NOAA20_DayNightBand',
    'Last night’s Day/Night Band imagery from NOAA-20.',
  );
  G(
    'built-up',
    'Built-Up Areas (Landsat)',
    'places',
    'Landsat_Human_Built-up_And_Settlement_Extent',
    'Human built-up and settlement extent mapped from Landsat (NASA SEDAC).',
    { alpha: 0.9 },
  );
  G(
    'human-footprint',
    'Human Footprint',
    'places',
    'Human_Footprint_1995-2004',
    'Combined human pressure on the land: population, land use, access and infrastructure (NASA SEDAC).',
  );
  G(
    'grump-settlements',
    'Settlement Points (GRUMP)',
    'places',
    'GRUMP_Settlements',
    'Every settlement of 1,000+ people in the Global Rural-Urban Mapping Project.',
    { alpha: 1 },
  );
  G(
    'grump-urban',
    'Urban Extents (GRUMP)',
    'places',
    'GRUMP_Urban_Extents_Grid_1995',
    'Urban extents from night lights and settlement data (GRUMP, NASA SEDAC).',
  );
  G(
    'urban-expansion',
    'Urban Expansion Forecast 2030',
    'places',
    'Probabilities_of_Urban_Expansion_2000-2030',
    'Probability that land becomes urban by 2030 (Seto et al., NASA SEDAC).',
  );
  G(
    'lecz',
    'Low-Elevation Coastal Zones (<10 m)',
    'places',
    'LECZ_Urban_Rural_Extents_Below_10m',
    'Urban and rural land less than 10 m above sea level — exposure to sea-level rise and storm surge.',
  );
  G(
    'uhi-day',
    'Urban Heat Islands · Day',
    'places',
    'UHI_Urban-Rural_Summer_Day_Max_Land_Surface_Temp_Difference_2013',
    'How much hotter cities are than their rural surroundings on summer days (NASA SEDAC).',
  );
  G(
    'uhi-night',
    'Urban Heat Islands · Night',
    'places',
    'UHI_Urban-Rural_Summer_Night_Min_Land_Surface_Temp_Difference_2013',
    'Summer night-time urban heat-island intensity (NASA SEDAC).',
  );

  // ═══ Radar, forests, biodiversity ══════════════════════════════════════
  tiles(
    'iem-nexrad',
    'US Weather Radar (NEXRAD)',
    'weather',
    'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/{z}/{x}/{y}.png',
    'Iowa Environmental Mesonet',
    'Composite NEXRAD base reflectivity for the United States, refreshed every 5 minutes.',
    { alpha: 0.8, maxLevel: 10 },
  );
  tiles(
    'rainviewer-radar',
    'Global Weather Radar (RainViewer)',
    'weather',
    '/api/overlay-tile/rainviewer-radar/{z}/{x}/{y}',
    'RainViewer',
    'The latest worldwide radar mosaic from RainViewer (newest frame, refreshed every few minutes).',
    { alpha: 0.8, maxLevel: 7 },
  );
  tiles(
    'gfw-tree-loss',
    'Tree Cover Loss since 2001 (GFW)',
    'land',
    '/api/overlay-tile/gfw-tree-loss/{z}/{x}/{y}',
    'Global Forest Watch · UMD',
    'Annual tree-cover loss from Landsat (Hansen/UMD) via Global Forest Watch.',
    { alpha: 0.9, maxLevel: 12 },
  );
  tiles(
    'gfw-integrated-alerts',
    'Deforestation Alerts (GFW)',
    'land',
    '/api/overlay-tile/gfw-integrated-alerts/{z}/{x}/{y}',
    'Global Forest Watch',
    'Recent forest-disturbance alerts integrating GLAD-L, GLAD-S2 and RADD radar alerts.',
    { alpha: 0.95, maxLevel: 12 },
  );
  const GBIF = (taxon) =>
    `https://api.gbif.org/v2/map/occurrence/density/{z}/{x}/{y}@1x.png?style=purpleYellow.point${taxon ? `&taxonKey=${taxon}` : ''}`;
  for (const [id, name, taxon, what] of [
    ['all', 'All Recorded Life', null, 'every species'],
    ['birds', 'Birds', 212, 'birds'],
    ['mammals', 'Mammals', 359, 'mammals'],
    ['plants', 'Plants', 6, 'plants'],
    ['insects', 'Insects', 216, 'insects'],
    ['fungi', 'Fungi', 5, 'fungi'],
    ['lizards-snakes', 'Lizards & Snakes', 11592253, 'lizards and snakes'],
    ['turtles', 'Turtles', 11418114, 'turtles and tortoises'],
    ['amphibians', 'Amphibians', 131, 'amphibians'],
    ['sharks-rays', 'Sharks & Rays', 121, 'sharks and rays'],
    ['cephalopods', 'Octopus & Squid', 136, 'cephalopods'],
    ['butterflies', 'Butterflies & Moths', 797, 'butterflies and moths'],
  ])
    tiles(
      `gbif-${id}`,
      `${name} · Occurrence Density (GBIF)`,
      'life',
      GBIF(taxon),
      'GBIF',
      `Density of recorded occurrences of ${what} from the Global Biodiversity Information Facility (museum records, surveys and citizen science).`,
      { alpha: 0.85, maxLevel: 14 },
    );

  // ═══ Keyed rasters (relayed by /api/overlay-tile, key stays server-side) ═
  const keyed = (
    id,
    name,
    category,
    source,
    description,
    requiresKey,
    opts = {},
  ) => {
    tiles(
      id,
      name,
      category,
      `/api/overlay-tile/${id}/{z}/{x}/{y}`,
      source,
      description,
      opts,
    );
    add.last().requiresKey = requiresKey;
  };
  for (const [id, name, what] of [
    ['clouds', 'Clouds', 'cloud cover'],
    ['precipitation', 'Precipitation', 'current precipitation'],
    ['pressure', 'Sea-Level Pressure', 'sea-level pressure'],
    ['wind', 'Wind Speed', 'wind speed'],
    ['temperature', 'Temperature', 'air temperature'],
  ])
    keyed(
      `owm-${id}`,
      `${name} (OpenWeatherMap)`,
      'weather',
      'OpenWeatherMap',
      `Current ${what} worldwide from OpenWeatherMap. Needs a free OWM_API_KEY.`,
      'OWM_API_KEY',
      { alpha: 0.8, maxLevel: 9 },
    );
  keyed(
    'waqi-aqi',
    'Air Quality Index (WAQI)',
    'atmosphere',
    'World Air Quality Index',
    'Live US-EPA AQI from 12,000+ monitoring stations worldwide. Needs a free WAQI_TOKEN.',
    'WAQI_TOKEN',
    { alpha: 0.9, maxLevel: 14 },
  );
  keyed(
    'openaip-chart',
    'Aeronautical Chart (OpenAIP)',
    'aviation',
    'OpenAIP',
    'Airspace boundaries, airports, navaids and reporting points from OpenAIP. Needs a free OPENAIP_API_KEY.',
    'OPENAIP_API_KEY',
    { alpha: 0.95, maxLevel: 14 },
  );
  for (const [id, name, category] of [
    ['transport', 'Public Transport Map', 'transport'],
    ['transport-dark', 'Public Transport Map (dark)', 'transport'],
    ['cycle', 'Cycle Map', 'transport'],
    ['outdoors', 'Outdoors Map', 'land'],
    ['landscape', 'Landscape Map', 'land'],
  ])
    keyed(
      `tf-${id}`,
      `${name} (Thunderforest)`,
      category,
      'Thunderforest · OpenStreetMap',
      `Thunderforest’s ${name.toLowerCase()} rendered from OpenStreetMap. Needs a free THUNDERFOREST_API_KEY.`,
      'THUNDERFOREST_API_KEY',
      { alpha: 0.85, maxLevel: 18 },
    );

  // ═══ Live feeds ════════════════════════════════════════════════════════
  feed(
    'usgs-all-day',
    'All Earthquakes · 24 hours',
    'hazards',
    'USGS',
    'Every earthquake USGS located in the past day, down to magnitude ~1 (dense in the US, M2.5+ elsewhere).',
    {
      refreshMs: 5 * MIN,
      style: {
        ...quakeStyle('#ffd166'),
        sizeBy: { prop: 'magnitude', domain: [0, 7], range: [3, 18] },
        labelMax: 0,
      },
      info: quakeInfo,
      statsValue: 'magnitude',
    },
  );
  feed(
    'usgs-all-hour',
    'All Earthquakes · past hour',
    'hazards',
    'USGS',
    'Earthquakes USGS located in the last hour — the freshest seismic picture.',
    {
      refreshMs: 2 * MIN,
      style: {
        ...quakeStyle('#ff6b3d'),
        sizeBy: { prop: 'magnitude', domain: [0, 7], range: [5, 20] },
      },
      info: quakeInfo,
      statsValue: 'magnitude',
    },
  );
  const quakeFields = [
    ['Magnitude', 'magnitude', 'num:1'],
    ['Type', 'mag_type', 'text'],
    ['Depth', 'depth_km', 'km'],
    ['Intensity (MMI)', 'mmi', 'int'],
    ['Time', 'time', 'time'],
    ['Agency', 'agency', 'text'],
    ['Details', 'link', 'link'],
  ];
  feed(
    'emsc-quakes',
    'Earthquakes Worldwide (EMSC)',
    'hazards',
    'EMSC',
    'The latest 1,000 earthquakes of magnitude 2+ from the European-Mediterranean Seismological Centre’s global real-time catalog.',
    {
      refreshMs: 5 * MIN,
      style: {
        color: '#ff9f43',
        sizeBy: { prop: 'magnitude', domain: [2, 8], range: [4, 20] },
        label: 'name',
        labelMax: 20,
      },
      info: { title: 'name', fields: quakeFields },
      statsBy: 'agency',
      statsValue: 'magnitude',
    },
  );
  feed(
    'geonet-quakes',
    'New Zealand Earthquakes (GeoNet)',
    'hazards',
    'GeoNet',
    'Felt earthquakes around Aotearoa New Zealand from GeoNet, with shaking intensity.',
    {
      refreshMs: 5 * MIN,
      style: {
        color: '#ffbe76',
        sizeBy: { prop: 'magnitude', domain: [1, 7], range: [4, 18] },
        label: 'name',
        labelMax: 20,
      },
      info: { title: 'name', fields: quakeFields },
      statsValue: 'magnitude',
    },
  );
  feed(
    'spc-storm-reports',
    'US Storm Reports · today & yesterday',
    'weather',
    'NOAA SPC',
    'Preliminary tornado, damaging-wind and large-hail reports from the Storm Prediction Center.',
    {
      refreshMs: 10 * MIN,
      style: {
        color: '#5fb4ff',
        size: 8,
        colorBy: {
          prop: 'kind',
          map: { Tornado: '#ff3b3b', Wind: '#5fb4ff', Hail: '#7fe0ff' },
        },
        label: 'name',
        labelMax: 20,
      },
      info: {
        title: 'name',
        fields: [
          ['Type', 'kind', 'text'],
          ['Magnitude', 'magnitude', 'text'],
          ['Time (UTC, HHMM)', 'time_utc', 'text'],
          ['County', 'county', 'text'],
          ['Day', 'day', 'text'],
          ['Comments', 'comments', 'text'],
        ],
      },
      statsBy: 'kind',
      legend: [
        ['Tornado', '#ff3b3b'],
        ['Wind', '#5fb4ff'],
        ['Hail', '#7fe0ff'],
      ],
    },
  );
  feed(
    'cneos-fireballs',
    'Fireballs (Bolides) since 1988',
    'sky',
    'NASA/JPL CNEOS',
    'Bright meteors detected by US government sensors, sized by estimated impact energy (kilotons of TNT).',
    {
      style: {
        color: '#ffb020',
        sizeBy: {
          prop: 'impact_kt',
          domain: [0.05, 50],
          range: [4, 22],
          scale: 'sqrt',
        },
        label: 'name',
        labelMax: 0,
      },
      info: {
        title: 'name',
        fields: [
          ['Impact energy (kt)', 'impact_kt', 'num:2'],
          ['Radiated energy (×10¹⁰ J)', 'energy_e10j', 'num:1'],
          ['Altitude', 'altitude_km', 'km'],
          ['Velocity (km/s)', 'velocity_kms', 'num:1'],
          ['Time (UTC)', 'time', 'text'],
        ],
      },
      statsValue: 'impact_kt',
    },
  );
  feed(
    'ioda-outages',
    'Internet Outages · 24 hours',
    'network',
    'IODA · Georgia Tech',
    'Countries with internet outage events in the last 24 hours (BGP, active probing and Google traffic signals), shaded by severity.',
    {
      refreshMs: 10 * MIN,
      geometry: 'polygon',
      style: {
        color: '#ff4d6d',
        width: 1,
        fill: 0.5,
        colorBy: {
          prop: 'severity',
          stops: [
            [1, '#ffd36e'],
            [3, '#ff8a3d'],
            [5, '#ff2d55'],
          ],
        },
        label: 'name',
        labelMax: 40,
      },
      info: {
        title: 'name',
        fields: [
          ['Outage score', 'score', 'int'],
          ['Events', 'events', 'int'],
          ['Signals', 'signals', 'text'],
          ['IODA dashboard', 'link', 'link'],
        ],
      },
      statsValue: 'score',
      legend: [
        ['Minor', '#ffd36e'],
        ['Moderate', '#ff8a3d'],
        ['Severe', '#ff2d55'],
      ],
    },
  );
  feed(
    'amtrak-trains',
    'Amtrak Trains (live)',
    'transport',
    'Amtraker',
    'Every active Amtrak train across the US with speed, heading and next stop, refreshed each minute.',
    {
      refreshMs: MIN,
      style: {
        color: '#4fa3ff',
        size: 10,
        colorBy: { prop: 'color', direct: true },
        label: 'name',
        labelMax: 40,
      },
      info: {
        title: 'name',
        fields: [
          ['Speed (mph)', 'speed_mph', 'num:0'],
          ['Status', 'state', 'text'],
          ['From', 'origin', 'text'],
          ['To', 'destination', 'text'],
          ['Next / last stop', 'next_stop', 'text'],
          ['Updated', 'updated', 'time'],
          ['Track it', 'link', 'link'],
        ],
      },
      statsBy: 'route',
      statsValue: 'speed_mph',
    },
  );
  feed(
    'digitraffic-ais',
    'Baltic & Nordic Ships (live AIS)',
    'transport',
    'Fintraffic Digitraffic',
    'Keyless live AIS for the Baltic Sea and Finnish waters: every vessel with name, type, speed and destination.',
    {
      refreshMs: MIN,
      style: {
        color: '#2fd1c5',
        size: 7,
        colorBy: {
          prop: 'type',
          map: {
            Cargo: '#2fd1c5',
            Tanker: '#ff8a3d',
            Passenger: '#ff8ad8',
            Fishing: '#ffd36e',
            Tug: '#c0a6ff',
            'Pleasure / sailing': '#8fd14f',
            'High-speed craft': '#ff4d6d',
            Military: '#9aa7b8',
          },
        },
        label: 'name',
        labelMax: 30,
      },
      info: {
        title: 'name',
        fields: [
          ['Type', 'type', 'text'],
          ['Speed (kn)', 'speed_kn', 'num:1'],
          ['Course', 'course', 'num:0'],
          ['Status', 'status', 'text'],
          ['Destination', 'destination', 'text'],
          ['Call sign', 'callsign', 'text'],
          ['MMSI', 'mmsi', 'text'],
          ['Position time', 'time', 'time'],
        ],
      },
      statsBy: 'type',
      statsValue: 'speed_kn',
      legend: [
        ['Cargo', '#2fd1c5'],
        ['Tanker', '#ff8a3d'],
        ['Passenger', '#ff8ad8'],
        ['Fishing', '#ffd36e'],
        ['Tug', '#c0a6ff'],
        ['Pleasure', '#8fd14f'],
      ],
    },
  );
  feed(
    'peeringdb-facilities',
    'Data Centers & Colocation (PeeringDB)',
    'network',
    'PeeringDB',
    'Interconnection facilities from PeeringDB, sized by how many networks are present — the physical internet.',
    {
      style: {
        color: '#7fe0ff',
        sizeBy: {
          prop: 'networks',
          domain: [0, 600],
          range: [4, 18],
          scale: 'sqrt',
        },
        label: 'name',
        labelMax: 25,
      },
      info: {
        title: 'name',
        fields: [
          ['Operator', 'operator', 'text'],
          ['City', 'city', 'text'],
          ['Country', 'country', 'text'],
          ['Networks present', 'networks', 'int'],
          ['Internet exchanges', 'exchanges', 'int'],
          ['PeeringDB', 'link', 'link'],
        ],
      },
      statsBy: 'country',
      statsValue: 'networks',
    },
  );
  feed(
    'citybikes-networks',
    'Bike-Share Networks Worldwide',
    'transport',
    'CityBikes',
    'Every public bike-share system tracked by the CityBikes project (800+ cities).',
    {
      style: { color: '#8fd14f', size: 7, label: 'name', labelMax: 25 },
      info: {
        title: 'name',
        fields: [
          ['City', 'city', 'text'],
          ['Country', 'country', 'text'],
          ['Operator', 'operator', 'text'],
        ],
      },
      statsBy: 'country',
    },
  );
  feed(
    'inat-observations',
    'Wildlife Sightings (iNaturalist)',
    'life',
    'iNaturalist',
    'The newest research-grade wildlife observations in view, with photos. Obscured and private locations are never shown.',
    {
      query: 'bbox',
      maxSpanDeg: 3,
      maxAltitudeM: 400_000,
      refreshMs: 15 * MIN,
      style: {
        color: '#9be15d',
        size: 8,
        colorBy: {
          prop: 'group',
          map: {
            Aves: '#5fb4ff',
            Mammalia: '#ffb020',
            Plantae: '#8fd14f',
            Insecta: '#ffd36e',
            Fungi: '#ff8ad8',
            Reptilia: '#2fd1c5',
            Amphibia: '#7ad7ff',
            Actinopterygii: '#4fbde6',
            Mollusca: '#c0a6ff',
            Arachnida: '#ff6b3d',
          },
        },
        label: 'name',
        labelMax: 30,
      },
      info: {
        title: 'name',
        fields: [
          ['Photo', 'photo', 'image'],
          ['Species', 'scientific', 'text'],
          ['Group', 'group', 'text'],
          ['Observed', 'observed', 'text'],
          ['Observation', 'link', 'link'],
        ],
      },
      statsBy: 'group',
      legend: [
        ['Birds', '#5fb4ff'],
        ['Mammals', '#ffb020'],
        ['Plants', '#8fd14f'],
        ['Insects', '#ffd36e'],
        ['Fungi', '#ff8ad8'],
        ['Reptiles', '#2fd1c5'],
      ],
    },
  );
  feed(
    'windy-webcams',
    'Webcams near the view (Windy)',
    'culture',
    'Windy Webcams',
    'Public webcams within 50 km of the view center with their latest still. Needs a free WINDY_WEBCAMS_API_KEY.',
    {
      query: 'point',
      maxAltitudeM: 300_000,
      refreshMs: 10 * MIN,
      style: { color: '#ff8ad8', size: 9, label: 'name', labelMax: 30 },
      info: {
        title: 'name',
        fields: [
          ['Latest image', 'photo', 'image'],
          ['City', 'city', 'text'],
          ['Country', 'country', 'text'],
          ['Watch', 'link', 'link'],
        ],
      },
    },
  );
  add.last().requiresKey = 'WINDY_WEBCAMS_API_KEY';

  // ═══ ME — your own devices (local sources from src/me/meData.js) ═══════
  const local = (id, name, description, spec) =>
    add({
      id,
      name,
      category: 'me',
      kind: 'local',
      source: 'You · stored only on this machine',
      description,
      local: id,
      query: null,
      maxSpanDeg: null,
      maxAltitudeM: null,
      refreshMs: null,
      geometry: spec.geometry ?? 'point',
      style: spec.style ?? {},
      info: spec.info ?? { title: 'name', fields: [] },
      statsBy: spec.statsBy ?? null,
      statsValue: spec.statsValue ?? null,
      legend: spec.legend ?? null,
      tags: `me myself my location gps track ${spec.tags ?? ''}`,
    });
  local(
    'me-position',
    'My Position (live)',
    'Where you are now: this browser’s GPS/Wi-Fi fix, your phone’s tracking app and an optional IP estimate. Start tracking in the ME tab.',
    {
      style: {
        color: '#00ff9c',
        size: 16,
        colorBy: { prop: 'color', direct: true },
        label: 'name',
        labelMax: 10,
      },
      info: {
        title: 'name',
        fields: [
          ['Time', 'time', 'time'],
          ['Accuracy', 'accuracy_m', 'm'],
          ['Speed (km/h)', 'speed_kmh', 'num:1'],
          ['Heading (°)', 'heading', 'num:0'],
          ['Altitude', 'altitude_m', 'm'],
          ['Battery', 'battery', 'pct'],
          ['Source', 'source', 'text'],
          ['ISP', 'isp', 'text'],
          ['Note', 'note', 'text'],
        ],
      },
      statsBy: 'source',
      tags: 'live position here',
    },
  );
  local(
    'me-accuracy',
    'My Position Accuracy',
    'The uncertainty circle around each of your latest fixes (GPS is metres, Wi-Fi tens of metres, IP city-level).',
    {
      geometry: 'polygon',
      style: {
        color: '#00ff9c',
        width: 1.5,
        fill: 0.12,
        colorBy: { prop: 'color', direct: true },
      },
      tags: 'accuracy uncertainty',
    },
  );
  local(
    'me-trail',
    'My Trail',
    'Your path over the range chosen in the ME tab (today by default), one color per device, split where tracking paused.',
    {
      geometry: 'line',
      style: {
        color: '#00ff9c',
        width: 3,
        colorBy: { prop: 'color', direct: true },
      },
      info: {
        title: 'name',
        fields: [
          ['From', 'start', 'time'],
          ['To', 'end', 'time'],
          ['Points', 'points', 'int'],
        ],
      },
      statsBy: 'device',
      tags: 'path history breadcrumb',
    },
  );
  local(
    'me-places',
    'My Places (where I spend time)',
    'Places you stayed 10+ minutes in the chosen range, merged and sized by total hours — computed on this machine.',
    {
      style: {
        color: '#ffe082',
        sizeBy: {
          prop: 'hours',
          domain: [0.2, 200],
          range: [6, 22],
          scale: 'sqrt',
        },
        label: 'name',
        labelMax: 15,
      },
      info: {
        title: 'name',
        fields: [
          ['Hours here', 'hours', 'num:1'],
          ['Visits', 'visits', 'int'],
          ['Last there', 'last', 'time'],
        ],
      },
      statsValue: 'hours',
      tags: 'stays visits frequent',
    },
  );
  local(
    'me-photos',
    'My Photo Locations',
    'Where your imported photos were taken, read from their EXIF GPS tags (import JPEGs in the ME tab).',
    {
      style: { color: '#ff8ad8', size: 7 },
      info: {
        title: 'name',
        fields: [
          ['Taken', 'time', 'time'],
          ['Altitude', 'altitude_m', 'm'],
        ],
      },
      tags: 'exif camera pictures',
    },
  );

  // ═══ World Statistics (World Bank WDI choropleths) ═════════════════════
  for (const indicator of WORLD_INDICATORS) {
    const ramp = indicatorRamp(indicator);
    feed(
      worldFeedId(indicator),
      indicator.name,
      'world',
      'World Bank WDI',
      `${indicator.name} by country (${indicator.unit}), most recent year each country reports, shaded in sixths from lowest to highest. World Bank World Development Indicators.`,
      {
        geometry: 'polygon',
        style: {
          color: ramp[3],
          width: 0.6,
          fill: 0.62,
          colorBy: { prop: 'q', stops: ramp.map((color, i) => [i, color]) },
          label: 'name',
          labelMax: 40,
        },
        info: {
          title: 'name',
          fields: [
            [indicator.name, 'display', 'text'],
            ['Year', 'year', 'text'],
            ['Rank (high → low)', 'rank_text', 'text'],
            ['Class', 'band', 'text'],
            ['World', 'world', 'text'],
            ['Region', 'region', 'text'],
          ],
        },
        statsBy: 'region',
        statsValue: 'value',
        legend: ramp.map((color, i) => [SIXTHS[i], color]),
        tags: `world bank statistics country ${indicator.group} ${indicator.code} ${indicator.slug.replace(/-/g, ' ')}`,
      },
    );
    add.last().indicator = indicator.code;
  }
}

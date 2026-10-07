# Ten parallel lanes: deck out God's Eye View

Each lane is a self-contained task for one Claude Code cloud session (claude.ai/code → repo
`nobodyfr69420/gods-eye-view-plus`). Paste **Shared rules** plus **one lane** as the session's prompt.

## Shared rules (every lane)

1. **Read the house rules first.** Before coding, read README.md, CONTRIBUTING.md, TESTING.md,
   DATA_SOURCES.md, docs/CODE-BOUNDARIES.md, docs/INFRASTRUCTURE-LAYERS.md and docs/UI-OWNERSHIP.md.
   Copy the patterns of existing layers:
   - Layer code goes in `src/layers/<family>/`, as `index.js` / `model.js` / `records.js` / `source.js` plus
     tests.
   - Proxied or cached providers go in `server/providers/`.
   - World labels go through the world-overlay host, never Cesium labels.
2. **Look and feel: keep it God's Eye View.**
   - Reuse the existing panels, chips, legends, HUD, readouts, CSS variables and palette.
   - No new design language, fonts or themes.
   - New layers appear in the existing layer menu with the same toggles. Selections open the same context
     panel style.
3. **Data sources.**
   - Use only public sources (open data, free tiers, public broadcasts). Prefer keyless ones.
   - Any key goes in `.env.example`, and the layer quietly disables itself without it. Never commit
     secrets.
   - Add every source to DATA_SOURCES.md (license, attribution, rate limit).
   - Cache and throttle in a server provider so the app stays within each provider's limits.
4. **Scope.** Track every vehicle, satellite, event and piece of infrastructure the public feeds expose. Do
   not build anything that locates or identifies specific private individuals:
   - no phone or social-media geolocation of people;
   - no home addresses;
   - no face or person recognition;
   - no access to non-public cameras.
5. **Layer tokens.** Take a provisional token with `npm run layer-token:next -- <layer-id>` and record it
   in both the registry and the ledger. The integrator renumbers tokens when merging lanes one by one, so
   don't fight over them.
6. **Shared files** are the layer catalog/registry, DATA_SOURCES.md, `.env.example`, the token ledger and
   the registered-layer count tests. Edit them minimally and append-only, so the ten lanes merge cleanly.
7. **Validation.**
   - Run `npm ci`, `npm run format:check`, `npm run check:boundaries`, `npm test` and `npm run build`.
   - Add unit tests for each new source/model, following the existing `*.test.mjs` style.
   - Put the commands and their results in the PR.
8. **Deliver.**
   - Branch `lane/<number>-<slug>`, with focused commits ending in
     `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
   - Push it and open a PR against `main` of nobodyfr69420/gods-eye-view-plus. The PR description ends
     with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
   - The description lists each new layer, its source and license, how to enable it, screenshots if you
     can make them, and anything you couldn't verify.

## Lane 1: Space and sky
Extend the satellites family and add sky layers:
- **Satellites:**
  - every CelesTrak group as filterable categories: Starlink, OneWeb, GPS/GNSS, weather, science,
    stations, amateur, military-catalogued;
  - space debris fields;
  - satellite ground tracks and footprints;
  - next passes over the camera's location.
- **Crewed missions:** the ISS and Tiangong with crew counts (open APIs).
- **Space weather:**
  - the live aurora oval from the NOAA SWPC OVATION model;
  - a space-weather panel: Kp index, solar wind, X-ray flux, alerts (NOAA SWPC JSON).
- **Re-entries:** upcoming re-entries.

## Lane 2: Natural hazards
- **Volcanoes:** active volcanoes (Smithsonian GVP, USGS volcano alerts).
- **Disaster alerts:** GDACS global alerts (earthquake, tsunami, flood, cyclone, drought, volcano) with
  severity colours.
- **Tsunamis:** warnings (NOAA tsunami.gov feeds).
- **Floods and landslides:** NASA flood/landslide products where open.
- **Avalanches:** avalanche danger where public.
- **Earthquake panel:** extend the earthquakes layer with depth colouring, magnitude filters, 24 h / 7 d /
  30 d windows and a statistics panel (counts by magnitude band, largest event, energy released).

## Lane 3: Weather and atmosphere
- **NASA GIBS imagery overlays** (WMTS, keyless) with a time slider: cloud cover, precipitation, surface
  temperature, snow cover, aerosols, dust, smoke.
- **Air quality:** stations from OpenAQ, AQI-coloured.
- **Live weather station readouts:** open sources such as METAR via aviationweather.gov.
- **Other:** UV index, a pressure/isobar overlay if an open source exists, heat and cold extremes.

## Lane 4: Oceans
- **Measurements:**
  - NDBC buoys with live readings;
  - NOAA CO-OPS tide stations and water levels;
  - wave height and sea surface temperature (ERDDAP / GIBS);
  - ocean currents (OSCAR or an equivalent open product);
  - sea-ice extent;
  - NOAA Coral Reef Watch bleaching alerts.
- **Shipping statistics panel**, built from the existing AIS layer: vessels by type, top flags, busiest
  areas in view.

## Lane 5: World statistics
A **World Statistics** dashboard plus country choropleths:
- **Country indicators:** World Bank API for population, GDP, GDP per capita, life expectancy, CO2,
  internet users, electricity access, military spending, urban share.
- **Country facts:** REST Countries.
- **Choropleth layer:** pick an indicator and a year; legend in the house style.
- **Country context panel:** click a country for the full fact sheet.
- **Global totals ticker:** world population, births and deaths today, estimated from UN rates with the
  method documented.
- **Night lights:** NASA Black Marble through GIBS.

## Lane 6: Energy and infrastructure
- **Power and energy:**
  - power plants by fuel (WRI Global Power Plant Database);
  - nuclear plants (open lists);
  - power lines, pipelines and refineries (OSM Overpass, in the viewport only, cached).
- **Transport hubs:**
  - airports with runways (OurAirports, public domain);
  - seaports (NGA World Port Index);
  - railways (OSM).
- **Internet:** internet exchange points and data centres (PeeringDB).
- **Outages:** live power-outage feeds where public (e.g. utility or ODIN feeds).

## Lane 7: Transport and mobility
- **Air:**
  - extend flights with a statistics panel: aircraft in view by altitude band, operators, emergency
    squawks 7500/7600/7700 highlighted with an alert list;
  - route arcs from airports.
- **Rail:** live trains where open APIs exist (e.g. Amtrak, national rail open data).
- **Road:** EV chargers (Open Charge Map).
- **Water:** ferries.
- **Traffic incidents:** where public.
- **Ports:** port congestion from AIS.

## Lane 8: Geopolitics, news and humanitarian
- **News:** a GDELT live event and news geolocation heatmap with topic filters, and a GDELT event timeline.
- **Humanitarian:** ReliefWeb disasters and reports; UNHCR refugee and displacement statistics by country
  (choropleth plus arcs).
- **Missions:** UN peacekeeping missions.
- **Internet outages:** IODA or Cloudflare Radar public outage signals.
- **Sanctions:** sanctioned-country shading from open lists.
- **Panel:** "what's happening now", ranked by event volume.

## Lane 9: Environment and biodiversity
- **Forests:** deforestation alerts (Global Forest Watch where open, or GLAD tiles).
- **Protected areas:** World Database on Protected Areas, non-commercial use.
- **Wildlife:**
  - species occurrence density (GBIF map tiles);
  - live animal migration tracks where public (Movebank public studies).
- **Emissions:**
  - Climate TRACE emissions sources;
  - methane plumes (open Carbon Mapper / EMIT products).
- **Fires:** fire-weather risk.

## Lane 10: Global HUD and world dashboard
- **Globe overlays:**
  - day/night terminator with twilight bands;
  - time-zone overlay;
  - sun and moon position, moon phase;
  - a world-clock HUD strip.
- **World dashboard panel:** live counters pulled from every layer's `getStats()`: aircraft, ships,
  satellites, quakes 24 h, fires, alerts, and so on, styled like the existing readouts.
- **Overlay control:** a global "all overlays" quick toggle grouped by family, and a legend drawer that
  shows the legend for every enabled layer.
- **Voice:** voice-control actions for the new toggles, following `src/voice/` patterns.

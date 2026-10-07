/**
 * World Bank WDI choropleths: one allowlisted feed per indicator in
 * src/overlayLibrary/worldIndicators.js. Each joins the indicator's most
 * recent value per country (mrnev=1) onto Natural Earth country shapes and
 * adds rank and a six-class quantile so every indicator shades well without
 * hand-tuned thresholds. Data: World Bank (CC BY 4.0).
 */
import {
  WORLD_INDICATORS,
  classOf,
  indicatorText,
  quantileBreaks,
  worldFeedId,
} from '../../../src/overlayLibrary/worldIndicators.js';
import { neCountryShapes } from './feedsPlus.js';

const DAY = 86_400_000;
const MB = 1024 * 1024;
const NE_COUNTRIES =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson';

export const worldBankUrl = (code) =>
  `https://api.worldbank.org/v2/country/all/indicator/${code}?format=json&per_page=400&mrnev=1`;

/** WDI response → Map(iso3 → {value, year}) for real countries only. */
export function worldBankValues(body) {
  const rows = Array.isArray(body?.[1]) ? body[1] : [];
  const out = new Map();
  for (const row of rows) {
    const iso3 = row?.countryiso3code;
    const value = Number(row?.value);
    if (
      !/^[A-Z]{3}$/.test(iso3 || '') ||
      row?.value === null ||
      !Number.isFinite(value)
    )
      continue;
    out.set(iso3, {
      value,
      year: Number(row.date) || null,
      label: row.country?.value,
    });
  }
  return out;
}

/** Aggregates WDI publishes alongside countries (not shaded, never ranked). */
const AGGREGATES = new Set(
  'AFE AFW ARB CEB CSS EAP EAR EAS ECA ECS EMU EUU FCS HIC HPC IBD IBT IDA IDB IDX INX LAC LCN LDC LIC LMC LMY LTE MEA MIC MNA NAC OED OSS PRE PSS PST SAS SSA SSF SST TEA TEC TLA TMN TSA TSS UMC WLD'.split(
    ' ',
  ),
);

/** Join WDI values onto country shapes with rank, class and world value. */
export function worldBankFeatures(countries, body, indicator) {
  const values = worldBankValues(body);
  const world = values.get('WLD') ?? null;
  for (const code of AGGREGATES) values.delete(code);
  const shapes = neCountryShapes(countries).filter((f) =>
    values.has(f.properties.iso3),
  );
  const ranked = [...values.entries()].sort((a, b) => b[1].value - a[1].value);
  const rank = new Map(ranked.map(([iso3], i) => [iso3, i + 1]));
  const cuts = quantileBreaks(
    ranked.map(([, v]) => v.value),
    6,
  );
  return shapes.map((shape) => {
    const { value, year } = values.get(shape.properties.iso3);
    const q = classOf(value, cuts);
    return {
      ...shape,
      properties: {
        name: shape.properties.name,
        iso3: shape.properties.iso3,
        continent: shape.properties.continent,
        region: shape.properties.region,
        value,
        display: indicatorText(value, indicator),
        year,
        q,
        band: `${q === 0 ? 'lowest' : q === 5 ? 'highest' : ['', '2nd', '3rd', '4th', '5th'][q]} sixth`,
        rank: rank.get(shape.properties.iso3),
        of: ranked.length,
        rank_text: `#${rank.get(shape.properties.iso3)} of ${ranked.length}`,
        world: world
          ? `${indicatorText(world.value, indicator)} (${world.year})`
          : null,
        indicator: indicator.code,
      },
    };
  });
}

export const WORLD_BANK_FEEDS = WORLD_INDICATORS.map((indicator) => [
  worldFeedId(indicator),
  {
    attribution: 'World Bank WDI (CC BY 4.0) · Natural Earth',
    upstreams: () => [
      {
        url: NE_COUNTRIES,
        format: 'json',
        ttlMs: 7 * DAY,
        disk: true,
        maxBytes: 12 * MB,
      },
      {
        url: worldBankUrl(indicator.code),
        format: 'json',
        ttlMs: DAY,
        disk: true,
        maxBytes: 4 * MB,
      },
    ],
    transform: ([countries, body]) =>
      worldBankFeatures(countries, body, indicator),
    staleMs: 90 * DAY,
  },
]);

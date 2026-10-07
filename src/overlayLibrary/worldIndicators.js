/**
 * World Statistics: the World Bank indicators the Overlay Library can shade
 * countries by, and the WORLD tab reads. Pure data, shared by the server feed
 * builder (server/providers/overlayFeeds/worldBank.js), the overlay catalog
 * and the WORLD tab. Every code was checked against the live WDI API.
 *
 * format: int | num:N | pct | usd | usdc (compact USD) | rate (per-capita
 * style decimals). `higher` says which direction is generally better, only
 * to pick a ramp; it is not a judgement shown to users.
 */

export const WORLD_GROUPS = Object.freeze([
  {
    id: 'people',
    name: 'People',
    ramp: ['#0b2233', '#0f4161', '#14638f', '#1f8cc0', '#4fbde6', '#bff0ff'],
  },
  {
    id: 'economy',
    name: 'Economy',
    ramp: ['#2b1d05', '#5a3d08', '#8a5d0b', '#c2850f', '#f2b632', '#ffe7a3'],
  },
  {
    id: 'tech',
    name: 'Technology',
    ramp: ['#1a0f33', '#33205e', '#4f338c', '#7150bf', '#9e7cf0', '#ddd0ff'],
  },
  {
    id: 'environment',
    name: 'Energy & Environment',
    ramp: ['#0d2410', '#18451c', '#24682a', '#3a8f3d', '#74c66b', '#d2f5c4'],
  },
  {
    id: 'health',
    name: 'Health',
    ramp: ['#062826', '#0a4a46', '#0f6f69', '#16968e', '#3ccfc2', '#b8fff6'],
  },
  {
    id: 'education',
    name: 'Education',
    ramp: ['#0c1733', '#16295c', '#223e8a', '#3559b8', '#6688e6', '#cddbff'],
  },
  {
    id: 'security',
    name: 'Security & Society',
    ramp: ['#2e0b0b', '#561313', '#801c1c', '#ad2a2a', '#e05555', '#ffc2c2'],
  },
]);

const I = (code, slug, name, group, unit, format, higher = null) =>
  Object.freeze({ code, slug, name, group, unit, format, higher });

export const WORLD_INDICATORS = Object.freeze([
  // People
  I('SP.POP.TOTL', 'population', 'Population', 'people', 'people', 'int'),
  I(
    'EN.POP.DNST',
    'density',
    'Population density',
    'people',
    'people / km²',
    'num:0',
  ),
  I(
    'SP.POP.GROW',
    'pop-growth',
    'Population growth',
    'people',
    '% per year',
    'num:2',
  ),
  I(
    'SP.URB.TOTL.IN.ZS',
    'urban',
    'Urban population',
    'people',
    '% of people',
    'pct',
  ),
  I(
    'SP.DYN.TFRT.IN',
    'fertility',
    'Fertility rate',
    'people',
    'births per woman',
    'num:2',
  ),
  I(
    'SP.DYN.LE00.IN',
    'life-expectancy',
    'Life expectancy',
    'people',
    'years',
    'num:1',
    'up',
  ),
  I(
    'SP.DYN.IMRT.IN',
    'infant-mortality',
    'Infant mortality',
    'people',
    'per 1,000 births',
    'num:1',
    'down',
  ),
  I(
    'SP.POP.65UP.TO.ZS',
    'over-65',
    'Aged 65+',
    'people',
    '% of people',
    'num:1',
  ),
  I(
    'SP.POP.0014.TO.ZS',
    'under-15',
    'Aged 0–14',
    'people',
    '% of people',
    'num:1',
  ),
  I(
    'SP.DYN.CBRT.IN',
    'birth-rate',
    'Birth rate',
    'people',
    'per 1,000 people',
    'num:1',
  ),
  I(
    'SP.DYN.CDRT.IN',
    'death-rate',
    'Death rate',
    'people',
    'per 1,000 people',
    'num:1',
  ),
  I(
    'SM.POP.NETM',
    'net-migration',
    'Net migration',
    'people',
    'people per year',
    'int',
  ),
  I(
    'SM.POP.TOTL.ZS',
    'migrants',
    'International migrants',
    'people',
    '% of people',
    'num:1',
  ),
  // Economy
  I('NY.GDP.MKTP.CD', 'gdp', 'GDP', 'economy', 'US$', 'usdc', 'up'),
  I(
    'NY.GDP.PCAP.CD',
    'gdp-per-capita',
    'GDP per capita',
    'economy',
    'US$',
    'usd',
    'up',
  ),
  I(
    'NY.GDP.PCAP.PP.CD',
    'gdp-ppp',
    'GDP per capita (PPP)',
    'economy',
    'international $',
    'usd',
    'up',
  ),
  I(
    'NY.GDP.MKTP.KD.ZG',
    'gdp-growth',
    'GDP growth',
    'economy',
    '% per year',
    'num:1',
    'up',
  ),
  I(
    'FP.CPI.TOTL.ZG',
    'inflation',
    'Inflation',
    'economy',
    '% per year',
    'num:1',
    'down',
  ),
  I(
    'SL.UEM.TOTL.ZS',
    'unemployment',
    'Unemployment',
    'economy',
    '% of labor force',
    'num:1',
    'down',
  ),
  I(
    'SL.UEM.1524.ZS',
    'youth-unemployment',
    'Youth unemployment',
    'economy',
    '% of 15–24 labor force',
    'num:1',
    'down',
  ),
  I(
    'SI.POV.GINI',
    'gini',
    'Income inequality (Gini)',
    'economy',
    'index 0–100',
    'num:1',
    'down',
  ),
  I(
    'SI.POV.DDAY',
    'extreme-poverty',
    'Extreme poverty ($3/day)',
    'economy',
    '% of people',
    'num:1',
    'down',
  ),
  I('NE.TRD.GNFS.ZS', 'trade', 'Trade', 'economy', '% of GDP', 'num:0'),
  I('NE.EXP.GNFS.ZS', 'exports', 'Exports', 'economy', '% of GDP', 'num:0'),
  I(
    'BX.KLT.DINV.CD.WD',
    'fdi',
    'Foreign direct investment',
    'economy',
    'US$ net inflows',
    'usdc',
  ),
  I(
    'GC.DOD.TOTL.GD.ZS',
    'gov-debt',
    'Government debt',
    'economy',
    '% of GDP',
    'num:0',
    'down',
  ),
  I(
    'BX.TRF.PWKR.DT.GD.ZS',
    'remittances',
    'Remittances received',
    'economy',
    '% of GDP',
    'num:1',
  ),
  I(
    'NV.AGR.TOTL.ZS',
    'agriculture',
    'Agriculture share',
    'economy',
    '% of GDP',
    'num:1',
  ),
  I(
    'NV.IND.MANF.ZS',
    'manufacturing',
    'Manufacturing share',
    'economy',
    '% of GDP',
    'num:1',
  ),
  I(
    'ST.INT.ARVL',
    'tourism',
    'Tourist arrivals',
    'economy',
    'arrivals per year',
    'int',
  ),
  I('GC.TAX.TOTL.GD.ZS', 'tax', 'Tax revenue', 'economy', '% of GDP', 'num:1'),
  I(
    'FI.RES.TOTL.CD',
    'reserves',
    'Total reserves',
    'economy',
    'US$ incl. gold',
    'usdc',
  ),
  // Technology
  I(
    'IT.NET.USER.ZS',
    'internet',
    'Internet users',
    'tech',
    '% of people',
    'pct',
    'up',
  ),
  I(
    'IT.CEL.SETS.P2',
    'mobile',
    'Mobile subscriptions',
    'tech',
    'per 100 people',
    'num:0',
  ),
  I(
    'IT.NET.BBND.P2',
    'broadband',
    'Fixed broadband',
    'tech',
    'per 100 people',
    'num:1',
    'up',
  ),
  I(
    'GB.XPD.RSDV.GD.ZS',
    'rnd',
    'R&D spending',
    'tech',
    '% of GDP',
    'num:2',
    'up',
  ),
  I(
    'IP.PAT.RESD',
    'patents',
    'Patent applications (residents)',
    'tech',
    'per year',
    'int',
  ),
  I(
    'TX.VAL.TECH.MF.ZS',
    'hightech-exports',
    'High-tech exports',
    'tech',
    '% of manufactured exports',
    'num:1',
  ),
  // Energy & environment
  I(
    'EG.ELC.ACCS.ZS',
    'electricity-access',
    'Access to electricity',
    'environment',
    '% of people',
    'pct',
    'up',
  ),
  I(
    'EG.USE.PCAP.KG.OE',
    'energy-use',
    'Energy use per person',
    'environment',
    'kg oil eq.',
    'num:0',
  ),
  I(
    'EG.FEC.RNEW.ZS',
    'renewables',
    'Renewable energy share',
    'environment',
    '% of final energy',
    'num:1',
    'up',
  ),
  I(
    'EG.ELC.RNEW.ZS',
    'renewable-power',
    'Renewable electricity',
    'environment',
    '% of output',
    'num:1',
    'up',
  ),
  I(
    'EG.ELC.NUCL.ZS',
    'nuclear-power',
    'Nuclear electricity',
    'environment',
    '% of output',
    'num:1',
  ),
  I(
    'EG.ELC.COAL.ZS',
    'coal-power',
    'Coal electricity',
    'environment',
    '% of output',
    'num:1',
    'down',
  ),
  I(
    'EN.GHG.CO2.PC.CE.AR5',
    'co2',
    'CO₂ per person',
    'environment',
    't CO₂e',
    'num:1',
    'down',
  ),
  I(
    'EN.GHG.ALL.PC.CE.AR5',
    'ghg',
    'Greenhouse gases per person',
    'environment',
    't CO₂e',
    'num:1',
    'down',
  ),
  I(
    'AG.LND.FRST.ZS',
    'forest',
    'Forest area',
    'environment',
    '% of land',
    'num:1',
    'up',
  ),
  I(
    'EN.ATM.PM25.MC.M3',
    'pm25',
    'PM2.5 air pollution',
    'environment',
    'µg/m³',
    'num:1',
    'down',
  ),
  I(
    'ER.H2O.INTR.PC',
    'freshwater',
    'Freshwater per person',
    'environment',
    'm³ per year',
    'int',
    'up',
  ),
  I(
    'AG.LND.ARBL.ZS',
    'arable',
    'Arable land',
    'environment',
    '% of land',
    'num:1',
  ),
  I(
    'ER.PTD.TOTL.ZS',
    'protected',
    'Protected areas',
    'environment',
    '% of territory',
    'num:1',
    'up',
  ),
  // Health
  I(
    'SH.XPD.CHEX.PC.CD',
    'health-spend',
    'Health spending per person',
    'health',
    'US$',
    'usd',
    'up',
  ),
  I(
    'SH.MED.PHYS.ZS',
    'physicians',
    'Physicians',
    'health',
    'per 1,000 people',
    'num:1',
    'up',
  ),
  I(
    'SH.MED.BEDS.ZS',
    'hospital-beds',
    'Hospital beds',
    'health',
    'per 1,000 people',
    'num:1',
    'up',
  ),
  I(
    'SH.DYN.MORT',
    'under5-mortality',
    'Under-5 mortality',
    'health',
    'per 1,000 births',
    'num:1',
    'down',
  ),
  I(
    'SH.STA.MMRT',
    'maternal-mortality',
    'Maternal mortality',
    'health',
    'per 100,000 births',
    'int',
    'down',
  ),
  I(
    'SH.H2O.SMDW.ZS',
    'safe-water',
    'Safe drinking water',
    'health',
    '% of people',
    'pct',
    'up',
  ),
  I(
    'SH.STA.SMSS.ZS',
    'sanitation',
    'Safe sanitation',
    'health',
    '% of people',
    'pct',
    'up',
  ),
  I(
    'SN.ITK.DEFC.ZS',
    'undernourishment',
    'Undernourishment',
    'health',
    '% of people',
    'num:1',
    'down',
  ),
  I(
    'SH.STA.SUIC.P5',
    'suicide',
    'Suicide rate',
    'health',
    'per 100,000',
    'num:1',
    'down',
  ),
  I(
    'SH.PRV.SMOK',
    'tobacco',
    'Tobacco use',
    'health',
    '% of adults',
    'num:1',
    'down',
  ),
  I(
    'SH.STA.TRAF.P5',
    'road-deaths',
    'Road traffic deaths',
    'health',
    'per 100,000',
    'num:1',
    'down',
  ),
  I(
    'SH.IMM.MEAS',
    'measles-vaccination',
    'Measles immunization',
    'health',
    '% of children',
    'pct',
    'up',
  ),
  // Education
  I(
    'SE.ADT.LITR.ZS',
    'literacy',
    'Adult literacy',
    'education',
    '% of adults',
    'pct',
    'up',
  ),
  I(
    'SE.XPD.TOTL.GD.ZS',
    'education-spend',
    'Education spending',
    'education',
    '% of GDP',
    'num:1',
    'up',
  ),
  I(
    'SE.PRM.ENRR',
    'primary-enrollment',
    'Primary enrollment',
    'education',
    '% gross',
    'num:0',
    'up',
  ),
  I(
    'SE.SEC.ENRR',
    'secondary-enrollment',
    'Secondary enrollment',
    'education',
    '% gross',
    'num:0',
    'up',
  ),
  I(
    'SE.TER.ENRR',
    'tertiary-enrollment',
    'Tertiary enrollment',
    'education',
    '% gross',
    'num:0',
    'up',
  ),
  // Security & society
  I(
    'MS.MIL.XPND.GD.ZS',
    'military-share',
    'Military spending',
    'security',
    '% of GDP',
    'num:1',
  ),
  I(
    'MS.MIL.XPND.CD',
    'military-spend',
    'Military spending (US$)',
    'security',
    'US$',
    'usdc',
  ),
  I(
    'MS.MIL.TOTL.P1',
    'armed-forces',
    'Armed forces personnel',
    'security',
    'people',
    'int',
  ),
  I(
    'VC.IHR.PSRC.P5',
    'homicide',
    'Homicide rate',
    'security',
    'per 100,000',
    'num:1',
    'down',
  ),
  I(
    'VC.BTL.DETH',
    'battle-deaths',
    'Battle-related deaths',
    'security',
    'people',
    'int',
    'down',
  ),
  I(
    'SG.GEN.PARL.ZS',
    'women-parliament',
    'Women in parliament',
    'security',
    '% of seats',
    'num:0',
  ),
]);

export const WORLD_INDICATOR_BY_SLUG = new Map(
  WORLD_INDICATORS.map((indicator) => [indicator.slug, indicator]),
);
export const WORLD_INDICATOR_BY_CODE = new Map(
  WORLD_INDICATORS.map((indicator) => [indicator.code, indicator]),
);
export const WORLD_GROUP_BY_ID = new Map(WORLD_GROUPS.map((g) => [g.id, g]));

/** Feed / overlay id for an indicator. */
export const worldFeedId = (indicator) => `wb-${indicator.slug}`;

/** The six-step ramp for an indicator: dark = low values, bright = high. */
export function indicatorRamp(indicator) {
  return WORLD_GROUP_BY_ID.get(indicator.group)?.ramp ?? WORLD_GROUPS[0].ramp;
}

const NUMBER = new Intl.NumberFormat('en-US');

/** Format an indicator value for display. */
export function formatIndicator(value, format) {
  const n = Number(value);
  if (value === null || value === undefined || !Number.isFinite(n)) return '—';
  const [kind, arg] = String(format).split(':');
  if (kind === 'int') return NUMBER.format(Math.round(n));
  if (kind === 'pct') return `${n.toFixed(n < 10 ? 1 : 0)}%`;
  if (kind === 'usd') return `$${NUMBER.format(Math.round(n))}`;
  if (kind === 'usdc') {
    const abs = Math.abs(n);
    const sign = n < 0 ? '−' : '';
    if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
    if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(1)}B`;
    if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
    return `${sign}$${NUMBER.format(Math.round(abs))}`;
  }
  const digits = Number(arg) || 0;
  return n.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/**
 * A value with its unit, read naturally: "42% of people", "$14,406",
 * "$1.2T net inflows", "73.5 years".
 */
export function indicatorText(value, indicator) {
  const text = formatIndicator(value, indicator.format);
  if (text === '—') return text;
  const unit = indicator.unit;
  if (unit.startsWith('%'))
    return `${text.endsWith('%') ? text : `${text}%`}${unit.slice(1)}`;
  if (/^usd/.test(indicator.format)) {
    if (unit.startsWith('US$')) return `${text}${unit.slice(3)}`;
    if (unit.startsWith('international $')) return `${text} (PPP)`;
  }
  return `${text} ${unit}`;
}

/**
 * Quantile thresholds splitting `values` into `n` equal-count classes.
 * Returns n-1 ascending cut points (empty when there are no values).
 */
export function quantileBreaks(values, n = 6) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return [];
  const cuts = [];
  for (let i = 1; i < n; i++) {
    const pos = (sorted.length - 1) * (i / n);
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    cuts.push(sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo));
  }
  return cuts;
}

/** Class index 0..cuts.length for a value. */
export function classOf(value, cuts) {
  let i = 0;
  while (i < cuts.length && value > cuts[i]) i++;
  return i;
}

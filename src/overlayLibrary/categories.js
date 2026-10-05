/** Overlay Library categories, in panel order. Glyphs are plain Unicode so the
 * subset icon font (index.html `icon_names`) never needs to grow. */
export const OVERLAY_CATEGORIES = Object.freeze([
  { id: 'hazards', name: 'Hazards & Disasters', glyph: '△', accent: '#ff6b3d' },
  { id: 'weather', name: 'Weather & Storms', glyph: '☁', accent: '#5fb4ff' },
  {
    id: 'atmosphere',
    name: 'Air Quality & Atmosphere',
    glyph: '◌',
    accent: '#b48cff',
  },
  { id: 'oceans', name: 'Oceans, Ice & Water', glyph: '≈', accent: '#2fd1c5' },
  {
    id: 'land',
    name: 'Land, Terrain & Vegetation',
    glyph: '▲',
    accent: '#8fd14f',
  },
  {
    id: 'imagery',
    name: 'Satellite Imagery & Night Lights',
    glyph: '◐',
    accent: '#f2c94c',
  },
  { id: 'energy', name: 'Energy & Industry', glyph: 'ϟ', accent: '#ffb020' },
  { id: 'aviation', name: 'Aviation', glyph: '✈', accent: '#7ad7ff' },
  { id: 'transport', name: 'Rail, Road & Sea', glyph: '⇄', accent: '#c0a6ff' },
  {
    id: 'safety',
    name: 'Emergency & Public Safety',
    glyph: '✚',
    accent: '#ff4d6d',
  },
  {
    id: 'government',
    name: 'Government & Security',
    glyph: '◆',
    accent: '#9aa7b8',
  },
  {
    id: 'civic',
    name: 'Health, Education & Civic',
    glyph: '⌂',
    accent: '#5ee6a8',
  },
  {
    id: 'culture',
    name: 'Culture, Tourism & Leisure',
    glyph: '★',
    accent: '#ff8ad8',
  },
  {
    id: 'commerce',
    name: 'Food, Shops & Services',
    glyph: '●',
    accent: '#ffd36e',
  },
  { id: 'places', name: 'Cities & Population', glyph: '◉', accent: '#00d4ff' },
  { id: 'borders', name: 'Borders & Reference', glyph: '⌗', accent: '#e8eaed' },
  { id: 'grids', name: 'Grids & Measurement', glyph: '⊞', accent: '#7fe0ff' },
  { id: 'sky', name: 'Sun, Moon & Space', glyph: '☼', accent: '#ffe082' },
]);

export const CATEGORY_BY_ID = new Map(OVERLAY_CATEGORIES.map((c) => [c.id, c]));

import {
  OVATION_COLUMNS,
  OVATION_ROWS,
  OVATION_CELLS,
} from '../spaceWeather/records.js';

/**
 * Probability bands for the OVATION aurora display, lowest first. Green is
 * the colour of the dominant 557.7 nm auroral emission; the top band shifts
 * toward the red 630 nm emission seen in strong storms.
 */
export const AURORA_BANDS = Object.freeze([
  Object.freeze({ min: 10, label: '10–29 %', color: '#2f9e6a', alpha: 0.28 }),
  Object.freeze({ min: 30, label: '30–49 %', color: '#5fe08f', alpha: 0.4 }),
  Object.freeze({ min: 50, label: '50–79 %', color: '#c6f36b', alpha: 0.5 }),
  Object.freeze({ min: 80, label: '≥80 %', color: '#ff6f91', alpha: 0.58 }),
]);

/** Display thresholds offered as chips. */
export const AURORA_THRESHOLDS = Object.freeze([10, 30, 50]);
/** Height the oval is drawn at: the base of the auroral emission layer. */
export const AURORA_HEIGHT_M = 110_000;

/** Band index for a probability, or -1 below the lowest band. */
export function auroraBandIndex(probability) {
  for (let i = AURORA_BANDS.length - 1; i >= 0; i--)
    if (probability >= AURORA_BANDS[i].min) return i;
  return -1;
}

/**
 * Merge each latitude row's consecutive same-band cells into rectangles.
 * Longitudes are returned in −180..180.
 * @param {Uint8Array} grid Dense OVATION grid.
 * @param {number} threshold Minimum probability shown.
 * @returns {Array<{west:number, east:number, south:number, north:number, band:number}>}
 */
export function auroraRuns(grid, threshold = 10) {
  if (!(grid instanceof Uint8Array) || grid.length !== OVATION_CELLS) return [];
  const runs = [];
  for (let row = 0; row < OVATION_ROWS; row++) {
    const lat = row - 90;
    const south = Math.max(-89.5, lat - 0.5);
    const north = Math.min(89.5, lat + 0.5);
    if (north <= south) continue;
    let open = null;
    // Walk display longitudes −180..179 so a run never straddles the seam.
    for (let i = 0; i <= 360; i++) {
      let band = -1;
      if (i < 360) {
        const displayLon = i - 180;
        const column = (displayLon + 360) % 360;
        const probability = grid[row * OVATION_COLUMNS + column];
        if (probability >= threshold) band = auroraBandIndex(probability);
      }
      if (open && band !== open.band) {
        runs.push({
          west: Math.max(-180, open.start - 0.5),
          east: Math.min(180, i - 180 - 0.5),
          south,
          north,
          band: open.band,
        });
        open = null;
      }
      if (!open && band >= 0) open = { start: i - 180, band };
    }
  }
  return runs;
}

/**
 * Summary statistics for the visible oval.
 * @param {Uint8Array} grid
 * @returns {{north: {maxProbability:number, equatorwardLat:number|null}, south: {maxProbability:number, equatorwardLat:number|null}}}
 */
export function auroraHemisphereStats(grid, threshold = 10) {
  const stats = {
    north: { maxProbability: 0, equatorwardLat: null },
    south: { maxProbability: 0, equatorwardLat: null },
  };
  if (!(grid instanceof Uint8Array) || grid.length !== OVATION_CELLS)
    return stats;
  for (let row = 0; row < OVATION_ROWS; row++) {
    const lat = row - 90;
    const hemi = lat >= 0 ? stats.north : stats.south;
    for (let column = 0; column < OVATION_COLUMNS; column++) {
      const p = grid[row * OVATION_COLUMNS + column];
      if (p > hemi.maxProbability) hemi.maxProbability = p;
      if (p >= threshold) {
        if (
          hemi.equatorwardLat === null ||
          Math.abs(lat) < Math.abs(hemi.equatorwardLat)
        )
          hemi.equatorwardLat = lat;
      }
    }
  }
  return stats;
}

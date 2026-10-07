import * as Cesium from 'cesium';
import { parseTleText } from '../../sources/tle.js';
import { tleOrbitSummary, tleAgeLabel } from '../satelliteGroups/model.js';
import {
  createSatellitePoints,
  createSelectionGraphics,
} from '../satelliteGroups/rendering.js';
import {
  nextPasses,
  describePass,
  cameraObserver,
  observerKey,
  utcClock,
} from '../satelliteGroups/passes.js';
import {
  installSpaceSelection,
  selectedSpaceCard,
  SPACE_CARD_SOURCE_OPTIONS,
} from '../satelliteGroups/interaction.js';
import { STATION_NORAD } from './records.js';
export { createCrewSource } from './source.js';

export const CREWED_STATIONS_LAYER_ID = 'crewed-stations';
export const CREWED_STATIONS_OVERLAY_SOURCE_ID = 'crewed-stations';
const PICK_PREFIX = 'crewed-stations:';
const PASS_REFRESH_MS = 60_000;

/** The two permanently crewed stations this layer draws. */
export const CREWED_STATIONS = Object.freeze([
  Object.freeze({
    key: 'ISS',
    norad: STATION_NORAD.ISS,
    title: 'ISS',
    fullName: 'International Space Station',
    color: '#fff6e5',
  }),
  Object.freeze({
    key: 'Tiangong',
    norad: STATION_NORAD.TIANGONG,
    title: 'Tiangong',
    fullName: 'Tiangong (China Space Station)',
    color: '#ffd0a8',
  }),
]);

/**
 * Pick the station TLEs out of the CelesTrak `stations` group.
 * @param {string} text TLE text.
 * @returns {Array<{station:object, norad:number, name:string, line1:string, line2:string, summary:object}>}
 */
export function stationRecordsFromTle(text) {
  const byNorad = new Map();
  for (const tle of parseTleText(text)) {
    const summary = tleOrbitSummary(tle.line1, tle.line2);
    if (summary) byNorad.set(summary.norad, { ...tle, summary });
  }
  return CREWED_STATIONS.flatMap((station) => {
    const tle = byNorad.get(station.norad);
    return tle
      ? [
          {
            station,
            norad: station.norad,
            name: tle.name.trim(),
            line1: tle.line1,
            line2: tle.line2,
            summary: tle.summary,
            category: 'stations',
            group: 'stations',
          },
        ]
      : [];
  });
}

/**
 * Crewed Stations: ISS and Tiangong with live SGP4 positions, ground tracks,
 * footprints, crew counts and next passes over the camera.
 * @param {object} options
 * @param {{readGroup: Function}} options.tleSource CelesTrak group reader.
 * @param {{getSnapshot: Function}} options.crewSource Crew roster source.
 * @param {object} options.overlayHost World overlay host.
 */
export function createCrewedStationsLayer({
  tleSource,
  crewSource,
  overlayHost,
  requestRender = () => {},
  cesium = Cesium,
  now = () => Date.now(),
} = {}) {
  if (typeof tleSource?.readGroup !== 'function')
    throw new TypeError('Crewed stations require a TLE source');
  if (typeof crewSource?.getSnapshot !== 'function')
    throw new TypeError('Crewed stations require a crew source');
  if (!overlayHost)
    throw new TypeError('Crewed stations require an overlay host');

  let viewer = null;
  let points = null;
  /** @type {Map<number, object>} */
  const tracks = new Map();
  let selection = null;
  let removePreRender = null;
  let listener = null;
  let enabled = false;
  let destroyed = false;
  let loading = false;
  let tleError = null;
  let crewError = null;
  let request = null;
  let stations = [];
  let tleMeta = { fetchedAt: null, stale: false };
  let crew = null;
  let selectedNorad = STATION_NORAD.ISS;
  let passCache = { key: null, at: 0, passes: [], observer: null };
  let lastFrameMs = 0;
  const live = new Map();

  const notify = () => {
    try {
      listener?.();
    } catch {
      /* listener failures stay in the panel */
    }
  };
  const crewCount = (station) =>
    crew && !crew.unavailable ? crew.counts[station.key] || 0 : null;

  function publishCards() {
    if (!enabled || !points) return;
    const entries = [];
    for (const record of stations) {
      const item = points.items.get(record.norad);
      if (!item) continue;
      const count = crewCount(record.station);
      const selected = record.norad === selectedNorad;
      entries.push(
        selectedSpaceCard({
          id: `station:${record.norad}`,
          position: () => item.point.position,
          title: `${record.station.title} · ${count === null ? 'crew ?' : `${count} crew`}`,
          details: selected ? [record.station.fullName] : [],
          accent: record.station.color,
          selected,
          priority: selected ? Number.MAX_SAFE_INTEGER : 5000,
        }),
      );
    }
    overlayHost.setVisible(CREWED_STATIONS_OVERLAY_SOURCE_ID, true);
    overlayHost.setEntries(
      CREWED_STATIONS_OVERLAY_SOURCE_ID,
      entries,
      SPACE_CARD_SOURCE_OPTIONS,
    );
  }

  function refreshPasses(force = false) {
    const item = points?.items.get(selectedNorad);
    if (!item) return;
    const observer = cameraObserver(viewer);
    const key = `${selectedNorad}@${observerKey(observer)}`;
    if (
      !force &&
      passCache.key === key &&
      now() - passCache.at < PASS_REFRESH_MS
    )
      return;
    passCache = {
      key,
      at: now(),
      observer,
      passes: observer
        ? nextPasses(item.satrec, {
            latDeg: observer.latDeg,
            lonDeg: observer.lonDeg,
            fromMs: now(),
          })
        : [],
    };
    notify();
  }

  function rebuild() {
    points.setRecords(stations, (record) => ({
      color: record.station.color,
      pixelSize: 10,
      outlineWidth: 2,
    }));
    points.setShow(enabled);
    for (const graphics of tracks.values()) graphics.destroy();
    tracks.clear();
    for (const record of stations) {
      const item = points.items.get(record.norad);
      if (!item) continue;
      const graphics = createSelectionGraphics({ viewer, cesium });
      graphics.setSubject({
        satrec: item.satrec,
        record,
        color: record.station.color,
      });
      graphics.setShow(enabled);
      tracks.set(record.norad, graphics);
      const pos = graphics.update(now());
      if (pos) live.set(record.norad, pos);
    }
    refreshPasses(true);
    publishCards();
  }

  function onPreRender() {
    if (!enabled || !points) return;
    const t = now();
    points.tick(
      new Date(t),
      stations.map((s) => s.norad),
    );
    if (t - lastFrameMs > 250) {
      lastFrameMs = t;
      for (const [norad, graphics] of tracks) {
        const pos = graphics.update(t);
        if (pos) live.set(norad, pos);
      }
      refreshPasses(false);
    }
  }

  const layer = {
    id: CREWED_STATIONS_LAYER_ID,
    name: 'Crewed Stations',
    icon: '👩‍🚀',
    source: 'CelesTrak · crew rosters',
    updateInterval: 30 * 60_000,

    init(nextViewer) {
      viewer = nextViewer;
      points = createSatellitePoints({
        viewer,
        idPrefix: PICK_PREFIX,
        refreshFrames: 1,
        cesium,
      });
      overlayHost.setVisible(CREWED_STATIONS_OVERLAY_SOURCE_ID, false);
    },

    enable() {
      if (destroyed || enabled || !viewer) return;
      enabled = true;
      points.setShow(true);
      for (const graphics of tracks.values()) graphics.setShow(true);
      removePreRender = viewer.scene.preRender.addEventListener(onPreRender);
      selection = installSpaceSelection({
        viewer,
        layerId: CREWED_STATIONS_LAYER_ID,
        cesium,
        active: () => enabled,
        ownsPickId: (id) => points?.ownsPickId(id) === true,
        onPick: (picked) => {
          const norad = points?.pickNorad(picked);
          if (norad === null || norad === undefined) return false;
          layer.setParams({ station: norad });
          return true;
        },
        // An empty click keeps the stations on screen; nothing to clear.
        onClear: () => {},
      });
      publishCards();
    },

    disable() {
      enabled = false;
      request?.abort();
      request = null;
      loading = false;
      selection?.destroy();
      selection = null;
      removePreRender?.();
      removePreRender = null;
      points?.setShow(false);
      for (const graphics of tracks.values()) graphics.setShow(false);
      overlayHost.clearSource(CREWED_STATIONS_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(CREWED_STATIONS_OVERLAY_SOURCE_ID, false);
      notify();
    },

    async update(_viewer, { signal } = {}) {
      if (!enabled || destroyed) return false;
      request?.abort();
      const controller = new AbortController();
      request = controller;
      const abort = () => controller.abort(signal?.reason);
      signal?.addEventListener?.('abort', abort, { once: true });
      loading = true;
      notify();
      try {
        const [tle, roster] = await Promise.allSettled([
          tleSource.readGroup('stations', { signal: controller.signal }),
          crewSource.getSnapshot({ signal: controller.signal }),
        ]);
        if (!enabled || controller.signal.aborted || request !== controller)
          return false;
        if (tle.status === 'fulfilled' && tle.value.ok) {
          const next = stationRecordsFromTle(tle.value.text);
          tleError = next.length
            ? null
            : 'Station TLEs missing from CelesTrak group';
          if (next.length) {
            stations = next;
            tleMeta = {
              fetchedAt: tle.value.fetchedAt,
              stale: tle.value.stale,
            };
            rebuild();
          }
        } else {
          tleError = 'CelesTrak unavailable';
        }
        if (roster.status === 'fulfilled') {
          crew = roster.value;
          crewError = crew.unavailable
            ? crew.reason || 'Crew roster unavailable'
            : null;
        } else {
          crewError = 'Crew roster unavailable';
        }
        publishCards();
        requestRender('crewed-stations');
        return true;
      } finally {
        signal?.removeEventListener?.('abort', abort);
        if (request === controller) {
          request = null;
          loading = false;
          notify();
        }
      }
    },

    setParams(params = {}) {
      if (destroyed) return false;
      if (Number.isInteger(params.station)) {
        if (!CREWED_STATIONS.some((s) => s.norad === params.station))
          return false;
        selectedNorad = params.station;
        refreshPasses(true);
        publishCards();
      }
      const pos = live.get(selectedNorad);
      if (params.focus === true && pos && viewer?.camera) {
        viewer.camera.flyTo({
          destination: cesium.Cartesian3.fromDegrees(
            pos.longitude,
            pos.latitude,
            2_500_000,
          ),
          duration: 1.4,
        });
      }
      notify();
      return true;
    },

    getParams() {
      return { station: selectedNorad };
    },

    getRowControls() {
      const selected = stations.find((s) => s.norad === selectedNorad);
      const pos = live.get(selectedNorad);
      const obs = passCache.observer;
      const roster = (key) =>
        (crew?.people || [])
          .filter((person) => person.craft === key)
          .map(
            (person) =>
              `· ${person.name}${person.agency ? ` (${person.agency})` : ''}${person.role ? ` — ${person.role}` : ''}`,
          );
      const lines = [];
      if (selected) {
        const s = selected.summary;
        const count = crewCount(selected.station);
        lines.push(
          `${selected.station.fullName} · NORAD ${selected.norad} · ${count === null ? 'crew count unavailable' : `${count} aboard`}`,
          pos
            ? `Now ${pos.latitude.toFixed(2)}°, ${pos.longitude.toFixed(2)}° · ${Math.round(pos.altitude / 1000)} km · ${pos.speedMps ? `${(pos.speedMps / 1000).toFixed(2)} km/s` : ''} (SGP4, live)`
            : 'Position unavailable',
          `i ${s.inclinationDeg.toFixed(2)}° · period ${s.periodMin.toFixed(1)} min · ${tleAgeLabel(s.epochMs, now())}${tleMeta.stale ? ' · STALE TLE copy' : ''}`,
          obs
            ? `Passes ≥10° over camera nadir ${obs.latDeg.toFixed(1)}°, ${obs.lonDeg.toFixed(1)}° (24 h):`
            : 'Passes: camera position unavailable',
          ...(passCache.passes.length
            ? passCache.passes.map((p) => `· ${describePass(p, now())}`)
            : obs
              ? ['· none']
              : []),
          ...roster(selected.station.key),
        );
      }
      const others = Object.entries(crew?.counts || {}).filter(
        ([key]) => !CREWED_STATIONS.some((s) => s.key === key),
      );
      if (others.length)
        lines.push(
          `Also in space: ${others.map(([key, n]) => `${key} ${n}`).join(' · ')}`,
        );
      lines.push(
        crew && !crew.unavailable
          ? `Crew: ${crew.source}, fetched ${utcClock(crew.fetchedAt)}${crew.stale ? ' · STALE' : ''} — community-maintained, may lag crew rotations`
          : `Crew: ${crewError || 'loading…'}`,
      );
      if (tleError) lines.push(tleError);
      return {
        chips: [],
        legend: CREWED_STATIONS.map((station) => ({
          label: station.title,
          color: station.color,
          count: crewCount(station) ?? undefined,
          blurb: station.fullName,
        })),
        list: {
          ariaLabel: 'Crewed space stations',
          items: stations.map((record, index) => {
            const count = crewCount(record.station);
            return {
              id: String(record.norad),
              ordinal: index + 1,
              lead: record.station.title,
              text: `${count === null ? 'crew ?' : `${count} crew`} · ${Math.round(live.get(record.norad)?.altitude / 1000 || record.summary.perigeeKm)} km`,
              active: record.norad === selectedNorad,
              params: { station: record.norad, focus: true },
            };
          }),
        },
        info: lines.join('\n'),
        infoTitle:
          'Positions are SGP4 propagations of CelesTrak TLEs. There is no official machine-readable crew API; counts come from community-maintained rosters and are labelled as such. Track: −½ orbit dim, +1 orbit bright; rings: footprint at 0° and 10° elevation.',
      };
    },

    setRowControlsListener(value) {
      listener = typeof value === 'function' ? value : null;
    },

    getStats() {
      const total = CREWED_STATIONS.reduce(
        (sum, station) => sum + (crewCount(station) || 0),
        0,
      );
      return {
        count: stations.length,
        countLabel: crew && !crew.unavailable ? `${total} crew` : undefined,
        lastUpdate: tleMeta.fetchedAt,
        loading,
        error: tleError || null,
        stale: tleMeta.stale || Boolean(crew?.stale),
        status: tleError ? 'degraded' : 'nominal',
        source: 'CelesTrak · crew rosters',
      };
    },

    destroy() {
      if (destroyed) return;
      layer.disable();
      destroyed = true;
      for (const graphics of tracks.values()) graphics.destroy();
      tracks.clear();
      points?.destroy();
      points = null;
      viewer = null;
      listener = null;
    },
  };
  return layer;
}

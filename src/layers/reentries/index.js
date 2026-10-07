import * as Cesium from 'cesium';
import { DECAY_WATCH_GROUPS, decayWatchCandidates } from './records.js';
import { tleAgeLabel } from '../satelliteGroups/model.js';
import {
  createSatellitePoints,
  createSelectionGraphics,
} from '../satelliteGroups/rendering.js';
import {
  installSpaceSelection,
  selectedSpaceCard,
  SPACE_CARD_SOURCE_OPTIONS,
} from '../satelliteGroups/interaction.js';
export { createReentrySource } from './source.js';

export const REENTRIES_LAYER_ID = 'reentries';
export const REENTRIES_OVERLAY_SOURCE_ID = 'reentries';
const WATCH_PREFIX = 'reentries:watch:';
const TIP_PREFIX = 'reentries:tip:';
const TIP_COLOR = '#ff6f91';
const WATCH_COLOR = '#ffb36b';
const SELECTED_COLOR = '#ffe19a';
const WATCH_REFRESH_MS = 30 * 60_000;

const utc = (ms) =>
  Number.isFinite(ms)
    ? `${new Date(ms).toISOString().slice(5, 16).replace('T', ' ')} UTC`
    : '—';
const windowLabel = (minutes) =>
  !Number.isFinite(minutes)
    ? 'window unknown'
    : minutes >= 120
      ? `±${(minutes / 60).toFixed(minutes % 60 ? 1 : 0)} h`
      : `±${minutes} min`;

/** Short relative description of a TIP prediction. */
export function describeTip(tip, nowMs = Date.now()) {
  const hours = (tip.decayAt - nowMs) / 3_600_000;
  const when =
    hours < 0
      ? `predicted ${Math.round(-hours)} h ago`
      : hours < 48
        ? `in ${hours < 1 ? `${Math.round(hours * 60)} min` : `${hours.toFixed(1)} h`}`
        : `in ${(hours / 24).toFixed(1)} d`;
  return `${utc(tip.decayAt)} ${windowLabel(tip.windowMin)} · ${when}`;
}

/**
 * Re-entries: official Space-Track TIP predictions (with credentials) and a
 * keyless, clearly-estimated decay watch of sub-200 km objects from CelesTrak.
 * @param {object} options
 * @param {{getSnapshot: Function}} options.source TIP source.
 * @param {{readGroup: Function}} options.tleSource CelesTrak group reader.
 * @param {object} options.overlayHost World overlay host.
 */
export function createReentriesLayer({
  source,
  tleSource,
  overlayHost,
  requestRender = () => {},
  cesium = Cesium,
  now = () => Date.now(),
} = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('Re-entries require a TIP source');
  if (typeof tleSource?.readGroup !== 'function')
    throw new TypeError('Re-entries require a TLE source');
  if (!overlayHost) throw new TypeError('Re-entries require an overlay host');

  let viewer = null;
  let watchPoints = null;
  let tipPoints = null;
  let graphics = null;
  let selection = null;
  let removePreRender = null;
  let listener = null;
  let enabled = false;
  let destroyed = false;
  let loading = false;
  let request = null;
  let tipSnapshot = null;
  let tipError = null;
  let watch = [];
  let watchError = null;
  let watchMeta = { readAt: 0, fetchedAt: null, stale: false };
  const watchTexts = new Map();
  let show = { tip: true, watch: true };
  let selected = null; // { kind: 'tip'|'watch', norad }
  let lastFrameMs = 0;

  const notify = () => {
    try {
      listener?.();
    } catch {
      /* panel listener failures stay in the panel */
    }
  };
  const tips = () => tipSnapshot?.tips || [];
  const tipColor = cesium.Color.fromCssColorString(TIP_COLOR);

  function rebuildTips() {
    tipPoints.removeAll();
    for (const tip of tips()) {
      if (tip.latitude === null || tip.longitude === null) continue;
      tipPoints.add({
        id: `${TIP_PREFIX}${tip.norad}`,
        position: cesium.Cartesian3.fromDegrees(tip.longitude, tip.latitude, 0),
        pixelSize: tip.decayAt < now() ? 7 : 10,
        color: tipColor.withAlpha(tip.decayAt < now() ? 0.5 : 0.95),
        outlineColor: cesium.Color.BLACK.withAlpha(0.7),
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      });
    }
    tipPoints.show = enabled && show.tip;
  }

  function publishCards() {
    if (!enabled) return;
    const entries = [];
    if (show.tip) {
      for (const tip of tips()) {
        if (tip.latitude === null || tip.longitude === null) continue;
        const isSelected =
          selected?.kind === 'tip' && selected.norad === tip.norad;
        if (!isSelected && entries.length >= 6) continue;
        const position = cesium.Cartesian3.fromDegrees(
          tip.longitude,
          tip.latitude,
          0,
        );
        entries.push(
          selectedSpaceCard({
            id: `tip:${tip.norad}`,
            position: () => position,
            title: tip.name || `NORAD ${tip.norad}`,
            details: [`TIP ${describeTip(tip, now())}`],
            accent: isSelected ? SELECTED_COLOR : TIP_COLOR,
            selected: isSelected,
            priority: isSelected
              ? Number.MAX_SAFE_INTEGER
              : 4000 - entries.length,
          }),
        );
      }
    }
    if (show.watch && selected?.kind === 'watch') {
      const item = watchPoints.items.get(selected.norad);
      if (item)
        entries.push(
          selectedSpaceCard({
            id: `watch:${selected.norad}`,
            position: () => item.point.position,
            title: item.record.name,
            details: [
              `ESTIMATED · perigee ${Math.round(item.record.perigeeKm)} km · not a prediction`,
            ],
            accent: SELECTED_COLOR,
          }),
        );
    }
    overlayHost.setVisible(REENTRIES_OVERLAY_SOURCE_ID, true);
    overlayHost.setEntries(REENTRIES_OVERLAY_SOURCE_ID, entries, {
      ...SPACE_CARD_SOURCE_OPTIONS,
      cohortLimit: 16,
      collisionCapacity: 16,
    });
  }

  function applySelection(next) {
    if (selected?.kind === 'watch') {
      watchPoints.restyle(selected.norad, { color: WATCH_COLOR, pixelSize: 6 });
    }
    selected = next;
    graphics.setSubject(null);
    if (selected?.kind === 'watch') {
      const item = watchPoints.items.get(selected.norad);
      if (!item) selected = null;
      else {
        watchPoints.restyle(selected.norad, {
          color: SELECTED_COLOR,
          pixelSize: 10,
          outlineWidth: 2,
        });
        graphics.setSubject({
          satrec: item.satrec,
          record: item.record,
          color: WATCH_COLOR,
        });
        graphics.update(now());
      }
    } else if (
      selected?.kind === 'tip' &&
      !tips().some((tip) => tip.norad === selected.norad)
    )
      selected = null;
    publishCards();
    notify();
    requestRender('reentries-selection');
  }

  async function loadWatch(signal) {
    if (now() - watchMeta.readAt < WATCH_REFRESH_MS && watchTexts.size) return;
    let failed = 0;
    let stale = false;
    const stamps = [];
    for (const group of DECAY_WATCH_GROUPS) {
      try {
        const result = await tleSource.readGroup(group, { signal });
        if (result.ok) {
          watchTexts.set(group, result.text);
          stale ||= result.stale;
          if (Number.isFinite(result.fetchedAt)) stamps.push(result.fetchedAt);
        } else failed++;
      } catch (cause) {
        if (signal.aborted) throw cause;
        failed++;
      }
    }
    watchMeta = {
      readAt: now(),
      fetchedAt: stamps.length ? Math.min(...stamps) : null,
      stale,
    };
    watchError =
      failed === DECAY_WATCH_GROUPS.length
        ? 'CelesTrak unavailable'
        : failed
          ? `${failed} CelesTrak group${failed === 1 ? '' : 's'} unavailable`
          : null;
    watch = decayWatchCandidates(watchTexts, now());
    watchPoints.setRecords(watch, () => ({ color: WATCH_COLOR, pixelSize: 6 }));
    watchPoints.setShow(enabled && show.watch);
  }

  function onPreRender() {
    if (!enabled || !watchPoints) return;
    const t = now();
    watchPoints.tick(
      new Date(t),
      selected?.kind === 'watch' ? [selected.norad] : [],
    );
    if (selected?.kind === 'watch' && t - lastFrameMs > 250) {
      lastFrameMs = t;
      graphics.update(t);
    }
  }

  const layer = {
    id: REENTRIES_LAYER_ID,
    name: 'Re-entries',
    icon: '☄',
    source: 'Space-Track TIP · CelesTrak',
    updateInterval: 15 * 60_000,

    init(nextViewer) {
      viewer = nextViewer;
      watchPoints = createSatellitePoints({
        viewer,
        idPrefix: WATCH_PREFIX,
        refreshFrames: 30,
        cesium,
      });
      tipPoints = viewer.scene.primitives.add(
        new cesium.PointPrimitiveCollection(),
      );
      tipPoints.show = false;
      graphics = createSelectionGraphics({ viewer, cesium });
      overlayHost.setVisible(REENTRIES_OVERLAY_SOURCE_ID, false);
    },

    enable() {
      if (destroyed || enabled || !viewer) return;
      enabled = true;
      watchPoints.setShow(show.watch);
      tipPoints.show = show.tip;
      graphics.setShow(true);
      removePreRender = viewer.scene.preRender.addEventListener(onPreRender);
      selection = installSpaceSelection({
        viewer,
        layerId: REENTRIES_LAYER_ID,
        cesium,
        active: () => enabled,
        ownsPickId: (id) =>
          typeof id === 'string' &&
          (id.startsWith(WATCH_PREFIX) || id.startsWith(TIP_PREFIX)),
        onPick: (picked) => {
          const watchNorad = watchPoints.pickNorad(picked);
          if (watchNorad !== null) {
            applySelection({ kind: 'watch', norad: watchNorad });
            return true;
          }
          const id = picked?.primitive?.id ?? picked?.id;
          if (typeof id === 'string' && id.startsWith(TIP_PREFIX)) {
            applySelection({
              kind: 'tip',
              norad: Number(id.slice(TIP_PREFIX.length)),
            });
            return true;
          }
          return false;
        },
        onClear: () => {
          if (selected) applySelection(null);
        },
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
      if (selected && graphics) applySelection(null);
      watchPoints?.setShow(false);
      if (tipPoints) tipPoints.show = false;
      graphics?.setShow(false);
      overlayHost.clearSource(REENTRIES_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(REENTRIES_OVERLAY_SOURCE_ID, false);
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
        const [tipResult] = await Promise.allSettled([
          source.getSnapshot({ signal: controller.signal }),
          loadWatch(controller.signal),
        ]);
        if (!enabled || controller.signal.aborted || request !== controller)
          return false;
        if (tipResult.status === 'fulfilled') {
          tipSnapshot = tipResult.value;
          tipError =
            tipSnapshot.configured && tipSnapshot.unavailable
              ? tipSnapshot.reason || 'Space-Track unavailable'
              : null;
        } else {
          tipError = 'Re-entry provider unavailable';
        }
        rebuildTips();
        if (selected) applySelection(selected);
        else publishCards();
        requestRender('reentries');
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
      if (params.toggle === 'tip' || params.toggle === 'watch') {
        show = { ...show, [params.toggle]: !show[params.toggle] };
        if (selected && !show[selected.kind]) applySelection(null);
        watchPoints?.setShow(enabled && show.watch);
        if (tipPoints) tipPoints.show = enabled && show.tip;
        publishCards();
        requestRender('reentries');
      }
      if (params.clear === true) applySelection(null);
      else if (
        (params.kind === 'tip' || params.kind === 'watch') &&
        Number.isInteger(params.norad)
      )
        applySelection({ kind: params.kind, norad: params.norad });
      if (params.focus === true && selected && viewer?.camera) {
        let lat = null;
        let lon = null;
        if (selected.kind === 'tip') {
          const tip = tips().find((t) => t.norad === selected.norad);
          lat = tip?.latitude ?? null;
          lon = tip?.longitude ?? null;
        } else {
          const pos = watchPoints.items.get(selected.norad)?.position;
          lat = pos?.latitude ?? null;
          lon = pos?.longitude ?? null;
        }
        if (lat !== null && lon !== null)
          viewer.camera.flyTo({
            destination: cesium.Cartesian3.fromDegrees(lon, lat, 6_000_000),
            duration: 1.4,
          });
      }
      notify();
      return true;
    },

    getParams() {
      return { showTip: show.tip, showWatch: show.watch };
    },

    getRowControls() {
      const t = now();
      const configured = tipSnapshot?.configured === true;
      const chips = [
        {
          id: 'tip',
          label: configured ? `OFFICIAL TIP ${tips().length}` : 'OFFICIAL TIP',
          active: show.tip && configured,
          state: !configured
            ? 'idle'
            : tipError
              ? 'error'
              : show.tip
                ? 'active'
                : 'idle',
          disabled: !configured,
          title: configured
            ? 'US Space Force TIP predictions via Space-Track.org'
            : 'Set SPACETRACK_IDENTITY and SPACETRACK_PASSWORD (free Space-Track.org account) to enable official predictions',
          params: { toggle: 'tip' },
        },
        {
          id: 'watch',
          label: `DECAY WATCH ${watch.length}`,
          active: show.watch,
          state:
            watchError && !watch.length
              ? 'error'
              : show.watch
                ? 'active'
                : 'idle',
          title:
            'ESTIMATED: CelesTrak objects with perigee below 200 km. Not a re-entry time prediction.',
          params: { toggle: 'watch' },
        },
      ];
      const items = [];
      if (show.tip)
        for (const tip of tips())
          items.push({
            id: `tip:${tip.norad}`,
            ordinal: items.length + 1,
            lead: 'TIP',
            text: `${tip.name || `NORAD ${tip.norad}`} · ${describeTip(tip, t)}`,
            active: selected?.kind === 'tip' && selected.norad === tip.norad,
            params: { kind: 'tip', norad: tip.norad, focus: true },
          });
      if (show.watch)
        for (const record of watch.slice(0, 25))
          items.push({
            id: `watch:${record.norad}`,
            ordinal: items.length + 1,
            lead: 'EST',
            text: `${record.name} · perigee ${Math.round(record.perigeeKm)} km · ${tleAgeLabel(record.epochMs, t)}`,
            active:
              selected?.kind === 'watch' && selected.norad === record.norad,
            params: { kind: 'watch', norad: record.norad, focus: true },
          });
      const lines = [];
      if (selected?.kind === 'tip') {
        const tip = tips().find((x) => x.norad === selected.norad);
        if (tip)
          lines.push(
            `${tip.name || 'Unnamed object'} · NORAD ${tip.norad}${tip.objectType ? ` · ${tip.objectType}` : ''}${tip.country ? ` · ${tip.country}` : ''}${tip.highInterest ? ' · HIGH INTEREST' : ''}`,
            `Predicted re-entry ${describeTip(tip, t)}`,
            `Predicted location ${tip.latitude?.toFixed(1)}°, ${tip.longitude?.toFixed(1)}° — only one point on a ground track; the ${windowLabel(tip.windowMin)} window spans thousands of km along the orbit`,
            `TIP message ${utc(tip.messageAt)}${tip.inclinationDeg !== null ? ` · i ${tip.inclinationDeg}°` : ''}${tip.direction ? ` · ${tip.direction}` : ''}`,
          );
      } else if (selected?.kind === 'watch') {
        const item = watchPoints.items.get(selected.norad);
        if (item) {
          const s = item.record.summary;
          lines.push(
            `${item.record.name} · NORAD ${item.record.norad} · ESTIMATED`,
            `Perigee ${Math.round(s.perigeeKm)} km · apogee ${Math.round(s.apogeeKm)} km · ${tleAgeLabel(s.epochMs, t)} · group ${item.record.group}`,
            'Low perigee means decay is likely within days to weeks; the TLE gives no re-entry time or place.',
          );
        }
      }
      lines.push(
        configured
          ? tipError
            ? `Space-Track: ${tipError}`
            : `Space-Track TIP fetched ${utc(tipSnapshot.fetchedAt)}${tipSnapshot.stale ? ' · STALE' : ''} · ${tips().length} active prediction${tips().length === 1 ? '' : 's'}`
          : 'Official predictions off: add a free Space-Track.org account as SPACETRACK_IDENTITY / SPACETRACK_PASSWORD',
        `Decay watch: ${watch.length} object${watch.length === 1 ? '' : 's'} below ${200} km perigee · CelesTrak ${watchMeta.fetchedAt ? `fetched ${utc(watchMeta.fetchedAt)}` : 'not loaded'}${watchMeta.stale ? ' · STALE' : ''}${watchError ? ` · ${watchError}` : ''}`,
      );
      return {
        chips,
        legend: [
          ...(configured
            ? [{ label: 'TIP predicted location', color: TIP_COLOR }]
            : []),
          { label: 'Decay watch (estimated)', color: WATCH_COLOR },
        ],
        list: { ariaLabel: 'Upcoming re-entries', items: items.slice(0, 40) },
        info: lines.join('\n'),
        infoTitle:
          'TIP (Tracking and Impact Prediction) messages are issued by the US Space Force for objects expected to re-enter; the window is the stated uncertainty in time. The decay watch is not a prediction: it lists catalogued objects whose current orbit dips below 200 km, computed from public CelesTrak TLEs.',
      };
    },

    setRowControlsListener(value) {
      listener = typeof value === 'function' ? value : null;
    },

    getStats() {
      return {
        count: tips().length + watch.length,
        lastUpdate: tipSnapshot?.fetchedAt ?? watchMeta.fetchedAt,
        loading,
        error: tipError && watchError ? watchError : null,
        stale: Boolean(tipSnapshot?.stale || watchMeta.stale),
        status: tipError || watchError ? 'degraded' : 'nominal',
        source: tipSnapshot?.configured
          ? 'Space-Track TIP · CelesTrak'
          : 'CelesTrak (estimated)',
      };
    },

    destroy() {
      if (destroyed) return;
      layer.disable();
      destroyed = true;
      watchPoints?.destroy();
      graphics?.destroy();
      if (tipPoints && viewer && !tipPoints.isDestroyed?.())
        viewer.scene.primitives.remove(tipPoints);
      tipPoints = null;
      watchPoints = null;
      graphics = null;
      viewer = null;
      listener = null;
    },
  };
  return layer;
}

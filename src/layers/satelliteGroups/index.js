import * as Cesium from 'cesium';
import {
  SATELLITE_GROUP_CATEGORIES,
  defaultSatelliteGroupCategories,
  normalizeSatelliteGroupCategories,
  satelliteGroupCategory,
  tleAgeLabel,
} from './model.js';
import {
  buildSatelliteGroupRecords,
  countByCategory,
  satelliteGroupAnalystRecord,
} from './records.js';
import { createSatellitePoints, createSelectionGraphics } from './rendering.js';
import {
  nextPasses,
  describePass,
  cameraObserver,
  observerKey,
  utcClock,
} from './passes.js';
import {
  installSpaceSelection,
  selectedSpaceCard,
  SPACE_CARD_SOURCE_OPTIONS,
} from './interaction.js';
export { createSatelliteGroupSource } from './source.js';

export const SATELLITE_GROUPS_LAYER_ID = 'satellite-groups';
export const SATELLITE_GROUPS_OVERLAY_SOURCE_ID = 'satellite-groups';
const PICK_PREFIX = 'satellite-groups:';
/** Re-ask the (6 h server-cached) CelesTrak proxy at most this often. */
const GROUP_REFRESH_MS = 30 * 60_000;
const PASS_REFRESH_MS = 60_000;
const SELECTED_COLOR = '#ffe19a';

const fmtCount = (n) =>
  n >= 10_000
    ? `${Math.round(n / 1000)}k`
    : n >= 1000
      ? `${(n / 1000).toFixed(1)}k`
      : String(n);

/**
 * Satellite Groups: every public CelesTrak category as a filterable point
 * cloud, with a selected object's ground track, coverage footprints and next
 * passes over the camera's nadir point.
 *
 * Positions are SGP4 propagations of CelesTrak TLEs (computed live in the
 * browser); TLE age is shown with every selection.
 * @param {object} options
 * @param {{readGroup: Function}} options.source CelesTrak group reader.
 * @param {{setEntries: Function, setVisible: Function, clearSource: Function}} options.overlayHost
 * @param {{registerEntityContext?: Function, selectEntityContext?: Function, clearSelectedEntityContextForLayer?: Function, removeEntityContextsForLayer?: Function}} [options.context]
 * @param {(reason: string) => void} [options.requestRender]
 */
export function createSatelliteGroupsLayer({
  source,
  overlayHost,
  context = {},
  requestRender = () => {},
  cesium = Cesium,
  now = () => Date.now(),
} = {}) {
  if (typeof source?.readGroup !== 'function')
    throw new TypeError('Satellite groups require a CelesTrak group source');
  if (!overlayHost)
    throw new TypeError('Satellite groups require an overlay host');

  let viewer = null;
  let points = null;
  let graphics = null;
  let selection = null;
  let removePreRender = null;
  let listener = null;
  let enabled = false;
  let destroyed = false;
  let loading = false;
  let error = null;
  let loadController = null;
  let loadToken = 0;
  let categories = new Set(defaultSatelliteGroupCategories());
  /** @type {Map<string, {text:string, fetchedAt:number|null, stale:boolean, readAt:number}>} */
  const groups = new Map();
  const failedGroups = new Set();
  let records = [];
  let counts = {};
  let selectedNorad = null;
  let selectedPosition = null;
  let passCache = { key: null, at: 0, passes: [], observer: null };
  let lastFrameMs = 0;
  let contextCarrier = null;

  const notify = () => {
    try {
      listener?.();
    } catch {
      /* a panel listener must not break the layer */
    }
  };
  const styleFor = (record) => ({
    color: satelliteGroupCategory(record.category)?.color || '#9fb3c4',
    pixelSize:
      record.category === 'starlink' || record.category === 'debris' ? 3 : 4,
  });
  const selectedItem = () =>
    selectedNorad === null ? null : points?.items.get(selectedNorad) || null;

  function publishCard() {
    const item = selectedItem();
    if (!item || !enabled) {
      overlayHost.clearSource(SATELLITE_GROUPS_OVERLAY_SOURCE_ID);
      return;
    }
    const s = item.record.summary;
    const pass = passCache.passes[0];
    const details = [
      `${satelliteGroupCategory(item.record.category)?.label || ''} · NORAD ${item.record.norad} · ${s.regime}`,
      `${Math.round(s.perigeeKm)}×${Math.round(s.apogeeKm)} km · i ${s.inclinationDeg.toFixed(1)}° · ${s.periodMin.toFixed(0)} min`,
      pass
        ? `Next pass ${describePass(pass, now())}`
        : 'No pass ≥10° over camera in 24 h',
    ];
    overlayHost.setVisible(SATELLITE_GROUPS_OVERLAY_SOURCE_ID, true);
    overlayHost.setEntries(
      SATELLITE_GROUPS_OVERLAY_SOURCE_ID,
      [
        selectedSpaceCard({
          id: `sat:${item.record.norad}`,
          position: () => item.point.position,
          title: item.record.name,
          details,
          accent: SELECTED_COLOR,
        }),
      ],
      SPACE_CARD_SOURCE_OPTIONS,
    );
  }

  function refreshPasses(force = false) {
    const item = selectedItem();
    if (!item) {
      passCache = { key: null, at: 0, passes: [], observer: null };
      return;
    }
    const observer = cameraObserver(viewer);
    const key = `${item.record.norad}@${observerKey(observer)}`;
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
    publishCard();
    notify();
  }

  function registerContext(item) {
    if (!context.registerEntityContext || !item) return;
    contextCarrier = { show: true };
    const s = item.record.summary;
    context.registerEntityContext(contextCarrier, {
      id: `${SATELLITE_GROUPS_LAYER_ID}:${item.record.norad}`,
      layerId: SATELLITE_GROUPS_LAYER_ID,
      layerName: 'Satellite Groups',
      source: 'CelesTrak',
      label: item.record.name,
      latitude: item.position?.latitude ?? null,
      longitude: item.position?.longitude ?? null,
      properties: {
        norad: item.record.norad,
        category: item.record.category,
        regime: s.regime,
        perigeeKm: Math.round(s.perigeeKm),
        apogeeKm: Math.round(s.apogeeKm),
        inclinationDeg: Math.round(s.inclinationDeg * 10) / 10,
        tle: tleAgeLabel(s.epochMs, now()),
      },
    });
    context.selectEntityContext?.(contextCarrier);
  }

  function select(norad) {
    const previous = selectedNorad;
    if (previous !== null && previous !== norad) {
      const old = points?.items.get(previous);
      if (old) points.restyle(previous, styleFor(old.record));
    }
    selectedNorad = norad;
    const item = selectedItem();
    if (!item) {
      selectedNorad = null;
      graphics?.setSubject(null);
      overlayHost.clearSource(SATELLITE_GROUPS_OVERLAY_SOURCE_ID);
      if (previous !== null) {
        context.clearSelectedEntityContextForLayer?.(SATELLITE_GROUPS_LAYER_ID);
        context.removeEntityContextsForLayer?.(SATELLITE_GROUPS_LAYER_ID);
      }
      contextCarrier = null;
      passCache = { key: null, at: 0, passes: [], observer: null };
      notify();
      requestRender('satellite-groups-selection');
      return;
    }
    points.restyle(norad, {
      color: SELECTED_COLOR,
      pixelSize: 9,
      outlineColor: '#000000',
      outlineWidth: 2,
    });
    graphics.setSubject({
      satrec: item.satrec,
      record: item.record,
      color:
        satelliteGroupCategory(item.record.category)?.color || SELECTED_COLOR,
    });
    selectedPosition = graphics.update(now());
    registerContext(item);
    refreshPasses(true);
    publishCard();
    notify();
    requestRender('satellite-groups-selection');
  }

  function onPreRender() {
    if (!enabled || !points) return;
    const t = now();
    points.tick(new Date(t), selectedNorad === null ? [] : [selectedNorad]);
    if (selectedNorad !== null && t - lastFrameMs > 250) {
      lastFrameMs = t;
      selectedPosition = graphics.update(t);
      refreshPasses(false);
    }
  }

  async function loadCategories({ signal } = {}) {
    if (!enabled || destroyed) return false;
    loadController?.abort();
    const controller = new AbortController();
    loadController = controller;
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener?.('abort', abort, { once: true });
    const token = ++loadToken;
    loading = true;
    notify();
    try {
      const wanted = SATELLITE_GROUP_CATEGORIES.filter((c) =>
        categories.has(c.id),
      ).flatMap((c) => c.groups);
      for (const group of wanted) {
        const cached = groups.get(group);
        if (cached && now() - cached.readAt < GROUP_REFRESH_MS) continue;
        try {
          const result = await source.readGroup(group, {
            signal: controller.signal,
          });
          if (result.ok) {
            groups.set(group, {
              text: result.text,
              fetchedAt: result.fetchedAt,
              stale: result.stale,
              readAt: now(),
            });
            failedGroups.delete(group);
          } else {
            failedGroups.add(group);
          }
        } catch (cause) {
          if (controller.signal.aborted) throw cause;
          failedGroups.add(group);
        }
      }
      if (token !== loadToken || !enabled || destroyed) return false;
      const texts = new Map(
        [...groups].map(([group, entry]) => [group, entry.text]),
      );
      records = buildSatelliteGroupRecords(texts, [...categories]);
      counts = countByCategory(records);
      points.setRecords(records, styleFor);
      points.setShow(enabled);
      const failedWanted = wanted.filter((group) => failedGroups.has(group));
      error =
        failedWanted.length && failedWanted.length === wanted.length
          ? 'CelesTrak unavailable'
          : failedWanted.length
            ? `Partial: ${failedWanted.join(', ')} unavailable`
            : null;
      if (selectedNorad !== null) {
        if (points.items.has(selectedNorad)) select(selectedNorad);
        else select(null);
      }
      requestRender('satellite-groups-catalog');
      return true;
    } catch (cause) {
      if (controller.signal.aborted) return false;
      error = cause?.message || 'CelesTrak unavailable';
      return false;
    } finally {
      signal?.removeEventListener?.('abort', abort);
      if (loadController === controller) {
        loadController = null;
        loading = false;
        notify();
      }
    }
  }

  function freshness() {
    const used = SATELLITE_GROUP_CATEGORIES.filter((c) => categories.has(c.id))
      .flatMap((c) => c.groups)
      .map((group) => groups.get(group))
      .filter(Boolean);
    const stamps = used.map((entry) => entry.fetchedAt).filter(Number.isFinite);
    return {
      oldest: stamps.length ? Math.min(...stamps) : null,
      stale: used.some((entry) => entry.stale),
    };
  }

  const layer = {
    id: SATELLITE_GROUPS_LAYER_ID,
    name: 'Satellite Groups',
    icon: '✦',
    source: 'CelesTrak',
    updateInterval: GROUP_REFRESH_MS,

    init(nextViewer) {
      if (viewer) throw new Error('Satellite groups are already initialized');
      viewer = nextViewer;
      points = createSatellitePoints({ viewer, idPrefix: PICK_PREFIX, cesium });
      graphics = createSelectionGraphics({ viewer, cesium });
      overlayHost.setVisible(SATELLITE_GROUPS_OVERLAY_SOURCE_ID, false);
    },

    enable() {
      if (destroyed || enabled || !viewer) return;
      enabled = true;
      points.setShow(true);
      graphics.setShow(true);
      removePreRender = viewer.scene.preRender.addEventListener(onPreRender);
      selection = installSpaceSelection({
        viewer,
        layerId: SATELLITE_GROUPS_LAYER_ID,
        cesium,
        active: () => enabled,
        ownsPickId: (id) => points?.ownsPickId(id) === true,
        onPick: (picked) => {
          const norad = points?.pickNorad(picked);
          if (norad === null || norad === undefined) return false;
          select(norad);
          return true;
        },
        onClear: () => {
          if (selectedNorad !== null) select(null);
        },
      });
    },

    disable() {
      enabled = false;
      loadController?.abort();
      loadController = null;
      loading = false;
      selection?.destroy();
      selection = null;
      removePreRender?.();
      removePreRender = null;
      if (selectedNorad !== null) select(null);
      points?.setShow(false);
      graphics?.setShow(false);
      overlayHost.clearSource(SATELLITE_GROUPS_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(SATELLITE_GROUPS_OVERLAY_SOURCE_ID, false);
      notify();
    },

    async update(_viewer, { signal } = {}) {
      return loadCategories({ signal });
    },

    /**
     * @param {{categories?: string[], toggleCategory?: string, noradId?: number|null, clear?: boolean, focus?: boolean}} params
     */
    setParams(params = {}) {
      if (destroyed) return false;
      let reload = false;
      if (Array.isArray(params.categories)) {
        categories = new Set(
          normalizeSatelliteGroupCategories(params.categories),
        );
        reload = true;
      }
      if (typeof params.toggleCategory === 'string') {
        if (!satelliteGroupCategory(params.toggleCategory)) return false;
        if (categories.has(params.toggleCategory))
          categories.delete(params.toggleCategory);
        else categories.add(params.toggleCategory);
        reload = true;
      }
      if (params.clear === true || params.noradId === null) select(null);
      else if (
        Number.isInteger(params.noradId) &&
        points?.items.has(params.noradId)
      )
        select(params.noradId);
      if (params.focus === true && selectedPosition && viewer?.camera) {
        const p = selectedPosition;
        viewer.camera.flyTo({
          destination: cesium.Cartesian3.fromDegrees(
            p.longitude,
            p.latitude,
            Math.max(2_500_000, p.altitude * 2.5),
          ),
          duration: 1.4,
        });
      }
      if (reload && enabled) void loadCategories();
      notify();
      return true;
    },

    getParams() {
      return {
        categories: SATELLITE_GROUP_CATEGORIES.map((c) => c.id).filter((id) =>
          categories.has(id),
        ),
        noradId: selectedNorad,
      };
    },

    getRowControls() {
      const item = selectedItem();
      const chips = SATELLITE_GROUP_CATEGORIES.map((category) => {
        const on = categories.has(category.id);
        const count = counts[category.id] || 0;
        const failed = category.groups.some((group) => failedGroups.has(group));
        return {
          id: `category:${category.id}`,
          label:
            on && count ? `${category.chip} ${fmtCount(count)}` : category.chip,
          active: on,
          state: on && failed && !count ? 'error' : on ? 'active' : 'idle',
          title: `${category.blurb}${category.heavy ? ' — heavy: thousands of points' : ''}${failed ? ' — CelesTrak group unavailable' : ''}`,
          params: { toggleCategory: category.id },
        };
      });
      const legend = SATELLITE_GROUP_CATEGORIES.filter(
        (category) => categories.has(category.id) && counts[category.id],
      ).map((category) => ({
        label: category.label,
        color: category.color,
        count: counts[category.id],
        blurb: category.blurb,
      }));
      if (item) legend.push({ label: 'Selected', color: SELECTED_COLOR });
      const fresh = freshness();
      let info;
      if (item) {
        const s = item.record.summary;
        const pos = selectedPosition;
        const obs = passCache.observer;
        info = [
          `${item.record.name} · NORAD ${item.record.norad} · ${satelliteGroupCategory(item.record.category)?.label}`,
          `${s.regime} · perigee ${Math.round(s.perigeeKm)} km · apogee ${Math.round(s.apogeeKm)} km · i ${s.inclinationDeg.toFixed(2)}° · period ${s.periodMin.toFixed(1)} min`,
          pos
            ? `Now ${pos.latitude.toFixed(2)}°, ${pos.longitude.toFixed(2)}° · ${Math.round(pos.altitude / 1000)} km${pos.speedMps ? ` · ${(pos.speedMps / 1000).toFixed(2)} km/s` : ''} (SGP4, live)`
            : 'Position unavailable (propagation failed)',
          `${tleAgeLabel(s.epochMs, now())} · CelesTrak group ${item.record.group}`,
          obs
            ? `Passes ≥10° over camera nadir ${obs.latDeg.toFixed(1)}°, ${obs.lonDeg.toFixed(1)}° (next 24 h):`
            : 'Passes: camera position unavailable',
          ...(passCache.passes.length
            ? passCache.passes.map((p) => `· ${describePass(p, now())}`)
            : obs
              ? ['· none']
              : []),
          'Track: −½ orbit dim, +1 orbit bright · rings: footprint at 0° and 10° elevation',
        ].join('\n');
      } else {
        info = [
          `${records.length.toLocaleString('en-US')} objects in ${categories.size} categor${categories.size === 1 ? 'y' : 'ies'} · click a point for track, footprint and passes`,
          fresh.oldest
            ? `CelesTrak TLEs fetched ${utcClock(fresh.oldest)}${fresh.stale ? ' · STALE (CelesTrak unreachable, cached copy)' : ''} · positions propagated live (SGP4)`
            : loading
              ? 'Loading CelesTrak groups…'
              : 'No CelesTrak data yet',
          error || '',
        ]
          .filter(Boolean)
          .join('\n');
      }
      return {
        chips,
        legend,
        info,
        infoTitle:
          'Public CelesTrak GP catalog groups. Military shows only objects in the public catalog. Positions come from SGP4 propagation of each TLE and lose accuracy as the TLE ages. Footprints assume a spherical Earth; passes are computed for the point directly below the camera.',
      };
    },

    setRowControlsListener(value) {
      listener = typeof value === 'function' ? value : null;
    },

    getStats() {
      const fresh = freshness();
      return {
        count: records.length,
        lastUpdate: fresh.oldest,
        loading,
        error,
        stale: fresh.stale,
        status:
          error === 'CelesTrak unavailable'
            ? 'unavailable'
            : error
              ? 'degraded'
              : 'nominal',
        source: 'CelesTrak',
      };
    },

    getAnalystRecords(maxCount = 2000) {
      if (!enabled || !points) return [];
      const out = [];
      for (const item of points.items.values()) {
        if (out.length >= maxCount) break;
        out.push(satelliteGroupAnalystRecord(item.record, item.position));
      }
      return out;
    },

    destroy() {
      if (destroyed) return;
      layer.disable();
      destroyed = true;
      points?.destroy();
      graphics?.destroy();
      points = null;
      graphics = null;
      viewer = null;
      listener = null;
      groups.clear();
      records = [];
    },
  };
  return layer;
}

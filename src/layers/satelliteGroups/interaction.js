import * as Cesium from 'cesium';
import { isPointerFree } from '../../data/inputOwnership.js';
import {
  registerPickOwner,
  unregisterPickOwner,
  resolvePickId,
  isOwnedByOtherLayer,
} from '../../data/pickRegistry.js';

/**
 * Click selection shared by the space layers.
 *
 * Yields to draw tools and Director (pointer ownership), leaves picks owned by
 * sibling layers alone, and treats an empty-globe click as "clear". Escape
 * clears too. Never claims the camera or tracking state.
 *
 * @param {object} options
 * @param {object} options.viewer Cesium viewer.
 * @param {string} options.layerId Owning layer id for the pick registry.
 * @param {(id: string) => boolean} options.ownsPickId Pick-id predicate.
 * @param {(picked: object) => boolean} options.onPick Return true when handled.
 * @param {() => void} options.onClear Empty-space click / Escape.
 * @param {() => boolean} [options.active] Gate (layer enabled).
 * @param {object} [options.cesium]
 * @returns {{destroy: () => void}}
 */
export function installSpaceSelection({
  viewer,
  layerId,
  ownsPickId,
  onPick,
  onClear,
  active = () => true,
  cesium = Cesium,
}) {
  registerPickOwner(layerId, (id) => active() && ownsPickId(id));
  const canvas = viewer?.scene?.canvas;
  let handler = null;
  if (canvas && typeof cesium.ScreenSpaceEventHandler === 'function') {
    handler = new cesium.ScreenSpaceEventHandler(canvas);
    handler.setInputAction((click) => {
      if (!active() || !isPointerFree() || !click?.position) return;
      const picked = viewer.scene.pick(click.position);
      if (picked && onPick(picked)) return;
      const pickedId = resolvePickId(picked);
      if (pickedId && isOwnedByOtherLayer(layerId, pickedId)) return;
      // Photoreal tiles pick as tileset content with no id: empty map.
      if (!picked || picked.id === undefined) onClear();
    }, cesium.ScreenSpaceEventType.LEFT_CLICK);
  }
  const onKey = (event) => {
    if (active() && event.key === 'Escape') onClear();
  };
  globalThis.document?.addEventListener?.('keydown', onKey);
  return {
    destroy() {
      unregisterPickOwner(layerId);
      globalThis.document?.removeEventListener?.('keydown', onKey);
      if (handler && !handler.isDestroyed?.()) handler.destroy();
      handler = null;
    },
  };
}

/**
 * Selected-object card on the shared world-overlay host.
 * @param {object} options
 * @param {string} options.id Stable entry id.
 * @param {() => object|null} options.position Live Cartesian getter.
 * @param {string} options.title
 * @param {string[]} options.details
 * @param {string} options.accent
 * @returns {object}
 */
export function selectedSpaceCard({
  id,
  position,
  title,
  details,
  accent,
  selected = true,
  priority = Number.MAX_SAFE_INTEGER,
}) {
  return {
    id,
    position,
    variant: selected ? 'selected' : 'card',
    title,
    details,
    accent,
    selected,
    protected: selected,
    cardStyle: 'tactical',
    collisionGroup: 'ambient-card',
    paintLane: selected ? 'selected' : 'ambient-card',
    priority,
    edgeFade: 'keyhole',
    horizonCull: true,
    terrainOcclusion: false,
    interactive: false,
    gapPx: 14,
    leaderOffsetPx: 8,
    verticalOnly: true,
    viewportMargin: 6,
  };
}

/** Moving-source options for a handful of space cards. */
export const SPACE_CARD_SOURCE_OPTIONS = Object.freeze({
  cohortLimit: 8,
  collisionCapacity: 8,
  moving: true,
});

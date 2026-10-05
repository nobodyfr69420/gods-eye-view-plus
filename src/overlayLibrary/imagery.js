import * as Cesium from 'cesium';
import { resolveImageryHost } from '../layers/weather/imageryHost.js';

/**
 * Raster overlays (NASA GIBS WMS, XYZ tile sets, browser-rendered canvases)
 * as Cesium imagery layers. Imagery drapes on the globe when it is shown and
 * on the photoreal tileset's imagery collection otherwise — the same host
 * rule the weather layers use — and follows the user across map-stack changes.
 */

/** UTC date string (YYYY-MM-DD) for 'yesterday' / 'today', or null for default. */
export function imageryTime(spec, now = new Date()) {
  if (spec === 'yesterday')
    return new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
  if (spec === 'today') return now.toISOString().slice(0, 10);
  if (typeof spec === 'string' && /^\d{4}-\d\d-\d\d$/.test(spec)) return spec;
  return null;
}

/** Build the Cesium imagery provider for an overlay definition. */
export function createImageryProvider(def) {
  const spec = def.imagery;
  const credit = new Cesium.Credit(def.source || '');
  if (spec.provider === 'wms') {
    const time = imageryTime(spec.time);
    return new Cesium.WebMapServiceImageryProvider({
      url: spec.url,
      layers: spec.layers,
      parameters: {
        format: 'image/png',
        transparent: 'true',
        ...(time ? { time } : {}),
      },
      tilingScheme: new Cesium.GeographicTilingScheme(),
      maximumLevel: spec.maxLevel ?? 8,
      tileWidth: 256,
      tileHeight: 256,
      credit,
    });
  }
  return new Cesium.UrlTemplateImageryProvider({
    url: spec.url,
    subdomains: spec.subdomains,
    minimumLevel: spec.minLevel ?? 0,
    maximumLevel: spec.maxLevel ?? 18,
    credit,
  });
}

/**
 * Own one imagery layer on whichever surface can show it.
 * @returns {{setAlpha:Function,setVisible:Function,destroy:Function,status:Function,replaceProvider:Function}}
 */
export function createImageryOverlay({
  viewer,
  mapStackController,
  def,
  provider = null,
  alpha = 1,
  onStatus,
}) {
  let layer = null;
  let host = null;
  let tileErrors = 0;
  let removeError = null;
  let visible = true;
  let currentAlpha = alpha;
  let hostMessage = null;

  const resolveHost = () =>
    resolveImageryHost({
      viewer,
      tileset: mapStackController?.getImageryHostTileset?.(),
    });

  function attach(nextProvider) {
    detach();
    const p = nextProvider || createImageryProvider(def);
    removeError = p.errorEvent?.addEventListener?.((error) => {
      tileErrors++;
      // Let Cesium give up on a broken tile instead of retrying forever.
      if (error) error.retry = false;
      onStatus?.();
    });
    layer = new Cesium.ImageryLayer(p, {
      alpha: currentAlpha * (def.imagery?.alpha ?? 1),
    });
    layer.show = visible;
    place();
  }

  function place() {
    if (!layer) return;
    const next = resolveHost();
    hostMessage =
      next.kind === 'none'
        ? 'Hidden by this map source · choose a globe map'
        : null;
    if (host?.collection === next.collection) return;
    if (host?.collection?.contains?.(layer))
      host.collection.remove(layer, false);
    host = next;
    host.collection?.add(layer);
    viewer.scene.requestRender?.();
    onStatus?.();
  }

  function detach() {
    removeError?.();
    removeError = null;
    if (layer) {
      if (host?.collection?.contains?.(layer))
        host.collection.remove(layer, true);
      else if (!layer.isDestroyed?.()) layer.destroy?.();
    }
    layer = null;
    host = null;
  }

  const onStack = () => place();
  globalThis.addEventListener?.('gev:map-stack-changed', onStack);
  attach(provider);

  return {
    setAlpha(value) {
      currentAlpha = Math.max(0, Math.min(1, Number(value)));
      if (layer) layer.alpha = currentAlpha * (def.imagery?.alpha ?? 1);
      viewer.scene.requestRender?.();
    },
    setVisible(value) {
      visible = value !== false;
      if (layer) layer.show = visible;
      viewer.scene.requestRender?.();
    },
    replaceProvider(nextProvider) {
      attach(nextProvider);
    },
    status: () => ({ tileErrors, hostMessage }),
    destroy() {
      globalThis.removeEventListener?.('gev:map-stack-changed', onStack);
      detach();
      viewer.scene.requestRender?.();
    },
  };
}

/** Equirectangular canvas → whole-globe single-tile provider (async). */
export async function canvasImageryProvider(
  canvas,
  credit = 'Computed in browser',
) {
  return Cesium.SingleTileImageryProvider.fromUrl(
    canvas.toDataURL('image/png'),
    {
      rectangle: Cesium.Rectangle.MAX_VALUE,
      credit: new Cesium.Credit(credit),
    },
  );
}

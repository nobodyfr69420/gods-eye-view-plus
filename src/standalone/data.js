import { createApplicationData } from '../app/data.js';
import { overlayHost } from '../app/layers/overlayHost.js';
import { mountOverlayLibrary } from '../overlayLibrary/index.js';
import { getStandaloneCatalog } from './catalog.js';
export function createStandaloneData(options) {
  const data = createApplicationData({
    catalog: options?.catalog ?? getStandaloneCatalog(),
    ...options,
  });
  // The Overlay Library (OVERLAYS panel: 280+ overlays and the STATS tab).
  // Registered after the data manager so its stats can read every layer.
  const viewer = options?.scene?.viewer;
  if (viewer && typeof options?.defer === 'function') {
    try {
      options.defer(
        mountOverlayLibrary({
          viewer,
          mapStackController: options.scene.mapStackController,
          dataManager: data.dataManager,
          overlayHost,
        }),
      );
    } catch (error) {
      console.warn('[OverlayLibrary] failed to start', error);
    }
  }
  return data;
}

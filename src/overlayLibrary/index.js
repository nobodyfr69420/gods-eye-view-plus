import { createOverlayLibrary } from './library.js';
import { createOverlayPanel } from './panel.js';
import { createStatsView } from './stats.js';
import { createInfoCard } from './infoCard.js';
import { createWorldView } from './worldView.js';
import { createMeData } from '../me/meData.js';
import { createMeView } from '../me/meView.js';

/**
 * Mount the Overlay Library into the OVERLAYS panel (#overlay-panel, from
 * src/ui/templates/layer-panels.html). Returns a disposer.
 *
 * Shortcuts: L toggles the panel, Shift+L opens it on the STATS tab,
 * Shift+W on WORLD, Shift+M on ME.
 */
export function mountOverlayLibrary({
  viewer,
  mapStackController = null,
  dataManager = null,
  overlayHost = null,
  documentRef = document,
}) {
  const root = documentRef.getElementById('overlay-library-root');
  const panelEl = documentRef.getElementById('overlay-panel');
  if (!root || !panelEl || !viewer) return () => {};

  const header = panelEl.querySelector('.panel-header');
  const library = createOverlayLibrary({
    viewer,
    mapStackController,
    overlayHost,
  });
  // ME: your own location sources feed local overlays (src/me/).
  const meData = createMeData();
  const removeMeSources = meData.sourceIds.map((id) =>
    library.registerLocalSource(id, meData.overlaySource(id)),
  );
  const infoCard = createInfoCard({ host: documentRef.body });
  let stats = null;
  let world = null;
  let me = null;
  const panel = createOverlayPanel({
    root,
    library,
    onTabChange: () => syncStatsVisibility(),
  });
  stats = createStatsView({
    container: panel.statsContainer,
    library,
    viewer,
    dataManager,
  });

  world = createWorldView({
    container: panel.panelFor('world'),
    library,
    viewer,
  });
  me = createMeView({
    container: panel.panelFor('me'),
    meData,
    library,
    viewer,
  });

  function syncStatsVisibility() {
    const open = !panelEl.classList.contains('collapsed');
    stats?.setVisible(panel.tab === 'stats' && open);
    world?.setVisible(panel.tab === 'world' && open);
    me?.setVisible(panel.tab === 'me' && open);
    // Pin the tab strip right under the (sticky) panel header.
    if (header && !panelEl.classList.contains('collapsed'))
      requestAnimationFrame(() =>
        root.style.setProperty(
          '--ovl-sticky-top',
          `${header.offsetHeight + 4}px`,
        ),
      );
  }
  const observer = new MutationObserver(syncStatsVisibility);
  observer.observe(panelEl, { attributes: true, attributeFilter: ['class'] });
  syncStatsVisibility();

  const removePick = library.onPick((pick) => infoCard.show(pick));

  const collapseButton = panelEl.querySelector('.panel-collapse-btn');
  const onKeyDown = (event) => {
    if (
      event.defaultPrevented ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey
    )
      return;
    if (
      event.target?.matches?.(
        'select, input, textarea, [contenteditable="true"]',
      )
    )
      return;
    const key = event.key.toLowerCase();
    const collapsed = panelEl.classList.contains('collapsed');
    if (event.shiftKey && (key === 'w' || key === 'm')) {
      panel.setTab(key === 'w' ? 'world' : 'me');
      if (collapsed) collapseButton?.click();
      return;
    }
    if (key !== 'l') return;
    if (event.shiftKey) {
      panel.setTab('stats');
      if (collapsed) collapseButton?.click();
    } else {
      collapseButton?.click();
    }
  };
  documentRef.addEventListener('keydown', onKeyDown);

  // Small QA/automation seam, mirroring window.__gev* helpers elsewhere.
  globalThis.__gevOverlayLibrary = library;
  globalThis.__gevMe = meData;
  if (import.meta.env?.DEV === true) globalThis.__gevOverlayViewer = viewer;

  return () => {
    documentRef.removeEventListener('keydown', onKeyDown);
    observer.disconnect();
    removePick();
    stats?.destroy();
    world.destroy();
    me.destroy();
    for (const remove of removeMeSources) remove();
    meData.destroy();
    panel.destroy();
    infoCard.destroy();
    library.destroy();
    if (globalThis.__gevOverlayLibrary === library)
      delete globalThis.__gevOverlayLibrary;
    if (globalThis.__gevMe === meData) delete globalThis.__gevMe;
    if (globalThis.__gevOverlayViewer === viewer)
      delete globalThis.__gevOverlayViewer;
  };
}

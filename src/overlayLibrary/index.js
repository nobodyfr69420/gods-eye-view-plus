import { createOverlayLibrary } from './library.js';
import { createOverlayPanel } from './panel.js';
import { createStatsView } from './stats.js';
import { createInfoCard } from './infoCard.js';

/**
 * Mount the Overlay Library into the OVERLAYS panel (#overlay-panel, from
 * src/ui/templates/layer-panels.html). Returns a disposer.
 *
 * Shortcuts: L toggles the panel, Shift+L opens it on the STATS tab.
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
  const infoCard = createInfoCard({ host: documentRef.body });
  let stats = null;
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

  function syncStatsVisibility() {
    stats?.setVisible(
      panel.tab === 'stats' && !panelEl.classList.contains('collapsed'),
    );
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
    if (event.key.toLowerCase() !== 'l') return;
    const collapsed = panelEl.classList.contains('collapsed');
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
  if (import.meta.env?.DEV === true) globalThis.__gevOverlayViewer = viewer;

  return () => {
    documentRef.removeEventListener('keydown', onKeyDown);
    observer.disconnect();
    removePick();
    stats?.destroy();
    panel.destroy();
    infoCard.destroy();
    library.destroy();
    if (globalThis.__gevOverlayLibrary === library)
      delete globalThis.__gevOverlayLibrary;
    if (globalThis.__gevOverlayViewer === viewer)
      delete globalThis.__gevOverlayViewer;
  };
}

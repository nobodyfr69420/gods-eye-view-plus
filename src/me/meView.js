import * as Cesium from 'cesium';
import { forward as toMGRS } from 'mgrs';
import { barList, el, factGrid, statTile } from '../overlayLibrary/charts.js';
import {
  maidenheadLocator,
  solarElevation,
} from '../overlayLibrary/computedGeometry.js';
import { formatAge } from '../overlayLibrary/style.js';
import { ME_RANGES } from './meData.js';
import {
  byDevice,
  compass,
  deviceColor,
  formatDistance,
  formatDuration,
  places,
  stays,
  trackStats,
} from './trackMath.js';

/**
 * ME tab — track yourself, every way the machine allows:
 *  live browser geolocation (GPS / Wi-Fi), your phone's tracking app pushing
 *  to this server, an IP estimate, and history imported from Google Timeline,
 *  GPX/KML/GeoJSON/CSV files and photo EXIF. Readouts, stats, places,
 *  devices, phone setup, export, and a forget button. All text via
 *  textContent; nothing leaves the machine except the opt-in IP lookup.
 */

const OVERLAYS = [
  ['me-position', 'POSITION'],
  ['me-accuracy', 'ACCURACY'],
  ['me-trail', 'TRAIL'],
  ['me-places', 'PLACES'],
  ['me-photos', 'PHOTOS'],
];

function button(label, title) {
  const b = el('button', 'ovl-mini-btn', label);
  b.type = 'button';
  if (title) b.title = title;
  return b;
}

export function createMeView({ container, meData, library, viewer }) {
  let destroyed = false;
  let visible = false;
  let follow = false;
  let lastFollowAt = 0;
  let setupInfo = null;
  let revealToken = false;
  let forgetArmed = 0;
  const removers = [];
  const on = (target, type, fn) => {
    target.addEventListener(type, fn);
    removers.push(() => target.removeEventListener(type, fn));
  };
  const card = (title, ...children) => {
    const section = el('section', 'ovl-card');
    section.appendChild(el('h4', 'ovl-card-title', title));
    for (const child of children) if (child) section.appendChild(child);
    return section;
  };

  container.replaceChildren();
  container.classList.add('ovl-me');

  // ── LIVE ───────────────────────────────────────────────────────────────
  const trackBtn = button(
    '▶ START TRACKING',
    'Continuous high-accuracy location from this browser',
  );
  const onceBtn = button('LOCATE ONCE');
  const ipBtn = button(
    'IP LOCATE',
    'Approximate position of this machine from its public IP (asks ipwho.is)',
  );
  const flyBtn = button('FLY TO ME');
  const followBtn = button(
    'FOLLOW: OFF',
    'Keep the camera over your live position',
  );
  const liveActions = el('div', 'ovl-me-actions');
  liveActions.append(trackBtn, onceBtn, ipBtn, flyBtn, followBtn);
  const liveStatus = el('p', 'ovl-footnote');
  const liveFacts = el('div');
  const overlayChips = el('div', 'ovl-chips ovl-me-chips');
  overlayChips.setAttribute('aria-label', 'Show ME layers on the globe');
  for (const [id, label] of OVERLAYS) {
    const chip = el('button', 'ovl-chip', label);
    chip.type = 'button';
    chip.dataset.overlay = id;
    overlayChips.appendChild(chip);
  }
  container.appendChild(
    card('LIVE · WHERE AM I', liveActions, liveStatus, liveFacts, overlayChips),
  );

  // ── STATS ──────────────────────────────────────────────────────────────
  const rangeChips = el('div', 'ovl-chips');
  for (const [id, range] of Object.entries(ME_RANGES)) {
    const chip = el('button', 'ovl-chip', range.label);
    chip.type = 'button';
    chip.dataset.range = id;
    rangeChips.appendChild(chip);
  }
  const statTiles = el('div', 'ovl-tiles');
  const placeList = el('div');
  container.appendChild(
    card(
      'MY STATS',
      rangeChips,
      statTiles,
      el('div', 'ovl-world-subhead', 'TOP PLACES (HOURS)'),
      placeList,
    ),
  );

  // ── DEVICES ────────────────────────────────────────────────────────────
  const deviceList = el('div', 'ovl-me-devices');
  container.appendChild(card('MY DEVICES', deviceList));

  // ── PHONE SETUP ────────────────────────────────────────────────────────
  const setupBtn = button('SHOW PHONE SETUP');
  const setupBody = el('div', 'ovl-me-setup');
  setupBody.appendChild(
    el(
      'p',
      'ovl-footnote',
      'Track your phone 24/7: install OwnTracks, Overland, GPSLogger or Traccar Client and point it at this server. Fixes land here, on this machine only.',
    ),
  );
  container.appendChild(card('TRACK MY PHONE', setupBody, setupBtn));

  // ── IMPORT / EXPORT ────────────────────────────────────────────────────
  const fileInput = el('input');
  fileInput.type = 'file';
  fileInput.multiple = true;
  fileInput.accept = '.gpx,.kml,.json,.geojson,.csv,.tsv,.jpg,.jpeg,image/jpeg';
  fileInput.hidden = true;
  const drop = el(
    'div',
    'ovl-me-drop',
    'Drop Google Timeline / Takeout JSON, GPX, KML, GeoJSON, CSV or photos here — or click to choose',
  );
  drop.tabIndex = 0;
  drop.setAttribute('role', 'button');
  const importStatus = el('p', 'ovl-footnote');
  const exportRow = el('div', 'ovl-me-actions');
  const exportBtns = ['gpx', 'geojson', 'csv'].map((format) => {
    const b = button(
      `⤓ ${format.toUpperCase()}`,
      `Export the selected range as ${format.toUpperCase()}`,
    );
    b.dataset.format = format;
    exportRow.appendChild(b);
    return b;
  });
  container.appendChild(
    card(
      'IMPORT MY HISTORY · EXPORT',
      drop,
      fileInput,
      importStatus,
      el(
        'p',
        'ovl-footnote',
        'Google Maps Timeline: on your phone, Settings → Location → Location services → Timeline → Export Timeline data (or Takeout “Location History” on older accounts).',
      ),
      exportRow,
    ),
  );

  // ── PRIVACY ────────────────────────────────────────────────────────────
  const forgetBtn = button('FORGET ALL MY LOCATION DATA');
  container.appendChild(
    card(
      'PRIVACY',
      el(
        'p',
        'ovl-footnote',
        'Everything here is stored in .gev-cache/me/ on this machine and served only to this machine (or to whoever holds your ingest token). Nothing is uploaded anywhere; IP LOCATE is the one call that asks an outside service.',
      ),
      forgetBtn,
    ),
  );

  // ── behaviour ──────────────────────────────────────────────────────────
  on(trackBtn, 'click', () =>
    meData.state.tracking ? meData.stopTracking() : startTracking(),
  );
  on(onceBtn, 'click', async () => {
    ensureOverlay('me-position');
    const fix = await meData.locateOnce();
    if (fix) flyTo(fix, 3000);
  });
  on(ipBtn, 'click', async () => {
    ensureOverlay('me-position');
    ensureOverlay('me-accuracy');
    const ip = await meData.ipLocate();
    if (Number.isFinite(ip?.lat)) flyTo(ip, 120_000);
  });
  on(flyBtn, 'click', () => {
    const fix = bestFix();
    if (fix) flyTo(fix, 3000);
  });
  on(followBtn, 'click', () => {
    follow = !follow;
    paint();
  });
  on(overlayChips, 'click', (event) => {
    const chip = event.target.closest('[data-overlay]');
    if (chip) library.toggle(chip.dataset.overlay);
  });
  on(rangeChips, 'click', (event) => {
    const chip = event.target.closest('[data-range]');
    if (chip) meData.setRange(chip.dataset.range);
  });
  on(setupBtn, 'click', loadSetup);
  on(drop, 'click', () => fileInput.click());
  on(drop, 'keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      fileInput.click();
    }
  });
  on(drop, 'dragover', (event) => {
    event.preventDefault();
    drop.classList.add('is-over');
  });
  on(drop, 'dragleave', () => drop.classList.remove('is-over'));
  on(drop, 'drop', (event) => {
    event.preventDefault();
    drop.classList.remove('is-over');
    if (event.dataTransfer?.files?.length)
      importFiles(event.dataTransfer.files);
  });
  on(fileInput, 'change', () => {
    if (fileInput.files?.length) importFiles(fileInput.files);
    fileInput.value = '';
  });
  for (const b of exportBtns)
    on(b, 'click', async () => {
      try {
        const n = await meData.exportFixes(b.dataset.format);
        importStatus.textContent = `Exported ${n.toLocaleString()} fixes (${ME_RANGES[meData.state.range].label}).`;
      } catch (error) {
        importStatus.textContent = `Export failed: ${error.message}`;
      }
    });
  on(forgetBtn, 'click', async () => {
    if (Date.now() - forgetArmed > 5000) {
      forgetArmed = Date.now();
      forgetBtn.textContent = 'CLICK AGAIN TO DELETE EVERYTHING';
      return;
    }
    forgetArmed = 0;
    forgetBtn.textContent = 'FORGET ALL MY LOCATION DATA';
    try {
      const removed = await meData.forget();
      importStatus.textContent = `Deleted ${removed.toLocaleString()} stored fixes.`;
    } catch (error) {
      importStatus.textContent = `Could not delete: ${error.message}`;
    }
  });

  function startTracking() {
    ensureOverlay('me-position');
    ensureOverlay('me-accuracy');
    ensureOverlay('me-trail');
    meData.startTracking();
  }

  function ensureOverlay(id) {
    if (!library.isEnabled(id)) library.enable(id);
  }

  function bestFix() {
    const latest = [...meData.latestByDevice().values()].filter(
      (f) => f.device !== 'photos' && !String(f.device).startsWith('import'),
    );
    latest.sort((a, b) => b.t - a.t);
    return (
      meData.state.lastBrowserFix ||
      latest[0] ||
      (Number.isFinite(meData.state.ip?.lat) ? meData.state.ip : null)
    );
  }

  function flyTo(fix, height) {
    viewer?.camera?.flyTo?.({
      destination: Cesium.Cartesian3.fromDegrees(fix.lon, fix.lat, height),
      duration: 2,
    });
  }

  async function importFiles(files) {
    ensureOverlay('me-trail');
    importStatus.textContent = 'Reading…';
    try {
      const results = await meData.importFiles(
        files,
        ({ file, done, total }) => {
          importStatus.textContent = `${file}: uploading ${done.toLocaleString()} / ${total.toLocaleString()}`;
        },
      );
      importStatus.textContent = results
        .map(
          (r) =>
            `${r.file}: ${r.format}, ${r.parsed.toLocaleString()} points, ${r.added.toLocaleString()} new`,
        )
        .join(' · ');
      if (results.some((r) => r.format === 'photo')) ensureOverlay('me-photos');
      meData.setRange('all');
    } catch (error) {
      importStatus.textContent = `Import failed: ${error.message}`;
    }
  }

  async function loadSetup() {
    setupBtn.disabled = true;
    try {
      setupInfo = await meData.setup();
      paintSetup();
    } catch (error) {
      setupBody.replaceChildren(
        el(
          'p',
          'ovl-empty',
          `Setup info is only available on the machine running the server (${error.message}).`,
        ),
      );
    } finally {
      setupBtn.disabled = false;
    }
  }

  function copyButton(text, label = 'COPY') {
    const b = button(label);
    b.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(text);
        b.textContent = 'COPIED';
        setTimeout(() => (b.textContent = label), 1500);
      } catch {
        b.textContent = 'COPY FAILED';
      }
    });
    return b;
  }

  function paintSetup() {
    const info = setupInfo;
    if (!info) return;
    const base = info.lan[0]?.base ?? `http://<this-pc-ip>:${info.port}/api/me`;
    const token = info.token;
    const tokenRow = el('div', 'ovl-me-token');
    const tokenText = el(
      'code',
      '',
      revealToken ? token : `${'•'.repeat(12)}${token.slice(-4)}`,
    );
    const reveal = button(revealToken ? 'HIDE' : 'SHOW');
    reveal.addEventListener('click', () => {
      revealToken = !revealToken;
      paintSetup();
    });
    tokenRow.append(
      el('span', 'ovl-fact-label', 'TOKEN'),
      tokenText,
      reveal,
      copyButton(token),
    );
    const nodes = [tokenRow];
    if (!info.reachableOnLan)
      nodes.push(
        el(
          'p',
          'ovl-me-warn',
          'Your phone cannot reach this server yet: add HOST=0.0.0.0 to .env and restart npm run dev (same Wi-Fi). Away from home, put both devices on Tailscale and use the PC’s Tailscale IP.',
        ),
      );
    const apps = [
      [
        'OwnTracks (iOS / Android)',
        `Mode: HTTP · URL: ${base}/owntracks · Authentication on · Username: your device name · Password: the token`,
        `${base}/owntracks`,
      ],
      [
        'Overland (iOS / Android)',
        `Receiver endpoint: ${base}/overland?token=${revealToken ? token : '<token>'}`,
        `${base}/overland?token=${token}`,
      ],
      [
        'GPSLogger (Android) · Log to custom URL',
        `${base}/osmand?token=${revealToken ? token : '<token>'}&id=phone&lat=%LAT&lon=%LON&timestamp=%TIMESTAMP&altitude=%ALT&accuracy=%ACC&spd_ms=%SPD&bearing=%DIR&batt=%BATT`,
        `${base}/osmand?token=${token}&id=phone&lat=%LAT&lon=%LON&timestamp=%TIMESTAMP&altitude=%ALT&accuracy=%ACC&spd_ms=%SPD&bearing=%DIR&batt=%BATT`,
      ],
      [
        'Traccar Client (iOS / Android)',
        `Server URL: ${base}/osmand?token=${revealToken ? token : '<token>'} · Device identifier: phone`,
        `${base}/osmand?token=${token}`,
      ],
    ];
    for (const [name, text, copy] of apps) {
      const row = el('div', 'ovl-me-app');
      row.append(
        el('strong', '', name),
        el('code', '', text),
        copyButton(copy, 'COPY URL'),
      );
      nodes.push(row);
    }
    if (info.lan.length > 1)
      nodes.push(
        el(
          'p',
          'ovl-footnote',
          `Other addresses of this PC: ${info.lan
            .slice(1)
            .map((a) => `${a.address} (${a.name})`)
            .join(', ')}`,
        ),
      );
    nodes.push(
      el(
        'p',
        'ovl-footnote',
        info.tokenFromEnv
          ? 'Token comes from ME_INGEST_TOKEN in .env.'
          : 'Token was generated for this machine (.gev-cache/me/ingest-token). `npm run keys` pins one in .env.',
      ),
    );
    setupBody.replaceChildren(...nodes);
  }

  // ── painting ───────────────────────────────────────────────────────────
  function paint() {
    if (destroyed) return;
    const s = meData.state;
    trackBtn.textContent = s.tracking ? '■ STOP TRACKING' : '▶ START TRACKING';
    trackBtn.classList.toggle('is-on', s.tracking);
    followBtn.textContent = follow ? 'FOLLOW: ON' : 'FOLLOW: OFF';
    followBtn.classList.toggle('is-on', follow);
    for (const chip of overlayChips.children) {
      const onNow = library.isEnabled(chip.dataset.overlay);
      chip.classList.toggle('active', onNow);
      chip.setAttribute('aria-pressed', String(onNow));
    }
    for (const chip of rangeChips.children) {
      const onNow = chip.dataset.range === s.range;
      chip.classList.toggle('active', onNow);
      chip.setAttribute('aria-pressed', String(onNow));
    }

    const fix = bestFix();
    liveStatus.textContent = s.trackingError
      ? s.trackingError
      : s.tracking
        ? `Tracking this browser · ${s.lastBrowserFix ? `last fix ${formatAge(s.lastBrowserFix.t)}` : 'waiting for first fix…'}`
        : fix
          ? `Latest: ${fix.device ?? 'IP estimate'} · ${fix.t ? formatAge(fix.t) : 'just now'}`
          : 'Not tracking. Start tracking, locate once, or connect your phone below.';
    if (fix) {
      let mgrs = '—';
      try {
        mgrs = toMGRS([fix.lon, fix.lat], 5);
      } catch {
        /* polar */
      }
      const sun = solarElevation(fix.lat, fix.lon, new Date());
      liveFacts.replaceChildren(
        factGrid([
          ['Latitude', `${fix.lat.toFixed(6)}°`],
          ['Longitude', `${fix.lon.toFixed(6)}°`],
          ['MGRS', mgrs],
          ['Maidenhead', maidenheadLocator(fix.lat, fix.lon)],
          [
            'Accuracy',
            Number.isFinite(fix.acc)
              ? `±${Math.round(fix.acc)} m (${fix.acc <= 30 ? 'GPS-grade' : fix.acc <= 150 ? 'Wi-Fi-grade' : 'coarse'})`
              : fix.note
                ? 'city-level (IP)'
                : null,
          ],
          [
            'Altitude',
            Number.isFinite(fix.alt) ? `${Math.round(fix.alt)} m` : null,
          ],
          [
            'Speed',
            Number.isFinite(fix.spd)
              ? `${(fix.spd * 3.6).toFixed(1)} km/h · ${(fix.spd * 2.23694).toFixed(1)} mph`
              : null,
          ],
          ['Heading', Number.isFinite(fix.hdg) ? compass(fix.hdg) : null],
          ['Battery', Number.isFinite(fix.batt) ? `${fix.batt}%` : null],
          ['Sun elevation', Number.isFinite(sun) ? `${sun.toFixed(1)}°` : null],
          [
            'Source',
            fix.src || fix.source || (fix.isp ? `IP · ${fix.isp}` : null),
          ],
        ]),
      );
    } else liveFacts.replaceChildren();

    // Stats over the chosen range, per device, summed.
    const all = meData.allFixes().filter((f) => f.device !== 'photos');
    let totals = {
      distanceM: 0,
      movingMs: 0,
      maxSpeedMs: 0,
      gainM: 0,
      fixes: 0,
    };
    const allStays = [];
    for (const [, list] of byDevice(all)) {
      const t = trackStats(list);
      totals = {
        distanceM: totals.distanceM + t.distanceM,
        movingMs: totals.movingMs + t.movingMs,
        maxSpeedMs: Math.max(totals.maxSpeedMs, t.maxSpeedMs),
        gainM: totals.gainM + t.gainM,
        fixes: totals.fixes + t.fixes,
      };
      allStays.push(...stays(list));
    }
    const avg =
      totals.movingMs > 0 ? totals.distanceM / (totals.movingMs / 1000) : 0;
    const days = new Set(all.map((f) => new Date(f.t).toDateString())).size;
    statTiles.replaceChildren(
      statTile(
        'DISTANCE',
        formatDistance(totals.distanceM),
        `${(totals.distanceM / 1609.344).toFixed(1)} mi`,
      ),
      statTile(
        'MOVING TIME',
        formatDuration(totals.movingMs),
        `${days} day${days === 1 ? '' : 's'} with data`,
      ),
      statTile(
        'MAX SPEED',
        `${(totals.maxSpeedMs * 3.6).toFixed(0)} km/h`,
        `avg ${(avg * 3.6).toFixed(1)} km/h moving`,
      ),
      statTile(
        'CLIMBED',
        `${Math.round(totals.gainM)} m`,
        `${totals.fixes.toLocaleString()} fixes`,
      ),
    );
    const top = places(allStays).slice(0, 6);
    placeList.replaceChildren(
      barList(
        top.map((p, i) => ({
          label: `#${i + 1}  ${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}`,
          value: p.dwellMs,
          display: `${(p.dwellMs / 3_600_000).toFixed(1)} h`,
          note: `${p.visits} visit${p.visits === 1 ? '' : 's'}`,
          swatch: '#ffe082',
        })),
        { emptyText: 'No stays of 10+ minutes in this range yet.' },
      ),
    );

    // Devices.
    const latest = meData.latestByDevice();
    const rows = [];
    for (const [device, f] of latest) {
      const meta = s.devices.find((d) => d.device === device);
      const row = el('div', 'ovl-me-device');
      const dot = el('span', 'ovl-swatch');
      dot.style.setProperty('--ovl-color', deviceColor(device));
      const text = el('div', 'ovl-me-device-text');
      text.append(
        el('strong', '', device),
        el(
          'span',
          'ovl-footnote',
          [
            f.src,
            formatAge(f.t),
            Number.isFinite(f.batt) ? `${f.batt}% battery` : null,
            meta ? `${meta.count.toLocaleString()} fixes` : null,
          ]
            .filter(Boolean)
            .join(' · '),
        ),
      );
      const fly = button('FLY');
      fly.addEventListener('click', () => flyTo(f, 3000));
      const forget = button('FORGET');
      forget.addEventListener('click', async () => {
        if (forget.dataset.armed) {
          await meData.forget(device);
        } else {
          forget.dataset.armed = '1';
          forget.textContent = 'SURE?';
          setTimeout(() => {
            delete forget.dataset.armed;
            forget.textContent = 'FORGET';
          }, 4000);
        }
      });
      row.append(dot, text, fly, forget);
      rows.push(row);
    }
    deviceList.replaceChildren(
      ...(rows.length
        ? rows
        : [
            el(
              'p',
              'ovl-empty',
              s.error
                ? `ME server unavailable (${s.error}).`
                : 'No devices yet.',
            ),
          ]),
    );

    // Follow mode: glide to the newest live fix at most every 2 s.
    if (follow && fix && Date.now() - lastFollowAt > 2000) {
      lastFollowAt = Date.now();
      const height = Math.min(
        Math.max(viewer?.camera?.positionCartographic?.height ?? 2000, 300),
        50_000,
      );
      viewer?.camera?.flyTo?.({
        destination: Cesium.Cartesian3.fromDegrees(fix.lon, fix.lat, height),
        duration: 1,
      });
    }
  }

  // A timer, not requestAnimationFrame: follow mode must keep working while
  // the tab is in the background (rAF stops in hidden tabs).
  let frame = 0;
  const schedule = () => {
    if (frame) return;
    frame = setTimeout(() => {
      frame = 0;
      if (visible || follow) paint();
    }, 120);
  };
  removers.push(meData.subscribe(schedule));
  removers.push(library.subscribe(schedule));
  const ageTimer = setInterval(schedule, 5000);
  removers.push(() => clearInterval(ageTimer));
  let release = null;

  return {
    setVisible(next) {
      visible = Boolean(next);
      if (visible && !release) release = meData.retain();
      if (!visible && release) {
        release();
        release = null;
      }
      if (visible) paint();
    },
    destroy() {
      destroyed = true;
      clearTimeout(frame);
      release?.();
      for (const remove of removers.splice(0)) remove();
      container.replaceChildren();
    },
  };
}

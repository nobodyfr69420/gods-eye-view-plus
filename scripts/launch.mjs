#!/usr/bin/env node
/**
 * One-click launcher (Start-GodsEyeView.cmd / .command / the desktop icon).
 *
 *  1. checks Node, installs dependencies when node_modules is missing or stale;
 *  2. first run: creates .env (imports keys from other installs, generates the
 *     ME token) via scripts/keys.mjs;
 *  3. reuses a server that is already running, otherwise starts one;
 *  4. opens the app in its own window (Chrome/Edge app mode) or the default
 *     browser; closing the launcher window stops the server.
 *
 * Flags: --tab (normal browser tab) · --no-open · --lan (HOST=0.0.0.0 so your
 * phone's tracking app can reach the ME endpoints) · --shortcut (create the
 * desktop icon and exit).
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { projectRoot } from './project-root.mjs';

const ROOT = projectRoot(import.meta.url);
const args = new Set(process.argv.slice(2));
const isWin = process.platform === 'win32';
const tty = process.stdout.isTTY;
const c = (code, text) => (tty ? `\x1b[${code}m${text}\x1b[0m` : text);
const say = (text) => console.log(`  ${text}`);

function fail(message) {
  console.error(`\n  ${c('31', '✗')} ${message}\n`);
  process.exit(1);
}

/** engines: ">=24.14.0 <25 || >=26 <27" */
export function nodeSupported(version = process.versions.node) {
  const [major, minor] = version.split('.').map(Number);
  return (major === 24 && minor >= 14) || major === 26;
}

function run(cmd, cmdArgs, label) {
  say(c('2', `${label}…`));
  const result = spawnSync(cmd, cmdArgs, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: isWin && cmd === 'npm',
  });
  if (result.status !== 0) fail(`${label} failed (exit ${result.status}).`);
}

function dependenciesStale() {
  const marker = path.join(ROOT, 'node_modules', '.package-lock.json');
  if (!fs.existsSync(marker)) return true;
  try {
    return (
      fs.statSync(path.join(ROOT, 'package-lock.json')).mtimeMs >
      fs.statSync(marker).mtimeMs + 1000
    );
  } catch {
    return true;
  }
}

function envPort() {
  try {
    const env = parseEnv(fs.readFileSync(path.join(ROOT, '.env'), 'utf8'));
    const port = Number(process.env.PORT || env.PORT);
    return Number.isInteger(port) && port > 0 ? port : 4173;
  } catch {
    return Number(process.env.PORT) || 4173;
  }
}

async function runningAt(port) {
  try {
    const response = await fetch(`http://localhost:${port}/`, {
      signal: AbortSignal.timeout(1500),
    });
    const text = await response.text();
    return response.ok && /God(?:&#39;|')s Eye View/i.test(text);
  } catch {
    return false;
  }
}

// ── browser ───────────────────────────────────────────────────────────────

function findAppBrowser() {
  if (isWin) {
    const local = process.env.LOCALAPPDATA || '';
    const candidates = [
      path.join(
        process.env.ProgramFiles || 'C:\\Program Files',
        'Google\\Chrome\\Application\\chrome.exe',
      ),
      path.join(
        process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
        'Google\\Chrome\\Application\\chrome.exe',
      ),
      path.join(local, 'Google\\Chrome\\Application\\chrome.exe'),
      path.join(
        process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
        'Microsoft\\Edge\\Application\\msedge.exe',
      ),
      path.join(
        process.env.ProgramFiles || 'C:\\Program Files',
        'Microsoft\\Edge\\Application\\msedge.exe',
      ),
    ];
    return candidates.find((file) => fs.existsSync(file)) ?? null;
  }
  if (process.platform === 'darwin') {
    for (const app of ['Google Chrome', 'Microsoft Edge', 'Chromium'])
      if (fs.existsSync(`/Applications/${app}.app`))
        return `/Applications/${app}.app/Contents/MacOS/${app}`;
    return null;
  }
  for (const bin of [
    'google-chrome',
    'chromium',
    'chromium-browser',
    'microsoft-edge',
  ]) {
    const found = spawnSync('which', [bin], { encoding: 'utf8' });
    if (found.status === 0) return found.stdout.trim();
  }
  return null;
}

function openApp(url) {
  const detached = { detached: true, stdio: 'ignore', windowsHide: false };
  const browser = args.has('--tab') ? null : findAppBrowser();
  try {
    if (browser) {
      spawn(browser, [`--app=${url}`, '--start-maximized'], detached).unref();
      return 'its own window';
    }
    if (isWin)
      spawn('cmd.exe', ['/c', 'start', '""', url], {
        ...detached,
        windowsHide: true,
      }).unref();
    else
      spawn(
        process.platform === 'darwin' ? 'open' : 'xdg-open',
        [url],
        detached,
      ).unref();
    return 'your browser';
  } catch {
    return null;
  }
}

// ── desktop shortcut ──────────────────────────────────────────────────────

export function createShortcut() {
  const desktop = path.join(os.homedir(), 'Desktop');
  const oneDriveDesktop = path.join(os.homedir(), 'OneDrive', 'Desktop');
  const targetDir =
    fs.existsSync(oneDriveDesktop) && !fs.existsSync(desktop)
      ? oneDriveDesktop
      : desktop;
  if (isWin) {
    // Windows Script Host ships with every Windows install (no PowerShell
    // needed) and knows the real Desktop, including OneDrive-redirected ones.
    const target = path.join(ROOT, 'Start-GodsEyeView.cmd');
    const icon = path.join(ROOT, 'launcher', 'gods-eye-view.ico');
    const vbs = path.join(os.tmpdir(), `gev-shortcut-${process.pid}.vbs`);
    const q = (s) => s.replace(/"/g, '""');
    const script = [
      'Set shell = CreateObject("WScript.Shell")',
      'path = shell.SpecialFolders("Desktop") & "\\God\'s Eye View.lnk"',
      'Set link = shell.CreateShortcut(path)',
      `link.TargetPath = "${q(target)}"`,
      `link.WorkingDirectory = "${q(ROOT)}"`,
      `link.IconLocation = "${q(icon)},0"`,
      'link.WindowStyle = 7',
      'link.Description = "God\'s Eye View: start the server and open the app"',
      'link.Save',
      'WScript.Echo path',
    ].join('\r\n');
    // UTF-16 with BOM so non-ASCII folder names survive cscript.
    fs.writeFileSync(vbs, Buffer.from(`\ufeff${script}`, 'utf16le'));
    const result = spawnSync('cscript.exe', ['//nologo', vbs], {
      encoding: 'utf8',
      windowsHide: true,
    });
    fs.rmSync(vbs, { force: true });
    if (result.status !== 0)
      throw new Error(result.stderr || result.stdout || 'cscript failed');
    return result.stdout.trim();
  }
  if (process.platform === 'darwin') {
    const link = path.join(targetDir, "God's Eye View.command");
    fs.writeFileSync(
      link,
      `#!/bin/bash\ncd "${ROOT}" && exec node scripts/launch.mjs "$@"\n`,
      { mode: 0o755 },
    );
    return link;
  }
  const link = path.join(targetDir, 'gods-eye-view.desktop');
  fs.writeFileSync(
    link,
    `[Desktop Entry]\nType=Application\nName=God's Eye View\nExec=node "${path.join(ROOT, 'scripts', 'launch.mjs')}"\nPath=${ROOT}\nIcon=${path.join(ROOT, 'public', 'logo.svg')}\nTerminal=true\n`,
    { mode: 0o755 },
  );
  return link;
}

// ── main ──────────────────────────────────────────────────────────────────

async function main() {
  process.title = "God's Eye View";
  console.log(`\n  ${c('36;1', "GOD'S EYE VIEW")} ${c('2', ROOT)}\n`);
  if (!nodeSupported())
    fail(
      `Node ${process.versions.node} is installed, but this app needs Node 24 (24.14+) or 26. Get it from https://nodejs.org`,
    );

  if (args.has('--shortcut')) {
    say(`${c('32', '✓')} desktop icon: ${createShortcut()}`);
    return;
  }

  if (dependenciesStale())
    run(
      'npm',
      ['ci', '--no-audit', '--no-fund'],
      'Installing dependencies (first run takes a few minutes)',
    );
  if (!fs.existsSync(path.join(ROOT, '.env')))
    run(
      process.execPath,
      [path.join(ROOT, 'scripts', 'keys.mjs'), '--no-check'],
      'Setting up keys',
    );

  const port = envPort();
  if (await runningAt(port)) {
    const url = `http://localhost:${port}/`;
    const where = args.has('--no-open') ? null : openApp(url);
    say(
      `${c('32', '✓')} already running at ${url}${where ? ` — opened in ${where}` : ''}`,
    );
    return;
  }

  // The server runs inside this process (Vite's API, like the Pinokio
  // launcher), so closing this window always stops it — no orphaned child.
  if (args.has('--lan')) process.env.HOST = '0.0.0.0';
  process.chdir(ROOT);
  say(c('2', 'Starting the server…'));
  const { createServer } = await import('vite');
  const server = await createServer({ root: ROOT });
  await server.listen();
  server.printUrls();
  const url =
    server.resolvedUrls?.local?.[0] ??
    `http://localhost:${server.config.server.port ?? port}/`;
  const where = args.has('--no-open') ? null : openApp(url);
  console.log();
  say(
    `${c('32', '✓')} ${c('1', 'Ready')} at ${url}${where ? ` — opened in ${where}` : ''}`,
  );
  say(
    c(
      '2',
      'Keep this window open while you use the app; close it (or press Ctrl+C) to stop.',
    ),
  );
  if (process.env.HOST === '0.0.0.0')
    say(
      c('2', 'LAN mode: your phone can reach the ME endpoints on this Wi-Fi.'),
    );
  console.log();
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await server.close().catch(() => {});
    process.exit(0);
  };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'])
    process.on(signal, close);
}

const invokedDirectly =
  process.argv[1] &&
  path.resolve(process.argv[1]).toLowerCase() ===
    fileURLToPath(import.meta.url).toLowerCase();
if (invokedDirectly)
  main().catch((error) => fail(error?.message || String(error)));

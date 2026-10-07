#!/usr/bin/env node
/**
 * `npm run keys` — get every API key in place with as little typing as possible.
 *
 *   npm run keys                 status, import from other installs, generate
 *                                local secrets, live-check every key
 *   npm run keys -- --setup      guided: opens each missing provider's key page
 *                                and files the key the moment you COPY it
 *                                (clipboard watch), validating it live first
 *   npm run keys -- --open       open every missing provider's key page at once
 *   npm run keys -- --import DIR also import from this folder's .env
 *   npm run keys -- --no-import / --no-check / --only id,id
 *
 * Values are never printed — only a 4-character suffix. Keys are written to
 * this checkout's .env (created from .env.example when absent) with the same
 * upsert rules and file hardening the in-app POWER UP panel uses.
 * Restart `npm run dev` afterwards so the server picks them up.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { parseEnv } from 'node:util';
import { projectRoot } from './project-root.mjs';
import { upsertDotenvValues } from '../src/keySetupCore.mjs';
import {
  GENERATED_SECRETS,
  classifyCandidate,
  entryForEnvVar,
  isWritableValue,
  maskKey,
  planImport,
  probeKey,
  wizardEntries,
  wizardEnvVars,
} from '../src/keyWizardCore.mjs';
import { hardenCredentialFile } from '../server/standalone/key-setup-hardening.mjs';

const ROOT = projectRoot(import.meta.url);
const ENV_PATH = path.join(ROOT, '.env');
const EXAMPLE_PATH = path.join(ROOT, '.env.example');
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const tty = process.stdout.isTTY;
const c = (code, text) => (tty ? `\x1b[${code}m${text}\x1b[0m` : text);
const green = (t) => c('32', t);
const red = (t) => c('31', t);
const yellow = (t) => c('33', t);
const cyan = (t) => c('36', t);
const dim = (t) => c('2', t);
const bold = (t) => c('1', t);

function readEnvFile(file) {
  try {
    return parseEnv(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  } catch {
    return null;
  }
}

function currentEnv() {
  const fromFile = readEnvFile(ENV_PATH) ?? {};
  const merged = { ...fromFile };
  for (const name of wizardEnvVars())
    if (!String(merged[name] ?? '').trim() && process.env[name])
      merged[name] = process.env[name];
  return { fromFile, merged };
}

function writeEnv(updates) {
  const names = Object.keys(updates);
  if (!names.length) return;
  for (const [name, value] of Object.entries(updates))
    if (!isWritableValue(value))
      throw new Error(
        `${name} contains characters a .env line cannot hold unquoted (# " ' $ \\ \` or spaces) — add it by hand`,
      );
  let text = '';
  if (fs.existsSync(ENV_PATH)) text = fs.readFileSync(ENV_PATH, 'utf8');
  else if (fs.existsSync(EXAMPLE_PATH))
    text = fs.readFileSync(EXAMPLE_PATH, 'utf8');
  const next = upsertDotenvValues(text, updates);
  const tmp = `${ENV_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, '', { mode: 0o600 });
  if (
    !hardenCredentialFile(tmp) &&
    !restrictWithIcacls(tmp) &&
    !writeEnv.warned
  ) {
    writeEnv.warned = true;
    console.warn(
      yellow('  ! could not restrict .env to your account; writing anyway'),
    );
  }
  fs.writeFileSync(tmp, next, 'utf8');
  fs.renameSync(tmp, ENV_PATH);
}

/**
 * Windows fallback when the full hardening's Windows PowerShell 5.1 verify
 * step cannot start: apply the same owner/SYSTEM/Administrators-only DACL with
 * icacls and confirm it by reading icacls' own listing back.
 */
function restrictWithIcacls(file) {
  if (process.platform !== 'win32') return false;
  const sys = process.env.SystemRoot || 'C:\\Windows';
  const whoami = spawnSync(
    path.join(sys, 'System32', 'whoami.exe'),
    ['/user', '/fo', 'csv', '/nh'],
    {
      encoding: 'utf8',
      windowsHide: true,
    },
  );
  const sid = /"(S-1-(?:5-21|12-1)-\d+-\d+-\d+-\d+)"/i.exec(
    whoami.stdout ?? '',
  )?.[1];
  if (!sid) return false;
  const icacls = path.join(sys, 'System32', 'icacls.exe');
  const applied = spawnSync(
    icacls,
    [
      file,
      '/inheritance:r',
      '/grant:r',
      `*${sid}:F`,
      '*S-1-5-18:F',
      '*S-1-5-32-544:F',
    ],
    { windowsHide: true },
  );
  if (applied.status !== 0) return false;
  const listing = spawnSync(icacls, [file], {
    encoding: 'utf8',
    windowsHide: true,
  });
  const rules = String(listing.stdout ?? '')
    .split(/\r?\n/)
    .map((line) => line.replace(file, '').trim())
    .filter((line) => /:\([A-Z,()]+\)$/.test(line));
  return rules.length === 3 && rules.every((rule) => /:\(F\)$/.test(rule));
}

// ── Discovery of other installs ───────────────────────────────────────────

function isGevCheckout(dir) {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(dir, 'package.json'), 'utf8'),
    );
    return pkg?.name === 'gods-eye-view';
  } catch {
    return false;
  }
}

function discoverInstalls() {
  const home = os.homedir();
  const roots = [
    home,
    'Desktop',
    'OneDrive/Desktop',
    'Documents',
    'OneDrive/Documents',
    'Downloads',
    'source/repos',
    'Projects',
    'projects',
    'code',
    'dev',
    'src',
    'repos',
    'GitHub',
    'pinokio/api',
  ].map((p) => (path.isAbsolute(p) ? p : path.join(home, p)));
  const extra = option('--import');
  if (extra) roots.unshift(path.resolve(extra));
  const found = new Map();
  const visit = (dir, depth) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (isGevCheckout(dir)) {
      found.set(path.resolve(dir), true);
      return;
    }
    if (depth <= 0) return;
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (/^(\.|node_modules$|AppData$|Library$)/.test(entry.name)) continue;
      visit(path.join(dir, entry.name), depth - 1);
    }
  };
  for (const root of roots) visit(root, 2);
  found.delete(path.resolve(ROOT));
  const sources = [];
  for (const dir of found.keys()) {
    for (const rel of ['.env', '.env.local', 'pinokio/ENVIRONMENT']) {
      const env = readEnvFile(path.join(dir, rel));
      if (env && Object.keys(env).length)
        sources.push({ label: path.join(dir, rel), env });
    }
  }
  return sources;
}

// ── Clipboard / browser helpers ───────────────────────────────────────────

function readClipboard() {
  const run = (cmd, cmdArgs) => {
    const r = spawnSync(cmd, cmdArgs, {
      encoding: 'utf8',
      timeout: 4000,
      windowsHide: true,
    });
    return r.status === 0 ? String(r.stdout ?? '') : null;
  };
  if (process.platform === 'win32') {
    // PowerShell 7 first: some machines carry a broken Windows PowerShell 5.1.
    const shell = (readClipboard.shell ??=
      ['pwsh.exe', 'powershell.exe'].find(
        (exe) =>
          run(exe, ['-NoProfile', '-NonInteractive', '-Command', '1']) !== null,
      ) ?? null);
    return shell
      ? run(shell, [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          'Get-Clipboard -Raw',
        ])
      : null;
  }
  if (process.platform === 'darwin') return run('pbpaste', []);
  return (
    run('wl-paste', ['-n']) ?? run('xclip', ['-o', '-selection', 'clipboard'])
  );
}

function openUrl(url) {
  if (!/^https:\/\//.test(url)) return;
  const [cmd, cmdArgs] =
    process.platform === 'win32'
      ? ['cmd.exe', ['/c', 'start', '""', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  try {
    spawn(cmd, cmdArgs, {
      stdio: 'ignore',
      detached: true,
      windowsHide: true,
    }).unref();
  } catch {
    /* the URL is printed too */
  }
}

// ── Reporting ─────────────────────────────────────────────────────────────

const VERDICT = {
  valid: green('✓ valid'),
  invalid: red('✗ rejected'),
  unverified: yellow('? unverified'),
  skipped: dim('· not checked'),
};

async function checkAll(env, only) {
  const entries = wizardEntries(env).filter(
    (e) => e.set && (!only || only.has(e.id)),
  );
  const results = await Promise.all(
    entries.map((entry) =>
      probeKey(
        entry.id,
        Object.fromEntries(entry.envVars.map((n) => [n, env[n]])),
      ),
    ),
  );
  return new Map(results.map((r) => [r.id, r]));
}

function printStatus(env, checks) {
  console.log(bold('\n  PROVIDER KEYS'));
  for (const entry of wizardEntries(env)) {
    const tier = entry.tier === 'metered' ? red('●') : yellow('●');
    const name = entry.title.padEnd(22);
    if (!entry.set) {
      const partial = entry.vars.some((v) => v.set) ? ' (incomplete)' : '';
      console.log(
        `  ${tier} ${name} ${dim('missing' + partial)}  ${dim(entry.unlocks)}`,
      );
      continue;
    }
    const check = checks?.get(entry.id);
    const suffix = entry.envVars.map((n) => maskKey(env[n])).join(' ');
    console.log(
      `  ${tier} ${name} ${check ? VERDICT[check.result] : green('set')} ${dim(suffix)}${check?.note ? dim(` — ${check.note}`) : ''}`,
    );
  }
  console.log(bold('\n  LOCAL SECRETS'));
  for (const secret of GENERATED_SECRETS) {
    const set = String(env[secret.envVar] ?? '').trim();
    console.log(
      `  ${cyan('●')} ${secret.title.padEnd(22)} ${set ? green('set') + ' ' + dim(maskKey(set)) : dim('missing')}  ${dim(secret.purpose)}`,
    );
  }
  console.log(
    dim(
      `\n  ${red('●')} metered (billing account)  ${yellow('●')} free sign-up  ${cyan('●')} generated here`,
    ),
  );
}

// ── Guided setup ──────────────────────────────────────────────────────────

function ask(rl, prompt) {
  return new Promise((resolve) => rl.question(prompt, resolve));
}

/** Wait for either a clipboard change that classifies, or a typed line. */
function captureKey(rl, { expected, missing }) {
  return new Promise((resolve) => {
    let last = readClipboard();
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      clearInterval(timer);
      rl.off('line', onLine);
      resolve(value);
    };
    const onLine = (line) => {
      const text = line.trim();
      if (text === '' || text.toLowerCase() === 's') return finish(null);
      if (text.toLowerCase() === 'q') return finish('quit');
      const hit = classifyCandidate(text, { expected, missing });
      if (hit) finish(hit);
      else
        console.log(
          yellow(`    that doesn't look like a ${expected} value — try again`),
        );
    };
    rl.on('line', onLine);
    const timer = setInterval(() => {
      const now = readClipboard();
      if (now === null || now === last) return;
      last = now;
      const hit = classifyCandidate(now, { expected, missing });
      if (hit) finish(hit);
    }, 1200);
  });
}

async function guidedSetup(only) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  console.log(
    bold('\n  GUIDED SETUP') +
      dim(
        ' — for each provider: the key page opens; sign in and COPY the key.\n  It is captured from the clipboard, checked live and saved. Or paste it here + Enter.\n  Enter on an empty line skips, q quits.\n',
      ),
  );
  let saved = 0;
  outer: for (;;) {
    const env = currentEnv().merged;
    const missingVars = new Set(
      wizardEntries(env).flatMap((e) =>
        e.vars.filter((v) => !v.set).map((v) => v.name),
      ),
    );
    const next = wizardEntries(env).find(
      (e) =>
        !e.set &&
        !e.hidden &&
        (!only || only.has(e.id)) &&
        !guidedSetup.skipped.has(e.id),
    );
    if (!next) break;
    console.log(
      `\n  ${bold(next.title)} ${dim('— ' + next.unlocks)}\n  ${cyan(next.getUrl)}`,
    );
    const go = (
      await ask(rl, `  open the key page? [Enter = open, s = skip, q = quit] `)
    )
      .trim()
      .toLowerCase();
    if (go === 'q') break;
    if (go === 's') {
      guidedSetup.skipped.add(next.id);
      continue;
    }
    openUrl(next.getUrl);
    const values = {};
    for (const variable of next.vars.filter((v) => !v.set)) {
      console.log(
        dim(`    waiting for ${variable.name} … (copy it, or paste + Enter)`),
      );
      const hit = await captureKey(rl, {
        expected: variable.name,
        missing: missingVars,
      });
      if (hit === 'quit') break outer;
      if (!hit) {
        guidedSetup.skipped.add(next.id);
        continue outer;
      }
      if (hit.envVar !== variable.name) {
        // A distinctive key for another provider was copied — file it too.
        const other = entryForEnvVar(hit.envVar);
        const verdict = await probeKey(other.id, {
          ...Object.fromEntries(other.envVars.map((n) => [n, env[n]])),
          [hit.envVar]: hit.value,
        });
        if (verdict.result !== 'invalid' && other.envVars.length === 1) {
          writeEnv({ [hit.envVar]: hit.value });
          saved++;
          console.log(
            green(
              `    ✓ that was a ${other.title} key ${maskKey(hit.value)} — saved it`,
            ),
          );
        }
        continue outer;
      }
      values[variable.name] = hit.value;
      console.log(dim(`    got ${maskKey(hit.value)}`));
    }
    const all = Object.fromEntries(
      next.envVars.map((n) => [n, values[n] ?? env[n]]),
    );
    process.stdout.write(dim('    checking with the provider… '));
    const verdict = await probeKey(next.id, all);
    console.log(
      `${VERDICT[verdict.result]}${verdict.note ? dim(' — ' + verdict.note) : ''}`,
    );
    if (verdict.result === 'invalid') {
      const retry = (await ask(rl, '  save anyway? [y/N] '))
        .trim()
        .toLowerCase();
      if (retry !== 'y') continue;
    }
    try {
      writeEnv(values);
      saved += Object.keys(values).length;
      console.log(green(`    ✓ saved to .env`));
    } catch (error) {
      console.log(red(`    ✗ ${error.message}`));
      guidedSetup.skipped.add(next.id);
    }
  }
  rl.close();
  return saved;
}
guidedSetup.skipped = new Set();

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const only = option('--only')
    ? new Set(
        option('--only')
          .split(',')
          .map((s) => s.trim()),
      )
    : null;
  console.log(bold("\n  GOD'S EYE VIEW — KEYS") + dim(`  ${ENV_PATH}`));

  // 1. Import from other installs on this machine.
  if (!flag('--no-import')) {
    const sources = discoverInstalls();
    const plan = planImport(currentEnv().merged, sources);
    if (plan.length) {
      writeEnv(Object.fromEntries(plan.map((p) => [p.envVar, p.value])));
      for (const item of plan)
        console.log(
          green(`  ↳ imported ${item.envVar} ${maskKey(item.value)}`) +
            dim(` from ${item.from}`),
        );
    } else if (sources.length) {
      console.log(
        dim(
          `  ↳ checked ${sources.length} other install file(s); nothing new to import`,
        ),
      );
    }
  }

  // 2. Generate local secrets.
  const generated = {};
  for (const secret of GENERATED_SECRETS)
    if (!String(currentEnv().merged[secret.envVar] ?? '').trim())
      generated[secret.envVar] = randomBytes(secret.bytes).toString(
        'base64url',
      );
  if (Object.keys(generated).length) {
    writeEnv(generated);
    for (const name of Object.keys(generated))
      console.log(green(`  ↳ generated ${name} ${maskKey(generated[name])}`));
  }

  // 3. Open every missing key page at once.
  if (flag('--open')) {
    for (const entry of wizardEntries(currentEnv().merged))
      if (!entry.set && !entry.hidden && (!only || only.has(entry.id)))
        openUrl(entry.getUrl);
  }

  // 4. Guided clipboard capture.
  if (flag('--setup')) {
    if (!process.stdin.isTTY) {
      console.log(red('  --setup needs an interactive terminal'));
    } else {
      const saved = await guidedSetup(only);
      console.log(dim(`\n  saved ${saved} value(s) in guided setup`));
    }
  }

  // 5. Live check + status.
  const env = currentEnv().merged;
  let checks = null;
  if (!flag('--no-check')) {
    process.stdout.write(dim('\n  checking keys with their providers…'));
    checks = await checkAll(env, only);
    process.stdout.write('\r' + ' '.repeat(40) + '\r');
  }
  printStatus(env, checks);
  const missing = wizardEntries(env).filter((e) => !e.set && !e.hidden).length;
  if (missing && !flag('--setup'))
    console.log(
      `\n  ${missing} provider(s) missing — run ${cyan('npm run keys -- --setup')} to add them by copying from each provider's page.`,
    );
  console.log(
    dim(
      '  Everything not listed here (286+ overlays, world stats, ME tracking) is keyless.\n  Restart `npm run dev` to load changed keys.\n',
    ),
  );
}

main().catch((error) => {
  console.error(red(`\n  keys: ${error?.message || error}`));
  process.exitCode = 1;
});

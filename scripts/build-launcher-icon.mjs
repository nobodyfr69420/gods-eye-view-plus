#!/usr/bin/env node
/**
 * Build launcher/gods-eye-view.ico (the desktop-shortcut icon) from
 * public/logo.svg: the eye centred on a dark rounded tile, at 16–256 px,
 * stored as PNG frames inside one .ico (supported since Windows Vista).
 * Usage: node scripts/build-launcher-icon.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { projectRoot } from './project-root.mjs';

const ROOT = projectRoot(import.meta.url);
const SIZES = [16, 24, 32, 48, 64, 128, 256];

async function frame(size) {
  const logo = await sharp(path.join(ROOT, 'public', 'logo.svg'), {
    density: 600,
  })
    .resize(Math.round(size * 0.86), Math.round(size * 0.86), {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
  const r = Math.round(size * 0.2);
  const tile = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${r}" fill="#0b0d16"/><rect x="0.5" y="0.5" width="${size - 1}" height="${size - 1}" rx="${r}" fill="none" stroke="#00d4ff" stroke-opacity="0.45"/></svg>`,
  );
  return sharp(tile)
    .composite([{ input: logo, gravity: 'center' }])
    .png()
    .toBuffer();
}

/** Pack PNG frames into an ICO container. */
export function packIco(frames) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(frames.length, 4);
  const entries = [];
  let offset = 6 + 16 * frames.length;
  for (const { size, png } of frames) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    entries.push(entry);
  }
  return Buffer.concat([header, ...entries, ...frames.map((f) => f.png)]);
}

const frames = [];
for (const size of SIZES) frames.push({ size, png: await frame(size) });
const out = path.join(ROOT, 'launcher', 'gods-eye-view.ico');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, packIco(frames));
fs.writeFileSync(
  path.join(ROOT, 'launcher', 'gods-eye-view-256.png'),
  frames.at(-1).png,
);
console.log(`Wrote ${out} (${SIZES.join(', ')} px)`);

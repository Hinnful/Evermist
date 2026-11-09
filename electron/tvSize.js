'use strict';
// tvSize.js — the size a screen reports about itself, from its EDID: the bytes every TV and monitor
// hands the computer. Windows keeps them in the registry, Linux in /sys/class/drm, a Mac in ioreg.
// Answers `tv-reported-size` with { inches } or null, never a rejection. Plain Node apart from
// register(): unit-tested. Which sizes are believable is src/player/tvInch.js's call.

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { tvBelievable } = require('../src/player/tvInch.js');

const READ_MS = 8000;
const DRM_DIR = '/sys/class/drm';

// The registry EDID of every monitor Windows has connected now (WmiMonitorID lists only those).
const WIN_SCRIPT = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  'Get-CimInstance -Namespace root\\wmi -ClassName WmiMonitorID | ForEach-Object {',
  "  $p = 'HKLM:\\SYSTEM\\CurrentControlSet\\Enum\\' + ($_.InstanceName -replace '_\\d+$', '') + '\\Device Parameters'",
  '  $e = (Get-ItemProperty -Path $p -Name EDID).EDID',
  '  if ($e) { [Convert]::ToBase64String($e) }',
  '}',
].join('\n');

const EDID_HEADER = [0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x00];

// One EDID base block: the name from its 0xFC descriptor, the preferred mode from its first timing,
// and the size it claims (the timing's mm if it gives any, else the header's cm) as believable inches.
function parseEdid(bytes) {
  const b = bytes ? Uint8Array.from(bytes) : null;
  if (!b || b.length < 128 || EDID_HEADER.some((v, i) => b[i] !== v)) return null;
  const out = { name: '', w: 0, h: 0, inches: null };
  let mm = null;
  for (let o = 54; o < 126; o += 18) {
    if (b[o] || b[o + 1]) {
      if (!out.w) {
        out.w = b[o + 2] | ((b[o + 4] & 0xf0) << 4);
        out.h = b[o + 5] | ((b[o + 7] & 0xf0) << 4);
        mm = { w: b[o + 12] | ((b[o + 14] & 0xf0) << 4), h: b[o + 13] | ((b[o + 14] & 0x0f) << 8) };
      }
    } else if (b[o + 3] === 0xfc) {
      out.name = String.fromCharCode(...b.slice(o + 5, o + 18)).split('\n')[0].trim();
    }
  }
  out.inches = (mm && tvBelievable(mm.w, mm.h, 'mm')) || tvBelievable(b[21], b[22], 'cm');
  return out;
}

// PowerShell's answer: one base64 EDID per line.
function edidsFromBase64(text) {
  return String(text || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean)
    .map(s => parseEdid(Buffer.from(s, 'base64'))).filter(Boolean);
}

// `ioreg -l`: Intel Macs carry IODisplayEDID, Apple silicon an EDID property under the display's DCP.
function edidsFromIoreg(text) {
  const seen = new Set();
  const out = [];
  for (const m of String(text || '').matchAll(/"(?:IODisplayEDID|EDID)"\s*=\s*<([0-9a-fA-F]+)>/g)) {
    const hex = m[1].toLowerCase();
    if (seen.has(hex)) continue;
    seen.add(hex);
    const e = parseEdid(Buffer.from(hex, 'hex'));
    if (e) out.push(e);
  }
  return out;
}

// The EDID that is this Electron display: by name, then by its full pixel size. Two screens that
// cannot be told apart get nothing, so neither takes the other's size.
function matchEdid(edids, display) {
  if (!display || !display.size) return null;
  const sf = display.scaleFactor > 0 ? display.scaleFactor : 1;
  const pw = Math.round(display.size.width * sf), ph = Math.round(display.size.height * sf);
  const label = (display.label || '').trim().toLowerCase();
  const named = label ? edids.filter(e => e.name && e.name.toLowerCase() === label) : [];
  const sized = (named.length ? named : edids).filter(e => e.w === pw && e.h === ph);
  if (sized.length === 1) return sized[0];
  return named.length === 1 && !sized.length ? named[0] : null;
}

function run(cmd, args, opts) {
  return new Promise(resolve => {
    execFile(cmd, args, Object.assign({ windowsHide: true, timeout: READ_MS }, opts),
      (err, stdout) => resolve(err ? '' : stdout));
  });
}

async function readEdids() {
  if (process.platform === 'win32') {
    return edidsFromBase64(await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WIN_SCRIPT]));
  }
  if (process.platform === 'darwin') {
    return edidsFromIoreg(await run('ioreg', ['-l', '-w0'], { maxBuffer: 64 * 1024 * 1024 }));
  }
  const out = [];
  for (const dir of fs.readdirSync(DRM_DIR)) {
    try {
      const e = parseEdid(fs.readFileSync(path.join(DRM_DIR, dir, 'edid')));
      if (e) out.push(e);
    } catch (_) { /* a connector with no EDID */ }
  }
  return out;
}

function register() {
  const { ipcMain, screen } = require('electron');
  ipcMain.handle('tv-reported-size', async (_event, displayId) => {
    try {
      const display = screen.getAllDisplays().find(d => d.id === displayId);
      const hit = display ? matchEdid(await readEdids(), display) : null;
      return hit && hit.inches ? { inches: hit.inches } : null;
    } catch (_) { return null; }
  });
}

module.exports = { register, parseEdid, edidsFromBase64, edidsFromIoreg, matchEdid };

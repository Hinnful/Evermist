'use strict';
// pdfText.js — a campaign PDF turned into plain text in a utilityProcess, so a malformed file
// cannot take the app down with it.

const { ipcMain, app, utilityProcess } = require('electron');
const path = require('path');

function register(ctx) {
}

// --- Module text: PDF → plain text IPC ---
//
// A published campaign module ships as a PDF, so the app converts it rather than asking the DM to
// prepare a file. The bytes come over IPC rather than a path, because Electron removed File.path.
//
// ⚠ THE PARSE DOES NOT RUN IN THIS PROCESS. A module is a file from somewhere else and pdf.js is a
// large parser for a format built to carry embedded programs, so it runs in a utilityProcess forked
// per import and killed as soon as it answers. It cannot run in the renderer either: pdfjs-dist is
// ESM-only and browser-side `import` breaks on file://.
//
// A whole module reads in a second or so, which is why there is no progress bar.

// The one place that knows the asar rewrite: pdfjs-dist is unpacked because ESM resolves through
// real filesystem paths. The child is handed the resolved directory.
const PDFJS_BUILD_DIR = path.join(
  __dirname.replace('app.asar', 'app.asar.unpacked'),
  'node_modules', 'pdfjs-dist', 'legacy', 'build',
);

// Generous by two orders of magnitude against the 1.4s measurement. This is not a performance
// budget, it is the backstop for a file crafted or corrupted into making the parser never return.
const PDF_EXTRACT_TIMEOUT_MS = 120000;

ipcMain.handle('extract-pdf-text', (_event, arrayBuffer) => new Promise(resolve => {
  const child = utilityProcess.fork(path.join(__dirname, '..', 'src', 'content', 'pdfExtract.js'));
  let settled = false;
  const finish = (res) => {
    if (settled) return;      // whichever of message / exit / timeout lands first wins
    settled = true;
    clearTimeout(timer);
    try { child.kill(); } catch (_) {}
    resolve(res);
  };
  const timer = setTimeout(
    () => finish({ ok: false, error: 'Reading the PDF took too long, so it was stopped.' }),
    PDF_EXTRACT_TIMEOUT_MS,
  );

  // Posting on 'spawn', not immediately: the child has to be up before it can hold a listener.
  child.on('spawn', () => child.postMessage({
    bytes: new Uint8Array(arrayBuffer), buildDir: PDFJS_BUILD_DIR,
  }));
  child.on('message', finish);
  // A parser that dies on a malformed file exits without replying. Without this the renderer waits
  // out the full timeout and then blames the clock for what was really a crash.
  child.on('exit', code => finish({
    ok: false, error: 'The PDF reader stopped unexpectedly (exit code ' + code + ').',
  }));
}));

module.exports = { register };

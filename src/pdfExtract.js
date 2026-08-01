'use strict';
// pdfExtract.js — a PDF's text, pulled out in a UTILITY PROCESS.
//
// WHY THIS IS NOT IN main.js. A campaign module is a file the DM got from somewhere, and pdf.js is
// a large parser for a format designed to carry embedded programs. That combination does not belong
// in the main process, which holds the filesystem helpers, the dialogs, the window handles and the
// IPC channels to every renderer. So the parse happens here, in a process forked for the one job
// and killed the moment it answers.
//
// WHAT THAT BUYS, precisely — worth being honest about, because it is a reduction and not a
// sandbox:
//   • Nothing in this process can reach Electron's privileged APIs. There is no `app`, no `dialog`,
//     no BrowserWindow, no session, and no channel to any renderer except the one port below.
//   • A parser that crashes, hangs or eats memory on a malformed file takes THIS process with it.
//     main.js kills it on a timeout and reports a normal error; the app does not notice.
//   • State cannot accumulate across imports, because the process does not survive one.
// What it does NOT buy: this is a Node process, so `fs` still exists here. Full isolation would
// mean a sandboxed renderer with no Node at all, which on this app means a custom protocol to load
// ESM from (see the file:// constraint in CLAUDE.md) — a bigger change to the app's shape than the
// remaining risk justifies.
//
// Lives in src/ to ride the build glob, like pdfLayout.js, and like it has NO <script src> tag —
// nothing here is browser code. Dependency-free apart from pdfLayout.js, so it forks cleanly from
// inside app.asar (verified: utilityProcess.fork resolves an asar-packed entry and its requires).

const path = require('path');
const url = require('url');
const { plDocumentText } = require('./pdfLayout.js');

let _pdfjs = null;

// pdf.js and its worker are loaded by EXPLICIT REAL PATH, handed in by main.js — which is the only
// place that knows about the app.asar → app.asar.unpacked rewrite. Two reasons the path matters,
// and the packaged app fails outright without either:
//
//   • pdfjs-dist is unpacked out of app.asar (package.json asarUnpack), because ESM resolves
//     through real filesystem paths and does not go through Electron's asar redirect.
//   • pdf.js sets up a "fake worker" when there is no Worker global, and derives that worker's
//     module path from workerSrc. Left unset it guesses `pdf.worker.mjs` — the NON-minified name,
//     which is not shipped — and dies with "Setting up fake worker failed". Dev hides this,
//     because there the whole package sits in node_modules.
function pdfjsFileUrl(buildDir, name) {
  return url.pathToFileURL(path.join(buildDir, name)).href;
}

async function loadPdfjs(buildDir) {
  if (!_pdfjs) {
    // Dynamic import: this file is CommonJS and pdfjs-dist ships ESM only. The `legacy` build is
    // the one that runs under Node without a DOM.
    _pdfjs = await import(pdfjsFileUrl(buildDir, 'pdf.min.mjs'));
    _pdfjs.GlobalWorkerOptions.workerSrc = pdfjsFileUrl(buildDir, 'pdf.worker.min.mjs');
  }
  return _pdfjs;
}

// Exported so it can be exercised directly against a BUILT tree without an Electron host — which
// is the only way to check the packaged pdfjs paths, since `npm start` cannot see that class of bug.
async function extractPdfText(bytes, buildDir) {
  const pdfjs = await loadPdfjs(buildDir);

  // cMaps and standard fonts are deliberately not configured — verified on a Russian-translation
  // module that Cyrillic decodes correctly from the embedded ToUnicode maps alone, so those 2.3MB
  // stay out of the installer. pdf.js logs a warning about it; extraction is unaffected.
  const doc = await pdfjs.getDocument({
    data: bytes,
    isEvalSupported: false,        // no dynamic code from an untrusted file
    useSystemFonts: false,         // text extraction needs no font substitution
  }).promise;

  try {
    const pages = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      try {
        const content = await page.getTextContent();
        pages.push({
          width: page.getViewport({ scale: 1 }).width,
          // transform[4]/[5] are the run's x/y on the page. Only these four fields cross into the
          // pure layer, which is what keeps pdfLayout.js free of any pdf.js shape.
          items: content.items
            .filter(it => it && typeof it.str === 'string')
            .map(it => ({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width || 0 })),
        });
      } finally {
        // Without this a 255-page book holds every page's operator list until the document is
        // destroyed, which on a 16MB module is a few hundred MB of garbage.
        page.cleanup();
      }
    }
    return { ok: true, text: plDocumentText(pages), pages: doc.numPages };
  } finally {
    await doc.destroy();
  }
}

// Utility-process wiring. Absent when this file is simply required (the build check above), which
// is why the export is the real entry point and this is a thin shell over it.
if (process.parentPort) {
  process.parentPort.on('message', async (e) => {
    const d = (e && e.data) || {};
    let res;
    try {
      res = await extractPdfText(d.bytes, d.buildDir);
    } catch (err) {
      res = { ok: false, error: String((err && err.message) || err) };
    }
    process.parentPort.postMessage(res);
  });
}

module.exports = { extractPdfText };

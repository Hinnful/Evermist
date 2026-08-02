'use strict';
// pdfExtract.js — a PDF's text, pulled out in a UTILITY PROCESS.
//
// A campaign module is an untrusted file and pdf.js is a large parser, so it runs here
// rather than in main.js: forked for the one job, killed the moment it answers, with no
// Electron APIs and no renderer channel. Honest limit: this is still a Node process, so
// `fs` exists. Full reasoning in docs/DECISIONS.md; the rules in CLAUDE.md.
//
// Lives in src/ for the build glob and has NO <script src> tag — nothing here is browser
// code. Dependency-free apart from pdfLayout.js, so it forks cleanly from inside app.asar.

const path = require('path');
const url = require('url');
const { plDocumentText } = require('./pdfLayout.js');

let _pdfjs = null;

// pdf.js is loaded by EXPLICIT REAL PATH, handed in by main.js — the only place that
// knows the app.asar → app.asar.unpacked rewrite. Both parts are load-bearing and the
// packaged app dies without either: pdfjs-dist is unpacked because ESM resolves through
// real filesystem paths, and workerSrc must be set because pdf.js otherwise guesses the
// non-minified worker name, which is not shipped. Dev hides both.
function pdfjsFileUrl(buildDir, name) {
  return url.pathToFileURL(path.join(buildDir, name)).href;
}

async function loadPdfjs(buildDir) {
  if (!_pdfjs) {
    // Dynamic import: this file is CommonJS and pdfjs-dist ships ESM only.
    _pdfjs = await import(pdfjsFileUrl(buildDir, 'pdf.min.mjs'));
    _pdfjs.GlobalWorkerOptions.workerSrc = pdfjsFileUrl(buildDir, 'pdf.worker.min.mjs');
  }
  return _pdfjs;
}

// Exported so a BUILT tree can be exercised without an Electron host, which is the only
// way to check the packaged pdfjs paths.
async function extractPdfText(bytes, buildDir) {
  const pdfjs = await loadPdfjs(buildDir);

  // cMaps and standard fonts deliberately not configured: verified that Cyrillic decodes
  // from the embedded ToUnicode maps alone, so those 2.3MB stay out of the installer.
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
          // Only these four fields cross into the pure layer, which is what keeps
          // pdfLayout.js free of any pdf.js shape. transform[4]/[5] are the run's x/y.
          items: content.items
            .filter(it => it && typeof it.str === 'string')
            .map(it => ({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width || 0 })),
        });
      } finally {
        // Without this, every page's operator list is held until the document is
        // destroyed — a few hundred MB of garbage on a 16MB module.
        page.cleanup();
      }
    }
    return { ok: true, text: plDocumentText(pages), pages: doc.numPages };
  } finally {
    await doc.destroy();
  }
}

// Absent when this file is merely required (the build check above), which is why the
// export is the real entry point and this is a thin shell over it.
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

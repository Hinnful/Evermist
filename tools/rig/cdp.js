'use strict';

// cdp.js — the rig's connection layer. Finds the app's pages over the Chrome DevTools endpoint,
// holds one WebSocket per page, and evaluates expressions on them. Plumbing only: it knows
// nothing about Evermist.
//
// ZERO DEPENDENCIES ON PURPOSE. Node has global `fetch` for target discovery and a global
// `WebSocket` for the protocol itself, which is the entire client. Do not add puppeteer,
// chrome-remote-interface or `ws` — the repo's identity is no bundler and no framework, and
// nothing here needs one.
//
// ⚠ EVALUATE WITH BARE IDENTIFIERS, NEVER `window.x`. The app's scripts are plain <script> tags
// using top-level let/const, which are NOT properties of window: `window.pixiApp` is undefined
// while bare `pixiApp` is an object. Same for currentScene, switchScene, sceneStore.

const fs = require('fs');

// Electron's own security warning is printed by ELECTRON, not by the app, and it arrives as a
// console ERROR rather than a warning — so an unfiltered run fails on the harness's own noise.
// Do not widen this: everything else a renderer logs at error level is the app's and should fail
// the run. (The seed also had to swallow `app-version`, because a harness with its own main
// process has no IPC handlers. The real main process registers it, so that term is gone.)
//
// The last two terms are Electron's sandboxed-renderer bootstrap failing, which fired on
// unmodified code about one boot in thirty and cost a full re-run each time. The splash window
// takes Electron's defaults — sandboxed, no preload — and main.js destroys it as soon as the DM
// paints, so its bootstrap can be cut off midway; `binding.startupData` is null exactly there.
// It is not the app's preload: every run measured has window.electronAPI present with all its
// methods, which is why assertPreloadRan() below exists.
//
// ⚠ NEVER FILTER THESE TWO ALONE. A real preload failure logs the same words, and swallowing it
// would leave the app running with no IPC and the rig calling that green. The pair is only safe
// because run.js asserts the preload ran on every boot; delete that assertion and these two
// terms have to come out with it.
const NOISE = /Electron Security Warning|electronjs\.org|unsafe-eval|unnecessary security|Content Security|once the app is packaged|This warning will not show up|sandboxed_renderer\.bundle\.js script failed to run|Cannot destructure property 'preloadScripts' of 'binding\.startupData'/;

// Big payloads (a PNG data URL, a recorded clip) move in slices rather than one giant
// Runtime.evaluate result. One 1 MB slice per round trip keeps every CDP frame small.
const CHUNK = 1 << 20;

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── Target discovery ────────────────────────────────────────────────────────

async function endpoint(port, route) {
  const res = await fetch('http://127.0.0.1:' + port + route);
  if (!res.ok) throw new Error(route + ' answered ' + res.status);
  return res.json();
}

async function listTargets(port) {
  const all = await endpoint(port, '/json/list');
  return all.filter(t => t.type === 'page');
}

// Polls the endpoint until a page target matches, rather than sleeping a guessed interval.
// Returns the target descriptor; throws once timeoutMs is up.
async function waitForTarget(port, match, timeoutMs, what) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      const hit = (await listTargets(port)).find(match);
      if (hit) return hit;
    } catch (err) { lastErr = err; }
    await sleep(150);
  }
  throw new Error('timed out after ' + (timeoutMs / 1000) + 's waiting for ' + what +
                  (lastErr ? ' (last endpoint error: ' + lastErr.message + ')' : ''));
}

// The browser-level session, which is where the Browser domain lives. Only the window-moving
// helper needs it; page work never does.
async function connectBrowser(port) {
  const v = await endpoint(port, '/json/version');
  return connect(v.webSocketDebuggerUrl, 'browser');
}

// ─── One session per target ──────────────────────────────────────────────────

function connect(wsUrl, label) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const session = new Session(ws, label || 'page');
    ws.addEventListener('open', () => resolve(session), { once: true });
    ws.addEventListener('error', () => reject(new Error('could not open ' + wsUrl)), { once: true });
  });
}

class Session {
  constructor(ws, label) {
    this.ws = ws;
    this.label = label;
    this.errors = [];          // console errors + uncaught exceptions, noise already filtered
    // Every JS execution context this page has, by id. A page with <iframe>s has one per frame,
    // and an expression sent without one lands in the main frame — which is how a check against
    // a two-column app reads the parent's empty scene and passes.
    this.contexts = new Map();
    this._id = 0;
    this._pending = new Map();
    this._closed = false;
    ws.addEventListener('message', e => this._onMessage(e.data));
    ws.addEventListener('close', () => {
      this._closed = true;
      for (const { reject } of this._pending.values()) reject(new Error(this.label + ' socket closed'));
      this._pending.clear();
    });
  }

  _onMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch (_) { return; }
    if (msg.id != null) {
      const slot = this._pending.get(msg.id);
      if (!slot) return;
      this._pending.delete(msg.id);
      if (msg.error) slot.reject(new Error(slot.method + ': ' + msg.error.message));
      else slot.resolve(msg.result);
      return;
    }
    this._onEvent(msg.method, msg.params || {});
  }

  _onEvent(method, p) {
    if (method === 'Runtime.executionContextCreated') {
      const c = p.context || {};
      this.contexts.set(c.id, { frameId: c.auxData && c.auxData.frameId, origin: c.origin });
      return;
    }
    if (method === 'Runtime.executionContextDestroyed') { this.contexts.delete(p.executionContextId); return; }
    if (method === 'Runtime.executionContextsCleared') { this.contexts.clear(); return; }
    if (method === 'Runtime.consoleAPICalled' && p.type === 'error') {
      this._note((p.args || []).map(a => a.value != null ? String(a.value) : (a.description || a.type)).join(' '));
    } else if (method === 'Runtime.exceptionThrown') {
      const d = p.exceptionDetails || {};
      this._note('uncaught: ' + (d.exception && d.exception.description ? d.exception.description : d.text));
    } else if (method === 'Log.entryAdded' && p.entry && p.entry.level === 'error') {
      // A network entry's text is just the error code, so an unadorned note reads as
      // "net::ERR_FILE_NOT_FOUND" with no way to tell WHICH file. The url is on the entry.
      const e = p.entry;
      // The initiator frame, when Chromium supplies one, is the difference between "some file is
      // missing" and the line that asked for it.
      const frame = e.stackTrace && e.stackTrace.callFrames && e.stackTrace.callFrames[0];
      this._note(e.text + (e.url ? '  <' + e.url + '>' : '') +
                 (e.source ? '  [' + e.source + ']' : '') +
                 (frame ? '  from ' + (frame.functionName || '(top level)') + ' ' +
                          frame.url + ':' + (frame.lineNumber + 1) : ''));
    }
  }

  _note(text) {
    if (text && !NOISE.test(text)) this.errors.push(this.label + ': ' + text);
  }

  send(method, params, timeoutMs = 60000) {
    if (this._closed) return Promise.reject(new Error(this.label + ' socket is closed'));
    const id = ++this._id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(method + ' on ' + this.label + ' did not answer in ' + (timeoutMs / 1000) + 's'));
      }, timeoutMs);
      const done = fn => v => { clearTimeout(timer); fn(v); };
      this._pending.set(id, { method, resolve: done(resolve), reject: done(reject) });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }

  // Turn on the two domains that report a page's own failures. Called once per session by the
  // launcher; a scenario never has to think about it.
  async watch() {
    await this.send('Runtime.enable');
    await this.send('Log.enable');
    await this.send('Page.enable');
    return this;
  }

  // The workhorse. `expression` is evaluated in the page's top-level scope, so bare app
  // identifiers resolve. A promise result is awaited; a thrown error becomes a thrown error here
  // rather than a silently undefined value.
  evaluate(expression, timeoutMs = 60000) {
    return this._evaluateIn(null, expression, timeoutMs);
  }

  async _evaluateIn(contextId, expression, timeoutMs = 60000) {
    const params = {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,          // some app paths (fullscreen, media) want an activation
    };
    if (contextId != null) params.contextId = contextId;
    const r = await this.send('Runtime.evaluate', params, timeoutMs);
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      const why = (d.exception && d.exception.description) || d.text || 'evaluate failed';
      throw new Error(this.label + ' threw: ' + why);
    }
    return r.result ? r.result.value : undefined;
  }

  // Poll a page condition instead of sleeping through it. `expression` must yield a boolean.
  async waitFor(expression, timeoutMs, what) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      let ok = false;
      try { ok = await this.evaluate('!!(' + expression + ')'); } catch (_) { ok = false; }
      if (ok) return true;
      await sleep(120);
    }
    throw new Error('timed out after ' + (timeoutMs / 1000) + 's waiting for ' + what + ' on ' + this.label);
  }

  // Pull a large string out of the page in slices. `expression` may be async and must yield a
  // string; the whole thing never rides in one CDP frame.
  async readBig(expression) {
    const len = await this.evaluate(
      '(async () => { globalThis.__rigOut = String(await (' + expression + ')); return globalThis.__rigOut.length; })()',
      180000);
    let out = '';
    for (let i = 0; i < len; i += CHUNK) {
      out += await this.evaluate('globalThis.__rigOut.substr(' + i + ',' + CHUNK + ')');
    }
    await this.evaluate('globalThis.__rigOut = null; 0');
    return out;
  }

  // Push a large string into the page under globalThis.<name>, in the same slices.
  async writeBig(name, str) {
    await this.evaluate('globalThis.' + name + ' = ""; 0');
    for (let i = 0; i < str.length; i += CHUNK) {
      await this.evaluate('globalThis.' + name + ' += ' + JSON.stringify(str.substr(i, CHUNK)) + '; 0');
    }
    return str.length;
  }

  // Writes a PNG of this page. `clip` is optional {x,y,width,height} in CSS pixels.
  async screenshot(destPath, clip) {
    const params = { format: 'png', captureBeyondViewport: false };
    if (clip) params.clip = { ...clip, scale: 1 };
    const r = await this.send('Page.captureScreenshot', params, 60000);
    fs.writeFileSync(destPath, Buffer.from(r.data, 'base64'));
    return destPath;
  }

  // A view onto ONE frame of this page: the same socket, every evaluate pinned to that frame's
  // context. Two-column mode puts the app inside <iframe>s, and `polygons` or `zoom` for a column
  // live nowhere else.
  //
  // ⚠ Re-resolved rather than cached across a reload: a frame that navigates gets a NEW context
  // and the old id answers "Cannot find context with specified id" on every call after.
  async frame(urlPart, timeoutMs = 20000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const tree = await this.send('Page.getFrameTree');
      const hit = (tree.frameTree.childFrames || [])
        .map(c => c.frame)
        .find(f => f.url && f.url.includes(urlPart));
      if (hit) {
        for (const [id, c] of this.contexts) {
          if (c.frameId === hit.id) return this._view(id);
        }
      }
      if (Date.now() > deadline) {
        throw new Error('timed out after ' + (timeoutMs / 1000) + 's waiting for a frame whose ' +
                        'url holds "' + urlPart + '" to have a JS context on ' + this.label);
      }
      await sleep(150);
    }
  }

  // ⚠ Delegates rather than inheriting from the Session. A copy sharing `_pending` while
  // keeping its own `_id` counter answers one request with another's reply.
  _view(contextId) {
    const parent = this;
    const view = {
      label: parent.label + '#' + contextId,
      get errors() { return parent.errors; },
      send: (m, p, t) => parent.send(m, p, t),
      evaluate: (expr, t) => parent._evaluateIn(contextId, expr, t),
      waitFor: (expr, t, what) => Session.prototype.waitFor.call(view, expr, t, what),
      screenshot: (dest, clip) => parent.screenshot(dest, clip),
      close: () => {},
    };
    return view;
  }

  close() {
    this._closed = true;
    try { this.ws.close(); } catch (_) {}
  }
}

// ⚠ THERE IS NO WINDOW-MOVING HELPER HERE, and there cannot be: Electron does not expose the CDP
// Browser domain, so `Browser.getWindowForTarget` answers "wasn't found" and every bounds call
// with it. `window.moveTo` works on the DM and is ignored for the Player. A window that has to be
// visible is made visible with the app's own fullscreen IPC — see showPlayer in run.js.

module.exports = { connect, connectBrowser, listTargets, waitForTarget, sleep, NOISE };

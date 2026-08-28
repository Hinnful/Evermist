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
    if (method === 'Runtime.consoleAPICalled' && p.type === 'error') {
      this._note((p.args || []).map(a => a.value != null ? String(a.value) : (a.description || a.type)).join(' '));
    } else if (method === 'Runtime.exceptionThrown') {
      const d = p.exceptionDetails || {};
      this._note('uncaught: ' + (d.exception && d.exception.description ? d.exception.description : d.text));
    } else if (method === 'Log.entryAdded' && p.entry && p.entry.level === 'error') {
      this._note(p.entry.text);
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
  async evaluate(expression, timeoutMs = 60000) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,          // some app paths (fullscreen, media) want an activation
    }, timeoutMs);
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

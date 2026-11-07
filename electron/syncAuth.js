'use strict';
// syncAuth.js — signing this computer in to sync. Connect is Google's OAuth for a desktop app: the consent page in the
// system browser, the answer on a one-shot loopback server, PKCE and a `state` checked on return. The refresh token is
// kept encrypted by safeStorage, or in memory only where there is no secure store. A config naming the rig's fake
// Drive runs the same flow; only the browser is a plain request there (syncRemote.js). Tested.

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const CALLBACK = '/oauth2callback';
const WAIT_MS = 5 * 60 * 1000;

const PAGE = {
  en: { ok: 'Evermist is connected to Google. You can close this tab and return to Evermist.',
    no: 'Evermist was not connected to Google. You can close this tab and return to Evermist.' },
  ru: { ok: 'Evermist подключён к Google. Эту вкладку можно закрыть и вернуться в Evermist.',
    no: 'Evermist не подключён к Google. Эту вкладку можно закрыть и вернуться в Evermist.' },
};

const _base = cfg => cfg.apiBase.replace(/\/$/, '');
const authUrlFor = cfg => (cfg.apiBase ? _base(cfg) + '/auth' : GOOGLE_AUTH);
const tokenUrlFor = cfg => cfg.tokenUrl || (cfg.apiBase ? _base(cfg) + '/token' : GOOGLE_TOKEN);

const b64url = buf => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function pkcePair(bytes) {
  const verifier = b64url(bytes || crypto.randomBytes(32));
  return { verifier, challenge: b64url(crypto.createHash('sha256').update(verifier).digest()) };
}

const newState = () => b64url(crypto.randomBytes(16));

function consentUrl(authUrl, clientId, redirectUri, challenge, state) {
  return authUrl + '?' + new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: SCOPE,
    access_type: 'offline', prompt: 'consent', code_challenge: challenge, code_challenge_method: 'S256', state,
  });
}

function sameState(got, want) {
  const a = Buffer.from(String(got)), b = Buffer.from(String(want));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// One request to the loopback: `code` or `error` when it is the answer to this sign-in, `ignore` for anything else.
function readRedirect(reqUrl, state) {
  let u;
  try { u = new URL(reqUrl, 'http://127.0.0.1'); } catch (_) { return { kind: 'ignore' }; }
  if (u.pathname !== CALLBACK || !sameState(u.searchParams.get('state') || '', state)) return { kind: 'ignore' };
  const code = u.searchParams.get('code');
  return code ? { kind: 'code', code } : { kind: 'error', error: u.searchParams.get('error') || 'no code' };
}

class AuthError extends Error {
  constructor(code, message) { super(message || code); this.authCode = code; }
}

// A server on 127.0.0.1 at a free port, answering one sign-in. `code` settles on the first request carrying its
// state, or on the timeout; any other request gets a 404 and the wait goes on.
function listenForCode(state, opts) {
  const o = opts || {};
  const words = PAGE[o.lang] || PAGE.en;
  let settle, timer = null;
  const code = new Promise((resolve, reject) => { settle = { resolve, reject }; });
  code.catch(() => {});
  const server = http.createServer((req, res) => {
    const r = req.method === 'GET' ? readRedirect(req.url, state) : { kind: 'ignore' };
    if (r.kind === 'ignore') { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', Connection: 'close' });
    res.end(r.kind === 'code' ? words.ok : words.no, end);
    if (r.kind === 'code') settle.resolve(r.code);
    else settle.reject(new AuthError(r.error === 'access_denied' ? 'denied' : 'refused', 'Google answered ' + r.error));
  });
  function end() {
    clearTimeout(timer);
    server.close();
    server.closeAllConnections();
  }
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      timer = setTimeout(() => { end(); settle.reject(new AuthError('timeout', 'the sign-in took too long')); }, o.timeoutMs || WAIT_MS);
      resolve({
        redirectUri: 'http://127.0.0.1:' + server.address().port + CALLBACK,
        code,
        close: () => { end(); settle.reject(new AuthError('cancelled', 'the sign-in was cancelled')); },
      });
    });
  });
}

const _tokenIn = text => {
  try { const v = JSON.parse(text).refreshToken; return typeof v === 'string' && v ? v : null; } catch (_) { return null; }
};

// `post(url, form)` answers { status, body } (syncRemote.js's request); `open(url)` shows the consent page; `vault` is
// safeStorage's part: `secure()`, `encrypt(text)` to a Buffer and `decrypt(buf)`.
function createAuth(userData, cfg, opts) {
  const { post, open, vault, timeoutMs } = opts;
  const dir = path.join(userData, 'sync');
  const plain = path.join(dir, 'token.json'), sealed = path.join(dir, 'token.enc');
  const secure = () => { try { return !!vault && vault.secure(); } catch (_) { return false; } };
  let rt = null;
  let pending = null;

  function keep(token) {
    rt = token;
    if (!secure()) return;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(sealed, vault.encrypt(JSON.stringify({ refreshToken: token })));
  }

  if (secure()) {
    try { rt = _tokenIn(vault.decrypt(fs.readFileSync(sealed))); } catch (_) { /* never signed in, or another store's */ }
  }
  // A plain token file from before encryption is sealed, then deleted. Without a secure store it is left and read,
  // since nowhere safer could hold it.
  let old = null;
  try { old = _tokenIn(fs.readFileSync(plain, 'utf8')); } catch (_) { /* none */ }
  if (old && secure()) {
    try { if (!rt) keep(old); fs.unlinkSync(plain); } catch (_) { /* tried again at the next start */ }
  }
  if (!rt) rt = old;

  async function connect(lang) {
    if (pending) pending.close();
    const { verifier, challenge } = pkcePair();
    const state = newState();
    const wait = await listenForCode(state, { lang, timeoutMs });
    pending = wait;
    let code;
    try {
      await open(consentUrl(authUrlFor(cfg), cfg.clientId, wait.redirectUri, challenge, state));
      code = await wait.code;
    } catch (err) {
      wait.close();
      return { ok: false, code: err.authCode || 'offline', message: String(err.message) };
    } finally {
      if (pending === wait) pending = null;
    }
    const form = new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, code,
      code_verifier: verifier, grant_type: 'authorization_code', redirect_uri: wait.redirectUri });
    let r;
    try { r = await post(tokenUrlFor(cfg), form.toString()); } catch (err) { return { ok: false, code: 'offline', message: String(err.message) }; }
    let got = null;
    try { got = r.status === 200 ? JSON.parse(r.body.toString()).refresh_token : null; } catch (_) { got = null; }
    if (typeof got !== 'string' || !got) return { ok: false, code: 'refused', message: 'the sign-in was refused (' + r.status + ')' };
    keep(got);
    return { ok: true };
  }

  function disconnect() {
    if (pending) pending.close();
    rt = null;
    for (const f of [plain, sealed]) { try { fs.unlinkSync(f); } catch (_) { /* already gone */ } }
  }

  return { refreshToken: () => rt, signedIn: () => !!rt, remembered: secure, connect, disconnect };
}

module.exports = { createAuth, listenForCode, readRedirect, consentUrl, pkcePair, sameState, tokenUrlFor, authUrlFor, SCOPE, CALLBACK };

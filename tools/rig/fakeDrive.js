'use strict';
// A local stand-in for the part of Google Drive v3 that sync uses: the appDataFolder, resumable
// uploads, paged listings, a quota error, a token that expires and a refresh endpoint, and a consent
// page that hands a PKCE-bound code to the app's loopback. The rig points each profile at it through
// the sync config file, so the app's Drive code runs unchanged.
//
// A file exists only once its upload FINISHES, as on Drive, so a cut upload never reads as present.
// Faults are switches on the returned object; `stats` is what a scenario asserts a tick cost.

const http = require('http');
const crypto = require('crypto');

const FOLDER = 'application/vnd.google-apps.folder';

function createFakeDrive() {
  const files = new Map();      // id -> { id, name, parents, mimeType, appProperties, data, modifiedTime }
  const sessions = new Map();   // id -> { meta, total, chunks, received }
  const valid = new Set();      // access tokens the API accepts
  const codes = new Map();      // consent code -> { challenge, redirectUri }, until it is traded once
  let nextId = 1;
  let nextToken = 1;
  let server = null;
  let port = 0;
  const sockets = new Set();

  const drive = {
    pageSize: 0,                // > 0 caps every listing page, whatever the client asks for
    quotaFull: false,           // creating a file fails with storageQuotaExceeded
    quotaLimit: 15 * 1024 * 1024 * 1024,
    quotaUsed: null,            // a number stands in for the bytes the files hold, so a scenario sets how full it reads
    cutNext: null,              // { bytes, down }: the next upload PUT dies after this many bytes; `down` keeps the Drive
                                // unreachable afterwards, as a lid closed mid-upload
    stats: { uploads: [], requests: [], consents: 0, refreshes: 0, unauthorized: 0, deletes: [], sessions: [], puts: [] },
    url: '',
  };

  const send = (res, code, body, headers) => {
    const text = body === undefined ? '' : (typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
    res.writeHead(code, Object.assign({ 'Content-Type': 'application/json' }, headers || {}));
    res.end(text);
  };
  const fail = (res, code, reason, message) =>
    send(res, code, { error: { code, message: message || reason, errors: [{ reason, message: message || reason }] } });
  const readBody = req => new Promise(resolve => {
    const parts = [];
    req.on('data', c => parts.push(c));
    req.on('end', () => resolve(Buffer.concat(parts)));
    req.on('error', () => resolve(null));
  });
  const meta = f => ({ id: f.id, name: f.name, parents: f.parents, mimeType: f.mimeType,
    appProperties: f.appProperties, size: String(f.data ? f.data.length : 0), modifiedTime: f.modifiedTime });
  const usage = () => Array.from(files.values()).reduce((n, f) => n + (f.data ? f.data.length : 0), 0);

  // The subset of Drive's `q` that sync writes: name = 'x', 'id' in parents, trashed = false,
  // name contains 'x', joined by `and`.
  function matches(f, q) {
    if (!q) return true;
    return q.split(/\s+and\s+/i).every(term => {
      let m;
      if ((m = /^name\s*=\s*'(.*)'$/.exec(term.trim()))) return f.name === m[1].replace(/\\'/g, "'");
      if ((m = /^name\s+contains\s+'(.*)'$/.exec(term.trim()))) return f.name.includes(m[1]);
      if ((m = /^'(.*)'\s+in\s+parents$/.exec(term.trim()))) return f.parents.includes(m[1]);
      if ((m = /^mimeType\s*=\s*'(.*)'$/.exec(term.trim()))) return f.mimeType === m[1];
      if (/^trashed\s*=\s*false$/.test(term.trim())) return true;
      throw new Error('the fake Drive does not understand the query term: ' + term);
    });
  }

  function create(metaIn, data) {
    const f = { id: 'f' + (nextId++), name: metaIn.name, parents: metaIn.parents || ['appDataFolder'],
      mimeType: metaIn.mimeType || 'application/octet-stream', appProperties: metaIn.appProperties || {},
      data, modifiedTime: new Date().toISOString() };
    files.set(f.id, f);
    return f;
  }

  async function handle(req, res) {
    const u = new URL(req.url, drive.url || 'http://127.0.0.1');
    drive.stats.requests.push(req.method + ' ' + u.pathname);

    // The consent page, answered as Google does once the DM agrees: back to the loopback with a code and the state.
    if (u.pathname === '/auth') {
      const p = u.searchParams;
      const back = /^http:\/\/127\.0\.0\.1:\d+\//.test(p.get('redirect_uri') || '') ? p.get('redirect_uri') : null;
      if (!back || p.get('response_type') !== 'code' || p.get('code_challenge_method') !== 'S256' || !p.get('code_challenge') ||
          p.get('access_type') !== 'offline' || p.get('scope') !== 'https://www.googleapis.com/auth/drive.appdata') {
        return send(res, 400, { error: 'invalid_request' });
      }
      const code = 'code-' + (nextToken++);
      codes.set(code, { challenge: p.get('code_challenge'), redirectUri: back });
      drive.stats.consents++;
      const to = new URL(back);
      to.searchParams.set('code', code);
      to.searchParams.set('state', p.get('state') || '');
      return send(res, 302, '', { Location: to.toString() });
    }

    if (u.pathname === '/token') {
      const form = new URLSearchParams((await readBody(req)).toString());
      // A code is good once, for the verifier whose hash the consent page was given and the same redirect.
      if (form.get('grant_type') === 'authorization_code') {
        const c = codes.get(form.get('code'));
        codes.delete(form.get('code'));
        const hash = crypto.createHash('sha256').update(form.get('code_verifier') || '').digest('base64url');
        if (!c || c.challenge !== hash || c.redirectUri !== form.get('redirect_uri')) return send(res, 400, { error: 'invalid_grant' });
      }
      const at = 'at-' + (nextToken++);
      valid.add(at);
      if (form.get('grant_type') === 'refresh_token') drive.stats.refreshes++;
      return send(res, 200, { access_token: at, expires_in: 3600, token_type: 'Bearer',
        refresh_token: form.get('grant_type') === 'authorization_code' ? 'rt-1' : undefined });
    }

    // A session URL is its own credential, as on Drive, so only the other paths check the token.
    const isSession = u.pathname.startsWith('/upload/session/');
    const bearer = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    if (!isSession && (!bearer || !valid.has(bearer[1]))) {
      drive.stats.unauthorized++;
      return fail(res, 401, 'authError', 'Invalid Credentials');
    }

    if (u.pathname === '/drive/v3/about') {
      const used = drive.quotaUsed === null ? usage() : drive.quotaUsed;
      return send(res, 200, { storageQuota: { limit: String(drive.quotaLimit), usage: String(used) } });
    }

    if (u.pathname === '/drive/v3/files' && req.method === 'GET') {
      const all = Array.from(files.values()).filter(f => matches(f, u.searchParams.get('q')));
      const ask = parseInt(u.searchParams.get('pageSize') || '100', 10);
      const size = drive.pageSize > 0 ? Math.min(drive.pageSize, ask) : ask;
      const from = u.searchParams.get('pageToken') ? parseInt(u.searchParams.get('pageToken'), 10) : 0;
      const page = all.slice(from, from + size);
      const out = { files: page.map(meta) };
      if (from + size < all.length) out.nextPageToken = String(from + size);
      return send(res, 200, out);
    }

    if (u.pathname === '/drive/v3/files' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString() || '{}');
      if (body.mimeType !== FOLDER) return fail(res, 400, 'badRequest', 'only folders are created by metadata');
      return send(res, 200, meta(create(body, null)));
    }

    if (u.pathname === '/upload/drive/v3/files' && req.method === 'POST') {
      if (u.searchParams.get('uploadType') !== 'resumable') return fail(res, 400, 'badRequest', 'resumable uploads only');
      if (drive.quotaFull) return fail(res, 403, 'storageQuotaExceeded', 'The user\'s Drive storage quota has been exceeded.');
      const body = JSON.parse((await readBody(req)).toString() || '{}');
      const id = crypto.randomBytes(6).toString('hex');
      drive.stats.sessions.push(body.name);
      sessions.set(id, { meta: body, total: parseInt(req.headers['x-upload-content-length'] || '-1', 10), chunks: [], received: 0 });
      return send(res, 200, '', { Location: drive.url + '/upload/session/' + id });
    }

    let m = /^\/upload\/session\/([0-9a-f]+)$/.exec(u.pathname);
    if (m && req.method === 'PUT') {
      const s = sessions.get(m[1]);
      if (!s) return fail(res, 404, 'notFound', 'upload session gone');
      const range = /^bytes (?:(\d+)-(\d+)|\*)\/(\d+|\*)$/.exec(req.headers['content-range'] || '');
      if (range && range[3] !== '*') s.total = parseInt(range[3], 10);
      // A status query: how much does the server hold?
      if (range && range[1] === undefined) {
        if (s.total >= 0 && s.received === s.total) return finishUpload(res, m[1], s);
        return send(res, 308, '', s.received ? { Range: 'bytes=0-' + (s.received - 1) } : {});
      }
      const start = range && range[1] !== undefined ? parseInt(range[1], 10) : 0;
      if (start !== s.received) return fail(res, 400, 'badRequest', 'the upload resumes at ' + s.received + ', not ' + start);
      drive.stats.puts.push({ name: s.meta.name, start });
      if (drive.cutNext) {
        const cut = drive.cutNext.bytes, lid = !!drive.cutNext.down;
        drive.cutNext = null;
        let got = 0;
        req.on('data', c => {
          if (got >= cut) return;
          const take = c.subarray(0, cut - got);
          s.chunks.push(take); s.received += take.length; got += take.length;
          if (got >= cut) { req.socket.destroy(); if (lid) drive.down(); }
        });
        return;
      }
      const data = await readBody(req);
      if (data === null) return;
      s.chunks.push(data); s.received += data.length;
      if (s.total < 0 || s.received < s.total) {
        return send(res, 308, '', s.received ? { Range: 'bytes=0-' + (s.received - 1) } : {});
      }
      return finishUpload(res, m[1], s);
    }

    m = /^\/drive\/v3\/files\/([^/]+)$/.exec(u.pathname);
    if (m) {
      const f = files.get(m[1]);
      if (!f) return fail(res, 404, 'notFound', 'File not found: ' + m[1]);
      if (req.method === 'GET') {
        if (u.searchParams.get('alt') === 'media') return send(res, 200, f.data || Buffer.alloc(0), { 'Content-Type': 'application/octet-stream' });
        return send(res, 200, meta(f));
      }
      if (req.method === 'PATCH') {
        const body = JSON.parse((await readBody(req)).toString() || '{}');
        if (body.name) f.name = body.name;
        if (body.appProperties) f.appProperties = Object.assign({}, f.appProperties, body.appProperties);
        const add = u.searchParams.get('addParents'), del = u.searchParams.get('removeParents');
        if (del) f.parents = f.parents.filter(p => p !== del);
        if (add) f.parents.push(add);
        f.modifiedTime = new Date().toISOString();
        return send(res, 200, meta(f));
      }
      if (req.method === 'DELETE') {
        files.delete(f.id);
        drive.stats.deletes.push(f.name);
        return send(res, 204);
      }
    }
    return fail(res, 404, 'notFound', 'the fake Drive has no ' + req.method + ' ' + u.pathname);
  }

  function finishUpload(res, id, s) {
    sessions.delete(id);
    if (drive.quotaFull) return fail(res, 403, 'storageQuotaExceeded', 'The user\'s Drive storage quota has been exceeded.');
    const data = Buffer.concat(s.chunks);
    const f = create(s.meta, data);
    drive.stats.uploads.push({ name: f.name, size: data.length });
    return send(res, 200, meta(f));
  }

  function listen() {
    return new Promise((resolve, reject) => {
      server = http.createServer((req, res) => {
        handle(req, res).catch(err => { try { fail(res, 500, 'backendError', String(err && err.message)); } catch (_) {} });
      });
      server.on('connection', s => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => {
        port = server.address().port;
        drive.url = 'http://127.0.0.1:' + port;
        resolve(drive);
      });
    });
  }

  Object.assign(drive, {
    start: listen,
    // Unreachable: connections are dropped and the port refuses. `up` brings it back on the SAME
    // port, because every profile's config file already names it.
    down() {
      return new Promise(resolve => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      });
    },
    up: listen,
    stop() { return drive.down(); },
    // The access token every client holds stops working; only the refresh endpoint mints a new one.
    expireToken() { valid.clear(); },
    files() { return Array.from(files.values()).map(meta); },
    read(id) { const f = files.get(id); return f ? f.data : null; },
    usage,
    // Seed a file as if another computer had left it.
    put(metaIn, data) { return meta(create(metaIn, data)); },
  });
  return drive;
}

module.exports = { createFakeDrive, FOLDER };

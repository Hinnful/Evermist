'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const sa = require('../electron/syncAuth.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sync-auth-'));
const fake = { clientId: 'c', clientSecret: 's', apiBase: 'http://127.0.0.1:1', tokenUrl: 'http://127.0.0.1:1/token' };
const google = { clientId: 'cid.apps.googleusercontent.com', clientSecret: 'sec' };

// A stand-in for safeStorage: reversible, and never the plain text.
const vault = (secure = true) => ({
  secure: () => secure,
  encrypt: text => Buffer.from(text, 'utf8').map(b => b ^ 0x5a),
  decrypt: buf => Buffer.from(buf).map(b => b ^ 0x5a).toString('utf8'),
});

const get = url => new Promise((resolve, reject) => {
  http.get(url, res => {
    const parts = [];
    res.on('data', c => parts.push(c));
    res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(parts).toString() }));
  }).on('error', reject);
});

// The browser and Google together: agrees on the consent page and calls the loopback back with a code.
function browser(answer) {
  const seen = { url: null, page: null };
  const open = async url => {
    seen.url = new URL(url);
    const p = seen.url.searchParams;
    const back = new URL(p.get('redirect_uri'));
    for (const [k, v] of Object.entries(answer || { code: 'the-code' })) back.searchParams.set(k, v);
    back.searchParams.set('state', p.get('state'));
    seen.page = await get(back.toString());
  };
  return { open, seen };
}

// The token endpoint: checks the verifier against the challenge the consent page was given.
function tokenEndpoint(seen, body) {
  const calls = [];
  const post = async (url, form) => {
    const f = new URLSearchParams(form);
    calls.push({ url, f });
    const hash = crypto.createHash('sha256').update(f.get('code_verifier')).digest('base64url');
    if (hash !== seen.url.searchParams.get('code_challenge')) return { status: 400, body: Buffer.from('{"error":"invalid_grant"}') };
    return { status: 200, body: Buffer.from(JSON.stringify(body || { refresh_token: 'rt-1', access_token: 'at' })) };
  };
  return { post, calls };
}

function signIn(dir, cfg, opts) {
  const b = browser(opts && opts.answer);
  const t = tokenEndpoint(b.seen, opts && opts.body);
  const a = sa.createAuth(dir, cfg, { post: t.post, open: b.open, vault: opts && 'vault' in opts ? opts.vault : vault(), timeoutMs: opts && opts.timeoutMs });
  return { a, b, t };
}

describe('the consent URL and PKCE', () => {
  it('asks Google for drive.appdata, offline, with consent, an S256 challenge and the state', () => {
    const u = new URL(sa.consentUrl(sa.authUrlFor(google), google.clientId, 'http://127.0.0.1:5000/oauth2callback', 'chal', 'st'));
    assert.equal(u.origin + u.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
    const p = Object.fromEntries(u.searchParams);
    assert.deepEqual(p, { client_id: google.clientId, redirect_uri: 'http://127.0.0.1:5000/oauth2callback', response_type: 'code',
      scope: 'https://www.googleapis.com/auth/drive.appdata', access_type: 'offline', prompt: 'consent',
      code_challenge: 'chal', code_challenge_method: 'S256', state: 'st' });
  });
  it('sends the rig to its fake Drive and Google to Google', () => {
    assert.equal(sa.authUrlFor(fake), 'http://127.0.0.1:1/auth');
    assert.equal(sa.tokenUrlFor(fake), 'http://127.0.0.1:1/token');
    assert.equal(sa.tokenUrlFor({ clientId: 'c', clientSecret: 's', apiBase: 'http://127.0.0.1:9/' }), 'http://127.0.0.1:9/token');
    assert.equal(sa.tokenUrlFor(google), 'https://oauth2.googleapis.com/token');
  });
  it('makes a verifier of RFC 7636 length and its SHA-256 challenge, both URL-safe', () => {
    const { verifier, challenge } = sa.pkcePair();
    assert.match(verifier, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(challenge, crypto.createHash('sha256').update(verifier).digest('base64url'));
    assert.notEqual(sa.pkcePair().verifier, verifier);
  });
  it('matches the RFC 7636 example pair', () => {
    const bytes = Buffer.from([116, 24, 223, 180, 151, 153, 224, 37, 79, 250, 96, 125, 216, 173, 187, 186, 22, 212, 37, 77, 105, 214, 191, 240, 91, 88, 5, 88, 83, 132, 141, 121]);
    assert.deepEqual(sa.pkcePair(bytes), { verifier: 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk', challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM' });
  });
});

describe('the loopback redirect', () => {
  it('takes the code only on the callback path with this sign-in\'s state', () => {
    assert.deepEqual(sa.readRedirect('/oauth2callback?code=abc&state=st', 'st'), { kind: 'code', code: 'abc' });
    assert.deepEqual(sa.readRedirect('/oauth2callback?error=access_denied&state=st', 'st'), { kind: 'error', error: 'access_denied' });
    for (const u of ['/oauth2callback?code=abc&state=other', '/oauth2callback?code=abc', '/elsewhere?code=abc&state=st', '/favicon.ico', '//bad host']) {
      assert.equal(sa.readRedirect(u, 'st').kind, 'ignore', u);
    }
  });
  it('compares states of any length without throwing', () => {
    assert.equal(sa.sameState('abc', 'abc'), true);
    assert.equal(sa.sameState('ab', 'abc'), false);
    assert.equal(sa.sameState('', 'abc'), false);
  });
  it('answers stray requests with a 404, takes the right one, shows a page and closes', async () => {
    const w = await sa.listenForCode('st');
    assert.match(w.redirectUri, /^http:\/\/127\.0\.0\.1:\d+\/oauth2callback$/);
    const root = w.redirectUri.replace('/oauth2callback', '');
    assert.equal((await get(root + '/favicon.ico')).status, 404);
    assert.equal((await get(w.redirectUri + '?code=x&state=wrong')).status, 404);
    const ok = await get(w.redirectUri + '?code=the-code&state=st');
    assert.equal(ok.status, 200);
    assert.match(ok.text, /return to Evermist/);
    assert.equal(await w.code, 'the-code');
    await assert.rejects(get(w.redirectUri + '?code=again&state=st'));
  });
  it('shows the page in Russian when asked', async () => {
    const w = await sa.listenForCode('st', { lang: 'ru' });
    assert.match((await get(w.redirectUri + '?code=c&state=st')).text, /вернуться в Evermist/);
    await w.code;
  });
  it('ends with denied when the DM cancels at Google, and with timeout when nobody answers', async () => {
    const w = await sa.listenForCode('st');
    assert.equal((await get(w.redirectUri + '?error=access_denied&state=st')).status, 200);
    await assert.rejects(w.code, err => err.authCode === 'denied');
    const late = await sa.listenForCode('st', { timeoutMs: 30 });
    await assert.rejects(late.code, err => err.authCode === 'timeout');
    await assert.rejects(get(late.redirectUri + '?code=c&state=st'));
  });
});

describe('the sync sign-in', () => {
  it('starts signed out; Connect trades a PKCE code and keeps the token sealed across a restart', async () => {
    const dir = tmp();
    const { a, b, t } = signIn(dir, google);
    assert.equal(a.signedIn(), false);
    assert.deepEqual(await a.connect(), { ok: true });
    assert.equal(b.seen.page.status, 200);
    assert.equal(t.calls.length, 1);
    const f = t.calls[0].f;
    assert.equal(t.calls[0].url, 'https://oauth2.googleapis.com/token');
    assert.equal(f.get('grant_type'), 'authorization_code');
    assert.equal(f.get('code'), 'the-code');
    assert.equal(f.get('client_secret'), 'sec');
    assert.equal(f.get('redirect_uri'), b.seen.url.searchParams.get('redirect_uri'));
    assert.equal(a.refreshToken(), 'rt-1');
    const sealed = fs.readFileSync(path.join(dir, 'sync', 'token.enc'));
    assert.equal(sealed.includes('rt-1'), false);
    assert.equal(fs.existsSync(path.join(dir, 'sync', 'token.json')), false);
    assert.equal(sa.createAuth(dir, google, { vault: vault() }).refreshToken(), 'rt-1');
  });
  it('without a secure store keeps the token in memory only and says so', async () => {
    const dir = tmp();
    const { a } = signIn(dir, google, { vault: vault(false) });
    assert.deepEqual(await a.connect(), { ok: true });
    assert.equal(a.signedIn(), true);
    assert.equal(a.remembered(), false);
    assert.deepEqual(fs.existsSync(path.join(dir, 'sync')) ? fs.readdirSync(path.join(dir, 'sync')) : [], []);
    assert.equal(sa.createAuth(dir, google, { vault: vault(false) }).signedIn(), false);
    assert.equal(sa.createAuth(dir, google, { vault: null }).remembered(), false);
  });
  it('a store that throws counts as none', () => {
    const a = sa.createAuth(tmp(), google, { vault: { secure: () => { throw new Error('no wallet'); } } });
    assert.equal(a.remembered(), false);
  });
  it('seals a plain token file from before, then deletes it', () => {
    const dir = tmp();
    fs.mkdirSync(path.join(dir, 'sync'));
    fs.writeFileSync(path.join(dir, 'sync', 'token.json'), JSON.stringify({ refreshToken: 'rt-old' }));
    assert.equal(sa.createAuth(dir, google, { vault: vault() }).refreshToken(), 'rt-old');
    assert.equal(fs.existsSync(path.join(dir, 'sync', 'token.json')), false);
    assert.equal(fs.existsSync(path.join(dir, 'sync', 'token.enc')), true);
    assert.equal(sa.createAuth(dir, google, { vault: vault() }).refreshToken(), 'rt-old');
  });
  it('without a secure store reads a plain token file and leaves it', () => {
    const dir = tmp();
    fs.mkdirSync(path.join(dir, 'sync'));
    fs.writeFileSync(path.join(dir, 'sync', 'token.json'), JSON.stringify({ refreshToken: 'rt-rig' }));
    assert.equal(sa.createAuth(dir, google, { vault: vault(false) }).refreshToken(), 'rt-rig');
    assert.equal(fs.existsSync(path.join(dir, 'sync', 'token.json')), true);
  });
  it('Disconnect forgets the token here and on disk', async () => {
    const dir = tmp();
    const { a } = signIn(dir, fake);
    await a.connect();
    fs.writeFileSync(path.join(dir, 'sync', 'token.json'), JSON.stringify({ refreshToken: 'rt-x' }));
    a.disconnect();
    assert.equal(a.signedIn(), false);
    assert.deepEqual(fs.readdirSync(path.join(dir, 'sync')), []);
    assert.equal(sa.createAuth(dir, fake, { vault: vault() }).signedIn(), false);
  });
  it('stays signed out when the DM cancels at Google, and asks the token endpoint nothing', async () => {
    const { a, t } = signIn(tmp(), google, { answer: { error: 'access_denied' } });
    assert.equal((await a.connect()).code, 'denied');
    assert.equal(t.calls.length, 0);
    assert.equal(a.signedIn(), false);
  });
  it('stays signed out when the endpoint refuses or sends no refresh token', async () => {
    const r = signIn(tmp(), fake);
    const refused = sa.createAuth(tmp(), fake, { open: r.b.open, vault: vault(), post: async () => ({ status: 400, body: Buffer.from('{}') }) });
    assert.equal((await refused.connect()).code, 'refused');
    const { a } = signIn(tmp(), fake, { body: { access_token: 'x' } });
    assert.equal((await a.connect()).ok, false);
    assert.equal(a.signedIn(), false);
  });
  it('a browser that cannot open ends the wait at once', async () => {
    const a = sa.createAuth(tmp(), google, { vault: vault(), post: async () => assert.fail('asked'), open: async () => { throw new Error('no browser'); } });
    const r = await a.connect();
    assert.equal(r.ok, false);
  });
  it('a second Connect replaces a wait still open', async () => {
    const opens = [];
    const b = browser();
    const a = sa.createAuth(tmp(), google, { vault: vault(), post: tokenEndpoint(b.seen).post,
      open: async url => { opens.push(url); if (opens.length === 2) await b.open(url); } });
    const first = a.connect();
    await new Promise(r => setTimeout(r, 20));
    assert.deepEqual(await a.connect(), { ok: true });
    assert.equal((await first).code, 'cancelled');
  });
  it('reads a damaged token file as signed out', () => {
    const dir = tmp();
    fs.mkdirSync(path.join(dir, 'sync'));
    fs.writeFileSync(path.join(dir, 'sync', 'token.json'), '{oops');
    fs.writeFileSync(path.join(dir, 'sync', 'token.enc'), 'not sealed by this store');
    assert.equal(sa.createAuth(dir, fake, { vault: vault() }).signedIn(), false);
  });
});

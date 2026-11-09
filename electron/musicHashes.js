'use strict';
// musicHashes.js — each track's content hash, kept in `userData/sync/music-hashes.json` so a sync tick reads the music
// folder without rehashing it. A track is hashed when it lands (copy, download, Claude's undo, a sync) and at start;
// a cached hash holds while the file keeps its size and time. Also moves a track into Recently deleted's folder and
// back with its hash. Pure Node, no Electron. Tested.

const fs = require('fs');
const path = require('path');
const { hashFile } = require('./fileHash.js');
const { uniqueMusicName } = require('../src/ui/musicPlan.js');
const { syMuNameOk } = require('../src/scenes/syncMusicPlan.js');

const HASH_RE = /^[0-9a-f]{64}$/;

const TOKEN_RE = /^[\w-][\w.-]{0,80}$/;

function createMusicHashes(musicDir, cacheFile, trashDir) {
  // files: name -> { size, mtime, hash }; stashed: a track in `.removed` under its token -> hash; trashed: a track in
  // `trashDir` under its token -> hash.
  let cache = null;
  const removedDir = path.join(musicDir, '.removed');

  function load() {
    if (cache) return cache;
    try { cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch (_) { cache = null; }
    if (!cache || typeof cache.files !== 'object' || typeof cache.stashed !== 'object') cache = { files: {}, stashed: {} };
    if (!cache.trashed || typeof cache.trashed !== 'object') cache.trashed = {};
    return cache;
  }
  async function save() {
    await fs.promises.mkdir(path.dirname(cacheFile), { recursive: true });
    await fs.promises.writeFile(cacheFile, JSON.stringify(cache));
  }
  const partPath = hash => path.join(musicDir, '.sync-' + hash + '.part');
  const trackPath = name => (syMuNameOk(name) ? path.join(musicDir, name) : null);
  const fresh = (c, st) => !!c && c.size === st.size && c.mtime === st.mtimeMs && HASH_RE.test(c.hash);

  // The folder's tracks as [{ name, size, hash }], `hash` null for a file not hashed yet unless `withHash`, and the
  // hashes of the tracks waiting in Claude's undo folder.
  async function list(withHash) {
    const c = load();
    let names = [];
    try { names = await fs.promises.readdir(musicDir); } catch (_) { names = []; }
    const tracks = [], seen = new Set();
    let changed = false;
    for (const name of names) {
      if (!syMuNameOk(name)) continue;
      let st;
      try { st = await fs.promises.stat(path.join(musicDir, name)); } catch (_) { continue; }
      if (!st.isFile()) continue;
      seen.add(name);
      let hash = fresh(c.files[name], st) ? c.files[name].hash : null;
      if (!hash && withHash) {
        try { hash = await hashFile(path.join(musicDir, name)); } catch (_) { hash = null; }
        if (hash) { c.files[name] = { size: st.size, mtime: st.mtimeMs, hash }; changed = true; }
      }
      tracks.push({ name, size: st.size, hash });
    }
    for (const n of Object.keys(c.files)) if (!seen.has(n)) { delete c.files[n]; changed = true; }
    let tokens = [];
    try { tokens = await fs.promises.readdir(removedDir); } catch (_) { tokens = []; }
    for (const t of Object.keys(c.stashed)) if (!tokens.includes(t)) { delete c.stashed[t]; changed = true; }
    if (changed) await save();
    return { tracks, stashed: tokens.map(t => c.stashed[t]).filter(h => HASH_RE.test(h || '')) };
  }

  // A downloaded track into the folder under its own name, or "Name (2).ext" when that is taken. Answers the name.
  async function place(partPath, name, hash) {
    if (!syMuNameOk(name) || !HASH_RE.test(hash)) throw new Error('a track name the music folder would not take');
    const c = load();
    for (;;) {
      const taken = await fs.promises.readdir(musicDir).catch(() => []);
      const final = uniqueMusicName(name, taken), dest = path.join(musicDir, final);
      // A link never lands over a file that took the name meanwhile; a disk without links copies instead.
      try { await fs.promises.link(partPath, dest); } catch (err) {
        if (err.code === 'EEXIST') continue;
        try { await fs.promises.copyFile(partPath, dest, fs.constants.COPYFILE_EXCL); } catch (e) { if (e.code === 'EEXIST') continue; throw e; }
      }
      await fs.promises.unlink(partPath).catch(() => {});
      const st = await fs.promises.stat(dest);
      c.files[final] = { size: st.size, mtime: st.mtimeMs, hash };
      await save();
      return final;
    }
  }

  const trashPath = token => {
    if (typeof token !== 'string' || !TOKEN_RE.test(token)) throw new Error('not a track in the Trash');
    return path.join(trashDir, token);
  };
  const hashOf = async (c, name, full, st) => (fresh(c.files[name], st) ? c.files[name].hash : hashFile(full));

  // ⚠ MOVED, NEVER UNLINKED: a deleted track leaves the folder for `trashDir` under `token`. Answers its hash.
  async function trash(name, token) {
    const dest = trashPath(token), full = trackPath(name);
    if (!full) throw new Error('not a track in the music folder');
    const st = await fs.promises.stat(full), c = load(), hash = await hashOf(c, name, full, st);
    await fs.promises.mkdir(trashDir, { recursive: true });
    await fs.promises.rename(full, dest);
    delete c.files[name];
    c.trashed[token] = hash;
    await save();
    return hash;
  }

  // A track another computer deleted moves into `trashDir` under `token`, only while the file under that name is still
  // that content.
  async function remove(name, hash, token) {
    const full = trackPath(name);
    if (!full) return false;
    let st;
    try { st = await fs.promises.stat(full); } catch (_) { return false; }
    if (await hashOf(load(), name, full, st) !== hash) return false;
    return (await trash(name, token)) === hash;
  }

  // A trashed track back into the folder under its name, or "Name (2).ext" when that is taken. Answers the name.
  async function untrash(token, name) {
    const src = trashPath(token), c = load();
    const hash = HASH_RE.test(c.trashed[token] || '') ? c.trashed[token] : await hashFile(src);
    const back = await place(src, name, hash);
    delete c.trashed[token];
    await save();
    return back;
  }

  // The only unlink of a trashed track, and only inside `trashDir`.
  async function purgeTrash(token) {
    await fs.promises.unlink(trashPath(token)).catch(() => {});
    const c = load();
    if (token in c.trashed) { delete c.trashed[token]; await save(); }
  }

  return { list, place, trash, remove, untrash, purgeTrash, partPath, trackPath };
}

module.exports = { createMusicHashes };

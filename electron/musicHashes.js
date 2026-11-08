'use strict';
// musicHashes.js — each track's content hash, kept in `userData/sync/music-hashes.json` so a sync tick reads the music
// folder without rehashing it. A track is hashed when it lands (copy, download, Claude's undo, a sync) and at start;
// a cached hash holds while the file keeps its size and time. Pure Node, no Electron. Tested.

const fs = require('fs');
const path = require('path');
const { hashFile } = require('./fileHash.js');
const { uniqueMusicName } = require('../src/ui/musicPlan.js');
const { syMuNameOk } = require('../src/scenes/syncMusicPlan.js');

const HASH_RE = /^[0-9a-f]{64}$/;

function createMusicHashes(musicDir, cacheFile) {
  // files: name -> { size, mtime, hash }; stashed: a track in `.removed` under its token -> hash.
  let cache = null;
  const removedDir = path.join(musicDir, '.removed');

  function load() {
    if (cache) return cache;
    try { cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch (_) { cache = null; }
    if (!cache || typeof cache.files !== 'object' || typeof cache.stashed !== 'object') cache = { files: {}, stashed: {} };
    return cache;
  }
  async function save() {
    await fs.promises.mkdir(path.dirname(cacheFile), { recursive: true });
    await fs.promises.writeFile(cacheFile, JSON.stringify(cache));
  }
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

  // Claude's delete moved a track into the undo folder, and its undo moved it back under `back`.
  async function stashed(name, token) {
    const c = load();
    if (c.files[name]) { c.stashed[token] = c.files[name].hash; delete c.files[name]; await save(); }
  }
  async function unstashed(token, back) {
    const c = load(), h = c.stashed[token];
    delete c.stashed[token];
    if (h) {
      try { const st = await fs.promises.stat(path.join(musicDir, back)); c.files[back] = { size: st.size, mtime: st.mtimeMs, hash: h }; } catch (_) { /* hashed at the next list */ }
    }
    await save();
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

  // A track another computer deleted leaves the folder, only while the file under that name is still that content.
  async function remove(name, hash) {
    if (!syMuNameOk(name)) return false;
    const full = path.join(musicDir, name);
    let st;
    try { st = await fs.promises.stat(full); } catch (_) { return false; }
    const c = load();
    const now = fresh(c.files[name], st) ? c.files[name].hash : await hashFile(full);
    if (now !== hash) return false;
    await fs.promises.unlink(full);
    delete c.files[name];
    await save();
    return true;
  }

  const partPath = hash => path.join(musicDir, '.sync-' + hash + '.part');
  const trackPath = name => (syMuNameOk(name) ? path.join(musicDir, name) : null);

  return { list, stashed, unstashed, place, remove, partPath, trackPath };
}

module.exports = { createMusicHashes };

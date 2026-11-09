'use strict';
// syncMerge.js — the silent merge entry: a record pulled from another computer, applied with Import's plan rules
// (transferPlan.js) and none of what `restoreFromZipPath` does around them. ⚠ NO exitPanes, commitPendingDelete, forced
// save, progress bar, switchScene, report or dialog: a change never lands under the DM's hands. What the DM has on screen
// is held (`syHeld`) and applied once let go, and a delete in its undo window defers everything. One record per idle
// slice; every stretch that holds the page is a `sync:` performance measure, and none may pass 50 ms.
// A pulled record is { format, key, ... }. scene: `rec` (the stored record, no Blobs), `thumb` (base64), `blobs`
// { map, fog } as { name, mime }. pic: `pic`, `blob`. local: `text`, `at`. campaign: `text` (syncCampaignText).
// backdrop: `meta`, `blob`. sync.js packs them.

const syncMerge = (() => {
  const SLICE_WARN_MS = 50;

  // Marks and measures one synchronous stretch; the rig reads the `sync:` measures back.
  function slice(name, fn) {
    const a = 'sync:' + name + ':a', b = 'sync:' + name + ':b';
    performance.mark(a);
    try { return fn(); } finally {
      performance.mark(b);
      const m = performance.measure('sync:' + name, a, b);
      performance.clearMarks(a); performance.clearMarks(b);
      if (m.duration > SLICE_WARN_MS) console.warn('[sync] a slice of ' + name + ' took ' + Math.round(m.duration) + ' ms');
    }
  }

  const idle = () => new Promise(r => (window.requestIdleCallback ? window.requestIdleCallback(() => r(), { timeout: 400 }) : setTimeout(r, 0)));

  // What a note open in the Notes window lives in, as a record key.
  function openNoteKey() {
    if (typeof nwIsOpen !== 'function' || !nwIsOpen() || typeof _ntSel === 'undefined' || !_ntSel) return null;
    if (_ntSel === 'campaign') return 'local:evermist.campaignNotes';
    let m = /^map:(.+)$/.exec(_ntSel) || /^room:([^:]+):/.exec(_ntSel);
    if (m) return 'scene:' + m[1];
    if (/^monster:/.test(_ntSel)) return 'local:evermist.combat';
    if (/^entry:/.test(_ntSel)) return 'local:evermist.notesEntries';
    if (/^(place|road):/.test(_ntSel)) return 'campaign';
    return null;
  }

  function context() {
    const cb = document.getElementById('cb-fight');
    return {
      openScene: currentScene ? currentScene.id : null,
      tvScene: tvSceneId,
      paneScenes: panesActive ? livePanes().map(id => panes[id].sceneId).filter(Boolean) : [],
      fightTable: !!cb && cb.style.display === 'block',
      openNoteKey: openNoteKey(),
    };
  }

  const held = key => syHeld(key, context());
  // A delete the DM can still undo, or a stopped job, is no moment to touch the library.
  const deferred = () => (typeof smPending !== 'undefined' && !!smPending);

  const _thumb = b64 => {
    if (typeof b64 !== 'string' || !b64) return null;
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    return new Blob([bytes], { type: 'image/jpeg' });
  };
  const _ext = e => (/\.mp4$/.test(e.mapPath || '') ? '.mp4' : '.webm');

  function _meta(rec) {
    return { id: rec.id, name: rec.name, group: rec.group || '', thumbnail: rec.thumbnail, sortOrder: rec.sortOrder, createdAt: rec.createdAt, mapType: rec.mapType, worldPos: rec.worldPos };
  }

  function _cardUpdated(rec) {
    const meta = allScenes.find(s => s.id === rec.id);
    if (meta) Object.assign(meta, _meta(rec));
    else { allScenes.push(_meta(rec)); allScenes.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)); }
    if (thumbURLs.has(rec.id)) { URL.revokeObjectURL(thumbURLs.get(rec.id)); thumbURLs.delete(rec.id); }
    sceneListChanged();
  }

  // A map another computer deleted moves into this computer's Recently deleted, `at` the deletion record's time so both
  // count the same days. ⚠ NOT deleteScenesWithUndo or commitPendingDelete: no toast, no undo, no switch, and the DM's
  // own pending delete untouched. The caller holds a map on screen and defers while a delete is pending.
  async function drop(id, at) {
    const i = allScenes.findIndex(s => s.id === id);
    if (i !== -1) allScenes.splice(i, 1);
    const roads = sceneTrash.roadsOf([id]);
    worldRoadsSceneGone([id]);
    await sceneTrash.put([id], at, roads);
    sceneListChanged();
  }

  async function _scene(r, io, ctx) {
    const e = r.rec;
    if (!e || typeof e.id !== 'string' || !TI_SAFE_ID.test(e.id) || r.key !== 'scene:' + e.id) return { skipped: 'bad' };
    const id = e.id, moment = Date.now(), video = e.mapType === 'video';
    const mb = r.blobs && r.blobs.map, fb = r.blobs && r.blobs.fog;
    const local = await sceneStore.loadScene(id);
    const thumb = slice('thumb', () => _thumb(r.thumb));
    const mapPath = `maps/${id}${_ext(e)}`;

    if (!local) {
      const rec = slice('build', () => ({ ...e, pictureBlobs: {}, mapPath: video ? mapPath : undefined, thumbnail: thumb }));
      // ⚠ A map file is in place BEFORE its record is saved: the index hashes the file as the record lands.
      if (mb && video) { if (await io.video(mb.name, id)) await io.place(id, _ext(e)); }
      else if (mb) rec.mapBlob = await io.blob(mb.name, mb.mime || 'image/jpeg');
      if (fb) rec.baseFogBlob = await io.blob(fb.name, 'image/png');
      await sceneStore.putScene(rec);
      _cardUpdated(rec);
      return { applied: true, added: true };
    }

    const missing = video ? !(await window.electronAPI.getVideoFilePath(id)) : !local.mapBlob;
    const plan = slice('plan', () => tpMergeScene(local, e, moment, { localMapMissing: missing }));
    const take = plan.take;
    // The first sync replaces no map file: the local one stays, and its time with it.
    if (ctx.firstSync && !missing) { take.map = false; plan.record.edits.scene.map = tpTime((local.edits || {}).scene, 'map', moment); }
    const rec = slice('build', () => ({ ...tpExtraFields(e), ...local, ...plan.record }));
    if (take.fog && fb) { rec.baseFogBlob = await io.blob(fb.name, 'image/png'); delete rec.baseFogPNG; }
    if ((take.map && mb || take.fog && fb) && thumb) rec.thumbnail = thumb;
    let staged = false;
    if (take.map && mb) {
      const size = { mapWidth: e.mapWidth, mapHeight: e.mapHeight };
      if (video) { staged = await io.video(mb.name, id); if (staged) Object.assign(rec, size, { mapType: 'video', mapPath, mapBlob: undefined }); }
      else Object.assign(rec, size, { mapType: 'image', mapPath: undefined, mapBlob: await io.blob(mb.name, mb.mime || 'image/jpeg') });
    }
    if (rec.floorPlan === undefined) { rec.floorPlan = e.floorPlan; rec.floorPlanName = e.floorPlanName; }
    if (take.place) { rec.group = sanitizeGroupName(rec.group); rec.worldPos = _tiRestoredPos(rec.worldPos, { dx: 0, dy: 0 }); }
    const changed = slice('compare', () => syRecordBody(rec) !== syRecordBody(local)) || take.fog && fb || take.map && mb;
    if (!changed) { if (staged) await io.dropPart(id); return { applied: false, same: true }; }
    if (ctx.keep) await ctx.keep(r.key, local);
    if (staged) {
      try { await io.place(id, _ext(e)); } catch (err) {
        console.error('[sync] a map file could not be put in place', err);
        await io.dropPart(id);
        return { skipped: 'file' };
      }
    }
    // The picture it replaces is kept 30 days; a video is kept by placeVideo.
    if (take.map && mb && local.mapBlob) await io.keepMap(id, local.mapBlob);
    await sceneStore.putScene(rec);
    _cardUpdated(rec);
    return { applied: true };
  }

  async function _pic(r, io, ctx) {
    const p = r.pic, b = r.blob;
    if (!p || typeof p.id !== 'string' || !TI_SAFE_ID.test(p.id) || r.key !== 'pic:' + p.id || !b) return { skipped: 'bad' };
    const have = (await galleryStore.all()).find(x => x.id === p.id);
    if (have && !(ctx.remoteAt > ctx.localAt)) return { applied: false };
    // A picture deleted here after its last edit stays out, as from a backup.
    if (!have && galleryGoneApply([], [p], galleryGone(), {}, Date.now()).skip.length) return { applied: false };
    const blob = await io.blob(b.name, p.type || 'image/png');
    if (ctx.keep && have) await ctx.keep(r.key, { id: have.id, name: have.name, added: have.added, named: have.named });
    await galleryStore.put({ id: p.id, name: p.name, added: p.added, named: p.named, blob });
    if (typeof galleryReload === 'function') await galleryReload();
    return { applied: true };
  }

  // The Campaign's places, roads and party marker, and the pictures deleted elsewhere, through Import's own path in.
  // `ctx.sceneIds`: maps on their way here, which a road's end or the marker keeps though they have not landed yet.
  async function _campaign(r, ctx) {
    if (syCampaignText(r.text) === null) return { skipped: 'bad' };
    const moment = Date.now();
    if (ctx.keep) await ctx.keep(r.key, syncCampaignText());
    const world = slice('campaign', () => tiWorldPlan(r.text, [], moment));
    const sceneMap = Object.create(null);
    for (const id of allScenes.map(x => x.id).concat(ctx.sceneIds || [])) sceneMap[id] = id;
    slice('campaign', () => tiAdoptWorld(r.text, world.plans, { dx: 0, dy: 0 }, sceneMap, world.mentions.groupUids));
    await galleryAdoptGone(world.gone.pictures);
    if (worldMapOpen) slice('campaign', worldMapRefresh);
    return { applied: true };
  }

  // The newer backdrop wins, as from a backup; its picture is fetched only then.
  async function _backdrop(r, io, ctx) {
    const b = r.blob;
    if (typeof r.meta !== 'string' || !b || !syBlobNameOk(b.name)) return { skipped: 'bad' };
    if (ctx.keep) await ctx.keep(r.key, localStorage.getItem('evermist.worldBg'));
    const say = m => console.error('[sync] the backdrop:', m.message);
    return { applied: await worldBackgroundAdopt(r.meta, () => io.blob(b.name, b.type || ''), null, Date.now(), say) === 'took' };
  }

  // Campaign text, the fight table and the factions and lore go through the rules Import uses for them; module text
  // takes the newer copy and asks nothing.
  function _local(r, ctx) {
    const key = r.key.slice(6);
    if (key === 'evermist.campaignNotes') {
      const cur = notesCampaignGet(), m = notesPickCampaign(cur, notesCampaignAt(), r.text, r.at, Date.now());
      if (ctx.keep) ctx.keep(r.key, cur);
      if (m.text !== cur) notesCampaignSet(m.text, m.at);
      return { applied: m.text !== cur };
    }
    if (key === 'evermist.campaignNotesAt') return { applied: false };
    if (key === 'evermist.combat' || key === 'evermist.combatFights') {
      if (ctx.keep) ctx.keep(r.key, localStorage.getItem(key));
      return { applied: cbMergePayload(r.text).ok };
    }
    if (key === 'evermist.notesEntries') {
      let d;
      try { d = JSON.parse(r.text); } catch (_) { return { skipped: 'bad' }; }
      if (ctx.keep) ctx.keep(r.key, localStorage.getItem(key));
      notesEntriesAdopt(d && d.entries, esGoneClean(d && d.gone));
      return { applied: true };
    }
    if (key === 'evermist.moduleText') {
      if (!(ctx.remoteAt > ctx.localAt)) return { applied: false };
      if (ctx.keep) ctx.keep(r.key, localStorage.getItem(key));
      return { applied: mtRestorePayload(r.text).ok };
    }
    return { skipped: 'kind' };
  }

  // The kinds this release applies; the rest are neither sent nor taken.
  const KINDS = ['scene:', 'pic:', 'campaign', 'backdrop', 'local:evermist.campaignNotes', 'local:evermist.campaignNotesAt', 'local:evermist.combat',
    'local:evermist.combatFights', 'local:evermist.notesEntries', 'local:evermist.moduleText'];
  const supported = key => KINDS.some(k => key === k || (k.endsWith(':') && key.startsWith(k)));

  // `ctx`: firstSync, keep(key, copy), remoteAt, localAt. Never throws for a record it cannot read: it answers skipped.
  async function apply(r, io, ctx) {
    if (!r || !(r.format <= SY_FORMAT)) return { skipped: 'format' };
    if (r.key.startsWith('scene:')) return _scene(r, io, ctx || {});
    if (r.key.startsWith('pic:')) return _pic(r, io, ctx || {});
    if (r.key === 'campaign') return _campaign(r, ctx || {});
    if (r.key === 'backdrop') return _backdrop(r, io, ctx || {});
    return slice('local', () => _local(r, ctx || {}));
  }

  return { apply, drop, held, deferred, context, idle, slice, supported, cardUpdated: _cardUpdated };
})();

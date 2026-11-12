'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const T = require('../src/scenes/transferPlan.js');

const NOW = 10000;
const sq = (n = 0) => [{ x: n, y: 0 }, { x: 9, y: 0 }, { x: 9, y: 9 }];
const room = (id, extra) => ({ id, uid: 'u' + id, name: 'Room ' + id, mode: 'shroud', vertices: sq(), ...extra });
const scene = (polygons, edits, extra) => ({ id: 's', name: 'Cave', polygons, effects: [], notes: '', edits, ...extra });
const find = (rec, uid) => rec.polygons.find(r => r.uid === uid);

describe('tpSceneIds', () => {
  const safe = id => /^[0-9a-zA-Z_-]+$/.test(id);
  let n = 0;
  const mint = () => 'new' + (++n);
  it('matches a scene the library holds and keeps a free safe id', () => {
    const r = T.tpSceneIds([{ id: 'a' }, { id: 'b' }], new Set(['a']), safe, mint);
    assert.deepEqual(r.map(x => [x.id, x.matched]), [['a', true], ['b', false]]);
  });
  it('mints an id for an unsafe one and for a repeat in the same file', () => {
    const r = T.tpSceneIds([{ id: '../x' }, { id: 'a' }, { id: 'a' }], new Set(['a']), safe, mint);
    assert.equal(r[0].matched, false);
    assert.ok(safe(r[0].id));
    assert.equal(r[1].matched, true);
    assert.notEqual(r[2].id, 'a');
  });
});

describe('tpMergeScene: TV fit', () => {
  it('takes an incoming fit edited later and keeps a local one edited later', () => {
    const fit = { step: 1, turn: 90 };
    const take = T.tpMergeScene(scene([], { scene: { tvFit: 100 } }), scene([], { scene: { tvFit: 300 } }, { tvFit: fit }), NOW);
    assert.deepEqual(take.record.tvFit, fit);
    assert.deepEqual(take.report.changed, [{ room: '', part: 'tvFit' }]);
    const keep = T.tpMergeScene(scene([], { scene: { tvFit: 500 } }, { tvFit: fit }), scene([], { scene: { tvFit: 300 } }), NOW);
    assert.equal(keep.take.tvFit, false);
    assert.equal(keep.record.tvFit, undefined);
  });
  it('reads a scene with no fit and one stepped back to Off as the same', () => {
    const m = T.tpMergeScene(scene([], undefined), scene([], undefined, { tvFit: { step: 0, turn: 0 } }), NOW);
    assert.equal(m.touched, false);
  });
  it('has a label for the part', () => assert.equal(T.TP_PART_LABEL.tvFit, 'TV fit'));
});

describe('tpMergeScene: time of day', () => {
  it('takes an incoming time of day edited later and keeps a local one edited later', () => {
    const take = T.tpMergeScene(scene([], { scene: { timeOfDay: 100 } }, { timeOfDay: 'day' }), scene([], { scene: { timeOfDay: 300 } }, { timeOfDay: 'night' }), NOW);
    assert.equal(take.record.timeOfDay, 'night');
    assert.deepEqual(take.report.changed, [{ room: '', part: 'timeOfDay' }]);
    const keep = T.tpMergeScene(scene([], { scene: { timeOfDay: 500 } }, { timeOfDay: 'day' }), scene([], { scene: { timeOfDay: 300 } }, { timeOfDay: 'night' }), NOW);
    assert.equal(keep.take.timeOfDay, false);
  });
  it('reads a map with no time of day and one set back to None as the same, and labels the part', () => {
    const m = T.tpMergeScene(scene([], undefined), scene([], undefined, { timeOfDay: 'none' }), NOW);
    assert.equal(m.touched, false);
    assert.equal(T.TP_PART_LABEL.timeOfDay, 'time of day');
  });
});

describe('tpMergeScene: weather', () => {
  it('takes an incoming weather edited later and keeps a local one edited later', () => {
    const take = T.tpMergeScene(scene([], { scene: { weather: 100 } }, { weather: 'rain' }), scene([], { scene: { weather: 300 } }, { weather: 'storm' }), NOW);
    assert.equal(take.record.weather, 'storm');
    assert.deepEqual(take.report.changed, [{ room: '', part: 'weather' }]);
    const keep = T.tpMergeScene(scene([], { scene: { weather: 500 } }, { weather: 'rain' }), scene([], { scene: { weather: 300 } }, { weather: 'storm' }), NOW);
    assert.equal(keep.take.weather, false);
    assert.equal(keep.record.weather, undefined);
  });
  it('lets a file from before weather leave a dry-weather-stamped map alone, and labels the part', () => {
    const m = T.tpMergeScene(scene([], { scene: { weather: 400 } }, { weather: 'fair' }), scene([], undefined), NOW);
    assert.equal(m.take.weather, false);
    assert.equal(T.TP_PART_LABEL.weather, 'weather');
  });
  it('reads a map with no weather and one set back to No weather as the same', () => {
    assert.equal(T.tpMergeScene(scene([], undefined), scene([], undefined, { weather: 'none' }), NOW).touched, false);
  });
});

describe('tpMergeScene: parts', () => {
  it('takes an incoming part edited later and keeps a local part edited later', () => {
    const local = scene([], { scene: { name: 100, notes: 500 } }, { name: 'Local', notes: 'local' });
    const inc = scene([], { scene: { name: 300, notes: 200 } }, { name: 'Home', notes: 'home' });
    const m = T.tpMergeScene(local, inc, NOW);
    assert.equal(m.record.name, 'Home');
    assert.equal(m.record.notes, undefined);
    assert.equal(m.take.notes, false);
    assert.deepEqual(m.record.edits.scene.name, 300);
    assert.deepEqual(m.report.overwritten, [{ room: '', part: 'name' }]);
    assert.deepEqual(m.report.kept, [{ room: '', part: 'notes' }]);
  });

  it('counts no time as oldest and gives a tie to the incoming copy', () => {
    const local = scene([], { scene: { name: 50 } }, { name: 'Local' });
    assert.equal(T.tpMergeScene(local, scene([], undefined, { name: 'Home' }), NOW).record.name, undefined);
    const tie = T.tpMergeScene(scene([], undefined, { name: 'Local' }), scene([], undefined, { name: 'Home' }), NOW);
    assert.equal(tie.record.name, 'Home');
  });

  it('counts an incoming time past the import moment as that moment', () => {
    const local = scene([], { scene: { name: 5000 } }, { name: 'Local' });
    const inc = scene([], { scene: { name: 99999999 } }, { name: 'Home' });
    const m = T.tpMergeScene(local, inc, NOW);
    assert.equal(m.record.name, 'Home');
    assert.equal(m.record.edits.scene.name, NOW);
  });

  it('takes a map only when it is newer, or when the local one is gone', () => {
    const local = scene([], { scene: { map: 10 } });
    assert.equal(T.tpMergeScene(local, scene([], { scene: { map: 10 } }), NOW).take.map, false);
    assert.equal(T.tpMergeScene(local, scene([], { scene: { map: 20 } }), NOW).take.map, true);
    assert.equal(T.tpMergeScene(local, scene([], { scene: { map: 10 } }), NOW, { localMapMissing: true }).take.map, true);
  });
});

describe('tpMergeScene: fog, grid, fog look and lights', () => {
  const ES = require('../src/scenes/editStamps.js');
  const at = (part, t) => ({ scene: { [part]: t } });

  it('keeps fog painted at the table through an import of an older copy, and takes newer fog', () => {
    const keep = T.tpMergeScene(scene([], at('fog', 500)), scene([], at('fog', 300)), NOW);
    assert.equal(keep.take.fog, false);
    assert.deepEqual(keep.report.kept, [{ room: '', part: 'fog' }]);
    assert.equal(keep.record.edits.scene.fog, 500);
    const take = T.tpMergeScene(scene([], at('fog', 300)), scene([], at('fog', 500)), NOW);
    assert.equal(take.take.fog, true);
    assert.deepEqual(take.report.overwritten, [{ room: '', part: 'fog' }]);
  });

  it('takes a newer grid, fog look and lights, and keeps local ones edited later', () => {
    const mine = { gridConfig: { size: 50 }, fogSettings: { blur: 1 }, lightsHidden: false, lightShapes: [] };
    const home = { gridConfig: { size: 70 }, fogSettings: { blur: 5 }, fogTheme: 'ice', lightsHidden: true, lightShapes: [{ id: 1 }] };
    const old = { scene: { grid: 100, fogSettings: 100, lights: 100 } };
    const newer = { scene: { grid: 300, fogSettings: 300, lights: 300 } };
    const take = T.tpMergeScene(scene([], old, mine), scene([], newer, home), NOW).record;
    assert.deepEqual(take.gridConfig, home.gridConfig);
    assert.deepEqual(take.fogSettings, home.fogSettings);
    assert.equal(take.fogTheme, 'ice');
    assert.equal(take.lightsHidden, true);
    assert.deepEqual(take.lightShapes, home.lightShapes);
    const keep = T.tpMergeScene(scene([], newer, mine), scene([], old, home), NOW);
    for (const f of ['gridConfig', 'fogSettings', 'fogTheme', 'lightsHidden', 'lightShapes']) assert.equal(keep.record[f], undefined, f);
    assert.equal(keep.report.kept.length, 3);
  });

  it('labels every scene part and writes each one it takes onto the record', () => {
    const mine = { name: 'Local', gridConfig: { size: 50 }, notes: 'local', fogSettings: { blur: 1 }, weather: 'rain', timeOfDay: 'day',
      lightsHidden: false, lightShapes: [], tvFit: { step: 1, turn: 0 }, group: 'Town', worldPos: { x: 1, y: 2 }, polygons: [room(1), room(2)] };
    const home = { name: 'Home', gridConfig: { size: 70 }, notes: 'home', fogSettings: { blur: 5 }, fogTheme: 'ice',
      weather: 'storm', timeOfDay: 'night', lightsHidden: true, lightShapes: [{ id: 1 }], tvFit: { step: 2, turn: 90 }, group: 'Keep', worldPos: { x: 5, y: 6 },
      polygons: [room(2), room(1)] };
    for (const part of ES.ES_SCENE_PARTS) {
      assert.ok(T.TP_PART_LABEL[part], part + ' has a label');
      const local = scene([], { scene: Object.fromEntries(ES.ES_SCENE_PARTS.map(p => [p, p === part ? 100 : 500])) }, mine);
      const inc = scene([], { scene: Object.fromEntries(ES.ES_SCENE_PARTS.map(p => [p, 300])) }, home);
      const m = T.tpMergeScene(local, inc, NOW);
      assert.deepEqual(ES.ES_SCENE_PARTS.filter(p => m.take[p]), [part]);
      assert.ok(m.report.changed.some(c => c.part === part), part + ' is reported');
      // Map and fog are files; the caller takes them from the zip on `take`.
      if (part === 'map' || part === 'fog') continue;
      assert.equal(ES.esSceneParts({ ...local, ...m.record })[part], ES.esSceneParts(inc)[part], part + ' is applied');
    }
  });
});

describe('tpMergeScene: the group and spot on the Campaign', () => {
  const at = (group, x) => ({ group, worldPos: { x, y: 0 } });
  it('takes a map moved later at home, and keeps one moved later here', () => {
    const take = T.tpMergeScene(scene([], { scene: { place: 100 } }, at('Town', 1)), scene([], { scene: { place: 300 } }, at('Keep', 9)), NOW);
    assert.equal(take.record.group, 'Keep');
    assert.deepEqual(take.record.worldPos, { x: 9, y: 0 });
    assert.ok(take.touched);
    const keep = T.tpMergeScene(scene([], { scene: { place: 500 } }, at('Town', 1)), scene([], { scene: { place: 300 } }, at('Keep', 9)), NOW);
    assert.equal(keep.record.group, undefined);
    assert.deepEqual(keep.report.kept, [{ room: '', part: 'place' }]);
  });
  it('moves no card when neither copy has a time, and lets a timed move beat an untimed card', () => {
    const none = T.tpMergeScene(scene([], undefined, at('Town', 1)), scene([], undefined, at('Keep', 9)), NOW);
    assert.equal(none.take.place, false);
    assert.equal(none.record.group, undefined);
    const timed = T.tpMergeScene(scene([], undefined, at('Town', 1)), scene([], { scene: { place: 300 } }, at('Keep', 9)), NOW);
    assert.equal(timed.record.group, 'Keep');
  });
  it('labels the part with a string the Russian dictionary already has', () => assert.equal(T.TP_PART_LABEL.place, 'Group'));
});

describe('tpMergeScene: rooms', () => {
  it('keeps a room the table revealed through an import of the untouched scene', () => {
    const local = scene([room(1, { mode: 'revealed' })], { rooms: { u1: { mode: 5000 } } });
    const inc = scene([room(1)], { rooms: { u1: { mode: 100 } } });
    const m = T.tpMergeScene(local, inc, NOW);
    assert.equal(find(m.record, 'u1').mode, 'revealed');
    assert.equal(m.touched, false);
  });

  it('keeps notes from home and the reveal from the table in one room', () => {
    const local = scene([room(1, { mode: 'revealed' })], { rooms: { u1: { mode: 5000, notes: 100 } } });
    const inc = scene([room(1, { desc: 'New notes' })], { rooms: { u1: { notes: 3000, mode: 100 } } });
    const r = find(T.tpMergeScene(local, inc, NOW).record, 'u1');
    assert.equal(r.mode, 'revealed');
    assert.equal(r.desc, 'New notes');
  });

  it('takes the incoming shape and state when home edited later', () => {
    const local = scene([room(1)], { rooms: { u1: { shape: 100, mode: 100 } } });
    const inc = scene([room(1, { mode: 'revealed', vertices: sq(2) })], { rooms: { u1: { shape: 900, mode: 900 } } });
    const m = T.tpMergeScene(local, inc, NOW);
    const r = find(m.record, 'u1');
    assert.equal(r.mode, 'revealed');
    assert.equal(r.vertices[0].x, 2);
    assert.deepEqual(m.report.overwritten, [{ room: 'Room 1', part: 'shape' }, { room: 'Room 1', part: 'mode' }]);
  });

  it('appends a room new from home that overlaps nothing, with home state, and keeps the local order', () => {
    const local = scene([room(1, { mode: 'revealed' }), room(2)]);
    const inc = scene([room(3, { id: 5, vertices: sq().map(v => ({ x: v.x + 100, y: v.y })) }), room(1)]);
    const m = T.tpMergeScene(local, inc, NOW);
    assert.deepEqual(m.record.polygons.map(r => r.uid), ['u1', 'u2', 'u3']);
    assert.equal(find(m.record, 'u3').mode, 'shroud');
    assert.deepEqual(m.report.roomsAdded, ['Room 3']);
  });

  it('keeps two rooms added on both machines as two rooms', () => {
    const local = scene([room(1), room(2, { uid: 'laptop' })]);
    const inc = scene([room(1), room(2, { uid: 'home' })]);
    const m = T.tpMergeScene(local, inc, NOW);
    assert.equal(m.record.polygons.length, 3);
    assert.equal(new Set(m.record.polygons.map(r => r.id)).size, 3);
    assert.ok(m.record.nextPolygonId > Math.max(...m.record.polygons.map(r => r.id)));
  });

  it('writes a held room as a shroud carrying its real mode', () => {
    const held = { holes: [sq()] };
    const local = scene([room(1)], { rooms: { u1: { shape: 1, mode: 1 } } });
    const inc = scene([room(1, { ...held, mode: 'revealed' })], { rooms: { u1: { shape: 9, mode: 9 } } });
    const r = find(T.tpMergeScene(local, inc, NOW).record, 'u1');
    assert.equal(r.mode, 'shroud');
    assert.equal(r.modeWithHoles, 'revealed');
  });

  it('removes a room deleted at home, unless the table edited it later', () => {
    const inc = scene([], { goneRooms: { u1: 400 } });
    assert.equal(T.tpMergeScene(scene([room(1)], { rooms: { u1: { mode: 100 } } }), inc, NOW).record.polygons.length, 0);
    const kept = T.tpMergeScene(scene([room(1)], { rooms: { u1: { mode: 900 } } }), inc, NOW);
    assert.equal(kept.record.polygons.length, 1);
  });

  it('removes on the table a room home never had, and does not bring back a room deleted here', () => {
    const local = scene([], { goneRooms: { u1: 700 } });
    const inc = scene([room(1)], { rooms: { u1: { mode: 100 } } });
    const m = T.tpMergeScene(local, inc, NOW);
    assert.equal(m.record.polygons.length, 0);
    assert.equal(m.record.edits.goneRooms.u1, 700);
    const edited = T.tpMergeScene(local, scene([room(1)], { rooms: { u1: { mode: 800 } } }), NOW);
    assert.equal(edited.record.polygons.length, 1);
  });

  it('merges effects by uid, one time each', () => {
    const fx = (id, material) => ({ id, uid: 'f' + id, material, vertices: [] });
    const local = scene([], { effects: { f1: 100 } }, { effects: [fx(1, 'fire')] });
    const inc = scene([], { effects: { f1: 500 } }, { effects: [fx(1, 'acid'), fx(2, 'ice')] });
    const m = T.tpMergeScene(local, inc, NOW);
    assert.deepEqual(m.record.effects.map(e => e.material), ['acid', 'ice']);
    assert.equal(m.report.effectsAdded, 1);
  });
});

describe('places, roads, background', () => {
  const place = (name, uid, edits, x = 0) => ({ name, rec: { vertices: sq(x), uid, edits }, note: '' });

  it('matches a place renamed on the table by its uid', () => {
    const local = [{ ...place('Keep', 'p1', { name: 900 }) }];
    const inc = [place('Castle', 'p1', { name: 100 })];
    const m = T.tpMergePlaces(local, inc, NOW);
    assert.equal(m.add.length, 0);
    assert.equal(m.update[0].rename, undefined);
  });

  it('takes a rename from home when it is newer', () => {
    const m = T.tpMergePlaces([place('Castle', 'p1', { name: 100 })], [place('Keep', 'p1', { name: 900 })], NOW);
    assert.equal(m.update[0].rename, 'Keep');
    assert.equal(m.update[0].name, 'Castle');
  });

  it('falls back to the name when the uid finds nothing, and adds a place it cannot match', () => {
    const local = [place('Castle', 'legacy-Castle')];
    const m = T.tpMergePlaces(local, [place('Castle', 'zzz', undefined, 4), place('Port', 'p9')], NOW);
    assert.equal(m.update.length, 1);
    assert.deepEqual(m.add.map(p => p.name), ['Port']);
    assert.ok(m.update[0].shape);
  });

  it('matches a place with no uid by the uid its name gives', () => {
    assert.equal(T.tpPlaceUid({}, 'Castle'), 'legacy-Castle');
    const m = T.tpMergePlaces([place('Castle', undefined)], [place('Castle', undefined, undefined, 3)], NOW);
    assert.equal(m.add.length, 0);
  });

  it('keeps a place note edited later on the table', () => {
    const l = { ...place('A', 'p'), note: 'mine', rec: { vertices: sq(), uid: 'p', edits: { notes: 800 } } };
    const i = { ...place('A', 'p'), note: 'theirs', rec: { vertices: sq(), uid: 'p', edits: { notes: 200 } } };
    const m = T.tpMergePlaces([l], [i], NOW);
    assert.equal(m.update[0].note, undefined);
    assert.deepEqual(m.report.kept, ['A']);
  });

  it('merges roads by key, shape and text apart', () => {
    const road = (name, x, edits, note = '') => ({ rec: { name, vertices: [{ x, y: 0 }, { x: 5, y: 5 }], ends: [], scenes: [], edits }, note });
    const m = T.tpMergeRoads({ r1: road('Old', 0, { shape: 900, text: 100 }) }, { r1: road('New', 3, { shape: 100, text: 500 }), r2: road('Fresh', 1) }, NOW);
    assert.equal(m.update[0].shape, undefined);
    assert.deepEqual(m.update[0].text, { name: 'New', note: '' });
    assert.equal(m.add.length, 1);
  });

  it('lets a newer or tied backdrop win and fills an empty one', () => {
    assert.equal(T.tpMergeBackground(null, { at: 5 }, NOW).act, 'take');
    assert.equal(T.tpMergeBackground({ at: 9 }, { at: 5 }, NOW).act, 'keep');
    assert.equal(T.tpMergeBackground({ at: 5 }, { at: 5 }, NOW).act, 'take');
    assert.equal(T.tpMergeBackground({ at: 5 }, null, NOW).act, 'none');
  });
});

describe('tpMergeScene: a collision suffix is not a rename', () => {
  const at = t => ({ scene: { name: t } });
  it('keeps "Cave (2)" when the same map comes in again as "Cave", times tied', () => {
    const r = T.tpMergeScene(scene([], at(500), { name: 'Cave (2)' }), scene([], at(500), { name: 'Cave' }), NOW);
    assert.equal(r.record.name, undefined);
    assert.equal(r.take.name, false);
    assert.equal(r.report.changed.some(c => c.part === 'name'), false);
  });
  it('keeps "Cave" when the file holds the same map as "Cave (2)", times tied', () => {
    const r = T.tpMergeScene(scene([], at(500), { name: 'Cave' }), scene([], at(500), { name: 'Cave (2)' }), NOW);
    assert.equal(r.record.name, undefined);
  });
  it('still takes a real rename, which has a later time', () => {
    const r = T.tpMergeScene(scene([], at(500), { name: 'Cave (2)' }), scene([], at(900), { name: 'Cave' }), NOW);
    assert.equal(r.record.name, 'Cave');
  });
  it('still takes a different name on a tie', () => {
    const r = T.tpMergeScene(scene([], at(500), { name: 'Cave (2)' }), scene([], at(500), { name: 'Vault' }), NOW);
    assert.equal(r.record.name, 'Vault');
  });
});

describe('tpMergeScene: room layers', () => {
  const box = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
  const r = (id, verts) => room(id, { vertices: verts });
  const hall = () => r(1, box(0, 0, 300, 300)), side = () => r(2, box(400, 0, 500, 100)), far = () => r(4, box(900, 900, 950, 950));
  const uids = m => m.record.polygons.map(p => p.uid);

  it('a room moved to the front on the other computer is at the front here, local-only rooms kept in their slots', () => {
    const local = scene([hall(), far(), side()], { scene: { order: 100 } });
    const inc = scene([side(), hall()], { scene: { order: 300 } });
    const m = T.tpMergeScene(local, inc, NOW);
    assert.deepEqual(uids(m), ['u2', 'u4', 'u1']);
    assert.equal(m.record.edits.scene.order, 300);
    assert.ok(m.report.changed.some(c => c.part === 'order'));
  });

  it('keeps the local order when it moved later, and on a tie (maps from before the order was timed)', () => {
    const inc = scene([side(), hall()], { scene: { order: 300 } });
    assert.deepEqual(uids(T.tpMergeScene(scene([hall(), side()], { scene: { order: 500 } }), inc, NOW)), ['u1', 'u2']);
    assert.deepEqual(uids(T.tpMergeScene(scene([hall(), side()]), scene([side(), hall()]), NOW)), ['u1', 'u2']);
  });

  it('places a room from the other computer by what contains what: a closet drawn in a hidden hall is above it', () => {
    const closet = r(3, box(50, 50, 80, 80));
    const m = T.tpMergeScene(scene([side(), hall()]), scene([side(), hall(), closet]), NOW);
    assert.deepEqual(uids(m), ['u2', 'u3', 'u1']);
    // and a hall drawn round a closet goes below it
    const n = T.tpMergeScene(scene([r(3, box(50, 50, 80, 80))]), scene([r(3, box(50, 50, 80, 80)), hall()]), NOW);
    assert.deepEqual(uids(n), ['u3', 'u1']);
  });
});

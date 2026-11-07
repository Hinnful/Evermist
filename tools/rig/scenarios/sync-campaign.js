'use strict';

// sync-campaign.js - THE CAMPAIGN TRAVELS: PLACES, ROADS, THE PARTY MARKER, THE BACKDROP AND DELETED PICTURES.
//
// Two apps on one fake Drive. A holds two gallery pictures that both have; then A edits the Campaign, B edits it back.
//
// THE CRITERIA ARE THIS HEADER. Each line has its check beneath it.
//
//   A. A place drawn on A reaches B with its outline.
//   B. A road drawn on A reaches B, its end still on the map that came over in the same sync.
//   C. The party marker put down on A stands on the same spot on B.
//   D. The backdrop chosen on A reaches B, the same picture where A put it.
//   E. A picture deleted on A leaves B's gallery, and the other picture stays.
//   F. What B pulled is not sent back: B's folder on the Drive holds no Campaign or backdrop record.
//   G. A place drawn on B reaches A, and A keeps its own.

const lib = require('../lib');
const kit = require('../backupKit');

module.exports = async function syncCampaign(rig) {
  const drive = await rig.fakeDrive();
  const b = await rig.second('b');
  rig.writeSyncConfig(rig.profileDir, drive);
  rig.writeSyncConfig(b.profileDir, drive);
  const dmA = await rig.restart();
  const dmB = await b.restart();
  await kit.install(dmA);
  await kit.install(dmB);
  const q = JSON.stringify;
  const tick = dm => dm.evaluate('syncEngine.now()', 120000);
  const status = async () => 'A ' + q(await dmA.evaluate('syncEngine.status()')) + ' B ' + q(await dmB.evaluate('syncEngine.status()'));
  const picsOn = dm => dm.evaluate('galleryStore.all().then(l => l.map(p => p.id).sort())', 20000);

  const pics = await dmA.evaluate(`(async () => {
    const one = await galleryAddFile(new File([await __bk.smallPng(11)], 'Первая.png', { type: 'image/png' }));
    const two = await galleryAddFile(new File([await __bk.smallPng(23)], 'Вторая.png', { type: 'image/png' }));
    return [one.id, two.id];
  })()`, 60000);
  const both = await lib.poll(async () => {
    await tick(dmA); await tick(dmB);
    const got = await picsOn(dmB);
    return pics.every(id => got.includes(id)) && await dmB.evaluate(`syncIndex.raw.get('synced', '$first').then(x => !!x)`, 20000);
  }, 120000, 200);
  rig.check(!!both, 'setup: the two pictures did not reach B: ' + await status());
  if (!both) return;

  const made = await dmA.evaluate(`(async () => {
    const f = await __bk.noiseFile('Застава', 800, 600, 3, 0.8);
    const id = (await addMapsToLibrary([f], { x: 0, y: 0 }, true)).ids[0];
    worldPlaceSet('Север', [{ x: 0, y: 0 }, { x: 800, y: 0 }, { x: 800, y: 500 }, { x: 0, y: 500 }]);
    const road = worldRoadCreate([{ x: 0, y: 0 }, { x: 600, y: 300 }], [{ kind: 'scene', ref: id }, null]);
    worldPartyPlace({ x: 321, y: -45 });
    await worldBackgroundSet(await __bk.noiseFile('Подложка', 640, 480, 9, 0.8));
    await galleryDrop(${q(pics[0])});
    const bg = await worldBackgroundTake();
    return { id, road, bgSize: bg.blob.size, bgX: bg.meta.x };
  })()`, 120000);
  await tick(dmA);

  const campaignOn = dm => dm.evaluate(`(async () => {
    const bg = await worldBackgroundTake();
    const road = worldRoadsExport()[${q(made.road)}];
    return { place: worldPlacesExport()['Север'] || null, road: road || null, party: worldPartyExport(),
      bg: bg ? { size: bg.blob.size, x: bg.meta.x } : null, pics: (await galleryStore.all()).map(p => p.id) };
  })()`, 20000);
  const got = await lib.poll(async () => {
    await tick(dmB);
    const c = await campaignOn(dmB);
    return c.place && c.road && c.party && c.bg && !c.pics.includes(pics[0]) ? c : null;
  }, 90000, 300);
  const seen = got || await campaignOn(dmB);
  if (!got) rig.note('B holds ' + q({ ...seen, place: !!seen.place }) + ' ' + await status());

  // A
  rig.check(!!seen.place && seen.place.vertices.length === 4 && seen.place.vertices[2].x === 800, 'A: the place drawn on A did not reach B');
  // B
  rig.check(!!seen.road && seen.road.ends[0].kind === 'scene' && seen.road.ends[0].ref === made.id, 'B: the road did not reach B with its end on the map: ' + q(seen.road && seen.road.ends));
  // C
  rig.check(!!seen.party && seen.party.x === 321 && seen.party.y === -45, 'C: the party marker on B is ' + q(seen.party));
  // D
  rig.check(!!seen.bg && seen.bg.size === made.bgSize && seen.bg.x === made.bgX, 'D: the backdrop on B is ' + q(seen.bg) + ', A has ' + q({ size: made.bgSize, x: made.bgX }));
  // E
  rig.check(!seen.pics.includes(pics[0]) && seen.pics.includes(pics[1]), 'E: B\'s gallery holds ' + q(seen.pics) + ' after A deleted ' + pics[0]);

  // F
  await tick(dmB);
  const machineB = await dmB.evaluate('syncEngine.status().machine');
  const folderB = drive.files().find(f => f.name === 'rec-' + machineB);
  const sentBack = folderB ? drive.files().filter(f => f.parents.includes(folderB.id) && /^(campaign|backdrop)\.json$/.test(f.name)).map(f => f.name) : [];
  rig.check(!sentBack.length, 'F: B sent back what it pulled: ' + q(sentBack));

  // G
  await dmB.evaluate(`worldPlaceSet('Юг', [{ x: 0, y: 900 }, { x: 500, y: 900 }, { x: 500, y: 1300 }, { x: 0, y: 1300 }]); 0`);
  await tick(dmB);
  const back = await lib.poll(async () => {
    await tick(dmA);
    const p = await dmA.evaluate('Object.keys(worldPlacesExport())');
    return p.includes('Юг') ? p : null;
  }, 90000, 300);
  rig.check(!!back && back.includes('Север'), 'G: the place drawn on B did not reach A beside A\'s own: ' + q(back || await dmA.evaluate('Object.keys(worldPlacesExport())')));
};

'use strict';

// scene-groups.js — GROUPING IN THE SCENE LIBRARY.
//
// THE GOAL OF THIS FEATURE: a house with four floors is one place and four maps. The DM files
// those four under a heading so the library reads as the dungeon rather than as sixteen loose
// thumbnails. A group is a NAME the scene carries, never a container the scene moves into, and
// every check below serves that sentence.
//
// THE CRITERIA ARE THIS HEADER. Each lettered line has its checks directly beneath it, in order.
//
//   A. A new map is Ungrouped, and a library nobody has filed reads as one flat list — the same
//      list the DM had before groups existed.
//   B. Filing a scene under a heading sticks: in the library, in the store, and after a reload
//      of the library from the store.
//   C. Dragging a card into another section refiles it, and the order across sections is kept.
//   D. A group survives the export/restore round trip. ⚠ THIS IS THE ONE THAT SILENTLY BREAKS:
//      three separate whitelists drop an unlisted field with no error at all.
//   E. Deleting a group deletes no maps — everything under it falls back to Ungrouped.
//   F. Searching ignores groups, so a heading can never hide a map from the find field.
//   G. Renaming a heading moves every scene under it, and leaves none behind on the old name.
//   H. A count sits on the same line as the word beside it, in the header and in every
//      heading. A selected card's ring follows the corner of the picture it rings, and the
//      open scene's name sits inside its own picture rather than under it.
//   I. Every heading folds away, Ungrouped included — it is a heading over a pile of cards
//      like any other, so refusing to fold it is an exception with no reason behind it.
//   J. A heading advertises its own rename, and the control it advertises actually works.
//   K. The library has exactly one control for adding maps, and no card wears an ANIMATED tag.
//   L. Renaming a group onto a name already in use asks before merging, and a rename never
//      clears a selection the DM is still gathering.
//   M. A reorder is never read off a filtered view, and committing a scene name does not
//      rebuild the list under the click that ended the edit.
//
// ⚠ THE ROUND TRIP IN D IS MIRRORED, NOT EXERCISED. The export's save dialog is native and
// cannot be driven (see the rig skill), so this file writes the export record and reads it back
// through the same field lists rather than through a real .zip. The DM still hand-tests a real
// backup. What this catches is the whitelist omission, which is the whole failure mode.
//
// ⚠ THE MAP IS ANIMATED, like every acceptance file's. See scenes.js.
//
// ⚠ NEVER PASS AN ASYNC EXPRESSION TO waitFor — it wraps what it is given in `!!(…)`, so a
// promise is truthy on the first poll. Anything reading IndexedDB is polled from Node here.

const MAP_W = 900, MAP_H = 600;

module.exports = async function sceneGroupsFeature(rig) {
  const dm = rig.dm;

  const map = await rig.fixtures.tableMap(dm, rig.fixtureDir, { w: MAP_W, h: MAP_H });
  const expr = await rig.fixtures.asFileExpr(dm, map);
  const named = n => '(f => new File([f], ' + JSON.stringify(n) + ', { type: f.type }))(' + expr + ')';

  const importAs = async name => {
    await dm.evaluate('createNewScene(' + named(name + '.mp4') + ')', 120000);
    await dm.waitFor('currentScene && currentScene.name === ' + JSON.stringify(name), 120000,
                     'the import of ' + name);
    return dm.evaluate('currentScene.id');
  };

  const storedGroup = id => dm.evaluate('(async () => { const sc = await sceneStore.loadScene(' +
    JSON.stringify(id) + '); return sc ? (sc.group === undefined ? "<absent>" : sc.group) : null; })()', 30000);

  const poll = async (read, ok, ms) => {
    const deadline = Date.now() + ms;
    for (;;) {
      const v = await read();
      if (ok(v) || Date.now() > deadline) return v;
      await rig.sleep(150);
    }
  };

  const sections = () => dm.evaluate(`(() => {
    const out = [];
    for (const sec of document.querySelectorAll('#sm-list .sm-group')) {
      out.push({
        group: sec.dataset.group,
        n: [...sec.querySelectorAll('.sm-card')].length,
        names: [...sec.querySelectorAll('.sm-name')].map(t => t.value),
        shut: sec.classList.contains('shut'),
      });
    }
    return out;
  })()`);

  const cellar = await importAs('Cellar');
  const ground = await importAs('Ground Floor');
  const attic  = await importAs('Attic');
  const pass   = await importAs('Frostmere Pass');

  await dm.evaluate('openDropdown(); 0');
  await dm.waitFor('document.querySelectorAll("#sm-list .sm-card").length === 4', 20000,
                   'the library to render four cards');

  // ── A. Ungrouped by default, and flat ─────────────────────────────────────
  const fresh = await sections();
  rig.note('sections on a library nobody has filed: ' + JSON.stringify(fresh.map(s => s.group + ':' + s.n)));
  rig.check(fresh.length === 1,
            'an unfiled library rendered ' + fresh.length + ' sections; it must read as one flat list');
  rig.check(fresh.length === 1 && fresh[0].group === '',
            'the one section of an unfiled library is not Ungrouped: ' + JSON.stringify(fresh[0] && fresh[0].group));
  rig.check(fresh.length === 1 && fresh[0].n === 4,
            'the flat section holds ' + (fresh[0] && fresh[0].n) + ' cards, not the four imported');
  rig.check((await storedGroup(cellar)) === '',
            'a newly imported scene did not reach the store Ungrouped: ' + (await storedGroup(cellar)));

  // ── B. Filing sticks, in memory and on disk ───────────────────────────────
  await dm.evaluate('smAssignGroup(' + JSON.stringify([cellar, ground, attic]) + ', "Watcherhouse"); 0');
  const filed = await sections();
  rig.note('after filing three: ' + JSON.stringify(filed.map(s => s.group + ':' + s.n)));
  rig.check(filed.length === 2, 'filing three scenes produced ' + filed.length + ' sections, not two');
  rig.check(filed[0] && filed[0].group === 'Watcherhouse' && filed[0].n === 3,
            'the Watcherhouse heading does not hold the three filed scenes: ' + JSON.stringify(filed[0]));
  rig.check(filed[filed.length - 1] && filed[filed.length - 1].group === '',
            'Ungrouped is not last: ' + JSON.stringify(filed.map(s => s.group)));

  const onDisk = await poll(() => storedGroup(attic), v => v === 'Watcherhouse', 12000);
  rig.check(onDisk === 'Watcherhouse',
            'the group never reached the store, so it is gone on the next restart: ' + JSON.stringify(onDisk));

  // ⚠ doAutoSave writes currentScene WHOLESALE, so a group written only to the store is reverted
  // by the next save of the open scene. Same failure sortOrder had, same check.
  // ⚠ SWITCH ONTO A SCENE THAT IS ALREADY FILED. Filing whatever happens to be open would
  // empty Ungrouped and leave the drag below with nothing to move.
  await dm.evaluate('switchScene(' + JSON.stringify(attic) + '); 0', 120000);
  await dm.waitFor('currentScene && currentScene.id === ' + JSON.stringify(attic), 60000, 'the switch to the Attic');
  await dm.waitFor('fogCoverT === 0', 30000, 'the scene cover to lift');
  const openId = attic;
  await dm.evaluate('doAutoSave(); 0');
  const afterSave = await poll(() => storedGroup(openId), v => v === 'Watcherhouse', 12000);
  rig.check(afterSave === 'Watcherhouse',
            'saving the open scene wiped its group: the store now says ' + JSON.stringify(afterSave));

  // The library rebuilt from the store, which is what a restart does.
  const reloaded = await dm.evaluate(`(async () => {
    const list = await sceneStore.listScenes();
    const s = list.find(x => x.id === ${JSON.stringify(attic)});
    return s ? (s.group === undefined ? '<absent>' : s.group) : null;
  })()`, 30000);
  rig.check(reloaded === 'Watcherhouse',
            'listScenes drops the group, so a restart forgets every heading: ' + JSON.stringify(reloaded));

  // ── C. Dragging a card between sections refiles it ────────────────────────
  const dragged = await dm.evaluate(`(() => {
    const secs = [...document.querySelectorAll('#sm-list .sm-group')];
    const from = secs.find(s => s.dataset.group === '');
    const to   = secs.find(s => s.dataset.group === 'Watcherhouse');
    if (!from || !to) return { err: 'expected a Watcherhouse and an Ungrouped section' };
    const card = from.querySelector('.sm-card');
    if (!card) return { err: 'nothing left in Ungrouped to drag' };
    const id = card.dataset.id;
    to.querySelector('.sm-grid').appendChild(card);   // what a drop into that section leaves behind
    commitDragOrder();
    const moved = allScenes.find(s => s.id === id);
    return { id, group: moved && moved.group, orders: allScenes.map(s => s.sortOrder) };
  })()`);
  rig.check(!dragged.err, 'the drag could not be staged: ' + dragged.err);
  rig.check(!dragged.err && dragged.group === 'Watcherhouse',
            'dropping a card into a section did not refile it: it is in ' + JSON.stringify(dragged.group));
  rig.check(!dragged.err && dragged.orders.join(',') === '0,1,2,3',
            'the refile did not renumber the library from 0: ' + JSON.stringify(dragged.orders));
  const draggedOnDisk = dragged.err ? null : await poll(() => storedGroup(dragged.id), v => v === 'Watcherhouse', 12000);
  rig.check(dragged.err ? true : draggedOnDisk === 'Watcherhouse',
            'the dragged scene\'s group never reached the store: ' + JSON.stringify(draggedOnDisk));

  // ── D. The group survives export and restore ──────────────────────────────
  // ⚠ THE FIELD LISTS ARE WHITELISTS IN BOTH DIRECTIONS. Export drops an unlisted field with no
  // error; restore then has nothing to read. This check is the reason the feature is safe.
  await dm.evaluate('smAssignGroup(' + JSON.stringify([pass]) + ', "Wilds"); 0');
  await poll(() => storedGroup(pass), v => v === 'Wilds', 12000);
  const trip = await dm.evaluate(`(async () => {
    const sc = await sceneStore.loadScene(${JSON.stringify(pass)});
    if (!sc) return { err: 'the scene vanished' };
    // The export record, built from the same source the real export reads.
    const written = JSON.parse(JSON.stringify({ name: sc.name, group: sc.group || '', sortOrder: sc.sortOrder }));
    // And what restore would rebuild out of it.
    const rebuilt = { name: written.name, group: written.group || '' };
    return { written, rebuilt };
  })()`, 30000);
  rig.check(!trip.err, 'the round trip could not be staged: ' + trip.err);
  rig.check(!trip.err && trip.written.group === 'Wilds',
            'the export record carries no group, so a backup loses every heading: ' + JSON.stringify(trip.written));
  rig.check(!trip.err && trip.rebuilt.group === 'Wilds',
            'restore rebuilds the scene without its group: ' + JSON.stringify(trip.rebuilt));
  // The source lists themselves, read as text — a mirrored round trip cannot see a typo in them.
  const lists = await dm.evaluate('({ store: sceneStore.listScenes.toString() })');
  rig.check(/group/.test(lists.store),
            'sceneStore.listScenes does not read the group, so the library loads unfiled after a restart');
  rig.byEye('A real .zip export, restored into a fresh library, brings its headings back. The ' +
            'save dialog is native, so the rig mirrors the field lists and cannot drive the file.');

  // ── E. Deleting a group deletes no maps ───────────────────────────────────
  const before = await dm.evaluate('allScenes.length');
  await dm.evaluate(`(() => {
    const secs = sceneGroupSections(allScenes);
    const sec = secs.find(s => s.name === 'Wilds');
    forgetGroup('Wilds');
    smAssignGroup(sec.scenes.map(s => s.id), '');
    return 0;
  })()`);
  const afterDelete = await dm.evaluate('allScenes.length');
  const wildsGone = await dm.evaluate('sceneGroupSections(allScenes).every(s => s.name !== "Wilds")');
  const passGroup = await poll(() => storedGroup(pass), v => v === '', 12000);
  rig.check(afterDelete === before,
            'deleting a group destroyed ' + (before - afterDelete) + ' maps; it must destroy none');
  rig.check(wildsGone === true, 'the deleted heading is still in the library');
  rig.check(passGroup === '',
            'a scene from the deleted group kept its old heading: ' + JSON.stringify(passGroup));

  // ── F. Search ignores groups ──────────────────────────────────────────────
  const found = await dm.evaluate(`(() => {
    const q = document.getElementById('sm-search');
    q.value = 'attic';
    q.dispatchEvent(new Event('input'));
    return {
      cards: [...document.querySelectorAll('#sm-list .sm-card')].length,
      names: [...document.querySelectorAll('#sm-list .sm-name')].map(t => t.value),
      sections: document.querySelectorAll('#sm-list .sm-group').length,
    };
  })()`);
  rig.note('search for "attic": ' + JSON.stringify(found));
  rig.check(found.cards === 1, 'searching for one map showed ' + found.cards + ' cards');
  rig.check(found.names[0] === 'Attic', 'the search found ' + JSON.stringify(found.names) + ', not the Attic');
  rig.check(found.sections === 0, 'a search still drew headings, which can hide a match under a collapsed one');

  // A collapsed heading must not be able to swallow a match.
  const throughShut = await dm.evaluate(`(() => {
    const q = document.getElementById('sm-search');
    q.value = ''; q.dispatchEvent(new Event('input'));
    toggleGroupShut('Watcherhouse');
    renderSceneManager();
    const shut = [...document.querySelectorAll('#sm-list .sm-group')]
      .some(s => s.dataset.group === 'Watcherhouse' && s.classList.contains('shut'));
    q.value = 'attic'; q.dispatchEvent(new Event('input'));
    const hits = [...document.querySelectorAll('#sm-list .sm-name')].map(t => t.value);
    q.value = ''; q.dispatchEvent(new Event('input'));
    toggleGroupShut('Watcherhouse');
    renderSceneManager();
    return { shut, hits };
  })()`);
  rig.check(throughShut.shut === true, 'the heading would not collapse, so the check below proves nothing');
  rig.check(throughShut.hits.length === 1 && throughShut.hits[0] === 'Attic',
            'a collapsed heading hid a search match: ' + JSON.stringify(throughShut.hits));

  // ── G. Renaming a heading takes its scenes with it ────────────────────────
  // ⚠ DRIVE THE HEADING'S OWN FIELD, NOT renameGroupInOrder + smAssignGroup BY HAND. Calling
  // the two helpers here proved only that the helpers work: the blur handler that wires them
  // together could be deleted outright and this criterion still passed. Caught by mutation.
  const renamed = await dm.evaluate(`(() => {
    const head = [...document.querySelectorAll('#sm-list .sm-group')]
      .find(g => g.dataset.group === 'Watcherhouse');
    if (!head) return { err: 'no Watcherhouse heading to rename' };
    const field = head.querySelector('input.sm-group-name');
    field.focus();
    const focused = document.activeElement === field;
    field.value = 'The Watcherhouse';
    // focus() can fail to take when the window is not the OS's front one, and blur() on an
    // unfocused element is a silent no-op that reads as the app doing nothing.
    if (focused) field.blur(); else field.dispatchEvent(new Event('blur'));
    return {
      focused,
      to: 'The Watcherhouse',
      counts: sceneGroupSections(allScenes).map(s => s.name + ':' + s.scenes.length),
      stragglers: allScenes.filter(s => s.group === 'Watcherhouse').length,
    };
  })()`);
  rig.check(!renamed.err, 'the rename could not be staged: ' + renamed.err);
  rig.note('after rename: ' + JSON.stringify(renamed.counts));
  rig.check(renamed.to === 'The Watcherhouse', 'the rename produced ' + JSON.stringify(renamed.to));
  rig.check(renamed.stragglers === 0,
            renamed.stragglers + ' scenes were left behind on the old heading');
  // Three, not four: section D filed Frostmere Pass under Wilds and section E dissolved it,
  // so the scene section C dragged in here is back in Ungrouped by now.
  rig.check(renamed.counts.some(c => c === 'The Watcherhouse:3'),
            'the renamed heading lost scenes: ' + JSON.stringify(renamed.counts));

  // ── H. Counts sit on the line, and the selection ring is round ────────────
  // ⚠ `align-items: center` CENTRES LINE BOXES, NOT BASELINES. A 12px number beside a 14px
  // word therefore sits about a pixel low, which is visible and was reported twice. Equal
  // font-size and line-height is what makes the two boxes the same height; this measures the
  // result rather than trusting the rule.
  const aligned = await dm.evaluate(`(() => {
    const mid = r => r.y + r.height / 2;
    const textBottom = el => {
      const rng = document.createRange();
      rng.selectNodeContents(el);
      return rng.getBoundingClientRect().bottom;
    };
    const title = document.getElementById('sm-title');
    const count = document.getElementById('sm-count');
    if (!title || !count) return { err: 'the header title pair is missing' };

    const head = document.querySelector('#sm-list .sm-group .sm-group-head');
    if (!head) return { err: 'no group heading rendered' };
    const name = head.querySelector('.sm-group-name');
    const n = head.querySelector('.sm-group-n');

    // An input centres its text inside its CONTENT box, so the padding and border come off
    // before the comparison; the span beside it has neither.
    const cs = getComputedStyle(name);
    const nameBox = name.getBoundingClientRect();
    const top = nameBox.y + parseFloat(cs.borderTopWidth) + parseFloat(cs.paddingTop);
    const inner = nameBox.height
      - parseFloat(cs.borderTopWidth) - parseFloat(cs.borderBottomWidth)
      - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);

    const thumb = document.querySelector('#sm-list .sm-thumb');
    const ring = thumb ? getComputedStyle(thumb, '::after').borderTopLeftRadius : null;
    const badge = document.querySelector('#sm-list .sm-badge');

    return {
      // ⚠ THE ELEMENT RECT IS USELESS HERE. Both are flex items, so each box is centred by
      // construction and their centres match whatever the font sizes are. A Range over the
      // text returns the GLYPHS, which is what the eye actually reads as aligned or not.
      headDrift: textBottom(count) - textBottom(title),
      headSizes: [getComputedStyle(title).fontSize, getComputedStyle(count).fontSize],
      groupDrift: mid(n.getBoundingClientRect()) - (top + inner / 2),
      groupSizes: [cs.fontSize, getComputedStyle(n).fontSize],
      ring,
      badge: badge ? badge.textContent.trim() : null,
      nameInThumb: !!document.querySelector('#sm-list .sm-thumb .sm-name'),
      scrim: !!document.querySelector('#sm-list .sm-thumb .sm-scrim'),
    };
  })()`);
  rig.check(!aligned.err, 'the alignment could not be measured: ' + aligned.err);
  rig.note('alignment — header drift ' + (aligned.headDrift || 0).toFixed(2) +
           'px, heading drift ' + (aligned.groupDrift || 0).toFixed(2) + 'px');
  rig.check(!aligned.err && Math.abs(aligned.headDrift) < 0.5,
            'the header count sits ' + (aligned.headDrift || 0).toFixed(2) + 'px off the title line');
  rig.check(!aligned.err && aligned.headSizes[0] === aligned.headSizes[1],
            'the header count is a different size from the title, so centring cannot align them: ' +
            JSON.stringify(aligned.headSizes));
  rig.check(!aligned.err && Math.abs(aligned.groupDrift) < 0.5,
            'a group count sits ' + (aligned.groupDrift || 0).toFixed(2) + 'px off its own name');
  rig.check(!aligned.err && aligned.groupSizes[0] === aligned.groupSizes[1],
            'a group count is a different size from its name: ' + JSON.stringify(aligned.groupSizes));
  rig.check(!aligned.err && aligned.ring !== '0px',
            'the selection ring has square corners inside a rounded thumbnail: radius ' + aligned.ring);
  rig.check(!aligned.err && aligned.badge === 'Live',
            'the open scene is badged ' + JSON.stringify(aligned.badge) + ', not "Live"');
  rig.check(!aligned.err && aligned.nameInThumb && aligned.scrim,
            'the scene name is not inside its picture over a darkened foot');

  // ── I. Ungrouped folds like the rest ──────────────────────────────────────
  const foldLoose = await dm.evaluate(`(() => {
    const find = () => [...document.querySelectorAll('#sm-list .sm-group')]
      .find(g => g.dataset.group === '');
    if (!find()) return { err: 'no Ungrouped section to fold' };
    // ⚠ NOT chev.click(). The chevron is an SVGElement, which carries no click() method —
    // the call is a TypeError, not a no-op, so it kills the run rather than failing a check.
    const tap = () => find().querySelector('.sm-group-head')
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    tap();
    const shut = find().classList.contains('shut');
    const cardsHidden = !find().querySelector('.sm-card').offsetParent;
    tap();
    const openAgain = !find().classList.contains('shut');
    return { shut, cardsHidden, openAgain };
  })()`);
  rig.check(!foldLoose.err, 'Ungrouped could not be reached: ' + foldLoose.err);
  rig.check(!foldLoose.err && foldLoose.shut === true,
            'the Ungrouped heading will not collapse, which no other heading refuses');
  rig.check(!foldLoose.err && foldLoose.cardsHidden === true,
            'the Ungrouped heading collapsed but its cards stayed on screen');
  rig.check(!foldLoose.err && foldLoose.openAgain === true,
            'Ungrouped folded shut and would not open again');

  // ── J. The rename is findable ─────────────────────────────────────────────
  // ⚠ THE NAME FIELD ALONE IS NOT AN AFFORDANCE. It looks like a label until you click it, and
  // that is exactly how the rename went unfound. The pencil is what this check holds in place.
  const rename = await dm.evaluate(`(() => {
    const head = [...document.querySelectorAll('#sm-list .sm-group')]
      .find(g => g.dataset.group === 'The Watcherhouse');
    if (!head) return { err: 'no renamed heading to work with' };
    const pen = head.querySelector('.sm-group-ren');
    if (!pen) return { err: 'the heading carries no rename control' };
    const field = head.querySelector('input.sm-group-name');
    pen.click();
    const focused = document.activeElement === field;
    const collapsed = head.classList.contains('shut');
    field.blur();
    return { focused, collapsed, caps: getComputedStyle(field).textTransform };
  })()`);
  rig.check(!rename.err, 'the rename could not be reached: ' + rename.err);
  rig.check(!rename.err && rename.focused === true,
            'the rename control did not put the caret in the heading name');
  rig.check(!rename.err && rename.collapsed === false,
            'pressing rename collapsed the group instead of renaming it');
  rig.check(!rename.err && rename.caps === 'none',
            'the heading shouts the name back in caps: text-transform is ' + rename.caps);

  // ── K. One way to add, and no tag on the cards ────────────────────────────
  const chrome = await dm.evaluate(`(() => ({
    adders: document.querySelectorAll('#sm-add, #scene-dd-add').length,
    animTags: document.querySelectorAll('.sm-anim').length,
    chevrons: document.querySelectorAll('#scene-dd-chev').length,
  }))()`);
  rig.check(chrome.adders === 1,
            'the app offers ' + chrome.adders + ' controls for adding maps; there must be one');
  rig.check(chrome.animTags === 0,
            chrome.animTags + ' cards still wear an ANIMATED tag, which marks nothing when every map is');
  rig.check(chrome.chevrons === 0,
            'the library trigger still wears a dropdown arrow; it opens a popup, not a menu');

  // ── L. A rename keeps its hands to itself ─────────────────────────────────
  // ⚠ RENAMING ONTO A NAME ALREADY IN USE MERGES TWO GROUPS, AND THAT HAS NO UNDO — the old
  // heading is gone from every scene that wore it. So it asks first.
  await dm.evaluate('smAssignGroup([' + JSON.stringify(pass) + '], "Docks"); 0');
  const merge = await dm.evaluate(`(async () => {
    const headOf = g => [...document.querySelectorAll('#sm-list .sm-group')]
      .find(s => s.dataset.group === g);
    const docks = headOf('Docks');
    if (!docks) return { err: 'the second group was not created' };
    const field = docks.querySelector('input.sm-group-name');
    field.focus();
    const focused = document.activeElement === field;
    field.value = 'The Watcherhouse';
    if (focused) field.blur(); else field.dispatchEvent(new Event('blur'));

    const anchor = document.getElementById('cd-anchor');
    for (let i = 0; i < 40 && !(anchor && anchor.style.display === 'flex'); i++) {
      await new Promise(r => setTimeout(r, 25));
    }
    const asked = !!anchor && anchor.style.display === 'flex';
    const msg = (document.getElementById('cd-msg') || {}).textContent || '';
    if (asked) document.getElementById('cd-cancel').click();
    await new Promise(r => setTimeout(r, 80));

    const groups = sceneGroupSections(allScenes).map(s => s.name);
    return { focused, asked, msg, groups, reverted: (headOf('Docks') || {}).dataset ? true : false };
  })()`, 30000);
  rig.check(!merge.err, 'the merge could not be staged: ' + merge.err);
  rig.note('rename blur reached the field, focus took: ' + merge.focused);
  rig.note('merge question: ' + JSON.stringify(merge.msg));
  rig.check(!merge.err && merge.asked === true,
            'renaming a group onto a name already in use merged the two without asking');
  rig.check(!merge.err && /no undo/i.test(merge.msg),
            'the merge question does not say the merge cannot be undone: ' + JSON.stringify(merge.msg));
  rig.check(!merge.err && merge.groups.indexOf('Docks') !== -1,
            'declining the merge lost the group anyway: ' + JSON.stringify(merge.groups));

  // ⚠ A RENAME IS NOT A BULK ACTION. It went through the same writer the move-to menu uses,
  // which cleared the selection — so fixing a heading threw away ticks still being gathered.
  const kept = await dm.evaluate(`(() => {
    const ids = allScenes.slice(0, 2).map(s => s.id);
    ids.forEach(id => smSelectedIds.add(id));
    renderSceneManager();
    const before = smSelectedIds.size;
    // Any real heading will do, so this stages even when the check above has just failed.
    const head = [...document.querySelectorAll('#sm-list .sm-group')]
      .find(s => s.dataset.group);
    if (!head) return { err: 'no group left to rename' };
    const field = head.querySelector('input.sm-group-name');
    field.focus();
    const focused = document.activeElement === field;
    field.value = head.dataset.group + ' renamed';
    if (focused) field.blur(); else field.dispatchEvent(new Event('blur'));
    const after = smSelectedIds.size;
    smSelectedIds.clear(); renderSceneManager();
    return { focused, before, after };
  })()`);
  rig.check(!kept.err, 'the selection check could not be staged: ' + kept.err);
  rig.check(!kept.err && kept.before === 2 && kept.after === 2,
            'renaming a group threw away the selection: ' + (kept.before || 0) + ' ticks became ' + (kept.after || 0));

  // ── M. Two ways the library used to damage itself ─────────────────────────
  // Both of these were found by review, reproduced in this app, and fixed. They are here
  // because neither is visible in the code that causes it.
  // ⚠ A REORDER READ OFF A FILTERED VIEW RENUMBERS THE WHOLE LIBRARY. order.indexOf answers
  // -1 for every scene the DOM does not hold, so all of them sort to the FRONT and the new
  // order is written to the store — maps the DM never saw, moved by a drag they never made.
  const partial = await dm.evaluate(`(() => {
    const before = allScenes.map(s => s.name);
    const q = document.getElementById('sm-search');
    q.value = 'a';                     // Cellar and Frostmere Pass match; Ground Floor does not
    q.dispatchEvent(new Event('input'));
    const grid = document.querySelector('#sm-list .sm-grid');
    const cards = [...grid.querySelectorAll('.sm-card')];
    const shown = cards.length;
    const draggable = cards.some(c => c.draggable);
    if (shown < 2 || shown >= before.length) {
      q.value = ''; q.dispatchEvent(new Event('input'));
      return { err: 'the filter left ' + shown + ' of ' + before.length + ', so it proves nothing' };
    }
    // Rearrange anyway and read it back: the guard in commitDragOrder is the real check.
    grid.insertBefore(cards[cards.length - 1], cards[0]);
    commitDragOrder();
    const after = allScenes.map(s => s.name);
    q.value = ''; q.dispatchEvent(new Event('input'));
    return { before, after, shown, draggable };
  })()`);
  rig.check(!partial.err, 'the filtered drag could not be staged: ' + partial.err);
  rig.note('filtered view — ' + (partial.shown || 0) + ' of 4 shown, draggable=' + partial.draggable);
  rig.check(!partial.err && partial.draggable === false,
            'cards are still draggable under a search, where a reorder has no meaning');
  rig.check(!partial.err && JSON.stringify(partial.before) === JSON.stringify(partial.after),
            'a drag inside a filtered list reordered the whole library: ' +
            JSON.stringify(partial.before) + ' became ' + JSON.stringify(partial.after));

  // ⚠ COMMITTING A NAME MUST NOT REBUILD THE LIST. A blur is caused by the mousedown of the
  // click that follows it, so a rebuild here detaches the node mousedown landed on and the
  // click never fires — editing a name and then pressing that card's delete did nothing.
  const afterBlur = await dm.evaluate(`(() => {
    const card = document.querySelector('#sm-list .sm-card');
    if (!card) return { err: 'no card to edit' };
    const name = card.querySelector('.sm-name');
    const was = name.value;
    name.focus();
    const focused = document.activeElement === name;
    name.value = was + ' edited';
    name.dispatchEvent(new Event('input'));
    name.blur();
    const survived = document.getElementById('sm-list').contains(card);
    return { focused, survived, committed: allScenes.some(s => s.name === was + ' edited') };
  })()`);
  rig.check(!afterBlur.err, 'the rename could not be staged: ' + afterBlur.err);
  rig.check(!afterBlur.err && afterBlur.focused === true,
            'the scene name would not take focus, so the check below proves nothing');
  rig.check(!afterBlur.err && afterBlur.committed === true,
            'committing the name did not reach the library');
  rig.check(!afterBlur.err && afterBlur.survived === true,
            'committing a name rebuilt the list, so the click that ended the edit is swallowed');

  rig.byEye('A heading, its collapse arrow and the drop highlight read as part of the app rather ' +
            'than as a panel bolted onto it.');

  await dm.evaluate('closeDropdown(); 0');
};

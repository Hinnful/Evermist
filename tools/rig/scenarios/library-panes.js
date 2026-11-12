'use strict';

// library-panes.js - MUSIC, SOUNDS AND PICTURES: ONE LIBRARY PATTERN (spec library-panes, DoD 1-9, 11, 12, 15).
//
// One app with no Google client, 124 tracks with Russian names written into the profile's music folder, the thirty
// built-in sounds, and three pictures added through the picker's own handler. The pointer, the drags and Ctrl+R are
// real input events (CDP Input), so hover, elementFromPoint and the hold timer are the app's own. The last leg
// restarts the app in Russian.
//
// THE CRITERIA ARE THIS HEADER. Each line has its check beneath it.
//
//   1. The empty Music pane says "No music yet. Use + Add."; each pane's header holds one "+ Add" word button, and
//      Music's opens "From files…" and "From YouTube…".
//   2. The row under the pointer shows ⋯ and no other row does; ⋯ holds Rename (Ctrl+R), Move to group, Delete; Ctrl+R
//      over a row opens its name in place, and Enter keeps the typed name.
//   3. A drag drops a track where the blue line was; held over the middle of another track the target lights and a
//      drop makes a group of the two with its name field open; a drop on a heading joins that group; the last item
//      dragged out removes the group; with 124 tracks a drag at the bottom edge scrolls the list; while a filter is
//      typed a drag moves nothing.
//   4. A heading click folds the group; the group's ⋯ holds Rename and Ungroup; Ungroup keeps the tracks; renaming a
//      group onto another's name asks "Merge these groups?" through confirmDialog, and Merge puts both under one.
//   5. Sounds are 30px rows: a click plays one more copy (×2), a right-click stops the newest. A right-click on the
//      playing track pauses it; on another track it does nothing.
//   6. The Sounds card names what plays with ×N, and its button stops every sound and greys out.
//   7. A built-in sound renames, moves into the DM's group and deletes (hidden, in the Trash); the built-in group
//      "Combat" renames by its ⋯; after a restart in Russian an unrenamed built-in sound and group read in Russian and
//      the renamed ones keep their names.
//   8. Pictures keep their tile size (two to a row) and gain groups and a manual order by drag.
//   9. Delete puts a track, a sound and a picture in the Trash with the undo toast; Undo and Restore put each back in
//      its group; a picture on the TV comes down first.
//  11. A renamed track's name is the row's, the now-playing line's, the search's, the undo toast's, the Trash row's
//      and Claude's list_music's.
//  12. Claude: list_music, rename_music, set_music_group with a position, create_music_group needing tracks,
//      list_sounds, rename_sound, set_sound_group, delete_sound (asks, then to the Trash, undo_last_change brings it
//      back), set_picture_group; two sounds of one name are refused with both named.
//  15. A name holding markup reaches the screen as text.

const fs = require('fs');
const path = require('path');
const lib = require('../lib');

const q = JSON.stringify;
const N = 124;
const T = i => 'Трек ' + String(i).padStart(3, '0');

const PAGE = `
globalThis.__lib = id => document.getElementById(id);
globalThis.__row = (id, label) => [...__lib(id).querySelectorAll('[data-lib-key]')].find(r => r.querySelector('.lib-name').textContent === label);
globalThis.__head = (id, name) => [...__lib(id).querySelectorAll('.lib-gh')].find(h => h.querySelector('.lib-name') && h.querySelector('.lib-name').textContent === name);
globalThis.__secs = id => [...__lib(id).querySelectorAll('.lib-sec')].filter(s => s.offsetParent !== null).map(s => ({
  name: s.querySelector('.lib-gh .lib-name') ? s.querySelector('.lib-gh .lib-name').textContent : null,
  items: [...s.querySelectorAll('[data-lib-key]')].map(r => r.querySelector('.lib-name').textContent) }));
globalThis.__order = id => [...__lib(id).querySelectorAll('[data-lib-key]')].map(r => r.querySelector('.lib-name').textContent);
globalThis.__at = (el, fy) => { el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height * (fy == null ? 0.5 : fy), w: r.width, h: r.height, left: r.left, right: r.right }; };
// Two points to drag between: the target scrolled into view, then both read, so neither is stale.
globalThis.__pair = (a, b, fb) => { b.scrollIntoView({ block: 'center' });
  const p = (el, f) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height * (f == null ? 0.5 : f) }; };
  return [p(a), p(b, fb)]; };
globalThis.__menu = () => [...document.querySelectorAll('.lib-menu:not(.lib-sub) > .sm-mi')].map(b => b.querySelector('.nm').textContent + '|' + b.querySelector('.ky').textContent);
globalThis.__pick = label => [...document.querySelectorAll('.lib-menu .sm-mi')].find(b => b.querySelector('.nm').textContent === label);
globalThis.__toast = () => { const t = document.getElementById('scene-undo-toast'); return t.style.display === 'none' ? null : t.querySelector('.undo-msg').textContent; };
globalThis.__dialog = () => { const ok = document.getElementById('cd-ok'); return ok && ok.offsetParent !== null ? document.getElementById('cd-title').textContent : null; };
globalThis.__gaFile = (name, w, h) => new Promise(r => {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); g.fillStyle = '#204060'; g.fillRect(0, 0, w, h);
  c.toBlob(b => r(new File([b], name, { type: 'image/png' })), 'image/png');
});
0`;

module.exports = async function libraryPanes(rig) {
  let dm = rig.dm;
  const musicDir = path.join(rig.profileDir, 'music');
  const ev = (x, ms) => dm.evaluate(x, ms);
  const mouse = (type, p, o) => dm.send('Input.dispatchMouseEvent', Object.assign({ type, x: Math.round(p.x), y: Math.round(p.y),
    button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 }, o || {}));
  const hover = p => mouse('mouseMoved', p, { button: 'none', buttons: 0 });
  const click = async p => { await hover(p); await mouse('mousePressed', p); await mouse('mouseReleased', p); };
  const rightClick = async p => { await hover(p); await mouse('mousePressed', p, { button: 'right', buttons: 2 }); await mouse('mouseReleased', p, { button: 'right' }); };
  // A drag in steps; `mid` runs with the button still down over the target.
  const drag = async (from, to, mid) => {
    await hover(from);
    await mouse('mousePressed', from);
    for (let k = 1; k <= 8; k++) await mouse('mouseMoved', { x: from.x + (to.x - from.x) * k / 8, y: from.y + (to.y - from.y) * k / 8 });
    if (mid) await mid();
    await mouse('mouseReleased', to);
  };
  const key = async (k, code, vk, mods) => {
    await dm.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers: mods || 0 });
    await dm.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers: mods || 0 });
  };
  const type = async text => { await dm.send('Input.insertText', { text }); await key('Enter', 'Enter', 13); };
  const at = (expr, fy) => ev('__at(' + expr + (fy == null ? '' : ', ' + fy) + ')');
  const row = (id, label) => `__row(${q(id)}, ${q(label)})`;
  const head = (id, name) => `__head(${q(id)}, ${q(name)})`;
  // A drag from one element to another, both read once the target is in view; `fy` places the drop along the target.
  const dragTo = async (a, b, fy, mid) => { const [f, t] = await ev(`__pair(${a}, ${b}, ${fy == null ? 'null' : fy})`); await drag(f, t, mid); };
  // ⋯ shows only under the pointer, so the pointer goes to the item or heading first, as the DM's does.
  const more = async owner => {
    await hover(await at(owner));
    const p = await ev(`(() => { const r = (${owner}).querySelector('.lib-more').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    await click(p);
  };
  const lit = id => () => lib.settle(dm, `!!document.querySelector('#${id} .lib-merge')`, 3000);
  const pane = async name => { await ev(`dockOpen(${q(name)}); 0`); await lib.settle(dm, `!document.getElementById('dock-pane-${name}').hidden`, 10000); };
  const claude = (tool, args) => ev(`_mcpAnswer(${q({ tool, args })})`, 60000);
  const said = r => (r && typeof r.text === 'string' ? r.text : JSON.stringify(r));
  const install = async () => { await lib.installHelpers(dm); await ev(PAGE); };
  await install();

  // 1
  await lib.step(rig, '1', async () => {
    await pane('music');
    await lib.settle(dm, `!!document.querySelector('#mu-list .mu-empty')`, 15000);
    const empty = await ev(`document.querySelector('#mu-list .mu-empty') && document.querySelector('#mu-list .mu-empty').textContent`);
    rig.check(empty === 'No music yet. Use + Add.', '1: the empty Music pane reads ' + q(empty));
    const heads = await ev(`['dock-pane-music', 'dock-pane-sounds', 'dock-pane-gallery'].map(id => [...document.querySelectorAll('#' + id + ' .dk-head button')].map(b => b.className + ':' + b.textContent.trim()))`);
    rig.check(heads.every(h => h.length === 1 && h[0] === 'dk-addb:Add'), '1: a pane header is not one "+ Add" word button: ' + q(heads));
    await click(await at(`document.getElementById('btn-mu-add')`));
    const rows = await ev('__menu()');
    rig.check(q(rows) === q(['From files…|', 'From YouTube…|']), '1: Music\'s "+ Add" lists ' + q(rows));
    await key('Escape', 'Escape', 27);
  });

  // Setup: 124 tracks, the pane read again.
  fs.mkdirSync(musicDir, { recursive: true });
  for (let i = 1; i <= N - 2; i++) fs.writeFileSync(path.join(musicDir, T(i) + '.wav'), lib.wav(1, 6 + (i % 9)));
  fs.writeFileSync(path.join(musicDir, 'Битва.wav'), lib.wav(3, 7));
  fs.writeFileSync(path.join(musicDir, 'Тема.wav'), lib.wav(3, 9));
  await ev('_muRefreshTracks().then(() => 0)', 60000);
  rig.check(await ev('_muTracks.length') === N, 'setup: the music pane does not list ' + N + ' tracks: ' + await ev('_muTracks.length'));

  // 2
  await lib.step(rig, '2', async () => {
    const p = await at(`__row('mu-list', ${q(T(3))})`);
    await hover(p);
    const shown = await ev(`[...__lib('mu-list').querySelectorAll('.mu-row')].filter(r => getComputedStyle(r.querySelector('.lib-more')).display !== 'none').map(r => r.dataset.track)`);
    rig.check(q(shown) === q([T(3) + '.wav']), '2: ⋯ shows on ' + q(shown) + ', not only on the row under the pointer');
    await more(`__row('mu-list', ${q(T(3))})`);
    const rows = await ev('__menu()');
    rig.check(q(rows) === q(['Rename|Ctrl+R', 'Move to group|›', 'Delete|']), '2: the row\'s ⋯ lists ' + q(rows));
    await key('Escape', 'Escape', 27);
    await hover(await at(`__row('mu-list', ${q(T(3))})`));
    await key('r', 'KeyR', 82, 2);
    const editing = await lib.settle(dm, `document.activeElement && document.activeElement.classList.contains('lib-edit')`, 5000);
    rig.check(editing, '2: Ctrl+R over a row did not open its name in place');
    await type('Пролог <b>жирный</b>');
    await lib.settle(dm, `!!__row('mu-list', 'Пролог <b>жирный</b>')`, 5000);
    rig.check(await ev(`!!__row('mu-list', 'Пролог <b>жирный</b>')`), '2: Enter did not keep the typed name');
    // 15
    rig.check(await ev(`!__lib('mu-list').querySelector('.lib-name b')`), '15: a name holding markup reached the screen as markup');
  });

  // 3
  await lib.step(rig, '3', async () => {
    const before = await ev(`__order('mu-list')`);
    await dragTo(row('mu-list', T(10)), row('mu-list', T(5)), 0.15);
    const after = await ev(`__order('mu-list')`);
    rig.check(after.indexOf(T(10)) === after.indexOf(T(5)) - 1 && after.length === before.length, '3: the dragged track did not land above "' + T(5) + '": ' + q(after.slice(0, 12)));

    // Hold to group.
    let held = false;
    await dragTo(row('mu-list', 'Битва'), row('mu-list', 'Тема'), 0.5, async () => { held = await lit('mu-list')(); });
    rig.check(held, '3: held over the middle of "Тема", the target did not light');
    const open = await lib.settle(dm, `document.activeElement && document.activeElement.classList.contains('lib-edit') && !!document.activeElement.closest('.lib-gh')`, 5000);
    rig.check(open, '3: the new group\'s name field is not open');
    await type('Подземье');
    await lib.settle(dm, `!!${head('mu-list', 'Подземье')}`, 5000);
    const sec = (await ev(`__secs('mu-list')`)).find(x => x.name === 'Подземье');
    rig.check(!!sec && q(sec.items) === q(['Тема', 'Битва']), '3: the hold did not make a group of the two, target first: ' + q(sec));

    // A drop on a heading joins: the last ungrouped track, just above the groups.
    const last = T(N - 2);
    await dragTo(row('mu-list', last), head('mu-list', 'Подземье'));
    const joined = (await ev(`__secs('mu-list')`)).find(x => x.name === 'Подземье');
    rig.check(!!joined && joined.items.includes(last), '3: a drop on the heading did not join the group: ' + q(joined));

    // The last item out removes the group: a group of two, both dragged back above an ungrouped track.
    await dragTo(row('mu-list', T(N - 3)), row('mu-list', T(N - 4)), 0.5, lit('mu-list'));
    await type('Одиночка');
    await lib.settle(dm, `!!${head('mu-list', 'Одиночка')}`, 5000);
    await dragTo(row('mu-list', T(N - 3)), row('mu-list', T(N - 5)), 0.15);
    rig.check(await ev(`!!${head('mu-list', 'Одиночка')}`), '3 setup: the group went with one track still in it');
    await dragTo(row('mu-list', T(N - 4)), row('mu-list', T(N - 5)), 0.15);
    rig.check(!(await ev(`!!${head('mu-list', 'Одиночка')} || musicGroupNames().includes('Одиночка')`)), '3: the group stayed after its last track left');

    // The list scrolls near its bottom edge.
    const sc = `__lib('mu-list').closest('.dk-scroll')`;
    await ev(`${sc}.scrollTop = 0; 0`);
    const top = await ev(`${sc}.scrollTop`);
    const box = await ev(`(() => { const r = ${sc}.getBoundingClientRect(); return { x: r.left + r.width / 2, bottom: r.bottom }; })()`);
    const first = await ev(`(() => { const r = __lib('mu-list').querySelector('.mu-row').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    let scrolled = null;
    await drag(first, { x: box.x, y: box.bottom - 4 }, async () => { scrolled = await lib.poll(async () => { const v = await ev(`${sc}.scrollTop`); return v > top + 40 ? { v } : null; }, 5000, 100); });
    rig.check(!!scrolled, '3: a drag held at the bottom edge did not scroll the list of ' + N);

    // A filter turns drag off.
    await ev(`(() => { const f = document.getElementById('mu-filter'); f.value = 'Трек 04'; f.dispatchEvent(new Event('input')); return 0; })()`);
    const f0 = await ev(`__order('mu-list')`);
    await dragTo(row('mu-list', T(45)), row('mu-list', T(41)), 0.15);
    rig.check(q(await ev(`__order('mu-list')`)) === q(f0) && !(await ev(`!!document.querySelector('.lib-ghost')`)), '3: a drag moved a track while the filter was typed');
    await ev(`(() => { const f = document.getElementById('mu-filter'); f.value = ''; f.dispatchEvent(new Event('input')); return 0; })()`);
  });

  // 4
  await lib.step(rig, '4', async () => {
    await click(await at(`__head('mu-list', 'Подземье')`));
    rig.check(await ev(`__head('mu-list', 'Подземье').closest('.lib-sec').classList.contains('shut')`), '4: a heading click did not fold the group');
    await click(await at(`__head('mu-list', 'Подземье')`));
    await more(`__head('mu-list', 'Подземье')`);
    const rows = await ev('__menu()');
    rig.check(q(rows) === q(['Rename|Ctrl+R', 'Ungroup|']), '4: the group\'s ⋯ lists ' + q(rows));
    await key('Escape', 'Escape', 27);
    // A second group, then a rename onto the first's name.
    await dragTo(row('mu-list', T(N - 7)), row('mu-list', T(N - 6)), 0.5, lit('mu-list'));
    await type('Пещеры');
    await lib.settle(dm, `!!__head('mu-list', 'Пещеры')`, 5000);
    await hover(await at(`__head('mu-list', 'Пещеры')`));
    await key('r', 'KeyR', 82, 2);
    await lib.settle(dm, `document.activeElement && document.activeElement.classList.contains('lib-edit')`, 5000);
    await type('подземье');
    const asked = await lib.poll(() => ev('__dialog()'), 5000, 100);
    rig.check(asked === 'Merge these groups?', '4: renaming onto a name in use did not ask to merge: ' + q(asked));
    if (asked) await ev(`document.getElementById('cd-ok').click(); 0`);
    const merged = (await ev(`__secs('mu-list')`)).find(s => s.name === 'Подземье');
    rig.check(!!merged && merged.items.includes(T(N - 7)) && merged.items.includes('Битва') && !(await ev(`!!__head('mu-list', 'Пещеры')`)), '4: Merge did not put both under one heading: ' + q(merged));
    // Ungroup keeps the tracks.
    await dragTo(row('mu-list', T(N - 9)), row('mu-list', T(N - 8)), 0.5, lit('mu-list'));
    await type('Временная');
    await lib.settle(dm, `!!__head('mu-list', 'Временная')`, 5000);
    await more(`__head('mu-list', 'Временная')`);
    await ev(`__pick('Ungroup').click(); 0`);
    const order = await ev(`__order('mu-list')`);
    rig.check(!(await ev(`!!__head('mu-list', 'Временная')`)) && order.includes(T(N - 9)) && order.includes(T(N - 8)), '4: Ungroup did not keep the tracks');
  });

  // 5 and 11 (music half)
  await lib.step(rig, '5, 11', async () => {
    await ev('_muEnsureDecks(); _muDecks.forEach(d => { d.el.muted = true; }); 0');
    await click(await at(`__row('mu-list', 'Пролог <b>жирный</b>')`));
    await lib.settle(dm, `_muPlaying === ${q(T(3) + '.wav')}`, 15000);
    rig.check(await ev(`document.getElementById('mu-pill-name').textContent`) === 'Пролог <b>жирный</b>', '11: the now-playing line does not read the track\'s name');
    await rightClick(await at(`__row('mu-list', 'Тема')`));
    rig.check(await ev('_muPlaying === ' + q(T(3) + '.wav') + ' && !_muPaused'), '5: a right-click on another track changed the playing one');
    await rightClick(await at(`__row('mu-list', 'Пролог <b>жирный</b>')`));
    rig.check(await ev('_muPaused === true'), '5: a right-click on the playing track did not pause it');
    const found = await ev(`searchEntries().filter(e => e.kind === 'music' && e.id === ${q(T(3) + '.wav')}).map(e => e.name)`);
    rig.check(q(found) === q(['Пролог <b>жирный</b>']), '11: the search lists the track as ' + q(found));
    const listed = JSON.parse(said(await claude('list_music', { query: 'Пролог' })));
    rig.check(listed.tracks && listed.tracks.length === 1 && listed.tracks[0].name === 'Пролог <b>жирный</b>', '11: Claude\'s list_music reads ' + q(listed));
  });

  // 9 and 11 (a track to the Trash and back in its group)
  await lib.step(rig, '9, 11: a track', async () => {
    await more(`__row('mu-list', 'Битва')`);
    await ev(`__pick('Delete').click(); 0`);
    const msg = await lib.poll(() => ev('__toast()'), 15000, 100);
    rig.check(msg === '"Битва" moved to Trash', '9: the track\'s undo toast reads ' + q(msg));
    await ev(`document.querySelector('#scene-undo-toast .undo-btn').click(); 0`);
    const back = await lib.poll(async () => { const s = (await ev(`__secs('mu-list')`)).find(x => x.name === 'Подземье'); return s && s.items.includes('Битва') ? s : null; }, 15000, 200);
    rig.check(!!back, '9: Undo did not put "Битва" back in "Подземье"');
    await more(`__row('mu-list', 'Пролог <b>жирный</b>')`);
    await ev(`__pick('Delete').click(); 0`);
    const trashed = await lib.poll(async () => (await ev('sceneTrash.list()', 20000)).find(e => e.kind === 'music'), 15000, 200);
    rig.check(!!trashed && trashed.name === 'Пролог <b>жирный</b>', '11: the Trash row reads ' + q(trashed));
    if (trashed) {
      await ev(`dockOpen('settings'); trashPanelRefresh().then(() => 0)`, 20000);
      const btn = `document.querySelector('#sy-trash [data-restore=' + CSS.escape(${q(trashed.id)}) + ']')`;
      rig.check(await lib.settle(dm, `!!${btn}`, 10000), '9: the Trash lists no Restore for the track');
      await ev(`${btn}.click(); 0`);
      await pane('music');
      const again = await lib.poll(() => ev(`!!__row('mu-list', 'Пролог <b>жирный</b>')`), 15000, 200);
      rig.check(!!again, '9: Restore did not bring the renamed track back under its name');
    }
  });

  // 5, 6, 7 Sounds
  await lib.step(rig, '5, 6, 7: sounds', async () => {
    await pane('sounds');
    await lib.settle(dm, `!!__row('sb-cols', 'Swords clash')`, 15000);
    await ev(`_sbEnsureCtx(); _sbMaster.disconnect(); const z = _sbCtx.createGain(); z.gain.value = 0; _sbMaster.connect(z); z.connect(_sbCtx.destination); 0`);
    const h = await ev(`__row('sb-cols', 'Swords clash').getBoundingClientRect().height / (__row('sb-cols', 'Swords clash').getBoundingClientRect().width / __row('sb-cols', 'Swords clash').offsetWidth)`);
    rig.check(Math.abs(h - 30) < 1, '5: a sound row is ' + h + 'px tall, not 30');
    const sw = await at(`__row('sb-cols', 'Swords clash')`);
    await click(sw); await click(sw);
    await lib.settle(dm, `(_sbPlaying['sword-clash.mp3'] || []).length === 2`, 15000);
    const card = await ev(`({ now: document.getElementById('sb-now').textContent, count: __row('sb-cols', 'Swords clash').querySelector('.sb-count').textContent, stop: document.getElementById('btn-sb-stop').disabled })`);
    rig.check(card.count === '×2' && /Swords clash ×2/.test(card.now) && !card.stop, '5, 6: two clicks did not show ×2 on the row and the card: ' + q(card));
    await rightClick(sw);
    rig.check(await ev(`(_sbPlaying['sword-clash.mp3'] || []).length`) === 1, '5: a right-click did not stop the newest copy');
    await click(await at(`__row('sb-cols', 'Thunder')`));
    await lib.settle(dm, `(_sbPlaying['thunder.mp3'] || []).length === 1`, 15000);
    await click(await at(`document.getElementById('btn-sb-stop')`));
    const stopped = await ev(`({ n: Object.keys(_sbPlaying).length, off: document.getElementById('btn-sb-stop').disabled })`);
    rig.check(stopped.n === 0 && stopped.off, '6: the card\'s button did not stop every sound and grey out: ' + q(stopped));

    // 7: a built-in renamed, grouped with another, its group heading renamed, one deleted.
    await hover(await at(`__row('sb-cols', 'Dragon roar')`));
    await key('r', 'KeyR', 82, 2);
    await lib.settle(dm, `document.activeElement && document.activeElement.classList.contains('lib-edit')`, 5000);
    await type('Рёв Смауга');
    await dragTo(row('sb-cols', 'Рёв Смауга'), row('sb-cols', 'Wolf howl'), 0.5, lit('sb-cols'));
    await type('Сессия 4');
    const s4 = (await ev(`__secs('sb-cols')`)).find(s => s.name === 'Сессия 4');
    rig.check(!!s4 && q(s4.items) === q(['Wolf howl', 'Рёв Смауга']), '7: built-ins did not regroup into the DM\'s group: ' + q(s4));
    await more(`__head('sb-cols', 'Combat')`);
    await ev(`__pick('Rename').click(); 0`);
    await lib.settle(dm, `document.activeElement && document.activeElement.classList.contains('lib-edit')`, 5000);
    await type('Драки');
    rig.check(await ev(`!!__head('sb-cols', 'Драки') && !__head('sb-cols', 'Combat')`), '7: the built-in group "Combat" did not rename');
    await more(`__row('sb-cols', 'Bell')`);
    await ev(`__pick('Delete').click(); 0`);
    const gone = await lib.poll(async () => !(await ev(`!!__row('sb-cols', 'Bell')`)) && (await ev('sceneTrash.list()', 20000)).find(e => e.kind === 'builtin'), 15000, 200);
    rig.check(!!gone && gone.name === 'Bell' && await ev('__toast()') === '"Bell" moved to Trash', '7, 9: deleting a built-in did not hide it into the Trash with the toast: ' + q(gone));
    await ev(`document.querySelector('#scene-undo-toast .undo-btn').click(); 0`);
    const bellBack = await lib.poll(async () => { const s = (await ev(`__secs('sb-cols')`)).find(x => x.name === 'Magic'); return s && s.items.includes('Bell') ? s : null; }, 15000, 200);
    rig.check(!!bellBack, '9: Undo did not put "Bell" back in "Magic"');
  });

  // 8, 9 Pictures
  await lib.step(rig, '8, 9: pictures', async () => {
    await pane('gallery');
    await ev(`(async () => { const files = [await __gaFile('Лич.png', 400, 400), await __gaFile('Письмо.png', 300, 500), await __gaFile('Королева.png', 500, 300)];
      const inp = document.getElementById('ga-input'), dt = new DataTransfer(); files.forEach(f => dt.items.add(f));
      inp.files = dt.files; inp.dispatchEvent(new Event('change', { bubbles: true })); return 0; })()`, 30000);
    await lib.settle(dm, `_gaPics.length === 3 && __order('ga-grid').length === 3`, 20000);
    const size = await ev(`(() => { const t = [...__lib('ga-grid').querySelectorAll('.ga-tile')].map(x => x.getBoundingClientRect()); const g = __lib('ga-grid').getBoundingClientRect(); return { w: t[0].width, row: t[0].top === t[1].top && t[2].top > t[0].top, grid: g.width }; })()`);
    rig.check(size.row && size.w > size.grid * 0.35, '8: the tiles are not two to a row at today\'s size: ' + q(size));
    const before = await ev(`__order('ga-grid')`);
    const last = before[2], first = before[0];
    const fr = await ev(`(() => { const r = __row('ga-grid', ${q(last)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    const tr = await ev(`(() => { const r = __row('ga-grid', ${q(first)}).getBoundingClientRect(); return { x: r.left + r.width * 0.1, y: r.top + r.height / 2 }; })()`);
    await drag(fr, tr);
    const after = await ev(`__order('ga-grid')`);
    rig.check(after[0] === last, '8: dragging the last picture before the first did not reorder: ' + q(after));
    const a = await ev(`(() => { const r = __row('ga-grid', ${q(after[1])}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    const b = await ev(`(() => { const r = __row('ga-grid', ${q(after[2])}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    await drag(a, b, lit('ga-grid'));
    await type('Люди');
    const people = (await ev(`__secs('ga-grid')`)).find(s => s.name === 'Люди');
    rig.check(!!people && people.items.length === 2, '8: a hold did not make a picture group: ' + q(await ev(`__secs('ga-grid')`)));
    // 9: on the TV, then deleted: it comes down, goes to the Trash, and Restore puts it back in "Люди".
    const victim = people ? people.items[0] : after[1];
    await ev(`__row('ga-grid', ${q(victim)}).querySelector('.ga-th').click(); 0`);
    rig.check(await ev('_gaLive !== null'), '9 setup: the picture is not on the TV');
    await ev(`__row('ga-grid', ${q(victim)}).querySelector('.lib-more').click(); __pick('Delete').click(); 0`);
    const out = await lib.poll(async () => (await ev('sceneTrash.list()', 20000)).find(e => e.kind === 'picture'), 15000, 200);
    rig.check(!!out && await ev('_gaLive === null') && !(await ev('!!__dialog()')), '9: the picture on the TV did not come down into the Trash without a question');
    rig.check(await ev('__toast()') === '"' + victim + '" moved to Trash', '9: the picture\'s toast reads ' + q(await ev('__toast()')));
    if (out) {
      await ev(`dockOpen('settings'); trashPanelRefresh().then(() => 0)`, 20000);
      const btn = `document.querySelector('#sy-trash [data-restore=' + CSS.escape(${q(out.id)}) + ']')`;
      rig.check(await lib.settle(dm, `!!${btn}`, 10000), '9: the Trash lists no Restore for the picture');
      await ev(`${btn}.click(); 0`);
      await pane('gallery');
      const home = await lib.poll(async () => { const s = (await ev(`__secs('ga-grid')`)).find(x => x.name === 'Люди'); return s && s.items.includes(victim) ? s : null; }, 15000, 200);
      rig.check(!!home, '9: Restore did not put the picture back in "Люди"');
    }
  });

  // 12 Claude
  await lib.step(rig, '12', async () => {
    rig.check(/Nothing was changed|tracks/.test(said(await claude('create_music_group', { name: 'Пустая' }))) && !(await ev(`musicGroupNames().includes('Пустая')`)), '12: create_music_group made a group with no tracks');
    said(await claude('rename_music', { name: T(70), newName: 'Ночной лес' }));
    rig.check(await ev(`musicLabel(${q(T(70) + '.wav')})`) === 'Ночной лес', '12: rename_music did not rename the track');
    said(await claude('set_music_group', { tracks: ['Ночной лес'], group: 'Подземье', position: 1 }));
    await pane('music');
    const top = (await ev(`__secs('mu-list')`)).find(s => s.name === 'Подземье');
    rig.check(!!top && top.items[0] === 'Ночной лес', '12: set_music_group did not put the track at position 1: ' + q(top && top.items));
    await pane('sounds');
    said(await claude('rename_sound', { name: 'Crow', newName: 'Рёв Смауга' }));
    const amb = said(await claude('set_sound_group', { sounds: ['Рёв Смауга'] }));
    rig.check(/Two or more sounds are called "Рёв Смауга"/.test(amb) && /built in/.test(amb), '12: two sounds of one name were not refused with both named: ' + amb);
    const ask = said(await claude('delete_sound', { name: 'Rats' }));
    rig.check(/Would delete/.test(ask) && await ev(`!!__row('sb-cols', 'Rats')`), '12: delete_sound did not ask first');
    said(await claude('delete_sound', { name: 'Rats', confirmed: true }));
    rig.check(!(await ev(`soundsList().some(x => x.label === 'Rats')`)) && (await ev('sceneTrash.list()', 20000)).some(e => e.id === 'builtin:rats.mp3'), '12: delete_sound did not move "Rats" to the Trash');
    said(await claude('undo_last_change', {}));
    rig.check(await lib.poll(() => ev(`soundsList().some(x => x.label === 'Rats')`), 10000, 200), '12: undo_last_change did not bring "Rats" back');
    const ls = JSON.parse(said(await claude('list_sounds', { query: 'Wolf' })));
    rig.check(ls.sounds && ls.sounds[0] && ls.sounds[0].group === 'Сессия 4' && ls.sounds[0].builtIn === true, '12: list_sounds reads ' + q(ls));
    said(await claude('set_picture_group', { pictures: ['Королева'], group: '' }));
    const pics = JSON.parse(said(await claude('list_gallery', {})));
    rig.check(pics.pictures && pics.pictures.find(p => p.name === 'Королева').group === null, '12: set_picture_group did not take the picture out of its group: ' + q(pics));
  });

  // 7 in Russian, and the order kept across a restart.
  await lib.step(rig, '7: Russian', async () => {
    const order = await ev(`__order('mu-list')`);
    dm = await lib.inRussian(rig);
    await install();
    await pane('music');
    await lib.settle(dm, `_muTracks.length === ${N}`, 30000);
    rig.check(q(await ev(`__order('mu-list')`)) === q(order), '7: the music order did not survive a restart');
    await pane('sounds');
    await lib.settle(dm, `!!__lib('sb-cols').querySelector('.sb-row')`, 15000);
    const ru = await ev(`({ clash: t('Swords clash'), magic: !!__head('sb-cols', t('Magic')), drak: !!__head('sb-cols', 'Драки'), sess: !!__head('sb-cols', 'Сессия 4'),
      named: !!__row('sb-cols', 'Рёв Смауга') })`);
    rig.check(ru.clash !== 'Swords clash' && await ev(`!!__row('sb-cols', t('Swords clash'))`), '7: in Russian an unrenamed built-in sound does not read in Russian: ' + q(ru));
    rig.check(ru.magic && ru.drak && ru.sess && ru.named, '7: in Russian a heading or a renamed sound reads wrong: ' + q(ru));
  });
};

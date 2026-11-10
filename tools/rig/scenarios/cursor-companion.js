'use strict';

// cursor-companion.js — THE POINTER PACK AND THE CRYSTAL COMPANION.
//
// THE CRITERIA ARE THIS HEADER. Each has its check beneath it, in the same order. The pointer is moved with the
// protocol's own mouse events, so the window's hit testing, its iframes and the app's handlers all see a real one.
//
//   1. Every kind in the pack computes to its own data URL in the DM window, the Player window, a two-map column,
//      a stage half, the two-map shell and the splash, with its hotspot after the image; the 1x image's natural size
//      is the drawn size in CSS px and the 2x is twice it; a dart's hotspot sits on its tip, a centred kind's on its
//      middle. A button computes to the clickable kind, an unstyled panel to the arrow, a text field to the text kind.
//   2. On the DM's map the crystal follows the pointer to within 4 px of its hover point, and its canvas sits there.
//   3. Six fast clicks on empty map make it angry.
//   4. While a map loads (the progress overlay is up) it is busy, and stops when the overlay goes.
//   5. With reduced motion it keeps the resting shape and sits exactly at its hover point.
//   6. Its work never reaches a saved scene or a backup: the library's digest is the same after, and no zip entry or
//      saved field names it. Its canvas is a 96 px fixed layer, never inside the map's container.
//   7. It hides while grid calibration's magnifier hides the cursor.
//   8. In the Player window it follows the pointer too.
//   9. Settings' "Crystal companion" Off hides it in the DM window and the Player window; two-map columns and stage
//      halves open with it off; On brings it back in every column and half.
//  10. In two-map mode exactly one crystal shows on the DM screen: the column the pointer is in, the parent none.
//      On the TV, exactly the half the pointer is in.

const fs = require('fs');
const path = require('path');
const lib = require('../lib');
const kit = require('../backupKit');

// Every kind set on a probe element, read back through the computed style and the decoded images.
const PACK = `(async () => {
  const out = { form: cursorPackForm, faults: [] };
  const el = document.createElement('div');
  document.body.appendChild(el);
  const alphaOf = async url => {
    const img = new Image(); img.src = url; await img.decode();
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    return { w: img.naturalWidth, h: img.naturalHeight, a: (x, y) => d[(y * c.width + x) * 4 + 3] };
  };
  for (const k of CURSOR_KINDS) {
    el.style.cursor = cursorFor(k);
    const c = getComputedStyle(el).cursor, im = CURSOR_IMAGES[k], [w, h, hx, hy] = CURSOR_BOX[k];
    if (!c.includes(im.x1)) { out.faults.push(k + ' computes to ' + c.slice(0, 60)); continue; }
    if (cursorKindOf(c) !== k) out.faults.push(k + ' reads back as ' + cursorKindOf(c));
    const after = c.slice(c.lastIndexOf(')') + 1).trim();
    if (!after.startsWith(hx + ' ' + hy + ',')) out.faults.push(k + ' hotspot reads "' + after + '", want ' + hx + ' ' + hy);
    const one = await alphaOf(im.x1), two = await alphaOf(im.x2);
    if (one.w !== w || one.h !== h) out.faults.push(k + ' 1x is ' + one.w + 'x' + one.h + ', drawn ' + w + 'x' + h);
    if (two.w !== 2 * w || two.h !== 2 * h) out.faults.push(k + ' 2x is ' + two.w + 'x' + two.h);
    if (hx === 2) {
      if (!(one.a(hx, hy) > 60 && one.a(hx - 2, hy - 2) < 60)) out.faults.push(k + ' tip alpha ' + one.a(hx, hy) + ', above-left ' + one.a(hx - 2, hy - 2));
    } else {
      let x0 = w, x1 = 0, y0 = h, y1 = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (one.a(x, y) > 128) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      const mx = (x0 + x1 + 1) / 2, my = (y0 + y1 + 1) / 2;
      if (Math.abs(mx - hx) > 1.5 || Math.abs(my - hy) > 1.5) out.faults.push(k + ' drawn centre ' + mx + ',' + my + ' vs hotspot ' + hx + ',' + hy);
    }
  }
  el.remove();
  return out;
})()`;

// The kind real elements compute to: [selector, kind].
const KINDS_OF = pairs => `(${JSON.stringify(pairs)}).map(([sel, want]) => {
  const el = sel === 'html' ? document.documentElement : document.querySelector(sel);
  const got = el ? cursorKindOf(getComputedStyle(el).cursor) : 'missing';
  return got === want ? '' : sel + ' is ' + got + ', want ' + want;
}).filter(Boolean)`;
const DM_ELEMENTS = [['html', 'arrow'], ['#dock-pane-settings .dk-head', 'arrow'], ['#dock-tab-settings', 'pointer'], ['#ga-filter', 'text']];
const PLAYER_ELEMENTS = [['html', 'arrow'], ['#canvas-container', 'arrow']];

const STATE = `({ inside: _cmp.inside, on: _cmpOn, hidden: _cmp.canvas.hidden, raf: !!_cmp.raf, present: _cmp.s.present,
  vis: _cmp.s.vis, x: _cmp.s.x, y: _cmp.s.y, mood: _cmp.s.mood, shape: _cmp.s.shape, kind: _cmp.kind, tf: _cmp.canvas.style.transform })`;
const SHOWS = '(!_cmp.canvas.hidden && !!_cmp.raf && _cmp.s.present && _cmp.s.vis > 0.5)';
const near = (x, y, px) => `Math.hypot(_cmp.s.x - ${x}, _cmp.s.y - ${y}) < ${px || 4}`;

module.exports = async function cursorCompanion(rig) {
  const q = JSON.stringify;
  const dm = rig.dm;
  const move = (s, x, y) => s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
  const press = (s, x, y) => s.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  const release = (s, x, y) => s.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  const pack = async (session, where, elements) => {
    const r = await session.evaluate(PACK, 30000);
    rig.note(where + ': cursor form ' + r.form);
    rig.check(r.faults.length === 0, '1: the pack is wrong in ' + where + ': ' + r.faults.join('; '));
    if (elements) {
      const wrong = await session.evaluate(KINDS_OF(elements));
      rig.check(wrong.length === 0, '1: in ' + where + ' ' + wrong.join('; '));
    }
  };
  // A point on the map with the map's own container under it, away from the edges.
  const mapPoint = s => s.evaluate(`(() => { const r = container.getBoundingClientRect(), over = [];
    for (const [fx, fy] of [[0.5, 0.45], [0.4, 0.4], [0.6, 0.5], [0.45, 0.6]]) {
      const x = Math.round(r.left + r.width * fx), y = Math.round(r.top + r.height * fy), el = document.elementFromPoint(x, y);
      if (el && container.contains(el)) return { x, y };
      over.push(el ? el.tagName + '#' + el.id + '.' + el.className : 'nothing');
    }
    return { over }; })()`);

  // 1, the DM window and the splash
  await lib.step(rig, '1 DM', () => pack(dm, 'the DM window', DM_ELEMENTS));
  await lib.step(rig, '1 splash', async () => {
    await dm.evaluate(`(() => { const f = document.createElement('iframe'); f.id = '__rig-splash'; f.src = 'splash.html';
      f.style.cssText = 'position:fixed;left:0;top:0;width:40px;height:40px;opacity:0;pointer-events:none'; document.body.appendChild(f); return 0; })()`);
    const splash = await dm.frame('splash.html', 20000);
    await lib.settle(splash, 'typeof CURSOR_IMAGES !== "undefined" && !!CURSOR_IMAGES.arrow', 10000);
    rig.check(await splash.evaluate(`getComputedStyle(document.documentElement).cursor.includes(CURSOR_IMAGES.arrow.x1)`),
      '1: the splash does not compute to the arrow');
    await dm.evaluate(`document.getElementById('__rig-splash').remove(); 0`);
  });

  const id = await lib.importWithPlan(rig, 'Crypt');
  // The Campaign view can be up over the map after an import, or come back up just after it is put away,
  // so it is put away until the map itself is under the pointer.
  await dm.evaluate(`setShape('select'); 0`);
  const p = (await lib.poll(async () => {
    await dm.evaluate('if (worldMapOpen && !_wmAnim) worldMapHide(); 0');
    const at = await mapPoint(dm);
    return at.over ? null : at;
  }, 30000, 250)) || await mapPoint(dm);
  rig.check(!p.over, 'setup: no point on the DM window has the map under it; covered by ' + q(p.over));
  if (p.over) return;
  await kit.install(dm);
  const before = await dm.evaluate('__bk.digest()', 120000);

  // 2
  await lib.step(rig, '2', async () => {
    await move(dm, p.x - 40, p.y);
    await move(dm, p.x, p.y);
    const ok = await lib.settle(dm, SHOWS + ' && ' + near(p.x + 17, p.y - 3), 5000);
    const st = await dm.evaluate(STATE);
    rig.check(ok, '2: the crystal is not within 4 px of its hover point beside the pointer at ' + q(p) + ': ' + q(st));
    const tf = (st.tf.match(/-?[\d.]+/g) || []).map(Number);
    rig.check(Math.abs(tf[0] - (st.x - 48)) < 1 && Math.abs(tf[1] - (st.y - 48)) < 1, '2: the canvas does not sit on the crystal: ' + st.tf);
    rig.check(st.kind === 'arrow', '2: the select tool on empty map reads as ' + st.kind + ', not the arrow');
  });

  // 3
  await lib.step(rig, '3', async () => {
    for (let i = 0; i < 6; i++) { await press(dm, p.x, p.y); await release(dm, p.x, p.y); }
    rig.check(await lib.settle(dm, '_cmp.s.mood === "angry"', 3000), '3: six fast clicks on empty map did not anger it: ' + q(await dm.evaluate(STATE)));
    await lib.settle(dm, '_cmp.s.anger === 0', 5000);
  });

  // 4
  await lib.step(rig, '4', async () => {
    await dm.evaluate(`showMapProgress('Loading map…'); 0`);
    rig.check(await lib.settle(dm, '_cmp.s.mood === "busy"', 3000), '4: it is not busy while the map progress is up: ' + q(await dm.evaluate(STATE)));
    await dm.evaluate(`hideMapProgress(); 0`);
    rig.check(await lib.settle(dm, '_cmp.s.mood !== "busy"', 3000), '4: it is still busy after the map progress went');
  });

  // 5
  await lib.step(rig, '5', async () => {
    await dm.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await move(dm, p.x + 30, p.y + 10);
    const still = `_cmp.s.shape === 'rest' && _cmp.s.x === ${p.x + 47} && _cmp.s.y === ${p.y + 7} && _cmp.s.mAng === 0 &&
      _cmp.s.verts.every((v, i) => v[0] === CMP_SHAPES.rest[i][0] && v[1] === CMP_SHAPES.rest[i][1])`;
    rig.check(await lib.settle(dm, still, 3000), '5: under reduced motion it is not still at rest on its hover point: ' + q(await dm.evaluate(STATE)));
    await dm.send('Emulation.setEmulatedMedia', { features: [] });
  });

  // 6
  await lib.step(rig, '6', async () => {
    const layer = await dm.evaluate(`(() => { const c = document.getElementById('companion'), cs = getComputedStyle(c);
      return { n: document.querySelectorAll('#companion').length, inMap: container.contains(c), pos: cs.position, w: cs.width, h: cs.height, pe: cs.pointerEvents }; })()`);
    rig.check(q(layer) === q({ n: 1, inMap: false, pos: 'fixed', w: '96px', h: '96px', pe: 'none' }), '6: the crystal layer is not one fixed, unhittable 96 px canvas outside the map: ' + q(layer));
    await dm.evaluate('doAutoSave()', 60000);
    const after = await dm.evaluate('__bk.digest()', 120000);
    const diffs = kit.diffDigests(before, after, ['stamps']);
    rig.check(diffs.length === 0, '6: the library changed while only the crystal was worked: ' + diffs.map(kit.describe).join('; '));
    const saved = await dm.evaluate(`sceneStore.loadScene(${q(id)}).then(s => JSON.stringify(Object.keys(s)))`);
    rig.check(!/companion|cmp|cursor/i.test(saved), '6: the saved scene carries a field for it: ' + saved);
    const zip = path.join(rig.outDir, 'companion.zip');
    await dm.evaluate(`doExport([${q(id)}], { destPath: ${q(zip)} })`, 300000);
    const names = fs.existsSync(zip) ? kit.zipEntries(zip).map(e => e.name) : null;
    rig.check(!!names && !names.some(n => /companion|cursor/i.test(n)), '6: the backup is missing or carries the crystal: ' + q(names));
  });

  // 7
  await lib.step(rig, '7', async () => {
    await dm.evaluate('armGridCalibration(true); 0');
    await move(dm, p.x, p.y);
    await press(dm, p.x, p.y);
    await move(dm, p.x + 20, p.y + 20);
    const hid = await lib.settle(dm, `container.style.cursor === 'none' && _cmp.canvas.hidden`, 3000);
    rig.check(hid, '7: the crystal shows while the magnifier hides the cursor: ' + q(await dm.evaluate(`({ cur: container.style.cursor, st: ${STATE} })`)));
    await release(dm, p.x + 20, p.y + 20);
    await dm.evaluate('armGridCalibration(false); 0');
    rig.check(await lib.settle(dm, '!_cmp.canvas.hidden', 3000), '7: the crystal did not come back after the magnifier');
  });

  // 1 and 8, the Player window
  const player = await rig.player();
  await lib.step(rig, '1 Player', () => pack(player, 'the Player window', PLAYER_ELEMENTS));
  await lib.step(rig, '8', async () => {
    const tp = await player.evaluate('({ x: Math.round(innerWidth / 2), y: Math.round(innerHeight / 2) })');
    await move(player, tp.x - 30, tp.y);
    await move(player, tp.x, tp.y);
    rig.check(await lib.settle(player, SHOWS + ' && ' + near(tp.x + 17, tp.y - 3), 5000),
      '8: the Player\'s crystal does not follow the pointer: ' + q(await player.evaluate(STATE)));
  });

  // 9, off
  await lib.step(rig, '9 off', async () => {
    await dm.evaluate(`(() => { if (document.getElementById('dock-pane-settings').hidden) document.getElementById('dock-tab-settings').click(); return 0; })()`);
    const label = await dm.evaluate(`document.querySelector('#settings-companion .dk-sub').textContent`);
    rig.check(label === 'Crystal companion', '9: the Settings switch is labelled ' + q(label));
    await dm.evaluate(`document.querySelector('#settings-companion [data-on="0"]').click(); 0`);
    rig.check(await dm.evaluate(`localStorage.getItem('evermist.companionOff') === '1' && _cmp.canvas.hidden && !_cmp.raf`), '9: Off did not hide the DM\'s crystal: ' + q(await dm.evaluate(STATE)));
    rig.check(await lib.settle(player, '!_cmpOn && _cmp.canvas.hidden && !_cmp.raf', 3000), '9: Off did not reach the Player window: ' + q(await player.evaluate(STATE)));
    await move(player, 200, 200);
    await lib.hold(400, 'long enough for a crystal turned off to have come back on a move');
    rig.check(await player.evaluate('_cmp.canvas.hidden && !_cmp.raf'), '9: a move brought the Player\'s crystal back while off');
  });

  // 9 and 10, two maps
  await lib.step(rig, '9/10 two maps', async () => {
    await dm.evaluate(`enterPanes(${q(id)}, null)`, 60000);
    await lib.settle(dm, 'panesActive && livePanes().length >= 1 && livePanes().every(id => panes[id].ready)', 60000);
    const colA = await rig.pane('A');
    const halfA = await rig.player('A');
    await lib.installHelpers(colA);
    rig.check(!(await colA.evaluate('_cmpOn')) && !(await halfA.evaluate('_cmpOn')), '9: a column or a half opened with the crystal on while it is off');
    await pack(colA, 'column A');
    await pack(halfA, 'stage half A', PLAYER_ELEMENTS);
    const shell = await halfA.send('Runtime.evaluate', { expression: PACK, awaitPromise: true, returnByValue: true }, 30000);
    const sr = shell.result.value;
    rig.note('the shell: cursor form ' + sr.form);
    rig.check(sr.faults.length === 0, '1: the pack is wrong in the two-map shell: ' + sr.faults.join('; '));

    await dm.evaluate(`document.querySelector('#settings-companion [data-on="1"]').click(); 0`);
    rig.check(await lib.settle(colA, '_cmpOn', 3000), '9: On did not reach column A');
    rig.check(await lib.settle(halfA, '_cmpOn', 3000), '9: On did not reach stage half A');

    // 10, the DM screen: the parent first, then into the column.
    const r = await dm.evaluate(`(() => { const f = panes.A.frame.getBoundingClientRect(), b = document.getElementById('dock-tab-settings').getBoundingClientRect();
      return { fx: Math.round(f.left + f.width / 2), fy: Math.round(f.top + f.height / 2), bx: Math.round(b.left + b.width / 2), by: Math.round(b.top + b.height / 2) }; })()`);
    await move(dm, r.bx, r.by);
    rig.check(await lib.settle(dm, SHOWS, 3000), '10: the parent shows no crystal with the pointer on its own dock: ' + q(await dm.evaluate(STATE)));
    await move(dm, r.fx, r.fy);
    await move(dm, r.fx + 5, r.fy + 5);
    const one = await lib.settle(dm, '!_cmp.raf && !_cmp.inside', 3000) && await lib.settle(colA, SHOWS, 3000);
    rig.check(one, '10: not exactly one crystal on the DM screen with the pointer in column A: parent ' + q(await dm.evaluate(STATE)) + ', column ' + q(await colA.evaluate(STATE)));
    const colB = await dm.evaluate('!!(panes.B && panes.B.frame && panes.B.frame.contentWindow && panes.B.frame.contentWindow._cmp)');
    if (colB) rig.check(!(await dm.evaluate('panes.B.frame.contentWindow._cmp.raf')), '10: column B runs a crystal too');

    // 10, the TV: into half A through the shell.
    const h = await halfA.send('Runtime.evaluate', { expression: `(() => { const r = document.querySelector('.stage-col[data-pane="A"]').getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`, returnByValue: true });
    const hp = h.result.value;
    await move(halfA, hp.x, hp.y);
    await move(halfA, hp.x + 5, hp.y + 5);
    rig.check(await lib.settle(halfA, SHOWS, 3000), '10: stage half A shows no crystal with the pointer in it: ' + q(await halfA.evaluate(STATE)));
    const halfB = await halfA.send('Runtime.evaluate', { expression: `(() => { const f = document.querySelector('.stage-col[data-pane="B"] iframe');
      return !!(f && f.contentWindow && f.contentWindow._cmp && f.contentWindow._cmp.raf); })()`, returnByValue: true });
    rig.check(halfB.result.value === false, '10: stage half B runs a crystal while the pointer is in half A');
  });

  rig.byEye('3, 4, 5: the pointers are sharp at the size of a normal cursor on both screens, the crystal keeps up with no visible lag, and its shapes and moods match the board');
};

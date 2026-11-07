'use strict';

// map-settings.js — THE MAP SETTINGS PANE (BACKLOG 255): every control does what it says, read back from state.
//
// Not a blocker. The DM's spec names this file for its Definition of Done items 2, 3 and 6.
//
// THE CRITERIA ARE THIS HEADER. Each line has its check beneath it.
//
//   1. The grid switch turns the grid on and off.
//   2. − and + move the cell size by 1, and a typed 5 lands as 10.
//   3. Fit to map arms calibration.
//   4. Each line style sets the grid's style, and the TV gets it.
//   5. Each thickness sets the width 1, 2 or 4.
//   6. A colour preset sets the colour and wears the ring; the multicolour square opens the picker.
//   7. The opacity slider sets the opacity.
//   8. Reset asks, and on yes puts the grid back, Solid and Thin included.
//   9. Each weather icon sets the weather, and each fog icon the fog theme.
//  10. Room names and Lights each flip their switch's state.
//  11. The floor plan card shows its counts, and Draw rooms draws the rooms.
//  12. Settings' module text row opens the import panel.
//  13. A scene saved dotted reloads dotted.
//  14. A scene saved without a line style loads solid.
//  15. In Russian, the pane shows no English.
//  16. The floor plan card's trash asks, and on yes the plan leaves the map.

const lib = require('../lib');

const NAME = 'Map settings';

// Clicks an element by id in the DM window; a missing one throws, which lib.step turns into a named failure.
const click = (dm, id) => dm.evaluate(`(() => { const el = document.getElementById(${JSON.stringify(id)});
  if (!el) throw new Error('no #' + ${JSON.stringify(id)}); el.click(); return 0; })()`);
const clickSel = (dm, sel) => dm.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)});
  if (!el) throw new Error('no ' + ${JSON.stringify(sel)}); el.click(); return 0; })()`);
const asked = dm => lib.settle(dm, "!!document.getElementById('cd-ok') && document.getElementById('cd-ok').offsetParent !== null", 8000);

module.exports = async function mapSettings(rig) {
  let dm = rig.dm;
  const sceneId = await lib.importWithPlan(rig, NAME);
  await dm.evaluate("dockOpen('scene'); 0");

  // ── 1. The grid switch ────────────────────────────────────────────────────
  await lib.step(rig, '1: the grid switch', async () => {
    for (let k = 0; k < 2; k++) {
      const before = await dm.evaluate('gridEnabled');
      await click(dm, 'cp-grid-switch');
      const after = await dm.evaluate(`({ on: gridEnabled, aria: document.getElementById('cp-grid-switch').getAttribute('aria-checked') })`);
      rig.check(after.on === !before && after.aria === String(after.on), '1: the grid switch did not flip gridEnabled: ' + JSON.stringify({ before, after }));
    }
    if (!(await dm.evaluate('gridEnabled'))) await click(dm, 'cp-grid-switch');
  });

  // ── 2. Cell size ──────────────────────────────────────────────────────────
  await lib.step(rig, '2: the cell size stepper', async () => {
    const typed = v => dm.evaluate(`(() => { const el = document.getElementById('grid-size-num'); el.value = '${v}';
      el.dispatchEvent(new Event('change', { bubbles: true })); return { size: gridSize, field: el.value }; })()`);
    await typed(70);
    await click(dm, 'cp-grid-inc');
    rig.check(await dm.evaluate('gridSize') === 71, '2: + did not move the cell size from 70 to 71: ' + await dm.evaluate('gridSize'));
    await click(dm, 'cp-grid-dec');
    rig.check(await dm.evaluate('gridSize') === 70, '2: − did not move the cell size back to 70: ' + await dm.evaluate('gridSize'));
    const five = await typed(5);
    rig.check(five.size === 10 && five.field === '10', '2: a typed 5 did not clamp to 10: ' + JSON.stringify(five));
    await typed(70);
    const count = await dm.evaluate(`document.getElementById('cp-grid-count').textContent`);
    rig.note('cell count: ' + count);
    rig.check(/\d+ × \d+/.test(count), '2: the cell size readout shows no square count: ' + JSON.stringify(count));
  });

  // ── 3. Fit to map ─────────────────────────────────────────────────────────
  await lib.step(rig, '3: Fit to map', async () => {
    await click(dm, 'cp-grid-calibrate');
    rig.check(await dm.evaluate('gridCalArmed'), '3: Fit to map did not arm calibration');
    await dm.evaluate('armGridCalibration(false); dockOpen("scene"); 0');
  });

  // ── 4. Line style, on the DM and the TV ───────────────────────────────────
  await lib.step(rig, '4: line style', async () => {
    const player = await rig.player();
    await lib.settle(player, 'mapWidth > 0', 120000);
    for (const st of ['dashed', 'dotted', 'solid']) {
      await clickSel(dm, `#cp-gridline-row [data-lstyle="${st}"]`);
      // ⚠ A string, never the dataset: a DOMStringMap crosses CDP as {}.
      const here = await dm.evaluate(`({ style: gridLineStyle,
        active: (document.querySelector('#cp-gridline-row .active') || { dataset: {} }).dataset.lstyle || null })`);
      rig.check(here.style === st && here.active === st, '4: ' + st + ' did not set the line style: ' + JSON.stringify(here));
      const there = await lib.settle(player, 'gridLineStyle === ' + JSON.stringify(st), 15000);
      rig.check(there, '4: the TV never got the ' + st + ' line style: ' + await player.evaluate('gridLineStyle'));
    }
  });

  // ── 5. Thickness ──────────────────────────────────────────────────────────
  await lib.step(rig, '5: thickness', async () => {
    for (const w of [2, 4, 1]) {
      await clickSel(dm, `#cp-gridwidth-row [data-lw="${w}"]`);
      rig.check(await dm.evaluate('gridLineWidth') === w, '5: thickness ' + w + ' did not set the width: ' + await dm.evaluate('gridLineWidth'));
    }
  });

  // ── 6. Colour ─────────────────────────────────────────────────────────────
  await lib.step(rig, '6: colour', async () => {
    await clickSel(dm, '#cp-grid-swatches [data-color="#e8b23a"]');
    const got = await dm.evaluate(`({ color: gridColor,
      ring: [...document.querySelectorAll('#cp-grid-swatches .dk-swatch.on')].map(b => b.dataset.color || b.id) })`);
    rig.check(got.color === '#e8b23a' && got.ring.length === 1 && got.ring[0] === '#e8b23a',
              '6: the gold preset did not set the colour and take the ring: ' + JSON.stringify(got));
    await click(dm, 'cp-grid-custom');
    rig.check(await dm.evaluate(`!document.getElementById('cp-pop-grid').hidden`), '6: the multicolour square did not open the colour picker');
    await dm.evaluate('dockClosePop(); 0');
  });

  // ── 7. Opacity ────────────────────────────────────────────────────────────
  await lib.step(rig, '7: opacity', async () => {
    await dm.evaluate(`(() => { const el = document.getElementById('cp-grid-opacity'); el.value = 60;
      el.dispatchEvent(new Event('input', { bubbles: true })); return 0; })()`);
    const got = await dm.evaluate(`({ o: gridOpacity, shown: document.getElementById('cp-grid-opacity-val').textContent })`);
    rig.check(Math.abs(got.o - 0.6) < 1e-9 && got.shown === '60%', '7: the slider did not set the opacity to 60%: ' + JSON.stringify(got));
  });

  // ── 8. Reset ──────────────────────────────────────────────────────────────
  await lib.step(rig, '8: reset', async () => {
    await clickSel(dm, '#cp-gridline-row [data-lstyle="dashed"]');
    await clickSel(dm, '#cp-gridwidth-row [data-lw="4"]');
    await click(dm, 'cp-grid-reset');
    rig.check(await asked(dm), '8: Reset did not ask first');
    await click(dm, 'cd-ok');
    const got = await dm.evaluate(`({ style: gridLineStyle, w: gridLineWidth, color: gridColor, o: gridOpacity, size: gridSize, mode: gridMode })`);
    rig.check(got.style === 'solid' && got.w === 1 && got.color === '#ffffff' && got.o === 0.25 && got.size === 70 && got.mode === 'square',
              '8: Reset did not put the grid back to its defaults: ' + JSON.stringify(got));
  });

  // ── 9. Weather and fog ────────────────────────────────────────────────────
  await lib.step(rig, '9: weather and fog', async () => {
    for (const w of ['rain', 'storm', 'snowfall', 'blizzard', 'fair', 'none']) {
      await clickSel(dm, `#cp-wx-row [data-wx="${w}"]`);
      rig.check(await dm.evaluate('weatherId') === w, '9: the ' + w + ' icon did not set the weather: ' + await dm.evaluate('weatherId'));
    }
    for (const f of ['blood', 'toxic', 'ice', 'fire', 'default']) {
      await clickSel(dm, `#cp-fogtheme-row [data-fogtheme="${f}"]`);
      rig.check(await dm.evaluate('fogTheme') === f, '9: the ' + f + ' icon did not set the fog theme: ' + await dm.evaluate('fogTheme'));
    }
  });

  // ── 10. Room names and Lights ─────────────────────────────────────────────
  await lib.step(rig, '10: the two switches', async () => {
    for (const [row, sw, v] of [['cp-labels-row', 'cp-labels-switch', 'showRoomLabels'], ['cp-lights-row', 'cp-lights-switch', '!lightsHidden']]) {
      const before = await dm.evaluate(v);
      await click(dm, row);
      const after = await dm.evaluate(`({ v: ${v}, aria: document.getElementById('${sw}').getAttribute('aria-checked') })`);
      rig.check(after.v === !before && after.aria === String(after.v), '10: ' + row + ' did not flip ' + v + ': ' + JSON.stringify({ before, after }));
      await click(dm, row);
    }
  });

  // ── 11. The floor plan card ───────────────────────────────────────────────
  await lib.step(rig, '11: the floor plan card', async () => {
    const card = await dm.evaluate(`({ card: !document.getElementById('cp-plan-card').hidden, load: !document.getElementById('cp-src-plan').hidden,
      meta: document.getElementById('cp-plan-meta').textContent })`);
    rig.check(card.card && !card.load && /^3 rooms · /.test(card.meta), '11: the card does not show the plan and its counts: ' + JSON.stringify(card));
    const rooms = await lib.drawRooms(rig, 3);
    rig.check(rooms.length === 3, '11: Draw rooms did not draw the plan\'s three rooms: ' + rooms.length);
  });

  // ── 12. Module text in Settings ───────────────────────────────────────────
  await lib.step(rig, '12: module text', async () => {
    await dm.evaluate("dockOpen('settings'); 0");
    await click(dm, 'cp-src-module');
    rig.check(await dm.evaluate(`document.getElementById('mt-modal').style.display !== 'none'`), '12: the module text row did not open the import panel');
    await dm.evaluate("closeModuleTextModal(); dockOpen('scene'); 0");
  });

  // ── 13. Dotted survives a restart ─────────────────────────────────────────
  const stored = () => dm.evaluate(`(async () => { const s = await sceneStore.loadScene(${JSON.stringify(sceneId)});
    return s && s.gridConfig ? (s.gridConfig.lineStyle || 'none') : null; })()`, 30000);
  await lib.step(rig, '13: dotted reloads dotted', async () => {
    await clickSel(dm, '#cp-gridline-row [data-lstyle="dotted"]');
    const saved = await lib.poll(async () => (await stored()) === 'dotted' ? { s: 'dotted' } : null, 30000, 300);
    rig.check(!!saved, '13: the dotted line style never reached the disk');
    dm = await rig.restart();
    await lib.installHelpers(dm);
    await lib.settle(dm, 'currentScene && mapWidth > 0', 120000);
    const back = await dm.evaluate(`({ style: gridLineStyle, seg: (document.querySelector('#cp-gridline-row .active') || { dataset: {} }).dataset.lstyle || null })`);
    rig.check(back.style === 'dotted' && back.seg === 'dotted', '13: the scene saved dotted did not reload dotted: ' + JSON.stringify(back));
  });

  // ── 14 and 15. No line style loads solid; Russian shows no English ────────
  await lib.step(rig, '14: no line style loads solid', async () => {
    await dm.evaluate(`(async () => { const s = await sceneStore.loadScene(${JSON.stringify(sceneId)});
      delete s.gridConfig.lineStyle; await sceneStore.putScene(s); return 0; })()`, 30000);
    rig.check(await stored() === 'none', '14: setup: the stored scene still carries a line style');
    // ⚠ The page saves on close, and that save would write the dotted style held in memory back over the stripped
    // record. Stubbed here alone: what this criterion reads is the load.
    await dm.evaluate('doAutoSave = () => Promise.resolve(); 0');
    await dm.evaluate('localStorage.setItem("evermist-lang", "ru"); 0');
    dm = await rig.restart();
    await lib.installHelpers(dm);
    await lib.settle(dm, 'currentScene && mapWidth > 0', 120000);
    rig.note('stored line style after the restart: ' + await stored());
    const back = await dm.evaluate(`({ style: gridLineStyle, seg: (document.querySelector('#cp-gridline-row .active') || { dataset: {} }).dataset.lstyle || null })`);
    rig.check(back.style === 'solid' && back.seg === 'solid', '14: a scene with no line style did not load solid: ' + JSON.stringify(back));
  });

  await lib.step(rig, '15: Russian', async () => {
    rig.check(await dm.evaluate('document.documentElement.lang') === 'ru', '15: setup: the app did not come up in Russian');
    await dm.evaluate("dockOpen('scene'); 0");
    const english = await dm.evaluate(`(() => {
      const out = [];
      const roots = [document.getElementById('dock-pane-scene'), document.getElementById('cp-module-card').parentNode];
      for (const root of roots) {
        const tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
          acceptNode: n => n.nodeType === 1 && (n.id === 'cp-legacy' || n.matches('.tb-backend, [data-no-i18n]'))
            ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
        for (let n = tw.currentNode; n; n = tw.nextNode()) {
          const bits = n.nodeType === 3 ? [n.nodeValue] : ['title', 'aria-label'].map(a => n.getAttribute(a) || '');
          for (const b of bits) if (/[A-Za-z]{3,}/.test(b.replace(/\\.dd2vtt/g, ''))) out.push(b.trim());
        }
      }
      return out;
    })()`);
    rig.check(english.length === 0, '15: English left in the Russian pane: ' + JSON.stringify(english));
  });

  // ── 16. The trash ─────────────────────────────────────────────────────────
  await lib.step(rig, '16: the floor plan trash', async () => {
    const plan = await dm.evaluate('currentScene.floorPlan');
    await click(dm, 'cp-plan-remove');
    rig.check(await asked(dm), '16: the trash did not ask first');
    await click(dm, 'cd-ok');
    const got = await dm.evaluate(`({ plan: currentScene.floorPlan, card: !document.getElementById('cp-plan-card').hidden,
      load: !document.getElementById('cp-src-plan').hidden })`);
    rig.check(got.plan == null && !got.card && got.load, '16: the trash did not take the plan off the map: ' + JSON.stringify({ ...got, plan: !!got.plan }));
    // The plan goes back and the app comes up in English, so the shot after this file shows the pane as built.
    await dm.evaluate('attachPlanText(' + JSON.stringify(plan) + ')');
    await lib.poll(async () => (await dm.evaluate(`(async () => { const s = await sceneStore.loadScene(${JSON.stringify(sceneId)}); return !!(s && s.floorPlan); })()`, 30000)) ? { ok: 1 } : null, 30000, 300);
    await dm.evaluate('localStorage.setItem("evermist-lang", "en"); 0');
    dm = await rig.restart();
    await lib.installHelpers(dm);
    await lib.settle(dm, 'currentScene && mapWidth > 0 && fogCoverT === 0', 120000);
    await dm.evaluate("if (!gridEnabled) document.getElementById('cp-grid-switch').click(); dockOpen('scene'); 0");
  });
};

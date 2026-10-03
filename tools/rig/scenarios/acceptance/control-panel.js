'use strict';

// control-panel.js — THE DOCK'S SCENE CONTROL PANE.
//
// THE GOAL OF THIS FEATURE: everything the Fog, Grid and Player tabs did sits in one pane, laid
// out the way Figma lays out its right panel: Player, Fog, Rooms, Lights, Grid, My seat. Every control
// drives the same hidden back end the tabs drove, so each check here asserts what a control
// DOES, never only where it sits.
//
// THE CRITERIA ARE THIS HEADER. Each lettered line has its checks under a marker carrying its
// letter.
//
//   A. The pane holds Player, Fog, Rooms, Lights, Grid and My seat, in that order, and no zoom stepper.
//   B. A colour field opens its picker beside the dock, level with its row. A colour picked there
//      reaches the fog and the field, and a click elsewhere puts the picker away.
//   C. The movement dropdown sets each preset and says which is set. The eye switches movement
//      off and on, and follows the A key. Custom… opens the dials beside the dock.
//   D. The Rooms eye shows and hides the room names on the DM's map and follows the L key.
//      Reveal all and Shroud all reach every room's fog. The sources say what is loaded, and the
//      module text row opens its panel.
//   E. The grid's eye switches the grid and dims the section. The type segment sets the type and
//      switches the grid on. Scrubbing the cell size's icon changes the cell, and a typed size is
//      clamped.
//   F. Every Player control reaches the button it mirrors; Lock and Auto / Manual hold their
//      state; My seat turns the DM's map.
//   G. Every panel that floats over the map wears the SAME edge, read from the --panel-*
//      variables in base.css, and those variables still resolve to a real edge.

const lib = require('../../lib');

module.exports = async function sceneControlFeature(rig) {
  const dm = rig.dm;
  await lib.openMap(rig, { w: 900, h: 600 });
  const click = id => dm.evaluate('document.getElementById(' + JSON.stringify(id) + ').click(); 0');
  const on = id => dm.evaluate('document.getElementById(' + JSON.stringify(id) + ').classList.contains("active")');
  if (await dm.evaluate('dockActivePane()') !== 'scene') await click('dock-tab-scene');

  // ── A ──
  // RED ON: the Rooms section moved below Grid (index.html) — 2026-10-02
  const sections = await dm.evaluate('[...document.querySelectorAll("#dock-pane-scene .cp-group > .dk-sh .cp-label")]' +
                                     '.map(l => l.textContent.trim()).join(",")');
  rig.check(sections === 'Player,Fog,Rooms,Lights,Grid,My seat',
            'A: Scene control holds the wrong sections, or in the wrong order: ' + sections);
  rig.check(await dm.evaluate('!document.querySelector("[id^=cp-zoom]") && typeof minimapNudgeZoom === "undefined"'),
            'A: the TV zoom stepper is still in the app');

  // ── B ──
  // RED ON: dockPlacePop gated off in _dockInitPops (dock.js), and separately the FEEDS listener in _cpInitFields (controlPanel.js) — 2026-10-02
  await click('cp-fog-field');
  const pop = await dm.evaluate(`(() => {
    const p = document.getElementById('cp-pop-fog').getBoundingClientRect();
    const d = document.getElementById('dock').getBoundingClientRect();
    const f = document.getElementById('cp-fog-field').closest('.dk-blk').getBoundingClientRect();
    return { shown: p.width > 0, gap: d.left - p.right, dy: p.top - f.top };
  })()`);
  rig.check(pop.shown && pop.gap > 0 && pop.gap < 20 && Math.abs(pop.dy) < 2,
            'B: the fog colour picker did not open beside the dock, level with its row: ' + JSON.stringify(pop));
  await lib.fire(dm, 'fog-color', '#22aa44', 'input');
  const field = await dm.evaluate('document.querySelector("#cp-fog-field .cp-hex").textContent');
  rig.check(field === '22AA44',
            'B: a colour picked in the pop-out did not reach the field: ' + field);
  await dm.evaluate('document.getElementById("canvas-container").dispatchEvent(' +
                    'new MouseEvent("mousedown", { bubbles: true })); 0');
  rig.check(await dm.evaluate('document.getElementById("cp-pop-fog").hidden'),
            'B: a click on the map left the colour picker open');

  // ── C ──
  // RED ON: lbl.textContent gated off in setAnimModeUI, and separately the btn-anim click listener (controlPanel.js) — 2026-10-02
  const pickMove = m => dm.evaluate('document.getElementById("cp-move-dd").click();' +
    ' document.querySelector("#cp-pop-move [data-anim=' + m + ']").click(); 0');
  for (const [m, preset, label] of [['slow', 'calm', 'Slow drift'], ['fast', 'fast', 'Fast drift'],
                                    ['medium', 'default', 'Medium drift']]) {
    await pickMove(m);
    rig.check(await on('anim-preset-' + preset) && await dm.evaluate('document.getElementById("cp-move-lbl").textContent') === label,
              'C: picking ' + label + ' did not set its preset and say so');
  }
  await click('cp-move-eye');
  rig.check(await dm.evaluate('fogAnimEnabled') === false &&
            await dm.evaluate('document.getElementById("cp-move-eye").classList.contains("off")'),
            'C: the movement eye did not switch the fog movement off');
  await dm.evaluate('__rigKey("KeyA"); 0');
  rig.check(await dm.evaluate('fogAnimEnabled') === true &&
            !(await dm.evaluate('document.getElementById("cp-move-eye").classList.contains("off")')),
            'C: the A key switched movement back on but the eye did not follow');
  await pickMove('advanced');
  const adv = await dm.evaluate('(() => { const p = document.getElementById("anim-advanced-panel").getBoundingClientRect();' +
    ' return { shown: p.width > 0, beside: p.right < document.getElementById("dock").getBoundingClientRect().left }; })()');
  rig.check(adv.shown && adv.beside, 'C: Custom… did not open the dials beside the dock: ' + JSON.stringify(adv));
  await click('cp-adv-close');
  rig.check(!(await on('btn-anim-advanced')) && await dm.evaluate('document.getElementById("anim-advanced-panel").hidden'),
            'C: closing the dials left Custom movement armed or on screen');

  // ── D ──
  // RED ON: refreshRoomsControlUI gated off in toggleRoomLabels (roomPanel.js), and separately the KeyL case bypassing toggleRoomLabels (input.js); the Sources module row's click listener gated off (controlPanel.js) — 2026-10-02
  const labels = () => dm.evaluate('showRoomLabels');
  const before = await labels();
  await click('cp-labels-eye');
  // ⚠ READ THE EYE HERE TOO: after the L key below the names are back where they started, which is
  // also where an eye that never updates still sits.
  rig.check(await labels() === !before &&
            await dm.evaluate('document.getElementById("cp-labels-eye").classList.contains("off")') === before,
            'D: the Rooms eye did not switch the room names, or did not show it had');
  await dm.evaluate('__rigKey("KeyL"); 0');
  rig.check(await labels() === before &&
            await dm.evaluate('document.getElementById("cp-labels-eye").classList.contains("off")') === !before,
            'D: the L key switched the names but the Rooms eye did not follow');
  await dm.evaluate('polygons = [{ id: 1, vertices: [{x:100,y:100},{x:300,y:100},{x:300,y:260},{x:100,y:260}],' +
                    ' mode: "reveal", cornerRadius: 0, name: "Hall" }]; nextPolygonId = 2; 0');
  await click('btn-fill-fog');
  rig.check(await dm.evaluate('polygons[0].mode') === 'shroud', 'D: Shroud all did not reach the room');
  await click('btn-clear-fog');
  rig.check(await dm.evaluate('polygons[0].mode') === 'reveal', 'D: Reveal all did not reach the room');
  rig.check(await dm.evaluate('document.querySelector("#cp-src-plan .nm").textContent') === 'Load floor plan…' &&
            await dm.evaluate('document.getElementById("btn-floorplan").disabled'),
            'D: the floor plan source does not say this map has none');
  await click('cp-src-module');
  rig.check(await dm.evaluate('document.getElementById("mt-modal").style.display !== "none"'),
            'D: the module text button did not open its panel');
  await dm.evaluate('closeModuleTextModal(); polygons = []; nextPolygonId = 1; 0');

  // ── E ──
  // RED ON: input.dispatchEvent gated off in _cpInitScrubs (controlPanel.js) — 2026-10-02
  const gridWas = await dm.evaluate('gridEnabled');
  await click('cp-grid-eye');
  rig.check(await dm.evaluate('gridEnabled') === !gridWas &&
            await dm.evaluate('document.getElementById("cp-grid-body").classList.contains("dk-dim")') === gridWas,
            'E: the grid eye did not switch the grid and dim the section to match');
  if (await dm.evaluate('gridEnabled')) await click('cp-grid-eye');
  await dm.evaluate('document.querySelector("#cp-gridtype-row [data-gtype=hex-pointy]").click(); 0');
  rig.check(await dm.evaluate('gridMode === "hex-pointy" && gridEnabled'),
            'E: picking Hex did not set the type and switch the grid on');
  await dm.evaluate('document.querySelector("#cp-gridtype-row [data-gtype=square]").click(); 0');
  const scrub = await dm.evaluate(`(() => {
    const before = gridSize, pre = document.querySelector('[data-scrub="grid-size-num"]');
    const r = pre.getBoundingClientRect(), x = r.left + 4, y = r.top + 4;
    pre.dispatchEvent(new MouseEvent('mousedown', { clientX: x, clientY: y, button: 0, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: x + 40, clientY: y, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mouseup', { clientX: x + 40, clientY: y, bubbles: true }));
    return { before, after: gridSize, field: +document.getElementById('grid-size-num').value };
  })()`);
  rig.check(scrub.after === scrub.before + 20 && scrub.field === scrub.after,
            'E: scrubbing the cell size icon 40px did not add 20 to the cell: ' + JSON.stringify(scrub));
  await lib.fire(dm, 'grid-size-num', 9999, 'input');
  await lib.fire(dm, 'grid-size-num', 9999, 'change');
  rig.check(await dm.evaluate('gridSize') === 400 && await dm.evaluate('document.getElementById("grid-size-num").value') === '400',
            'E: a typed cell size over the maximum was not clamped to 400');

  // ── F ──
  // RED ON: proxy()'s forward gated off with `if (target && false)` (controlPanel.js) — 2026-09-19
  // ⚠ THE FORWARD IS WHAT IS UNDER TEST, not what the legacy button then does. Four of these open
  // a window, fullscreen a display or push to a Player that is not up, so the button's onclick
  // is swapped for a recorder and put back.
  const forwards = (fromId, toId) => dm.evaluate(`(() => {
    const target = document.getElementById(${JSON.stringify(toId)});
    const source = document.getElementById(${JSON.stringify(fromId)});
    if (!target || !source) return { err: 'missing #' + (!target ? ${JSON.stringify(toId)} : ${JSON.stringify(fromId)}) };
    const was = target.onclick;
    let hits = 0;
    target.onclick = () => { hits++; };
    source.click();
    target.onclick = was;
    return { hits };
  })()`);
  for (const [from, to, what] of [['cp-player-golive', 'btn-player', 'Open Window'],
                                  ['cp-player-fullscreen', 'btn-fullscreen-player', 'Fullscreen'],
                                  ['cp-player-syncview', 'btn-sync-view', 'Sync View'],
                                  ['cp-player-send', 'btn-send', 'Send']]) {
    const f = await forwards(from, to);
    rig.check(!f.err && f.hits === 1,
              'F: ' + what + ' does not reach the button it mirrors: ' + JSON.stringify(f));
  }
  const lockWas = await dm.evaluate('minimapLocked === true');
  await click('cp-player-lock');
  rig.check(await dm.evaluate('minimapLocked === true') !== lockWas &&
            await on('cp-player-lock') !== lockWas, 'F: Lock on the minimap did not lock it and say so');
  await click('cp-player-lock');
  rig.check(await dm.evaluate('minimapLocked === true') === lockWas, 'F: Lock would not let go again');
  // ⚠ TWO SEGMENTS OVER ONE TOGGLE: pressing the lit one must not flip it away.
  const seg = want => dm.evaluate('document.querySelector(\'#cp-pane-player [data-sync="' + want + '"]\').click(); 0');
  await seg('manual');
  await seg('manual');
  rig.check(await dm.evaluate('autoSync') === false, 'F: a second press on Manual flipped the gate back to Auto');
  await seg('auto');
  rig.check(await dm.evaluate('autoSync') === true, 'F: Auto would not switch the send gate back on');
  await dm.evaluate('document.querySelector(\'#cp-sec-seat [data-seat="90"]\').click(); 0');
  rig.check(await dm.evaluate('seatTurn') === 90 &&
            await dm.evaluate('document.querySelector("#cp-sec-seat [data-seat].active").dataset.seat') === '90',
            'F: My seat 90° did not turn the DM map and say so');
  await dm.evaluate('document.querySelector(\'#cp-sec-seat [data-seat="0"]\').click(); 0');

  // ── G ──
  // RED ON: a .dk-pop { border-radius: 4px } rule appended (dock.css) — 2026-10-02
  // ⚠ THE PROBE SITS INSIDE THE PANEL IT MEASURES: Chromium folds an ancestor `zoom` into every
  // computed length, so a probe on <body> would resolve the variables unscaled.
  const edgeOf = id => dm.evaluate(`(() => {
    const p = document.getElementById(${JSON.stringify(id)});
    if (!p) return { err: 'is not in the DOM' };
    const b = p.getBoundingClientRect();
    if (b.width === 0 || b.height === 0) return { err: 'measured zero, so it was still hidden' };
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;left:-9999px;top:0;width:4px;height:4px;' +
      'background:var(--panel-bg);border:var(--panel-border);' +
      'border-radius:var(--panel-radius);box-shadow:var(--panel-shadow)';
    p.appendChild(probe);
    // The shadow is left out: a centred window sits deeper than a pop-out (--win-shadow).
    const read = el => { const c = getComputedStyle(el); return [c.backgroundColor,
      c.borderTopWidth, c.borderTopColor, c.borderTopLeftRadius].join(' | '); };
    const pc = getComputedStyle(probe);
    const got = read(p), want = read(probe);
    const wantW = parseFloat(pc.borderTopWidth), wantR = parseFloat(pc.borderTopLeftRadius);
    probe.remove();
    return { got, want, wantW, wantR };
  })()`);
  const edges = {};
  let resolvedW = 0, resolvedR = 0;
  const measure = async (id, open, shut) => {
    await open();
    await lib.settle(dm, 'document.getElementById(' + JSON.stringify(id) + ') && ' +
      'document.getElementById(' + JSON.stringify(id) + ').getBoundingClientRect().width > 0', 8000);
    const e = await edgeOf(id);
    rig.check(!e.err, 'G: #' + id + ' ' + e.err + ', so its edge was never checked');
    if (!e.err) {
      rig.check(e.got === e.want, 'G: #' + id + ' writes its own shell instead of the --panel-* variables' +
                ' — it has [' + e.got + '] where base.css says [' + e.want + ']');
      edges[id] = e.got;
      resolvedW = e.wantW; resolvedR = e.wantR;
    }
    try { await shut(); } catch (err) { rig.note('#' + id + ' would not close again: ' + err.message); }
  };
  await measure('cp-pop-grid', () => click('cp-grid-field'), () => dm.evaluate('dockClosePop(); 0'));
  await measure('anim-advanced-panel', () => pickMove('advanced'), () => click('cp-adv-close'));
  await measure('mt-modal', () => dm.evaluate('openModuleTextModal(); 0'), () => dm.evaluate('closeModuleTextModal(); 0'));
  await measure('cd-modal', () => dm.evaluate('confirmDialog({ title: "Edge probe", message: "Measuring the shell." }); 0'),
                () => click('cd-cancel'));
  rig.check(resolvedW > 0 && resolvedR > 0,
            'G: base.css no longer resolves --panel-border and --panel-radius to a real edge (width ' +
            resolvedW + 'px, radius ' + resolvedR + 'px)');
  const distinct = [...new Set(Object.values(edges))];
  rig.check(distinct.length <= 1, 'G: the floating panels do not agree on one edge: ' +
            Object.keys(edges).map(k => '#' + k + ' [' + edges[k] + ']').join(', '));
};

'use strict';

// dock.js — THE DOCK ON THE RIGHT EDGE.
//
// THE GOAL OF THIS FEATURE: every control that is not on the map or the toolbar lives in one
// dock: an icon rail on the right edge and one pane beside it. It sits over the map and never
// narrows it, so what the TV is sent does not depend on whether a pane is open.
//
// THE CRITERIA ARE THIS HEADER. Each lettered line has its checks under a marker carrying its
// letter.
//
//   A. A first run comes up with Scene control open, and the previous release's evermist.cpPane
//      key is never written.
//   B. Each pane tab opens its pane alone and lights its tab alone. Its second click shuts the
//      pane and leaves the rail on screen.
//   C. The Room tab does nothing while no room is selected.
//   D. The window tabs open and shut the scene library, the Bestiary and the fight table, and
//      the rail shows which are open.
//   E. Dragging the dock's inner edge resizes the pane between a minimum and a maximum, and the
//      dock never covers the toolbar at this window size.
//   F. The dock sits over the map: opening or shutting a pane changes neither the map's canvas
//      nor the region sent to the Player.
//   G. The open pane and the width survive a restart, and so does a pane left shut. So does the
//      fog's Feather, set in Settings.
//   H. The Player window shows no dock and no rail.
//   I. The toolbar stays where it is while the pane opens, shuts or is dragged wider or narrower.
//   J. The Fog colour, Grid colour and Custom movement pop-outs close with the scene library
//      window's close button, and each button still closes its pop-out.
//
// ⚠ G RESTARTS THE APP, so it runs last but one: rig.restart() hands back a new DM session and
// the `dm` taken at the top is a dead socket after it.

const lib = require('../../lib');

module.exports = async function dockFeature(rig) {
  let dm = rig.dm;
  await lib.openMap(rig, { w: 1200, h: 800 });

  const pane = () => dm.evaluate('dockActivePane()');
  const lit = () => dm.evaluate('[...document.querySelectorAll("#dock-rail [data-dock-pane].active")]' +
                                '.map(b => b.dataset.dockPane).join(",")');
  const shownPanes = () => dm.evaluate('[...document.querySelectorAll("#dock .dk-sec")]' +
                                       '.filter(s => s.offsetParent !== null).map(s => s.dataset.pane).join(",")');
  // Bestiary and the fight table keep their old button ids on the rail.
  const TAB_ID = { bestiary: 'btn-bestiary', combat: 'btn-combat' };
  const tab = name => dm.evaluate('document.getElementById("' + (TAB_ID[name] || 'dock-tab-' + name) + '").click(); 0');
  const box = id => dm.evaluate('(() => { const b = document.getElementById(' + JSON.stringify(id) +
                                ').getBoundingClientRect(); return { left: b.left, right: b.right, width: b.width, height: b.height }; })()');

  // ── A ──
  // RED ON: the 'scene' default in initDock gated off with false && (dock.js) — 2026-10-02
  rig.check(await pane() === 'scene' && await shownPanes() === 'scene',
            'A: a first run did not come up with Scene control open: ' + await pane());
  rig.check(await dm.evaluate('localStorage.getItem("evermist.cpPane") === null'),
            'A: the dock wrote evermist.cpPane, which the previous release reads as its own tab');

  // ── B ──
  // RED ON: the rail's null branch gated off with false && in initDock (dock.js) — 2026-10-02
  for (const name of ['music', 'sounds', 'settings', 'scene']) {
    await tab(name);
    rig.check(await pane() === name && await shownPanes() === name && await lit() === name,
              'B: the ' + name + ' tab did not open its pane alone: open ' + await shownPanes() +
              ', lit ' + await lit());
  }
  await tab('scene');
  rig.check(await pane() === null && await shownPanes() === '' && await lit() === '',
            'B: a second click on the open tab did not shut the pane');
  const railShut = await box('dock-rail');
  rig.check(railShut.width > 0 && railShut.height > 0, 'B: shutting the pane took the rail with it');

  // ── C ──
  // RED ON: the rail's `off` guard gated off with false && (dock.js) — 2026-10-02
  await tab('room');
  rig.check(await pane() === null, 'C: the Room tab opened with no room selected');
  rig.check(await dm.evaluate('document.getElementById("dock-tab-room").classList.contains("off")'),
            'C: the Room tab does not look unavailable with no room selected');

  // ── D ──
  // RED ON: toggleDropdown() in _dockToggleWindow gated off with false && (dock.js) — 2026-10-02
  const winOpen = {
    library: 'smIsOpen()',
    bestiary: 'document.getElementById("bs-modal").style.display !== "none"',
    combat: 'document.getElementById("cb-fight").style.display === "block"',
  };
  for (const [name, isOpen] of Object.entries(winOpen)) {
    await tab(name);
    rig.check(await dm.evaluate(isOpen), 'D: the ' + name + ' tab did not open its window');
    rig.check(await dm.evaluate('(b => b.classList.contains("active") || b.classList.contains("win"))' +
                                '(document.getElementById("' + (TAB_ID[name] || 'dock-tab-' + name) + '"))'),
              'D: the rail does not show the ' + name + ' window as open');
    await tab(name);
    rig.check(!(await dm.evaluate(isOpen)), 'D: a second click on the ' + name + ' tab did not shut it');
  }

  const bar = () => dm.evaluate('Math.round(document.getElementById("toolbar-bottom").getBoundingClientRect().left)');
  const barShut = await bar();

  // ── E ──
  // RED ON: the _dockMaxW clamp gated off in the edge drag and in dockLayout (dock.js) — 2026-10-02
  await tab('scene');
  const dragEdge = dx => dm.evaluate(`(() => {
    const e = document.getElementById('dock-edge'), r = e.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + 200;
    e.dispatchEvent(new MouseEvent('mousedown', { clientX: x, clientY: y, button: 0, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: x + ${dx}, clientY: y, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mouseup', { clientX: x + ${dx}, clientY: y, bubbles: true }));
    return document.getElementById('dock-pane').offsetWidth;
  })()`);
  const w0 = await dm.evaluate('document.getElementById("dock-pane").offsetWidth');
  const wSmall = await dragEdge(300);
  rig.check(wSmall === w0 && w0 === 230, 'E: the pane shrank below its minimum: ' + w0 + ' → ' + wSmall);
  const wBig = await dragEdge(-2000);
  rig.note('pane width: minimum ' + w0 + ', dragged wide ' + wBig);
  rig.check(wBig >= w0 && wBig <= 420, 'E: the pane grew past its maximum: ' + wBig);
  const covers = await dm.evaluate('(() => { const d = document.getElementById("dock").getBoundingClientRect();' +
    ' return ["toolbar-bottom", "context-row"].map(id => document.getElementById(id).getBoundingClientRect())' +
    '.filter(b => b.width > 0).some(b => b.right > d.left); })()');
  rig.check(!covers, 'E: the dock covers the toolbar at this window size');
  rig.check(+(await dm.evaluate('localStorage.getItem("evermist.dockWidth")')) === Math.round(wBig),
            'E: the dragged width was not stored');

  // ── I ──
  // RED ON: the toolbar box measured against the whole dock instead of the rail (dock.js) — 2026-10-02
  const barWide = await bar();
  await dragEdge(2000);
  const barNarrow = await bar();
  await dragEdge(-2000);
  rig.check(barShut === barWide && barWide === barNarrow,
            'I: the toolbar moved with the pane: shut ' + barShut + ', wide ' + barWide + ', narrow ' + barNarrow);

  // ── F ──
  // RED ON: body:has(#dock.open) #canvas-container given margin-right: 300px (dock.css) — 2026-10-02
  const canvasOpen = await dm.evaluate('[container.clientWidth, container.clientHeight].join("x")');
  const regionOpen = await dm.evaluate('JSON.stringify(dmVisibleRegion())');
  await tab('scene');
  const canvasShut = await dm.evaluate('[container.clientWidth, container.clientHeight].join("x")');
  const regionShut = await dm.evaluate('JSON.stringify(dmVisibleRegion())');
  rig.check(canvasOpen === canvasShut && canvasOpen === await dm.evaluate('innerWidth + "x" + container.clientHeight'),
            'F: the dock narrows the map instead of sitting over it: ' + canvasOpen + ' vs ' + canvasShut);
  rig.check(regionOpen === regionShut,
            'F: the region sent to the Player changes with the pane: ' + regionOpen + ' vs ' + regionShut);

  // ── H ──
  // RED ON: the body.player-mode #dock selector renamed (dock.css) — 2026-10-02
  const player = await rig.player();
  rig.check(await player.evaluate('(() => { const d = document.getElementById("dock");' +
                                  ' return !d || d.getBoundingClientRect().width === 0; })()'),
            'H: the Player window shows the dock');

  // ── J ──
  // RED ON: the Fog pop-out button's class put back to cp-adv-close, its data-pop-close and the Custom movement click handler gated off (index.html, controlPanel.js) — 2026-10-03
  await tab('scene');
  const closeLook = id => dm.evaluate('(() => { const b = document.getElementById(' + JSON.stringify(id) + ');' +
    ' if (!b) return null; const s = getComputedStyle(b);' +
    ' return { svg: b.innerHTML.trim(), w: s.width, h: s.height }; })()');
  const POPS = [
    { name: 'Fog colour', open: 'document.querySelector("[data-dock-pop=cp-pop-fog]").click()',
      pop: 'cp-pop-fog', close: 'document.querySelector("#cp-pop-fog .cp-adv-head button")' },
    { name: 'Grid colour', open: 'document.querySelector("[data-dock-pop=cp-pop-grid]").click()',
      pop: 'cp-pop-grid', close: 'document.querySelector("#cp-pop-grid .cp-adv-head button")' },
    { name: 'Custom movement', open: 'document.getElementById("btn-anim-advanced").click()',
      pop: 'anim-advanced-panel', close: 'document.getElementById("cp-adv-close")' },
  ];
  const ref = await closeLook('sm-close');
  rig.check(!!ref && ref.w === '28px' && ref.h === '28px',
            'J: the scene library close button, the pattern to match, did not read 28px: ' + JSON.stringify(ref));
  for (const p of POPS) {
    await dm.evaluate(p.open + '; 0');
    await lib.settle(dm, 'document.getElementById("' + p.pop + '").hidden === false', 5000);
    const look = await dm.evaluate('(() => { const b = ' + p.close + '; if (!b) return null;' +
      ' const s = getComputedStyle(b); return { cls: b.className, svg: b.innerHTML.trim(), w: s.width, h: s.height }; })()');
    rig.check(!!look && /\bsm-x\b/.test(look.cls) && !!ref && look.svg === ref.svg &&
              Math.abs(parseFloat(look.w) - parseFloat(ref.w)) < 0.1 &&
              Math.abs(parseFloat(look.h) - parseFloat(ref.h)) < 0.1,
              'J: the ' + p.name + ' pop-out close button is not the scene library window\'s: ' +
              JSON.stringify(look) + ' against ' + JSON.stringify(ref));
    await dm.evaluate(p.close + '.click(); 0');
    await lib.settle(dm, 'document.getElementById("' + p.pop + '").hidden === true', 5000);
    rig.check(await dm.evaluate('document.getElementById("' + p.pop + '").hidden'),
              'J: the ' + p.name + ' close button did not close its pop-out');
  }

  // ── G ──
  // RED ON: localStorage.setItem(DOCK_PANE_KEY) gated off (dock.js), and separately saveFeather's write (fogControls.js) — 2026-10-02
  await tab('music');
  await lib.fire(dm, 'fog-feather-num', 7, 'change');
  dm = await rig.restart();
  await lib.installHelpers(dm);
  await lib.settle(dm, 'typeof dockActivePane === "function"', 30000);
  rig.check(await dm.evaluate('dockActivePane()') === 'music',
            'G: a restart did not reopen the pane it was left on');
  rig.check(await dm.evaluate('document.getElementById("dock-pane").offsetWidth') === Math.round(wBig),
            'G: a restart did not keep the dragged width');
  rig.check(await dm.evaluate('fogFeatherRadius') === 7 &&
            await dm.evaluate('document.getElementById("fog-feather-num").value') === '7',
            'G: a restart did not keep the Feather the DM set: ' + await dm.evaluate('fogFeatherRadius'));
  await dm.evaluate('document.getElementById("dock-tab-music").click(); 0');
  dm = await rig.restart();
  await lib.settle(dm, 'typeof dockActivePane === "function"', 30000);
  rig.check(await dm.evaluate('dockActivePane()') === null,
            'G: a restart reopened the pane the DM had shut');
};

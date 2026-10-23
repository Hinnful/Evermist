'use strict';

// show-on-tv.js — SHOW ON TV: ONE BUTTON ON THE MINIMAP PUTS THE MAP ON THE TV.
//
// THE GOAL OF THIS FEATURE: a new DM presses one button on the minimap and the map is on the TV.
// The minimap reads as "what the TV shows": the TV's shape, its edges dotted, a blue edge while
// the map is on the TV. Under --offscreen no window is moved, fullscreened or switched, so Show
// on TV takes the window route here.
//
// THE CRITERIA ARE THIS HEADER. Each lettered line has its checks under a marker carrying its letter.
//
//   A. Scene control has no Player section, and its header has no "On the TV" dot.
//   B. The minimap stays in the bottom-left corner when the notes open, and on a window too
//      narrow for it to stay clear of the toolbar it shrinks instead of covering it.
//   C. The minimap takes the TV's shape (16:9 with no TV known), keeps its dotted frame in the
//      middle, and My seat turns the box and its picture while the buttons stay upright.
//   D. Before the map is on the TV the minimap shows the Show on TV button (grey while no TV is found,
//      see tv-rescan.js), the caption with its arrow, and a dimmed picture with a faint blue edge.
//   E. Lock is top-left; Sync (live only) and ··· are top-right; faint until hovered; a
//      Lock that is on stays fully visible, in the quiet tint and not solid blue.
//   F. With several other screens and none remembered, Show on TV asks which; the answer is
//      remembered, and next time it goes straight there. A screen with no name is "Screen N",
//      a TV's name is only ever text, and a long name is cut with its whole name in the tooltip.
//   G. With no other screen, the help box opens. Its switch button does nothing under the rig.
//   H. Live: a breathing blue edge and a pill that reads "Live in a window"; Stop closes the Player.
//   I. In Manual a Send part joins the pill, with a dot while changes wait; Send clears it.
//   J. On the window route a Fullscreen part joins the pill, its tooltip names the F11 key.
//   K. No label is cut at any seat, with every part on the pill, and Sync never touches Lock.
//   L. With two maps the minimap holds both pictures in one TV shape, a press on a half selects
//      its column, and there is one pill with one Stop.
//
// Unchecked here, because the rig has one display and never fullscreens: the map on a real second
// screen, the help box's switch, "Live on TV", fullscreen itself, and an unplugged TV.

const lib = require('../../lib');

const q = sel => 'document.querySelector(' + JSON.stringify(sel) + ')';

module.exports = async function showOnTv(rig) {
  const dm = rig.dm;
  await lib.openMap(rig, { w: 900, h: 600 });
  await lib.settle(dm, '!minimapDirty', 10000);
  const ratio = () => dm.evaluate('(() => { const p = document.getElementById("minimap-panel"); return p.offsetWidth / p.offsetHeight; })()');
  const refresh = async () => { await dm.evaluate('_tvKey = ""; refreshPlayerControlUI(); 0'); };
  // ⚠ THE MACHINE'S OWN SCREENS NEVER DECIDE A CHECK: a desk with two monitors would hand Show on TV
  // a TV of its own. The list main reports is replaced by the laptop alone, and F and G set their own.
  const LAPTOP = '{ id: 1, label: "Laptop", internal: true, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, size: { width: 1920, height: 1080 } }';
  await dm.evaluate(`(() => {
    globalThis.__loadReal = _tvLoadDisplays;
    _tvLoadDisplays = async () => {};
    _tvDmId = 1; _tvDisplays = [${LAPTOP}];
    _tvKey = ''; tvRefresh(); return 0;
  })()`);

  // ── A ──
  // RED ON: a #cp-pane-player div put back in index.html - 2026-10-13
  rig.check(await dm.evaluate('!document.getElementById("cp-pane-player") && !document.getElementById("dock-live")'),
            'A: Scene control still has its Player section or the "On the TV" dot');

  // ── B ──
  // RED ON: the shrink gated off with `if (false)` in minimapLayout (minimap.js) - 2026-10-13
  const place = await dm.evaluate(`(() => {
    const m = document.getElementById('minimap-panel').getBoundingClientRect();
    const t = document.getElementById('toolbar-bottom').getBoundingClientRect();
    const p = document.getElementById('minimap-panel');
    return { left: m.left, right: m.right, bottom: m.bottom, tLeft: t.left, h: innerHeight,
             long: Math.max(p.offsetWidth, p.offsetHeight) };
  })()`);
  rig.check(place.left < 40 && place.bottom > place.h - 40,
            'B: the minimap is not in the bottom-left corner: ' + JSON.stringify(place));
  rig.check(place.right <= place.tLeft + 1 || place.long <= 161,
            'B: the minimap covers the toolbar while it could have shrunk: ' + JSON.stringify(place));
  rig.check(place.long >= 160, 'B: the minimap shrank below 160px on its long side: ' + JSON.stringify(place));
  if (await dm.evaluate('dockActivePane()') !== 'notes') await dm.evaluate('document.getElementById("dock-tab-notes").click(); 0');
  await lib.settle(dm, 'dockActivePane() === "notes"', 6000);
  const withNotes = await dm.evaluate('document.getElementById("minimap-panel").getBoundingClientRect().left');
  rig.check(Math.abs(withNotes - place.left) < 1, 'B: opening the notes moved the minimap: ' + place.left + ' → ' + withNotes);

  // ── C ──
  // RED ON: a margin returned to _mmRegion, applySeatTurn's minimapLayout call removed (mapTurn.js), and a remembered TV's match returned null (tvPick.js) - 2026-10-13
  const wide = await ratio();
  rig.check(Math.abs(wide - 16 / 9) < 0.04, 'C: with no TV known the minimap is not 16:9: ' + wide);
  await lib.settle(dm, '!minimapDirty', 10000);
  const frame = await dm.evaluate(`(() => {
    const h = _mmGeom().halves[0], r = _mmRegion(h);
    return { w: r.w * h.view.zoom / h.tv.w, h: r.h * h.view.zoom / h.tv.h, hasFrame: typeof MINIMAP_FRAME !== 'undefined' };
  })()`);
  rig.check(Math.abs(frame.w - 1) < 1e-6 && Math.abs(frame.h - 1) < 1e-6 && !frame.hasFrame,
            "C: the minimap shows more map than the TV does, or still has a frame: " + JSON.stringify(frame));
  await dm.evaluate('setSeatTurn(90); 0');
  await lib.settle(dm, 'document.getElementById("minimap-panel").offsetWidth < document.getElementById("minimap-panel").offsetHeight', 6000);
  const turned = await dm.evaluate(`(() => {
    const m = getComputedStyle(document.getElementById('minimap-canvas')).transform;
    const upright = ['#tv-ui .tv-ov', '#tv-ui', '#tv-clip', '#minimap-panel']
      .every(s => getComputedStyle(document.querySelector(s)).transform === 'none');
    return { m, upright, ratio: document.getElementById('minimap-panel').offsetWidth / document.getElementById('minimap-panel').offsetHeight };
  })()`);
  rig.check(Math.abs(turned.ratio - 9 / 16) < 0.04 && /matrix\(0, 1, -1, 0/.test(turned.m),
            'C: at seat 90 the box did not swap its sides and turn the picture: ' + JSON.stringify(turned));
  rig.check(turned.upright, 'C: the buttons over the minimap turned with the picture: ' + JSON.stringify(turned));
  await dm.evaluate('setSeatTurn(0); 0');
  await lib.settle(dm, 'document.getElementById("minimap-panel").offsetWidth > document.getElementById("minimap-panel").offsetHeight', 6000);

  // ── D ──
  // RED ON: the off filter set to none (playerPane.css) - 2026-10-13
  const off = await dm.evaluate(`(() => ({
    cls: document.getElementById('minimap-panel').className,
    go: ${q('#tv-ui .tv-go')} && ${q('#tv-ui .tv-go')}.textContent,
    goBg: ${q('#tv-ui .tv-go')} && getComputedStyle(${q('#tv-ui .tv-go')}).backgroundColor,
    car: !!${q('#tv-ui .tv-sub .car')},
    caption: ${q('#tv-ui .tv-sub .nm')} && ${q('#tv-ui .tv-sub .nm')}.textContent,
    filter: getComputedStyle(document.getElementById('minimap-canvas')).filter,
    edge: getComputedStyle(document.getElementById('minimap-panel')).boxShadow,
    screens: _tvDisplays.length,
  }))()`);
  rig.check(off.cls.includes('tv-off') && off.go === 'Show on TV' && off.goBg !== 'rgb(12, 140, 233)' && off.car,
            'D: the off state has no Show on TV button with its arrow, or it is solid blue with no TV found: ' + JSON.stringify(off));
  rig.check(off.screens > 1 || off.caption === 'No TV found', 'D: with one screen the caption does not say "No TV found": ' + off.caption);
  rig.check(/brightness\(0\.8\)/.test(off.filter) && off.edge.includes('rgba(12, 140, 233'),
            'D: the off picture is not dimmed, or has no faint blue edge: ' + JSON.stringify(off));
  rig.byEye('the off minimap: the button, the caption and the glow read as one calm control');

  // ── E ──
  // RED ON: the tools' opacity set to 1 (playerPane.css) - 2026-10-13
  const tools = await dm.evaluate(`(() => {
    const p = document.getElementById('minimap-panel').getBoundingClientRect();
    const r = e => e.getBoundingClientRect();
    const lock = ${q('#tv-ui .tv-row.tl .tv-ov')}, menu = ${q('#tv-ui .tv-row.tr .tv-ov:last-child')};
    return { lockLeft: r(lock).left - p.left, lockTop: r(lock).top - p.top,
             menuRight: p.right - r(menu).right, menuTop: r(menu).top - p.top,
             sync: document.querySelectorAll('#tv-ui .tv-row.tr .tv-ov').length, faint: +getComputedStyle(lock).opacity };
  })()`);
  rig.check(tools.lockLeft < 20 && tools.lockTop < 20 && tools.menuRight < 20 && tools.menuTop < 20,
            'E: Lock is not top-left, or the menu is not top-right: ' + JSON.stringify(tools));
  // The top-right row holds ··· alone at rest; Sync joins it only while live. No players' view button.
  rig.check(tools.sync === 1, 'E: Sync is on the minimap while the map is not on the TV: ' + JSON.stringify(tools));
  rig.check(tools.faint < 0.6, 'E: the tools are not faint at rest: ' + JSON.stringify(tools));
  await dm.evaluate(q('#tv-ui .tv-row.tl .tv-ov') + '.click(); 0');
  const locked = await dm.evaluate(`(() => {
    const l = ${q('#tv-ui .tv-row.tl .tv-ov')}, c = getComputedStyle(l);
    return { on: l.classList.contains('active'), opacity: +c.opacity, bg: c.backgroundColor, color: c.color, locked: minimapLocked };
  })()`);
  rig.check(locked.locked && locked.on && locked.opacity === 1 && locked.bg !== 'rgb(12, 140, 233)' && locked.color === 'rgb(92, 177, 255)',
            'E: a Lock that is on is faint, or solid blue, or does not lock: ' + JSON.stringify(locked));
  await dm.evaluate(q('#tv-ui .tv-row.tl .tv-ov') + '.click(); 0');

  // ── F ──
  // RED ON: _rememberedMatch returning null (tvPick.js), and _tvName writing innerHTML (tvControl.js) - 2026-10-13
  const LONG = '<b>Samsung QN90C Neo QLED 4K Smart TV (HDMI 2)</b>';
  await dm.evaluate(`(() => {
    localStorage.removeItem(TV_SCREEN_KEY);
    _tvDisplays = [
      ${LAPTOP},
      { id: 2, label: '', internal: false, bounds: { x: 1920, y: 0, width: 3840, height: 2160 }, size: { width: 3840, height: 2160 } },
      { id: 3, label: ${JSON.stringify(LONG)}, internal: false, bounds: { x: 5760, y: 0, width: 1024, height: 768 }, size: { width: 1024, height: 768 } },
    ];
    _tvKey = ''; tvRefresh(); return 0;
  })()`);
  rig.check(await dm.evaluate(q('#tv-ui .tv-sub .nm') + '.textContent') === 'Pick a screen',
            'F: with several screens and none remembered the caption does not say "Pick a screen"');
  await dm.evaluate(q('#tv-ui .tv-go') + '.click(); 0');
  await lib.settle(dm, '_tvMenu === "ask"', 6000);
  const ask = await dm.evaluate(`(() => {
    const rows = [...document.querySelectorAll('#tv-pop .tv-row2')];
    return { title: ${q('#tv-pop .q')} && ${q('#tv-pop .q')}.textContent,
             rows: rows.map(r => ({ name: r.querySelector('.nm') && r.querySelector('.nm').textContent,
               res: r.querySelector('.mt') && r.querySelector('.mt').textContent, tip: r.title,
               markup: !!r.querySelector('b') })) };
  })()`);
  rig.check(ask.title === 'Which screen is the TV?', 'F: Show on TV did not ask which screen is the TV: ' + JSON.stringify(ask));
  rig.check(ask.rows[0].name === 'Screen 2' && ask.rows[0].res === '3840×2160',
            'F: a screen with no name is not "Screen 2" with its resolution: ' + JSON.stringify(ask.rows[0]));
  rig.check(ask.rows[1].name === LONG && !ask.rows[1].markup && ask.rows[1].tip === LONG,
            "F: a TV's name was read as markup, or its tooltip lost the whole name: " + JSON.stringify(ask.rows[1]));
  await dm.evaluate('document.querySelectorAll("#tv-pop .tv-row2")[1].click(); 0');
  await lib.settle(dm, '_tvLive()', 8000);
  const kept = await dm.evaluate('JSON.parse(localStorage.getItem(TV_SCREEN_KEY))');
  rig.check(kept && kept.label === LONG && kept.width === 1024, 'F: the answer was not remembered: ' + JSON.stringify(kept));
  // ⚠ UNDER --offscreen THE PLAYER IS NEVER PLACED: the route falls back to a window.
  await lib.settle(dm, '_tvRoute === "window"', 8000);
  rig.check(await dm.evaluate('_tvRoute') === 'window',
            'F: under the rig Show on TV placed the Player instead of taking the window route');
  await dm.evaluate(q('#tv-ui .tv-grp .lv') + '.click(); 0');
  await lib.settle(dm, '!_tvLive()', 8000);
  await refresh();
  const shape = await dm.evaluate(`(() => ({ ratio: document.getElementById('minimap-panel').offsetWidth / document.getElementById('minimap-panel').offsetHeight,
    caption: ${q('#tv-ui .tv-sub .nm')}.textContent, tip: ${q('#tv-ui .tv-sub')}.title }))()`);
  rig.check(shape.caption === LONG && shape.tip === LONG, 'F: the remembered TV is not the caption, or its tooltip lost the name: ' + JSON.stringify(shape));
  rig.check(Math.abs(shape.ratio - 4 / 3) < 0.05, "C: the box did not take the chosen TV's 4:3 shape: " + JSON.stringify(shape));
  await dm.evaluate(q('#tv-ui .tv-go') + '.click(); 0');
  await lib.settle(dm, '_tvLive()', 8000);
  rig.check(await dm.evaluate('_tvMenu') === null, 'F: the remembered screen was asked about again');
  await dm.evaluate(q('#tv-ui .tv-grp .lv') + '.click(); 0');
  await lib.settle(dm, '!_tvLive()', 8000);
  await dm.evaluate('_tvDisplays = [' + LAPTOP + ']; localStorage.removeItem(TV_SCREEN_KEY); _tvKey = ""; tvRefresh(); 0');

  // ── G ──
  // RED ON: the help title reworded (tvControl.js) - 2026-10-13
  {
    await dm.evaluate(q('#tv-ui .tv-go') + '.click(); 0');
    await lib.settle(dm, '_tvMenu === "help"', 6000);
    const help = await dm.evaluate(`(() => ({
      title: ${q('#tv-pop .tv-help .t')}.textContent,
      body: ${q('#tv-pop .tv-help-body')}.textContent,
      buttons: [...document.querySelectorAll('#tv-pop button')].map(b => b.textContent),
      os: _tvOs() }))()`);
    rig.check(help.title === 'Evermist sees only this screen' && help.body.startsWith('If the TV is plugged in, it is copying this screen.'),
              'G: the help box does not explain the one screen: ' + JSON.stringify(help));
    const switchLabel = help.os === 'win' ? 'Use the TV as a second screen' : help.os === 'mac' ? 'Open Display settings' : null;
    rig.check(help.buttons.includes('Not now') && help.buttons.includes('Open in a window instead') &&
              (!switchLabel || help.buttons.includes(switchLabel)),
              'G: the help box lacks a button the spec names: ' + JSON.stringify(help));
    if (switchLabel) {
      await dm.evaluate('[...document.querySelectorAll("#tv-pop button")].find(b => b.textContent === ' + JSON.stringify(switchLabel) + ').click(); 0');
      await lib.hold(500, 'the switch is skipped under --offscreen, so there is no state to poll for');
      rig.check(await dm.evaluate('_tvWaitSince === 0 && _tvMenu === "help" && !_tvLive()'),
                'G: under the rig the help box switch did something besides log');
    }
    await dm.evaluate('[...document.querySelectorAll("#tv-pop button")].find(b => b.textContent === "Not now").click(); 0');
  }

  // ── H ──
  // RED ON: the tvBreathe animation removed (dock.css) - 2026-10-13
  await rig.player();
  await refresh();
  await lib.settle(dm, '!!document.querySelector("#tv-ui .tv-grp .lv")', 8000);
  const live = await dm.evaluate(`(() => {
    const lv = ${q('#tv-ui .tv-grp .lv')}, st = lv.querySelector('.st'), ac = lv.querySelector('.ac');
    const p = document.getElementById('minimap-panel');
    return { cls: p.className, label: st.textContent, stop: ac.textContent, acHidden: getComputedStyle(ac).visibility,
             wide: lv.offsetWidth >= ac.offsetWidth && lv.offsetWidth >= st.offsetWidth,
             anim: getComputedStyle(p).animationName, sync: document.querySelectorAll('#tv-ui .tv-row.tr .tv-ov').length };
  })()`);
  rig.check(live.cls.includes('tv-live') && live.label === 'Live in a window' && live.anim === 'tvBreathe',
            'H: the live minimap has no breathing edge or says the wrong thing: ' + JSON.stringify(live));
  rig.check(live.stop === 'Stop showing' && live.acHidden === 'hidden' && live.wide,
            'H: the pill does not hold both of its words in one width: ' + JSON.stringify(live));
  rig.check(live.sync === 2, 'H: Sync is not on the minimap while live: ' + JSON.stringify(live));

  // ── I ──
  // RED ON: playerUnsent never set in scheduleAutoSync (playerWindow.js) - 2026-10-13
  await dm.evaluate('if (autoSync) document.getElementById("btn-auto-sync").click(); 0');
  await refresh();
  const sendPart = () => dm.evaluate(`(() => { const s = [...document.querySelectorAll('#tv-ui .tv-grp .sd')].find(b => /Send/.test(b.title));
    return s ? { word: s.textContent, dot: !!s.querySelector('.unsent') } : null; })()`);
  const manual = await sendPart();
  // ⚠ THE WORD IS DROPPED WHEN THE PILL DOES NOT FIT, which a 1008px window makes it; the tooltip keeps it.
  rig.check(manual && /^(Send)?$/.test(manual.word) && !manual.dot, 'I: Manual has no Send part, or it shows a dot with nothing waiting: ' + JSON.stringify(manual));
  await dm.evaluate('scheduleAutoSync(); 0');
  await lib.poll(async () => { await refresh(); const s = await sendPart(); return s && s.dot ? s : null; }, 6000);
  rig.check((await sendPart()).dot, 'I: a change in Manual left no dot on Send');
  await dm.evaluate(q('#tv-ui .tv-grp .sd:last-child') + '.click(); 0');
  const cleared = await lib.poll(async () => { await refresh(); const s = await sendPart(); return s && !s.dot ? s : null; }, 6000);
  rig.check(!!cleared && await dm.evaluate('playerUnsent === false'), 'I: Send did not clear the dot');

  // ── J ──
  // RED ON: F11 dropped from the Fullscreen tooltip (tvControl.js) - 2026-10-13
  const fs = await dm.evaluate(`(() => { const s = [...document.querySelectorAll('#tv-ui .tv-grp .sd')].find(b => /Fullscreen|Windowed/.test(b.title));
    return s ? { word: s.textContent, title: s.title } : null; })()`);
  rig.check(fs && /^(Fullscreen)?$/.test(fs.word) && /^Fullscreen/.test(fs.title) && /F11/.test(fs.title),
            'J: the window route has no Fullscreen part naming F11: ' + JSON.stringify(fs));
  rig.byEye('Fullscreen on the real TV, through the pill, F11, a double-click and Esc');

  // ── K ──
  // RED ON: _tvTooWide forced false (tvControl.js) - 2026-10-13
  const cut = () => dm.evaluate(`(() => {
    const grp = document.querySelector('#tv-ui .tv-grp'), p = document.getElementById('minimap-panel');
    const bad = [...document.querySelectorAll('#tv-ui .tv-grp, #tv-ui .tv-grp *')].filter(e => e.scrollWidth > e.clientWidth + 1)
      .map(e => e.className + ':' + e.textContent + ':' + e.scrollWidth + '/' + e.clientWidth + ':' +
        [...e.children].map(k => k.className + '=' + k.offsetWidth).join(','));
    return { bad, fits: grp.scrollWidth <= p.offsetWidth, fit: _tvFit };
  })()`);
  // RED BY DESIGN: the Sync and Stop steps are written against item 217, never re-proved
  const crowd = () => dm.evaluate(`(() => {
    const l = ${q('#tv-ui .tv-row.tl')}.getBoundingClientRect(), r = ${q('#tv-ui .tv-row.tr')}.getBoundingClientRect();
    return { gap: r.left - l.right, syncWord: !!${q('#tv-ui .tv-ov.wd')}, stopWord: /Stop/.test(${q('#tv-ui .tv-grp .lv .ac')}.textContent) };
  })()`);
  for (const seat of [0, 90, 180, 270]) {
    await dm.evaluate('setSeatTurn(' + seat + '); 0');
    await lib.settle(dm, '(document.getElementById("minimap-panel").offsetWidth < document.getElementById("minimap-panel").offsetHeight) === ' + (seat % 180 === 90), 6000);
    await refresh();
    const c = await cut();
    rig.check(c.bad.length === 0 && c.fits, 'K: at seat ' + seat + ' a label on the pill is cut: ' + JSON.stringify(c));
    const g = await crowd();
    rig.check(g.gap >= 4 - 1e-6, 'K: at seat ' + seat + ' Sync runs into Lock: ' + JSON.stringify(g));
  }
  await dm.evaluate('setSeatTurn(0); 0');
  await lib.settle(dm, 'seatTurn === 0', 6000);
  await dm.evaluate('if (!autoSync) document.getElementById("btn-auto-sync").click(); 0');

  // ── L ──
  // RED ON: _halfAt always answering the first half (minimap.js) - 2026-10-13
  const firstId = await dm.evaluate('currentScene.id');
  const map2 = await rig.fixtures.tableMap(dm, rig.fixtureDir, { w: 1200, h: 1500 });
  const expr2 = await rig.fixtures.asFileExpr(dm, map2);
  await dm.evaluate('createNewScene(' + expr2 + ')', 180000);
  await dm.waitFor('currentScene && mapWidth === 1200', 180000, 'the second map to load');
  await dm.waitFor('fogCoverT === 0', 30000, 'the scene cover to lift');
  await dm.evaluate('document.getElementById("btn-two-maps").click(); 0');
  await dm.waitFor('panesActive && panes.A.ready && panes.B.ready', 180000, 'both columns to come up');
  await dm.evaluate('worldMapColumnFill(' + JSON.stringify(firstId) + '); 0');
  await dm.waitFor('panes.A.mapW > 0 && panes.B.mapW > 0', 90000, 'both columns to report their maps');
  await lib.settle(dm, '!minimapDirty', 10000);
  const two = await dm.evaluate(`(() => { const g = _mmGeom(); return { n: g.halves.length, cw: g.cw,
    a: g.halves[0].dst, b: g.halves[1].dst }; })()`);
  rig.check(two.n === 2 && two.b.x >= two.a.w && two.b.x + two.b.w <= two.cw && two.a.w > 0 && two.b.w > 0,
            'L: the minimap does not hold both maps side by side in one box: ' + JSON.stringify(two));
  const press = async half => {
    await dm.evaluate(`(() => {
      const c = document.getElementById('minimap-canvas'), r = c.getBoundingClientRect(), g = _mmGeom();
      const d = g.halves[${half}].dst;
      const x = r.left + (d.x + d.w / 2) / g.cw * r.width, y = r.top + r.height / 2;
      const orig = c.setPointerCapture; c.setPointerCapture = () => {};
      const ev = (t, px) => c.dispatchEvent(new PointerEvent(t, { pointerId: 9, clientX: px, clientY: y, bubbles: true, cancelable: true }));
      ev('pointerdown', x); ev('pointermove', x + 12); ev('pointerup', x + 12);
      c.setPointerCapture = orig; return 0;
    })()`);
  };
  await dm.evaluate('selectPane("A"); 0');
  await press(1);
  rig.check(await dm.evaluate('panesSelected') === 'B', 'L: a press on the right half did not select its column');
  await press(0);
  rig.check(await dm.evaluate('panesSelected') === 'A', 'L: a press on the left half did not select its column');
  // Entering two maps hands the open Player window to the shell, so it may already be up.
  await dm.evaluate('if (!stageIsOpen()) document.getElementById("btn-player").click(); 0');
  await lib.settle(dm, 'stageIsOpen()', 30000);
  await refresh();
  rig.note('two maps: stage open ' + await dm.evaluate('stageIsOpen()') + ', live ' + await dm.evaluate('_tvLive()') +
           ', ui "' + await dm.evaluate('document.getElementById("tv-ui").innerText.replace(/\\n/g, " | ")') + '"');
  const pills = await dm.evaluate('({ pills: document.querySelectorAll("#tv-ui .tv-grp").length, stops: document.querySelectorAll("#tv-ui .tv-grp .lv").length })');
  rig.check(pills.pills === 1 && pills.stops === 1, 'L: two maps show more than one pill: ' + JSON.stringify(pills));
  await dm.evaluate(q('#tv-ui .tv-grp .lv') + '.click(); 0');
  await lib.settle(dm, '!stageIsOpen()', 15000);
  rig.check(await dm.evaluate('!stageIsOpen()'), 'L: Stop did not close the Player window');

  rig.byEye('the live pill on the real TV reads "Live on TV", and an unplugged TV takes the map off with the note');
};

'use strict';

// control-panel.js — THE FOG / GRID / PLAYER TAB BAR FLOATS OUTSIDE THE PANEL.
//
// THE GOAL OF THIS FEATURE: the panel covered about 288 screen px of map on the right edge.
// Zoomed in, the players saw a strip the DM could not, and what the DM centred landed off-centre
// on the TV. The tab bar now sits in the top-right corner on its own and never hides. The panel
// opens under it on the picked tab and shuts on that same tab, so the map keeps every pixel the
// panel is not using — WITHOUT changing one pixel of what the Player is sent.
//
// THE CRITERIA ARE THIS HEADER. Each lettered line has its checks directly beneath it, in order.
//
//   A. The tab bar is outside the panel, so shutting the panel cannot take it down. The tabs are
//      words, not icons. A first run comes up on Fog.
//   B. Picking a tab opens the panel under the bar, on that pane, and lights that tab alone. The
//      bar is one box, no narrower than the panel, and flush with its right edge.
//   C. Picking a different tab switches pane and leaves the panel open.
//   D. Picking the lit tab again shuts the panel. The bar stays up, in the same place on screen,
//      and is a fraction of the panel's height. ⚠ MEASURE THE HEIGHT here: the bar matches the
//      panel's width by design, so a width check cannot tell the two states apart.
//   E. Shutting closes the advanced fog panel. That panel is placed by measuring the panel's
//      box, so leaving it open would strand it over the map with nothing anchoring it.
//   F. ⚠ THE REGION SENT TO THE PLAYER IS IDENTICAL OPEN OR SHUT. Subtracting the panel width
//      from it was built and reverted: it crops the TV to the DM's readable area, so content
//      stops reaching the players. This check exists to catch that creeping back in.
//   G. The open pane survives a reload, and so does a panel left shut.
//   H. Every panel that floats over the map wears the SAME edge, because all of them read the
//      four --panel-* variables in base.css. Two panels side by side with edges that disagree
//      is the fault this catches. It also checks the variables still resolve to a real edge,
//      which is the one way all four panels can drift together without disagreeing.
//
// ⚠ G RE-RUNS THE BOOT PATH, IT DOES NOT NAVIGATE. A real reload would tear down the loaded scene
// and the CDP session for no extra coverage: what has to hold is that _cpRestoreTab() reads
// evermist.cpPane and applies it, which is exactly what initControlPanel calls at boot.
//
// ⚠ THE MAP IS ANIMATED, like every acceptance file's. It is here so the region in F is a real
// one measured against real map bounds rather than the empty-map fallback.

const MAP_W = 900, MAP_H = 600;

module.exports = async function controlPanelFeature(rig) {
  const dm = rig.dm;

  const map = await rig.fixtures.tableMap(dm, rig.fixtureDir, { w: MAP_W, h: MAP_H });
  const expr = await rig.fixtures.asFileExpr(dm, map);
  await dm.evaluate('createNewScene(' + expr + ')', 120000);
  await dm.waitFor('currentScene && mapWidth > 0', 120000, 'the map to load');

  const shown = id => dm.evaluate('(() => { const e = document.getElementById(' +
    JSON.stringify(id) + '); return !!e && !e.hidden && e.offsetParent !== null; })()');
  const boxOf = id => dm.evaluate('(() => { const e = document.getElementById(' +
    JSON.stringify(id) + '); if (!e) return null; const b = e.getBoundingClientRect(); ' +
    'return { left: Math.round(b.left), top: Math.round(b.top), right: Math.round(b.right), ' +
    'width: Math.round(b.width), height: Math.round(b.height) }; })()');
  const lit = () => dm.evaluate(
    '[...document.querySelectorAll(".cp-tab.active")].map(b => b.dataset.tab).join(",")');
  const words = () => dm.evaluate(
    '[...document.querySelectorAll(".cp-tab")].map(b => b.textContent.trim()).join(",")');
  const pick = tab => dm.evaluate(
    'document.querySelector(".cp-tab[data-tab=\'' + tab + '\']").click(); 0');

  // ── A ──
  rig.check(await dm.evaluate('document.querySelectorAll("#sidebar-right .cp-tab").length === 0'),
            'the tab bar sits inside the panel, so shutting the panel takes the tabs with it');
  rig.check(await shown('cp-tabbar'), 'the tab bar is not on screen');
  rig.check(await words() === 'Fog,Grid,Player',
            'the tabs read "' + await words() + '" — they carry words, not icons');
  rig.check(await shown('sidebar-right') && await lit() === 'fog',
            'a first run does not come up with the panel open on Fog');

  // ── B ── from shut, since a first run comes up open.
  await pick('fog');
  await pick('fog');
  rig.check(await shown('sidebar-right'), 'the Fog tab did not open the panel');
  rig.check(await shown('cp-pane-fog'), 'the Fog tab opened the panel on the wrong pane');
  rig.check(await lit() === 'fog', 'the lit tabs read "' + await lit() + '", not "fog" alone');
  const panelBox = await boxOf('sidebar-right');
  const barOpen = await boxOf('cp-tabbar');
  rig.check(barOpen.top < panelBox.top,
            'the panel does not open under the tab bar (' + barOpen.top + ' vs ' + panelBox.top + ')');
  // ⚠ WITHIN A PIXEL, not equal. Two separately zoomed boxes round independently, so an exact
  // compare fails on a rounding step rather than on the layout this is here to catch.
  rig.check(Math.abs(barOpen.right - panelBox.right) <= 1,
            'the tab bar and the panel do not share a right edge (' + barOpen.right +
            ' vs ' + panelBox.right + ')');
  rig.check(barOpen.width >= panelBox.width,
            'the tab bar is narrower than the panel under it (' + barOpen.width +
            ' vs ' + panelBox.width + ')');
  rig.check(await dm.evaluate('document.querySelectorAll("#cp-tabbar .cp-tabs").length === 0'),
            'the tab bar has a second box inside it — one rounded box inside another reads as a mistake');

  // ── C ──
  await pick('grid');
  rig.check(await shown('sidebar-right'), 'switching to Grid shut the panel instead of swapping the pane');
  rig.check(await shown('cp-pane-grid') && !(await shown('cp-pane-fog')),
            'the Grid tab left the wrong pane on screen');
  rig.check(await lit() === 'grid', 'the lit tabs read "' + await lit() + '", not "grid" alone');

  // ── D ──
  await pick('grid');
  rig.check(!(await shown('sidebar-right')), 'picking the lit tab again did not shut the panel');
  rig.check(await shown('cp-tabbar'), 'shutting the panel took the tab bar down with it');
  rig.check(await lit() === '', 'a tab is still lit with the panel shut');
  const barShut = await boxOf('cp-tabbar');
  rig.note('panel ' + panelBox.height + 'px tall, tab bar ' + barShut.height + 'px');
  rig.check(barShut.left === barOpen.left && barShut.top === barOpen.top,
            'the tab bar moved when the panel shut (' + barOpen.left + ',' + barOpen.top +
            ' → ' + barShut.left + ',' + barShut.top + ')');
  // Half, not a third: the panel's height is its content, so a tighter ratio would turn a short
  // rig window into a red run that says nothing about the bar.
  rig.check(barShut.height > 0 && barShut.height < panelBox.height / 2,
            'the tab bar is not a fraction of the panel height (' + barShut.height +
            ' vs ' + panelBox.height + ')');

  // ── E ── opened on the Fog pane, or the advanced panel would go dark from the pane swap alone
  // and the check would pass without the shut doing anything.
  await pick('fog');
  await dm.evaluate('document.querySelector("#cp-anim-row [data-anim=\'advanced\']").click(); 0');
  await dm.waitFor('document.getElementById("anim-advanced-panel").style.display === "block"',
                   10000, 'the advanced fog panel to open');
  await pick('fog');
  rig.check(await dm.evaluate('document.getElementById("anim-advanced-panel").style.display === "none"'),
            'shutting the panel left the advanced fog panel floating over the map');
  rig.check(!(await dm.evaluate('document.getElementById("btn-anim-advanced").classList.contains("active")')),
            'the advanced fog panel was only hidden, not closed — it reopens on the next pane switch');

  // ── F ──
  const shutRegion = await dm.evaluate('JSON.stringify(dmVisibleRegion())');
  await pick('fog');
  const openRegion = await dm.evaluate('JSON.stringify(dmVisibleRegion())');
  rig.check(shutRegion === openRegion,
            'the region sent to the Player changes with the panel — the reverted panel-width trim is back: ' +
            shutRegion + ' vs ' + openRegion);

  // ── G ──
  const reboot = () => dm.evaluate('_cpRestoreTab(); 0');

  await pick('player');
  rig.check(await dm.evaluate('localStorage.getItem("evermist.cpPane") === "player"'),
            'the open pane was not saved');
  await reboot();
  rig.check(await shown('cp-pane-player') && await lit() === 'player',
            'a reload did not reopen the panel on the pane it was left on');

  await pick('player');
  rig.check(await dm.evaluate('localStorage.getItem("evermist.cpPane") === ""'),
            'the shut state was not saved');
  await reboot();
  rig.check(!(await shown('sidebar-right')) && await lit() === '',
            'a reload reopened the panel the DM had shut');

  // ── H ──
  // ⚠ THE PROBE SITS INSIDE THE PANEL IT MEASURES. Chromium folds an ancestor `zoom` into every
  // computed length, and every one of these panels carries `zoom: var(--ui-zoom)`, so a probe on
  // <body> would resolve the variables unscaled and never match anything.
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
    const read = el => { const c = getComputedStyle(el); return [c.backgroundColor,
      c.borderTopWidth, c.borderTopColor, c.borderTopLeftRadius, c.boxShadow].join(' | '); };
    const pc = getComputedStyle(probe);
    const got = read(p), want = read(probe);
    const wantW = parseFloat(pc.borderTopWidth), wantR = parseFloat(pc.borderTopLeftRadius);
    probe.remove();
    return { got, want, wantW, wantR };
  })()`);

  // Every panel gets REVEALED first, then measured, then put back.
  const edges = {};
  // ⚠ CHECK BEFORE THE TEARDOWN, and let the teardown fail loudly but harmlessly. A panel that
  // never revealed leaves its close button absent, and closing it first turned the one FAIL line
  // naming that panel into a thrown scenario that also skipped every panel after it.
  let resolvedW = 0, resolvedR = 0;
  const measure = async (id, open, shut) => {
    await open();
    await rig.sleep(200);
    const e = await edgeOf(id);
    rig.check(!e.err, '#' + id + ' ' + e.err + ', so its edge was never checked');
    if (!e.err) {
      rig.check(e.got === e.want,
                '#' + id + ' writes its own shell instead of reading the --panel-* variables' +
                ' — it has [' + e.got + '] where base.css says [' + e.want + ']');
      edges[id] = e.got;
      resolvedW = e.wantW; resolvedR = e.wantR;
    }
    try { await shut(); } catch (err) {
      rig.note('#' + id + ' would not close again: ' + err.message);
    }
    await rig.sleep(120);
  };

  await pick('fog');
  const advBtn = 'document.querySelector(\'#cp-anim-row [data-anim="advanced"]\').click(); 0';
  await measure('anim-advanced-panel',
    () => dm.evaluate(advBtn),
    () => dm.evaluate(advBtn));
  await pick('fog');

  await measure('mt-modal',
    () => dm.evaluate('openModuleTextModal(); 0'),
    () => dm.evaluate('closeModuleTextModal(); 0'));

  await measure('cd-modal',
    () => dm.evaluate('confirmDialog({ title: "Edge probe", message: "Measuring the shell." }); 0'),
    () => dm.evaluate('document.getElementById("cd-cancel").click(); 0'));

  await measure('panel-room',
    () => dm.evaluate('polygons = [{ id: 1, vertices: [{x:100,y:100},{x:300,y:100},' +
      '{x:300,y:260},{x:100,y:260}], mode: "shroud", cornerRadius: 0, name: "Edge probe" }];' +
      ' nextPolygonId = 2; selectedPolygonId = 1; refreshRoomPanel(); 0'),
    () => dm.evaluate('polygons = []; nextPolygonId = 1; selectedPolygonId = null;' +
      ' refreshRoomPanel(); 0'));

  // ⚠ THE PROBE READS THE SAME VARIABLES THE PANELS DO, so a renamed or deleted --panel-* makes
  // both sides fall back to the initial value and every compare above passes with the panels bare.
  // This is the only check that notices the variables themselves going missing.
  rig.check(resolvedW > 0 && resolvedR > 0,
            'base.css no longer resolves --panel-border and --panel-radius to a real edge ' +
            '(width ' + resolvedW + 'px, radius ' + resolvedR + 'px) — whichever reads 0 is gone ' +
            'from every floating panel, and the compares above cannot see it');

  const distinct = [...new Set(Object.values(edges))];
  rig.check(distinct.length <= 1,
            'the floating panels do not agree on one edge, so two of them side by side over the ' +
            'map look like different apps: ' +
            Object.keys(edges).map(k => '#' + k + ' [' + edges[k] + ']').join(', '));
};

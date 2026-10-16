'use strict';

// blue-press-vs-picked.js — SOLID BLUE IS "PRESS THIS", THE BLUE TINT IS "PICKED".
//
// THE GOAL OF THIS FEATURE: a new DM can tell "this is on" from "do this". What is picked wears the
// tint; only the thing to press wears solid blue. The scan over the stylesheets is test/blueMeaning.test.js;
// this file checks what the DM sees (.claude/private/specs/blue-press-vs-picked.md).
//
//   1. The tool in hand on the scene toolbar wears the tint.
//   2. The row under the pointer in a chevron list wears the tint.
//   3. The active Left / Right chip on the world map wears the tint.
//   (Show on TV and a window's main button stay solid; the dock menu, library menu and combat menu share the
//   row rule of 2 and are not driven here.)
//
// ⚠ BY EYE: the key hint beside a hovered row, and the tick marks of the boxes.

const lib = require('../../lib');

module.exports = async function bluePressVsPicked(rig) {
  const dm = rig.dm;
  await lib.openMap(rig, { kind: 'still', w: 1200, h: 800 });
  await lib.settle(dm, 'currentScene && fogCoverT === 0', 60000);

  const PROBE = `globalThis.__bpTint = () => { const p = document.createElement('i'); p.style.background = 'var(--b-tint)';
    document.body.appendChild(p); const c = getComputedStyle(p).backgroundColor; p.remove(); return c; };
    globalThis.__bpBg = el => getComputedStyle(el).backgroundColor;
    globalThis.__bpMid = el => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }; 0`;
  await dm.evaluate(PROBE);
  const move = async (sel) => {
    const p = await dm.evaluate('__bpMid(document.querySelector(' + JSON.stringify(sel) + '))');
    await dm.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y });
  };

  // ── 1. The tool in hand ────────────────────────────────────────────────
  // RED ON: `.tool-btn.active` back to `background: var(--b-solid)` (toolbar.css) - 2026-10-16
  await dm.evaluate('document.getElementById("btn-brush").click(); 0');
  // Polled: .tool-btn fades its background over 0.12s, so a read right after the click sees the start.
  let tool = null;
  await lib.poll(async () => {
    tool = await dm.evaluate('({ bg: __bpBg(document.getElementById("btn-brush")), tint: __bpTint(), on: document.getElementById("btn-brush").classList.contains("active") })');
    return tool.on && tool.bg === tool.tint ? { tool } : null;
  }, 3000);
  rig.check(tool.on && tool.bg === tool.tint, 'the tool in hand does not wear the tint: ' + JSON.stringify(tool));

  // ── 2. The row under the pointer ───────────────────────────────────────
  // RED ON: `.dd-it:hover:not(.off)` back to `background: var(--b-solid)` (toolbar.css) - 2026-10-16
  await dm.evaluate('document.querySelector("[data-chev=shape]").click(); 0');
  await lib.settle(dm, 'document.querySelectorAll("#tb-dd .dd-it:not(.off)").length > 1', 5000);
  await move('#tb-dd .dd-it:not(.off)');
  const row = await lib.poll(async () => {
    const r = await dm.evaluate('({ bg: __bpBg(document.querySelector("#tb-dd .dd-it:not(.off)")), tint: __bpTint() })');
    return r.bg === r.tint ? { r } : null;
  }, 3000);
  rig.check(!!row, 'the hovered row of a chevron list does not wear the tint');
  await dm.evaluate('document.querySelector("[data-chev=shape]").click(); 0');

  // ── 3. The active column chip, with Two maps on ────────────────────────
  // RED ON: `#wm-cols button.active` back to `background: var(--b-solid)` (worldMap.css) - 2026-10-16
  await rig.player();
  await dm.evaluate('document.getElementById("btn-two-maps").click(); 0');
  await dm.waitFor('panesActive && panes.A.ready && panes.B.ready', 180000, 'both columns to come up');
  await lib.settle(dm, 'worldMapOpen', 20000);
  if (!(await dm.evaluate('worldMapOpen'))) await dm.evaluate('document.getElementById("btn-world").click(); 0');
  await dm.waitFor('worldMapOpen && !document.getElementById("wm-cols").hidden', 20000, 'the Left and Right chips');
  const chip = await dm.evaluate('({ bg: __bpBg(document.querySelector("#wm-cols button.active")), tint: __bpTint(), n: document.querySelectorAll("#wm-cols button.active").length })');
  rig.check(chip.n === 1 && chip.bg === chip.tint, 'the active column chip does not wear the tint: ' + JSON.stringify(chip));
  rig.byEye('the hovered row keeps its key hint readable, and ticked boxes show a blue tick on the tint');
};

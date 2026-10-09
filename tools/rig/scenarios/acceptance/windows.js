'use strict';

// windows.js — EVERY WINDOW OUTSIDE THE DOCK, BUILT FROM ONE SET OF PARTS.
//
// THE GOAL OF THIS FEATURE: the DM reads the same signal for the same action in every window. A
// button, a header, a close, a toast and a selection look and sit the same wherever they are, so
// nothing has to be learnt twice. The parts live in sceneManager.css; this file holds each window
// to them.
//
// THE CRITERIA ARE THIS HEADER. Each lettered line has its checks under a marker carrying its
// letter.
//
//   A. Every control in a window is 28px tall and has no outline, and an icon beside a label sits
//      on the label's optical centre.
//   B. Every header is 48px and every list toolbar 44px with the all/none tick first.
//   C. A destructive button wears the trash, no red and no fill at rest. In a footer it sits on
//      the right, and no footer button only closes its window.
//   D. A centred window is one of the three widths, 360, 480 or 720, and carries at most one
//      primary button.
//   E. The fight's stat block and the Bestiary's page read at one type scale.
//   F. Every toast sits in the one stack, its button centred and on the message's baseline.
//
// ⚠ THE WINDOWS ARE OPENED BY THEIR OWN FUNCTIONS and fed the state they show, never driven
// through a real file or a real link: what is measured here is the parts, and every behaviour
// behind them has its own scenario.
//
// ⚠ THE ICON CHECK IS THE DM'S PLATFORM ONLY. The 1px nudge is Segoe UI's baseline, so on the
// Mac and Linux fonts it is noted rather than held.

const lib = require('../../lib');

// The board's audit (.claude/private/design/item-150/board.js), measuring one window at a time.
const AUDIT = `
globalThis.__winAudit = (root, name, opts) => {
  const o = opts || {}, out = [], icons = [];
  let checks = 0;
  const shown = el => el.getClientRects().length > 0 && el.getBoundingClientRect().width > 0;
  const px = v => Math.round(parseFloat(v) * 10) / 10;
  const label = b => (b.textContent.trim() || b.title || b.id || b.className).slice(0, 40);
  const mc = document.createElement('canvas').getContext('2d');
  const metrics = el => {
    const cs = getComputedStyle(el);
    mc.font = cs.fontWeight + ' 100px ' + cs.fontFamily;
    const H = mc.measureText('H'), x = mc.measureText('x'), k = parseFloat(cs.fontSize) / 100;
    return { a: H.fontBoundingBoxAscent * k, d: H.fontBoundingBoxDescent * k, cap: H.actualBoundingBoxAscent * k, xh: x.actualBoundingBoxAscent * k };
  };
  const textNode = el => document.createTreeWalker(el, NodeFilter.SHOW_TEXT,
    { acceptNode: n => n.textContent.trim() && !n.parentElement.closest('.sm-chev,.car') ? 1 : 3 }).nextNode();
  const baseline = el => {
    const tn = textNode(el);
    if (!tn) return null;
    const r = document.createRange(); r.selectNodeContents(tn);
    const rr = r.getClientRects()[0];
    if (!rr) return null;
    const m = metrics(tn.parentElement), z = rr.height / (m.a + m.d), base = rr.bottom - m.d * z;
    return { base, optical: base - (m.cap + m.xh) / 4 * z, z };
  };
  const all = sel => [root, ...root.querySelectorAll(sel)].filter(el => el.matches(sel) && shown(el));

  for (const b of all('.sm-hbtn,.sm-bare,.sm-x,.bs-ib,.bs-f,.cb-save,.cb-head .cb-iconbtn,.cb-acts .cb-iconbtn,.bs-pop .top button')) {
    const cs = getComputedStyle(b);
    checks += 2;
    if (px(cs.height) !== 28) out.push('a control is ' + cs.height + ' tall: ' + label(b));
    if (['Top', 'Right', 'Bottom', 'Left'].some(s => parseFloat(cs['border' + s + 'Width']) > 0)) out.push('a control has an outline: ' + label(b));
    const ic = b.querySelector(':scope > svg'), bi = baseline(b);
    if (ic && bi) {
      // The trash is set by eye 1.25px above the optical line: its lid reads low (sceneManager.css).
      const want = bi.optical - (ic.classList.contains('i-trash') ? 1.25 : 0) * bi.z, r = ic.getBoundingClientRect();
      const off = ((r.top + r.bottom) / 2 - want) / bi.z;
      if (Math.abs(off) > 0.6) icons.push('icon off its label by ' + off.toFixed(2) + 'px: ' + label(b));
    }
  }
  for (const b of all('.sm-hbtn.danger')) {
    checks += 3;
    if (!b.querySelector('svg.i-trash')) out.push('a destructive button has no trash: ' + label(b));
    const c = getComputedStyle(b).color.match(/\\d+/g).map(Number);
    if (c[0] - c[1] > 60) out.push('a destructive button is red at rest: ' + label(b));
    if (getComputedStyle(b).backgroundColor !== 'rgba(0, 0, 0, 0)') out.push('a destructive button has a fill at rest: ' + label(b));
  }
  for (const h of all('.sm-whead,.bs-head,.cb-head')) {
    checks++;
    if (px(getComputedStyle(h).height) !== 48) out.push('a header is ' + getComputedStyle(h).height);
  }
  for (const l of all('.sm-ltb')) {
    checks += 2;
    if (px(getComputedStyle(l).height) !== 44) out.push('a list toolbar is ' + getComputedStyle(l).height);
    if (!l.querySelector(':scope > .sm-tick')) out.push('a list toolbar has no all/none tick');
  }
  for (const f of all('.sm-field')) {
    checks++;
    if (px(getComputedStyle(f).height) !== 28) out.push('a field is ' + getComputedStyle(f).height);
  }
  for (const f of all('.sm-wfoot')) {
    for (const d of [...f.querySelectorAll('.sm-hbtn.danger')].filter(shown)) {
      checks++;
      const fr = f.getBoundingClientRect(), dr = d.getBoundingClientRect();
      if (fr.right - dr.right > fr.width / 2) out.push('a destructive button sits on the left of a footer');
    }
    for (const b of [...f.querySelectorAll('button')].filter(shown)) {
      checks++;
      if (/^(done|ok|close)$/i.test(b.textContent.trim()) && !f.closest('.w-s')) out.push('a footer button only closes its window: ' + label(b));
    }
  }
  for (const w of all('.sm-win')) {
    if (o.anyWidth) continue;
    checks++;
    if (!w.matches('.w-s, .w-m, .w-l')) out.push('a window off the three widths: ' + Math.round(w.offsetWidth) + 'px');
  }
  checks++;
  const primaries = [...root.querySelectorAll('.sm-hbtn.primary, .cb-save')].filter(shown).filter(b => !b.closest('.sm-toast'));
  if (primaries.length > 1) out.push(primaries.length + ' primary buttons: ' + primaries.map(label).join(', '));
  for (const t of all('.sm-toast')) {
    const m = t.querySelector('.m'), mi = m && baseline(m), tr = t.getBoundingClientRect();
    const z = tr.height / t.offsetHeight;
    checks++;
    if (!t.closest('#sm-toasts')) out.push('a toast outside the stack: ' + t.id);
    for (const b of [...t.querySelectorAll('button')].filter(shown)) {
      const br = b.getBoundingClientRect();
      checks++;
      const off = ((br.top + br.bottom) / 2 - (tr.top + tr.bottom) / 2) / z;
      if (Math.abs(off) > 0.5) out.push('a toast button is off centre by ' + off.toFixed(2) + 'px: ' + t.id);
      const li = baseline(b);
      if (li && mi && m.getBoundingClientRect().height < 20 * z) {
        checks++;
        if (Math.abs(li.base - mi.base) > 0.5 * z) out.push('a toast button sits ' + ((li.base - mi.base) / z).toFixed(2) + 'px off the message baseline: ' + t.id);
      }
    }
  }
  return { name, checks, out, icons };
};
0`;

module.exports = async function windowsFeature(rig) {
  const dm = rig.dm;
  await lib.openMap(rig, { w: 1200, h: 800 });
  await dm.evaluate(AUDIT);
  const onWindows = process.platform === 'win32';

  const audit = async (name, open, sel, opts, shut) => {
    await dm.evaluate('(() => { ' + open + '; return 0; })()');
    const res = await dm.evaluate('__winAudit(document.querySelector(' + JSON.stringify(sel) + '), ' +
                                  JSON.stringify(name) + ', ' + JSON.stringify(opts || {}) + ')');
    rig.note(name + ': ' + res.checks + ' checks');
    rig.check(res.checks > 0, name + ': nothing was measured, so the window never opened');
    rig.check(res.out.length === 0, name + ': ' + res.out.join('; '));
    if (onWindows) rig.check(res.icons.length === 0, name + ': ' + res.icons.join('; '));
    else if (res.icons.length) rig.note(name + ' icons, off the DM\'s platform: ' + res.icons.join('; '));
    if (shut) await dm.evaluate('(() => { ' + shut + '; return 0; })()');
  };

  // ── A-D. Every window ─────────────────────────────────────────────────────
  // RED ON: .sm-hbtn height set back to 30px (sceneManager.css) — 2026-10-03
  // RED ON: .sm-hbtn.danger given its red fill back (sceneManager.css) — 2026-10-03
  // RED ON: #mt-modal's w-m class misspelt (index.html) — 2026-10-03
  await audit('Confirm dialog', 'confirmDialog({ title: "Delete the scene?", message: "It goes for good.", confirmLabel: "Delete", danger: true })',
              '#cd-modal', {}, 'document.getElementById("cd-cancel").click()');
  await audit('Message dialog', 'messageDialog({ title: "The map would not open", message: "It is not an image." })',
              '#cd-modal', {}, 'document.getElementById("cd-ok").click()');
  await audit('Module text', 'mtStore([{ num: "1", name: "Cave Mouth", body: "A dark mouth." }, { num: "2", name: "Kennel", body: "" }], "Phandelver.txt"); openModuleTextModal()',
              '#mt-modal', {}, 'closeModuleTextModal(); mtClearStored()');
  await audit('Add from YouTube', `openMusicDownload(); _muLookup = { title: 'Tavern', entries: [
      { id: 'aaaaaaaaaaa', title: 'One', duration: 60, size: 1048576, url: '', have: false },
      { id: 'bbbbbbbbbbb', title: 'Two', duration: 60, size: 1048576, url: '', have: true }] };
      _muPicked.clear(); _muPicked.add('aaaaaaaaaaa'); _muRenderLookup()`,
              '#mu-modal', {}, '_muPicked.clear(); _muLookup = null; _muRenderLookup(); document.getElementById("btn-mu-close").click()');
  await audit('Keyboard shortcuts', 'toggleLegend()', '#legend-win', {}, 'toggleLegend()');
  await dm.evaluate('openChangelog(); 0');
  await dm.waitFor('!!document.getElementById("cl-modal") && document.getElementById("cl-anchor").style.display !== "none"', 10000, 'What\'s new to open');
  await audit('What\'s new', 'const r = [...document.querySelectorAll("#cl-body .cl-row")].find(x => x.querySelector(".sm-chev")); if (r) r.click()',
              '#cl-modal', {}, 'closeChangelog()');
  await audit('Progress', 'setMapProgressRun("7 of 12", "Backup.zip"); showMapProgress("Extracting scenes…")', '#map-progress',
              {}, 'hideMapProgress(); setMapProgressRun("")');

  await dm.evaluate(`(() => {
    for (const n of ['Goblin', 'Goblin Boss', 'Wolf']) combatAddEntry(cbState.blocks, Object.assign(combatBlankBlock('', n), { meta: 'Small humanoid', cr: '1', ac: '15', hp: '7 (2d6)',
      secs: { Actions: [{ n: 'Scimitar', t: 'Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 5 (1d6 + 2) slashing damage.' }] } }));
    cbSave(); return 0; })()`);
  await audit('Bestiary', `bestiarySetOpen(true); const ids = Object.keys(cbState.blocks); bs.picked = new Set(ids.slice(0, 2)); _bsShow(ids[2])`,
              '#bs-panel', {}, null);
  await audit('Import menu', 'document.querySelector(\'#bs-panel [data-a="import"]\').click()', '.bs-pop', {},
              '_bsClosePop(); bs.picked.clear(); bestiaryRender()');

  // ── E. One stat block type scale ──────────────────────────────────────────
  // RED ON: .cb-sb-name set back to 600 16px (combat.css) — 2026-10-03
  await dm.evaluate(`(() => { cbSetOpen(true); document.getElementById('cb-add').click();
    const b = Object.values(cbState.blocks)[2], r = cbState.rows[cbState.rows.length - 1];
    r.sb = combatSnapshot(b); cbOpenStat(r); return 0; })()`);
  const scale = await dm.evaluate(`(() => {
    const pairs = [['#cb-stat .cb-sb-name', '#bs-page .bs-page-head h2'], ['#cb-stat .cb-sb-sechd', '#bs-page .bp-sec-h'],
                   ['#cb-stat .cb-sb-line', '#bs-page .bp-read']];
    return pairs.map(([a, b]) => { const x = document.querySelector(a), y = document.querySelector(b);
      if (!x || !y) return a + ' or ' + b + ' is missing';
      const fx = getComputedStyle(x), fy = getComputedStyle(y);
      return fx.fontSize === fy.fontSize && fx.fontWeight === fy.fontWeight ? '' :
        a + ' is ' + fx.fontSize + ' ' + fx.fontWeight + ', the Bestiary\\'s ' + fy.fontSize + ' ' + fy.fontWeight; }).filter(Boolean);
  })()`);
  rig.check(scale.length === 0, 'E: the stat blocks read at two type scales: ' + scale.join('; '));
  await dm.evaluate('bestiarySetOpen(false); 0');
  await audit('Fight table', '0', '#cb-fight', {}, null);
  await audit('Stat block', '0', '#cb-stat', {}, 'cbCloseStat(); cbSetOpen(false)');

  // ── F. The toasts ─────────────────────────────────────────────────────────
  // RED ON: .sm-toast .sm-hbtn given margin-top: 4px (sceneManager.css) — 2026-10-03
  await audit('Toasts', `undoHint('Undone'); showUndoToast('"Goblin Caves" removed'); noticeToast('One door was removed with the wall it was on.');
      upToast('Version 9.9.9 is ready to install', 'Restart now', () => {}, 0)`,
              '#sm-toasts', {}, 'hideUndoToast(); hideUpdateToast(); document.getElementById("notice-toast").style.display = "none"');
};

'use strict';

// user.js - the DM's own hands. Every action is real CDP input (mouse, keys, text) aimed at what is on screen,
// and refused when something else lies on top of the target, as it would block the DM. A scenario acts on the
// app through this; a JS .click(), a synthetic event or a value set by script proves nothing (fakeInput.js).
//
//   const u = user(dm);
//   await u.click('#btn-reveal');                 // a selector
//   await u.click({ text: 'Начать бой' });         // the visible text, label, title or placeholder
//   await u.click({ sel: '#cb-list .cb-row', text: 'Гуль' });
//   await u.click({ sel: '#cb-list [data-f=hp]', nth: 1 });     // the second of several, counted from 0
//   await u.type('Гуль'); await u.press('Enter'); await u.press('h', { ctrl: true });
//   await u.drag('#a', { x: 400, y: 300 }); await u.wheel({ x: 400, y: 300 }, -120);
//   await u.drag(await u.map(100, 200), await u.map(300, 200));    // map units, as the DM's map shows them

const BUTTONS = { left: 1, right: 2, middle: 4 };
const MODS = { alt: 1, ctrl: 2, meta: 4, shift: 8 };
const KEYS = {
  Enter: [13, 'Enter', '\r'], Escape: [27, 'Escape'], Tab: [9, 'Tab'], Backspace: [8, 'Backspace'],
  Delete: [46, 'Delete'], Space: [32, 'Space', ' '], ArrowUp: [38, 'ArrowUp'], ArrowDown: [40, 'ArrowDown'],
  ArrowLeft: [37, 'ArrowLeft'], ArrowRight: [39, 'ArrowRight'], Home: [36, 'Home'], End: [35, 'End'],
  PageUp: [33, 'PageUp'], PageDown: [34, 'PageDown'],
};

const describe = (t) => (typeof t === 'string' ? t : JSON.stringify(t));

// The middle of the target's first line box, scrolled into view, and what the pointer would really hit there.
// A text target is the deepest visible element whose text, label, title or placeholder is exactly that text.
const AIM = (sel, text, nth) => `(() => {
  const want = ${JSON.stringify(text === undefined ? null : text)};
  const seen = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const says = (e) => [e.innerText, e.getAttribute('aria-label'), e.title, e.placeholder]
    .some((v) => typeof v === 'string' && v.trim() === want);
  const all = [...document.querySelectorAll(${JSON.stringify(sel || '*')})].filter(seen);
  const hits = want === null ? all : all.filter(says);
  const e = ${JSON.stringify(nth === undefined ? null : nth)} === null ? (want === null ? hits[0] : hits.pop()) : hits[${JSON.stringify(nth || 0)}];
  if (!e) return null;
  e.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  const r = e.getClientRects()[0] || e.getBoundingClientRect();
  // A field is clicked on its first line, as the DM clicks into one, never in the middle of a tall box.
  const field = /^(INPUT|TEXTAREA)$/.test(e.tagName) || e.isContentEditable;
  const x = field ? r.left + Math.min(r.width / 2, 24) : r.left + r.width / 2;
  const y = field ? r.top + Math.min(r.height / 2, 10) : r.top + r.height / 2;
  const hit = document.elementFromPoint(x, y);
  const name = (n) => n ? n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') + (n.classList[0] ? '.' + n.classList[0] : '') : 'nothing';
  return { x, y, covered: hit && e.contains(hit) ? '' : name(hit) };
})()`;

const aimOf = (target) => { const t = typeof target === 'string' ? { sel: target } : target; return AIM(t.sel, t.text, t.nth); };
// A point that must land on `over` (the map's own element): what lies there instead, if anything.
const OVER = (p) => `(() => { const hit = document.elementFromPoint(${p.x}, ${p.y}), on = document.querySelector(${JSON.stringify(p.over)});
  const name = (n) => n ? n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') + (n.classList[0] ? '.' + n.classList[0] : '') : 'nothing';
  return { x: ${p.x}, y: ${p.y}, covered: on && hit && on.contains(hit) ? '' : name(hit) }; })()`;

// ⚠ A PARKED WINDOW IS NEVER THE OS'S FOCUSED ONE, and Chromium then fires no focus or blur on a click. Focus
// emulation makes the page behave as the window the DM is using, so a real click moves focus as it does for them.
function user(page) {
  page.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
  const mouse = (type, p, extra) => page.send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, ...extra });
  const mods = (m = {}) => Object.keys(MODS).reduce((sum, k) => sum + (m[k] ? MODS[k] : 0), 0);

  // A target is waited for as the DM waits for a control to appear and stop moving, up to `wait` ms: a window still
  // growing in moves its buttons from under a click aimed a frame earlier. A point on the map must have the map itself
  // under it. A free point ({ x, y }) is taken as it is.
  async function at(target, wait = 5000) {
    if (target && typeof target.x === 'number' && typeof target.y === 'number' && !target.over) return target;
    const end = Date.now() + wait;
    const read = () => page.evaluate(target && target.over ? OVER(target) : aimOf(target));
    for (;;) {
      const p = await read();
      if (p && !p.covered) {
        await new Promise((r) => setTimeout(r, 60));
        const q = await read();
        if (q && !q.covered && Math.abs(q.x - p.x) < 0.5 && Math.abs(q.y - p.y) < 0.5) return q;
        if (Date.now() < end) continue;
      }
      if (Date.now() >= end) {
        if (!p) throw new Error('user: nothing on screen matches ' + describe(target));
        throw new Error('user: ' + describe(target) + ' is covered by ' + p.covered + ', so the DM could not reach it');
      }
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  async function click(target, { button = 'left', count = 1, ...m } = {}) {
    const p = await at(target);
    const modifiers = mods(m);
    await mouse('mouseMoved', p, { modifiers });
    for (let i = 1; i <= count; i++) {
      await mouse('mousePressed', p, { button, buttons: BUTTONS[button], clickCount: i, modifiers });
      await mouse('mouseReleased', p, { button, buttons: 0, clickCount: i, modifiers });
    }
    return p;
  }

  // One key's events. keyDown and keyUp apart hold a key, as the DM holds H to see the TV's view.
  function keyEvents(key, m = {}, commands) {
    const named = KEYS[key];
    const ch = !named && key.length === 1 ? key : '';
    const upper = ch.toUpperCase();
    const code = named ? named[1] : /[a-z]/i.test(ch) ? 'Key' + upper : /\d/.test(ch) ? 'Digit' + ch : '';
    const vk = named ? named[0] : upper.charCodeAt(0);
    const modifiers = mods(m);
    const text = named ? named[2] : (m.ctrl || m.alt || m.meta ? '' : (m.shift ? upper : ch));
    const base = { key: named ? named[1].replace('Space', ' ') : ch, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers };
    return {
      down: () => page.send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', ...base, ...(text ? { text, unmodifiedText: text } : {}), ...(commands ? { commands } : {}) }),
      up: () => page.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base }),
    };
  }
  async function press(key, m) {
    const k = keyEvents(key, m);
    await k.down();
    await k.up();
  }

  return {
    click,
    dblclick: (t, m) => click(t, { ...m, count: 2 }),
    rightClick: (t, m) => click(t, { ...m, button: 'right' }),
    async hover(target) { const p = await at(target); await mouse('mouseMoved', p); return p; },
    // Text into whatever has focus, as the keyboard's IME would deliver it. Click the field first.
    type: (text) => page.send('Input.insertText', { text: String(text) }),
    press,
    // Everything in the focused field selected, by the platform's own keys. ⚠ ON A MAC CHROMIUM RUNS NO EDITING
    // COMMAND FROM A SYNTHESISED KEY: Cmd+A alone selects nothing, so the command travels with it.
    async selectAll() {
      const mac = process.platform === 'darwin';
      const k = keyEvents('a', mac ? { meta: true } : { ctrl: true }, mac ? ['selectAll'] : undefined);
      await k.down();
      await k.up();
    },
    keyDown: (key, m) => keyEvents(key, m).down(),
    keyUp: (key, m) => keyEvents(key, m).up(),
    async drag(from, to, { button = 'left', steps = 8 } = {}) {
      const a = await at(from);
      const b = await at(to);
      await mouse('mouseMoved', a);
      await mouse('mousePressed', a, { button, buttons: BUTTONS[button], clickCount: 1 });
      for (let i = 1; i <= steps; i++) {
        await mouse('mouseMoved', { x: a.x + (b.x - a.x) * i / steps, y: a.y + (b.y - a.y) * i / steps }, { button, buttons: BUTTONS[button] });
      }
      await mouse('mouseReleased', b, { button, buttons: 0, clickCount: 1 });
      return { from: a, to: b };
    },
    async wheel(target, deltaY, { deltaX = 0, ...m } = {}) {
      const p = await at(target);
      await mouse('mouseMoved', p);
      await mouse('mouseWheel', p, { deltaX, deltaY, modifiers: mods(m) });
      return p;
    },
    // A point given in map units, where the DM's map shows it now (zoom and pan read live).
    map: async (mx, my) => ({ ...await page.evaluate(`(() => { const r = container.getBoundingClientRect();
      return { x: ${mx} * zoom + panX + r.left, y: ${my} * zoom + panY + r.top }; })()`), over: '#canvas-container' }),
    at,
  };
}

module.exports = { user };

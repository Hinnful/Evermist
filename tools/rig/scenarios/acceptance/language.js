'use strict';

// language.js — THE RUSSIAN INTERFACE.
//
// THE GOAL OF THIS FEATURE: a DM picks Русский in the About block, restarts, and every label,
// tooltip and message on their screen is Russian, while the names they typed stay exactly as
// typed. English stays exactly as it was.
//
// THE CRITERIA ARE THIS HEADER. Each lettered line has its checks under a marker carrying its
// letter.
//
//   A. A run with nothing stored comes up in English, and the About switch shows English picked.
//   B. Picking Русский stores the choice and says it applies after a restart; the screen does not
//      change until then.
//   C. After the restart, buttons and tooltips read Russian, and so does a tooltip the app
//      rewrites while it runs (the Player window button).
//   D. A dialog reads Russian, title and message.
//   E. A count reads in the right Russian plural form.
//   F. The DM's own text stays as typed, even when it is a word the dictionary knows: a fight
//      name, a monster's name in its stat block, the Attacks line typed into the fight table,
//      and a scene name in Scene control's header.
//   G. Typing into an editable cell saves exactly what was typed.
//   H. Text with no Russian entry shows its English and breaks nothing.
//   I. Picking English and restarting brings back the English readings from A, byte for byte.
//   J. In Russian, no label in any dock pane clips at the default dock width.
//
// ⚠ THE PASS RUNS ON A MUTATION OBSERVER, which answers after the change that fed it. Every read
// after an action waits a tick first, or it reads the English the observer has not reached yet.
//
// ⚠ run.js PINS --lang=en-US, and Chromium ignores it on macOS. A mac runner in another language
// would start in that language, so A notes the language rather than failing on it there.

const lib = require('../../lib');

const TICK = 'new Promise(r => setTimeout(r, 30))';

// The fixed readings A takes and I compares against.
const SAMPLES = `(() => ({
  tab: document.querySelector('#cp-sec-fog .cp-label').textContent.trim(),
  help: document.getElementById('btn-help').title,
  golive: document.getElementById('cp-player-golive').title,
  gridReset: document.getElementById('cp-grid-reset').title,
  lang: document.documentElement.lang,
}))()`;

const pick = lang => `document.querySelector('.about-lang [data-lang="${lang}"]').click(); ${TICK}`;

module.exports = async function language(rig) {
  let dm = rig.dm;
  await lib.openMap(rig, { w: 1200, h: 800 });

  // ── A ─────────────────────────────────────────────────────────────────────
  const navLang = await dm.evaluate('navigator.language');
  rig.note('navigator.language under the rig: ' + navLang);
  const english = await dm.evaluate(SAMPLES);
  // RED ON: the no-choice default set to 'ru' in i18n.js - 2026-09-29
  rig.check(english.tab === 'Fog' && english.help === 'Keyboard shortcuts (?)' && english.lang === 'en',
    'A: a run with nothing stored did not come up in English: ' + JSON.stringify(english));
  rig.check(await dm.evaluate('document.querySelector(".about-lang .active").dataset.lang === "en"'),
    'A: the About switch does not show English picked');

  // ── B ─────────────────────────────────────────────────────────────────────
  await dm.evaluate(pick('ru'));
  const stored = await dm.evaluate('localStorage.getItem("evermist-lang")');
  const note = await dm.evaluate('(() => { const n = document.querySelector(".about-lang-note"); return { shown: n.style.display !== "none", text: n.textContent }; })()');
  // RED ON: the switch writing to a different localStorage key (i18n.js) - 2026-09-29
  rig.check(stored === 'ru', 'B: picking Русский did not store the choice (' + stored + ')');
  rig.check(note.shown && note.text === 'Applies after restart', 'B: no "Applies after restart" note: ' + JSON.stringify(note));
  rig.check((await dm.evaluate(SAMPLES)).tab === 'Fog', 'B: the screen changed before the restart');

  // Names that are dictionary words, set before the restart so they come back from storage.
  const sceneId = await dm.evaluate('currentScene.id');
  await dm.evaluate('(() => { const s = allScenes.find(x => x.id === currentScene.id);' +
                    ' commitSceneName(s, { value: "Grid" }); return 0; })()');
  // ⚠ THE RENAME IS WRITTEN AFTER IT RETURNS. A restart that beats the write finds the old name,
  // which reads as the translator eating the DM's text; a slow runner loses that race.
  const renamed = await lib.poll(async () => {
    const name = await dm.evaluate(`sceneStore.loadScene(${JSON.stringify(sceneId)}).then(s => s && s.name)`);
    return name === 'Grid' ? { name } : null;
  }, 20000);
  rig.check(!!renamed, 'the scene rename never reached disk, so F below would test nothing');

  // ── C ─────────────────────────────────────────────────────────────────────
  dm = await rig.restart();
  await lib.installHelpers(dm);
  await lib.settle(dm, 'typeof currentScene !== "undefined" && !!currentScene', 30000);
  await dm.evaluate(TICK);
  const russian = await dm.evaluate(SAMPLES);
  // RED ON: the pass and t() forced to English in i18n.js - 2026-09-29
  rig.check(russian.tab === 'Туман' && russian.help === 'Горячие клавиши (?)' && russian.lang === 'ru',
    'C: after the restart the screen is not Russian: ' + JSON.stringify(russian));
  await rig.player();
  await dm.evaluate('refreshPlayerControlUI(); ' + TICK);
  const live = await dm.evaluate('({ title: document.getElementById("cp-player-golive").title,' +
                                 ' label: document.getElementById("cp-golive-lbl").textContent })');
  // RED ON: attribute watching turned off in the observer (i18n.js) - 2026-09-29
  rig.check(live.title === 'Закрыть окно игроков' && live.label === 'Закрыть окно',
    'C: the Player button the app rewrites stayed English: ' + JSON.stringify(live));

  // ── D ─────────────────────────────────────────────────────────────────────
  await dm.evaluate('document.getElementById("cp-grid-reset").click(); ' + TICK);
  const dialog = await dm.evaluate('({ title: document.getElementById("cd-title").textContent,' +
                                   ' msg: document.getElementById("cd-msg").textContent,' +
                                   ' ok: document.getElementById("cd-ok").textContent })');
  // RED ON: the pass and t() forced to English in i18n.js - 2026-09-29
  rig.check(dialog.title === 'Сбросить настройки?' && dialog.msg.startsWith('Тип, размер') && dialog.ok === 'Сбросить',
    'D: the reset dialog is not Russian: ' + JSON.stringify(dialog));
  await dm.evaluate('document.getElementById("cd-cancel").click(); 0');

  // ── J ─────────────────────────────────────────────────────────────────────
  // RED ON: 'Spell' set back to 'Заклинание' (ru.js) — 2026-10-02
  // ⚠ WIDTH FOR A ONE-LINE LABEL, HEIGHT TOO FOR A TILE NAME: a name may take two lines there,
  // and a line-height of 1 overhangs its box by a pixel of descender, which is no clip.
  const clipped = await dm.evaluate(`(async () => {
    localStorage.setItem('evermist.dockWidth', '230'); _dockWantW = 230; dockLayout();
    const SEL = '.cp-label, .dk-sub, .cp-btn, .cp-segtab, .dk-src .nm, .dk-dd span, .cp-advlbl, ' +
                '.dk-addpic span, .dk-head .cp-adv-title, .pl-sub span, .sb-name';
    const out = [];
    for (const p of ['scene', 'music', 'sounds', 'settings']) {
      dockOpen(p);
      await new Promise(r => setTimeout(r, 60));
      for (const e of document.querySelectorAll('#dock-pane-' + p + ' :is(' + SEL + ')')) {
        if (!e.offsetParent || e.closest('[data-no-i18n]') && !e.classList.contains('sb-name')) continue;
        const tall = e.classList.contains('sb-name') && e.scrollHeight > e.clientHeight + 2;
        if (e.scrollWidth > e.clientWidth + 1 || tall) out.push(p + ': ' + e.textContent.trim());
      }
    }
    dockOpen('scene');
    return out;
  })()`);
  rig.check(clipped.length === 0, 'J: these Russian labels clip at the default dock width: ' + clipped.join(' | '));

  // ── E ─────────────────────────────────────────────────────────────────────
  const counts = await dm.evaluate(`(() => {
    const saved = _muTracks, out = {};
    for (const n of [1, 2, 5, 21]) { _muTracks = Array.from({ length: n }, (_, i) => ({ name: 't' + i })); _muRenderCount();
      out[n] = document.getElementById('mu-filter').placeholder; }
    _muTracks = saved; _muRenderCount();
    return out;
  })()`);
  // RED ON: the pass and t() forced to English in i18n.js - 2026-09-29
  rig.check(counts[1] === 'Фильтр по 1 треку' && counts[2] === 'Фильтр по 2 трекам' &&
            counts[5] === 'Фильтр по 5 трекам' && counts[21] === 'Фильтр по 21 треку',
    'E: the track count does not read in Russian plural forms: ' + JSON.stringify(counts));

  // ── F and G ───────────────────────────────────────────────────────────────
  const scene = await dm.evaluate('document.getElementById("scene-dd-name").textContent');
  // RED ON: I18N_SKIP stripped of data-no-i18n and contenteditable (i18n.js) - 2026-09-29
  rig.check(scene === 'Grid', 'F: the scene named "Grid" reads "' + scene + '" on the Scenes button');

  await dm.evaluate('document.getElementById("btn-combat").click(); ' + TICK);
  await dm.evaluate('document.getElementById("cb-add").click(); ' + TICK);
  const row = await dm.evaluate('cbState.rows[cbState.rows.length - 1].id');
  await dm.evaluate(`(() => { combatRenameFight(cbState, cbState.openId, 'Poisoned'); cbFightsTitle();
    const r = cbState.rows.find(x => x.id === ${JSON.stringify(row)});
    const cell = [...document.querySelectorAll('#cb-list .cb-row')].pop().querySelector('.cb-cell.atk');
    _cbEditAttacks(cell, r);
    const span = cell.querySelector('.cb-atk');
    span.textContent = 'Prone';
    span.dispatchEvent(new Event('input', { bubbles: true }));
    span.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    cbOpenStat(r);
    const name = document.querySelector('#cb-stat [data-p="name"]');
    name.textContent = 'Medium';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    return 0; })(); ${TICK}`);
  // ⚠ THE NEXT KEYSTROKE IS WHAT SAVES A TRANSLATED FIELD: the first input saves before the
  // observer runs, so G only proves anything once the field is read again after a tick.
  await dm.evaluate(`document.querySelector('#cb-stat [data-p="name"]').dispatchEvent(new Event('input', { bubbles: true })); ${TICK}`);
  const own = await dm.evaluate(`(() => { const r = cbState.rows.find(x => x.id === ${JSON.stringify(row)}); return {
    fight: document.querySelector('#cb-fightpick .nm').textContent,
    atkSaved: r.sb.quick, atkShown: [...document.querySelectorAll('#cb-list .cb-row')].pop().querySelector('.cb-atk').textContent,
    statName: document.querySelector('#cb-stat [data-p="name"]').textContent, statSaved: r.sb.name }; })()`);
  // RED ON: I18N_SKIP stripped of data-no-i18n and contenteditable (i18n.js) - 2026-09-29
  rig.check(own.fight === 'Poisoned', 'F: the fight named "Poisoned" reads "' + own.fight + '"');
  rig.check(own.atkShown === 'Prone', 'F: the Attacks line typed as "Prone" reads "' + own.atkShown + '"');
  rig.check(own.statName === 'Medium', 'F: the stat block name typed as "Medium" reads "' + own.statName + '"');
  // RED ON: contenteditable dropped from I18N_SKIP (i18n.js) - 2026-09-29
  rig.check(own.atkSaved === 'Prone' && own.statSaved === 'Medium',
    'G: an editable cell saved something other than what was typed: ' + JSON.stringify(own));

  // ── H ─────────────────────────────────────────────────────────────────────
  const errorsBefore = (dm.errors || []).length;
  await dm.evaluate('delete RU["Reset settings?"]; document.getElementById("cp-grid-reset").click(); ' + TICK);
  const fallback = await dm.evaluate('document.getElementById("cd-title").textContent');
  await dm.evaluate('document.getElementById("cd-cancel").click(); 0');
  // RED ON: _i18nText blanking a text node with no entry (i18n.js) - 2026-09-29
  rig.check(fallback === 'Reset settings?', 'H: a missing entry did not fall back to English: "' + fallback + '"');
  rig.check((dm.errors || []).length === errorsBefore, 'H: a missing entry raised a console error');

  // ── I ─────────────────────────────────────────────────────────────────────
  await dm.evaluate(pick('en'));
  dm = await rig.restart();
  await lib.installHelpers(dm);
  await lib.settle(dm, 'typeof currentScene !== "undefined" && !!currentScene', 30000);
  await dm.evaluate(TICK);
  const back = await dm.evaluate(SAMPLES);
  // RED ON: the switch always storing 'ru' (i18n.js) - 2026-09-29
  rig.check(JSON.stringify(back) === JSON.stringify(english),
    'I: English after switching back differs from the first run: ' + JSON.stringify(back) + ' vs ' + JSON.stringify(english));
  rig.byEye('Russian text fits its buttons, pills and panels, and the wording reads naturally');
};

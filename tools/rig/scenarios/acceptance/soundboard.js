'use strict';

// soundboard.js — THE SOUNDS PILL BESIDE THE MUSIC PILL.
//
// THE GOAL OF THIS FEATURE: a door creak or a dragon roar is one click away during play, over
// the music and never instead of it. The thirty sounds ship inside the app.
//
// THE CRITERIA ARE THIS HEADER. Each lettered line has its checks under a marker carrying its
// letter.
//
//   A. The Sounds pill is on the DM window and ABSENT from the Player.
//   B. The panel is shut at boot, opens on a click with all thirty sounds in six groups across
//      three columns, and shuts on a second click.
//   C. One panel under the pills at a time: opening the sounds shuts the music list, and opening
//      the music list shuts the sounds.
//   D. Every sound in the list decodes, so no file is missing from the build or unreadable.
//   E. A left click plays one more copy over the ones still sounding: two clicks, two copies,
//      the row lit and marked ×2.
//   F. A right click stops the newest copy only, and the mark goes with it.
//   G. A copy that ends on its own leaves the row unlit.
//   H. The volume slider drives the app's own fill and knob, the level, and the saved value.
//   I. The sound actually leaves the speaker, and each one is the sound its name says.
//
// ⚠ SILENT TWICE: run.js launches with `--mute-audio`, and the scenario routes the soundboard's
// output through a zero gain as well. I is therefore rig.byEye.

const lib = require('../../lib');

const MAP_W = 1600, MAP_H = 1000;

const rowCount = "document.querySelectorAll('#sb-cols .sb-row').length";
const shown = id => `getComputedStyle(document.getElementById('${id}')).display`;
const row = file => `document.querySelector('#sb-cols [data-file="${file}"]')`;

module.exports = async function soundboardFeature(rig) {
  const dm = rig.dm;
  await lib.openMap(rig, { w: MAP_W, h: MAP_H });

  // ── A. On the DM, absent from the Player ───────────────────────────────────
  // RED ON: `body.player-mode #music-anchor` renamed in music.css — 2026-10-01
  await dm.waitFor("!!document.getElementById('btn-sb-open')", 30000, 'the Sounds pill to exist');
  rig.check(await dm.evaluate("document.getElementById('btn-sb-open').getBoundingClientRect().width > 0"),
    'the Sounds pill has no width on the DM window, so there is nothing to click');
  const player = await rig.player();
  rig.check(await player.evaluate(`(() => {
    const b = document.getElementById('btn-sb-open');
    return !b || b.getBoundingClientRect().width === 0;
  })()`), 'the Sounds pill shows on the Player, which must carry no UI at all');

  // ── B. Shut at boot, thirty in six groups, toggled by the pill ─────────────
  // RED ON: the pill's click handler made `_sbSetOpen(true || !_sbOpen)` (soundboard.js) — 2026-10-01
  rig.check(await dm.evaluate(shown('sb-panel')) === 'none',
    'the sounds panel is open before anyone clicked the pill');
  await dm.evaluate("document.getElementById('btn-sb-open').click()");
  // Silenced at the first moment the context exists, before any sound can start.
  await dm.evaluate(`(() => {
    _sbMaster.disconnect();
    const zero = _sbCtx.createGain(); zero.gain.value = 0;
    _sbMaster.connect(zero); zero.connect(_sbCtx.destination);
    return 0;
  })()`);
  rig.check(await dm.evaluate(shown('sb-panel')) === 'flex', 'a click on the Sounds pill did not open the panel');
  const layout = await dm.evaluate(`(() => ({
    rows: ${rowCount},
    cols: document.querySelectorAll('#sb-cols .sb-col').length,
    caps: [...document.querySelectorAll('#sb-cols .sb-cap')].length,
    lit: document.getElementById('btn-sb-open').classList.contains('sb-pill-on'),
  }))()`);
  rig.check(layout.rows === 30, 'the panel lists ' + layout.rows + ' sounds, not thirty');
  rig.check(layout.cols === 3 && layout.caps === 6,
    'the panel has ' + layout.cols + ' columns and ' + layout.caps + ' group captions, not three and six');
  rig.check(layout.lit, 'the Sounds pill does not light while its panel is open');
  await dm.evaluate("document.getElementById('btn-sb-open').click()");
  rig.check(await dm.evaluate(shown('sb-panel')) === 'none', 'a second click on the Sounds pill did not shut the panel');

  // ── C. One panel at a time ─────────────────────────────────────────────────
  // RED ON: the `_muSetOpen(false)` call in `_sbSetOpen` gated off with `false &&` (soundboard.js) — 2026-10-01
  await dm.evaluate("document.getElementById('btn-mu-chev').click()");
  await dm.evaluate("document.getElementById('btn-sb-open').click()");
  rig.check(await dm.evaluate(shown('mu-panel')) === 'none',
    'opening the sounds left the music list open under it');
  await dm.evaluate("document.getElementById('btn-mu-open').click()");
  rig.check(await dm.evaluate(shown('sb-panel')) === 'none',
    'opening the music list left the sounds panel open under it');
  await dm.evaluate("document.getElementById('btn-mu-open').click()");
  await dm.evaluate("document.getElementById('btn-sb-open').click()");

  // ── D. Every file decodes ──────────────────────────────────────────────────
  // RED ON: `rats.mp3` renamed `rats-x.mp3` in soundList.js — 2026-10-01
  const decoded = await dm.evaluate(`Promise.all(SOUND_GROUPS.flatMap(g => g.sounds).map(s =>
    _sbBuffer(s.file).then(b => b.duration > 0 ? null : s.file, () => s.file)))
    .then(r => r.filter(Boolean))`);
  rig.check(decoded.length === 0, 'these sounds do not decode: ' + decoded.join(', '));

  // ── E. A left click adds a copy ────────────────────────────────────────────
  // RED ON: `_sbPlay` returning while a copy of the same sound plays (soundboard.js) — 2026-10-01
  await dm.evaluate(row('bell.mp3') + '.click()');
  await dm.evaluate(row('bell.mp3') + '.click()');
  await dm.waitFor("(_sbPlaying['bell.mp3'] || []).length === 2", 10000, 'two copies of the bell');
  const twice = await dm.evaluate(`(() => ({
    lit: ${row('bell.mp3')}.classList.contains('sb-row-on'),
    mark: ${row('bell.mp3')}.querySelector('.sb-count').textContent,
  }))()`);
  rig.check(twice.lit, 'the bell row is not lit while two copies sound');
  rig.check(twice.mark === '×2', 'the bell row reads "' + twice.mark + '" with two copies, not ×2');

  // ── F. A right click stops the newest only ─────────────────────────────────
  // RED ON: `list.pop()` made `list.shift()` in `_sbStopNewest` (soundboard.js) — 2026-10-01
  const oldest = await dm.evaluate("_sbPlaying['bell.mp3'][0].start");
  await dm.evaluate(row('bell.mp3') + ".dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))");
  const once = await dm.evaluate(`(() => ({
    n: (_sbPlaying['bell.mp3'] || []).length,
    first: (_sbPlaying['bell.mp3'] || [{}])[0].start,
    mark: ${row('bell.mp3')}.querySelector('.sb-count').textContent,
  }))()`);
  rig.check(once.n === 1, 'a right click left ' + once.n + ' copies of the bell, not one');
  rig.check(once.first === oldest, 'a right click stopped the older copy rather than the newest');
  rig.check(once.mark === '', 'the ×2 mark stayed on the bell row with one copy left');
  await dm.evaluate(row('bell.mp3') + ".dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))");

  // ── G. A copy that ends leaves the row unlit ───────────────────────────────
  // RED ON: the `list.splice` in a copy's `onended` gated off with `false &&` (soundboard.js) — 2026-10-01
  await dm.evaluate(row('trap.mp3') + '.click()');
  await lib.settle(dm, "!_sbPlaying['trap.mp3'] && !" + row('trap.mp3') + ".classList.contains('sb-row-on')", 10000);
  rig.check(await dm.evaluate("!_sbPlaying['trap.mp3']"), 'the trap sound never finished, so its copy is still listed');
  rig.check(await dm.evaluate('!' + row('trap.mp3') + ".classList.contains('sb-row-on')"),
    'the trap row stays lit after its sound ended');

  // ── H. The volume slider ───────────────────────────────────────────────────
  // RED ON: the gain write in `_sbSetVolume` gated off with `false &&` (soundboard.js) — 2026-10-01
  await lib.fire(dm, 'sb-vol', 35, 'input');
  const vol = await dm.evaluate(`(() => {
    const wrap = document.getElementById('sb-vol').closest('.cp-slider');
    return {
      fill: wrap.querySelector('.cp-slider-fill').style.width,
      knob: wrap.querySelector('.cp-slider-knob').style.left,
      gain: _sbMaster.gain.value,
      saved: localStorage.getItem('evermist.sounds.volume'),
    };
  })()`);
  rig.check(vol.fill === '35%' && vol.knob === '35%',
    'the sounds slider drew its fill at ' + vol.fill + ' and its knob at ' + vol.knob + ', not 35%');
  rig.check(Math.abs(vol.gain - 0.35) < 0.001, 'the sounds slider set the level to ' + vol.gain + ', not 0.35');
  rig.check(vol.saved === '0.35', 'the sounds volume was saved as ' + vol.saved + ', not 0.35');

  // ── I. By ear ──────────────────────────────────────────────────────────────
  rig.byEye('each sound leaves the speaker, over the music, and is the sound its name says');
};

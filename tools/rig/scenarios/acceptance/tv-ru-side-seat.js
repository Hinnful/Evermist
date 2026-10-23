'use strict';

// tv-ru-side-seat.js - THE MINIMAP'S RUSSIAN LABELS ON A SIDE SEAT.
//
// THE GOAL OF THIS FEATURE: a Russian DM in a side chair has a narrow minimap, and its one button
// and its pill still read as Russian words: Show on TV shortens to "Показать на ТВ" and goes
// small, and the live pill gives up Stop's word before it ever shows English or an empty label.
//
//   A. After a restart in Russian, seats 90 and 270 with the TV off: Show on TV reads exactly
//      "Показать на ТВ", is small, and has no icon.
//   B. The same seats with the TV live: the pill says "Показ", Stop has no word, and the tooltip
//      is the whole Russian sentence.
//
// The rig's geometry leaves a side-seat minimap wide enough for every word, so the DM's TV is a
// 21:9 ultrawide here (A: the listed screen, B: the shape the Player reports), which is what makes
// the minimap narrow.

const lib = require('../../lib');

const q = sel => 'document.querySelector(' + JSON.stringify(sel) + ')';
const TICK = 'new Promise(r => setTimeout(r, 30))';

module.exports = async function tvRuSideSeat(rig) {
  let dm = rig.dm;
  await lib.openMap(rig, { w: 900, h: 600 });
  await dm.evaluate('document.querySelector(\'.about-lang [data-lang="ru"]\').click(); ' + TICK);
  rig.check(await dm.evaluate('localStorage.getItem("evermist-lang")') === 'ru', 'the Russian choice was not stored, so every check below would read English');

  dm = await rig.restart();
  await lib.installHelpers(dm);
  await lib.settle(dm, 'typeof currentScene !== "undefined" && !!currentScene', 30000);
  await dm.evaluate(TICK);
  rig.check(await dm.evaluate('I18N_LANG') === 'ru', 'the app did not come up in Russian');

  // The DM's TV is a 21:9 ultrawide: the minimap takes the TV's shape, so seated at 90/270 it is as
  // narrow as the app ever makes it. The machine's own screens never decide a check.
  // ⚠ One real read first: a read the app started before the stub answers after it and puts the
  // machine's own screens back. Reads answer in order, so awaiting a new one outlasts them.
  await dm.evaluate(`(async () => {
    await _tvLoadDisplays();
    _tvLoadDisplays = async () => {};
    _tvDmId = 1;
    _tvDisplays = [
      { id: 1, label: 'Laptop', internal: true, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, size: { width: 1920, height: 1080 } },
      { id: 2, label: 'Ultrawide TV', internal: false, bounds: { x: 1920, y: 0, width: 3440, height: 1440 }, size: { width: 3440, height: 1440 } },
    ];
    localStorage.removeItem(TV_SCREEN_KEY);
    _tvScreenPick = null; _tvKey = ''; tvRefresh(); return 0;
  })()`);

  const refresh = () => dm.evaluate('_tvKey = ""; refreshPlayerControlUI(); ' + TICK);
  const seatTo = async seat => {
    await dm.evaluate('setSeatTurn(' + seat + '); 0');
    // ⚠ The 21:9 shape, not just upright: a 16:9 minimap is upright too, and reading it before the
    // ultrawide shape lands finds the label still fitting.
    await lib.settle(dm, '(p => p.offsetWidth / p.offsetHeight < 0.5)(document.getElementById("minimap-panel"))', 6000);
    await refresh();
  };

  // ── A ──
  // RED ON: the short Russian label dropped (_tvGoFit >= 2 && I18N_LANG === 'ru' -> false) (tvControl.js) - 2026-10-23
  // RED ON: Show on TV's small class dropped (_tvGoFit >= 3 ? ' small' -> '') (tvControl.js) - 2026-10-23
  for (const seat of [90, 270]) {
    await seatTo(seat);
    const off = await dm.evaluate(`(() => { const g = ${q('#tv-ui .tv-go')};
      return g ? { text: g.textContent, small: g.classList.contains('small'), icon: !!g.querySelector('.tv-ic'), fit: _tvGoFit } : null; })()`);
    rig.check(!!off && off.text === 'Показать на ТВ' && off.small && !off.icon && off.fit === 3,
      'A: at seat ' + seat + ' with the TV off, Show on TV is not the short small Russian label: ' + JSON.stringify(off));
  }

  // ── B ──
  // RED ON: Stop's word kept a step longer (_tvFit < 4 -> _tvFit < 3 in tvRefresh) (tvControl.js) - 2026-10-23
  // RED ON: the pill's short label dropped (_tvFit >= 3 ? t('Live') -> false) (tvControl.js) - 2026-10-23
  const player = await rig.player();
  // The live minimap takes the shape of the screen the Player reports. The Player sends the same
  // message when its window is dragged to a wide shape, so say that one from the Player itself.
  await player.evaluate('playerReplyTarget().postMessage({ type: "PLAYER_SCREEN", screenW: 3440, screenH: 1440 }, "*"); 0');
  await lib.settle(dm, 'playerScreenW === 3440', 6000);
  for (const seat of [90, 270]) {
    await seatTo(seat);
    const live = await dm.evaluate(`(() => { const lv = ${q('#tv-ui .tv-grp .lv')};
      return lv ? { state: lv.querySelector('.st').textContent, stop: lv.querySelector('.ac').textContent, title: lv.title, fit: _tvFit } : null; })()`);
    rig.check(!!live && live.state === 'Показ' && live.stop === '' && live.fit === 4 &&
      live.title === 'Идёт показ в окне. Остановить показ',
      'B: at seat ' + seat + ' with the TV live, the pill is not "Показ" with a wordless Stop: ' + JSON.stringify(live));
  }
};

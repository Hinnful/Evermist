'use strict';

// stat-block-clip.js — AN ATTACK PILL KEEPS ITS OWN HEIGHT BESIDE A MULTIATTACK GROUP.
//
// THE GOAL: a long Russian stat block (the Vroc, MM2024) shows its attacks in the fight table as pills,
// and a pill that shares a line with the bordered Multiattack group is drawn at its own height, not
// stretched to the group's. Seen 2026-10-16 on "Споры": a taller block with its bottom cut square.
//
//   A. Every pill in the Attacks cell lies inside the cell.
//   B. A pill is as tall as its own tallest segment, whatever shares its line.

const lib = require('../../lib');

const VROC = {
  name: 'Врок', meta: 'Большой фиенд (демон), хаотично-злой', ac: '15', hp: '152 (16d10 + 64)', speed: '40 фт., летая 60 фт.',
  cr: '6', source: 'MM2024',
  secs: {
    Actions: [
      { n: 'Мультиатака', t: 'Врок совершает две атаки Измельчением.' },
      { n: 'Измельчение', t: 'Бросок рукопашной атаки: +6, досягаемость 10 фт. Попадание: 10 (2d6 + 3) Режущего урона плюс 10 (3d6) урона Ядом.' },
      { n: 'Споры (Перезарядка 6)', t: 'Спасбросок Телосложения: СЛ 15, каждое существо в 15-футовом излучении Врока. Провал: 5 (1d10) урона Ядом, и цель Отравлена на 1 минуту.' },
      { n: 'Ошеломляющий вопль (1/День)', t: 'Спасбросок Телосложения: СЛ 15, каждое существо в 20-футовом излучении Врока. Провал: 10 (3d6) урона Психической энергией, и цель Ошеломлена до конца следующего хода Врока.' },
    ],
  },
};

const OWN_HELPERS = `
globalThis.__pillGeo = () => [...document.querySelectorAll('#cb-list .cb-cell.atk')].map(c => {
  const cr = c.getBoundingClientRect();
  return { scroll: c.scrollHeight, client: c.clientHeight,
    pills: [...c.querySelectorAll('.cb-pill')].map(p => {
      const r = p.getBoundingClientRect(), segs = Math.max(...[...p.children].map(s => s.getBoundingClientRect().height));
      return { t: p.textContent.slice(0, 16), h: r.height, segs, out: r.bottom > cr.bottom + 0.5 || r.top < cr.top - 0.5 || r.right > cr.right + 0.5 };
    }) };
});
0`;

module.exports = async function statBlockClipFeature(rig) {
  const dm = rig.dm;
  await lib.openMap(rig, { w: 1200, h: 800 });
  await dm.evaluate(OWN_HELPERS);

  await dm.evaluate('document.getElementById("btn-combat").click(); 0');
  await dm.evaluate(`(() => { document.getElementById('cb-add').click();
    const row = [...document.querySelectorAll('#cb-list .cb-row')].pop(), inp = row.querySelector('[data-f=name]');
    inp.focus(); inp.value = ${JSON.stringify(VROC.name)}; inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    const r = cbState.rows.find(x => x.name === ${JSON.stringify(VROC.name)}); r.sb = Object.assign(combatBlankBlock('', ${JSON.stringify(VROC.name)}), ${JSON.stringify(VROC)});
    const f = document.getElementById('cb-fight'); f.style.setProperty('--cb-name', '120px'); f.style.setProperty('--cb-hp', '90px'); f.style.setProperty('--cb-cond', '80px'); f.style.setProperty('--cb-atk', '400px');
    cbRender(); return 0; })()`);
  const cells = await dm.evaluate('__pillGeo()');
  const pills = cells.flatMap(c => c.pills);
  rig.note('pills: ' + JSON.stringify(pills));

  // A. every pill inside its cell
  // RED BY DESIGN: written to fail on a pill outside its cell; the stretch below is what was reproduced
  rig.check(pills.length === 3 && pills.every(p => !p.out), 'a pill lies outside the Attacks cell: ' + JSON.stringify(pills));

  // B. a pill keeps its own height
  // RED ON: align-items: center removed from .cb-atk.pills (combat.css) - 2026-10-16
  rig.check(pills.every(p => Math.abs(p.h - p.segs) < 0.5), 'a pill is taller than its own segments, stretched by its line: ' + JSON.stringify(pills));
};

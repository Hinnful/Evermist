// The interface's inventory: every window, pop-up, menu, dialog and toast of the DM window, and the states each
// can be in. The `design-sweep` scenario opens every entry in every state and checks it (docs/PROCESS.md,
// "Building"). A new surface gets its entry in the same change; an entry that does not open fails the sweep, and so
// does a surface with a pop or window shadow that shows without one.
//
// An entry: id; root, the selector that wraps it once open; motion, its kind in design-system.md's Motion table
// (`still` for what never opens or closes); prep, page JS (bare globals) that readies what the entry needs and is
// let settle first; trigger, what the sweep clicks to open it: a selector, `{ sel, button: 'right' }` for a
// right-click, `{ map: n }` for a click inside the open map's n-th room, or the point `{ x, y }` its code opens it
// at; open, page JS that opens it when no click does; from, for a surface code opens, the control it still comes
// from; close, page JS; states, each { name, set } run in order on the open entry (the first is usually rest);
// shifts, each { name, run, except, root } checked for boxes that move when run; menu, a right-click menu whose size
// is compared with the others; below, extra height for a close-up whose list opens under the root; kin, a selector
// of other surfaces this entry stands for (every hint, for one).

// The library every entry draws from: monsters of several types and sources, a fight with pills of every kind,
// an ally, a condition and a defeated row, and the plan's rooms drawn on the open map.
const SETUP = `
  const wait = async (fn, ms) => { for (let t = 0; t < ms && !fn(); t += 100) await new Promise(r => setTimeout(r, 100)); };
  [['Ааракокра-аэромант', '4', 'Средний гуманоид'], ['Аболет', '10', 'Большая аберрация'], ['Огр', '2', 'Большой великан'],
   ['Призрак', '5', 'Средняя нежить'], ['Дракон белый, взрослый', '13', 'Огромный дракон'], ['Óни', '7', 'Большой великан']]
    .forEach(([n, cr, meta], i) => { const b = cbNewBlock(n); b.source = i % 2 ? 'MM24' : 'MM14'; b.cr = cr; b.meta = meta;
      b.ac = '15 (природный доспех)'; b.hp = String(40 + i * 11) + ' (6к10+12)'; });
  const act = (n, t) => ({ n, t });
  [['Огр', [act('Мультиатака', 'Огр совершает две атаки Палицей.'), act('Палица', 'Рукопашная атака оружием: +6 к попаданию, досягаемость 5 фт. Попадание: 13 (2к8+4) дробящего урона.')], [], 'enemy', []],
   ['Призрак', [act('Касание жизни', 'Рукопашная атака: +6 к попаданию, досягаемость 5 фт. Попадание: 21 (4к8+3) некротического урона.')],
     [act('Шаг в тень', 'Рукопашная атака: +6 к попаданию, досягаемость 5 фт. Попадание: 7 (2к6) урона холодом.')], 'enemy', ['Poisoned']],
   ['Страж', [act('Копьё', 'Рукопашная атака оружием: +3 к попаданию. Попадание: 4 (1к6+1) колющего урона.')], [], 'ally', []]]
    .forEach(([name, acts, bonus, side, conds]) => cbState.rows.push({ id: cbState.nextId++, init: String(10 + cbState.rows.length), name, hp: '', ac: '12',
      conds, side, sbChanged: false, sb: Object.assign(combatBlankBlock('', name), { hp: '30', ac: '12', secs: { Actions: acts, 'Bonus actions': bonus } }) }));
  cbSave(true);
  dockOpen('sounds'); await _sbDelete(document.querySelector('#sb-cols .sb-row').dataset.libKey, true);
  document.getElementById('btn-floorplan').click();
  await wait(() => polygons.length > 0, 20000);
  hideFloorPlanNotice();
`;

const ROW_AT = '{ left: 400, top: 300, bottom: 300, right: 400 }';
const CLOSE_ALL = 'libCloseMenu(); ntCloseMenu(); cbCloseMenu(); _bsClosePop(); worldMapMenuClose(); _tbCloseList();';

const INVENTORY = [
  // ── The dock ──
  { id: 'dock-rail', root: '#dock', motion: 'still', open: "dockOpen(null);" },
  { id: 'dock-map-settings', root: '#dock-pane-scene', motion: 'pane', prep: 'dockOpen(null);', trigger: '#dock-tab-scene', close: 'dockOpen(null);',
    states: [{ name: 'rest', set: '' }, { name: 'grid on', set: "document.getElementById('cp-grid-switch').click();" }] },
  { id: 'dock-music', root: '#dock-pane-music', motion: 'pane', prep: 'dockOpen(null);', trigger: '#dock-tab-music',
    states: [{ name: 'rest', set: '' }, { name: 'filter, no hits', set: "const f = document.getElementById('mu-filter'); f.value = 'zzq'; f.dispatchEvent(new Event('input'));" }],
    close: "const f = document.getElementById('mu-filter'); f.value = ''; f.dispatchEvent(new Event('input')); dockOpen(null);" },
  { id: 'dock-sounds', root: '#dock-pane-sounds', motion: 'pane', prep: 'dockOpen(null);', trigger: '#dock-tab-sounds',
    states: [{ name: 'rest', set: '' }, { name: 'filter', set: "const f = document.getElementById('sb-filter'); f.value = 'двер'; f.dispatchEvent(new Event('input'));" }],
    close: "const f = document.getElementById('sb-filter'); f.value = ''; f.dispatchEvent(new Event('input')); dockOpen(null);" },
  { id: 'dock-pictures', root: '#dock-pane-gallery', motion: 'pane', prep: 'dockOpen(null);', trigger: '#dock-tab-gallery', close: 'dockOpen(null);' },
  { id: 'dock-settings', root: '#dock-pane-settings', motion: 'pane', prep: 'dockOpen(null);', trigger: '#dock-tab-settings', close: 'dockOpen(null);' },
  { id: 'pop-grid-colour', root: '#cp-pop-grid', motion: 'pane', prep: "dockOpen('scene');", trigger: '#cp-grid-custom', close: 'dockClosePop();' },
  { id: 'pop-trash', root: '#sy-trash-pop', motion: 'pane', prep: "dockOpen('settings'); await new Promise(r => setTimeout(r, 600));", trigger: '#sy-trash-open', close: 'dockClosePop();' },
  { id: 'menu-music-add', root: '.lib-menu', motion: 'menu', prep: "dockOpen('music');", trigger: '#btn-mu-add', close: 'libCloseMenu();', menu: true,
    states: [{ name: 'rest', set: '' }, { name: 'a row ticked', set: "document.querySelector('.lib-menu .sm-mi').classList.add('on');" }] },
  { id: 'music-download', root: '#mu-modal', motion: 'window', from: '#dock-tab-music', open: 'openMusicDownload();', close: '_muCloseDownload();',
    states: [{ name: 'rest', set: '' },
      { name: 'list', set: "_muLookup = { title: 'Плейлист', entries: [{ id: 'a', title: 'Таверна', duration: 200 }, { id: 'b', title: 'Битва', have: true }, { id: 'c', title: 'Ошибка', failed: true }] }; _muPicked.add('a'); _muRenderLookup();" },
      { name: 'error', set: "_muSetStatus('Не удалось прочитать ссылку', true);" }] },
  { id: 'module-text', root: '#mt-modal', motion: 'window', from: '#dock-tab-settings', open: 'openModuleTextModal();', close: 'closeModuleTextModal();' },
  { id: 'tv-help', root: '#tv-pop', motion: 'popup', from: '#tv-go', open: "_tvOpen('help');", close: '_tvClose(); tvRefresh();' },
  { id: 'tv-setup', root: '#tv-setup .sm-win', motion: 'window', trigger: '#tv-ui [data-tv-more]', close: '_tvSetupClose();',
    states: [{ name: 'rest', set: '' }, { name: 'screen list', set: '_tvSetupDd = true; _tvSetupRender();' }] },
  { id: 'minimap', root: '#minimap-panel', motion: 'still', open: '' },

  // ── The bar and the rows above it ──
  { id: 'toolbar', root: '#toolbar-bottom', motion: 'still', open: '' },
  { id: 'list-shape', root: '#tb-dd', motion: 'menu', trigger: '#tb-grp-shape .tb-chev', close: '_tbCloseList();' },
  { id: 'effects-row', root: '#context-row', motion: 'bar', trigger: '#btn-effects', close: 'effectsToolLeave();' },
  { id: 'list-effect-shape', root: '#tb-dd', motion: 'menu', prep: 'effectsToolEnter();', trigger: '#context-row .fx-chev', close: '_tbCloseList(); effectsToolLeave();' },
  { id: 'material-palette', root: '#mat-pal', motion: 'menu', prep: 'effectsToolEnter();', trigger: '#mat-pick .mt-btn',
    states: [{ name: 'rest', set: '' }, { name: 'search', set: "const f = document.getElementById('mat-find'); f.value = 'лёд'; f.dispatchEvent(new Event('input'));" }],
    close: 'materialPaletteClose(); effectsToolLeave();' },
  { id: 'room-switcher', root: '#room-fog', motion: 'popup', prep: "dockOpen(null); setPlaceMode('rooms'); setShape('select'); selectedPolygonId = null; scheduleRender();",
    trigger: { map: 0 }, close: 'selectedPolygonId = null; scheduleRender();' },
  { id: 'edit-row', root: '#edit-row', motion: 'bar', open: "setShape('select'); selectedPolygonId = polygons[0].id; editRowEnter(); scheduleRender();",
    states: [{ name: 'rest', set: '' }, { name: 'pen', set: "editTool = 'pen'; _erKey = ''; refreshEditRow();" }],
    close: 'editRowClose(); selectedPolygonId = null; scheduleRender();' },
  { id: 'shortcut-legend', root: '#shortcut-legend', motion: 'window', trigger: '#btn-help', close: 'toggleLegend();' },

  // ── Notes ──
  { id: 'notes', root: '#notes-window', motion: 'window', trigger: '#dock-tab-notes',
    states: [{ name: 'campaign', set: "notesShow({ kind: 'campaign' });" }, { name: 'map', set: "ntGoKey('map:' + currentScene.id);" },
      { name: 'room', set: 'selectedPolygonId = polygons[0].id; scheduleRender(); refreshRoomPanel();' }],
    close: 'selectedPolygonId = null; nwHide();' },
  { id: 'menu-notes-row', root: '.lib-menu', motion: 'menu', menu: true, close: 'libCloseMenu(); nwHide();',
    prep: 'nwShow();', trigger: { sel: '#nw-tl .nw-row[data-lib-key^="map:"]', button: 'right' } },
  { id: 'menu-notes-new', root: '.nw-menu', motion: 'menu', menu: true, close: 'ntCloseMenu(); nwHide();', prep: 'nwShow();', trigger: { x: 300, y: 300 },
    open: "ntMenuAt({ x: 300, y: 300 }, [{ label: 'Фракция', run() {} }, { label: 'Лор', run() {} }, { sep: true }, { label: 'Удалить', danger: true, off: true, hint: 'Сначала откройте карту', run() {} }]);" },

  // ── The Bestiary ──
  { id: 'bestiary', root: '#bs-panel', motion: 'window', trigger: '#btn-bestiary',
    states: [{ name: 'rest', set: 'bestiaryRender();' },
      { name: 'ticked', set: 'Object.keys(cbState.blocks).slice(0, 2).forEach(id => bs.picked.add(id)); bestiaryRender();' },
      { name: 'page', set: "bs.picked.clear(); _bsShow(Object.values(cbState.blocks).find(b => b.name === 'Ааракокра-аэромант').id);" },
      { name: 'page end', set: "notesCampaignSet('Встреча: ' + mpToken('Ааракокра-аэромант', 'monster', mxMonsterUid(cbState.blocks[bs.open]))); mxBump(); bpAppearsSync(); document.querySelector('#bs-page .bs-page-body').scrollTop = 1e6;" },
      { name: 'page editing', set: 'bs.editing = true; _bsRenderPage();' },
      { name: 'medium width', set: "bs.editing = false; document.getElementById('bs-panel').style.width = '700px'; bswdApply(); bestiaryRender();" },
      { name: 'nothing matches', set: "document.getElementById('bs-panel').style.width = '1000px'; bswdApply(); bs.f.q = 'zzz'; bestiaryRender();" }],
    shifts: [{ name: 'a tick', root: '#bs-table', except: '.bs-cb',
      run: "bs.f.q = ''; bs.picked.clear(); bestiaryRender(); await new Promise(r => setTimeout(r, 50)); __rigBefore = __rigSurface.snap('#bs-table'); bs.picked.add(Object.keys(cbState.blocks)[2]); bestiaryRender();" }],
    close: "bs.f.q = ''; bs.picked.clear(); bestiaryRender(); bestiarySetOpen(false);" },
  { id: 'filter-list', root: '.bs-pop', motion: 'menu', prep: 'bestiarySetOpen(true);', from: '#bs-panel [data-filter=type]',
    open: "_bsFilterPop(document.querySelector('#bs-panel [data-filter=type]'), 'type');",
    states: [{ name: 'rest', set: '' }, { name: 'ticked', set: "document.querySelector('.bs-pop .o').click();" }],
    close: "bs.f.type = []; _bsClosePop(); bestiaryRender(); bestiarySetOpen(false);" },
  { id: 'filter-range', root: '.bs-pop', motion: 'menu', below: 380, prep: 'bestiarySetOpen(true);', from: '#bs-panel [data-filter=cr]',
    open: "_bsFilterPop(document.querySelector('#bs-panel [data-filter=cr]'), 'cr');",
    states: [{ name: 'rest', set: '' }, { name: 'list open', set: "document.querySelector('.bs-pop select[data-r=\"1\"]').showPicker();" }],
    close: "document.querySelector('.bs-pop select[data-r=\"1\"]').blur(); _bsClosePop(); bestiarySetOpen(false);" },
  { id: 'bestiary-import-menu', root: '.bs-menu', motion: 'menu', prep: 'bestiarySetOpen(true);', from: '#bs-panel [data-a=import]',
    open: "_bsImportMenu(document.querySelector('#bs-panel [data-a=import]'));", close: '_bsClosePop(); bestiarySetOpen(false);' },
  { id: 'bestiary-import-bar', root: '.bs-importbar', motion: 'still', prep: 'bestiarySetOpen(true);', open: 'bs.importing = true; bestiaryRender();',
    states: [{ name: 'rest', set: '' },
      { name: 'queue', set: "cbImportQueue.push({ id: 9, state: 'failed', url: 'https://example.org/goblin', why: 'Это не страница монстра', host: 'example.org' }, { id: 10, state: 'reading', url: 'https://example.org/orc', host: 'example.org' }); bestiaryRender();" }],
    close: 'cbImportQueue.length = 0; bs.importing = false; bestiaryRender(); bestiarySetOpen(false);' },
  { id: 'bestiary-copy', root: '#bs-page', motion: 'window', from: '#btn-bestiary', prep: 'cbSetOpen(true);', open: 'bcOpen(cbState.rows[0]);',
    states: [{ name: 'rest', set: '' }, { name: 'changed', set: 'cbState.rows[0].sbChanged = true; _bsRenderPage();' }],
    close: 'cbState.rows[0].sbChanged = false; bcClose(); bestiarySetOpen(false); cbSetOpen(false);' },

  // ── The fight table ──
  { id: 'fight', root: '#cb-fight', motion: 'window', trigger: '#btn-combat',
    states: [{ name: 'rest', set: '' }, { name: 'defeated fold', set: "cbState.rows[0].hp = '-999'; cbRender(); cbCleanUp(); cbToggleFold();" }],
    close: "cbState.rows.forEach(r => { r.hp = ''; delete r.cleaned; }); cbRender(); cbSetOpen(false);" },
  { id: 'menu-fight-row', root: '#cb-menu', motion: 'menu', menu: true, prep: 'cbSetOpen(true);', trigger: { x: 400, y: 300 },
    open: 'cbMenu(_cbRowItems(cbState.rows[1]), ' + ROW_AT + ');', close: 'cbCloseMenu(); cbSetOpen(false);' },
  { id: 'menu-conditions', root: '#cb-menu', motion: 'menu', prep: 'cbSetOpen(true);', trigger: { x: 400, y: 300 },
    open: '_cbCondMenu(cbState.rows[1], ' + ROW_AT + ');',
    shifts: [{ name: 'a tick', except: '.box', run: "document.querySelectorAll('#cb-menu [data-i]')[2].click();" }],
    close: 'cbCloseMenu(); cbSetOpen(false);' },
  { id: 'fight-picker', root: '#cf-menu', motion: 'menu', prep: 'cbSetOpen(true);', trigger: '#cb-fightpick',
    states: [{ name: 'rest', set: '' },
      { name: 'one on TV', set: 'initiativeTvSet(true); combatAddFight(cbState, combatFightId); cbSave(); cbRender(); cbFightsTitle();' }],
    close: "initiativeTvSet(false); const f = cbState.fights[cbState.fights.length - 1]; if (cbState.fights.length > 1 && f.name === 'New fight') " +
      '{ combatOpenFight(cbState, cbState.fights[0].id); cbState.fights.pop(); cbSave(); cbRender(); cbFightsTitle(); } cbCloseFights(); cbSetOpen(false);' },
  { id: 'fight-suggestions', root: '#cb-suggest', motion: 'still', prep: 'cbSetOpen(true);', open: "const i = document.getElementById('cb-search'); i.focus(); i.value = 'а'; _cbSearch(i);",
    close: "_cbSuggestClose(); document.getElementById('cb-search').value = ''; cbSetOpen(false);" },

  // ── The Campaign ──
  { id: 'campaign', root: '#wm', motion: 'layer', trigger: '#btn-world',
    states: [{ name: 'rest', set: '' }, { name: 'picked', set: "worldMapSelect({ sceneId: currentScene.id, place: '' });" }],
    close: "worldMapSelect({ sceneId: null, place: '' }); worldMapHide();" },
  { id: 'menu-campaign-map', root: '.wm-menu', motion: 'menu', menu: true, close: 'worldMapMenuClose(); worldMapHide();',
    prep: 'worldMapShow(); await new Promise(r => setTimeout(r, 1200));', trigger: { x: 300, y: 300 },
    open: "worldMapMenuOpen({ target: _wmEls.get('c' + currentScene.id), clientX: 300, clientY: 300, preventDefault() {}, stopPropagation() {} });" },
  { id: 'menu-campaign-ground', root: '.wm-menu', motion: 'menu', close: 'worldMapMenuClose(); worldMapHide();',
    prep: 'worldMapShow(); await new Promise(r => setTimeout(r, 1200));', trigger: { x: 60, y: 500 },
    open: "worldMapMenuOpen({ target: document.getElementById('wm'), clientX: 60, clientY: 500, preventDefault() {}, stopPropagation() {} });" },

  // ── Search ──
  { id: 'search', root: '#sr-box', motion: 'dialog', trigger: '#tb-find',
    states: [{ name: 'empty', set: '' }, { name: 'results', set: "_srInput.value = 'Огр'; _srTyped();" }, { name: 'no results', set: "_srInput.value = 'zzzq'; _srTyped();" }],
    close: 'searchClose();' },

  // ── Dialogs, toasts, hints ──
  { id: 'dialog-delete', root: '#cd-modal', motion: 'dialog', close: '_cdClose(false);',
    open: "confirmDialog({ title: 'Удалить карту?', message: 'Карта уйдёт в корзину на 30 дней.', confirmLabel: 'Удалить', danger: true, onConfirm() {} });" },
  { id: 'dialog-confirm', root: '#cd-modal', motion: 'dialog', close: '_cdClose(false);',
    open: "confirmDialog({ title: 'Заменить комнаты?', message: 'На карте уже есть комнаты.', confirmLabel: 'Заменить', onConfirm() {} });" },
  { id: 'dialog-message', root: '#cd-modal', motion: 'dialog', close: '_cdClose(true);',
    open: "messageDialog({ title: 'Не удалось открыть файл', message: 'Файл повреждён или это не карта.' });" },
  { id: 'dialog-first-sync', root: '#cd-modal', motion: 'dialog', close: '_cdOnConfirm = _cdOnCancel = null; _cdClose(false);',
    open: '_ssAskFirst({ here: 3, maps: 5, computers: 1 });' },
  { id: 'toast-undo', root: '#scene-undo-toast', motion: 'toast', open: "showUndoToast('«Склеп» в корзине', () => {}, false);", close: 'hideUndoToast();' },
  { id: 'toast-notice', root: '#notice-toast', motion: 'toast', open: "noticeToast('Карта сохранена');", close: 'hideToast(_noticeEl);' },
  { id: 'toast-update', root: '#up-toast', motion: 'toast', open: "upToast('Обновлено до 9.9.9', 'Что нового', () => {}, 0);", close: 'hideUpdateToast();' },
  { id: 'toast-floor-plan', root: '#fp-notice', motion: 'toast', open: "showFloorPlanNotice('Склеп', { rooms: [[], []], portals: [], srcW: 1 });", close: 'hideFloorPlanNotice();' },
  { id: 'map-progress', root: '#map-progress', motion: 'toast', open: "showMapProgress('Сохраняю анимированную карту…'); updateMapProgress(40);", close: 'hideMapProgress();' },
  { id: 'hint', root: '.hintcall-rooms', kin: '.hintcall', motion: 'popup', from: '#btn-shape',
    open: "_hintShow('rooms', 'Нарисуйте комнату', 'Обведите комнату, чтобы открывать её одним кликом.', 'btn-shape', _hintPlaceOver('btn-shape'));",
    close: "hintClose('rooms');" },
  { id: 'whats-new', root: '#cl-modal', motion: 'window', from: '#dock-tab-settings', open: 'openChangelog();', close: 'closeChangelog();' },
  { id: 'calibration', root: '#gridcal-hud', motion: 'popup', open: 'armGridCalibration(true);', close: 'armGridCalibration(false);' },
];

module.exports = { SETUP, INVENTORY, CLOSE_ALL };

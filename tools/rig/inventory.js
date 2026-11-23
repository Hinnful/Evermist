// The interface's inventory: every window, pop-up, menu, dialog and toast of the DM window, and the states each
// can be in. The `design-sweep` scenario opens every entry in every state and checks it (docs/PROCESS.md,
// "Building"). A new surface gets its entry in the same change; an entry that does not open fails the sweep.
//
// An entry: id; root, the selector that wraps it once open; open and close, page JS (bare globals); states, each
// { name, set } run in order on the open entry (the first is usually rest); shifts, each { name, run, except, root }
// checked for boxes that move when run; menu, a right-click menu whose size is compared with the others; below,
// extra height for a close-up whose list opens under the root.

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
  { id: 'dock-rail', root: '#dock', open: "dockOpen(null);" },
  { id: 'dock-map-settings', root: '#dock-pane-scene', open: "dockOpen('scene');",
    states: [{ name: 'rest', set: '' }, { name: 'grid on', set: "document.getElementById('cp-grid-switch').click();" }] },
  { id: 'dock-music', root: '#dock-pane-music', open: "dockOpen('music');",
    states: [{ name: 'rest', set: '' }, { name: 'filter, no hits', set: "const f = document.getElementById('mu-filter'); f.value = 'zzq'; f.dispatchEvent(new Event('input'));" }],
    close: "const f = document.getElementById('mu-filter'); f.value = ''; f.dispatchEvent(new Event('input'));" },
  { id: 'dock-sounds', root: '#dock-pane-sounds', open: "dockOpen('sounds');",
    states: [{ name: 'rest', set: '' }, { name: 'filter', set: "const f = document.getElementById('sb-filter'); f.value = 'двер'; f.dispatchEvent(new Event('input'));" }],
    close: "const f = document.getElementById('sb-filter'); f.value = ''; f.dispatchEvent(new Event('input'));" },
  { id: 'dock-pictures', root: '#dock-pane-gallery', open: "dockOpen('gallery');" },
  { id: 'dock-settings', root: '#dock-pane-settings', open: "dockOpen('settings');" },
  { id: 'pop-grid-colour', root: '#cp-pop-grid', open: "dockOpen('scene'); document.getElementById('cp-grid-custom').click();", close: 'dockClosePop();' },
  { id: 'pop-trash', root: '#sy-trash-pop', open: "dockOpen('settings'); await new Promise(r => setTimeout(r, 600)); document.getElementById('sy-trash-open').click();", close: 'dockClosePop();' },
  { id: 'menu-music-add', root: '.lib-menu', open: "dockOpen('music'); document.getElementById('btn-mu-add').click();", close: 'libCloseMenu();', menu: true },
  { id: 'music-download', root: '#mu-modal', open: 'openMusicDownload();', close: '_muCloseDownload();',
    states: [{ name: 'rest', set: '' },
      { name: 'list', set: "_muLookup = { title: 'Плейлист', entries: [{ id: 'a', title: 'Таверна', duration: 200 }, { id: 'b', title: 'Битва', have: true }, { id: 'c', title: 'Ошибка', failed: true }] }; _muPicked.add('a'); _muRenderLookup();" },
      { name: 'error', set: "_muSetStatus('Не удалось прочитать ссылку', true);" }] },
  { id: 'module-text', root: '#mt-modal', open: 'openModuleTextModal();', close: 'closeModuleTextModal();' },
  { id: 'tv-help', root: '#tv-pop', open: "_tvOpen('help');", close: '_tvClose(); tvRefresh();' },
  { id: 'tv-setup', root: '#tv-setup .sm-win', open: '_tvSetupOpen();', close: '_tvSetupClose();',
    states: [{ name: 'rest', set: '' }, { name: 'screen list', set: '_tvSetupDd = true; _tvSetupRender();' }] },
  { id: 'minimap', root: '#minimap-panel', open: '' },

  // ── The bar and the rows above it ──
  { id: 'toolbar', root: '#toolbar-bottom', open: '' },
  { id: 'list-shape', root: '#tb-dd', open: '_tbOpenShapeList();', close: '_tbCloseList();' },
  { id: 'effects-row', root: '#context-row', open: 'effectsToolEnter();', close: 'effectsToolLeave();' },
  { id: 'list-effect-shape', root: '#tb-dd', open: 'effectsToolEnter(); openFxShapeList();', close: '_tbCloseList(); effectsToolLeave();' },
  { id: 'material-palette', root: '#mat-pal', open: "effectsToolEnter(); toggleMaterialPalette(null, 'fire');",
    states: [{ name: 'rest', set: '' }, { name: 'search', set: "const f = document.getElementById('mat-find'); f.value = 'лёд'; f.dispatchEvent(new Event('input'));" }],
    close: "document.getElementById('mat-pal').hidden = true; effectsToolLeave();" },
  { id: 'room-switcher', root: '#room-fog', open: "setPlaceMode('rooms'); setShape('select'); selectedPolygonId = polygons[0].id; scheduleRender(); await new Promise(r => setTimeout(r, 300));",
    close: 'selectedPolygonId = null; scheduleRender();' },
  { id: 'edit-row', root: '#edit-row', open: "setShape('select'); selectedPolygonId = polygons[0].id; editRowEnter(); scheduleRender();",
    states: [{ name: 'rest', set: '' }, { name: 'pen', set: "editTool = 'pen'; _erKey = ''; refreshEditRow();" }],
    close: 'editRowClose(); selectedPolygonId = null; scheduleRender();' },
  { id: 'shortcut-legend', root: '#shortcut-legend', open: 'toggleLegend();', close: 'toggleLegend();' },

  // ── Notes ──
  { id: 'notes', root: '#notes-window', open: "nwShow(); notesShow({ kind: 'campaign' });",
    states: [{ name: 'campaign', set: '' }, { name: 'map', set: "ntGoKey('map:' + currentScene.id);" },
      { name: 'room', set: 'selectedPolygonId = polygons[0].id; scheduleRender(); refreshRoomPanel();' }],
    close: 'selectedPolygonId = null; nwHide();' },
  { id: 'menu-notes-row', root: '.lib-menu', menu: true, close: 'libCloseMenu(); nwHide();',
    open: "nwShow(); const k = document.querySelector('#nw-tl .nw-row').dataset.key; libMenuAtPoint(300, 300, ntMenuRows(_ntNode(k)));" },
  { id: 'menu-notes-new', root: '.nw-menu', menu: true, close: 'ntCloseMenu(); nwHide();',
    open: "nwShow(); ntMenuAt({ x: 300, y: 300 }, [{ label: 'Фракция', run() {} }, { label: 'Лор', run() {} }, { sep: true }, { label: 'Удалить', danger: true, off: true, hint: 'Сначала откройте карту', run() {} }]);" },

  // ── The Bestiary ──
  { id: 'bestiary', root: '#bs-panel', open: 'bestiarySetOpen(true); bestiaryRender();',
    states: [{ name: 'rest', set: '' },
      { name: 'ticked', set: 'Object.keys(cbState.blocks).slice(0, 2).forEach(id => bs.picked.add(id)); bestiaryRender();' },
      { name: 'page', set: "bs.picked.clear(); _bsShow(Object.values(cbState.blocks).find(b => b.name === 'Ааракокра-аэромант').id);" },
      { name: 'page editing', set: 'bs.editing = true; _bsRenderPage();' },
      { name: 'medium width', set: "bs.editing = false; document.getElementById('bs-panel').style.width = '700px'; bswdApply(); bestiaryRender();" },
      { name: 'nothing matches', set: "document.getElementById('bs-panel').style.width = '1000px'; bswdApply(); bs.f.q = 'zzz'; bestiaryRender();" }],
    shifts: [{ name: 'a tick', root: '#bs-table', except: '.bs-cb',
      run: "bs.f.q = ''; bs.picked.clear(); bestiaryRender(); await new Promise(r => setTimeout(r, 50)); __rigBefore = __rigSurface.snap('#bs-table'); bs.picked.add(Object.keys(cbState.blocks)[2]); bestiaryRender();" }],
    close: "bs.f.q = ''; bs.picked.clear(); bestiaryRender(); bestiarySetOpen(false);" },
  { id: 'filter-list', root: '.bs-pop', open: "bestiarySetOpen(true); _bsFilterPop(document.querySelector('#bs-panel [data-filter=type]'), 'type');",
    states: [{ name: 'rest', set: '' }, { name: 'ticked', set: "document.querySelector('.bs-pop .o').click();" }],
    close: "bs.f.type = []; _bsClosePop(); bestiaryRender(); bestiarySetOpen(false);" },
  { id: 'filter-range', root: '.bs-pop', below: 380, open: "bestiarySetOpen(true); _bsFilterPop(document.querySelector('#bs-panel [data-filter=cr]'), 'cr');",
    states: [{ name: 'rest', set: '' }, { name: 'list open', set: "document.querySelector('.bs-pop select[data-r=\"1\"]').showPicker();" }],
    close: "document.querySelector('.bs-pop select[data-r=\"1\"]').blur(); _bsClosePop(); bestiarySetOpen(false);" },
  { id: 'bestiary-import-menu', root: '.bs-menu', open: "bestiarySetOpen(true); _bsImportMenu(document.querySelector('#bs-panel [data-a=import]'));",
    close: '_bsClosePop(); bestiarySetOpen(false);' },
  { id: 'bestiary-import-bar', root: '.bs-importbar', open: 'bestiarySetOpen(true); bs.importing = true; bestiaryRender();',
    states: [{ name: 'rest', set: '' },
      { name: 'queue', set: "cbImportQueue.push({ id: 9, state: 'failed', url: 'https://example.org/goblin', why: 'Это не страница монстра', host: 'example.org' }, { id: 10, state: 'reading', url: 'https://example.org/orc', host: 'example.org' }); bestiaryRender();" }],
    close: 'cbImportQueue.length = 0; bs.importing = false; bestiaryRender(); bestiarySetOpen(false);' },
  { id: 'bestiary-copy', root: '#bs-page', open: 'cbSetOpen(true); bcOpen(cbState.rows[0]);',
    states: [{ name: 'rest', set: '' }, { name: 'changed', set: 'cbState.rows[0].sbChanged = true; _bsRenderPage();' }],
    close: 'cbState.rows[0].sbChanged = false; bcClose(); bestiarySetOpen(false); cbSetOpen(false);' },

  // ── The fight table ──
  { id: 'fight', root: '#cb-fight', open: 'cbSetOpen(true);',
    states: [{ name: 'rest', set: '' }, { name: 'defeated fold', set: "cbState.rows[0].hp = '-999'; cbRender(); cbCleanUp(); cbToggleFold();" }],
    close: "cbState.rows.forEach(r => { r.hp = ''; delete r.cleaned; }); cbRender(); cbSetOpen(false);" },
  { id: 'menu-fight-row', root: '#cb-menu', menu: true, open: 'cbSetOpen(true); cbMenu(_cbRowItems(cbState.rows[1]), ' + ROW_AT + ');', close: 'cbCloseMenu(); cbSetOpen(false);' },
  { id: 'menu-conditions', root: '#cb-menu', open: 'cbSetOpen(true); _cbCondMenu(cbState.rows[1], ' + ROW_AT + ');',
    shifts: [{ name: 'a tick', except: '.box', run: "document.querySelectorAll('#cb-menu [data-i]')[2].click();" }],
    close: 'cbCloseMenu(); cbSetOpen(false);' },
  { id: 'fight-picker', root: '#cf-menu', open: 'cbSetOpen(true); _cfToggle();', close: 'cbCloseFights(); cbSetOpen(false);' },
  { id: 'fight-suggestions', root: '#cb-suggest', open: "cbSetOpen(true); const i = document.getElementById('cb-search'); i.focus(); i.value = 'а'; _cbSearch(i);",
    close: "_cbSuggestClose(); document.getElementById('cb-search').value = ''; cbSetOpen(false);" },

  // ── The Campaign ──
  { id: 'campaign', root: '#wm', open: 'worldMapShow();',
    states: [{ name: 'rest', set: '' }, { name: 'picked', set: "worldMapSelect({ sceneId: currentScene.id, place: '' });" }],
    close: "worldMapSelect({ sceneId: null, place: '' }); worldMapHide();" },
  { id: 'menu-campaign-map', root: '.wm-menu', menu: true, close: 'worldMapMenuClose(); worldMapHide();',
    open: "worldMapShow(); await new Promise(r => setTimeout(r, 1200)); worldMapMenuOpen({ target: _wmEls.get('c' + currentScene.id), clientX: 300, clientY: 300, preventDefault() {}, stopPropagation() {} });" },
  { id: 'menu-campaign-ground', root: '.wm-menu', close: 'worldMapMenuClose(); worldMapHide();',
    open: "worldMapShow(); await new Promise(r => setTimeout(r, 1200)); worldMapMenuOpen({ target: document.getElementById('wm'), clientX: 60, clientY: 500, preventDefault() {}, stopPropagation() {} });" },

  // ── Search ──
  { id: 'search', root: '#sr-box', open: 'searchOpen();',
    states: [{ name: 'empty', set: '' }, { name: 'results', set: "_srInput.value = 'Огр'; _srTyped();" }, { name: 'no results', set: "_srInput.value = 'zzzq'; _srTyped();" }],
    close: 'searchClose();' },

  // ── Dialogs, toasts, hints ──
  { id: 'dialog-delete', root: '#cd-modal', close: '_cdClose(false);',
    open: "confirmDialog({ title: 'Удалить карту?', message: 'Карта уйдёт в корзину на 30 дней.', confirmLabel: 'Удалить', danger: true, onConfirm() {} });" },
  { id: 'dialog-confirm', root: '#cd-modal', close: '_cdClose(false);',
    open: "confirmDialog({ title: 'Заменить комнаты?', message: 'На карте уже есть комнаты.', confirmLabel: 'Заменить', onConfirm() {} });" },
  { id: 'dialog-message', root: '#cd-modal', close: '_cdClose(true);',
    open: "messageDialog({ title: 'Не удалось открыть файл', message: 'Файл повреждён или это не карта.' });" },
  { id: 'dialog-first-sync', root: '#cd-modal', close: '_cdOnConfirm = _cdOnCancel = null; _cdClose(false);',
    open: '_ssAskFirst({ here: 3, maps: 5, computers: 1 });' },
  { id: 'toast-undo', root: '#scene-undo-toast', open: "showUndoToast('«Склеп» в корзине', () => {}, false);", close: 'hideUndoToast();' },
  { id: 'toast-notice', root: '#notice-toast', open: "noticeToast('Карта сохранена');", close: "_noticeEl.style.display = 'none';" },
  { id: 'toast-update', root: '#up-toast', open: "upToast('Обновлено до 9.9.9', 'Что нового', () => {}, 0);", close: 'hideUpdateToast();' },
  { id: 'toast-floor-plan', root: '#fp-notice', open: "showFloorPlanNotice('Склеп', { rooms: [[], []], portals: [], srcW: 1 });", close: 'hideFloorPlanNotice();' },
  { id: 'map-progress', root: '#map-progress', open: "showMapProgress('Сохраняю анимированную карту…'); updateMapProgress(40);", close: 'hideMapProgress();' },
  { id: 'hint', root: '.hintcall-rooms', open: "_hintShow('rooms', 'Нарисуйте комнату', 'Обведите комнату, чтобы открывать её одним кликом.', 'btn-shape', _hintPlaceOver('btn-shape'));",
    close: "hintClose('rooms');" },
  { id: 'whats-new', root: '#cl-modal', open: 'openChangelog();', close: 'closeChangelog();' },
  { id: 'calibration', root: '#gridcal-hud', open: 'armGridCalibration(true);', close: 'armGridCalibration(false);' },
];

module.exports = { SETUP, INVENTORY, CLOSE_ALL };

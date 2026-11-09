'use strict';
// tvOneInch.js — 1 inch: the minimap button's press, TV setup's TV size row under Turn, and the size
// kept per TV on this computer. tvInch.js does the sums; tvControl.js places the button and the row.
// The size lives in evermist.tvSizes, which the previous release never reads.

const TV_SIZES_KEY = 'evermist.tvSizes';

let _tviReported = {};   // per TV: the inches it reported, 0 when it reported none, null while asking
let _tviOther = false;   // Other is picked and its field is still empty
let _tviMark = false;    // 1 inch was pressed with no size: the row is marked until a size is set
let _tviWant = false;    // TV setup was opened by 1 inch, so Done zooms

// The TV the size belongs to: the screen the open Player says it is on; else the screen the map will go
// to; for a window, the one other screen, else the DM's own. ⚠ On Wayland main cannot see where a
// window is and takes the main screen for the DM's, so only the Player's report is trustworthy there.
function tvInchDisplay() {
  const seen = _tvLive() ? tvInchMatchScreen(_tvDisplays, paneScope().playerScreenInfo) : null;
  if (seen) return seen;
  const sel = _tvSelected();
  if (sel.kind === 'display') return sel.display;
  const others = _tvDisplays.filter(d => d.id !== _tvDmId);
  return (others.length === 1 ? others[0] : null) || _tvDisplays.find(d => d.id === _tvDmId) || _tvDisplays[0] || null;
}

function _tviAll() {
  let text = null;
  try { text = localStorage.getItem(TV_SIZES_KEY); } catch (_) {}
  return tvSizesRead(text);
}

function tvSizeStored(display) {
  return display ? _tviAll()[tvSizeKey(display)] || null : null;
}

function _tviStore(display, inches) {
  const all = _tviAll();
  all[tvSizeKey(display)] = inches;
  try { localStorage.setItem(TV_SIZES_KEY, JSON.stringify(all)); } catch (_) {}
  _tviOther = false;
  _tviMark = false;
}

// The press: the TV zooms about its centre so a square is 1.1 inches, by the wheel's own path, so
// Manual, two maps and the Player's view-snap treat it as a wheel step. No size yet opens TV setup.
function tvOneInchPress() {
  const display = tvInchDisplay();
  const inches = tvSizeStored(display);
  if (!inches) {
    _tviWant = true;
    _tviMark = true;
    _tvSetupOpen();
    return;
  }
  const z = tvInchZoom(inches, display, tvInchCellPx(paneScope().gridConfig));
  if (z) minimapSetZoom(z);
}

// TV setup's Done.
function tvOneInchDone() {
  if (_tviWant && tvSizeStored(tvInchDisplay())) tvOneInchPress();
}

function tvOneInchClosed() {
  _tviWant = false;
  _tviMark = false;
  _tviOther = false;
}

// The first look at a TV this launch asks it for its size; with nothing stored, a believable answer
// is stored and starts picked.
async function _tviAsk(display) {
  const key = tvSizeKey(display);
  if (key in _tviReported) return;
  _tviReported[key] = null;
  await Promise.resolve();   // never inside the render that asked
  const api = window.electronAPI;
  let r = null;
  try { r = api && api.tvReportedSize ? await api.tvReportedSize(display.id) : null; } catch (_) {}
  _tviReported[key] = r && tvSizeValid(r.inches) ? r.inches : 0;
  if (_tviReported[key] && !tvSizeStored(display)) _tviStore(display, _tviReported[key]);
  if (_tvSetup) _tvSetupRender();
}

function _tviField(display, value) {
  const had = document.activeElement && document.activeElement.id === 'tv-size-other';
  const inp = document.createElement('input');
  inp.id = 'tv-size-other';
  inp.className = 'tvs-field' + (value ? '' : ' empty');
  inp.inputMode = 'numeric';
  inp.maxLength = 3;
  inp.value = value ? String(value) : '';
  inp.addEventListener('input', () => {
    const n = /^\d+$/.test(inp.value) ? Number(inp.value) : NaN;
    if (tvSizeValid(n)) _tviStore(display, n);
    inp.classList.toggle('empty', !tvSizeValid(n));
    const row = inp.closest('.tvs-size');
    if (row && tvSizeStored(display)) row.classList.remove('need');
  });
  if (had) requestAnimationFrame(() => { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); });
  return _tvMake('div', 'tvs-other', [inp, _tvText('sm-dim', t('inches'))]);
}

// The TV size row: the label, the picker, Other's field, and where the size came from.
function tvSizeRowEls() {
  const display = tvInchDisplay();
  if (!display) return [];
  _tviAsk(display);
  const stored = tvSizeStored(display);
  const pick = _tviOther ? 'other' : tvSizePick(stored);
  const wrap = _tvMake('div', 'tvs-size' + (_tviMark && !stored ? ' need' : ''));
  const seg = _tvMake('div', 'cp-tabs');
  for (const v of TV_INCH_SIZES.concat('other')) {
    const b = _tvBtn('cp-segtab' + (pick === v ? ' active' : ''), '', [document.createTextNode(v === 'other' ? t('Other') : String(v))], () => {
      if (v === 'other') _tviOther = true;
      else _tviStore(display, v);
      _tvSetupRender();
    });
    b.setAttribute('data-tv-size', v);
    seg.append(b);
  }
  wrap.append(_tvText('sm-sub', t('TV size')), seg);
  if (pick === 'other') wrap.append(_tviField(display, TV_INCH_SIZES.includes(stored) ? null : stored));
  const said = _tviReported[tvSizeKey(display)];
  if (said) wrap.append(_tvText('sm-dim', t.plural(said, 'Your TV says it is {n} inch.', 'Your TV says it is {n} inches.', { n: said })));
  else if (said === 0) wrap.append(_tvText('sm-dim', t("Your TV doesn't say its size. Pick it from the TV's box.")));
  return [wrap];
}

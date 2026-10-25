'use strict';
// fogPreview.js — hovering Reveal all or Hide all shows its result on the DM's map, inside a green
// or purple frame, and changes nothing else: no fog state, no undo, no save, nothing to the Player.

let _fpOverlay = null, _fpFrame = null, _fpKind = null;

function fogPreviewInit(reveal, hide) {
  [[reveal, 'reveal'], [hide, 'hide']].forEach(([btn, kind]) => {
    btn.addEventListener('mouseenter', () => { if (!btn.disabled) fogPreviewSet(kind); });
    ['mouseleave', 'mousedown', 'click'].forEach(ev => btn.addEventListener(ev, fogPreviewEnd));
  });
  // A key can open the world map under the pointer, and a blur can eat the mouseleave.
  window.addEventListener('blur', fogPreviewEnd);
  document.addEventListener('keydown', fogPreviewEnd);
}

function fogPreviewSet(kind) {
  if (isPlayer || panesActive || worldMapOpen || !pixiFogLayer) return;   // two maps: the fog is in the columns
  fogPreviewEnd();
  _fpKind = kind;
  if (kind === 'reveal') pixiFogLayer.visible = false;
  else if (pixiFogBlurSpr) {
    _fpOverlay = new PIXI.Graphics();
    _fpOverlay.beginFill(parseInt(fogBaseColor.slice(1), 16), 1);
    _fpOverlay.drawRect(0, 0, pixiFogBlurSpr.width, pixiFogBlurSpr.height);
    _fpOverlay.endFill();
    pixiFogLayer.addChild(_fpOverlay);
  }
  if (!_fpFrame) {
    _fpFrame = document.createElement('div');
    _fpFrame.id = 'fp-frame';
    document.body.appendChild(_fpFrame);
  }
  _fpFrame.style.right = dockMapInset() + 'px';
  _fpFrame.dataset.kind = kind;
  _fpFrame.classList.add('on');
  scheduleRender();
}

// Also called by pixiDestroyFog: a rebuilt fog layer must not keep the hidden layer or the overlay.
function fogPreviewEnd() {
  if (!_fpKind) return;
  _fpKind = null;
  if (pixiFogLayer) pixiFogLayer.visible = true;
  if (_fpOverlay) { if (_fpOverlay.parent) _fpOverlay.parent.removeChild(_fpOverlay); _fpOverlay.destroy(); _fpOverlay = null; }
  if (_fpFrame) _fpFrame.classList.remove('on');
  scheduleRender();
}

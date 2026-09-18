// Every input in the Fog tab, and nothing that renders: the animation presets with their
// sliders, and the legacy inputs the tabbed panel sits over.

const ANIM_PRESETS = {
  calm:    { speed: 40,  drift: 0.3,  morph: 0.12, warpStr: 0.08, warpRad: 0.05, pulse: 0.10 },
  default: { speed: 60,  drift: 0.5,  morph: 0.20, warpStr: 0.10, warpRad: 0.06, pulse: 0.15 },
  fast:    { speed: 100, drift: 1.0,  morph: 0.35, warpStr: 0.15, warpRad: 0.08, pulse: 0.30 },
};

// Which preset the animation values ARE, or none when dialled in by hand. ⚠ DERIVED, never
// remembered: a remembered one describes whichever map was open when a preset was pressed.
function highlightAnimPreset() {
  const near = (a, b) => Math.abs(a - b) < 0.001;
  const hit = Object.keys(ANIM_PRESETS).find(name => {
    const p = ANIM_PRESETS[name];
    return near(fogAnimSpeed, p.speed / 100) && near(driftScale, p.drift) &&
           near(cloudFrameSpeed, p.morph) && near(cloudWarpStrength, p.warpStr) &&
           near(cloudWarpRadius, p.warpRad) && near(alphaPulseAmp, p.pulse);
  }) || null;
  document.querySelectorAll('.anim-preset-btn').forEach(b =>
    b.classList.toggle('active', hit !== null && b.id === 'anim-preset-' + hit));
  return hit;
}

// Every control in the Fog panel, set to one scene's settings. ⚠ TWO CALLERS: a scene switch,
// and selecting the other column in two-map mode.
function showFogSettings(hex, alpha, an) {
  fogPickedHex      = hex;
  FOG_TINT_ALPHA    = alpha;
  fogAnimEnabled    = an.enabled;
  fogAnimSpeed      = an.speed;
  driftScale        = an.drift;
  cloudFrameSpeed   = an.morph;
  cloudWarpStrength = an.warpStr;
  cloudWarpRadius   = an.warpRad;
  alphaPulseAmp     = an.pulse;

  const colorEl  = document.getElementById('fog-color');
  const sliderEl = document.getElementById('fog-tint-alpha');
  const numEl    = document.getElementById('fog-tint-alpha-num');
  if (colorEl)  colorEl.value  = hex;
  if (sliderEl) sliderEl.value = Math.round(alpha * 100);
  if (numEl)    numEl.value    = Math.round(alpha * 100);
  updateAnimSliders();
  const btnAnim = document.getElementById('btn-anim');
  if (btnAnim) btnAnim.classList.toggle('active', fogAnimEnabled);
  if (typeof highlightAnimPreset === 'function') highlightAnimPreset();
  if (typeof refreshFogControlUI === 'function') refreshFogControlUI();
}

// ─── Anim-panel DOM helpers ───────────────────────────────────────────────────

// Midpoint reference values for the log-scale sliders (slider=500 ↔ these values).
const ANIM_DEFAULTS = {
  drift: 0.5, morphSpeed: 0.20, warpStr: 0.10, warpRad: 0.06, pulse: 0.15
};

function updateAnimSliders() {
  document.getElementById('anim-speed').value = Math.round(fogAnimSpeed * 100);
  document.getElementById('anim-speed-num').value = Math.round(fogAnimSpeed * 100);

  const logSliders = [
    ['anim-drift',       'anim-drift-num',    driftScale,        ANIM_DEFAULTS.drift],
    ['anim-morph-speed', 'anim-morph-num',    cloudFrameSpeed,   ANIM_DEFAULTS.morphSpeed],
    ['anim-warp-str',    'anim-warp-num',     cloudWarpStrength, ANIM_DEFAULTS.warpStr],
    ['anim-warp-rad',    'anim-warp-rad-num', cloudWarpRadius,   ANIM_DEFAULTS.warpRad],
    ['anim-alpha-amp',   'anim-alpha-amp-num', alphaPulseAmp,    ANIM_DEFAULTS.pulse],
  ];
  for (const [sliderId, numId, val, base] of logSliders) {
    document.getElementById(sliderId).value = Math.round(animSliderFromVal(val, base));
    document.getElementById(numId).value = val.toFixed(2);
  }
}

function initFogAnimControls() {
  function toggleFogAnim() {
    fogAnimEnabled = !fogAnimEnabled;
    document.getElementById('btn-anim').classList.toggle('active', fogAnimEnabled);
    if (!panesActive) { if (fogAnimEnabled) startFogAnim(); else stopFogAnim(); }
    syncAnimToPlayer();
  }
  document.getElementById('btn-anim').onclick = function(e) {
    e.stopPropagation();
    toggleFogAnim();
  };
  fogAnimEnabled = true;
  document.getElementById('btn-anim').classList.add('active');
  startFogAnim();

  // ─── Fog animation presets & advanced sliders ────────────────────────────
  let activePreset = 'default';

  function applyAnimPreset(name) {
    const p = ANIM_PRESETS[name];
    if (!p) return;
    activePreset = name;
    document.querySelectorAll('.anim-preset-btn').forEach(b => b.classList.remove('active'));
    const btn = document.getElementById('anim-preset-' + name);
    if (btn) btn.classList.add('active');

    const warpChanged = cloudWarpStrength !== p.warpStr || cloudWarpRadius !== p.warpRad;

    fogAnimSpeed = p.speed / 100;
    driftScale = p.drift;
    cloudFrameSpeed = p.morph;
    cloudWarpStrength = p.warpStr;
    cloudWarpRadius = p.warpRad;
    alphaPulseAmp = p.pulse;

    updateAnimSliders();
    if (warpChanged) {
      regenCloudFrames();
    } else {
      syncAnimToPlayer();
    }

    if (!fogAnimEnabled) {
      fogAnimEnabled = true;
      document.getElementById('btn-anim').classList.add('active');
      startFogAnim();
    }
  }

  function clearPresetHighlight() {
    activePreset = null;
    document.querySelectorAll('.anim-preset-btn').forEach(b => b.classList.remove('active'));
  }

  Object.keys(ANIM_PRESETS).forEach(name => {
    document.getElementById('anim-preset-' + name).onclick = () => applyAnimPreset(name);
  });

  // ⚠ THE BUTTON'S OWN CLASS IS THE STATE, never the panel's display: another tab up hides the
  // panel too, so a toggle reading display armed Advanced when asked to disarm it.
  document.getElementById('btn-anim-advanced').onclick = function() {
    const armed = this.classList.contains('active');
    this.classList.toggle('active', !armed);
    if (typeof _cpUpdateAdvVisibility === 'function') _cpUpdateAdvVisibility();
    else document.getElementById('anim-advanced-panel').style.display = armed ? 'none' : 'block';
  };

  // Wire speed slider (linear, not log)
  function wireSpeedSlider() {
    const slider = document.getElementById('anim-speed');
    const num = document.getElementById('anim-speed-num');
    slider.oninput = function() {
      fogAnimSpeed = +this.value / 100;
      num.value = this.value;
      clearPresetHighlight();
      syncAnimToPlayer();
    };
    num.onchange = function() {
      const v = Math.max(0, Math.min(300, Math.round(+this.value)));
      this.value = v;
      slider.value = v;
      fogAnimSpeed = v / 100;
      clearPresetHighlight();
      syncAnimToPlayer();
    };
  }
  wireSpeedSlider();

  function wireAnimSlider(sliderId, numId, baseVal, apply, isWarp) {
    const slider = document.getElementById(sliderId);
    const num = document.getElementById(numId);
    slider.oninput = function() {
      const v = animLogScale(+this.value, baseVal);
      num.value = v.toFixed(2);
      apply(v);
      clearPresetHighlight();
      if (!isWarp) syncAnimToPlayer();
    };
    num.onchange = function() {
      const v = Math.max(0, +this.value);
      this.value = v.toFixed(2);
      slider.value = Math.round(animSliderFromVal(v, baseVal));
      apply(v);
      clearPresetHighlight();
      if (isWarp) regenCloudFrames();
      else syncAnimToPlayer();
    };
    if (isWarp) slider.addEventListener('mouseup', regenCloudFrames);
  }

  wireAnimSlider('anim-drift', 'anim-drift-num', ANIM_DEFAULTS.drift, v => { driftScale = v; });
  wireAnimSlider('anim-morph-speed', 'anim-morph-num', ANIM_DEFAULTS.morphSpeed, v => { cloudFrameSpeed = v; });
  wireAnimSlider('anim-alpha-amp', 'anim-alpha-amp-num', ANIM_DEFAULTS.pulse, v => { alphaPulseAmp = v; });
  wireAnimSlider('anim-warp-str', 'anim-warp-num', ANIM_DEFAULTS.warpStr, v => { cloudWarpStrength = v; }, true);
  wireAnimSlider('anim-warp-rad', 'anim-warp-rad-num', ANIM_DEFAULTS.warpRad, v => { cloudWarpRadius = v; }, true);


  // Reset button — resets to current preset (or Default if none)
  document.getElementById('btn-anim-reset').onclick = function() {
    applyAnimPreset(activePreset || 'default');
  };
}

function initFogInputs() {
  const featherSlider = document.getElementById('fog-feather');
  const featherNum    = document.getElementById('fog-feather-num');
  featherSlider.oninput = function() {
    featherNum.value = this.value;
    if (paneBroadcast('fog-feather', { radius: +this.value })) return;
    fogFeatherRadius = +this.value;
    rebuildFogFromPolygons();
    rebuildFogEffect();
    fogDirty = true;
    scheduleRender();
    scheduleAutoSync();
  };
  featherNum.onchange = function() {
    const v = Math.max(0, Math.min(24, Math.round(+this.value)));
    this.value = v;
    featherSlider.value = v;
    if (paneBroadcast('fog-feather', { radius: v })) return;
    fogFeatherRadius = v;
    rebuildFogFromPolygons();
    rebuildFogEffect();
    fogDirty = true;
    scheduleRender();
    scheduleAutoSync();
  };

  // Half-shroud density. Persisted, unlike Feather above, because it is dialled in across
  // sittings. Global preference, so localStorage — never a scene or a backup.
  const halfSlider = document.getElementById('fog-half-alpha');
  const halfNum    = document.getElementById('fog-half-alpha-num');
  const applyHalf = pct => {
    if (paneBroadcast('fog-half', { pct })) return;
    fogHalfAlpha = pct / 100;
    try { localStorage.setItem(FOG_HALF_ALPHA_KEY, String(pct)); } catch (_) {}
    // Rebuild every time, including mid-drag: watching half rooms change IS the point.
    rebuildFogFromPolygons();
    rebuildFogEffect();
    fogDirty = true;
    scheduleRender();
    scheduleAutoSync();
  };
  halfSlider.oninput = function() { halfNum.value = this.value; applyHalf(+this.value); };
  halfNum.onchange = function() {
    const v = Math.max(0, Math.min(100, Math.round(+this.value) || 0));
    this.value = v;
    halfSlider.value = v;
    applyHalf(v);
  };
  // A garbage entry parses to NaN and is skipped, leaving the markup's default.
  try {
    const stored = parseInt(localStorage.getItem(FOG_HALF_ALPHA_KEY), 10);
    if (!isNaN(stored)) {
      const v = Math.max(0, Math.min(100, stored));
      halfSlider.value = v;
      halfNum.value = v;
      fogHalfAlpha = v / 100;
    }
  } catch (_) {}

  // Door size, in percent of a grid cell. A preference the DM sets once, like Half above, so it
  // lives in localStorage and never in a scene or a backup.
  const applyDoorSize = () => {
    try { localStorage.setItem(DOOR_SIZE_KEY, doorWidthPct + ',' + doorDepthPct); } catch (_) {}
    rebuildFogFromPolygons();
    rebuildFogEffect();
    fogDirty = true;
    scheduleRender();
    scheduleAutoSync();
  };
  const doorFields = [['door-width-num', v => { doorWidthPct = v; }],
                      ['door-depth-num', v => { doorDepthPct = v; }]];
  doorFields.forEach(([id, set]) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.onchange = function() {
      const v = Math.max(0, Math.min(300, Math.round(+this.value) || 0));
      this.value = v;
      if (paneBroadcast('door-size', { id, value: v })) return;
      set(v);
      applyDoorSize();
    };
  });
  // A garbage entry parses to NaN and is skipped, leaving the markup's defaults.
  try {
    const parts = String(localStorage.getItem(DOOR_SIZE_KEY) || '').split(',');
    [doorFields[0], doorFields[1]].forEach(([id, set], i) => {
      const v = parseInt(parts[i], 10);
      if (isNaN(v)) return;
      const clamped = Math.max(0, Math.min(300, v));
      set(clamped);
      const el = document.getElementById(id);
      if (el) el.value = clamped;
    });
  } catch (_) {}

  const fogColorPicker   = document.getElementById('fog-color');
  const tintAlphaSlider  = document.getElementById('fog-tint-alpha');
  const tintAlphaNum     = document.getElementById('fog-tint-alpha-num');

  fogColorPicker.oninput = function() {
    applyFogColor(this.value);
    syncFogColorToPlayer(this.value);
  };
  tintAlphaSlider.oninput = function() {
    const v = parseInt(this.value);
    tintAlphaNum.value = v;
    applyFogTintAlpha(v / 100);
    syncFogColorToPlayer(fogColorPicker.value);
  };
  tintAlphaNum.oninput = function() {
    const v = Math.max(0, Math.min(100, parseInt(this.value) || 0));
    tintAlphaSlider.value = v;
    applyFogTintAlpha(v / 100);
    syncFogColorToPlayer(fogColorPicker.value);
  };
}

// ⚠ Wiring only, in either order: nothing here reads what the other half assigned.
function initFogControls() {
  initFogAnimControls();
  initFogInputs();
}

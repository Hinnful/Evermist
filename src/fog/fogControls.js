// Every input in the Fog row that is not the theme: feather, half-shroud and the door fields, and the
// legacy inputs the dock sits over. The theme itself is fog.js (setFogTheme) and controlPanel.js.

function saveFeather(v) {
  try { localStorage.setItem(FOG_FEATHER_KEY, String(v)); } catch (_) {}
}

function initFogControls() {
  const featherSlider = document.getElementById('fog-feather');
  const featherNum    = document.getElementById('fog-feather-num');
  featherSlider.oninput = function() {
    featherNum.value = this.value;
    saveFeather(+this.value);
    if (paneBroadcast('fog-feather', { radius: +this.value })) return;
    fogFeatherRadius = +this.value;
    rebuildFogFromPolygons();
    rebuildFogEffect();
    fogDirty = true;
    scheduleRender();
    scheduleAutoSync();
  };
  featherNum.onchange = function() {
    const v = Math.max(0, Math.min(24, Math.round(+this.value) || 0));
    this.value = v;
    featherSlider.value = v;
    saveFeather(v);
    if (paneBroadcast('fog-feather', { radius: v })) return;
    fogFeatherRadius = v;
    rebuildFogFromPolygons();
    rebuildFogEffect();
    fogDirty = true;
    scheduleRender();
    scheduleAutoSync();
  };

  // Feather and Half are dialled in across sittings: global preferences in localStorage, never a
  // scene or a backup. A garbage entry parses to NaN and is skipped, leaving the markup's default.
  try {
    const stored = parseInt(localStorage.getItem(FOG_FEATHER_KEY), 10);
    if (!isNaN(stored)) {
      const v = Math.max(0, Math.min(24, stored));
      featherSlider.value = v;
      featherNum.value = v;
      fogFeatherRadius = v;
    }
  } catch (_) {}

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
}

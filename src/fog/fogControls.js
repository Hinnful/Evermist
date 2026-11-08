// The door fields of the Fog row. The theme itself is fog.js (setFogTheme) and controlPanel.js.

function initFogControls() {
  // Door size, in percent of a grid cell. A preference the DM sets once, so it
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

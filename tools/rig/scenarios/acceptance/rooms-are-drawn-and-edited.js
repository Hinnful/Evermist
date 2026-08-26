'use strict';

// rooms-are-drawn-and-edited.js — the room tools exactly as they work today. It was written to
// pin them before a second placement mode went into tools.js; that mode was built and later
// removed, and this outlived it as the cover the room tools had always been missing.
// Every check drives the app's own mouse handlers
// (input.js → tools.js) with synthetic events, so nothing here can pass through a path the DM
// never takes.
//
// THE CRITERIA ARE THIS HEADER. Each line below has its check directly beneath it in the code,
// in the same order. There is no separate criteria document.
//
//   A. The Rectangle tool creates a room, carrying the fog mode picked on the toolbar.
//   B. The Circle tool creates a room, carrying the fog mode picked on the toolbar.
//   C. The Select tool selects a room by clicking inside it.
//   D. Dragging the body of a selected room moves the whole room.
//   E. Dragging one vertex reshapes that room and moves nothing else.
//   F. A drag released OUTSIDE the canvas still commits, rather than being abandoned.
//
// ⚠ CLIENT COORDINATES ARE INTEGERS. MouseEvent.clientX/Y truncate, so a map coordinate makes
// the round trip with up to 1/zoom map-units of error. Every geometric assertion here carries a
// tolerance rather than comparing exactly; a run that starts failing by half a unit is telling
// you about the tolerance, not about the app.

const MAP_W = 2000, MAP_H = 1200;

// Drives the real handlers. Map → client conversion reads zoom/pan at call time, so a scenario
// step can never bake in a camera from before the map loaded.
const HELPERS = `
globalThis.__rigMouse = (type, mx, my, onWindow) => {
  const r = container.getBoundingClientRect();
  const ev = new MouseEvent(type, {
    clientX: mx * zoom + panX + r.left,
    clientY: my * zoom + panY + r.top,
    bubbles: true, cancelable: true, button: 0,
  });
  (onWindow ? window : container).dispatchEvent(ev);
};
// releaseOnWindow=true is the release that happened off the canvas: the container never sees
// the mouseup, only the window listener does.
globalThis.__rigDrag = (x1, y1, x2, y2, releaseOnWindow) => {
  __rigMouse('mousedown', x1, y1);
  __rigMouse('mousemove', (x1 + x2) / 2, (y1 + y2) / 2);
  __rigMouse('mousemove', x2, y2);
  __rigMouse('mouseup', x2, y2, releaseOnWindow);
};
globalThis.__rigBox = (p) => p ? {
  x0: Math.min(...p.vertices.map(v => v.x)), y0: Math.min(...p.vertices.map(v => v.y)),
  x1: Math.max(...p.vertices.map(v => v.x)), y1: Math.max(...p.vertices.map(v => v.y)),
} : null;
globalThis.__rigPoly = (i) => {
  const p = polygons[i];
  return p ? { id: p.id, mode: p.mode, n: p.vertices.length,
               verts: p.vertices.map(v => ({ x: v.x, y: v.y })), box: __rigBox(p) } : null;
};
0`;

const TOL = 5;   // map units — see the clientX note above
const near = (a, b, tol = TOL) => Math.abs(a - b) <= tol;

module.exports = async function roomsAreDrawnAndEdited(rig) {
  const dm = rig.dm;

  const still = await rig.fixtures.stillMap(dm, rig.fixtureDir, { w: MAP_W, h: MAP_H, name: 'rig-still.png' });
  const fileExpr = await rig.fixtures.asFileExpr(dm, still);
  await dm.evaluate('createNewScene(' + fileExpr + ')', 120000);
  await dm.waitFor('currentScene && currentScene.mapType === "image" && mapWidth === ' + MAP_W,
                   120000, 'the generated map to load on the DM');
  await dm.waitFor('!!mapOffscreen', 60000, 'the DM map surface');
  await dm.evaluate(HELPERS);

  // ── A. The Rectangle tool creates a room in the picked fog mode ───────────
  await dm.evaluate('setShape("rect"); document.getElementById("btn-shroud").click(); 0');
  await dm.evaluate('__rigDrag(200, 200, 600, 500); 0');
  const rect = await dm.evaluate('__rigPoly(0)');
  rig.check(await dm.evaluate('polygons.length') === 1,
            'the Rectangle tool did not create exactly one room');
  rig.check(rect && rect.mode === 'shroud',
            'the rectangle room did not take the Shrouded mode picked on the toolbar: ' +
            (rect ? rect.mode : 'no room at all'));
  rig.check(rect && rect.n === 4, 'the rectangle room is not four-cornered: ' + (rect ? rect.n : 'none'));
  rig.check(rect && near(rect.box.x0, 200) && near(rect.box.y0, 200) &&
                    near(rect.box.x1, 600) && near(rect.box.y1, 500),
            'the rectangle room is not where it was drawn: ' + JSON.stringify(rect && rect.box));

  // ── B. The Circle tool creates a room in the picked fog mode ──────────────
  // Drawn centre-outwards, so the drag length is the radius.
  await dm.evaluate('setShape("circle"); document.getElementById("btn-reveal").click(); 0');
  await dm.evaluate('__rigDrag(1400, 800, 1400, 1000); 0');
  const circ = await dm.evaluate('__rigPoly(1)');
  rig.check(await dm.evaluate('polygons.length') === 2,
            'the Circle tool did not add a second room');
  rig.check(circ && circ.mode === 'reveal',
            'the circle room did not take the Revealed mode picked on the toolbar: ' +
            (circ ? circ.mode : 'no room at all'));
  rig.check(circ && circ.n === 32, 'the circle room is not 32-sided: ' + (circ ? circ.n : 'none'));
  rig.check(circ && near(circ.box.x0, 1200, 8) && near(circ.box.x1, 1600, 8) &&
                    near(circ.box.y0, 600, 8)  && near(circ.box.y1, 1000, 8),
            'the circle room is not where it was drawn: ' + JSON.stringify(circ && circ.box));

  // Drawing must leave nothing selected, so the room card can't cover the map mid-draw.
  rig.check(await dm.evaluate('selectedPolygonId') === null,
            'drawing a room left it selected, so the room card now covers the map');

  // ── C. The Select tool selects a room by clicking inside it ───────────────
  await dm.evaluate('setShape("select"); 0');
  await dm.evaluate('__rigDrag(400, 350, 400, 350); 0');
  const selected = await dm.evaluate('selectedPolygonId');
  rig.check(rect != null && selected === rect.id,
            'clicking inside the rectangle room did not select it (selected ' + selected +
            ', expected ' + (rect && rect.id) + ')');

  // ── D. Dragging the body moves the whole room ─────────────────────────────
  await dm.evaluate('__rigDrag(400, 350, 500, 400); 0');
  const moved = await dm.evaluate('__rigPoly(0)');
  rig.check(moved && near(moved.box.x0, 300) && near(moved.box.y0, 250) &&
                     near(moved.box.x1, 700) && near(moved.box.y1, 550),
            'dragging the room body did not move the whole room by the drag: ' +
            JSON.stringify(moved && moved.box));
  rig.check(moved && moved.n === 4, 'dragging the room body changed its vertex count');
  rig.check(await dm.evaluate('isDraggingPolygon') === false,
            'the room drag never ended — the room is still following the pointer');

  // ── E. Dragging one vertex reshapes that room and moves nothing else ──────
  // The vertex is read back rather than assumed, so an earlier tolerance slip can't put the
  // grab outside findVertexAt's hit radius and make this look like a broken drag. The fallback
  // is the geometry the drag above should have produced: when an earlier stage is broken this
  // check still runs and still reports its own criterion, rather than throwing on a null and
  // hiding every criterion below it.
  const EXPECTED = [{ x: 300, y: 250 }, { x: 700, y: 250 }, { x: 700, y: 550 }, { x: 300, y: 550 }];
  const before = (moved && moved.verts) || EXPECTED;
  const v0 = before[0];
  await dm.evaluate('__rigDrag(' + v0.x + ',' + v0.y + ',' + (v0.x - 120) + ',' + (v0.y - 90) + '); 0');
  const reshaped = await dm.evaluate('__rigPoly(0)');
  rig.check(reshaped && near(reshaped.verts[0].x, v0.x - 120) && near(reshaped.verts[0].y, v0.y - 90),
            'dragging a vertex did not move it: ' + JSON.stringify(reshaped && reshaped.verts[0]));
  rig.check(reshaped && near(reshaped.verts[2].x, before[2].x, 0.01) &&
                        near(reshaped.verts[2].y, before[2].y, 0.01),
            'dragging one vertex moved the opposite corner too — the whole room shifted instead ' +
            'of reshaping');
  rig.check(reshaped && reshaped.n === 4, 'dragging a vertex changed the room vertex count');

  // ── F. A drag released outside the canvas still commits ───────────────────
  // The container never sees this mouseup; only the window listener does, which is the path
  // input.js wires to toolWindowMouseUp. A release off the canvas is common on a small window
  // and must not abandon the edit.
  const v1 = (reshaped && reshaped.verts[1]) || EXPECTED[1];
  await dm.evaluate('__rigDrag(' + v1.x + ',' + v1.y + ',' + (v1.x + 140) + ',' + (v1.y - 70) + ', true); 0');
  const outside = await dm.evaluate(
    '({ poly: __rigPoly(0), draggingVert: isDraggingVertex, draggingPoly: isDraggingPolygon })');
  rig.check(outside.poly && near(outside.poly.verts[1].x, v1.x + 140) &&
                            near(outside.poly.verts[1].y, v1.y - 70),
            'a vertex drag released outside the canvas was abandoned: ' +
            JSON.stringify(outside.poly && outside.poly.verts[1]));
  rig.check(outside.draggingVert === false && outside.draggingPoly === false,
            'a drag released outside the canvas never ended — the room still follows the pointer');
  // The observable failure of a missed window release: the pointer keeps reshaping the room with
  // no button held. Asserted rather than inferred from the flag above.
  await dm.evaluate('__rigMouse("mousemove", 100, 100); 0');
  const afterMove = await dm.evaluate('__rigPoly(0)');
  rig.check(afterMove && near(afterMove.verts[1].x, v1.x + 140) && near(afterMove.verts[1].y, v1.y - 70),
            'moving the pointer after a release outside the canvas went on reshaping the room: ' +
            JSON.stringify(afterMove && afterMove.verts[1]));
};

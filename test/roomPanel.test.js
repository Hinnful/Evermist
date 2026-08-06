'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

// fitLabelBox() calls getPolyBBox(), which the browser provides via script load order
// (fogGeometry.js loads long before roomPanel.js). Node has no such ambient scope, so the
// real implementation is hoisted to the global here rather than duplicated.
global.getPolyBBox = require('../src/fogGeometry.js').getPolyBBox;

const {
  normalizeRoomFields, sanitizeRoomName, sanitizeRoomDesc,
  clampPanelPosition, ellipsizeToWidth,
  roomLabelFontPx, polygonRowSpans, cornerInsetAt, fitLabelBox,
  ROOM_NAME_MAX, ROOM_DESC_MAX,
} = require('../src/roomPanel.js');

// Helpers for the label-geometry suites.
const rect = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
const circle = (cx, cy, r, segs = 32) => Array.from({ length: segs }, (_, i) => {
  const a = (i / segs) * Math.PI * 2;
  return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
});
// ∪ shapes: wide at the bottom, split into two prongs at the top. The row that crosses
// the notch has two separate interior spans.
const uShape = [ {x:0,y:0},{x:20,y:0},{x:20,y:60},{x:80,y:60},{x:80,y:0},{x:100,y:0},
                 {x:100,y:100},{x:0,y:100} ];
const bigU   = [ {x:0,y:0},{x:120,y:0},{x:120,y:120},{x:280,y:120},{x:280,y:0},{x:400,y:0},
                 {x:400,y:300},{x:0,y:300} ];
const pointInPoly = (px, py, vs) => {
  let inside = false;
  for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
    const xi = vs[i].x, yi = vs[i].y, xj = vs[j].x, yj = vs[j].y;
    if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

describe('normalizeRoomFields', () => {
  test('backfills a missing name from the polygon id', () => {
    assert.equal(normalizeRoomFields([{ id: 7 }])[0].name, 'Room 7');
  });

  test('leaves a name that is already there exactly as it was', () => {
    assert.equal(normalizeRoomFields([{ id: 4, name: 'Kitchen' }])[0].name, 'Kitchen');
  });

  test('an empty name string is preserved — only null/undefined are backfilled', () => {
    // ?? not || : the card's own rename path is what enforces a non-empty name.
    assert.equal(normalizeRoomFields([{ id: 5, name: '' }])[0].name, '');
  });

  test('empty array in, empty array out', () => {
    assert.deepEqual(normalizeRoomFields([]), []);
  });

  test('non-array input yields an empty array rather than throwing', () => {
    assert.deepEqual(normalizeRoomFields(undefined), []);
    assert.deepEqual(normalizeRoomFields(null), []);
  });

  test('preserves every other field — cornerRadii and desc included', () => {
    // A field whitelist here would silently drop per-vertex corner overrides from every
    // saved scene on load. This is the regression that matters.
    const poly = {
      id: 2,
      vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
      mode: 'shroud',
      cornerRadius: 8,
      cornerRadii: [4, null, 12],
      desc: 'Twelve bunks.',
    };
    const out = normalizeRoomFields([poly])[0];
    assert.deepEqual(out.cornerRadii, [4, null, 12]);
    assert.deepEqual(out.vertices, poly.vertices);
    assert.equal(out.mode, 'shroud');
    assert.equal(out.cornerRadius, 8);
    assert.equal(out.desc, 'Twelve bunks.');
    assert.equal(out.id, 2);
  });

  test('does not backfill a description — absent until the DM types one', () => {
    assert.equal('desc' in normalizeRoomFields([{ id: 3 }])[0], false);
  });

  test('does not mutate the input polygons', () => {
    const poly = { id: 3 };
    normalizeRoomFields([poly]);
    assert.equal(poly.name, undefined);
  });
});

describe('sanitizeRoomName', () => {
  test('trims surrounding whitespace', () => {
    assert.equal(sanitizeRoomName('  Kitchen  ', 'Room 1'), 'Kitchen');
  });

  test('falls back when the result is empty', () => {
    assert.equal(sanitizeRoomName('   ', 'Room 1'), 'Room 1');
    assert.equal(sanitizeRoomName('', 'Room 1'), 'Room 1');
    assert.equal(sanitizeRoomName(null, 'Room 1'), 'Room 1');
  });

  test('caps the length so a pasted essay cannot wreck the card', () => {
    const long = 'x'.repeat(ROOM_NAME_MAX + 40);
    assert.equal(sanitizeRoomName(long, 'Room 1').length, ROOM_NAME_MAX);
  });

  test('strips newlines — drawRoomLabels feeds this to fillText', () => {
    // A pasted multi-line name renders as a control glyph on the map otherwise.
    assert.equal(sanitizeRoomName('Guard\nRoom', 'Room 1'), 'Guard Room');
    assert.equal(sanitizeRoomName('Guard\r\nRoom', 'Room 1'), 'Guard Room');
    assert.equal(sanitizeRoomName('Guard\tRoom', 'Room 1'), 'Guard Room');
    assert.equal(sanitizeRoomName('\n\n', 'Room 1'), 'Room 1');
  });

  test('newline stripping happens before the length cap', () => {
    const out = sanitizeRoomName('a\n'.repeat(ROOM_NAME_MAX), 'Room 1');
    assert.equal(out.length, ROOM_NAME_MAX);
    assert.equal(out.includes('\n'), false);
  });
});

describe('sanitizeRoomDesc', () => {
  test('keeps internal newlines — they are how prep notes are structured', () => {
    const v = 'Twelve bunks.\nA draught off the cold chimney.\n\nLoose flagstone: 60 gp.';
    assert.equal(sanitizeRoomDesc(v), v);
  });

  test('trims the ends only', () => {
    assert.equal(sanitizeRoomDesc('  \n Sealed since the siege. \n '), 'Sealed since the siege.');
  });

  test('empty in, empty out — no fallback, an empty description is normal', () => {
    assert.equal(sanitizeRoomDesc(''), '');
    assert.equal(sanitizeRoomDesc('    '), '');
    assert.equal(sanitizeRoomDesc(null), '');
    assert.equal(sanitizeRoomDesc(undefined), '');
  });

  test('caps at ROOM_DESC_MAX', () => {
    assert.equal(sanitizeRoomDesc('x'.repeat(ROOM_DESC_MAX + 500)).length, ROOM_DESC_MAX);
  });

  test('is generous enough for real prep notes', () => {
    assert.ok(ROOM_DESC_MAX >= 1000);
  });
});

describe('clampPanelPosition', () => {
  // 260x300 card in a 1000x800 viewport unless stated otherwise.
  const W = 260, H = 300, VW = 1000, VH = 800;
  // A room box around a centre point. `at` is the degenerate zero-size case.
  const box = (cx, cy, w, h) => ({ left: cx - w / 2, top: cy - h / 2, right: cx + w / 2, bottom: cy + h / 2 });
  const at  = (cx, cy) => box(cx, cy, 0, 0);

  test('sits above the room, horizontally centred on it, when there is room', () => {
    const p = clampPanelPosition(at(500, 600), W, H, VW, VH);
    assert.equal(p.placement, 'above');
    assert.equal(p.left + W / 2, 500);        // centred on the room
    assert.equal(p.top + H, 600 - 22);        // one gap above the room's top edge
  });

  test('flips below when the card would run off the top', () => {
    const p = clampPanelPosition(at(500, 100), W, H, VW, VH);
    assert.equal(p.placement, 'below');
    assert.equal(p.top, 100 + 22);
    assert.ok(p.top + H <= VH - 8);
  });

  test('falls back beside the room when neither above nor below fits', () => {
    // A viewport barely taller than the card leaves no vertical slot.
    const p = clampPanelPosition(at(400, 180), W, H, VW, 340);
    assert.equal(p.placement, 'right');
    assert.equal(p.left, 400 + 22);
    assert.ok(p.top >= 8 && p.top + H <= 340 - 8);   // vertically clamped, not clipped
  });

  test('the side fallback goes left when the right side would overflow', () => {
    const p = clampPanelPosition(at(900, 180), W, H, VW, 340);
    assert.equal(p.placement, 'left');
    assert.equal(p.left, 900 - 22 - W);
  });

  test('clamps against the left viewport edge', () => {
    const p = clampPanelPosition(at(10, 600), W, H, VW, VH);
    assert.equal(p.left, 8);
  });

  test('clamps against the right viewport edge', () => {
    const p = clampPanelPosition(at(990, 600), W, H, VW, VH);
    assert.equal(p.left, VW - W - 8);
  });

  test('a card wider than the viewport pins to the left edge, never off-screen', () => {
    const p = clampPanelPosition(at(150, 600), 400, H, 300, VH);
    assert.equal(p.left, 8);
  });

  test('never returns a negative left even in the left-side fallback', () => {
    const p = clampPanelPosition(at(30, 180), W, H, 320, 340);
    assert.ok(p.left >= 8);
  });

  // The side fallback is the only branch that reads the room's own x straight through, so it is
  // the one that can follow a panned-away room off the screen. Both directions, both axes.
  test('the side fallback stays on screen when the room is panned off the left edge', () => {
    const p = clampPanelPosition(at(-500, 180), W, H, VW, 340);
    assert.ok(p.left >= 8, 'left edge must stay inside the viewport, got ' + p.left);
    assert.ok(p.left + W <= VW - 8);
  });

  test('the side fallback stays on screen when the room is panned off the right edge', () => {
    const p = clampPanelPosition(at(VW + 500, 180), W, H, VW, 340);
    assert.ok(p.left + W <= VW - 8, 'right edge must stay inside the viewport, got ' + p.left);
    assert.ok(p.left >= 8);
  });

  test('stays on screen when the room has been panned below the viewport', () => {
    // The box comes from MAP coordinates, so zooming in or panning can put it far off-screen.
    // "Above a room 3000px below the fold" would itself be off-screen.
    const p = clampPanelPosition(at(500, 3000), W, H, VW, VH);
    assert.ok(p.top + H <= VH - 8, 'bottom edge must stay inside the viewport');
    assert.ok(p.top >= 8);
  });

  test('stays on screen when the room has been panned above the viewport', () => {
    const p = clampPanelPosition(at(500, -2000), W, H, VW, VH);
    assert.ok(p.top >= 8, 'top edge must stay inside the viewport');
    assert.ok(p.top + H <= VH - 8);
  });

  test('a card taller than the viewport pins to the top edge, never negative', () => {
    const p = clampPanelPosition(at(500, 3000), W, 900, VW, VH);
    assert.equal(p.top, 8);
  });

  test('gap and margin are overridable', () => {
    const p = clampPanelPosition(at(500, 600), W, H, VW, VH, 0, 0);
    assert.equal(p.top + H, 600);
  });

  // ── Clearing the room, not just its centre ──────────────────────────────────
  // The whole point of taking a box: a room wide enough to reach past the card must not have
  // the card land inside it.

  test('clears a big room entirely rather than sitting on its centre', () => {
    // 600x300 room, top edge at y=350. Anchoring on the centre (y=500) would put the card at
    // 500-22-300 = 178, whose bottom edge (478) lands INSIDE the room.
    const room = box(500, 500, 600, 300);
    const p = clampPanelPosition(room, W, H, VW, VH);
    assert.equal(p.placement, 'above');
    assert.ok(p.top + H <= room.top, 'card bottom must clear the room top, got ' + (p.top + H));
  });

  test('goes below when a room hugs the top of the viewport', () => {
    const room = box(500, 200, 600, 340);   // top edge at y=30, no room above
    const p = clampPanelPosition(room, W, H, VW, VH);
    assert.equal(p.placement, 'below');
    assert.ok(p.top >= room.bottom, 'card top must clear the room bottom');
  });

  test('goes beside a room that is tall but narrow', () => {
    const room = box(200, 400, 120, 780);   // spans the full height, leaves width to the right
    const p = clampPanelPosition(room, W, H, VW, VH);
    assert.equal(p.placement, 'right');
    assert.ok(p.left >= room.right, 'card left must clear the room right edge');
  });

  test('a room leaving no clear slot takes the roomiest side', () => {
    // Zoomed right in: the room overruns the viewport left, right and top, and the space below
    // it is too short for the card. Nothing is fully clear, so below wins on space.
    const room = { left: -200, top: -100, right: VW + 200, bottom: 500 };
    const p = clampPanelPosition(room, W, H, VW, VH);
    assert.equal(p.placement, 'below');
    assert.equal(p.top, VH - H - 8);          // pinned to the bottom edge, furthest from the room
    assert.ok(p.top >= 8);
  });

  test('the last-resort placement is still fully on screen', () => {
    // Room bigger than the viewport in every direction — no side has any clear space.
    const room = { left: -500, top: -500, right: VW + 500, bottom: VH + 500 };
    const p = clampPanelPosition(room, W, H, VW, VH);
    assert.ok(p.left >= 8 && p.left + W <= VW - 8);
    assert.ok(p.top >= 8 && p.top + H <= VH - 8);
  });
});

describe('ellipsizeToWidth', () => {
  // Stub metrics: every character is 10px wide, the ellipsis included.
  const measure = t => t.length * 10;

  test('returns the text untouched when it already fits', () => {
    assert.equal(ellipsizeToWidth('Crypt', 200, measure), 'Crypt');
  });

  test('an exact fit is not ellipsised', () => {
    assert.equal(ellipsizeToWidth('Crypt', 50, measure), 'Crypt');
  });

  test('ellipsises from the end when it overflows', () => {
    // 'Barracks' is 80px; at 50px only 4 chars + the ellipsis fit.
    assert.equal(ellipsizeToWidth('Barracks', 50, measure), 'Barr…');
  });

  test('one pixel short of fitting still ellipsises', () => {
    // 49px fits 4 stub chars; 'Cryp…' would be 5 (50px), so it drops to 3 chars + ellipsis.
    assert.equal(ellipsizeToWidth('Crypt', 49, measure), 'Cry…');
  });

  test('returns the bare ellipsis when only it fits', () => {
    assert.equal(ellipsizeToWidth('Barracks', 10, measure), '…');
  });

  test('returns empty when not even the ellipsis fits', () => {
    assert.equal(ellipsizeToWidth('Barracks', 9, measure), '');
    assert.equal(ellipsizeToWidth('Barracks', 0, measure), '');
    assert.equal(ellipsizeToWidth('Barracks', -5, measure), '');
  });

  test('a string shorter than the ellipsis is never widened into one', () => {
    // Narrow text + a wide ellipsis: the early fits-already return is what protects this.
    const wideEllipsis = t => (t.includes('…') ? 100 : t.length * 4);
    assert.equal(ellipsizeToWidth('a', 10, wideEllipsis), 'a');
    assert.equal(ellipsizeToWidth('ab', 8, wideEllipsis), 'ab');
  });

  test('empty and nullish input yield an empty string', () => {
    assert.equal(ellipsizeToWidth('', 100, measure), '');
    assert.equal(ellipsizeToWidth(null, 100, measure), '');
    assert.equal(ellipsizeToWidth(undefined, 100, measure), '');
  });

  test('a single character that does not fit falls back to the ellipsis', () => {
    assert.equal(ellipsizeToWidth('W', 10, measure), 'W');   // exactly fits
    assert.equal(ellipsizeToWidth('WW', 10, measure), '…');  // only the ellipsis fits
  });
});

describe('roomLabelFontPx', () => {
  test('is the base size at zoom 1', () => {
    assert.equal(roomLabelFontPx(1), 21);
  });

  test('grows with zoom, but sub-linearly', () => {
    const z1 = roomLabelFontPx(1), z4 = roomLabelFontPx(4);
    assert.ok(z4 > z1, 'should grow');
    assert.ok(z4 < z1 * 4, 'must not track zoom one-for-one, or a hall label would be huge');
  });

  test('floors when zoomed out — a label must never become unreadable', () => {
    // Zoomed out is exactly when the DM most needs to know which room is which.
    assert.equal(roomLabelFontPx(0.2), 17);
    assert.equal(roomLabelFontPx(0.02), 17);
  });

  test('ceilings when zoomed in', () => {
    assert.equal(roomLabelFontPx(50), 38);
  });

  test('is monotonic across the working zoom range', () => {
    let prev = 0;
    for (const z of [0.1, 0.25, 0.5, 1, 2, 4, 8, 20]) {
      const px = roomLabelFontPx(z);
      assert.ok(px >= prev, 'zoom ' + z + ' gave ' + px + ', below the previous ' + prev);
      prev = px;
    }
  });

  test('returns whole pixels', () => {
    for (const z of [0.37, 1.3, 2.7, 6.1]) assert.equal(roomLabelFontPx(z) % 1, 0);
  });

  test('a zero or negative zoom does not produce NaN', () => {
    assert.equal(roomLabelFontPx(0), 21);
    assert.equal(roomLabelFontPx(-3), 21);
  });

  test('exponent 0 is screen-fixed, 1 is fully map-locked', () => {
    assert.equal(roomLabelFontPx(4, 15, 1, 999, 0), 15);
    assert.equal(roomLabelFontPx(4, 15, 1, 999, 1), 60);
  });
});

describe('polygonRowSpans', () => {
  test('a rectangle yields one span equal to its width', () => {
    const s = polygonRowSpans(rect(10, 10, 100, 50), 30);
    assert.equal(s.length, 1);
    assert.deepEqual([s[0].x0, s[0].x1], [10, 110]);
  });

  test('rows outside the shape yield nothing', () => {
    assert.deepEqual(polygonRowSpans(rect(10, 10, 100, 50), 5), []);
    assert.deepEqual(polygonRowSpans(rect(10, 10, 100, 50), 500), []);
  });

  test('a circle narrows towards the top', () => {
    const c = circle(100, 100, 50);
    const nearTop = polygonRowSpans(c, 58)[0];
    const middle  = polygonRowSpans(c, 100)[0];
    assert.ok(nearTop.x1 - nearTop.x0 < middle.x1 - middle.x0);
    assert.ok(Math.abs((middle.x1 - middle.x0) - 100) < 2, 'mid-row is the diameter');
  });

  test('a concave shape yields two spans on a row crossing the notch', () => {
    const s = polygonRowSpans(uShape, 30);
    assert.equal(s.length, 2);
    assert.deepEqual([s[0].x0, s[0].x1], [0, 20]);
    assert.deepEqual([s[1].x0, s[1].x1], [80, 100]);
  });

  test('spans come back left to right', () => {
    const s = polygonRowSpans(uShape, 30);
    assert.ok(s[0].x0 < s[1].x0);
  });

  test('a triangle widens downward', () => {
    const tri = [{ x: 50, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
    const hi = polygonRowSpans(tri, 20)[0], lo = polygonRowSpans(tri, 80)[0];
    assert.ok(lo.x1 - lo.x0 > hi.x1 - hi.x0);
  });
});

describe('cornerInsetAt', () => {
  test('is the full radius at the very top edge', () => {
    assert.equal(cornerInsetAt(20, 0), 20);
  });

  test('falls to zero at the depth where the arc meets the straight edge', () => {
    assert.equal(cornerInsetAt(20, 20), 0);
    assert.equal(cornerInsetAt(20, 40), 0);
  });

  test('matches the circle equation halfway down the arc', () => {
    assert.ok(Math.abs(cornerInsetAt(10, 5) - (10 - Math.sqrt(75))) < 1e-9);
  });

  test('decreases monotonically with depth', () => {
    let prev = Infinity;
    for (let d = 0; d <= 20; d += 2) {
      const v = cornerInsetAt(20, d);
      assert.ok(v <= prev);
      prev = v;
    }
  });

  test('a square corner insets nothing', () => {
    assert.equal(cornerInsetAt(0, 5), 0);
  });

  test('nonsense input is inert rather than NaN', () => {
    assert.equal(cornerInsetAt(-5, 3), 0);
    assert.equal(cornerInsetAt(10, -1), 0);
  });
});

describe('fitLabelBox', () => {
  test('puts the label at the top-left of a plain rectangle', () => {
    const box = fitLabelBox(rect(100, 100, 300, 200), 80, 20, 6, 0);
    assert.ok(box, 'should fit');
    assert.equal(box.x, 106);              // left edge + pad
    assert.equal(box.y, 100 + 6 + 10);     // top + pad + half the label height
    assert.ok(box.avail >= 80);
  });

  // REGRESSION: the label used to sit flush against the room's left edge with a visible gap
  // above it, because the caller fitted the label's TEXT box and then drew the plate offset by
  // its own horizontal padding — cancelling the left gap while the top kept it. Passing the
  // PLATE's dimensions (drawRoomLabels adds PAD_X × 2 into the width) makes the pad land
  // identically on both axes, which is what this asserts.
  test('the gap above the plate equals the gap to its left', () => {
    const pad = 10, plateW = 120, plateH = 34;
    const box = fitLabelBox(rect(100, 100, 400, 300), plateW, plateH, pad, 0);
    assert.ok(box, 'should fit');
    assert.equal(box.x - 100, pad, 'left gap');
    assert.equal((box.y - plateH / 2) - 100, pad, 'top gap');
  });

  test('keeps the whole label box inside a circle', () => {
    // A circle's bounding-box corner is OUTSIDE the shape — the case that makes naive
    // top-left placement wrong.
    const c = circle(200, 200, 120);
    const box = fitLabelBox(c, 90, 24, 6, 0);
    assert.ok(box, 'should fit somewhere');
    for (const dy of [-12, 0, 12]) {
      assert.ok(pointInPoly(box.x, box.y + dy, c), 'left edge outside at dy=' + dy);
      assert.ok(pointInPoly(box.x + 90, box.y + dy, c), 'right edge outside at dy=' + dy);
    }
  });

  test('a circle pushes the label below its topmost point', () => {
    const box = fitLabelBox(circle(200, 200, 120), 90, 24, 6, 0);
    assert.ok(box.y > 80 + 24, 'must sit where the chord is wide, not at the apex');
  });

  test('a rounded corner pushes the label right, off the arc', () => {
    const r = rect(0, 0, 300, 200);
    assert.ok(fitLabelBox(r, 60, 20, 6, 60).x > fitLabelBox(r, 60, 20, 6, 0).x);
  });

  test('the indent equals the arc inset at the label top edge, exactly', () => {
    // The label's top always sits `pad` below the shape's top, so the indent is the arc's
    // horizontal offset at that depth — no fudge factor.
    const box = fitLabelBox(rect(0, 0, 300, 400), 60, 20, 6, 80);
    assert.ok(Math.abs(box.x - (6 + cornerInsetAt(80, 6))) < 1e-9);
  });

  test('a bigger corner radius indents further', () => {
    const r = rect(0, 0, 300, 400);
    const xs = [0, 20, 50, 90].map(cr => fitLabelBox(r, 60, 20, 6, cr).x);
    for (let i = 1; i < xs.length; i++) assert.ok(xs[i] > xs[i - 1], 'radius ' + i);
  });

  test('takes the highest row that fits the whole label', () => {
    const tri = [{ x: 150, y: 0 }, { x: 300, y: 300 }, { x: 0, y: 300 }];
    assert.ok(fitLabelBox(tri, 40, 20, 4, 0).y < fitLabelBox(tri, 200, 20, 4, 0).y,
      'a wider label must drop further down the triangle');
  });

  test('falls back to the roomiest row when nothing fits the whole label', () => {
    // The caller ellipsises into box.avail rather than dropping the label entirely.
    const box = fitLabelBox(rect(0, 0, 80, 200), 500, 20, 6, 0);
    assert.ok(box, 'should still return a row');
    assert.ok(box.avail > 0 && box.avail < 500);
  });

  test('returns null when the label is taller than the room', () => {
    assert.equal(fitLabelBox(rect(0, 0, 300, 10), 50, 40, 6, 0), null);
  });

  test('returns null for a degenerate polygon', () => {
    assert.equal(fitLabelBox([{ x: 0, y: 0 }, { x: 10, y: 10 }], 10, 10, 2, 0), null);
    assert.equal(fitLabelBox(null, 10, 10, 2, 0), null);
  });

  test('prefers the leftmost span on a concave row', () => {
    const box = fitLabelBox(bigU, 60, 20, 6, 0);
    assert.ok(box.x < 120, 'should land in the left prong, not the right one');
  });

  test('the returned anchor is inside a concave shape', () => {
    const box = fitLabelBox(bigU, 60, 20, 6, 0);
    assert.ok(pointInPoly(box.x, box.y, bigU));
    assert.ok(pointInPoly(box.x + 60, box.y, bigU));
  });
});

'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseEdid, edidsFromBase64, edidsFromIoreg, matchEdid } = require('../electron/tvSize.js');

// Recorded from a 27-inch 2560x1440 monitor on Linux (/sys/class/drm/*/edid, base block).
const MONITOR_HEX = '00ffffffffffff003103ffff000000000b220104b53c2278bf7855a5534c99250e5054a54b0081800101b300' +
  'd1c0714fa9c0814081c06a5e00a0a0a0295030203500544f2100001a000000fd0030b4ffff46010a202020202020000000fc005032' +
  '374132520a202020202020000000ff0030303030303030303030303030024c';

// The recording with its name, header size and first timing rewritten, the way the other screens arrive.
function edid({ name, cm, px, mm }) {
  const b = Buffer.from(MONITOR_HEX, 'hex');
  b[21] = cm[0]; b[22] = cm[1];
  b[56] = px[0] & 0xff; b[58] = (b[58] & 0x0f) | ((px[0] >> 4) & 0xf0);
  b[59] = px[1] & 0xff; b[61] = (b[61] & 0x0f) | ((px[1] >> 4) & 0xf0);
  b[66] = mm[0] & 0xff; b[67] = mm[1] & 0xff; b[68] = ((mm[0] >> 4) & 0xf0) | ((mm[1] >> 8) & 0x0f);
  b.fill(0x20, 95, 108);
  Buffer.from(name + '\n').copy(b, 95);
  return b;
}
// An LG TV reporting its aspect ratio times ten as its size: 160 x 90 cm, 1600 x 900 mm.
const LG_TV = edid({ name: 'LG TV SSCR2', cm: [160, 90], px: [3840, 2160], mm: [1600, 900] });
// A projector, which has no size of its own: 0 x 0.
const PROJECTOR = edid({ name: 'EPSON PJ', cm: [0, 0], px: [1920, 1080], mm: [0, 0] });

describe('parseEdid', () => {
  it('reads a good monitor: its name, preferred mode and 27 inches', () => {
    assert.deepEqual(parseEdid(Buffer.from(MONITOR_HEX, 'hex')), { name: 'P27A2R', w: 2560, h: 1440, inches: 27 });
  });
  it('ignores the LG TV\'s 160 x 90 cm', () => {
    assert.deepEqual(parseEdid(LG_TV), { name: 'LG TV SSCR2', w: 3840, h: 2160, inches: null });
  });
  it('ignores a projector\'s 0 x 0', () => {
    assert.deepEqual(parseEdid(PROJECTOR), { name: 'EPSON PJ', w: 1920, h: 1080, inches: null });
  });
  it('takes the timing\'s mm over the header\'s cm', () => {
    const b = edid({ name: 'TV', cm: [0, 0], px: [1920, 1080], mm: [1210, 680] });
    assert.equal(parseEdid(b).inches, 55);
  });
  it('falls back to the header\'s cm when the timing gives no mm', () => {
    const b = edid({ name: 'TV', cm: [121, 68], px: [1920, 1080], mm: [0, 0] });
    assert.equal(parseEdid(b).inches, 55);
  });
  it('refuses bytes that are not an EDID', () => {
    assert.equal(parseEdid(Buffer.alloc(128)), null);
    assert.equal(parseEdid(Buffer.from(MONITOR_HEX, 'hex').subarray(0, 100)), null);
    assert.equal(parseEdid(null), null);
  });
});

describe('each system\'s answer', () => {
  it('Windows: one base64 EDID per PowerShell line', () => {
    const text = [MONITOR_HEX, LG_TV.toString('hex')].map(h => Buffer.from(h, 'hex').toString('base64')).join('\r\n') + '\r\n';
    assert.deepEqual(edidsFromBase64(text).map(e => [e.name, e.inches]), [['P27A2R', 27], ['LG TV SSCR2', null]]);
    assert.deepEqual(edidsFromBase64(''), []);
  });
  it('Mac: IODisplayEDID on Intel, EDID under the DCP on Apple silicon, each once', () => {
    const text = '    | |   "IODisplayEDID" = <' + MONITOR_HEX + '>\n' +
      '    | |   "EDID" = <' + PROJECTOR.toString('hex').toUpperCase() + '>\n' +
      '    | |   "EDID" = <' + MONITOR_HEX + '>\n    | |   "IODisplayPrefsKey" = "x"\n';
    assert.deepEqual(edidsFromIoreg(text).map(e => [e.name, e.inches]), [['P27A2R', 27], ['EPSON PJ', null]]);
  });
});

describe('matchEdid', () => {
  const list = [parseEdid(Buffer.from(MONITOR_HEX, 'hex')), parseEdid(LG_TV), parseEdid(PROJECTOR)];
  it('finds a display by its name and full pixel size', () => {
    assert.equal(matchEdid(list, { label: 'P27A2R', scaleFactor: 1, size: { width: 2560, height: 1440 } }).inches, 27);
    assert.equal(matchEdid(list, { label: 'LG TV SSCR2', scaleFactor: 2, size: { width: 1920, height: 1080 } }).name, 'LG TV SSCR2');
  });
  it('finds a named display set to a mode below its preferred one', () => {
    assert.equal(matchEdid(list, { label: 'P27A2R', scaleFactor: 1, size: { width: 1920, height: 1080 } }).name, 'P27A2R');
  });
  it('finds an unnamed display by a pixel size only it has', () => {
    assert.equal(matchEdid(list, { label: '', scaleFactor: 1.25, size: { width: 2048, height: 1152 } }).name, 'P27A2R');
  });
  it('gives nothing when two screens cannot be told apart', () => {
    const twins = [list[0], { ...list[0], inches: 32 }];
    assert.equal(matchEdid(twins, { label: '', scaleFactor: 1, size: { width: 2560, height: 1440 } }), null);
    assert.equal(matchEdid(list, { label: 'Other', scaleFactor: 1, size: { width: 800, height: 600 } }), null);
  });
});

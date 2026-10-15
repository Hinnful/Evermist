'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const P = require('../src/gallery/galleryPlan.js');

const blob = type => ({ type });

describe('pictureBox', () => {
  it('takes the Compression box, and 4K when Compression is off', () => {
    assert.deepEqual(P.pictureBox({ w: 1920, h: 1080 }), { w: 1920, h: 1080 });
    assert.deepEqual(P.pictureBox({ value: '0' }), P.PICTURE_MAX_BOX);
    assert.deepEqual(P.pictureBox(null), P.PICTURE_MAX_BOX);
  });
});

describe('pictureFit', () => {
  it('shrinks a portrait to the box height and never upscales', () => {
    assert.deepEqual(P.pictureFit(6000, 10000, { w: 1920, h: 1080 }), { w: 648, h: 1080 });
    assert.deepEqual(P.pictureFit(800, 600, { w: 1920, h: 1080 }), { w: 800, h: 600 });
  });
});

describe('galleryNameFromFile', () => {
  it('strips the extension and nothing else', () => {
    assert.equal(P.galleryNameFromFile('Old King.portrait.PNG'), 'Old King.portrait');
    assert.equal(P.galleryNameFromFile('  letter.jpg '), 'letter');
    assert.equal(P.galleryNameFromFile('map'), 'map');
  });
  it('keeps a dotfile whole rather than leave nothing', () => {
    assert.equal(P.galleryNameFromFile('.png'), '.png');
    assert.equal(P.galleryNameFromFile(''), '');
  });
});

describe('roomPictureRefs', () => {
  it('drops a ref whose bytes are gone, and anything that is not a ref', () => {
    const poly = { pictures: [{ id: 'a' }, { id: 'b' }, null, { id: 3 }] };
    assert.deepEqual(P.roomPictureRefs(poly, { a: blob('image/jpeg') }), [{ id: 'a' }]);
    assert.deepEqual(P.roomPictureRefs({}, {}), []);
  });
});

describe('pictureZipName', () => {
  it('builds the name from the id and a fixed extension', () => {
    assert.equal(P.pictureZipName('k3x9', 'image/png'), 'pic-k3x9.png');
    assert.equal(P.pictureZipName('k3x9', 'image/gif'), 'pic-k3x9.gif');
    assert.equal(P.pictureZipName('k3x9', 'image/svg+xml'), 'pic-k3x9.svg');
    assert.equal(P.pictureZipName('k3x9', 'image/bmp'), 'pic-k3x9.jpg');
    assert.equal(P.pictureZipName('k3x9', '../x'), 'pic-k3x9.jpg');
  });
  it('refuses an id that could be a path', () => {
    assert.equal(P.pictureZipName('../map'), null);
    assert.equal(P.pictureZipName('A/b'), null);
    assert.equal(P.pictureZipName(''), null);
  });
});

describe('pictureBackupList / picturesReferenced', () => {
  const blobs = { a: blob('image/png'), b: blob('image/jpeg'), z: blob('image/jpeg') };
  const polys = [{ pictures: [{ id: 'a' }, { id: 'b' }] }, { pictures: [{ id: 'a' }, { id: 'gone' }] }];
  it('lists each referenced picture once, with its type', () => {
    assert.deepEqual(P.pictureBackupList(polys, blobs),
      [{ id: 'a', type: 'image/png' }, { id: 'b', type: 'image/jpeg' }]);
  });
  it('trims the bytes to what the rooms point at', () => {
    assert.deepEqual(Object.keys(P.picturesReferenced(polys, blobs)).sort(), ['a', 'b']);
  });
});

describe('galleryFromScenes', () => {
  const a = blob('image/png'), b = blob('image/jpeg');
  const scenes = [
    { polygons: [{ pictures: [{ id: 'a1', name: 'Old King.png' }, { id: 'gone', name: 'x.png' }] }], pictureBlobs: { a1: a } },
    null,
    { polygons: [{ pictures: [{ id: 'a1', name: 'Other.png' }, { id: 'b2', name: 'letter' }, { id: '../x', name: 'bad.png' }] }],
      pictureBlobs: { a1: a, b2: b, '../x': b } },
  ];
  it('copies every picture a room holds, once by its own id, named without the extension', () => {
    assert.deepEqual(P.galleryFromScenes(scenes),
      [{ id: 'a1', name: 'Old King', blob: a }, { id: 'b2', name: 'letter', blob: b }]);
  });
  it('is the same list on a rerun, which is what stops a duplicate', () => {
    assert.deepEqual(P.galleryFromScenes(scenes), P.galleryFromScenes(scenes));
  });
  it('names a picture whose ref has no name by its id, and reads a scene with no pictures as none', () => {
    assert.equal(P.galleryFromScenes([{ polygons: [{ pictures: [{ id: 'q', name: '' }] }], pictureBlobs: { q: a } }])[0].name, 'q');
    assert.deepEqual(P.galleryFromScenes([{ polygons: [{}] }, {}]), []);
  });
  it('leaves the scenes it reads as they were', () => {
    const before = JSON.stringify(scenes);
    P.galleryFromScenes(scenes);
    assert.equal(JSON.stringify(scenes), before);
  });
});

describe('galleryMissing', () => {
  it('keeps only ids the gallery does not hold, once each', () => {
    const got = P.galleryMissing(['a'], [{ id: 'a' }, { id: 'b' }, { id: 'b' }, { id: 'c' }, { id: '../d' }, null]);
    assert.deepEqual(got.map(p => p.id), ['b', 'c']);
  });
});

describe('galleryBackupMeta / galleryParseMeta', () => {
  const pics = [{ id: 'a', name: 'King', added: 5, blob: blob('image/png') }, { id: '../x', name: 'bad', blob: blob('image/png') }];
  it('writes a list a restore reads back', () => {
    const meta = P.galleryBackupMeta(pics);
    assert.deepEqual(meta, [{ id: 'a', name: 'King', added: 5, type: 'image/png' }]);
    assert.deepEqual(P.galleryParseMeta(JSON.stringify(meta)), meta);
  });
  it('reads damage as an empty list and drops an entry with no usable id or name', () => {
    assert.deepEqual(P.galleryParseMeta('not json'), []);
    assert.deepEqual(P.galleryParseMeta('{}'), []);
    assert.deepEqual(P.galleryParseMeta([{ id: 'a', name: ' ' }, { id: '../a', name: 'x' }, { id: 'b', name: 'ok', type: 'image/bmp' }]),
      [{ id: 'b', name: 'ok', added: 0, type: 'image/jpeg' }]);
  });
});

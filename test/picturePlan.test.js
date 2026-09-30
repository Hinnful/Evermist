'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const P = require('../src/rooms/picturePlan.js');

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

describe('roomPictureRefs', () => {
  it('drops a ref whose bytes are gone, and anything that is not a ref', () => {
    const poly = { pictures: [{ id: 'a' }, { id: 'b' }, null, { id: 3 }] };
    assert.deepEqual(P.roomPictureRefs(poly, { a: blob('image/jpeg') }), [{ id: 'a' }]);
    assert.deepEqual(P.roomPictureRefs({}, {}), []);
  });
});

describe('picturesMoved / picturesWithout', () => {
  const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  it('moves one and returns a new array', () => {
    const out = P.picturesMoved(list, 0, 2);
    assert.deepEqual(out.map(p => p.id), ['b', 'c', 'a']);
    assert.notEqual(out, list);
    assert.deepEqual(list.map(p => p.id), ['a', 'b', 'c']);
  });
  it('deletes by id', () => {
    assert.deepEqual(P.picturesWithout(list, 'b').map(p => p.id), ['a', 'c']);
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

describe('tvPictureLive', () => {
  const blobs = { a: blob('image/jpeg') };
  const polys = [{ id: 4, pictures: [{ id: 'a' }] }];
  it('holds while the room still carries the picture in the same scene', () => {
    assert.equal(P.tvPictureLive({ sceneId: 's', roomId: 4, picId: 'a' }, 's', polys, blobs), true);
  });
  it('fails on another scene, a deleted room or a deleted picture', () => {
    assert.equal(P.tvPictureLive({ sceneId: 's', roomId: 4, picId: 'a' }, 't', polys, blobs), false);
    assert.equal(P.tvPictureLive({ sceneId: 's', roomId: 5, picId: 'a' }, 's', polys, blobs), false);
    assert.equal(P.tvPictureLive({ sceneId: 's', roomId: 4, picId: 'b' }, 's', polys, blobs), false);
    assert.equal(P.tvPictureLive(null, 's', polys, blobs), false);
  });
});

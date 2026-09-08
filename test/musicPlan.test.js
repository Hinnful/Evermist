'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseMusicUrl,
  videoIdFromFileName,
  displayName,
  filterTracks,
  fadeLevel,
  fadePhase,
  formatDuration,
  formatBytes,
} = require('../src/musicPlan');

describe('parseMusicUrl', () => {

  it('reads a plain watch link as one video', () => {
    const r = parseMusicUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    assert.equal(r.mode, 'video');
    assert.equal(r.videoId, 'dQw4w9WgXcQ');
    assert.equal(r.playlistId, null);
  });

  // The case that decides the feature: a link copied while a playlist is open carries both ids,
  // and taking the playlist downloads a hundred tracks nobody asked for.
  it('prefers the video when a link carries both a video and a list', () => {
    const r = parseMusicUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLFgquLnL59alW3xmYiWRaoz0oM3H17Lth');
    assert.equal(r.mode, 'video');
    assert.equal(r.videoId, 'dQw4w9WgXcQ');
    assert.equal(r.playlistId, 'PLFgquLnL59alW3xmYiWRaoz0oM3H17Lth');
  });

  it('reads a pure playlist link as a playlist', () => {
    const r = parseMusicUrl('https://www.youtube.com/playlist?list=PLFgquLnL59alW3xmYiWRaoz0oM3H17Lth');
    assert.equal(r.mode, 'playlist');
    assert.equal(r.videoId, null);
    assert.equal(r.playlistId, 'PLFgquLnL59alW3xmYiWRaoz0oM3H17Lth');
  });

  it('reads the short, shorts, live and embed forms', () => {
    assert.equal(parseMusicUrl('https://youtu.be/dQw4w9WgXcQ').videoId, 'dQw4w9WgXcQ');
    assert.equal(parseMusicUrl('https://youtu.be/dQw4w9WgXcQ?list=PLFgquLnL59alW3xmYiWRaoz0oM3H17Lth').mode, 'video');
    assert.equal(parseMusicUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ').videoId, 'dQw4w9WgXcQ');
    assert.equal(parseMusicUrl('https://www.youtube.com/live/dQw4w9WgXcQ').videoId, 'dQw4w9WgXcQ');
    assert.equal(parseMusicUrl('https://www.youtube.com/embed/dQw4w9WgXcQ').videoId, 'dQw4w9WgXcQ');
  });

  it('accepts the mobile and music hosts', () => {
    assert.equal(parseMusicUrl('https://m.youtube.com/watch?v=dQw4w9WgXcQ').videoId, 'dQw4w9WgXcQ');
    assert.equal(parseMusicUrl('https://music.youtube.com/watch?v=dQw4w9WgXcQ').videoId, 'dQw4w9WgXcQ');
  });

  // yt-dlp handles a long list of other sites, and none of them needs an id parsed out.
  it('passes a non-YouTube link through verbatim', () => {
    const url = 'https://fabomusic.bandcamp.com/track/into-the-mists';
    const r = parseMusicUrl(url);
    assert.equal(r.mode, 'video');
    assert.equal(r.videoId, null);
    assert.equal(r.url, url);
  });

  it('refuses anything that is not a usable link', () => {
    for (const bad of ['', '   ', 'not a url', 'dQw4w9WgXcQ', 'ftp://youtube.com/watch?v=dQw4w9WgXcQ',
                       'https://www.youtube.com/', null, undefined, 42, {}]) {
      assert.equal(parseMusicUrl(bad).mode, null, JSON.stringify(bad) + ' should not parse');
    }
  });

  it('refuses a video id of the wrong length', () => {
    assert.equal(parseMusicUrl('https://www.youtube.com/watch?v=tooshort').mode, null);
    assert.equal(parseMusicUrl('https://youtu.be/waaaaaaaaaaaaytoolong').mode, null);
  });

  it('ignores a list parameter too short to be a real playlist', () => {
    const r = parseMusicUrl('https://www.youtube.com/playlist?list=PL123');
    assert.equal(r.mode, null);
  });

  it('trims surrounding whitespace, which a paste carries', () => {
    assert.equal(parseMusicUrl('  https://youtu.be/dQw4w9WgXcQ \n').videoId, 'dQw4w9WgXcQ');
  });
});

describe('videoIdFromFileName', () => {

  it('reads the id back out of a downloaded name', () => {
    assert.equal(videoIdFromFileName('Strahd Battle Theme [dQw4w9WgXcQ].m4a'), 'dQw4w9WgXcQ');
    assert.equal(videoIdFromFileName('Strahd Battle Theme [dQw4w9WgXcQ]'), 'dQw4w9WgXcQ');
  });

  it('reads an id out of a title that itself holds brackets', () => {
    assert.equal(videoIdFromFileName('Into the Mists [1 Hour Loop] [dQw4w9WgXcQ].webm'), 'dQw4w9WgXcQ');
  });

  it('returns null for a file that carries no id', () => {
    for (const name of ['handmade.mp3', 'Into the Mists.m4a', 'Into the Mists [short].m4a', '', null]) {
      assert.equal(videoIdFromFileName(name), null, String(name));
    }
  });
});

describe('displayName', () => {

  it('drops the extension and the id', () => {
    assert.equal(displayName('Strahd Battle Theme [dQw4w9WgXcQ].m4a'), 'Strahd Battle Theme');
  });

  it('leaves a hand-dropped file alone but for its extension', () => {
    assert.equal(displayName('Tavern Ambience.mp3'), 'Tavern Ambience');
  });

  it('keeps brackets that are part of the title', () => {
    assert.equal(displayName('Into the Mists [1 Hour Loop] [dQw4w9WgXcQ].webm'), 'Into the Mists [1 Hour Loop]');
  });

  it('never returns an empty label', () => {
    assert.equal(displayName('[dQw4w9WgXcQ].m4a'), '[dQw4w9WgXcQ].m4a');
    assert.equal(displayName(''), '');
  });
});

describe('filterTracks', () => {
  const tracks = [
    { name: 'Strahd Battle Theme' },
    { name: 'Village of Barovia' },
    { name: 'Крипты' },
  ];

  it('returns everything for an empty query', () => {
    assert.equal(filterTracks(tracks, '').length, 3);
    assert.equal(filterTracks(tracks, '   ').length, 3);
  });

  it('matches a substring anywhere in the name', () => {
    assert.deepEqual(filterTracks(tracks, 'barovia').map(t => t.name), ['Village of Barovia']);
  });

  it('ignores case, including in Cyrillic', () => {
    assert.equal(filterTracks(tracks, 'STRAHD').length, 1);
    assert.equal(filterTracks(tracks, 'КРИПТЫ').length, 1);
    assert.equal(filterTracks(tracks, 'крипты').length, 1);
  });

  it('matches the display name, never the video id in the filename', () => {
    const withIds = [{ name: 'Ireena [dQw4w9WgXcQ].m4a', display: 'Ireena' }];
    assert.equal(filterTracks(withIds, 'ireena').length, 1);
    assert.equal(filterTracks(withIds, 'dQw4').length, 0);
  });

  it('survives a bad list or a bad row', () => {
    assert.deepEqual(filterTracks(null, 'x'), []);
    assert.deepEqual(filterTracks([null, {}, { name: 5 }], 'x'), []);
  });
});

describe('fadeLevel and fadePhase', () => {

  it('runs a fade from silence to full', () => {
    assert.equal(fadeLevel(0), 0);
    assert.ok(Math.abs(fadeLevel(1) - 1) < 1e-9);
  });

  // Two linear ramps dip audibly in the middle, because power goes as the square of amplitude.
  it('holds constant power across a crossfade', () => {
    for (let i = 0; i <= 20; i++) {
      const p = i / 20;
      const a = fadeLevel(p), b = fadeLevel(1 - p);
      assert.ok(Math.abs(a * a + b * b - 1) < 1e-9, 'power dips at phase ' + p);
    }
  });

  it('inverts itself, so a reversed fade resumes where it is', () => {
    for (const p of [0, 0.13, 0.5, 0.87, 1]) {
      assert.ok(Math.abs(fadePhase(fadeLevel(p)) - p) < 1e-9, 'round trip fails at ' + p);
    }
  });

  it('clamps a phase or a level from outside the range', () => {
    assert.equal(fadeLevel(-3), 0);
    assert.ok(Math.abs(fadeLevel(9) - 1) < 1e-9);
    assert.equal(fadePhase(-3), 0);
    assert.ok(Math.abs(fadePhase(9) - 1) < 1e-9);
    assert.equal(fadeLevel(NaN), 0);
    assert.equal(fadePhase(undefined), 0);
  });
});

describe('formatDuration', () => {

  it('writes minutes under an hour and hours over it', () => {
    assert.equal(formatDuration(0), '0:00');
    assert.equal(formatDuration(9), '0:09');
    assert.equal(formatDuration(70), '1:10');
    assert.equal(formatDuration(3604), '1:00:04');
    assert.equal(formatDuration(3600 * 3 + 61), '3:01:01');
  });

  it('survives junk', () => {
    assert.equal(formatDuration(null), '0:00');
    assert.equal(formatDuration(-5), '0:00');
    assert.equal(formatDuration('abc'), '0:00');
  });
});

describe('formatBytes', () => {

  it('rounds to a unit a person reads', () => {
    assert.equal(formatBytes(1024 * 500), '500 KB');
    assert.equal(formatBytes(57 * 1024 * 1024), '57 MB');
    assert.equal(formatBytes(5.5 * 1024 * 1024 * 1024), '5.5 GB');
  });

  it('says nothing rather than zero when the size is unknown', () => {
    assert.equal(formatBytes(0), '');
    assert.equal(formatBytes(null), '');
    assert.equal(formatBytes('x'), '');
  });
});

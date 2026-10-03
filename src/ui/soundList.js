'use strict';

// soundList.js — the soundboard's built-in sounds: six groups of five. Data only. Each file sits
// in assets/sounds/, and every one is CC0.

const SOUND_GROUPS = [
  { name: 'Doors and traps', sounds: [
    { file: 'door-creak.mp3', name: 'Door creak' },
    { file: 'door-slam.mp3', name: 'Door slam' },
    { file: 'door-knock.mp3', name: 'Knock' },
    { file: 'trap.mp3', name: 'Trap' },
    { file: 'chains.mp3', name: 'Chains' },
  ] },
  { name: 'Combat', sounds: [
    { file: 'sword-clash.mp3', name: 'Swords clash' },
    { file: 'sword-draw.mp3', name: 'Sword drawn' },
    { file: 'arrow-hit.mp3', name: 'Arrow hits' },
    { file: 'arrow-whoosh.mp3', name: 'Arrow flies' },
    { file: 'war-drum.mp3', name: 'War drum' },
  ] },
  { name: 'Monsters', sounds: [
    { file: 'growl.mp3', name: 'Growl' },
    { file: 'dragon-roar.mp3', name: 'Dragon roar' },
    { file: 'wolf-howl.mp3', name: 'Wolf howl' },
    { file: 'evil-laugh.mp3', name: 'Evil laugh' },
    { file: 'scream.mp3', name: 'Scream' },
  ] },
  { name: 'Magic', sounds: [
    { file: 'spell.mp3', name: 'Spell' },
    { file: 'fireball.mp3', name: 'Fireball' },
    { file: 'explosion.mp3', name: 'Explosion' },
    { file: 'bell.mp3', name: 'Bell' },
    { file: 'bones.mp3', name: 'Bones' },
  ] },
  { name: 'Nature', sounds: [
    { file: 'thunder.mp3', name: 'Thunder' },
    { file: 'wind.mp3', name: 'Wind gust' },
    { file: 'splash.mp3', name: 'Splash' },
    { file: 'crow.mp3', name: 'Crow' },
    { file: 'rats.mp3', name: 'Rats' },
  ] },
  { name: 'People', sounds: [
    { file: 'footsteps.mp3', name: 'Footsteps' },
    { file: 'coins.mp3', name: 'Coins' },
    { file: 'glass-break.mp3', name: 'Glass breaks' },
    { file: 'horn.mp3', name: 'Horn' },
    { file: 'heartbeat.mp3', name: 'Heartbeat' },
  ] },
];

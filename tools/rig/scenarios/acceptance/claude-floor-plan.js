'use strict';

// claude-floor-plan.js — CLAUDE LOADS A FLOOR PLAN ONTO A MAP NOBODY HAS OPEN, AND GETS WHAT DRAW ROOMS GETS.
//
// THE GOAL: load_floor_plan (src/mcp/mcpImport.js) takes rooms, doors, lights and grid from a .dd2vtt through the
// app's own builders, so a closed map ends up exactly as the DM's Draw Rooms would leave it. On a map that already
// has rooms it asks first, and changes nothing until confirmed: true.
//
// The plan is test/fixtures/sample-map.dd2vtt (three rooms, one light), read from disk by path as Claude reads it.
// The map is half the export's width, so a plan whose rooms were not scaled onto the map comes out twice too big.
//
//   A. On a closed map with no rooms, the plan's rooms are stored with the map at once, with the plan itself.
//   B. Called again on that map, now holding rooms, it answers what would be replaced and the stored map is unchanged.
//   C. With confirmed: true it draws them again.
//   D. The stored rooms, doors, lights and grid size are exactly what Draw Rooms makes on that map.

const fs = require('fs');
const path = require('path');
const lib = require('../../lib');

const PLAN_PATH = path.join(__dirname, '..', '..', '..', '..', 'test', 'fixtures', 'sample-map.dd2vtt');
const ONE_W = 1575, ONE_H = 1050;

module.exports = async function claudeFloorPlan(rig) {
  const dm = rig.dm;
  // A still: the plan's odd width cannot be an animated map, which the encoder rounds to an even size.
  await lib.openMap(rig, { w: ONE_W, h: ONE_H, kind: 'still' });
  const one = await dm.evaluate('currentScene.id');
  const name = await dm.evaluate('currentScene.name');
  await lib.openMap(rig, { w: 1000, h: 700 });
  rig.check(await dm.evaluate('currentScene.id !== "' + one + '"'), 'the first map is still open, so nothing below tests a closed map');

  const address = await lib.poll(async () => {
    try { return JSON.parse(fs.readFileSync(path.join(rig.profileDir, 'mcp.json'), 'utf8')); } catch { return null; }
  }, 15000);
  rig.check(!!(address && address.port && address.token), 'the app wrote no mcp.json with a port and a key into its profile');
  if (!address) return;
  const call = async (tool, args) => (await fetch('http://127.0.0.1:' + address.port + '/call', {
    method: 'POST', body: JSON.stringify({ tool, args: args || {} }),
    headers: { 'content-type': 'application/json', 'x-evermist-token': address.token },
  })).json();
  const stored = () => dm.evaluate(`(async () => {
    const r = await sceneStore.loadScene(${JSON.stringify(one)});
    return { rooms: (r.polygons || []).length, lights: (r.lightShapes || []).length, plan: !!r.floorPlan, json: JSON.stringify(r.polygons || []) };
  })()`);

  // ── A ──
  // RED BY DESIGN: written against the feature, never re-proved
  const first = await call('load_floor_plan', { name, path: PLAN_PATH });
  const a = await stored();
  rig.check(!first.isError && a.rooms === 3 && a.plan, 'A: the plan\'s rooms did not reach the closed map: ' + JSON.stringify({ first, a: { rooms: a.rooms, plan: a.plan } }));

  // ── B ──
  // RED BY DESIGN: written against the feature, never re-proved
  const asked = await call('load_floor_plan', { name, path: PLAN_PATH });
  const b = await stored();
  rig.check(!asked.isError && /confirmed: true/.test(asked.text) && /3 rooms/.test(asked.text) && b.json === a.json,
            'B: a map with rooms was not asked about first, or changed before the yes: ' + JSON.stringify(asked));

  // ── C ──
  // RED BY DESIGN: written against the feature, never re-proved
  const done = await call('load_floor_plan', { name, path: PLAN_PATH, confirmed: true });
  const c = await stored();
  rig.check(!done.isError && c.rooms === 3 && /Loaded the floor plan/.test(done.text), 'C: confirmed: true did not draw the plan: ' + JSON.stringify(done));

  // ── D ──
  // RED BY DESIGN: written against the feature, never re-proved
  const same = await dm.evaluate(`(async () => {
    await switchScene(${JSON.stringify(one)});
    const pick = () => JSON.stringify({ rooms: polygons.map(p => ({ v: p.vertices, n: p.name, m: p.mode, d: p.doors || [] })),
      lights: lightShapes.map(l => ({ v: l.vertices, h: l.holes || null })), grid: gridSize });
    const claude = pick();
    const plan = currentScene.floorPlan;
    applyPlanGridSize();
    applyPlanToScene(describePlan(plan));
    lightShapes = [];
    applyPlanLights();
    return { claude, app: pick() };
  })()`, 120000);
  rig.check(same.claude === same.app, 'D: Claude\'s rooms, doors, lights or grid differ from Draw Rooms on the same map: ' + JSON.stringify(same).slice(0, 600));
};

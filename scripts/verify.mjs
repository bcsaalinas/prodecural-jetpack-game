/** headless checks against the real game and config modules */

import { strict as assert } from "node:assert";

import { defaultConfig } from "../dist-verify/config/gameplayConfig.js";
import { Game, GameState } from "../dist-verify/game/Game.js";
import { aabbOverlap } from "../dist-verify/game/Collision.js";
import { integrateVertical } from "../dist-verify/game/Physics.js";
import { SeededRandom } from "../dist-verify/game/Random.js";
import { reachableBand, simulatePath } from "../dist-verify/game/Trajectory.js";
import { World } from "../dist-verify/game/World.js";

let passed = 0;
function ok(name) {
  passed++;
  console.log(`  ok - ${name}`);
}

// seeded random
{
  const a = new SeededRandom(12345);
  const b = new SeededRandom(12345);
  const c = new SeededRandom(999);
  const seqA = Array.from({ length: 1000 }, () => a.next());
  const seqB = Array.from({ length: 1000 }, () => b.next());
  const seqC = Array.from({ length: 1000 }, () => c.next());
  assert.deepStrictEqual(seqA, seqB, "same seed -> same stream");
  assert.notDeepStrictEqual(seqA, seqC, "different seed -> different stream");
  assert.ok(seqA.every((v) => v >= 0 && v < 1), "values in [0,1)");
  ok("SeededRandom determinism + range");
}

// deterministic replay and spawn order
function runScripted(seed, steps) {
  const cfg = defaultConfig();
  cfg.seed = seed;
  const g = new Game(cfg);
  const spawned = [];
  const orig = g.spawner.update.bind(g.spawner);
  g.spawner.update = (cameraX, y, vy, speed, out) => {
    const before = out.length;
    orig(cameraX, y, vy, speed, out);
    for (let i = before; i < out.length; i++) spawned.push(out[i]);
  };
  for (let i = 0; i < steps; i++) {
    // fixed input blocks make both runs comparable
    g.input.isDown = Math.floor(i / 30) % 2 === 0;
    g.step(cfg.fixedDt);
    if (g.state === GameState.DEAD) break;
  }
  return {
    seq: spawned.map((o) => [o.id, o.type, o.worldX, o.width, o.possible]),
    final: {
      state: g.state,
      distance: g.camera.x,
      time: g.time,
      y: g.player.y,
      vy: g.player.vy,
      stepCount: g.stepCount,
      death: g.deathInfo,
    },
  };
}

{
  const a = runScripted(12345, 8000);
  const b = runScripted(12345, 8000);
  assert.deepStrictEqual(a, b, "same seed + same input -> identical run");
  ok(`deterministic replay (seed 12345, ${a.seq.length} obstacles, ended ${a.final.state} @ ${a.final.distance.toFixed(0)}px)`);

  const c = runScripted(999, 8000);
  assert.notDeepStrictEqual(a.seq, c.seq, "different seed -> different level");
  ok("different seed produces a different obstacle sequence");

  assert.ok(a.seq.length > 5, "obstacles actually spawned");
  const xs = a.seq.map(([, , x]) => x);
  assert.ok(xs.every((x, i) => i === 0 || x > xs[i - 1]), "spawn x strictly increasing");
  ok("spawn schedule is strictly ordered");
}

// physics integration and clamps
{
  const cfg = defaultConfig();

  // one step from rest checks the integration order
  const s = { y: 100, vy: 0, ay: 0, thrusting: false };
  integrateVertical(s, cfg, cfg.fixedDt);
  assert.ok(Math.abs(s.vy - cfg.gravity * cfg.fixedDt) < 1e-9, "vy = g*dt");
  assert.ok(Math.abs(s.y - (100 + cfg.gravity * cfg.fixedDt * cfg.fixedDt)) < 1e-9, "y uses NEW vy");
  ok("semi-implicit Euler: velocity first, position from new velocity");

  const fall = { y: 100, vy: 0, ay: 0, thrusting: false };
  for (let i = 0; i < 600; i++) integrateVertical(fall, cfg, cfg.fixedDt);
  assert.strictEqual(fall.vy, cfg.maxFallSpeed, "vy clamps at maxFallSpeed");
  ok("terminal velocity clamp (fall)");

  const rise = { y: 500, vy: 0, ay: 0, thrusting: true };
  for (let i = 0; i < 600; i++) integrateVertical(rise, cfg, cfg.fixedDt);
  assert.strictEqual(rise.vy, cfg.maxRiseSpeed, "vy clamps at maxRiseSpeed");
  assert.ok(rise.ay < 0, "net acceleration is upward while thrusting");
  assert.ok(rise.y < 500, "thrust makes the player rise");
  ok("thrust overcomes gravity; rise clamp holds");

  // the same fixed steps must end on the same state
  const r1 = { y: 300, vy: 10, ay: 0, thrusting: true };
  const r2 = { y: 300, vy: 10, ay: 0, thrusting: true };
  for (let i = 0; i < 240; i++) {
    integrateVertical(r1, cfg, 1 / 60);
    integrateVertical(r2, cfg, 1 / 60);
  }
  assert.strictEqual(r1.y, r2.y);
  ok("identical fixed steps -> identical state (determinism)");
}

// AABB collision
{
  assert.ok(aabbOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 }));
  assert.ok(!aabbOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 }), "touching edges do NOT overlap (strict)");
  assert.ok(!aabbOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 0, y: 20, w: 10, h: 10 }));
  ok("AABB overlap: partial overlap hits, edge-touch does not");
}

// trajectory prediction
{
  const cfg = defaultConfig();
  const world = new World(cfg);
  const y0 = (world.ceilingY() + world.floorY()) / 2;

  const down = simulatePath(y0, 0, false, 1.0, cfg, world);
  const up = simulatePath(y0, 0, true, 1.0, cfg, world);
  assert.ok(down[down.length - 1].y > y0, "released -> falls");
  assert.ok(up[up.length - 1].y < y0, "held -> rises");
  ok("prediction: release falls, hold rises");

  const band = reachableBand(y0, 0, 1.0, cfg, world);
  assert.ok(band.minY <= band.maxY, "band ordered");
  assert.ok(band.minY >= world.ceilingY() - 1e-9, "band respects ceiling");
  assert.ok(band.maxY <= world.floorY() - cfg.playerHeight + 1e-9, "band respects floor");
  ok("reachable band is bounded by the corridor");
}

// validator reaction window
{
  const cfg = defaultConfig();
  cfg.spawnAheadDistance = 500; // forces a short warning window
  cfg.worldStartSpeed = 1200; // keeps the warning window below the limit
  cfg.worldMaxSpeed = 1200;
  const g = new Game(cfg);
  g.input.isDown = true;
  for (let i = 0; i < 240 && g.state !== GameState.DEAD; i++) g.step(cfg.fixedDt);
  const flagged = g.obstacles.filter((o) => !o.possible);
  assert.ok(
    g.spawner.rejectedLog.length > 0 || flagged.length > 0,
    "validator should flag obstacles with ~0.4s reaction window",
  );
  ok(`validator flags impossible setups (${g.spawner.rejectedLog.length} rejections logged)`);
}

console.log(`\nAll ${passed} verification groups passed.`);

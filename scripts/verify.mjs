/** headless checks against the real game and config modules */

import { strict as assert } from "node:assert";

import { defaultConfig } from "../dist-verify/config/gameplayConfig.js";
import { Game, GameState } from "../dist-verify/game/Game.js";
import { aabbOverlap } from "../dist-verify/game/Collision.js";
import { integrateVertical } from "../dist-verify/game/Physics.js";
import { SeededRandom } from "../dist-verify/game/Random.js";
import { reachableBand, simulatePath } from "../dist-verify/game/Trajectory.js";
import { World } from "../dist-verify/game/World.js";
import { Spawner } from "../dist-verify/game/Spawner.js";
import { Obstacle, ObstacleType } from "../dist-verify/game/Obstacle.js";
import { generateCandidates } from "../dist-verify/game/procedural/CandidateGenerator.js";
import { AgentRun, evaluateCandidate } from "../dist-verify/game/procedural/AgentController.js";
import { EncounterSimulation, cameraAfterSteps, cameraStepsBetween } from "../dist-verify/game/procedural/Encounter.js";
import { findCollision } from "../dist-verify/game/Collision.js";
import { computeDifficulty, worldSpeedAt } from "../dist-verify/game/Difficulty.js";
import { validateObstacle } from "../dist-verify/game/Validator.js";
import { encounterSeed, genomeSeed, hash32, streamFor } from "../dist-verify/game/procedural/RandomStreams.js";
import {
  cheapConstraints, crossover, genomeKey, initRanges, legalBounds, mutate, randomGenome, realizeGenome, signatureOf, structuralDistance,
} from "../dist-verify/game/procedural/EncounterGenome.js";
import { ENCOUNTER_LEAD_TIME, bandCloseness, pacingTarget, phaseForEncounter } from "../dist-verify/game/procedural/Pacing.js";
import { MOTIFS, motifGenome, safeFallbackGenome } from "../dist-verify/game/procedural/PatternLibrary.js";
import {
  defaultEntryStates, entryStatesFromExits, feasibilityFromEntry, feasibilitySettings, validateSequence,
} from "../dist-verify/game/procedural/SequenceValidator.js";
import { AGENT_PROFILES } from "../dist-verify/game/procedural/AgentController.js";
import { measure, runProfiles, scoreCandidate } from "../dist-verify/game/procedural/Fitness.js";
import { DiversityArchive } from "../dist-verify/game/procedural/DiversityArchive.js";
import { SearchRun, budgetFromConfig, nextEntryStates } from "../dist-verify/game/procedural/SearchGenerator.js";

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
function runScripted(seed, steps, encounterMode = 0) {
  const cfg = defaultConfig();
  cfg.seed = seed;
  cfg.encounterMode = encounterMode;
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

// Recovery must create an observable gap without depending on render batching.
{
  function spawnToHorizon(seed, recoveryTime, horizons) {
    const cfg = defaultConfig();
    cfg.encounterMode = 0; // the weighted baseline owns the recovery rule
    cfg.recoveryTime = recoveryTime;
    const world = new World(cfg);
    const spawner = new Spawner(cfg, world);
    spawner.reset(seed);
    const obstacles = [];
    for (const horizon of horizons) {
      cfg.spawnAheadDistance = horizon - cfg.playerScreenX;
      spawner.update(0, 280, 0, cfg.worldStartSpeed, obstacles);
    }
    return { cfg, spawner, obstacles };
  }

  const baseline = spawnToHorizon(12345, 0, [4000]);
  const paced = spawnToHorizon(12345, 0.75, [4000]);
  assert.deepStrictEqual(
    paced.obstacles.slice(0, 3).map((o) => o.getRects(0, 0)),
    baseline.obstacles.slice(0, 3).map((o) => o.getRects(0, 0)),
    "the opening three challenges retain their geometry",
  );
  const third = paced.obstacles[2];
  const scheduledSpeed = 320 + (760 - 320) * (third.worldX - 180) / 12000;
  const extraGap = paced.obstacles[3].worldX - baseline.obstacles[3].worldX;
  assert.ok(Math.abs(extraGap / scheduledSpeed - 0.75) < 1e-9,
    "first recovery adds the requested travel-time budget between #3 and #4");
  assert.ok(extraGap > 240, "default recovery adds noticeable breathing room");
  assert.ok(baseline.obstacles.every((o) => o.recoveryAfter === 0), "zero restores baseline pacing");
  ok("recovery creates extra breathing room after the opening three challenges; zero disables it");

  for (const seed of [12345, 999, 0]) {
    const batched = spawnToHorizon(seed, 0.75, [14000]);
    const incremental = spawnToHorizon(seed, 0.75, [1500, 3000, 6000, 10000, 14000]);
    assert.deepStrictEqual(batched.obstacles, incremental.obstacles,
      `seed ${seed}: geometry and cadence survive different spawn batching`);
    batched.spawner.reset(seed);
    const replay = [];
    batched.spawner.update(0, 280, 0, batched.cfg.worldStartSpeed, replay);
    assert.deepStrictEqual(replay, incremental.obstacles, "restart resets both seed and recovery cadence");
  }
  ok("recovery determinism across seeds, spawn batching, and restart");

  const live = spawnToHorizon(12345, 0, [1500]);
  const committed = live.obstacles[0].worldX;
  live.cfg.recoveryTime = 1.5;
  live.cfg.spawnAheadDistance = 5000;
  live.spawner.update(0, 280, 0, 320, live.obstacles);
  assert.equal(live.obstacles[0].worldX, committed, "live tuning preserves committed positions");
  assert.equal(live.obstacles[2].recoveryAfter, 1.5, "live tuning applies to the next recovery interval");
  ok("live recovery tuning affects new scheduling while preserving committed obstacles");
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
  cfg.encounterMode = 0;
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

// Candidate lab uses real generation and agent rollouts, not display fixtures.
{
  const cfg = defaultConfig();
  const candidates = generateCandidates(cfg, 12345);
  assert.equal(candidates.length, 6);
  assert.deepStrictEqual(candidates, generateCandidates(cfg, 12345), "seed/config reproduce every alternative and witness");
  assert.notDeepStrictEqual(candidates, generateCandidates(cfg, 999), "different seed changes expansion choices");
  cfg.gravity = 2000;
  assert.equal(candidates[0].cfg.gravity, 1450, "generated candidates keep the captured physics snapshot");
  for (const c of candidates) {
    assert.equal(c.rejection, null, "default construction produces actual solid obstacles");
    const replay = new EncounterSimulation(c.cfg, c.obstacles);
    const trace = [replay.frame()];
    for (const f of c.witness.slice(1)) trace.push(replay.step(f.hold));
    assert.deepStrictEqual(trace, c.witness, "construction witness survives the real collision simulation");
  }
  ok("six deterministic candidate alternatives, immutable config snapshot and verified construction witnesses");

  for (const candidate of candidates) {
    const result = evaluateCandidate(candidate);
    assert.ok(result.completed, `${candidate.id}: agent should pass the default construction`);
    const stepped = new AgentRun(candidate);
    while (!stepped.done) stepped.advanceDecision();
    assert.deepStrictEqual(stepped.result(), result, "UI decision stepping matches uninterrupted headless evaluation");
    const replay = new EncounterSimulation(candidate.cfg, candidate.obstacles);
    const trace = [replay.frame()];
    for (const f of result.trace.slice(1)) trace.push(replay.step(f.hold));
    assert.deepStrictEqual(trace, result.trace, "recorded agent controls reproduce every physics and collision frame");
    for (const decision of result.decisions) {
      const frame = result.trace[decision.step];
      const visible = candidate.obstacles.filter((o) => o.worldX - frame.cameraX < 960 &&
        o.worldX + o.width > frame.cameraX + candidate.cfg.playerScreenX).map((o) => o.id);
      assert.deepStrictEqual(decision.visibleIds, visible, "agent observes only visible upcoming solids");
    }
    assert.deepStrictEqual(evaluateCandidate({ ...candidate, witness: [], parameters: {
      ...candidate.parameters, targetFractions: [0, 0, 0],
    } }), result, "agent cannot use the construction controls or target fractions");
  }
  ok("agent passes default candidates; visible-only planning, isolated witness and replay/step parity");

  const c = candidates[0];
  const wall = new Obstacle(99, ObstacleType.BLOCK_TOP, c.obstacles[0].worldX, c.cfg.obstacleWidth,
    [{ dx: 0, y: c.cfg.ceilingHeight, w: c.cfg.obstacleWidth, h: 600 - c.cfg.floorHeight - c.cfg.ceilingHeight }]);
  const impossible = evaluateCandidate({ ...c, obstacles: [wall] });
  assert.equal(impossible.completed, false);
  assert.equal(impossible.hitId, 99);
  assert.ok(impossible.progress < 1 && impossible.trace[impossible.trace.length - 1].hitId === 99);
  assert.ok(impossible.decisions.some((d) => d.collidedRollouts > 0), "planner records rejected colliding branches");
  assert.ok(impossible.decisions.some((d) => d.planningStatus === "NO_SAFE_ACTION" && d.predictedCost === null),
    "no surviving action is explicit and has no misleading prediction score");
  assert.throws(() => generateCandidates({ ...defaultConfig(), fixedDt: 0 }, 1));
  assert.throws(() => generateCandidates({ ...defaultConfig(), worldStartSpeed: 0 }, 1));
  assert.throws(() => generateCandidates({ ...defaultConfig(), fixedDt: 1 / 20, worldStartSpeed: 1600, obstacleWidth: 10 }, 1));
  assert.throws(() => new AgentRun(c, { beamWidth: 0, horizonActions: 8, actionSeconds: 0.1 }));
  ok("agent reports real collisions and rejected rollouts; invalid/unbounded lab settings are rejected");
}


// ---------------------------------------------------------------------------
// Encounter search (GDD milestones A–D): seeds, genomes, feasibility, agents,
// fitness, evolution, scheduler, fallback. Timings are printed because the
// evaluation budget is an open measurement.
// ---------------------------------------------------------------------------

const quiet = console.warn;
console.warn = () => {}; // the single-obstacle validator warns on purpose in a few setups below

// hierarchical deterministic seeds
{
  assert.equal(hash32(12345, 7), hash32(12345, 7));
  const seeds = Array.from({ length: 64 }, (_, i) => encounterSeed(12345, i));
  assert.equal(new Set(seeds).size, 64, "encounter seeds are distinct");
  assert.equal(encounterSeed(12345, 20), seeds[20], "encounter 20 does not depend on other encounters");
  const genomes = new Set();
  for (let g = 0; g < 4; g++) for (let slot = 0; slot < 8; slot++) genomes.add(genomeSeed(seeds[3], g, slot));
  assert.equal(genomes.size, 32, "genome seeds are distinct per generation and slot");
  ok("hierarchical seeds: hash(master, encounter) and hash(encounter, generation, slot) are distinct and independent");
}

// genome operators stay inside the legal bounds
{
  const cfg = defaultConfig();
  const world = new World(cfg);
  const bounds = legalBounds(cfg, world);
  const inBounds = (genome) => {
    assert.ok(genome.genes.length >= bounds.length[0] && genome.genes.length <= bounds.length[1], "length in bounds");
    for (const g of genome.genes) {
      assert.ok(g.spacing >= bounds.spacing[0] - 1e-9 && g.spacing <= bounds.spacing[1] + 1e-9, "spacing in bounds");
      assert.ok(g.center > 0 && g.center < 1, "center inside corridor");
      assert.ok(g.opening > 0 && g.opening <= 0.9, "opening in bounds");
      assert.ok(g.moverSpeed >= bounds.moverSpeed[0] && g.moverSpeed <= bounds.moverSpeed[1]);
    }
    for (const o of realizeGenome(genome, cfg, world, 1000, 1)) {
      for (const r of o.getRects(0, 0)) {
        assert.ok(r.y >= world.ceilingY() - 1e-6 && r.y + r.h <= world.floorY() + 1e-6, "solids stay inside the corridor");
      }
    }
  };
  let mutations = 0;
  for (const phase of ["WARMUP", "BUILD", "PEAK", "RECOVERY"]) {
    const target = pacingTarget(phase, 0.5);
    const ranges = initRanges(cfg, world, bounds, target);
    for (let seed = 1; seed <= 40; seed++) {
      const rng = streamFor(seed);
      const a = randomGenome(rng, target, ranges, bounds, `A${seed}`);
      const b = randomGenome(rng, target, ranges, bounds, `B${seed}`);
      inBounds(a); inBounds(b);
      let m = a;
      for (let i = 0; i < 6; i++) { m = mutate(m, rng, target, ranges, bounds, `M${i}`, "T"); inBounds(m); mutations++; }
      inBounds(crossover(a, b, rng, bounds, "X", "T"));
      assert.equal(genomeKey(a), genomeKey({ ...a, id: "other", history: [] }), "key ignores identity, keeps geometry");
      assert.equal(structuralDistance(signatureOf(a), signatureOf(a)), 0, "self distance is zero");
      const d = structuralDistance(signatureOf(a), signatureOf(b));
      assert.ok(d >= 0 && d <= 1, "distance normalized");
    }
    for (const motif of MOTIFS) inBounds(motifGenome(motif, streamFor(5), ranges, bounds, motif.name));
    inBounds(safeFallbackGenome(cfg, world, bounds, "FB"));
  }
  ok(`genome operators: ${mutations} mutations, crossovers, motifs and the fallback all stay inside legal bounds`);
}

// the headless simulation reproduces the live game step for step
{
  // movers appear once difficulty passes 0.1; a short ramp and a seed sweep find a run that reaches one
  const holdAt = (i) => Math.floor(i / 25) % 2 === 0 || i % 97 < 20;
  let cfg, liveTrace, obstacles;
  for (let seed = 1; seed <= 60; seed++) {
    cfg = defaultConfig();
    cfg.encounterMode = 0;
    cfg.difficultyDistance = 2500;
    cfg.seed = seed;
    const live = new Game(cfg);
    liveTrace = [];
    const seen = new Map();
    for (let i = 0; i < 2400 && live.state !== GameState.DEAD; i++) {
      live.input.isDown = holdAt(i);
      live.step(cfg.fixedDt);
      for (const o of live.obstacles) seen.set(o.id, o);
      liveTrace.push({ y: live.player.y, vy: live.player.vy, cameraX: live.camera.x, time: live.time, hit: live.deathInfo?.obstacleId ?? null });
    }
    obstacles = [...seen.values()].sort((a, b) => a.worldX - b.worldX);
    const reachedMover = obstacles.some((o) => o.moving && o.worldX < live.camera.x + cfg.playerScreenX + cfg.playerWidth);
    if (reachedMover && live.state === GameState.DEAD) break;
    obstacles = null;
  }
  assert.ok(obstacles, "a seed exists whose run reaches a moving hazard");
  const sim = new EncounterSimulation(cfg, obstacles, { speedAt: (x) => worldSpeedAt(computeDifficulty(x, cfg), cfg) });
  for (let i = 0; i < liveTrace.length; i++) {
    const hold = holdAt(i);
    sim.advance(hold);
    const expected = liveTrace[i];
    assert.strictEqual(sim.player.y, expected.y, `y matches at step ${i}`);
    assert.strictEqual(sim.player.vy, expected.vy, `vy matches at step ${i}`);
    assert.strictEqual(sim.cameraX, expected.cameraX, `camera matches at step ${i}`);
    assert.strictEqual(sim.time, expected.time, `time matches at step ${i}`);
    assert.strictEqual(sim.hitId, expected.hit, `collision matches at step ${i}`);
    const reference = findCollision(sim.player.rect(), obstacles, sim.cameraX, sim.time)?.obstacle.id ?? null;
    assert.strictEqual(sim.hitId, reference, "lean collision equals Collision.ts");
  }
  assert.ok(sim.hitId !== null, "the parity run ends in the same collision");
  ok(`headless simulation parity: ${liveTrace.length} live steps reproduced exactly, including the moving-hazard collision`);
}

// entry states: defaults and fixed quantiles of a previous exit set
{
  const cfg = defaultConfig();
  const world = new World(cfg);
  assert.equal(defaultEntryStates(cfg, world, 5).length, 5);
  assert.equal(defaultEntryStates(cfg, world, 3).length, 3);
  const exits = Array.from({ length: 20 }, (_, i) => ({ y: 100 + i * 15, vy: (i % 5 - 2) * 150 }));
  const a = entryStatesFromExits(exits, 5, cfg, world);
  const b = entryStatesFromExits([...exits].reverse(), 5, cfg, world);
  assert.deepStrictEqual(a, b, "quantiles do not depend on exit order");
  assert.equal(a.length, 5);
  const few = entryStatesFromExits([{ y: 200, vy: 0 }, { y: 200, vy: 0 }], 5, cfg, world);
  assert.equal(few.length, 1, "duplicate exits collapse and the smaller set is reported");
  ok("entry states: five fixed quantiles by projected altitude, order independent, duplicates collapse");
}

function scenarioFor(cfg, obstacles, startX, gapAfterTime = 0.9) {
  const speedAt = (x) => worldSpeedAt(computeDifficulty(x, cfg), cfg);
  const nominalStart = startX - cfg.playerScreenX - ENCOUNTER_LEAD_TIME * speedAt(startX - cfg.playerScreenX);
  const startSteps = cameraStepsBetween(0, nominalStart, speedAt, cfg.fixedDt);
  const startCameraX = cameraAfterSteps(0, startSteps, speedAt, cfg.fixedDt);
  const last = obstacles[obstacles.length - 1];
  const endX = last.worldX + last.width + gapAfterTime * speedAt(last.worldX - cfg.playerScreenX);
  const nominalEnd = endX - cfg.playerScreenX - ENCOUNTER_LEAD_TIME * speedAt(endX - cfg.playerScreenX);
  const durationSteps = cameraStepsBetween(startCameraX, nominalEnd, speedAt, cfg.fixedDt);
  return { cfg, obstacles, durationSteps, startCameraX, startTime: startSteps * cfg.fixedDt, speedAt, endX };
}

// sequence feasibility: safe motif passes with an exact witness; wall and impossible transition fail with reasons
{
  const cfg = defaultConfig();
  const world = new World(cfg);
  const bounds = legalBounds(cfg, world);
  const target = pacingTarget("WARMUP", 0);
  const ranges = initRanges(cfg, world, bounds, target);
  const safe = realizeGenome(motifGenome(MOTIFS[0], streamFor(3), ranges, bounds, "SAFE"), cfg, world, 1000, 1);
  const entries = defaultEntryStates(cfg, world, 5);
  const scenario = scenarioFor(cfg, safe, 1000);
  const v = validateSequence(scenario, entries, cfg);
  assert.ok(v.ok, `known-safe motif is feasible: ${v.reason}`);
  assert.equal(v.coverage, 1, "every entry state has a path");
  for (const r of v.results) {
    const replay = new EncounterSimulation(cfg, safe, scenario);
    replay.setState(r.entry.y, r.entry.vy);
    const frames = [replay.frame()];
    for (const f of r.witness.slice(1)) frames.push(replay.step(f.hold));
    assert.deepStrictEqual(frames, r.witness, "witness is an exact replay");
    assert.equal(replay.hitId, null);
    assert.equal(frames.length - 1, scenario.durationSteps, "witness covers the whole encounter plus exit buffer");
  }
  assert.ok(v.exits.length === 5, "exits recorded for the next boundary");

  const wall = [new Obstacle(9, ObstacleType.BLOCK_TOP, 1000, cfg.obstacleWidth,
    [{ dx: 0, y: cfg.ceilingHeight, w: cfg.obstacleWidth, h: world.corridorHeight() }])];
  const w = validateSequence(scenarioFor(cfg, wall, 1000), entries, cfg);
  assert.equal(w.ok, false);
  assert.equal(w.gate, "COVERAGE");
  assert.match(w.reason, /feasible from 0\/5/);
  assert.equal(w.exits.length, 0);

  // individually passable gates with an impossible transition: high gate then a low gate 150 px later at 760 px/s
  const fast = { ...cfg, worldStartSpeed: 760, worldMaxSpeed: 760 };
  const fastWorld = new World(fast);
  const corridor = fastWorld.corridorHeight();
  const gate = (id, x, center) => {
    const gapTop = fastWorld.ceilingY() + center * corridor - 0.15 * corridor;
    const gapBottom = gapTop + 0.3 * corridor;
    return new Obstacle(id, ObstacleType.GATE, x, fast.obstacleWidth, [
      { dx: 0, y: fastWorld.ceilingY(), w: fast.obstacleWidth, h: gapTop - fastWorld.ceilingY() },
      { dx: 0, y: gapBottom, w: fast.obstacleWidth, h: fastWorld.floorY() - gapBottom },
    ], gapTop, gapBottom);
  };
  const pair = [gate(1, 1500, 0.2), gate(2, 1650, 0.8)];
  const farY = (fastWorld.ceilingY() + fastWorld.floorY()) / 2;
  for (const o of pair) {
    assert.ok(validateObstacle(o, farY, 0, 0, 760, fast, fastWorld).possible, `#${o.id} passes the single-obstacle check on its own`);
  }
  const t = validateSequence(scenarioFor(fast, pair, 1500), defaultEntryStates(fast, fastWorld, 5), fast);
  assert.equal(t.ok, false, "the transition is rejected as a sequence");
  assert.equal(t.gate, "COVERAGE");
  assert.match(t.reason, /no collision-free HOLD\/RELEASE path/);
  ok(`sequence feasibility: safe motif passes with exact witnesses; wall rejected (${w.reason}); impossible transition rejected (${t.reason})`);
}

// agent profiles and fitness measurements on a known-safe and an impossible encounter
{
  const cfg = defaultConfig();
  const world = new World(cfg);
  const bounds = legalBounds(cfg, world);
  const target = pacingTarget("BUILD", 0.3);
  const ranges = initRanges(cfg, world, bounds, target);
  const safe = realizeGenome(motifGenome(MOTIFS[3], streamFor(11), ranges, bounds, "CRD"), cfg, world, 1000, 1);
  const entries = defaultEntryStates(cfg, world, 5);
  const scenario = scenarioFor(cfg, safe, 1000);
  const rollouts = runProfiles(scenario, entries, AGENT_PROFILES, true);
  assert.equal(rollouts.length, 15);
  for (const r of rollouts) {
    const replay = new EncounterSimulation(cfg, safe, scenario);
    replay.setState(r.trace[0].y, r.trace[0].vy);
    const frames = [replay.frame()];
    for (const f of r.trace.slice(1)) frames.push(replay.step(f.hold));
    assert.deepStrictEqual(frames, r.trace, `${r.profile}/${r.entry}: recorded controls reproduce the rollout`);
  }
  const metrics = measure(rollouts, cfg, 1.0);
  const fitness = scoreCandidate(metrics, target, 1, cfg);
  assert.ok(metrics.completion.strong >= metrics.completion.novice, "strong profile completes at least as often as novice");
  assert.ok(fitness.fitness >= 0 && fitness.fitness <= 1, "fitness normalized");
  assert.ok(Math.abs(fitness.fitness - (0.45 * fitness.difficultyMatch + 0.2 * fitness.rhythmMatch + 0.2 * fitness.novelty + 0.15 * fitness.readability)) < 1e-12);
  assert.deepStrictEqual(runProfiles(scenario, entries, AGENT_PROFILES, false).map((r) => ({ ...r, trace: null })),
    rollouts.map((r) => ({ ...r, trace: null })), "traceless rollouts measure the same numbers");
  const wall = [new Obstacle(9, ObstacleType.BLOCK_TOP, 1000, cfg.obstacleWidth,
    [{ dx: 0, y: cfg.ceilingHeight, w: cfg.obstacleWidth, h: world.corridorHeight() }])];
  const impossible = runProfiles(scenarioFor(cfg, wall, 1000), entries, AGENT_PROFILES, false);
  assert.ok(impossible.every((r) => !r.completed && r.hitId === 9), "every profile fails the wall");
  assert.equal(bandCloseness(0.5, [0.2, 0.8]), 1);
  assert.ok(Math.abs(bandCloseness(1.4, [0.2, 0.8])) < 1e-9);
  ok(`agent profiles: completion S${metrics.completion.strong} I${metrics.completion.intermediate} N${metrics.completion.novice}, switch ${metrics.switchRate.toFixed(2)}/s, pressure ${metrics.pressure.toFixed(2)}, fitness ${fitness.fitness.toFixed(3)}; all profiles fail the wall`);
}

function projection(rec) {
  return {
    candidateId: rec.candidateId, phrase: rec.phrase, genes: rec.genome.genes, fallback: rec.fallback,
    obstacles: rec.obstacles.map((o) => [o.id, o.type, o.worldX, o.getParts(), o.moving]),
    fitness: rec.fitness, metrics: rec.metrics, exits: rec.exits, entries: rec.entries,
    evaluations: rec.evaluations, gateCounts: rec.gateCounts, startCameraX: rec.startCameraX,
    endCameraX: rec.endCameraX, durationSteps: rec.durationSteps,
    witness: rec.validation?.witness ?? null, traces: rec.rollouts?.map((r) => r.trace) ?? null,
  };
}

function searchChain(cfg, seed, count, strategy = "evolve") {
  const world = new World(cfg);
  const speedAt = (x) => worldSpeedAt(computeDifficulty(x, cfg), cfg);
  const archive = new DiversityArchive(6);
  const records = [];
  let startX = 1000;
  let previous = null;
  let firstId = 1;
  for (let index = 0; index < count; index++) {
    let startCameraX, startTime;
    if (previous) {
      startCameraX = previous.endCameraX;
      startTime = previous.startTime + previous.durationSteps * cfg.fixedDt;
    } else {
      const nominal = startX - cfg.playerScreenX - ENCOUNTER_LEAD_TIME * speedAt(startX - cfg.playerScreenX);
      const steps = cameraStepsBetween(0, nominal, speedAt, cfg.fixedDt);
      startCameraX = cameraAfterSteps(0, steps, speedAt, cfg.fixedDt);
      startTime = steps * cfg.fixedDt;
    }
    const target = pacingTarget(phaseForEncounter(index), computeDifficulty(startX - cfg.playerScreenX, cfg));
    const run = new SearchRun({
      masterSeed: seed, encounterIndex: index, cfg, world, startX, startCameraX, startTime, speedAt, target,
      entries: nextEntryStates(previous, cfg, world), archive: archive.snapshot(), budget: budgetFromConfig(cfg, strategy),
      profiles: AGENT_PROFILES, firstObstacleId: firstId,
    });
    const rec = run.finish();
    if (rec.signature) archive.push(rec.signature);
    records.push(rec);
    previous = rec;
    startX = rec.endX;
    firstId += rec.obstacles.length;
  }
  return records;
}

// search determinism: same seed + config + budget selects the same encounters and traces
{
  const cfg = defaultConfig();
  const t0 = performance.now();
  const a = searchChain(cfg, 12345, 3);
  const t1 = performance.now();
  const b = searchChain(cfg, 12345, 3);
  assert.deepStrictEqual(a.map(projection), b.map(projection), "identical selection, geometry, fitness, witnesses and traces");
  const c = searchChain(cfg, 999, 3);
  assert.notDeepStrictEqual(a.map((r) => r.genome.genes), c.map((r) => r.genome.genes), "a different master seed selects different encounters");
  assert.ok(a.every((r) => r.fallback === null), "default settings find feasible candidates without fallback");
  assert.ok(a.every((r) => r.validation.ok && r.validation.coverage >= cfg.entryCoverage), "winners pass the coverage gate");
  for (let i = 1; i < a.length; i++) {
    assert.strictEqual(a[i].startX, a[i - 1].endX, "encounters chain without gaps or overlaps");
    assert.strictEqual(a[i].startCameraX, a[i - 1].endCameraX, "simulation windows chain exactly");
    assert.deepStrictEqual(a[i].entries, entryStatesFromExits(a[i - 1].exits, 5, cfg, new World(cfg)), "entries come from the previous exits");
  }
  const evals = a.reduce((s, r) => s + r.evaluations, 0);
  ok(`search determinism: 3 encounters, ${evals} evaluations in ${(t1 - t0).toFixed(0)}ms (${((t1 - t0) / evals).toFixed(1)}ms/eval); replay identical, other seed differs, no fallback`);
}

// time slicing cannot change the result: tiny budgets vs synchronous finish vs restart
{
  const run = (budgetMs, steps) => {
    const cfg = defaultConfig();
    cfg.seed = 2024;
    const g = new Game(cfg);
    const placed = [];
    const orig = g.spawner.update.bind(g.spawner);
    g.spawner.update = (cameraX, y, vy, speed, out) => {
      const before = out.length;
      orig(cameraX, y, vy, speed, out);
      for (let i = before; i < out.length; i++) placed.push(out[i]);
    };
    for (let i = 0; i < steps; i++) {
      g.input.isDown = Math.floor(i / 20) % 2 === 0;
      g.step(cfg.fixedDt);
      g.backgroundWork(budgetMs);
      if (g.state === GameState.DEAD) break;
    }
    return {
      seq: placed.map((o) => [o.id, o.type, o.worldX, o.getParts(), o.encounter?.index, o.encounter?.candidateId]),
      death: g.deathInfo, distance: g.camera.x, sync: g.spawner.scheduler.stats.syncFinishes,
    };
  };
  const sliced = run(0.05, 1500);
  const synchronous = run(Infinity, 1500);
  assert.deepStrictEqual(sliced.seq, synchronous.seq, "obstacle sequence is independent of the frame budget");
  assert.deepStrictEqual(sliced.death, synchronous.death, "death report is independent of the frame budget");
  assert.ok(sliced.seq.length >= 4, "encounters were placed");
  assert.ok(sliced.seq.every((o, i) => i === 0 || o[2] > sliced.seq[i - 1][2]), "world x strictly increasing");
  assert.ok(sliced.seq.every((o) => o[4] !== undefined && o[4] !== null), "every obstacle carries its encounter tag");
  assert.ok(sliced.death && sliced.death.encounter && typeof sliced.death.encounter.candidateId === "string", "death report names the encounter and candidate");
  ok(`slicing independence: ${sliced.seq.length} obstacles identical at 0.05ms/frame (${sliced.sync} synchronous finishes) and at infinite budget; death in E${sliced.death.encounter.index} ${sliced.death.encounter.candidateId}`);
}

// evolve vs random vs the weighted spawner at equal evaluation budgets (Experiment B)
{
  const cfg = defaultConfig();
  const table = [];
  const summarizeRecords = (name, records) => {
    const feasibleRate = records.reduce((s, r) => s + (r.gateCounts.FEASIBLE ?? 0) / r.evaluations, 0) / records.length;
    const targetError = records.reduce((s, r) => s + (r.fitness ? 1 - r.fitness.difficultyMatch : 1), 0) / records.length;
    const fitness = records.reduce((s, r) => s + (r.fitness?.fitness ?? 0), 0) / records.length;
    const novelty = records.reduce((s, r) => s + (r.fitness?.novelty ?? 0), 0) / records.length;
    const phrases = new Set(records.map((r) => r.phrase)).size;
    table.push({ generator: name, encounters: records.length, feasibleRate: feasibleRate.toFixed(2), targetError: targetError.toFixed(3), fitness: fitness.toFixed(3), novelty: novelty.toFixed(2), distinctPhrases: phrases, fallbacks: records.filter((r) => r.fallback).length });
    return { fitness, targetError };
  };
  const evolve = [];
  const random = [];
  for (const seed of [12345, 999, 7]) {
    evolve.push(...searchChain(cfg, seed, 4, "evolve"));
    random.push(...searchChain(cfg, seed, 4, "random"));
  }
  const e = summarizeRecords("evolutionary search", evolve);
  const r = summarizeRecords("random search (same budget)", random);

  // the weighted spawner: its consecutive obstacles grouped in threes and judged by the same evaluators,
  // including novelty against a rolling archive built from the chunks' own structure and behavior
  const laneOfRect = (o, world) => {
    const free = o.freeIntervals(0, 0, world, cfg.playerHeight, true);
    if (!free.length) return "M";
    const [a, b] = free.reduce((best, iv) => (iv[1] - iv[0] > best[1] - best[0] ? iv : best));
    const f = ((a + b) / 2 - world.ceilingY()) / world.corridorHeight();
    return f <= 0.38 ? "H" : f >= 0.62 ? "L" : "M";
  };
  const demandOfRect = (o, lane) => o.type === "BLOCK_BOTTOM" ? "CLIMB" : o.type === "BLOCK_TOP" ? "DIVE" :
    o.type === "FLOATING" ? "CHOICE" : o.type === "MOVING" ? "TIMING" : lane === "H" ? "CLIMB" : lane === "L" ? "DIVE" : "PRECISION";
  const weighted = [];
  for (const seed of [12345, 999, 7]) {
    const wcfg = { ...cfg, encounterMode: 0 };
    const world = new World(wcfg);
    const spawner = new Spawner(wcfg, world);
    spawner.reset(seed);
    const obstacles = [];
    wcfg.spawnAheadDistance = 7000;
    spawner.update(0, 280, 0, wcfg.worldStartSpeed, obstacles);
    let previousExits = [];
    const archive = new DiversityArchive(6);
    for (let index = 0; index < 4; index++) {
      const chunk = obstacles.slice(index * 3, index * 3 + 3);
      const startX = chunk[0].worldX;
      const scenario = scenarioFor(wcfg, chunk, startX);
      const target = pacingTarget(phaseForEncounter(index), computeDifficulty(startX - wcfg.playerScreenX, wcfg));
      const entries = entryStatesFromExits(previousExits, 5, wcfg, world);
      const validation = validateSequence(scenario, entries, wcfg);
      let fitness = null;
      if (validation.ok) {
        const rollouts = runProfiles(scenario, entries, AGENT_PROFILES, false);
        let warning = Infinity;
        for (let i = 1; i < chunk.length; i++) warning = Math.min(warning, (chunk[i].worldX - chunk[i - 1].worldX) / scenario.speedAt(chunk[i].worldX - wcfg.playerScreenX));
        const metrics = measure(rollouts, wcfg, warning);
        const lanes = chunk.map((o) => laneOfRect(o, world));
        const signature = {
          structure: {
            types: chunk.map((o) => o.type), lanes,
            spacingBins: chunk.map((o, i) => (i === 0 ? 0 : Math.round((o.worldX - chunk[i - 1].worldX) / 100))),
            moving: chunk.filter((o) => o.moving).length, demands: chunk.map((o, i) => demandOfRect(o, lanes[i])),
          },
          holdFraction: metrics.holdFraction, switchBin: Math.round(metrics.switchRate), demand: demandOfRect(chunk[0], lanes[0]),
        };
        fitness = scoreCandidate(metrics, target, archive.novelty(signature), wcfg);
        archive.push(signature);
        previousExits = [...validation.exits, ...rollouts.filter((x) => x.completed).map((x) => x.exit)];
      }
      weighted.push({ phrase: chunk.map((o) => o.type).join("→"), fitness, gateCounts: { FEASIBLE: validation.ok ? 1 : 0 }, evaluations: 1, fallback: validation.ok ? null : validation.reason });
    }
  }
  summarizeRecords("weighted spawner (3-obstacle chunks, no search)", weighted);
  console.log("\n  Experiment B — equal budget comparison (3 seeds × 4 encounters):");
  console.table(table);
  assert.ok(evolve.every((x) => x.fallback === null) && random.every((x) => x.fallback === null), "both search strategies found feasible winners");
  ok(`search vs random vs weighted: evolve fitness ${e.fitness.toFixed(3)} / target error ${e.targetError.toFixed(3)} · random ${r.fitness.toFixed(3)} / ${r.targetError.toFixed(3)} (see table)`);
}

// fallback policy: when nothing feasible exists the verified safe motif is used, then an empty gap
{
  // flat speed makes gap times exact. The fallback uses the widest legal spacing (930 px = 2.91 s);
  // random two-gene candidates draw spacing in [671, 908] px, so with a 2.6 s minimum a small random
  // population often fails entirely. The seed sweep finds such a budget-exhausted search.
  const fallback = { ...defaultConfig(), worldMaxSpeed: 320, searchPopulation: 2, searchGenerations: 1, minObstacleGapTime: 2.6 };
  let rec = null;
  let fallbackSeed = -1;
  for (let seed = 1; seed <= 60 && !rec; seed++) {
    const [candidate] = searchChain(fallback, seed, 1, "random");
    if (candidate.fallback && /safe fallback used/.test(candidate.fallback)) { rec = candidate; fallbackSeed = seed; }
  }
  assert.ok(rec, "a seed exists whose random population fails entirely and uses the safe fallback");
  assert.equal(rec.obstacles.length, 2);
  assert.equal(rec.gateCounts.CHEAP, 2, "both candidates were rejected by the cheap warning gate");
  assert.ok(rec.validation?.ok, "the fallback itself passed sequence feasibility");
  assert.deepStrictEqual(projection(searchChain(fallback, fallbackSeed, 1, "random")[0]), projection(rec), "fallback selection replays deterministically");
  const empty = { ...defaultConfig(), seed: 5, minObstacleGapTime: 5.0 };
  const [rec2] = searchChain(empty, 5, 1);
  assert.match(rec2.fallback ?? "", /EMPTY_GAP/, "an empty gap when even the fallback fails");
  assert.equal(rec2.obstacles.length, 0);
  const g = new Game({ ...defaultConfig(), seed: 5, minObstacleGapTime: 5.0 });
  g.input.isDown = true;
  for (let i = 0; i < 600; i++) { g.step(g.cfg.fixedDt); g.backgroundWork(Infinity); }
  assert.ok(g.spawner.scheduler.stats.fallbacks >= 2 && g.state !== GameState.DEAD, "the game keeps running on empty fallbacks");
  ok(`fallback policy: ${rec.fallback} · ${rec2.fallback}`);
}

// live generator switch keeps the world consistent
{
  const cfg = defaultConfig();
  cfg.encounterMode = 0;
  cfg.seed = 77;
  const g = new Game(cfg);
  const xs = [];
  let run = 0;
  const orig = g.spawner.update.bind(g.spawner);
  g.spawner.update = (cameraX, y, vy, speed, out) => {
    const before = out.length;
    orig(cameraX, y, vy, speed, out);
    for (let i = before; i < out.length; i++) xs.push({ x: out[i].worldX, encounter: out[i].encounter?.index ?? null, run });
  };
  for (let i = 0; i < 900; i++) {
    if (i === 300) cfg.encounterMode = 1;
    g.input.isDown = Math.floor(i / 40) % 2 === 0;
    g.step(cfg.fixedDt);
    g.backgroundWork(Infinity);
    if (g.state === GameState.DEAD) { g.restart(cfg.seed); run++; }
  }
  for (let i = 1; i < xs.length; i++) {
    if (xs[i].run === xs[i - 1].run) assert.ok(xs[i].x > xs[i - 1].x, `spawn x keeps increasing across the switch (${xs[i - 1].x} -> ${xs[i].x})`);
  }
  assert.ok(xs.some((x) => x.encounter === null) && xs.some((x) => x.encounter !== null), "both generators placed obstacles");
  const first = xs.find((x) => x.encounter !== null);
  const beforeSwitch = xs.filter((x) => x.encounter === null && x.run === first.run);
  assert.ok(beforeSwitch.every((x) => x.x < first.x), "the first searched encounter starts after every weighted obstacle of that run");
  ok("live generator switch: weighted → search continues from the current cursor");
}

// pacing table
{
  assert.deepStrictEqual([0, 1, 2, 3, 4, 5, 6].map(phaseForEncounter), ["WARMUP", "BUILD", "PEAK", "RECOVERY", "BUILD", "PEAK", "RECOVERY"]);
  const peak = pacingTarget("PEAK", 0.8);
  assert.ok(peak.completion.novice < pacingTarget("RECOVERY", 0.8).completion.novice, "peak expects fewer novice completions than recovery");
  assert.ok(peak.allowMoving && !pacingTarget("RECOVERY", 0.8).allowMoving);
  ok("pacing: WARMUP once, then BUILD → PEAK → RECOVERY repeating with phase-specific targets");
}

console.warn = quiet;

console.log(`\nAll ${passed} verification groups passed.`);

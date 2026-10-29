/**
 * whole-sequence feasibility: does any HOLD / RELEASE input path survive the
 * entire encounter from a plausible incoming state?
 *
 * The single-obstacle validator remains a cheap prefilter. Vertical velocity
 * carries through a sequence, so individually passable obstacles can still be
 * jointly impossible: a high gate immediately followed by a low gate may leave
 * no time to reverse. This search branches HOLD / RELEASE at a coarse control
 * interval, integrates at the real fixed step, discards collisions, merges
 * near-duplicate (y, vy) states, and keeps a safe path across every obstacle
 * plus the exit buffer. It returns a witness trajectory, not a difficulty
 * rating. The control interval doubles as the minimum control duration, so a
 * one-frame-perfect solution cannot pass.
 */

import { lerp, type GameplayConfig } from "../../config/gameplayConfig.js";
import type { Obstacle } from "../Obstacle.js";
import type { World } from "../World.js";
import { EncounterSimulation, type EncounterOptions, type TraceFrame } from "./Encounter.js";

export interface EntryState {
  y: number;
  vy: number;
  label: string;
}

export interface ExitState {
  y: number;
  vy: number;
}

/** centered, high, low, rising, falling: used when no previous encounter exists */
export function defaultEntryStates(cfg: GameplayConfig, world: World, count: number): EntryState[] {
  const top = world.ceilingY();
  const bottom = world.floorY() - cfg.playerHeight;
  const mid = (top + bottom) / 2;
  const all: EntryState[] = [
    { label: "center", y: mid, vy: 0 },
    { label: "high", y: lerp(top, bottom, 0.25), vy: 0 },
    { label: "low", y: lerp(top, bottom, 0.75), vy: 0 },
    { label: "rising", y: mid, vy: cfg.maxRiseSpeed * 0.5 },
    { label: "falling", y: mid, vy: cfg.maxFallSpeed * 0.5 },
  ];
  return all.slice(0, Math.max(1, Math.min(count, all.length)));
}

/**
 * Fixed quantiles of the previous encounter's exit set, ordered by projected
 * altitude y + vy × 0.25 so velocity counts as well as height. The same set is
 * reused for every candidate at this boundary, so no genome can be favored by
 * a convenient start. Fewer than `count` distinct states keeps all of them.
 */
export function entryStatesFromExits(exits: ExitState[], count: number, cfg: GameplayConfig, world: World): EntryState[] {
  if (exits.length === 0) return defaultEntryStates(cfg, world, count);
  const project = (e: ExitState) => e.y + e.vy * 0.25;
  const sorted = [...exits].sort((a, b) => project(a) - project(b) || a.y - b.y || a.vy - b.vy);
  const picked: EntryState[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < count; i++) {
    const q = count === 1 ? 0.5 : i / (count - 1);
    const e = sorted[Math.round(q * (sorted.length - 1))];
    const key = `${Math.round(e.y / 4)}:${Math.round(e.vy / 20)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push({ y: e.y, vy: e.vy, label: `exit q${q.toFixed(2)}` });
  }
  return picked;
}

export interface FeasibilityScenario extends EncounterOptions {
  cfg: GameplayConfig;
  obstacles: Obstacle[];
  durationSteps: number;
}

export interface FeasibilitySettings {
  intervalSeconds: number;
  maxStates: number;
  binY: number;
  binVy: number;
}

export interface FeasibilityResult {
  entry: EntryState;
  feasible: boolean;
  reason: string | null;
  /** exact replay of the found input path through the real collision test */
  witness: TraceFrame[] | null;
  minClearance: number | null;
  exit: ExitState | null;
  rollouts: number;
  stepsSimulated: number;
  /** the state cap trimmed a layer, so "no path" may be a budget artifact */
  capped: boolean;
}

interface Node {
  sim: EncounterSimulation;
  parent: Node | null;
  hold: boolean;
  clearance: number;
  order: number;
}

export function feasibilityFromEntry(scenario: FeasibilityScenario, entry: EntryState, settings: FeasibilitySettings): FeasibilityResult {
  const { cfg } = scenario;
  const steps = Math.max(1, Math.round(settings.intervalSeconds / cfg.fixedDt));
  const root = new EncounterSimulation(cfg, scenario.obstacles, scenario);
  root.setState(entry.y, entry.vy);
  let layer: Node[] = [{ sim: root, parent: null, hold: false, clearance: root.clearance(), order: 0 }];
  let rollouts = 0;
  let stepsSimulated = 0;
  let capped = false;

  while (layer.length > 0 && layer[0].sim.stepCount < scenario.durationSteps) {
    const next = new Map<string, Node>();
    let order = 0;
    for (const node of layer) {
      for (const hold of [false, true]) {
        const sim = node.sim.clone();
        let clearance = node.clearance;
        const remaining = scenario.durationSteps - sim.stepCount;
        for (let i = 0; i < Math.min(steps, remaining); i++) {
          sim.advance(hold);
          stepsSimulated++;
          if (sim.hitId !== null) break;
          const c = sim.clearance();
          if (c < clearance) clearance = c;
        }
        rollouts++;
        if (sim.hitId !== null) continue;
        // states inside one bin share a future closely enough to keep only the safest one
        const key = `${Math.round(sim.player.y / settings.binY)}:${Math.round(sim.player.vy / settings.binVy)}`;
        const existing = next.get(key);
        if (!existing || clearance > existing.clearance) next.set(key, { sim, parent: node, hold, clearance, order: order++ });
      }
    }
    let survivors = [...next.values()];
    if (survivors.length > settings.maxStates) {
      capped = true;
      survivors.sort((a, b) => b.clearance - a.clearance || a.order - b.order);
      survivors = survivors.slice(0, settings.maxStates);
    }
    layer = survivors;
  }

  if (layer.length === 0) {
    return {
      entry, feasible: false, witness: null, minClearance: null, exit: null, rollouts, stepsSimulated, capped,
      reason: capped ? "no collision-free path inside the state budget" : "no collision-free HOLD/RELEASE path",
    };
  }

  // best terminal: safest path, then earliest discovered for a deterministic tie-break
  let best = layer[0];
  for (const node of layer) if (node.clearance > best.clearance) best = node;
  const holds: boolean[] = [];
  for (let n: Node | null = best; n && n.parent; n = n.parent) holds.push(n.hold);
  holds.reverse();

  // replay from the entry through the real collision test so the witness is exact, not a bin
  const replay = new EncounterSimulation(cfg, scenario.obstacles, scenario);
  replay.setState(entry.y, entry.vy);
  const witness: TraceFrame[] = [replay.frame()];
  let minClearance = Infinity;
  for (const hold of holds) {
    const remaining = scenario.durationSteps - replay.stepCount;
    for (let i = 0; i < Math.min(steps, remaining); i++) {
      const frame = replay.step(hold);
      witness.push(frame);
      if (frame.clearance !== null && frame.clearance < minClearance) minClearance = frame.clearance;
    }
  }
  if (replay.hitId !== null) throw new Error("feasibility witness replay collided; simulation determinism is broken");

  return {
    entry, feasible: true, reason: null, witness,
    minClearance: Number.isFinite(minClearance) ? minClearance : null,
    exit: { y: replay.player.y, vy: replay.player.vy },
    rollouts, stepsSimulated, capped,
  };
}

export type SequenceGate = "COVERAGE" | "CLEARANCE";

export interface SequenceValidation {
  ok: boolean;
  gate: SequenceGate | null;
  reason: string | null;
  /** fraction of entry states with a collision-free path */
  coverage: number;
  results: FeasibilityResult[];
  witness: TraceFrame[] | null;
  witnessEntry: EntryState | null;
  minClearance: number | null;
  exits: ExitState[];
  stepsSimulated: number;
}

export function feasibilitySettings(cfg: GameplayConfig): FeasibilitySettings {
  return { intervalSeconds: cfg.feasibilityInterval, maxStates: cfg.feasibilityMaxStates, binY: 4, binVy: 20 };
}

/** hard gates before any fitness: coverage of the entry states, then witness clearance */
export function validateSequence(scenario: FeasibilityScenario, entries: EntryState[], cfg: GameplayConfig): SequenceValidation {
  const settings = feasibilitySettings(cfg);
  return assembleSequenceValidation(entries.map((entry) => feasibilityFromEntry(scenario, entry, settings)), entries, cfg);
}

/** the gate logic on already computed per-entry results; the search computes them one at a time between frames */
export function assembleSequenceValidation(results: FeasibilityResult[], entries: EntryState[], cfg: GameplayConfig): SequenceValidation {
  const feasible = results.filter((r) => r.feasible);
  const coverage = entries.length > 0 ? feasible.length / entries.length : 0;
  const stepsSimulated = results.reduce((s, r) => s + r.stepsSimulated, 0);
  let best: FeasibilityResult | null = null;
  for (const r of feasible) if (!best || (r.minClearance ?? Infinity) > (best.minClearance ?? Infinity)) best = r;
  const exits = feasible.map((r) => r.exit!).filter(Boolean);
  const base = { coverage, results, exits, stepsSimulated, witness: best?.witness ?? null, witnessEntry: best?.entry ?? null, minClearance: best?.minClearance ?? null };

  const needed = Math.ceil(cfg.entryCoverage * entries.length);
  if (feasible.length < needed) {
    const failed = results.find((r) => !r.feasible);
    return {
      ...base, ok: false, gate: "COVERAGE",
      reason: `feasible from ${feasible.length}/${entries.length} entry states (need ${needed}); ${failed?.entry.label}: ${failed?.reason}`,
    };
  }
  if (best && best.minClearance !== null && best.minClearance < cfg.minClearance) {
    return {
      ...base, ok: false, gate: "CLEARANCE",
      reason: `safest witness clearance ${best.minClearance.toFixed(1)}px < min ${cfg.minClearance}px`,
    };
  }
  return { ...base, ok: true, gate: null, reason: null };
}

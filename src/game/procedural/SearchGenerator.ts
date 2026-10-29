/**
 * bounded evolutionary search for one encounter
 *
 *   initialize feasible-biased population (motifs + random legal genomes)
 *   repeat for a fixed number of generations:
 *       cheap-reject invalid geometry
 *       check sequence feasibility from every entry state
 *       run the agent profiles and measure fitness
 *       keep feasible elites, select parents by tournament, mutate, optionally crossover, repair
 *   pick the feasible candidate with the best fitness (deterministic tie-break)
 *   if none exists: verified safe fallback, then an empty gap
 *
 * The evaluation count is fixed (population × generations) and every random
 * choice comes from a seed derived from (master seed, encounter index,
 * generation, slot), so the same seed, config, and budget always select the
 * same encounter. Work is delivered through a generator so the game loop can
 * spend a few milliseconds per frame on it; the slicing changes when the result
 * arrives, never what it is.
 */

import type { GameplayConfig } from "../../config/gameplayConfig.js";
import type { Obstacle } from "../Obstacle.js";
import type { World } from "../World.js";
import { AGENT_PROFILES, type AgentProfile } from "./AgentController.js";
import { DiversityArchive, type EncounterSignature } from "./DiversityArchive.js";
import { cameraAfterSteps, cameraStepsBetween } from "./Encounter.js";
import {
  cheapConstraints, crossover, dominantDemand, genomeKey, genomeSpan, initRanges, legalBounds, mutate, phraseOf,
  randomGenome, realizeGenome, signatureOf, type GeneBounds, type Genome, type InitRanges,
} from "./EncounterGenome.js";
import { measure, runProfile, runProfiles, scoreCandidate, type FitnessComponents, type Metrics, type RolloutSummary } from "./Fitness.js";
import { ENCOUNTER_LEAD_TIME, type PacingTarget } from "./Pacing.js";
import { initialGenome, safeFallbackGenome } from "./PatternLibrary.js";
import { attemptSeed, encounterSeed, genomeSeed, streamFor } from "./RandomStreams.js";
import {
  assembleSequenceValidation, entryStatesFromExits, feasibilityFromEntry, feasibilitySettings,
  type EntryState, type ExitState, type FeasibilityResult, type SequenceValidation,
} from "./SequenceValidator.js";

export interface SearchBudget {
  population: number;
  generations: number;
  elites: number;
  tournament: number;
  crossoverRate: number;
  /** "random" draws a fresh population every generation: the equal-budget baseline */
  strategy: "evolve" | "random";
}

export function budgetFromConfig(cfg: GameplayConfig, strategy: SearchBudget["strategy"] = "evolve"): SearchBudget {
  const population = Math.max(2, Math.round(cfg.searchPopulation));
  return {
    population,
    generations: Math.max(1, Math.round(cfg.searchGenerations)),
    elites: Math.max(0, Math.min(Math.round(cfg.searchElites), population - 1)),
    tournament: 3,
    crossoverRate: 0.25,
    strategy,
  };
}

export interface SearchContext {
  masterSeed: number;
  encounterIndex: number;
  /** config snapshot; live slider edits cannot change a running search */
  cfg: GameplayConfig;
  world: World;
  /** world x of the first obstacle front */
  startX: number;
  /** a live camera value: the simulation starts exactly on the game's step grid */
  startCameraX: number;
  startTime: number;
  speedAt: (cameraX: number) => number;
  target: PacingTarget;
  entries: EntryState[];
  archive: DiversityArchive;
  budget: SearchBudget;
  profiles: AgentProfile[];
  firstObstacleId: number;
}

export interface Evaluation {
  id: string;
  generation: number;
  slot: number;
  genome: Genome;
  key: string;
  cached: boolean;
  obstacles: Obstacle[];
  endX: number;
  durationSteps: number;
  gate: "CHEAP" | "COVERAGE" | "CLEARANCE" | null;
  gateReason: string | null;
  validation: SequenceValidation | null;
  rollouts: RolloutSummary[] | null;
  metrics: Metrics | null;
  fitness: FitnessComponents | null;
  signature: EncounterSignature | null;
  elapsedMs: number;
}

/** compact view of an evaluation for the debug panel and exports */
export interface EvaluationSummary {
  id: string;
  generation: number;
  origin: Genome["origin"];
  parentIds: string[];
  phrase: string;
  lastOperation: string;
  gate: Evaluation["gate"];
  gateReason: string | null;
  fitness: FitnessComponents | null;
  completion: Metrics["completion"] | null;
}

export interface EncounterRecord {
  index: number;
  seed: number;
  masterSeed: number;
  phase: PacingTarget["phase"];
  target: PacingTarget;
  startX: number;
  endX: number;
  startCameraX: number;
  endCameraX: number;
  startTime: number;
  durationSteps: number;
  candidateId: string;
  genome: Genome;
  phrase: string;
  obstacles: Obstacle[];
  fallback: string | null;
  fitness: FitnessComponents | null;
  metrics: Metrics | null;
  validation: SequenceValidation | null;
  rollouts: RolloutSummary[] | null;
  entries: EntryState[];
  exits: ExitState[];
  signature: EncounterSignature | null;
  strategy: SearchBudget["strategy"];
  population: number;
  generations: number;
  evaluations: number;
  cachedHits: number;
  gateCounts: Record<string, number>;
  gateExamples: string[];
  nearWinners: EvaluationSummary[];
  elapsedMs: number;
  stepsSimulated: number;
  finishedSynchronously: boolean;
}

const now = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());

export function summarize(e: Evaluation): EvaluationSummary {
  return {
    id: e.id, generation: e.generation, origin: e.genome.origin, parentIds: e.genome.parentIds, phrase: phraseOf(e.genome),
    lastOperation: e.genome.history[e.genome.history.length - 1] ?? "", gate: e.gate, gateReason: e.gateReason,
    fitness: e.fitness, completion: e.metrics?.completion ?? null,
  };
}

export class SearchRun {
  readonly bounds: GeneBounds;
  readonly ranges: InitRanges;
  readonly encSeed: number;
  done = false;
  finishedSynchronously = false;
  private population: Genome[] = [];
  private readonly evaluations: Evaluation[] = [];
  private readonly cache = new Map<string, Evaluation>();
  private generation = 0;
  private slot = 0;
  private elapsedMs = 0;
  private stepsSimulated = 0;
  private cachedHits = 0;
  private record: EncounterRecord | null = null;
  private readonly iterator: Generator<void, void, void>;

  constructor(readonly ctx: SearchContext) {
    this.bounds = legalBounds(ctx.cfg, ctx.world);
    this.ranges = initRanges(ctx.cfg, ctx.world, this.bounds, ctx.target);
    this.encSeed = encounterSeed(ctx.masterSeed, ctx.encounterIndex);
    this.iterator = this.run();
  }

  get progress(): { generation: number; slot: number; evaluated: number; total: number; elapsedMs: number } {
    return {
      generation: this.generation, slot: this.slot, evaluated: this.evaluations.length,
      total: this.ctx.budget.population * this.ctx.budget.generations, elapsedMs: this.elapsedMs,
    };
  }

  /** spend at most maxMs of wall time; returns true once the record exists */
  work(maxMs: number): boolean {
    if (this.done) return true;
    const start = now();
    do {
      if (this.iterator.next().done) { this.done = true; break; }
    } while (now() - start < maxMs);
    return this.done;
  }

  /** complete the remaining budget right now; the result is identical, only the timing differs */
  finish(): EncounterRecord {
    if (!this.done) {
      this.finishedSynchronously = true;
      while (!this.iterator.next().done) { /* evaluate the remaining candidates */ }
      this.done = true;
    }
    return this.record!;
  }

  private *run(): Generator<void, void, void> {
    const { budget } = this.ctx;
    this.population = this.initialPopulation();
    for (let g = 0; g < budget.generations; g++) {
      this.generation = g;
      for (let slot = 0; slot < this.population.length; slot++) {
        this.slot = slot;
        yield* this.evaluate(this.population[slot], g, slot);
      }
      if (g < budget.generations - 1) this.population = this.nextGeneration(g + 1);
    }
    this.record = this.choose();
  }

  private genomeId(generation: number, slot: number): string {
    return `E${this.ctx.encounterIndex}-G${generation}-S${slot}`;
  }

  private initialPopulation(): Genome[] {
    const { budget, target } = this.ctx;
    const genomes: Genome[] = [];
    for (let slot = 0; slot < budget.population; slot++) {
      const rng = streamFor(genomeSeed(this.encSeed, 0, slot));
      const id = this.genomeId(0, slot);
      const random = (r: typeof rng, gid: string) => randomGenome(r, target, this.ranges, this.bounds, gid);
      genomes.push(budget.strategy === "random" ? random(rng, id) : initialGenome(slot, rng, target, this.ranges, this.bounds, id, random));
    }
    return genomes;
  }

  /** run an evaluation to completion right now (fallback construction, headless tools) */
  private evaluateNow(genome: Genome, generation: number, slot: number, idOverride?: string): Evaluation {
    const it = this.evaluate(genome, generation, slot, idOverride);
    for (;;) {
      const r = it.next();
      if (r.done) return r.value;
    }
  }

  /**
   * realize, gate, roll out, score; identical genomes reuse the cached evaluation.
   * The generator yields after every feasibility run and every agent rollout
   * (a few milliseconds each) so the frame budget in `work` is honoured.
   */
  private *evaluate(genome: Genome, generation: number, slot: number, idOverride?: string): Generator<void, Evaluation, void> {
    const ctx = this.ctx;
    const { cfg } = ctx;
    const id = idOverride ?? genome.id;
    const key = genomeKey(genome);
    const cached = this.cache.get(key);
    if (cached) {
      this.cachedHits++;
      const copy: Evaluation = { ...cached, id, generation, slot, genome, cached: true, elapsedMs: 0 };
      this.evaluations.push(copy);
      return copy;
    }
    let start = now();
    const obstacles = realizeGenome(genome, cfg, ctx.world, ctx.startX, ctx.firstObstacleId);
    const lastX = ctx.startX + genomeSpan(genome, cfg) - cfg.obstacleWidth;
    // the gap after the last obstacle holds the exit buffer and the next encounter's lead
    const endX = lastX + cfg.obstacleWidth + ctx.target.gapAfterTime * ctx.speedAt(lastX - cfg.playerScreenX);
    const nominalEnd = endX - cfg.playerScreenX - ENCOUNTER_LEAD_TIME * ctx.speedAt(endX - cfg.playerScreenX);
    const durationSteps = cameraStepsBetween(ctx.startCameraX, nominalEnd, ctx.speedAt, cfg.fixedDt);
    const evaluation: Evaluation = {
      id, generation, slot, genome, key, cached: false, obstacles, endX, durationSteps,
      gate: null, gateReason: null, validation: null, rollouts: null, metrics: null, fitness: null, signature: null, elapsedMs: 0,
    };
    const cheap = cheapConstraints(genome, cfg, ctx.world, this.bounds, ctx.target, ctx.startX, ctx.speedAt, ctx.archive.recentDemands());
    if (cheap) {
      evaluation.gate = "CHEAP";
      evaluation.gateReason = cheap;
    } else {
      const scenario = { cfg, obstacles, durationSteps, startCameraX: ctx.startCameraX, startTime: ctx.startTime, speedAt: ctx.speedAt };
      const settings = feasibilitySettings(cfg);
      const results: FeasibilityResult[] = [];
      for (const entry of ctx.entries) {
        results.push(feasibilityFromEntry(scenario, entry, settings));
        // measure only our own work: the clock restarts after the frame boundary
        evaluation.elapsedMs += now() - start;
        yield;
        start = now();
      }
      const validation = assembleSequenceValidation(results, ctx.entries, cfg);
      evaluation.validation = validation;
      this.stepsSimulated += validation.stepsSimulated;
      if (!validation.ok) {
        evaluation.gate = validation.gate;
        evaluation.gateReason = validation.reason;
      } else {
        const rollouts: RolloutSummary[] = [];
        for (const profile of ctx.profiles) {
          for (const entry of ctx.entries) {
            rollouts.push(runProfile(scenario, entry, profile, false));
            evaluation.elapsedMs += now() - start;
            yield;
            start = now();
          }
        }
        let warningTime = Infinity;
        for (let i = 1; i < genome.genes.length; i++) {
          warningTime = Math.min(warningTime, genome.genes[i].spacing / ctx.speedAt(obstacles[i].worldX - cfg.playerScreenX));
        }
        if (!Number.isFinite(warningTime)) warningTime = ENCOUNTER_LEAD_TIME;
        const metrics = measure(rollouts, cfg, warningTime);
        const signature: EncounterSignature = {
          structure: signatureOf(genome), holdFraction: metrics.holdFraction,
          switchBin: Math.round(metrics.switchRate), demand: dominantDemand(genome),
        };
        evaluation.rollouts = rollouts;
        evaluation.metrics = metrics;
        evaluation.signature = signature;
        evaluation.fitness = scoreCandidate(metrics, ctx.target, ctx.archive.novelty(signature), cfg);
        for (const r of rollouts) this.stepsSimulated += Math.round(r.seconds / cfg.fixedDt);
      }
    }
    evaluation.elapsedMs += now() - start;
    this.elapsedMs += evaluation.elapsedMs;
    this.cache.set(key, evaluation);
    this.evaluations.push(evaluation);
    return evaluation;
  }

  /** feasible evaluations best first; ties resolve by generation then slot so selection is deterministic */
  private ranked(): Evaluation[] {
    return this.evaluations
      .filter((e) => e.fitness !== null)
      .sort((a, b) => b.fitness!.fitness - a.fitness!.fitness || a.generation - b.generation || a.slot - b.slot);
  }

  private tournament(rng: ReturnType<typeof streamFor>, pool: Evaluation[]): Evaluation {
    let best = pool[rng.int(0, pool.length - 1)];
    for (let i = 1; i < this.ctx.budget.tournament; i++) {
      const challenger = pool[rng.int(0, pool.length - 1)];
      if (challenger.fitness!.fitness > best.fitness!.fitness) best = challenger;
    }
    return best;
  }

  private nextGeneration(generation: number): Genome[] {
    const { budget, target } = this.ctx;
    const ranked = this.ranked();
    const seenKeys = new Set<string>();
    const elites: Evaluation[] = [];
    for (const e of ranked) {
      if (budget.strategy === "random" || elites.length >= budget.elites) break;
      if (seenKeys.has(e.key)) continue;
      seenKeys.add(e.key);
      elites.push(e);
    }
    const next: Genome[] = [];
    for (let slot = 0; slot < budget.population; slot++) {
      const rng = streamFor(genomeSeed(this.encSeed, generation, slot));
      const id = this.genomeId(generation, slot);
      const label = `G${generation}`;
      if (slot < elites.length) {
        const elite = elites[slot].genome;
        next.push({ ...elite, id, parentIds: [elite.id], history: [...elite.history, `${label}: elite copy of ${elite.id}`] });
      } else if (budget.strategy === "random" || ranked.length < 2) {
        next.push(randomGenome(rng, target, this.ranges, this.bounds, id));
      } else {
        const parent = this.tournament(rng, ranked);
        if (rng.next() < budget.crossoverRate) {
          const other = this.tournament(rng, ranked);
          const child = crossover(parent.genome, other.genome, rng, this.bounds, `${id}x`, label);
          next.push(mutate(child, rng, target, this.ranges, this.bounds, id, label));
        } else {
          next.push(mutate(parent.genome, rng, target, this.ranges, this.bounds, id, label));
        }
      }
    }
    return next;
  }

  private choose(): EncounterRecord {
    const ranked = this.ranked();
    if (ranked.length > 0) return this.buildRecord(ranked[0], null);
    // nothing feasible inside the budget: the verified safe fallback, evaluated through the same gates
    const fallbackGenome = safeFallbackGenome(this.ctx.cfg, this.ctx.world, this.bounds, `E${this.ctx.encounterIndex}-FALLBACK`);
    const fallback = this.evaluateNow(fallbackGenome, this.ctx.budget.generations, 0, fallbackGenome.id);
    if (fallback.gate === null) return this.buildRecord(fallback, "NO_FEASIBLE_CANDIDATE: verified safe fallback used");
    return this.emptyRecord(`EMPTY_GAP: safe fallback failed too (${fallback.gateReason})`);
  }

  private gateStats(): { counts: Record<string, number>; examples: string[] } {
    const counts: Record<string, number> = {};
    const examples: string[] = [];
    for (const e of this.evaluations) {
      const name = e.gate ?? "FEASIBLE";
      counts[name] = (counts[name] ?? 0) + 1;
      if (e.gateReason && examples.length < 4 && !examples.includes(e.gateReason)) examples.push(`${e.id}: ${e.gateReason}`);
    }
    return { counts, examples };
  }

  private buildRecord(winner: Evaluation, fallback: string | null): EncounterRecord {
    const ctx = this.ctx;
    const { cfg } = ctx;
    const scenario = { cfg, obstacles: winner.obstacles, durationSteps: winner.durationSteps, startCameraX: ctx.startCameraX, startTime: ctx.startTime, speedAt: ctx.speedAt };
    // traces are recomputed only for the winner; the same deterministic rollouts, this time recorded
    const rollouts = runProfiles(scenario, ctx.entries, ctx.profiles, true);
    const exits: ExitState[] = [...(winner.validation?.exits ?? []), ...rollouts.filter((r) => r.completed).map((r) => r.exit)];
    const { counts, examples } = this.gateStats();
    const ranked = this.ranked().filter((e) => e.id !== winner.id);
    const gated = this.evaluations.filter((e) => e.gate !== null && !e.cached).slice(0, 3);
    return {
      index: ctx.encounterIndex, seed: this.encSeed, masterSeed: ctx.masterSeed, phase: ctx.target.phase, target: ctx.target,
      startX: ctx.startX, endX: winner.endX, startCameraX: ctx.startCameraX,
      endCameraX: cameraAfterSteps(ctx.startCameraX, winner.durationSteps, ctx.speedAt, cfg.fixedDt),
      startTime: ctx.startTime, durationSteps: winner.durationSteps,
      candidateId: winner.id, genome: winner.genome, phrase: phraseOf(winner.genome), obstacles: winner.obstacles, fallback,
      fitness: winner.fitness, metrics: winner.metrics, validation: winner.validation, rollouts,
      entries: ctx.entries, exits, signature: winner.signature,
      strategy: ctx.budget.strategy, population: ctx.budget.population, generations: ctx.budget.generations,
      evaluations: this.evaluations.length, cachedHits: this.cachedHits, gateCounts: counts, gateExamples: examples,
      nearWinners: [...ranked.slice(0, 4).map(summarize), ...gated.map(summarize)],
      elapsedMs: this.elapsedMs, stepsSimulated: this.stepsSimulated, finishedSynchronously: this.finishedSynchronously,
    };
  }

  /** no obstacles at all: a plain gap whose exits are simply the entries carried forward */
  private emptyRecord(fallback: string): EncounterRecord {
    const ctx = this.ctx;
    const { cfg } = ctx;
    const endX = ctx.startX + cfg.maxSpacing * 2;
    const nominalEnd = endX - cfg.playerScreenX - ENCOUNTER_LEAD_TIME * ctx.speedAt(endX - cfg.playerScreenX);
    const durationSteps = cameraStepsBetween(ctx.startCameraX, nominalEnd, ctx.speedAt, cfg.fixedDt);
    const { counts, examples } = this.gateStats();
    const genome: Genome = { id: `E${ctx.encounterIndex}-EMPTY`, genes: [], parentIds: [], origin: "fallback", history: [fallback] };
    return {
      index: ctx.encounterIndex, seed: this.encSeed, masterSeed: ctx.masterSeed, phase: ctx.target.phase, target: ctx.target,
      startX: ctx.startX, endX, startCameraX: ctx.startCameraX,
      endCameraX: cameraAfterSteps(ctx.startCameraX, durationSteps, ctx.speedAt, cfg.fixedDt),
      startTime: ctx.startTime, durationSteps, candidateId: genome.id, genome, phrase: "EMPTY", obstacles: [], fallback,
      fitness: null, metrics: null, validation: null, rollouts: null, entries: ctx.entries,
      exits: ctx.entries.map((e) => ({ y: e.y, vy: e.vy })), signature: null,
      strategy: ctx.budget.strategy, population: ctx.budget.population, generations: ctx.budget.generations,
      evaluations: this.evaluations.length, cachedHits: this.cachedHits, gateCounts: counts, gateExamples: examples,
      nearWinners: this.evaluations.slice(0, 4).map(summarize), elapsedMs: this.elapsedMs, stepsSimulated: this.stepsSimulated,
      finishedSynchronously: this.finishedSynchronously,
    };
  }
}

/** entry states for the encounter that follows a record */
export function nextEntryStates(previous: EncounterRecord | null, cfg: GameplayConfig, world: World): EntryState[] {
  return entryStatesFromExits(previous?.exits ?? [], Math.max(1, Math.round(cfg.entryStateCount)), cfg, world);
}

/** convenience for headless experiments: run one search to completion */
export function searchEncounter(ctx: SearchContext): EncounterRecord {
  return new SearchRun(ctx).finish();
}

export { AGENT_PROFILES, attemptSeed };

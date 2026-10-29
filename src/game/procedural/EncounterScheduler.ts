/**
 * runtime scheduler: searches encounters ahead of the player and commits them to
 * the world when their start enters the spawn horizon
 *
 * Searches run one at a time in encounter order because each one needs the
 * previous encounter's exit states. The game loop feeds `backgroundWork` a few
 * milliseconds per frame; up to `lookahead` finished encounters wait in a
 * buffer. If the player reaches an encounter whose search is still running, the
 * search is completed synchronously (a logged hitch) rather than replaced by a
 * timing-dependent fallback, so same seed + config + budget always produce the
 * same world no matter how fast the machine is.
 */

import type { GameplayConfig } from "../../config/gameplayConfig.js";
import { computeDifficulty, worldSpeedAt } from "../Difficulty.js";
import type { Obstacle } from "../Obstacle.js";
import { World } from "../World.js";
import { AGENT_PROFILES } from "./AgentController.js";
import { DiversityArchive } from "./DiversityArchive.js";
import { cameraAfterSteps, cameraStepsBetween } from "./Encounter.js";
import { ENCOUNTER_LEAD_TIME, pacingTarget, phaseForEncounter } from "./Pacing.js";
import { budgetFromConfig, nextEntryStates, SearchRun, type EncounterRecord, type SearchBudget } from "./SearchGenerator.js";

const now = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());

export class EncounterScheduler {
  /** placed in the world, oldest first; trimmed so the debug view keeps a bounded history */
  committed: EncounterRecord[] = [];
  /** searched, waiting for the spawn horizon */
  ready: EncounterRecord[] = [];
  active: SearchRun | null = null;
  log: string[] = [];
  readonly archive = new DiversityArchive(6);
  stats = { searched: 0, syncFinishes: 0, fallbacks: 0, evaluations: 0, elapsedMs: 0 };
  readonly lookahead = 2;
  strategy: SearchBudget["strategy"] = "evolve";

  private masterSeed = 1;
  private nextIndex = 0;
  private nextStartX = 0;
  private nextObstacleId = 1;

  constructor(private cfg: GameplayConfig) {}

  reset(seed: number, firstX: number, firstObstacleId: number, start = true): void {
    this.masterSeed = seed >>> 0;
    this.nextIndex = 0;
    this.nextStartX = firstX;
    this.nextObstacleId = firstObstacleId;
    this.committed = [];
    this.ready = [];
    this.active = null;
    this.log = [];
    this.archive.recent.length = 0;
    this.stats = { searched: 0, syncFinishes: 0, fallbacks: 0, evaluations: 0, elapsedMs: 0 };
    // searching begins during READY so the first encounters are usually buffered before the first input
    if (start) this.ensureSearching();
  }

  private lastPlanned(): EncounterRecord | null {
    return this.ready[this.ready.length - 1] ?? this.committed[this.committed.length - 1] ?? null;
  }

  /** start the next search if the buffer has room; inputs are captured now so slicing cannot change the result */
  private ensureSearching(): void {
    if (this.active || this.ready.length >= this.lookahead) return;
    const cfg = { ...this.cfg };
    const world = new World(cfg);
    const speedAt = (x: number) => worldSpeedAt(computeDifficulty(x, cfg), cfg);
    const previous = this.lastPlanned();
    const index = this.nextIndex;
    const startX = this.nextStartX;
    let startCameraX: number;
    let startTime: number;
    if (previous) {
      startCameraX = previous.endCameraX;
      startTime = previous.startTime + previous.durationSteps * cfg.fixedDt;
    } else {
      // first encounter: step the live speed rule from the run start so the simulation lands on a real camera value
      const nominal = startX - cfg.playerScreenX - ENCOUNTER_LEAD_TIME * speedAt(startX - cfg.playerScreenX);
      const steps = cameraStepsBetween(0, nominal, speedAt, cfg.fixedDt);
      startCameraX = cameraAfterSteps(0, steps, speedAt, cfg.fixedDt);
      startTime = steps * cfg.fixedDt;
    }
    const phase = phaseForEncounter(index);
    const target = pacingTarget(phase, computeDifficulty(startX - cfg.playerScreenX, cfg));
    this.active = new SearchRun({
      masterSeed: this.masterSeed, encounterIndex: index, cfg, world, startX, startCameraX, startTime, speedAt, target,
      entries: nextEntryStates(previous, cfg, world), archive: this.archive.snapshot(),
      budget: budgetFromConfig(cfg, this.strategy), profiles: AGENT_PROFILES, firstObstacleId: this.nextObstacleId,
    });
  }

  /** called once per rendered frame with a wall-clock budget; latency only */
  backgroundWork(maxMs: number): void {
    if (!this.active) this.ensureSearching();
    if (this.active && this.active.work(maxMs)) this.complete();
  }

  private complete(): EncounterRecord {
    const record = this.active!.finish();
    this.active = null;
    this.ready.push(record);
    if (record.signature) this.archive.push(record.signature);
    this.nextIndex++;
    this.nextStartX = record.endX;
    this.nextObstacleId += record.obstacles.length;
    this.stats.searched++;
    this.stats.evaluations += record.evaluations;
    this.stats.elapsedMs += record.elapsedMs;
    if (record.fallback) this.stats.fallbacks++;
    const fit = record.fitness ? record.fitness.fitness.toFixed(3) : "—";
    this.push(`E${record.index} ${record.phase} d=${record.target.difficulty.toFixed(2)} → ${record.candidateId} ${record.phrase} fit ${fit} · ${record.evaluations} evals ${record.elapsedMs.toFixed(0)}ms${record.fallback ? ` · FALLBACK ${record.fallback}` : ""}`);
    this.ensureSearching();
    return record;
  }

  private push(line: string): void {
    this.log.push(line);
    if (this.log.length > 14) this.log.shift();
  }

  /** world x where the next not-yet-placed encounter begins */
  nextPlannedStartX(): number {
    return this.ready.length ? this.ready[0].startX : this.active ? this.active.ctx.startX : this.nextStartX;
  }

  /** place every planned encounter whose first obstacle is inside the horizon; returns what was placed */
  update(horizonX: number, out: Obstacle[]): Obstacle[] {
    const placed: Obstacle[] = [];
    while (this.nextPlannedStartX() < horizonX) {
      if (this.ready.length === 0) {
        if (!this.active) this.ensureSearching();
        // the player arrived before the search finished: complete it now, deterministically, and say so
        const start = now();
        const record = this.complete();
        this.stats.syncFinishes++;
        this.push(`E${record.index} finished synchronously (${(now() - start).toFixed(0)}ms) — lower the search budget or raise the frame budget`);
      }
      const record = this.ready.shift()!;
      for (const o of record.obstacles) {
        o.encounter = {
          index: record.index, phase: record.phase, candidateId: record.candidateId,
          targetDifficulty: record.target.difficulty, fitness: record.fitness?.fitness ?? null, fallback: record.fallback,
        };
        out.push(o);
        placed.push(o);
      }
      this.committed.push(record);
      if (this.committed.length > 12) this.committed.shift();
      this.ensureSearching();
    }
    return placed;
  }
}

/**
 * headless playing agent: receding-horizon beam search over HOLD / RELEASE
 *
 * The agent is a bounded simulated player, not a reachability solver. It sees
 * only what a player could see (solids inside the viewport, optionally with a
 * reaction delay), plans a short way ahead with the real physics, executes the
 * first action, then observes again. Its failures are performance evidence,
 * never proof that an encounter is impossible; the feasibility search in
 * SequenceValidator answers that question separately.
 */

import { CANVAS_HEIGHT, CANVAS_WIDTH, type GameplayConfig } from "../../config/gameplayConfig.js";
import type { Obstacle } from "../Obstacle.js";
import { EncounterSimulation, type EncounterOptions, type TraceFrame } from "./Encounter.js";

export interface AgentSettings {
  beamWidth: number;
  horizonActions: number;
  actionSeconds: number;
  /** seconds before a newly visible hazard enters the observation; 0 = immediate */
  reactionDelay?: number;
}

export const DEFAULT_AGENT: AgentSettings = { beamWidth: 8, horizonActions: 8, actionSeconds: 0.1 };

/**
 * One planner, three limits. These are controller parameters that must be
 * calibrated against human play; they are not validated models of skill.
 * Budgets are deliberately smaller than the design document's first
 * hypothesis so a full population evaluates inside a frame budget.
 */
export interface AgentProfile extends AgentSettings {
  name: "strong" | "intermediate" | "novice";
  reactionDelay: number;
}

export const AGENT_PROFILES: AgentProfile[] = [
  { name: "strong", beamWidth: 8, horizonActions: 10, actionSeconds: 0.12, reactionDelay: 0 },
  { name: "intermediate", beamWidth: 4, horizonActions: 6, actionSeconds: 0.16, reactionDelay: 0.12 },
  { name: "novice", beamWidth: 2, horizonActions: 4, actionSeconds: 0.2, reactionDelay: 0.25 },
];

/** everything a rollout needs; a candidate-lab Candidate satisfies this shape */
export interface AgentScenario extends EncounterOptions {
  cfg: GameplayConfig;
  obstacles: Obstacle[];
  durationSteps: number;
  /** incoming state; defaults to the player reset state */
  entry?: { y: number; vy: number };
}

export interface AgentDecision {
  step: number;
  hold: boolean;
  visibleIds: number[];
  rollouts: number;
  collidedRollouts: number;
  planningStatus: "PLAN" | "PREFIX_ONLY" | "NO_SAFE_ACTION";
  predictedCost: number | null;
}

export interface AgentResult {
  completed: boolean;
  hitId: number | null;
  progress: number;
  switches: number;
  /** switches per simulated second */
  switchRate: number;
  verticalTravel: number;
  minClearance: number | null;
  /** fraction of obstacle-crossing steps spent below tightClearance */
  pressure: number;
  /** fraction of simulated steps with thrust held; part of the behavioral signature */
  holdFraction: number;
  exitY: number;
  exitVy: number;
  seconds: number;
  trace: TraceFrame[];
  decisions: AgentDecision[];
  settings: AgentSettings;
}

interface BeamNode {
  simulation: EncounterSimulation;
  firstHold: boolean;
  lastHold: boolean;
  cost: number;
  order: number;
}

export class AgentRun<T extends AgentScenario = AgentScenario> {
  readonly simulation: EncounterSimulation;
  readonly trace: TraceFrame[];
  readonly decisions: AgentDecision[] = [];
  readonly settings: AgentSettings & { reactionDelay: number };
  private switches = 0;
  private travel = 0;
  private clearance = Infinity;
  private overlapSteps = 0;
  private pressureSteps = 0;
  private holdSteps = 0;
  private readonly actionSteps: number;

  constructor(readonly candidate: T, settings: AgentSettings = DEFAULT_AGENT, private readonly keepTrace = true) {
    const delay = settings.reactionDelay ?? 0;
    if (!Number.isInteger(settings.beamWidth) || settings.beamWidth < 1 || settings.beamWidth > 64 ||
      !Number.isInteger(settings.horizonActions) || settings.horizonActions < 1 || settings.horizonActions > 24 ||
      !Number.isFinite(settings.actionSeconds) || settings.actionSeconds < 0.05 || settings.actionSeconds > 0.3 ||
      !Number.isFinite(delay) || delay < 0 || delay > 0.5) {
      throw new Error("Agent bounds: beam 1–64, horizon 1–24 actions, action interval 0.05–0.3 s, reaction delay 0–0.5 s.");
    }
    this.settings = { ...settings, reactionDelay: delay };
    this.simulation = new EncounterSimulation(candidate.cfg, candidate.obstacles, candidate);
    if (candidate.entry) this.simulation.setState(candidate.entry.y, candidate.entry.vy);
    this.trace = [this.simulation.frame()];
    this.actionSteps = Math.max(1, Math.round(settings.actionSeconds / candidate.cfg.fixedDt));
  }

  get done(): boolean {
    return this.simulation.hitId !== null || this.simulation.stepCount >= this.candidate.durationSteps;
  }

  /** solids a player could currently see; a delayed profile reacts to the view from `reactionDelay` seconds ago */
  private visibleObstacles(): Obstacle[] {
    const s = this.simulation;
    const cfg = this.candidate.cfg;
    const observedCameraX = s.cameraX - this.settings.reactionDelay * s.speedAt(s.cameraX);
    return this.candidate.obstacles.filter((o) => o.worldX - observedCameraX < CANVAS_WIDTH &&
      o.worldX + o.width > s.cameraX + cfg.playerScreenX);
  }

  advanceDecision(): void {
    if (this.done) return;
    const s = this.simulation;
    const cfg = this.candidate.cfg;
    const visible = this.visibleObstacles();
    // rollouts collide only with visible solids: the agent cannot plan through what it has not seen
    const root = new EncounterSimulation(cfg, visible, { startCameraX: s.startCameraX, startTime: s.startTime, speedAt: s.speedAt });
    Object.assign(root.player, { y: s.player.y, vy: s.player.vy, ay: s.player.ay, thrusting: s.player.thrusting });
    root.cameraX = s.cameraX;
    root.time = s.time;
    root.stepCount = s.stepCount;
    let beam: BeamNode[] = [{ simulation: root, firstHold: false, lastHold: s.player.thrusting, cost: 0, order: 0 }];
    let order = 0;
    let rollouts = 0;
    let collidedRollouts = 0;
    let plannedActions = 0;
    for (let depth = 0; depth < this.settings.horizonActions; depth++) {
      const branches: BeamNode[] = [];
      for (const node of beam) {
        for (const hold of [false, true]) {
          const prediction = node.simulation.clone();
          const remaining = this.candidate.durationSteps - prediction.stepCount;
          for (let i = 0; i < Math.min(this.actionSteps, remaining); i++) prediction.advance(hold);
          rollouts++;
          if (prediction.hitId !== null) { collidedRollouts++; continue; }
          // a small switch cost discourages chattering; position cost steers toward the next opening
          const cost = node.cost + this.positionCost(prediction, visible) + (node.lastHold !== hold ? 0.015 : 0);
          branches.push({ simulation: prediction, firstHold: depth === 0 ? hold : node.firstHold, lastHold: hold, cost, order: order++ });
        }
      }
      // If every deeper branch dies, execute the safest surviving prefix.
      // This is bounded planning, not proof that no input path exists.
      if (branches.length === 0) break;
      branches.sort((a, b) => a.cost - b.cost || a.order - b.order);
      // merge near-duplicate (y, vy, action) states so the beam spends its width on different futures
      const seen = new Set<string>();
      const merged: BeamNode[] = [];
      for (const b of branches) {
        const key = `${Math.round(b.simulation.player.y / 4)}|${Math.round(b.simulation.player.vy / 20)}|${b.lastHold ? 1 : 0}`;
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(b);
        if (merged.length >= this.settings.beamWidth) break;
      }
      beam = merged;
      plannedActions = depth + 1;
    }
    const best = beam[0];
    const hold = best.firstHold;
    this.decisions.push({
      step: s.stepCount, hold, visibleIds: visible.map((o) => o.id), rollouts, collidedRollouts,
      planningStatus: plannedActions === 0 ? "NO_SAFE_ACTION" : plannedActions < this.settings.horizonActions ? "PREFIX_ONLY" : "PLAN",
      predictedCost: plannedActions === 0 ? null : best.cost,
    });
    if (s.stepCount > 0 && s.player.thrusting !== hold) this.switches++;
    for (let i = 0; i < this.actionSteps && !this.done; i++) {
      const previousY = s.player.y;
      const frame = s.step(hold);
      this.travel += Math.abs(frame.y - previousY);
      if (hold) this.holdSteps++;
      if (this.keepTrace) this.trace.push(frame);
      if (frame.clearance !== null) {
        this.overlapSteps++;
        if (frame.clearance < cfg.tightClearance) this.pressureSteps++;
        if (frame.clearance < this.clearance) this.clearance = frame.clearance;
      }
    }
  }

  /**
   * Heuristic: squared distance from the velocity-projected position to the
   * center of the nearest free interval of the next visible solid, or to the
   * corridor center when nothing is visible (a stable, open corridor). This is a
   * controller heuristic, not a difficulty or fun score.
   */
  private positionCost(s: EncounterSimulation, visible: Obstacle[]): number {
    const cfg = this.candidate.cfg;
    const next = visible.find((o) => o.worldX + o.width > s.cameraX + cfg.playerScreenX);
    const projected = s.player.y + s.player.vy * 0.15;
    let target = (s.world.ceilingY() + s.world.floorY() - cfg.playerHeight) / 2;
    if (next) {
      let bestDistance = Infinity;
      for (const [a, b] of next.freeIntervals(s.cameraX, s.time, s.world, cfg.playerHeight, false)) {
        const center = (a + b) / 2;
        const distance = Math.abs(projected - center);
        if (distance < bestDistance) { bestDistance = distance; target = center; }
      }
    }
    const error = (projected - target) / CANVAS_HEIGHT;
    return error * error;
  }

  result(): AgentResult {
    const s = this.simulation;
    const seconds = s.stepCount * this.candidate.cfg.fixedDt;
    return {
      completed: s.hitId === null && s.stepCount >= this.candidate.durationSteps,
      hitId: s.hitId,
      progress: Math.min(1, s.stepCount / this.candidate.durationSteps),
      switches: this.switches,
      switchRate: seconds > 0 ? this.switches / seconds : 0,
      verticalTravel: this.travel,
      minClearance: Number.isFinite(this.clearance) ? this.clearance : null,
      pressure: this.overlapSteps > 0 ? this.pressureSteps / this.overlapSteps : 0,
      holdFraction: s.stepCount > 0 ? this.holdSteps / s.stepCount : 0,
      exitY: s.player.y,
      exitVy: s.player.vy,
      seconds,
      trace: [...this.trace],
      decisions: [...this.decisions],
      settings: { ...this.settings },
    };
  }
}

export function evaluateCandidate<T extends AgentScenario>(candidate: T, settings: AgentSettings = DEFAULT_AGENT, keepTrace = true): AgentResult {
  const run = new AgentRun(candidate, settings, keepTrace);
  while (!run.done) run.advanceDecision();
  return run.result();
}

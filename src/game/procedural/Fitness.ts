/**
 * fitness: target difficulty, rhythm, novelty, readability
 *
 * Difficulty is inferred from how the agent profiles perform, never from the
 * geometry alone. Every term is on a 0–1 scale and the weights are initial
 * illustrative settings to be recalibrated with human playtests. A low
 * completion rate is not evidence of fun; feasibility gates run before any of
 * this and cannot be overridden by a good score.
 *
 *   difficultyMatch = 1 - mean_p |completion[p] - target[p, phase]|
 *   rhythmMatch     = mean(closeness(switchRate), closeness(pressure), closeness(settle))
 *   novelty         = min structural + behavioral distance from recent encounters
 *   readability     = 0.5 * warning quality + 0.5 * clearance quality (capped)
 *   fitness         = 0.45 * difficultyMatch + 0.20 * rhythmMatch + 0.20 * novelty + 0.15 * readability
 */

import { clamp, type GameplayConfig } from "../../config/gameplayConfig.js";
import { AgentRun, type AgentProfile, type AgentScenario } from "./AgentController.js";
import type { TraceFrame } from "./Encounter.js";
import { bandCloseness, type PacingTarget } from "./Pacing.js";
import type { EntryState, ExitState } from "./SequenceValidator.js";

export interface RolloutSummary {
  profile: AgentProfile["name"];
  entry: string;
  completed: boolean;
  hitId: number | null;
  progress: number;
  minClearance: number | null;
  switches: number;
  switchRate: number;
  pressure: number;
  holdFraction: number;
  exit: ExitState;
  seconds: number;
  /** kept only for the selected encounter to bound memory */
  trace: TraceFrame[] | null;
}

/** one profile from one fixed entry state; traces are optional because search evaluates many candidates */
export function runProfile(scenario: AgentScenario, entry: EntryState, profile: AgentProfile, keepTrace: boolean): RolloutSummary {
  const run = new AgentRun({ ...scenario, entry: { y: entry.y, vy: entry.vy } }, profile, keepTrace);
  while (!run.done) run.advanceDecision();
  const r = run.result();
  return {
    profile: profile.name, entry: entry.label, completed: r.completed, hitId: r.hitId, progress: r.progress,
    minClearance: r.minClearance, switches: r.switches, switchRate: r.switchRate, pressure: r.pressure,
    holdFraction: r.holdFraction, exit: { y: r.exitY, vy: r.exitVy }, seconds: r.seconds,
    trace: keepTrace ? r.trace : null,
  };
}

/** every profile from every fixed entry state, in a fixed order */
export function runProfiles(scenario: AgentScenario, entries: EntryState[], profiles: AgentProfile[], keepTraces: boolean): RolloutSummary[] {
  const out: RolloutSummary[] = [];
  for (const profile of profiles) for (const entry of entries) out.push(runProfile(scenario, entry, profile, keepTraces));
  return out;
}

export interface Metrics {
  /** fraction of entry states each profile completed */
  completion: { strong: number; intermediate: number; novice: number };
  /** mean normalized progress of failed rollouts, 1 when none failed */
  failProgress: number;
  /** over successful strong rollouts; null when none crossed an obstacle */
  minClearance: number | null;
  meanClearance: number | null;
  /** strong profile: switches per second, pressure fraction, exit stability */
  switchRate: number;
  pressure: number;
  settle: number;
  holdFraction: number;
  /** smallest seconds between consecutive obstacle fronts */
  warningTime: number;
  rollouts: number;
}

function mean(values: number[], fallback: number): number {
  return values.length ? values.reduce((s, v) => s + v, 0) / values.length : fallback;
}

export function measure(rollouts: RolloutSummary[], cfg: GameplayConfig, warningTime: number): Metrics {
  const byProfile = (name: AgentProfile["name"]) => rollouts.filter((r) => r.profile === name);
  const completion = (name: AgentProfile["name"]) => {
    const rs = byProfile(name);
    return rs.length ? rs.filter((r) => r.completed).length / rs.length : 0;
  };
  const strong = byProfile("strong");
  // rhythm comes from runs that actually crossed the encounter; failures would bias every rate downward
  const reference = strong.some((r) => r.completed) ? strong.filter((r) => r.completed) : strong;
  const failed = rollouts.filter((r) => !r.completed);
  const crossed = reference.filter((r) => r.minClearance !== null);
  return {
    completion: { strong: completion("strong"), intermediate: completion("intermediate"), novice: completion("novice") },
    failProgress: failed.length ? mean(failed.map((r) => r.progress), 1) : 1,
    minClearance: crossed.length ? Math.min(...crossed.map((r) => r.minClearance!)) : null,
    meanClearance: crossed.length ? mean(crossed.map((r) => r.minClearance!), 0) : null,
    switchRate: mean(reference.map((r) => r.switchRate), 0),
    pressure: mean(reference.map((r) => r.pressure), 0),
    settle: mean(reference.map((r) => 1 - Math.min(1, Math.abs(r.exit.vy) / cfg.maxFallSpeed)), 0),
    holdFraction: mean(reference.map((r) => r.holdFraction), 0),
    warningTime,
    rollouts: rollouts.length,
  };
}

export const FITNESS_WEIGHTS = { difficulty: 0.45, rhythm: 0.2, novelty: 0.2, readability: 0.15 };

export interface FitnessComponents {
  difficultyMatch: number;
  rhythmMatch: number;
  novelty: number;
  readability: number;
  fitness: number;
  detail: {
    completionError: { strong: number; intermediate: number; novice: number };
    switchCloseness: number;
    pressureCloseness: number;
    settleCloseness: number;
    warningScore: number;
    clearanceScore: number;
  };
}

export function scoreCandidate(metrics: Metrics, target: PacingTarget, novelty: number, cfg: GameplayConfig): FitnessComponents {
  const completionError = {
    strong: Math.abs(metrics.completion.strong - target.completion.strong),
    intermediate: Math.abs(metrics.completion.intermediate - target.completion.intermediate),
    novice: Math.abs(metrics.completion.novice - target.completion.novice),
  };
  // equal profile weights at first; with five entries each completion moves in steps of 0.2
  const difficultyMatch = clamp(1 - (completionError.strong + completionError.intermediate + completionError.novice) / 3, 0, 1);
  const switchCloseness = bandCloseness(metrics.switchRate, target.switchBand);
  const pressureCloseness = bandCloseness(metrics.pressure, target.pressureBand);
  const settleCloseness = bandCloseness(metrics.settle, target.settleBand);
  const rhythmMatch = (switchCloseness + pressureCloseness + settleCloseness) / 3;
  // capped so a trivially empty layout cannot keep collecting readability
  const warningScore = clamp(metrics.warningTime / (2 * cfg.minObstacleGapTime), 0, 1);
  const clearanceScore = metrics.meanClearance === null ? 0.5 : clamp(metrics.meanClearance / (4 * cfg.minClearance), 0, 1);
  const readability = 0.5 * warningScore + 0.5 * clearanceScore;
  const w = FITNESS_WEIGHTS;
  const fitness = w.difficulty * difficultyMatch + w.rhythm * rhythmMatch + w.novelty * clamp(novelty, 0, 1) + w.readability * readability;
  return {
    difficultyMatch, rhythmMatch, novelty: clamp(novelty, 0, 1), readability, fitness,
    detail: { completionError, switchCloseness, pressureCloseness, settleCloseness, warningScore, clearanceScore },
  };
}

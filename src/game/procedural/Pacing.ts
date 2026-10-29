/**
 * local pacing targets: WARMUP -> BUILD -> PEAK -> RECOVERY, repeated while global
 * difficulty keeps rising with distance
 *
 * Global difficulty is an allowed budget, not the whole pacing model. A run that
 * only tightens gaps and raises speed becomes a monotonic stream of pressure.
 * These targets alternate easier and harder encounters inside the budget and are
 * the numbers the fitness function compares agent measurements against.
 *
 * Every value here is an initial illustrative setting, not a measured truth.
 * They are meant to be changed after human playtests.
 */

export type PacingPhase = "WARMUP" | "BUILD" | "PEAK" | "RECOVERY";

/** one WARMUP opens the run, then the three-phase wave repeats */
export const PHASE_CYCLE: PacingPhase[] = ["BUILD", "PEAK", "RECOVERY"];

export function phaseForEncounter(encounterIndex: number): PacingPhase {
  if (encounterIndex === 0) return "WARMUP";
  return PHASE_CYCLE[(encounterIndex - 1) % PHASE_CYCLE.length];
}

/** completion fraction a profile is expected to reach across the entry-state set */
export interface CompletionTargets {
  strong: number;
  intermediate: number;
  novice: number;
}

export interface PacingTarget {
  phase: PacingPhase;
  /** global distance difficulty at the encounter start */
  difficulty: number;
  /** fraction of the global budget this phase may spend on geometry ranges */
  budgetScale: number;
  completion: CompletionTargets;
  /** HOLD/RELEASE switches per second, desired band */
  switchBand: [number, number];
  /** fraction of obstacle-crossing time spent under tight clearance, desired band */
  pressureBand: [number, number];
  /** exit stability 1 - |vy_exit| / maxFallSpeed, desired band */
  settleBand: [number, number];
  /** initialization range modifiers relative to the difficulty curve */
  spacingScale: number;
  openingScale: number;
  allowMoving: boolean;
  /** obstacle count limits for initial candidates */
  length: [number, number];
  /** seconds of empty travel after the last obstacle before the next encounter starts */
  gapAfterTime: number;
}

/** the agent sees the first obstacle this long before it arrives; shared by every phase so exit == next entry */
export const ENCOUNTER_LEAD_TIME = 0.6;

/**
 * The target table from the design document for five entry states.
 * PEAK deliberately accepts low novice completion; it must never override the
 * feasibility and warning gates, which run before fitness.
 */
export function pacingTarget(phase: PacingPhase, difficulty: number): PacingTarget {
  switch (phase) {
    case "WARMUP":
      return {
        phase, difficulty, budgetScale: 0.5,
        completion: { strong: 1.0, intermediate: 1.0, novice: 0.8 },
        switchBand: [0.4, 2.5], pressureBand: [0, 0.15], settleBand: [0.6, 1],
        spacingScale: 1.3, openingScale: 1.25, allowMoving: false, length: [2, 2], gapAfterTime: 1.2,
      };
    case "BUILD":
      return {
        phase, difficulty, budgetScale: 0.85,
        completion: { strong: 1.0, intermediate: 0.8, novice: 0.6 },
        switchBand: [1.2, 4.0], pressureBand: [0.08, 0.4], settleBand: [0.4, 1],
        spacingScale: 1.0, openingScale: 1.0, allowMoving: difficulty > 0.1, length: [2, 3], gapAfterTime: 0.9,
      };
    case "PEAK":
      return {
        phase, difficulty, budgetScale: 1.0,
        completion: { strong: 0.8, intermediate: 0.6, novice: 0.2 },
        switchBand: [2.0, 6.0], pressureBand: [0.2, 0.7], settleBand: [0.2, 1],
        spacingScale: 0.85, openingScale: 0.9, allowMoving: difficulty > 0.1, length: [3, 4], gapAfterTime: 0.8,
      };
    case "RECOVERY":
      return {
        phase, difficulty, budgetScale: 0.4,
        completion: { strong: 1.0, intermediate: 1.0, novice: 1.0 },
        switchBand: [0, 2.0], pressureBand: [0, 0.1], settleBand: [0.7, 1],
        spacingScale: 1.4, openingScale: 1.3, allowMoving: false, length: [2, 2], gapAfterTime: 1.3,
      };
  }
}

/** 1 inside the band, falling linearly to 0 one band-width outside it */
export function bandCloseness(value: number, band: [number, number]): number {
  const [lo, hi] = band;
  if (value >= lo && value <= hi) return 1;
  const width = Math.max(hi - lo, 1e-6);
  const distance = value < lo ? lo - value : value - hi;
  return Math.max(0, 1 - distance / width);
}

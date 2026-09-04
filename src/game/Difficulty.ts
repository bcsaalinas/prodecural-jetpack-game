/**
 * distance based difficulty values with no random choices
 * the spawner owns variation while this file owns the progression curve
 */

import { clamp, lerp, type GameplayConfig } from "../config/gameplayConfig.js";
import type { SeededRandom } from "./Random.js";

export function computeDifficulty(distance: number, cfg: GameplayConfig): number {
  // one shared scalar keeps speed, spacing, gaps, and movers on the same curve
  return clamp(distance / cfg.difficultyDistance, 0, 1);
}

export function worldSpeedAt(difficulty: number, cfg: GameplayConfig): number {
  return lerp(cfg.worldStartSpeed, cfg.worldMaxSpeed, difficulty);
}

/**
 * seeded jitter keeps spacing from feeling metronomic
 */
export function spacingAt(difficulty: number, cfg: GameplayConfig, rng: SeededRandom): number {
  const base = lerp(cfg.maxSpacing, cfg.minSpacing, difficulty);
  return base * rng.range(0.9, 1.15);
}

/** GATE gap height at the given difficulty (px). */
export function openingAt(difficulty: number, cfg: GameplayConfig, rng: SeededRandom): number {
  return lerp(cfg.openingMax, cfg.openingMin, difficulty) * rng.range(0.95, 1.05);
}

/** MOVING hazard oscillation speed scales up with difficulty. */
export function moverSpeedAt(difficulty: number, cfg: GameplayConfig): number {
  return cfg.movingHazardSpeed * (1 + difficulty);
}

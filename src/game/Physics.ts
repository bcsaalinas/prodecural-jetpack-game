/**
 * vertical motion shared by the player, predictor, and validator
 *
 * semi implicit euler updates velocity before position
 * keeping this in one function stops preview math from drifting away from play
 */

import { clamp, type GameplayConfig } from "../config/gameplayConfig.js";

export interface VerticalState {
  y: number;
  vy: number;
  ay: number; // kept in state for debug output and telemetry
  thrusting: boolean;
}

export function integrateVertical(s: VerticalState, cfg: GameplayConfig, dt: number): void {
  // gravity stays active during thrust, so input changes acceleration and not velocity directly
  const thrust = s.thrusting ? cfg.thrustAcceleration : 0;
  s.ay = cfg.gravity + thrust;

  s.vy += s.ay * dt;

  // exponential damping has the same result at different fixed step sizes
  if (cfg.linearDamping > 0) s.vy *= Math.exp(-cfg.linearDamping * dt);

  // the clamps also give obstacle design a known vertical speed limit
  s.vy = clamp(s.vy, cfg.maxRiseSpeed, cfg.maxFallSpeed);

  s.y += s.vy * dt;
}

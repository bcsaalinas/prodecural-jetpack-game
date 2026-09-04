/**
 * forward simulation for the preview and obstacle validator
 * both branches reuse live physics so tuning changes all three paths together
 * full thrust and no thrust give the vertical bounds because control is additive
 */

import type { GameplayConfig } from "../config/gameplayConfig.js";
import { integrateVertical, type VerticalState } from "./Physics.js";
import type { World } from "./World.js";

export interface TrajectoryPoint {
  t: number; // seconds into the future
  y: number; // player TOP y (same reference as Player.y)
}

/** Simulate one input policy (held or released) for `seconds`. */
export function simulatePath(
  y0: number,
  vy0: number,
  thrusting: boolean,
  seconds: number,
  cfg: GameplayConfig,
  world: World,
): TrajectoryPoint[] {
  const s: VerticalState = { y: y0, vy: vy0, ay: 0, thrusting };
  const dt = cfg.fixedDt;
  const pts: TrajectoryPoint[] = [];
  const minY = world.ceilingY();
  const maxY = world.floorY() - cfg.playerHeight;

  const steps = Math.min(Math.ceil(seconds / dt), 4096); // bad config must not lock the page
  for (let i = 0; i < steps; i++) {
    integrateVertical(s, cfg, dt);
    if (s.y < minY) { s.y = minY; if (s.vy < 0) s.vy = 0; }
    if (s.y > maxY) { s.y = maxY; if (s.vy > 0) s.vy = 0; }
    pts.push({ t: (i + 1) * dt, y: s.y });
  }
  return pts;
}

export interface ReachableBand {
  /** Smallest reachable top-y (highest altitude): full-thrust branch. */
  minY: number;
  /** Largest reachable top-y (lowest altitude): released branch. */
  maxY: number;
  t: number;
}

/** Exact reachable vertical interval `t` seconds from now. */
export function reachableBand(
  y0: number,
  vy0: number,
  t: number,
  cfg: GameplayConfig,
  world: World,
): ReachableBand {
  const up = simulatePath(y0, vy0, true, t, cfg, world);
  const down = simulatePath(y0, vy0, false, t, cfg, world);
  return {
    minY: up.length ? up[up.length - 1].y : y0,
    maxY: down.length ? down[down.length - 1].y : y0,
    t,
  };
}

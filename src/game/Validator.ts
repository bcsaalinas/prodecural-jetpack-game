/**
 * spawn time check for reaction time and single obstacle reachability
 * rejected obstacles stay in the run so the bad setup can be inspected
 * obstacle chains are validated as a group by procedural/SequenceValidator
 */

import type { GameplayConfig } from "../config/gameplayConfig.js";
import { Obstacle } from "./Obstacle.js";
import { reachableBand } from "./Trajectory.js";
import type { World } from "./World.js";

export interface ValidationResult {
  possible: boolean;
  reason: string;
  reactionTime: number;
}

export function validateObstacle(
  obs: Obstacle,
  playerY: number,
  playerVy: number,
  cameraX: number,
  worldSpeed: number,
  cfg: GameplayConfig,
  world: World,
): ValidationResult {
  const dist = obs.distanceToPlayer(cameraX, cfg.playerScreenX, cfg.playerWidth);
  const t = worldSpeed > 0 ? dist / worldSpeed : Infinity;
  const fmt = (n: number) => n.toFixed(0);

  // check the warning window before doing reachability work
  if (t < cfg.minReactionTime) {
    return {
      possible: false,
      reactionTime: t,
      reason: `reaction ${t.toFixed(2)}s < min ${cfg.minReactionTime.toFixed(2)}s`,
    };
  }

  // full thrust and release paths bound the reachable top y values
  const band = reachableBand(playerY, playerVy, t, cfg, world);

  // each interval is a player top y range that clears the obstacle
  // moving hazards use their full sweep, so this check is conservative
  const safe = obs.freeIntervals(cameraX, 0, world, cfg.playerHeight, true);
  if (safe.length === 0) {
    return { possible: false, reactionTime: t, reason: "unreachable: no opening fits the player height" };
  }

  const overlaps = safe.some(([a, b]) => band.maxY >= a && band.minY <= b && b >= a);
  if (overlaps) {
    return { possible: true, reason: "", reactionTime: t };
  }

  return {
    possible: false,
    reactionTime: t,
    reason:
      `unreachable: need top-y in ${safe.map(([a, b]) => `[${fmt(a)},${fmt(b)}]`).join(" or ")}` +
      ` but reachable band is [${fmt(band.minY)},${fmt(band.maxY)}] at t=${t.toFixed(2)}s`,
  };
}

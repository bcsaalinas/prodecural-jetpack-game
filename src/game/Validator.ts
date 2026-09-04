/**
 * spawn time check for reaction time and single obstacle reachability
 * rejected obstacles stay in the run so the bad setup can be inspected
 * obstacle chains are not validated as a group
 */

import type { GameplayConfig } from "../config/gameplayConfig.js";
import { Obstacle, ObstacleType } from "./Obstacle.js";
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
  const h = cfg.playerHeight;
  const floorTop = world.floorY();
  const ceilBot = world.ceilingY();

  // each interval is a player top y range that clears the obstacle
  let safe: Array<[number, number]> = [];

  switch (obs.type) {
    case ObstacleType.GATE: {
      const gTop = obs.gapTop ?? ceilBot;
      const gBot = obs.gapBottom ?? floorTop;
      // player height reduces the usable gate range
      safe = [[gTop, gBot - h]];
      break;
    }
    case ObstacleType.BLOCK_TOP: {
      // top block leaves one safe range below it
      const blockBottom = ceilBot + obsHeight(obs, cameraX);
      safe = [[blockBottom, floorTop - h]];
      break;
    }
    case ObstacleType.BLOCK_BOTTOM: {
      const blockTop = floorTop - obsHeight(obs, cameraX);
      safe = [[ceilBot, blockTop - h]];
      break;
    }
    case ObstacleType.FLOATING:
    case ObstacleType.MOVING: {
      // moving hazards use their full sweep, so this check is conservative
      const r = worstRect(obs, cameraX);
      // floating blocks leave one range on each side
      safe = [
        [ceilBot, r.y - h],
        [r.y + r.h, floorTop - h],
      ];
      break;
    }
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

/** Height of the first solid part (blocks are single-part). */
function obsHeight(obs: Obstacle, cameraX: number): number {
  const r = obs.getRects(cameraX, 0)[0];
  return r ? r.h : 0;
}

/** For FLOATING/MOVING: the rect expanded to worst-case vertical extent. */
function worstRect(obs: Obstacle, cameraX: number): { y: number; h: number } {
  const r = obs.getRects(cameraX, 0)[0];
  if (!r) return { y: 0, h: 0 };
  if (obs.moving) {
    return { y: r.y - Math.abs(obs.moving.amplitude), h: r.h + 2 * Math.abs(obs.moving.amplitude) };
  }
  return { y: r.y, h: r.h };
}

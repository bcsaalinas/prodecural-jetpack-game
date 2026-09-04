/**
 * manual AABB collision with a simple horizontal broad phase
 * collision is discrete on purpose so timestep and tunneling can be studied
 */

import { Obstacle } from "./Obstacle.js";
import type { AABB } from "./Player.js";

export function aabbOverlap(a: AABB, b: AABB): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export interface CollisionHit {
  obstacle: Obstacle;
  rect: AABB; // exact solid part that was hit
}

/** First obstacle part overlapping the player this step, or null. */
export function findCollision(
  player: AABB,
  obstacles: Obstacle[],
  cameraX: number,
  time: number,
): CollisionHit | null {
  for (const obs of obstacles) {
    // skip obstacle parts that cannot overlap the player on x
    const sx = obs.worldX - cameraX;
    if (sx + obs.width < player.x || sx > player.x + player.w) continue;

    for (const rect of obs.getRects(cameraX, time)) {
      if (aabbOverlap(player, rect)) return { obstacle: obs, rect };
    }
  }
  return null;
}

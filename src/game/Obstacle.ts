/**
 * obstacle data stays in world space
 * getRects is the one screen space view used by collision and debug drawing
 */

import type { AABB } from "./Player.js";

export enum ObstacleType {
  GATE = "GATE",
  BLOCK_TOP = "BLOCK_TOP",
  BLOCK_BOTTOM = "BLOCK_BOTTOM",
  FLOATING = "FLOATING",
  MOVING = "MOVING",
}

/** Geometry of one solid part, in world space (x is worldX + local dx). */
export interface ObstaclePart {
  dx: number; // offset from obstacle worldX (usually 0)
  y: number;
  w: number;
  h: number;
}

export interface MovingSpec {
  baseY: number; // center of oscillation using the rect top as reference
  amplitude: number;
  speed: number; // px/s value converted to an angular phase rate
  phase: number;
}

export class Obstacle {
  /** Set by the validator: false = "potentially impossible from spawn state". */
  possible = true;
  rejectReason = "";

  /** Reaction window this obstacle gave the player AT SPAWN TIME (seconds). */
  spawnReactionTime = 0;

  constructor(
    public readonly id: number,
    public readonly type: ObstacleType,
    public readonly worldX: number,
    public readonly width: number,
    private parts: ObstaclePart[],
    /** For GATE: the vertical open interval [gapTop, gapBottom]. */
    public readonly gapTop: number | null = null,
    public readonly gapBottom: number | null = null,
    public moving: MovingSpec | null = null,
  ) {}

  /**
   * Solid rectangles in SCREEN space for the current camera position and time.
   * Moving hazards offset their y with a sine; amplitude is pre-clamped at
   * spawn so the extremes never leave the corridor.
   */
  getRects(cameraX: number, time: number): AABB[] {
    const screenX = this.worldX - cameraX;
    return this.parts.map((p) => {
      let y = p.y;
      if (this.moving) {
        y = p.y + Math.sin(time * this.moving.speed * 0.02 + this.moving.phase) * this.moving.amplitude;
      }
      return { x: screenX + p.dx, y, w: p.w, h: p.h };
    });
  }

  /** Horizontal distance from the player edge to the obstacle front, px. */
  distanceToPlayer(cameraX: number, playerScreenX: number, playerW: number): number {
    return this.worldX - cameraX - (playerScreenX + playerW);
  }

  /** Live estimate: seconds until the obstacle front reaches the player. */
  timeToPlayer(cameraX: number, playerScreenX: number, playerW: number, worldSpeed: number): number {
    if (worldSpeed <= 0) return Infinity;
    return this.distanceToPlayer(cameraX, playerScreenX, playerW) / worldSpeed;
  }

  /** True once the obstacle is fully behind the visible screen. */
  isGone(cameraX: number): boolean {
    return this.worldX - cameraX + this.width < -50;
  }
}

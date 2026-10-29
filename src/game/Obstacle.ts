/**
 * obstacle data stays in world space
 * getRects is the one screen space view used by collision and debug drawing
 */

import type { AABB } from "./Player.js";
import type { World } from "./World.js";

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

/** which searched encounter placed this obstacle; null for the weighted spawner */
export interface EncounterTag {
  index: number;
  phase: string;
  candidateId: string;
  targetDifficulty: number;
  fitness: number | null;
  fallback: string | null;
}

export class Obstacle {
  /** Set by the validator: false = "potentially impossible from spawn state". */
  possible = true;
  rejectReason = "";

  /** search metadata for the debug view and death report */
  encounter: EncounterTag | null = null;

  /** Reaction window this obstacle gave the player AT SPAWN TIME (seconds). */
  spawnReactionTime = 0;

  /** Extra spacing budget after this obstacle, in seconds at its scheduled speed. */
  recoveryAfter = 0;

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

  /** world space solid parts, read-only; the headless simulation precomputes from these */
  getParts(): readonly ObstaclePart[] {
    return this.parts;
  }

  /**
   * Player top-y intervals that clear this obstacle: the free space between
   * solid parts inside the corridor, shrunk by the player height. With `sweep`
   * a moving part is expanded to its full travel (conservative, for validation);
   * without it the part is where it is right now (what a player can see).
   */
  freeIntervals(cameraX: number, time: number, world: World, playerHeight: number, sweep: boolean): Array<[number, number]> {
    const amp = this.moving ? Math.abs(this.moving.amplitude) : 0;
    const rects = (sweep && this.moving
      ? this.parts.map((p) => ({ y: p.y - amp, h: p.h + 2 * amp }))
      : this.getRects(cameraX, time).map((r) => ({ y: r.y, h: r.h })))
      .sort((a, b) => a.y - b.y);
    const intervals: Array<[number, number]> = [];
    let cursor = world.ceilingY();
    for (const r of rects) {
      if (r.y - cursor >= playerHeight) intervals.push([cursor, r.y - playerHeight]);
      cursor = Math.max(cursor, r.y + r.h);
    }
    const floor = world.floorY();
    if (floor - cursor >= playerHeight) intervals.push([cursor, floor - playerHeight]);
    return intervals;
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

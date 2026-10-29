/**
 * finite headless simulation shared by construction, feasibility search, the
 * playing agent, and the encounter scheduler
 *
 * It runs the same fixed step order as Game: speed from the camera position,
 * Player.update (integrator + corridor response), camera advance, hazard
 * collision. Nothing is rendered. Solids are precomputed once so thousands of
 * clones per decision stay cheap; the overlap test is the same strict AABB rule
 * as Collision.ts, which the headless verification checks frame by frame.
 */

import type { GameplayConfig } from "../../config/gameplayConfig.js";
import type { Obstacle } from "../Obstacle.js";
import { Player, PlayerState } from "../Player.js";
import { World } from "../World.js";

export interface TraceFrame {
  step: number;
  time: number;
  cameraX: number;
  y: number;
  vy: number;
  hold: boolean;
  hitId: number | null;
  /** vertical gap to the nearest solid overlapping the player horizontally; null when none does */
  clearance: number | null;
}

export interface CandidateParameters {
  spacing: number;
  recoveryDistance: number;
  clearance: number;
  targetFractions: number[];
}

export interface Candidate {
  id: string;
  seed: number;
  cfg: GameplayConfig;
  derivation: string[];
  parameters: CandidateParameters;
  obstacles: Obstacle[];
  durationSteps: number;
  witness: TraceFrame[];
  rejection: string | null;
}

export interface EncounterOptions {
  /** camera position at step 0; obstacle world x values are absolute */
  startCameraX?: number;
  /** run time at step 0; moving hazards use absolute time, exactly like Game */
  startTime?: number;
  /** scroll speed for a camera position; defaults to the constant worldStartSpeed used by the candidate lab */
  speedAt?: (cameraX: number) => number;
}

interface SolidPart {
  x0: number;
  w: number;
  y: number;
  h: number;
  moving: boolean;
  amp: number;
  speed: number;
  phase: number;
}

interface Solid {
  id: number;
  x0: number;
  w: number;
  parts: SolidPart[];
}

export class EncounterSimulation {
  readonly player: Player;
  readonly world: World;
  readonly startCameraX: number;
  readonly startTime: number;
  readonly speedAt: (cameraX: number) => number;
  cameraX: number;
  time: number;
  stepCount = 0;
  hitId: number | null = null;
  private readonly solids: Solid[];

  constructor(readonly cfg: GameplayConfig, readonly obstacles: Obstacle[], options: EncounterOptions = {}, shared?: Solid[]) {
    this.world = new World(cfg);
    this.player = new Player(cfg, this.world);
    this.startCameraX = options.startCameraX ?? 0;
    this.startTime = options.startTime ?? 0;
    this.cameraX = this.startCameraX;
    this.time = this.startTime;
    const constant = cfg.worldStartSpeed;
    this.speedAt = options.speedAt ?? (() => constant);
    this.solids = shared ?? obstacles.map((o) => ({
      id: o.id, x0: o.worldX, w: o.width,
      parts: o.getParts().map((p) => ({
        x0: o.worldX + p.dx, w: p.w, y: p.y, h: p.h,
        moving: o.moving !== null, amp: o.moving?.amplitude ?? 0, speed: o.moving?.speed ?? 0, phase: o.moving?.phase ?? 0,
      })),
    }));
  }

  /** place the player in an incoming state; used for entry-state sweeps */
  setState(y: number, vy: number): void {
    this.player.y = y;
    this.player.vy = vy;
    this.player.ay = 0;
    this.player.thrusting = false;
    this.player.state = PlayerState.FALLING;
  }

  clone(): EncounterSimulation {
    const copy = new EncounterSimulation(this.cfg, this.obstacles,
      { startCameraX: this.startCameraX, startTime: this.startTime, speedAt: this.speedAt }, this.solids);
    Object.assign(copy.player, {
      y: this.player.y, vy: this.player.vy, ay: this.player.ay,
      thrusting: this.player.thrusting, state: this.player.state,
    });
    copy.cameraX = this.cameraX;
    copy.time = this.time;
    copy.stepCount = this.stepCount;
    copy.hitId = this.hitId;
    return copy;
  }

  frame(): TraceFrame {
    const c = this.clearance();
    return {
      step: this.stepCount, time: this.time, cameraX: this.cameraX,
      y: this.player.y, vy: this.player.vy, hold: this.player.thrusting, hitId: this.hitId,
      clearance: Number.isFinite(c) ? c : null,
    };
  }

  /** one fixed step without building a frame; rollouts call this in tight loops */
  advance(hold: boolean): void {
    if (this.hitId !== null) return;
    // same order as Game: speed is read from the camera position before the player moves
    const speed = this.speedAt(this.cameraX);
    this.player.update(this.cfg.fixedDt, hold);
    this.cameraX += speed * this.cfg.fixedDt;
    this.time += this.cfg.fixedDt;
    this.stepCount++;
    this.hitId = this.collide();
  }

  step(hold: boolean): TraceFrame {
    this.advance(hold);
    return this.frame();
  }

  /** first overlapping obstacle id in array order: the same broad phase and strict AABB test as Collision.ts */
  private collide(): number | null {
    const cfg = this.cfg;
    const px = cfg.playerScreenX;
    const pw = cfg.playerWidth;
    const py = this.player.y;
    const ph = cfg.playerHeight;
    for (const o of this.solids) {
      const sx = o.x0 - this.cameraX;
      if (sx + o.w < px || sx > px + pw) continue;
      for (const p of o.parts) {
        const x = p.x0 - this.cameraX;
        const y = p.moving ? p.y + Math.sin(this.time * p.speed * 0.02 + p.phase) * p.amp : p.y;
        if (x < px + pw && x + p.w > px && py < y + p.h && py + ph > y) return o.id;
      }
    }
    return null;
  }

  /** smallest vertical gap to a solid that overlaps the player horizontally; Infinity when none does */
  clearance(): number {
    const cfg = this.cfg;
    const px = cfg.playerScreenX;
    const pw = cfg.playerWidth;
    const py = this.player.y;
    const ph = cfg.playerHeight;
    let best = Infinity;
    for (const o of this.solids) {
      for (const p of o.parts) {
        const x = p.x0 - this.cameraX;
        if (x < px + pw && x + p.w > px) {
          const y = p.moving ? p.y + Math.sin(this.time * p.speed * 0.02 + p.phase) * p.amp : p.y;
          const c = Math.max(0, y - py - ph, py - y - p.h);
          if (c < best) best = c;
        }
      }
    }
    return best;
  }
}

/** fixed steps for the camera to travel from one position to another under the live speed rule */
export function cameraStepsBetween(fromCameraX: number, toCameraX: number, speedAt: (x: number) => number, dt: number, maxSteps = 100000): number {
  let x = fromCameraX;
  let n = 0;
  while (x < toCameraX && n < maxSteps) {
    x += speedAt(x) * dt;
    n++;
  }
  return n;
}

/** camera position after that many steps; with cameraStepsBetween this reproduces the live camera sequence exactly */
export function cameraAfterSteps(fromCameraX: number, steps: number, speedAt: (x: number) => number, dt: number): number {
  let x = fromCameraX;
  for (let i = 0; i < steps; i++) x += speedAt(x) * dt;
  return x;
}

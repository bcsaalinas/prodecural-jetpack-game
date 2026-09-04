/**
 * vertical player state and corridor contact response
 * horizontal progress belongs to Camera, not Player
 */

import type { GameplayConfig } from "../config/gameplayConfig.js";
import { integrateVertical, type VerticalState } from "./Physics.js";
import type { World } from "./World.js";

export enum PlayerState {
  FALLING = "FALLING",
  THRUSTING = "THRUSTING",
  FLOOR_CONTACT = "FLOOR_CONTACT",
  CEILING_CONTACT = "CEILING_CONTACT",
}

export interface AABB {
  x: number;
  y: number;
  w: number;
  h: number;
}

export class Player implements VerticalState {
  y = 0;
  vy = 0;
  ay = 0;
  thrusting = false;
  state: PlayerState = PlayerState.FALLING;

  constructor(private cfg: GameplayConfig, private world: World) {
    this.reset();
  }

  reset(): void {
    this.y = (this.world.ceilingY() + this.world.floorY()) / 2 - this.cfg.playerHeight / 2;
    this.vy = this.cfg.startVelocityY;
    this.ay = 0;
    this.thrusting = false;
    this.state = PlayerState.FALLING;
  }

  /** one fixed physics step with the current input state */
  update(dt: number, thrustHeld: boolean): void {
    this.thrusting = thrustHeld;

    integrateVertical(this, this.cfg, dt);

    // clamp and clear inward velocity so floor and ceiling contacts stay stable
    const minY = this.world.ceilingY();
    const maxY = this.world.floorY() - this.cfg.playerHeight;

    let contact: PlayerState | null = null;
    if (this.y <= minY) {
      this.y = minY;
      if (this.vy < 0) this.vy = 0;
      contact = PlayerState.CEILING_CONTACT;
    } else if (this.y >= maxY) {
      this.y = maxY;
      if (this.vy > 0) this.vy = 0;
      contact = PlayerState.FLOOR_CONTACT;
    }

    // contact stays active only while input or gravity keeps pushing into that surface
    if (contact === PlayerState.FLOOR_CONTACT && this.vy === 0 && !thrustHeld) {
      this.state = PlayerState.FLOOR_CONTACT;
    } else if (contact === PlayerState.CEILING_CONTACT && thrustHeld) {
      this.state = PlayerState.CEILING_CONTACT;
    } else {
      this.state = thrustHeld ? PlayerState.THRUSTING : PlayerState.FALLING;
    }
  }

  /** screen space collider with a fixed x */
  rect(): AABB {
    return {
      x: this.cfg.playerScreenX,
      y: this.y,
      w: this.cfg.playerWidth,
      h: this.cfg.playerHeight,
    };
  }

  centerX(): number { return this.cfg.playerScreenX + this.cfg.playerWidth / 2; }
  centerY(): number { return this.y + this.cfg.playerHeight / 2; }
}

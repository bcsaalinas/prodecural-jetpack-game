/** corridor geometry derived from the live config */

import { CANVAS_HEIGHT, CANVAS_WIDTH, type GameplayConfig } from "../config/gameplayConfig.js";

export class World {
  constructor(private cfg: GameplayConfig) {}

  get canvasWidth(): number { return CANVAS_WIDTH; }
  get canvasHeight(): number { return CANVAS_HEIGHT; }

  /** Y of the floor surface (top of the floor rect). */
  floorY(): number { return CANVAS_HEIGHT - this.cfg.floorHeight; }

  /** Y of the ceiling surface (bottom of the ceiling rect). */
  ceilingY(): number { return this.cfg.ceilingHeight; }

  /** Vertical space actually flyable, in px. Level design lives in here. */
  corridorHeight(): number { return this.floorY() - this.ceilingY(); }
}

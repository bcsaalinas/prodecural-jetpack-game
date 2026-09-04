/** fixed step samples used by the debug graphs */

import type { Game } from "../game/Game.js";

export interface Sample {
  t: number;     // simulation time, s
  y: number;     // player top y, px
  vy: number;    // px/s
  ay: number;    // px/s^2
  speed: number; // world scroll speed, px/s
}

export class Telemetry {
  private buf: Sample[] = [];
  readonly capacity = 480;

  sample(game: Game): void {
    this.buf.push({
      t: game.time,
      y: game.player.y,
      vy: game.player.vy,
      ay: game.player.ay,
      speed: game.worldSpeed,
    });
    if (this.buf.length > this.capacity) this.buf.shift();
  }

  clear(): void {
    this.buf.length = 0;
  }

  get samples(): readonly Sample[] {
    return this.buf;
  }

  minMax(pick: (s: Sample) => number): { min: number; max: number } {
    let min = Infinity;
    let max = -Infinity;
    for (const s of this.buf) {
      const v = pick(s);
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (min === Infinity) { min = 0; max = 1; }
    if (max - min < 1e-6) { max = min + 1; } // flat data still needs a drawable range
    return { min, max };
  }
}

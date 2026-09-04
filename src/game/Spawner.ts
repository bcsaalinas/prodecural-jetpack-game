/**
 * deterministic obstacle generation on a world distance timeline
 * geometry comes from seed and world x, while validation reads live player state
 */

import type { GameplayConfig } from "../config/gameplayConfig.js";
import { computeDifficulty, moverSpeedAt, openingAt, spacingAt } from "./Difficulty.js";
import { Obstacle, ObstacleType, type ObstaclePart } from "./Obstacle.js";
import { SeededRandom } from "./Random.js";
import { validateObstacle } from "./Validator.js";
import type { World } from "./World.js";

/** first obstacle world x leaves time to test the controls */
const FIRST_SPAWN_X = 1000;

export class Spawner {
  /** next obstacle world x, also shown in debug output */
  nextSpawnX = FIRST_SPAWN_X;
  private nextId = 1;
  private rng = new SeededRandom(1);
  /** recent validator rejections */
  rejectedLog: string[] = [];

  constructor(private cfg: GameplayConfig, private world: World) {}

  reset(seed: number): void {
    this.rng = new SeededRandom(seed);
    this.nextSpawnX = FIRST_SPAWN_X;
    this.nextId = 1;
    this.rejectedLog = [];
  }

  /** append every obstacle inside the current spawn horizon */
  update(
    cameraX: number,
    playerY: number,
    playerVy: number,
    worldSpeed: number,
    out: Obstacle[],
  ): void {
    const horizon = cameraX + this.cfg.playerScreenX + this.cfg.spawnAheadDistance;
    while (this.nextSpawnX < horizon) {
      const obs = this.generate(this.nextSpawnX);

      const v = validateObstacle(obs, playerY, playerVy, cameraX, worldSpeed, this.cfg, this.world);
      obs.possible = v.possible;
      obs.rejectReason = v.reason;
      obs.spawnReactionTime = v.reactionTime;
      if (!v.possible) {
        this.rejectedLog.push(`#${obs.id} ${obs.type} @${obs.worldX.toFixed(0)}px — ${v.reason}`);
        if (this.rejectedLog.length > 12) this.rejectedLog.shift();
        console.warn("[spawner:validator]", this.rejectedLog[this.rejectedLog.length - 1]);
      }

      out.push(obs);

      // draw spacing after geometry so frame batching does not change rng order
      const d = computeDifficulty(this.nextSpawnX - this.cfg.playerScreenX, this.cfg);
      this.nextSpawnX += Math.max(60, spacingAt(d, this.cfg, this.rng));
    }
  }

  /** Distance (px) from camera until the next spawn point is reached. */
  nextSpawnIn(cameraX: number): number {
    return this.nextSpawnX - cameraX;
  }

  private generate(worldX: number): Obstacle {
    const cfg = this.cfg;
    const w = this.world;
    // world position fixes difficulty even if this obstacle spawns on a different frame
    const d = computeDifficulty(worldX - cfg.playerScreenX, cfg);

    const type = this.rng.pickWeighted({
      GATE: 3,
      BLOCK_TOP: 2,
      BLOCK_BOTTOM: 2,
      FLOATING: 1.5,
      MOVING: d > 0.1 ? 1 : 0, // movers appear once the run has some speed
    } as Record<ObstacleType, number>);

    const ceil = w.ceilingY();
    const floor = w.floorY();
    const corridor = floor - ceil;
    const W = cfg.obstacleWidth;
    const id = this.nextId++;

    switch (type) {
      case ObstacleType.GATE: {
        const margin = 40;
        const opening = Math.min(openingAt(d, cfg, this.rng), corridor - margin * 2);
        const cMin = ceil + margin + opening / 2;
        const cMax = floor - margin - opening / 2;
        const center = cMax > cMin ? this.rng.range(cMin, cMax) : (ceil + floor) / 2;
        const gapTop = center - opening / 2;
        const gapBottom = center + opening / 2;
        const parts: ObstaclePart[] = [];
        if (gapTop - ceil > 0) parts.push({ dx: 0, y: ceil, w: W, h: gapTop - ceil });
        if (floor - gapBottom > 0) parts.push({ dx: 0, y: gapBottom, w: W, h: floor - gapBottom });
        return new Obstacle(id, type, worldX, W, parts, gapTop, gapBottom);
      }
      case ObstacleType.BLOCK_TOP: {
        const h = corridor * this.rng.range(0.25, 0.5);
        return new Obstacle(id, type, worldX, W, [{ dx: 0, y: ceil, w: W, h }]);
      }
      case ObstacleType.BLOCK_BOTTOM: {
        const h = corridor * this.rng.range(0.25, 0.5);
        return new Obstacle(id, type, worldX, W, [{ dx: 0, y: floor - h, w: W, h }]);
      }
      case ObstacleType.FLOATING: {
        const h = this.rng.range(50, 110);
        const y = this.rng.range(ceil + corridor * 0.2, floor - corridor * 0.2 - h);
        return new Obstacle(id, type, worldX, W, [{ dx: 0, y, w: W, h }]);
      }
      case ObstacleType.MOVING: {
        const h = this.rng.range(40, 80);
        // keep both movement extremes inside the corridor
        const ampMax = Math.max(0, corridor / 2 - h / 2 - 20);
        const amp = Math.min(cfg.movingHazardAmplitude, ampMax);
        const baseY = this.rng.range(ceil + h + amp, floor - h - amp);
        return new Obstacle(id, type, worldX, W, [{ dx: 0, y: baseY, w: W, h }], null, null, {
          baseY,
          amplitude: amp,
          speed: moverSpeedAt(d, cfg),
          phase: this.rng.range(0, Math.PI * 2),
        });
      }
    }
  }
}

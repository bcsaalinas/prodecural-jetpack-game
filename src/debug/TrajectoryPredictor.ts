/**
 * projects game trajectories into screen space for debug drawing
 * predicted hits assume world speed stays constant during the preview
 */

import { Game } from "../game/Game.js";
import { simulatePath } from "../game/Trajectory.js";

export interface ScreenPoint {
  x: number;
  y: number;
}

export const PREDICTION_SECONDS = 1.6;

export function predictScreenPath(game: Game, thrusting: boolean): ScreenPoint[] {
  const cfg = game.cfg;
  const pts = simulatePath(
    game.player.y,
    game.player.vy,
    thrusting,
    PREDICTION_SECONDS,
    cfg,
    game.world,
  );
  return pts.map((p) => ({ x: cfg.playerScreenX + game.worldSpeed * p.t, y: p.y }));
}

export interface PredictedHit {
  obstacleId: number;
  x: number;
  y: number;
}

export function predictedHit(game: Game): PredictedHit | null {
  const cfg = game.cfg;
  const path = simulatePath(
    game.player.y,
    game.player.vy,
    game.player.thrusting, // preview the current input choice
    3,
    cfg,
    game.world,
  );
  if (path.length === 0) return null;

  for (const obs of game.obstacles) {
    const t = obs.timeToPlayer(game.camera.x, cfg.playerScreenX, cfg.playerWidth, game.worldSpeed);
    if (t <= 0 || t > 3) continue;
    const idx = Math.min(path.length - 1, Math.max(0, Math.round(t / cfg.fixedDt) - 1));
    const y = path[idx].y;
    // at arrival time only vertical overlap is left to test
    for (const r of obs.getRects(game.camera.x, game.time + t)) {
      if (y < r.y + r.h && y + cfg.playerHeight > r.y) {
        return { obstacleId: obs.id, x: cfg.playerScreenX, y };
      }
    }
  }
  return null;
}

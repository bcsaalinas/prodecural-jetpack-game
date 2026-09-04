/**
 * owns simulation state and the fixed step order
 * ready -> running -> paused or dead, and restart always returns to ready
 */

import type { GameplayConfig } from "../config/gameplayConfig.js";
import { Camera } from "./Camera.js";
import { findCollision } from "./Collision.js";
import { computeDifficulty, worldSpeedAt } from "./Difficulty.js";
import { Input } from "./Input.js";
import { Obstacle } from "./Obstacle.js";
import { Player } from "./Player.js";
import { Spawner } from "./Spawner.js";
import { World } from "./World.js";

export enum GameState {
  READY = "READY",
  RUNNING = "RUNNING",
  PAUSED = "PAUSED",
  DEAD = "DEAD",
}

export interface DeathInfo {
  obstacleId: number;
  obstacleType: string;
  playerVy: number;
  worldSpeed: number;
  distance: number;
  difficulty: number;
  spawnReactionTime: number;
}

/** debug layers controlled by F1 through F5 */
export interface DebugFlags {
  overlay: boolean;
  colliders: boolean;
  vectors: boolean;
  trajectory: boolean;
  telemetry: boolean;
}

export class Game {
  readonly world: World;
  readonly camera = new Camera();
  readonly player: Player;
  readonly spawner: Spawner;
  readonly input = new Input();

  obstacles: Obstacle[] = [];
  state: GameState = GameState.READY;
  private resumedFrom: GameState = GameState.READY;

  time = 0;
  difficulty = 0;
  worldSpeed = 0;
  deathInfo: DeathInfo | null = null;

  /** fixed steps executed in this run */
  stepCount = 0;

  debug: DebugFlags = {
    overlay: true,
    colliders: true,
    vectors: true,
    trajectory: false,
    telemetry: false,
  };

  constructor(readonly cfg: GameplayConfig) {
    this.world = new World(cfg);
    this.player = new Player(cfg, this.world);
    this.spawner = new Spawner(cfg, this.world);
    this.restart(cfg.seed);
  }

  /** reset all run state with the given seed */
  restart(seed: number = this.cfg.seed): void {
    this.cfg.seed = seed;
    this.camera.x = 0;
    this.time = 0;
    this.difficulty = 0;
    this.worldSpeed = this.cfg.worldStartSpeed;
    this.obstacles = [];
    this.deathInfo = null;
    this.stepCount = 0;
    this.player.reset();
    this.input.reset();
    this.spawner.reset(seed);
    this.state = GameState.READY;
  }

  restartWithRandomSeed(): number {
    // Math.random only picks a new seed and never builds obstacle geometry
    const seed = (Math.random() * 0x7fffffff) | 0;
    this.restart(seed);
    return seed;
  }

  togglePause(): void {
    if (this.state === GameState.PAUSED) {
      this.state = this.resumedFrom;
    } else if (this.state === GameState.RUNNING || this.state === GameState.READY) {
      this.resumedFrom = this.state;
      this.state = GameState.PAUSED;
    }
  }

  /** pause if needed and advance one fixed step */
  stepOnce(): void {
    if (this.state === GameState.RUNNING) {
      this.resumedFrom = GameState.RUNNING;
      this.state = GameState.PAUSED;
    }
    if (this.state === GameState.PAUSED) this.simulate(this.cfg.fixedDt);
  }

  /** normal fixed step entry used by main */
  step(dt: number): void {
    if (this.state !== GameState.RUNNING && this.state !== GameState.READY) return;
    this.simulate(dt);
  }

  private simulate(dt: number): void {
    // 1 input
    this.input.update(dt);
    const thrustHeld = this.input.isDown;

    // ready keeps the world still until the first held input
    if (this.state === GameState.READY) {
      if (!thrustHeld) return;
      this.state = GameState.RUNNING;
    }

    // 2 difficulty and world speed
    this.difficulty = computeDifficulty(this.camera.x, this.cfg);
    this.worldSpeed = worldSpeedAt(this.difficulty, this.cfg);

    // 3 player physics
    this.player.update(dt, thrustHeld);

    // 4 world scroll
    this.camera.x += this.worldSpeed * dt;
    this.time += dt;

    // 5 spawn and cleanup
    this.spawner.update(this.camera.x, this.player.y, this.player.vy, this.worldSpeed, this.obstacles);
    if (this.obstacles.length > 0 && this.obstacles[0].isGone(this.camera.x)) {
      // obstacles are ordered by world x, so only the first one can expire
      this.obstacles.shift();
    }

    // 6 hazard collision and state update
    const hit = findCollision(this.player.rect(), this.obstacles, this.camera.x, this.time);
    if (hit) {
      this.state = GameState.DEAD;
      this.deathInfo = {
        obstacleId: hit.obstacle.id,
        obstacleType: hit.obstacle.type,
        playerVy: this.player.vy,
        worldSpeed: this.worldSpeed,
        distance: this.camera.x,
        difficulty: this.difficulty,
        spawnReactionTime: hit.obstacle.spawnReactionTime,
      };
    }

    this.stepCount++;
  }
}

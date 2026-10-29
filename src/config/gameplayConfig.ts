/**
 * live gameplay values used by the panel and the simulation
 *
 * time uses seconds and distance uses pixels
 * canvas y points down, so gravity is positive and upward values are negative
 */

export interface GameplayConfig {
  // vertical physics
  /** downward acceleration in px/s^2 */
  gravity: number;
  /**
   * upward acceleration added while input is held
   * abs(thrust) must be greater than gravity for the player to rise
   */
  thrustAcceleration: number;
  /** upward velocity limit in px/s, stored as a negative value */
  maxRiseSpeed: number;
  /** downward terminal velocity in px/s */
  maxFallSpeed: number;
  /** vertical velocity used on restart */
  startVelocityY: number;
  /**
   * exponential velocity damping in 1/s
   * zero disables it, nonzero values soften both directions
   */
  linearDamping: number;

  // simulation
  /**
   * fixed physics step in seconds
   * rendering uses a separate frame rate through the accumulator in main
   */
  fixedDt: number;

  // world scroll
  /** scroll speed at difficulty zero */
  worldStartSpeed: number;
  /** scroll speed at difficulty one */
  worldMaxSpeed: number;
  /**
   * distance used to move difficulty from zero to one
   */
  difficultyDistance: number;

  // player and corridor
  playerWidth: number;
  playerHeight: number;
  /** floor collider height */
  floorHeight: number;
  /** ceiling collider height */
  ceilingHeight: number;
  /** fixed player screen x */
  playerScreenX: number;

  // obstacles
  /** world distance used as the spawn horizon */
  spawnAheadDistance: number;
  /** obstacle spacing at difficulty one */
  minSpacing: number;
  /** obstacle spacing at difficulty zero */
  maxSpacing: number;
  /** extra breathing time after every third obstacle; zero disables local pacing */
  recoveryTime: number;
  /** gate gap height at difficulty one */
  openingMin: number;
  /** gate gap height at difficulty zero */
  openingMax: number;
  obstacleWidth: number;
  /** moving hazard speed before difficulty scaling */
  movingHazardSpeed: number;
  /** moving hazard vertical amplitude */
  movingHazardAmplitude: number;
  /**
   * minimum warning time used by the validator
   */
  minReactionTime: number;

  // encounter search (agent evaluated procedural generation)
  /** 0 = weighted baseline spawner, 1 = evolutionary encounter search; restart to apply */
  encounterMode: number;
  /** candidates evaluated per generation */
  searchPopulation: number;
  /** generations per encounter; population × generations is the fixed evaluation budget */
  searchGenerations: number;
  /** feasible elites copied unchanged into the next generation */
  searchElites: number;
  /** wall-clock milliseconds of search work allowed per rendered frame; latency only, never the result */
  searchFrameBudgetMs: number;
  /** plausible incoming (y, vy) states tested per candidate */
  entryStateCount: number;
  /** fraction of entry states that must have a collision-free path */
  entryCoverage: number;
  /** seconds each HOLD or RELEASE lasts in the feasibility search; the minimum control duration */
  feasibilityInterval: number;
  /** merged (y, vy) states kept per feasibility layer; bounds the work per entry state */
  feasibilityMaxStates: number;
  /** minimum seconds between consecutive obstacle fronts inside an encounter */
  minObstacleGapTime: number;
  /** minimum vertical clearance of the feasibility witness, px */
  minClearance: number;
  /** clearance below this counts as pressure in the rhythm measurements, px */
  tightClearance: number;

  /** seed for obstacle generation */
  seed: number;
}

/** balanced values used on first load and reset */
export function defaultConfig(): GameplayConfig {
  return {
    gravity: 1450,
    thrustAcceleration: -2600,
    maxRiseSpeed: -620,
    maxFallSpeed: 900,
    startVelocityY: 0,
    linearDamping: 0,

    fixedDt: 1 / 60,

    worldStartSpeed: 320,
    worldMaxSpeed: 760,
    difficultyDistance: 12000,

    playerWidth: 34,
    playerHeight: 44,
    floorHeight: 56,
    ceilingHeight: 24,
    playerScreenX: 180,

    spawnAheadDistance: 1300,
    minSpacing: 260,
    maxSpacing: 620,
    recoveryTime: 0.75,
    openingMin: 150,
    openingMax: 260,
    obstacleWidth: 60,
    movingHazardSpeed: 90,
    movingHazardAmplitude: 90,
    minReactionTime: 0.8,

    encounterMode: 1,
    searchPopulation: 8,
    searchGenerations: 3,
    searchElites: 2,
    searchFrameBudgetMs: 6,
    entryStateCount: 5,
    entryCoverage: 0.8,
    feasibilityInterval: 0.1,
    feasibilityMaxStates: 120,
    minObstacleGapTime: 0.3,
    minClearance: 10,
    tightClearance: 24,

    seed: 12345,
  };
}

/** canvas size is not part of the live gameplay config */
export const CANVAS_WIDTH = 960;
export const CANVAS_HEIGHT = 600;

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

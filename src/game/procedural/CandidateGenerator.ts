import { clamp, type GameplayConfig } from "../../config/gameplayConfig.js";
import { Obstacle, ObstacleType, type ObstaclePart } from "../Obstacle.js";
import { SeededRandom } from "../Random.js";
import { World } from "../World.js";
import { EncounterSimulation, type Candidate } from "./Encounter.js";

const PATTERNS = [
  { name: "CLIMB → RECOVERY → DIVE", targets: [0.3, 0.3, 0.7],
    types: [ObstacleType.BLOCK_BOTTOM, ObstacleType.GATE, ObstacleType.BLOCK_TOP] },
  { name: "DIVE → RECOVERY → CLIMB", targets: [0.7, 0.7, 0.3],
    types: [ObstacleType.BLOCK_TOP, ObstacleType.GATE, ObstacleType.BLOCK_BOTTOM] },
  { name: "PRECISION → RECOVERY → REVERSAL", targets: [0.4, 0.6, 0.35],
    types: [ObstacleType.GATE, ObstacleType.GATE, ObstacleType.GATE] },
];

export function validateLabConfig(cfg: GameplayConfig): void {
  if (Object.values(cfg).some((v) => !Number.isFinite(v)) || cfg.fixedDt < 1 / 240 || cfg.fixedDt > 1 / 20) {
    throw new Error("Candidate lab requires finite values and a timestep between 1/240 and 1/20 s.");
  }
  const world = new World(cfg);
  if (cfg.worldStartSpeed < 50 || cfg.worldStartSpeed > 1600 || cfg.maxSpacing < 80 || cfg.maxSpacing > 1600 ||
    cfg.recoveryTime < 0 || cfg.recoveryTime > 2 || cfg.playerWidth <= 0 || cfg.playerHeight <= 0 ||
    cfg.obstacleWidth < 10 || cfg.obstacleWidth > 300 || cfg.playerScreenX < 0 || cfg.playerScreenX > 600 ||
    cfg.floorHeight < 0 || cfg.ceilingHeight < 0 || world.corridorHeight() < cfg.playerHeight + 40 ||
    cfg.maxRiseSpeed >= 0 || cfg.maxFallSpeed <= 0 || cfg.gravity <= 0 || cfg.thrustAcceleration >= -cfg.gravity) {
    throw new Error("Use a flyable corridor, positive speed/gravity, upward net thrust, and normal lab geometry bounds.");
  }
  if (cfg.worldStartSpeed * cfg.fixedDt >= cfg.obstacleWidth + cfg.playerWidth) {
    throw new Error("Horizontal travel per step could skip an entire collider. Reduce timestep/speed or widen colliders before constructing candidates.");
  }
}

/** Bounded first experiment: enumerate 3 authored phrases × 2 parameter
 * alternatives. Each candidate owns a seed stream; evaluation order cannot
 * change its geometry. This is an inspectable grammar expansion, not evolution. */
export function generateCandidates(source: GameplayConfig, seed: number): Candidate[] {
  validateLabConfig(source);
  const cfg = { ...source, seed: seed >>> 0 };
  const world = new World(cfg);
  const speed = cfg.worldStartSpeed;
  const candidates: Candidate[] = [];
  for (let patternIndex = 0; patternIndex < PATTERNS.length; patternIndex++) {
    for (let variant = 0; variant < 2; variant++) {
      const index = patternIndex * 2 + variant + 1;
      const pattern = PATTERNS[patternIndex];
      const rng = new SeededRandom((seed ^ Math.imul(index, 0x9e3779b9)) >>> 0);
      const spacing = cfg.maxSpacing * [0.9, 1.1][variant];
      const recoveryDistance = speed * cfg.recoveryTime;
      const clearance = [20, 40][variant];
      const targetFractions = pattern.targets.map((f) => clamp(f + [-0.05, 0, 0.05][rng.int(0, 2)], 0.2, 0.8));
      const firstX = cfg.playerScreenX + cfg.playerWidth + speed * 1.3;
      const xs = [firstX, firstX + spacing, firstX + spacing * 2 + recoveryDistance];
      const endX = xs[2] + cfg.obstacleWidth + speed * 0.3;
      const durationSteps = Math.ceil((endX - cfg.playerScreenX) / speed / cfg.fixedDt);
      if (durationSteps > 4096) throw new Error("Encounter exceeds the 4096-step development budget; increase speed or reduce spacing.");

      // First construct a control witness with actual player physics. Carve each
      // solid around its full crossing envelope, not one instantaneous y value.
      // The independent agent never reads these controls or targets.
      const construction = new EncounterSimulation(cfg, []);
      const witness = [construction.frame()];
      for (let i = 0; i < durationSteps; i++) {
        const upcoming = xs.findIndex((x) => x + cfg.obstacleWidth >= construction.cameraX + cfg.playerScreenX);
        const fraction = targetFractions[upcoming < 0 ? 2 : upcoming];
        const targetY = world.ceilingY() + fraction * (world.corridorHeight() - cfg.playerHeight);
        // Velocity lookahead brakes before reaching the target; it is only a
        // construction policy, not an oracle for the beam-search playing agent.
        witness.push(construction.step(construction.player.y + construction.player.vy * 0.22 > targetY));
      }

      const obstacles = xs.map((x, i) => {
        const crossing = witness.filter((f) => x < f.cameraX + cfg.playerScreenX + cfg.playerWidth &&
          x + cfg.obstacleWidth > f.cameraX + cfg.playerScreenX);
        const top = Math.max(world.ceilingY(), Math.min(...crossing.map((f) => f.y)) - clearance);
        const bottom = Math.min(world.floorY(), Math.max(...crossing.map((f) => f.y + cfg.playerHeight)) + clearance);
        const parts: ObstaclePart[] = [];
        const type = pattern.types[i];
        if (type !== ObstacleType.BLOCK_BOTTOM && top > world.ceilingY()) {
          parts.push({ dx: 0, y: world.ceilingY(), w: cfg.obstacleWidth, h: top - world.ceilingY() });
        }
        if (type !== ObstacleType.BLOCK_TOP && bottom < world.floorY()) {
          parts.push({ dx: 0, y: bottom, w: cfg.obstacleWidth, h: world.floorY() - bottom });
        }
        const gapTop = type === ObstacleType.BLOCK_BOTTOM ? world.ceilingY() : top;
        const gapBottom = type === ObstacleType.BLOCK_TOP ? world.floorY() : bottom;
        return new Obstacle(i + 1, type, x, cfg.obstacleWidth, parts, gapTop, gapBottom);
      });
      // Re-record the witness against the real solids so every frame carries
      // its clearance and the stored witness equals an exact replay.
      const check = new EncounterSimulation(cfg, obstacles);
      const verified = [check.frame()];
      for (const frame of witness.slice(1)) verified.push(check.step(frame.hold));
      const empty = obstacles.find((o) => o.getRects(0, 0).length === 0);
      const rejection = empty ? `Obstacle #${empty.id} has no solid geometry at these settings.` :
        check.hitId !== null ? `Construction witness hit obstacle #${check.hitId}.` : null;
      candidates.push({
        id: `C${String(index).padStart(2, "0")}`, seed: cfg.seed, cfg: { ...cfg },
        derivation: ["<Encounter> → <Pattern> <Recovery> <Pattern>",
          `<Pattern> expansion → ${pattern.name}`,
          `Terminals → ${pattern.types.join(" → ")} (LARGE_SPACING before #3)`,
          `Variant ${variant + 1} → spacing ×${[0.9, 1.1][variant]}, clearance ${clearance}px`,
          "Geometry → carve the full fixed-step crossing envelope + clearance",
          "Construction check → replay witness with the real collision tests"],
        parameters: { spacing, recoveryDistance, clearance, targetFractions },
        obstacles, durationSteps, witness: verified, rejection,
      });
    }
  }
  return candidates;
}

/**
 * encounter genome: a short ordered list of obstacle genes plus the operators
 * evolution applies to it
 *
 * Genes store corridor fractions instead of pixels so a genome keeps its
 * meaning when the corridor, player size, or opening tuning change. Physics,
 * controls, collision, and fairness limits are authored and never part of the
 * genome: the search explores level geometry inside legal bounds, it does not
 * explore the rules.
 */

import { clamp, lerp, type GameplayConfig } from "../../config/gameplayConfig.js";
import { Obstacle, ObstacleType, type ObstaclePart } from "../Obstacle.js";
import type { SeededRandom } from "../Random.js";
import type { World } from "../World.js";
import type { PacingTarget } from "./Pacing.js";

/** semantic demand a gene places on the player; derived from type and geometry */
export type Demand = "CLIMB" | "DIVE" | "PRECISION" | "CHOICE" | "TIMING" | "RECOVERY" | "NEUTRAL";

export interface ObstacleGene {
  type: ObstacleType;
  demand: Demand;
  /** px from the previous obstacle front; the first gene sits at the encounter start, so its spacing is unused */
  spacing: number;
  /** corridor fraction (0 = ceiling, 1 = floor): gate gap center or body center */
  center: number;
  /** corridor fraction left free: gate gap height, or the open side next to a block */
  opening: number;
  /** corridor fraction: floating or moving body height */
  size: number;
  /** phase rate for MovingSpec.speed */
  moverSpeed: number;
  /** corridor fraction of vertical travel each way */
  moverAmplitude: number;
  /** radians */
  moverPhase: number;
}

export type GenomeOrigin = "motif" | "random" | "mutation" | "crossover" | "fallback";

export interface Genome {
  id: string;
  genes: ObstacleGene[];
  parentIds: string[];
  origin: GenomeOrigin;
  /** human readable operator log, newest last */
  history: string[];
}

/** legal ranges; mutations may explore all of them, initialization uses a narrower difficulty-controlled slice */
export interface GeneBounds {
  spacing: [number, number];
  gateOpening: [number, number];
  blockOpening: [number, number];
  floatSize: [number, number];
  moverSize: [number, number];
  amplitude: [number, number];
  moverSpeed: [number, number];
  centerMargin: number;
  length: [number, number];
}

export function legalBounds(cfg: GameplayConfig, world: World): GeneBounds {
  const corridor = world.corridorHeight();
  // the smallest passable free space is the player plus clearance on both sides
  const minFree = (cfg.playerHeight + 2 * cfg.minClearance) / corridor;
  return {
    spacing: [Math.max(80, cfg.minSpacing * 0.6), cfg.maxSpacing * 1.5],
    gateOpening: [Math.min(0.9, minFree * 1.1), 0.85],
    blockOpening: [Math.min(0.9, minFree * 1.2), 0.85],
    floatSize: [0.06, 0.3],
    moverSize: [0.06, 0.2],
    amplitude: [0.04, 0.3],
    moverSpeed: [30, 240],
    centerMargin: 0.03,
    length: [2, 4],
  };
}

/** difficulty-controlled initialization slice of the legal bounds */
export interface InitRanges {
  spacing: [number, number];
  gateOpening: [number, number];
  blockOpening: [number, number];
}

export function initRanges(cfg: GameplayConfig, world: World, bounds: GeneBounds, target: PacingTarget): InitRanges {
  // the phase spends only part of the global budget: WARMUP and RECOVERY stay generous late in a run
  const d = target.difficulty * target.budgetScale;
  const corridor = world.corridorHeight();
  const spacing = lerp(cfg.maxSpacing, cfg.minSpacing, d) * target.spacingScale;
  const gate = (lerp(cfg.openingMax, cfg.openingMin, d) / corridor) * target.openingScale;
  const block = lerp(0.72, 0.5, d) * target.openingScale;
  const within = (lo: number, hi: number, b: [number, number]): [number, number] =>
    [clamp(lo, b[0], b[1]), clamp(hi, b[0], b[1])];
  return {
    spacing: within(spacing * 0.85, spacing * 1.15, bounds.spacing),
    gateOpening: within(gate * 0.95, gate * 1.05, bounds.gateOpening),
    blockOpening: within(block * 0.95, block * 1.05, bounds.blockOpening),
  };
}

/** the demand is a function of geometry so mutations can never leave a stale label */
export function demandOf(g: ObstacleGene): Demand {
  switch (g.type) {
    case ObstacleType.BLOCK_BOTTOM: return "CLIMB";
    case ObstacleType.BLOCK_TOP: return "DIVE";
    case ObstacleType.FLOATING: return "CHOICE";
    case ObstacleType.MOVING: return "TIMING";
    case ObstacleType.GATE:
      if (g.opening >= 0.6) return "RECOVERY";
      if (g.center <= 0.38) return "CLIMB";
      if (g.center >= 0.62) return "DIVE";
      return g.opening <= 0.42 ? "PRECISION" : "NEUTRAL";
  }
}

/** vertical lane the gene asks for: H = near the ceiling, L = near the floor */
export function laneOf(g: ObstacleGene): "H" | "M" | "L" {
  if (g.type === ObstacleType.BLOCK_BOTTOM) return "H";
  if (g.type === ObstacleType.BLOCK_TOP) return "L";
  return g.center <= 0.38 ? "H" : g.center >= 0.62 ? "L" : "M";
}

export function dominantDemand(genome: Genome): Demand {
  const counts = new Map<Demand, number>();
  for (const g of genome.genes) counts.set(g.demand, (counts.get(g.demand) ?? 0) + 1);
  let best: Demand = genome.genes[0]?.demand ?? "NEUTRAL";
  let bestCount = -1;
  for (const [demand, count] of counts) if (count > bestCount) { best = demand; bestCount = count; }
  return best;
}

/** symbolic phrase, for example CLIMB → DIVE (REVERSAL) */
export function phraseOf(genome: Genome): string {
  const demands = genome.genes.map((g) => g.demand);
  const reversal = demands.some((d, i) => i > 0 &&
    ((d === "CLIMB" && demands[i - 1] === "DIVE") || (d === "DIVE" && demands[i - 1] === "CLIMB")));
  return demands.join(" → ") + (reversal ? " (REVERSAL)" : "");
}

/** clamp every field into its legal range for the gene type and refresh the demand */
export function repairGene(g: ObstacleGene, bounds: GeneBounds): ObstacleGene {
  const r = { ...g };
  r.spacing = clamp(r.spacing, bounds.spacing[0], bounds.spacing[1]);
  r.moverSpeed = clamp(r.moverSpeed, bounds.moverSpeed[0], bounds.moverSpeed[1]);
  r.moverAmplitude = clamp(r.moverAmplitude, bounds.amplitude[0], bounds.amplitude[1]);
  r.moverPhase = ((r.moverPhase % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const m = bounds.centerMargin;
  switch (r.type) {
    case ObstacleType.GATE:
      r.opening = clamp(r.opening, bounds.gateOpening[0], bounds.gateOpening[1]);
      r.size = clamp(r.size, bounds.floatSize[0], bounds.floatSize[1]);
      r.center = clamp(r.center, r.opening / 2 + m, 1 - r.opening / 2 - m);
      break;
    case ObstacleType.BLOCK_TOP:
    case ObstacleType.BLOCK_BOTTOM:
      r.opening = clamp(r.opening, bounds.blockOpening[0], bounds.blockOpening[1]);
      r.size = clamp(r.size, bounds.floatSize[0], bounds.floatSize[1]);
      r.center = clamp(r.center, 0.2, 0.8);
      break;
    case ObstacleType.FLOATING:
      r.size = clamp(r.size, bounds.floatSize[0], bounds.floatSize[1]);
      r.opening = clamp(r.opening, bounds.gateOpening[0], bounds.gateOpening[1]);
      r.center = clamp(r.center, r.size / 2 + m, 1 - r.size / 2 - m);
      break;
    case ObstacleType.MOVING:
      r.size = clamp(r.size, bounds.moverSize[0], bounds.moverSize[1]);
      r.opening = clamp(r.opening, bounds.gateOpening[0], bounds.gateOpening[1]);
      r.center = clamp(r.center, r.size / 2 + r.moverAmplitude + m, 1 - r.size / 2 - r.moverAmplitude - m);
      break;
  }
  r.demand = demandOf(r);
  return r;
}

export function repairGenome(genome: Genome, bounds: GeneBounds): Genome {
  const genes = genome.genes.slice(0, bounds.length[1]).map((g) => repairGene(g, bounds));
  return { ...genome, genes };
}

/** pick among keys with positive weight only, so a zero weight can never be chosen */
function pickType(rng: SeededRandom, target: PacingTarget): ObstacleType {
  const weights: Array<[ObstacleType, number]> = [
    [ObstacleType.GATE, 3], [ObstacleType.BLOCK_TOP, 2], [ObstacleType.BLOCK_BOTTOM, 2],
    [ObstacleType.FLOATING, 1.5], [ObstacleType.MOVING, target.allowMoving ? 1 : 0],
  ];
  const live = weights.filter(([, w]) => w > 0);
  let roll = rng.next() * live.reduce((s, [, w]) => s + w, 0);
  for (const [type, w] of live) { roll -= w; if (roll <= 0) return type; }
  return live[live.length - 1][0];
}

/** one gene with a fixed draw order so streams stay aligned whatever the type */
export function randomGene(rng: SeededRandom, type: ObstacleType, ranges: InitRanges, bounds: GeneBounds): ObstacleGene {
  const spacing = rng.range(ranges.spacing[0], ranges.spacing[1]);
  const center = rng.range(0.2, 0.8);
  const gateOpening = rng.range(ranges.gateOpening[0], ranges.gateOpening[1]);
  const blockOpening = rng.range(ranges.blockOpening[0], ranges.blockOpening[1]);
  const sizeRange = type === ObstacleType.MOVING ? bounds.moverSize : bounds.floatSize;
  const size = rng.range(sizeRange[0], sizeRange[1]);
  const moverSpeed = rng.range(bounds.moverSpeed[0], bounds.moverSpeed[1]);
  const moverAmplitude = rng.range(bounds.amplitude[0], bounds.amplitude[1]);
  const moverPhase = rng.range(0, Math.PI * 2);
  return repairGene({
    type, demand: "NEUTRAL", spacing, center,
    opening: type === ObstacleType.GATE || type === ObstacleType.FLOATING || type === ObstacleType.MOVING ? gateOpening : blockOpening,
    size, moverSpeed, moverAmplitude, moverPhase,
  }, bounds);
}

export function randomGenome(rng: SeededRandom, target: PacingTarget, ranges: InitRanges, bounds: GeneBounds, id: string): Genome {
  const length = clamp(rng.int(target.length[0], target.length[1]), bounds.length[0], bounds.length[1]);
  const genes: ObstacleGene[] = [];
  for (let i = 0; i < length; i++) genes.push(randomGene(rng, pickType(rng, target), ranges, bounds));
  return { id, genes, parentIds: [], origin: "random", history: [`${id}: random initialization (${length} genes)`] };
}

/** concrete geometry: same part conventions as the weighted spawner so collision and drawing stay shared */
export function realizeGene(g: ObstacleGene, cfg: GameplayConfig, world: World, worldX: number, id: number): Obstacle {
  const ceil = world.ceilingY();
  const floor = world.floorY();
  const corridor = floor - ceil;
  const W = cfg.obstacleWidth;
  const parts: ObstaclePart[] = [];
  switch (g.type) {
    case ObstacleType.GATE: {
      const gap = g.opening * corridor;
      const gapTop = ceil + g.center * corridor - gap / 2;
      const gapBottom = gapTop + gap;
      if (gapTop - ceil > 0) parts.push({ dx: 0, y: ceil, w: W, h: gapTop - ceil });
      if (floor - gapBottom > 0) parts.push({ dx: 0, y: gapBottom, w: W, h: floor - gapBottom });
      return new Obstacle(id, g.type, worldX, W, parts, gapTop, gapBottom);
    }
    case ObstacleType.BLOCK_TOP: {
      const h = (1 - g.opening) * corridor;
      return new Obstacle(id, g.type, worldX, W, [{ dx: 0, y: ceil, w: W, h }]);
    }
    case ObstacleType.BLOCK_BOTTOM: {
      const h = (1 - g.opening) * corridor;
      return new Obstacle(id, g.type, worldX, W, [{ dx: 0, y: floor - h, w: W, h }]);
    }
    case ObstacleType.FLOATING: {
      const h = g.size * corridor;
      const y = clamp(ceil + g.center * corridor - h / 2, ceil, floor - h);
      return new Obstacle(id, g.type, worldX, W, [{ dx: 0, y, w: W, h }]);
    }
    case ObstacleType.MOVING: {
      const h = g.size * corridor;
      // both movement extremes must stay inside the corridor, like the weighted spawner
      const amp = Math.min(g.moverAmplitude * corridor, Math.max(0, corridor / 2 - h / 2 - 20));
      const baseY = clamp(ceil + g.center * corridor - h / 2, ceil + amp, floor - h - amp);
      return new Obstacle(id, g.type, worldX, W, [{ dx: 0, y: baseY, w: W, h }], null, null, {
        baseY, amplitude: amp, speed: g.moverSpeed, phase: g.moverPhase,
      });
    }
  }
}

export function realizeGenome(genome: Genome, cfg: GameplayConfig, world: World, startX: number, firstId: number): Obstacle[] {
  let x = startX;
  return genome.genes.map((g, i) => {
    if (i > 0) x += g.spacing;
    return realizeGene(g, cfg, world, x, firstId + i);
  });
}

/** horizontal extent of the realized obstacles, px */
export function genomeSpan(genome: Genome, cfg: GameplayConfig): number {
  let span = cfg.obstacleWidth;
  for (let i = 1; i < genome.genes.length; i++) span += genome.genes[i].spacing;
  return span;
}

const OPERATORS = ["SHIFT_CENTER", "CHANGE_SPACING", "CHANGE_OPENING", "CHANGE_SIZE", "MOVER_TIMING", "SWITCH_TYPE", "INSERT", "REMOVE", "SWAP"] as const;
export type MutationOperator = (typeof OPERATORS)[number];

/** one operator per child; every operator keeps the genome inside the legal bounds through repair */
export function mutate(parent: Genome, rng: SeededRandom, target: PacingTarget, ranges: InitRanges, bounds: GeneBounds, id: string, label: string): Genome {
  const genes = parent.genes.map((g) => ({ ...g }));
  const ops = OPERATORS.filter((op) =>
    (op !== "INSERT" || genes.length < bounds.length[1]) &&
    (op !== "REMOVE" || genes.length > bounds.length[0]) &&
    (op !== "SWAP" || genes.length > 1) &&
    (op !== "MOVER_TIMING" || genes.some((g) => g.type === ObstacleType.MOVING)));
  const op = ops[rng.int(0, ops.length - 1)];
  const i = rng.int(0, genes.length - 1);
  const f3 = (v: number) => v.toFixed(3);
  let note = "";
  switch (op) {
    case "SHIFT_CENTER": {
      const before = genes[i].center;
      genes[i].center = before + rng.range(-0.15, 0.15);
      note = `center ${f3(before)}→${f3(genes[i].center)}`;
      break;
    }
    case "CHANGE_SPACING": {
      const j = genes.length > 1 ? Math.max(1, i) : 0; // the first gene's spacing is unused
      const before = genes[j].spacing;
      genes[j].spacing = before * rng.range(0.75, 1.3);
      note = `spacing #${j + 1} ${before.toFixed(0)}→${genes[j].spacing.toFixed(0)}px`;
      break;
    }
    case "CHANGE_OPENING": {
      const before = genes[i].opening;
      genes[i].opening = before + rng.range(-0.1, 0.1);
      note = `opening ${f3(before)}→${f3(genes[i].opening)}`;
      break;
    }
    case "CHANGE_SIZE": {
      const before = genes[i].size;
      genes[i].size = before * rng.range(0.7, 1.4);
      note = `size ${f3(before)}→${f3(genes[i].size)}`;
      break;
    }
    case "MOVER_TIMING": {
      const movers = genes.map((g, k) => (g.type === ObstacleType.MOVING ? k : -1)).filter((k) => k >= 0);
      const k = movers[rng.int(0, movers.length - 1)];
      genes[k].moverPhase += rng.range(-1.2, 1.2);
      genes[k].moverSpeed *= rng.range(0.7, 1.4);
      note = `mover #${k + 1} phase ${f3(genes[k].moverPhase)} speed ${genes[k].moverSpeed.toFixed(0)}`;
      break;
    }
    case "SWITCH_TYPE": {
      const before = genes[i].type;
      const choices = [ObstacleType.GATE, ObstacleType.BLOCK_TOP, ObstacleType.BLOCK_BOTTOM, ObstacleType.FLOATING,
        ...(target.allowMoving ? [ObstacleType.MOVING] : [])].filter((t) => t !== before);
      genes[i].type = choices[rng.int(0, choices.length - 1)];
      note = `type ${before}→${genes[i].type}`;
      break;
    }
    case "INSERT": {
      const gene = randomGene(rng, pickType(rng, target), ranges, bounds);
      genes.splice(i + 1, 0, gene);
      note = `insert ${gene.type} after #${i + 1}`;
      break;
    }
    case "REMOVE": {
      note = `remove ${genes[i].type} #${i + 1}`;
      genes.splice(i, 1);
      break;
    }
    case "SWAP": {
      const j = (i + 1) % genes.length;
      [genes[i], genes[j]] = [genes[j], genes[i]];
      note = `swap #${i + 1} and #${j + 1}`;
      break;
    }
  }
  return repairGenome({
    id, genes, parentIds: [parent.id], origin: "mutation",
    history: [...parent.history, `${label}: ${op} #${i + 1} ${note}`],
  }, bounds);
}

/** splice a prefix of one parent with a suffix of another at gene boundaries */
export function crossover(a: Genome, b: Genome, rng: SeededRandom, bounds: GeneBounds, id: string, label: string): Genome {
  const cutA = rng.int(1, Math.max(1, a.genes.length - 1));
  const cutB = rng.int(1, Math.max(1, b.genes.length - 1));
  const genes = [...a.genes.slice(0, cutA), ...b.genes.slice(cutB)].map((g) => ({ ...g }));
  while (genes.length < bounds.length[0]) genes.push({ ...b.genes[b.genes.length - 1] });
  return repairGenome({
    id, genes, parentIds: [a.id, b.id], origin: "crossover",
    history: [...a.history.slice(-2), ...b.history.slice(-2), `${label}: CROSSOVER ${a.id}[0..${cutA}) + ${b.id}[${cutB}..]`],
  }, bounds);
}

/** stable key for evaluation caching: identical genes give identical evaluations */
export function genomeKey(genome: Genome): string {
  return genome.genes.map((g) =>
    `${g.type}:${g.spacing.toFixed(2)}:${g.center.toFixed(4)}:${g.opening.toFixed(4)}:${g.size.toFixed(4)}:` +
    `${g.moverSpeed.toFixed(2)}:${g.moverAmplitude.toFixed(4)}:${g.moverPhase.toFixed(4)}`).join("|");
}

/** structural signature used by the diversity archive */
export interface GenomeSignature {
  types: ObstacleType[];
  lanes: Array<"H" | "M" | "L">;
  spacingBins: number[];
  moving: number;
  demands: Demand[];
}

export function signatureOf(genome: Genome): GenomeSignature {
  return {
    types: genome.genes.map((g) => g.type),
    lanes: genome.genes.map(laneOf),
    spacingBins: genome.genes.map((g, i) => (i === 0 ? 0 : Math.round(g.spacing / 100))),
    moving: genome.genes.filter((g) => g.type === ObstacleType.MOVING).length,
    demands: genome.genes.map((g) => g.demand),
  };
}

/** 0 = identical structure, 1 = nothing in common; aligned position by position */
export function structuralDistance(a: GenomeSignature, b: GenomeSignature): number {
  const n = Math.max(a.types.length, b.types.length);
  let typeDiff = 0, laneDiff = 0, spacingDiff = 0, demandDiff = 0;
  for (let i = 0; i < n; i++) {
    if (a.types[i] !== b.types[i]) typeDiff++;
    if (a.lanes[i] !== b.lanes[i]) laneDiff++;
    if (a.spacingBins[i] !== b.spacingBins[i]) spacingDiff++;
    if (a.demands[i] !== b.demands[i]) demandDiff++;
  }
  const movingDiff = Math.min(1, Math.abs(a.moving - b.moving));
  return clamp(0.3 * (typeDiff / n) + 0.2 * (laneDiff / n) + 0.15 * (spacingDiff / n) + 0.25 * (demandDiff / n) + 0.1 * movingDiff, 0, 1);
}

/**
 * cheap constraints: geometry bounds, warning time, readable movers, phase rules,
 * and repetition caps. These reject before any simulation runs and always say why.
 */
export function cheapConstraints(
  genome: Genome,
  cfg: GameplayConfig,
  world: World,
  bounds: GeneBounds,
  target: PacingTarget,
  startX: number,
  speedAt: (cameraX: number) => number,
  recentDemands: Demand[],
): string | null {
  const n = genome.genes.length;
  if (n < bounds.length[0] || n > bounds.length[1]) return `length ${n} outside [${bounds.length[0]}, ${bounds.length[1]}]`;
  const corridor = world.corridorHeight();
  const minFree = cfg.playerHeight + 2 * cfg.minClearance;
  let x = startX;
  for (let i = 0; i < n; i++) {
    const g = genome.genes[i];
    if (i > 0) {
      x += g.spacing;
      // warning time between consecutive fronts is the local reaction budget
      const gapTime = g.spacing / speedAt(x - cfg.playerScreenX);
      if (gapTime < cfg.minObstacleGapTime) {
        return `#${i + 1} warning ${gapTime.toFixed(2)}s < min ${cfg.minObstacleGapTime.toFixed(2)}s (${g.spacing.toFixed(0)}px)`;
      }
    }
    let free = 0;
    switch (g.type) {
      case ObstacleType.GATE: free = g.opening * corridor; break;
      case ObstacleType.BLOCK_TOP:
      case ObstacleType.BLOCK_BOTTOM: free = g.opening * corridor; break;
      case ObstacleType.FLOATING: {
        const h = g.size * corridor;
        const top = g.center * corridor - h / 2;
        free = Math.max(top, corridor - top - h);
        break;
      }
      case ObstacleType.MOVING: {
        if (!target.allowMoving) return `#${i + 1} MOVING not allowed in ${target.phase}`;
        const h = g.size * corridor;
        const amp = g.moverAmplitude * corridor;
        const top = g.center * corridor - h / 2 - amp; // full sweep, conservative
        free = Math.max(top, corridor - (top + h + 2 * amp));
        // readability: one full oscillation must take longer than the local reaction budget
        const period = (Math.PI * 2) / (g.moverSpeed * 0.02);
        if (period < cfg.minObstacleGapTime * 2) return `#${i + 1} mover period ${period.toFixed(2)}s unreadable`;
        break;
      }
    }
    if (free < minFree) return `#${i + 1} ${g.type} free space ${free.toFixed(0)}px < player ${cfg.playerHeight} + 2×${cfg.minClearance}px`;
  }
  // repetition caps: three consecutive encounters of the same precision or timing demand are tiring
  const dominant = dominantDemand(genome);
  if ((dominant === "PRECISION" || dominant === "TIMING") && recentDemands.length >= 2 &&
    recentDemands.slice(-2).every((d) => d === dominant)) {
    return `third consecutive ${dominant} encounter`;
  }
  return null;
}

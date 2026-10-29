/**
 * known-safe motifs that seed the population and the verified fallback encounter
 *
 * Random initialization alone struggles to produce readable challenge phrases.
 * Motifs give the search recognizable structures (climb → recover → dive) as a
 * starting point. They are proposals, never the final selector: every motif
 * instance still passes the same feasibility gates and fitness as any mutant.
 */

import type { GameplayConfig } from "../../config/gameplayConfig.js";
import { ObstacleType } from "../Obstacle.js";
import type { SeededRandom } from "../Random.js";
import type { World } from "../World.js";
import { randomGene, repairGenome, type GeneBounds, type Genome, type InitRanges, type ObstacleGene } from "./EncounterGenome.js";
import type { PacingPhase, PacingTarget } from "./Pacing.js";

interface MotifGene {
  type: ObstacleType;
  center?: number;
  opening?: number;
  size?: number;
  /** multiplier on the initialization spacing range */
  spacingScale?: number;
}

export interface Motif {
  name: string;
  phases: PacingPhase[];
  genes: MotifGene[];
}

export const MOTIFS: Motif[] = [
  { name: "WIDE_GATES", phases: ["WARMUP", "RECOVERY"], genes: [
    { type: ObstacleType.GATE, center: 0.5, opening: 0.62 },
    { type: ObstacleType.GATE, center: 0.45, opening: 0.6, spacingScale: 1.2 } ] },
  { name: "GENTLE_CLIMB", phases: ["WARMUP", "BUILD"], genes: [
    { type: ObstacleType.BLOCK_BOTTOM, opening: 0.62 },
    { type: ObstacleType.GATE, center: 0.32, opening: 0.45, spacingScale: 1.1 } ] },
  { name: "GENTLE_DIVE", phases: ["WARMUP", "BUILD"], genes: [
    { type: ObstacleType.BLOCK_TOP, opening: 0.62 },
    { type: ObstacleType.GATE, center: 0.68, opening: 0.45, spacingScale: 1.1 } ] },
  { name: "CLIMB_RECOVER_DIVE", phases: ["BUILD", "PEAK"], genes: [
    { type: ObstacleType.BLOCK_BOTTOM, opening: 0.55 },
    { type: ObstacleType.GATE, center: 0.3, opening: 0.38 },
    { type: ObstacleType.BLOCK_TOP, opening: 0.55, spacingScale: 1.5 } ] },
  { name: "DIVE_RECOVER_CLIMB", phases: ["BUILD", "PEAK"], genes: [
    { type: ObstacleType.BLOCK_TOP, opening: 0.55 },
    { type: ObstacleType.GATE, center: 0.7, opening: 0.38 },
    { type: ObstacleType.BLOCK_BOTTOM, opening: 0.55, spacingScale: 1.5 } ] },
  { name: "REVERSAL", phases: ["BUILD", "PEAK"], genes: [
    { type: ObstacleType.GATE, center: 0.3, opening: 0.4 },
    { type: ObstacleType.GATE, center: 0.7, opening: 0.4, spacingScale: 1.25 } ] },
  { name: "PRECISION_PAIR", phases: ["PEAK"], genes: [
    { type: ObstacleType.FLOATING, center: 0.5, size: 0.16 },
    { type: ObstacleType.GATE, center: 0.5, opening: 0.34, spacingScale: 1.1 } ] },
  { name: "TIMING_GATE", phases: ["BUILD", "PEAK"], genes: [
    { type: ObstacleType.MOVING, center: 0.5, size: 0.12 },
    { type: ObstacleType.GATE, center: 0.5, opening: 0.48, spacingScale: 1.2 } ] },
  { name: "CHOICE_LANE", phases: ["BUILD"], genes: [
    { type: ObstacleType.FLOATING, center: 0.5, size: 0.2 },
    { type: ObstacleType.FLOATING, center: 0.5, size: 0.2, spacingScale: 1.1 } ] },
];

export function motifsForPhase(phase: PacingPhase, allowMoving: boolean): Motif[] {
  return MOTIFS.filter((m) => m.phases.includes(phase) &&
    (allowMoving || m.genes.every((g) => g.type !== ObstacleType.MOVING)));
}

/** a motif instance: template fractions plus small seeded jitter, inside the init ranges */
export function motifGenome(motif: Motif, rng: SeededRandom, ranges: InitRanges, bounds: GeneBounds, id: string): Genome {
  const genes: ObstacleGene[] = motif.genes.map((t) => {
    const base = randomGene(rng, t.type, ranges, bounds);
    const jitter = rng.range(-0.03, 0.03);
    return {
      ...base,
      spacing: base.spacing * (t.spacingScale ?? 1),
      center: t.center !== undefined ? t.center + jitter : base.center,
      opening: t.opening !== undefined ? t.opening + jitter : base.opening,
      size: t.size !== undefined ? t.size : base.size,
    };
  });
  return repairGenome({ id, genes, parentIds: [], origin: "motif", history: [`${id}: motif ${motif.name}`] }, bounds);
}

/** the deterministic fallback: two wide centered gates with the widest legal spacing */
export function safeFallbackGenome(cfg: GameplayConfig, world: World, bounds: GeneBounds, id: string): Genome {
  const corridor = world.corridorHeight();
  const gene = (): ObstacleGene => ({
    type: ObstacleType.GATE, demand: "RECOVERY", spacing: bounds.spacing[1], center: 0.5,
    opening: Math.min(bounds.gateOpening[1], Math.max(bounds.gateOpening[0], (cfg.playerHeight * 4) / corridor)),
    size: 0.1, moverSpeed: bounds.moverSpeed[0], moverAmplitude: bounds.amplitude[0], moverPhase: 0,
  });
  return repairGenome({ id, genes: [gene(), gene()], parentIds: [], origin: "fallback",
    history: [`${id}: verified safe fallback (wide centered gates)`] }, bounds);
}

/** initial population: motifs matching the phase first, then random legal genomes */
export function initialGenome(slot: number, rng: SeededRandom, target: PacingTarget, ranges: InitRanges, bounds: GeneBounds,
  id: string, random: (rng: SeededRandom, id: string) => Genome): Genome {
  const motifs = motifsForPhase(target.phase, target.allowMoving);
  // half the slots are motif proposals so readable phrases exist from generation 0
  if (motifs.length && slot % 2 === 0) return motifGenome(motifs[(slot / 2) % motifs.length], rng, ranges, bounds, id);
  return random(rng, id);
}

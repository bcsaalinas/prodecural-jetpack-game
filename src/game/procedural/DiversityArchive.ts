/**
 * rolling archive of recent encounter signatures for novelty and repetition control
 *
 * A single score tends to converge on one layout. Novelty is the distance from
 * the nearest recent encounter, combining structure (types, lanes, spacing,
 * demands) with behavior (how the strong agent had to fly it). It is capped at
 * 1 so meaningless pixel shifts cannot dominate, and it never overrides a
 * feasibility gate.
 */

import { clamp } from "../../config/gameplayConfig.js";
import { structuralDistance, type Demand, type GenomeSignature } from "./EncounterGenome.js";

export interface EncounterSignature {
  structure: GenomeSignature;
  /** strong agent: fraction of steps holding thrust */
  holdFraction: number;
  /** strong agent: switches per second, rounded */
  switchBin: number;
  demand: Demand;
}

export function signatureDistance(a: EncounterSignature, b: EncounterSignature): number {
  const structural = structuralDistance(a.structure, b.structure);
  const behavioral = clamp(Math.abs(a.holdFraction - b.holdFraction) * 2 + Math.abs(a.switchBin - b.switchBin) / 4, 0, 1);
  return clamp(0.7 * structural + 0.3 * behavioral, 0, 1);
}

export class DiversityArchive {
  readonly recent: EncounterSignature[] = [];

  constructor(readonly capacity = 6) {}

  push(signature: EncounterSignature): void {
    this.recent.push(signature);
    if (this.recent.length > this.capacity) this.recent.shift();
  }

  /** 1 when nothing is recent; otherwise distance to the most similar recent encounter */
  novelty(signature: EncounterSignature): number {
    if (this.recent.length === 0) return 1;
    let best = Infinity;
    for (const r of this.recent) best = Math.min(best, signatureDistance(signature, r));
    return best;
  }

  /** dominant demands of recent encounters, oldest first; used by the repetition cap */
  recentDemands(): Demand[] {
    return this.recent.map((r) => r.demand);
  }

  snapshot(): DiversityArchive {
    const copy = new DiversityArchive(this.capacity);
    for (const r of this.recent) copy.recent.push(r);
    return copy;
  }
}

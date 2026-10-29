/**
 * hierarchical deterministic seeds for encounter search
 *
 * One sequential stream is ideal while obstacles are never regenerated. Once a
 * validator rejects and resamples an encounter, a single stream makes every
 * later encounter shift because one encounter consumed extra draws. Hashing
 * (master seed, encounter index, attempt) gives each encounter, genome, and
 * attempt its own stream, so encounter 20 never changes because encounter 4
 * needed a retry, and a bug reproduces from masterSeed + encounterIndex alone.
 */

import { SeededRandom } from "../Random.js";

/** 32-bit mix of two inputs (murmur3 finalizer). Small, portable, inspectable. */
export function hash32(a: number, b: number): number {
  let h = (a >>> 0) ^ Math.imul(b >>> 0, 0x9e3779b1);
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** encounter seed = hash(masterSeed, encounterIndex) */
export function encounterSeed(masterSeed: number, encounterIndex: number): number {
  return hash32(hash32(masterSeed, 0x454e43), encounterIndex);
}

/** every genome slot in every generation owns a stream derived from the encounter seed */
export function genomeSeed(encSeed: number, generation: number, slot: number): number {
  return hash32(hash32(encSeed, 0x47454e + generation), slot);
}

/** extra attempts (fallback construction, repairs) never disturb the main streams */
export function attemptSeed(encSeed: number, attempt: number): number {
  return hash32(hash32(encSeed, 0x415454), attempt);
}

export function streamFor(seed: number): SeededRandom {
  return new SeededRandom(seed);
}

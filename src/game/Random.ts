/**
 * seeded mulberry32 random stream for repeatable obstacle generation
 * this is gameplay randomness and is not suitable for security work
 */
export class SeededRandom {
  private state: number;

  constructor(seed: number) {
    // uint32 keeps the stream portable and the fallback avoids a bad zero state
    this.state = seed >>> 0;
    if (this.state === 0) this.state = 0x9e3779b9;
  }

  /** Next float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Float in [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  /**
   * Weighted pick. weights maps a key to a relative weight.
   * consumes one rng draw so later generation stays aligned
   */
  pickWeighted<T extends string>(weights: Record<T, number>): T {
    let total = 0;
    for (const k of Object.keys(weights)) total += weights[k as T];
    let roll = this.next() * total;
    for (const k of Object.keys(weights)) {
      roll -= weights[k as T];
      if (roll <= 0) return k as T;
    }
    return Object.keys(weights)[Object.keys(weights).length - 1] as T;
  }
}

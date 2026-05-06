// Tiny deterministic RNG (mulberry32). The simulation must NEVER call Math.random.
// Both the local sim and any future networked peers seed from the same value.

export class RNG {
  private state: number;
  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number { return min + (max - min) * this.next(); }
  int(min: number, max: number): number { return Math.floor(this.range(min, max + 1)); }
  pick<T>(arr: readonly T[]): T { return arr[this.int(0, arr.length - 1)]; }
  chance(p: number): boolean { return this.next() < p; }

  serialize(): number { return this.state >>> 0; }
  static fromState(state: number): RNG {
    const r = new RNG(0);
    (r as any).state = state >>> 0;
    return r;
  }
}

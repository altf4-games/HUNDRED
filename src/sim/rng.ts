// Seeded PRNG (mulberry32). The only source of randomness in src/sim/.
// State is a single plain object so it can live inside the sim state and be hashed.

export interface Rng {
  s: number;
}

export function makeRng(seed: number): Rng {
  return { s: (seed >>> 0) || 1 };
}

/** Uniform float in [0, 1). */
export function rand(r: Rng): number {
  r.s = (r.s + 0x6d2b79f5) >>> 0;
  let t = r.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Integer in [lo, hi] inclusive. */
export function randInt(r: Rng, lo: number, hi: number): number {
  return lo + Math.floor(rand(r) * (hi - lo + 1));
}

export function range(r: Rng, lo: number, hi: number): number {
  return lo + rand(r) * (hi - lo);
}

export function chance(r: Rng, p: number): boolean {
  return rand(r) < p;
}

export function pick<T>(r: Rng, arr: readonly T[]): T {
  return arr[Math.floor(rand(r) * arr.length)] as T;
}

/** Roughly bell-shaped value in [0, 1] centred on 0.5. */
export function bell(r: Rng): number {
  return (rand(r) + rand(r) + rand(r)) / 3;
}

export function shuffle<T>(r: Rng, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand(r) * (i + 1));
    const t = arr[i] as T;
    arr[i] = arr[j] as T;
    arr[j] = t;
  }
  return arr;
}

/** Stateless hash to [0,1) for cosmetic, order-independent variation. */
export function hash01(a: number, b = 0): number {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

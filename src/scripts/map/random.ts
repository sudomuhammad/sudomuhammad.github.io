// Deterministic randomness, so the map looks the same on every visit.

export type Random = () => number;

/** Mulberry32: a tiny, fast seeded PRNG returning floats in [0, 1). */
export function seededRandom(seed: number): Random {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A standard normal sample (Box–Muller). */
export function gaussian(random: Random): number {
  const u = 1 - random();
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Shuffle pairs of numbers ([x0, y0, x1, y1, …]) in place. */
export function shufflePairs(values: Float32Array, random: Random): Float32Array {
  for (let i = values.length / 2 - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [values[i * 2], values[j * 2]] = [values[j * 2], values[i * 2]];
    [values[i * 2 + 1], values[j * 2 + 1]] = [values[j * 2 + 1], values[i * 2 + 1]];
  }
  return values;
}

export function createRng(seed) {
  let t = (Number(seed) >>> 0) + 0x6d2b79f5;

  return function next() {
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomInt(rng, min, max) {
  const lo = Math.ceil(Math.min(min, max));
  const hi = Math.floor(Math.max(min, max));
  return Math.floor(rng() * (hi - lo + 1)) + lo;
}

export function randomFloat(rng, min, max) {
  return min + rng() * (max - min);
}

export function choice(rng, list) {
  return list[randomInt(rng, 0, list.length - 1)];
}

export function randomSeed() {
  return Math.floor(Math.random() * 2147483647);
}
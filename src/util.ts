export function clamp(v: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, v))
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export function damp(current: number, target: number, lambda: number, dt: number): number {
  return lerp(current, target, 1 - Math.exp(-lambda * dt))
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function formatInt(n: number): string {
  return Math.max(0, Math.floor(n)).toLocaleString('en-US')
}

export function formatDist(meters: number): string {
  if (meters < 1000) return `${Math.floor(meters)} m`
  return `${(meters / 1000).toFixed(2)} km`
}

export function formatKmh(mps: number): string {
  return `${Math.round(mps * 3.6)}`
}

export function shuffleInPlace(items: number[], rng: () => number): number[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = items[i]!
    items[i] = items[j]!
    items[j] = tmp
  }
  return items
}

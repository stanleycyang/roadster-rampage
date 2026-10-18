export const LANE_COUNT = 5
export const LANE_W = 3.5
export const ROAD_HALF = (LANE_COUNT * LANE_W) / 2

export const PLAYER_HW = 0.76
export const PLAYER_HL = 1.85

export const GRAVITY = 28
export const JUMP_V = 12.15
export const BOOST_MAX = 100
export const BOOST_DRAIN = 36
export const BOOST_REGEN = 8
export const COMBO_TIME = 4.2
export const COMBO_MAX = 12

export const SAVE_KEY = 'roadster-rampage-best'
export const MUTE_KEY = 'roadster-rampage-muted'
export const QUALITY_KEY = 'roadster-rampage-quality'
export const SKIN_KEY = 'roadster-rampage-signal'

export function laneX(index: number): number {
  return (index - (LANE_COUNT - 1) / 2) * LANE_W
}

export function nearestLane(x: number): number {
  const i = Math.round(x / LANE_W + (LANE_COUNT - 1) / 2)
  return Math.max(0, Math.min(LANE_COUNT - 1, i))
}

/** 1 = saturated sunset, 0 = full night. Cycles as distance grows. */
export function dayness(distance: number): number {
  const raw = ((distance % 11000) + 11000) % 11000 / 11000
  const wave = Math.cos(raw * Math.PI * 2) * 0.5 + 0.5
  return Math.pow(wave, 1.12)
}

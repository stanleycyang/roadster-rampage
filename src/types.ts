export interface Player {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  speed: number
  onGround: boolean
  coyote: number
  boosting: boolean
  boost: number
  rolling: boolean
  rollDir: number
  rollT: number
  shield: boolean
  magnet: number
  ludicrous: number
  invuln: number
  jumpBuf: number
  steer: number
  gas: boolean
  brake: boolean
}

export interface FrameInput {
  steer: number
  gas: boolean
  brake: boolean
  jumpEdge: boolean
  jumpHeld: boolean
  rollLeft: boolean
  rollRight: boolean
}

export type VaultTier = 'close' | 'vault' | 'fly'

export type PowerKind = 'boost' | 'shield' | 'magnet' | 'ludicrous'

export type VehKind = 'sedan' | 'sport' | 'truck' | 'bus' | 'police'

export type GameEvent =
  | { type: 'jump' }
  | { type: 'land'; impact: number }
  | { type: 'crash' }
  | { type: 'shield-break' }
  | { type: 'nearmiss'; x: number; z: number }
  | { type: 'vault'; tier: VaultTier; x: number; z: number }
  | { type: 'flip' }
  | { type: 'coin' }
  | { type: 'boost' }
  | { type: 'shield'; fresh: boolean }
  | { type: 'magnet' }
  | { type: 'ludicrous' }
  | { type: 'ramp' }
  | { type: 'scrape'; x: number; z: number; side: number }
  | { type: 'police' }
  | { type: 'escaped' }
  | { type: 'storm' }
  | { type: 'storm-end' }
  | { type: 'tunnel' }
  | { type: 'tunnel-end' }
  | { type: 'rocket' }
  | { type: 'km'; n: number }

export interface SaveData {
  score: number
  distance: number
  combo: number
}

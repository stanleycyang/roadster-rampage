import * as THREE from 'three'
import {
  BOOST_DRAIN,
  BOOST_MAX,
  BOOST_REGEN,
  GRAVITY,
  JUMP_V,
  LANE_COUNT,
  LANE_W,
  PLAYER_HL,
  PLAYER_HW,
  ROAD_HALF,
  laneX,
  nearestLane,
} from './config.ts'
import type { FrameInput, GameEvent, Player, PowerKind, VehKind, VaultTier } from './types.ts'
import { clamp, damp, lerp, mulberry32, shuffleInPlace } from './util.ts'
import { TRAFFIC_COLORS, createVehicle } from './vehicles.ts'
import type { VehModel } from './vehicles.ts'

interface Vehicle extends VehModel {
  active: boolean
  x: number
  z: number
  speed: number
  lane: number
  scored: boolean
  hit: boolean
  switchT: number
}

interface Coin {
  mesh: THREE.Mesh
  active: boolean
  x: number
  y: number
  z: number
  phase: number
}

interface Powerup {
  mesh: THREE.Group
  active: boolean
  kind: PowerKind
  x: number
  y: number
  z: number
  phase: number
  show: Record<PowerKind, THREE.Object3D>
}

interface Ramp {
  mesh: THREE.Group
  active: boolean
  x: number
  z: number
  hw: number
  hl: number
  height: number
  used: boolean
}

interface Ring {
  mesh: THREE.Mesh
  active: boolean
  z: number
}

interface Zone {
  z0: number
  z1: number
}

const CIV: VehKind[] = ['sedan', 'sport', 'truck', 'bus']

function makeCoin(): Coin {
  const mesh = new THREE.Mesh(
    new THREE.TorusGeometry(0.32, 0.08, 8, 14),
    new THREE.MeshStandardMaterial({
      color: 0xffd56a,
      metalness: 0.85,
      roughness: 0.25,
      emissive: new THREE.Color().setRGB(1.1, 0.65, 0.1),
      emissiveIntensity: 0.7,
    }),
  )
  mesh.visible = false
  return { mesh, active: false, x: 0, y: 1.1, z: 0, phase: Math.random() * 6 }
}

function makePowerup(): Powerup {
  const root = new THREE.Group()
  const boost = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.22, 0.7, 10),
    new THREE.MeshStandardMaterial({
      color: 0x7af6ff,
      emissive: new THREE.Color().setRGB(0.2, 1.2, 1.4),
      emissiveIntensity: 0.8,
      metalness: 0.4,
      roughness: 0.3,
    }),
  )
  const shield = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.42),
    new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(0.5, 1.6, 1.8), toneMapped: false }),
  )
  const magnet = new THREE.Mesh(
    new THREE.TorusGeometry(0.36, 0.08, 8, 16),
    new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(1.7, 0.2, 1.0), toneMapped: false }),
  )
  const ludicrous = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.4, 0),
    new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(1.8, 0.3, 1.2), toneMapped: false }),
  )
  boost.rotation.z = Math.PI / 2
  root.add(boost, shield, magnet, ludicrous)
  root.visible = false
  return {
    mesh: root,
    active: false,
    kind: 'boost',
    x: 0,
    y: 1.3,
    z: 0,
    phase: Math.random() * 5,
    show: { boost, shield, magnet, ludicrous },
  }
}

function chevronTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 256
  const g = c.getContext('2d')!
  g.fillStyle = '#24180c'
  g.fillRect(0, 0, 128, 256)
  g.strokeStyle = '#ffc857'
  g.lineWidth = 10
  g.lineJoin = 'round'
  for (let y = 16; y < 256; y += 42) {
    g.beginPath()
    g.moveTo(18, y + 20)
    g.lineTo(64, y)
    g.lineTo(110, y + 20)
    g.stroke()
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.needsUpdate = true
  return tex
}

function makeRamp(): Ramp {
  const group = new THREE.Group()
  const slope = new THREE.Mesh(
    new THREE.BoxGeometry(3, 0.28, 10),
    new THREE.MeshStandardMaterial({ color: 0x3a2a18, metalness: 0.4, roughness: 0.55 }),
  )
  slope.rotation.x = -0.18
  slope.position.y = 0.85
  const decal = new THREE.Mesh(
    new THREE.PlaneGeometry(2.4, 8.6),
    new THREE.MeshBasicMaterial({ map: chevronTexture(), transparent: true, toneMapped: false }),
  )
  decal.rotation.x = -Math.PI / 2 - 0.18
  decal.position.y = 1.05
  const edgeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(2.2, 1.1, 0.2), toneMapped: false, fog: false })
  const edgeL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 9), edgeMat)
  edgeL.position.set(-1.45, 0.4, 0)
  const edgeR = edgeL.clone()
  edgeR.position.x = 1.45
  group.add(slope, decal, edgeL, edgeR)
  group.visible = false
  return { mesh: group, active: false, x: 0, z: 0, hw: 1.5, hl: 5, height: 1.55, used: false }
}

function makeRing(i: number): Ring {
  const mat = new THREE.MeshBasicMaterial({
    color: new THREE.Color().setRGB(i % 2 === 0 ? 1.6 : 0.2, i % 2 === 0 ? 0.15 : 1.2, i % 2 === 0 ? 0.85 : 1.5),
    toneMapped: false,
    fog: false,
  })
  const mesh = new THREE.Mesh(new THREE.TorusGeometry(8.4, 0.09, 8, 36), mat)
  mesh.position.y = 8.1
  mesh.visible = false
  return { mesh, active: false, z: 0 }
}

export class Simulation {
  readonly vehicles: Vehicle[] = []
  readonly coins: Coin[] = []
  readonly powerups: Powerup[] = []
  readonly ramps: Ramp[] = []
  readonly rings: Ring[] = []
  rainT = 0
  policeT = 0
  inTunnel = false
  private readonly police: Vehicle[] = []
  private readonly events: GameEvent[] = []
  private readonly zones: Zone[] = []
  private rng: () => number = Math.random
  private generated = 0
  private tutorialDone = false
  private over = false
  private ghost = false
  private chasing = false
  private nextRamp = 680
  private nextTunnel = 820
  private nextPolice = 1100
  private nextRain = 1550
  private nextRocket = 2200
  private nextBoost = 420
  private nextShield = 500
  private nextMagnet = 900
  private nextLudi = 1300
  private lastKm = 0
  private scrapeCd = 0
  private wasRain = false
  private visTime = 0
  private readonly laneBag = [0, 1, 2, 3, 4]
  readonly player: Player

  constructor(player: Player) {
    this.player = player
    const counts: Record<VehKind, number> = { sedan: 12, sport: 7, truck: 6, bus: 4, police: 3 }
    for (const kind of [...CIV, 'police'] as VehKind[]) {
      for (let i = 0; i < counts[kind]; i++) {
        const model = createVehicle(kind, TRAFFIC_COLORS[i % TRAFFIC_COLORS.length])
        const v: Vehicle = {
          ...model,
          active: false,
          x: 0,
          z: 0,
          speed: 20,
          lane: 0,
          scored: false,
          hit: false,
          switchT: 0,
        }
        this.vehicles.push(v)
        if (kind === 'police') this.police.push(v)
      }
    }
    for (let i = 0; i < 72; i++) this.coins.push(makeCoin())
    for (let i = 0; i < 16; i++) this.powerups.push(makePowerup())
    for (let i = 0; i < 4; i++) this.ramps.push(makeRamp())
    for (let i = 0; i < 16; i++) this.rings.push(makeRing(i))
  }

  attach(scene: THREE.Scene): void {
    for (const v of this.vehicles) scene.add(v.group)
    for (const c of this.coins) scene.add(c.mesh)
    for (const p of this.powerups) scene.add(p.mesh)
    for (const r of this.ramps) scene.add(r.mesh)
    for (const ring of this.rings) scene.add(ring.mesh)
  }

  reset(seed?: number): void {
    this.rng = mulberry32(seed ?? (Math.random() * 1e9) | 0)
    this.generated = 0
    this.tutorialDone = false
    this.over = false
    this.rainT = 0
    this.policeT = 0
    this.chasing = false
    this.inTunnel = false
    this.wasRain = false
    this.zones.length = 0
    this.events.length = 0
    this.nextRamp = 700
    this.nextTunnel = 860
    this.nextPolice = 1150
    this.nextRain = 1600
    this.nextRocket = 2200
    this.nextBoost = 430
    this.nextShield = 520
    this.nextMagnet = 920
    this.nextLudi = 1320
    this.lastKm = 0
    this.scrapeCd = 0
    const p = this.player
    p.x = 0
    p.y = 0
    p.z = 0
    p.vx = 0
    p.vy = 0
    p.speed = 40
    p.onGround = true
    p.coyote = 0
    p.boosting = false
    p.boost = 72
    p.rolling = false
    p.rollDir = 1
    p.rollT = 0
    p.shield = false
    p.magnet = 0
    p.ludicrous = 0
    p.invuln = 0.7
    p.jumpBuf = 0
    p.steer = 0
    p.gas = false
    p.brake = false
    for (const v of this.vehicles) this.hideVehicle(v)
    for (const c of this.coins) this.hideCoin(c)
    for (const item of this.powerups) this.hidePower(item)
    for (const r of this.ramps) {
      r.active = false
      r.mesh.visible = false
      r.used = false
    }
    for (const ring of this.rings) {
      ring.active = false
      ring.mesh.visible = false
    }
  }

  update(worldDt: number, realDt: number, input: FrameInput, ghost: boolean): GameEvent[] {
    this.events.length = 0
    this.ghost = ghost
    if (this.over && !ghost) return this.events
    const p = this.player
    if (p.ludicrous > 0) p.ludicrous = Math.max(0, p.ludicrous - realDt)
    if (p.magnet > 0) p.magnet = Math.max(0, p.magnet - realDt)
    if (this.rainT > 0) this.rainT = Math.max(0, this.rainT - realDt)
    if (this.policeT > 0) this.policeT = Math.max(0, this.policeT - realDt)
    if (this.scrapeCd > 0) this.scrapeCd = Math.max(0, this.scrapeCd - realDt)

    if (worldDt > 0) {
      const steps = Math.max(1, Math.ceil(worldDt / 0.016))
      const h = worldDt / steps
      for (let i = 0; i < steps; i++) {
        this.substep(h, input, i === 0)
        if (this.over) break
      }
    }
    this.stream()
    this.eventsAndTimers()
    this.animate(realDt)
    return this.events
  }

  private substep(h: number, input: FrameInput, isFirst: boolean): void {
    const p = this.player
    if (p.invuln > 0) p.invuln -= h
    const prevZ = p.z
    p.steer = input.steer
    p.gas = input.gas
    p.brake = input.brake

    const distT = clamp(p.z / 8000, 0, 1)
    let cruise = 36 + distT * 34
    let maxS = cruise + 28
    if (this.ghost) {
      cruise = 33
      maxS = 34
    }
    let target = cruise
    if (input.gas && !input.brake) target = maxS
    if (input.brake) target = 16
    const rate = input.brake ? 3.2 : input.gas ? 1.65 : 0.8
    p.speed = damp(p.speed, target, rate, h)
    p.z += p.speed * h

    const wet = this.rainT > 0
    const lambda = p.onGround ? (wet ? 4.2 : 9.2) : 5.4
    const maxLat = p.onGround ? (wet ? 7 : 12) : 9
    p.vx = damp(p.vx, input.steer * maxLat, lambda, h)
    p.x += p.vx * h

    if (isFirst && input.jumpEdge) p.jumpBuf = 0.12
    else p.jumpBuf -= h
    if (p.jumpBuf > 0 && (p.onGround || p.coyote > 0)) {
      p.jumpBuf = 0
      p.vy = JUMP_V
      p.onGround = false
      p.coyote = 0
      this.events.push({ type: 'jump' })
    }

    const thrust = input.jumpHeld && !p.onGround && p.boost > 0.5 && p.y > 0.28
    if (thrust) {
      p.boosting = true
      p.vy -= GRAVITY * 0.22 * h
      if (p.vy < 1.6) p.vy += 12 * h
      p.boost = Math.max(0, p.boost - BOOST_DRAIN * h)
    } else {
      p.boosting = false
      if (!p.onGround) p.vy -= GRAVITY * h
      else p.boost = Math.min(BOOST_MAX, p.boost + BOOST_REGEN * h)
    }
    p.y += p.vy * h
    if (p.y <= 0) {
      const impact = p.vy
      const wasAir = !p.onGround
      p.y = 0
      p.vy = 0
      p.onGround = true
      if (wasAir && impact < -1) this.events.push({ type: 'land', impact })
    } else p.onGround = false

    this.applyRamps()
    this.applyWalls()
    if (this.over) return
    this.moveTraffic(h)
    this.collideVehicles()
    if (this.over) return
    if (!this.ghost) this.collectPickups(h)
    this.scorePasses(prevZ)

    if (isFirst && !p.rolling && !p.onGround) {
      if (input.rollRight) this.startRoll(-1)
      else if (input.rollLeft) this.startRoll(1)
    }
    if (p.rolling) {
      p.rollT += h / 0.5
      if (p.rollT >= 1) {
        p.rolling = false
        p.rollT = 1
        if (!this.ghost) this.events.push({ type: 'flip' })
      }
    }
    if (p.onGround && p.rolling) {
      const ok = p.rollT > 0.82
      p.rolling = false
      if (ok && !this.ghost) this.events.push({ type: 'flip' })
    }
    if (p.onGround) p.coyote = 0.1
    else p.coyote -= h
  }

  private startRoll(dir: number): void {
    this.player.rolling = true
    this.player.rollDir = dir
    this.player.rollT = 0
  }

  private applyRamps(): void {
    const p = this.player
    for (const ramp of this.ramps) {
      if (!ramp.active) continue
      if (Math.abs(p.x - ramp.x) > ramp.hw || Math.abs(p.z - ramp.z) > ramp.hl) continue
      const t = clamp((p.z - (ramp.z - ramp.hl)) / (ramp.hl * 2), 0, 1)
      const surface = t * ramp.height
      if (p.y <= surface + 0.4) {
        p.y = Math.max(p.y, surface)
        p.onGround = true
        p.vy = Math.max(0, p.vy)
        if (t > 0.9 && !ramp.used) {
          ramp.used = true
          p.vy = 14.2 + p.speed * 0.04
          p.onGround = false
          p.y = surface + 0.08
          if (!this.ghost) this.events.push({ type: 'ramp' })
        }
      }
    }
  }

  private applyWalls(): void {
    const p = this.player
    const limit = ROAD_HALF - PLAYER_HW - 0.12
    if (p.x > limit) this.hitWall(1, limit)
    if (p.x < -limit) this.hitWall(-1, -limit)
  }

  private hitWall(side: number, limit: number): void {
    const p = this.player
    if (Math.abs(p.vx) > 3 && this.scrapeCd <= 0 && !this.ghost) {
      this.scrapeCd = 0.35
      p.speed = Math.max(18, p.speed * 0.9)
      this.events.push({ type: 'scrape', x: p.x, z: p.z, side })
    }
    p.x = limit
    if (side > 0) p.vx = Math.min(0, p.vx)
    else p.vx = Math.max(0, p.vx)
  }

  private moveTraffic(h: number): void {
    const p = this.player
    for (const v of this.vehicles) {
      if (!v.active) continue
      if (v.kind === 'police' && this.policeT > 0) {
        v.switchT -= h
        if (v.switchT <= 0) {
          const toward = nearestLane(p.x)
          const offset = this.rng() < 0.58 ? 0 : this.rng() < 0.5 ? -1 : 1
          v.lane = clamp(toward + offset, 0, LANE_COUNT - 1)
          v.switchT = 0.85 + this.rng() * 0.7
        }
        v.x = damp(v.x, laneX(v.lane), 3.1, h)
        const chaseCap = 36 + clamp(p.z / 8000, 0, 1) * 34 + 8
        const chase = Math.min(p.speed + 4, chaseCap)
        v.speed = damp(v.speed, chase, 1.4, h)
      }
      v.z += v.speed * h
      const behind = v.kind === 'police' ? 90 : 40
      if (v.z < p.z - behind || v.z > p.z + 540) this.hideVehicle(v)
    }
  }

  private collideVehicles(): void {
    const p = this.player
    for (const v of this.vehicles) {
      if (!v.active || v.hit) continue
      const overlapX = Math.abs(p.x - v.x) < PLAYER_HW + v.hw - 0.06
      const overlapZ = Math.abs(p.z - v.z) < PLAYER_HL + v.hl - 0.08
      if (!overlapX || !overlapZ || p.y >= v.height - 0.1) continue
      v.hit = true
      v.scored = true
      if (this.ghost || p.invuln > 0) {
        const away = Math.sign(p.x - v.x) || 1
        p.x += away * 0.45
        p.vx = away * 7
        continue
      }
      if (p.shield) {
        p.shield = false
        p.invuln = 0.75
        p.vy = Math.max(p.vy, 9)
        const away = Math.sign(p.x - v.x) || (this.rng() < 0.5 ? -1 : 1)
        p.vx = away * 9
        p.x += away * 0.3
        this.events.push({ type: 'shield-break' })
        continue
      }
      this.over = true
      this.events.push({ type: 'crash' })
      return
    }
  }

  private scorePasses(prevZ: number): void {
    if (this.ghost || this.over) return
    const p = this.player
    for (const v of this.vehicles) {
      if (!v.active || v.scored) continue
      if (!(prevZ < v.z && p.z >= v.z)) continue
      v.scored = true
      const latGap = Math.abs(p.x - v.x) - (PLAYER_HW + v.hw)
      const clearance = p.y - v.height
      if (latGap < -0.02) {
        if (clearance >= -0.05) {
          const tier: VaultTier = clearance < 0.55 ? 'close' : clearance < 2.15 ? 'vault' : 'fly'
          this.events.push({ type: 'vault', tier, x: v.x, z: v.z })
        }
      } else if (latGap < 0.7 && p.y < v.height + 0.55) {
        this.events.push({ type: 'nearmiss', x: v.x, z: v.z })
      }
    }
  }

  private collectPickups(h: number): void {
    const p = this.player
    for (const c of this.coins) {
      if (!c.active) continue
      if (p.magnet > 0) this.pull(c, h, 10)
      const dx = p.x - c.x
      const dy = p.y + 0.5 - c.y
      const dz = p.z - c.z
      if (dx * dx + dy * dy + dz * dz < 1.7) {
        this.hideCoin(c)
        this.events.push({ type: 'coin' })
      } else if (c.z < p.z - 24) this.hideCoin(c)
    }
    for (const item of this.powerups) {
      if (!item.active) continue
      if (p.magnet > 0 && (item.kind === 'boost' || item.kind === 'shield')) this.pull(item, h, 8)
      const dx = p.x - item.x
      const dy = p.y + 0.5 - item.y
      const dz = p.z - item.z
      if (dx * dx + dy * dy + dz * dz < 2.1) {
        this.applyPower(item.kind)
        this.hidePower(item)
      } else if (item.z < p.z - 24) this.hidePower(item)
    }
  }

  private pull(item: { x: number; y: number; z: number }, h: number, range: number): void {
    const p = this.player
    const dx = p.x - item.x
    const dy = p.y + 0.5 - item.y
    const dz = p.z - item.z
    const d2 = dx * dx + dy * dy + dz * dz
    if (d2 > range * range || d2 < 0.04) return
    const d = Math.sqrt(d2)
    const k = Math.min(0.65, (20 * h) / d)
    item.x += dx * k
    item.y += dy * k
    item.z += dz * k
  }

  private applyPower(kind: PowerKind): void {
    const p = this.player
    if (kind === 'boost') {
      p.boost = clamp(p.boost + 42, 0, BOOST_MAX)
      this.events.push({ type: 'boost' })
    } else if (kind === 'shield') {
      const fresh = !p.shield
      p.shield = true
      this.events.push({ type: 'shield', fresh })
    } else if (kind === 'magnet') {
      p.magnet = 8.5
      this.events.push({ type: 'magnet' })
    } else {
      p.ludicrous = 6.5
      p.boost = clamp(p.boost + 28, 0, BOOST_MAX)
      this.events.push({ type: 'ludicrous' })
    }
  }

  private stream(): void {
    const horizon = this.player.z + 400
    if (!this.tutorialDone) {
      this.spawnTutorial()
      this.tutorialDone = true
      this.generated = 400
    }
    let guard = 0
    while (this.generated < horizon && guard++ < 14) this.spawnRow(this.generated)
  }

  private spawnTutorial(): void {
    for (let i = 0; i < 8; i++) this.spawnCoin(0, 1.15, 16 + i * 3.3)
    this.spawnVehicle(3, 88, 'sedan', 18)
    this.spawnVehicle(1, 128, 'sedan', 20)
    this.spawnVehicle(4, 136, 'sport', 26)
    for (let i = 0; i < 6; i++) this.spawnCoin(0, 2.35, 162 + i * 3.2)
    this.spawnPower('boost', 0, 1.35, 176)
    this.spawnRamp(2, 230, false)
    for (let i = 0; i < 8; i++) {
      const t = i / 7
      this.spawnCoin(laneX(2), 1 + Math.sin(t * Math.PI) * 2.8, 238 + t * 32)
    }
    this.spawnPower('shield', laneX(3), 1.4, 275)
    this.spawnVehicle(0, 330, 'truck', 16)
    this.spawnVehicle(2, 338, 'bus', 18)
    this.spawnVehicle(4, 324, 'sedan', 22)
    for (let i = 0; i < 5; i++) this.spawnCoin(laneX(1), 1.15, 318 + i * 3.2)
  }

  private spawnRow(z: number): void {
    const d = clamp((z - 300) / 7000, 0, 1)
    if (z >= this.nextTunnel) {
      this.spawnTunnel(z, d)
      return
    }
    if (z >= this.nextRamp) {
      this.spawnRampRow(z, d)
      return
    }
    const spacing = lerp(50, 30, d) + this.rng() * 8
    const maxBlock = d > 0.65 ? 4 : d > 0.28 ? 3 : 2
    const count = 1 + Math.floor(this.rng() * maxBlock)
    shuffleInPlace(this.laneBag, this.rng)
    const blocked = this.laneBag.slice(0, count)
    for (const lane of blocked) {
      const kind = this.pickKind(d)
      const speed = this.speedFor(kind, d)
      this.spawnVehicle(lane, z + this.rng() * 6, kind, speed)
    }
    const open = this.laneBag.filter((lane) => !blocked.includes(lane))
    if (open.length && this.rng() < 0.62) {
      const lane = open[Math.floor(this.rng() * open.length)]!
      const slalom = this.rng() < 0.2
      const air = this.rng() < 0.22
      const n = 5 + Math.floor(this.rng() * 4)
      for (let k = 0; k < n; k++) {
        const x = laneX(lane) + (slalom ? Math.sin(k * 0.9) * LANE_W * 0.7 : 0)
        this.spawnCoin(x, air ? 2.25 : 1.15, z - 8 + k * 3.15)
      }
    }
    this.generated = z + spacing
  }

  private spawnRampRow(z: number, d: number): void {
    const lane = Math.floor(this.rng() * LANE_COUNT)
    const wide = d > 0.35 && this.rng() < 0.3
    this.spawnRamp(lane, z, wide)
    const blockedLanes = new Set<number>([lane])
    if (wide) blockedLanes.add(clamp(lane + (this.rng() < 0.5 ? -1 : 1), 0, LANE_COUNT - 1))
    const others = [0, 1, 2, 3, 4].filter((i) => !blockedLanes.has(i))
    const force = d > 0.45 && this.rng() < 0.3
    const leave = !force && others.length ? others[Math.floor(this.rng() * others.length)]! : -1
    for (const i of others) {
      if (i === leave) continue
      if (!force && this.rng() < 0.25) continue
      this.spawnVehicle(i, z + this.rng() * 5, this.pickKind(d), this.speedFor('sedan', d))
    }
    for (let i = 0; i < 8; i++) {
      const t = i / 7
      this.spawnCoin(laneX(lane), 1.1 + Math.sin(t * Math.PI) * 3.1, z + 8 + t * 34)
    }
    this.nextRamp = z + lerp(560, 360, d) + this.rng() * 180
    this.generated = z + 48
  }

  private spawnTunnel(z: number, d: number): void {
    const length = 170
    for (let i = 0; i < 12; i++) this.spawnRing(z + 8 + i * 14)
    this.spawnVehicle(1, z + 46, 'sedan', 24)
    this.spawnVehicle(3, z + 96, 'sport', 30)
    for (let i = 0; i < 14; i++) {
      const t = i / 13
      const x = Math.sin(t * Math.PI * 2) * 5.4
      this.spawnCoin(x, 1.25 + Math.sin(t * Math.PI) * 1.1, z + 12 + t * 145)
    }
    this.zones.push({ z0: z, z1: z + length })
    this.nextTunnel = z + lerp(1200, 820, d) + this.rng() * 300
    this.generated = z + length + 24
  }

  private eventsAndTimers(): void {
    const p = this.player
    const was = this.inTunnel
    this.inTunnel = this.zones.some((zone) => p.z >= zone.z0 && p.z <= zone.z1)
    this.zones.splice(0, this.zones.length, ...this.zones.filter((zone) => zone.z1 > p.z - 30))
    if (this.inTunnel && !was) this.events.push({ type: 'tunnel' })
    if (!this.inTunnel && was) this.events.push({ type: 'tunnel-end' })
    const raining = this.rainT > 0
    if (raining && !this.wasRain) this.events.push({ type: 'storm' })
    if (!raining && this.wasRain) this.events.push({ type: 'storm-end' })
    this.wasRain = raining

    if (!this.ghost && p.z > this.nextRocket) {
      this.events.push({ type: 'rocket' })
      this.nextRocket = advanceRocket(p.z)
    }
    const km = Math.floor(p.z / 1000)
    if (km > this.lastKm) {
      this.lastKm = km
      if (km > 0 && !this.ghost) this.events.push({ type: 'km', n: km })
    }
    if (!this.ghost && this.policeT <= 0 && p.z > this.nextPolice) {
      if (this.inTunnel) this.nextPolice = p.z + 200
      else {
        this.startPolice()
        this.events.push({ type: 'police' })
        this.nextPolice = p.z + 1750 + this.rng() * 500
      }
    }
    if (this.chasing) {
      let maxZ = -Infinity
      let any = false
      for (const cop of this.police) {
        if (!cop.active) continue
        any = true
        maxZ = Math.max(maxZ, cop.z)
      }
      if (any && p.z - maxZ > 54) this.endPolice(true)
      else if (!any || this.policeT <= 0) this.endPolice(false)
    }
    if (!this.ghost && this.rainT <= 0 && p.z > this.nextRain) {
      if (this.inTunnel) this.nextRain = p.z + 220
      else {
        this.rainT = 17
        this.nextRain = p.z + 2200 + this.rng() * 600
      }
    }
    if (!this.ghost) this.ensurePickups()

    for (const ramp of this.ramps) {
      if (ramp.active && ramp.z < p.z - 30) {
        ramp.active = false
        ramp.mesh.visible = false
      }
    }
    for (const ring of this.rings) {
      if (ring.active && ring.z < p.z - 24) {
        ring.active = false
        ring.mesh.visible = false
      }
    }
  }

  private ensurePickups(): void {
    const horizon = this.player.z + 150
    while (this.nextBoost < horizon) {
      this.dropPower('boost', this.nextBoost)
      this.nextBoost += 400 + this.rng() * 90
    }
    while (this.nextShield < horizon) {
      this.dropPower('shield', this.nextShield)
      this.nextShield += 1150 + this.rng() * 200
    }
    while (this.nextMagnet < horizon) {
      this.dropPower('magnet', this.nextMagnet)
      this.nextMagnet += 900 + this.rng() * 180
    }
    while (this.nextLudi < horizon) {
      this.dropPower('ludicrous', this.nextLudi)
      this.nextLudi += 1550 + this.rng() * 250
    }
  }

  private startPolice(): void {
    this.policeT = 16
    this.chasing = true
    this.police.forEach((cop, i) => {
      cop.active = true
      cop.group.visible = true
      cop.z = this.player.z - 16 - i * 9
      cop.lane = (2 + i) % LANE_COUNT
      cop.x = laneX(cop.lane)
      cop.speed = this.player.speed
      cop.scored = false
      cop.hit = false
      cop.switchT = 0.35 * i
    })
  }

  private endPolice(escaped: boolean): void {
    for (const cop of this.police) this.hideVehicle(cop)
    this.policeT = 0
    this.chasing = false
    if (escaped && !this.ghost) this.events.push({ type: 'escaped' })
  }

  private dropPower(kind: PowerKind, z: number): void {
    const blocked = new Set<number>()
    for (const v of this.vehicles) {
      if (v.active && Math.abs(v.z - z) < 14) blocked.add(v.lane)
    }
    const open = [0, 1, 2, 3, 4].filter((i) => !blocked.has(i))
    const lane = open.length ? open[Math.floor(this.rng() * open.length)]! : 2
    const y = open.length ? 1.45 : 3.3
    this.spawnPower(kind, laneX(lane), y, z)
  }

  private pickKind(d: number): VehKind {
    const r = this.rng()
    if (r < 0.12 + d * 0.1) return 'truck'
    if (r < 0.22 + d * 0.08) return 'bus'
    if (r < 0.42) return 'sport'
    return 'sedan'
  }

  private speedFor(kind: VehKind, d: number): number {
    const base = kind === 'sport' ? 34 : kind === 'truck' ? 15 : kind === 'bus' ? 17 : 22
    return base + this.rng() * 7 + d * 6
  }

  private spawnVehicle(lane: number, z: number, kind: VehKind, speed: number): void {
    const pool = this.vehicles.filter((v) => !v.active && v.kind === kind && v.kind !== 'police')
    const fallback = this.vehicles.filter((v) => !v.active && v.kind !== 'police')
    const v = pool[0] ?? fallback[0]
    if (!v) return
    if (kind !== v.kind) {
      /* keep the mesh kind; speed still fine */
    }
    v.active = true
    v.group.visible = true
    v.lane = lane
    v.x = laneX(lane)
    v.z = z
    v.speed = speed
    v.scored = false
    v.hit = false
    if (v.kind !== 'police') {
      const color = TRAFFIC_COLORS[Math.floor(this.rng() * TRAFFIC_COLORS.length)]!
      v.bodyMat.color.setHex(color)
    }
    v.group.position.set(v.x, 0, v.z)
  }

  private spawnCoin(x: number, y: number, z: number): void {
    const c = this.coins.find((coin) => !coin.active)
    if (!c) return
    c.active = true
    c.mesh.visible = true
    c.x = x
    c.y = y
    c.z = z
    c.mesh.position.set(x, y, z)
  }

  private spawnPower(kind: PowerKind, x: number, y: number, z: number): void {
    const item = this.powerups.find((p) => !p.active)
    if (!item) return
    item.active = true
    item.kind = kind
    item.x = x
    item.y = y
    item.z = z
    item.mesh.visible = true
    for (const key of Object.keys(item.show) as PowerKind[]) item.show[key].visible = key === kind
    item.mesh.position.set(x, y, z)
  }

  private spawnRamp(lane: number, z: number, wide: boolean): void {
    const ramp = this.ramps.find((r) => !r.active)
    if (!ramp) return
    ramp.active = true
    ramp.used = false
    ramp.x = laneX(lane)
    ramp.z = z
    ramp.hw = wide ? LANE_W * 0.95 : LANE_W * 0.48
    ramp.hl = 5
    ramp.height = 1.55
    ramp.mesh.visible = true
    ramp.mesh.position.set(ramp.x, 0, ramp.z)
    ramp.mesh.scale.set(wide ? 1.7 : 1, 1, 1)
  }

  private spawnRing(z: number): void {
    const ring = this.rings.find((r) => !r.active)
    if (!ring) return
    ring.active = true
    ring.z = z
    ring.mesh.visible = true
    ring.mesh.position.z = z
  }

  private hideVehicle(v: Vehicle): void {
    v.active = false
    v.group.visible = false
    v.scored = false
    v.hit = false
  }

  private hideCoin(c: Coin): void {
    c.active = false
    c.mesh.visible = false
  }

  private hidePower(item: Powerup): void {
    item.active = false
    item.mesh.visible = false
  }

  private animate(realDt: number): void {
    this.visTime += realDt
    const t = this.visTime
    for (const v of this.vehicles) {
      if (!v.active) continue
      v.group.position.set(v.x, 0, v.z)
      for (const w of v.wheels) w.rotation.x -= v.speed * realDt * 0.7
      if (v.kind === 'police' && v.lightL && v.lightR) {
        const blink = Math.sin(t * 22 + v.z) > 0
        v.lightL.color.setRGB(blink ? 4.2 : 0.2, 0.03, 0.05)
        v.lightR.color.setRGB(0.05, 0.12, blink ? 0.25 : 4)
      }
    }
    for (const c of this.coins) {
      if (!c.active) continue
      c.mesh.position.set(c.x, c.y + Math.sin(t * 3 + c.phase) * 0.1, c.z)
      c.mesh.rotation.y += realDt * 2.2
    }
    for (const item of this.powerups) {
      if (!item.active) continue
      item.mesh.position.set(item.x, item.y + Math.sin(t * 2.4 + item.phase) * 0.12, item.z)
      item.mesh.rotation.y += realDt * 1.4
      if (item.kind === 'ludicrous') {
        const mat = (item.show.ludicrous as THREE.Mesh).material as THREE.MeshBasicMaterial
        const pulse = 0.5 + Math.sin(t * 8) * 0.5
        mat.color.setRGB(1.2 + pulse, 0.2, 1.1 + (1 - pulse) * 0.6)
      }
    }
  }
}

function advanceRocket(z: number): number {
  const marks = [2200, 5200, 9000, 13500]
  for (const m of marks) if (m > z + 1) return m
  const base = 13500
  const step = 5000
  const k = Math.floor((z - base) / step) + 1
  return base + k * step
}

import * as THREE from 'three'
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { AudioEngine } from './audio.ts'
import { Roadster } from './car.ts'
import { COMBO_MAX, COMBO_TIME, MUTE_KEY, QUALITY_KEY, SAVE_KEY, SKIN_KEY } from './config.ts'
import { Effects } from './fx.ts'
import { Input } from './input.ts'
import { SpeedShader } from './shaders.ts'
import { Simulation } from './sim.ts'
import type { GameEvent, Player, SaveData, VaultTier } from './types.ts'
import { UI } from './ui.ts'
import { clamp } from './util.ts'
import { World } from './world.ts'

type Mode = 'title' | 'playing' | 'paused' | 'replay' | 'score'

const FLAVOR = [
  'The asphalt keeps the receipt.',
  'Cold gas, hot mess.',
  'That was not the racing line.',
  'Wheels up. Ego down.',
  'The combo believed in you.',
  'Next time, vault it.',
  'The night is undefeated.',
]

export class Game {
  private readonly world: World
  private readonly sim: Simulation
  private readonly player: Player
  private readonly car = new Roadster()
  private readonly fx = new Effects()
  private readonly input = new Input()
  private readonly audio: AudioEngine
  private readonly ui: UI
  private readonly composer: EffectComposer
  private readonly bloom: UnrealBloomPass
  private readonly ssao: SSAOPass
  private readonly bokeh: BokehPass
  private readonly speedPass: ShaderPass
  private readonly camPos = new THREE.Vector3()
  private readonly look = new THREE.Vector3()
  private readonly desired = new THREE.Vector3()
  private readonly desiredLook = new THREE.Vector3()
  private readonly nozzle = new THREE.Vector3()
  private readonly exhaustDir = new THREE.Vector3()
  private mode: Mode = 'title'
  private time = 0
  private score = 0
  private combo = 1
  private comboTimer = 0
  private bestCombo = 1
  private near = 0
  private vaults = 0
  private flips = 0
  private coins = 0
  private topSpeed = 0
  private lastZ = 0
  private best: SaveData = { score: 0, distance: 0, combo: 0 }
  private shake = 0
  private flash = 0
  private lightning = 0
  private replayT = 0
  private finished = false
  private didJump = false
  private snapCam = true
  private suppress = 0
  private pixelCap = 1.25
  private high = true
  private qualityChecked = false
  private warmup = 0
  private fpsAccum = 0
  private fpsFrames = 0
  private lastCoinSfx = 0
  private readonly debug: boolean
  private readonly autostart: boolean
  private readonly beauty: boolean
  private readonly shot: 'front' | 'side' | 'rear' | null
  private signal = false
  private accentOn = false
  private readonly frame = (now: number) => {
    const dt = Math.min(0.05, (now - this.last) / 1000)
    this.last = now
    this.tick(dt)
    requestAnimationFrame(this.frame)
  }
  private last = performance.now()

  constructor(canvas: HTMLCanvasElement) {
    this.world = new World(canvas)
    this.player = {
      x: 0, y: 0, z: 0, vx: 0, vy: 0, speed: 40, onGround: true, coyote: 0,
      boosting: false, boost: 72, rolling: false, rollDir: 1, rollT: 0,
      shield: false, magnet: 0, ludicrous: 0, invuln: 0, jumpBuf: 0,
      steer: 0, gas: false, brake: false,
    }
    this.sim = new Simulation(this.player)
    this.sim.attach(this.world.scene)
    this.world.scene.add(this.car.root, this.car.shadow, this.fx.points, this.fx.smoke, this.fx.rain, this.fx.shock)
    this.best = loadSave()
    this.audio = new AudioEngine(loadMute())
    this.ui = new UI({
      start: () => this.startRun(),
      restart: () => this.startRun(),
      resume: () => this.togglePause(),
      menu: () => this.backToTitle(),
      mute: () => this.toggleMute(),
      pause: () => this.togglePause(),
      quality: () => this.toggleQuality(),
      skin: () => this.toggleSkin(),
    })
    this.ui.setMuted(this.audio.muted)
    this.ui.setBest(this.best)

    const w = window.innerWidth
    const h = window.innerHeight
    const renderPass = new RenderPass(this.world.scene, this.world.camera)
    this.ssao = new SSAOPass(this.world.scene, this.world.camera, w, h, 16)
    this.ssao.kernelRadius = 0.45
    this.ssao.minDistance = 0.0008
    this.ssao.maxDistance = 0.012
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.42, 0.4, 0.78)
    this.bokeh = new BokehPass(this.world.scene, this.world.camera, { focus: 8, aperture: 0.00018, maxblur: 0.006 })
    this.speedPass = new ShaderPass(SpeedShader)
    this.composer = new EffectComposer(this.world.renderer)
    this.composer.addPass(renderPass)
    this.composer.addPass(this.ssao)
    this.composer.addPass(this.bloom)
    this.composer.addPass(this.bokeh)
    this.composer.addPass(this.speedPass)
    this.composer.addPass(new OutputPass())

    const params = new URLSearchParams(location.search)
    this.debug = params.has('debug')
    this.autostart = params.has('autostart')
    const shot = params.get('shot')
    this.shot = shot === 'front' || shot === 'side' || shot === 'rear' ? shot : params.has('beauty') ? 'front' : null
    this.beauty = this.shot !== null
    if (this.beauty) document.body.classList.add('beauty')
    this.signal = loadFlag(SKIN_KEY) || this.best.score > 0
    this.accentOn = this.shot === 'front'
    this.car.setLivery(this.accentOn)
    this.ui.setSkin(this.signal, this.accentOn)
    window.addEventListener('resize', this.onResize)
    window.addEventListener('pointerdown', () => this.audio.unlock())
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.mode === 'playing') this.togglePause()
    })
    if (this.debug) window.addEventListener('keydown', this.onDebug)
    const stored = loadQuality()
    const coarse = window.matchMedia('(pointer: coarse)').matches
    this.applyQuality(stored ?? (coarse ? 'medium' : 'high'), false)
    this.onResize()
    this.backToTitle()
  }

  start(): void {
    this.last = performance.now()
    requestAnimationFrame(this.frame)
    if (this.autostart) window.setTimeout(() => this.startRun(), 350)
  }

  private tick(dt: number): void {
    this.time += dt
    this.suppress = Math.max(0, this.suppress - dt)
    if (this.input.muteEdge) this.toggleMute()
    if (this.input.pauseEdge && (this.mode === 'playing' || this.mode === 'paused')) this.togglePause()
    if ((this.mode === 'title' || this.mode === 'score') && (this.input.startEdge || this.input.jumpEdge)) this.startRun()

    if (this.mode === 'paused' || this.mode === 'score') {
      this.audio.update(this.player.speed, this.mode === 'paused' ? 'paused' : 'score', false, false, false, false, false)
      this.composer.render()
      this.input.consume()
      return
    }

    if (this.mode === 'replay') this.updateReplay(dt)
    else this.updateLive(dt)

    this.updateWorld(dt)
    this.updateCamera(dt)
    this.updatePost()
    this.composer.render()
    this.sampleFps(dt)
    this.input.consume()
  }

  private updateLive(dt: number): void {
    const playing = this.mode === 'playing'
    const input = playing ? this.readInput() : this.attractInput()
    const ludi = this.player.ludicrous > 0
    const worldDt = dt * (ludi ? 0.46 : 1)
    const events = this.sim.update(worldDt, dt, input, !playing)
    this.handleEvents(events)
    if (playing) {
      const dz = this.player.z - this.lastZ
      if (dz > 0) this.score += dz * (5 + this.combo * 1.5) * (ludi ? 2 : 1)
      this.topSpeed = Math.max(this.topSpeed, this.player.speed)
      if (this.combo > 1 && !ludi) {
        this.comboTimer -= dt
        if (this.comboTimer <= 0) {
          this.combo = 1
          this.comboTimer = 0
        }
      }
      const showHint = !this.didJump && this.player.z > 12 && this.player.z < 250
      this.ui.setHint(showHint ? (document.body.classList.contains('touch') ? 'HOLD JUMP TO FIRE COLD-GAS THRUSTERS' : 'HOLD SPACE — COLD-GAS THRUSTERS') : '')
    }
    if (this.beauty) {
      this.player.x = 0
      this.player.z = 8
      this.player.vx = 0
      this.player.vy = 0
      this.player.speed = this.shot === 'rear' ? 32 : 0
      this.player.y = this.shot === 'rear' ? 0.22 : 0
      this.player.onGround = this.shot !== 'rear'
      this.player.boosting = this.shot === 'rear'
      this.car.setDoors(this.shot === 'side' ? 1 : 0)
    }
    this.lastZ = this.player.z
    this.placeCar(dt)
    this.spawnExhaust(dt)
    if (playing || this.mode === 'title') this.paintHud()
  }

  private readInput() {
    return {
      steer: this.input.steer(),
      gas: this.input.gas,
      brake: this.input.brake,
      jumpEdge: this.suppress > 0 ? false : this.input.jumpEdge,
      jumpHeld: this.suppress > 0 ? false : this.input.jumpHeld,
      rollLeft: this.input.rollLeftEdge,
      rollRight: this.input.rollRightEdge,
    }
  }

  private attractInput() {
    let steer = Math.sin(this.time * 0.35) * 0.3
    let best = 48
    for (const v of this.sim.vehicles) {
      if (!v.active) continue
      const dz = v.z - this.player.z
      if (dz < 4 || dz > 46 || dz > best) continue
      if (Math.abs(v.x - this.player.x) < 2.2) {
        best = dz
        steer = this.player.x >= v.x ? 1 : -1
      }
    }
    return { steer, gas: false, brake: false, jumpEdge: false, jumpHeld: false, rollLeft: false, rollRight: false }
  }

  private handleEvents(events: GameEvent[]): void {
    for (const e of events) {
      if (e.type === 'land') {
        this.onLand(e.impact)
        continue
      }
      if (e.type === 'crash' && this.mode === 'playing') {
        this.beginReplay()
        continue
      }
      if (this.mode !== 'playing') continue
      this.onPlayEvent(e)
    }
  }

  private onPlayEvent(e: GameEvent): void {
    const m = this.mult()
    switch (e.type) {
      case 'jump':
        this.didJump = true
        this.audio.jump()
        break
      case 'nearmiss':
        this.addCombo()
        this.near++
        this.score += 250 * m
        this.audio.whoosh()
        this.ui.toast(`NEAR MISS  x${this.combo}`)
        this.shake = Math.max(this.shake, 0.08)
        break
      case 'vault':
        this.addCombo()
        this.vaults++
        this.score += vaultPoints(e.tier) * m
        this.audio.whoosh()
        this.ui.toast(`${vaultLabel(e.tier)}  x${this.combo}`, e.tier === 'close' ? 'epic' : 'good')
        this.fx.burst(e.x, 1.2, e.z, 10, 5, 1, 0.85, 0.4, 0.35)
        if (e.tier === 'close') this.flash = Math.max(this.flash, 0.18)
        break
      case 'flip':
        this.addCombo()
        this.flips++
        this.score += 1000 * m
        this.audio.roll()
        this.ui.toast(`CLEAN FLIP  x${this.combo}`, 'epic')
        break
      case 'coin':
        this.coins++
        this.score += 40 * m
        if (this.combo > 1) this.comboTimer = COMBO_TIME
        if (this.time - this.lastCoinSfx > 0.07) {
          this.audio.coin()
          this.lastCoinSfx = this.time
        }
        break
      case 'boost':
        this.score += 80 * m
        this.audio.pickup()
        this.ui.toast('+ BOOST')
        break
      case 'shield':
        this.audio.shield()
        if (e.fresh) this.ui.toast('SHIELD')
        else {
          this.score += 200 * m
          this.ui.toast('SHIELD MAX')
        }
        break
      case 'magnet':
        this.score += 80 * m
        this.audio.pickup()
        this.ui.toast('MAGNET')
        break
      case 'ludicrous':
        this.audio.ludicrous()
        this.ui.banner('LUDICROUS MODE', '#ff4ad4')
        this.ui.toast('TIME SLOWS', 'epic')
        this.flash = Math.max(this.flash, 0.22)
        break
      case 'ramp':
        this.addCombo()
        this.score += 150 * m
        this.audio.jump()
        this.ui.toast('RAMP')
        break
      case 'shield-break':
        this.audio.shield()
        this.ui.toast('SHIELD BREAK', 'warn')
        this.shake = Math.max(this.shake, 0.45)
        this.flash = Math.max(this.flash, 0.28)
        this.fx.burst(this.player.x, this.player.y + 0.8, this.player.z, 18, 8, 0.5, 1.4, 1.6, 0.4)
        break
      case 'scrape':
        this.audio.land(false)
        this.fx.burst(e.x, 0.3, e.z, 8, 5, 1, 0.6, 0.3, 0.25)
        break
      case 'police':
        this.ui.banner('POLICE CHASE', '#ff3355')
        break
      case 'escaped':
        this.addCombo()
        this.score += 2000 * m
        this.ui.banner('ESCAPED', '#7af6ff')
        this.ui.toast('LOST THEM', 'epic')
        break
      case 'storm':
        this.ui.banner('STORM FRONT', '#9ecbff')
        break
      case 'tunnel':
        this.ui.banner('NEON TUNNEL', '#ff4ad4')
        this.audio.whoosh()
        break
      case 'rocket':
        this.ui.banner('ORBITAL LAUNCH', '#ffc857')
        this.audio.rocket()
        this.world.rocket.launch(this.player.x > 0 ? -34 : 34, this.player.z + 48)
        this.shake = Math.max(this.shake, 0.2)
        break
      case 'km':
        this.score += 500 * this.combo
        this.ui.toast(`${e.n} KM`, 'epic')
        break
      default:
        break
    }
  }

  private onLand(impact: number): void {
    if (impact > -6) {
      this.audio.land(false)
      return
    }
    const hard = impact < -11
    this.audio.land(hard)
    this.shake = Math.max(this.shake, clamp(-impact / 16, 0.2, 1))
    this.fx.burst(this.player.x, 0.25, this.player.z, hard ? 28 : 16, hard ? 9 : 6, 1, 0.55, 0.2, 0.4)
    this.fx.shockwave(this.player.x, this.player.z)
    if (navigator.vibrate) navigator.vibrate(hard ? 18 : 10)
  }

  private addCombo(): void {
    this.combo = Math.min(COMBO_MAX, this.combo + 1)
    this.bestCombo = Math.max(this.bestCombo, this.combo)
    this.comboTimer = COMBO_TIME
    if (this.combo === 5) this.ui.banner('ON A TEAR', '#7af6ff')
    if (this.combo === 8) this.ui.banner('UNSTOPPABLE', '#ff3d9a')
    if (this.combo === 12) this.ui.banner('PURE RAMPAGE', '#ffc857')
  }

  private mult(): number {
    return this.combo * (this.player.ludicrous > 0 ? 2 : 1)
  }

  private beginReplay(): void {
    this.mode = 'replay'
    this.ui.setMode('replay')
    this.replayT = 0
    this.player.vy = Math.max(2, Math.abs(this.player.vy) * 0.2)
    this.car.lean.rotation.set(0, 0, 0)
    this.audio.crash()
    this.shake = 1
    this.flash = 0.65
    this.fx.burst(this.player.x, this.player.y + 0.6, this.player.z, 36, 12, 1, 0.35, 0.15, 0.55)
    if (navigator.vibrate) navigator.vibrate([30, 40, 80])
    this.ui.setHint('')
  }

  private updateReplay(dt: number): void {
    this.replayT += dt
    const s = dt * 0.34
    this.player.vy -= 9 * s
    this.player.y = Math.max(0.12, this.player.y + this.player.vy * s)
    this.car.root.position.set(this.player.x, this.player.y, this.player.z)
    this.car.root.rotation.x += 2.5 * s
    this.car.root.rotation.z += 3.2 * s
    this.car.root.rotation.y += 0.5 * s
    if (Math.random() < 0.55) this.fx.burst(this.player.x, this.player.y + 0.4, this.player.z, 2, 3.5, 1, 0.4, 0.15, 0.22)
    const ang = 0.5 + this.replayT * 0.48
    const rad = 6.4 + this.replayT * 0.4
    this.camPos.set(this.player.x + Math.sin(ang) * rad, this.player.y + 2.15, this.player.z + Math.cos(ang) * rad * 0.72)
    this.look.set(this.player.x, this.player.y + 0.55, this.player.z)
    this.world.camera.position.copy(this.camPos)
    this.world.camera.lookAt(this.look)
    this.world.camera.fov = 56
    this.world.camera.updateProjectionMatrix()
    this.paintHud()
    if (this.replayT > 3.2) this.finishRun()
  }

  private finishRun(): void {
    if (this.finished) return
    this.finished = true
    this.mode = 'score'
    this.ui.setMode('score')
    const isRecord = this.score > this.best.score
    if (isRecord) {
      this.best = { score: Math.floor(this.score), distance: this.player.z, combo: this.bestCombo }
      saveSave(this.best)
      this.ui.setBest(this.best)
    }
    if (!this.signal) {
      this.signal = true
      try { localStorage.setItem(SKIN_KEY, '1') } catch { /* ignore */ }
      this.ui.setSkin(true, this.accentOn)
    }
    let flavor = FLAVOR[Math.floor(Math.random() * FLAVOR.length)]!
    if (this.sim.policeT > 0) flavor = 'The chase ends under neon.'
    else if (this.sim.rainT > 0) flavor = 'The storm collects.'
    else if (this.player.y > 1.2) flavor = 'Gravity always gets a vote.'
    this.ui.showScore({
      score: this.score,
      best: this.best,
      isRecord,
      distance: this.player.z,
      topSpeed: this.topSpeed,
      combo: this.bestCombo,
      near: this.near,
      vaults: this.vaults,
      flips: this.flips,
      coins: this.coins,
      flavor,
    })
  }

  private startRun(): void {
    if (this.mode === 'playing') return
    this.audio.unlock()
    this.sim.reset()
    this.finished = false
    this.mode = 'playing'
    this.ui.setMode('playing')
    this.score = 0
    this.combo = 1
    this.comboTimer = 0
    this.bestCombo = 1
    this.near = 0
    this.vaults = 0
    this.flips = 0
    this.coins = 0
    this.topSpeed = this.player.speed
    this.lastZ = 0
    this.didJump = false
    this.snapCam = true
    this.suppress = 0.3
    this.car.root.rotation.set(0, 0, 0)
    this.car.lean.rotation.set(0, 0, 0)
    this.ui.resetScoreTicker(0)
    this.ui.setHint('')
  }

  private backToTitle(): void {
    this.sim.reset()
    this.finished = false
    this.mode = 'title'
    this.ui.setMode('title')
    this.snapCam = true
    this.car.root.rotation.set(0, 0, 0)
    this.car.lean.rotation.set(0, 0, 0)
    this.lastZ = 0
  }

  private togglePause(): void {
    if (this.mode === 'playing') {
      this.mode = 'paused'
      this.ui.setMode('paused')
    } else if (this.mode === 'paused') {
      this.mode = 'playing'
      this.ui.setMode('playing')
    }
  }

  private toggleMute(): void {
    const muted = this.audio.toggleMute()
    this.ui.setMuted(muted)
    try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0') } catch { /* ignore */ }
  }

  private placeCar(dt: number): void {
    const p = this.player
    const bob = p.onGround ? Math.sin(p.z * 0.85) * 0.012 : 0
    this.car.root.rotation.set(0, 0, 0)
    this.car.root.position.set(p.x, p.y + bob, p.z)
    this.car.root.updateMatrixWorld(true)
    this.car.update(dt, {
      speed: p.speed,
      boosting: p.boosting,
      braking: p.brake,
      steer: p.steer,
      airborne: !p.onGround,
      rolling: p.rolling,
      rollDir: p.rollDir,
      rollT: p.rollT,
      shield: p.shield,
      magnet: p.magnet > 0,
      ludicrous: p.ludicrous,
      time: this.time,
    })
    this.car.setPitchFromVelocity(p.vy, !p.onGround, p.boosting, dt)
    this.car.updateShadow(p.x, p.y, p.z)
  }

  private spawnExhaust(dt: number): void {
    const p = this.player
    if (p.speed < 4 || this.mode === 'replay') return
    const rate = p.boosting ? 1 : dt > 0.02 ? 1 : Math.random() < 0.7 ? 1 : 0
    if (!rate) return
    this.car.exhaustDir(this.exhaustDir)
    for (let i = 0; i < this.car.nozzleCount; i++) {
      this.car.nozzleWorld(i, this.nozzle)
      this.fx.exhaust(
        this.nozzle.x, this.nozzle.y, this.nozzle.z,
        this.exhaustDir.x * (p.boosting ? 10 : 4),
        this.exhaustDir.y * 4,
        this.exhaustDir.z * (p.boosting ? 10 : 4),
        p.boosting,
      )
    }
    if (this.world.rocket.active && Math.random() < 0.8) {
      this.world.rocket.flamePosition(this.nozzle)
      this.fx.exhaust(this.nozzle.x, this.nozzle.y, this.nozzle.z, (Math.random() - 0.5) * 2, -6, (Math.random() - 0.5) * 2, true)
    }
  }

  private updateWorld(dt: number): void {
    if (this.sim.rainT > 0 && this.mode === 'playing' && Math.random() < dt * 0.22) {
      this.lightning = 1
      this.audio.thunder()
      this.shake = Math.max(this.shake, 0.16)
    }
    this.lightning = Math.max(0, this.lightning - dt * 2.6)
    this.flash = Math.max(0, this.flash - dt * 2.2)
    this.world.update(dt, this.player, this.sim.rainT > 0, this.sim.inTunnel, this.lightning)
    this.fx.update(dt, this.player.x, this.player.z, this.sim.rainT > 0, this.player.speed)
    const mode = this.mode === 'title' ? 'title' : this.mode === 'replay' ? 'replay' : 'playing'
    this.audio.update(this.player.speed, mode, this.sim.inTunnel, this.sim.rainT > 0, this.sim.policeT > 0, this.player.ludicrous > 0, this.player.gas)
  }

  private updateCamera(dt: number): void {
    if (this.mode === 'replay') return
    const p = this.player
    if (this.beauty) {
      const cam = this.world.camera
      cam.up.set(0, 1, 0)
      if (this.shot === 'side') {
        cam.position.set(p.x - 5.1, 0.82, p.z + 0.2)
        cam.lookAt(p.x + 0.1, 0.46, p.z)
        cam.fov = 26
      } else if (this.shot === 'rear') {
        cam.position.set(p.x + 0.15, 1.05, p.z - 4.6)
        cam.lookAt(p.x, 0.48, p.z - 0.2)
        cam.fov = 30
      } else {
        cam.position.set(p.x + 3.2, 0.95, p.z + 3.5)
        cam.lookAt(p.x + 0.05, 0.42, p.z + 0.1)
        cam.fov = 30
      }
      cam.updateProjectionMatrix()
      return
    }
    const speedN = clamp((p.speed - 28) / 70, 0, 1)
    const title = this.mode === 'title'
    const back = title ? 11.2 : 7.5 - speedN * 0.7
    const height = (title ? 3.35 : 2.45) + p.y * 0.42 + speedN * 0.15
    this.desired.set(p.x * (title ? 0.35 : 0.72), height, p.z - back)
    this.desiredLook.set(p.x * 0.85, 0.9 + p.y * 0.38, p.z + (title ? 6 : 12 + speedN * 8))
    if (this.snapCam) {
      this.camPos.copy(this.desired)
      this.look.copy(this.desiredLook)
      this.snapCam = false
    } else {
      const k = 1 - Math.exp(-3.4 * dt)
      this.camPos.lerp(this.desired, k)
      this.look.lerp(this.desiredLook, k)
    }
    this.shake = Math.max(0, this.shake - dt * 1.7)
    const s = this.shake * this.shake
    const cam = this.world.camera
    cam.position.set(
      this.camPos.x + (Math.random() - 0.5) * s * 0.65,
      this.camPos.y + (Math.random() - 0.5) * s * 0.4,
      this.camPos.z,
    )
    cam.up.set(0, 1, 0)
    cam.lookAt(this.look)
    const roll = (-p.steer * 0.045) + (p.rolling ? 0 : this.car.lean.rotation.z * -0.12)
    cam.rotateZ(roll)
    const targetFov = (title ? 62 : 66) + speedN * 16 + (p.boosting ? 5 : 0) + (p.ludicrous > 0 ? 8 : 0)
    cam.fov += (targetFov - cam.fov) * (1 - Math.exp(-4 * dt))
    cam.updateProjectionMatrix()
  }

  private updatePost(): void {
    const speedN = clamp((this.player.speed - 24) / 75, 0, 1)
    const night = 1 - clamp((Math.cos(((this.player.z % 11000) / 11000) * Math.PI * 2) * 0.5 + 0.5), 0, 1)
    const ludi = this.player.ludicrous > 0 ? 1 : 0
    this.bokeh.enabled = this.high && !this.beauty
    this.bloom.strength = (this.beauty ? 0.08 : 0.12) + ludi * 0.14
    this.bloom.threshold = ludi ? 1.2 : 1.7
    this.bloom.radius = 0.35 + ludi * 0.08
    const u = this.speedPass.uniforms
    const set = (name: string, value: number) => {
      const slot = u[name]
      if (slot) slot.value = value
    }
    set('uSpeed', this.mode === 'replay' ? 0.25 : speedN)
    set('uTime', this.time)
    set('uLudi', ludi)
    set('uFlash', Math.max(this.flash, this.lightning * 0.55))
    const focus = this.world.camera.position.distanceTo(this.beauty ? this.car.root.position : this.look)
    const bu = this.bokeh.uniforms as Record<string, { value: number }>
    bu['focus']!.value = Math.max(1.2, focus)
    bu['aperture']!.value = this.high ? (this.beauty ? 0.00035 : 0.00016) : 0
    bu['maxblur']!.value = this.beauty ? 0.012 : 0.005
  }

  private paintHud(): void {
    this.ui.update({
      score: this.score,
      speed: this.player.speed,
      distance: this.player.z,
      combo: this.combo,
      comboFrac: this.combo > 1 ? this.comboTimer / COMBO_TIME : 0,
      boost: this.player.boost,
      shield: this.player.shield,
      magnet: this.player.magnet > 0,
      ludicrous: this.player.ludicrous > 0,
      lowBoost: this.player.boost < 18,
    })
    this.ui.drawRadar(
      this.player.x,
      this.player.z,
      this.sim.vehicles.map((v) => ({ x: v.x, z: v.z, active: v.active, police: v.kind === 'police' })),
      [
        ...this.sim.coins.map((c) => ({ x: c.x, z: c.z, active: c.active })),
        ...this.sim.powerups.map((c) => ({ x: c.x, z: c.z, active: c.active })),
      ],
      this.sim.ramps.map((r) => ({ x: r.x, z: r.z, active: r.active })),
    )
  }

  private sampleFps(dt: number): void {
    if (this.qualityChecked) return
    this.warmup += dt
    if (this.warmup < 2.5) return
    this.fpsAccum += dt
    this.fpsFrames++
    if (this.fpsAccum < 1.6) return
    const fps = this.fpsFrames / this.fpsAccum
    if (fps < 50 && this.high) {
      this.applyQuality('medium', true)
      this.ui.toast('MEDIUM QUALITY', 'warn')
    } else if (fps < 52 && this.pixelCap > 1) {
      this.pixelCap = 1
      this.onResize()
    }
    this.qualityChecked = true
    console.info(`Roadster Rampage ${fps.toFixed(0)} fps`)
  }

  private toggleSkin(): void {
    if (!this.signal) {
      this.ui.toast('FINISH A RUN TO UNLOCK SIGNAL', 'warn')
      return
    }
    this.accentOn = !this.accentOn
    this.car.setLivery(this.accentOn)
    this.ui.setSkin(true, this.accentOn)
  }

  private toggleQuality(): void {
    this.applyQuality(this.high ? 'medium' : 'high', true)
  }

  private applyQuality(level: 'high' | 'medium', persist: boolean): void {
    this.high = level === 'high'
    this.pixelCap = this.high ? 1.25 : 1
    this.ssao.enabled = this.high
    this.bokeh.enabled = this.high
    this.world.setQuality(this.high)
    this.car.setHeadlightShadows(this.high)
    this.ui.setQuality(this.high)
    if (persist) {
      try { localStorage.setItem(QUALITY_KEY, level) } catch { /* ignore */ }
    }
    this.onResize()
  }

  private readonly onResize = (): void => {
    const coarse = window.matchMedia('(pointer: coarse)').matches
    const pr = Math.min(window.devicePixelRatio || 1, coarse ? 1.05 : this.pixelCap)
    this.world.resize(pr)
    this.composer.setPixelRatio(pr)
    this.composer.setSize(window.innerWidth, window.innerHeight)
    const slot = this.speedPass.uniforms['uAspect']
    if (slot) slot.value = window.innerWidth / Math.max(1, window.innerHeight)
  }

  private readonly onDebug = (e: KeyboardEvent): void => {
    if (e.code === 'KeyL') this.player.ludicrous = 6.5
    if (e.code === 'KeyG') this.player.shield = true
    if (e.code === 'KeyB') this.player.boost = 100
    if (e.code === 'KeyN') this.player.z += 4000
    if (e.code === 'KeyK') {
      this.world.rocket.launch(34, this.player.z + 40)
      this.audio.rocket()
    }
  }
}

function vaultPoints(tier: VaultTier): number {
  if (tier === 'close') return 900
  if (tier === 'fly') return 220
  return 450
}

function vaultLabel(tier: VaultTier): string {
  if (tier === 'close') return 'CLOSE VAULT'
  if (tier === 'fly') return 'FLYOVER'
  return 'VAULT'
}

function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(SAVE_KEY)
    if (!raw) return { score: 0, distance: 0, combo: 0 }
    const parsed = JSON.parse(raw) as Partial<SaveData>
    return {
      score: Number(parsed.score) || 0,
      distance: Number(parsed.distance) || 0,
      combo: Number(parsed.combo) || 0,
    }
  } catch {
    return { score: 0, distance: 0, combo: 0 }
  }
}

function saveSave(data: SaveData): void {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)) } catch { /* ignore */ }
}

function loadMute(): boolean {
  try { return localStorage.getItem(MUTE_KEY) === '1' } catch { return false }
}

function loadFlag(key: string): boolean {
  try { return localStorage.getItem(key) === '1' } catch { return false }
}

function loadQuality(): 'high' | 'medium' | null {
  try {
    const value = localStorage.getItem(QUALITY_KEY)
    if (value === 'high' || value === 'medium') return value
  } catch { /* ignore */ }
  return null
}

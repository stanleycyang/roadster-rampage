import { ROAD_HALF } from './config.ts'
import { formatDist, formatInt, formatKmh } from './util.ts'
import type { SaveData } from './types.ts'

export interface HudState {
  score: number
  speed: number
  distance: number
  combo: number
  comboFrac: number
  boost: number
  shield: boolean
  magnet: boolean
  overdrive: boolean
  lowBoost: boolean
}

export interface ScoreView {
  score: number
  best: SaveData
  isRecord: boolean
  distance: number
  topSpeed: number
  combo: number
  near: number
  vaults: number
  flips: number
  coins: number
  flavor: string
}

type Mode = 'title' | 'playing' | 'paused' | 'replay' | 'score'

export class UI {
  private readonly scoreVal = this.must('scoreVal')
  private readonly speedVal = this.must('speedVal')
  private readonly distVal = this.must('distVal')
  private readonly comboEl = this.must('combo')
  private readonly comboFill = this.must('comboFill')
  private readonly comboWrap = this.must('comboWrap')
  private readonly bannerEl = this.must('eventBanner')
  private readonly hintEl = this.must('hint')
  private readonly boostFill = this.must('boostFill')
  private readonly boostCluster = this.must('boostCluster')
  private readonly shieldBadge = this.must('shieldBadge')
  private readonly magnetBadge = this.must('magnetBadge')
  private readonly overdriveBadge = this.must('overdriveBadge')
  private readonly hud = this.must('hud')
  private readonly toasts = this.must('toasts')
  private readonly titleBest = this.must('titleBest')
  private readonly scoreFlavor = this.must('scoreFlavor')
  private readonly scoreBig = this.must('scoreBig')
  private readonly newRecord = this.must('newRecord')
  private readonly scoreGrid = this.must('scoreGrid')
  private readonly scoreBest = this.must('scoreBest')
  private readonly muteBtn = this.must('muteBtn') as HTMLButtonElement
  private readonly radar = this.must('radar') as HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private bannerTimer = 0
  private lastCombo = 1
  private shownScore = 0

  constructor(handlers: { start: () => void; restart: () => void; resume: () => void; menu: () => void; mute: () => void; pause: () => void; quality: () => void; skin: () => void }) {
    const rctx = this.radar.getContext('2d')
    if (!rctx) throw new Error('Radar unavailable')
    this.ctx = rctx
    this.must('startBtn').addEventListener('click', handlers.start)
    this.must('restartBtn').addEventListener('click', handlers.restart)
    this.must('resumeBtn').addEventListener('click', handlers.resume)
    this.must('menuBtn').addEventListener('click', handlers.menu)
    this.must('pauseBtn').addEventListener('click', handlers.pause)
    this.muteBtn.addEventListener('click', handlers.mute)
    this.must('qualityBtn').addEventListener('click', handlers.quality)
    this.must('skinBtn').addEventListener('click', handlers.skin)
    const touch = window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0 || window.innerWidth < 780
    if (touch) document.body.classList.add('touch')
  }

  private must(id: string): HTMLElement {
    const el = document.getElementById(id)
    if (!el) throw new Error(`Missing #${id}`)
    return el
  }

  setMode(mode: Mode): void {
    document.body.classList.remove('mode-title', 'mode-playing', 'mode-paused', 'mode-replay', 'mode-score')
    const cls = mode === 'playing' ? 'mode-playing' : mode === 'paused' ? 'mode-paused' : mode === 'replay' ? 'mode-replay' : mode === 'score' ? 'mode-score' : 'mode-title'
    document.body.classList.add(cls)
  }

  setMuted(muted: boolean): void {
    this.muteBtn.textContent = muted ? 'Muted' : 'Sound'
    this.muteBtn.classList.toggle('is-muted', muted)
  }

  setSkin(unlocked: boolean, signal: boolean): void {
    const btn = this.must('skinBtn')
    btn.textContent = !unlocked ? 'Signal locked' : signal ? 'Signal red' : 'Pearl white'
    btn.classList.toggle('is-locked', !unlocked)
  }

  setQuality(high: boolean): void {
    const btn = this.must('qualityBtn')
    btn.textContent = high ? 'High' : 'Medium'
    btn.classList.toggle('is-medium', !high)
  }

  setBest(save: SaveData): void {
    this.titleBest.textContent = save.score > 0
      ? `Best ${formatInt(save.score)} · ${formatDist(save.distance)}`
      : 'No record yet — the night is undefeated'
  }

  setHint(text: string): void {
    if (this.hintEl.textContent !== text) this.hintEl.textContent = text
    this.hintEl.classList.toggle('show', text.length > 0)
  }

  update(state: HudState): void {
    this.shownScore += (state.score - this.shownScore) * 0.2
    if (Math.abs(state.score - this.shownScore) < 1) this.shownScore = state.score
    this.scoreVal.textContent = formatInt(this.shownScore)
    this.speedVal.textContent = formatKmh(state.speed)
    this.distVal.textContent = formatDist(state.distance)
    this.comboEl.textContent = `x${state.combo}`
    this.comboFill.style.transform = `scaleX(${state.combo > 1 ? state.comboFrac : 0})`
    this.comboWrap.classList.toggle('hot', state.combo > 1)
    this.comboWrap.classList.toggle('insane', state.combo >= 8)
    if (state.combo !== this.lastCombo) {
      this.comboEl.classList.remove('pop')
      void this.comboEl.offsetWidth
      this.comboEl.classList.add('pop')
      this.lastCombo = state.combo
    }
    this.boostFill.style.transform = `scaleX(${Math.max(0, Math.min(1, state.boost / 100))})`
    this.boostCluster.classList.toggle('low', state.lowBoost)
    this.shieldBadge.classList.toggle('on', state.shield)
    this.magnetBadge.classList.toggle('on', state.magnet)
    this.overdriveBadge.classList.toggle('on', state.overdrive)
    this.hud.classList.toggle('overdrive', state.overdrive)
  }

  resetScoreTicker(score: number): void {
    this.shownScore = score
    this.lastCombo = 1
  }

  banner(text: string, color: string): void {
    this.bannerEl.textContent = text
    this.bannerEl.style.color = color
    this.bannerEl.classList.remove('show')
    void this.bannerEl.offsetWidth
    this.bannerEl.classList.add('show')
    window.clearTimeout(this.bannerTimer)
    this.bannerTimer = window.setTimeout(() => this.bannerEl.classList.remove('show'), 1700)
  }

  toast(text: string, kind: 'good' | 'epic' | 'warn' = 'good'): void {
    const el = document.createElement('div')
    el.className = `toast ${kind}`
    el.textContent = text
    this.toasts.appendChild(el)
    while (this.toasts.children.length > 4) this.toasts.firstElementChild?.remove()
    window.setTimeout(() => el.remove(), 1200)
  }

  flash(strength: number): void {
    const el = this.must('flash')
    el.style.transition = 'none'
    el.style.opacity = String(strength)
    requestAnimationFrame(() => {
      el.style.transition = 'opacity 0.45s ease'
      el.style.opacity = '0'
    })
  }

  showScore(view: ScoreView): void {
    this.scoreFlavor.textContent = view.flavor
    this.scoreBig.textContent = formatInt(view.score)
    this.newRecord.classList.toggle('show', view.isRecord)
    const rows: Array<[string, string]> = [
      ['Distance', formatDist(view.distance)],
      ['Top speed', `${formatKmh(view.topSpeed)} km/h`],
      ['Best combo', `x${view.combo}`],
      ['Near misses', formatInt(view.near)],
      ['Vaults', formatInt(view.vaults)],
      ['Flips', formatInt(view.flips)],
      ['Coins', formatInt(view.coins)],
    ]
    this.scoreGrid.replaceChildren(...rows.map(([k, v]) => {
      const cell = document.createElement('div')
      const label = document.createElement('span')
      label.textContent = k
      const val = document.createElement('b')
      val.textContent = v
      cell.append(label, val)
      return cell
    }))
    this.scoreBest.textContent = view.best.score > 0 ? `Record ${formatInt(view.best.score)}` : ''
  }

  drawRadar(px: number, pz: number, cars: Array<{ x: number; z: number; active: boolean; police: boolean }>, picks: Array<{ x: number; z: number; active: boolean }>, ramps: Array<{ x: number; z: number; active: boolean }>): void {
    const ctx = this.ctx
    const w = this.radar.width
    const h = this.radar.height
    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = 'rgba(8, 2, 16, 0.2)'
    ctx.fillRect(0, 0, w, h)
    ctx.strokeStyle = 'rgba(122, 246, 255, 0.25)'
    ctx.lineWidth = 1
    for (let i = 0; i < 5; i++) {
      const x = ((i - 2) / 2) * (w * 0.36) + w / 2
      ctx.beginPath()
      ctx.moveTo(x, 18)
      ctx.lineTo(x, h - 14)
      ctx.stroke()
    }
    ctx.fillStyle = 'rgba(122,246,255,0.75)'
    ctx.font = '11px Rajdhani, sans-serif'
    ctx.fillText('AHEAD', 8, 14)
    const range = 110
    const xTo = (x: number) => (x / ROAD_HALF) * (w * 0.4) + w / 2
    const zTo = (dz: number) => h * 0.84 - (dz / range) * (h * 0.72)
    const blot = (x: number, z: number, color: string, rw: number, rh: number) => {
      const dz = z - pz
      if (dz < -18 || dz > range) return
      ctx.fillStyle = color
      ctx.fillRect(xTo(x) - rw / 2, zTo(dz) - rh / 2, rw, rh)
    }
    for (const r of ramps) if (r.active) blot(r.x, r.z, '#ffc857', 14, 6)
    for (const c of picks) if (c.active) blot(c.x, c.z, '#7af6ff', 4, 4)
    for (const car of cars) if (car.active) blot(car.x, car.z, car.police ? '#ff3355' : '#ff5d7a', 7, 10)
    ctx.fillStyle = '#f4fbff'
    ctx.beginPath()
    const py = zTo(0)
    const pxp = xTo(px)
    ctx.moveTo(pxp, py - 7)
    ctx.lineTo(pxp + 5, py + 6)
    ctx.lineTo(pxp - 5, py + 6)
    ctx.closePath()
    ctx.fill()
  }
}

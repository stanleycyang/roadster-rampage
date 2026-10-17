import { clamp } from './util.ts'

interface Held {
  left: boolean
  right: boolean
  gas: boolean
  brake: boolean
  jump: boolean
}

export class Input {
  jumpEdge = false
  rollLeftEdge = false
  rollRightEdge = false
  leftEdge = false
  rightEdge = false
  muteEdge = false
  pauseEdge = false
  startEdge = false
  private readonly held: Held = { left: false, right: false, gas: false, brake: false, jump: false }

  constructor() {
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    this.bindButton('btnLeft', 'left')
    this.bindButton('btnRight', 'right')
    this.bindButton('btnGas', 'gas')
    this.bindButton('btnBrake', 'brake')
    this.bindButton('btnJump', 'jump')
  }

  steer(): number {
    let s = 0
    if (this.held.left) s -= 1
    if (this.held.right) s += 1
    return clamp(s, -1, 1)
  }

  get gas(): boolean {
    return this.held.gas
  }

  get brake(): boolean {
    return this.held.brake
  }

  get jumpHeld(): boolean {
    return this.held.jump
  }

  consume(): void {
    this.jumpEdge = false
    this.rollLeftEdge = false
    this.rollRightEdge = false
    this.leftEdge = false
    this.rightEdge = false
    this.muteEdge = false
    this.pauseEdge = false
    this.startEdge = false
  }

  private bindButton(id: string, action: keyof Held): void {
    const btn = document.getElementById(id)
    if (!btn) return
    const down = (e: PointerEvent) => {
      e.preventDefault()
      btn.setPointerCapture(e.pointerId)
      btn.classList.add('held')
      this.press(action, true)
    }
    const up = (e: PointerEvent) => {
      e.preventDefault()
      btn.classList.remove('held')
      this.press(action, false)
    }
    btn.addEventListener('pointerdown', down)
    btn.addEventListener('pointerup', up)
    btn.addEventListener('pointercancel', up)
  }

  private press(action: keyof Held, down: boolean): void {
    if (down && !this.held[action]) {
      if (action === 'jump') this.jumpEdge = true
      if (action === 'left') {
        this.leftEdge = true
        this.rollLeftEdge = true
      }
      if (action === 'right') {
        this.rightEdge = true
        this.rollRightEdge = true
      }
    }
    this.held[action] = down
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) return
    const block = ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']
    if (block.includes(e.code)) e.preventDefault()
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') this.press('left', true)
    if (e.code === 'ArrowRight' || e.code === 'KeyD') this.press('right', true)
    if (e.code === 'ArrowUp' || e.code === 'KeyW') this.press('gas', true)
    if (e.code === 'ArrowDown' || e.code === 'KeyS') this.press('brake', true)
    if (e.code === 'Space') this.press('jump', true)
    if (e.code === 'KeyQ') this.rollLeftEdge = true
    if (e.code === 'KeyE') this.rollRightEdge = true
    if (e.code === 'KeyM') this.muteEdge = true
    if (e.code === 'KeyP' || e.code === 'Escape') this.pauseEdge = true
    if (e.code === 'Enter') this.startEdge = true
    if (e.code === 'Space') this.startEdge = true
  }

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') this.press('left', false)
    if (e.code === 'ArrowRight' || e.code === 'KeyD') this.press('right', false)
    if (e.code === 'ArrowUp' || e.code === 'KeyW') this.press('gas', false)
    if (e.code === 'ArrowDown' || e.code === 'KeyS') this.press('brake', false)
    if (e.code === 'Space') this.press('jump', false)
  }
}

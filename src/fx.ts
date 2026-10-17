import * as THREE from 'three'

export class Effects {
  readonly points: THREE.Points
  readonly rain: THREE.Points
  readonly shock: THREE.Mesh
  private readonly count = 360
  private readonly pos: Float32Array
  private readonly vel: Float32Array
  private readonly life: Float32Array
  private readonly maxLife: Float32Array
  private readonly col: Float32Array
  private readonly base: Float32Array
  private cursor = 0
  private readonly rainCount = 380
  private readonly rainPos: Float32Array
  private shockT = 1
  private readonly shockMat: THREE.MeshBasicMaterial

  constructor() {
    this.pos = new Float32Array(this.count * 3)
    this.vel = new Float32Array(this.count * 3)
    this.life = new Float32Array(this.count)
    this.maxLife = new Float32Array(this.count)
    this.col = new Float32Array(this.count * 3)
    this.base = new Float32Array(this.count * 3)
    for (let i = 0; i < this.count; i++) this.pos[i * 3 + 1] = -999
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3))
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.22,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      sizeAttenuation: true,
      fog: false,
    }))
    this.points.frustumCulled = false

    this.rainPos = new Float32Array(this.rainCount * 3)
    const rainCol = new Float32Array(this.rainCount * 3)
    for (let i = 0; i < this.rainCount; i++) {
      this.rainPos[i * 3 + 1] = Math.random() * 16
      rainCol[i * 3] = 0.55
      rainCol[i * 3 + 1] = 0.72
      rainCol[i * 3 + 2] = 0.95
    }
    const rainGeo = new THREE.BufferGeometry()
    rainGeo.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3))
    rainGeo.setAttribute('color', new THREE.BufferAttribute(rainCol, 3))
    this.rain = new THREE.Points(rainGeo, new THREE.PointsMaterial({
      size: 0.13,
      vertexColors: true,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      toneMapped: false,
      sizeAttenuation: true,
      fog: false,
    }))
    this.rain.frustumCulled = false
    this.rain.visible = false

    this.shockMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color().setRGB(0.55, 1.5, 1.7),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      side: THREE.DoubleSide,
    })
    this.shock = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.04, 6, 28), this.shockMat)
    this.shock.rotation.x = Math.PI / 2
    this.shock.visible = false
    this.shock.renderOrder = 3
  }

  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, r: number, g: number, b: number, life: number): void {
    const i = this.cursor
    this.cursor = (this.cursor + 1) % this.count
    this.pos[i * 3] = x
    this.pos[i * 3 + 1] = y
    this.pos[i * 3 + 2] = z
    this.vel[i * 3] = vx
    this.vel[i * 3 + 1] = vy
    this.vel[i * 3 + 2] = vz
    this.life[i] = life
    this.maxLife[i] = life
    this.base[i * 3] = r
    this.base[i * 3 + 1] = g
    this.base[i * 3 + 2] = b
  }

  burst(x: number, y: number, z: number, count: number, speed: number, r: number, g: number, b: number, life: number): void {
    for (let n = 0; n < count; n++) {
      const a = Math.random() * Math.PI * 2
      const sp = speed * (0.35 + Math.random() * 0.85)
      this.spawn(
        x, y, z,
        Math.cos(a) * sp,
        Math.random() * sp,
        Math.sin(a) * sp,
        r, g, b,
        life * (0.55 + Math.random() * 0.7),
      )
    }
  }

  exhaust(x: number, y: number, z: number, dx: number, dy: number, dz: number, hot: boolean): void {
    const j = (s: number) => (Math.random() - 0.5) * s
    if (hot) this.spawn(x, y, z, dx + j(1.5), dy + Math.random(), dz + j(1.5), 0.4, 1.6, 1.9, 0.26 + Math.random() * 0.16)
    else this.spawn(x, y, z, dx + j(0.7), dy + 0.35, dz + j(0.7), 0.85, 0.45, 0.28, 0.2 + Math.random() * 0.1)
  }

  shockwave(x: number, z: number): void {
    this.shockT = 0
    this.shock.visible = true
    this.shock.position.set(x, 0.12, z)
  }

  update(dt: number, anchorX: number, anchorZ: number, raining: boolean, speed: number): void {
    for (let i = 0; i < this.count; i++) {
      if (this.life[i]! <= 0) continue
      this.life[i] = this.life[i]! - dt
      const f = this.life[i]! <= 0 ? 0 : this.life[i]! / this.maxLife[i]!
      if (f <= 0) {
        this.pos[i * 3 + 1] = -999
        this.col[i * 3] = 0
        this.col[i * 3 + 1] = 0
        this.col[i * 3 + 2] = 0
        continue
      }
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1]! - 16 * dt
      this.pos[i * 3] = this.pos[i * 3]! + this.vel[i * 3]! * dt
      this.pos[i * 3 + 1] = this.pos[i * 3 + 1]! + this.vel[i * 3 + 1]! * dt
      this.pos[i * 3 + 2] = this.pos[i * 3 + 2]! + this.vel[i * 3 + 2]! * dt
      this.col[i * 3] = this.base[i * 3]! * f
      this.col[i * 3 + 1] = this.base[i * 3 + 1]! * f
      this.col[i * 3 + 2] = this.base[i * 3 + 2]! * f
    }
    const posAttr = this.points.geometry.getAttribute('position') as THREE.BufferAttribute
    const colAttr = this.points.geometry.getAttribute('color') as THREE.BufferAttribute
    posAttr.needsUpdate = true
    colAttr.needsUpdate = true

    this.rain.visible = raining
    if (raining) {
      const slant = Math.min(30, speed * 0.25)
      for (let i = 0; i < this.rainCount; i++) {
        this.rainPos[i * 3 + 1] = this.rainPos[i * 3 + 1]! - 30 * dt
        this.rainPos[i * 3 + 2] = this.rainPos[i * 3 + 2]! - slant * dt
        if (this.rainPos[i * 3 + 1]! < 0 || this.rainPos[i * 3 + 2]! < anchorZ - 18) {
          this.rainPos[i * 3] = anchorX + (Math.random() - 0.5) * 36
          this.rainPos[i * 3 + 1] = 12 + Math.random() * 10
          this.rainPos[i * 3 + 2] = anchorZ - 6 + Math.random() * 62
        }
      }
      const rainAttr = this.rain.geometry.getAttribute('position') as THREE.BufferAttribute
      rainAttr.needsUpdate = true
    }

    if (this.shockT < 1) {
      this.shockT = Math.min(1, this.shockT + dt * 1.7)
      const s = 0.5 + this.shockT * 8
      this.shock.scale.set(s, s, s)
      this.shockMat.opacity = (1 - this.shockT) * 0.75
      if (this.shockT >= 1) this.shock.visible = false
    }
  }
}

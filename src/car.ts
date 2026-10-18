import * as THREE from 'three'

export interface CarVisual {
  speed: number
  boosting: boolean
  braking: boolean
  steer: number
  airborne: boolean
  rolling: boolean
  rollDir: number
  rollT: number
  shield: boolean
  magnet: boolean
  ludicrous: number
  time: number
}

interface St {
  z: number
  y0: number
  yB: number
  yS: number
  yT: number
  w0: number
  wB: number
  wS: number
  wT: number
}

/** Faceted wedge. Stations run from the tail toward the nose. */
const STS: St[] = [
  { z: -1.86, y0: 0.3, yB: 0.5, yS: 0.62, yT: 0.66, w0: 0.78, wB: 0.98, wS: 0.72, wT: 0.18 },
  { z: -1.25, y0: 0.18, yB: 0.46, yS: 0.82, yT: 0.96, w0: 0.92, wB: 1.04, wS: 0.8, wT: 0.36 },
  { z: -0.55, y0: 0.16, yB: 0.4, yS: 0.7, yT: 1.02, w0: 0.86, wB: 0.86, wS: 0.62, wT: 0.46 },
  { z: -0.05, y0: 0.16, yB: 0.42, yS: 0.64, yT: 0.98, w0: 0.86, wB: 0.98, wS: 0.66, wT: 0.5 },
  { z: 0.42, y0: 0.16, yB: 0.4, yS: 0.56, yT: 0.64, w0: 0.84, wB: 0.98, wS: 0.52, wT: 0.16 },
  { z: 1.15, y0: 0.16, yB: 0.38, yS: 0.5, yT: 0.54, w0: 0.82, wB: 1.02, wS: 0.42, wT: 0.06 },
  { z: 1.72, y0: 0.2, yB: 0.34, yS: 0.4, yT: 0.42, w0: 0.5, wB: 0.88, wS: 0.22, wT: 0.02 },
  { z: 2.02, y0: 0.24, yB: 0.3, yS: 0.32, yT: 0.33, w0: 0.16, wB: 0.36, wS: 0.06, wT: 0 },
]

const AXLE_Y = 0.34
const FRONT_Z = 1.18
const REAR_Z = -1.22

function ring(s: St): number[][] {
  return [
    [-s.w0, s.y0, s.z],
    [-s.wB, s.yB, s.z],
    [-s.wS, s.yS, s.z],
    [-s.wT, s.yT, s.z],
    [s.wT, s.yT, s.z],
    [s.wS, s.yS, s.z],
    [s.wB, s.yB, s.z],
    [s.w0, s.y0, s.z],
  ]
}

function pushTri(buf: number[], a: number[], b: number[], c: number[]): void {
  const ax = b[0]! - a[0]!
  const ay = b[1]! - a[1]!
  const az = b[2]! - a[2]!
  const bx = c[0]! - a[0]!
  const by = c[1]! - a[1]!
  const bz = c[2]! - a[2]!
  const nx = ay * bz - az * by
  const ny = az * bx - ax * bz
  const nz = ax * by - ay * bx
  const mx = (a[0]! + b[0]! + c[0]!) / 3
  const my = (a[1]! + b[1]! + c[1]!) / 3 - 0.48
  const mz = ((a[2]! + b[2]! + c[2]!) / 3) * 0.08
  if (nx * mx + ny * my + nz * mz < 0) buf.push(...a, ...c, ...b)
  else buf.push(...a, ...b, ...c)
}

function pushQuad(buf: number[], a: number[], b: number[], c: number[], d: number[]): void {
  const ax = b[0]! - a[0]!
  const ay = b[1]! - a[1]!
  const az = b[2]! - a[2]!
  const bx = d[0]! - a[0]!
  const by = d[1]! - a[1]!
  const bz = d[2]! - a[2]!
  const nx = ay * bz - az * by
  const ny = az * bx - ax * bz
  const nz = ax * by - ay * bx
  const mx = (a[0]! + b[0]! + c[0]! + d[0]!) * 0.25
  const my = (a[1]! + b[1]! + c[1]! + d[1]!) * 0.25 - 0.48
  const mz = (a[2]! + b[2]! + c[2]! + d[2]!) * 0.02
  if (nx * mx + ny * my + nz * mz < 0) buf.push(...a, ...d, ...c, ...a, ...c, ...b)
  else buf.push(...a, ...b, ...c, ...a, ...c, ...d)
}

type Band = 'lower' | 'accent' | 'pearl' | 'glass'

function bandOf(edge: number, z: number): Band {
  if (edge === 0 || edge === 6 || edge === 7) return 'lower'
  if (edge === 1 || edge === 5) return 'accent'
  const cabin = z < 0.38 && z > -1.02
  if (cabin) return 'glass'
  return 'pearl'
}

function buildBands(): Record<Band, THREE.BufferGeometry> {
  const bufs: Record<Band, number[]> = { lower: [], accent: [], pearl: [], glass: [] }
  const rings = STS.map(ring)
  for (let s = 0; s < rings.length - 1; s++) {
    const r0 = rings[s]!
    const r1 = rings[s + 1]!
    for (let i = 0; i < 8; i++) {
      const a = r0[i]!
      const b = r0[(i + 1) % 8]!
      const c = r1[(i + 1) % 8]!
      const d = r1[i]!
      const z = (a[2]! + d[2]!) * 0.5
      pushQuad(bufs[bandOf(i, z)], a, b, c, d)
    }
  }
  const cap = (section: number) => {
    const r = rings[section]!
    const st = STS[section]!
    const center = [0, (st.y0 + st.yT) * 0.5, st.z]
    for (let i = 0; i < 8; i++) {
      const a = r[i]!
      const b = r[(i + 1) % 8]!
      pushTri(bufs[bandOf(i, st.z)], center, a, b)
    }
  }
  cap(0)
  cap(STS.length - 1)

  const out = {} as Record<Band, THREE.BufferGeometry>
  for (const key of ['lower', 'accent', 'pearl', 'glass'] as const) {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(bufs[key], 3))
    geo.computeVertexNormals()
    out[key] = geo
  }
  return out
}

function plateTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 96
  const g = c.getContext('2d')!
  g.fillStyle = '#eceae4'
  g.fillRect(0, 0, 256, 96)
  g.strokeStyle = '#2a2a2a'
  g.lineWidth = 6
  g.strokeRect(4, 4, 248, 88)
  g.fillStyle = '#1a1a1a'
  g.font = '700 42px sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText('RDSTR', 128, 52)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.needsUpdate = true
  return tex
}

interface WheelRig {
  mount: THREE.Group
  steer: THREE.Group
  spin: THREE.Group
  z: number
  front: boolean
}

function makeWheel(discMat: THREE.Material, rubber: THREE.Material): WheelRig {
  const mount = new THREE.Group()
  const steer = new THREE.Group()
  const spin = new THREE.Group()
  mount.add(steer)
  steer.add(spin)
  const tireGeo = new THREE.TorusGeometry(0.29, 0.05, 10, 28)
  tireGeo.rotateY(Math.PI / 2)
  const tire = new THREE.Mesh(tireGeo, rubber)
  tire.castShadow = true
  spin.add(tire)
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.06, 28), discMat)
  disc.rotation.z = Math.PI / 2
  disc.castShadow = true
  spin.add(disc)
  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.06, 0.07, 16),
    new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.45, metalness: 0.6 }),
  )
  cap.rotation.z = Math.PI / 2
  spin.add(cap)
  return { mount, steer, spin, z: 0, front: false }
}

export class Roadster {
  readonly root = new THREE.Group()
  readonly lean = new THREE.Group()
  readonly shadow: THREE.Mesh
  readonly spot: THREE.SpotLight
  readonly nozzleCount = 4
  private readonly wheels: WheelRig[] = []
  private readonly jets: THREE.Mesh[] = []
  private readonly plumes: THREE.Mesh[] = []
  private readonly doors: THREE.Group[] = []
  private readonly wing: THREE.Group
  private readonly pearl: THREE.MeshPhysicalMaterial
  private readonly accent: THREE.MeshPhysicalMaterial
  private readonly lower: THREE.MeshPhysicalMaterial
  private readonly tailMat: THREE.MeshStandardMaterial
  private readonly headMat: THREE.MeshStandardMaterial
  private readonly shield: THREE.Group
  private readonly magnetRing: THREE.Mesh
  private readonly nozzles = [
    new THREE.Vector3(-0.54, 0.34, -1.98),
    new THREE.Vector3(-0.18, 0.34, -1.98),
    new THREE.Vector3(0.18, 0.34, -1.98),
    new THREE.Vector3(0.54, 0.34, -1.98),
  ]
  private readonly tmpDir = new THREE.Vector3()
  private doorHold = 0
  private doorAngle = 0

  constructor() {
    this.root.add(this.lean)
    this.pearl = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color().setStyle('#f4f1ea'),
      metalness: 0.06,
      roughness: 0.42,
      clearcoat: 0.65,
      clearcoatRoughness: 0.32,
      envMapIntensity: 0.65,
      flatShading: true,
    })
    this.accent = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color().setStyle('#101114'),
      metalness: 0.35,
      roughness: 0.46,
      clearcoat: 0.4,
      clearcoatRoughness: 0.2,
      envMapIntensity: 0.5,
      flatShading: true,
    })
    this.lower = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color().setStyle('#0b0c0e'),
      metalness: 0.55,
      roughness: 0.32,
      clearcoat: 0.85,
      clearcoatRoughness: 0.12,
      envMapIntensity: 0.7,
      flatShading: true,
    })
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color().setStyle('#0a1016'),
      metalness: 0.12,
      roughness: 0.04,
      clearcoat: 1,
      clearcoatRoughness: 0.03,
      envMapIntensity: 1.35,
      transparent: true,
      opacity: 0.88,
      flatShading: true,
    })
    const bands = buildBands()
    const pearlMesh = new THREE.Mesh(bands.pearl, this.pearl)
    const accentMesh = new THREE.Mesh(bands.accent, this.accent)
    const lowerMesh = new THREE.Mesh(bands.lower, this.lower)
    const glassMesh = new THREE.Mesh(bands.glass, glassMat)
    pearlMesh.castShadow = accentMesh.castShadow = lowerMesh.castShadow = true
    glassMesh.name = 'glass'
    this.lean.add(pearlMesh, accentMesh, lowerMesh, glassMesh)

    const carbon = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color().setStyle('#141414'),
      metalness: 0.4,
      roughness: 0.55,
      clearcoat: 0.25,
      clearcoatRoughness: 0.35,
      flatShading: true,
    })
    const rubber = new THREE.MeshStandardMaterial({ color: 0x121212, roughness: 0.72, metalness: 0.04 })
    const discMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color().setStyle('#e4e7ee'),
      metalness: 0.94,
      roughness: 0.2,
    })

    for (const side of [-1, 1]) {
      const hinge = new THREE.Group()
      hinge.position.set(side * 0.9, 0.9, -0.12)
      const skin = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.46, 0.78), this.pearl)
      skin.position.set(side * 0.03, -0.24, 0.02)
      skin.castShadow = true
      const win = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.16, 0.5), glassMat)
      win.position.set(side * 0.045, -0.06, -0.02)
      hinge.add(skin, win)
      this.lean.add(hinge)
      this.doors.push(hinge)
    }

    const sailGeo = new THREE.BoxGeometry(0.04, 0.28, 0.7)
    for (const side of [-1, 1]) {
      const sail = new THREE.Mesh(sailGeo, this.pearl)
      sail.position.set(side * 0.42, 0.78, -1.15)
      sail.rotation.z = side * -0.35
      sail.castShadow = true
      this.lean.add(sail)
    }

    this.headMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: new THREE.Color().setRGB(2.2, 2.15, 2.0),
      emissiveIntensity: 1,
      toneMapped: false,
    })
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.035, 0.04), this.headMat)
    bar.position.set(0, 0.33, 1.78)
    this.lean.add(bar)
    const lampGeo = new THREE.SphereGeometry(0.045, 12, 10)
    for (const side of [-1, 1]) {
      const lamp = new THREE.Mesh(lampGeo, this.headMat)
      lamp.position.set(side * 0.82, 0.4, 1.7)
      this.lean.add(lamp)
    }

    this.tailMat = new THREE.MeshStandardMaterial({
      color: 0xff2218,
      emissive: new THREE.Color().setRGB(2.6, 0.05, 0.02),
      emissiveIntensity: 1,
      toneMapped: false,
    })
    const tailBar = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.018, 0.025), this.tailMat)
    tailBar.position.set(0, 0.6, -1.9)
    this.lean.add(tailBar)

    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(0.42, 0.16),
      new THREE.MeshStandardMaterial({ map: plateTexture(), roughness: 0.6, metalness: 0.05 }),
    )
    plate.position.set(0, 0.46, -1.91)
    plate.rotation.y = Math.PI
    this.lean.add(plate)

    const diffuser = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.22, 0.42), carbon)
    diffuser.position.set(0, 0.26, -1.78)
    diffuser.castShadow = true
    this.lean.add(diffuser)
    const ventMat = new THREE.MeshStandardMaterial({ color: 0x070708, roughness: 0.8, metalness: 0.2 })
    for (const x of this.nozzles.map((n) => n.x)) {
      const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.085, 0.16, 16), ventMat)
      nozzle.rotation.x = Math.PI / 2
      nozzle.position.set(x, 0.34, -1.92)
      const fan = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.04, 12), ventMat)
      fan.rotation.x = Math.PI / 2
      fan.position.set(x, 0.2, -1.96)
      this.lean.add(nozzle, fan)
    }

    const jetGeo = new THREE.ConeGeometry(0.07, 1.15, 10)
    jetGeo.translate(0, 0.58, 0)
    const jetMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color().setRGB(1.6, 1.7, 1.8),
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    })
    const plumeGeo = new THREE.ConeGeometry(0.16, 1.6, 8)
    plumeGeo.translate(0, 0.85, 0)
    const plumeMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color().setRGB(0.85, 0.88, 0.92),
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    })
    for (const n of this.nozzles) {
      const jet = new THREE.Mesh(jetGeo, jetMat)
      jet.position.copy(n)
      jet.rotation.x = -Math.PI / 2
      jet.visible = false
      jet.name = 'fx'
      const plume = new THREE.Mesh(plumeGeo, plumeMat)
      plume.position.copy(n)
      plume.rotation.x = -Math.PI / 2
      plume.visible = false
      plume.name = 'fx'
      this.lean.add(jet, plume)
      this.jets.push(jet)
      this.plumes.push(plume)
    }

    this.wing = new THREE.Group()
    this.wing.position.set(0, 0.78, -1.48)
    const wingSkin = new THREE.Mesh(new THREE.BoxGeometry(1.65, 0.03, 0.46), this.pearl)
    wingSkin.castShadow = true
    const strutGeo = new THREE.BoxGeometry(0.04, 0.22, 0.04)
    for (const x of [-0.42, 0.42]) {
      const strut = new THREE.Mesh(strutGeo, carbon)
      strut.position.set(x, -0.1, 0.05)
      this.wing.add(strut)
    }
    this.wing.add(wingSkin)
    this.lean.add(this.wing)

    const spots: Array<[number, number, boolean]> = [
      [-0.84, FRONT_Z, true],
      [0.84, FRONT_Z, true],
      [-0.86, REAR_Z, false],
      [0.86, REAR_Z, false],
    ]
    for (const [x, z, front] of spots) {
      const rig = makeWheel(discMat, rubber)
      rig.z = z
      rig.front = front
      rig.mount.position.set(x, AXLE_Y, z)
      if (x > 0) rig.steer.scale.x = -1
      this.lean.add(rig.mount)
      this.wheels.push(rig)
    }

    this.spot = new THREE.SpotLight(0xfff6ee, 7, 28, 0.7, 0.6, 2)
    this.spot.position.set(0, 0.4, 1.5)
    this.spot.target.position.set(0, 0.05, 16)
    this.spot.castShadow = true
    this.spot.shadow.mapSize.set(512, 512)
    this.spot.shadow.bias = -0.001
    this.spot.shadow.camera.near = 0.4
    this.spot.shadow.camera.far = 26
    this.lean.add(this.spot, this.spot.target)

    this.shield = new THREE.Group()
    this.shield.add(
      new THREE.Mesh(
        new THREE.SphereGeometry(2.2, 18, 12),
        new THREE.MeshPhysicalMaterial({
          color: 0xb9e7ff,
          transparent: true,
          opacity: 0.08,
          roughness: 0.05,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      ),
    )
    this.shield.visible = false
    this.shield.name = 'fx'
    this.lean.add(this.shield)

    this.magnetRing = new THREE.Mesh(
      new THREE.TorusGeometry(1.9, 0.028, 8, 28),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color().setRGB(1.4, 0.2, 0.85),
        transparent: true,
        opacity: 0.75,
        toneMapped: false,
      }),
    )
    this.magnetRing.rotation.x = Math.PI / 2
    this.magnetRing.visible = false
    this.magnetRing.name = 'fx'
    this.lean.add(this.magnetRing)

    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(2.4, 4.3),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }),
    )
    this.shadow.rotation.x = -Math.PI / 2
    this.shadow.renderOrder = 2
  }

  setLivery(signal: boolean): void {
    if (signal) {
      this.accent.color.setStyle('#d3122c')
      this.accent.metalness = 0.12
      this.accent.roughness = 0.34
      this.accent.clearcoat = 0.7
    } else {
      this.accent.color.setStyle('#101114')
      this.accent.metalness = 0.35
      this.accent.roughness = 0.46
      this.accent.clearcoat = 0.4
    }
  }

  setDoors(open: number): void {
    this.doorHold = Math.max(0, Math.min(1, open))
  }

  setHeadlightShadows(on: boolean): void {
    this.spot.castShadow = on
  }

  nozzleWorld(index: number, target: THREE.Vector3): THREE.Vector3 {
    return target.copy(this.nozzles[index]!).applyMatrix4(this.lean.matrixWorld)
  }

  exhaustDir(target: THREE.Vector3): THREE.Vector3 {
    return target.copy(this.tmpDir.set(0, -0.35, -1)).transformDirection(this.lean.matrixWorld)
  }

  update(dt: number, v: CarVisual): void {
    const spin = (v.speed * dt) / 0.34
    for (const w of this.wheels) w.spin.rotation.x -= spin

    const gas = !v.braking && !v.airborne && v.speed > 20
    const pitch = v.airborne ? (v.boosting ? -0.08 : 0.04) : v.braking ? 0.045 : gas ? -0.016 : 0
    const squat = v.airborne ? 0.03 : v.braking ? -0.025 : gas ? 0.01 : 0
    this.lean.position.y += (squat - this.lean.position.y) * Math.min(1, dt * 8)
    this.lean.rotation.x += (pitch - this.lean.rotation.x) * Math.min(1, dt * 6)

    if (v.rolling) this.lean.rotation.z = v.rollDir * v.rollT * Math.PI * 2
    else {
      let z = this.lean.rotation.z
      if (z > Math.PI) z -= Math.PI * 2
      if (z < -Math.PI) z += Math.PI * 2
      const lean = -v.steer * 0.05
      this.lean.rotation.z = z + (lean - z) * Math.min(1, dt * 8)
    }

    const yaw = v.rolling ? 0 : -v.steer * 0.3
    for (const w of this.wheels) {
      if (w.front) w.steer.rotation.y += (yaw - w.steer.rotation.y) * Math.min(1, dt * 10)
      w.mount.position.y = AXLE_Y + w.z * Math.sin(this.lean.rotation.x) * 0.8
    }

    this.doorAngle += (this.doorHold - this.doorAngle) * Math.min(1, dt * 4)
    this.doors.forEach((door, i) => {
      const side = i === 0 ? -1 : 1
      door.rotation.z = side * this.doorAngle * 1.15
    })

    const wingY = v.boosting ? 1.12 : 0.76
    const wingX = v.boosting ? -0.28 : -0.08
    this.wing.position.y += (wingY - this.wing.position.y) * Math.min(1, dt * 4)
    this.wing.rotation.x += (wingX - this.wing.rotation.x) * Math.min(1, dt * 4)

    const brake = v.braking ? 4.2 : 2.6
    this.tailMat.emissive.setRGB(brake, v.braking ? 0.25 : 0.05, 0.03)
    this.headMat.emissive.setRGB(v.boosting ? 2.8 : 2.2, v.boosting ? 2.7 : 2.15, 2)
    this.spot.intensity = v.boosting ? 10 : 6
    this.jets.forEach((jet, i) => {
      jet.visible = v.boosting
      this.plumes[i]!.visible = v.boosting
      const s = 0.75 + Math.random() * 0.45
      jet.scale.set(s, 0.85 + Math.random() * 0.4, s)
    })

    this.shield.visible = v.shield
    if (v.shield) this.shield.rotation.y += dt * 0.8
    this.magnetRing.visible = v.magnet
    if (v.magnet) this.magnetRing.rotation.z += dt * 2.2

    const ludi = v.ludicrous > 0
    this.pearl.emissive.setRGB(ludi ? 0.25 : 0, ludi ? 0.12 : 0, ludi ? 0.2 : 0)
    this.pearl.emissiveIntensity = ludi ? 0.45 : 0
  }

  updateShadow(x: number, y: number, z: number): void {
    this.shadow.position.set(x, 0.04, z)
    const s = 1 / (1 + y * 0.28)
    this.shadow.scale.set(s, s, s)
    const mat = this.shadow.material as THREE.MeshBasicMaterial
    mat.opacity = 0.3 * (1 - Math.min(0.85, y / 8))
  }

  setPitchFromVelocity(vy: number, airborne: boolean, boosting: boolean, dt: number): void {
    if (!airborne) return
    const target = Math.max(-0.28, Math.min(0.34, -vy * 0.016 + (boosting ? -0.04 : 0.02)))
    this.lean.rotation.x += (target - this.lean.rotation.x) * Math.min(1, dt * 5)
    for (const w of this.wheels) w.mount.position.y = AXLE_Y + w.z * Math.sin(this.lean.rotation.x) * 0.8
  }
}

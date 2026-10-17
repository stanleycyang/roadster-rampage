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

interface Key {
  z: number
  yRocker: number
  yBelt: number
  yCrown: number
  wRocker: number
  wBelt: number
  wCrown: number
}

/** Long-nose, low, wide 2+2 teardrop. No badging. */
const KEYS: Key[] = [
  { z: -1.9, yRocker: 0.32, yBelt: 0.58, yCrown: 0.64, wRocker: 0.66, wBelt: 0.82, wCrown: 0.28 },
  { z: -1.55, yRocker: 0.18, yBelt: 0.66, yCrown: 0.78, wRocker: 0.9, wBelt: 1.02, wCrown: 0.5 },
  { z: -1.15, yRocker: 0.15, yBelt: 0.68, yCrown: 1.0, wRocker: 0.92, wBelt: 1.0, wCrown: 0.58 },
  { z: -0.55, yRocker: 0.14, yBelt: 0.67, yCrown: 1.1, wRocker: 0.9, wBelt: 0.98, wCrown: 0.54 },
  { z: 0.05, yRocker: 0.14, yBelt: 0.64, yCrown: 1.08, wRocker: 0.9, wBelt: 0.97, wCrown: 0.5 },
  { z: 0.5, yRocker: 0.14, yBelt: 0.55, yCrown: 0.8, wRocker: 0.88, wBelt: 0.96, wCrown: 0.32 },
  { z: 0.98, yRocker: 0.16, yBelt: 0.58, yCrown: 0.78, wRocker: 0.9, wBelt: 1.02, wCrown: 0.22 },
  { z: 1.48, yRocker: 0.16, yBelt: 0.44, yCrown: 0.52, wRocker: 0.78, wBelt: 0.9, wCrown: 0.08 },
  { z: 1.92, yRocker: 0.2, yBelt: 0.3, yCrown: 0.32, wRocker: 0.26, wBelt: 0.32, wCrown: 0 },
]

const AROUND = 36
const AXLE_Y = 0.375
const FRONT_Z = 1.02
const REAR_Z = -1.18

function archAt(z: number): number {
  const front = Math.exp(-((z - FRONT_Z) ** 2) / 0.14)
  const rear = Math.exp(-((z - REAR_Z) ** 2) / 0.16)
  return front * 0.1 + rear * 0.12
}

function pointAt(k: Key, a: number): THREE.Vector3 {
  const c = Math.cos(a)
  const s = Math.sin(a)
  const ax = Math.sign(c || 1) * Math.pow(Math.abs(c), 0.7)
  const ay = Math.sign(s || 1) * Math.pow(Math.abs(s), s > 0 ? 0.82 : 1.7)
  const up = Math.max(0, ay)
  const dn = Math.max(0, -ay)
  const width = k.wBelt * (1 - up) * (1 - dn) + k.wCrown * up + k.wRocker * dn + archAt(k.z) * (1 - up * 0.4)
  const y = k.yBelt + (ay >= 0 ? (k.yCrown - k.yBelt) * ay : (k.yBelt - k.yRocker) * ay)
  let x = ax * width
  const side = Math.pow(Math.abs(c), 0.4) * Math.exp(-s * s * 2.4)
  const door = Math.exp(-((k.z - 0.08) ** 2) / 0.42)
  x -= Math.sign(x || 1) * door * 0.075 * side
  return new THREE.Vector3(x, Math.max(0.11, y), k.z)
}

function cabinGlass(k: Key, a: number): boolean {
  const rise = k.yCrown - k.yBelt
  return Math.sin(a) > 0.22 && rise > 0.22
}

function buildShell(glass: boolean): THREE.BufferGeometry {
  const rings: THREE.Vector3[] = []
  for (const k of KEYS) {
    for (let i = 0; i < AROUND; i++) {
      const a = (i / AROUND) * Math.PI * 2
      rings.push(pointAt(k, a))
    }
  }
  const index: number[] = []
  for (let s = 0; s < KEYS.length - 1; s++) {
    for (let i = 0; i < AROUND; i++) {
      const a0 = (i / AROUND) * Math.PI * 2
      const a1 = ((i + 1) / AROUND) * Math.PI * 2
      const midA = (a0 + a1) * 0.5
      const midK = KEYS[s]!
      const isGlass = cabinGlass(midK, midA) || cabinGlass(KEYS[s + 1]!, midA)
      if (isGlass !== glass) continue
      const i0 = s * AROUND + i
      const i1 = s * AROUND + ((i + 1) % AROUND)
      const i2 = (s + 1) * AROUND + i
      const i3 = (s + 1) * AROUND + ((i + 1) % AROUND)
      index.push(i0, i2, i1, i1, i2, i3)
    }
  }
  if (!glass) {
    const cap = (section: number, outward: number) => {
      const k = KEYS[section]!
      const center = rings.length
      rings.push(new THREE.Vector3(0, (k.yRocker + k.yBelt) * 0.5, k.z))
      const base = section * AROUND
      for (let i = 0; i < AROUND; i++) {
        const a = (i / AROUND) * Math.PI * 2
        if (Math.sin(a) > 0.35) continue
        const b = base + i
        const c = base + ((i + 1) % AROUND)
        if (outward > 0) index.push(center, c, b)
        else index.push(center, b, c)
      }
    }
    cap(0, -1)
    cap(KEYS.length - 1, 1)
  }
  const geo = new THREE.BufferGeometry()
  geo.setFromPoints(rings)
  geo.setIndex(index)
  geo.computeVertexNormals()
  const pos = geo.getAttribute('position')
  const nrm = geo.getAttribute('normal')
  let dot = 0
  for (let i = 0; i < pos.count; i += 6) {
    dot += pos.getX(i) * nrm.getX(i) + (pos.getY(i) - 0.5) * nrm.getY(i)
  }
  if (dot < 0) {
    for (let i = 0; i < index.length; i += 3) {
      const tmp = index[i + 1]!
      index[i + 1] = index[i + 2]!
      index[i + 2] = tmp
    }
    geo.setIndex(index)
    geo.computeVertexNormals()
  }
  return geo
}

function softShadow(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 128
  const g = c.getContext('2d')!
  const grd = g.createRadialGradient(64, 64, 8, 64, 64, 62)
  grd.addColorStop(0, 'rgba(0,0,0,0.85)')
  grd.addColorStop(0.55, 'rgba(0,0,0,0.35)')
  grd.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = grd
  g.fillRect(0, 0, 128, 128)
  const tex = new THREE.CanvasTexture(c)
  tex.needsUpdate = true
  return tex
}

function plateTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 64
  const g = c.getContext('2d')!
  g.fillStyle = '#f4f1ea'
  g.fillRect(0, 0, 256, 64)
  g.strokeStyle = '#1c140c'
  g.lineWidth = 5
  g.strokeRect(3, 3, 250, 58)
  g.fillStyle = '#1a120c'
  g.font = '700 28px sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText('RAMPAGE', 128, 34)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.needsUpdate = true
  return tex
}

function carbonTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 128
  const g = c.getContext('2d')!
  g.fillStyle = '#121418'
  g.fillRect(0, 0, 128, 128)
  g.strokeStyle = '#2c313a'
  g.lineWidth = 2
  for (let i = -128; i < 256; i += 8) {
    g.beginPath()
    g.moveTo(i, 0)
    g.lineTo(i + 128, 128)
    g.stroke()
    g.beginPath()
    g.moveTo(i, 128)
    g.lineTo(i + 128, 0)
    g.stroke()
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(6, 2)
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

function makeWheel(chrome: THREE.Material, rubber: THREE.Material, caliperMat: THREE.Material, discMat: THREE.Material): WheelRig {
  const mount = new THREE.Group()
  const steer = new THREE.Group()
  const spin = new THREE.Group()
  mount.add(steer)
  steer.add(spin)

  const tireGeo = new THREE.TorusGeometry(0.32, 0.055, 12, 28)
  tireGeo.rotateY(Math.PI / 2)
  const tire = new THREE.Mesh(tireGeo, rubber)
  tire.castShadow = true
  spin.add(tire)

  const lipGeo = new THREE.TorusGeometry(0.25, 0.018, 8, 24)
  lipGeo.rotateY(Math.PI / 2)
  const lip = new THREE.Mesh(lipGeo, chrome)
  lip.castShadow = true
  spin.add(lip)

  const spokeGeo = new THREE.BoxGeometry(0.016, 0.22, 0.02)
  for (let i = 0; i < 10; i++) {
    const spoke = new THREE.Mesh(spokeGeo, chrome)
    spoke.rotation.x = (i / 10) * Math.PI * 2
    spin.add(spoke)
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.08, 14), chrome)
  hub.rotation.z = Math.PI / 2
  spin.add(hub)

  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.02, 16), discMat)
  disc.rotation.z = Math.PI / 2
  spin.add(disc)

  const caliper = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.11, 0.16), caliperMat)
  caliper.position.set(0.09, 0, 0.12)
  caliper.castShadow = true
  steer.add(caliper)

  return { mount, steer, spin, z: 0, front: false }
}

export class Roadster {
  readonly root = new THREE.Group()
  readonly lean = new THREE.Group()
  readonly shadow: THREE.Mesh
  readonly spot: THREE.SpotLight
  private readonly wheels: WheelRig[] = []
  private readonly flames: THREE.Mesh[] = []
  private readonly bodyMat: THREE.MeshPhysicalMaterial
  private readonly tailMat: THREE.MeshStandardMaterial
  private readonly headMat: THREE.MeshStandardMaterial
  private readonly shield: THREE.Group
  private readonly magnetRing: THREE.Mesh
  private readonly nozzles = [new THREE.Vector3(-0.42, 0.26, -1.82), new THREE.Vector3(0.42, 0.26, -1.82)]
  private readonly tmp = new THREE.Vector3()
  private readonly tmpDir = new THREE.Vector3()

  constructor() {
    this.root.add(this.lean)

    this.bodyMat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color().setStyle('#6d1020'),
      metalness: 0.92,
      roughness: 0.22,
      clearcoat: 1,
      clearcoatRoughness: 0.045,
      envMapIntensity: 0.85,
    })
    const paint = new THREE.Mesh(buildShell(false), this.bodyMat)
    paint.castShadow = true
    this.lean.add(paint)

    const glassMat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color().setStyle('#16343f'),
      metalness: 0.12,
      roughness: 0.03,
      clearcoat: 1,
      clearcoatRoughness: 0.02,
      envMapIntensity: 1.15,
      transparent: true,
      opacity: 0.62,
      ior: 1.5,
      reflectivity: 1,
    })
    const glass = new THREE.Mesh(buildShell(true), glassMat)
    glass.name = 'glass'
    this.lean.add(glass)

    const chrome = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color().setStyle('#e7ebf2'),
      metalness: 1,
      roughness: 0.08,
      clearcoat: 0.35,
      clearcoatRoughness: 0.08,
      envMapIntensity: 1.8,
    })
    const carbon = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color().setStyle('#1a1d22'),
      map: carbonTexture(),
      metalness: 0.55,
      roughness: 0.42,
      clearcoat: 0.4,
      clearcoatRoughness: 0.25,
      envMapIntensity: 0.8,
    })
    const rubber = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.72, metalness: 0.05 })
    const caliperMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color().setStyle('#b4232a'),
      metalness: 0.45,
      roughness: 0.35,
    })
    const discMat = new THREE.MeshStandardMaterial({ color: 0x6a6e76, metalness: 0.85, roughness: 0.28 })

    const diffuser = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.04, 0.22), carbon)
    diffuser.position.set(0, 0.24, -1.72)
    diffuser.castShadow = true
    this.lean.add(diffuser)

    const lip = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.025, 0.16), carbon)
    lip.position.set(0, 0.7, -1.72)
    lip.rotation.x = -0.35
    this.lean.add(lip)

    const handleGeo = new THREE.BoxGeometry(0.11, 0.018, 0.028)
    for (const side of [-1, 1]) {
      for (const z of [0.35, -0.45]) {
        const h = new THREE.Mesh(handleGeo, chrome)
        h.position.set(side * 0.96, 0.62, z)
        this.lean.add(h)
      }
    }

    this.headMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: new THREE.Color().setRGB(3.4, 3.1, 2.4),
      emissiveIntensity: 1,
      roughness: 0.25,
      metalness: 0.1,
      toneMapped: false,
    })
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.028, 0.035), this.headMat)
    bar.position.set(0, 0.42, 1.62)
    const tickL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.02, 0.03), this.headMat)
    tickL.position.set(-0.72, 0.4, 1.58)
    tickL.rotation.y = 0.45
    const tickR = tickL.clone()
    tickR.position.x = 0.78
    tickR.rotation.y = -0.45
    this.lean.add(bar, tickL, tickR)

    this.tailMat = new THREE.MeshStandardMaterial({
      color: 0xff2218,
      emissive: new THREE.Color().setRGB(3.2, 0.08, 0.04),
      emissiveIntensity: 1,
      roughness: 0.35,
      toneMapped: false,
    })
    const tailBar = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.022, 0.03), this.tailMat)
    tailBar.position.set(0, 0.58, -1.9)
    this.lean.add(tailBar)

    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(0.42, 0.12),
      new THREE.MeshStandardMaterial({ map: plateTexture(), roughness: 0.55, metalness: 0.05 }),
    )
    plate.position.set(0, 0.38, -1.91)
    plate.rotation.y = Math.PI
    this.lean.add(plate)

    const trim = new THREE.MeshStandardMaterial({ color: 0x0c0e12, roughness: 0.6, metalness: 0.2 })
    const nozzleGeo = new THREE.CylinderGeometry(0.05, 0.07, 0.12, 10)
    const flameGeo = new THREE.ConeGeometry(0.07, 0.7, 8)
    flameGeo.translate(0, 0.35, 0)
    const flameMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color().setRGB(0.55, 1.8, 2.2),
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    })
    for (const n of this.nozzles) {
      const nozzle = new THREE.Mesh(nozzleGeo, trim)
      nozzle.rotation.x = Math.PI / 2
      nozzle.position.copy(n)
      const flame = new THREE.Mesh(flameGeo, flameMat)
      flame.position.copy(n)
      flame.rotation.x = Math.PI / 2
      flame.visible = false
      flame.name = 'fx'
      this.lean.add(nozzle, flame)
      this.flames.push(flame)
    }

    const seat = new THREE.Mesh(
      new THREE.BoxGeometry(0.72, 0.12, 0.42),
      new THREE.MeshStandardMaterial({ color: 0x1a120f, roughness: 0.8 }),
    )
    seat.position.set(0, 0.48, -0.15)
    const wheelRim = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.012, 6, 16), chrome)
    wheelRim.rotation.y = Math.PI / 2
    wheelRim.position.set(0, 0.62, 0.42)
    this.lean.add(seat, wheelRim)

    const spots: Array<[number, number, boolean]> = [
      [-0.78, FRONT_Z, true],
      [0.78, FRONT_Z, true],
      [-0.8, REAR_Z, false],
      [0.8, REAR_Z, false],
    ]
    for (const [x, z, front] of spots) {
      const rig = makeWheel(chrome, rubber, caliperMat, discMat)
      rig.z = z
      rig.front = front
      rig.mount.position.set(x, AXLE_Y, z)
      if (x > 0) rig.steer.scale.x = -1
      this.lean.add(rig.mount)
      this.wheels.push(rig)
    }

    this.spot = new THREE.SpotLight(0xfff3df, 6, 26, 0.5, 0.75, 2)
    this.spot.position.set(0, 0.46, 1.55)
    this.spot.target.position.set(0, 0.05, 16)
    this.spot.castShadow = true
    this.spot.shadow.mapSize.set(512, 512)
    this.spot.shadow.bias = -0.001
    this.spot.shadow.camera.near = 0.4
    this.spot.shadow.camera.far = 28
    this.lean.add(this.spot, this.spot.target)

    this.shield = new THREE.Group()
    const bubble = new THREE.Mesh(
      new THREE.SphereGeometry(2.15, 20, 14),
      new THREE.MeshPhysicalMaterial({
        color: 0x9fd8ff,
        transparent: true,
        opacity: 0.08,
        roughness: 0.05,
        metalness: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    )
    const wire = new THREE.Mesh(
      new THREE.IcosahedronGeometry(2.22, 1),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color().setRGB(0.45, 1.4, 1.6),
        wireframe: true,
        transparent: true,
        opacity: 0.35,
        toneMapped: false,
      }),
    )
    this.shield.add(bubble, wire)
    this.shield.visible = false
    this.shield.name = 'fx'
    this.lean.add(this.shield)

    this.magnetRing = new THREE.Mesh(
      new THREE.TorusGeometry(1.85, 0.03, 8, 32),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color().setRGB(1.5, 0.2, 0.9),
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
      new THREE.PlaneGeometry(2.3, 4.2),
      new THREE.MeshBasicMaterial({
        map: softShadow(),
        color: 0x000000,
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
      }),
    )
    this.shadow.rotation.x = -Math.PI / 2
    this.shadow.renderOrder = 2
  }

  setHeadlightShadows(on: boolean): void {
    this.spot.castShadow = on
  }

  nozzleWorld(index: number, target: THREE.Vector3): THREE.Vector3 {
    return target.copy(this.nozzles[index]!).applyMatrix4(this.lean.matrixWorld)
  }

  exhaustDir(target: THREE.Vector3): THREE.Vector3 {
    return target.copy(this.tmpDir.set(0, 0.15, -1)).transformDirection(this.lean.matrixWorld)
  }

  update(dt: number, v: CarVisual): void {
    const spin = (v.speed * dt) / 0.34
    for (const w of this.wheels) w.spin.rotation.x -= spin

    const gas = !v.braking && !v.airborne && v.speed > 20
    const pitch = v.airborne ? (v.boosting ? -0.1 : 0.045) : v.braking ? 0.05 : gas ? -0.018 : 0
    const squat = v.airborne ? 0.035 : v.braking ? -0.028 : gas ? 0.012 : 0
    this.lean.position.y += (squat - this.lean.position.y) * Math.min(1, dt * 8)
    this.lean.rotation.x += (pitch - this.lean.rotation.x) * Math.min(1, dt * 6)

    if (v.rolling) this.lean.rotation.z = v.rollDir * v.rollT * Math.PI * 2
    else {
      let z = this.lean.rotation.z
      if (z > Math.PI) z -= Math.PI * 2
      if (z < -Math.PI) z += Math.PI * 2
      const lean = -v.steer * 0.055
      this.lean.rotation.z = z + (lean - z) * Math.min(1, dt * 8)
    }

    const yaw = v.rolling ? 0 : -v.steer * 0.32
    for (const w of this.wheels) {
      if (w.front) w.steer.rotation.y += (yaw - w.steer.rotation.y) * Math.min(1, dt * 10)
      const lift = w.z * Math.sin(this.lean.rotation.x)
      w.mount.position.y = AXLE_Y + lift * 0.82
    }

    const brake = v.braking ? 5.5 : 3.2
    this.tailMat.emissive.setRGB(brake, v.braking ? 0.2 : 0.04, 0.03)
    this.headMat.emissive.setRGB(v.boosting ? 4.2 : 3.4, v.boosting ? 3.8 : 3.1, 2.4)
    this.spot.intensity = v.boosting ? 9 : 6
    for (const f of this.flames) {
      f.visible = v.boosting
      const s = 0.75 + Math.random() * 0.55
      f.scale.set(s, 0.65 + Math.random() * 0.9, s)
    }

    this.shield.visible = v.shield
    if (v.shield) {
      this.shield.rotation.y += dt * 0.8
      this.shield.scale.setScalar(1 + Math.sin(v.time * 5) * 0.03)
    }
    this.magnetRing.visible = v.magnet
    if (v.magnet) this.magnetRing.rotation.z += dt * 2.4

    const ludi = v.ludicrous > 0
    this.bodyMat.emissive.setRGB(ludi ? 0.55 : 0, ludi ? 0.04 : 0, ludi ? 0.18 : 0)
    this.bodyMat.emissiveIntensity = ludi ? 0.45 + Math.sin(v.time * 10) * 0.15 : 0
  }

  updateShadow(x: number, y: number, z: number): void {
    this.shadow.position.set(x, 0.04, z)
    const s = 1 / (1 + y * 0.28)
    this.shadow.scale.set(s, s, s)
    const mat = this.shadow.material as THREE.MeshBasicMaterial
    mat.opacity = 0.22 * (1 - Math.min(0.85, y / 8))
  }

  setPitchFromVelocity(vy: number, airborne: boolean, boosting: boolean, dt: number): void {
    if (!airborne) return
    const target = Math.max(-0.32, Math.min(0.38, -vy * 0.018 + (boosting ? -0.05 : 0.02)))
    this.lean.rotation.x += (target - this.lean.rotation.x) * Math.min(1, dt * 5)
    for (const w of this.wheels) {
      w.mount.position.y = AXLE_Y + w.z * Math.sin(this.lean.rotation.x) * 0.82
    }
    this.tmp.set(0, 0, 0)
  }
}

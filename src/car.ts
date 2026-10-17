import * as THREE from 'three'

interface Section {
  z: number
  hw: number
  y0: number
  y1: number
}

function profile(angle: number, hw: number, y0: number, y1: number): [number, number] {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const n = s >= 0 ? 2.35 : 3.6
  const exp = 2 / n
  const x = Math.sign(c || 1) * hw * Math.pow(Math.abs(c), exp)
  const mid = (y0 + y1) * 0.5
  const hh = (y1 - y0) * 0.5
  const y = mid + Math.sign(s || 1) * hh * Math.pow(Math.abs(s), exp)
  return [x, y]
}

function loft(sections: Section[], segs = 16): THREE.BufferGeometry {
  const rings: THREE.Vector3[] = []
  const index: number[] = []
  for (const s of sections) {
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2
      const [x, y] = profile(a, s.hw, s.y0, s.y1)
      rings.push(new THREE.Vector3(x, y, s.z))
    }
  }
  for (let s = 0; s < sections.length - 1; s++) {
    for (let i = 0; i < segs; i++) {
      const i0 = s * segs + i
      const i1 = s * segs + ((i + 1) % segs)
      const i2 = (s + 1) * segs + i
      const i3 = (s + 1) * segs + ((i + 1) % segs)
      index.push(i0, i2, i1, i1, i2, i3)
    }
  }
  const cap = (sectionIndex: number, outward: number) => {
    const s = sections[sectionIndex]!
    const center = rings.length
    rings.push(new THREE.Vector3(0, (s.y0 + s.y1) * 0.5, s.z))
    const base = sectionIndex * segs
    for (let i = 0; i < segs; i++) {
      const a = base + i
      const b = base + ((i + 1) % segs)
      if (outward > 0) index.push(center, b, a)
      else index.push(center, a, b)
    }
  }
  cap(0, -1)
  cap(sections.length - 1, 1)

  const geo = new THREE.BufferGeometry()
  geo.setFromPoints(rings)
  geo.setIndex(index)
  geo.computeVertexNormals()
  const pos = geo.getAttribute('position')
  const nrm = geo.getAttribute('normal')
  let dot = 0
  for (let i = 0; i < pos.count; i += 4) {
    dot += pos.getX(i) * nrm.getX(i) + (pos.getY(i) - 0.45) * nrm.getY(i) + pos.getZ(i) * nrm.getZ(i) * 0.15
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

function plateTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 72
  const g = c.getContext('2d')!
  g.fillStyle = '#f3efe6'
  g.fillRect(0, 0, 256, 72)
  g.strokeStyle = '#241820'
  g.lineWidth = 6
  g.strokeRect(4, 4, 248, 64)
  g.fillStyle = '#1a1020'
  g.font = '700 36px sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText('RAMPAGE', 128, 38)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.needsUpdate = true
  return tex
}

function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 128
  const g = c.getContext('2d')!
  const grd = g.createRadialGradient(64, 64, 8, 64, 64, 64)
  grd.addColorStop(0, 'rgba(120,255,255,0.95)')
  grd.addColorStop(0.4, 'rgba(0,220,255,0.35)')
  grd.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = grd
  g.fillRect(0, 0, 128, 128)
  const tex = new THREE.CanvasTexture(c)
  tex.needsUpdate = true
  return tex
}

const BODY: Section[] = [
  { z: -2.16, hw: 0.78, y0: 0.26, y1: 0.64 },
  { z: -1.7, hw: 0.98, y0: 0.18, y1: 0.72 },
  { z: -1.05, hw: 0.96, y0: 0.16, y1: 0.64 },
  { z: -0.2, hw: 0.92, y0: 0.15, y1: 0.54 },
  { z: 0.7, hw: 0.88, y0: 0.14, y1: 0.46 },
  { z: 1.4, hw: 0.72, y0: 0.14, y1: 0.36 },
  { z: 2.05, hw: 0.34, y0: 0.16, y1: 0.3 },
]

const CABIN: Section[] = [
  { z: -1.22, hw: 0.38, y0: 0.58, y1: 0.66 },
  { z: -0.9, hw: 0.62, y0: 0.58, y1: 1.0 },
  { z: -0.25, hw: 0.58, y0: 0.55, y1: 1.06 },
  { z: 0.28, hw: 0.46, y0: 0.5, y1: 0.86 },
  { z: 0.62, hw: 0.22, y0: 0.46, y1: 0.58 },
]

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

export class Roadster {
  readonly root = new THREE.Group()
  readonly lean = new THREE.Group()
  readonly shadow: THREE.Mesh
  private readonly wheels: THREE.Object3D[] = []
  private readonly flames: THREE.Mesh[] = []
  private readonly bodyMat: THREE.MeshPhysicalMaterial
  private readonly tailMat: THREE.MeshBasicMaterial
  private readonly underMat: THREE.MeshBasicMaterial
  private readonly shield: THREE.Group
  private readonly magnetRing: THREE.Mesh
  private readonly nozzles = [new THREE.Vector3(-0.36, 0.32, -2.12), new THREE.Vector3(0.36, 0.32, -2.12)]
  private readonly tmp = new THREE.Vector3()
  private readonly tmpDir = new THREE.Vector3()

  constructor() {
    this.root.add(this.lean)
    this.bodyMat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color().setStyle('#ff2a4d'),
      metalness: 0.84,
      roughness: 0.22,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
      envMapIntensity: 1.35,
    })
    const body = new THREE.Mesh(loft(BODY), this.bodyMat)
    this.lean.add(body)
    const glass = new THREE.MeshStandardMaterial({
      color: 0x07141c,
      metalness: 0.9,
      roughness: 0.06,
      transparent: true,
      opacity: 0.8,
      envMapIntensity: 1.6,
    })
    this.lean.add(new THREE.Mesh(loft(CABIN, 12), glass))

    const trim = new THREE.MeshStandardMaterial({ color: 0x12080e, metalness: 0.5, roughness: 0.45 })
    const splitter = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.05, 0.42), trim)
    splitter.position.set(0, 0.16, 1.85)
    const skirtL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 3.1), new THREE.MeshBasicMaterial({
      color: new THREE.Color().setRGB(0.2, 1.3, 1.6),
      toneMapped: false,
    }))
    skirtL.position.set(-1.0, 0.22, 0.05)
    const skirtR = skirtL.clone()
    skirtR.position.x = 1.0
    this.lean.add(splitter, skirtL, skirtR)

    const wing = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.06, 0.38), trim)
    wing.position.set(0, 0.98, -1.85)
    wing.rotation.x = -0.25
    const strutGeo = new THREE.BoxGeometry(0.06, 0.32, 0.08)
    const strutL = new THREE.Mesh(strutGeo, trim)
    strutL.position.set(-0.42, 0.8, -1.82)
    const strutR = strutL.clone()
    strutR.position.x = 0.42
    this.lean.add(wing, strutL, strutR)

    this.tailMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color().setRGB(2.8, 0.08, 0.07),
      toneMapped: false,
      fog: false,
    })
    const tailGeo = new THREE.BoxGeometry(0.62, 0.07, 0.05)
    const tl = new THREE.Mesh(tailGeo, this.tailMat)
    tl.position.set(-0.46, 0.5, -2.18)
    tl.rotation.y = 0.42
    tl.rotation.z = -0.12
    const tr = new THREE.Mesh(tailGeo, this.tailMat)
    tr.position.set(0.46, 0.5, -2.18)
    tr.rotation.y = -0.42
    tr.rotation.z = 0.12
    const center = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.035, 0.04), this.tailMat)
    center.position.set(0, 0.66, -2.16)
    this.lean.add(tl, tr, center)

    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(0.46, 0.14),
      new THREE.MeshBasicMaterial({ map: plateTexture(), toneMapped: false }),
    )
    plate.position.set(0, 0.34, -2.2)
    plate.rotation.y = Math.PI
    this.lean.add(plate)

    const headMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color().setRGB(2.8, 2.5, 1.8),
      toneMapped: false,
      fog: false,
    })
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.07, 0.05), headMat)
    hl.position.set(-0.42, 0.28, 2.08)
    const hr = hl.clone()
    hr.position.x = 0.42
    this.lean.add(hl, hr)

    const spokeGeo = new THREE.BoxGeometry(0.04, 0.22, 0.03)
    spokeGeo.translate(0, 0.12, 0)
    const rimMat = new THREE.MeshStandardMaterial({
      color: 0xd7fbff,
      metalness: 0.9,
      roughness: 0.2,
      emissive: new THREE.Color().setRGB(0.08, 0.25, 0.3),
      emissiveIntensity: 0.6,
    })
    const tireGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.26, 18)
    tireGeo.rotateZ(Math.PI / 2)
    const rimGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.28, 16)
    rimGeo.rotateZ(Math.PI / 2)
    const tireMat = new THREE.MeshStandardMaterial({ color: 0x101014, roughness: 0.85, metalness: 0.1 })
    const spots: Array<[number, number]> = [[-0.86, 1.32], [0.86, 1.32], [-0.9, -1.32], [0.9, -1.32]]
    for (const [x, z] of spots) {
      const w = new THREE.Group()
      w.add(new THREE.Mesh(tireGeo, tireMat))
      w.add(new THREE.Mesh(rimGeo, rimMat))
      for (let i = 0; i < 5; i++) {
        const spoke = new THREE.Mesh(spokeGeo, rimMat)
        spoke.rotation.x = (i / 5) * Math.PI * 2
        w.add(spoke)
      }
      w.position.set(x, 0.34, z)
      this.lean.add(w)
      this.wheels.push(w)
    }

    this.underMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color().setRGB(0.25, 1.4, 1.7),
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      map: glowTexture(),
    })
    const under = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 3.5), this.underMat)
    under.rotation.x = -Math.PI / 2
    under.position.set(0, 0.07, -0.15)
    this.lean.add(under)

    const flameGeo = new THREE.ConeGeometry(0.1, 0.85, 8)
    flameGeo.translate(0, 0.42, 0)
    const flameMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color().setRGB(0.7, 2.2, 2.4),
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    })
    for (const n of this.nozzles) {
      const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.16, 8), trim)
      nozzle.rotation.x = Math.PI / 2
      nozzle.position.copy(n)
      const flame = new THREE.Mesh(flameGeo, flameMat.clone())
      flame.position.copy(n)
      flame.rotation.x = Math.PI / 2
      flame.visible = false
      this.lean.add(nozzle, flame)
      this.flames.push(flame)
    }

    const interior = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.08, 0.45),
      new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(0.25, 1.2, 1.5), toneMapped: false }),
    )
    interior.position.set(0, 0.72, -0.35)
    this.lean.add(interior)

    this.shield = new THREE.Group()
    const bubble = new THREE.Mesh(
      new THREE.SphereGeometry(2.05, 18, 14),
      new THREE.MeshBasicMaterial({
        color: 0x9fffff,
        transparent: true,
        opacity: 0.1,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    )
    const wire = new THREE.Mesh(
      new THREE.IcosahedronGeometry(2.15, 1),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color().setRGB(0.6, 1.8, 1.9),
        wireframe: true,
        transparent: true,
        opacity: 0.45,
        toneMapped: false,
      }),
    )
    this.shield.add(bubble, wire)
    this.shield.visible = false
    this.lean.add(this.shield)

    this.magnetRing = new THREE.Mesh(
      new THREE.TorusGeometry(1.7, 0.035, 8, 28),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color().setRGB(1.8, 0.25, 1.1),
        transparent: true,
        opacity: 0.8,
        toneMapped: false,
      }),
    )
    this.magnetRing.rotation.x = Math.PI / 2
    this.magnetRing.visible = false
    this.lean.add(this.magnetRing)

    const shadowTex = glowTexture()
    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(2.4, 4.2),
      new THREE.MeshBasicMaterial({
        map: shadowTex,
        color: 0x000000,
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
      }),
    )
    this.shadow.rotation.x = -Math.PI / 2
    this.shadow.renderOrder = 2
  }

  nozzleWorld(index: number, target: THREE.Vector3): THREE.Vector3 {
    return target.copy(this.nozzles[index]!).applyMatrix4(this.lean.matrixWorld)
  }

  exhaustDir(target: THREE.Vector3): THREE.Vector3 {
    return target.copy(this.tmpDir.set(0, 0.25, -1)).transformDirection(this.lean.matrixWorld)
  }

  update(dt: number, v: CarVisual): void {
    const spin = (v.speed * dt) / 0.34
    for (const w of this.wheels) w.rotation.x -= spin

    if (v.rolling) this.lean.rotation.z = v.rollDir * v.rollT * Math.PI * 2
    else {
      let z = this.lean.rotation.z
      if (z > Math.PI) z -= Math.PI * 2
      if (z < -Math.PI) z += Math.PI * 2
      this.lean.rotation.z = z + (-v.steer * 0.14 - z) * Math.min(1, dt * 8)
    }
    const targetPitch = v.airborne ? (v.boosting ? -0.12 : 0.04) : v.braking ? 0.07 : 0
    this.lean.rotation.x += (targetPitch - this.lean.rotation.x) * Math.min(1, dt * 6)

    const brake = v.braking ? 5.5 : 2.4
    this.tailMat.color.setRGB(brake, v.braking ? 0.25 : 0.07, 0.05)
    for (const f of this.flames) {
      f.visible = v.boosting
      f.scale.set(0.85 + Math.random() * 0.4, 0.7 + Math.random() * 0.8, 0.85 + Math.random() * 0.4)
    }
    this.underMat.color.setRGB(v.boosting ? 0.45 : 0.2, v.boosting ? 2.2 : 1.2, v.boosting ? 2.4 : 1.5)

    this.shield.visible = v.shield
    if (v.shield) {
      this.shield.rotation.y += dt * 0.8
      const s = 1 + Math.sin(v.time * 5) * 0.03
      this.shield.scale.setScalar(s)
    }
    this.magnetRing.visible = v.magnet
    if (v.magnet) this.magnetRing.rotation.z += dt * 2.4

    const ludi = v.ludicrous > 0
    this.bodyMat.emissive.setRGB(ludi ? 0.85 : 0, ludi ? 0.05 : 0, ludi ? 0.35 : 0)
    this.bodyMat.emissiveIntensity = ludi ? 0.55 + Math.sin(v.time * 12) * 0.25 : 0
  }

  updateShadow(x: number, y: number, z: number): void {
    this.shadow.position.set(x, 0.05, z)
    const s = 1 / (1 + y * 0.28)
    this.shadow.scale.set(s, s, s)
    const mat = this.shadow.material as THREE.MeshBasicMaterial
    mat.opacity = 0.42 * (1 - Math.min(0.8, y / 9))
  }

  /** Used so the airborne pitch can read vertical speed without widening CarVisual too much. */
  setPitchFromVelocity(vy: number, airborne: boolean, boosting: boolean, dt: number): void {
    const target = airborne ? Math.max(-0.35, Math.min(0.4, -vy * 0.02 + (boosting ? -0.06 : 0))) : this.lean.rotation.x
    if (airborne) this.lean.rotation.x += (target - this.lean.rotation.x) * Math.min(1, dt * 5)
    this.tmp.set(0, 0, 0)
  }
}

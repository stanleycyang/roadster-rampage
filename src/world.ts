import * as THREE from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { ROAD_HALF, dayness } from './config.ts'
import { damp, lerp } from './util.ts'
import { groundFragment, groundVertex, skyFragment, skyVertex } from './shaders.ts'
import type { Player } from './types.ts'

function ridge(i: number, seed: number): number {
  const n = Math.sin(i * 0.37 + seed) * 0.5 + Math.sin(i * 0.13 + seed * 2.2) * 0.35 + Math.sin(i * 0.07 + 1.7) * 0.25
  return n * 0.5 + 0.5
}

function rangeMesh(seed: number, color: number, height: number): THREE.Mesh {
  const segs = 110
  const width = 1200
  const pos: number[] = []
  for (let i = 0; i < segs; i++) {
    const x0 = -width / 2 + (width * i) / segs
    const x1 = -width / 2 + (width * (i + 1)) / segs
    const h0 = (0.25 + 0.75 * ridge(i, seed)) * height
    const h1 = (0.25 + 0.75 * ridge(i + 1, seed)) * height
    pos.push(x0, -8, 0, x1, -8, 0, x1, h1, 0, x0, -8, 0, x1, h1, 0, x0, h0, 0)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, fog: true }))
}

function sunTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 256
  const g = c.getContext('2d')!
  const grd = g.createRadialGradient(128, 128, 10, 128, 128, 120)
  grd.addColorStop(0, 'rgba(255,236,190,1)')
  grd.addColorStop(0.28, 'rgba(255,120,40,0.95)')
  grd.addColorStop(0.55, 'rgba(255,40,70,0.45)')
  grd.addColorStop(1, 'rgba(255,0,40,0)')
  g.fillStyle = grd
  g.fillRect(0, 0, 256, 256)
  g.globalCompositeOperation = 'destination-out'
  let y = 148
  const stripes = [10, 8, 7, 5, 4, 3]
  for (let i = 0; i < stripes.length; i++) {
    const h = stripes[i]!
    g.fillRect(0, y, 256, h)
    y += h + 4 + i
  }
  const tex = new THREE.CanvasTexture(c)
  tex.needsUpdate = true
  return tex
}

function moonTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 128
  const g = c.getContext('2d')!
  const grd = g.createRadialGradient(64, 64, 8, 64, 64, 60)
  grd.addColorStop(0, 'rgba(230,240,255,1)')
  grd.addColorStop(0.45, 'rgba(180,200,255,0.7)')
  grd.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = grd
  g.fillRect(0, 0, 128, 128)
  const tex = new THREE.CanvasTexture(c)
  tex.needsUpdate = true
  return tex
}

function windowTexture(seed: number): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 128
  const g = c.getContext('2d')!
  g.fillStyle = '#07040f'
  g.fillRect(0, 0, 64, 128)
  let s = seed
  const rnd = () => {
    s = (s * 16807 + 11) % 2147483647
    return s / 2147483647
  }
  for (let y = 4; y < 128; y += 8) {
    for (let x = 3; x < 64; x += 7) {
      if (rnd() < 0.38) continue
      const pick = rnd()
      g.fillStyle = pick > 0.82 ? '#ff4fd8' : pick > 0.5 ? '#8af7ff' : '#ffe1a8'
      g.globalAlpha = 0.4 + rnd() * 0.6
      g.fillRect(x, y, 3, 4)
    }
  }
  g.globalAlpha = 1
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.needsUpdate = true
  return tex
}

interface Building {
  mesh: THREE.Mesh
  neon: boolean
}

export class RocketShow {
  readonly group = new THREE.Group()
  active = false
  age = 0
  private readonly rocket: THREE.Group
  private readonly flame: THREE.Mesh

  constructor() {
    const towerMat = new THREE.MeshStandardMaterial({ color: 0x2a2438, metalness: 0.4, roughness: 0.6 })
    const mast = new THREE.Mesh(new THREE.BoxGeometry(0.6, 16, 0.6), towerMat)
    mast.position.y = 8
    const arm = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.35, 0.35), towerMat)
    arm.position.set(1.2, 12, 0)
    this.group.add(mast, arm)

    this.rocket = new THREE.Group()
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.62, 7.2, 12),
      new THREE.MeshStandardMaterial({ color: 0xf4f1ea, metalness: 0.35, roughness: 0.4 }),
    )
    body.position.y = 3.6
    const nose = new THREE.Mesh(
      new THREE.ConeGeometry(0.55, 1.6, 12),
      new THREE.MeshStandardMaterial({ color: 0xff3d6e, metalness: 0.4, roughness: 0.35 }),
    )
    nose.position.y = 8
    const stripe = new THREE.Mesh(
      new THREE.CylinderGeometry(0.58, 0.64, 0.35, 12),
      new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(1.6, 0.15, 0.7), toneMapped: false }),
    )
    stripe.position.y = 5.2
    this.rocket.add(body, nose, stripe)
    const finMat = new THREE.MeshStandardMaterial({ color: 0x241820, metalness: 0.3, roughness: 0.5 })
    for (let i = 0; i < 3; i++) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.1, 0.7), finMat)
      const a = (i / 3) * Math.PI * 2
      fin.position.set(Math.cos(a) * 0.7, 1.1, Math.sin(a) * 0.7)
      this.rocket.add(fin)
    }
    const flameGeo = new THREE.ConeGeometry(0.45, 2.4, 10)
    flameGeo.translate(0, -1.2, 0)
    this.flame = new THREE.Mesh(flameGeo, new THREE.MeshBasicMaterial({
      color: new THREE.Color().setRGB(2.5, 1.1, 0.25),
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    }))
    this.flame.position.y = 0.2
    this.rocket.add(this.flame)
    this.group.add(this.rocket)
    this.group.visible = false
  }

  launch(x: number, z: number): void {
    this.group.position.set(x, 0, z)
    this.rocket.position.y = 0
    this.group.visible = true
    this.active = true
    this.age = 0
  }

  update(dt: number): void {
    if (!this.active) return
    this.age += dt
    const t = this.age
    const lift = t < 0.35 ? t * 4 : Math.pow(t - 0.2, 1.55) * 18
    this.rocket.position.y = lift
    const flicker = 0.75 + Math.random() * 0.5
    this.flame.scale.set(flicker, 0.8 + Math.random() * 0.7, flicker)
    if (t > 16) {
      this.active = false
      this.group.visible = false
    }
  }

  flamePosition(target: THREE.Vector3): THREE.Vector3 {
    this.flame.getWorldPosition(target)
    return target
  }
}

export class World {
  readonly scene = new THREE.Scene()
  readonly camera: THREE.PerspectiveCamera
  readonly renderer: THREE.WebGLRenderer
  readonly rocket = new RocketShow()
  readonly fog: THREE.Fog
  private readonly ground: THREE.Mesh
  private readonly groundUniforms: {
    uOrigin: { value: number }
    uCar: { value: THREE.Vector3 }
    uRoadHalf: { value: number }
    uDay: { value: number }
    uRain: { value: number }
    uTime: { value: number }
    uHorizon: { value: THREE.Color }
    uSunDir: { value: THREE.Vector3 }
  }
  private readonly sky: THREE.Mesh
  private readonly skyUniforms: { uDay: { value: number }; uTime: { value: number }; uLightning: { value: number } }
  private readonly anchor = new THREE.Group()
  private readonly sun: THREE.Sprite
  private readonly moon: THREE.Sprite
  private readonly hemi: THREE.HemisphereLight
  private readonly dir: THREE.DirectionalLight
  private readonly catcher: THREE.Mesh
  private readonly shaft: THREE.Mesh
  private readonly sunDir = new THREE.Vector3()
  private readonly up = new THREE.Vector3(0, 1, 0)
  private high = true
  private readonly buildings: Building[] = []
  private readonly lamps: THREE.Group[] = []
  private readonly strips: THREE.Mesh[] = []
  private readonly rim: THREE.DirectionalLight
  private readonly pool: THREE.SpotLight
  private readonly horizon = new THREE.Color()
  private rainMix = 0
  private tunnelMix = 0
  private time = 0

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
      alpha: false,
    })
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 0.95
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    this.renderer.setClearColor(0x12060e, 1)
    this.camera = new THREE.PerspectiveCamera(68, 1, 0.1, 700)
    this.fog = new THREE.Fog(0x2a1020, 70, 220)
    this.scene.fog = this.fog

    const pmrem = new THREE.PMREMGenerator(this.renderer)
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    this.scene.environmentIntensity = 0.42
    pmrem.dispose()

    this.hemi = new THREE.HemisphereLight(0xffc2a8, 0x1a1020, 0.55)
    this.dir = new THREE.DirectionalLight(0xffc8a4, 1.35)
    this.dir.position.set(-12, 18, 16)
    this.dir.castShadow = true
    this.dir.shadow.mapSize.set(2048, 2048)
    this.dir.shadow.camera.near = 2
    this.dir.shadow.camera.far = 70
    this.dir.shadow.camera.left = -16
    this.dir.shadow.camera.right = 16
    this.dir.shadow.camera.top = 22
    this.dir.shadow.camera.bottom = -14
    this.dir.shadow.bias = -0.0006
    this.dir.shadow.normalBias = 0.035
    this.dir.shadow.radius = 2
    this.scene.add(this.hemi, this.dir, this.dir.target)
    this.rim = new THREE.DirectionalLight(0xfff4ea, 0.85)
    this.rim.position.set(-8, 4, -6)
    this.pool = new THREE.SpotLight(0xfff7ef, 2.4, 16, 0.5, 0.6, 1.6)
    this.pool.position.set(0, 9, 3)
    this.pool.target.position.set(0, 0, 0)
    this.scene.add(this.rim, this.rim.target, this.pool, this.pool.target)

    this.catcher = new THREE.Mesh(
      new THREE.PlaneGeometry(64, 80),
      new THREE.ShadowMaterial({ opacity: 0.42 }),
    )
    this.catcher.rotation.x = -Math.PI / 2
    this.catcher.position.y = 0.03
    this.catcher.receiveShadow = true
    this.scene.add(this.catcher)

    this.shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(1.5, 14, 70, 16, 1, true),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color().setRGB(1.15, 0.48, 0.22),
        transparent: true,
        opacity: 0.05,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        fog: false,
      }),
    )
    this.shaft.frustumCulled = false
    this.anchor.add(this.shaft)

    this.groundUniforms = THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uOrigin: { value: 0 },
        uCar: { value: new THREE.Vector3() },
        uRoadHalf: { value: ROAD_HALF },
        uDay: { value: 1 },
        uRain: { value: 0 },
        uTime: { value: 0 },
        uHorizon: { value: new THREE.Color(0.5, 0.15, 0.1) },
        uSunDir: { value: new THREE.Vector3(-0.4, 0.4, 0.7).normalize() },
      },
    ]) as typeof this.groundUniforms
    const groundMat = new THREE.ShaderMaterial({
      uniforms: this.groundUniforms,
      vertexShader: groundVertex,
      fragmentShader: groundFragment,
      fog: true,
    })
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(420, 560, 1, 1), groundMat)
    this.ground.rotation.x = -Math.PI / 2
    this.scene.add(this.ground)

    this.skyUniforms = { uDay: { value: 1 }, uTime: { value: 0 }, uLightning: { value: 0 } }
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(420, 28, 18),
      new THREE.ShaderMaterial({
        uniforms: this.skyUniforms,
        vertexShader: skyVertex,
        fragmentShader: skyFragment,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      }),
    )
    this.sky.frustumCulled = false
    this.anchor.add(this.sky)
    this.sun = new THREE.Sprite(new THREE.SpriteMaterial({
      map: sunTexture(),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      fog: false,
    }))
    this.sun.scale.set(86, 86, 1)
    this.moon = new THREE.Sprite(new THREE.SpriteMaterial({
      map: moonTexture(),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      fog: false,
    }))
    this.moon.scale.set(28, 28, 1)
    this.anchor.add(this.sun, this.moon)

    const far = rangeMesh(1.2, 0x160818, 96)
    far.position.set(0, 0, 250)
    const near = rangeMesh(4.4, 0x2a1236, 58)
    near.position.set(0, 0, 175)
    this.anchor.add(far, near)

    const neonColors = [
      new THREE.Color().setRGB(1.5, 0.12, 0.7),
      new THREE.Color().setRGB(0.15, 1.1, 1.4),
      new THREE.Color().setRGB(1.2, 0.45, 0.12),
    ]
    for (let i = 0; i < 7; i++) {
      const h = 34 + (i % 4) * 12
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(3.2, h, 3.2),
        new THREE.MeshBasicMaterial({ color: neonColors[i % 3], fog: true, toneMapped: false }),
      )
      mesh.position.set((i % 2 === 0 ? -1 : 1) * (48 + i * 14), h / 2, 150 + (i % 3) * 16)
      this.anchor.add(mesh)
    }
    this.scene.add(this.anchor)

    const windowMats: THREE.MeshStandardMaterial[] = []
    for (let i = 0; i < 4; i++) {
      const tex = windowTexture(20 + i * 17)
      windowMats.push(new THREE.MeshStandardMaterial({
        color: 0x120814,
        roughness: 0.85,
        metalness: 0.08,
        emissive: new THREE.Color(0xffffff),
        emissiveMap: tex,
        emissiveIntensity: 0.85,
        map: tex,
      }))
    }
    const neonMats = neonColors.map((color) => new THREE.MeshBasicMaterial({ color, fog: true, toneMapped: false }))
    for (let i = 0; i < 42; i++) {
      const side = i % 2 === 0 ? -1 : 1
      const neon = i % 6 === 0
      const w = 6 + (i % 5) * 1.4
      const h = neon ? 18 + (i % 4) * 8 : 10 + (i % 7) * 4.5
      const d = 6 + (i % 3) * 2
      const geo = new THREE.BoxGeometry(w, h, d)
      geo.translate(0, h / 2, 0)
      const mesh = new THREE.Mesh(geo, neon ? neonMats[i % neonMats.length]! : windowMats[i % windowMats.length]!)
      const row = Math.floor(i / 2)
      mesh.position.set(side * (20 + (i % 5) * 7), 0, row * 22)
      this.scene.add(mesh)
      this.buildings.push({ mesh, neon })
    }

    const poleMat = new THREE.MeshStandardMaterial({ color: 0x1a1020, metalness: 0.6, roughness: 0.4 })
    const lampMatA = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(1.6, 0.2, 0.9), toneMapped: false, fog: false })
    const lampMatB = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(0.2, 1.3, 1.6), toneMapped: false, fog: false })
    for (let i = 0; i < 36; i++) {
      const g = new THREE.Group()
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 4.2, 6), poleMat)
      pole.position.y = 2.1
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.12, 0.28), i % 2 === 0 ? lampMatA : lampMatB)
      head.position.y = 4.2
      g.add(pole, head)
      const side = i % 2 === 0 ? -1 : 1
      g.position.set(side * (ROAD_HALF + 1.15), 0, Math.floor(i / 2) * 24)
      this.scene.add(g)
      this.lamps.push(g)
    }

    const stripMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color().setRGB(2.4, 0.05, 0.07),
      toneMapped: false,
      fog: true,
    })
    for (let i = 0; i < 16; i++) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 8, 0.07), stripMat)
      const side = i % 2 === 0 ? -1 : 1
      strip.position.set(side * (ROAD_HALF + 3.2), 4, Math.floor(i / 2) * 26)
      this.scene.add(strip)
      this.strips.push(strip)
    }

    this.scene.add(this.rocket.group)
  }

  setQuality(high: boolean): void {
    this.high = high
    const size = high ? 2048 : 1024
    this.dir.shadow.mapSize.set(size, size)
    this.dir.shadow.map?.dispose()
    this.dir.shadow.map = null
    const mat = this.shaft.material as THREE.MeshBasicMaterial
    mat.opacity = high ? 0.055 : 0.028
  }

  resize(pr: number): void {
    const w = window.innerWidth
    const h = window.innerHeight
    this.camera.aspect = w / Math.max(1, h)
    this.camera.updateProjectionMatrix()
    this.renderer.setPixelRatio(pr)
    this.renderer.setSize(w, h, false)
  }

  update(dt: number, player: Player, raining: boolean, inTunnel: boolean, lightning: number): void {
    this.time += dt
    const day = dayness(player.z)
    this.rainMix = damp(this.rainMix, raining ? 1 : 0, 1.5, dt)
    this.tunnelMix = damp(this.tunnelMix, inTunnel ? 1 : 0, 2.4, dt)
    const night = 1 - day
    this.horizon.setRGB(lerp(0.05, 0.5, day), lerp(0.015, 0.14, day), lerp(0.07, 0.09, day))
    this.fog.color.copy(this.horizon)
    this.fog.near = lerp(62, 22, Math.max(this.tunnelMix, this.rainMix * 0.65))
    this.fog.far = lerp(210, 120, Math.max(this.tunnelMix * 0.75, this.rainMix * 0.5))

    this.ground.position.set(0, 0, player.z + 30)
    this.groundUniforms.uOrigin.value = Math.floor(player.z / 500) * 500
    this.groundUniforms.uCar.value.set(player.x, player.y, player.z)
    this.groundUniforms.uDay.value = day
    this.groundUniforms.uRain.value = this.rainMix
    this.groundUniforms.uTime.value = this.time
    this.groundUniforms.uHorizon.value.copy(this.horizon)
    this.groundUniforms.uSunDir.value.set(-0.42, -0.02 + day * 0.7, 0.72).normalize()

    this.anchor.position.set(player.x * 0.15, 0, player.z)
    this.skyUniforms.uDay.value = day
    this.skyUniforms.uTime.value = this.time
    this.skyUniforms.uLightning.value = lightning
    this.sunDir.set(-0.42, -0.05 + day * 0.66, 0.72).normalize()
    const sunDir = this.sunDir
    this.sun.position.copy(sunDir).multiplyScalar(250)
    const sunMat = this.sun.material as THREE.SpriteMaterial
    sunMat.opacity = Math.min(1, day * 1.35)
    this.sun.visible = day > 0.05
    const moonDir = new THREE.Vector3(0.52, 0.38, 0.48).normalize()
    this.moon.position.copy(moonDir).multiplyScalar(250)
    const moonMat = this.moon.material as THREE.SpriteMaterial
    moonMat.opacity = Math.max(0, night * 1.1 - 0.05)

    this.hemi.intensity = (0.42 + day * 0.38) * (1 - this.tunnelMix * 0.55)
    this.hemi.color.setRGB(lerp(0.45, 1, day), lerp(0.35, 0.62, day), lerp(0.55, 0.48, day))
    this.dir.intensity = (0.45 + day * 1.25) * (1 - this.tunnelMix * 0.78) + lightning * 1.2
    this.dir.color.setRGB(1, lerp(0.55, 0.78, day), lerp(0.42, 0.58, day))
    this.dir.position.set(player.x, 0, player.z + 6).addScaledVector(sunDir, 28)
    this.dir.target.position.set(player.x, 0.4, player.z + 2)
    this.dir.target.updateMatrixWorld()
    this.catcher.position.set(player.x, 0.03, player.z + 4)
    this.shaft.position.copy(sunDir).multiplyScalar(190)
    this.shaft.quaternion.setFromUnitVectors(this.up, sunDir)
    const shaftMat = this.shaft.material as THREE.MeshBasicMaterial
    shaftMat.opacity = (this.high ? 0.055 : 0.028) * (0.35 + day * 0.75) * (1 - this.tunnelMix)
    this.renderer.toneMappingExposure = 0.8 + night * 0.08 + lightning * 0.2
    this.rim.position.set(player.x - 7, 3.4, player.z - 5)
    this.rim.target.position.set(player.x, 0.5, player.z + 1)
    this.rim.target.updateMatrixWorld()
    this.pool.position.set(player.x, 8.5, player.z + 1.5)
    this.pool.target.position.set(player.x, 0, player.z + 1.2)
    this.pool.target.updateMatrixWorld()

    for (const b of this.buildings) {
      if (b.mesh.position.z < player.z - 40) b.mesh.position.z += 462
    }
    for (const lamp of this.lamps) {
      if (lamp.position.z < player.z - 30) lamp.position.z += 24 * 18
    }
    for (const strip of this.strips) {
      if (strip.position.z < player.z - 40) strip.position.z += 26 * 8
    }
    this.rocket.update(dt)
  }
}

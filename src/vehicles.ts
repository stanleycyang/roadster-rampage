import * as THREE from 'three'
import type { VehKind } from './types.ts'

export interface VehModel {
  group: THREE.Group
  wheels: THREE.Object3D[]
  bodyMat: THREE.MeshStandardMaterial
  tail: THREE.MeshBasicMaterial
  lightL: THREE.MeshBasicMaterial | null
  lightR: THREE.MeshBasicMaterial | null
  hw: number
  hl: number
  height: number
  kind: VehKind
}

const tireGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.22, 12)
tireGeo.rotateZ(Math.PI / 2)
const tireMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.9, metalness: 0.05 })
const glassMat = new THREE.MeshStandardMaterial({
  color: 0x0c1a22,
  roughness: 0.08,
  metalness: 0.7,
  transparent: true,
  opacity: 0.78,
  envMapIntensity: 1,
})
const windowMat = new THREE.MeshBasicMaterial({
  color: new THREE.Color().setRGB(0.25, 0.85, 1.15),
  toneMapped: false,
  fog: false,
})
const headMat = new THREE.MeshBasicMaterial({
  color: new THREE.Color().setRGB(2.4, 2.1, 1.5),
  toneMapped: false,
  fog: false,
})
const amberMat = new THREE.MeshBasicMaterial({
  color: new THREE.Color().setRGB(2.4, 1.1, 0.15),
  toneMapped: false,
  fog: false,
})

function tailMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: new THREE.Color().setRGB(2.6, 0.08, 0.06),
    toneMapped: false,
    fog: false,
  })
}

function bodyMaterial(color: number): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color,
    metalness: 0.62,
    roughness: 0.38,
    envMapIntensity: 0.55,
  })
  return mat
}

function wheel(): THREE.Mesh {
  return new THREE.Mesh(tireGeo, tireMat)
}

function addTail(group: THREE.Group, mat: THREE.MeshBasicMaterial, x: number, y: number, z: number, w = 0.42): void {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.08, 0.06), mat)
  m.position.set(x, y, z)
  group.add(m)
}

export function createVehicle(kind: VehKind, color = 0xd8d4ea): VehModel {
  const group = new THREE.Group()
  const tail = tailMaterial()
  const bodyMat = bodyMaterial(color)
  const wheels: THREE.Object3D[] = []
  let hw = 0.82
  let hl = 2.15
  let height = 1.18
  let lightL: THREE.MeshBasicMaterial | null = null
  let lightR: THREE.MeshBasicMaterial | null = null

  const placeWheel = (x: number, z: number) => {
    const w = wheel()
    w.position.set(x, 0.34, z)
    group.add(w)
    wheels.push(w)
  }

  if (kind === 'sedan' || kind === 'police') {
    hw = kind === 'police' ? 0.84 : 0.8
    hl = 2.15
    height = kind === 'police' ? 1.42 : 1.16
    const body = new THREE.Mesh(new THREE.BoxGeometry(hw * 2, 0.48, 4.2), bodyMat)
    body.position.set(0, 0.58, 0)
    group.add(body)
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(hw * 1.55, 0.36, 1.7), glassMat)
    cabin.position.set(0, 0.96, -0.25)
    group.add(cabin)
    placeWheel(-hw + 0.08, 1.25)
    placeWheel(hw - 0.08, 1.25)
    placeWheel(-hw + 0.08, -1.25)
    placeWheel(hw - 0.08, -1.25)
    addTail(group, tail, -0.48, 0.62, -2.12)
    addTail(group, tail, 0.48, 0.62, -2.12)
    const headL = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.08, 0.05), headMat)
    headL.position.set(-0.48, 0.58, 2.12)
    const headR = headL.clone()
    headR.position.x = 0.48
    group.add(headL, headR)
    if (kind === 'police') {
      lightL = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(3.2, 0.05, 0.08), toneMapped: false, fog: false })
      lightR = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(0.08, 0.18, 3.2), toneMapped: false, fog: false })
      const bar = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.08, 0.28), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.5, metalness: 0.4 }))
      bar.position.set(0, 1.22, -0.2)
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.1, 0.22), lightL)
      l.position.set(-0.28, 1.32, -0.2)
      const r = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.1, 0.22), lightR)
      r.position.set(0.28, 1.32, -0.2)
      group.add(bar, l, r)
      bodyMat.color.setHex(0x151820)
    }
  } else if (kind === 'sport') {
    hw = 0.9
    hl = 2.05
    height = 1.02
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.38, 4.05), bodyMat)
    body.position.set(0, 0.5, 0.05)
    group.add(body)
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.28, 1.35), glassMat)
    cabin.position.set(0, 0.78, -0.35)
    group.add(cabin)
    const wing = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.05, 0.32), bodyMat)
    wing.position.set(0, 0.92, -1.7)
    group.add(wing)
    placeWheel(-0.82, 1.2)
    placeWheel(0.82, 1.2)
    placeWheel(-0.86, -1.25)
    placeWheel(0.86, -1.25)
    addTail(group, tail, -0.55, 0.52, -2.02, 0.5)
    addTail(group, tail, 0.55, 0.52, -2.02, 0.5)
  } else if (kind === 'truck') {
    hw = 1.02
    hl = 3.05
    height = 2.32
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.95, 1.35, 2.15), bodyMat)
    cab.position.set(0, 1.15, 1.55)
    group.add(cab)
    const bed = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.15, 3.7), bodyMat)
    bed.position.set(0, 1.05, -1.35)
    group.add(bed)
    const cabGlass = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.48, 0.9), glassMat)
    cabGlass.position.set(0, 1.55, 1.85)
    group.add(cabGlass)
    placeWheel(-0.95, 1.7)
    placeWheel(0.95, 1.7)
    placeWheel(-0.95, -0.4)
    placeWheel(0.95, -0.4)
    placeWheel(-0.95, -2.35)
    placeWheel(0.95, -2.35)
    addTail(group, tail, -0.62, 0.85, -3.15, 0.46)
    addTail(group, tail, 0.62, 0.85, -3.15, 0.46)
    const marker = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.06, 0.08), amberMat)
    marker.position.set(0, 1.9, 1.5)
    group.add(marker)
  } else {
    hw = 0.98
    hl = 4.15
    height = 2.12
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.95, 1.55, 8.2), bodyMat)
    body.position.set(0, 1.25, 0)
    group.add(body)
    const winL = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.48, 6.4), windowMat)
    winL.position.set(-0.98, 1.55, -0.2)
    const winR = winL.clone()
    winR.position.x = 0.98
    group.add(winL, winR)
    placeWheel(-0.95, 2.6)
    placeWheel(0.95, 2.6)
    placeWheel(-0.95, -2.6)
    placeWheel(0.95, -2.6)
    addTail(group, tail, -0.6, 0.85, -4.12, 0.5)
    addTail(group, tail, 0.6, 0.85, -4.12, 0.5)
    const head = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.1, 0.06), headMat)
    head.position.set(0, 0.7, 4.12)
    group.add(head)
  }

  group.visible = false
  return { group, wheels, bodyMat, tail, lightL, lightR, hw, hl, height, kind }
}

export const TRAFFIC_COLORS = [0xe8e6ef, 0x3ec8ff, 0xff4d8d, 0xffc857, 0x8d7cff, 0xfff3d6, 0x57e08a, 0xff7a3c]

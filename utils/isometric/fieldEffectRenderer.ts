import * as THREE from 'three'
import type { GridDimensions } from '~/types/pokemon'
import type { MapFieldEffects, MapVoxelV2, MapWeatherKind } from '~/types/map'
import { MAP_ROOM_DEFINITIONS, MAP_TERRAIN_DEFINITIONS } from '~/utils/mapFieldEffects'
import { parseHexColor } from '~/utils/voxels'
import { disposeObject3D } from './resourceDisposal'

export interface FieldEffectRendererInput {
  dimensions: GridDimensions
  voxels: ReadonlyArray<MapVoxelV2>
  groundLevelY: number
  effects: MapFieldEffects
}

export interface FieldEffectRenderer {
  sync(input: FieldEffectRendererInput): void
  update(delta: number, elapsed: number): void
  setVisible(visible: boolean): void
  dispose(): void
}

export const createFieldEffectRenderer = (container: THREE.Group): FieldEffectRenderer => {
  const fieldEffectObjects: THREE.Object3D[] = []
  const fieldEffectAnimators: Array<(delta: number, elapsed: number) => void> = []
  let visible = true
  let input: FieldEffectRendererInput = {
    dimensions: { x: 1, y: 1, z: 1 },
    voxels: [],
    groundLevelY: 0,
    effects: {},
  }

  const disposeFieldEffectObjects = () => {
    fieldEffectAnimators.splice(0)
    for (const object of fieldEffectObjects.splice(0)) disposeObject3D(object)
  }

  const fieldEffectColor = (color: string, fallback = 0xfabd2f): number =>
    parseHexColor(color) ?? fallback

  const makeSurfaceFieldEffectMesh = (
    color: string,
    opacity: number,
    yOffset: number,
    inset: number,
    renderOrder: number,
  ): THREE.InstancedMesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> => {
    const count = Math.max(1, input.dimensions.x * input.dimensions.z)
    const mesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(Math.max(0.2, 1 - inset), Math.max(0.2, 1 - inset)),
      new THREE.MeshBasicMaterial({
        color: fieldEffectColor(color),
        transparent: true,
        opacity,
        depthTest: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
      count,
    )

    const groundY = input.groundLevelY
    const columnTop = new Map<string, number>()
    for (const voxel of input.voxels) {
      const key = `${voxel.x},${voxel.z}`
      columnTop.set(key, Math.max(columnTop.get(key) ?? groundY, voxel.y + 1))
    }

    const rotation = new THREE.Matrix4().makeRotationX(-Math.PI / 2)
    const translation = new THREE.Matrix4()
    const matrix = new THREE.Matrix4()
    let index = 0
    for (let z = 0; z < input.dimensions.z; z += 1) {
      for (let x = 0; x < input.dimensions.x; x += 1) {
        const y = Math.max(groundY, columnTop.get(`${x},${z}`) ?? groundY) + yOffset
        translation.makeTranslation(x + 0.5, y, z + 0.5)
        matrix.multiplyMatrices(translation, rotation)
        mesh.setMatrixAt(index, matrix)
        index += 1
      }
    }
    mesh.count = index
    mesh.instanceMatrix.needsUpdate = true
    mesh.renderOrder = renderOrder
    return mesh
  }

  interface WeatherVisual {
    group: THREE.Group
    update: (delta: number, elapsed: number) => void
  }

  interface WeatherBounds {
    minX: number
    maxX: number
    minZ: number
    maxZ: number
    centerX: number
    centerZ: number
    groundY: number
    topY: number
    width: number
    depth: number
    height: number
  }

  const seededWeatherRandom = (seed: string) => {
    let state = 2166136261
    for (let i = 0; i < seed.length; i += 1) {
      state = Math.imul(state ^ seed.charCodeAt(i), 16777619) >>> 0
    }

    return () => {
      state = (state + 0x6d2b79f5) >>> 0
      let t = state
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  const randomRange = (rand: () => number, min: number, max: number) =>
    min + (max - min) * rand()

  const wrapRange = (value: number, min: number, max: number) => {
    const size = max - min
    if (size <= 0) return min
    return min + ((((value - min) % size) + size) % size)
  }

  const getWeatherBounds = (): WeatherBounds => {
    const groundY = input.groundLevelY
    let highestY = groundY
    for (const voxel of input.voxels) {
      highestY = Math.max(highestY, voxel.y + 1)
    }

    const maxMapSide = Math.max(input.dimensions.x, input.dimensions.z)
    const margin = Math.max(1.4, Math.min(5, maxMapSide * 0.22))
    const topY = Math.max(
      highestY + 3.2,
      groundY + Math.max(4.5, input.dimensions.y + 1.5),
    )
    const minX = -margin
    const maxX = input.dimensions.x + margin
    const minZ = -margin
    const maxZ = input.dimensions.z + margin

    return {
      minX,
      maxX,
      minZ,
      maxZ,
      centerX: input.dimensions.x / 2,
      centerZ: input.dimensions.z / 2,
      groundY,
      topY,
      width: maxX - minX,
      depth: maxZ - minZ,
      height: topY - groundY,
    }
  }

  let sunRayTexture: THREE.CanvasTexture | null = null
  let sandstreamTexture: THREE.CanvasTexture | null = null

  const getSunRayTexture = () => {
    if (sunRayTexture) return sunRayTexture

    const canvas = document.createElement('canvas')
    canvas.width = 128
    canvas.height = 512
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2d canvas context unavailable')

    const horizontal = ctx.createLinearGradient(0, 0, canvas.width, 0)
    horizontal.addColorStop(0, 'rgba(255, 226, 128, 0)')
    horizontal.addColorStop(0.28, 'rgba(255, 226, 128, 0.18)')
    horizontal.addColorStop(0.5, 'rgba(255, 239, 170, 0.82)')
    horizontal.addColorStop(0.72, 'rgba(255, 226, 128, 0.18)')
    horizontal.addColorStop(1, 'rgba(255, 226, 128, 0)')
    ctx.fillStyle = horizontal
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    const verticalMask = ctx.createLinearGradient(0, 0, 0, canvas.height)
    verticalMask.addColorStop(0, 'rgba(255, 255, 255, 0)')
    verticalMask.addColorStop(0.16, 'rgba(255, 255, 255, 0.95)')
    verticalMask.addColorStop(0.72, 'rgba(255, 255, 255, 0.58)')
    verticalMask.addColorStop(1, 'rgba(255, 255, 255, 0)')
    ctx.globalCompositeOperation = 'destination-in'
    ctx.fillStyle = verticalMask
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    sunRayTexture = new THREE.CanvasTexture(canvas)
    sunRayTexture.colorSpace = THREE.SRGBColorSpace
    sunRayTexture.needsUpdate = true
    return sunRayTexture
  }

  const getSandstreamTexture = () => {
    if (sandstreamTexture) return sandstreamTexture

    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = 256
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2d canvas context unavailable')

    const rand = seededWeatherRandom('sandstream-texture')
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    const haze = ctx.createLinearGradient(0, 0, canvas.width, 0)
    haze.addColorStop(0, 'rgba(250, 189, 47, 0)')
    haze.addColorStop(0.32, 'rgba(250, 189, 47, 0.08)')
    haze.addColorStop(0.68, 'rgba(235, 219, 178, 0.11)')
    haze.addColorStop(1, 'rgba(250, 189, 47, 0)')
    ctx.fillStyle = haze
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    ctx.lineCap = 'round'
    for (let i = 0; i < 92; i += 1) {
      const y = randomRange(rand, -20, canvas.height + 20)
      const lift = randomRange(rand, -22, 22)
      const alpha = randomRange(rand, 0.05, 0.22)
      const width = randomRange(rand, 0.7, 4.5)
      ctx.strokeStyle = `rgba(250, 213, 133, ${alpha})`
      ctx.lineWidth = width
      ctx.beginPath()
      ctx.moveTo(-40, y)
      ctx.bezierCurveTo(
        canvas.width * 0.28,
        y + lift,
        canvas.width * 0.68,
        y - lift * 0.55,
        canvas.width + 40,
        y + lift * 0.35,
      )
      ctx.stroke()
    }

    for (let i = 0; i < 130; i += 1) {
      const radius = randomRange(rand, 0.45, 1.8)
      ctx.fillStyle = `rgba(255, 236, 170, ${randomRange(rand, 0.08, 0.28)})`
      ctx.beginPath()
      ctx.ellipse(
        randomRange(rand, 0, canvas.width),
        randomRange(rand, 0, canvas.height),
        radius * randomRange(rand, 1.4, 3.2),
        radius,
        randomRange(rand, -0.4, 0.4),
        0,
        Math.PI * 2,
      )
      ctx.fill()
    }

    sandstreamTexture = new THREE.CanvasTexture(canvas)
    sandstreamTexture.wrapS = THREE.RepeatWrapping
    sandstreamTexture.wrapT = THREE.ClampToEdgeWrapping
    sandstreamTexture.repeat.set(1.7, 1)
    sandstreamTexture.colorSpace = THREE.SRGBColorSpace
    sandstreamTexture.needsUpdate = true
    return sandstreamTexture
  }

  const disposeWeatherTextureCache = () => {
    sunRayTexture?.dispose()
    sandstreamTexture?.dispose()
    sunRayTexture = null
    sandstreamTexture = null
  }

  const makeSunnyWeatherVisual = (seed: string, index: number, total: number): WeatherVisual => {
    const rand = seededWeatherRandom(seed)
    const bounds = getWeatherBounds()
    const group = new THREE.Group()
    group.name = 'weather-sun-rays'

    const texture = getSunRayTexture()
    const rayCount = Math.round(THREE.MathUtils.clamp(input.dimensions.x * 0.45 + 3, 5, 10))
    const opacityScale = total > 1 ? 0.65 : 1
    const rays: Array<{
      sprite: THREE.Sprite
      baseX: number
      baseY: number
      baseZ: number
      baseOpacity: number
      phase: number
      drift: number
    }> = []

    for (let i = 0; i < rayCount; i += 1) {
      const material = new THREE.SpriteMaterial({
        map: texture,
        color: 0xffe9a6,
        transparent: true,
        opacity: randomRange(rand, 0.22, 0.38) * opacityScale,
        depthTest: false,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
      material.rotation = THREE.MathUtils.degToRad(-23)

      const sprite = new THREE.Sprite(material)
      sprite.renderOrder = 24 + index
      sprite.frustumCulled = false
      sprite.center.set(0.5, 0.52)

      const lane = (i + 0.5) / rayCount
      const baseX = bounds.minX + lane * bounds.width + randomRange(rand, -0.42, 0.42)
      const baseY = bounds.groundY + bounds.height * randomRange(rand, 0.48, 0.72)
      const baseZ = bounds.centerZ + randomRange(rand, -bounds.depth * 0.22, bounds.depth * 0.22)
      const rayWidth = randomRange(rand, 0.55, 1.25) * Math.max(1, input.dimensions.x / 9)
      const rayHeight = bounds.height * randomRange(rand, 0.92, 1.42)

      sprite.position.set(baseX, baseY, baseZ)
      sprite.scale.set(rayWidth, rayHeight, 1)
      group.add(sprite)
      rays.push({
        sprite,
        baseX,
        baseY,
        baseZ,
        baseOpacity: material.opacity,
        phase: randomRange(rand, 0, Math.PI * 2),
        drift: randomRange(rand, 0.08, 0.24),
      })
    }

    return {
      group,
      update: (_delta, elapsed) => {
        for (const ray of rays) {
          ray.sprite.position.set(
            ray.baseX + Math.sin(elapsed * 0.18 + ray.phase) * ray.drift,
            ray.baseY + Math.sin(elapsed * 0.14 + ray.phase * 0.7) * 0.06,
            ray.baseZ,
          )
          ray.sprite.material.opacity = ray.baseOpacity * (0.82 + Math.sin(elapsed * 0.62 + ray.phase) * 0.18)
        }
      },
    }
  }

  const makeRainyWeatherVisual = (seed: string, index: number, total: number): WeatherVisual => {
    const rand = seededWeatherRandom(seed)
    const bounds = getWeatherBounds()
    const group = new THREE.Group()
    group.name = 'weather-rain'

    const area = input.dimensions.x * input.dimensions.z
    const count = Math.round(THREE.MathUtils.clamp(area * 3.4, 100, 320) * (total > 1 ? 0.72 : 1))
    const positions = new Float32Array(count * 2 * 3)
    const drops = Array.from({ length: count }, () => ({
      x: randomRange(rand, bounds.minX, bounds.maxX),
      y: randomRange(rand, bounds.groundY, bounds.topY),
      z: randomRange(rand, bounds.minZ, bounds.maxZ),
      speed: randomRange(rand, 3.8, 6.8),
      length: randomRange(rand, 0.45, 0.95),
      slantX: randomRange(rand, 0.18, 0.34),
      slantZ: randomRange(rand, 0.05, 0.18),
    }))

    const geometry = new THREE.BufferGeometry()
    const positionAttribute = new THREE.BufferAttribute(positions, 3)
    geometry.setAttribute('position', positionAttribute)

    const material = new THREE.LineBasicMaterial({
      color: 0xb8e6ff,
      transparent: true,
      opacity: total > 1 ? 0.48 : 0.66,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    const lines = new THREE.LineSegments(geometry, material)
    lines.renderOrder = 26 + index
    lines.frustumCulled = false
    group.add(lines)

    const syncPositions = () => {
      for (let i = 0; i < drops.length; i += 1) {
        const drop = drops[i]
        const offset = i * 6
        positions[offset] = drop.x
        positions[offset + 1] = drop.y
        positions[offset + 2] = drop.z
        positions[offset + 3] = drop.x + drop.slantX
        positions[offset + 4] = drop.y - drop.length
        positions[offset + 5] = drop.z + drop.slantZ
      }
      positionAttribute.needsUpdate = true
    }
    syncPositions()

    return {
      group,
      update: (delta) => {
        for (const drop of drops) {
          drop.y -= drop.speed * delta
          drop.x += 0.72 * delta
          drop.z += 0.28 * delta
          drop.x = wrapRange(drop.x, bounds.minX, bounds.maxX)
          drop.z = wrapRange(drop.z, bounds.minZ, bounds.maxZ)
          if (drop.y < bounds.groundY - 0.25) {
            drop.y = bounds.topY + randomRange(rand, 0, 1.2)
            drop.x = randomRange(rand, bounds.minX, bounds.maxX)
            drop.z = randomRange(rand, bounds.minZ, bounds.maxZ)
          }
        }
        syncPositions()
      },
    }
  }

  const makeHailWeatherVisual = (seed: string, index: number, total: number): WeatherVisual => {
    const rand = seededWeatherRandom(seed)
    const bounds = getWeatherBounds()
    const group = new THREE.Group()
    group.name = 'weather-hail'

    const area = input.dimensions.x * input.dimensions.z
    const count = Math.round(THREE.MathUtils.clamp(area * 1.55, 64, 180) * (total > 1 ? 0.75 : 1))
    const geometry = new THREE.OctahedronGeometry(1, 0)
    const material = new THREE.MeshBasicMaterial({
      // Keep this a fixed icy color; enabling vertexColors on an
      // InstancedMesh without per-vertex color data renders black on
      // some three.js/WebGL paths.
      color: 0xeafaff,
      transparent: true,
      opacity: total > 1 ? 0.72 : 0.88,
      depthTest: false,
      depthWrite: false,
    })
    const mesh = new THREE.InstancedMesh(geometry, material, count)
    mesh.renderOrder = 27 + index
    mesh.frustumCulled = false
    group.add(mesh)

    const particles = Array.from({ length: count }, () => ({
      x: randomRange(rand, bounds.minX, bounds.maxX),
      y: randomRange(rand, bounds.groundY, bounds.topY),
      z: randomRange(rand, bounds.minZ, bounds.maxZ),
      speed: randomRange(rand, 2.4, 4.6),
      driftX: randomRange(rand, -0.18, 0.34),
      driftZ: randomRange(rand, -0.08, 0.24),
      scale: randomRange(rand, 0.045, 0.09),
      phase: randomRange(rand, 0, Math.PI * 2),
      spin: randomRange(rand, 1.8, 4.2),
    }))

    const matrix = new THREE.Matrix4()
    const position = new THREE.Vector3()
    const quaternion = new THREE.Quaternion()
    const rotation = new THREE.Euler()
    const scale = new THREE.Vector3()

    const syncInstances = (elapsed: number) => {
      for (let i = 0; i < particles.length; i += 1) {
        const p = particles[i]
        const pulse = 1 + Math.sin(elapsed * 5.2 + p.phase) * 0.08
        position.set(p.x, p.y, p.z)
        rotation.set(p.phase + elapsed * p.spin, p.phase * 0.7 + elapsed * p.spin * 0.8, p.phase * 1.3)
        quaternion.setFromEuler(rotation)
        scale.set(p.scale * pulse, p.scale * 1.35 * pulse, p.scale * pulse)
        matrix.compose(position, quaternion, scale)
        mesh.setMatrixAt(i, matrix)
      }
      mesh.instanceMatrix.needsUpdate = true
    }
    syncInstances(0)

    return {
      group,
      update: (delta, elapsed) => {
        for (const p of particles) {
          p.y -= p.speed * delta
          p.x += p.driftX * delta
          p.z += p.driftZ * delta
          p.x = wrapRange(p.x, bounds.minX, bounds.maxX)
          p.z = wrapRange(p.z, bounds.minZ, bounds.maxZ)
          if (p.y < bounds.groundY + 0.02) {
            p.y = bounds.topY + randomRange(rand, 0, 0.8)
            p.x = randomRange(rand, bounds.minX, bounds.maxX)
            p.z = randomRange(rand, bounds.minZ, bounds.maxZ)
          }
        }
        syncInstances(elapsed)
      },
    }
  }

  const makeSandstormWeatherVisual = (seed: string, index: number, total: number): WeatherVisual => {
    const rand = seededWeatherRandom(seed)
    const bounds = getWeatherBounds()
    const group = new THREE.Group()
    group.name = 'weather-sandstream'

    const streamTexture = getSandstreamTexture()
    const planeWidth = Math.hypot(bounds.width, bounds.depth) + bounds.height + 4
    const planeHeight = Math.max(2.2, bounds.height * 0.72)
    const opacityScale = total > 1 ? 0.65 : 1
    const ribbons: Array<{
      sprite: THREE.Sprite
      baseY: number
      baseOpacity: number
      phase: number
    }> = []

    for (let i = 0; i < 4; i += 1) {
      const material = new THREE.SpriteMaterial({
        map: streamTexture,
        color: 0xffddb1,
        transparent: true,
        opacity: randomRange(rand, 0.2, 0.34) * opacityScale,
        depthTest: false,
        depthWrite: false,
      })
      material.rotation = THREE.MathUtils.degToRad(randomRange(rand, -10, -5))
      const sprite = new THREE.Sprite(material)
      const baseY = bounds.groundY + planeHeight * randomRange(rand, 0.34, 0.58) + i * 0.18
      sprite.position.set(
        bounds.centerX + randomRange(rand, -0.4, 0.4),
        baseY,
        bounds.minZ + ((i + 0.5) / 4) * bounds.depth + randomRange(rand, -0.4, 0.4),
      )
      sprite.scale.set(planeWidth, planeHeight, 1)
      sprite.renderOrder = 25 + index
      sprite.frustumCulled = false
      group.add(sprite)
      ribbons.push({ sprite, baseY, baseOpacity: material.opacity, phase: randomRange(rand, 0, Math.PI * 2) })
    }

    const moteCount = Math.round(THREE.MathUtils.clamp(input.dimensions.x * input.dimensions.z * 2.15, 90, 260) * (total > 1 ? 0.75 : 1))
    const motePositions = new Float32Array(moteCount * 3)
    const motes = Array.from({ length: moteCount }, () => ({
      x: randomRange(rand, bounds.minX, bounds.maxX),
      y: randomRange(rand, bounds.groundY + 0.12, bounds.groundY + bounds.height * 0.78),
      z: randomRange(rand, bounds.minZ, bounds.maxZ),
      speedX: randomRange(rand, 0.85, 1.85),
      speedZ: randomRange(rand, 0.18, 0.65),
      bob: randomRange(rand, 0.015, 0.055),
      phase: randomRange(rand, 0, Math.PI * 2),
    }))
    const moteGeometry = new THREE.BufferGeometry()
    const moteAttribute = new THREE.BufferAttribute(motePositions, 3)
    moteGeometry.setAttribute('position', moteAttribute)
    const moteMaterial = new THREE.PointsMaterial({
      color: 0xf2c46d,
      transparent: true,
      opacity: total > 1 ? 0.34 : 0.48,
      size: 0.075,
      sizeAttenuation: true,
      depthTest: false,
      depthWrite: false,
    })
    const motePoints = new THREE.Points(moteGeometry, moteMaterial)
    motePoints.renderOrder = 28 + index
    motePoints.frustumCulled = false
    group.add(motePoints)

    const syncMotes = (elapsed: number) => {
      for (let i = 0; i < motes.length; i += 1) {
        const mote = motes[i]
        const offset = i * 3
        motePositions[offset] = mote.x
        motePositions[offset + 1] = mote.y + Math.sin(elapsed * 3.4 + mote.phase) * mote.bob
        motePositions[offset + 2] = mote.z
      }
      moteAttribute.needsUpdate = true
    }
    syncMotes(0)

    return {
      group,
      update: (delta, elapsed) => {
        streamTexture.offset.x = (streamTexture.offset.x + delta * 0.18) % 1
        streamTexture.offset.y = (streamTexture.offset.y + delta * 0.012) % 1
        for (const ribbon of ribbons) {
          ribbon.sprite.position.y = ribbon.baseY + Math.sin(elapsed * 0.42 + ribbon.phase) * 0.1
          ribbon.sprite.material.opacity = ribbon.baseOpacity * (0.92 + Math.sin(elapsed * 0.55 + ribbon.phase) * 0.08)
        }
        for (const mote of motes) {
          mote.x = wrapRange(mote.x + mote.speedX * delta, bounds.minX, bounds.maxX)
          mote.z = wrapRange(mote.z + mote.speedZ * delta, bounds.minZ, bounds.maxZ)
        }
        syncMotes(elapsed)
      },
    }
  }

  const makeWeatherVisual = (kind: MapWeatherKind, index: number, total: number): WeatherVisual => {
    const seed = `${kind}:${input.dimensions.x}x${input.dimensions.y}x${input.dimensions.z}:${index}`
    switch (kind) {
      case 'sunny':
        return makeSunnyWeatherVisual(seed, index, total)
      case 'rainy':
        return makeRainyWeatherVisual(seed, index, total)
      case 'hail':
        return makeHailWeatherVisual(seed, index, total)
      case 'sandstorm':
        return makeSandstormWeatherVisual(seed, index, total)
    }
  }

  const makeRoomBoundary = (
    color: string,
    opacity: number,
    y: number,
    inset: number,
  ): THREE.LineSegments<THREE.EdgesGeometry, THREE.LineBasicMaterial> => {
    const width = Math.max(0.2, input.dimensions.x - inset * 2)
    const depth = Math.max(0.2, input.dimensions.z - inset * 2)
    const height = Math.max(1, input.dimensions.y - y)
    const geometry = new THREE.BoxGeometry(width, height, depth)
    const edges = new THREE.EdgesGeometry(geometry)
    geometry.dispose()
    const lines = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({
        color: fieldEffectColor(color),
        transparent: true,
        opacity,
        depthTest: true,
        depthWrite: false,
      }),
    )
    lines.position.set(input.dimensions.x / 2, y + height / 2, input.dimensions.z / 2)
    lines.renderOrder = 18
    return lines
  }

  const sync = (nextInput: FieldEffectRendererInput) => {
    input = nextInput
    disposeFieldEffectObjects()

    const effects = input.effects
    const groundY = input.groundLevelY

    effects.weather?.forEach((effect, index) => {
      const visual = makeWeatherVisual(effect.kind, index, effects.weather!.length)
      container.add(visual.group)
      fieldEffectObjects.push(visual.group)
      fieldEffectAnimators.push(visual.update)
    })

    effects.terrains?.forEach((effect, index) => {
      const def = MAP_TERRAIN_DEFINITIONS[effect.kind]
      const surface = makeSurfaceFieldEffectMesh(def.color, effects.terrains!.length > 1 ? 0.16 : 0.22, 0.022 + index * 0.003, index * 0.18, 9 + index)
      container.add(surface)
      fieldEffectObjects.push(surface)
    })

    effects.rooms?.forEach((effect, index) => {
      const def = MAP_ROOM_DEFINITIONS[effect.kind]
      const boundary = makeRoomBoundary(def.color, effects.rooms!.length > 1 ? 0.42 : 0.62, groundY + 0.02, index * 0.18)
      container.add(boundary)
      fieldEffectObjects.push(boundary)
    })

    container.visible = visible
    for (const object of fieldEffectObjects) object.visible = visible
  }

  return {
    sync,

    update(delta, elapsed) {
      for (const updateFieldEffect of fieldEffectAnimators) {
        updateFieldEffect(delta, elapsed)
      }
    },

    setVisible(nextVisible) {
      visible = nextVisible
      container.visible = nextVisible
      for (const object of fieldEffectObjects) object.visible = nextVisible
    },

    dispose() {
      disposeFieldEffectObjects()
      disposeWeatherTextureCache()
    },
  }
}

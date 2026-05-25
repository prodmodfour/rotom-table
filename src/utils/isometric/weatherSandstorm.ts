import * as THREE from 'three'
import {
  getWeatherBounds,
  randomRange,
  seededWeatherRandom,
  wrapRange,
  type WeatherEffectRendererInput,
} from './weatherMath'
import {
  SAND_RIBBON_COUNT,
  layeredSandRibbonOpacityScale,
  sandMoteCountForDimensions,
} from './weatherVisualConfig'
import type { WeatherTextureCache } from './weatherTextures'
import type { WeatherVisual } from './weatherVisualTypes'

export const makeSandstormWeatherVisual = (
  input: WeatherEffectRendererInput,
  seed: string,
  index: number,
  total: number,
  weatherTextures: WeatherTextureCache,
): WeatherVisual => {
  const rand = seededWeatherRandom(seed)
  const bounds = getWeatherBounds(input)
  const group = new THREE.Group()
  group.name = 'weather-sandstream'

  const streamTexture = weatherTextures.getSandstreamTexture()
  const planeWidth = Math.hypot(bounds.width, bounds.depth) + bounds.height + 4
  const planeHeight = Math.max(2.2, bounds.height * 0.72)
  const opacityScale = layeredSandRibbonOpacityScale(total)
  const ribbons: Array<{
    sprite: THREE.Sprite
    baseY: number
    baseOpacity: number
    phase: number
  }> = []

  for (let i = 0; i < SAND_RIBBON_COUNT; i += 1) {
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
    const baseY =
      bounds.groundY + planeHeight * randomRange(rand, 0.34, 0.58) + i * 0.18
    sprite.position.set(
      bounds.centerX + randomRange(rand, -0.4, 0.4),
      baseY,
      bounds.minZ +
        ((i + 0.5) / SAND_RIBBON_COUNT) * bounds.depth +
        randomRange(rand, -0.4, 0.4),
    )
    sprite.scale.set(planeWidth, planeHeight, 1)
    sprite.renderOrder = 25 + index
    sprite.frustumCulled = false
    group.add(sprite)
    ribbons.push({
      sprite,
      baseY,
      baseOpacity: material.opacity,
      phase: randomRange(rand, 0, Math.PI * 2),
    })
  }

  const moteCount = sandMoteCountForDimensions(input.dimensions, total)
  const motePositions = new Float32Array(moteCount * 3)
  const moteX = new Float64Array(moteCount)
  const moteY = new Float64Array(moteCount)
  const moteZ = new Float64Array(moteCount)
  const moteSpeedX = new Float64Array(moteCount)
  const moteSpeedZ = new Float64Array(moteCount)
  const moteBob = new Float64Array(moteCount)
  const motePhase = new Float64Array(moteCount)

  for (let i = 0; i < moteCount; i += 1) {
    moteX[i] = randomRange(rand, bounds.minX, bounds.maxX)
    moteY[i] = randomRange(
      rand,
      bounds.groundY + 0.12,
      bounds.groundY + bounds.height * 0.78,
    )
    moteZ[i] = randomRange(rand, bounds.minZ, bounds.maxZ)
    moteSpeedX[i] = randomRange(rand, 0.85, 1.85)
    moteSpeedZ[i] = randomRange(rand, 0.18, 0.65)
    moteBob[i] = randomRange(rand, 0.015, 0.055)
    motePhase[i] = randomRange(rand, 0, Math.PI * 2)
  }
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
    for (let i = 0; i < moteCount; i += 1) {
      const offset = i * 3
      motePositions[offset] = moteX[i]
      motePositions[offset + 1] =
        moteY[i] + Math.sin(elapsed * 3.4 + motePhase[i]) * moteBob[i]
      motePositions[offset + 2] = moteZ[i]
    }
    moteAttribute.needsUpdate = true
  }
  syncMotes(0)

  return {
    group,
    update: (delta, elapsed) => {
      streamTexture.offset.x = (streamTexture.offset.x + delta * 0.18) % 1
      streamTexture.offset.y = (streamTexture.offset.y + delta * 0.012) % 1
      for (let i = 0; i < ribbons.length; i += 1) {
        const ribbon = ribbons[i]
        ribbon.sprite.position.y =
          ribbon.baseY + Math.sin(elapsed * 0.42 + ribbon.phase) * 0.1
        ribbon.sprite.material.opacity =
          ribbon.baseOpacity *
          (0.92 + Math.sin(elapsed * 0.55 + ribbon.phase) * 0.08)
      }
      for (let i = 0; i < moteCount; i += 1) {
        moteX[i] = wrapRange(
          moteX[i] + moteSpeedX[i] * delta,
          bounds.minX,
          bounds.maxX,
        )
        moteZ[i] = wrapRange(
          moteZ[i] + moteSpeedZ[i] * delta,
          bounds.minZ,
          bounds.maxZ,
        )
      }
      syncMotes(elapsed)
    },
  }
}

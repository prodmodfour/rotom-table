import * as THREE from 'three'
import { randomRange, seededWeatherRandom } from './weatherMath'

export interface WeatherTextureCache {
  getSunRayTexture(): THREE.CanvasTexture
  getSandstreamTexture(): THREE.CanvasTexture
  disposeTextureCache(): void
}

export interface WeatherTextureCacheOptions {
  createCanvas?: (width: number, height: number) => HTMLCanvasElement
}

const createCanvasElement = (width: number, height: number): HTMLCanvasElement => {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

const requireCanvasContext = (canvas: HTMLCanvasElement) => {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d canvas context unavailable')
  return ctx
}

export const createWeatherTextureCache = (
  options: WeatherTextureCacheOptions = {},
): WeatherTextureCache => {
  const createCanvas = options.createCanvas ?? createCanvasElement
  let sunRayTexture: THREE.CanvasTexture | null = null
  let sandstreamTexture: THREE.CanvasTexture | null = null

  const getSunRayTexture = () => {
    if (sunRayTexture) return sunRayTexture

    const canvas = createCanvas(128, 512)
    const ctx = requireCanvasContext(canvas)

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

    const canvas = createCanvas(512, 256)
    const ctx = requireCanvasContext(canvas)

    const rand = seededWeatherRandom('sandstream-texture')
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    const haze = ctx.createLinearGradient(0, 0, canvas.width, 0)
    haze.addColorStop(0, 'rgba(202, 164, 90, 0)')
    haze.addColorStop(0.32, 'rgba(202, 164, 90, 0.08)')
    haze.addColorStop(0.68, 'rgba(247, 224, 170, 0.11)')
    haze.addColorStop(1, 'rgba(202, 164, 90, 0)')
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

  const disposeTextureCache = () => {
    sunRayTexture?.dispose()
    sandstreamTexture?.dispose()
    sunRayTexture = null
    sandstreamTexture = null
  }

  return {
    getSunRayTexture,
    getSandstreamTexture,
    disposeTextureCache,
  }
}

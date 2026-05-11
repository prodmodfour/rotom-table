import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { createWeatherTextureCache } from '~/utils/isometric/weatherTextures'

const createFakeCanvasFactory = () => {
  const gradient = { addColorStop: vi.fn() }
  const context = {
    createLinearGradient: vi.fn(() => gradient),
    fillRect: vi.fn(),
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    bezierCurveTo: vi.fn(),
    stroke: vi.fn(),
    ellipse: vi.fn(),
    fill: vi.fn(),
    fillStyle: '',
    globalCompositeOperation: 'source-over',
    lineCap: 'butt',
    lineWidth: 1,
    strokeStyle: '',
  } as unknown as CanvasRenderingContext2D

  const createCanvas = vi.fn((width: number, height: number) => ({
    width,
    height,
    getContext: vi.fn(() => context),
  }) as unknown as HTMLCanvasElement)

  return { context, createCanvas }
}

describe('weather texture cache', () => {
  it('creates and caches sun-ray textures with deterministic canvas dimensions', () => {
    const { context, createCanvas } = createFakeCanvasFactory()
    const cache = createWeatherTextureCache({ createCanvas })

    const first = cache.getSunRayTexture()
    const second = cache.getSunRayTexture()

    expect(second).toBe(first)
    expect(createCanvas).toHaveBeenCalledOnce()
    expect(createCanvas).toHaveBeenCalledWith(128, 512)
    expect(context.createLinearGradient).toHaveBeenCalledTimes(2)
    expect(first.colorSpace).toBe(THREE.SRGBColorSpace)
  })

  it('creates and caches sandstream textures with repeat wrapping', () => {
    const { context, createCanvas } = createFakeCanvasFactory()
    const cache = createWeatherTextureCache({ createCanvas })

    const first = cache.getSandstreamTexture()
    const second = cache.getSandstreamTexture()

    expect(second).toBe(first)
    expect(createCanvas).toHaveBeenCalledOnce()
    expect(createCanvas).toHaveBeenCalledWith(512, 256)
    expect(context.bezierCurveTo).toHaveBeenCalledTimes(92)
    expect(context.ellipse).toHaveBeenCalledTimes(130)
    expect(first.wrapS).toBe(THREE.RepeatWrapping)
    expect(first.wrapT).toBe(THREE.ClampToEdgeWrapping)
    expect(first.repeat.x).toBeCloseTo(1.7)
    expect(first.repeat.y).toBe(1)
    expect(first.colorSpace).toBe(THREE.SRGBColorSpace)
  })

  it('disposes cached textures and recreates them on demand', () => {
    const { createCanvas } = createFakeCanvasFactory()
    const cache = createWeatherTextureCache({ createCanvas })
    const sun = cache.getSunRayTexture()
    const sand = cache.getSandstreamTexture()
    const disposeSun = vi.spyOn(sun, 'dispose')
    const disposeSand = vi.spyOn(sand, 'dispose')

    cache.disposeTextureCache()
    const nextSun = cache.getSunRayTexture()

    expect(disposeSun).toHaveBeenCalledOnce()
    expect(disposeSand).toHaveBeenCalledOnce()
    expect(nextSun).not.toBe(sun)
    expect(createCanvas).toHaveBeenCalledTimes(3)
  })
})

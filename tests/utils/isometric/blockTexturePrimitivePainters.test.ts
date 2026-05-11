import { describe, expect, it } from 'vitest'
import { BLOCK_TEXTURE_SIZE } from '~/utils/isometric/blockTextureConstants'
import {
  drawHazardStripeOverlay,
  drawTechPanelOverlay,
  paintDirtTexture,
  paintGrassSideTexture,
  putBlockPixel,
} from '~/utils/isometric/blockTexturePrimitivePainters'

type FillCall = {
  x: number
  y: number
  width: number
  height: number
  fillStyle: string | CanvasGradient | CanvasPattern
  globalAlpha: number
}

type StrokeCall = {
  strokeStyle: string | CanvasGradient | CanvasPattern
  globalAlpha: number
  lineWidth: number
}

interface FakeCanvasContext extends Partial<CanvasRenderingContext2D> {
  fillStyle: string | CanvasGradient | CanvasPattern
  strokeStyle: string | CanvasGradient | CanvasPattern
  globalAlpha: number
  lineWidth: number
  fillCalls: FillCall[]
  strokeCalls: StrokeCall[]
}

const createFakeCanvasContext = (): FakeCanvasContext => ({
  fillStyle: '#000000',
  strokeStyle: '#000000',
  globalAlpha: 1,
  lineWidth: 1,
  fillCalls: [],
  strokeCalls: [],
  save: () => undefined,
  restore: () => undefined,
  beginPath: () => undefined,
  moveTo: () => undefined,
  lineTo: () => undefined,
  fillRect(x, y, width, height) {
    this.fillCalls.push({
      x,
      y,
      width,
      height,
      fillStyle: this.fillStyle,
      globalAlpha: this.globalAlpha,
    })
  },
  stroke() {
    this.strokeCalls.push({
      strokeStyle: this.strokeStyle,
      globalAlpha: this.globalAlpha,
      lineWidth: this.lineWidth,
    })
  },
})

const asCanvas = (ctx: FakeCanvasContext) => ctx as CanvasRenderingContext2D

describe('isometric block texture primitive painters', () => {
  it('writes one generated pixel with CSS hex color', () => {
    const ctx = createFakeCanvasContext()

    putBlockPixel(asCanvas(ctx), 2, 3, 0x123abc)

    expect(ctx.fillCalls).toEqual([
      expect.objectContaining({
        x: 2,
        y: 3,
        width: 1,
        height: 1,
        fillStyle: '#123abc',
      }),
    ])
  })

  it('paints full generated grids for base terrain primitives', () => {
    const dirt = createFakeCanvasContext()
    const grassSide = createFakeCanvasContext()

    paintDirtTexture(asCanvas(dirt), 'top', 42)
    paintGrassSideTexture(asCanvas(grassSide), 'side', 42)

    expect(dirt.fillCalls).toHaveLength(BLOCK_TEXTURE_SIZE * BLOCK_TEXTURE_SIZE)
    expect(grassSide.fillCalls.length).toBeGreaterThan(BLOCK_TEXTURE_SIZE * BLOCK_TEXTURE_SIZE)
    expect(dirt.fillCalls.every((call) => call.width === 1 && call.height === 1)).toBe(true)
  })

  it('draws hazard stripe overlays with deterministic stripe dimensions', () => {
    const ctx = createFakeCanvasContext()

    drawHazardStripeOverlay(asCanvas(ctx))

    expect(ctx.fillCalls).toHaveLength(8)
    expect(ctx.fillCalls[0]).toEqual(expect.objectContaining({
      x: -BLOCK_TEXTURE_SIZE,
      y: 0,
      width: 3,
      height: BLOCK_TEXTURE_SIZE,
      fillStyle: '#1d2021',
      globalAlpha: 0.9,
    }))
  })

  it('draws typed tech-panel overlays with matching stroke styles and opacity', () => {
    const electric = createFakeCanvasContext()
    const medical = createFakeCanvasContext()
    const poison = createFakeCanvasContext()

    drawTechPanelOverlay(asCanvas(electric), new Set(['electric']))
    drawTechPanelOverlay(asCanvas(medical), new Set(['medical']))
    drawTechPanelOverlay(asCanvas(poison), new Set(['poison']))

    expect(electric.strokeCalls).toEqual([
      expect.objectContaining({ strokeStyle: '#83a9ff', globalAlpha: 0.22, lineWidth: 1 }),
    ])
    expect(medical.strokeCalls).toEqual([
      expect.objectContaining({ strokeStyle: '#ffffff', globalAlpha: 0.16, lineWidth: 1 }),
    ])
    expect(poison.strokeCalls).toEqual([
      expect.objectContaining({ strokeStyle: '#b8f48a', globalAlpha: 0.22, lineWidth: 1 }),
    ])
  })
})

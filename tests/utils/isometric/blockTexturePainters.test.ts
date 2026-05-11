import { describe, expect, it } from 'vitest'
import { paintResolvedBlockTexturePattern } from '~/utils/isometric/blockTexturePainters'
import { BLOCK_TEXTURE_SIZE } from '~/utils/isometric/blockTextureConstants'
import type {
  BlockTexturePaintInput,
  BlockTexturePatternKind,
} from '~/utils/isometric/blockTexturePatterns'

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

const createFakeCanvasContext = (): FakeCanvasContext => {
  const ctx: FakeCanvasContext = {
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
  }
  return ctx
}

const paintInput = (overrides: Partial<BlockTexturePaintInput> = {}): BlockTexturePaintInput => ({
  role: 'top',
  materialId: 'custom',
  tags: new Set(),
  isCustom: true,
  seed: 123,
  baseColor: 0x6699cc,
  ...overrides,
})

const paintPattern = (
  pattern: BlockTexturePatternKind,
  overrides: Partial<BlockTexturePaintInput> = {},
): FakeCanvasContext => {
  const ctx = createFakeCanvasContext()
  paintResolvedBlockTexturePattern(
    ctx as CanvasRenderingContext2D,
    paintInput(overrides),
    pattern,
  )
  return ctx
}

describe('isometric block texture painters', () => {
  it('paints a full generated pixel grid for base patterns', () => {
    const ctx = paintPattern('custom')

    expect(ctx.fillCalls).toHaveLength(BLOCK_TEXTURE_SIZE * BLOCK_TEXTURE_SIZE)
    expect(ctx.fillCalls.every((call) => call.width === 1 && call.height === 1)).toBe(true)
  })

  it('adds hazard stripe overlay cells only on top faces', () => {
    const topCtx = paintPattern('hazard-stripe', { role: 'top', isCustom: false })
    const sideCtx = paintPattern('hazard-stripe', { role: 'side', isCustom: false })

    expect(topCtx.fillCalls.some((call) => call.width === 3 && call.height === BLOCK_TEXTURE_SIZE)).toBe(true)
    expect(sideCtx.fillCalls.some((call) => call.width === 3 && call.height === BLOCK_TEXTURE_SIZE)).toBe(false)
  })

  it('adds colored tech-panel strokes for top-face electric panels', () => {
    const topCtx = paintPattern('tech-panel', {
      role: 'top',
      isCustom: false,
      tags: new Set(['electric']),
    })
    const sideCtx = paintPattern('tech-panel', {
      role: 'side',
      isCustom: false,
      tags: new Set(['electric']),
    })

    expect(topCtx.strokeCalls).toEqual([
      expect.objectContaining({ strokeStyle: '#83a9ff', lineWidth: 1 }),
    ])
    expect(sideCtx.strokeCalls).toHaveLength(0)
  })
})

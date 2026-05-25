import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import type { SpriteAnimation } from '~/types/pokemon'
import type { WorldSpriteState } from '~/utils/isometric/types'
import {
  anyWorldSpriteStateNeedsAnimationFrame,
  anyWorldSpriteStateNeedsRenderFrame,
  applyWorldSpriteAnimationFrame,
  applyWorldSpriteTextureTransform,
  setWorldSpriteTextureWindow,
  spriteAnimationFrameAt,
  spriteAnimationRequiresFrames,
  spriteVisualAssetKey,
  worldSpriteStateNeedsAnimationFrame,
  worldSpriteStateNeedsRenderFrame,
  worldSpriteStateNeedsTextureFrame,
} from '~/utils/isometric/worldSpriteAssets'

const animation = (overrides: Partial<SpriteAnimation> = {}): SpriteAnimation => ({
  url: '/sprites/test.png',
  frameWidth: 16,
  frameHeight: 16,
  frames: 4,
  columns: 2,
  rows: 2,
  durationsMs: [100, 100, 100, 100],
  totalDurationMs: 400,
  ...overrides,
})

describe('world sprite asset helpers', () => {
  it('detects animation metadata that requires ongoing frames', () => {
    expect(spriteAnimationRequiresFrames(animation())).toBe(true)
    expect(spriteAnimationRequiresFrames(animation({ frames: 1 }))).toBe(false)
    expect(spriteAnimationRequiresFrames(animation({ frames: 3, totalDurationMs: 0, durationsMs: [] }))).toBe(false)
    expect(spriteAnimationRequiresFrames(null)).toBe(false)
  })

  it('detects visible world sprite states that need render continuation frames', () => {
    const visibleAnimated = {
      animationMeta: animation(),
      sprite: { visible: true },
    }
    const hiddenAnimated = {
      animationMeta: animation(),
      sprite: { visible: false },
    }
    const visibleStatic = {
      animationMeta: null,
      sprite: { visible: true },
    }
    const visibleLoading = {
      animationMeta: null,
      sprite: { visible: true },
      textureLoading: true,
    }
    const hiddenLoading = {
      animationMeta: null,
      sprite: { visible: false },
      textureLoading: true,
    }

    expect(worldSpriteStateNeedsAnimationFrame(visibleAnimated)).toBe(true)
    expect(worldSpriteStateNeedsAnimationFrame(hiddenAnimated)).toBe(false)
    expect(worldSpriteStateNeedsAnimationFrame(visibleStatic)).toBe(false)
    expect(worldSpriteStateNeedsAnimationFrame(null)).toBe(false)
    expect(worldSpriteStateNeedsTextureFrame(visibleLoading)).toBe(true)
    expect(worldSpriteStateNeedsTextureFrame(hiddenLoading)).toBe(false)
    expect(worldSpriteStateNeedsTextureFrame(visibleStatic)).toBe(false)
    expect(worldSpriteStateNeedsRenderFrame(visibleAnimated)).toBe(true)
    expect(worldSpriteStateNeedsRenderFrame(visibleLoading)).toBe(true)
    expect(worldSpriteStateNeedsRenderFrame(visibleStatic)).toBe(false)
    expect(anyWorldSpriteStateNeedsAnimationFrame([hiddenAnimated, visibleStatic])).toBe(false)
    expect(anyWorldSpriteStateNeedsAnimationFrame([hiddenAnimated, visibleAnimated])).toBe(true)
    expect(anyWorldSpriteStateNeedsRenderFrame([hiddenAnimated, visibleStatic])).toBe(false)
    expect(anyWorldSpriteStateNeedsRenderFrame([hiddenAnimated, visibleLoading])).toBe(true)
  })

  it('selects animation frames with wrapping elapsed time', () => {
    const meta = animation({
      frames: 3,
      columns: 3,
      rows: 1,
      durationsMs: [100, 200, 300],
      totalDurationMs: 600,
    })

    expect(spriteAnimationFrameAt(meta, 0)).toBe(0)
    expect(spriteAnimationFrameAt(meta, 99)).toBe(0)
    expect(spriteAnimationFrameAt(meta, 100)).toBe(1)
    expect(spriteAnimationFrameAt(meta, 299)).toBe(1)
    expect(spriteAnimationFrameAt(meta, 300)).toBe(2)
    expect(spriteAnimationFrameAt(meta, 599)).toBe(2)
    expect(spriteAnimationFrameAt(meta, 600)).toBe(0)
    expect(spriteAnimationFrameAt(meta, -1)).toBe(2)
  })

  it('uses fallback frame durations and safe zero-frame defaults', () => {
    const sparseDurations = animation({
      frames: 3,
      columns: 3,
      rows: 1,
      durationsMs: [50],
      totalDurationMs: 150,
    })

    expect(spriteAnimationFrameAt(sparseDurations, 49)).toBe(0)
    expect(spriteAnimationFrameAt(sparseDurations, 50)).toBe(1)
    expect(spriteAnimationFrameAt(sparseDurations, 100)).toBe(2)
    expect(spriteAnimationFrameAt(animation({ frames: 1 }), 250)).toBe(0)
    expect(spriteAnimationFrameAt(animation({ totalDurationMs: 0, durationsMs: [] }), 250)).toBe(0)
  })

  it('builds stable sprite visual asset keys', () => {
    expect(spriteVisualAssetKey({ url: '/front.png' })).toBe('/front.png|static|full')
    expect(spriteVisualAssetKey({
      url: '/front.png',
      animation: animation({ url: '/animated.json' }),
      crop: {
        canvasWidth: 64,
        canvasHeight: 48,
        left: 3,
        top: 4,
        width: 20,
        height: 21,
      },
    })).toBe('/animated.json|animated|64,48,3,4,20,21')
  })

  it('applies texture coordinates only when the animation frame changes', () => {
    const repeatSet = vi.fn()
    const offsetSet = vi.fn()
    const texture = {
      repeat: { set: repeatSet },
      offset: { set: offsetSet },
      needsUpdate: false,
    }
    const state = {
      animationMeta: animation(),
      animationStartedAtMs: 100,
      texture,
      currentFrame: -1,
      textureRepeat: new THREE.Vector2(1, 1),
      textureOffset: new THREE.Vector2(0, 0),
      mirroredX: false,
    } as unknown as WorldSpriteState

    applyWorldSpriteAnimationFrame(state, 350)

    expect(state.currentFrame).toBe(2)
    expect(repeatSet).toHaveBeenCalledWith(0.5, 0.5)
    expect(offsetSet).toHaveBeenCalledWith(0, 0)
    expect(texture.needsUpdate).toBe(true)

    applyWorldSpriteAnimationFrame(state, 375)

    expect(repeatSet).toHaveBeenCalledTimes(1)
    expect(offsetSet).toHaveBeenCalledTimes(1)
  })

  it('mirrors the active texture window by flipping X repeat and shifting X offset', () => {
    const texture = {
      repeat: { set: vi.fn() },
      offset: { set: vi.fn() },
      needsUpdate: false,
    }
    const state = {
      texture,
      textureRepeat: new THREE.Vector2(0.25, 0.5),
      textureOffset: new THREE.Vector2(0.5, 0.25),
      mirroredX: true,
    } as unknown as WorldSpriteState

    applyWorldSpriteTextureTransform(state)

    expect(texture.repeat.set).toHaveBeenCalledWith(-0.25, 0.5)
    expect(texture.offset.set).toHaveBeenCalledWith(0.75, 0.25)
    expect(texture.needsUpdate).toBe(true)

    setWorldSpriteTextureWindow(state, 0.5, 0.5, 0, 0.5)

    expect(texture.repeat.set).toHaveBeenLastCalledWith(-0.5, 0.5)
    expect(texture.offset.set).toHaveBeenLastCalledWith(0.5, 0.5)
  })

  it('ignores missing animation metadata or textures', () => {
    const texture = {
      repeat: { set: vi.fn() },
      offset: { set: vi.fn() },
      needsUpdate: false,
    }
    const noAnimation = {
      animationMeta: null,
      texture,
      currentFrame: -1,
      textureRepeat: new THREE.Vector2(1, 1),
      textureOffset: new THREE.Vector2(0, 0),
      mirroredX: false,
    } as unknown as WorldSpriteState
    const noTexture = {
      animationMeta: animation(),
      texture: null,
      currentFrame: -1,
      textureRepeat: new THREE.Vector2(1, 1),
      textureOffset: new THREE.Vector2(0, 0),
      mirroredX: false,
    } as unknown as WorldSpriteState

    applyWorldSpriteAnimationFrame(noAnimation, 1000)
    applyWorldSpriteAnimationFrame(noTexture, 1000)

    expect(noAnimation.currentFrame).toBe(-1)
    expect(noTexture.currentFrame).toBe(-1)
    expect(texture.repeat.set).not.toHaveBeenCalled()
  })
})

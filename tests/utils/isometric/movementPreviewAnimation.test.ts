import { describe, expect, it } from 'vitest'
import type { SpriteAnimation } from '~/types/pokemon'
import {
  createMovementPreviewAnimationState,
  movementPreviewAnimationStateNeedsFrame,
} from '~/utils/isometric/movementPreviewAnimation'

const animation = (overrides: Partial<SpriteAnimation> = {}): SpriteAnimation => ({
  url: '/sprites/movement-preview-animated.png',
  frameWidth: 16,
  frameHeight: 16,
  frames: 4,
  columns: 2,
  rows: 2,
  durationsMs: [100, 100, 100, 100],
  totalDurationMs: 400,
  ...overrides,
})

const ghostSpriteState = (
  visible: boolean,
  animationMeta: SpriteAnimation | null = animation(),
) => ({
  sprite: { visible },
  animationMeta,
})

describe('movement preview animation state', () => {
  it('normalizes movement-preview visibility and optional ghost sprite state', () => {
    const spriteState = ghostSpriteState(true)

    expect(createMovementPreviewAnimationState(true, spriteState)).toEqual({
      visible: true,
      ghostSpriteState: spriteState,
    })
    expect(createMovementPreviewAnimationState(false, undefined)).toEqual({
      visible: false,
      ghostSpriteState: null,
    })
  })

  it('requires frames only for visible previews with visible animated ghost sprites', () => {
    expect(movementPreviewAnimationStateNeedsFrame(
      createMovementPreviewAnimationState(true, ghostSpriteState(true)),
    )).toBe(true)

    expect(movementPreviewAnimationStateNeedsFrame(
      createMovementPreviewAnimationState(false, ghostSpriteState(true)),
    )).toBe(false)
    expect(movementPreviewAnimationStateNeedsFrame(
      createMovementPreviewAnimationState(true, ghostSpriteState(false)),
    )).toBe(false)
    expect(movementPreviewAnimationStateNeedsFrame(
      createMovementPreviewAnimationState(true, ghostSpriteState(true, null)),
    )).toBe(false)
    expect(movementPreviewAnimationStateNeedsFrame(
      createMovementPreviewAnimationState(true, ghostSpriteState(true, animation({ frames: 1 }))),
    )).toBe(false)
    expect(movementPreviewAnimationStateNeedsFrame(null)).toBe(false)
  })
})

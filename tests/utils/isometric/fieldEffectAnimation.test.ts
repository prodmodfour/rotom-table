import { describe, expect, it } from 'vitest'
import {
  createFieldEffectAnimationState,
  fieldEffectAnimationStateNeedsFrame,
} from '~/utils/isometric/fieldEffectAnimation'

describe('field effect animation state', () => {
  it('requires frames only when visible animators are active', () => {
    expect(fieldEffectAnimationStateNeedsFrame(null)).toBe(false)
    expect(fieldEffectAnimationStateNeedsFrame(createFieldEffectAnimationState(true, 0))).toBe(false)
    expect(fieldEffectAnimationStateNeedsFrame(createFieldEffectAnimationState(false, 2))).toBe(false)
    expect(fieldEffectAnimationStateNeedsFrame(createFieldEffectAnimationState(true, 2))).toBe(true)
  })

  it('normalizes animator counts defensively', () => {
    expect(createFieldEffectAnimationState(true, 1.8)).toEqual({
      visible: true,
      activeAnimatorCount: 1,
    })
    expect(createFieldEffectAnimationState(true, -4)).toEqual({
      visible: true,
      activeAnimatorCount: 0,
    })
    expect(createFieldEffectAnimationState(true, Number.NaN)).toEqual({
      visible: true,
      activeAnimatorCount: 0,
    })
  })
})

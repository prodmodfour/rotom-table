import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MOVE_ANIMATIONS_ENABLED,
  MOVE_ANIMATIONS_ENABLED_STORAGE_KEY,
  moveAnimationsEnabledLabel,
  moveAnimationsEnabledTitle,
  parseMoveAnimationsEnabled,
  resolveMoveAnimationsEnabled,
  serializeMoveAnimationsEnabled,
} from '~/utils/moveAnimationSettings'

describe('move animation settings', () => {
  it('defaults move animations to enabled', () => {
    expect(DEFAULT_MOVE_ANIMATIONS_ENABLED).toBe(true)
    expect(MOVE_ANIMATIONS_ENABLED_STORAGE_KEY).toBe('rotom-table:move-animations-enabled')
    expect(resolveMoveAnimationsEnabled(undefined)).toBe(true)
    expect(resolveMoveAnimationsEnabled('unexpected')).toBe(true)
  })

  it('parses and serializes the local browser enablement preference', () => {
    expect(parseMoveAnimationsEnabled(true)).toBe(true)
    expect(parseMoveAnimationsEnabled(false)).toBe(false)
    expect(parseMoveAnimationsEnabled('enabled')).toBe(true)
    expect(parseMoveAnimationsEnabled('OFF')).toBe(false)
    expect(parseMoveAnimationsEnabled('0')).toBe(false)
    expect(parseMoveAnimationsEnabled('maybe')).toBeNull()

    expect(serializeMoveAnimationsEnabled(true)).toBe('true')
    expect(serializeMoveAnimationsEnabled(false)).toBe('false')
  })

  it('labels disabled mode as visual-only while move automation remains available', () => {
    expect(moveAnimationsEnabledLabel(true)).toBe('Move animations on')
    expect(moveAnimationsEnabledLabel(false)).toBe('Move animations off')
    expect(moveAnimationsEnabledTitle(false)).toContain('Move automation stays usable')
  })
})

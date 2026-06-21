import { describe, expect, it } from 'vitest'
import {
  parseSoundEffectsEnabled,
  resolveSoundEffectsEnabled,
  serializeSoundEffectsEnabled,
  soundEffectsEnabledLabel,
  soundEffectsEnabledTitle,
} from '~/utils/soundEffectSettings'

describe('soundEffectSettings', () => {
  it('resolves the enabled setting with a default-on fallback', () => {
    expect(resolveSoundEffectsEnabled(undefined)).toBe(true)
    expect(resolveSoundEffectsEnabled('unexpected')).toBe(true)
    expect(resolveSoundEffectsEnabled('unexpected', false)).toBe(false)
  })

  it('parses and serializes boolean-like storage values', () => {
    expect(parseSoundEffectsEnabled(true)).toBe(true)
    expect(parseSoundEffectsEnabled(false)).toBe(false)
    expect(parseSoundEffectsEnabled('enabled')).toBe(true)
    expect(parseSoundEffectsEnabled('OFF')).toBe(false)
    expect(parseSoundEffectsEnabled('0')).toBe(false)
    expect(parseSoundEffectsEnabled('maybe')).toBeNull()
    expect(serializeSoundEffectsEnabled(true)).toBe('true')
    expect(serializeSoundEffectsEnabled(false)).toBe('false')
  })

  it('formats accessible labels for settings UI', () => {
    expect(soundEffectsEnabledLabel(true)).toBe('Sound effects on')
    expect(soundEffectsEnabledLabel(false)).toBe('Sound effects off')
    expect(soundEffectsEnabledTitle(true)).toContain('Dice rolls')
    expect(soundEffectsEnabledTitle(false)).toContain('disabled')
  })
})

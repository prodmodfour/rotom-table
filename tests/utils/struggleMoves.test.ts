import { describe, expect, it } from 'vitest'
import { findMove } from '~~/data/ptuReference'
import {
  makeAutomaticStruggleMoves,
  requiredStruggleCapabilityForMoveName,
  struggleAttackIsAvailableForCapabilities,
  struggleMoveNamesForCapabilities,
} from '~/utils/struggleMoves'

describe('struggleMoves', () => {
  it('adds physical and special entries for every Special-Attack-capable Struggle modifier', () => {
    expect(struggleMoveNamesForCapabilities([
      'Firestarter',
      'Fountain',
      'Freezer',
      'Guster',
      'Materializer',
      'Telekinetic',
      'Zapper',
    ])).toEqual([
      'Struggle',
      'Struggle (Firestarter Physical)',
      'Struggle (Firestarter Special)',
      'Struggle (Fountain Physical)',
      'Struggle (Fountain Special)',
      'Struggle (Freezer Physical)',
      'Struggle (Freezer Special)',
      'Struggle (Guster Physical)',
      'Struggle (Guster Special)',
      'Struggle (Materializer Physical)',
      'Struggle (Materializer Special)',
      'Struggle (Telekinetic Physical)',
      'Struggle (Telekinetic Special)',
      'Struggle (Zapper Physical)',
      'Struggle (Zapper Special)',
    ])
  })

  it('requires each typed Struggle variant capability while leaving base Struggle available', () => {
    expect(requiredStruggleCapabilityForMoveName('Struggle')).toBeNull()
    expect(requiredStruggleCapabilityForMoveName('Struggle (Firestarter Physical)')).toBe('Firestarter')
    expect(requiredStruggleCapabilityForMoveName('Struggle (Materialiser Special)')).toBe('Materializer')
    expect(struggleAttackIsAvailableForCapabilities('Struggle', [])).toBe(true)
    expect(struggleAttackIsAvailableForCapabilities('Struggle (Fountain Special)', [])).toBe(false)
    expect(struggleAttackIsAvailableForCapabilities('Struggle (Fountain Special)', ['Fountain'])).toBe(true)
    expect(struggleAttackIsAvailableForCapabilities('Struggle (Materializer Physical)', ['Materialiser'])).toBe(true)
  })

  it('treats legacy unsuffixed Struggle variants as their special entries when skipping duplicates', () => {
    expect(makeAutomaticStruggleMoves(['Firestarter'], [
      { name: 'Struggle' },
      { name: 'Struggle (Firestarter)' },
    ])).toEqual([
      { name: 'Struggle (Firestarter Physical)' },
    ])
  })

  it('keeps legacy and British-spelling lookup aliases pointed at canonical entries', () => {
    expect(findMove('Struggle (Firestarter)')).toMatchObject({
      name: 'Struggle (Firestarter Special)',
      damage_class: 'Special',
    })
    expect(findMove('Struggle (Materialiser Physical)')).toMatchObject({
      name: 'Struggle (Materializer Physical)',
      damage_class: 'Physical',
    })
  })
})

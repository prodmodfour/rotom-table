import { describe, expect, it } from 'vitest'
import {
  BREEDING_READ_ONLY_COMPATIBILITY_FIELDS,
  BreedingLegacyCompatibilityValidationError,
  preserveReadOnlyBreedingCompatibilityFields,
} from '../../server/domain/breeding/legacyAdapters'
import type { CharacterSheet } from '../../src/types/characterSheet'

const base = (overrides: Partial<CharacterSheet> = {}): CharacterSheet => ({
  slug: 'pokemon-child',
  nickname: 'Child',
  species: 'Pikachu',
  level: 30,
  ...overrides,
})

describe('read-only Breeding compatibility adapter', () => {
  it('preserves existing compatibility fields and discards create, rewrite, and delete attempts', () => {
    const current = base({
      eggMoves: [{ name: 'Volt Tackle' }],
      inheritedMoves: { '20': 'Volt Tackle' },
      inheritedRemaining: 1,
    })
    const requested = base({
      nickname: 'Renamed',
      eggMoves: [{ name: 'Present' }],
      inheritedMoves: { '30': 'Present' },
      inheritedRemaining: 99,
    })
    const preserved = preserveReadOnlyBreedingCompatibilityFields(current, requested)

    expect(BREEDING_READ_ONLY_COMPATIBILITY_FIELDS).toEqual([
      'eggMoves', 'inheritedMoves', 'inheritedRemaining',
    ])
    expect(preserved).toMatchObject({
      nickname: 'Renamed',
      eggMoves: [{ name: 'Volt Tackle' }],
      inheritedMoves: { '20': 'Volt Tackle' },
      inheritedRemaining: 1,
    })
    expect(preserved.eggMoves).not.toBe(current.eggMoves)
    expect(preserved.inheritedMoves).not.toBe(current.inheritedMoves)

    const omitted = preserveReadOnlyBreedingCompatibilityFields(current, base({ nickname: 'Still renamed' }))
    expect(omitted.eggMoves).toEqual(current.eggMoves)
    expect(omitted.inheritedMoves).toEqual(current.inheritedMoves)
    expect(omitted.inheritedRemaining).toBe(1)

    const forgedOnAbsent = preserveReadOnlyBreedingCompatibilityFields(base(), requested)
    expect(forgedOnAbsent).not.toHaveProperty('eggMoves')
    expect(forgedOnAbsent).not.toHaveProperty('inheritedMoves')
    expect(forgedOnAbsent).not.toHaveProperty('inheritedRemaining')
  })

  it('fails closed on accessor-backed, sparse, enriched, cyclic, and non-plain current data', () => {
    const accessor = base()
    Object.defineProperty(accessor, 'eggMoves', {
      enumerable: true,
      get: () => [{ name: 'Volt Tackle' }],
    })
    expect(() => preserveReadOnlyBreedingCompatibilityFields(accessor, base()))
      .toThrow(BreedingLegacyCompatibilityValidationError)

    const sparse = base({ eggMoves: new Array(2) })
    expect(() => preserveReadOnlyBreedingCompatibilityFields(sparse, base()))
      .toThrow(/dense and have no extra properties/)

    const enriched = [{ name: 'Volt Tackle' }]
    Object.defineProperty(enriched, 'extra', { enumerable: true, value: true })
    expect(() => preserveReadOnlyBreedingCompatibilityFields(base({ eggMoves: enriched }), base()))
      .toThrow(/dense and have no extra properties/)

    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(() => preserveReadOnlyBreedingCompatibilityFields(
      base({ inheritedMoves: cyclic as Record<string, string> }),
      base(),
    )).toThrow(/must not contain cycles/)

    expect(() => preserveReadOnlyBreedingCompatibilityFields(
      base({ inheritedMoves: new Map() as unknown as Record<string, string> }),
      base(),
    )).toThrow(/plain symbol-free object/)
  })

  it('fails closed without invoking accessor-backed submitted sheet fields', () => {
    let invoked = false
    const requested = base()
    Object.defineProperty(requested, 'eggMoves', {
      enumerable: true,
      get: () => {
        invoked = true
        return [{ name: 'Forged' }]
      },
    })
    expect(() => preserveReadOnlyBreedingCompatibilityFields(base(), requested))
      .toThrow(BreedingLegacyCompatibilityValidationError)
    expect(invoked).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { placementToSpawned } from '~/utils/placement'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement } from '~/types/map'

describe('placement helpers', () => {
  it('copies sheet ability names, gender, and skill ranks onto spawned tokens for automation', () => {
    const sheet: CharacterSheet = {
      slug: 'pika',
      nickname: 'Pika',
      species: 'Pikachu',
      level: 5,
      gender: 'Female',
      abilities: [{ name: 'Levitate' }],
      skills: { combat: '5d6+1', focus: '4d6' },
    }
    const placement: SheetPlacement = {
      id: 'placement-1',
      sheetKind: 'pokemon',
      sheetSlug: 'pika',
      position: { x: 0, y: 0, z: 0 },
    }

    const spawned = placementToSpawned(placement, {
      pokemon: new Map([[sheet.slug, sheet]]),
      trainer: new Map(),
    })

    expect(spawned?.abilityNames).toEqual(['Levitate'])
    expect(spawned?.gender).toBe('Female')
    expect(spawned?.defenderCapabilities).toEqual({ levitate: 4 })
    expect(spawned?.combatSkillRankValue).toBe(5)
    expect(spawned?.focusSkillRankValue).toBe(4)
  })
})

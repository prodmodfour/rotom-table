import { describe, expect, it } from 'vitest'
import { trainerCatalog } from '~~/data/trainerCatalog'
import { placementToSpawned } from '~/utils/placement'
import { moveAutomationUserAccuracy } from '~/utils/moveAutomationAccuracy'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'

describe('placement helpers', () => {
  it('copies sheet ability names, gender, skill ranks, and accuracy context onto spawned tokens for automation', () => {
    const sheet: CharacterSheet = {
      slug: 'pika',
      nickname: 'Pika',
      species: 'Pikachu',
      level: 5,
      gender: 'Female',
      abilities: [{ name: 'Levitate' }],
      skills: { combat: '5d6+1', focus: '4d6' },
      combatStages: { acc: 2 },
      items: { held: 'Luck Incense' },
    }
    const placement: SheetPlacement = {
      id: 'placement-1',
      sheetKind: 'pokemon',
      sheetSlug: 'pika',
      position: { x: 0, y: 0, z: 0 },
      facing: 'north-east',
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
    expect(spawned?.combatStages.acc).toBe(2)
    expect(spawned?.tokenItems).toEqual(['Luck Incense'])
    expect(spawned ? moveAutomationUserAccuracy(spawned) : null).toBe(3)
    expect(spawned?.facing).toBe('north-east')
    expect(spawned?.turned).toBe(false)
  })

  it('scales trainer sprite dimensions to the trainer sheet height in metres', () => {
    const catalog = trainerCatalog[0]!
    const sheet: TrainerSheet = {
      slug: 'trainer-1',
      name: 'Trainer One',
      level: 5,
      height: '1.72',
      portraitUrl: catalog.spriteUrl,
    }
    const placement: SheetPlacement = {
      id: 'placement-1',
      sheetKind: 'trainer',
      sheetSlug: 'trainer-1',
      position: { x: 0, y: 0, z: 0 },
    }

    const spawned = placementToSpawned(placement, {
      pokemon: new Map(),
      trainer: new Map([[sheet.slug, sheet]]),
    })

    expect(spawned?.sheetKind).toBe('trainer')
    expect(spawned?.height).toBe(1.72)
    expect(spawned?.width).toBeCloseTo(catalog.width * (1.72 / catalog.height))
    expect(spawned?.base).toBe(catalog.base)
  })
})

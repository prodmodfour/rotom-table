import { describe, expect, it } from 'vitest'
import { trainerCatalog } from '~~/data/trainerCatalog'
import { placementToSpawned, placementsToSpawned, unresolvedPlacementReferences } from '~/utils/placement'
import { moveAutomationUserAccuracy } from '~/utils/moveAutomationAccuracy'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { activeEquipmentState } from '../fixtures/equipment'

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
      activeTrainingFeature: 'Focused Training',
      items: { held: 'Luck Incense' },
      equipmentState: activeEquipmentState({
        ownerKind: 'pokemon', ownerSlug: 'pika', slotId: 'held', canonicalItemId: 'luck-incense',
      }),
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
    expect(spawned?.movementCapabilities).toMatchObject({ overland: 7, levitate: 4 })
    expect(spawned?.movementProfile?.state).toEqual({
      grounding: 'airborne',
      semiInvulnerable: 'none',
    })
    expect(spawned?.combatSkillRankValue).toBe(5)
    expect(spawned?.focusSkillRankValue).toBe(4)
    expect(spawned?.combatStages.acc).toBe(2)
    expect(spawned?.activeTrainingFeature).toBe('Focused Training')
    expect(spawned?.accuracyRollBonus).toBe(1)
    expect(spawned?.tokenItems).toEqual(['Luck Incense'])
    expect(spawned ? moveAutomationUserAccuracy(spawned) : null).toBe(4)
    expect(spawned?.facing).toBe('north-east')
    expect(spawned?.turned).toBe(false)
  })

  it('skips unresolved placements for rendering without removing them from the map document', () => {
    const map: TabletopMap = {
      schemaVersion: 2,
      slug: 'runtime-sheet-map',
      name: 'Runtime Sheet Map',
      dimensions: { x: 4, y: 1, z: 4 },
      groundLevelY: 0,
      playerVisible: true,
      voxels: [],
      hazards: [],
      fieldEffects: { weather: [], terrains: [], rooms: [] },
      placements: [
        {
          id: 'runtime-token',
          sheetKind: 'pokemon',
          sheetSlug: 'runtime-pokemon',
          position: { x: 0, y: 0, z: 0 },
        },
      ],
      lights: [],
      initiative: { activeId: null, round: 1 },
    }
    const lookup = { pokemon: new Map<string, CharacterSheet>(), trainer: new Map<string, TrainerSheet>() }

    expect(placementsToSpawned(map, lookup)).toEqual([])
    expect(unresolvedPlacementReferences(map, lookup)).toEqual([
      {
        id: 'runtime-token',
        sheetKind: 'pokemon',
        sheetSlug: 'runtime-pokemon',
        reason: 'missing-sheet',
      },
    ])
    expect(map.placements).toHaveLength(1)
    expect(map.placements[0]?.sheetSlug).toBe('runtime-pokemon')
  })

  it('scales trainer sprite dimensions to the trainer sheet height in metres', () => {
    const catalog = trainerCatalog[0]!
    const sheet: TrainerSheet = {
      slug: 'trainer-1',
      name: 'Trainer One',
      level: 5,
      height: '1.72',
      portraitUrl: catalog.spriteUrl,
      capabilities: {
        overland: 8,
        highJump: 2,
        longJump: 3,
        other: ['Phasing', 'Wallclimber'],
      },
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
    expect(spawned?.movementCapabilities).toMatchObject({ overland: 8, climb: 4 })
    expect(spawned?.movementTraits).toEqual({
      phasing: true,
      jump: { long: 3, high: 2 },
    })
    expect(spawned?.movementProfile?.state).toEqual({
      grounding: 'grounded',
      semiInvulnerable: 'none',
    })
  })
})

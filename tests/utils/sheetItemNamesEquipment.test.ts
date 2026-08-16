import { describe, expect, it } from 'vitest'
import {
  pokemonHeldItemNames,
  trainerEquippedItemNames,
} from '~/utils/sheetItemNames'
import { projectSheetEquipmentStateForPlayer } from '#shared/itemAutomation/equipment'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import { activeEquipmentState } from '../fixtures/equipment'

describe('explicit effective sheet equipment names', () => {
  it('never treats legacy descriptive Pokémon or Trainer fields as active equipment', () => {
    expect(pokemonHeldItemNames({
      slug: 'pikachu', nickname: 'Pika', species: 'Pikachu', level: 10,
      items: { held: 'Quick Claw' },
    } as CharacterSheet)).toEqual([])
    expect(trainerEquippedItemNames({
      slug: 'ash', name: 'Ash', level: 10,
      equipmentSlots: { accessory: 'Quick Claw', body: 'Light Armor' },
    } as TrainerSheet)).toEqual([])
  })

  it('returns only active owner-bound explicit instances and honors Accessory suppression', () => {
    const pokemon: CharacterSheet = {
      slug: 'pikachu', nickname: 'Pika', species: 'Pikachu', level: 10,
      items: { held: 'Wrong legacy value' },
      equipmentState: activeEquipmentState({
        ownerKind: 'pokemon', ownerSlug: 'pikachu', slotId: 'held', canonicalItemId: 'Quick Claw',
      }),
    }
    expect(pokemonHeldItemNames(pokemon)).toEqual(['Quick Claw'])

    const trainer: TrainerSheet = {
      slug: 'ash', name: 'Ash', level: 10,
      equipmentSlots: { accessory: 'Wrong legacy value' },
      equipmentState: activeEquipmentState({
        ownerKind: 'trainer', ownerSlug: 'ash', slotId: 'accessory', canonicalItemId: 'Quick Claw',
      }),
    }
    expect(trainerEquippedItemNames(trainer)).toEqual(['Quick Claw'])
    expect(trainerEquippedItemNames(trainer, { includeAccessory: false })).toEqual([])

    const projectedTrainer: TrainerSheet = {
      ...trainer,
      equipmentState: undefined,
      equipmentProjection: projectSheetEquipmentStateForPlayer(trainer.equipmentState),
    }
    expect(trainerEquippedItemNames(projectedTrainer)).toEqual(['Quick Claw'])

    const misbound = { ...pokemon, slug: 'raichu' }
    expect(pokemonHeldItemNames(misbound)).toEqual([])
  })
})

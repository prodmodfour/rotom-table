import { describe, expect, it } from 'vitest'
import {
  createEmptySheetEquipmentState,
  projectSheetEquipmentStateForPlayer,
} from '#shared/itemAutomation/equipment'
import { buildDefaultRuntimeSheet } from '~~/server/utils/sheetDocuments'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import { normalizeCharacterSheet, normalizeTrainerSheet } from '~/utils/sheetNormalize'
import { toPersistableSheetPayload } from '~/utils/sheets/persistence'

describe('sheet equipment normalization', () => {
  it('creates complete empty explicit authority for every new runtime sheet', () => {
    expect(buildDefaultRuntimeSheet('trainer', 'ash', { now: 100 })).toMatchObject({
      slug: 'ash',
      equipmentState: {
        schemaVersion: 1,
        revision: 0,
        owner: { kind: 'trainer', slug: 'ash' },
        slots: [
          { slotId: 'mainHand', instanceId: null },
          { slotId: 'offHand', instanceId: null },
          { slotId: 'head', instanceId: null },
          { slotId: 'body', instanceId: null },
          { slotId: 'feet', instanceId: null },
          { slotId: 'accessory', instanceId: null },
        ],
        instances: [], unresolved: [],
      },
    })
    expect(buildDefaultRuntimeSheet('pokemon', 'pikachu')).toMatchObject({
      slug: 'pikachu',
      equipmentState: {
        schemaVersion: 1,
        owner: { kind: 'pokemon', slug: 'pikachu' },
        slots: [
          { slotId: 'held', instanceId: null },
          { slotId: 'held-secondary', instanceId: null },
        ],
      },
    })
  })

  it('strictly owner-binds explicit state during Trainer and Pokémon normalization', () => {
    const trainerState = createEmptySheetEquipmentState({ ownerKind: 'trainer', ownerSlug: 'ash' })
    const trainer = normalizeTrainerSheet({
      slug: 'ash', name: 'Ash', level: 1, equipmentState: structuredClone(trainerState),
    } as TrainerSheet)
    expect(trainer.equipmentState).toEqual(trainerState)
    expect(Object.isFrozen(trainer.equipmentState)).toBe(true)

    const pokemonState = createEmptySheetEquipmentState({ ownerKind: 'pokemon', ownerSlug: 'pikachu' })
    const pokemon = normalizeCharacterSheet({
      slug: 'pikachu', nickname: 'Pika', species: 'Pikachu', level: 1,
      equipmentState: structuredClone(pokemonState),
    } as CharacterSheet)
    expect(pokemon.equipmentState).toEqual(pokemonState)
    expect(Object.isFrozen(pokemon.equipmentState)).toBe(true)

    expect(() => normalizeTrainerSheet({
      slug: 'misty', name: 'Misty', level: 1, equipmentState: trainerState,
    } as TrainerSheet)).toThrow(/must match owning sheet trainer\/misty/)
    expect(() => normalizeCharacterSheet({
      slug: 'eevee', nickname: 'Eevee', species: 'Eevee', level: 1,
      equipmentState: pokemonState,
    } as CharacterSheet)).toThrow(/must match owning sheet pokemon\/eevee/)
  })

  it('never persists a player-safe derived projection as sheet authority', () => {
    const state = createEmptySheetEquipmentState({ ownerKind: 'trainer', ownerSlug: 'ash' })
    const projection = projectSheetEquipmentStateForPlayer(state)
    expect(toPersistableSheetPayload({
      slug: 'ash', name: 'Ash', equipmentState: state, equipmentProjection: projection,
    })).toEqual({ slug: 'ash', name: 'Ash', equipmentState: state, revision: 0 })
  })
})

import { describe, expect, it } from 'vitest'
import { pokemonHpSnapshot, trainerHpSnapshot } from '~/utils/sheetSpawn'
import {
  applyCombatStagesToSheet,
  applyConditionsToSheet,
  applyHpToSheet,
  createSheetUpdateForPlacement,
  toPersistableSheetPayload,
} from '~/utils/sheetMutations'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'

describe('sheet mutation helpers', () => {
  const pokemon = (): CharacterSheet => ({
    slug: 'bolt',
    nickname: 'Bolt',
    species: 'Bulbasaur',
    level: 5,
    folder: 'party/a',
    combat: { currentHp: 1, conditions: [] },
    stats: {},
  } as CharacterSheet)

  const trainer = (): TrainerSheet => ({
    slug: 'gm-npc',
    name: 'GM NPC',
    level: 5,
    folder: 'npcs',
    currentHp: 1,
    conditions: [],
    stats: {},
  } as TrainerSheet)

  it('applies HP updates through kind-specific sheet storage', () => {
    const originalPokemon = pokemon()
    const updatedPokemon = applyHpToSheet('pokemon', originalPokemon, 999) as CharacterSheet
    expect(updatedPokemon.combat?.currentHp).toBe(pokemonHpSnapshot(originalPokemon).maxHp)
    expect(originalPokemon.combat?.currentHp).toBe(1)

    const originalTrainer = trainer()
    const updatedTrainer = applyHpToSheet('trainer', originalTrainer, 999) as TrainerSheet
    expect(updatedTrainer.currentHp).toBe(trainerHpSnapshot(originalTrainer).maxHp)
    expect(originalTrainer.currentHp).toBe(1)
  })

  it('normalizes combat stages and condition names', () => {
    const staged = applyCombatStagesToSheet('pokemon', pokemon(), {
      atk: 99,
      def: -99,
      satk: 1,
      sdef: 2,
      spd: 3,
      acc: 8,
    }) as CharacterSheet

    expect(staged.stats?.atk?.stage).toBe(6)
    expect(staged.stats?.def?.stage).toBe(-6)
    expect(staged.combatStages?.acc).toBe(6)

    const conditioned = applyConditionsToSheet('trainer', trainer(), ['Burned', 'bad-value']) as TrainerSheet
    expect(conditioned.conditions).toEqual(['Burned'])
  })

  it('creates update contexts and strips derived folder fields for persistence', () => {
    const pokemonSheet = pokemon()
    const lookups = {
      pokemon: new Map([[pokemonSheet.slug, pokemonSheet]]),
      trainer: new Map<string, TrainerSheet>(),
    }

    const context = createSheetUpdateForPlacement(
      {
        id: 'token-1',
        sheetKind: 'pokemon',
        sheetSlug: pokemonSheet.slug,
        position: { x: 0, y: 0, z: 0 },
      },
      lookups,
      (kind, sheet) => applyConditionsToSheet(kind, sheet, ['Poisoned']),
    )

    expect(context?.kind).toBe('pokemon')
    expect(toPersistableSheetPayload(context!.updated)).not.toHaveProperty('folder')
  })
})

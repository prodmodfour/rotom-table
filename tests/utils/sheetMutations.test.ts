import { describe, expect, it } from 'vitest'
import { pokemonHpSnapshot, trainerHpSnapshot } from '~/utils/sheetSpawn'
import {
  applyAbilityActivationToSheet,
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
    abilities: [{ name: 'Sand Veil' }, { name: 'Snow Cloak' }],
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
    expect((applyHpToSheet('pokemon', originalPokemon, -7) as CharacterSheet).combat?.currentHp).toBe(-7)

    const originalTrainer = trainer()
    const updatedTrainer = applyHpToSheet('trainer', originalTrainer, 999) as TrainerSheet
    expect(updatedTrainer.currentHp).toBe(trainerHpSnapshot(originalTrainer).maxHp)
    expect(originalTrainer.currentHp).toBe(1)
    expect((applyHpToSheet('trainer', originalTrainer, -7) as TrainerSheet).currentHp).toBe(-7)
  })

  it('applies Injury updates alongside HP updates', () => {
    const injuredPokemon = applyHpToSheet('pokemon', pokemon(), 10, 2) as CharacterSheet
    expect(injuredPokemon.combat?.injuries).toBe(2)
    expect(injuredPokemon.combat?.currentHp).toBeLessThanOrEqual(pokemonHpSnapshot(injuredPokemon).maxHp)

    const injuredTrainer = applyHpToSheet('trainer', trainer(), 10, 3) as TrainerSheet
    expect(injuredTrainer.currentInjuries).toBe(3)
    expect(injuredTrainer.currentHp).toBeLessThanOrEqual(trainerHpSnapshot(injuredTrainer).maxHp)
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

    const conditioned = applyConditionsToSheet('trainer', trainer(), ['Burned', 'Disable: Tackle', 'bad-value']) as TrainerSheet
    expect(conditioned.conditions).toEqual(['Burned', 'Disabled: Tackle'])
  })

  it('activates sheet-backed ability automation without mutating the original sheet', () => {
    const originalPokemon = pokemon()
    const updatedPokemon = applyAbilityActivationToSheet(
      'pokemon',
      originalPokemon,
      'Sand Veil',
    ) as CharacterSheet

    expect(updatedPokemon.abilities?.[0]).toMatchObject({ name: 'Sand Veil', activated: true })
    expect(originalPokemon.abilities?.[0]).toEqual({ name: 'Sand Veil' })

    const updatedSnowCloak = applyAbilityActivationToSheet(
      'pokemon',
      originalPokemon,
      'Snow Cloak',
    ) as CharacterSheet
    expect(updatedSnowCloak.abilities?.[1]).toMatchObject({ name: 'Snow Cloak', activated: true })
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

import { describe, expect, it } from 'vitest'
import {
  abilityEntriesForPlacement,
  buildTokenAbilityMenuOptions,
} from '~/utils/mapTokenAbilities'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'

describe('map token ability menu options', () => {
  it('resolves Pokémon sheet abilities with sheet and map automation categories', () => {
    const options = buildTokenAbilityMenuOptions([
      { name: 'Sand Veil', activated: true },
      { name: 'Intimidate' },
      { name: 'Moxie' },
      { name: 'Quick Feet' },
      { name: 'Run Away' },
    ])

    expect(options).toMatchObject([
      { name: 'Sand Veil', automation: { category: 'sheet', label: 'Sheet' }, activated: true },
      { name: 'Intimidate', automation: { category: 'map', label: 'Map' }, activated: false },
      { name: 'Moxie', automation: { category: 'map', label: 'Self' }, activated: false },
      { name: 'Quick Feet', automation: { category: 'passive', label: 'Auto' }, activated: false },
      { name: 'Run Away', automation: null, activated: false },
    ])
  })

  it('pulls ability entries from Pokémon and trainer placements', () => {
    const pokemonSheet = {
      slug: 'sandile',
      nickname: 'Sandile',
      species: 'Sandile',
      level: 5,
      abilities: [{ name: 'Intimidate' }],
    } as CharacterSheet
    const trainerSheet = {
      slug: 'trainer',
      name: 'Trainer',
      level: 1,
      abilities: [{ name: 'Run Away' }],
    } as TrainerSheet
    const lookup = {
      pokemon: new Map([[pokemonSheet.slug, pokemonSheet]]),
      trainer: new Map([[trainerSheet.slug, trainerSheet]]),
    }

    expect(abilityEntriesForPlacement({ sheetKind: 'pokemon', sheetSlug: 'sandile' }, lookup))
      .toEqual([{ name: 'Intimidate' }])
    expect(abilityEntriesForPlacement({ sheetKind: 'trainer', sheetSlug: 'trainer' }, lookup))
      .toEqual([{ name: 'Run Away' }])
  })
})

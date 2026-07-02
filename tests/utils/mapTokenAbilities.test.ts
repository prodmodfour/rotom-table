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
      { name: 'Snow Cloak' },
      { name: 'Healer' },
      { name: 'Intimidate' },
      { name: 'Leaf Guard' },
      { name: 'Moxie' },
      { name: 'Compound Eyes' },
      { name: 'Cute Charm' },
      { name: 'Poison Point' },
      { name: 'Poison Touch' },
      { name: 'Quick Feet' },
      { name: 'No Guard' },
      { name: 'Shield Dust' },
      { name: 'Sweet Veil' },
      { name: 'Run Away' },
    ])

    expect(options).toMatchObject([
      { name: 'Sand Veil', automation: { category: 'sheet', label: 'Sheet' }, activated: true },
      { name: 'Snow Cloak', automation: { category: 'sheet', label: 'Sheet' }, activated: false },
      { name: 'Healer', automation: { category: 'map', label: 'Map' }, activated: false },
      { name: 'Intimidate', automation: { category: 'map', label: 'Map' }, activated: false },
      { name: 'Leaf Guard', automation: { category: 'map', label: 'Self' }, activated: false },
      { name: 'Moxie', automation: { category: 'map', label: 'Self' }, activated: false },
      { name: 'Compound Eyes', automation: { category: 'passive', label: 'Auto' }, activated: false },
      { name: 'Cute Charm', automation: { category: 'passive', label: 'Auto' }, activated: false },
      { name: 'Poison Point', automation: { category: 'passive', label: 'Auto' }, activated: false },
      { name: 'Poison Touch', automation: { category: 'passive', label: 'Auto' }, activated: false },
      { name: 'Quick Feet', automation: { category: 'passive', label: 'Auto' }, activated: false },
      { name: 'No Guard', automation: { category: 'passive', label: 'Auto' }, activated: false },
      { name: 'Shield Dust', automation: { category: 'passive', label: 'Auto' }, activated: false },
      { name: 'Sweet Veil', automation: { category: 'passive', label: 'Auto' }, activated: false },
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

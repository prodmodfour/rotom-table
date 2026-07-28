import { describe, expect, it } from 'vitest'
import {
  abilityEntriesForPlacement,
  buildTokenAbilityMenuOptions,
} from '~/utils/mapTokenAbilities'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'

describe('map token ability menu options', () => {
  it('default-denies sheet entries and merges only matching server capabilities', () => {
    const entries = [
      { name: 'Sand Veil', activated: true },
      { name: 'Run Away' },
    ]
    const withoutCapabilities = buildTokenAbilityMenuOptions(entries)
    expect(withoutCapabilities).toMatchObject([
      { name: 'Sand Veil', capability: null },
      { name: 'Run Away', capability: null },
    ])
    expect(withoutCapabilities[0]).not.toHaveProperty('activated')

    const ready = {
      instanceId: 'base:token:0', canonicalId: 'Sand Veil', displayName: 'Sand Veil',
      effective: true, baseStatus: 'complete', interactionStatus: 'unassessed',
      status: 'ready', statusBadgeKey: 'ability.status.ready', unavailableReasonCode: null,
      modes: [{ modeId: 'activate', kind: 'activated', invocable: true, targeting: [] }],
    } as const
    const transformed = {
      ...ready,
      instanceId: 'transformed:effect:0',
      canonicalId: 'Snow Cloak',
      displayName: 'Snow Cloak',
      status: 'passive',
      statusBadgeKey: 'ability.status.passive',
      modes: [{ modeId: 'static', kind: 'static', invocable: false, targeting: [] }],
    } as const
    expect(buildTokenAbilityMenuOptions(entries, [ready, transformed])).toMatchObject([
      { name: 'Sand Veil', instanceId: 'base:token:0', capability: { status: 'ready' } },
      { name: 'Run Away', capability: null },
      { name: 'Snow Cloak', instanceId: 'transformed:effect:0', capability: { status: 'passive' } },
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

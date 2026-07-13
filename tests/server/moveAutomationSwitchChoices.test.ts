import { describe, expect, it } from 'vitest'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { buildAuthoritativeMoveRulesContext } from '~~/server/domain/moveAutomation/context'
import {
  AuthoritativeSwitchChoiceError,
  enumerateAuthoritativeSwitchChoices,
  revalidateAuthoritativeSwitchChoice,
} from '~~/server/domain/moveAutomation/switchChoices'

const pokemon = (
  slug: string,
  species: string,
  currentHp = 40,
): CharacterSheet => ({
  slug,
  nickname: slug,
  species,
  level: 20,
  revision: 2,
  combat: { currentHp },
  movelist: slug === 'actor' ? [{ name: 'Ember' }] : [],
})

const trainer = (slug = 'ash', team = ['actor', 'eevee', 'fainted', 'active']): TrainerSheet => ({
  slug,
  name: slug,
  level: 10,
  revision: 3,
  currentTeam: team,
})

const mapFixture = (): TabletopMap => ({
  schemaVersion: 2,
  slug: 'switch-choice-arena',
  name: 'Switch Choice Arena',
  revision: 7,
  dimensions: { x: 8, y: 4, z: 8 },
  voxels: [],
  placements: [
    {
      id: 'actor-token',
      sheetKind: 'pokemon',
      sheetSlug: 'actor',
      position: { x: 2, y: 0, z: 2 },
      sideId: 'heroes',
      initiative: 17,
      facing: 'south-east',
    },
    {
      id: 'trainer-token',
      sheetKind: 'trainer',
      sheetSlug: 'ash',
      position: { x: 0, y: 0, z: 0 },
      sideId: 'heroes',
    },
    {
      id: 'active-token',
      sheetKind: 'pokemon',
      sheetSlug: 'active',
      position: { x: 5, y: 0, z: 5 },
      sideId: 'heroes',
    },
  ],
})

const context = (options: {
  readonly trainers?: ReadonlyMap<string, TrainerSheet>
  readonly map?: TabletopMap
} = {}) => buildAuthoritativeMoveRulesContext({
  map: options.map ?? mapFixture(),
  pokemonSheets: new Map([
    ['actor', pokemon('actor', 'Pikachu')],
    ['eevee', pokemon('eevee', 'Eevee')],
    ['fainted', pokemon('fainted', 'Bulbasaur', 0)],
    ['active', pokemon('active', 'Charmander')],
  ]),
  trainerSheets: options.trainers ?? new Map([['ash', trainer()]]),
  intent: {
    schemaVersion: 1,
    placementId: 'actor-token',
    moveName: 'Ember',
    selection: { kind: 'self' },
  },
  random: () => { throw new Error('switch choices do not draw randomness') },
  time: 1_000,
})

const declaration = {
  recalledPlacementId: 'actor-token',
  setId: 'switch.ember.replacements',
  positionPolicy: 'recalled-position' as const,
  initiativePolicy: 'inherit-slot' as const,
}

describe('authoritative move-driven replacement choices', () => {
  it('offers only conscious off-map current-team Pokémon and preserves placement policy', () => {
    const rules = context()
    const mapBefore = structuredClone(rules.map)
    const set = enumerateAuthoritativeSwitchChoices({ context: rules, ...declaration })

    expect(set.choices).toHaveLength(1)
    expect(set.choices[0]).toMatchObject({
      option: {
        id: expect.stringMatching(/^switch\.replacement\.[a-f0-9]{24}$/),
        labelKey: 'move.switch.replacement.eevee',
      },
      trainerPlacementId: 'trainer-token',
      trainerSheetSlug: 'ash',
      recalledPlacementId: 'actor-token',
      replacementSheetSlug: 'eevee',
      sentOutPlacement: {
        id: expect.stringMatching(/^switch\.[a-f0-9]{24}$/),
        sheetKind: 'pokemon',
        sheetSlug: 'eevee',
        position: { x: 2, y: 0, z: 2 },
        sideId: 'heroes',
        initiative: 17,
        facing: 'south-east',
      },
    })
    expect(set.sheetReads).toEqual(expect.arrayContaining([
      { kind: 'pokemon', slug: 'actor', revision: 2 },
      { kind: 'trainer', slug: 'ash', revision: 3 },
      { kind: 'pokemon', slug: 'eevee', revision: 2 },
      { kind: 'pokemon', slug: 'fainted', revision: 2 },
    ]))
    expect(set.sheetReads).not.toContainEqual(expect.objectContaining({ slug: 'active' }))
    expect(rules.map).toEqual(mapBefore)
    expect(Object.isFrozen(set)).toBe(true)

    const selected = revalidateAuthoritativeSwitchChoice({
      context: rules,
      ...declaration,
      optionId: set.choices[0]!.option.id,
    })
    expect(selected).toEqual(set.choices[0])
  })

  it('returns no options without an on-map owning trainer and rejects ambiguous ownership', () => {
    const noOwner = context({ trainers: new Map([['ash', trainer('ash', ['eevee'])]]) })
    expect(enumerateAuthoritativeSwitchChoices({ context: noOwner, ...declaration }).choices)
      .toEqual([])

    const map = mapFixture()
    map.placements.push({
      id: 'other-trainer-token',
      sheetKind: 'trainer',
      sheetSlug: 'misty',
      position: { x: 0, y: 0, z: 3 },
    })
    const ambiguous = context({
      map,
      trainers: new Map([
        ['ash', trainer()],
        ['misty', trainer('misty', ['actor', 'eevee'])],
      ]),
    })
    expect(() => enumerateAuthoritativeSwitchChoices({
      context: ambiguous,
      ...declaration,
    })).toThrowError(expect.objectContaining({
      name: AuthoritativeSwitchChoiceError.name,
      code: 'switch-choice-owner-ambiguous',
    }))
  })

  it('rejects a forged or no-longer-legal option without mutating context', () => {
    const rules = context()
    const before = structuredClone(rules.map)
    expect(() => revalidateAuthoritativeSwitchChoice({
      context: rules,
      ...declaration,
      optionId: 'switch.replacement.deadbeefdeadbeefdeadbeef',
    })).toThrowError(expect.objectContaining({
      code: 'switch-choice-option-unknown',
    }))
    expect(rules.map).toEqual(before)
  })
})

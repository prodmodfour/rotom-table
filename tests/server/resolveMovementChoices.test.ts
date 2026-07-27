import { describe, expect, it } from 'vitest'
import {
  pendingMoveMovementOptionId,
} from '#shared/moveAutomation/responseOptions'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import {
  AuthoritativeMovementChoiceError,
  enumerateAuthoritativeMovementChoices,
  revalidateAuthoritativeMovementChoice,
} from '~~/server/domain/movement/resolveMovementChoices'
import type { AuthoritativeMovementSheets } from '~~/server/domain/movement/resolveMovement'

const placement = (
  id: string,
  position: { x: number; y: number; z: number },
): SheetPlacement => ({
  id,
  sheetKind: 'pokemon',
  sheetSlug: id,
  position,
})

const pokemonSheet = (
  slug: string,
  overrides: Partial<CharacterSheet> = {},
): CharacterSheet => ({
  nickname: slug,
  species: 'Pikachu',
  level: 10,
  revision: 2,
  capabilities: { overland: 4, sky: 0, swim: 0, levitate: 0 },
  ...overrides,
  slug,
})

const mapFixture = (
  placements: readonly SheetPlacement[] = [placement('actor', { x: 1, y: 0, z: 1 })],
): TabletopMap => ({
  schemaVersion: 2,
  slug: 'movement-choice-arena',
  name: 'Movement Choice Arena',
  revision: 7,
  dimensions: { x: 4, y: 2, z: 4 },
  groundLevelY: 0,
  voxels: [],
  placements: [...placements],
})

const sheetsFor = (...slugs: readonly string[]): AuthoritativeMovementSheets => ({
  pokemon: new Map(slugs.map(slug => [slug, pokemonSheet(slug)])),
  trainer: new Map<string, TrainerSheet>(),
})

const expectChoiceError = (
  run: () => unknown,
  code: AuthoritativeMovementChoiceError['code'],
): void => {
  expect(run).toThrowError(expect.objectContaining({
    name: 'AuthoritativeMovementChoiceError',
    code,
  }))
}

describe('authoritative durable movement choices', () => {
  it('deduplicates and orders oracle-legal server candidate cells with stable IDs', () => {
    const map = mapFixture([
      placement('actor', { x: 1, y: 0, z: 1 }),
      placement('blocker', { x: 2, y: 0, z: 1 }),
    ])
    const resources = sheetsFor('actor', 'blocker')
    const candidateDestinations = [
      { x: 3, y: 0, z: 3 },
      { x: 7, y: 0, z: 7 },
      { x: 2, y: 0, z: 1 },
      { x: 0, y: 0, z: 1 },
      { x: 3, y: 0, z: 3 },
    ]
    const input = {
      kind: 'destination' as const,
      map,
      sheets: resources,
      placementId: 'actor',
      setId: 'test.voluntary-destinations',
      maximumDistance: 4,
      candidateDestinations,
    }
    const mapBefore = structuredClone(map)
    const candidatesBefore = structuredClone(candidateDestinations)

    const first = enumerateAuthoritativeMovementChoices(input)
    const replay = enumerateAuthoritativeMovementChoices(input)

    expect(first.choices.map(choice => choice.option)).toEqual([
      {
        id: expect.stringMatching(/^movement\.destination\.[a-f0-9]{8}\.0\.0\.1$/),
        labelKey: 'move.movement.destination',
        selection: {
          kind: 'movement-destination',
          setId: 'test.voluntary-destinations',
          destination: { x: 0, y: 0, z: 1 },
        },
      },
      {
        id: expect.stringMatching(/^movement\.destination\.[a-f0-9]{8}\.3\.0\.3$/),
        labelKey: 'move.movement.destination',
        selection: {
          kind: 'movement-destination',
          setId: 'test.voluntary-destinations',
          destination: { x: 3, y: 0, z: 3 },
        },
      },
    ])
    expect(first.choices.map(choice => choice.option.id)).toEqual(
      first.choices.map(choice => pendingMoveMovementOptionId(choice.option.selection)),
    )
    expect(replay.choices.map(choice => choice.option.id)).toEqual(
      first.choices.map(choice => choice.option.id),
    )
    expect(first.choices.map(choice => choice.movement.cost)).toEqual([1, 3])
    expect(first.sheetReads).toEqual([
      { kind: 'pokemon', slug: 'actor', revision: 2 },
      { kind: 'pokemon', slug: 'blocker', revision: 2 },
    ])
    expect(map).toEqual(mapBefore)
    expect(candidateDestinations).toEqual(candidatesBefore)
    expect(Object.isFrozen(map)).toBe(false)
    expect(Object.isFrozen(resources.pokemon.get('actor'))).toBe(false)
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first.choices[0]?.option.selection)).toBe(true)
  })

  it('deduplicates legal directions into canonical order and derives bounded endpoints', () => {
    const set = enumerateAuthoritativeMovementChoices({
      kind: 'direction',
      map: mapFixture([placement('actor', { x: 0, y: 0, z: 0 })]),
      sheets: sheetsFor('actor'),
      placementId: 'actor',
      setId: 'test.direction-set',
      maximumDistance: 3,
      directions: ['south', 'west', 'east', 'east', 'north'],
    })

    expect(set.choices.map(choice => choice.option.selection)).toEqual([
      {
        kind: 'movement-direction',
        setId: 'test.direction-set',
        direction: 'east',
        destination: { x: 3, y: 0, z: 0 },
      },
      {
        kind: 'movement-direction',
        setId: 'test.direction-set',
        direction: 'south',
        destination: { x: 0, y: 0, z: 3 },
      },
    ])
    expect(set.choices.map(choice => choice.option.id)).toEqual([
      expect.stringMatching(/\.east\.3\.0\.0$/),
      expect.stringMatching(/\.south\.0\.0\.3$/),
    ])
  })

  it('rejects detours as direction options when the reviewed ray is obstructed', () => {
    const set = enumerateAuthoritativeMovementChoices({
      kind: 'direction',
      map: mapFixture([
        placement('actor', { x: 0, y: 0, z: 1 }),
        placement('blocker', { x: 1, y: 0, z: 1 }),
      ]),
      sheets: sheetsFor('actor', 'blocker'),
      placementId: 'actor',
      setId: 'test.obstructed-direction',
      maximumDistance: 3,
      directions: ['east', 'west'],
    })

    expect(set.choices).toEqual([])
    expect(set.sheetReads).toEqual([
      { kind: 'pokemon', slug: 'actor', revision: 2 },
      { kind: 'pokemon', slug: 'blocker', revision: 2 },
    ])
  })

  it('filters range, map bounds, and complete footprint occupancy', () => {
    const map: TabletopMap = {
      ...mapFixture([
        placement('actor', { x: 0, y: 0, z: 0 }),
        placement('blocker', { x: 3, y: 0, z: 0 }),
      ]),
      dimensions: { x: 5, y: 2, z: 5 },
    }
    const resources: AuthoritativeMovementSheets = {
      pokemon: new Map([
        ['actor', pokemonSheet('actor', {
          species: 'Snorlax',
          capabilities: { overland: 4 },
        })],
        ['blocker', pokemonSheet('blocker')],
      ]),
      trainer: new Map<string, TrainerSheet>(),
    }
    const set = enumerateAuthoritativeMovementChoices({
      kind: 'destination',
      map,
      sheets: resources,
      placementId: 'actor',
      setId: 'test.large-footprint',
      maximumDistance: 1,
      candidateDestinations: [
        { x: 4, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 0, y: 0, z: 3 },
        { x: 1, y: 0, z: 0 },
      ],
    })

    expect(set.choices.map(choice => choice.option.selection?.destination)).toEqual([
      { x: 1, y: 0, z: 0 },
    ])
    expect(set.choices[0]?.movement.footprint).toEqual({ base: 2, clearance: 2 })
  })

  it('derives movement-mode legality from authoritative sheet capabilities', () => {
    const map: TabletopMap = {
      ...mapFixture([placement('actor', { x: 0, y: 0, z: 0 })]),
      dimensions: { x: 3, y: 3, z: 3 },
    }
    const candidates = [{ x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }]
    const choicesFor = (actor: CharacterSheet) => enumerateAuthoritativeMovementChoices({
      kind: 'destination',
      map,
      sheets: {
        pokemon: new Map([['actor', actor]]),
        trainer: new Map<string, TrainerSheet>(),
      },
      placementId: 'actor',
      setId: 'test.movement-mode',
      maximumDistance: 2,
      candidateDestinations: candidates,
    })

    expect(choicesFor(pokemonSheet('actor')).choices
      .map(choice => choice.option.selection?.destination)).toEqual([
      { x: 1, y: 0, z: 0 },
    ])
    expect(choicesFor(pokemonSheet('actor', {
      capabilities: { overland: 4, sky: 2 },
    })).choices.map(choice => choice.option.selection?.destination)).toEqual([
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
    ])
  })

  it('fails closed on malformed identities, distances, anchors, and candidate bounds', () => {
    const common = {
      kind: 'destination' as const,
      map: mapFixture(),
      sheets: sheetsFor('actor'),
      placementId: 'actor',
      setId: 'test.bounded-set',
      maximumDistance: 2,
    }

    expectChoiceError(() => enumerateAuthoritativeMovementChoices({
      ...common,
      setId: 'Client supplied label',
    }), 'movement-choice-invalid')
    expectChoiceError(() => enumerateAuthoritativeMovementChoices({
      ...common,
      maximumDistance: 0,
    }), 'movement-choice-invalid')
    expectChoiceError(() => enumerateAuthoritativeMovementChoices({
      ...common,
      candidateDestinations: [{ x: Number.NaN, y: 0, z: 0 }],
    }), 'movement-choice-invalid')
    expectChoiceError(() => enumerateAuthoritativeMovementChoices({
      ...common,
      candidateDestinations: Array.from({ length: 4_097 }, () => ({ x: 0, y: 0, z: 0 })),
    }), 'movement-choice-candidate-limit')
  })

  it('retains teleport semantics while revalidating a route-obstructed endpoint', () => {
    const map: TabletopMap = {
      ...mapFixture([
        placement('actor', { x: 0, y: 0, z: 0 }),
        placement('blocker', { x: 1, y: 0, z: 0 }),
      ]),
      dimensions: { x: 4, y: 1, z: 1 },
    }
    const common = {
      kind: 'destination' as const,
      map,
      sheets: sheetsFor('actor', 'blocker'),
      placementId: 'actor',
      setId: 'test.teleport-set',
      maximumDistance: 4,
      mode: 'teleport' as const,
    }
    const set = enumerateAuthoritativeMovementChoices({
      ...common,
      candidateDestinations: [{ x: 3, y: 0, z: 0 }],
    })

    expect(set.mode).toBe('teleport')
    expect(set.choices).toHaveLength(1)
    const revalidated = revalidateAuthoritativeMovementChoice({
      ...common,
      option: set.choices[0]!.option,
    })
    expect(revalidated.movement).toMatchObject({
      mode: 'teleport',
      destination: { x: 3, y: 0, z: 0 },
      path: [{ x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }],
      triggeringSteps: [],
    })
  })

  it('revalidates the selected stored option and rejects stale or forged coordinates', () => {
    const baseMap = mapFixture()
    const common = {
      kind: 'destination' as const,
      map: baseMap,
      sheets: sheetsFor('actor'),
      placementId: 'actor',
      setId: 'test.revalidation-set',
      maximumDistance: 3,
    }
    const set = enumerateAuthoritativeMovementChoices({
      ...common,
      candidateDestinations: [{ x: 2, y: 0, z: 1 }],
    })
    const option = set.choices[0]!.option

    expect(revalidateAuthoritativeMovementChoice({ ...common, option })).toMatchObject({
      movement: {
        destination: { x: 2, y: 0, z: 1 },
        reasonCode: 'movement-legal',
      },
    })

    const occupiedMap = mapFixture([
      placement('actor', { x: 1, y: 0, z: 1 }),
      placement('late-blocker', { x: 2, y: 0, z: 1 }),
    ])
    expectChoiceError(() => revalidateAuthoritativeMovementChoice({
      ...common,
      map: occupiedMap,
      sheets: sheetsFor('actor', 'late-blocker'),
      option,
    }), 'movement-choice-stale')

    expectChoiceError(() => revalidateAuthoritativeMovementChoice({
      ...common,
      option: {
        ...option,
        selection: {
          kind: 'movement-destination',
          setId: 'test.revalidation-set',
          destination: { x: 99, y: 0, z: 99 },
        },
      },
    }), 'movement-choice-option-unknown')
  })
})

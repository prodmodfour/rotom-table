import { describe, expect, it } from 'vitest'
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

const pokemonSheet = (slug: string, overland = 4): CharacterSheet => ({
  slug,
  nickname: slug,
  species: 'Pikachu',
  level: 10,
  revision: 2,
  capabilities: { overland, sky: 0, swim: 0, levitate: 0 },
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
  it('issues stable option IDs only for oracle-legal server candidate cells', () => {
    const map = mapFixture([
      placement('actor', { x: 1, y: 0, z: 1 }),
      placement('blocker', { x: 2, y: 0, z: 1 }),
    ])
    const input = {
      kind: 'destination' as const,
      map,
      sheets: sheetsFor('actor', 'blocker'),
      placementId: 'actor',
      setId: 'test.voluntary-destinations',
      maximumDistance: 4,
      candidateDestinations: [
        { x: 0, y: 0, z: 1 },
        { x: 2, y: 0, z: 1 },
        { x: 3, y: 0, z: 3 },
        { x: 7, y: 0, z: 7 },
      ],
    }

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
    expect(replay.choices.map(choice => choice.option.id)).toEqual(
      first.choices.map(choice => choice.option.id),
    )
    expect(first.choices.map(choice => choice.movement.cost)).toEqual([1, 3])
    expect(first.sheetReads).toEqual([
      { kind: 'pokemon', slug: 'actor', revision: 2 },
      { kind: 'pokemon', slug: 'blocker', revision: 2 },
    ])
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first.choices[0]?.option.selection)).toBe(true)
  })

  it('derives bounded legal directions and their endpoints in reviewed order', () => {
    const set = enumerateAuthoritativeMovementChoices({
      kind: 'direction',
      map: mapFixture([placement('actor', { x: 0, y: 0, z: 0 })]),
      sheets: sheetsFor('actor'),
      placementId: 'actor',
      setId: 'test.direction-set',
      maximumDistance: 3,
      directions: ['west', 'east', 'south', 'north'],
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

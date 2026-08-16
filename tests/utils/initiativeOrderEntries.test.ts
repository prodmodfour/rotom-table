import { describe, expect, it } from 'vitest'
import { initiativeOrderIdsForPlacements } from '~/utils/initiativeOrderEntries'
import { activeEquipmentState } from '../fixtures/equipment'
import { projectEquipmentContributionsForSheet } from '~~/server/domain/itemAutomation/equipmentContributionProjection'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement } from '~/types/map'

const placement = (id: string, sheetSlug = id, initiative?: number | null): SheetPlacement => ({
  id,
  sheetKind: 'pokemon',
  sheetSlug,
  position: { x: 0, y: 0, z: 0 },
  ...(initiative === undefined ? {} : { initiative }),
})

const pokemonSheet = (
  slug: string,
  speed: number,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => {
  const sheet = {
    slug,
    nickname: slug,
    species: '',
    level: 1,
    stats: { spd: { base: speed } },
    combat: { conditions: [] },
    ...overrides,
  } as CharacterSheet
  sheet.equipmentContributionProjection = projectEquipmentContributionsForSheet({
    kind: 'pokemon', slug, sheet,
  }) ?? undefined
  return sheet as unknown as Record<string, unknown>
}

describe('initiativeOrderEntries', () => {
  it('matches effective UI ordering for Speed, conditions, item bonuses, and training bonuses', () => {
    const placements = [
      placement('token-alpha', 'alpha'),
      placement('token-bravo', 'bravo'),
      placement('token-zulu', 'zulu'),
    ]
    const sheets = new Map<string, Record<string, unknown>>([
      ['alpha', pokemonSheet('alpha', 30, { combat: { conditions: ['Paralysis'] } })],
      ['bravo', pokemonSheet('bravo', 20)],
      ['zulu', pokemonSheet('zulu', 10, {
        activeTrainingFeature: 'Agility Training',
        items: { held: 'Legacy text is not authority' },
        equipmentState: activeEquipmentState({
          ownerKind: 'pokemon', ownerSlug: 'zulu', slotId: 'held', canonicalItemId: 'Quick Claw',
        }),
      })],
    ])

    expect(initiativeOrderIdsForPlacements(placements, (_kind, slug) => ({
      path: `/tmp/${slug}.json`,
      sheet: sheets.get(slug)!,
    }))).toEqual(['token-zulu', 'token-bravo', 'token-alpha'])
  })

  it('supports lowest-first calculated order without changing authoritative scores', () => {
    const placements = [
      placement('token-alpha', 'alpha'),
      placement('token-bravo', 'bravo'),
      placement('token-zulu', 'zulu'),
    ]
    const sheets = new Map<string, Record<string, unknown>>([
      ['alpha', pokemonSheet('alpha', 30)],
      ['bravo', pokemonSheet('bravo', 20)],
      ['zulu', pokemonSheet('zulu', 10)],
    ])

    expect(initiativeOrderIdsForPlacements(
      placements,
      (_kind, slug) => ({ sheet: sheets.get(slug)! }),
      null,
      'lowest-first',
    )).toEqual(['token-zulu', 'token-bravo', 'token-alpha'])
  })

  it('overlays manual ids onto the calculated placement order', () => {
    const placements = [
      placement('token-alpha', 'alpha'),
      placement('token-bravo', 'bravo'),
      placement('token-zulu', 'zulu'),
    ]
    const sheets = new Map<string, Record<string, unknown>>([
      ['alpha', pokemonSheet('alpha', 30)],
      ['bravo', pokemonSheet('bravo', 20)],
      ['zulu', pokemonSheet('zulu', 10)],
    ])

    expect(initiativeOrderIdsForPlacements(
      placements,
      (_kind, slug) => ({
        path: `/tmp/${slug}.json`,
        sheet: sheets.get(slug)!,
      }),
      ['token-zulu', 'token-alpha'],
    )).toEqual(['token-zulu', 'token-alpha', 'token-bravo'])
  })

  it('applies conditions after explicit initiative overrides', () => {
    const placements = [
      placement('token-paralyzed', 'paralyzed', 40),
      placement('token-normal', 'normal', 25),
    ]
    const sheets = new Map<string, Record<string, unknown>>([
      ['paralyzed', pokemonSheet('paralyzed', 30, { combat: { conditions: ['Paralysis'] } })],
      ['normal', pokemonSheet('normal', 10)],
    ])

    expect(initiativeOrderIdsForPlacements(placements, (_kind, slug) => ({
      path: `/tmp/${slug}.json`,
      sheet: sheets.get(slug)!,
    }))).toEqual(['token-normal', 'token-paralyzed'])
  })

  it('uses deterministic final token-id tie-breaks across trainers and Pokémon with duplicate names', () => {
    const placements: SheetPlacement[] = [
      { id: 'b-token', sheetKind: 'trainer', sheetSlug: 'trainer-clone', position: { x: 0, y: 0, z: 0 }, initiative: 10 },
      { id: 'a-token', sheetKind: 'pokemon', sheetSlug: 'pokemon-clone', position: { x: 0, y: 0, z: 0 }, initiative: 10 },
    ]
    const sheets = new Map<string, Record<string, unknown>>([
      ['trainer-clone', { slug: 'trainer-clone', name: 'Clone', level: 1, stats: { spd: { base: 5 } }, conditions: [] }],
      ['pokemon-clone', pokemonSheet('pokemon-clone', 5, { nickname: 'Clone' })],
    ])

    expect(initiativeOrderIdsForPlacements(placements, (_kind, slug) => ({
      path: `/tmp/${slug}.json`,
      sheet: sheets.get(slug)!,
    }))).toEqual(['a-token', 'b-token'])
  })

  it('falls back to raw placement initiative when a sheet cannot be read', () => {
    const placements = [
      placement('token-missing-low', 'missing-low', 5),
      placement('token-missing-high', 'missing-high', 30),
    ]

    expect(initiativeOrderIdsForPlacements(placements, () => null)).toEqual([
      'token-missing-high',
      'token-missing-low',
    ])
  })
})

import { describe, expect, it } from 'vitest'
import type { SheetPlacement } from '~/types/map'
import type { SpawnedPokemon } from '~/types/pokemon'
import { createMoveAutomationFlankingResolver } from '~~/server/domain/moveAutomation/flanking'
import { createMoveAutomationRelationshipResolver } from '~~/server/domain/moveAutomation/relationships'

const token = (input: {
  readonly id: string
  readonly x: number
  readonly z: number
  readonly size?: string
  readonly base?: number
}): SpawnedPokemon => ({
  id: input.id,
  species: input.id,
  slug: input.id,
  size: input.size ?? 'Medium',
  width: input.base ?? 1,
  height: 1,
  base: input.base ?? 1,
  clearance: 1,
  spriteUrl: '/sprite.png',
  entityKind: 'pokemon',
  position: { x: input.x, y: 0, z: input.z },
  sheetKind: 'pokemon',
  sheetSlug: input.id,
  level: 20,
  currentHp: 100,
  maxHp: 100,
  atk: 10,
  satk: 10,
  def: 10,
  sdef: 10,
  spd: 10,
  evasion: { physical: 2, special: 2, speed: 2 },
  defenderTypes: ['Normal'],
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  conditions: [],
  tokenItems: [],
})

const placement = (
  id: string,
  sideId: 'heroes' | 'foes' | undefined,
  position: SpawnedPokemon['position'],
): SheetPlacement => ({
  id,
  sheetKind: 'pokemon',
  sheetSlug: id,
  ...(sideId ? { sideId } : {}),
  position: { ...position },
})

const resolve = (input: {
  readonly tokens: readonly SpawnedPokemon[]
  readonly sideById: Readonly<Record<string, 'heroes' | 'foes' | undefined>>
  readonly targetId?: string
  readonly onRead?: (placement: Pick<SheetPlacement, 'sheetKind' | 'sheetSlug'>) => void
}) => {
  const placements = input.tokens.map(entry => placement(
    entry.id,
    input.sideById[entry.id],
    entry.position,
  ))
  const relationships = createMoveAutomationRelationshipResolver({
    placements,
    sides: {
      heroes: { id: 'heroes', label: 'Heroes', status: 'active' },
      foes: { id: 'foes', label: 'Foes', status: 'active' },
    },
  })
  return createMoveAutomationFlankingResolver({
    placements,
    tokens: input.tokens,
    relationships,
    recordSheetRead: input.onRead,
  }).resolve(input.targetId ?? 'target')
}

describe('authoritative move flanking query', () => {
  it('requires two non-adjacent explicit foes around a Medium target', () => {
    const target = token({ id: 'target', x: 5, z: 5 })
    const left = token({ id: 'left', x: 4, z: 5 })
    const right = token({ id: 'right', x: 6, z: 5 })
    const result = resolve({
      tokens: [target, left, right],
      sideById: { target: 'foes', left: 'heroes', right: 'heroes' },
    })
    expect(result).toEqual({
      targetPlacementId: 'target',
      flanked: true,
      requiredAdjacentSquares: 2,
      adjacentFoeIds: ['left', 'right'],
      qualifyingFoeIds: ['left', 'right'],
      contributions: [
        { placementId: 'left', adjacentSquares: 1 },
        { placementId: 'right', adjacentSquares: 1 },
      ],
      reasonCode: 'target-flanked',
    })
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.contributions)).toBe(true)
  })

  it('does not count flankers that are adjacent to each other', () => {
    const result = resolve({
      tokens: [
        token({ id: 'target', x: 5, z: 5 }),
        token({ id: 'left', x: 4, z: 5 }),
        token({ id: 'diagonal', x: 4, z: 6 }),
      ],
      sideById: { target: 'foes', left: 'heroes', diagonal: 'heroes' },
    })
    expect(result).toMatchObject({
      flanked: false,
      adjacentFoeIds: ['left', 'diagonal'],
      qualifyingFoeIds: [],
      reasonCode: 'target-not-flanked',
    })
  })

  it('fails unknown allegiance and same-side placements closed', () => {
    const result = resolve({
      tokens: [
        token({ id: 'target', x: 5, z: 5 }),
        token({ id: 'ally', x: 4, z: 5 }),
        token({ id: 'unknown', x: 6, z: 5 }),
      ],
      sideById: { target: 'foes', ally: 'foes', unknown: undefined },
    })
    expect(result).toMatchObject({
      flanked: false,
      adjacentFoeIds: [],
      qualifyingFoeIds: [],
      reasonCode: 'target-not-flanked',
    })
  })

  it('counts a large foe by adjacent occupied squares but still requires two combatants', () => {
    const target = token({ id: 'target', x: 5, z: 5, size: 'Large', base: 2 })
    const largeFoe = token({ id: 'large-foe', x: 3, z: 5, size: 'Large', base: 2 })
    const smallFoe = token({ id: 'small-foe', x: 7, z: 6 })
    const oneCombatant = resolve({
      tokens: [target, largeFoe],
      sideById: { target: 'foes', 'large-foe': 'heroes' },
    })
    const twoCombatants = resolve({
      tokens: [target, largeFoe, smallFoe],
      sideById: { target: 'foes', 'large-foe': 'heroes', 'small-foe': 'heroes' },
    })
    expect(oneCombatant).toMatchObject({
      flanked: false,
      requiredAdjacentSquares: 3,
      contributions: [{ placementId: 'large-foe', adjacentSquares: 2 }],
    })
    expect(twoCombatants).toMatchObject({
      flanked: true,
      requiredAdjacentSquares: 3,
      qualifyingFoeIds: ['large-foe', 'small-foe'],
      contributions: [
        { placementId: 'large-foe', adjacentSquares: 2 },
        { placementId: 'small-foe', adjacentSquares: 1 },
      ],
    })
  })

  it('records the complete placed-sheet read set for positive and negative results', () => {
    const reads: string[] = []
    const result = resolve({
      tokens: [
        token({ id: 'target', x: 5, z: 5 }),
        token({ id: 'distant', x: 10, z: 10 }),
      ],
      sideById: { target: 'foes', distant: 'heroes' },
      onRead: entry => reads.push(`${entry.sheetKind}:${entry.sheetSlug}`),
    })
    expect(result.flanked).toBe(false)
    expect(reads).toEqual(['pokemon:target', 'pokemon:distant'])
  })
})

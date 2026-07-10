import { describe, expect, it } from 'vitest'
import type { EncounterSideDirectory } from '#shared/moveAutomation/encounterState'
import {
  DEFAULT_MOVE_AUTOMATION_RELATIONSHIP_POLICY,
  MOVE_AUTOMATION_RELATIONSHIP_PREDICATES,
  createMoveAutomationRelationshipResolver,
  type MoveAutomationRelationshipPlacement,
} from '../../server/domain/moveAutomation/relationships'

const sides = (): EncounterSideDirectory => ({
  north: { id: 'north', label: 'North', status: 'active' },
  south: { id: 'south', label: 'South', status: 'active' },
  archived: { id: 'archived', label: 'Archived', status: 'inactive' },
})

const placement = (
  id: string,
  sideId?: string,
): MoveAutomationRelationshipPlacement => ({
  id,
  ...(sideId ? { sideId } : {}),
})

const resolver = (
  placements: readonly MoveAutomationRelationshipPlacement[],
  sideDirectory: EncounterSideDirectory = sides(),
) => createMoveAutomationRelationshipResolver({ placements, sides: sideDirectory })

describe('authoritative move relationship queries', () => {
  it('classifies self from authoritative placement identity independently of allegiance', () => {
    const relationships = resolver([
      placement('known', 'north'),
      placement('unknown'),
    ])

    expect(relationships.resolve('known', 'known')).toEqual({
      sourcePlacementId: 'known',
      targetPlacementId: 'known',
      sourceSideId: 'north',
      targetSideId: 'north',
      relationship: 'self',
      reasonCode: 'relationship-self',
    })
    expect(relationships.match('known', 'known', 'self').matches).toBe(true)
    expect(relationships.match('known', 'known', 'same-side').matches).toBe(true)
    expect(relationships.match('known', 'known', 'ally').matches).toBe(false)
    expect(relationships.match('known', 'known', 'enemy').matches).toBe(false)
    expect(relationships.match('known', 'known', 'other').matches).toBe(false)
    expect(relationships.match('unknown', 'unknown', 'self').matches).toBe(true)
    expect(relationships.match('unknown', 'unknown', 'same-side').matches).toBe(false)
  })

  it('classifies distinct placements on the same explicit side as allies and same-side others', () => {
    const relationships = resolver([
      placement('first', 'north'),
      placement('second', 'north'),
    ])

    expect(relationships.resolve('first', 'second')).toEqual({
      sourcePlacementId: 'first',
      targetPlacementId: 'second',
      sourceSideId: 'north',
      targetSideId: 'north',
      relationship: 'ally',
      reasonCode: 'relationship-ally',
    })
    expect(relationships.match('first', 'second', 'self').matches).toBe(false)
    expect(relationships.match('first', 'second', 'ally').matches).toBe(true)
    expect(relationships.match('first', 'second', 'same-side').matches).toBe(true)
    expect(relationships.match('first', 'second', 'other').matches).toBe(true)
    expect(relationships.match('first', 'second', 'enemy').matches).toBe(false)
    expect(relationships.match('first', 'second', 'unknown').matches).toBe(false)
  })

  it('classifies distinct placements on different explicit sides as enemies and other', () => {
    const relationships = resolver([
      placement('north-token', 'north'),
      placement('south-token', 'south'),
    ])

    expect(relationships.resolve('north-token', 'south-token')).toEqual({
      sourcePlacementId: 'north-token',
      targetPlacementId: 'south-token',
      sourceSideId: 'north',
      targetSideId: 'south',
      relationship: 'enemy',
      reasonCode: 'relationship-enemy',
    })
    expect(relationships.match('north-token', 'south-token', 'enemy').matches).toBe(true)
    expect(relationships.match('north-token', 'south-token', 'other').matches).toBe(true)
    expect(relationships.match('north-token', 'south-token', 'ally').matches).toBe(false)
    expect(relationships.match('north-token', 'south-token', 'same-side').matches).toBe(false)
  })

  it('fails ally and enemy closed for unknown sides unless a broad predicate explicitly allows them', () => {
    const relationships = resolver([
      placement('unknown'),
      placement('also-unknown'),
      placement('known', 'north'),
      placement('dangling', 'not-in-directory'),
    ])
    const allowUnknown = { allowUnknown: true }

    expect(DEFAULT_MOVE_AUTOMATION_RELATIONSHIP_POLICY).toEqual({ allowUnknown: false })
    expect(relationships.resolve('unknown', 'known')).toMatchObject({
      relationship: 'unknown',
      reasonCode: 'relationship-unknown-side',
      sourceSideId: null,
      targetSideId: 'north',
    })
    expect(relationships.resolve('dangling', 'known')).toMatchObject({
      relationship: 'unknown',
      reasonCode: 'relationship-unknown-side',
      sourceSideId: null,
    })

    for (const targetId of ['known', 'also-unknown']) {
      expect(relationships.match('unknown', targetId, 'ally').matches).toBe(false)
      expect(relationships.match('unknown', targetId, 'enemy').matches).toBe(false)
      expect(relationships.match('unknown', targetId, 'same-side').matches).toBe(false)
      expect(relationships.match('unknown', targetId, 'ally', allowUnknown).matches).toBe(false)
      expect(relationships.match('unknown', targetId, 'enemy', allowUnknown).matches).toBe(false)
    }

    expect(relationships.match('unknown', 'known', 'other').matches).toBe(false)
    expect(relationships.match('unknown', 'known', 'unknown').matches).toBe(false)
    expect(relationships.match('unknown', 'known', 'other', allowUnknown).matches).toBe(true)
    expect(relationships.match('unknown', 'known', 'unknown', allowUnknown).matches).toBe(true)
  })

  it('never allows missing placement identities, even under the unknown-target policy', () => {
    const relationships = resolver([placement('known', 'north')])
    const missing = relationships.resolve('known', 'missing')

    expect(missing).toMatchObject({
      relationship: 'unknown',
      reasonCode: 'relationship-placement-missing',
      sourceSideId: 'north',
      targetSideId: null,
    })
    expect(relationships.resolve('missing', 'missing')).toMatchObject({
      relationship: 'unknown',
      reasonCode: 'relationship-placement-missing',
    })
    expect(relationships.match('known', 'missing', 'other', { allowUnknown: true }).matches).toBe(false)
    expect(relationships.match('known', 'missing', 'unknown', { allowUnknown: true }).matches).toBe(false)
  })

  it('uses archived explicit sides but never infers allegiance from control metadata', () => {
    const controlledPlacements = [
      { ...placement('gm-north', 'north'), controlledBy: 'gm' },
      { ...placement('gm-south', 'south'), controlledBy: 'gm' },
      { ...placement('player-north', 'north'), controlledBy: 'player' },
      { ...placement('gm-archived', 'archived'), controlledBy: 'gm' },
      { ...placement('player-archived', 'archived'), controlledBy: 'player' },
      { ...placement('gm-unknown'), controlledBy: 'gm' },
    ] satisfies readonly (MoveAutomationRelationshipPlacement & {
      readonly controlledBy: 'gm' | 'player'
    })[]
    const relationships = resolver(controlledPlacements)

    expect(relationships.resolve('gm-north', 'gm-south').relationship).toBe('enemy')
    expect(relationships.resolve('gm-north', 'player-north').relationship).toBe('ally')
    expect(relationships.resolve('gm-archived', 'player-archived').relationship).toBe('ally')
    expect(relationships.resolve('gm-unknown', 'gm-south').relationship).toBe('unknown')
  })

  it('snapshots placement assignments and exposes every closed predicate', () => {
    const mutablePlacements = [
      placement('first', 'north'),
      placement('second', 'north'),
    ]
    const relationships = resolver(mutablePlacements)
    mutablePlacements[1] = placement('second', 'south')

    expect(MOVE_AUTOMATION_RELATIONSHIP_PREDICATES).toEqual([
      'self',
      'ally',
      'enemy',
      'same-side',
      'other',
      'unknown',
    ])
    expect(relationships.resolve('first', 'second').relationship).toBe('ally')
    expect(Object.isFrozen(relationships)).toBe(true)
    expect(Object.isFrozen(relationships.resolve('first', 'second'))).toBe(true)
  })
})

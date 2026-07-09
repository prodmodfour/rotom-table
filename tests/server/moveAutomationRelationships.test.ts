import { describe, expect, it } from 'vitest'
import {
  ally,
  enemy,
  sameSide,
  self,
  type MoveAutomationRelationshipParticipant,
} from '../../server/domain/moveAutomation/relationships'

const participant = (
  id: string,
  sideId?: string | null,
): MoveAutomationRelationshipParticipant => ({ id, sideId })

describe('authoritative move relationship queries', () => {
  it('fails side relationships closed when either allegiance is unknown', () => {
    const unknown = participant('unknown')
    const alsoUnknown = participant('also-unknown', null)
    const known = participant('known', 'north')

    expect(sameSide(unknown, alsoUnknown)).toBe(false)
    expect(ally(unknown, known)).toBe(false)
    expect(enemy(unknown, known)).toBe(false)
    expect(ally(participant('blank', '  '), known)).toBe(false)
  })

  it('identifies the same token without requiring a side or treating it as its own ally or enemy', () => {
    const token = participant('token')

    expect(self(token, participant('token'))).toBe(true)
    expect(sameSide(token, participant('token'))).toBe(false)
    expect(ally(token, participant('token', 'north'))).toBe(false)
    expect(enemy(token, participant('token', 'south'))).toBe(false)
  })

  it('identifies distinct placements on the same explicit side as allies', () => {
    const first = participant('first', 'north')
    const second = participant('second', 'north')

    expect(self(first, second)).toBe(false)
    expect(sameSide(first, second)).toBe(true)
    expect(ally(first, second)).toBe(true)
    expect(enemy(first, second)).toBe(false)
  })

  it('identifies distinct placements on different explicit sides as enemies', () => {
    const north = participant('north-token', 'north')
    const south = participant('south-token', 'south')

    expect(sameSide(north, south)).toBe(false)
    expect(ally(north, south)).toBe(false)
    expect(enemy(north, south)).toBe(true)
  })

  it('never infers allegiance from GM control', () => {
    const gmNorth = { ...participant('gm-north', 'north'), controlledBy: 'gm' as const }
    const gmSouth = { ...participant('gm-south', 'south'), controlledBy: 'gm' as const }
    const playerNorth = { ...participant('player-north', 'north'), controlledBy: 'player' as const }
    const gmUnknown = { ...participant('gm-unknown'), controlledBy: 'gm' as const }

    expect(ally(gmNorth, gmSouth)).toBe(false)
    expect(enemy(gmNorth, gmSouth)).toBe(true)
    expect(ally(gmNorth, playerNorth)).toBe(true)
    expect(ally(gmUnknown, gmSouth)).toBe(false)
    expect(enemy(gmUnknown, gmSouth)).toBe(false)
  })
})

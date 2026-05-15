import { describe, expect, it } from 'vitest'
import {
  ALL_MOVE_TYPES_OPTION,
  buildMoveTypeOptions,
  filterMovesForIndex,
  moveMatchesSearch,
} from '~/utils/reference/moveIndex'
import type { PtuMove } from '~/types/ptuReference'

const move = (overrides: Partial<PtuMove> & Pick<PtuMove, 'name' | 'type'>): PtuMove => ({
  name: overrides.name,
  type: overrides.type,
  frequency: overrides.frequency,
  ac: overrides.ac,
  damage_base: overrides.damage_base,
  damage_roll: overrides.damage_roll,
  damage_class: overrides.damage_class,
  range: overrides.range,
  effect: overrides.effect,
  special: overrides.special,
})

const sampleMoves: PtuMove[] = [
  move({
    name: 'Tackle',
    type: 'Normal',
    frequency: 'At-Will',
    damage_class: 'Physical',
    range: 'Melee, 1 Target',
    effect: 'Pushes the target.',
  }),
  move({
    name: 'Flamethrower',
    type: 'Fire',
    frequency: 'EOT',
    damage_class: 'Special',
    range: '4, 1 Target',
    effect: 'Burns on 19+.',
  }),
  move({
    name: 'Swords Dance',
    type: 'Normal',
    frequency: 'Scene',
    damage_class: 'Status',
    range: 'Self',
    effect: 'Raises Attack.',
  }),
  move({
    name: 'Water Gun',
    type: 'Water',
    frequency: 'At-Will',
    damage_class: 'Special',
    range: '4, 1 Target',
    effect: 'A blast of water.',
  }),
]

describe('move index helpers', () => {
  it('builds sorted type options with All first', () => {
    expect(buildMoveTypeOptions(sampleMoves)).toEqual([
      ALL_MOVE_TYPES_OPTION,
      'Fire',
      'Normal',
      'Water',
    ])
  })

  it('matches move search haystacks', () => {
    expect(moveMatchesSearch(sampleMoves[0]!, 'push')).toBe(true)
    expect(moveMatchesSearch(sampleMoves[1]!, 'special')).toBe(true)
    expect(moveMatchesSearch(sampleMoves[2]!, 'self')).toBe(true)
    expect(moveMatchesSearch(move({ name: 'Ember', type: 'Fire', special: 'Grants Firestarter' }), 'firestarter')).toBe(true)
    expect(moveMatchesSearch(sampleMoves[3]!, 'missing')).toBe(false)
  })

  it('filters by type and search term', () => {
    expect(filterMovesForIndex(sampleMoves, { type: 'Normal' }).map((m) => m.name)).toEqual([
      'Tackle',
      'Swords Dance',
    ])
    expect(filterMovesForIndex(sampleMoves, { searchTerm: 'burn' }).map((m) => m.name)).toEqual([
      'Flamethrower',
    ])
    expect(filterMovesForIndex(sampleMoves, { type: 'Normal', searchTerm: 'self' }).map((m) => m.name)).toEqual([
      'Swords Dance',
    ])
  })

  it('treats omitted type as All', () => {
    expect(filterMovesForIndex(sampleMoves, {}).map((m) => m.name)).toEqual([
      'Tackle',
      'Flamethrower',
      'Swords Dance',
      'Water Gun',
    ])
  })
})

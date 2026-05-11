import { describe, expect, it } from 'vitest'
import { buildMoveSearchValues } from '~/utils/pokedex/searchMoveValues'

describe('pokedex move search value helpers', () => {
  it('returns no aliases when a Pokédex entry has no learned move sources', () => {
    expect(buildMoveSearchValues({})).toEqual([])
  })

  it('builds level-up move aliases with generic move and level-specific terms', () => {
    expect(buildMoveSearchValues({
      level_up_moves: [{ level: 10, name: 'Thunder Shock', type: 'Electric' }],
    })).toEqual([
      'Thunder Shock',
      'move Thunder Shock',
      'moves Thunder Shock',
      'Thunder Shock move',
      'level up Thunder Shock',
      'level 10 Thunder Shock',
    ])
  })

  it('builds TM/HM machine aliases while preserving compact machine labels', () => {
    const values = buildMoveSearchValues({
      tm_hm_moves: [
        { kind: 'TM', number: '24', name: 'Thunderbolt' },
        { kind: 'HM', number: '03', name: 'Surf' },
      ],
    })

    expect(values).toEqual(expect.arrayContaining([
      'move Thunderbolt',
      'TM 24',
      'TM24',
      'TM 24 Thunderbolt',
      'TM24 Thunderbolt',
      'HM 03',
      'HM03',
      'HM03 Surf',
    ]))
  })

  it('builds egg and tutor move aliases including heart-scale tutor terms', () => {
    const values = buildMoveSearchValues({
      egg_moves: ['Fake Out'],
      tutor_moves: [
        { name: 'Iron Tail', heart_scale: true },
        { name: 'Signal Beam', heart_scale: false },
      ],
    })

    expect(values).toEqual(expect.arrayContaining([
      'egg move Fake Out',
      'tutor move Iron Tail',
      'heart scale move Iron Tail',
      'tutor move Signal Beam',
    ]))
    expect(values).not.toContain('heart scale move Signal Beam')
  })
})

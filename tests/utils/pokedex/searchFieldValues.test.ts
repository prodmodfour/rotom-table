import { describe, expect, it } from 'vitest'
import {
  buildBaseStatSearchValues,
  buildBreedingSearchValues,
  buildCapabilitySearchValues,
  buildIdentitySearchValues,
  buildMoveSearchValues,
  buildSkillSearchValues,
  formatNationalDexNumber,
  toPokedexSlug,
} from '~/utils/pokedex/searchFieldValues'

describe('pokedex search field value helpers', () => {
  it('builds identity values with dex and generation aliases', () => {
    expect(toPokedexSlug("Flabébé’s Form")).toBe('flabebes-form')
    expect(formatNationalDexNumber(7)).toBe('#007')

    expect(buildIdentitySearchValues({
      species: 'Mr. Mime',
      slug: 'mr-mime',
      nationalDexNumber: 122,
      source_gen: '1',
    })).toEqual([
      'Mr. Mime',
      'mr mime',
      '1',
      'gen 1',
      'source 1',
      122,
      '122',
      '#122',
      'dex 122',
      'dex 122',
      'national dex 122',
      '#122',
    ])
  })

  it('builds capability aliases for movement and labelled other capabilities', () => {
    const values = buildCapabilitySearchValues({ capabilities: { overland: 6, jump: '2/3', other: ['Threaded 4 (forest)'] } })

    expect(values).toContain('cap Overland 6')
    expect(values).toContain('Overland 5')
    expect(values).toContain('Threaded 4')
    expect(values).toContain('capability Threaded 4')
    expect(values).toContain('Threaded 3')
  })

  it('builds move aliases across learned move sources', () => {
    const values = buildMoveSearchValues({
      level_up_moves: [{ level: 10, name: 'Thunder Shock', type: 'Electric' }],
      tm_hm_moves: [{ kind: 'TM', number: '24', name: 'Thunderbolt' }],
      egg_moves: ['Fake Out'],
      tutor_moves: [{ name: 'Iron Tail', heart_scale: true }],
    })

    expect(values).toContain('level 10 Thunder Shock')
    expect(values).toContain('TM24 Thunderbolt')
    expect(values).toContain('egg move Fake Out')
    expect(values).toContain('heart scale move Iron Tail')
  })

  it('builds breeding, skill, and base-stat threshold aliases', () => {
    expect(buildBreedingSearchValues({
      egg_groups: ['Field'],
      genderless: true,
      male_pct: null,
      female_pct: 100,
      hatch_rate: '10 Days',
    })).toEqual(expect.arrayContaining([
      'Field',
      'Field egg group',
      'genderless',
      'male 0',
      'female 100',
      'hatch rate 10 Days',
    ]))

    expect(buildSkillSearchValues({ skills: { Acrobatics: '4d6+2' } })).toEqual(expect.arrayContaining([
      'skill Acrobatics 4d6+2',
      'Acrobatics 3d6',
    ]))

    expect(buildBaseStatSearchValues({ base_stats: { hp: 4, atk: 5, def: 4, spatk: 5, spdef: 5, spd: 9 } })).toEqual(expect.arrayContaining([
      'base stat Speed 9',
      'Speed 8',
      'Spd 8',
    ]))
  })
})

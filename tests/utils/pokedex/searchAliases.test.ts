import { describe, expect, it } from 'vitest'
import {
  buildMinimumBaseStatAliases,
  buildMinimumCapabilityAliases,
  buildMinimumLabelledCapabilityAliases,
  buildMinimumSkillAliases,
  hasPokedexCapabilityValue,
} from '~/utils/pokedex/searchAliases'

describe('pokedex search alias helpers', () => {
  it('classifies meaningful movement capability values', () => {
    expect(hasPokedexCapabilityValue(undefined)).toBe(false)
    expect(hasPokedexCapabilityValue(null)).toBe(false)
    expect(hasPokedexCapabilityValue(0)).toBe(false)
    expect(hasPokedexCapabilityValue('0')).toBe(false)
    expect(hasPokedexCapabilityValue('0/0')).toBe(false)
    expect(hasPokedexCapabilityValue('2/3')).toBe(true)
    expect(hasPokedexCapabilityValue(4)).toBe(true)
  })

  it('builds minimum aliases for numeric movement capabilities', () => {
    expect(buildMinimumCapabilityAliases('Overland', '2/3')).toEqual([
      'Overland 1',
      'cap Overland 1',
      'caps Overland 1',
      'capability Overland 1',
      'capabilities Overland 1',
      'Overland 2',
      'cap Overland 2',
      'caps Overland 2',
      'capability Overland 2',
      'capabilities Overland 2',
      'Overland 3',
      'cap Overland 3',
      'caps Overland 3',
      'capability Overland 3',
      'capabilities Overland 3',
    ])
  })

  it('builds minimum aliases for labelled other capabilities', () => {
    expect(buildMinimumLabelledCapabilityAliases('Threaded 4 (sticky)')).toContain('cap Threaded 3')
    expect(buildMinimumLabelledCapabilityAliases('Threaded 4 (sticky)')).toContain('capabilities Threaded 4')
    expect(buildMinimumLabelledCapabilityAliases('Darkvision')).toEqual([])
  })

  it('builds minimum aliases for skill dice and base stats', () => {
    expect(buildMinimumSkillAliases('Acrobatics', '3d6+2')).toEqual(expect.arrayContaining([
      '1d6',
      'skill Acrobatics 2d6',
      'Acrobatics 3d6+1',
      'skills 3d6+2',
    ]))

    expect(buildMinimumBaseStatAliases('Speed', 'Spd', 2)).toEqual([
      'Speed 1',
      'Spd 1',
      'stat Speed 1',
      'stat Spd 1',
      'base Speed 1',
      'base stat Speed 1',
      'Speed 2',
      'Spd 2',
      'stat Speed 2',
      'stat Spd 2',
      'base Speed 2',
      'base stat Speed 2',
    ])
  })
})

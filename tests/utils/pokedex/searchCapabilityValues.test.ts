import { describe, expect, it } from 'vitest'
import {
  CAPABILITY_SEARCH_FIELDS,
  buildCapabilitySearchValues,
} from '~/utils/pokedex/searchCapabilityValues'

describe('pokedex capability search value helpers', () => {
  it('keeps the canonical movement capability field order', () => {
    expect(CAPABILITY_SEARCH_FIELDS.map(([key]) => key)).toEqual([
      'overland',
      'sky',
      'swim',
      'levitate',
      'burrow',
      'jump',
      'power',
    ])
  })

  it('returns no values when capabilities are absent or empty', () => {
    expect(buildCapabilitySearchValues({ capabilities: undefined })).toEqual([])
    expect(buildCapabilitySearchValues({ capabilities: { overland: 0, jump: '0/0', other: ['', null as unknown as string] } })).toEqual([])
  })

  it('builds movement capability aliases and minimum threshold aliases', () => {
    const values = buildCapabilitySearchValues({ capabilities: { overland: 3, jump: '2/3' } })

    expect(values).toEqual(expect.arrayContaining([
      'Overland',
      'cap Overland',
      'Overland 3',
      'capability Overland 3',
      'Jump 2/3',
      'Jump 1',
      'cap Jump 2',
      'capabilities Jump 3',
    ]))
  })

  it('builds aliases for labelled other capabilities without parenthetical suffixes', () => {
    const values = buildCapabilitySearchValues({ capabilities: { other: ['Threaded 4 (forest)', 'Darkvision'] } })

    expect(values).toEqual(expect.arrayContaining([
      'Threaded 4 (forest)',
      'Threaded 4',
      'cap Threaded 4',
      'Threaded 4 capability',
      'Threaded 3',
      'capabilities Threaded 4',
      'Darkvision',
      'Darkvision capability',
    ]))
  })
})

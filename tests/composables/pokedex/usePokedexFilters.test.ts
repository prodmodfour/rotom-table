import { describe, expect, it } from 'vitest'
import {
  buildActivePokedexSearchFilters,
  createDefaultPokedexFilterOperators,
  createEmptyPokedexSearchFilters,
  filterPokedexEntries,
} from '~/composables/pokedex/usePokedexFilters'
import type { DisplayPokedexEntry } from '~/utils/pokedex/entryIndex'

describe('usePokedexFilters helpers', () => {
  it('creates stable default filter state', () => {
    expect(createEmptyPokedexSearchFilters()).toMatchObject({ any: '', type: '', move: '' })
    expect(createDefaultPokedexFilterOperators()).toMatchObject({ identity: 'and', type: 'and', move: 'and' })
  })

  it('builds advanced and field-mode active filters', () => {
    const emptyFilters = createEmptyPokedexSearchFilters()
    const operators = createDefaultPokedexFilterOperators()

    expect(buildActivePokedexSearchFilters('advanced', { ...emptyFilters, any: 'fire or water' }, operators)).toHaveLength(1)

    const fieldFilters = buildActivePokedexSearchFilters('fields', {
      ...emptyFilters,
      type: 'fire',
      ability: 'intimidate',
    }, {
      ...operators,
      ability: 'or',
    })

    expect(fieldFilters.map((filter) => ({ key: filter.key, operator: filter.operator }))).toEqual([
      { key: 'type', operator: 'and' },
      { key: 'ability', operator: 'or' },
    ])
  })

  it('filters display entries with active filters without cloning the no-filter list', () => {
    const entries = [
      {
        id: 'charmander',
        species: 'Charmander',
        slug: 'charmander',
        nationalDexNumber: 4,
        searchText: 'charmander fire ember',
        searchTexts: {
          any: 'charmander fire ember',
          identity: 'charmander',
          type: 'fire',
          ability: '',
          capability: '',
          move: 'ember',
          habitat: '',
          breeding: '',
          diet: '',
          skill: '',
          stat: '',
          size: '',
        },
      },
      {
        id: 'squirtle',
        species: 'Squirtle',
        slug: 'squirtle',
        nationalDexNumber: 7,
        searchText: 'squirtle water surf',
        searchTexts: {
          any: 'squirtle water surf',
          identity: 'squirtle',
          type: 'water',
          ability: '',
          capability: '',
          move: 'surf',
          habitat: '',
          breeding: '',
          diet: '',
          skill: '',
          stat: '',
          size: '',
        },
      },
    ] as DisplayPokedexEntry[]

    expect(filterPokedexEntries(entries, [])).toBe(entries)

    const filters = buildActivePokedexSearchFilters(
      'fields',
      { ...createEmptyPokedexSearchFilters(), type: 'fire' },
      createDefaultPokedexFilterOperators(),
    )
    expect(filterPokedexEntries(entries, filters).map((entry) => entry.slug)).toEqual(['charmander'])
  })
})

import { describe, expect, it } from 'vitest'
import {
  buildDietSearchValues,
  buildEggGroupSearchValues,
  buildHabitatSearchValues,
  buildTypeSearchValues,
} from '~/utils/pokedex/searchListValues'

describe('pokedex search list value helpers', () => {
  it('builds type aliases with singular and plural aggregate labels', () => {
    expect(buildTypeSearchValues({ types: ['Fire', 'Flying'] })).toEqual([
      'Fire',
      'Flying',
      'type Fire Flying',
      'types Fire Flying',
      'type Fire',
      'Fire type',
      'type Flying',
      'Flying type',
    ])
  })

  it('builds habitat aliases with singular and plural aggregate labels', () => {
    expect(buildHabitatSearchValues({ habitat: ['Forest', 'Urban'] })).toEqual([
      'Forest',
      'Urban',
      'habitat Forest Urban',
      'habitats Forest Urban',
      'habitat Forest',
      'Forest habitat',
      'habitat Urban',
      'Urban habitat',
    ])
  })

  it('builds diet and egg group aliases without adding extra plural aggregates', () => {
    expect(buildDietSearchValues({ diet: ['Herbivore', 'Phototroph'] })).toEqual([
      'Herbivore',
      'Phototroph',
      'diet Herbivore Phototroph',
      'diet Herbivore',
      'Herbivore diet',
      'diet Phototroph',
      'Phototroph diet',
    ])

    expect(buildEggGroupSearchValues(['Field', 'Fairy'])).toEqual([
      'Field',
      'Fairy',
      'egg group Field Fairy',
      'egg group Field',
      'Field egg group',
      'egg group Fairy',
      'Fairy egg group',
    ])
  })

  it('returns empty arrays for missing list values', () => {
    expect(buildTypeSearchValues({ types: undefined })).toEqual([])
    expect(buildHabitatSearchValues({ habitat: [] })).toEqual([])
    expect(buildDietSearchValues({ diet: undefined })).toEqual([])
    expect(buildEggGroupSearchValues(undefined)).toEqual([])
  })
})

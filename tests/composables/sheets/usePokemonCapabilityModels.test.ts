import { ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { pokedexNaturewalkDefault, usePokemonCapabilityModels } from '~/composables/sheets/usePokemonCapabilityModels'
import { getPokedexEntry } from '~~/data/characterSheets'
import type { CharacterSheet } from '~/types/characterSheet'

const makeSheet = (overrides: Partial<CharacterSheet> = {}): CharacterSheet => ({
  slug: 'spark',
  nickname: 'Spark',
  species: 'Pikachu',
  level: 10,
  ...overrides,
})

describe('usePokemonCapabilityModels', () => {
  it('displays Pokédex capability defaults when sheet fields are missing', () => {
    const sheet = ref<CharacterSheet | null>(makeSheet({ capabilities: { other: [] } }))
    const capabilities = usePokemonCapabilityModels(sheet)

    expect(capabilities.overland.value).toBe(7)
    expect(capabilities.sky.value).toBe(0)
    expect(capabilities.swim.value).toBe(2)
    expect(capabilities.jump.value).toBe('2/2')
    expect(capabilities.power.value).toBe(2)
    expect(capabilities.weight.value).toBe(1)
    expect(capabilities.size.value).toBe('Small')
    expect(capabilities.naturewalk.value).toBe('Forest, Urban')
  })

  it('keeps sheet-level overrides writable without materialising every default', () => {
    const sheet = ref<CharacterSheet | null>(makeSheet({
      capabilities: { overland: 9, other: [] },
    }))
    const capabilities = usePokemonCapabilityModels(sheet)

    expect(capabilities.overland.value).toBe(9)
    expect(capabilities.swim.value).toBe(2)

    capabilities.swim.value = 4
    capabilities.size.value = 'Medium'

    expect(sheet.value?.capabilities).toEqual({
      overland: 9,
      swim: 4,
      size: 'Medium',
      other: [],
    })
  })

  it('tracks species changes until a sheet value overrides the field', () => {
    const sheet = ref<CharacterSheet | null>(makeSheet({ species: 'Abra', capabilities: {} }))
    const capabilities = usePokemonCapabilityModels(sheet)

    expect(capabilities.overland.value).toBe(3)

    sheet.value!.species = 'Pikachu'
    expect(capabilities.overland.value).toBe(7)

    capabilities.overland.value = 10
    sheet.value!.species = 'Abra'
    expect(capabilities.overland.value).toBe(10)
  })

  it('creates the capability object when writing to a sparse sheet', () => {
    const sheet = ref<CharacterSheet | null>(makeSheet())
    const capabilities = usePokemonCapabilityModels(sheet)

    capabilities.burrow.value = 2

    expect(sheet.value?.capabilities?.burrow).toBe(2)
  })

  it('parses Naturewalk defaults from Pokédex capability labels', () => {
    expect(pokedexNaturewalkDefault(getPokedexEntry('Pikachu'))).toBe('Forest, Urban')
    expect(pokedexNaturewalkDefault(getPokedexEntry('Miltank'))).toBeUndefined()
  })
})

import { computed, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { usePokemonSheetCsvFields } from '~/composables/sheets/usePokemonSheetCsvFields'
import type { CharacterSheet } from '~/types/characterSheet'

const makeSheet = (): CharacterSheet => ({
  slug: 'pikachu',
  species: 'Pikachu',
  nickname: 'Pika',
  level: 5,
  types: ['Electric'],
  eggGroups: ['Field', 'Fairy'],
  capabilities: { other: ['Zapper'] },
  skillBackground: { raised: ['Acrobatics'], lowered: ['Stealth'] },
})

describe('usePokemonSheetCsvFields', () => {
  it('exposes list-backed Pokémon fields as comma-separated v-models', () => {
    const sheet = ref<CharacterSheet | null>(makeSheet())
    const fields = usePokemonSheetCsvFields({
      sheet,
      sheetTypes: computed(() => sheet.value?.types ?? []),
      eggGroups: computed(() => sheet.value?.eggGroups ?? []),
    })

    expect(fields.typesAsCsv.value).toBe('Electric')
    expect(fields.eggGroupsAsCsv.value).toBe('Field, Fairy')
    expect(fields.otherCapsCsv.value).toBe('Zapper')
    expect(fields.skillBgRaisedCsv.value).toBe('Acrobatics')
    expect(fields.skillBgLoweredCsv.value).toBe('Stealth')

    fields.typesAsCsv.value = 'Electric, Steel'
    fields.eggGroupsAsCsv.value = 'Field,, Monster '
    fields.otherCapsCsv.value = 'Telepath, Aura Reader'
    fields.skillBgRaisedCsv.value = 'Athletics, Survival'
    fields.skillBgLoweredCsv.value = 'Combat'

    expect(sheet.value?.types).toEqual(['Electric', 'Steel'])
    expect(sheet.value?.eggGroups).toEqual(['Field', 'Monster'])
    expect(sheet.value?.capabilities?.other).toEqual(['Telepath', 'Aura Reader'])
    expect(sheet.value?.skillBackground?.raised).toEqual(['Athletics', 'Survival'])
    expect(sheet.value?.skillBackground?.lowered).toEqual(['Combat'])
  })

  it('uses derived fallback values for type and egg group display', () => {
    const sheet = ref<CharacterSheet | null>({
      ...makeSheet(),
      types: undefined,
      eggGroups: undefined,
    })
    const fields = usePokemonSheetCsvFields({
      sheet,
      sheetTypes: computed(() => sheet.value?.types ?? ['Water']),
      eggGroups: computed(() => sheet.value?.eggGroups ?? ['Water 1']),
    })

    expect(fields.typesAsCsv.value).toBe('Water')
    expect(fields.eggGroupsAsCsv.value).toBe('Water 1')
  })

  it('clears optional arrays consistently and is inert without a sheet', () => {
    const sheet = ref<CharacterSheet | null>(makeSheet())
    const fields = usePokemonSheetCsvFields({
      sheet,
      sheetTypes: computed(() => sheet.value?.types ?? []),
      eggGroups: computed(() => sheet.value?.eggGroups ?? []),
    })

    fields.typesAsCsv.value = ''
    fields.eggGroupsAsCsv.value = ''
    fields.skillBgRaisedCsv.value = ''
    fields.skillBgLoweredCsv.value = ''
    fields.otherCapsCsv.value = ''

    expect(sheet.value?.types).toBeUndefined()
    expect(sheet.value?.eggGroups).toBeUndefined()
    expect(sheet.value?.skillBackground?.raised).toBeUndefined()
    expect(sheet.value?.skillBackground?.lowered).toBeUndefined()
    expect(sheet.value?.capabilities?.other).toEqual([])

    sheet.value = null
    fields.typesAsCsv.value = 'ignored'
    expect(sheet.value).toBeNull()
  })
})

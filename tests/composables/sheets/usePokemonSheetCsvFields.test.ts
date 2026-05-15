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
    expect(fields.otherCapsCsv.value).toBe('Zapper, Underdog')
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
    expect(fields.otherCapsCsv.value).toBe('Zapper, Underdog, Telepath, Aura Reader')
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

  it('shows move-granted Other capabilities without storing automatic entries', () => {
    const sheet = ref<CharacterSheet | null>({
      slug: 'abra',
      species: 'Abra',
      nickname: 'Abra',
      level: 5,
      movelist: [{ name: 'Ember' }, { name: 'Teleport' }],
      capabilities: { other: [] },
    })
    const fields = usePokemonSheetCsvFields({
      sheet,
      sheetTypes: computed(() => []),
      eggGroups: computed(() => []),
    })

    expect(fields.otherCapsCsv.value).toBe('Teleporter 6, Telekinetic, Telepath, Underdog, Firestarter')

    fields.otherCapsCsv.value = 'Teleporter 8, Firestarter, Custom Sense'

    expect(sheet.value?.capabilities?.other).toEqual(['Teleporter 4', 'Custom Sense'])
    expect(fields.otherCapsCsv.value).toBe('Telekinetic, Telepath, Underdog, Teleporter 8, Custom Sense, Firestarter')
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
    expect(fields.otherCapsCsv.value).toBe('Zapper, Underdog')

    sheet.value = null
    fields.typesAsCsv.value = 'ignored'
    expect(sheet.value).toBeNull()
  })
})

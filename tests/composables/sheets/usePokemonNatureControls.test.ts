import { nextTick, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import {
  formatNatureModDisplay,
  natureStepForStat,
  POKEMON_GENDER_OPTIONS,
  syncNatureModForSheet,
  usePokemonNatureControls,
} from '~/composables/sheets/usePokemonNatureControls'
import type { CharacterSheet } from '~/types/characterSheet'

const makeSheet = (nature = 'Adamant'): CharacterSheet => ({
  slug: 'pikachu',
  species: 'Pikachu',
  nickname: 'Pika',
  level: 5,
  nature,
  natureMod: {},
})

describe('usePokemonNatureControls', () => {
  it('formats PTU nature deltas with HP and non-HP step sizes', () => {
    expect(natureStepForStat('hp')).toBe(1)
    expect(natureStepForStat('atk')).toBe(2)
    expect(formatNatureModDisplay('hp', 1)).toBe('HP +1')
    expect(formatNatureModDisplay('sdef', -1)).toBe('SDEF -2')
    expect(formatNatureModDisplay(undefined, 1)).toBeUndefined()
  })

  it('syncs persisted natureMod fields from the selected nature', () => {
    const sheet = makeSheet('Adamant')

    syncNatureModForSheet(sheet)
    expect(sheet.natureMod).toEqual({ plus: 'atk', minus: 'satk' })

    syncNatureModForSheet(sheet, 'Patient')
    expect(sheet.natureMod).toEqual({ plus: 'hp', minus: 'spd' })

    syncNatureModForSheet(sheet, 'Unknown')
    expect(sheet.natureMod).toEqual({ plus: undefined, minus: undefined })
  })

  it('exposes species-valid gender options and updates displays reactively', async () => {
    const sheet = ref<CharacterSheet | null>(makeSheet('Adamant'))
    const controls = usePokemonNatureControls(sheet)

    expect(controls.genderOptions.value).toEqual(['Male', 'Female'])
    expect(sheet.value?.gender).toBe('Male')
    expect(controls.natureOptions).toContain('Adamant')
    expect(controls.naturePlusDisplay.value).toBe('ATK +2')
    expect(controls.natureMinusDisplay.value).toBe('SATK -2')

    sheet.value!.nature = 'Patient'
    await nextTick()

    expect(controls.naturePlusDisplay.value).toBe('HP +1')
    expect(controls.natureMinusDisplay.value).toBe('SPD -2')
    expect(sheet.value?.natureMod).toEqual({ plus: 'hp', minus: 'spd' })

    sheet.value!.species = 'chansey'
    await nextTick()

    expect(controls.genderOptions.value).toEqual(['Female'])
    expect(sheet.value?.gender).toBe('Female')

    sheet.value!.species = 'Ditto'
    await nextTick()

    expect(controls.genderOptions.value).toEqual(['Genderless'])
    expect(sheet.value?.gender).toBe('Genderless')

    sheet.value!.species = 'Not A Real Species'
    await nextTick()

    expect(controls.genderOptions.value).toBe(POKEMON_GENDER_OPTIONS)
    expect(sheet.value?.gender).toBe('Genderless')
  })
})

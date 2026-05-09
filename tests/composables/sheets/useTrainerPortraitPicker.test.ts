import { ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { useTrainerPortraitPicker } from '~/composables/sheets/useTrainerPortraitPicker'
import type { PokemonCatalogEntry } from '~/types/pokemon'
import type { TrainerSheet } from '~/types/trainerSheet'

const catalog: PokemonCatalogEntry[] = [
  {
    species: 'Lenora Vask',
    slug: 'lenora-vask',
    size: 'Trainer',
    width: 1,
    height: 1,
    base: 1,
    clearance: 1,
    spriteUrl: '/trainer-sprites/lenora.png',
    entityKind: 'trainer',
  },
  {
    species: 'Hassan',
    slug: 'desert-hassan',
    size: 'Trainer',
    width: 1,
    height: 1,
    base: 1,
    clearance: 1,
    spriteUrl: '/trainer-sprites/hassan.png',
    entityKind: 'trainer',
  },
]

const makeSheet = (): TrainerSheet => ({
  slug: 'trainer',
  name: 'Trainer',
  level: 1,
})

describe('useTrainerPortraitPicker', () => {
  it('opens with a cleared query and filters by species or slug', () => {
    const sheet = ref<TrainerSheet | null>(makeSheet())
    const picker = useTrainerPortraitPicker(sheet, catalog)

    picker.portraitQuery.value = 'old query'
    picker.openPortraitPicker()

    expect(picker.portraitPickerOpen.value).toBe(true)
    expect(picker.portraitQuery.value).toBe('')
    expect(picker.filteredPortraitOptions.value).toEqual(catalog)

    picker.portraitQuery.value = 'desert'
    expect(picker.filteredPortraitOptions.value.map((entry) => entry.species)).toEqual(['Hassan'])

    picker.portraitQuery.value = 'LENORA'
    expect(picker.filteredPortraitOptions.value.map((entry) => entry.species)).toEqual(['Lenora Vask'])
  })

  it('selects and clears the sheet portrait URL', () => {
    const sheet = ref<TrainerSheet | null>(makeSheet())
    const picker = useTrainerPortraitPicker(sheet, catalog)

    picker.openPortraitPicker()
    picker.selectPortrait('/trainer-sprites/lenora.png')

    expect(sheet.value?.portraitUrl).toBe('/trainer-sprites/lenora.png')
    expect(picker.portraitPickerOpen.value).toBe(false)

    picker.clearPortrait()
    expect(sheet.value?.portraitUrl).toBeUndefined()
  })

  it('is inert when no trainer sheet is loaded', () => {
    const sheet = ref<TrainerSheet | null>(null)
    const picker = useTrainerPortraitPicker(sheet, catalog)

    picker.openPortraitPicker()
    picker.selectPortrait('/trainer-sprites/lenora.png')
    picker.clearPortrait()

    expect(sheet.value).toBeNull()
    expect(picker.portraitPickerOpen.value).toBe(true)
  })
})

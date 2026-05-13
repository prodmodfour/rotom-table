import { ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { useTrainerSheetCsvFields } from '~/composables/sheets/useTrainerSheetCsvFields'
import type { TrainerSheet, TrainerSkillKey } from '~/types/trainerSheet'

const skillKeys: TrainerSkillKey[] = ['focus', 'command', 'stealth']

const makeSheet = (): TrainerSheet => ({
  slug: 'trainer',
  name: 'Trainer',
  level: 1,
  skillBackground: { adept: 'command', novice: ['focus'], pathetic: ['stealth'] },
  capabilities: { other: ['Aura Reader'] },
  currentTeam: ['bolt'],
  wishlist: ['Potion'],
})

describe('useTrainerSheetCsvFields', () => {
  it('exposes skill background CSV fields with skill-key filtering', () => {
    const sheet = ref<TrainerSheet | null>(makeSheet())
    const fields = useTrainerSheetCsvFields(sheet, skillKeys)

    expect(fields.adeptCsv.value).toBe('Command')
    expect(fields.noviceCsv.value).toBe('Focus')
    expect(fields.patheticCsv.value).toBe('Stealth')

    fields.adeptCsv.value = 'Focus, invalid, Command'
    fields.noviceCsv.value = ''
    fields.patheticCsv.value = 'Stealth, nope'

    expect(sheet.value?.skillBackground?.adept).toEqual(['focus', 'command'])
    expect(sheet.value?.skillBackground?.novice).toBeUndefined()
    expect(sheet.value?.skillBackground?.pathetic).toEqual(['stealth'])
  })

  it('accepts trainer skill labels and aliases in skill background fields', () => {
    const sheet = ref<TrainerSheet | null>(makeSheet())
    const fields = useTrainerSheetCsvFields(sheet, ['medicineEd', 'pokeEd', 'techEd'])

    fields.adeptCsv.value = 'Medicine Ed'
    fields.noviceCsv.value = 'Pokemon Ed'
    fields.patheticCsv.value = 'Tech Ed, Technology Ed'

    expect(sheet.value?.skillBackground?.adept).toBe('medicineEd')
    expect(sheet.value?.skillBackground?.novice).toBe('pokeEd')
    expect(sheet.value?.skillBackground?.pathetic).toEqual(['techEd'])
    expect(fields.adeptCsv.value).toBe('Medicine Ed')
    expect(fields.noviceCsv.value).toBe('Pokémon Ed')
    expect(fields.patheticCsv.value).toBe('Technology Ed')
  })

  it('exposes list-backed trainer CSV fields', () => {
    const sheet = ref<TrainerSheet | null>(makeSheet())
    const fields = useTrainerSheetCsvFields(sheet, skillKeys)

    fields.otherCapsCsv.value = 'Telepath, Aura Reader'
    fields.currentTeamCsv.value = 'bolt, ember'
    fields.wishlistCsv.value = 'Potion,, Revive '

    expect(sheet.value?.capabilities?.other).toEqual(['Telepath', 'Aura Reader'])
    expect(sheet.value?.currentTeam).toEqual(['bolt', 'ember'])
    expect(sheet.value?.wishlist).toEqual(['Potion', 'Revive'])
  })

  it('is inert when no sheet is loaded', () => {
    const sheet = ref<TrainerSheet | null>(null)
    const fields = useTrainerSheetCsvFields(sheet, skillKeys)

    expect(fields.currentTeamCsv.value).toBe('')
    fields.currentTeamCsv.value = 'ignored'
    expect(sheet.value).toBeNull()
  })
})

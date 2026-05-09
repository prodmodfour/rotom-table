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

    expect(fields.adeptCsv.value).toBe('command')
    expect(fields.noviceCsv.value).toBe('focus')
    expect(fields.patheticCsv.value).toBe('stealth')

    fields.adeptCsv.value = 'focus, invalid, command'
    fields.noviceCsv.value = ''
    fields.patheticCsv.value = 'stealth, nope'

    expect(sheet.value?.skillBackground?.adept).toEqual(['focus', 'command'])
    expect(sheet.value?.skillBackground?.novice).toBeUndefined()
    expect(sheet.value?.skillBackground?.pathetic).toEqual(['stealth'])
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

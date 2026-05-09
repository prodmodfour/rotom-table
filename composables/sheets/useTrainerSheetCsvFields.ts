import { computed, type Ref } from 'vue'
import type { TrainerSheet, TrainerSkillKey } from '~/types/trainerSheet'
import {
  formatCsvList,
  formatCsvSingleOrList,
  parseAllowedCsvList,
  parseCsvList,
  toOptionalSingleOrList,
} from '~/utils/sheets/csvFields'

export function useTrainerSheetCsvFields(
  sheet: Readonly<Ref<TrainerSheet | null>>,
  skillKeys: readonly TrainerSkillKey[],
) {
  const splitSkillCsv = (raw: string): TrainerSkillKey[] =>
    parseAllowedCsvList(raw, skillKeys)

  const adeptCsv = computed<string>({
    get: () => formatCsvSingleOrList(sheet.value?.skillBackground?.adept),
    set: (raw) => {
      if (!sheet.value) return
      sheet.value.skillBackground!.adept = toOptionalSingleOrList(splitSkillCsv(raw))
    },
  })

  const noviceCsv = computed<string>({
    get: () => formatCsvSingleOrList(sheet.value?.skillBackground?.novice),
    set: (raw) => {
      if (!sheet.value) return
      sheet.value.skillBackground!.novice = toOptionalSingleOrList(splitSkillCsv(raw))
    },
  })

  const patheticCsv = computed<string>({
    get: () => formatCsvList(sheet.value?.skillBackground?.pathetic),
    set: (raw) => {
      if (!sheet.value) return
      sheet.value.skillBackground!.pathetic = splitSkillCsv(raw)
    },
  })

  const otherCapsCsv = computed<string>({
    get: () => formatCsvList(sheet.value?.capabilities?.other),
    set: (raw) => {
      if (!sheet.value) return
      sheet.value.capabilities!.other = parseCsvList(raw)
    },
  })

  const currentTeamCsv = computed<string>({
    get: () => formatCsvList(sheet.value?.currentTeam),
    set: (raw) => {
      if (!sheet.value) return
      sheet.value.currentTeam = parseCsvList(raw)
    },
  })

  const wishlistCsv = computed<string>({
    get: () => formatCsvList(sheet.value?.wishlist),
    set: (raw) => {
      if (!sheet.value) return
      sheet.value.wishlist = parseCsvList(raw)
    },
  })

  return {
    adeptCsv,
    noviceCsv,
    patheticCsv,
    otherCapsCsv,
    currentTeamCsv,
    wishlistCsv,
  }
}

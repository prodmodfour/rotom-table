import { computed, type ComputedRef, type Ref } from 'vue'
import type { CharacterSheet } from '~/types/characterSheet'
import { formatCsvList, parseCsvList } from '~/utils/sheets/csvFields'

export interface PokemonSheetCsvFieldSources {
  sheet: Readonly<Ref<CharacterSheet | null>>
  sheetTypes: ComputedRef<readonly string[]>
  eggGroups: ComputedRef<readonly string[]>
}

export function usePokemonSheetCsvFields({
  sheet,
  sheetTypes,
  eggGroups,
}: PokemonSheetCsvFieldSources) {
  const typesAsCsv = computed<string>({
    get: () => formatCsvList(sheetTypes.value),
    set: (raw) => {
      if (!sheet.value) return
      const next = parseCsvList(raw)
      sheet.value.types = next.length ? next : undefined
    },
  })

  const eggGroupsAsCsv = computed<string>({
    get: () => formatCsvList(eggGroups.value),
    set: (raw) => {
      if (!sheet.value) return
      const next = parseCsvList(raw)
      sheet.value.eggGroups = next.length ? next : undefined
    },
  })

  const otherCapsCsv = computed<string>({
    get: () => formatCsvList(sheet.value?.capabilities?.other),
    set: (raw) => {
      if (!sheet.value) return
      sheet.value.capabilities!.other = parseCsvList(raw)
    },
  })

  const skillBgRaisedCsv = computed<string>({
    get: () => formatCsvList(sheet.value?.skillBackground?.raised),
    set: (raw) => {
      if (!sheet.value) return
      const next = parseCsvList(raw)
      sheet.value.skillBackground!.raised = next.length ? next : undefined
    },
  })

  const skillBgLoweredCsv = computed<string>({
    get: () => formatCsvList(sheet.value?.skillBackground?.lowered),
    set: (raw) => {
      if (!sheet.value) return
      const next = parseCsvList(raw)
      sheet.value.skillBackground!.lowered = next.length ? next : undefined
    },
  })

  return {
    typesAsCsv,
    eggGroupsAsCsv,
    otherCapsCsv,
    skillBgRaisedCsv,
    skillBgLoweredCsv,
  }
}

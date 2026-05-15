import { computed, type ComputedRef, type Ref } from 'vue'
import { getPokedexEntry } from '~~/data/characterSheets'
import type { CharacterSheet, CharacterSheetCapabilities } from '~/types/characterSheet'
import { formatCsvList, parseCsvList } from '~/utils/sheets/csvFields'
import {
  pokedexOtherCapabilityDefaults,
  removeDefaultCapabilitiesForStorage,
  resolvePokemonOtherCapabilities,
} from '~/utils/sheets/pokemonCapabilities'

export interface PokemonSheetCsvFieldSources {
  sheet: Readonly<Ref<CharacterSheet | null>>
  sheetTypes: ComputedRef<readonly string[]>
  eggGroups: ComputedRef<readonly string[]>
}

const ensureCapabilities = (sheet: CharacterSheet): CharacterSheetCapabilities => {
  if (!sheet.capabilities || typeof sheet.capabilities !== 'object' || Array.isArray(sheet.capabilities)) {
    sheet.capabilities = {}
  }
  return sheet.capabilities
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

  const species = computed(() => (sheet.value ? getPokedexEntry(sheet.value.species) : null))

  const otherCapsCsv = computed<string>({
    get: () => formatCsvList(resolvePokemonOtherCapabilities(species.value, sheet.value?.capabilities)),
    set: (raw) => {
      if (!sheet.value) return
      ensureCapabilities(sheet.value).other = removeDefaultCapabilitiesForStorage(
        parseCsvList(raw),
        pokedexOtherCapabilityDefaults(species.value),
      )
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

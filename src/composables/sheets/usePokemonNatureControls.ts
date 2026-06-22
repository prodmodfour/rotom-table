import { computed, watch, type ComputedRef, type Ref } from 'vue'
import { getPokedexEntry } from '~~/data/characterSheets'
import { PTU_NATURE_OPTIONS, resolveNatureMod } from '~/utils/ptuNatures'
import {
  pokemonGenderOptionsForPokedexEntry,
  syncPokemonGenderForPokedexEntry,
} from '~/utils/sheets/pokemonGender'
import type { CharacterSheet, StatKey } from '~/types/characterSheet'

export type PokemonNatureSheetRef = Ref<CharacterSheet | null> | ComputedRef<CharacterSheet | null>

export { POKEMON_GENDER_OPTIONS } from '~/utils/sheets/pokemonGender'
export const POKEMON_NATURE_OPTIONS = PTU_NATURE_OPTIONS

export const POKEMON_NATURE_STAT_LABELS: Record<StatKey, string> = {
  hp: 'HP',
  atk: 'ATK',
  def: 'DEF',
  satk: 'SATK',
  sdef: 'SDEF',
  spd: 'SPD',
}

export const natureStepForStat = (key: StatKey): number => key === 'hp' ? 1 : 2

export const formatNatureModDisplay = (
  key: StatKey | undefined,
  sign: 1 | -1,
): string | undefined => {
  if (!key) return undefined
  const delta = natureStepForStat(key) * sign
  return `${POKEMON_NATURE_STAT_LABELS[key]} ${delta > 0 ? `+${delta}` : delta}`
}

export const syncNatureModForSheet = (
  target: CharacterSheet,
  nature = target.nature,
): void => {
  if (!target.natureMod) target.natureMod = {}
  const mod = resolveNatureMod(nature)
  target.natureMod.plus = mod?.plus
  target.natureMod.minus = mod?.minus
}

export function usePokemonNatureControls(sheet: PokemonNatureSheetRef) {
  const pokedexEntry = computed(() => (sheet.value ? getPokedexEntry(sheet.value.species) : null))
  const genderOptions = computed(() => pokemonGenderOptionsForPokedexEntry(pokedexEntry.value))
  const natureLookupMod = computed(() => resolveNatureMod(sheet.value?.nature))
  const naturePlusDisplay = computed(() => formatNatureModDisplay(natureLookupMod.value?.plus, 1))
  const natureMinusDisplay = computed(() => formatNatureModDisplay(natureLookupMod.value?.minus, -1))

  watch(
    () => [sheet.value, pokedexEntry.value, sheet.value?.gender] as const,
    ([target, entry]) => {
      if (target) syncPokemonGenderForPokedexEntry(target, entry)
    },
    { immediate: true, flush: 'sync' },
  )

  watch(
    () => sheet.value?.nature,
    (nature) => {
      if (sheet.value) syncNatureModForSheet(sheet.value, nature)
    },
  )

  return {
    genderOptions,
    natureOptions: POKEMON_NATURE_OPTIONS,
    natureLookupMod,
    naturePlusDisplay,
    natureMinusDisplay,
  }
}

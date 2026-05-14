import { computed, type ComputedRef, type Ref, type WritableComputedRef } from 'vue'
import { getPokedexEntry } from '~~/data/characterSheets'
import type { CharacterSheet, CharacterSheetCapabilities } from '~/types/characterSheet'
import type { PokedexRecord } from '~/types/pokemon'

export type PokemonSheetRef = Ref<CharacterSheet | null> | ComputedRef<CharacterSheet | null>

export type PokemonCapabilityModelKey = Exclude<keyof CharacterSheetCapabilities, 'other'>

type CapabilityModelValue<K extends PokemonCapabilityModelKey> = CharacterSheetCapabilities[K]

const NATUREWALK_PATTERN = /^Naturewalk\s*\(([^)]*)\)\s*$/i

const ensureCapabilities = (sheet: CharacterSheet): CharacterSheetCapabilities => {
  if (!sheet.capabilities || typeof sheet.capabilities !== 'object' || Array.isArray(sheet.capabilities)) {
    sheet.capabilities = {}
  }
  return sheet.capabilities
}

export const pokedexNaturewalkDefault = (
  species: PokedexRecord | null | undefined,
): string | undefined => {
  const values = (species?.capabilities?.other ?? [])
    .map((capability) => NATUREWALK_PATTERN.exec(capability.trim())?.[1]?.trim())
    .filter((value): value is string => Boolean(value))

  return values.length ? values.join(', ') : undefined
}

/**
 * Writable capability cell models that display Pokédex species defaults until
 * a sheet-level override is entered. This keeps the sheet JSON sparse while
 * the editor still shows movement capabilities such as Overland/Jump from the
 * selected Pokémon's Pokédex entry.
 */
export function usePokemonCapabilityModels(sheet: PokemonSheetRef) {
  const species = computed(() => (sheet.value ? getPokedexEntry(sheet.value.species) : null))

  const capabilityModel = <K extends PokemonCapabilityModelKey>(
    key: K,
    speciesDefault: () => CapabilityModelValue<K> | undefined,
  ): WritableComputedRef<CapabilityModelValue<K> | undefined> => computed({
    get: () => sheet.value?.capabilities?.[key] ?? speciesDefault(),
    set: (value) => {
      if (!sheet.value) return
      ensureCapabilities(sheet.value)[key] = value
    },
  })

  return {
    overland: capabilityModel('overland', () => species.value?.capabilities?.overland),
    sky: capabilityModel('sky', () => species.value?.capabilities?.sky),
    swim: capabilityModel('swim', () => species.value?.capabilities?.swim),
    levitate: capabilityModel('levitate', () => species.value?.capabilities?.levitate),
    burrow: capabilityModel('burrow', () => species.value?.capabilities?.burrow),
    jump: capabilityModel('jump', () => species.value?.capabilities?.jump),
    power: capabilityModel('power', () => species.value?.capabilities?.power),
    weight: capabilityModel('weight', () => species.value?.weight),
    size: capabilityModel('size', () => species.value?.size),
    naturewalk: capabilityModel('naturewalk', () => pokedexNaturewalkDefault(species.value)),
  }
}

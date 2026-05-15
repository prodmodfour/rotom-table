import { computed, type ComputedRef, type Ref, type WritableComputedRef } from 'vue'
import type { TrainerCapabilities, TrainerSheet } from '~/types/trainerSheet'
import {
  computeDefaultTrainerCapabilities,
  type BasicTrainerCapabilityKey,
} from '~/utils/sheets/trainerDerived'

export type TrainerSheetRef = Ref<TrainerSheet | null> | ComputedRef<TrainerSheet | null>

type TrainerCapabilityModelValue<K extends keyof TrainerCapabilities> = TrainerCapabilities[K]

const ensureCapabilities = (sheet: TrainerSheet): TrainerCapabilities => {
  if (!sheet.capabilities || typeof sheet.capabilities !== 'object' || Array.isArray(sheet.capabilities)) {
    sheet.capabilities = {}
  }
  return sheet.capabilities
}

/**
 * Writable trainer capability models. Basic trainer capabilities display the
 * PTU formula defaults derived from current Skill ranks until a sheet-level
 * override is entered; optional movement types remain blank unless granted.
 */
export function useTrainerCapabilityModels(sheet: TrainerSheetRef) {
  const defaults = computed(() => (sheet.value ? computeDefaultTrainerCapabilities(sheet.value) : null))

  const capabilityModel = <K extends keyof TrainerCapabilities>(
    key: K,
    fallback: () => TrainerCapabilityModelValue<K> | undefined,
  ): WritableComputedRef<TrainerCapabilityModelValue<K> | undefined> => computed({
    get: () => sheet.value?.capabilities?.[key] ?? fallback(),
    set: (value) => {
      if (!sheet.value) return
      ensureCapabilities(sheet.value)[key] = value
    },
  })

  const defaultedModel = <K extends BasicTrainerCapabilityKey>(key: K) =>
    capabilityModel(key, () => defaults.value?.[key])

  return {
    overland: defaultedModel('overland'),
    throwingRange: defaultedModel('throwingRange'),
    highJump: defaultedModel('highJump'),
    longJump: defaultedModel('longJump'),
    swim: defaultedModel('swim'),
    power: defaultedModel('power'),
    sky: capabilityModel('sky', () => undefined),
    levitate: capabilityModel('levitate', () => undefined),
    burrow: capabilityModel('burrow', () => undefined),
  }
}

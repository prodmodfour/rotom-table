import { isPlainJsonObject, type StrictJsonObject } from '../automation/strictJson'
import type { EquipmentItemConfigurationV1 } from './equipment'
import type { EquipmentDefinitionV1 } from './equipmentDefinitions'

export const EQUIPMENT_DURABILITY_STATE_KEY = 'equipmentDurability' as const
export const EQUIPMENT_DURABILITY_STATE_SCHEMA_VERSION = 1 as const

export interface EquipmentDurabilityStateV1 {
  readonly schemaVersion: typeof EQUIPMENT_DURABILITY_STATE_SCHEMA_VERSION
  readonly current: number
  readonly maximum: number
}

const durabilityMaximumFor = (input: {
  readonly definition: EquipmentDefinitionV1
  readonly configuration: EquipmentItemConfigurationV1 | null
}): number | null => {
  const field = input.definition.configuration?.fields.find(row => row.key === 'durabilityMaximum')
  if (!field) return null
  if (field.kind !== 'integer-enum' || !input.configuration) {
    throw new Error('Reviewed equipment durability configuration is unavailable.')
  }
  const maximum = input.configuration.values.durabilityMaximum
  if (typeof maximum !== 'number' || !Number.isSafeInteger(maximum)
    || maximum <= 0 || !field.values.includes(maximum)) {
    throw new Error('Reviewed equipment durability configuration is invalid.')
  }
  return maximum
}

export const parseEquipmentDurabilityState = (
  serializedState: StrictJsonObject,
): EquipmentDurabilityStateV1 | null => {
  const value = serializedState[EQUIPMENT_DURABILITY_STATE_KEY]
  if (value === undefined) return null
  if (!isPlainJsonObject(value)) throw new Error('Equipment durability state is malformed.')
  const row = value as Record<string, unknown>
  if (Object.keys(row).length !== 3
    || row.schemaVersion !== EQUIPMENT_DURABILITY_STATE_SCHEMA_VERSION
    || typeof row.current !== 'number' || !Number.isSafeInteger(row.current)
    || typeof row.maximum !== 'number' || !Number.isSafeInteger(row.maximum)
    || row.maximum <= 0 || row.current < 0 || row.current > row.maximum) {
    throw new Error('Equipment durability state is malformed.')
  }
  return Object.freeze({
    schemaVersion: EQUIPMENT_DURABILITY_STATE_SCHEMA_VERSION,
    current: row.current,
    maximum: row.maximum,
  })
}

/**
 * Initialize only from a reviewed integer-enum configuration. Existing state
 * is validated and never silently replenished or rebound to another maximum.
 */
export const initializeEquipmentDurabilityState = (input: {
  readonly definition: EquipmentDefinitionV1
  readonly configuration: EquipmentItemConfigurationV1 | null
  readonly serializedState: StrictJsonObject
}): StrictJsonObject => {
  const reviewedMaximum = durabilityMaximumFor(input)
  const existing = parseEquipmentDurabilityState(input.serializedState)
  if (reviewedMaximum === null) {
    if (existing) throw new Error('This item has durability state without a reviewed durability definition.')
    return input.serializedState
  }
  if (existing) {
    if (existing.maximum !== reviewedMaximum) {
      throw new Error('Equipment durability state does not match its reviewed configuration.')
    }
    return input.serializedState
  }
  return {
    ...input.serializedState,
    [EQUIPMENT_DURABILITY_STATE_KEY]: {
      schemaVersion: EQUIPMENT_DURABILITY_STATE_SCHEMA_VERSION,
      current: reviewedMaximum,
      maximum: reviewedMaximum,
    },
  }
}

export const updateEquipmentDurabilityState = (input: {
  readonly serializedState: StrictJsonObject
  readonly amount: number
  readonly kind: 'damage' | 'restore'
}): { readonly state: StrictJsonObject; readonly durability: EquipmentDurabilityStateV1 } => {
  const durability = parseEquipmentDurabilityState(input.serializedState)
  if (!durability) throw new Error('This item has no reviewed durability state.')
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) {
    throw new Error('Equipment durability change must be a positive safe integer.')
  }
  const current = input.kind === 'damage'
    ? Math.max(0, durability.current - input.amount)
    : Math.min(durability.maximum, durability.current + input.amount)
  if (current === durability.current) throw new Error('Equipment durability change would have no effect.')
  const next = Object.freeze({ ...durability, current })
  return Object.freeze({
    state: {
      ...input.serializedState,
      [EQUIPMENT_DURABILITY_STATE_KEY]: next,
    },
    durability: next,
  })
}

import type { StrictJsonObject } from '#shared/automation/strictJson'

export const GLUE_CANNON_STATE_SCHEMA_VERSION = 1 as const
export const GLUE_CANNON_INITIAL_CHARGES = 3 as const
export const GLUE_CANNON_MAX_CHARGES = 99 as const

export interface GlueCannonStateV1 {
  readonly schemaVersion: typeof GLUE_CANNON_STATE_SCHEMA_VERSION
  readonly charges: number
}

/** Empty legacy/new whole-item state means the canonical purchased three-packet bundle. */
export const parseGlueCannonState = (serializedState: Readonly<Record<string, unknown>>): GlueCannonStateV1 => {
  const value = serializedState.glueCannon
  if (value === undefined) return Object.freeze({ schemaVersion: 1, charges: GLUE_CANNON_INITIAL_CHARGES })
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Glue Cannon state is malformed.')
  const input = value as Record<string, unknown>
  if (Object.keys(input).sort().join(',') !== 'charges,schemaVersion'
    || input.schemaVersion !== 1
    || !Number.isSafeInteger(input.charges)
    || Number(input.charges) < 0
    || Number(input.charges) > GLUE_CANNON_MAX_CHARGES) throw new Error('Glue Cannon state is malformed.')
  return Object.freeze({ schemaVersion: 1, charges: Number(input.charges) })
}

export const withGlueCannonCharges = (
  serializedState: StrictJsonObject,
  charges: number,
): StrictJsonObject => {
  if (!Number.isSafeInteger(charges) || charges < 0 || charges > GLUE_CANNON_MAX_CHARGES) {
    throw new Error('Glue Cannon charge count is outside reviewed bounds.')
  }
  return Object.freeze({
    ...serializedState,
    glueCannon: Object.freeze({ schemaVersion: 1, charges }),
  })
}

export const SHOCK_COLLAR_PAIR_SCHEMA_VERSION = 1 as const

export interface ShockCollarPairStateV1 {
  readonly schemaVersion: typeof SHOCK_COLLAR_PAIR_SCHEMA_VERSION
  readonly role: 'remote' | 'collar'
  readonly pairId: string
  readonly groundCapable: boolean
}

const STABLE_ID = /^[A-Za-z0-9]+(?:[._:/-][A-Za-z0-9]+)*$/u

/** Fail-closed parser for the private paired components of one purchased collar set. */
export const parseShockCollarPairState = (value: unknown): ShockCollarPairStateV1 | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const input = value as Record<string, unknown>
  const raw = input.shockCollarPair
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const pair = raw as Record<string, unknown>
  if (Object.keys(pair).sort().join(',') !== 'groundCapable,pairId,role,schemaVersion'
    || pair.schemaVersion !== 1
    || (pair.role !== 'remote' && pair.role !== 'collar')
    || typeof pair.pairId !== 'string'
    || pair.pairId.length > 180
    || !STABLE_ID.test(pair.pairId)
    || typeof pair.groundCapable !== 'boolean') return null
  return Object.freeze({
    schemaVersion: 1,
    role: pair.role,
    pairId: pair.pairId,
    groundCapable: pair.groundCapable,
  })
}

export const ATTACK_OF_OPPORTUNITY_METADATA_KEY = 'attackOfOpportunity' as const
export const ATTACK_OF_OPPORTUNITY_STATE_SCHEMA_VERSION = 1 as const

export type AttackOfOpportunityReason = 'movement' | 'ranged-attack'

export interface AttackOfOpportunityPromptRecord {
  readonly id: string
  readonly attackerId: string
  readonly attackerName: string
  readonly provokerId: string
  readonly provokerName: string
  readonly reason: AttackOfOpportunityReason
  readonly round: number | null
}

export type AttackOfOpportunityUsedRoundByAttackerId = Record<string, number | null>

export interface AttackOfOpportunityState {
  readonly schemaVersion: typeof ATTACK_OF_OPPORTUNITY_STATE_SCHEMA_VERSION
  readonly prompts: readonly AttackOfOpportunityPromptRecord[]
  readonly usedRoundByAttackerId: AttackOfOpportunityUsedRoundByAttackerId
}

export type AttackOfOpportunityStateUpdatePayload =
  | { readonly action: 'queue'; readonly records: readonly AttackOfOpportunityPromptRecord[] }
  | { readonly action: 'clear-prompt'; readonly promptId: string }
  | { readonly action: 'clear-all'; readonly actorId?: string }
  | { readonly action: 'mark-attacker-used'; readonly attackerId: string; readonly round?: number | null }

const ATTACK_OF_OPPORTUNITY_REASONS = new Set<unknown>(['movement', 'ranged-attack'])

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const nonEmptyString = (value: unknown): value is string => (
  typeof value === 'string' && value.trim().length > 0
)

const normalizeRound = (value: unknown): number | null => (
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null
)

const normalizeOptionalRound = (value: unknown): number | null | undefined => (
  value === undefined ? undefined : normalizeRound(value)
)

export const emptyAttackOfOpportunityState = (): AttackOfOpportunityState => ({
  schemaVersion: ATTACK_OF_OPPORTUNITY_STATE_SCHEMA_VERSION,
  prompts: [],
  usedRoundByAttackerId: {},
})

export const normalizeAttackOfOpportunityPromptRecord = (
  value: unknown,
): AttackOfOpportunityPromptRecord | null => {
  if (!isRecord(value)) return null
  if (!nonEmptyString(value.id)) return null
  if (!nonEmptyString(value.attackerId)) return null
  if (!nonEmptyString(value.attackerName)) return null
  if (!nonEmptyString(value.provokerId)) return null
  if (!nonEmptyString(value.provokerName)) return null
  if (!ATTACK_OF_OPPORTUNITY_REASONS.has(value.reason)) return null

  return {
    id: value.id,
    attackerId: value.attackerId,
    attackerName: value.attackerName,
    provokerId: value.provokerId,
    provokerName: value.provokerName,
    reason: value.reason as AttackOfOpportunityReason,
    round: normalizeRound(value.round),
  }
}

const normalizeUsedRoundByAttackerId = (value: unknown): AttackOfOpportunityUsedRoundByAttackerId => {
  if (!isRecord(value)) return {}

  const out: AttackOfOpportunityUsedRoundByAttackerId = {}
  for (const [attackerId, round] of Object.entries(value)) {
    if (!nonEmptyString(attackerId)) continue
    out[attackerId] = normalizeRound(round)
  }
  return out
}

export const normalizeAttackOfOpportunityState = (value: unknown): AttackOfOpportunityState => {
  if (!isRecord(value)) return emptyAttackOfOpportunityState()

  const seenPromptIds = new Set<string>()
  const prompts = (Array.isArray(value.prompts) ? value.prompts : [])
    .map(normalizeAttackOfOpportunityPromptRecord)
    .filter((record): record is AttackOfOpportunityPromptRecord => record !== null)
    .filter((record) => {
      if (seenPromptIds.has(record.id)) return false
      seenPromptIds.add(record.id)
      return true
    })

  return {
    schemaVersion: ATTACK_OF_OPPORTUNITY_STATE_SCHEMA_VERSION,
    prompts,
    usedRoundByAttackerId: normalizeUsedRoundByAttackerId(value.usedRoundByAttackerId),
  }
}

export const readAttackOfOpportunityState = (
  metadata: Record<string, unknown> | null | undefined,
): AttackOfOpportunityState => normalizeAttackOfOpportunityState(metadata?.[ATTACK_OF_OPPORTUNITY_METADATA_KEY])

const attackOfOpportunityStateIsEmpty = (state: AttackOfOpportunityState): boolean => (
  state.prompts.length === 0 && Object.keys(state.usedRoundByAttackerId).length === 0
)

export const writeAttackOfOpportunityState = (
  metadata: Record<string, unknown> | null | undefined,
  state: AttackOfOpportunityState,
): Record<string, unknown> => {
  const normalized = normalizeAttackOfOpportunityState(state)
  const next = { ...(metadata ?? {}) }
  if (attackOfOpportunityStateIsEmpty(normalized)) delete next[ATTACK_OF_OPPORTUNITY_METADATA_KEY]
  else next[ATTACK_OF_OPPORTUNITY_METADATA_KEY] = normalized
  return next
}

export const attackOfOpportunityStatesEqual = (
  left: AttackOfOpportunityState,
  right: AttackOfOpportunityState,
): boolean => JSON.stringify(normalizeAttackOfOpportunityState(left)) === JSON.stringify(normalizeAttackOfOpportunityState(right))

export const normalizeAttackOfOpportunityStateUpdatePayload = (
  payload: unknown,
): AttackOfOpportunityStateUpdatePayload | null => {
  if (!isRecord(payload)) return null

  if (payload.action === 'queue') {
    if (!Array.isArray(payload.records)) return null
    const records = payload.records
      .map(normalizeAttackOfOpportunityPromptRecord)
      .filter((record): record is AttackOfOpportunityPromptRecord => record !== null)
    if (records.length !== payload.records.length) return null
    return { action: 'queue', records }
  }

  if (payload.action === 'clear-prompt') {
    if (!nonEmptyString(payload.promptId)) return null
    return { action: 'clear-prompt', promptId: payload.promptId }
  }

  if (payload.action === 'clear-all') {
    if (payload.actorId !== undefined && !nonEmptyString(payload.actorId)) return null
    return {
      action: 'clear-all',
      ...(payload.actorId === undefined ? {} : { actorId: payload.actorId }),
    }
  }

  if (payload.action === 'mark-attacker-used') {
    if (!nonEmptyString(payload.attackerId)) return null
    return {
      action: 'mark-attacker-used',
      attackerId: payload.attackerId,
      ...(payload.round === undefined ? {} : { round: normalizeOptionalRound(payload.round) }),
    }
  }

  return null
}

export const applyAttackOfOpportunityStateUpdate = (
  state: AttackOfOpportunityState,
  payload: AttackOfOpportunityStateUpdatePayload,
): AttackOfOpportunityState => {
  const current = normalizeAttackOfOpportunityState(state)

  if (payload.action === 'queue') {
    const promptsById = new Map(current.prompts.map((prompt) => [prompt.id, prompt]))
    for (const record of payload.records) {
      const normalized = normalizeAttackOfOpportunityPromptRecord(record)
      if (normalized) promptsById.set(normalized.id, normalized)
    }
    return {
      ...current,
      prompts: [...promptsById.values()],
    }
  }

  if (payload.action === 'clear-prompt') {
    return {
      ...current,
      prompts: current.prompts.filter((prompt) => prompt.id !== payload.promptId),
    }
  }

  if (payload.action === 'clear-all') {
    return {
      ...current,
      prompts: [],
    }
  }

  return {
    ...current,
    prompts: current.prompts.filter((prompt) => prompt.attackerId !== payload.attackerId),
    usedRoundByAttackerId: {
      ...current.usedRoundByAttackerId,
      [payload.attackerId]: payload.round ?? null,
    },
  }
}

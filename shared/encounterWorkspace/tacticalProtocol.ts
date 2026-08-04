export const ENCOUNTER_TACTICAL_MESSAGE_CHANNEL = 'rotom-encounter-tactical-v1' as const
export const ENCOUNTER_TACTICAL_TARGET_LIMIT = 64 as const

export interface EncounterTacticalAdoptionMessage {
  readonly channel: typeof ENCOUNTER_TACTICAL_MESSAGE_CHANNEL
  readonly type: 'adopt'
  readonly mapSlug: string
  readonly mapRevision: number
  readonly selectedParticipantId: string | null
  readonly actionOfferId: string | null
  readonly selectedTargetIds: readonly string[]
}

export type EncounterTacticalChildMessage =
  | {
      readonly channel: typeof ENCOUNTER_TACTICAL_MESSAGE_CHANNEL
      readonly type: 'ready' | 'revision'
      readonly mapSlug: string
      readonly mapRevision: number
    }
  | {
      readonly channel: typeof ENCOUNTER_TACTICAL_MESSAGE_CHANNEL
      readonly type: 'selection'
      readonly mapSlug: string
      readonly participantId: string | null
    }
  | {
      readonly channel: typeof ENCOUNTER_TACTICAL_MESSAGE_CHANNEL
      readonly type: 'close'
      readonly mapSlug: string
    }

export type EncounterTacticalChildMessageInput =
  | { readonly type: 'ready' | 'revision', readonly mapSlug: string, readonly mapRevision: number }
  | { readonly type: 'selection', readonly mapSlug: string, readonly participantId: string | null }
  | { readonly type: 'close', readonly mapSlug: string }

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)
const safeId = (value: unknown): value is string => (
  typeof value === 'string'
  && value.length > 0
  && value.length <= 200
  && !/[\u0000-\u001f\u007f]/.test(value)
)
const nullableId = (value: unknown): value is string | null => value === null || safeId(value)
const revision = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0
const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const expected = new Set(keys)
  return Object.keys(value).length === expected.size && Object.keys(value).every(key => expected.has(key))
}

export const createEncounterTacticalAdoptionMessage = (input: {
  readonly mapSlug: string
  readonly mapRevision: number
  readonly selectedParticipantId: string | null
  readonly actionOfferId: string | null
  readonly selectedTargetIds: readonly string[]
}): EncounterTacticalAdoptionMessage => {
  if (!safeId(input.mapSlug) || !revision(input.mapRevision)
    || !nullableId(input.selectedParticipantId) || !nullableId(input.actionOfferId)) {
    throw new Error('Encounter tactical adoption identity is invalid.')
  }
  const selectedTargetIds = [...new Set(input.selectedTargetIds)]
  if (selectedTargetIds.length > ENCOUNTER_TACTICAL_TARGET_LIMIT || !selectedTargetIds.every(safeId)) {
    throw new Error('Encounter tactical target identities are invalid or exceed the limit.')
  }
  return Object.freeze({
    channel: ENCOUNTER_TACTICAL_MESSAGE_CHANNEL,
    type: 'adopt',
    mapSlug: input.mapSlug,
    mapRevision: input.mapRevision,
    selectedParticipantId: input.selectedParticipantId,
    actionOfferId: input.actionOfferId,
    selectedTargetIds: Object.freeze(selectedTargetIds),
  })
}

export const parseEncounterTacticalAdoptionMessage = (
  value: unknown,
): EncounterTacticalAdoptionMessage | null => {
  if (!isRecord(value) || !hasExactKeys(value, [
    'channel', 'type', 'mapSlug', 'mapRevision', 'selectedParticipantId', 'actionOfferId', 'selectedTargetIds',
  ])) return null
  if (value.channel !== ENCOUNTER_TACTICAL_MESSAGE_CHANNEL || value.type !== 'adopt'
    || !safeId(value.mapSlug) || !revision(value.mapRevision)
    || !nullableId(value.selectedParticipantId) || !nullableId(value.actionOfferId)
    || !Array.isArray(value.selectedTargetIds)
    || value.selectedTargetIds.length > ENCOUNTER_TACTICAL_TARGET_LIMIT
    || !value.selectedTargetIds.every(safeId)
    || new Set(value.selectedTargetIds).size !== value.selectedTargetIds.length) return null
  return Object.freeze({
    channel: ENCOUNTER_TACTICAL_MESSAGE_CHANNEL,
    type: 'adopt',
    mapSlug: value.mapSlug,
    mapRevision: value.mapRevision,
    selectedParticipantId: value.selectedParticipantId,
    actionOfferId: value.actionOfferId,
    selectedTargetIds: Object.freeze([...value.selectedTargetIds]),
  })
}

export const parseEncounterTacticalChildMessage = (
  value: unknown,
): EncounterTacticalChildMessage | null => {
  if (!isRecord(value) || value.channel !== ENCOUNTER_TACTICAL_MESSAGE_CHANNEL || !safeId(value.mapSlug)) return null
  if (value.type === 'ready' || value.type === 'revision') {
    if (!hasExactKeys(value, ['channel', 'type', 'mapSlug', 'mapRevision']) || !revision(value.mapRevision)) return null
    return Object.freeze({ channel: ENCOUNTER_TACTICAL_MESSAGE_CHANNEL, type: value.type, mapSlug: value.mapSlug, mapRevision: value.mapRevision })
  }
  if (value.type === 'selection') {
    if (!hasExactKeys(value, ['channel', 'type', 'mapSlug', 'participantId']) || !nullableId(value.participantId)) return null
    return Object.freeze({ channel: ENCOUNTER_TACTICAL_MESSAGE_CHANNEL, type: 'selection', mapSlug: value.mapSlug, participantId: value.participantId })
  }
  if (value.type === 'close' && hasExactKeys(value, ['channel', 'type', 'mapSlug'])) {
    return Object.freeze({ channel: ENCOUNTER_TACTICAL_MESSAGE_CHANNEL, type: 'close', mapSlug: value.mapSlug })
  }
  return null
}

export const createEncounterTacticalChildMessage = (
  message: EncounterTacticalChildMessageInput,
): EncounterTacticalChildMessage => {
  const parsed = parseEncounterTacticalChildMessage({ channel: ENCOUNTER_TACTICAL_MESSAGE_CHANNEL, ...message })
  if (!parsed) throw new Error('Encounter tactical child message is invalid.')
  return parsed
}

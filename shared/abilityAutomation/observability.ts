export const ABILITY_AUTOMATION_OBSERVATION_SCHEMA_VERSION = 1 as const

export const ABILITY_AUTOMATION_OBSERVATION_EVENTS = [
  'declaration-offered',
  'resolution-committed',
  'resolution-pending',
  'request-rejected',
] as const

export const ABILITY_AUTOMATION_OBSERVATION_REASON_FAMILIES = [
  'none',
  'invalid',
  'unauthorized',
  'unavailable',
  'conflict',
  'internal',
] as const

export const ABILITY_AUTOMATION_OBSERVATION_COUNT_BUCKETS = [
  '0', '1', '2-4', '5-16', '17-64', '65+',
] as const
export const ABILITY_AUTOMATION_OBSERVATION_DURATION_BUCKETS = [
  'under-10ms', '10-49ms', '50-249ms', '250-999ms', '1000ms-plus',
] as const

export type AbilityAutomationObservationEvent =
  (typeof ABILITY_AUTOMATION_OBSERVATION_EVENTS)[number]
export type AbilityAutomationObservationReasonFamily =
  (typeof ABILITY_AUTOMATION_OBSERVATION_REASON_FAMILIES)[number]
export type AbilityAutomationObservationCountBucket =
  (typeof ABILITY_AUTOMATION_OBSERVATION_COUNT_BUCKETS)[number]
export type AbilityAutomationObservationDurationBucket =
  (typeof ABILITY_AUTOMATION_OBSERVATION_DURATION_BUCKETS)[number]

export interface AbilityAutomationObservation {
  readonly schemaVersion: typeof ABILITY_AUTOMATION_OBSERVATION_SCHEMA_VERSION
  readonly event: AbilityAutomationObservationEvent
  readonly reasonFamily: AbilityAutomationObservationReasonFamily
  readonly duration: AbilityAutomationObservationDurationBucket
  readonly declarations: AbilityAutomationObservationCountBucket
  readonly options: AbilityAutomationObservationCountBucket
  readonly outstandingWindows: AbilityAutomationObservationCountBucket
}

export interface AbilityAutomationObservationInput {
  readonly event: AbilityAutomationObservationEvent
  readonly reasonFamily?: AbilityAutomationObservationReasonFamily
  readonly durationMs: number
  readonly declarationCount?: number
  readonly optionCount?: number
  readonly outstandingWindowCount?: number
}

const boundedCount = (value: number | undefined): number => {
  if (value === undefined) return 0
  if (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000) {
    throw new Error('Ability automation observation counts must be bounded non-negative integers.')
  }
  return value
}

const countBucket = (value: number | undefined): AbilityAutomationObservationCountBucket => {
  const count = boundedCount(value)
  if (count === 0) return '0'
  if (count === 1) return '1'
  if (count <= 4) return '2-4'
  if (count <= 16) return '5-16'
  if (count <= 64) return '17-64'
  return '65+'
}

const durationBucket = (value: number): AbilityAutomationObservationDurationBucket => {
  if (!Number.isFinite(value) || value < 0 || value > 86_400_000) {
    throw new Error('Ability automation observation duration must be bounded.')
  }
  if (value < 10) return 'under-10ms'
  if (value < 50) return '10-49ms'
  if (value < 250) return '50-249ms'
  if (value < 1_000) return '250-999ms'
  return '1000ms-plus'
}

/**
 * Produce an aggregate-only record. There is deliberately no field for map,
 * actor, ability, responder, option identity, roll, operation, or trace data.
 */
export const projectAbilityAutomationObservation = (
  input: AbilityAutomationObservationInput,
): AbilityAutomationObservation => {
  if (!ABILITY_AUTOMATION_OBSERVATION_EVENTS.includes(input.event)) {
    throw new Error('Ability automation observation event is unsupported.')
  }
  const reasonFamily = input.reasonFamily ?? 'none'
  if (!ABILITY_AUTOMATION_OBSERVATION_REASON_FAMILIES.includes(reasonFamily)) {
    throw new Error('Ability automation observation reason family is unsupported.')
  }
  if (input.event === 'request-rejected' && reasonFamily === 'none') {
    throw new Error('Rejected ability observations require a bounded reason family.')
  }
  if (input.event !== 'request-rejected' && reasonFamily !== 'none') {
    throw new Error('Successful ability observations cannot carry a rejection reason.')
  }
  return Object.freeze({
    schemaVersion: ABILITY_AUTOMATION_OBSERVATION_SCHEMA_VERSION,
    event: input.event,
    reasonFamily,
    duration: durationBucket(input.durationMs),
    declarations: countBucket(input.declarationCount),
    options: countBucket(input.optionCount),
    outstandingWindows: countBucket(input.outstandingWindowCount),
  })
}

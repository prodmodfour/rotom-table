import { isSlug } from '../paths'
import {
  parseBreedingOperationIdSyntax,
  parsePokemonEggIdSyntax,
  type BreedingOperationId,
  type PokemonEggId,
} from './ids'
import type { PokemonEggReadinessKind, PokemonEggStatus } from './egg'

export const BREEDING_INCUBATION_PROJECTION_AUDIENCES = Object.freeze(['gm', 'owner'] as const)
export type BreedingIncubationProjectionAudience = typeof BREEDING_INCUBATION_PROJECTION_AUDIENCES[number]

export const BREEDING_INCUBATION_PAUSE_REASON_IDS = Object.freeze([
  'breeding.incubation-pause.campaign-rule',
  'breeding.incubation-pause.gm-maintenance',
  'breeding.incubation-pause.owner-request',
] as const)
export type BreedingIncubationPauseReasonId = typeof BREEDING_INCUBATION_PAUSE_REASON_IDS[number]

export const BREEDING_INCUBATION_MODIFIER_PROVIDER_KINDS = Object.freeze(['capability', 'facility', 'item'] as const)
export type BreedingIncubationModifierProviderKind = typeof BREEDING_INCUBATION_MODIFIER_PROVIDER_KINDS[number]

/**
 * Server-owned contribution envelope reserved for the BR-061/BR-062 provider
 * integrations. BR-050 parses and hash-checks this shape but executes only an
 * empty contribution set.
 */
export interface BreedingIncubationModifierContributionV1 {
  readonly schemaVersion: 1
  readonly providerKind: BreedingIncubationModifierProviderKind
  readonly providerId: string
  readonly checkpoint: 'continuous'
  readonly effect: 'progress-rate-multiplier'
  readonly numerator: number
  readonly denominator: number
  readonly subjectKind: 'pokemon-egg' | 'trainer-sheet'
  readonly subjectId: string
  readonly subjectRevision: number
  readonly providerDefinitionSha256: string
  readonly effectiveEvidenceSha256: string
  readonly definitionSha256: string
}

export interface BreedingIncubationProgressProjectionV1 {
  readonly schemaVersion: 1
  readonly audience: BreedingIncubationProjectionAudience
  readonly eggId: PokemonEggId
  readonly revision: number
  readonly status: PokemonEggStatus
  readonly targetCampaignMinutes: number
  readonly accumulatedCampaignMinutes: number
  readonly remainingCampaignMinutes: number
  readonly progressBasisPoints: number
  readonly paused: boolean
  readonly readyAtCampaignMinute: number | null
  readonly readinessKind: PokemonEggReadinessKind | null
  readonly lastAppliedClockRevision: number
  readonly lastAppliedClockMinute: number
  readonly modifierMode: 'base-rate-only' | 'authoritative-rate'
  readonly availableActions: readonly ('advance-egg-incubation' | 'set-egg-incubation-pause' | 'mark-egg-ready')[]
  readonly generatedAtCampaignMinute: number
}

export interface BreedingIncubationSegmentResultV1 {
  readonly schemaVersion: 1
  readonly operationId: BreedingOperationId
  readonly commandKind: 'advance-egg-incubation' | 'set-egg-incubation-pause'
  readonly eggId: PokemonEggId
  readonly eggRevisionBefore: number
  readonly eggRevisionAfter: number
  readonly fromClockRevision: number
  readonly fromCampaignMinute: number
  readonly throughClockRevision: number
  readonly throughCampaignMinute: number
  readonly elapsedCampaignMinutes: number
  readonly creditedCampaignMinutes: number
  readonly skippedCampaignMinutes: number
  readonly overflowCampaignMinutes: number
  readonly targetCampaignMinutes: number
  readonly accumulatedBeforeCampaignMinutes: number
  readonly accumulatedAfterCampaignMinutes: number
  readonly reachedReady: boolean
  readonly readyAtCampaignMinute: number | null
  readonly pausedDuringSegment: boolean
  readonly pauseMutation: 'none' | 'paused' | 'resumed'
  readonly modifierMode: 'base-rate-only' | 'authoritative-rate'
  readonly definitionSha256: string
}

export type BreedingIncubationValidationCode =
  | 'breeding.incubation.invalid-document'
  | 'breeding.incubation.unknown-field'
  | 'breeding.incubation.invalid-id'
  | 'breeding.incubation.invalid-invariant'

export class BreedingIncubationValidationError extends Error {
  readonly code: BreedingIncubationValidationCode
  readonly path: string

  constructor(code: BreedingIncubationValidationCode, path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'BreedingIncubationValidationError'
    this.code = code
    this.path = path
  }
}

type UnknownRecord = Record<string, unknown>
const SHA256 = /^[0-9a-f]{64}$/
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/
const EGG_STATUSES = new Set<string>([
  'incubating', 'ready', 'awaiting-special-adjudication', 'hatching', 'hatched', 'cancelled', 'invalidated-by-gm',
])
const READY_REQUIRED_STATUSES = new Set<string>(['ready', 'awaiting-special-adjudication', 'hatching', 'hatched'])

const fail = (code: BreedingIncubationValidationCode, path: string, message: string): never => {
  throw new BreedingIncubationValidationError(code, path, message)
}
const record = (value: unknown, path: string): UnknownRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fail('breeding.incubation.invalid-document', path, 'must be a plain object.')
  }
  const prototype = Object.getPrototypeOf(value)
  if ((prototype !== Object.prototype && prototype !== null) || Object.getOwnPropertySymbols(value).length > 0) {
    return fail('breeding.incubation.invalid-document', path, 'must be a plain data object without symbols.')
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      fail('breeding.incubation.invalid-document', `${path}.${key}`, 'must be an enumerable data field.')
    }
  }
  return value as UnknownRecord
}
const exact = (value: unknown, fields: readonly string[], path: string): UnknownRecord => {
  const row = record(value, path)
  const allowed = new Set(fields)
  if (fields.some(field => !Object.hasOwn(row, field)) || Object.keys(row).some(field => !allowed.has(field))) {
    fail('breeding.incubation.unknown-field', path, 'must contain exactly the declared fields.')
  }
  return row
}
const integer = (value: unknown, path: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number => (
  Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum
    ? value as number
    : fail('breeding.incubation.invalid-document', path, `must be a safe integer from ${minimum} through ${maximum}.`)
)
const identifier = (value: unknown, path: string): string => (
  typeof value === 'string' && IDENTIFIER.test(value)
    ? value
    : fail('breeding.incubation.invalid-id', path, 'must be a bounded stable identifier.')
)
const hash = (value: unknown, path: string): string => (
  typeof value === 'string' && SHA256.test(value)
    ? value
    : fail('breeding.incubation.invalid-document', path, 'must be a lowercase SHA-256 value.')
)
const freeze = <Value>(value: Value): Value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child)
    Object.freeze(value)
  }
  return value
}
const strictArray = (value: unknown, path: string, maximum: number): unknown[] => {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
    || value.length > maximum || Object.getOwnPropertySymbols(value).length > 0) {
    return fail('breeding.incubation.invalid-document', path, `must be a strict array of at most ${maximum} entries.`)
  }
  const names = Object.getOwnPropertyNames(value)
  if (names.length !== value.length + 1
    || names.some(key => key !== 'length' && !/^(0|[1-9][0-9]*)$/.test(key))) {
    return fail('breeding.incubation.invalid-document', path, `must be a strict array of at most ${maximum} entries.`)
  }
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      fail('breeding.incubation.invalid-document', `${path}[${index}]`, 'must be an enumerable data entry.')
    }
  }
  return value
}

export const parseBreedingIncubationModifierContributionV1 = (
  value: unknown,
  path = 'modifierContribution',
): BreedingIncubationModifierContributionV1 => {
  const row = exact(value, [
    'schemaVersion', 'providerKind', 'providerId', 'checkpoint', 'effect', 'numerator', 'denominator',
    'subjectKind', 'subjectId', 'subjectRevision', 'providerDefinitionSha256', 'effectiveEvidenceSha256',
    'definitionSha256',
  ], path)
  if (row.schemaVersion !== 1
    || (row.providerKind !== 'item' && row.providerKind !== 'capability' && row.providerKind !== 'facility')
    || row.checkpoint !== 'continuous' || row.effect !== 'progress-rate-multiplier'
    || (row.subjectKind !== 'pokemon-egg' && row.subjectKind !== 'trainer-sheet')) {
    fail('breeding.incubation.invalid-document', path, 'must be a v1 continuous incubation modifier contribution.')
  }
  const subjectId = row.subjectKind === 'pokemon-egg'
    ? parsePokemonEggIdSyntax(row.subjectId) ?? fail('breeding.incubation.invalid-id', `${path}.subjectId`, 'must be an Egg ID.')
    : isSlug(row.subjectId) && row.subjectId.length <= 160
      ? row.subjectId
      : fail('breeding.incubation.invalid-id', `${path}.subjectId`, 'must be a bounded Trainer slug.')
  return freeze({
    schemaVersion: 1,
    providerKind: row.providerKind,
    providerId: identifier(row.providerId, `${path}.providerId`),
    checkpoint: 'continuous',
    effect: 'progress-rate-multiplier',
    numerator: integer(row.numerator, `${path}.numerator`, 1, 100),
    denominator: integer(row.denominator, `${path}.denominator`, 1, 100),
    subjectKind: row.subjectKind,
    subjectId,
    subjectRevision: integer(row.subjectRevision, `${path}.subjectRevision`, 0, 2_147_483_647),
    providerDefinitionSha256: hash(row.providerDefinitionSha256, `${path}.providerDefinitionSha256`),
    effectiveEvidenceSha256: hash(row.effectiveEvidenceSha256, `${path}.effectiveEvidenceSha256`),
    definitionSha256: hash(row.definitionSha256, `${path}.definitionSha256`),
  }) as BreedingIncubationModifierContributionV1
}

export const parseBreedingIncubationModifierContributionsV1 = (
  value: unknown,
  path = 'modifierContributions',
): readonly BreedingIncubationModifierContributionV1[] => {
  const values = strictArray(value, path, 16).map((entry, index) => (
    parseBreedingIncubationModifierContributionV1(entry, `${path}[${index}]`)
  ))
  const keys = values.map(entry => `${entry.providerKind}\u0000${entry.providerId}\u0000${entry.subjectKind}\u0000${entry.subjectId}`)
  for (let index = 1; index < keys.length; index += 1) {
    if (keys[index - 1]! >= keys[index]!) {
      fail('breeding.incubation.invalid-invariant', path, 'must be unique in provider and subject order.')
    }
  }
  return Object.freeze(values)
}

export const parseBreedingIncubationProgressProjectionV1 = (
  value: unknown,
  path = 'projection',
): BreedingIncubationProgressProjectionV1 => {
  const row = exact(value, [
    'schemaVersion', 'audience', 'eggId', 'revision', 'status', 'targetCampaignMinutes',
    'accumulatedCampaignMinutes', 'remainingCampaignMinutes', 'progressBasisPoints', 'paused',
    'readyAtCampaignMinute', 'readinessKind', 'lastAppliedClockRevision', 'lastAppliedClockMinute',
    'modifierMode', 'availableActions', 'generatedAtCampaignMinute',
  ], path)
  if (row.schemaVersion !== 1 || (row.audience !== 'gm' && row.audience !== 'owner')
    || typeof row.status !== 'string' || !EGG_STATUSES.has(row.status) || typeof row.paused !== 'boolean'
    || (row.modifierMode !== 'base-rate-only' && row.modifierMode !== 'authoritative-rate')
    || (row.readinessKind !== null && row.readinessKind !== 'incubation-complete' && row.readinessKind !== 'gm-mark-ready')) {
    fail('breeding.incubation.invalid-document', path, 'must be a v1 owner or GM incubation projection.')
  }
  const status = row.status as PokemonEggStatus
  const target = integer(row.targetCampaignMinutes, `${path}.targetCampaignMinutes`, 1, 31_536_000)
  const accumulated = integer(row.accumulatedCampaignMinutes, `${path}.accumulatedCampaignMinutes`, 0, target)
  const remaining = integer(row.remainingCampaignMinutes, `${path}.remainingCampaignMinutes`, 0, target)
  const basisPoints = integer(row.progressBasisPoints, `${path}.progressBasisPoints`, 0, 10_000)
  const readyAt = row.readyAtCampaignMinute === null
    ? null
    : integer(row.readyAtCampaignMinute, `${path}.readyAtCampaignMinute`)
  const actions = strictArray(row.availableActions, `${path}.availableActions`, 3).map((entry, index) => (
    entry === 'advance-egg-incubation' || entry === 'set-egg-incubation-pause' || entry === 'mark-egg-ready'
      ? entry
      : fail('breeding.incubation.invalid-document', `${path}.availableActions[${index}]`, 'must be an incubation action.')
  ))
  const expectedActions = status === 'incubating'
    ? [
        'advance-egg-incubation',
        'set-egg-incubation-pause',
        ...(row.audience === 'gm' && !row.paused ? ['mark-egg-ready'] : []),
      ]
    : []
  const ready = readyAt !== null
  if (accumulated + remaining !== target || basisPoints !== Math.floor(accumulated * 10_000 / target)
    || ready !== (row.readinessKind !== null)
    || (status === 'incubating' && ready)
    || (READY_REQUIRED_STATUSES.has(status) && !ready)
    || (row.paused && status !== 'incubating')
    || JSON.stringify(actions) !== JSON.stringify(expectedActions)
    || integer(row.generatedAtCampaignMinute, `${path}.generatedAtCampaignMinute`) < integer(row.lastAppliedClockMinute, `${path}.lastAppliedClockMinute`)) {
    fail('breeding.incubation.invalid-invariant', path, 'totals, readiness, status, pause, clock, and canonical actions must agree.')
  }
  return freeze({
    schemaVersion: 1,
    audience: row.audience,
    eggId: parsePokemonEggIdSyntax(row.eggId)
      ?? fail('breeding.incubation.invalid-id', `${path}.eggId`, 'must be an Egg ID.'),
    revision: integer(row.revision, `${path}.revision`, 0, 2_147_483_647),
    status,
    targetCampaignMinutes: target,
    accumulatedCampaignMinutes: accumulated,
    remainingCampaignMinutes: remaining,
    progressBasisPoints: basisPoints,
    paused: row.paused,
    readyAtCampaignMinute: readyAt,
    readinessKind: row.readinessKind,
    lastAppliedClockRevision: integer(row.lastAppliedClockRevision, `${path}.lastAppliedClockRevision`, 0, 2_147_483_647),
    lastAppliedClockMinute: row.lastAppliedClockMinute as number,
    modifierMode: row.modifierMode,
    availableActions: Object.freeze(actions),
    generatedAtCampaignMinute: row.generatedAtCampaignMinute as number,
  }) as BreedingIncubationProgressProjectionV1
}

export const parseBreedingIncubationSegmentResultV1 = (
  value: unknown,
  path = 'segmentResult',
): BreedingIncubationSegmentResultV1 => {
  const row = exact(value, [
    'schemaVersion', 'operationId', 'commandKind', 'eggId', 'eggRevisionBefore', 'eggRevisionAfter',
    'fromClockRevision', 'fromCampaignMinute', 'throughClockRevision', 'throughCampaignMinute',
    'elapsedCampaignMinutes', 'creditedCampaignMinutes', 'skippedCampaignMinutes', 'overflowCampaignMinutes',
    'targetCampaignMinutes', 'accumulatedBeforeCampaignMinutes', 'accumulatedAfterCampaignMinutes',
    'reachedReady', 'readyAtCampaignMinute', 'pausedDuringSegment', 'pauseMutation', 'modifierMode',
    'definitionSha256',
  ], path)
  if (row.schemaVersion !== 1
    || (row.commandKind !== 'advance-egg-incubation' && row.commandKind !== 'set-egg-incubation-pause')
    || typeof row.reachedReady !== 'boolean' || typeof row.pausedDuringSegment !== 'boolean'
    || (row.pauseMutation !== 'none' && row.pauseMutation !== 'paused' && row.pauseMutation !== 'resumed')
    || (row.modifierMode !== 'base-rate-only' && row.modifierMode !== 'authoritative-rate')) {
    fail('breeding.incubation.invalid-document', path, 'must be a v1 incubation segment result.')
  }
  const beforeRevision = integer(row.eggRevisionBefore, `${path}.eggRevisionBefore`, 0, 2_147_483_646)
  const afterRevision = integer(row.eggRevisionAfter, `${path}.eggRevisionAfter`, 1, 2_147_483_647)
  const fromClockRevision = integer(row.fromClockRevision, `${path}.fromClockRevision`, 0, 2_147_483_647)
  const throughClockRevision = integer(row.throughClockRevision, `${path}.throughClockRevision`, 0, 2_147_483_647)
  const fromMinute = integer(row.fromCampaignMinute, `${path}.fromCampaignMinute`)
  const throughMinute = integer(row.throughCampaignMinute, `${path}.throughCampaignMinute`)
  const elapsed = integer(row.elapsedCampaignMinutes, `${path}.elapsedCampaignMinutes`)
  const credited = integer(row.creditedCampaignMinutes, `${path}.creditedCampaignMinutes`)
  const skipped = integer(row.skippedCampaignMinutes, `${path}.skippedCampaignMinutes`)
  const overflow = integer(row.overflowCampaignMinutes, `${path}.overflowCampaignMinutes`)
  const target = integer(row.targetCampaignMinutes, `${path}.targetCampaignMinutes`, 1, 31_536_000)
  const accumulatedBefore = integer(row.accumulatedBeforeCampaignMinutes, `${path}.accumulatedBeforeCampaignMinutes`, 0, target)
  const accumulatedAfter = integer(row.accumulatedAfterCampaignMinutes, `${path}.accumulatedAfterCampaignMinutes`, 0, target)
  const readyAt = row.readyAtCampaignMinute === null
    ? null
    : integer(row.readyAtCampaignMinute, `${path}.readyAtCampaignMinute`)
  const clockAdvanced = throughClockRevision > fromClockRevision && throughMinute > fromMinute
  const sameClock = throughClockRevision === fromClockRevision && throughMinute === fromMinute
  const rateNumerator = row.modifierMode === 'authoritative-rate' ? 2 : 1
  const expectedProgress = row.pausedDuringSegment ? 0 : elapsed * rateNumerator
  const expectedReadyMinute = readyAt === null ? null : fromMinute + Math.ceil((target - accumulatedBefore) / rateNumerator)
  if (afterRevision !== beforeRevision + 1 || (!clockAdvanced && !sameClock)
    || (row.commandKind === 'advance-egg-incubation' && !clockAdvanced)
    || elapsed !== throughMinute - fromMinute || expectedProgress !== credited + overflow
    || skipped !== (row.pausedDuringSegment ? elapsed : 0)
    || accumulatedAfter !== accumulatedBefore + credited
    || (row.pausedDuringSegment !== (skipped === elapsed && elapsed > 0) && elapsed > 0)
    || (row.reachedReady !== (accumulatedAfter === target))
    || row.reachedReady !== (readyAt !== null)
    || (overflow > 0 && !row.reachedReady)
    || readyAt !== expectedReadyMinute
    || (row.commandKind === 'advance-egg-incubation') !== (row.pauseMutation === 'none')
    || (row.commandKind === 'set-egg-incubation-pause' && row.reachedReady)) {
    fail('breeding.incubation.invalid-invariant', path, 'revision, clock, credit, skip, overflow, readiness, and pause facts must agree.')
  }
  return freeze({
    schemaVersion: 1,
    operationId: parseBreedingOperationIdSyntax(row.operationId)
      ?? fail('breeding.incubation.invalid-id', `${path}.operationId`, 'must be an operation ID.'),
    commandKind: row.commandKind,
    eggId: parsePokemonEggIdSyntax(row.eggId)
      ?? fail('breeding.incubation.invalid-id', `${path}.eggId`, 'must be an Egg ID.'),
    eggRevisionBefore: beforeRevision,
    eggRevisionAfter: afterRevision,
    fromClockRevision,
    fromCampaignMinute: fromMinute,
    throughClockRevision,
    throughCampaignMinute: throughMinute,
    elapsedCampaignMinutes: elapsed,
    creditedCampaignMinutes: credited,
    skippedCampaignMinutes: skipped,
    overflowCampaignMinutes: overflow,
    targetCampaignMinutes: target,
    accumulatedBeforeCampaignMinutes: accumulatedBefore,
    accumulatedAfterCampaignMinutes: accumulatedAfter,
    reachedReady: row.reachedReady,
    readyAtCampaignMinute: readyAt,
    pausedDuringSegment: row.pausedDuringSegment,
    pauseMutation: row.pauseMutation,
    modifierMode: row.modifierMode,
    definitionSha256: hash(row.definitionSha256, `${path}.definitionSha256`),
  }) as BreedingIncubationSegmentResultV1
}

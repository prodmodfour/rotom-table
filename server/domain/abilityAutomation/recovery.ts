import { createHash } from 'node:crypto'
import {
  parseAbilityDailyUsageLedger,
  type AbilityDailyUsageLedger,
} from '#shared/abilityAutomation/resources'
import { parseAbilityAutomationRollLedger, type AbilityAutomationRollLedgerEntry } from '#shared/abilityAutomation/random'
import {
  abilityResolutionTraceRollLedger,
  parseAbilityResolutionTrace,
  type AbilityResolutionAuditTrace,
} from '#shared/abilityAutomation/trace'
import { ABILITY_SPEC_PHASES, type AbilitySpecJsonObject, type AbilitySpecPhase } from '#shared/abilityAutomation/spec'
import { cloneStrictJson, deepFreezeStrictJson, isPlainJsonObject } from '#shared/automation/strictJson'
import { stableJsonStringify } from '#shared/automation/stableJson'
import { parseEncounterState, type EncounterState } from '#shared/moveAutomation/encounterState'
import type { SheetKind } from '~/types/map'
import type { PrivatePendingAbilityResult } from './results'
import { recoverAbilityEncounterResources } from './timing'
import { recoverAbilityEffectLifecycles, type AbilityEffectRecoveryFacts } from './effectLifecycle'
import { recoverAbilityOwnedState } from './ownedState'
import { recoverAbilityEntities } from './entities'
import { recoverAbilityTransformations } from './transformations'
import type { AbilityTimingCursor } from '#shared/abilityAutomation/timingResources'

export const ABILITY_RECOVERY_BUNDLE_SCHEMA_VERSION = 1 as const
export const ABILITY_RECOVERY_BUNDLE_LIMITS = Object.freeze({
  dailyUsageSheets: 512,
  pendingResolutions: 128,
  pendingOptions: 64,
  responderPrincipals: 128,
  continuationNodes: 32_768,
  identifierLength: 200,
})

export interface AbilityRecoveryDailyUsage {
  readonly sheetKind: SheetKind
  readonly sheetSlug: string
  readonly sheetRevision: number
  readonly usage: AbilityDailyUsageLedger
}

export interface RecoverablePendingAbilityResolution extends PrivatePendingAbilityResult {
  /** Private interpreter cursor/state; never projected to table clients. */
  readonly continuation: AbilitySpecJsonObject
}

export interface AbilityRecoveryPayload {
  readonly rulesetId: string
  readonly sourceDataSha256: string
  readonly exportedAt: number
  readonly mapSlug: string
  readonly mapRevision: number
  readonly encounterState: EncounterState
  readonly dailyUsage: readonly AbilityRecoveryDailyUsage[]
  readonly pendingResolutions: readonly RecoverablePendingAbilityResolution[]
}

export interface AbilityRecoveryBundle {
  readonly schemaVersion: typeof ABILITY_RECOVERY_BUNDLE_SCHEMA_VERSION
  readonly payloadSha256: string
  readonly payload: AbilityRecoveryPayload
}

export interface AbilityRecoveryRuntimeIdentity {
  readonly canonicalId: string
  readonly modeId: string
  readonly runtimeVersion: number
  readonly definitionHash: string
  readonly sourceModule: string
}

export interface RecoveredAbilityAutomationState {
  readonly encounterState: EncounterState
  readonly dailyUsage: readonly AbilityRecoveryDailyUsage[]
  readonly pendingResolutions: readonly RecoverablePendingAbilityResolution[]
}

export interface AbilityMaintenanceExportAbandonment {
  readonly resolutionId: string
  readonly operationId: string
  readonly mapSlug: string
  readonly previousStatus: 'pending'
}

export interface AbilityMaintenanceExport {
  readonly schemaVersion: 1
  readonly policy: 'terminally-abandoned-on-maintenance-export'
  /** Interchange bundle; unlike a private backup, it can never resume a prompt. */
  readonly bundle: AbilityRecoveryBundle
  readonly abandonedPendingResolutions: readonly AbilityMaintenanceExportAbandonment[]
}

export type AbilityRecoveryErrorCode =
  | 'invalid-bundle'
  | 'hash-mismatch'
  | 'ruleset-mismatch'
  | 'map-mismatch'
  | 'runtime-mismatch'
  | 'limit-exceeded'
  | 'not-json'

export class AbilityRecoveryError extends Error {
  readonly code: AbilityRecoveryErrorCode
  readonly path: string

  constructor(code: AbilityRecoveryErrorCode, path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'AbilityRecoveryError'
    this.code = code
    this.path = path
  }
}

type UnknownRecord = Record<string, unknown>
const BUNDLE_FIELDS = ['schemaVersion', 'payloadSha256', 'payload'] as const
const PAYLOAD_FIELDS = [
  'rulesetId', 'sourceDataSha256', 'exportedAt', 'mapSlug', 'mapRevision',
  'encounterState', 'dailyUsage', 'pendingResolutions',
] as const
const DAILY_FIELDS = ['sheetKind', 'sheetSlug', 'sheetRevision', 'usage'] as const
const PENDING_FIELDS = [
  'kind', 'operationId', 'resolutionId', 'mapSlug', 'previousRevision', 'revision',
  'canonicalId', 'modeId', 'actorPlacementId', 'phase', 'createdAt', 'updatedAt',
  'outstandingWindowCount', 'window', 'trace', 'rollLedger', 'privateReadCount', 'continuation',
] as const
const WINDOW_FIELDS = [
  'windowId', 'kind', 'phase', 'promptKey', 'options', 'allowPass', 'responderPrincipalIds',
] as const
const OPTION_FIELDS = ['id', 'presentationKey', 'operationIds'] as const
const STABLE_ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const PHASE_SET = new Set<string>(ABILITY_SPEC_PHASES)

const fail = (code: AbilityRecoveryErrorCode, path: string, detail: string): never => {
  throw new AbilityRecoveryError(code, path, detail)
}

const cloneBundle = (value: unknown) => cloneStrictJson(value, 'abilityRecoveryBundle', {
  limits: {
    depth: 64,
    nodes: 250_000,
    objectFields: 2_048,
    arrayEntries: 8_192,
    stringLength: 100_000,
    objectKeyLength: 200,
  },
  rootLabel: 'ability recovery bundle',
  valueLabel: 'ability recovery bundles',
  failNotJson: (path, detail) => fail('not-json', path, detail),
  failLimit: (path, detail) => fail('limit-exceeded', path, detail),
})

const record = (value: unknown, path: string): UnknownRecord => {
  if (!isPlainJsonObject(value)) return fail('invalid-bundle', path, 'must be an object.')
  return value
}

const exact = (value: UnknownRecord, fields: readonly string[], path: string): void => {
  const expected = new Set(fields)
  if (
    fields.some(field => !Object.prototype.hasOwnProperty.call(value, field))
    || Object.keys(value).some(field => !expected.has(field))
  ) fail('invalid-bundle', path, 'has an invalid shape.')
}

const text = (
  value: unknown,
  path: string,
  maximum: number = ABILITY_RECOVERY_BUNDLE_LIMITS.identifierLength,
): string => {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > maximum
    || value.trim() !== value
    || /[\u0000-\u001f\u007f]/.test(value)
  ) return fail('invalid-bundle', path, 'must be bounded trimmed text.')
  return value
}

const stableId = (value: unknown, path: string): string => {
  const id = text(value, path)
  if (!STABLE_ID_PATTERN.test(id)) fail('invalid-bundle', path, 'must be a stable identifier.')
  return id
}

const revision = (value: unknown, path: string): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    return fail('invalid-bundle', path, 'must be a non-negative safe integer.')
  }
  return Number(value)
}

const timestamp = (value: unknown, path: string): number => revision(value, path)

const hashPayload = (payload: unknown): string => createHash('sha256')
  .update(stableJsonStringify(payload))
  .digest('hex')

const parseDailyUsage = (value: unknown, index: number): AbilityRecoveryDailyUsage => {
  const path = `abilityRecoveryBundle.payload.dailyUsage[${index}]`
  const input = record(value, path)
  exact(input, DAILY_FIELDS, path)
  if (input.sheetKind !== 'pokemon' && input.sheetKind !== 'trainer') {
    fail('invalid-bundle', `${path}.sheetKind`, 'is unsupported.')
  }
  return Object.freeze({
    sheetKind: input.sheetKind as SheetKind,
    sheetSlug: text(input.sheetSlug, `${path}.sheetSlug`),
    sheetRevision: revision(input.sheetRevision, `${path}.sheetRevision`),
    usage: parseAbilityDailyUsageLedger(input.usage, `${path}.usage`),
  })
}

const parseStringArray = (
  value: unknown,
  path: string,
  maximum: number,
  stable = true,
): readonly string[] => {
  if (!Array.isArray(value) || value.length > maximum) {
    fail('limit-exceeded', path, 'must be a bounded array.')
  }
  const values = (value as readonly unknown[]).map((entry, index) => (
    stable ? stableId(entry, `${path}[${index}]`) : text(entry, `${path}[${index}]`)
  ))
  if (new Set(values).size !== values.length) fail('invalid-bundle', path, 'must not repeat values.')
  return Object.freeze(values)
}

const parsePending = (value: unknown, index: number): RecoverablePendingAbilityResolution => {
  const path = `abilityRecoveryBundle.payload.pendingResolutions[${index}]`
  const input = record(value, path)
  exact(input, PENDING_FIELDS, path)
  if (input.kind !== 'pending-private') fail('invalid-bundle', `${path}.kind`, 'must be pending-private.')
  if (typeof input.phase !== 'string' || !PHASE_SET.has(input.phase)) {
    fail('invalid-bundle', `${path}.phase`, 'is unsupported.')
  }
  const windowPath = `${path}.window`
  const window = record(input.window, windowPath)
  exact(window, WINDOW_FIELDS, windowPath)
  if (window.kind !== 'choice' && window.kind !== 'reaction') {
    fail('invalid-bundle', `${windowPath}.kind`, 'is unsupported.')
  }
  if (window.phase !== input.phase) fail('invalid-bundle', `${windowPath}.phase`, 'must match pending phase.')
  if (!Array.isArray(window.options) || window.options.length > ABILITY_RECOVERY_BUNDLE_LIMITS.pendingOptions) {
    fail('limit-exceeded', `${windowPath}.options`, 'must be a bounded array.')
  }
  const options = (window.options as readonly unknown[]).map((value, optionIndex) => {
    const optionPath = `${windowPath}.options[${optionIndex}]`
    const option = record(value, optionPath)
    exact(option, OPTION_FIELDS, optionPath)
    return Object.freeze({
      id: stableId(option.id, `${optionPath}.id`),
      presentationKey: stableId(option.presentationKey, `${optionPath}.presentationKey`),
      operationIds: parseStringArray(option.operationIds, `${optionPath}.operationIds`, 256),
    })
  })
  if (new Set(options.map(option => option.id)).size !== options.length) {
    fail('invalid-bundle', `${windowPath}.options`, 'must not repeat option IDs.')
  }
  const continuation = cloneStrictJson(input.continuation, `${path}.continuation`, {
    limits: {
      depth: 32,
      nodes: ABILITY_RECOVERY_BUNDLE_LIMITS.continuationNodes,
      objectFields: 1_024,
      arrayEntries: 4_096,
      stringLength: 10_000,
      objectKeyLength: 200,
    },
    rootLabel: 'ability continuation',
    valueLabel: 'ability continuations',
    failNotJson: (failurePath, detail) => fail('not-json', failurePath, detail),
    failLimit: (failurePath, detail) => fail('limit-exceeded', failurePath, detail),
  })
  if (!isPlainJsonObject(continuation)) fail('invalid-bundle', `${path}.continuation`, 'must be an object.')
  const trace = parseAbilityResolutionTrace(input.trace)
  const canonicalId = text(input.canonicalId, `${path}.canonicalId`, 160)
  const modeId = stableId(input.modeId, `${path}.modeId`)
  const resolutionId = stableId(input.resolutionId, `${path}.resolutionId`)
  if (
    trace.resolutionId !== resolutionId
    || trace.program.canonicalId !== canonicalId
    || trace.program.modeId !== modeId
  ) fail('invalid-bundle', `${path}.trace`, 'identity does not match pending resolution.')
  const rollLedger = parseAbilityAutomationRollLedger(input.rollLedger, `${path}.rollLedger`)
  if (stableJsonStringify(rollLedger) !== stableJsonStringify(abilityResolutionTraceRollLedger(trace))) {
    fail('invalid-bundle', `${path}.rollLedger`, 'must match causal trace rolls exactly.')
  }
  const createdAt = timestamp(input.createdAt, `${path}.createdAt`)
  const updatedAt = timestamp(input.updatedAt, `${path}.updatedAt`)
  if (updatedAt < createdAt) fail('invalid-bundle', `${path}.updatedAt`, 'cannot precede creation.')
  const outstandingWindowCount = revision(
    input.outstandingWindowCount,
    `${path}.outstandingWindowCount`,
  )
  if (outstandingWindowCount < 1 || outstandingWindowCount > 128) {
    fail('invalid-bundle', `${path}.outstandingWindowCount`, 'must be 1 through 128.')
  }
  return deepFreezeStrictJson({
    kind: 'pending-private',
    operationId: stableId(input.operationId, `${path}.operationId`),
    resolutionId,
    mapSlug: text(input.mapSlug, `${path}.mapSlug`),
    previousRevision: revision(input.previousRevision, `${path}.previousRevision`),
    revision: revision(input.revision, `${path}.revision`),
    canonicalId,
    modeId,
    actorPlacementId: stableId(input.actorPlacementId, `${path}.actorPlacementId`),
    phase: input.phase as AbilitySpecPhase,
    createdAt,
    updatedAt,
    outstandingWindowCount,
    window: {
      windowId: stableId(window.windowId, `${windowPath}.windowId`),
      kind: window.kind as 'choice' | 'reaction',
      phase: input.phase as AbilitySpecPhase,
      promptKey: stableId(window.promptKey, `${windowPath}.promptKey`),
      options,
      allowPass: typeof window.allowPass === 'boolean'
        ? window.allowPass
        : fail('invalid-bundle', `${windowPath}.allowPass`, 'must be boolean.'),
      responderPrincipalIds: parseStringArray(
        window.responderPrincipalIds,
        `${windowPath}.responderPrincipalIds`,
        ABILITY_RECOVERY_BUNDLE_LIMITS.responderPrincipals,
        false,
      ),
    },
    trace,
    rollLedger,
    privateReadCount: revision(input.privateReadCount, `${path}.privateReadCount`),
    continuation: continuation as AbilitySpecJsonObject,
  })
}

export const parseAbilityRecoveryBundle = (value: unknown): AbilityRecoveryBundle => {
  const root = record(cloneBundle(value), 'abilityRecoveryBundle')
  exact(root, BUNDLE_FIELDS, 'abilityRecoveryBundle')
  if (root.schemaVersion !== ABILITY_RECOVERY_BUNDLE_SCHEMA_VERSION) {
    fail('invalid-bundle', 'abilityRecoveryBundle.schemaVersion', 'is unsupported.')
  }
  if (typeof root.payloadSha256 !== 'string' || !SHA256_PATTERN.test(root.payloadSha256)) {
    fail('invalid-bundle', 'abilityRecoveryBundle.payloadSha256', 'must be SHA-256.')
  }
  if (hashPayload(root.payload) !== root.payloadSha256) {
    fail('hash-mismatch', 'abilityRecoveryBundle.payloadSha256', 'does not match payload.')
  }
  const input = record(root.payload, 'abilityRecoveryBundle.payload')
  exact(input, PAYLOAD_FIELDS, 'abilityRecoveryBundle.payload')
  if (typeof input.sourceDataSha256 !== 'string' || !SHA256_PATTERN.test(input.sourceDataSha256)) {
    fail('invalid-bundle', 'abilityRecoveryBundle.payload.sourceDataSha256', 'must be SHA-256.')
  }
  if (!Array.isArray(input.dailyUsage)
    || input.dailyUsage.length > ABILITY_RECOVERY_BUNDLE_LIMITS.dailyUsageSheets) {
    fail('limit-exceeded', 'abilityRecoveryBundle.payload.dailyUsage', 'must be a bounded array.')
  }
  const dailyUsage = (input.dailyUsage as readonly unknown[]).map(parseDailyUsage)
  const dailyKeys = dailyUsage.map(entry => `${entry.sheetKind}:${entry.sheetSlug}`)
  if (new Set(dailyKeys).size !== dailyUsage.length) {
    fail('invalid-bundle', 'abilityRecoveryBundle.payload.dailyUsage', 'must not repeat sheets.')
  }
  if (dailyKeys.some((key, index) => index > 0 && key <= dailyKeys[index - 1]!)) {
    fail('invalid-bundle', 'abilityRecoveryBundle.payload.dailyUsage', 'must use stable sheet order.')
  }
  if (!Array.isArray(input.pendingResolutions)
    || input.pendingResolutions.length > ABILITY_RECOVERY_BUNDLE_LIMITS.pendingResolutions) {
    fail('limit-exceeded', 'abilityRecoveryBundle.payload.pendingResolutions', 'must be a bounded array.')
  }
  const pendingResolutions = (input.pendingResolutions as readonly unknown[]).map(parsePending)
  const pendingIds = pendingResolutions.map(entry => entry.resolutionId)
  if (new Set(pendingIds).size !== pendingResolutions.length) {
    fail('invalid-bundle', 'abilityRecoveryBundle.payload.pendingResolutions', 'must not repeat resolutions.')
  }
  if (pendingIds.some((id, index) => index > 0 && id <= pendingIds[index - 1]!)) {
    fail('invalid-bundle', 'abilityRecoveryBundle.payload.pendingResolutions', 'must use stable resolution order.')
  }
  const mapSlug = text(input.mapSlug, 'abilityRecoveryBundle.payload.mapSlug')
  const mapRevision = revision(input.mapRevision, 'abilityRecoveryBundle.payload.mapRevision')
  const rulesetId = stableId(input.rulesetId, 'abilityRecoveryBundle.payload.rulesetId')
  if (pendingResolutions.some(entry => (
    entry.mapSlug !== mapSlug
    || entry.previousRevision > entry.revision
    || entry.revision > mapRevision
    || entry.trace.ruleset.rulesetId !== rulesetId
    || entry.trace.ruleset.sourceDataSha256 !== input.sourceDataSha256
  ))) {
    fail('invalid-bundle', 'abilityRecoveryBundle.payload.pendingResolutions', 'has inconsistent causal identity.')
  }
  return deepFreezeStrictJson({
    schemaVersion: ABILITY_RECOVERY_BUNDLE_SCHEMA_VERSION,
    payloadSha256: root.payloadSha256 as string,
    payload: {
      rulesetId,
      sourceDataSha256: input.sourceDataSha256 as string,
      exportedAt: timestamp(input.exportedAt, 'abilityRecoveryBundle.payload.exportedAt'),
      mapSlug,
      mapRevision,
      encounterState: parseEncounterState(input.encounterState),
      dailyUsage,
      pendingResolutions,
    },
  })
}

export const createAbilityRecoveryBundle = (
  payload: AbilityRecoveryPayload,
): AbilityRecoveryBundle => {
  const candidate = record(cloneBundle({
    schemaVersion: ABILITY_RECOVERY_BUNDLE_SCHEMA_VERSION,
    payloadSha256: '0'.repeat(64),
    payload,
  }), 'abilityRecoveryBundle')
  return parseAbilityRecoveryBundle({
    ...candidate,
    payloadSha256: hashPayload(candidate.payload),
  })
}

/**
 * Build explicit JSON interchange output. Resumable private windows belong only
 * in a consistent database/private recovery backup; maintenance JSON export
 * terminally abandons them and retains identity-only operator audit evidence.
 */
export const createAbilityMaintenanceExport = (
  payload: AbilityRecoveryPayload,
): AbilityMaintenanceExport => {
  const backup = createAbilityRecoveryBundle(payload)
  const abandonedPendingResolutions = backup.payload.pendingResolutions.map(pending => ({
    resolutionId: pending.resolutionId,
    operationId: pending.operationId,
    mapSlug: pending.mapSlug,
    previousStatus: 'pending' as const,
  }))
  const bundle = createAbilityRecoveryBundle({
    ...backup.payload,
    pendingResolutions: [],
  })
  return deepFreezeStrictJson({
    schemaVersion: 1,
    policy: 'terminally-abandoned-on-maintenance-export',
    bundle,
    abandonedPendingResolutions,
  })
}

export const recoverAbilityAutomationState = (input: {
  readonly bundle: unknown
  readonly expectedRulesetId: string
  readonly expectedSourceDataSha256: string
  readonly expectedMapSlug: string
  readonly expectedMapRevision?: number
  readonly timingCursor: AbilityTimingCursor
  readonly effectFacts: AbilityEffectRecoveryFacts
  readonly runtimeIdentityFor: (
    canonicalId: string,
    modeId: string,
  ) => AbilityRecoveryRuntimeIdentity | null
}): RecoveredAbilityAutomationState => {
  const bundle = parseAbilityRecoveryBundle(input.bundle)
  const payload = bundle.payload
  if (
    payload.rulesetId !== input.expectedRulesetId
    || payload.sourceDataSha256 !== input.expectedSourceDataSha256
  ) fail('ruleset-mismatch', 'abilityRecoveryBundle.payload', 'ruleset identity changed.')
  if (payload.mapSlug !== input.expectedMapSlug
    || (input.expectedMapRevision !== undefined && payload.mapRevision !== input.expectedMapRevision)) {
    fail('map-mismatch', 'abilityRecoveryBundle.payload', 'map identity or revision changed.')
  }
  for (const pending of payload.pendingResolutions) {
    const runtime = input.runtimeIdentityFor(pending.canonicalId, pending.modeId)
    if (!runtime
      || runtime.canonicalId !== pending.trace.program.canonicalId
      || runtime.modeId !== pending.trace.program.modeId
      || runtime.runtimeVersion !== pending.trace.program.runtimeVersion
      || runtime.definitionHash !== pending.trace.program.definitionHash
      || runtime.sourceModule !== pending.trace.program.sourceModule) {
      fail('runtime-mismatch', `pending.${pending.resolutionId}`, 'runtime identity changed.')
    }
  }
  let encounterState = recoverAbilityEncounterResources(payload.encounterState, input.timingCursor)
  encounterState = recoverAbilityEffectLifecycles(encounterState, input.effectFacts)
  encounterState = recoverAbilityOwnedState(encounterState, {
    presentPlacementIds: input.effectFacts.presentPlacementIds,
    activeAbilityInstanceIdsByPlacement: input.effectFacts.activeAbilityInstanceIdsByPlacement,
  })
  encounterState = recoverAbilityEntities({
    encounter: encounterState,
    presentPlacementIds: input.effectFacts.presentPlacementIds,
    activeAbilityInstanceIdsByPlacement: input.effectFacts.activeAbilityInstanceIdsByPlacement,
  })
  encounterState = recoverAbilityTransformations({
    encounter: encounterState,
    presentPlacementIds: input.effectFacts.presentPlacementIds,
    activeAbilityInstanceIdsByPlacement: input.effectFacts.activeAbilityInstanceIdsByPlacement,
  })
  return Object.freeze({
    encounterState,
    dailyUsage: payload.dailyUsage,
    pendingResolutions: payload.pendingResolutions,
  })
}

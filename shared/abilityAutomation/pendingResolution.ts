import { isSlug } from '../paths'
import { isSheetKind, type SheetKind } from '../sheets'
import {
  ABILITY_SPEC_PHASES,
  type AbilitySpecPhase,
} from './spec'
import {
  abilityResolutionTraceRollLedger,
  parseAbilityResolutionTrace,
  type AbilityResolutionAuditTrace,
} from './trace'
import {
  parseAbilityAutomationRollLedger,
  type AbilityAutomationRollLedgerEntry,
} from './random'
import { cloneStrictJson, deepFreezeStrictJson, isPlainJsonObject } from '../automation/strictJson'
import { stableJsonStringify } from '../automation/stableJson'

export const PENDING_ABILITY_RESOLUTION_SCHEMA_VERSION = 1 as const
export const PENDING_ABILITY_CONTINUATION_SCHEMA_VERSION = 1 as const
export const PENDING_ABILITY_RESOLUTION_LIMITS = Object.freeze({
  identifierLength: 200,
  canonicalIdLength: 160,
  reads: 512,
  owners: 128,
  options: 512,
  optionOperations: 256,
  completedOperations: 512,
  choiceBindings: 64,
  optionIdsPerBinding: 32,
})

export type PendingAbilityRead =
  | { readonly kind: 'map'; readonly slug: string; readonly revision: number }
  | { readonly kind: 'sheet'; readonly sheetKind: SheetKind; readonly slug: string; readonly revision: number }
  | { readonly kind: 'group-inventory'; readonly slug: string; readonly revision: number }

export const PENDING_ABILITY_OWNER_KINDS = ['principal', 'placement', 'profile', 'side', 'gm'] as const
export type PendingAbilityOwnerKind = (typeof PENDING_ABILITY_OWNER_KINDS)[number]
export interface PendingAbilityResponseOwner {
  readonly kind: PendingAbilityOwnerKind
  readonly id: string | null
}

export interface PendingAbilityResponseOption {
  readonly id: string
  readonly presentationKey: string
  readonly operationIds: readonly string[]
}

export interface PendingAbilityOptionalTriggerWindow {
  readonly windowId: string
  readonly kind: 'optional-trigger'
  readonly phase: AbilitySpecPhase
  readonly promptKey: string
  readonly reasonCode: string
  readonly owners: readonly PendingAbilityResponseOwner[]
  readonly options: readonly PendingAbilityResponseOption[]
  readonly allowPass: true
  readonly priority: number
}

export interface PendingAbilityTriggerIdentity {
  readonly chainId: string
  readonly triggerId: string
  readonly eventId: string
  readonly parentEventId: string | null
  readonly ownerPlacementId: string
  readonly abilityInstanceId: string
  readonly canonicalId: string
  readonly modeId: string
  readonly subscriptionId: string
  readonly response: 'optional'
  readonly runtimeVersion: number
  readonly definitionHash: string
  readonly sourceModule: string
}

export interface PendingAbilityChoiceBinding {
  readonly declarationId: string
  readonly optionIds: readonly string[]
}

export interface PendingAbilityContinuation {
  readonly schemaVersion: typeof PENDING_ABILITY_CONTINUATION_SCHEMA_VERSION
  readonly kind: 'abilityspec-v1'
  readonly phase: AbilitySpecPhase
  readonly phaseIndex: number
  readonly operationIndex: number
  readonly completedOperationIds: readonly string[]
  readonly choiceBindings: readonly PendingAbilityChoiceBinding[]
  readonly chainId: string
  readonly triggerId: string
}

export interface PendingAbilityResolution {
  readonly schemaVersion: typeof PENDING_ABILITY_RESOLUTION_SCHEMA_VERSION
  readonly kind: 'pending-ability-resolution'
  readonly status: 'pending'
  readonly resolutionId: string
  readonly operationId: string
  readonly requestSha256: string
  readonly mapSlug: string
  readonly previousRevision: number
  readonly revision: number
  readonly createdAt: number
  readonly updatedAt: number
  readonly expiresAt: number | null
  readonly trigger: PendingAbilityTriggerIdentity
  readonly phase: AbilitySpecPhase
  readonly readSet: readonly PendingAbilityRead[]
  readonly window: PendingAbilityOptionalTriggerWindow
  readonly trace: AbilityResolutionAuditTrace
  readonly rollLedger: readonly AbilityAutomationRollLedgerEntry[]
  readonly continuation: PendingAbilityContinuation
}

export type PendingAbilityResolutionValidationCode =
  | 'invalid-pending-resolution'
  | 'unsupported-schema-version'
  | 'limit-exceeded'
  | 'duplicate-id'
  | 'not-json'
  | 'inconsistent-pending-resolution'

export class PendingAbilityResolutionValidationError extends Error {
  constructor(readonly code: PendingAbilityResolutionValidationCode, readonly path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'PendingAbilityResolutionValidationError'
  }
}

type UnknownRecord = Record<string, unknown>
const ROOT_FIELDS = [
  'schemaVersion', 'kind', 'status', 'resolutionId', 'operationId', 'requestSha256',
  'mapSlug', 'previousRevision', 'revision', 'createdAt', 'updatedAt', 'expiresAt',
  'trigger', 'phase', 'readSet', 'window', 'trace', 'rollLedger', 'continuation',
] as const
const TRIGGER_FIELDS = [
  'chainId', 'triggerId', 'eventId', 'parentEventId', 'ownerPlacementId',
  'abilityInstanceId', 'canonicalId', 'modeId', 'subscriptionId', 'response', 'runtimeVersion',
  'definitionHash', 'sourceModule',
] as const
const READ_FIELDS = ['kind', 'slug', 'revision'] as const
const SHEET_READ_FIELDS = ['kind', 'sheetKind', 'slug', 'revision'] as const
const WINDOW_FIELDS = [
  'windowId', 'kind', 'phase', 'promptKey', 'reasonCode', 'owners', 'options',
  'allowPass', 'priority',
] as const
const OWNER_FIELDS = ['kind', 'id'] as const
const OPTION_FIELDS = ['id', 'presentationKey', 'operationIds'] as const
const CONTINUATION_FIELDS = [
  'schemaVersion', 'kind', 'phase', 'phaseIndex', 'operationIndex',
  'completedOperationIds', 'choiceBindings', 'chainId', 'triggerId',
] as const
const BINDING_FIELDS = ['declarationId', 'optionIds'] as const
const OWNER_KIND_SET = new Set<string>(PENDING_ABILITY_OWNER_KINDS)
const PHASE_SET = new Set<string>(ABILITY_SPEC_PHASES)
const STABLE_ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/

const fail = (code: PendingAbilityResolutionValidationCode, path: string, detail: string): never => {
  throw new PendingAbilityResolutionValidationError(code, path, detail)
}
const clone = (value: unknown): unknown => cloneStrictJson(value, 'pendingAbilityResolution', {
  limits: {
    depth: 32, nodes: 131_072, objectFields: 128, arrayEntries: 8_192,
    stringLength: 2_000, objectKeyLength: PENDING_ABILITY_RESOLUTION_LIMITS.identifierLength,
  },
  rootLabel: 'pending ability resolution', valueLabel: 'pending ability resolution values',
  failNotJson: (path, detail) => fail('not-json', path, detail),
  failLimit: (path, detail) => fail('limit-exceeded', path, detail),
})
const record = (value: unknown, path: string): UnknownRecord => {
  if (!isPlainJsonObject(value)) fail('invalid-pending-resolution', path, 'must be an object.')
  return value as UnknownRecord
}
const exact = (value: UnknownRecord, fields: readonly string[], path: string): void => {
  const expected = new Set(fields)
  if (fields.some(field => !Object.prototype.hasOwnProperty.call(value, field))
    || Object.keys(value).some(field => !expected.has(field))) {
    fail('invalid-pending-resolution', path, 'has an invalid shape.')
  }
}
const stableId = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || value.length === 0
    || value.length > PENDING_ABILITY_RESOLUTION_LIMITS.identifierLength
    || !STABLE_ID_PATTERN.test(value)) fail('invalid-pending-resolution', path, 'must be a stable ID.')
  return value as string
}
const text = (
  value: unknown,
  path: string,
  maximum: number = PENDING_ABILITY_RESOLUTION_LIMITS.identifierLength,
): string => {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum
    || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) {
    fail('invalid-pending-resolution', path, 'must be bounded trimmed text.')
  }
  return value as string
}
const integer = (value: unknown, path: string, maximum = Number.MAX_SAFE_INTEGER): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > maximum) {
    fail('invalid-pending-resolution', path, `must be an integer from 0 through ${maximum}.`)
  }
  return Number(value)
}
const phase = (value: unknown, path: string): AbilitySpecPhase => {
  if (typeof value !== 'string' || !PHASE_SET.has(value)) {
    fail('invalid-pending-resolution', path, 'is not an AbilitySpec phase.')
  }
  return value as AbilitySpecPhase
}
const stringIds = (value: unknown, path: string, maximum: number): readonly string[] => {
  if (!Array.isArray(value) || value.length > maximum) fail('limit-exceeded', path, 'must be bounded.')
  const values = (value as readonly unknown[]).map((entry, index) => stableId(entry, `${path}[${index}]`))
  if (new Set(values).size !== values.length) fail('duplicate-id', path, 'must not repeat IDs.')
  return Object.freeze(values)
}
const parseTrigger = (value: unknown): PendingAbilityTriggerIdentity => {
  const path = 'pendingAbilityResolution.trigger'
  const input = record(value, path)
  exact(input, TRIGGER_FIELDS, path)
  if (typeof input.definitionHash !== 'string' || !SHA256_PATTERN.test(input.definitionHash)) {
    fail('invalid-pending-resolution', `${path}.definitionHash`, 'must be SHA-256.')
  }
  if (input.response !== 'optional') {
    fail('invalid-pending-resolution', `${path}.response`, 'must identify an optional trigger.')
  }
  const runtimeVersion = integer(input.runtimeVersion, `${path}.runtimeVersion`, 1_000_000)
  if (runtimeVersion < 1) fail('invalid-pending-resolution', `${path}.runtimeVersion`, 'must be positive.')
  return Object.freeze({
    chainId: stableId(input.chainId, `${path}.chainId`),
    triggerId: stableId(input.triggerId, `${path}.triggerId`),
    eventId: stableId(input.eventId, `${path}.eventId`),
    parentEventId: input.parentEventId === null ? null : stableId(input.parentEventId, `${path}.parentEventId`),
    ownerPlacementId: stableId(input.ownerPlacementId, `${path}.ownerPlacementId`),
    abilityInstanceId: stableId(input.abilityInstanceId, `${path}.abilityInstanceId`),
    canonicalId: text(input.canonicalId, `${path}.canonicalId`, PENDING_ABILITY_RESOLUTION_LIMITS.canonicalIdLength),
    modeId: stableId(input.modeId, `${path}.modeId`),
    subscriptionId: stableId(input.subscriptionId, `${path}.subscriptionId`),
    response: 'optional',
    runtimeVersion,
    definitionHash: input.definitionHash as string,
    sourceModule: text(input.sourceModule, `${path}.sourceModule`),
  })
}
const parseReadSet = (value: unknown): readonly PendingAbilityRead[] => {
  const path = 'pendingAbilityResolution.readSet'
  if (!Array.isArray(value) || value.length === 0 || value.length > PENDING_ABILITY_RESOLUTION_LIMITS.reads) {
    fail('limit-exceeded', path, 'must be a bounded non-empty read set.')
  }
  const reads = (value as readonly unknown[]).map((entry, index): PendingAbilityRead => {
    const entryPath = `${path}[${index}]`
    const input = record(entry, entryPath)
    exact(input, input.kind === 'sheet' ? SHEET_READ_FIELDS : READ_FIELDS, entryPath)
    const slug = text(input.slug, `${entryPath}.slug`)
    const revision = integer(input.revision, `${entryPath}.revision`)
    if (input.kind === 'map') return Object.freeze({ kind: 'map', slug, revision })
    if (input.kind === 'group-inventory') return Object.freeze({ kind: 'group-inventory', slug, revision })
    if (input.kind !== 'sheet' || !isSheetKind(input.sheetKind)) {
      fail('invalid-pending-resolution', `${entryPath}.kind`, 'is unsupported.')
    }
    return Object.freeze({ kind: 'sheet', sheetKind: input.sheetKind as SheetKind, slug, revision })
  })
  const keys = reads.map(read => read.kind === 'sheet'
    ? `sheet:${read.sheetKind}:${read.slug}`
    : `${read.kind}:${read.slug}`)
  if (new Set(keys).size !== keys.length) fail('duplicate-id', path, 'must not repeat resources.')
  return Object.freeze(reads)
}
const parseWindow = (value: unknown): PendingAbilityOptionalTriggerWindow => {
  const path = 'pendingAbilityResolution.window'
  const input = record(value, path)
  exact(input, WINDOW_FIELDS, path)
  if (input.kind !== 'optional-trigger' || input.allowPass !== true) {
    fail('invalid-pending-resolution', path, 'must be a passable optional-trigger window.')
  }
  if (!Array.isArray(input.owners) || input.owners.length === 0
    || input.owners.length > PENDING_ABILITY_RESOLUTION_LIMITS.owners) {
    fail('limit-exceeded', `${path}.owners`, 'must be bounded and non-empty.')
  }
  const owners = (input.owners as readonly unknown[]).map((entry, index): PendingAbilityResponseOwner => {
    const ownerPath = `${path}.owners[${index}]`
    const owner = record(entry, ownerPath)
    exact(owner, OWNER_FIELDS, ownerPath)
    if (typeof owner.kind !== 'string' || !OWNER_KIND_SET.has(owner.kind)) {
      fail('invalid-pending-resolution', `${ownerPath}.kind`, 'is unsupported.')
    }
    const id = owner.id === null ? null : stableId(owner.id, `${ownerPath}.id`)
    if ((owner.kind === 'gm') !== (id === null)) {
      fail('invalid-pending-resolution', ownerPath, 'only GM ownership has a null ID.')
    }
    return Object.freeze({ kind: owner.kind as PendingAbilityOwnerKind, id })
  })
  const ownerKeys = owners.map(owner => `${owner.kind}:${owner.id ?? ''}`)
  if (new Set(ownerKeys).size !== owners.length) fail('duplicate-id', `${path}.owners`, 'must not repeat owners.')
  if (!Array.isArray(input.options) || input.options.length === 0
    || input.options.length > PENDING_ABILITY_RESOLUTION_LIMITS.options) {
    fail('limit-exceeded', `${path}.options`, 'must be bounded and non-empty.')
  }
  const options = (input.options as readonly unknown[]).map((entry, index): PendingAbilityResponseOption => {
    const optionPath = `${path}.options[${index}]`
    const option = record(entry, optionPath)
    exact(option, OPTION_FIELDS, optionPath)
    return Object.freeze({
      id: stableId(option.id, `${optionPath}.id`),
      presentationKey: stableId(option.presentationKey, `${optionPath}.presentationKey`),
      operationIds: stringIds(
        option.operationIds,
        `${optionPath}.operationIds`,
        PENDING_ABILITY_RESOLUTION_LIMITS.optionOperations,
      ),
    })
  })
  if (new Set(options.map(option => option.id)).size !== options.length) {
    fail('duplicate-id', `${path}.options`, 'must not repeat option IDs.')
  }
  if (!Number.isSafeInteger(input.priority) || Math.abs(Number(input.priority)) > 1_000_000) {
    fail('invalid-pending-resolution', `${path}.priority`, 'must be a bounded integer.')
  }
  return Object.freeze({
    windowId: stableId(input.windowId, `${path}.windowId`),
    kind: 'optional-trigger',
    phase: phase(input.phase, `${path}.phase`),
    promptKey: stableId(input.promptKey, `${path}.promptKey`),
    reasonCode: stableId(input.reasonCode, `${path}.reasonCode`),
    owners: Object.freeze(owners),
    options: Object.freeze(options),
    allowPass: true,
    priority: Number(input.priority),
  })
}
const parseContinuation = (value: unknown): PendingAbilityContinuation => {
  const path = 'pendingAbilityResolution.continuation'
  const input = record(value, path)
  exact(input, CONTINUATION_FIELDS, path)
  if (input.schemaVersion !== PENDING_ABILITY_CONTINUATION_SCHEMA_VERSION || input.kind !== 'abilityspec-v1') {
    fail('unsupported-schema-version', path, 'has an unsupported continuation.')
  }
  if (!Array.isArray(input.choiceBindings)
    || input.choiceBindings.length > PENDING_ABILITY_RESOLUTION_LIMITS.choiceBindings) {
    fail('limit-exceeded', `${path}.choiceBindings`, 'must be bounded.')
  }
  const choiceBindings = (input.choiceBindings as readonly unknown[]).map((entry, index): PendingAbilityChoiceBinding => {
    const bindingPath = `${path}.choiceBindings[${index}]`
    const binding = record(entry, bindingPath)
    exact(binding, BINDING_FIELDS, bindingPath)
    return Object.freeze({
      declarationId: stableId(binding.declarationId, `${bindingPath}.declarationId`),
      optionIds: stringIds(
        binding.optionIds,
        `${bindingPath}.optionIds`,
        PENDING_ABILITY_RESOLUTION_LIMITS.optionIdsPerBinding,
      ),
    })
  })
  if (new Set(choiceBindings.map(binding => binding.declarationId)).size !== choiceBindings.length) {
    fail('duplicate-id', `${path}.choiceBindings`, 'must not repeat declarations.')
  }
  return Object.freeze({
    schemaVersion: PENDING_ABILITY_CONTINUATION_SCHEMA_VERSION,
    kind: 'abilityspec-v1',
    phase: phase(input.phase, `${path}.phase`),
    phaseIndex: integer(input.phaseIndex, `${path}.phaseIndex`, ABILITY_SPEC_PHASES.length - 1),
    operationIndex: integer(input.operationIndex, `${path}.operationIndex`, 512),
    completedOperationIds: stringIds(
      input.completedOperationIds,
      `${path}.completedOperationIds`,
      PENDING_ABILITY_RESOLUTION_LIMITS.completedOperations,
    ),
    choiceBindings: Object.freeze(choiceBindings),
    chainId: stableId(input.chainId, `${path}.chainId`),
    triggerId: stableId(input.triggerId, `${path}.triggerId`),
  })
}

export const parsePendingAbilityResolution = (value: unknown): PendingAbilityResolution => {
  const input = record(clone(value), 'pendingAbilityResolution')
  exact(input, ROOT_FIELDS, 'pendingAbilityResolution')
  if (input.schemaVersion !== PENDING_ABILITY_RESOLUTION_SCHEMA_VERSION) {
    fail('unsupported-schema-version', 'pendingAbilityResolution.schemaVersion', 'is unsupported.')
  }
  if (input.kind !== 'pending-ability-resolution' || input.status !== 'pending') {
    fail('invalid-pending-resolution', 'pendingAbilityResolution', 'must be a pending ability resolution.')
  }
  if (typeof input.requestSha256 !== 'string' || !SHA256_PATTERN.test(input.requestSha256)) {
    fail('invalid-pending-resolution', 'pendingAbilityResolution.requestSha256', 'must be SHA-256.')
  }
  if (!isSlug(input.mapSlug)) fail('invalid-pending-resolution', 'pendingAbilityResolution.mapSlug', 'must be a slug.')
  const previousRevision = integer(input.previousRevision, 'pendingAbilityResolution.previousRevision')
  const revision = integer(input.revision, 'pendingAbilityResolution.revision')
  const createdAt = integer(input.createdAt, 'pendingAbilityResolution.createdAt')
  const updatedAt = integer(input.updatedAt, 'pendingAbilityResolution.updatedAt')
  const expiresAt = input.expiresAt === null ? null : integer(input.expiresAt, 'pendingAbilityResolution.expiresAt')
  const trigger = parseTrigger(input.trigger)
  const pendingPhase = phase(input.phase, 'pendingAbilityResolution.phase')
  const readSet = parseReadSet(input.readSet)
  const window = parseWindow(input.window)
  const trace = parseAbilityResolutionTrace(input.trace)
  const rollLedger = parseAbilityAutomationRollLedger(input.rollLedger, 'pendingAbilityResolution.rollLedger')
  const continuation = parseContinuation(input.continuation)
  const mapRead = readSet.find(read => read.kind === 'map' && read.slug === input.mapSlug)
  if (revision !== previousRevision + 1 || updatedAt < createdAt
    || (expiresAt !== null && expiresAt <= updatedAt)
    || !mapRead || mapRead.revision !== revision
    || window.phase !== pendingPhase || continuation.phase !== pendingPhase
    || continuation.phaseIndex !== ABILITY_SPEC_PHASES.indexOf(pendingPhase)
    || continuation.chainId !== trigger.chainId || continuation.triggerId !== trigger.triggerId
    || window.options.some(option => option.operationIds.some(operationId => (
      continuation.completedOperationIds.includes(operationId)
    )))
    || trace.resolutionId !== input.resolutionId
    || trace.program.canonicalId !== trigger.canonicalId
    || trace.program.modeId !== trigger.modeId
    || trace.program.runtimeVersion !== trigger.runtimeVersion
    || trace.program.definitionHash !== trigger.definitionHash
    || trace.program.sourceModule !== trigger.sourceModule
    || stableJsonStringify(abilityResolutionTraceRollLedger(trace)) !== stableJsonStringify(rollLedger)) {
    fail('inconsistent-pending-resolution', 'pendingAbilityResolution', 'runtime, revision, phase, read, trace, roll, or continuation facts disagree.')
  }
  return deepFreezeStrictJson({
    schemaVersion: PENDING_ABILITY_RESOLUTION_SCHEMA_VERSION,
    kind: 'pending-ability-resolution',
    status: 'pending',
    resolutionId: stableId(input.resolutionId, 'pendingAbilityResolution.resolutionId'),
    operationId: stableId(input.operationId, 'pendingAbilityResolution.operationId'),
    requestSha256: input.requestSha256,
    mapSlug: input.mapSlug,
    previousRevision,
    revision,
    createdAt,
    updatedAt,
    expiresAt,
    trigger,
    phase: pendingPhase,
    readSet,
    window,
    trace,
    rollLedger,
    continuation,
  }) as PendingAbilityResolution
}

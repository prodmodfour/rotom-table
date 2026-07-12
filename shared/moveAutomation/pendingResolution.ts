import {
  isLivePlayOpId,
  type LivePlayCommandAccepted,
  type LivePlayOpId,
} from '../livePlayCommands'
import { isSlug } from '../paths'
import { isPlayerProfileId } from '../playerProfiles'
import { isSheetKind, type SheetKind } from '../sheets'
import { isEncounterSideId } from './encounterState'
import {
  MoveAutomationRollLedgerValidationError,
  parseMoveAutomationRollLedger,
  type MoveAutomationRollLedgerEntry,
} from './random'
import {
  MOVE_SPEC_PHASES,
  type MoveSpecPhase,
} from './spec'
import {
  MOVE_RESOLUTION_TRACE_LIMITS,
  MoveResolutionTraceValidationError,
  parseMoveResolutionAuditTrace,
  type MoveResolutionAuditTrace,
  type MoveResolutionTraceAncestryEntry,
} from './trace'

/**
 * Durable server-owned state for one MoveSpec execution suspended on a human
 * response. This is storage data, not a client command or an executable plan.
 */
export const PENDING_MOVE_RESOLUTION_SCHEMA_VERSION = 1 as const

export const PENDING_MOVE_RESOLUTION_STATUSES = [
  'pending',
  'resuming',
  'committed',
  'cancelled',
  'expired',
  'conflicted',
  'abandoned',
] as const

export const PENDING_MOVE_RESOLUTION_TERMINAL_STATUSES = [
  'committed',
  'cancelled',
  'expired',
  'conflicted',
  'abandoned',
] as const

export const PENDING_MOVE_RESOLUTION_RESOURCE_KINDS = [
  'map',
  'sheet',
  'group-inventory',
] as const

export const PENDING_MOVE_RESPONSE_WINDOW_KINDS = [
  'choice',
  'reaction',
] as const

/**
 * Actor and target are server-resolved roles. Placement, profile, and side are
 * concrete authorization principals. GM deliberately carries no client data.
 */
export const PENDING_MOVE_RESPONSE_OWNER_KINDS = [
  'actor',
  'target',
  'placement',
  'profile',
  'side',
  'gm',
] as const

export const PENDING_MOVE_RESOLUTION_LIMITS = Object.freeze({
  identifierChars: 160,
  placementIdChars: 200,
  canonicalMoveChars: 160,
  resourceReads: 512,
  responseWindows: 64,
  ownersPerWindow: 64,
  optionsPerWindow: 64,
  chosenOptions: 256,
  reactionPriorityMagnitude: 1_000,
  jsonDepth: 24,
  jsonNodes: 131_072,
  jsonObjectFields: 128,
  jsonArrayEntries: MOVE_RESOLUTION_TRACE_LIMITS.auditEvents,
  jsonStringChars: 500,
})

export type PendingMoveResolutionStatus =
  (typeof PENDING_MOVE_RESOLUTION_STATUSES)[number]
export type PendingMoveResolutionTerminalStatus =
  (typeof PENDING_MOVE_RESOLUTION_TERMINAL_STATUSES)[number]
export type PendingMoveResolutionResourceKind =
  (typeof PENDING_MOVE_RESOLUTION_RESOURCE_KINDS)[number]
export type PendingMoveResponseWindowKind =
  (typeof PENDING_MOVE_RESPONSE_WINDOW_KINDS)[number]
export type PendingMoveResponseOwnerKind =
  (typeof PENDING_MOVE_RESPONSE_OWNER_KINDS)[number]

export interface PendingMoveResolutionMapRead {
  readonly kind: 'map'
  readonly slug: string
  readonly revision: number
}

export interface PendingMoveResolutionSheetRead {
  readonly kind: 'sheet'
  readonly sheetKind: SheetKind
  readonly slug: string
  readonly revision: number
}

export interface PendingMoveResolutionGroupInventoryRead {
  readonly kind: 'group-inventory'
  readonly slug: string
  readonly revision: number
}

/** Every authoritative resource consulted before suspension, including read-only resources. */
export type PendingMoveResolutionResourceRead =
  | PendingMoveResolutionMapRead
  | PendingMoveResolutionSheetRead
  | PendingMoveResolutionGroupInventoryRead

export interface PendingMoveResponseOwner {
  readonly kind: PendingMoveResponseOwnerKind
  /** Null only for the current actor role and authorized-GM role. */
  readonly id: string | null
}

/** Presentation lookup only. Mechanics remain in the reviewed server definition. */
export interface PendingMoveResponseOption {
  readonly id: string
  readonly labelKey: string
}

export interface PendingMoveResponseWindow {
  readonly windowId: string
  readonly operationId: string
  readonly kind: PendingMoveResponseWindowKind
  readonly phase: MoveSpecPhase
  readonly reasonCode: string
  readonly promptKey: string
  readonly ownership: readonly PendingMoveResponseOwner[]
  readonly options: readonly PendingMoveResponseOption[]
  readonly allowPass: boolean
  /** Null for ordinary choices; server-authored and bounded for reactions. */
  readonly priority: number | null
}

export interface PendingMoveResolutionChosenOption {
  readonly windowId: string
  /** The idempotency identity of the accepted response command. */
  readonly responseOpId: LivePlayOpId
  /** Null records an authorized pass. */
  readonly optionId: string | null
  readonly chosenBy: PendingMoveResponseOwner
  readonly chosenAt: number
}

/**
 * Map-visible state intentionally omits option IDs, ownership, rolls, reads,
 * response operation IDs, and trace data. Eligible viewers fetch window detail
 * through an authorization boundary rather than reconstructing it from here.
 */
export interface PendingMoveResolutionPublicSummary {
  readonly schemaVersion: typeof PENDING_MOVE_RESOLUTION_SCHEMA_VERSION
  readonly resolutionId: string
  readonly actorPlacementId: string
  readonly canonicalMoveId: string
  readonly phase: MoveSpecPhase
  readonly status: PendingMoveResolutionStatus
  readonly outstandingWindowCount: number
  readonly createdAt: number
  readonly updatedAt: number
}

/**
 * Non-terminal acknowledgement for a declaration that durably suspended.
 * It deliberately remains outside `live_play_ops` even though its revision
 * and patch envelope match ordinary accepted map-command responses.
 */
export interface PendingMoveDeclarationResult extends LivePlayCommandAccepted {
  readonly pending: true
  readonly pendingResolution: PendingMoveResolutionPublicSummary
}

export interface PendingMoveResolution {
  readonly schemaVersion: typeof PENDING_MOVE_RESOLUTION_SCHEMA_VERSION
  readonly resolutionId: string
  readonly originMapSlug: string
  readonly originOpId: LivePlayOpId
  readonly actorPlacementId: string
  readonly canonicalMoveId: string
  readonly specVersion: number
  readonly specHash: string
  readonly rulesetId: string
  readonly rulesetHash: string
  readonly phase: MoveSpecPhase
  readonly readSet: readonly PendingMoveResolutionResourceRead[]
  readonly trace: MoveResolutionAuditTrace
  readonly rollLedger: readonly MoveAutomationRollLedgerEntry[]
  readonly outstandingWindows: readonly PendingMoveResponseWindow[]
  readonly chosenOptions: readonly PendingMoveResolutionChosenOption[]
  readonly causalAncestry: readonly MoveResolutionTraceAncestryEntry[]
  readonly status: PendingMoveResolutionStatus
  readonly createdAt: number
  readonly updatedAt: number
  readonly publicSummary: PendingMoveResolutionPublicSummary
}

export type PendingMoveResolutionValidationCode =
  | 'invalid-pending-resolution'
  | 'unsupported-schema-version'
  | 'unknown-status'
  | 'limit-exceeded'
  | 'not-json'
  | 'duplicate-id'
  | 'inconsistent-state'

export class PendingMoveResolutionValidationError extends Error {
  readonly code: PendingMoveResolutionValidationCode
  readonly path: string
  readonly detail: string

  constructor(
    code: PendingMoveResolutionValidationCode,
    path: string,
    detail: string,
  ) {
    super(`${path}: ${detail}`)
    this.name = 'PendingMoveResolutionValidationError'
    this.code = code
    this.path = path
    this.detail = detail
  }
}

type UnknownRecord = Record<string, unknown>
type DetachedJson =
  | null
  | boolean
  | number
  | string
  | readonly DetachedJson[]
  | { readonly [key: string]: DetachedJson }
type JsonCloneState = {
  readonly ancestors: WeakSet<object>
  nodes: number
}

const ROOT_FIELDS = [
  'schemaVersion',
  'resolutionId',
  'originMapSlug',
  'originOpId',
  'actorPlacementId',
  'canonicalMoveId',
  'specVersion',
  'specHash',
  'rulesetId',
  'rulesetHash',
  'phase',
  'readSet',
  'trace',
  'rollLedger',
  'outstandingWindows',
  'chosenOptions',
  'causalAncestry',
  'status',
  'createdAt',
  'updatedAt',
  'publicSummary',
] as const
const MAP_READ_FIELDS = ['kind', 'slug', 'revision'] as const
const SHEET_READ_FIELDS = ['kind', 'sheetKind', 'slug', 'revision'] as const
const GROUP_INVENTORY_READ_FIELDS = ['kind', 'slug', 'revision'] as const
const OWNER_FIELDS = ['kind', 'id'] as const
const OPTION_FIELDS = ['id', 'labelKey'] as const
const WINDOW_FIELDS = [
  'windowId',
  'operationId',
  'kind',
  'phase',
  'reasonCode',
  'promptKey',
  'ownership',
  'options',
  'allowPass',
  'priority',
] as const
const CHOSEN_OPTION_FIELDS = [
  'windowId',
  'responseOpId',
  'optionId',
  'chosenBy',
  'chosenAt',
] as const
const ANCESTRY_FIELDS = [
  'depth',
  'resolutionId',
  'canonicalId',
  'definitionHash',
  'parentOperationId',
] as const
const PUBLIC_SUMMARY_FIELDS = [
  'schemaVersion',
  'resolutionId',
  'actorPlacementId',
  'canonicalMoveId',
  'phase',
  'status',
  'outstandingWindowCount',
  'createdAt',
  'updatedAt',
] as const

const STABLE_ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/
const ARRAY_INDEX_PATTERN = /^(0|[1-9][0-9]*)$/
const STATUS_SET = new Set<string>(PENDING_MOVE_RESOLUTION_STATUSES)
const TERMINAL_STATUS_SET = new Set<string>(PENDING_MOVE_RESOLUTION_TERMINAL_STATUSES)
const RESOURCE_KIND_SET = new Set<string>(PENDING_MOVE_RESOLUTION_RESOURCE_KINDS)
const WINDOW_KIND_SET = new Set<string>(PENDING_MOVE_RESPONSE_WINDOW_KINDS)
const OWNER_KIND_SET = new Set<string>(PENDING_MOVE_RESPONSE_OWNER_KINDS)
const PHASE_SET = new Set<string>(MOVE_SPEC_PHASES)
const RESOURCE_KIND_ORDER = new Map<string, number>(
  PENDING_MOVE_RESOLUTION_RESOURCE_KINDS.map((kind, index) => [kind, index]),
)
const OWNER_KIND_ORDER = new Map<string, number>(
  PENDING_MOVE_RESPONSE_OWNER_KINDS.map((kind, index) => [kind, index]),
)

const fail = (
  code: PendingMoveResolutionValidationCode,
  path: string,
  detail: string,
): never => {
  throw new PendingMoveResolutionValidationError(code, path, detail)
}

const isPlainRecord = (value: unknown): value is UnknownRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const clonePlainJson = (
  value: unknown,
  path: string,
  depth: number,
  state: JsonCloneState,
): DetachedJson => {
  state.nodes += 1
  if (state.nodes > PENDING_MOVE_RESOLUTION_LIMITS.jsonNodes) {
    fail(
      'limit-exceeded',
      path,
      `pending resolution data must contain at most ${PENDING_MOVE_RESOLUTION_LIMITS.jsonNodes} JSON nodes.`,
    )
  }
  if (depth > PENDING_MOVE_RESOLUTION_LIMITS.jsonDepth) {
    fail(
      'limit-exceeded',
      path,
      `must be at most ${PENDING_MOVE_RESOLUTION_LIMITS.jsonDepth} levels deep.`,
    )
  }

  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('not-json', path, 'non-finite numbers are not JSON values.')
    return value
  }
  if (typeof value === 'string') {
    if (value.length > PENDING_MOVE_RESOLUTION_LIMITS.jsonStringChars) {
      fail(
        'limit-exceeded',
        path,
        `must contain at most ${PENDING_MOVE_RESOLUTION_LIMITS.jsonStringChars} characters.`,
      )
    }
    return value
  }
  if (
    value === undefined
    || typeof value === 'bigint'
    || typeof value === 'function'
    || typeof value === 'symbol'
  ) {
    return fail('not-json', path, `${typeof value} values are not allowed.`)
  }

  if (Array.isArray(value)) {
    if (state.ancestors.has(value)) fail('not-json', path, 'circular references are not allowed.')
    if (value.length > PENDING_MOVE_RESOLUTION_LIMITS.jsonArrayEntries) {
      fail(
        'limit-exceeded',
        path,
        `must contain at most ${PENDING_MOVE_RESOLUTION_LIMITS.jsonArrayEntries} entries.`,
      )
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      fail('not-json', path, 'symbol properties are not allowed.')
    }
    for (const key of Object.getOwnPropertyNames(value)) {
      if (key === 'length') continue
      const index = Number(key)
      if (!ARRAY_INDEX_PATTERN.test(key) || !Number.isSafeInteger(index) || index >= value.length) {
        fail('not-json', `${path}.${key}`, 'arrays cannot contain named properties.')
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
        ?? fail('not-json', `${path}[${key}]`, 'must have a property descriptor.')
      if (!descriptor.enumerable || !('value' in descriptor)) {
        fail('not-json', `${path}[${key}]`, 'entries must be enumerable data properties.')
      }
    }

    state.ancestors.add(value)
    const clone: DetachedJson[] = []
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) {
        fail('not-json', `${path}[${index}]`, 'sparse arrays are not allowed.')
      }
      clone.push(clonePlainJson(value[index], `${path}[${index}]`, depth + 1, state))
    }
    state.ancestors.delete(value)
    return clone
  }

  if (!isPlainRecord(value)) {
    return fail('not-json', path, 'must contain only plain JSON objects.')
  }
  if (state.ancestors.has(value)) fail('not-json', path, 'circular references are not allowed.')
  if (Object.getOwnPropertySymbols(value).length > 0) {
    fail('not-json', path, 'symbol properties are not allowed.')
  }
  const keys = Object.getOwnPropertyNames(value)
  if (keys.length > PENDING_MOVE_RESOLUTION_LIMITS.jsonObjectFields) {
    fail(
      'limit-exceeded',
      path,
      `must contain at most ${PENDING_MOVE_RESOLUTION_LIMITS.jsonObjectFields} fields.`,
    )
  }

  state.ancestors.add(value)
  const clone: Record<string, DetachedJson> = {}
  for (const key of keys) {
    if (
      key.length === 0
      || key.length > PENDING_MOVE_RESOLUTION_LIMITS.identifierChars
      || CONTROL_CHARACTER_PATTERN.test(key)
    ) {
      fail('not-json', `${path}.${key}`, 'object keys must be bounded and free of control characters.')
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
      ?? fail('not-json', `${path}.${key}`, 'must have a property descriptor.')
    if (!descriptor.enumerable || !('value' in descriptor)) {
      fail('not-json', `${path}.${key}`, 'fields must be enumerable data properties.')
    }
    Object.defineProperty(clone, key, {
      value: clonePlainJson(descriptor.value, `${path}.${key}`, depth + 1, state),
      enumerable: true,
      configurable: true,
      writable: true,
    })
  }
  state.ancestors.delete(value)
  return clone
}

const detachedJson = (value: unknown, path: string): DetachedJson => clonePlainJson(
  value,
  path,
  0,
  { ancestors: new WeakSet<object>(), nodes: 0 },
)

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

const parseRecord = (value: unknown, path: string): UnknownRecord => {
  if (!isPlainRecord(value)) {
    return fail('invalid-pending-resolution', path, 'must be a plain object.')
  }
  return value
}

const assertExactFields = (
  record: UnknownRecord,
  fields: readonly string[],
  path: string,
): void => {
  const expected = new Set(fields)
  const missing = fields.filter(field => !Object.prototype.hasOwnProperty.call(record, field))
  const unknown = Object.keys(record).filter(field => !expected.has(field))
  if (missing.length === 0 && unknown.length === 0) return
  const detail = [
    missing.length > 0 ? `missing ${missing.join(', ')}` : '',
    unknown.length > 0 ? `unknown ${unknown.join(', ')}` : '',
  ].filter(Boolean).join('; ')
  fail(
    'invalid-pending-resolution',
    path,
    `must contain exactly the supported fields (${detail}).`,
  )
}

const parseExactRecord = (
  value: unknown,
  fields: readonly string[],
  path: string,
): UnknownRecord => {
  const record = parseRecord(value, path)
  assertExactFields(record, fields, path)
  return record
}

const parseBoundedArray = (
  value: unknown,
  path: string,
  maximum: number,
): readonly unknown[] => {
  if (!Array.isArray(value)) {
    return fail('invalid-pending-resolution', path, 'must be an array.')
  }
  if (value.length > maximum) {
    fail('limit-exceeded', path, `must contain at most ${maximum} entries.`)
  }
  return value
}

const parseBoundedText = (
  value: unknown,
  path: string,
  maximum: number,
): string => {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.trim() !== value
    || CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    return fail(
      'invalid-pending-resolution',
      path,
      'must be a non-empty, trimmed string without control characters.',
    )
  }
  if (value.length > maximum) {
    fail('limit-exceeded', path, `must contain at most ${maximum} characters.`)
  }
  return value
}

const parseStableId = (value: unknown, path: string): string => {
  const id = parseBoundedText(value, path, PENDING_MOVE_RESOLUTION_LIMITS.identifierChars)
  if (!STABLE_ID_PATTERN.test(id)) {
    fail('invalid-pending-resolution', path, 'must be a lowercase stable identifier.')
  }
  return id
}

const parsePlacementId = (value: unknown, path: string): string => parseBoundedText(
  value,
  path,
  PENDING_MOVE_RESOLUTION_LIMITS.placementIdChars,
)

const parseCanonicalMoveId = (value: unknown, path: string): string => parseBoundedText(
  value,
  path,
  PENDING_MOVE_RESOLUTION_LIMITS.canonicalMoveChars,
)

const parseSha256 = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    return fail('invalid-pending-resolution', path, 'must be a lowercase SHA-256 digest.')
  }
  return value
}

const parseInteger = (
  value: unknown,
  path: string,
  minimum: number,
  maximum: number,
): number => {
  if (!Number.isSafeInteger(value)) {
    return fail('invalid-pending-resolution', path, 'must be a safe integer.')
  }
  const parsed = Number(value)
  if (parsed < minimum || parsed > maximum) {
    fail('limit-exceeded', path, `must be from ${minimum} through ${maximum}.`)
  }
  return parsed
}

const parseTimestamp = (value: unknown, path: string): number => parseInteger(
  value,
  path,
  0,
  Number.MAX_SAFE_INTEGER,
)

const parseBoolean = (value: unknown, path: string): boolean => {
  if (typeof value !== 'boolean') {
    return fail('invalid-pending-resolution', path, 'must be boolean.')
  }
  return value
}

const parsePhase = (value: unknown, path: string): MoveSpecPhase => {
  if (typeof value !== 'string' || !PHASE_SET.has(value)) {
    return fail('invalid-pending-resolution', path, 'must be a supported MoveSpec phase.')
  }
  return value as MoveSpecPhase
}

const parseStatus = (value: unknown, path: string): PendingMoveResolutionStatus => {
  if (typeof value !== 'string' || !STATUS_SET.has(value)) {
    return fail(
      'unknown-status',
      path,
      `must be one of ${PENDING_MOVE_RESOLUTION_STATUSES.join(', ')}.`,
    )
  }
  return value as PendingMoveResolutionStatus
}

const parseOriginMapSlug = (value: unknown, path: string): string => {
  const slug = parseBoundedText(value, path, PENDING_MOVE_RESOLUTION_LIMITS.identifierChars)
  if (!isSlug(slug)) {
    fail('invalid-pending-resolution', path, 'must be a lowercase map slug.')
  }
  return slug
}

const parseOriginOpId = (value: unknown, path: string): LivePlayOpId => {
  if (!isLivePlayOpId(value)) {
    return fail('invalid-pending-resolution', path, 'must be a valid live-play operation ID.')
  }
  return value
}

const resourceReadKey = (read: PendingMoveResolutionResourceRead): string => {
  if (read.kind === 'sheet') return `${read.kind}:${read.sheetKind}:${read.slug}`
  return `${read.kind}:${read.slug}`
}

const parseResourceRead = (
  value: unknown,
  path: string,
): PendingMoveResolutionResourceRead => {
  const record = parseRecord(value, path)
  if (typeof record.kind !== 'string' || !RESOURCE_KIND_SET.has(record.kind)) {
    return fail(
      'invalid-pending-resolution',
      `${path}.kind`,
      'must be map, sheet, or group-inventory.',
    )
  }
  if (record.kind === 'map') {
    assertExactFields(record, MAP_READ_FIELDS, path)
    return {
      kind: 'map',
      slug: parseOriginMapSlug(record.slug, `${path}.slug`),
      revision: parseInteger(record.revision, `${path}.revision`, 0, Number.MAX_SAFE_INTEGER),
    }
  }
  if (record.kind === 'sheet') {
    assertExactFields(record, SHEET_READ_FIELDS, path)
    if (!isSheetKind(record.sheetKind)) {
      fail('invalid-pending-resolution', `${path}.sheetKind`, 'must be pokemon or trainer.')
    }
    return {
      kind: 'sheet',
      sheetKind: record.sheetKind as SheetKind,
      slug: parseOriginMapSlug(record.slug, `${path}.slug`),
      revision: parseInteger(record.revision, `${path}.revision`, 0, Number.MAX_SAFE_INTEGER),
    }
  }
  assertExactFields(record, GROUP_INVENTORY_READ_FIELDS, path)
  return {
    kind: 'group-inventory',
    slug: parseOriginMapSlug(record.slug, `${path}.slug`),
    revision: parseInteger(record.revision, `${path}.revision`, 0, Number.MAX_SAFE_INTEGER),
  }
}

const compareResourceReads = (
  left: PendingMoveResolutionResourceRead,
  right: PendingMoveResolutionResourceRead,
): number => {
  const kindOrder = (RESOURCE_KIND_ORDER.get(left.kind) ?? 0)
    - (RESOURCE_KIND_ORDER.get(right.kind) ?? 0)
  if (kindOrder !== 0) return kindOrder
  return resourceReadKey(left).localeCompare(resourceReadKey(right))
}

const parseReadSet = (
  value: unknown,
  originMapSlug: string,
  path: string,
): readonly PendingMoveResolutionResourceRead[] => {
  const reads = parseBoundedArray(
    value,
    path,
    PENDING_MOVE_RESOLUTION_LIMITS.resourceReads,
  ).map((entry, index) => parseResourceRead(entry, `${path}[${index}]`))
  const keys = new Set<string>()
  for (const [index, read] of reads.entries()) {
    const key = resourceReadKey(read)
    if (keys.has(key)) {
      fail('duplicate-id', `${path}[${index}]`, `duplicates authoritative resource ${key}.`)
    }
    keys.add(key)
  }
  const mapReads = reads.filter(
    (read): read is PendingMoveResolutionMapRead => read.kind === 'map',
  )
  if (mapReads.length !== 1 || mapReads[0]?.slug !== originMapSlug) {
    fail(
      'inconsistent-state',
      path,
      `must contain exactly one map read for originating map ${originMapSlug}.`,
    )
  }
  return [...reads].sort(compareResourceReads)
}

const parseOwner = (value: unknown, path: string): PendingMoveResponseOwner => {
  const record = parseExactRecord(value, OWNER_FIELDS, path)
  if (typeof record.kind !== 'string' || !OWNER_KIND_SET.has(record.kind)) {
    fail('invalid-pending-resolution', `${path}.kind`, 'must be a supported response owner kind.')
  }
  const kind = record.kind as PendingMoveResponseOwnerKind
  if (kind === 'actor' || kind === 'gm') {
    if (record.id !== null) {
      fail('invalid-pending-resolution', `${path}.id`, `must be null for ${kind} ownership.`)
    }
    return { kind, id: null }
  }
  const ownerId = record.id
  if (ownerId === null) {
    fail('invalid-pending-resolution', `${path}.id`, `must identify the ${kind} owner.`)
  }
  if (kind === 'profile') {
    const profileId = isPlayerProfileId(ownerId)
      ? ownerId
      : fail('invalid-pending-resolution', `${path}.id`, 'must identify a valid player profile owner.')
    return { kind, id: profileId }
  }
  if (kind === 'side') {
    const sideId = isEncounterSideId(ownerId)
      ? ownerId
      : fail('invalid-pending-resolution', `${path}.id`, 'must identify a valid encounter side owner.')
    return { kind, id: sideId }
  }
  return {
    kind,
    id: parsePlacementId(ownerId, `${path}.id`),
  }
}

const ownerKey = (owner: PendingMoveResponseOwner): string => `${owner.kind}:${owner.id ?? ''}`

const compareOwners = (
  left: PendingMoveResponseOwner,
  right: PendingMoveResponseOwner,
): number => {
  const kindOrder = (OWNER_KIND_ORDER.get(left.kind) ?? 0)
    - (OWNER_KIND_ORDER.get(right.kind) ?? 0)
  if (kindOrder !== 0) return kindOrder
  return ownerKey(left).localeCompare(ownerKey(right))
}

const parseOwnership = (
  value: unknown,
  path: string,
): readonly PendingMoveResponseOwner[] => {
  const ownership = parseBoundedArray(
    value,
    path,
    PENDING_MOVE_RESOLUTION_LIMITS.ownersPerWindow,
  ).map((entry, index) => parseOwner(entry, `${path}[${index}]`))
  if (ownership.length === 0) {
    fail('invalid-pending-resolution', path, 'must contain at least one response owner.')
  }
  const seen = new Set<string>()
  for (const [index, owner] of ownership.entries()) {
    const key = ownerKey(owner)
    if (seen.has(key)) fail('duplicate-id', `${path}[${index}]`, `duplicates owner ${key}.`)
    seen.add(key)
  }
  return [...ownership].sort(compareOwners)
}

const parseOptions = (
  value: unknown,
  path: string,
): readonly PendingMoveResponseOption[] => {
  const options = parseBoundedArray(
    value,
    path,
    PENDING_MOVE_RESOLUTION_LIMITS.optionsPerWindow,
  ).map((entry, index): PendingMoveResponseOption => {
    const optionPath = `${path}[${index}]`
    const record = parseExactRecord(entry, OPTION_FIELDS, optionPath)
    return {
      id: parseStableId(record.id, `${optionPath}.id`),
      labelKey: parseStableId(record.labelKey, `${optionPath}.labelKey`),
    }
  })
  if (options.length === 0) {
    fail('invalid-pending-resolution', path, 'must contain at least one option.')
  }
  const seen = new Set<string>()
  for (const [index, option] of options.entries()) {
    if (seen.has(option.id)) {
      fail('duplicate-id', `${path}[${index}].id`, `duplicates option ${option.id}.`)
    }
    seen.add(option.id)
  }
  return options
}

const parseWindow = (value: unknown, path: string): PendingMoveResponseWindow => {
  const record = parseExactRecord(value, WINDOW_FIELDS, path)
  if (typeof record.kind !== 'string' || !WINDOW_KIND_SET.has(record.kind)) {
    fail('invalid-pending-resolution', `${path}.kind`, 'must be choice or reaction.')
  }
  const kind = record.kind as PendingMoveResponseWindowKind
  let priority: number | null = null
  if (kind === 'reaction') {
    priority = parseInteger(
      record.priority,
      `${path}.priority`,
      -PENDING_MOVE_RESOLUTION_LIMITS.reactionPriorityMagnitude,
      PENDING_MOVE_RESOLUTION_LIMITS.reactionPriorityMagnitude,
    )
  }
  else if (record.priority !== null) {
    fail('invalid-pending-resolution', `${path}.priority`, 'must be null for a choice window.')
  }

  return {
    windowId: parseStableId(record.windowId, `${path}.windowId`),
    operationId: parseStableId(record.operationId, `${path}.operationId`),
    kind,
    phase: parsePhase(record.phase, `${path}.phase`),
    reasonCode: parseStableId(record.reasonCode, `${path}.reasonCode`),
    promptKey: parseStableId(record.promptKey, `${path}.promptKey`),
    ownership: parseOwnership(record.ownership, `${path}.ownership`),
    options: parseOptions(record.options, `${path}.options`),
    allowPass: parseBoolean(record.allowPass, `${path}.allowPass`),
    priority,
  }
}

const parseWindows = (
  value: unknown,
  path: string,
): readonly PendingMoveResponseWindow[] => {
  const windows = parseBoundedArray(
    value,
    path,
    PENDING_MOVE_RESOLUTION_LIMITS.responseWindows,
  ).map((entry, index) => parseWindow(entry, `${path}[${index}]`))
  const seen = new Set<string>()
  for (const [index, window] of windows.entries()) {
    if (seen.has(window.windowId)) {
      fail('duplicate-id', `${path}[${index}].windowId`, `duplicates window ${window.windowId}.`)
    }
    seen.add(window.windowId)
  }
  return windows
}

const parseChosenOptions = (
  value: unknown,
  createdAt: number,
  updatedAt: number,
  path: string,
): readonly PendingMoveResolutionChosenOption[] => {
  const chosen = parseBoundedArray(
    value,
    path,
    PENDING_MOVE_RESOLUTION_LIMITS.chosenOptions,
  ).map((entry, index): PendingMoveResolutionChosenOption => {
    const entryPath = `${path}[${index}]`
    const record = parseExactRecord(entry, CHOSEN_OPTION_FIELDS, entryPath)
    return {
      windowId: parseStableId(record.windowId, `${entryPath}.windowId`),
      responseOpId: parseOriginOpId(record.responseOpId, `${entryPath}.responseOpId`),
      optionId: record.optionId === null
        ? null
        : parseStableId(record.optionId, `${entryPath}.optionId`),
      chosenBy: parseOwner(record.chosenBy, `${entryPath}.chosenBy`),
      chosenAt: parseTimestamp(record.chosenAt, `${entryPath}.chosenAt`),
    }
  })
  const windowIds = new Set<string>()
  const operationIds = new Set<string>()
  let previousTimestamp = createdAt
  for (const [index, choice] of chosen.entries()) {
    const entryPath = `${path}[${index}]`
    if (windowIds.has(choice.windowId)) {
      fail('duplicate-id', `${entryPath}.windowId`, `duplicates chosen window ${choice.windowId}.`)
    }
    if (operationIds.has(choice.responseOpId)) {
      fail(
        'duplicate-id',
        `${entryPath}.responseOpId`,
        `duplicates response operation ${choice.responseOpId}.`,
      )
    }
    if (choice.chosenAt < previousTimestamp || choice.chosenAt > updatedAt) {
      fail(
        'inconsistent-state',
        `${entryPath}.chosenAt`,
        'must be chronological and between the resolution timestamps.',
      )
    }
    windowIds.add(choice.windowId)
    operationIds.add(choice.responseOpId)
    previousTimestamp = choice.chosenAt
  }
  return chosen
}

const parseCausalAncestry = (
  value: unknown,
  path: string,
): readonly MoveResolutionTraceAncestryEntry[] => {
  const resolutionIds = new Set<string>()
  return parseBoundedArray(
    value,
    path,
    MOVE_RESOLUTION_TRACE_LIMITS.ancestryDepth,
  ).map((entry, index): MoveResolutionTraceAncestryEntry => {
    const entryPath = `${path}[${index}]`
    const record = parseExactRecord(entry, ANCESTRY_FIELDS, entryPath)
    const depth = parseInteger(
      record.depth,
      `${entryPath}.depth`,
      0,
      MOVE_RESOLUTION_TRACE_LIMITS.ancestryDepth - 1,
    )
    if (depth !== index) {
      fail('inconsistent-state', `${entryPath}.depth`, `must equal ancestry index ${index}.`)
    }
    const resolutionId = parseBoundedText(
      record.resolutionId,
      `${entryPath}.resolutionId`,
      PENDING_MOVE_RESOLUTION_LIMITS.identifierChars,
    )
    if (resolutionIds.has(resolutionId)) {
      fail('duplicate-id', `${entryPath}.resolutionId`, `duplicates ${resolutionId}.`)
    }
    resolutionIds.add(resolutionId)
    return {
      depth,
      resolutionId,
      canonicalId: parseCanonicalMoveId(record.canonicalId, `${entryPath}.canonicalId`),
      definitionHash: parseSha256(record.definitionHash, `${entryPath}.definitionHash`),
      parentOperationId: record.parentOperationId === null
        ? null
        : parseStableId(record.parentOperationId, `${entryPath}.parentOperationId`),
    }
  })
}

const parseTrace = (value: unknown, path: string): MoveResolutionAuditTrace => {
  try {
    return parseMoveResolutionAuditTrace(value, path)
  }
  catch (error) {
    if (error instanceof MoveResolutionTraceValidationError) {
      const code: PendingMoveResolutionValidationCode = error.code === 'limit-exceeded'
        ? 'limit-exceeded'
        : error.code === 'not-json'
          ? 'not-json'
          : 'invalid-pending-resolution'
      return fail(code, error.path, error.message.replace(`${error.path}: `, ''))
    }
    throw error
  }
}

const parseRollLedger = (
  value: unknown,
  path: string,
): readonly MoveAutomationRollLedgerEntry[] => {
  try {
    return parseMoveAutomationRollLedger(value, path)
  }
  catch (error) {
    if (error instanceof MoveAutomationRollLedgerValidationError) {
      const code: PendingMoveResolutionValidationCode = error.code === 'limit-exceeded'
        ? 'limit-exceeded'
        : error.code === 'duplicate-roll-id'
          ? 'duplicate-id'
          : 'invalid-pending-resolution'
      return fail(code, error.path, error.message.replace(`${error.path}: `, ''))
    }
    throw error
  }
}

const parsePublicSummaryRecord = (
  value: unknown,
  path: string,
): PendingMoveResolutionPublicSummary => {
  const record = parseExactRecord(value, PUBLIC_SUMMARY_FIELDS, path)
  if (record.schemaVersion !== PENDING_MOVE_RESOLUTION_SCHEMA_VERSION) {
    fail(
      'unsupported-schema-version',
      `${path}.schemaVersion`,
      `must be ${PENDING_MOVE_RESOLUTION_SCHEMA_VERSION}.`,
    )
  }
  const createdAt = parseTimestamp(record.createdAt, `${path}.createdAt`)
  const updatedAt = parseTimestamp(record.updatedAt, `${path}.updatedAt`)
  if (updatedAt < createdAt) {
    fail('inconsistent-state', `${path}.updatedAt`, 'cannot precede createdAt.')
  }
  return {
    schemaVersion: PENDING_MOVE_RESOLUTION_SCHEMA_VERSION,
    resolutionId: parseBoundedText(
      record.resolutionId,
      `${path}.resolutionId`,
      PENDING_MOVE_RESOLUTION_LIMITS.identifierChars,
    ),
    actorPlacementId: parsePlacementId(record.actorPlacementId, `${path}.actorPlacementId`),
    canonicalMoveId: parseCanonicalMoveId(record.canonicalMoveId, `${path}.canonicalMoveId`),
    phase: parsePhase(record.phase, `${path}.phase`),
    status: parseStatus(record.status, `${path}.status`),
    outstandingWindowCount: parseInteger(
      record.outstandingWindowCount,
      `${path}.outstandingWindowCount`,
      0,
      PENDING_MOVE_RESOLUTION_LIMITS.responseWindows,
    ),
    createdAt,
    updatedAt,
  }
}

const sameJson = (left: unknown, right: unknown): boolean => (
  JSON.stringify(left) === JSON.stringify(right)
)

const assertTraceIdentity = (options: {
  readonly canonicalMoveId: string
  readonly specVersion: number
  readonly specHash: string
  readonly rulesetId: string
  readonly rulesetHash: string
  readonly phase: MoveSpecPhase
  readonly trace: MoveResolutionAuditTrace
  readonly rollLedger: readonly MoveAutomationRollLedgerEntry[]
  readonly causalAncestry: readonly MoveResolutionTraceAncestryEntry[]
  readonly path: string
}): void => {
  const { trace, path } = options
  if (
    trace.program.runtimeKind !== 'movespec-v2'
    || trace.program.canonicalId !== options.canonicalMoveId
    || trace.program.runtimeVersion !== options.specVersion
    || trace.program.definitionHash !== options.specHash
  ) {
    fail(
      'inconsistent-state',
      `${path}.trace.program`,
      'must match the suspended MoveSpec identity and hash.',
    )
  }
  if (
    trace.ruleset.rulesetId !== options.rulesetId
    || trace.ruleset.sourceDataSha256 !== options.rulesetHash
  ) {
    fail(
      'inconsistent-state',
      `${path}.trace.ruleset`,
      'must match the suspended ruleset identity and hash.',
    )
  }
  const activePhase = [...trace.events]
    .reverse()
    .find(event => event.kind === 'phase-transition')
  if (!activePhase || activePhase.kind !== 'phase-transition' || activePhase.to !== options.phase) {
    fail(
      'inconsistent-state',
      `${path}.phase`,
      'must match the last completed trace phase transition.',
    )
  }
  const tracedRolls = trace.events.flatMap(event => event.kind === 'roll' ? [event.roll] : [])
  if (!sameJson(tracedRolls, options.rollLedger)) {
    fail(
      'inconsistent-state',
      `${path}.rollLedger`,
      'must exactly match roll events in the completed trace.',
    )
  }
  if (!sameJson(trace.ancestry, options.causalAncestry)) {
    fail(
      'inconsistent-state',
      `${path}.causalAncestry`,
      'must exactly match the completed trace ancestry.',
    )
  }
}

const assertWindowTraceLinks = (
  windows: readonly PendingMoveResponseWindow[],
  trace: MoveResolutionAuditTrace,
  phase: MoveSpecPhase,
  path: string,
): void => {
  for (const [index, window] of windows.entries()) {
    const windowPath = `${path}.outstandingWindows[${index}]`
    if (window.phase !== phase) {
      fail('inconsistent-state', `${windowPath}.phase`, 'must match the suspended phase.')
    }
    const operationEvent = trace.events.find(event => (
      event.kind === 'operation'
      && event.operationId === window.operationId
      && event.outcome === 'pending'
    ))
    if (
      !operationEvent
      || operationEvent.kind !== 'operation'
      || operationEvent.phase !== window.phase
      || operationEvent.reasonCode !== window.reasonCode
    ) {
      fail(
        'inconsistent-state',
        windowPath,
        'must reference a matching pending operation in the completed trace.',
      )
    }
    const requestKind = window.kind === 'reaction' ? 'reaction' : 'choice'
    const choiceEvent = trace.events.find(event => (
      event.kind === 'choice'
      && event.requestId === window.windowId
      && event.outcome === 'requested'
    ))
    if (
      !choiceEvent
      || choiceEvent.kind !== 'choice'
      || choiceEvent.phase !== window.phase
      || choiceEvent.requestKind !== requestKind
      || choiceEvent.reasonCode !== window.reasonCode
    ) {
      fail(
        'inconsistent-state',
        `${windowPath}.windowId`,
        'must reference a matching requested response in the completed trace.',
      )
    }
  }
}

const assertChosenTraceLinks = (
  choices: readonly PendingMoveResolutionChosenOption[],
  trace: MoveResolutionAuditTrace,
  path: string,
): void => {
  for (const [index, choice] of choices.entries()) {
    const matchingEvent = trace.events.find(event => (
      event.kind === 'choice'
      && event.requestId === choice.windowId
      && (
        (choice.optionId === null && event.outcome === 'passed' && event.optionId === null)
        || (
          choice.optionId !== null
          && event.outcome === 'selected'
          && event.optionId === choice.optionId
        )
      )
    ))
    if (!matchingEvent) {
      fail(
        'inconsistent-state',
        `${path}.chosenOptions[${index}]`,
        'must reference a matching selected or passed event in the completed trace.',
      )
    }
  }
}

const assertStatusShape = (
  status: PendingMoveResolutionStatus,
  windows: readonly PendingMoveResponseWindow[],
  path: string,
): void => {
  if (status === 'pending' && windows.length === 0) {
    fail('inconsistent-state', `${path}.status`, 'pending status requires an outstanding window.')
  }
  if (TERMINAL_STATUS_SET.has(status) && windows.length > 0) {
    fail('inconsistent-state', `${path}.status`, 'terminal status cannot retain outstanding windows.')
  }
}

const assertPublicSummary = (
  summary: PendingMoveResolutionPublicSummary,
  resolution: Pick<
    PendingMoveResolution,
    | 'resolutionId'
    | 'actorPlacementId'
    | 'canonicalMoveId'
    | 'phase'
    | 'status'
    | 'createdAt'
    | 'updatedAt'
    | 'outstandingWindows'
  >,
  path: string,
): void => {
  if (
    summary.resolutionId !== resolution.resolutionId
    || summary.actorPlacementId !== resolution.actorPlacementId
    || summary.canonicalMoveId !== resolution.canonicalMoveId
    || summary.phase !== resolution.phase
    || summary.status !== resolution.status
    || summary.createdAt !== resolution.createdAt
    || summary.updatedAt !== resolution.updatedAt
    || summary.outstandingWindowCount !== resolution.outstandingWindows.length
  ) {
    fail(
      'inconsistent-state',
      `${path}.publicSummary`,
      'must exactly project the bounded public fields of the pending resolution.',
    )
  }
}

/** Strictly parse, detach, and freeze a map-visible pending-resolution summary. */
export const parsePendingMoveResolutionPublicSummary = (
  value: unknown,
  path = 'pendingResolutionSummary',
): PendingMoveResolutionPublicSummary => deepFreeze(
  parsePublicSummaryRecord(detachedJson(value, path), path),
)

export const createPendingMoveDeclarationResult = (input: {
  readonly opId: string
  readonly mapSlug: string
  readonly previousRevision: number
  readonly revision: number
  readonly pendingResolution: PendingMoveResolutionPublicSummary
}): PendingMoveDeclarationResult => {
  if (!isLivePlayOpId(input.opId)) {
    fail('invalid-pending-resolution', 'pendingDeclaration.opId', 'must be a valid live-play operation ID.')
  }
  if (!isSlug(input.mapSlug)) {
    fail('invalid-pending-resolution', 'pendingDeclaration.mapSlug', 'must be a lowercase map slug.')
  }
  const previousRevision = parseInteger(
    input.previousRevision,
    'pendingDeclaration.previousRevision',
    0,
    Number.MAX_SAFE_INTEGER,
  )
  const revision = parseInteger(
    input.revision,
    'pendingDeclaration.revision',
    0,
    Number.MAX_SAFE_INTEGER,
  )
  if (revision !== previousRevision + 1) {
    fail(
      'inconsistent-state',
      'pendingDeclaration.revision',
      'must advance the originating map revision exactly once.',
    )
  }
  const pendingResolution = parsePendingMoveResolutionPublicSummary(
    input.pendingResolution,
    'pendingDeclaration.pendingResolution',
  )
  if (pendingResolution.status !== 'pending') {
    fail(
      'inconsistent-state',
      'pendingDeclaration.pendingResolution.status',
      'a suspended declaration must expose pending status.',
    )
  }
  return deepFreeze({
    ok: true,
    pending: true,
    opId: input.opId,
    mapSlug: input.mapSlug,
    previousRevision,
    revision,
    patches: [],
    pendingResolution,
  })
}

export const isPendingMoveDeclarationResult = (
  value: unknown,
): value is PendingMoveDeclarationResult => {
  if (!isPlainRecord(value) || value.ok !== true || value.pending !== true) return false
  if (!isLivePlayOpId(value.opId) || !isSlug(value.mapSlug)) return false
  if (!Number.isSafeInteger(value.previousRevision) || !Number.isSafeInteger(value.revision)) {
    return false
  }
  if (value.revision !== Number(value.previousRevision) + 1) return false
  if (!Array.isArray(value.patches) || value.patches.length !== 0) return false
  try {
    return parsePendingMoveResolutionPublicSummary(value.pendingResolution).status === 'pending'
  }
  catch {
    return false
  }
}

/** Strictly parse, cross-check, detach, and freeze a durable suspended resolution. */
export const parsePendingMoveResolution = (
  value: unknown,
  path = 'pendingResolution',
): PendingMoveResolution => {
  const record = parseExactRecord(detachedJson(value, path), ROOT_FIELDS, path)
  if (record.schemaVersion !== PENDING_MOVE_RESOLUTION_SCHEMA_VERSION) {
    fail(
      'unsupported-schema-version',
      `${path}.schemaVersion`,
      `must be ${PENDING_MOVE_RESOLUTION_SCHEMA_VERSION}.`,
    )
  }

  const resolutionId = parseBoundedText(
    record.resolutionId,
    `${path}.resolutionId`,
    PENDING_MOVE_RESOLUTION_LIMITS.identifierChars,
  )
  const originMapSlug = parseOriginMapSlug(record.originMapSlug, `${path}.originMapSlug`)
  const originOpId = parseOriginOpId(record.originOpId, `${path}.originOpId`)
  const actorPlacementId = parsePlacementId(
    record.actorPlacementId,
    `${path}.actorPlacementId`,
  )
  const canonicalMoveId = parseCanonicalMoveId(
    record.canonicalMoveId,
    `${path}.canonicalMoveId`,
  )
  const specVersion = parseInteger(
    record.specVersion,
    `${path}.specVersion`,
    1,
    Number.MAX_SAFE_INTEGER,
  )
  const specHash = parseSha256(record.specHash, `${path}.specHash`)
  const rulesetId = parseBoundedText(
    record.rulesetId,
    `${path}.rulesetId`,
    PENDING_MOVE_RESOLUTION_LIMITS.identifierChars,
  )
  const rulesetHash = parseSha256(record.rulesetHash, `${path}.rulesetHash`)
  const phase = parsePhase(record.phase, `${path}.phase`)
  const status = parseStatus(record.status, `${path}.status`)
  const createdAt = parseTimestamp(record.createdAt, `${path}.createdAt`)
  const updatedAt = parseTimestamp(record.updatedAt, `${path}.updatedAt`)
  if (updatedAt < createdAt) {
    fail('inconsistent-state', `${path}.updatedAt`, 'cannot precede createdAt.')
  }

  const readSet = parseReadSet(record.readSet, originMapSlug, `${path}.readSet`)
  const trace = parseTrace(record.trace, `${path}.trace`)
  const rollLedger = parseRollLedger(record.rollLedger, `${path}.rollLedger`)
  const outstandingWindows = parseWindows(
    record.outstandingWindows,
    `${path}.outstandingWindows`,
  )
  const chosenOptions = parseChosenOptions(
    record.chosenOptions,
    createdAt,
    updatedAt,
    `${path}.chosenOptions`,
  )
  const causalAncestry = parseCausalAncestry(
    record.causalAncestry,
    `${path}.causalAncestry`,
  )
  const publicSummary = parsePublicSummaryRecord(
    record.publicSummary,
    `${path}.publicSummary`,
  )

  assertTraceIdentity({
    canonicalMoveId,
    specVersion,
    specHash,
    rulesetId,
    rulesetHash,
    phase,
    trace,
    rollLedger,
    causalAncestry,
    path,
  })
  assertWindowTraceLinks(outstandingWindows, trace, phase, path)
  assertChosenTraceLinks(chosenOptions, trace, path)
  assertStatusShape(status, outstandingWindows, path)
  const outstandingIds = new Set(outstandingWindows.map(window => window.windowId))
  const overlappingChoice = chosenOptions.find(choice => outstandingIds.has(choice.windowId))
  if (overlappingChoice) {
    fail(
      'inconsistent-state',
      `${path}.chosenOptions`,
      `chosen window ${overlappingChoice.windowId} cannot remain outstanding.`,
    )
  }

  const parsed: PendingMoveResolution = {
    schemaVersion: PENDING_MOVE_RESOLUTION_SCHEMA_VERSION,
    resolutionId,
    originMapSlug,
    originOpId,
    actorPlacementId,
    canonicalMoveId,
    specVersion,
    specHash,
    rulesetId,
    rulesetHash,
    phase,
    readSet,
    trace,
    rollLedger,
    outstandingWindows,
    chosenOptions,
    causalAncestry,
    status,
    createdAt,
    updatedAt,
    publicSummary,
  }
  assertPublicSummary(publicSummary, parsed, path)
  return deepFreeze(parsed)
}

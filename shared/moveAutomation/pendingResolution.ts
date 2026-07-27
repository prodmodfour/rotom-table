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
  MOVE_AUTOMATION_AREA_DIRECTIONS,
  type MoveAutomationAreaDirection,
} from '~/types/moveAutomation'
import {
  moveHazardCellSelectionResponseId,
  parseMoveHazardCellSelectionWindow,
  type MoveHazardCellSelectionWindow,
} from './hazardCellSelection'
import {
  MOVE_RESPONSE_OPTION_LIMITS,
  PENDING_MOVE_MOVEMENT_SELECTION_KINDS,
  isCanonicalPendingMoveMovementOption,
  pendingMoveMovementSelectionKey,
  type MoveResponseGridAnchor,
  type PendingMoveMovementSelection,
  type PendingMoveMovementSelectionKind,
  type PendingMoveResponseOption,
  type PendingMoveResponsePublicOption,
} from './responseOptions'
import {
  MoveItemChoiceValidationError,
  isMatchingMoveItemChoicePresentation,
  moveItemChoiceSelectionKey,
  moveItemChoiceSelectionOptionId,
  parseMoveItemChoicePresentation,
  parseMoveItemResponseSelection,
} from './itemChoices'

export {
  MOVE_RESPONSE_OPTION_LIMITS,
  PENDING_MOVE_MOVEMENT_SELECTION_KINDS,
} from './responseOptions'
export type {
  MoveResponseGridAnchor,
  PendingMoveDestinationSelection,
  PendingMoveDirectionSelection,
  PendingMoveMovementSelection,
  PendingMoveMovementSelectionKind,
  PendingMoveResponseOption,
  PendingMoveResponsePublicOption,
} from './responseOptions'
import {
  MoveAutomationRollLedgerValidationError,
  parseMoveAutomationRollLedger,
  type MoveAutomationRollLedgerEntry,
} from './random'
import {
  MOVE_REACTION_LIMITS,
  isMoveReactionTiming,
  moveReactionTimingDefinition,
  type MoveReactionTiming,
} from './reactions'
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

export const PENDING_MOVE_RESOLUTION_CONTINUATION_KINDS = [
  'movespec-v2',
  'ability-follow-ups',
  'attack-of-opportunity',
] as const

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
  identifierChars: MOVE_RESPONSE_OPTION_LIMITS.identifierChars,
  placementIdChars: MOVE_RESPONSE_OPTION_LIMITS.placementIdChars,
  canonicalMoveChars: 160,
  resourceReads: 512,
  responseWindows: 64,
  ownersPerWindow: 64,
  rootAreaExcludedTargets: 32,
  optionsPerWindow: MOVE_RESPONSE_OPTION_LIMITS.optionsPerWindow,
  chosenOptions: 256,
  reactionPriorityMagnitude: MOVE_REACTION_LIMITS.priorityMagnitude,
  reactionNestedWindowDepth: MOVE_REACTION_LIMITS.nestedWindowDepth,
  jsonDepth: 24,
  jsonNodes: 131_072,
  jsonObjectFields: 128,
  jsonArrayEntries: MOVE_RESOLUTION_TRACE_LIMITS.auditEvents,
  jsonStringChars: 500,
})

export type PendingMoveResolutionContinuationKind =
  (typeof PENDING_MOVE_RESOLUTION_CONTINUATION_KINDS)[number]
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

interface PendingMoveResponseWindowBase {
  readonly windowId: string
  readonly operationId: string
  readonly phase: MoveSpecPhase
  readonly reasonCode: string
  readonly promptKey: string
  readonly ownership: readonly PendingMoveResponseOwner[]
  readonly options: readonly PendingMoveResponseOption[]
}

export interface PendingMoveChoiceResponseWindow
  extends PendingMoveResponseWindowBase {
  readonly kind: 'choice'
  readonly allowPass: boolean
  readonly priority: null
  /** Private server-owned cell values; projected only after window authorization. */
  readonly hazardCellSelection?: MoveHazardCellSelectionWindow
}

export interface PendingMoveReactionResponseWindow
  extends PendingMoveResponseWindowBase {
  readonly kind: 'reaction'
  /** An eligible responder may always decline the current reaction window. */
  readonly allowPass: true
  readonly timing: MoveReactionTiming
  readonly priority: number
  /** Server-derived causal ancestry depth; never supplied by a response. */
  readonly depth: number
}

export type PendingMoveResponseWindow =
  | PendingMoveChoiceResponseWindow
  | PendingMoveReactionResponseWindow

/**
 * Legacy post-commit follow-ups resolve in reviewed priority order. Their
 * remaining windows stay durable but only the first is answerable/visible.
 * MoveSpec suspensions currently materialize one active window at a time.
 * Opportunity-attack windows are independent defenders and remain concurrently
 * visible only to each window's authorized owner.
 */
export const activePendingMoveResponseWindows = (
  resolution: Pick<PendingMoveResolution, 'continuationKind' | 'outstandingWindows'>,
): readonly PendingMoveResponseWindow[] => resolution.continuationKind === 'ability-follow-ups'
  ? resolution.outstandingWindows.slice(0, 1)
  : resolution.outstandingWindows

export interface PendingMoveResolutionChosenOption {
  readonly windowId: string
  /** The idempotency identity of the accepted response command. */
  readonly responseOpId: LivePlayOpId
  /** Null records an authorized pass; multi-cell choices use their stable selection digest. */
  readonly optionId: string | null
  /** Canonical server-issued IDs retained only for an audited multi-cell choice. */
  readonly optionIds?: readonly string[]
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

export interface PendingMoveAttackOfOpportunityContextBase {
  readonly kind: 'attack-of-opportunity'
  readonly triggerReason: 'movement' | 'ranged-attack'
  readonly provokerPlacementId: string
  readonly from: { readonly x: number; readonly y: number; readonly z: number } | null
  readonly to: { readonly x: number; readonly y: number; readonly z: number } | null
  readonly targetPlacementIds: readonly string[]
}

/** Compatibility shape for already-durable MA-110 post-action prompts. */
export interface PendingMovePostActionAttackOfOpportunityContext
  extends PendingMoveAttackOfOpportunityContextBase {
  readonly timingLimitation: 'post-provoking-action'
}

export interface PendingMoveMovementLifecycleCursor {
  readonly schemaVersion: 1
  readonly movementId: string
  readonly pathHash: string
  readonly nextEventIndex: number
}

/** Private server-owned route and progress retained while movement is paused. */
export interface PendingMoveOpportunityMovementPath {
  readonly schemaVersion: 1
  readonly movementId: string
  readonly sourceOperationId: LivePlayOpId
  readonly mode: 'shift'
  readonly policy: 'standard' | 'gm-override'
  readonly origin: MoveResponseGridAnchor
  /** The currently validated endpoint; it may be a typed shortened endpoint. */
  readonly destination: MoveResponseGridAnchor
  /** Original requested endpoint retained for audit even after shortening. */
  readonly requestedDestination: MoveResponseGridAnchor
  /** Origin followed by every deterministic oracle step endpoint. */
  readonly path: readonly MoveResponseGridAnchor[]
  /** Zero at origin, then the authoritative cumulative cost for each step. */
  readonly cumulativeCosts: readonly number[]
  readonly committedStepCount: number
  readonly cursor: PendingMoveMovementLifecycleCursor
  readonly declarationPreviousRevision: number
  readonly declarationRevision: number
}

export interface PendingMovePreStepAttackOfOpportunityContext
  extends PendingMoveAttackOfOpportunityContextBase {
  readonly triggerReason: 'movement'
  readonly timing: 'pre-movement-step'
  readonly from: MoveResponseGridAnchor
  readonly to: MoveResponseGridAnchor
  readonly movementPath: PendingMoveOpportunityMovementPath
}

export type PendingMoveAttackOfOpportunityContext =
  | PendingMovePostActionAttackOfOpportunityContext
  | PendingMovePreStepAttackOfOpportunityContext

export type PendingMoveResolutionContinuationContext = PendingMoveAttackOfOpportunityContext

export interface PendingMoveRootAreaSelection {
  readonly kind: 'area'
  readonly areaTemplateId: string
  readonly direction?: MoveAutomationAreaDirection
  readonly aimCell?: MoveResponseGridAnchor
  readonly excludedTargetPlacementIds?: readonly string[]
}

export interface PendingMoveResolution {
  readonly schemaVersion: typeof PENDING_MOVE_RESOLUTION_SCHEMA_VERSION
  readonly continuationKind: PendingMoveResolutionContinuationKind
  readonly continuationContext?: PendingMoveResolutionContinuationContext
  readonly resolutionId: string
  readonly originMapSlug: string
  readonly originOpId: LivePlayOpId
  readonly actorPlacementId: string
  readonly virtualOriginCell?: MoveResponseGridAnchor
  /** Server-validated targeting branch retained for deterministic continuation replay. */
  readonly targetBranchId?: string
  /** Exact server-reviewed root area declaration retained for deterministic continuation replay. */
  readonly rootAreaSelection?: PendingMoveRootAreaSelection
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

const ROOT_REQUIRED_FIELDS = [
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
const ROOT_OPTIONAL_FIELDS = [
  'continuationKind', 'continuationContext', 'virtualOriginCell', 'targetBranchId',
  'rootAreaSelection',
] as const
const ROOT_AREA_SELECTION_FIELDS = ['kind', 'areaTemplateId'] as const
const ROOT_AREA_SELECTION_OPTIONAL_FIELDS = [
  'direction', 'aimCell', 'excludedTargetPlacementIds',
] as const
const MAP_READ_FIELDS = ['kind', 'slug', 'revision'] as const
const SHEET_READ_FIELDS = ['kind', 'sheetKind', 'slug', 'revision'] as const
const GROUP_INVENTORY_READ_FIELDS = ['kind', 'slug', 'revision'] as const
const OWNER_FIELDS = ['kind', 'id'] as const
const OPTION_FIELDS = ['id', 'labelKey'] as const
const MOVEMENT_OPTION_FIELDS = [...OPTION_FIELDS, 'selection'] as const
const PRIVATE_ITEM_OPTION_FIELDS = [...OPTION_FIELDS, 'itemChoice', 'itemSelection'] as const
const PUBLIC_ITEM_OPTION_FIELDS = [...OPTION_FIELDS, 'itemChoice'] as const
const MOVEMENT_DESTINATION_SELECTION_FIELDS = ['kind', 'setId', 'destination'] as const
const MOVEMENT_DIRECTION_SELECTION_FIELDS = [
  'kind',
  'setId',
  'direction',
  'destination',
] as const
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
const HAZARD_CELL_WINDOW_FIELDS = [...WINDOW_FIELDS, 'hazardCellSelection'] as const
const REACTION_WINDOW_FIELDS = [...WINDOW_FIELDS, 'timing', 'depth'] as const
const CHOSEN_OPTION_FIELDS = [
  'windowId',
  'responseOpId',
  'optionId',
  'chosenBy',
  'chosenAt',
] as const
const MULTI_CHOSEN_OPTION_FIELDS = [
  'windowId',
  'responseOpId',
  'optionId',
  'optionIds',
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
const ATTACK_OF_OPPORTUNITY_CONTEXT_FIELDS = [
  'kind',
  'triggerReason',
  'provokerPlacementId',
  'from',
  'to',
  'targetPlacementIds',
  'timingLimitation',
] as const
const PRE_STEP_ATTACK_OF_OPPORTUNITY_CONTEXT_FIELDS = [
  'kind',
  'triggerReason',
  'provokerPlacementId',
  'from',
  'to',
  'targetPlacementIds',
  'timing',
  'movementPath',
] as const
const OPPORTUNITY_MOVEMENT_PATH_FIELDS = [
  'schemaVersion',
  'movementId',
  'sourceOperationId',
  'mode',
  'policy',
  'origin',
  'destination',
  'requestedDestination',
  'path',
  'cumulativeCosts',
  'committedStepCount',
  'cursor',
  'declarationPreviousRevision',
  'declarationRevision',
] as const
const MOVEMENT_LIFECYCLE_CURSOR_FIELDS = [
  'schemaVersion',
  'movementId',
  'pathHash',
  'nextEventIndex',
] as const
const GRID_ANCHOR_FIELDS = ['x', 'y', 'z'] as const
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
const CONTINUATION_KIND_SET = new Set<string>(PENDING_MOVE_RESOLUTION_CONTINUATION_KINDS)
const STATUS_SET = new Set<string>(PENDING_MOVE_RESOLUTION_STATUSES)
const TERMINAL_STATUS_SET = new Set<string>(PENDING_MOVE_RESOLUTION_TERMINAL_STATUSES)
const RESOURCE_KIND_SET = new Set<string>(PENDING_MOVE_RESOLUTION_RESOURCE_KINDS)
const WINDOW_KIND_SET = new Set<string>(PENDING_MOVE_RESPONSE_WINDOW_KINDS)
const OWNER_KIND_SET = new Set<string>(PENDING_MOVE_RESPONSE_OWNER_KINDS)
const MOVEMENT_SELECTION_KIND_SET = new Set<string>(PENDING_MOVE_MOVEMENT_SELECTION_KINDS)
const AREA_DIRECTION_SET = new Set<string>(MOVE_AUTOMATION_AREA_DIRECTIONS)
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

const parseRecordWithOptionalFields = (
  value: unknown,
  requiredFields: readonly string[],
  optionalFields: readonly string[],
  path: string,
): UnknownRecord => {
  const record = parseRecord(value, path)
  const allowed = new Set([...requiredFields, ...optionalFields])
  const missing = requiredFields.filter(field => !Object.prototype.hasOwnProperty.call(record, field))
  const unknown = Object.keys(record).filter(field => !allowed.has(field))
  if (missing.length === 0 && unknown.length === 0) return record
  const detail = [
    missing.length > 0 ? `missing ${missing.join(', ')}` : '',
    unknown.length > 0 ? `unknown ${unknown.join(', ')}` : '',
  ].filter(Boolean).join('; ')
  return fail(
    'invalid-pending-resolution',
    path,
    `must contain only the supported fields (${detail}).`,
  )
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

const parseMovementSelectionAnchor = (
  value: unknown,
  path: string,
): MoveResponseGridAnchor => {
  const record = parseExactRecord(value, GRID_ANCHOR_FIELDS, path)
  return {
    x: parseInteger(
      record.x,
      `${path}.x`,
      0,
      MOVE_RESPONSE_OPTION_LIMITS.coordinateMagnitude,
    ),
    y: parseInteger(
      record.y,
      `${path}.y`,
      0,
      MOVE_RESPONSE_OPTION_LIMITS.coordinateMagnitude,
    ),
    z: parseInteger(
      record.z,
      `${path}.z`,
      0,
      MOVE_RESPONSE_OPTION_LIMITS.coordinateMagnitude,
    ),
  }
}

const parseMovementSelection = (
  value: unknown,
  path: string,
): PendingMoveMovementSelection => {
  const candidate = parseRecord(value, path)
  if (
    typeof candidate.kind !== 'string'
    || !MOVEMENT_SELECTION_KIND_SET.has(candidate.kind)
  ) {
    fail(
      'invalid-pending-resolution',
      `${path}.kind`,
      'must be movement-destination or movement-direction.',
    )
  }
  const kind = candidate.kind as PendingMoveMovementSelectionKind
  const record = parseExactRecord(
    value,
    kind === 'movement-direction'
      ? MOVEMENT_DIRECTION_SELECTION_FIELDS
      : MOVEMENT_DESTINATION_SELECTION_FIELDS,
    path,
  )
  const common = {
    setId: parseStableId(record.setId, `${path}.setId`),
    destination: parseMovementSelectionAnchor(record.destination, `${path}.destination`),
  }
  if (kind === 'movement-destination') {
    return { kind, ...common }
  }
  const direction = typeof record.direction === 'string'
    && AREA_DIRECTION_SET.has(record.direction)
    ? record.direction as MoveAutomationAreaDirection
    : fail(
        'invalid-pending-resolution',
        `${path}.direction`,
        'must be a canonical movement direction.',
      )
  return { kind, ...common, direction }
}

const parseItemOptionFields = (
  record: UnknownRecord,
  path: string,
): Pick<PendingMoveResponseOption, 'itemChoice' | 'itemSelection'> => {
  try {
    const itemChoice = parseMoveItemChoicePresentation(record.itemChoice, `${path}.itemChoice`)
    const itemSelection = parseMoveItemResponseSelection(
      record.itemSelection,
      `${path}.itemSelection`,
    )
    if (
      !isMatchingMoveItemChoicePresentation(itemSelection, itemChoice)
      || moveItemChoiceSelectionOptionId(itemSelection) !== record.id
    ) {
      fail(
        'inconsistent-state',
        path,
        'item option identity and presentation must match its private server-owned selection.',
      )
    }
    return { itemChoice, itemSelection }
  }
  catch (error) {
    if (error instanceof PendingMoveResolutionValidationError) throw error
    if (error instanceof MoveItemChoiceValidationError) {
      return fail('invalid-pending-resolution', path, error.message)
    }
    throw error
  }
}

const parseResponseOption = (
  value: unknown,
  path: string,
): PendingMoveResponseOption => {
  const candidate = parseRecord(value, path)
  const hasSelection = Object.prototype.hasOwnProperty.call(candidate, 'selection')
  const hasItemChoice = Object.prototype.hasOwnProperty.call(candidate, 'itemChoice')
  const hasItemSelection = Object.prototype.hasOwnProperty.call(candidate, 'itemSelection')
  if (hasSelection && (hasItemChoice || hasItemSelection)) {
    fail('inconsistent-state', path, 'an option cannot mix movement and item selections.')
  }
  if (hasItemChoice !== hasItemSelection) {
    fail('inconsistent-state', path, 'a private item option requires presentation and selection fields.')
  }
  const record = parseExactRecord(
    value,
    hasSelection
      ? MOVEMENT_OPTION_FIELDS
      : hasItemChoice
        ? PRIVATE_ITEM_OPTION_FIELDS
        : OPTION_FIELDS,
    path,
  )
  const option: PendingMoveResponseOption = {
    id: parseStableId(record.id, `${path}.id`),
    labelKey: parseStableId(record.labelKey, `${path}.labelKey`),
    ...(hasSelection
      ? { selection: parseMovementSelection(record.selection, `${path}.selection`) }
      : {}),
    ...(hasItemChoice ? parseItemOptionFields(record, path) : {}),
  }
  if (option.selection && !isCanonicalPendingMoveMovementOption(option)) {
    fail(
      'invalid-pending-resolution',
      path,
      'movement option ID and label must exactly match its server-owned selection.',
    )
  }
  return option
}

/** Strict parser for one private durable response option. */
export const parsePendingMoveResponseOption = (
  value: unknown,
  path = 'pendingMoveResponseOption',
): PendingMoveResponseOption => deepFreeze(parseResponseOption(detachedJson(value, path), path))

/** Strictly reject private item identity while parsing an authorized wire option. */
export const parsePendingMoveResponsePublicOption = (
  value: unknown,
  path = 'pendingMoveResponsePublicOption',
): PendingMoveResponsePublicOption => {
  const detached = detachedJson(value, path)
  const candidate = parseRecord(detached, path)
  if (Object.prototype.hasOwnProperty.call(candidate, 'itemSelection')) {
    return fail(
      'invalid-pending-resolution',
      `${path}.itemSelection`,
      'private item selections are not allowed in response views.',
    )
  }
  const hasSelection = Object.prototype.hasOwnProperty.call(candidate, 'selection')
  const hasItemChoice = Object.prototype.hasOwnProperty.call(candidate, 'itemChoice')
  if (hasSelection && hasItemChoice) {
    return fail('inconsistent-state', path, 'an option cannot mix movement and item presentation.')
  }
  const record = parseExactRecord(
    detached,
    hasSelection
      ? MOVEMENT_OPTION_FIELDS
      : hasItemChoice
        ? PUBLIC_ITEM_OPTION_FIELDS
        : OPTION_FIELDS,
    path,
  )
  const option: PendingMoveResponsePublicOption = {
    id: parseStableId(record.id, `${path}.id`),
    labelKey: parseStableId(record.labelKey, `${path}.labelKey`),
    ...(hasSelection
      ? { selection: parseMovementSelection(record.selection, `${path}.selection`) }
      : {}),
    ...(hasItemChoice
      ? {
          itemChoice: (() => {
            try {
              return parseMoveItemChoicePresentation(record.itemChoice, `${path}.itemChoice`)
            }
            catch (error) {
              if (error instanceof MoveItemChoiceValidationError) {
                return fail('invalid-pending-resolution', `${path}.itemChoice`, error.message)
              }
              throw error
            }
          })(),
        }
      : {}),
  }
  if (option.selection && !isCanonicalPendingMoveMovementOption(option)) {
    fail(
      'invalid-pending-resolution',
      path,
      'movement option ID and label must exactly match its server-owned selection.',
    )
  }
  return deepFreeze(option)
}

const parseOptions = (
  value: unknown,
  path: string,
): readonly PendingMoveResponseOption[] => {
  const options = parseBoundedArray(
    value,
    path,
    PENDING_MOVE_RESOLUTION_LIMITS.optionsPerWindow,
  ).map((entry, index) => parseResponseOption(entry, `${path}[${index}]`))
  const movementOptions = options.filter(option => option.selection !== undefined)
  const itemOptions = options.filter(option => option.itemSelection !== undefined)
  if (movementOptions.length > 0 && movementOptions.length !== options.length) {
    fail(
      'inconsistent-state',
      path,
      'a movement response window cannot mix movement and other options.',
    )
  }
  if (itemOptions.length > 0 && itemOptions.length !== options.length) {
    fail(
      'inconsistent-state',
      path,
      'an item response window cannot mix item and generic options.',
    )
  }
  const movementSetKinds = new Set(movementOptions.map(option => (
    `${option.selection!.kind}:${option.selection!.setId}`
  )))
  if (movementSetKinds.size > 1) {
    fail(
      'inconsistent-state',
      path,
      'movement response options must belong to one typed server-owned set.',
    )
  }
  const itemSetIds = new Set(itemOptions.map(option => option.itemSelection!.setId))
  if (itemSetIds.size > 1) {
    fail(
      'inconsistent-state',
      path,
      'item response options must belong to one typed server-owned set.',
    )
  }

  const seen = new Set<string>()
  const seenSelections = new Set<string>()
  for (const [index, option] of options.entries()) {
    if (seen.has(option.id)) {
      fail('duplicate-id', `${path}[${index}].id`, `duplicates option ${option.id}.`)
    }
    seen.add(option.id)
    const selectionKey = option.selection
      ? pendingMoveMovementSelectionKey(option.selection)
      : option.itemSelection
        ? moveItemChoiceSelectionKey(option.itemSelection)
        : null
    if (selectionKey === null) continue
    if (seenSelections.has(selectionKey)) {
      fail(
        'duplicate-id',
        `${path}[${index}]`,
        `duplicates server-owned selection ${selectionKey}.`,
      )
    }
    seenSelections.add(selectionKey)
  }
  return options
}

const parseContinuationGridAnchor = (
  value: unknown,
  path: string,
): MoveResponseGridAnchor | null => {
  if (value === null) return null
  const record = parseExactRecord(value, GRID_ANCHOR_FIELDS, path)
  return {
    x: parseInteger(record.x, `${path}.x`, -1_000_000, 1_000_000),
    y: parseInteger(record.y, `${path}.y`, -1_000_000, 1_000_000),
    z: parseInteger(record.z, `${path}.z`, -1_000_000, 1_000_000),
  }
}

const requiredContinuationGridAnchor = (
  value: unknown,
  path: string,
): MoveResponseGridAnchor => parseContinuationGridAnchor(value, path)
  ?? fail('invalid-pending-resolution', path, 'must be a bounded grid anchor.')

const parseRootAreaSelection = (
  value: unknown,
  path: string,
): PendingMoveRootAreaSelection => {
  const record = parseRecordWithOptionalFields(
    value,
    ROOT_AREA_SELECTION_FIELDS,
    ROOT_AREA_SELECTION_OPTIONAL_FIELDS,
    path,
  )
  if (record.kind !== 'area') {
    fail('invalid-pending-resolution', `${path}.kind`, 'must be area.')
  }
  const areaTemplateId = parseStableId(record.areaTemplateId, `${path}.areaTemplateId`)
  const direction = Object.prototype.hasOwnProperty.call(record, 'direction')
    ? typeof record.direction === 'string' && AREA_DIRECTION_SET.has(record.direction)
      ? record.direction as MoveAutomationAreaDirection
      : fail(
          'invalid-pending-resolution',
          `${path}.direction`,
          'must be a supported area direction.',
        )
    : null
  const aimCell = Object.prototype.hasOwnProperty.call(record, 'aimCell')
    ? requiredContinuationGridAnchor(record.aimCell, `${path}.aimCell`)
    : null
  const excludedTargetPlacementIds = Object.prototype.hasOwnProperty.call(
    record,
    'excludedTargetPlacementIds',
  )
    ? parseBoundedArray(
        record.excludedTargetPlacementIds,
        `${path}.excludedTargetPlacementIds`,
        PENDING_MOVE_RESOLUTION_LIMITS.rootAreaExcludedTargets,
      ).map((id, index) => parsePlacementId(
        id,
        `${path}.excludedTargetPlacementIds[${index}]`,
      ))
    : null
  if (
    excludedTargetPlacementIds
    && new Set(excludedTargetPlacementIds).size !== excludedTargetPlacementIds.length
  ) {
    fail(
      'duplicate-id',
      `${path}.excludedTargetPlacementIds`,
      'must not contain duplicate placements.',
    )
  }
  return {
    kind: 'area',
    areaTemplateId,
    ...(direction ? { direction } : {}),
    ...(aimCell ? { aimCell } : {}),
    ...(excludedTargetPlacementIds ? { excludedTargetPlacementIds } : {}),
  }
}

const sameContinuationAnchor = (
  left: MoveResponseGridAnchor,
  right: MoveResponseGridAnchor,
): boolean => left.x === right.x && left.y === right.y && left.z === right.z

const parseOpportunityMovementPath = (
  value: unknown,
  originOpId: LivePlayOpId,
  from: MoveResponseGridAnchor,
  to: MoveResponseGridAnchor,
  path: string,
): PendingMoveOpportunityMovementPath => {
  const record = parseExactRecord(value, OPPORTUNITY_MOVEMENT_PATH_FIELDS, path)
  if (record.schemaVersion !== 1) {
    fail('unsupported-schema-version', `${path}.schemaVersion`, 'must be 1.')
  }
  const movementId = parseStableId(record.movementId, `${path}.movementId`)
  const sourceOperationId = parseOriginOpId(
    record.sourceOperationId,
    `${path}.sourceOperationId`,
  )
  if (sourceOperationId !== originOpId) {
    fail('inconsistent-state', `${path}.sourceOperationId`, 'must match originOpId.')
  }
  if (record.mode !== 'shift') {
    fail('invalid-pending-resolution', `${path}.mode`, 'must be shift.')
  }
  const policy = record.policy === 'standard' || record.policy === 'gm-override'
    ? record.policy
    : fail('invalid-pending-resolution', `${path}.policy`, 'must be standard or gm-override.')
  const origin = requiredContinuationGridAnchor(record.origin, `${path}.origin`)
  const destination = requiredContinuationGridAnchor(record.destination, `${path}.destination`)
  const requestedDestination = requiredContinuationGridAnchor(
    record.requestedDestination,
    `${path}.requestedDestination`,
  )
  const route = parseBoundedArray(record.path, `${path}.path`, 10_001)
    .map((cell, index) => requiredContinuationGridAnchor(cell, `${path}.path[${index}]`))
  if (route.length < 2) {
    fail('inconsistent-state', `${path}.path`, 'must contain an origin and at least one step.')
  }
  const cumulativeCosts = parseBoundedArray(
    record.cumulativeCosts,
    `${path}.cumulativeCosts`,
    10_001,
  ).map((cost, index) => parseInteger(
    cost,
    `${path}.cumulativeCosts[${index}]`,
    0,
    Number.MAX_SAFE_INTEGER,
  ))
  if (cumulativeCosts.length !== route.length || cumulativeCosts[0] !== 0) {
    fail(
      'inconsistent-state',
      `${path}.cumulativeCosts`,
      'must align with the complete route and start at zero.',
    )
  }
  for (let index = 1; index < cumulativeCosts.length; index += 1) {
    if (cumulativeCosts[index]! <= cumulativeCosts[index - 1]!) {
      fail(
        'inconsistent-state',
        `${path}.cumulativeCosts[${index}]`,
        'must increase for every authoritative movement step.',
      )
    }
  }
  const committedStepCount = parseInteger(
    record.committedStepCount,
    `${path}.committedStepCount`,
    0,
    route.length - 2,
  )
  if (
    !sameContinuationAnchor(route[0]!, origin)
    || !sameContinuationAnchor(route.at(-1)!, destination)
    || !sameContinuationAnchor(route[committedStepCount]!, from)
    || !sameContinuationAnchor(route[committedStepCount + 1]!, to)
  ) {
    fail(
      'inconsistent-state',
      path,
      'route endpoints and committed progress must match the provoking step.',
    )
  }
  const cursorRecord = parseExactRecord(
    record.cursor,
    MOVEMENT_LIFECYCLE_CURSOR_FIELDS,
    `${path}.cursor`,
  )
  if (cursorRecord.schemaVersion !== 1) {
    fail('unsupported-schema-version', `${path}.cursor.schemaVersion`, 'must be 1.')
  }
  const cursorMovementId = parseStableId(
    cursorRecord.movementId,
    `${path}.cursor.movementId`,
  )
  if (cursorMovementId !== movementId) {
    fail('inconsistent-state', `${path}.cursor.movementId`, 'must match movementId.')
  }
  const declarationPreviousRevision = parseInteger(
    record.declarationPreviousRevision,
    `${path}.declarationPreviousRevision`,
    0,
    Number.MAX_SAFE_INTEGER,
  )
  const declarationRevision = parseInteger(
    record.declarationRevision,
    `${path}.declarationRevision`,
    0,
    Number.MAX_SAFE_INTEGER,
  )
  if (declarationRevision !== declarationPreviousRevision + 1) {
    fail(
      'inconsistent-state',
      `${path}.declarationRevision`,
      'must immediately follow declarationPreviousRevision.',
    )
  }
  return {
    schemaVersion: 1,
    movementId,
    sourceOperationId,
    mode: 'shift',
    policy,
    origin,
    destination,
    requestedDestination,
    path: route,
    cumulativeCosts,
    committedStepCount,
    cursor: {
      schemaVersion: 1,
      movementId: cursorMovementId,
      pathHash: parseSha256(cursorRecord.pathHash, `${path}.cursor.pathHash`),
      nextEventIndex: parseInteger(
        cursorRecord.nextEventIndex,
        `${path}.cursor.nextEventIndex`,
        1,
        Number.MAX_SAFE_INTEGER,
      ),
    },
    declarationPreviousRevision,
    declarationRevision,
  }
}

const parseContinuationContext = (
  value: unknown,
  continuationKind: PendingMoveResolutionContinuationKind,
  actorPlacementId: string,
  originOpId: LivePlayOpId,
  path: string,
): PendingMoveResolutionContinuationContext | undefined => {
  if (value === undefined) {
    if (continuationKind === 'attack-of-opportunity') {
      fail('inconsistent-state', path, 'is required for an Attack of Opportunity continuation.')
    }
    return undefined
  }
  if (continuationKind !== 'attack-of-opportunity') {
    fail('inconsistent-state', path, 'is allowed only for an Attack of Opportunity continuation.')
  }
  const candidate = parseRecord(value, path)
  const preStep = Object.prototype.hasOwnProperty.call(candidate, 'movementPath')
  const record = parseExactRecord(
    value,
    preStep
      ? PRE_STEP_ATTACK_OF_OPPORTUNITY_CONTEXT_FIELDS
      : ATTACK_OF_OPPORTUNITY_CONTEXT_FIELDS,
    path,
  )
  if (record.kind !== 'attack-of-opportunity') {
    fail('invalid-pending-resolution', `${path}.kind`, 'must be attack-of-opportunity.')
  }
  if (record.triggerReason !== 'movement' && record.triggerReason !== 'ranged-attack') {
    fail('invalid-pending-resolution', `${path}.triggerReason`, 'must be movement or ranged-attack.')
  }
  const triggerReason = record.triggerReason as PendingMoveAttackOfOpportunityContext['triggerReason']
  const provokerPlacementId = parsePlacementId(
    record.provokerPlacementId,
    `${path}.provokerPlacementId`,
  )
  if (provokerPlacementId !== actorPlacementId) {
    fail('inconsistent-state', `${path}.provokerPlacementId`, 'must match actorPlacementId.')
  }
  const from = parseContinuationGridAnchor(record.from, `${path}.from`)
  const to = parseContinuationGridAnchor(record.to, `${path}.to`)
  const targetPlacementIds = parseBoundedArray(
    record.targetPlacementIds,
    `${path}.targetPlacementIds`,
    64,
  ).map((id, index) => parsePlacementId(id, `${path}.targetPlacementIds[${index}]`))
  if (new Set(targetPlacementIds).size !== targetPlacementIds.length) {
    fail('duplicate-id', `${path}.targetPlacementIds`, 'must not contain duplicate placements.')
  }

  if (preStep) {
    if (
      triggerReason !== 'movement'
      || record.timing !== 'pre-movement-step'
      || targetPlacementIds.length > 0
    ) {
      fail(
        'inconsistent-state',
        path,
        'pre-step opportunity attacks require movement anchors and no ranged targets.',
      )
    }
    const movementFrom = requiredContinuationGridAnchor(record.from, `${path}.from`)
    const movementTo = requiredContinuationGridAnchor(record.to, `${path}.to`)
    return {
      kind: 'attack-of-opportunity',
      triggerReason: 'movement',
      provokerPlacementId,
      from: movementFrom,
      to: movementTo,
      targetPlacementIds: [],
      timing: 'pre-movement-step',
      movementPath: parseOpportunityMovementPath(
        record.movementPath,
        originOpId,
        movementFrom,
        movementTo,
        `${path}.movementPath`,
      ),
    }
  }

  if (record.timingLimitation !== 'post-provoking-action') {
    fail(
      'invalid-pending-resolution',
      `${path}.timingLimitation`,
      'must be post-provoking-action.',
    )
  }
  if (
    (triggerReason === 'movement' && (from === null || to === null || targetPlacementIds.length > 0))
    || (triggerReason === 'ranged-attack' && (from !== null || to !== null))
  ) {
    fail(
      'inconsistent-state',
      path,
      'must contain movement anchors or ranged target IDs according to its trigger reason.',
    )
  }
  return {
    kind: 'attack-of-opportunity',
    triggerReason,
    provokerPlacementId,
    from,
    to,
    targetPlacementIds,
    timingLimitation: 'post-provoking-action',
  }
}

const parseWindow = (value: unknown, path: string): PendingMoveResponseWindow => {
  const candidate = parseRecord(value, path)
  if (typeof candidate.kind !== 'string' || !WINDOW_KIND_SET.has(candidate.kind)) {
    fail('invalid-pending-resolution', `${path}.kind`, 'must be choice or reaction.')
  }
  const kind = candidate.kind as PendingMoveResponseWindowKind
  const hasHazardCellSelection = Object.prototype.hasOwnProperty.call(
    candidate,
    'hazardCellSelection',
  )
  if (kind === 'reaction' && hasHazardCellSelection) {
    fail('inconsistent-state', `${path}.hazardCellSelection`, 'is available only for a choice window.')
  }
  const record = parseExactRecord(
    value,
    kind === 'reaction'
      ? REACTION_WINDOW_FIELDS
      : hasHazardCellSelection
        ? HAZARD_CELL_WINDOW_FIELDS
        : WINDOW_FIELDS,
    path,
  )
  const common = {
    windowId: parseStableId(record.windowId, `${path}.windowId`),
    operationId: parseStableId(record.operationId, `${path}.operationId`),
    phase: parsePhase(record.phase, `${path}.phase`),
    reasonCode: parseStableId(record.reasonCode, `${path}.reasonCode`),
    promptKey: parseStableId(record.promptKey, `${path}.promptKey`),
    ownership: parseOwnership(record.ownership, `${path}.ownership`),
    options: parseOptions(record.options, `${path}.options`),
  }
  const allowPass = parseBoolean(record.allowPass, `${path}.allowPass`)
  if (common.options.length === 0 && (kind !== 'choice' || !allowPass)) {
    fail(
      'invalid-pending-resolution',
      `${path}.options`,
      'may be empty only for an explicitly passable choice window.',
    )
  }

  if (kind === 'choice') {
    if (record.priority !== null) {
      fail('invalid-pending-resolution', `${path}.priority`, 'must be null for a choice window.')
    }
    if (!hasHazardCellSelection) return { ...common, kind, allowPass, priority: null }

    let hazardCellSelection: MoveHazardCellSelectionWindow
    try {
      hazardCellSelection = parseMoveHazardCellSelectionWindow(
        record.hazardCellSelection,
        `${path}.hazardCellSelection`,
      )
    }
    catch (error) {
      return fail(
        'invalid-pending-resolution',
        `${path}.hazardCellSelection`,
        error instanceof Error ? error.message : 'must be a valid private hazard-cell window.',
      )
    }
    const declaration = hazardCellSelection.declaration
    const optionIds = common.options.map(option => option.id)
    const hazardOptionIds = hazardCellSelection.options.map(option => option.id)
    const minimum = declaration.constraints.count.kind === 'exact'
      ? declaration.constraints.count.count
      : declaration.constraints.count.minimum
    if (
      declaration.windowId !== common.windowId
      || declaration.move.operationId !== common.operationId
      || common.promptKey !== declaration.promptKey
      || optionIds.length !== hazardOptionIds.length
      || optionIds.some((id, index) => id !== hazardOptionIds[index])
      || allowPass !== (minimum === 0)
      || common.options.some(option => (
        option.selection !== undefined || option.itemSelection !== undefined
      ))
    ) {
      fail(
        'inconsistent-state',
        `${path}.hazardCellSelection`,
        'must exactly match the choice identity, options, prompt, and pass policy.',
      )
    }
    return { ...common, kind, allowPass, priority: null, hazardCellSelection }
  }

  if (!allowPass) {
    fail(
      'inconsistent-state',
      `${path}.allowPass`,
      'reaction windows must allow an explicit decline.',
    )
  }
  const timing = isMoveReactionTiming(record.timing)
    ? record.timing
    : fail(
        'invalid-pending-resolution',
        `${path}.timing`,
        'must be a canonical move reaction timing.',
      )
  const expectedPhase = moveReactionTimingDefinition(timing).phase
  if (common.phase !== expectedPhase) {
    fail(
      'inconsistent-state',
      `${path}.timing`,
      `${timing} reactions must suspend in the ${expectedPhase} phase.`,
    )
  }
  return {
    ...common,
    kind,
    allowPass: true,
    timing,
    priority: parseInteger(
      record.priority,
      `${path}.priority`,
      -PENDING_MOVE_RESOLUTION_LIMITS.reactionPriorityMagnitude,
      PENDING_MOVE_RESOLUTION_LIMITS.reactionPriorityMagnitude,
    ),
    depth: parseInteger(
      record.depth,
      `${path}.depth`,
      0,
      PENDING_MOVE_RESOLUTION_LIMITS.reactionNestedWindowDepth,
    ),
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
    const candidate = parseRecord(entry, entryPath)
    const hasOptionIds = Object.prototype.hasOwnProperty.call(candidate, 'optionIds')
    const record = parseExactRecord(
      entry,
      hasOptionIds ? MULTI_CHOSEN_OPTION_FIELDS : CHOSEN_OPTION_FIELDS,
      entryPath,
    )
    const windowId = parseStableId(record.windowId, `${entryPath}.windowId`)
    const optionId = record.optionId === null
      ? null
      : parseStableId(record.optionId, `${entryPath}.optionId`)
    const optionIds = hasOptionIds
      ? parseBoundedArray(
          record.optionIds,
          `${entryPath}.optionIds`,
          PENDING_MOVE_RESOLUTION_LIMITS.optionsPerWindow,
        ).map((id, optionIndex) => parseStableId(
          id,
          `${entryPath}.optionIds[${optionIndex}]`,
        ))
      : undefined
    if (optionIds && new Set(optionIds).size !== optionIds.length) {
      fail('duplicate-id', `${entryPath}.optionIds`, 'must not contain duplicate option IDs.')
    }
    if (
      optionIds
      && optionId !== moveHazardCellSelectionResponseId(windowId, optionIds)
    ) {
      fail(
        'inconsistent-state',
        `${entryPath}.optionId`,
        'must be the stable audit identity for the canonical multi-cell option IDs.',
      )
    }
    return {
      windowId,
      responseOpId: parseOriginOpId(record.responseOpId, `${entryPath}.responseOpId`),
      optionId,
      ...(optionIds ? { optionIds } : {}),
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
  readonly continuationKind: PendingMoveResolutionContinuationKind
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
  const expectedRuntimeKind = options.continuationKind
  if (
    trace.program.runtimeKind !== expectedRuntimeKind
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
    const pendingOperationEvent = operationEvent as Extract<
      MoveResolutionAuditTrace['events'][number],
      { readonly kind: 'operation' }
    >
    if (window.kind === 'reaction') {
      const operationInput = pendingOperationEvent.input
      if (
        pendingOperationEvent.operationKind !== 'reaction-request'
        || !isPlainRecord(operationInput)
        || operationInput.timing !== window.timing
        || operationInput.priority !== window.priority
        || window.depth !== trace.ancestry.length
      ) {
        fail(
          'inconsistent-state',
          windowPath,
          'reaction timing and priority must match the reviewed pending operation trace.',
        )
      }
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

const assertHazardCellWindowBindings = (input: {
  readonly windows: readonly PendingMoveResponseWindow[]
  readonly resolutionId: string
  readonly originMapSlug: string
  readonly actorPlacementId: string
  readonly canonicalMoveId: string
  readonly readSet: readonly PendingMoveResolutionResourceRead[]
  readonly path: string
}): void => {
  const mapReads = input.readSet.filter(read => read.kind === 'map')
  const mapRead = mapReads.length === 1 ? mapReads[0] : undefined
  for (const [index, window] of input.windows.entries()) {
    if (window.kind !== 'choice' || !window.hazardCellSelection) continue
    const declaration = window.hazardCellSelection.declaration
    if (
      declaration.move.resolutionId !== input.resolutionId
      || declaration.move.actorPlacementId !== input.actorPlacementId
      || declaration.move.canonicalMoveId !== input.canonicalMoveId
      || declaration.map.slug !== input.originMapSlug
      || declaration.map.revision !== mapRead?.revision
    ) {
      fail(
        'inconsistent-state',
        `${input.path}.outstandingWindows[${index}].hazardCellSelection`,
        'must match the durable resolution identity and current authoritative map read.',
      )
    }
  }
}

/** Strictly parse, cross-check, detach, and freeze a durable suspended resolution. */
export const parsePendingMoveResolution = (
  value: unknown,
  path = 'pendingResolution',
): PendingMoveResolution => {
  const record = parseRecordWithOptionalFields(
    detachedJson(value, path),
    ROOT_REQUIRED_FIELDS,
    ROOT_OPTIONAL_FIELDS,
    path,
  )
  if (record.schemaVersion !== PENDING_MOVE_RESOLUTION_SCHEMA_VERSION) {
    fail(
      'unsupported-schema-version',
      `${path}.schemaVersion`,
      `must be ${PENDING_MOVE_RESOLUTION_SCHEMA_VERSION}.`,
    )
  }

  const rawContinuationKind = Object.prototype.hasOwnProperty.call(record, 'continuationKind')
    ? record.continuationKind
    : 'movespec-v2'
  if (
    typeof rawContinuationKind !== 'string'
    || !CONTINUATION_KIND_SET.has(rawContinuationKind)
  ) {
    fail(
      'invalid-pending-resolution',
      `${path}.continuationKind`,
      'must be movespec-v2, ability-follow-ups, or attack-of-opportunity.',
    )
  }
  const continuationKind = rawContinuationKind as PendingMoveResolutionContinuationKind
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
  const continuationContext = parseContinuationContext(
    record.continuationContext,
    continuationKind,
    actorPlacementId,
    originOpId,
    `${path}.continuationContext`,
  )
  const virtualOriginCell = Object.prototype.hasOwnProperty.call(record, 'virtualOriginCell')
    ? requiredContinuationGridAnchor(record.virtualOriginCell, `${path}.virtualOriginCell`)
    : null
  const targetBranchId = Object.prototype.hasOwnProperty.call(record, 'targetBranchId')
    ? parseBoundedText(
        record.targetBranchId,
        `${path}.targetBranchId`,
        PENDING_MOVE_RESOLUTION_LIMITS.identifierChars,
      )
    : null
  if (targetBranchId !== null && !STABLE_ID_PATTERN.test(targetBranchId)) {
    fail(
      'invalid-pending-resolution',
      `${path}.targetBranchId`,
      'must be a stable targeting-branch ID.',
    )
  }
  const rootAreaSelection = Object.prototype.hasOwnProperty.call(record, 'rootAreaSelection')
    ? parseRootAreaSelection(record.rootAreaSelection, `${path}.rootAreaSelection`)
    : null
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
    continuationKind,
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
  assertHazardCellWindowBindings({
    windows: outstandingWindows,
    resolutionId,
    originMapSlug,
    actorPlacementId,
    canonicalMoveId,
    readSet,
    path,
  })
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
    continuationKind,
    ...(continuationContext ? { continuationContext } : {}),
    resolutionId,
    originMapSlug,
    originOpId,
    actorPlacementId,
    ...(virtualOriginCell ? { virtualOriginCell } : {}),
    ...(targetBranchId ? { targetBranchId } : {}),
    ...(rootAreaSelection ? { rootAreaSelection } : {}),
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

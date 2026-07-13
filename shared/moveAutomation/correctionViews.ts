import {
  isLivePlayMapSlug,
  isLivePlayOpId,
} from '../livePlayCommands'
import type { SheetKind } from '~/types/map'

/** GM-only, value-free projection of one accepted move's correction metadata. */
export const GM_MOVE_CORRECTION_DETAILS_SCHEMA_VERSION = 1 as const
export const GM_MOVE_CORRECTION_DETAILS_LIMITS = Object.freeze({
  operationCount: 256,
  correctionCount: 256,
  identifierChars: 200,
  messageChars: 500,
})

export const GM_MOVE_CORRECTION_EFFECT_KINDS = [
  'temporary-hp',
  'move-usage',
  'hazards',
  'field-effects',
  'encounter-sides',
  'encounter-effects',
  'encounter-counters',
  'turn-resources',
  'zones',
  'placement',
  'hp',
  'combat-stages',
  'conditions',
  'history',
  'pending-resolution',
  'external-resource',
  'other',
] as const

export type GmMoveCorrectionEffectKind = (typeof GM_MOVE_CORRECTION_EFFECT_KINDS)[number]

export interface GmMoveCorrectionMapResourceView {
  readonly kind: 'map'
  readonly mapSlug: string
  /** Revision produced by the accepted move, never a map value. */
  readonly acceptedRevision: number
}

export interface GmMoveCorrectionSheetResourceView {
  readonly kind: 'sheet'
  readonly sheetKind: SheetKind
  readonly sheetSlug: string
  /** Revision produced by the accepted move, never a sheet value. */
  readonly acceptedRevision: number
}

export interface GmMoveCorrectionExternalResourceView {
  readonly kind: 'external-resource'
  readonly resourceKind: 'group-inventory'
  readonly resourceId: string
  readonly acceptedRevision: number
}

export type GmMoveCorrectionResourceView =
  | GmMoveCorrectionMapResourceView
  | GmMoveCorrectionSheetResourceView
  | GmMoveCorrectionExternalResourceView

interface GmMoveCorrectionOperationViewBase {
  readonly operationId: string
  readonly effectKind: GmMoveCorrectionEffectKind
  readonly reasonCode: string
  readonly resource: GmMoveCorrectionResourceView
}

export interface GmMoveCorrectionAvailableOperationView
  extends GmMoveCorrectionOperationViewBase {
  readonly availability: 'available'
}

export interface GmMoveCorrectionUnavailableOperationView
  extends GmMoveCorrectionOperationViewBase {
  readonly availability: 'unavailable'
  readonly safety: 'irreversible' | 'externally-observed'
  readonly unavailableReasonCode: string
}

export type GmMoveCorrectionOperationView =
  | GmMoveCorrectionAvailableOperationView
  | GmMoveCorrectionUnavailableOperationView

export interface GmMoveCorrectionHistoryView {
  readonly correctionOperationId: string
  readonly originOperationId: string
  readonly operationIds: readonly string[]
  readonly status: 'accepted' | 'conflicted'
  readonly createdAt: number
  readonly mapRevision: number | null
  readonly reasonCode?: string
  readonly message?: string
}

export interface GmMoveCorrectionDetails {
  readonly schemaVersion: typeof GM_MOVE_CORRECTION_DETAILS_SCHEMA_VERSION
  readonly mapSlug: string
  readonly originOperationId: string
  readonly moveName: string
  readonly acceptedAt: number
  readonly acceptedRevision: number
  readonly operations: readonly GmMoveCorrectionOperationView[]
  readonly corrections: readonly GmMoveCorrectionHistoryView[]
}

export class GmMoveCorrectionDetailsValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GmMoveCorrectionDetailsValidationError'
  }
}

type UnknownRecord = Record<string, unknown>

const OPERATION_ID_PATTERN = /^[A-Za-z0-9]+(?:[._:/-][A-Za-z0-9]+)*$/
const EFFECT_KIND_SET = new Set<unknown>(GM_MOVE_CORRECTION_EFFECT_KINDS)

const fail = (message: string): never => {
  throw new GmMoveCorrectionDetailsValidationError(message)
}

const isRecord = (value: unknown): value is UnknownRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const assertExactKeys = (
  value: UnknownRecord,
  allowed: ReadonlySet<string>,
  label: string,
): void => {
  for (const key of allowed) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) fail(`${label}.${key} is required.`)
  }
  const unknown = Object.keys(value).find(key => !allowed.has(key))
  if (unknown) fail(`${label}.${unknown} is not supported.`)
}

const boundedText = (
  value: unknown,
  label: string,
  maxLength: number = GM_MOVE_CORRECTION_DETAILS_LIMITS.identifierChars,
): string => {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > maxLength
    || value.trim() !== value
    || /[\u0000-\u001f\u007f]/.test(value)
  ) return fail(`${label} must be bounded non-empty text.`)
  return value
}

const operationIdentifier = (value: unknown, label: string): string => {
  const identifier = boundedText(value, label)
  if (!OPERATION_ID_PATTERN.test(identifier)) {
    return fail(`${label} must be a stable operation identifier.`)
  }
  return identifier
}

const livePlayOperationId = (value: unknown, label: string): string => {
  if (!isLivePlayOpId(value)) return fail(`${label} must be a live-play operation ID.`)
  return value
}

const revision = (value: unknown, label: string): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    return fail(`${label} must be a safe non-negative integer.`)
  }
  return Number(value)
}

const resourceView = (value: unknown, label: string): GmMoveCorrectionResourceView => {
  if (!isRecord(value)) return fail(`${label} must be an object.`)
  if (value.kind === 'map') {
    assertExactKeys(value, new Set(['kind', 'mapSlug', 'acceptedRevision']), label)
    if (!isLivePlayMapSlug(value.mapSlug)) return fail(`${label}.mapSlug is invalid.`)
    return {
      kind: 'map',
      mapSlug: value.mapSlug,
      acceptedRevision: revision(value.acceptedRevision, `${label}.acceptedRevision`),
    }
  }
  if (value.kind === 'sheet') {
    assertExactKeys(
      value,
      new Set(['kind', 'sheetKind', 'sheetSlug', 'acceptedRevision']),
      label,
    )
    if (value.sheetKind !== 'pokemon' && value.sheetKind !== 'trainer') {
      return fail(`${label}.sheetKind is unsupported.`)
    }
    return {
      kind: 'sheet',
      sheetKind: value.sheetKind,
      sheetSlug: boundedText(value.sheetSlug, `${label}.sheetSlug`),
      acceptedRevision: revision(value.acceptedRevision, `${label}.acceptedRevision`),
    }
  }
  if (value.kind === 'external-resource') {
    assertExactKeys(
      value,
      new Set(['kind', 'resourceKind', 'resourceId', 'acceptedRevision']),
      label,
    )
    if (value.resourceKind !== 'group-inventory') {
      return fail(`${label}.resourceKind is unsupported.`)
    }
    return {
      kind: 'external-resource',
      resourceKind: 'group-inventory',
      resourceId: boundedText(value.resourceId, `${label}.resourceId`),
      acceptedRevision: revision(value.acceptedRevision, `${label}.acceptedRevision`),
    }
  }
  return fail(`${label}.kind is unsupported.`)
}

const operationView = (
  value: unknown,
  label: string,
): GmMoveCorrectionOperationView => {
  if (!isRecord(value)) return fail(`${label} must be an object.`)
  const variantKeys = value.availability === 'unavailable'
    ? ['safety', 'unavailableReasonCode']
    : []
  assertExactKeys(
    value,
    new Set([
      'operationId',
      'effectKind',
      'reasonCode',
      'resource',
      'availability',
      ...variantKeys,
    ]),
    label,
  )
  const operationId = operationIdentifier(value.operationId, `${label}.operationId`)
  if (!EFFECT_KIND_SET.has(value.effectKind)) return fail(`${label}.effectKind is unsupported.`)
  const common = {
    operationId,
    effectKind: value.effectKind as GmMoveCorrectionEffectKind,
    reasonCode: boundedText(value.reasonCode, `${label}.reasonCode`),
    resource: resourceView(value.resource, `${label}.resource`),
  }
  if (value.availability === 'available') return { ...common, availability: 'available' }
  if (value.availability !== 'unavailable') return fail(`${label}.availability is unsupported.`)
  if (value.safety !== 'irreversible' && value.safety !== 'externally-observed') {
    return fail(`${label}.safety is unsupported.`)
  }
  return {
    ...common,
    availability: 'unavailable',
    safety: value.safety,
    unavailableReasonCode: boundedText(
      value.unavailableReasonCode,
      `${label}.unavailableReasonCode`,
    ),
  }
}

const operationIdList = (
  value: unknown,
  label: string,
  knownAvailableIds: ReadonlySet<string>,
): readonly string[] => {
  if (
    !Array.isArray(value)
    || value.length === 0
    || value.length > GM_MOVE_CORRECTION_DETAILS_LIMITS.operationCount
  ) {
    return fail(`${label} must be a non-empty bounded array.`)
  }
  const ids: string[] = []
  const seen = new Set<string>()
  for (const [index, item] of value.entries()) {
    const id = operationIdentifier(item, `${label}.${index}`)
    if (seen.has(id)) fail(`${label} contains duplicate operation ${id}.`)
    if (!knownAvailableIds.has(id)) fail(`${label} references unavailable operation ${id}.`)
    seen.add(id)
    ids.push(id)
  }
  return ids
}

const historyView = (
  value: unknown,
  label: string,
  originOperationId: string,
  knownAvailableIds: ReadonlySet<string>,
): GmMoveCorrectionHistoryView => {
  if (!isRecord(value)) return fail(`${label} must be an object.`)
  const optionalKeys = [
    ...(value.reasonCode === undefined ? [] : ['reasonCode']),
    ...(value.message === undefined ? [] : ['message']),
  ]
  assertExactKeys(
    value,
    new Set([
      'correctionOperationId',
      'originOperationId',
      'operationIds',
      'status',
      'createdAt',
      'mapRevision',
      ...optionalKeys,
    ]),
    label,
  )
  const correctionOperationId = livePlayOperationId(
    value.correctionOperationId,
    `${label}.correctionOperationId`,
  )
  const correctionOriginId = livePlayOperationId(
    value.originOperationId,
    `${label}.originOperationId`,
  )
  if (correctionOriginId !== originOperationId || correctionOperationId === originOperationId) {
    return fail(`${label} has invalid correction ancestry.`)
  }
  if (value.status !== 'accepted' && value.status !== 'conflicted') {
    return fail(`${label}.status is unsupported.`)
  }
  if (value.mapRevision !== null) revision(value.mapRevision, `${label}.mapRevision`)
  const reasonCode = value.reasonCode === undefined
    ? undefined
    : boundedText(value.reasonCode, `${label}.reasonCode`)
  const message = value.message === undefined
    ? undefined
    : boundedText(
        value.message,
        `${label}.message`,
        GM_MOVE_CORRECTION_DETAILS_LIMITS.messageChars,
      )
  if (value.status === 'accepted' && (reasonCode !== undefined || message !== undefined)) {
    return fail(`${label} accepted entries cannot carry conflict details.`)
  }
  if (value.status === 'conflicted' && reasonCode === undefined) {
    return fail(`${label} conflicted entries require a reason code.`)
  }
  return {
    correctionOperationId,
    originOperationId: correctionOriginId,
    operationIds: operationIdList(
      value.operationIds,
      `${label}.operationIds`,
      knownAvailableIds,
    ),
    status: value.status,
    createdAt: revision(value.createdAt, `${label}.createdAt`),
    mapRevision: value.mapRevision === null ? null : Number(value.mapRevision),
    ...(reasonCode === undefined ? {} : { reasonCode }),
    ...(message === undefined ? {} : { message }),
  }
}

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  return Object.freeze(value)
}

/** Strictly validate and detach a GM-only correction-details response. */
export const parseGmMoveCorrectionDetails = (
  value: unknown,
): GmMoveCorrectionDetails => {
  if (!isRecord(value)) return fail('GM move correction details must be an object.')
  assertExactKeys(
    value,
    new Set([
      'schemaVersion',
      'mapSlug',
      'originOperationId',
      'moveName',
      'acceptedAt',
      'acceptedRevision',
      'operations',
      'corrections',
    ]),
    'details',
  )
  if (value.schemaVersion !== GM_MOVE_CORRECTION_DETAILS_SCHEMA_VERSION) {
    return fail('details.schemaVersion is unsupported.')
  }
  if (!isLivePlayMapSlug(value.mapSlug)) return fail('details.mapSlug is invalid.')
  const originOperationId = livePlayOperationId(
    value.originOperationId,
    'details.originOperationId',
  )
  if (
    !Array.isArray(value.operations)
    || value.operations.length > GM_MOVE_CORRECTION_DETAILS_LIMITS.operationCount
  ) {
    return fail('details.operations must be a bounded array.')
  }
  const operations = value.operations.map((operation, index) => (
    operationView(operation, `details.operations.${index}`)
  ))
  const operationIds = new Set<string>()
  for (const operation of operations) {
    if (operationIds.has(operation.operationId)) {
      return fail(`details.operations duplicates ${operation.operationId}.`)
    }
    operationIds.add(operation.operationId)
  }
  const availableIds = new Set(
    operations
      .filter((operation): operation is GmMoveCorrectionAvailableOperationView => (
        operation.availability === 'available'
      ))
      .map(operation => operation.operationId),
  )
  if (
    !Array.isArray(value.corrections)
    || value.corrections.length > GM_MOVE_CORRECTION_DETAILS_LIMITS.correctionCount
  ) {
    return fail('details.corrections must be a bounded array.')
  }
  const corrections = value.corrections.map((correction, index) => historyView(
    correction,
    `details.corrections.${index}`,
    originOperationId,
    availableIds,
  ))
  const correctionIds = new Set<string>()
  for (const correction of corrections) {
    if (correctionIds.has(correction.correctionOperationId)) {
      return fail(`details.corrections duplicates ${correction.correctionOperationId}.`)
    }
    correctionIds.add(correction.correctionOperationId)
  }

  return deepFreeze({
    schemaVersion: GM_MOVE_CORRECTION_DETAILS_SCHEMA_VERSION,
    mapSlug: value.mapSlug,
    originOperationId,
    moveName: boundedText(value.moveName, 'details.moveName'),
    acceptedAt: revision(value.acceptedAt, 'details.acceptedAt'),
    acceptedRevision: revision(value.acceptedRevision, 'details.acceptedRevision'),
    operations,
    corrections,
  })
}

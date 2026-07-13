import {
  PENDING_MOVE_RESOLUTION_LIMITS,
  parsePendingMoveResolutionPublicSummary,
  type PendingMoveResolutionPublicSummary,
  type PendingMoveResponseOption,
  type PendingMoveResponseWindowKind,
} from './pendingResolution'
import { isSlug } from '../paths'
import {
  MOVE_SPEC_PHASES,
  type MoveSpecPhase,
} from './spec'

/** Client-safe projection version for authorized durable move-response prompts. */
export const PENDING_MOVE_RESPONSE_VIEW_SCHEMA_VERSION = 1 as const

export const PENDING_MOVE_RESPONSE_VIEW_LIMITS = Object.freeze({
  windows: 256,
  identifierChars: PENDING_MOVE_RESOLUTION_LIMITS.identifierChars,
})

/**
 * Window detail available only after server authorization. Ownership principals,
 * operation IDs, target identities, reads, rolls, and audit traces stay private.
 */
export interface PendingMoveResponseWindowView {
  readonly schemaVersion: typeof PENDING_MOVE_RESPONSE_VIEW_SCHEMA_VERSION
  readonly resolution: PendingMoveResolutionPublicSummary
  readonly window: {
    readonly windowId: string
    readonly kind: PendingMoveResponseWindowKind
    readonly phase: MoveSpecPhase
    readonly reasonCode: string
    readonly promptKey: string
    readonly options: readonly PendingMoveResponseOption[]
    readonly allowPass: boolean
    readonly priority: number | null
  }
}

/** Authorized windows for one currently accessible map. */
export interface PendingMoveResponseWindowList {
  readonly schemaVersion: typeof PENDING_MOVE_RESPONSE_VIEW_SCHEMA_VERSION
  readonly mapSlug: string
  readonly windows: readonly PendingMoveResponseWindowView[]
}

type UnknownRecord = Record<string, unknown>

const ROOT_FIELDS = ['schemaVersion', 'mapSlug', 'windows'] as const
const VIEW_FIELDS = ['schemaVersion', 'resolution', 'window'] as const
const WINDOW_FIELDS = [
  'windowId',
  'kind',
  'phase',
  'reasonCode',
  'promptKey',
  'options',
  'allowPass',
  'priority',
] as const
const OPTION_FIELDS = ['id', 'labelKey'] as const
const STABLE_ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const WINDOW_KIND_SET = new Set<unknown>(['choice', 'reaction'])
const PHASE_SET = new Set<unknown>(MOVE_SPEC_PHASES)

const isPlainRecord = (value: unknown): value is UnknownRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const exactRecord = (
  value: unknown,
  fields: readonly string[],
  path: string,
): UnknownRecord => {
  if (!isPlainRecord(value)) throw new Error(`${path} must be a plain object.`)
  const expected = new Set(fields)
  const missing = fields.filter(field => !Object.prototype.hasOwnProperty.call(value, field))
  const unknown = Object.keys(value).filter(field => !expected.has(field))
  if (missing.length > 0 || unknown.length > 0) {
    throw new Error(`${path} must contain exactly ${fields.join(', ')}.`)
  }
  return value
}

const stableId = (value: unknown, path: string): string => {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > PENDING_MOVE_RESPONSE_VIEW_LIMITS.identifierChars
    || !STABLE_ID_PATTERN.test(value)
  ) {
    throw new Error(`${path} must be a bounded lowercase stable identifier.`)
  }
  return value
}

const parseOption = (value: unknown, path: string): PendingMoveResponseOption => {
  const record = exactRecord(value, OPTION_FIELDS, path)
  return Object.freeze({
    id: stableId(record.id, `${path}.id`),
    labelKey: stableId(record.labelKey, `${path}.labelKey`),
  })
}

const parseWindow = (
  value: unknown,
  path: string,
): PendingMoveResponseWindowView['window'] => {
  const record = exactRecord(value, WINDOW_FIELDS, path)
  if (!WINDOW_KIND_SET.has(record.kind)) throw new Error(`${path}.kind is unsupported.`)
  if (!PHASE_SET.has(record.phase)) throw new Error(`${path}.phase is unsupported.`)
  if (!Array.isArray(record.options)) throw new Error(`${path}.options must be an array.`)
  if (record.options.length > PENDING_MOVE_RESOLUTION_LIMITS.optionsPerWindow) {
    throw new Error(`${path}.options exceeds the response option limit.`)
  }
  if (typeof record.allowPass !== 'boolean') throw new Error(`${path}.allowPass must be boolean.`)
  if (
    record.priority !== null
    && (
      !Number.isSafeInteger(record.priority)
      || Math.abs(Number(record.priority)) > PENDING_MOVE_RESOLUTION_LIMITS.reactionPriorityMagnitude
    )
  ) {
    throw new Error(`${path}.priority is invalid.`)
  }

  const options = record.options.map((option, index) => parseOption(option, `${path}.options[${index}]`))
  const optionIds = new Set(options.map(option => option.id))
  if (optionIds.size !== options.length) throw new Error(`${path}.options contains duplicate IDs.`)

  return Object.freeze({
    windowId: stableId(record.windowId, `${path}.windowId`),
    kind: record.kind as PendingMoveResponseWindowKind,
    phase: record.phase as MoveSpecPhase,
    reasonCode: stableId(record.reasonCode, `${path}.reasonCode`),
    promptKey: stableId(record.promptKey, `${path}.promptKey`),
    options: Object.freeze(options),
    allowPass: record.allowPass,
    priority: record.priority as number | null,
  })
}

const parseView = (value: unknown, path: string): PendingMoveResponseWindowView => {
  const record = exactRecord(value, VIEW_FIELDS, path)
  if (record.schemaVersion !== PENDING_MOVE_RESPONSE_VIEW_SCHEMA_VERSION) {
    throw new Error(`${path}.schemaVersion is unsupported.`)
  }
  const resolution = parsePendingMoveResolutionPublicSummary(record.resolution, `${path}.resolution`)
  if (resolution.status !== 'pending') throw new Error(`${path}.resolution must be pending.`)
  return Object.freeze({
    schemaVersion: PENDING_MOVE_RESPONSE_VIEW_SCHEMA_VERSION,
    resolution,
    window: parseWindow(record.window, `${path}.window`),
  })
}

/** Strictly validate, detach, and freeze an authorized prompt-list response. */
export const parsePendingMoveResponseWindowList = (
  value: unknown,
): PendingMoveResponseWindowList => {
  const detached = JSON.parse(JSON.stringify(value)) as unknown
  const record = exactRecord(detached, ROOT_FIELDS, 'pendingMoveResponses')
  if (record.schemaVersion !== PENDING_MOVE_RESPONSE_VIEW_SCHEMA_VERSION) {
    throw new Error('pendingMoveResponses.schemaVersion is unsupported.')
  }
  if (!isSlug(record.mapSlug)) throw new Error('pendingMoveResponses.mapSlug is invalid.')
  if (!Array.isArray(record.windows)) throw new Error('pendingMoveResponses.windows must be an array.')
  if (record.windows.length > PENDING_MOVE_RESPONSE_VIEW_LIMITS.windows) {
    throw new Error('pendingMoveResponses.windows exceeds the authorized prompt limit.')
  }

  const windows = record.windows.map((view, index) => parseView(
    view,
    `pendingMoveResponses.windows[${index}]`,
  ))
  const keys = windows.map(view => `${view.resolution.resolutionId}:${view.window.windowId}`)
  if (new Set(keys).size !== keys.length) {
    throw new Error('pendingMoveResponses.windows contains duplicate resolution/window IDs.')
  }

  return Object.freeze({
    schemaVersion: PENDING_MOVE_RESPONSE_VIEW_SCHEMA_VERSION,
    mapSlug: record.mapSlug,
    windows: Object.freeze(windows),
  })
}

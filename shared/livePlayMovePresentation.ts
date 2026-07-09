import { isLivePlayOpId } from './livePlayCommands'
import type {
  LivePlayResolvedMoveArea,
  LivePlayResolvedMovePassMovement,
  LivePlayResolvedMoveResult,
} from './livePlayMoveResolution'
import {
  MOVE_AUTOMATION_AREA_DIRECTIONS,
  type MoveAutomationAreaDirection,
  type MoveAutomationAreaTemplateKind,
} from '~/types/moveAutomation'
import type { GridAnchor } from '~/types/map'

export const LIVE_PLAY_MOVE_PRESENTATION_SCHEMA_VERSION = 1 as const
export const LIVE_PLAY_MOVE_PRESENTATION_MAX_TEXT_LENGTH = 120 as const
export const LIVE_PLAY_MOVE_PRESENTATION_MAX_TARGET_IDS = 128 as const
export const LIVE_PLAY_MOVE_PRESENTATION_MAX_CELLS = 512 as const

export const LIVE_PLAY_MOVE_PRESENTATION_OUTCOME_KINDS = [
  'self',
  'no-target',
  'miss',
  'hit',
  'mixed',
] as const

export type LivePlayMovePresentationOutcomeKind = (
  typeof LIVE_PLAY_MOVE_PRESENTATION_OUTCOME_KINDS
)[number]

export interface LivePlayMovePresentationIdentity {
  readonly name: string
  readonly type: string
}

export interface LivePlayMovePresentationAreaGeometry {
  readonly templateKind: MoveAutomationAreaTemplateKind
  readonly cells: readonly GridAnchor[]
  readonly direction?: MoveAutomationAreaDirection
}

export interface LivePlayMovePresentationPassGeometry {
  readonly from: GridAnchor
  readonly destination: GridAnchor
  readonly pathCells: readonly GridAnchor[]
  readonly direction: MoveAutomationAreaDirection
}

/**
 * Bounded, mechanics-free data needed to present one accepted move.
 *
 * This summary is stored in the terminal operation result and copied through
 * accepted-command realtime delivery. It identifies already-resolved outcomes;
 * clients must never use it to apply mechanics or infer a new result.
 */
export interface LivePlayMovePresentationSummary {
  readonly schemaVersion: typeof LIVE_PLAY_MOVE_PRESENTATION_SCHEMA_VERSION
  readonly operationId: string
  readonly actorPlacementId: string
  readonly move: LivePlayMovePresentationIdentity
  readonly attackedTargetIds: readonly string[]
  readonly hitTargetIds: readonly string[]
  readonly outcomeKind: LivePlayMovePresentationOutcomeKind
  readonly area?: LivePlayMovePresentationAreaGeometry
  readonly pass?: LivePlayMovePresentationPassGeometry
}

export type LivePlayMovePresentationValidationCode =
  | 'not-object'
  | 'missing-field'
  | 'unknown-field'
  | 'invalid-field'
  | 'duplicate-value'
  | 'too-many-values'
  | 'inconsistent-outcome'

export interface LivePlayMovePresentationValidationIssue {
  readonly path: string
  readonly code: LivePlayMovePresentationValidationCode
  readonly message: string
}

export type ParseLivePlayMovePresentationSummaryResult =
  | {
      readonly valid: true
      readonly presentation: LivePlayMovePresentationSummary
      readonly issues: readonly []
    }
  | {
      readonly valid: false
      readonly issues: readonly LivePlayMovePresentationValidationIssue[]
    }

type UnknownRecord = Record<string, unknown>
type MutableIssues = LivePlayMovePresentationValidationIssue[]

const ROOT_FIELDS = new Set([
  'schemaVersion',
  'operationId',
  'actorPlacementId',
  'move',
  'attackedTargetIds',
  'hitTargetIds',
  'outcomeKind',
  'area',
  'pass',
])
const MOVE_FIELDS = new Set(['name', 'type'])
const AREA_FIELDS = new Set(['templateKind', 'cells', 'direction'])
const PASS_FIELDS = new Set(['from', 'destination', 'pathCells', 'direction'])
const AREA_TEMPLATE_KINDS = new Set<unknown>([
  'burst',
  'close-blast',
  'ranged-blast',
  'cone',
  'line',
  'pass',
  'cardinally-adjacent',
])
const AREA_DIRECTIONS = new Set<unknown>(MOVE_AUTOMATION_AREA_DIRECTIONS)
const OUTCOME_KINDS = new Set<unknown>(LIVE_PLAY_MOVE_PRESENTATION_OUTCOME_KINDS)
const isRecord = (value: unknown): value is UnknownRecord => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const hasOwn = (record: UnknownRecord, key: string): boolean => (
  Object.prototype.hasOwnProperty.call(record, key)
)

const addIssue = (
  issues: MutableIssues,
  path: string,
  code: LivePlayMovePresentationValidationCode,
  message: string,
): void => {
  issues.push({ path, code, message })
}

const requireField = (
  record: UnknownRecord,
  key: string,
  path: string,
  issues: MutableIssues,
): void => {
  if (!hasOwn(record, key)) addIssue(issues, path, 'missing-field', `${path} is required.`)
}

const rejectUnknownFields = (
  record: UnknownRecord,
  fields: ReadonlySet<string>,
  path: string,
  issues: MutableIssues,
): void => {
  for (const key of Object.keys(record)) {
    if (fields.has(key)) continue
    const fieldPath = path ? `${path}.${key}` : key
    addIssue(issues, fieldPath, 'unknown-field', `${fieldPath} is not supported.`)
  }
}

const parseText = (
  value: unknown,
  path: string,
  issues: MutableIssues,
): string | null => {
  if (typeof value !== 'string') {
    addIssue(issues, path, 'invalid-field', `${path} must be a non-empty string.`)
    return null
  }
  const text = value.trim()
  if (!text || text.length > LIVE_PLAY_MOVE_PRESENTATION_MAX_TEXT_LENGTH) {
    addIssue(
      issues,
      path,
      'invalid-field',
      `${path} must be between 1 and ${LIVE_PLAY_MOVE_PRESENTATION_MAX_TEXT_LENGTH} characters.`,
    )
    return null
  }
  return text
}

const parseOperationId = (
  value: unknown,
  path: string,
  issues: MutableIssues,
): string | null => {
  if (isLivePlayOpId(value)) return value
  addIssue(issues, path, 'invalid-field', `${path} must be a valid live-play operation ID.`)
  return null
}

const parseStringArray = (
  value: unknown,
  path: string,
  issues: MutableIssues,
): string[] | null => {
  if (!Array.isArray(value)) {
    addIssue(issues, path, 'invalid-field', `${path} must be an array.`)
    return null
  }
  if (value.length > LIVE_PLAY_MOVE_PRESENTATION_MAX_TARGET_IDS) {
    addIssue(
      issues,
      path,
      'too-many-values',
      `${path} must contain at most ${LIVE_PLAY_MOVE_PRESENTATION_MAX_TARGET_IDS} values.`,
    )
  }

  const parsed: string[] = []
  const seen = new Set<string>()
  for (const [index, item] of value.entries()) {
    const text = parseText(item, `${path}[${index}]`, issues)
    if (!text) continue
    if (seen.has(text)) {
      addIssue(issues, `${path}[${index}]`, 'duplicate-value', `${path} contains duplicate value ${text}.`)
      continue
    }
    seen.add(text)
    parsed.push(text)
  }
  return parsed
}

const parseGridAnchor = (
  value: unknown,
  path: string,
  issues: MutableIssues,
): GridAnchor | null => {
  if (!isRecord(value)) {
    addIssue(issues, path, 'invalid-field', `${path} must be an object with x, y, and z.`)
    return null
  }
  rejectUnknownFields(value, new Set(['x', 'y', 'z']), path, issues)
  if (!Number.isSafeInteger(value.x) || !Number.isSafeInteger(value.y) || !Number.isSafeInteger(value.z)) {
    addIssue(issues, path, 'invalid-field', `${path} must contain safe integer x, y, and z values.`)
    return null
  }
  return { x: value.x as number, y: value.y as number, z: value.z as number }
}

const parseGridAnchors = (
  value: unknown,
  path: string,
  issues: MutableIssues,
): GridAnchor[] | null => {
  if (!Array.isArray(value)) {
    addIssue(issues, path, 'invalid-field', `${path} must be an array.`)
    return null
  }
  if (value.length > LIVE_PLAY_MOVE_PRESENTATION_MAX_CELLS) {
    addIssue(
      issues,
      path,
      'too-many-values',
      `${path} must contain at most ${LIVE_PLAY_MOVE_PRESENTATION_MAX_CELLS} cells.`,
    )
  }
  const anchors: GridAnchor[] = []
  const seen = new Set<string>()
  for (const [index, item] of value.entries()) {
    const anchor = parseGridAnchor(item, `${path}[${index}]`, issues)
    if (!anchor) continue
    const key = `${anchor.x}:${anchor.y}:${anchor.z}`
    if (seen.has(key)) {
      addIssue(issues, `${path}[${index}]`, 'duplicate-value', `${path} contains duplicate cell ${key}.`)
      continue
    }
    seen.add(key)
    anchors.push(anchor)
  }
  return anchors
}

const parseDirection = (
  value: unknown,
  path: string,
  issues: MutableIssues,
): MoveAutomationAreaDirection | null => {
  if (AREA_DIRECTIONS.has(value)) return value as MoveAutomationAreaDirection
  addIssue(issues, path, 'invalid-field', `${path} must be a supported area direction.`)
  return null
}

const parseMove = (
  value: unknown,
  issues: MutableIssues,
): LivePlayMovePresentationIdentity | null => {
  if (!isRecord(value)) {
    addIssue(issues, 'move', 'invalid-field', 'move must be an object.')
    return null
  }
  rejectUnknownFields(value, MOVE_FIELDS, 'move', issues)
  requireField(value, 'name', 'move.name', issues)
  requireField(value, 'type', 'move.type', issues)
  const name = parseText(value.name, 'move.name', issues)
  const type = parseText(value.type, 'move.type', issues)
  return name && type ? { name, type } : null
}

const parseArea = (
  value: unknown,
  issues: MutableIssues,
): LivePlayMovePresentationAreaGeometry | null => {
  if (!isRecord(value)) {
    addIssue(issues, 'area', 'invalid-field', 'area must be an object.')
    return null
  }
  rejectUnknownFields(value, AREA_FIELDS, 'area', issues)
  requireField(value, 'templateKind', 'area.templateKind', issues)
  requireField(value, 'cells', 'area.cells', issues)
  if (!AREA_TEMPLATE_KINDS.has(value.templateKind)) {
    addIssue(issues, 'area.templateKind', 'invalid-field', 'area.templateKind must be a supported template kind.')
  }
  const cells = parseGridAnchors(value.cells, 'area.cells', issues)
  const direction = hasOwn(value, 'direction') ? parseDirection(value.direction, 'area.direction', issues) : null
  if (!AREA_TEMPLATE_KINDS.has(value.templateKind) || !cells) return null
  return {
    templateKind: value.templateKind as MoveAutomationAreaTemplateKind,
    cells,
    ...(direction ? { direction } : {}),
  }
}

const parsePass = (
  value: unknown,
  issues: MutableIssues,
): LivePlayMovePresentationPassGeometry | null => {
  if (!isRecord(value)) {
    addIssue(issues, 'pass', 'invalid-field', 'pass must be an object.')
    return null
  }
  rejectUnknownFields(value, PASS_FIELDS, 'pass', issues)
  for (const field of PASS_FIELDS) requireField(value, field, `pass.${field}`, issues)
  const from = parseGridAnchor(value.from, 'pass.from', issues)
  const destination = parseGridAnchor(value.destination, 'pass.destination', issues)
  const pathCells = parseGridAnchors(value.pathCells, 'pass.pathCells', issues)
  const direction = parseDirection(value.direction, 'pass.direction', issues)
  if (!from || !destination || !pathCells || !direction) return null
  return { from, destination, pathCells, direction }
}

export const resolveLivePlayMovePresentationOutcomeKind = (input: {
  readonly attackedTargetIds: readonly string[]
  readonly hitTargetIds: readonly string[]
  readonly selectedTargetIds?: readonly string[]
  readonly area?: unknown
}): LivePlayMovePresentationOutcomeKind => {
  if (input.attackedTargetIds.length === 0) {
    return (input.selectedTargetIds?.length ?? 0) === 0 && input.area === undefined
      ? 'self'
      : 'no-target'
  }
  if (input.hitTargetIds.length === 0) return 'miss'
  if (input.hitTargetIds.length === input.attackedTargetIds.length) return 'hit'
  return 'mixed'
}

export const parseLivePlayMovePresentationSummary = (
  value: unknown,
): ParseLivePlayMovePresentationSummaryResult => {
  const issues: MutableIssues = []
  if (!isRecord(value)) {
    return {
      valid: false,
      issues: [{ path: '', code: 'not-object', message: 'Move presentation summary must be an object.' }],
    }
  }

  rejectUnknownFields(value, ROOT_FIELDS, '', issues)
  for (const field of ['schemaVersion', 'operationId', 'actorPlacementId', 'move', 'attackedTargetIds', 'hitTargetIds', 'outcomeKind']) {
    requireField(value, field, field, issues)
  }
  if (value.schemaVersion !== LIVE_PLAY_MOVE_PRESENTATION_SCHEMA_VERSION) {
    addIssue(
      issues,
      'schemaVersion',
      'invalid-field',
      `schemaVersion must be ${LIVE_PLAY_MOVE_PRESENTATION_SCHEMA_VERSION}.`,
    )
  }
  const operationId = parseOperationId(value.operationId, 'operationId', issues)
  const actorPlacementId = parseText(value.actorPlacementId, 'actorPlacementId', issues)
  const move = parseMove(value.move, issues)
  const attackedTargetIds = parseStringArray(value.attackedTargetIds, 'attackedTargetIds', issues)
  const hitTargetIds = parseStringArray(value.hitTargetIds, 'hitTargetIds', issues)
  if (!OUTCOME_KINDS.has(value.outcomeKind)) {
    addIssue(issues, 'outcomeKind', 'invalid-field', 'outcomeKind must be self, no-target, miss, hit, or mixed.')
  }
  const area = hasOwn(value, 'area') ? parseArea(value.area, issues) : null
  const pass = hasOwn(value, 'pass') ? parsePass(value.pass, issues) : null

  if (attackedTargetIds && hitTargetIds) {
    const attacked = new Set(attackedTargetIds)
    for (const [index, hitTargetId] of hitTargetIds.entries()) {
      if (attacked.has(hitTargetId)) continue
      addIssue(
        issues,
        `hitTargetIds[${index}]`,
        'inconsistent-outcome',
        `Hit target ${hitTargetId} is not present in attackedTargetIds.`,
      )
    }
    if (OUTCOME_KINDS.has(value.outcomeKind)) {
      const hasGeometry = hasOwn(value, 'area') || hasOwn(value, 'pass')
      const zeroTargetOutcomeIsValid = attackedTargetIds.length === 0 && (
        value.outcomeKind === 'no-target'
        || (!hasGeometry && value.outcomeKind === 'self')
      )
      const expected = attackedTargetIds.length === 0
        ? null
        : resolveLivePlayMovePresentationOutcomeKind({ attackedTargetIds, hitTargetIds })
      if (!zeroTargetOutcomeIsValid && expected !== value.outcomeKind) {
        addIssue(
          issues,
          'outcomeKind',
          'inconsistent-outcome',
          `outcomeKind ${String(value.outcomeKind)} does not match attacked/hit target identity.`,
        )
      }
    }
  }

  if (
    issues.length > 0
    || !operationId
    || !actorPlacementId
    || !move
    || !attackedTargetIds
    || !hitTargetIds
    || !OUTCOME_KINDS.has(value.outcomeKind)
  ) {
    return { valid: false, issues }
  }

  return {
    valid: true,
    presentation: {
      schemaVersion: LIVE_PLAY_MOVE_PRESENTATION_SCHEMA_VERSION,
      operationId,
      actorPlacementId,
      move,
      attackedTargetIds,
      hitTargetIds,
      outcomeKind: value.outcomeKind as LivePlayMovePresentationOutcomeKind,
      ...(area ? { area } : {}),
      ...(pass ? { pass } : {}),
    },
    issues: [],
  }
}

const areaPresentation = (
  area: LivePlayResolvedMoveArea | undefined,
): LivePlayMovePresentationAreaGeometry | undefined => area ? {
  templateKind: area.template.kind,
  cells: area.cells.map((cell) => ({ ...cell })),
  ...(area.direction ? { direction: area.direction } : {}),
} : undefined

const passPresentation = (
  movement: LivePlayResolvedMovePassMovement | undefined,
): LivePlayMovePresentationPassGeometry | undefined => movement ? {
  from: { ...movement.from },
  destination: { ...movement.destination },
  pathCells: movement.pathCells.map((cell) => ({ ...cell })),
  direction: movement.direction,
} : undefined

export const createLivePlayMovePresentationSummary = (input: {
  readonly operationId: string
  readonly move: LivePlayResolvedMoveResult
}): LivePlayMovePresentationSummary => {
  const attackedTargetIds = [...input.move.transaction.attackedTargetIds]
  const hitTargetIds = [...input.move.transaction.hitTargetIds]
  const candidate: LivePlayMovePresentationSummary = {
    schemaVersion: LIVE_PLAY_MOVE_PRESENTATION_SCHEMA_VERSION,
    operationId: input.operationId,
    actorPlacementId: input.move.actorPlacementId,
    move: {
      name: input.move.moveName,
      type: input.move.script.type,
    },
    attackedTargetIds,
    hitTargetIds,
    outcomeKind: resolveLivePlayMovePresentationOutcomeKind({
      attackedTargetIds,
      hitTargetIds,
      selectedTargetIds: input.move.selectedTargetIds,
      area: input.move.area,
    }),
    ...(input.move.area ? { area: areaPresentation(input.move.area) } : {}),
    ...(input.move.movement ? { pass: passPresentation(input.move.movement) } : {}),
  }
  const parsed = parseLivePlayMovePresentationSummary(candidate)
  if (!parsed.valid) {
    throw new Error(`Resolved move produced invalid presentation data: ${parsed.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`)
  }
  return parsed.presentation
}

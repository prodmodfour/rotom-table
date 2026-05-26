import type { SessionCommandValidationIssue } from './sessionCommandResults'
import {
  type SessionCommandEnvelope,
  type SessionCommandScope,
} from './sessionCommands'
import {
  canUseGmAuthority,
  type PermissionDenied,
  type PermissionResult,
  type SessionActor,
} from './sessionPermissions'
import type { SessionRevision } from './sessionRevisions'
import {
  isRecord,
  validateSessionCommandEnvelope,
} from './sessionCommandValidation'

export const PLACE_HAZARD_COMMAND_TYPE = 'placeHazard' as const
export const REMOVE_HAZARD_COMMAND_TYPE = 'removeHazard' as const
export const HAZARD_COMMAND_TYPES = [
  PLACE_HAZARD_COMMAND_TYPE,
  REMOVE_HAZARD_COMMAND_TYPE,
] as const

export type HazardCommandType = (typeof HAZARD_COMMAND_TYPES)[number]

export const HAZARD_COMMAND_SCOPE_FIELD = 'hazards' as const

export const SESSION_HAZARD_KINDS = [
  'spikes',
  'toxic-spikes',
  'sticky-web',
  'stealth-rock',
  'fire',
] as const

export type SessionHazardKind = (typeof SESSION_HAZARD_KINDS)[number]

export interface SessionHazardCell {
  readonly x: number
  readonly y: number
  readonly z: number
}

export interface SessionHazardPlacement extends SessionHazardCell {
  readonly kind: SessionHazardKind
  /** Toxic Spikes supports up to two layers. Other hazard kinds ignore this value after validation. */
  readonly layer?: number
  /** Optional free-form side/owner label for future move automation. */
  readonly owner?: string
}

export interface PlaceHazardCommandPayload {
  /** Optional map target. When omitted, the server uses the hazard scope map or selected session map. */
  readonly mapSlug?: string
  readonly hazard: SessionHazardPlacement
}

export interface RemoveHazardCell extends SessionHazardCell {
  /** When omitted, every hazard kind on the cell is removed. */
  readonly kind?: SessionHazardKind
}

export interface RemoveHazardCommandPayload {
  /** Optional map target. When omitted, the server uses the hazard scope map or selected session map. */
  readonly mapSlug?: string
  readonly cell: RemoveHazardCell
}

export type PlaceHazardCommand<
  TActor extends SessionActor = SessionActor,
> = SessionCommandEnvelope<
  typeof PLACE_HAZARD_COMMAND_TYPE,
  PlaceHazardCommandPayload,
  TActor,
  SessionRevision
>

export type RemoveHazardCommand<
  TActor extends SessionActor = SessionActor,
> = SessionCommandEnvelope<
  typeof REMOVE_HAZARD_COMMAND_TYPE,
  RemoveHazardCommandPayload,
  TActor,
  SessionRevision
>

export type HazardCommand<TActor extends SessionActor = SessionActor> =
  | PlaceHazardCommand<TActor>
  | RemoveHazardCommand<TActor>

export type HazardCommandPayload = PlaceHazardCommandPayload | RemoveHazardCommandPayload

export const HAZARD_COMMAND_VALIDATION_CODES = [
  'invalid-command-type',
  'invalid-payload',
  'invalid-map-slug',
  'invalid-hazard',
  'invalid-kind',
  'invalid-cell',
  'invalid-layer',
  'invalid-owner',
  'invalid-hazard-scope',
  'permission-denied',
] as const

export type HazardCommandValidationCode =
  (typeof HAZARD_COMMAND_VALIDATION_CODES)[number]

export interface HazardCommandValidationContext {
  /** Hazard placement/removal is GM-only in Live session; this context is reserved for future table policy. */
  readonly assignments?: readonly unknown[]
}

export interface HazardCommandValidationSuccess<
  TCommand extends HazardCommand = HazardCommand,
> {
  readonly valid: true
  readonly command: TCommand
  readonly payload: TCommand['payload']
  readonly mapSlug?: string
  readonly permission: Extract<PermissionResult, { readonly allowed: true }>
  readonly issues: readonly []
}

export interface HazardCommandValidationFailure {
  readonly valid: false
  readonly issues: readonly SessionCommandValidationIssue[]
  readonly permission?: PermissionDenied
}

export type HazardCommandValidationResult<
  TCommand extends HazardCommand = HazardCommand,
> = HazardCommandValidationSuccess<TCommand> | HazardCommandValidationFailure

type MutableIssueList = SessionCommandValidationIssue[]
type UnknownRecord = Record<string, unknown>

const EXPECTED_OBJECT = 'object'
const EXPECTED_NON_EMPTY_STRING = 'non-empty string'
const EXPECTED_GRID_COORDINATE = 'safe non-negative integer grid coordinate'
const EXPECTED_HAZARD_KIND = SESSION_HAZARD_KINDS.join(' | ')
const EXPECTED_LAYER = 'integer 1 or 2'

const hasOwn = (record: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(record, key)

const describeReceived = (value: unknown): string => {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

const addIssue = (
  issues: MutableIssueList,
  path: string,
  code: HazardCommandValidationCode,
  message: string,
  expected?: string,
  received?: unknown,
): void => {
  issues.push({
    path,
    code,
    message,
    ...(expected === undefined ? {} : { expected }),
    ...(received === undefined ? {} : { received: describeReceived(received) }),
  })
}

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0

const isGridCoordinate = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

const isHazardLayer = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= 2

export const isSessionHazardKind = (value: unknown): value is SessionHazardKind =>
  (SESSION_HAZARD_KINDS as readonly unknown[]).includes(value)

export const isHazardCommandType = (value: unknown): value is HazardCommandType =>
  (HAZARD_COMMAND_TYPES as readonly unknown[]).includes(value)

export const isHazardCommandValidationCode = (
  value: unknown,
): value is HazardCommandValidationCode =>
  (HAZARD_COMMAND_VALIDATION_CODES as readonly unknown[]).includes(value)

export const createHazardCommandScope = (mapSlug?: string): SessionCommandScope => ({
  lane: 'hazard',
  field: HAZARD_COMMAND_SCOPE_FIELD,
  ...(mapSlug === undefined ? {} : { mapSlug }),
})

const cloneCell = <TCell extends SessionHazardCell>(cell: TCell): TCell => ({
  ...cell,
  x: cell.x,
  y: cell.y,
  z: cell.z,
})

const cloneHazardPlacement = (hazard: SessionHazardPlacement): SessionHazardPlacement => ({
  kind: hazard.kind,
  x: hazard.x,
  y: hazard.y,
  z: hazard.z,
  ...(hazard.layer === undefined ? {} : { layer: hazard.layer }),
  ...(hazard.owner === undefined ? {} : { owner: hazard.owner }),
})

const clonePlacePayload = (payload: PlaceHazardCommandPayload): PlaceHazardCommandPayload => ({
  ...(payload.mapSlug === undefined ? {} : { mapSlug: payload.mapSlug }),
  hazard: cloneHazardPlacement(payload.hazard),
})

const cloneRemovePayload = (payload: RemoveHazardCommandPayload): RemoveHazardCommandPayload => ({
  ...(payload.mapSlug === undefined ? {} : { mapSlug: payload.mapSlug }),
  cell: {
    ...cloneCell(payload.cell),
    ...(payload.cell.kind === undefined ? {} : { kind: payload.cell.kind }),
  },
})

const collectPayloadMapSlugIssue = (
  payload: UnknownRecord,
  issues: MutableIssueList,
): string | undefined => {
  if (!hasOwn(payload, 'mapSlug')) return undefined
  if (!isNonEmptyString(payload.mapSlug)) {
    addIssue(
      issues,
      'payload.mapSlug',
      'invalid-map-slug',
      'hazard payload.mapSlug must be a non-empty string when provided.',
      EXPECTED_NON_EMPTY_STRING,
      payload.mapSlug,
    )
    return undefined
  }
  return payload.mapSlug
}

const collectHazardCellIssues = (
  cell: unknown,
  path: string,
  issues: MutableIssueList,
): SessionHazardCell | undefined => {
  if (!isRecord(cell)) {
    addIssue(
      issues,
      path,
      'invalid-cell',
      'hazard cell must be an object.',
      EXPECTED_OBJECT,
      cell,
    )
    return undefined
  }

  if (!isGridCoordinate(cell.x)) {
    addIssue(
      issues,
      `${path}.x`,
      'invalid-cell',
      'hazard cell x must be a safe non-negative integer.',
      EXPECTED_GRID_COORDINATE,
      cell.x,
    )
  }
  if (!isGridCoordinate(cell.y)) {
    addIssue(
      issues,
      `${path}.y`,
      'invalid-cell',
      'hazard cell y must be a safe non-negative integer.',
      EXPECTED_GRID_COORDINATE,
      cell.y,
    )
  }
  if (!isGridCoordinate(cell.z)) {
    addIssue(
      issues,
      `${path}.z`,
      'invalid-cell',
      'hazard cell z must be a safe non-negative integer.',
      EXPECTED_GRID_COORDINATE,
      cell.z,
    )
  }

  if (issues.some((issue) => issue.path.startsWith(path))) return undefined
  return { x: cell.x as number, y: cell.y as number, z: cell.z as number }
}

const collectPlaceHazardPayloadIssues = (
  payload: unknown,
  issues: MutableIssueList,
): PlaceHazardCommandPayload | undefined => {
  if (!isRecord(payload)) {
    addIssue(
      issues,
      'payload',
      'invalid-payload',
      'placeHazard payload must be an object.',
      EXPECTED_OBJECT,
      payload,
    )
    return undefined
  }

  const mapSlug = collectPayloadMapSlugIssue(payload, issues)
  const hazard = payload.hazard
  if (!isRecord(hazard)) {
    addIssue(
      issues,
      'payload.hazard',
      'invalid-hazard',
      'placeHazard payload.hazard must be an object.',
      EXPECTED_OBJECT,
      hazard,
    )
    return undefined
  }

  const cell = collectHazardCellIssues(hazard, 'payload.hazard', issues)
  if (!isSessionHazardKind(hazard.kind)) {
    addIssue(
      issues,
      'payload.hazard.kind',
      'invalid-kind',
      'placeHazard payload.hazard.kind must be a supported hazard kind.',
      EXPECTED_HAZARD_KIND,
      hazard.kind,
    )
  }

  if (hasOwn(hazard, 'layer') && hazard.layer !== undefined && !isHazardLayer(hazard.layer)) {
    addIssue(
      issues,
      'payload.hazard.layer',
      'invalid-layer',
      'placeHazard payload.hazard.layer must be 1 or 2 when provided.',
      EXPECTED_LAYER,
      hazard.layer,
    )
  }

  if (hasOwn(hazard, 'owner') && hazard.owner !== undefined && !isNonEmptyString(hazard.owner)) {
    addIssue(
      issues,
      'payload.hazard.owner',
      'invalid-owner',
      'placeHazard payload.hazard.owner must be a non-empty string when provided.',
      EXPECTED_NON_EMPTY_STRING,
      hazard.owner,
    )
  }

  if (issues.some((issue) => issue.path.startsWith('payload'))) return undefined

  const placement: SessionHazardPlacement = {
    kind: hazard.kind as SessionHazardKind,
    ...(cell as SessionHazardCell),
    ...(hazard.layer === undefined ? {} : { layer: hazard.layer as number }),
    ...(hazard.owner === undefined ? {} : { owner: (hazard.owner as string).trim() }),
  }

  return clonePlacePayload({
    ...(mapSlug === undefined ? {} : { mapSlug }),
    hazard: placement,
  })
}

const collectRemoveHazardPayloadIssues = (
  payload: unknown,
  issues: MutableIssueList,
): RemoveHazardCommandPayload | undefined => {
  if (!isRecord(payload)) {
    addIssue(
      issues,
      'payload',
      'invalid-payload',
      'removeHazard payload must be an object.',
      EXPECTED_OBJECT,
      payload,
    )
    return undefined
  }

  const mapSlug = collectPayloadMapSlugIssue(payload, issues)
  const cell = collectHazardCellIssues(payload.cell, 'payload.cell', issues)
  const rawCell = isRecord(payload.cell) ? payload.cell : undefined
  if (rawCell !== undefined && hasOwn(rawCell, 'kind') && rawCell.kind !== undefined && !isSessionHazardKind(rawCell.kind)) {
    addIssue(
      issues,
      'payload.cell.kind',
      'invalid-kind',
      'removeHazard payload.cell.kind must be a supported hazard kind when provided.',
      EXPECTED_HAZARD_KIND,
      rawCell.kind,
    )
  }

  if (issues.some((issue) => issue.path.startsWith('payload'))) return undefined

  return cloneRemovePayload({
    ...(mapSlug === undefined ? {} : { mapSlug }),
    cell: {
      ...(cell as SessionHazardCell),
      ...(rawCell?.kind === undefined ? {} : { kind: rawCell.kind as SessionHazardKind }),
    },
  })
}

const findHazardScopeMapSlug = (
  command: Pick<HazardCommand, 'scopes' | 'payload' | 'type'>,
  payload: HazardCommandPayload | undefined,
  issues: MutableIssueList,
): string | undefined => {
  const hazardScopes = command.scopes.filter(
    (scope) => scope.lane === 'hazard' && scope.field === HAZARD_COMMAND_SCOPE_FIELD,
  )

  if (hazardScopes.length === 0) {
    addIssue(
      issues,
      'scopes',
      'invalid-hazard-scope',
      `${command.type} commands must include a hazard scope with field "hazards".`,
      'hazard scope',
      command.scopes,
    )
    return payload?.mapSlug
  }

  const mapSlugs = new Set(
    hazardScopes
      .map((scope) => scope.mapSlug)
      .filter((mapSlug): mapSlug is string => mapSlug !== undefined),
  )
  if (mapSlugs.size > 1) {
    addIssue(
      issues,
      'scopes',
      'invalid-hazard-scope',
      `${command.type} hazard scopes must not target multiple maps.`,
      'same mapSlug or omitted mapSlug',
      command.scopes,
    )
  }

  const scopeMapSlug = [...mapSlugs][0]
  if (payload?.mapSlug !== undefined && scopeMapSlug !== undefined && payload.mapSlug !== scopeMapSlug) {
    addIssue(
      issues,
      'payload.mapSlug',
      'invalid-map-slug',
      `${command.type} payload.mapSlug must match the hazard scope mapSlug when both are provided.`,
      scopeMapSlug,
      payload.mapSlug,
    )
  }

  return payload?.mapSlug ?? scopeMapSlug
}

const createValidationFailure = (
  issues: readonly SessionCommandValidationIssue[],
  permission: PermissionResult,
): HazardCommandValidationFailure => ({
  valid: false,
  issues,
  ...(permission.allowed ? {} : { permission }),
})

const validatePermission = (
  command: HazardCommand,
  issues: MutableIssueList,
): PermissionResult => {
  const permission = canUseGmAuthority(command.actor)
  if (!permission.allowed) {
    addIssue(
      issues,
      'actor',
      'permission-denied',
      permission.message,
      'GM actor',
      command.actor,
    )
  }
  return permission
}

export const validatePlaceHazardCommand = <
  TActor extends SessionActor = SessionActor,
>(
  value: unknown,
  _context: HazardCommandValidationContext = {},
): HazardCommandValidationResult<PlaceHazardCommand<TActor>> => {
  const envelopeResult = validateSessionCommandEnvelope<PlaceHazardCommand<TActor>>(value)
  if (!envelopeResult.valid) return { valid: false, issues: envelopeResult.issues }

  const command = envelopeResult.command
  const issues: MutableIssueList = []

  if (command.type !== PLACE_HAZARD_COMMAND_TYPE) {
    addIssue(
      issues,
      'type',
      'invalid-command-type',
      'placeHazard validators only accept command envelopes with type "placeHazard".',
      PLACE_HAZARD_COMMAND_TYPE,
      command.type,
    )
  }

  const payload = collectPlaceHazardPayloadIssues(command.payload, issues)
  const mapSlug = findHazardScopeMapSlug(command, payload, issues)
  const permission = validatePermission(command, issues)

  if (issues.length > 0) return createValidationFailure(issues, permission)

  return {
    valid: true,
    command,
    payload: payload as PlaceHazardCommandPayload,
    ...(mapSlug === undefined ? {} : { mapSlug }),
    permission: permission as Extract<PermissionResult, { readonly allowed: true }>,
    issues: [],
  }
}

export const validateRemoveHazardCommand = <
  TActor extends SessionActor = SessionActor,
>(
  value: unknown,
  _context: HazardCommandValidationContext = {},
): HazardCommandValidationResult<RemoveHazardCommand<TActor>> => {
  const envelopeResult = validateSessionCommandEnvelope<RemoveHazardCommand<TActor>>(value)
  if (!envelopeResult.valid) return { valid: false, issues: envelopeResult.issues }

  const command = envelopeResult.command
  const issues: MutableIssueList = []

  if (command.type !== REMOVE_HAZARD_COMMAND_TYPE) {
    addIssue(
      issues,
      'type',
      'invalid-command-type',
      'removeHazard validators only accept command envelopes with type "removeHazard".',
      REMOVE_HAZARD_COMMAND_TYPE,
      command.type,
    )
  }

  const payload = collectRemoveHazardPayloadIssues(command.payload, issues)
  const mapSlug = findHazardScopeMapSlug(command, payload, issues)
  const permission = validatePermission(command, issues)

  if (issues.length > 0) return createValidationFailure(issues, permission)

  return {
    valid: true,
    command,
    payload: payload as RemoveHazardCommandPayload,
    ...(mapSlug === undefined ? {} : { mapSlug }),
    permission: permission as Extract<PermissionResult, { readonly allowed: true }>,
    issues: [],
  }
}

export const validateHazardCommand = <
  TActor extends SessionActor = SessionActor,
>(
  value: unknown,
  context: HazardCommandValidationContext = {},
): HazardCommandValidationResult<HazardCommand<TActor>> => {
  const envelopeResult = validateSessionCommandEnvelope<HazardCommand<TActor>>(value)
  if (!envelopeResult.valid) return { valid: false, issues: envelopeResult.issues }

  if (envelopeResult.command.type === PLACE_HAZARD_COMMAND_TYPE) {
    return validatePlaceHazardCommand<TActor>(value, context) as HazardCommandValidationResult<HazardCommand<TActor>>
  }
  if (envelopeResult.command.type === REMOVE_HAZARD_COMMAND_TYPE) {
    return validateRemoveHazardCommand<TActor>(value, context) as HazardCommandValidationResult<HazardCommand<TActor>>
  }

  return {
    valid: false,
    issues: [
      {
        path: 'type',
        code: 'invalid-command-type',
        message: 'hazard validators only accept placeHazard or removeHazard command envelopes.',
        expected: HAZARD_COMMAND_TYPES.join(' | '),
        received: describeReceived(isRecord(value) ? value.type : undefined),
      },
    ],
  }
}

export const assertValidHazardCommand = <
  TActor extends SessionActor = SessionActor,
>(
  value: unknown,
  context: HazardCommandValidationContext = {},
  label = 'hazard command',
): HazardCommand<TActor> => {
  const result = validateHazardCommand<TActor>(value, context)
  if (result.valid) return result.command

  const summary = result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')
  throw new Error(`${label} is invalid: ${summary}`)
}

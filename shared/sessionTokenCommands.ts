import type { SessionCommandValidationIssue } from './sessionCommandResults'
import {
  type SessionCommandEnvelope,
  type SessionCommandScope,
} from './sessionCommands'
import {
  isRecord,
  validateSessionCommandEnvelope,
} from './sessionCommandValidation'
import {
  canActorControlResource,
  type PermissionDenied,
  type PermissionResult,
  type PlayerAssignmentRecord,
  type SessionActor,
  type SessionTokenResourceRef,
} from './sessionPermissions'
import type { SessionRevision } from './sessionRevisions'
import { isSheetKind } from './sheets'

export const MOVE_TOKEN_COMMAND_TYPE = 'moveToken' as const
export const MOVE_TOKEN_COMMAND_SCOPE_FIELD = 'position' as const

export const TURN_TOKEN_COMMAND_TYPE = 'turnToken' as const
export const TURN_TOKEN_COMMAND_SCOPE_FIELD = 'facing' as const

export const SESSION_TOKEN_FACING_DIRECTIONS = [
  'south-east',
  'north-east',
  'north-west',
  'south-west',
] as const

export type SessionTokenFacingDirection = (typeof SESSION_TOKEN_FACING_DIRECTIONS)[number]

export interface MoveTokenPosition {
  readonly x: number
  readonly y: number
  readonly z: number
}

export type MoveTokenGridPosition = MoveTokenPosition

export interface MoveTokenCommandPayload {
  readonly tokenId: string
  readonly to: MoveTokenPosition
}

export interface TurnTokenCommandPayload {
  readonly tokenId: string
  readonly facing: SessionTokenFacingDirection
}

export type MoveTokenCommand<
  TActor extends SessionActor = SessionActor,
> = SessionCommandEnvelope<
  typeof MOVE_TOKEN_COMMAND_TYPE,
  MoveTokenCommandPayload,
  TActor,
  SessionRevision
>

export type TurnTokenCommand<
  TActor extends SessionActor = SessionActor,
> = SessionCommandEnvelope<
  typeof TURN_TOKEN_COMMAND_TYPE,
  TurnTokenCommandPayload,
  TActor,
  SessionRevision
>

export const MOVE_TOKEN_COMMAND_VALIDATION_CODES = [
  'invalid-command-type',
  'invalid-payload',
  'invalid-token-id',
  'invalid-position',
  'invalid-token-scope',
  'permission-denied',
] as const

export type MoveTokenCommandValidationCode =
  (typeof MOVE_TOKEN_COMMAND_VALIDATION_CODES)[number]

export const TURN_TOKEN_COMMAND_VALIDATION_CODES = [
  'invalid-command-type',
  'invalid-payload',
  'invalid-token-id',
  'invalid-facing',
  'invalid-token-scope',
  'permission-denied',
] as const

export type TurnTokenCommandValidationCode =
  (typeof TURN_TOKEN_COMMAND_VALIDATION_CODES)[number]

export interface MoveTokenCommandValidationContext {
  /**
   * Current GM-managed assignment records. GM actors are allowed without an
   * assignment; player actors must be assigned and able to see the token scope.
   */
  readonly assignments?: readonly PlayerAssignmentRecord[]
}

export interface MoveTokenCommandValidationSuccess<
  TActor extends SessionActor = SessionActor,
> {
  readonly valid: true
  readonly command: MoveTokenCommand<TActor>
  readonly payload: MoveTokenCommandPayload
  readonly resource: SessionTokenResourceRef
  readonly permission: Extract<PermissionResult, { readonly allowed: true }>
  readonly issues: readonly []
}

export interface MoveTokenCommandValidationFailure {
  readonly valid: false
  readonly issues: readonly SessionCommandValidationIssue[]
  readonly permission?: PermissionDenied
}

export type MoveTokenCommandValidationResult<
  TActor extends SessionActor = SessionActor,
> = MoveTokenCommandValidationSuccess<TActor> | MoveTokenCommandValidationFailure

export interface TurnTokenCommandValidationContext {
  /**
   * Current GM-managed assignment records. GM actors are allowed without an
   * assignment; player actors must be assigned and able to see the token scope.
   */
  readonly assignments?: readonly PlayerAssignmentRecord[]
}

export interface TurnTokenCommandValidationSuccess<
  TActor extends SessionActor = SessionActor,
> {
  readonly valid: true
  readonly command: TurnTokenCommand<TActor>
  readonly payload: TurnTokenCommandPayload
  readonly resource: SessionTokenResourceRef
  readonly permission: Extract<PermissionResult, { readonly allowed: true }>
  readonly issues: readonly []
}

export interface TurnTokenCommandValidationFailure {
  readonly valid: false
  readonly issues: readonly SessionCommandValidationIssue[]
  readonly permission?: PermissionDenied
}

export type TurnTokenCommandValidationResult<
  TActor extends SessionActor = SessionActor,
> = TurnTokenCommandValidationSuccess<TActor> | TurnTokenCommandValidationFailure

type MutableIssueList = SessionCommandValidationIssue[]
type UnknownRecord = Record<string, unknown>

const EXPECTED_OBJECT = 'object'
const EXPECTED_NON_EMPTY_STRING = 'non-empty string'
const EXPECTED_GRID_COORDINATE = 'safe non-negative integer grid coordinate'
const EXPECTED_TOKEN_FACING = SESSION_TOKEN_FACING_DIRECTIONS.join(' | ')

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
  code: MoveTokenCommandValidationCode,
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

const cloneTokenResource = (resource: SessionTokenResourceRef): SessionTokenResourceRef => ({
  ...resource,
})

const clonePosition = (position: MoveTokenPosition): MoveTokenPosition => ({
  x: position.x,
  y: position.y,
  z: position.z,
})

export const isMoveTokenCommandValidationCode = (
  value: unknown,
): value is MoveTokenCommandValidationCode =>
  (MOVE_TOKEN_COMMAND_VALIDATION_CODES as readonly unknown[]).includes(value)

export const isTurnTokenCommandValidationCode = (
  value: unknown,
): value is TurnTokenCommandValidationCode =>
  (TURN_TOKEN_COMMAND_VALIDATION_CODES as readonly unknown[]).includes(value)

export const isSessionTokenFacingDirection = (
  value: unknown,
): value is SessionTokenFacingDirection =>
  (SESSION_TOKEN_FACING_DIRECTIONS as readonly unknown[]).includes(value)

export const isMoveTokenPosition = (value: unknown): value is MoveTokenPosition =>
  isRecord(value) &&
  isGridCoordinate(value.x) &&
  isGridCoordinate(value.y) &&
  isGridCoordinate(value.z)

export const createMoveTokenCommandScope = (
  resource: SessionTokenResourceRef,
): SessionCommandScope => ({
  lane: 'token',
  resource: cloneTokenResource(resource),
  field: MOVE_TOKEN_COMMAND_SCOPE_FIELD,
  ...(resource.mapSlug === undefined ? {} : { mapSlug: resource.mapSlug }),
})

export const createTurnTokenCommandScope = (
  resource: SessionTokenResourceRef,
): SessionCommandScope => ({
  lane: 'token',
  resource: cloneTokenResource(resource),
  field: TURN_TOKEN_COMMAND_SCOPE_FIELD,
  ...(resource.mapSlug === undefined ? {} : { mapSlug: resource.mapSlug }),
})

const collectMoveTokenPayloadIssues = (
  payload: unknown,
  issues: MutableIssueList,
): MoveTokenCommandPayload | undefined => {
  if (!isRecord(payload)) {
    addIssue(
      issues,
      'payload',
      'invalid-payload',
      'moveToken payload must be an object.',
      EXPECTED_OBJECT,
      payload,
    )
    return undefined
  }

  const tokenId = payload.tokenId

  if (!isNonEmptyString(tokenId)) {
    addIssue(
      issues,
      'payload.tokenId',
      'invalid-token-id',
      'moveToken payload.tokenId must be a non-empty token ID string.',
      EXPECTED_NON_EMPTY_STRING,
      tokenId,
    )
  }

  if (!isRecord(payload.to)) {
    addIssue(
      issues,
      'payload.to',
      'invalid-position',
      'moveToken payload.to must be a grid position object.',
      EXPECTED_OBJECT,
      payload.to,
    )
    return undefined
  }

  for (const axis of ['x', 'y', 'z'] as const) {
    if (!isGridCoordinate(payload.to[axis])) {
      addIssue(
        issues,
        `payload.to.${axis}`,
        'invalid-position',
        `moveToken payload.to.${axis} must be a ${EXPECTED_GRID_COORDINATE}.`,
        EXPECTED_GRID_COORDINATE,
        payload.to[axis],
      )
    }
  }

  if (issues.some((issue) => issue.path.startsWith('payload.'))) {
    return undefined
  }

  return {
    tokenId: tokenId as string,
    to: clonePosition(payload.to as unknown as MoveTokenPosition),
  }
}

const tokenResourceFromScope = (
  scope: SessionCommandScope,
  path: string,
  issues: MutableIssueList,
  commandName = 'moveToken',
): SessionTokenResourceRef | undefined => {
  if (scope.resource?.kind !== 'token') return undefined

  const tokenResource = scope.resource

  if (hasOwn(tokenResource, 'mapSlug') && hasOwn(scope, 'mapSlug') && tokenResource.mapSlug !== scope.mapSlug) {
    addIssue(
      issues,
      `${path}.mapSlug`,
      'invalid-token-scope',
      `${commandName} token scope mapSlug must match the token resource mapSlug when both are provided.`,
      'matching token scope map slug',
      scope.mapSlug,
    )
  }

  if (hasOwn(tokenResource, 'sheetKind') && tokenResource.sheetKind !== undefined && !isSheetKind(tokenResource.sheetKind)) {
    addIssue(
      issues,
      `${path}.resource.sheetKind`,
      'invalid-token-scope',
      `${commandName} token scope sheetKind must be pokemon or trainer when provided.`,
      'pokemon | trainer',
      tokenResource.sheetKind,
    )
  }

  return {
    ...tokenResource,
    ...(tokenResource.mapSlug === undefined && typeof scope.mapSlug === 'string'
      ? { mapSlug: scope.mapSlug }
      : {}),
  }
}

const findMoveTokenResource = (
  command: MoveTokenCommand,
  payload: MoveTokenCommandPayload | undefined,
  issues: MutableIssueList,
): SessionTokenResourceRef | undefined => {
  if (payload === undefined) return undefined

  const tokenScopeResources: Array<{
    readonly index: number
    readonly scope: SessionCommandScope
    readonly resource: SessionTokenResourceRef
  }> = []

  command.scopes.forEach((scope, index) => {
    const resource = tokenResourceFromScope(scope, `scopes[${index}]`, issues, 'moveToken')
    if (resource === undefined) return
    tokenScopeResources.push({ index, scope, resource })
  })

  const matchingTokenScope = tokenScopeResources.find(({ scope, resource }) =>
    scope.lane === 'token' &&
    scope.field === MOVE_TOKEN_COMMAND_SCOPE_FIELD &&
    resource.tokenId === payload.tokenId,
  )

  if (matchingTokenScope === undefined) {
    addIssue(
      issues,
      'scopes',
      'invalid-token-scope',
      'moveToken commands must include a token scope with resource.kind "token", field "position", and a tokenId matching payload.tokenId.',
      'matching token position scope',
      command.scopes,
    )
    return undefined
  }

  if (
    hasOwn(matchingTokenScope.scope, 'mapSlug') &&
    typeof matchingTokenScope.scope.mapSlug === 'string' &&
    matchingTokenScope.scope.mapSlug.trim().length === 0
  ) {
    addIssue(
      issues,
      `scopes[${matchingTokenScope.index}].mapSlug`,
      'invalid-token-scope',
      'moveToken token scope mapSlug must be a non-empty string when provided.',
      EXPECTED_NON_EMPTY_STRING,
      matchingTokenScope.scope.mapSlug,
    )
  }

  return cloneTokenResource(matchingTokenScope.resource)
}

export const validateMoveTokenCommand = <
  TActor extends SessionActor = SessionActor,
>(
  value: unknown,
  context: MoveTokenCommandValidationContext = {},
): MoveTokenCommandValidationResult<TActor> => {
  const envelopeResult = validateSessionCommandEnvelope<MoveTokenCommand<TActor>>(value)
  if (!envelopeResult.valid) {
    return { valid: false, issues: envelopeResult.issues }
  }

  const command = envelopeResult.command
  const issues: MutableIssueList = []

  if (command.type !== MOVE_TOKEN_COMMAND_TYPE) {
    addIssue(
      issues,
      'type',
      'invalid-command-type',
      'moveToken validators only accept command envelopes with type "moveToken".',
      MOVE_TOKEN_COMMAND_TYPE,
      command.type,
    )
  }

  const payload = collectMoveTokenPayloadIssues(command.payload, issues)
  const resource = findMoveTokenResource(command, payload, issues)

  let permission: PermissionResult | undefined
  if (resource !== undefined) {
    permission = canActorControlResource(command.actor, context.assignments ?? [], resource)
    if (!permission.allowed) {
      addIssue(
        issues,
        'actor',
        'permission-denied',
        permission.message,
        'GM actor or player actor assigned to a visible token resource',
        command.actor,
      )
    }
  }

  if (issues.length > 0) {
    return {
      valid: false,
      issues,
      ...(permission !== undefined && !permission.allowed ? { permission } : {}),
    }
  }

  return {
    valid: true,
    command,
    payload: payload as MoveTokenCommandPayload,
    resource: resource as SessionTokenResourceRef,
    permission: permission as Extract<PermissionResult, { readonly allowed: true }>,
    issues: [],
  }
}

export const assertValidMoveTokenCommand = <
  TActor extends SessionActor = SessionActor,
>(
  value: unknown,
  context: MoveTokenCommandValidationContext = {},
  label = 'moveToken command',
): MoveTokenCommand<TActor> => {
  const result = validateMoveTokenCommand<TActor>(value, context)
  if (result.valid) return result.command

  const summary = result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')
  throw new Error(`${label} is invalid: ${summary}`)
}

const addTurnIssue = (
  issues: MutableIssueList,
  path: string,
  code: TurnTokenCommandValidationCode,
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

const collectTurnTokenPayloadIssues = (
  payload: unknown,
  issues: MutableIssueList,
): TurnTokenCommandPayload | undefined => {
  if (!isRecord(payload)) {
    addTurnIssue(
      issues,
      'payload',
      'invalid-payload',
      'turnToken payload must be an object.',
      EXPECTED_OBJECT,
      payload,
    )
    return undefined
  }

  const tokenId = payload.tokenId
  const facing = payload.facing

  if (!isNonEmptyString(tokenId)) {
    addTurnIssue(
      issues,
      'payload.tokenId',
      'invalid-token-id',
      'turnToken payload.tokenId must be a non-empty token ID string.',
      EXPECTED_NON_EMPTY_STRING,
      tokenId,
    )
  }

  if (!isSessionTokenFacingDirection(facing)) {
    addTurnIssue(
      issues,
      'payload.facing',
      'invalid-facing',
      `turnToken payload.facing must be one of ${EXPECTED_TOKEN_FACING}.`,
      EXPECTED_TOKEN_FACING,
      facing,
    )
  }

  if (issues.some((issue) => issue.path.startsWith('payload.'))) {
    return undefined
  }

  return {
    tokenId: tokenId as string,
    facing: facing as SessionTokenFacingDirection,
  }
}

const findTurnTokenResource = (
  command: TurnTokenCommand,
  payload: TurnTokenCommandPayload | undefined,
  issues: MutableIssueList,
): SessionTokenResourceRef | undefined => {
  if (payload === undefined) return undefined

  const tokenScopeResources: Array<{
    readonly index: number
    readonly scope: SessionCommandScope
    readonly resource: SessionTokenResourceRef
  }> = []

  command.scopes.forEach((scope, index) => {
    const resource = tokenResourceFromScope(scope, `scopes[${index}]`, issues, 'turnToken')
    if (resource === undefined) return
    tokenScopeResources.push({ index, scope, resource })
  })

  const matchingTokenScope = tokenScopeResources.find(({ scope, resource }) =>
    scope.lane === 'token' &&
    scope.field === TURN_TOKEN_COMMAND_SCOPE_FIELD &&
    resource.tokenId === payload.tokenId,
  )

  if (matchingTokenScope === undefined) {
    addTurnIssue(
      issues,
      'scopes',
      'invalid-token-scope',
      'turnToken commands must include a token scope with resource.kind "token", field "facing", and a tokenId matching payload.tokenId.',
      'matching token facing scope',
      command.scopes,
    )
    return undefined
  }

  if (
    hasOwn(matchingTokenScope.scope, 'mapSlug') &&
    typeof matchingTokenScope.scope.mapSlug === 'string' &&
    matchingTokenScope.scope.mapSlug.trim().length === 0
  ) {
    addTurnIssue(
      issues,
      `scopes[${matchingTokenScope.index}].mapSlug`,
      'invalid-token-scope',
      'turnToken token scope mapSlug must be a non-empty string when provided.',
      EXPECTED_NON_EMPTY_STRING,
      matchingTokenScope.scope.mapSlug,
    )
  }

  return cloneTokenResource(matchingTokenScope.resource)
}

export const validateTurnTokenCommand = <
  TActor extends SessionActor = SessionActor,
>(
  value: unknown,
  context: TurnTokenCommandValidationContext = {},
): TurnTokenCommandValidationResult<TActor> => {
  const envelopeResult = validateSessionCommandEnvelope<TurnTokenCommand<TActor>>(value)
  if (!envelopeResult.valid) {
    return { valid: false, issues: envelopeResult.issues }
  }

  const command = envelopeResult.command
  const issues: MutableIssueList = []

  if (command.type !== TURN_TOKEN_COMMAND_TYPE) {
    addTurnIssue(
      issues,
      'type',
      'invalid-command-type',
      'turnToken validators only accept command envelopes with type "turnToken".',
      TURN_TOKEN_COMMAND_TYPE,
      command.type,
    )
  }

  const payload = collectTurnTokenPayloadIssues(command.payload, issues)
  const resource = findTurnTokenResource(command, payload, issues)

  let permission: PermissionResult | undefined
  if (resource !== undefined) {
    permission = canActorControlResource(command.actor, context.assignments ?? [], resource)
    if (!permission.allowed) {
      addTurnIssue(
        issues,
        'actor',
        'permission-denied',
        permission.message,
        'GM actor or player actor assigned to a visible token resource',
        command.actor,
      )
    }
  }

  if (issues.length > 0) {
    return {
      valid: false,
      issues,
      ...(permission !== undefined && !permission.allowed ? { permission } : {}),
    }
  }

  return {
    valid: true,
    command,
    payload: payload as TurnTokenCommandPayload,
    resource: resource as SessionTokenResourceRef,
    permission: permission as Extract<PermissionResult, { readonly allowed: true }>,
    issues: [],
  }
}

export const assertValidTurnTokenCommand = <
  TActor extends SessionActor = SessionActor,
>(
  value: unknown,
  context: TurnTokenCommandValidationContext = {},
  label = 'turnToken command',
): TurnTokenCommand<TActor> => {
  const result = validateTurnTokenCommand<TActor>(value, context)
  if (result.valid) return result.command

  const summary = result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')
  throw new Error(`${label} is invalid: ${summary}`)
}

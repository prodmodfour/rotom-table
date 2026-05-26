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
  canUseGmAuthority,
  type PermissionDenied,
  type PermissionResult,
  type PlayerAssignmentRecord,
  type SessionActor,
  type SessionTokenResourceRef,
} from './sessionPermissions'
import type { SessionRevision } from './sessionRevisions'
import { isSheetKind, type SheetKind } from './sheets'

export const MOVE_TOKEN_COMMAND_TYPE = 'moveToken' as const
export const MOVE_TOKEN_COMMAND_SCOPE_FIELD = 'position' as const

export const TURN_TOKEN_COMMAND_TYPE = 'turnToken' as const
export const TURN_TOKEN_COMMAND_SCOPE_FIELD = 'facing' as const

export const SPAWN_TOKEN_COMMAND_TYPE = 'spawnToken' as const
export const SPAWN_TOKEN_COMMAND_SCOPE_FIELD = 'spawn' as const

export const DELETE_TOKEN_COMMAND_TYPE = 'deleteToken' as const
export const DELETE_TOKEN_COMMAND_SCOPE_FIELD = 'delete' as const

export const SEND_OUT_POKEMON_COMMAND_TYPE = 'sendOutPokemon' as const
export const SEND_OUT_POKEMON_TRAINER_SCOPE_FIELD = 'sendOut' as const
export const SEND_OUT_POKEMON_SPAWN_SCOPE_FIELD = 'spawn' as const

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

export interface SpawnTokenPlacementPayload {
  readonly id: string
  readonly sheetKind: SheetKind
  readonly sheetSlug: string
  readonly position: MoveTokenPosition
  readonly facing?: SessionTokenFacingDirection
  readonly initiative?: number | null
}

export interface SpawnTokenCommandPayload {
  readonly placement: SpawnTokenPlacementPayload
}

export interface DeleteTokenCommandPayload {
  readonly tokenId: string
}

export interface SendOutPokemonCommandPayload {
  readonly trainerTokenId: string
  readonly pokemonSlug: string
  readonly tokenId: string
  readonly position: MoveTokenPosition
  readonly facing?: SessionTokenFacingDirection
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

export type SpawnTokenCommand<
  TActor extends SessionActor = SessionActor,
> = SessionCommandEnvelope<
  typeof SPAWN_TOKEN_COMMAND_TYPE,
  SpawnTokenCommandPayload,
  TActor,
  SessionRevision
>

export type DeleteTokenCommand<
  TActor extends SessionActor = SessionActor,
> = SessionCommandEnvelope<
  typeof DELETE_TOKEN_COMMAND_TYPE,
  DeleteTokenCommandPayload,
  TActor,
  SessionRevision
>

export type SendOutPokemonCommand<
  TActor extends SessionActor = SessionActor,
> = SessionCommandEnvelope<
  typeof SEND_OUT_POKEMON_COMMAND_TYPE,
  SendOutPokemonCommandPayload,
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

export const SPAWN_TOKEN_COMMAND_VALIDATION_CODES = [
  'invalid-command-type',
  'invalid-payload',
  'invalid-token-id',
  'invalid-sheet-kind',
  'invalid-sheet-slug',
  'invalid-position',
  'invalid-facing',
  'invalid-initiative',
  'invalid-token-scope',
  'permission-denied',
] as const

export type SpawnTokenCommandValidationCode =
  (typeof SPAWN_TOKEN_COMMAND_VALIDATION_CODES)[number]

export const DELETE_TOKEN_COMMAND_VALIDATION_CODES = [
  'invalid-command-type',
  'invalid-payload',
  'invalid-token-id',
  'invalid-token-scope',
  'permission-denied',
] as const

export type DeleteTokenCommandValidationCode =
  (typeof DELETE_TOKEN_COMMAND_VALIDATION_CODES)[number]

export const SEND_OUT_POKEMON_COMMAND_VALIDATION_CODES = [
  'invalid-command-type',
  'invalid-payload',
  'invalid-trainer-token-id',
  'invalid-token-id',
  'invalid-pokemon-slug',
  'invalid-position',
  'invalid-facing',
  'invalid-token-scope',
  'permission-denied',
] as const

export type SendOutPokemonCommandValidationCode =
  (typeof SEND_OUT_POKEMON_COMMAND_VALIDATION_CODES)[number]

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

export interface SpawnTokenCommandValidationContext {}

export interface SpawnTokenCommandValidationSuccess<
  TActor extends SessionActor = SessionActor,
> {
  readonly valid: true
  readonly command: SpawnTokenCommand<TActor>
  readonly payload: SpawnTokenCommandPayload
  readonly resource: SessionTokenResourceRef
  readonly permission: Extract<PermissionResult, { readonly allowed: true }>
  readonly issues: readonly []
}

export interface SpawnTokenCommandValidationFailure {
  readonly valid: false
  readonly issues: readonly SessionCommandValidationIssue[]
  readonly permission?: PermissionDenied
}

export type SpawnTokenCommandValidationResult<
  TActor extends SessionActor = SessionActor,
> = SpawnTokenCommandValidationSuccess<TActor> | SpawnTokenCommandValidationFailure

export interface DeleteTokenCommandValidationContext {}

export interface DeleteTokenCommandValidationSuccess<
  TActor extends SessionActor = SessionActor,
> {
  readonly valid: true
  readonly command: DeleteTokenCommand<TActor>
  readonly payload: DeleteTokenCommandPayload
  readonly resource: SessionTokenResourceRef
  readonly permission: Extract<PermissionResult, { readonly allowed: true }>
  readonly issues: readonly []
}

export interface DeleteTokenCommandValidationFailure {
  readonly valid: false
  readonly issues: readonly SessionCommandValidationIssue[]
  readonly permission?: PermissionDenied
}

export type DeleteTokenCommandValidationResult<
  TActor extends SessionActor = SessionActor,
> = DeleteTokenCommandValidationSuccess<TActor> | DeleteTokenCommandValidationFailure

export interface SendOutPokemonCommandValidationContext {
  /**
   * Current GM-managed assignment records. GM actors are allowed without an
   * assignment; player actors must control the trainer token used to send out.
   */
  readonly assignments?: readonly PlayerAssignmentRecord[]
}

export interface SendOutPokemonCommandValidationSuccess<
  TActor extends SessionActor = SessionActor,
> {
  readonly valid: true
  readonly command: SendOutPokemonCommand<TActor>
  readonly payload: SendOutPokemonCommandPayload
  /** The trainer token resource used for actor permission checks. */
  readonly resource: SessionTokenResourceRef
  readonly trainerResource: SessionTokenResourceRef
  readonly pokemonResource: SessionTokenResourceRef
  readonly permission: Extract<PermissionResult, { readonly allowed: true }>
  readonly issues: readonly []
}

export interface SendOutPokemonCommandValidationFailure {
  readonly valid: false
  readonly issues: readonly SessionCommandValidationIssue[]
  readonly permission?: PermissionDenied
}

export type SendOutPokemonCommandValidationResult<
  TActor extends SessionActor = SessionActor,
> = SendOutPokemonCommandValidationSuccess<TActor> | SendOutPokemonCommandValidationFailure

type MutableIssueList = SessionCommandValidationIssue[]
type UnknownRecord = Record<string, unknown>

const EXPECTED_OBJECT = 'object'
const EXPECTED_NON_EMPTY_STRING = 'non-empty string'
const EXPECTED_GRID_COORDINATE = 'safe non-negative integer grid coordinate'
const EXPECTED_SAFE_INTEGER = 'safe integer'
const EXPECTED_TOKEN_FACING = SESSION_TOKEN_FACING_DIRECTIONS.join(' | ')
const EXPECTED_SHEET_KIND = 'pokemon | trainer'

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
  code: string,
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

const cloneSpawnTokenPlacement = (
  placement: SpawnTokenPlacementPayload,
): SpawnTokenPlacementPayload => ({
  id: placement.id,
  sheetKind: placement.sheetKind,
  sheetSlug: placement.sheetSlug,
  position: clonePosition(placement.position),
  ...(placement.facing === undefined ? {} : { facing: placement.facing }),
  ...(placement.initiative === undefined ? {} : { initiative: placement.initiative }),
})

const cloneSendOutPokemonPayload = (
  payload: SendOutPokemonCommandPayload,
): SendOutPokemonCommandPayload => ({
  trainerTokenId: payload.trainerTokenId,
  pokemonSlug: payload.pokemonSlug,
  tokenId: payload.tokenId,
  position: clonePosition(payload.position),
  ...(payload.facing === undefined ? {} : { facing: payload.facing }),
})

export const isMoveTokenCommandValidationCode = (
  value: unknown,
): value is MoveTokenCommandValidationCode =>
  (MOVE_TOKEN_COMMAND_VALIDATION_CODES as readonly unknown[]).includes(value)

export const isTurnTokenCommandValidationCode = (
  value: unknown,
): value is TurnTokenCommandValidationCode =>
  (TURN_TOKEN_COMMAND_VALIDATION_CODES as readonly unknown[]).includes(value)

export const isSpawnTokenCommandValidationCode = (
  value: unknown,
): value is SpawnTokenCommandValidationCode =>
  (SPAWN_TOKEN_COMMAND_VALIDATION_CODES as readonly unknown[]).includes(value)

export const isDeleteTokenCommandValidationCode = (
  value: unknown,
): value is DeleteTokenCommandValidationCode =>
  (DELETE_TOKEN_COMMAND_VALIDATION_CODES as readonly unknown[]).includes(value)

export const isSendOutPokemonCommandValidationCode = (
  value: unknown,
): value is SendOutPokemonCommandValidationCode =>
  (SEND_OUT_POKEMON_COMMAND_VALIDATION_CODES as readonly unknown[]).includes(value)

export const isSessionTokenFacingDirection = (
  value: unknown,
): value is SessionTokenFacingDirection =>
  (SESSION_TOKEN_FACING_DIRECTIONS as readonly unknown[]).includes(value)

export const isMoveTokenPosition = (value: unknown): value is MoveTokenPosition =>
  isRecord(value) &&
  isGridCoordinate(value.x) &&
  isGridCoordinate(value.y) &&
  isGridCoordinate(value.z)

export const isSpawnTokenPlacementPayload = (
  value: unknown,
): value is SpawnTokenPlacementPayload =>
  isRecord(value) &&
  isNonEmptyString(value.id) &&
  isSheetKind(value.sheetKind) &&
  isNonEmptyString(value.sheetSlug) &&
  isMoveTokenPosition(value.position) &&
  (value.facing === undefined || isSessionTokenFacingDirection(value.facing)) &&
  (
    value.initiative === undefined ||
    value.initiative === null ||
    (typeof value.initiative === 'number' && Number.isSafeInteger(value.initiative))
  )

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

export const createSpawnTokenCommandScope = (
  resource: SessionTokenResourceRef,
): SessionCommandScope => ({
  lane: 'token',
  resource: cloneTokenResource(resource),
  field: SPAWN_TOKEN_COMMAND_SCOPE_FIELD,
  ...(resource.mapSlug === undefined ? {} : { mapSlug: resource.mapSlug }),
})

export const createDeleteTokenCommandScope = (
  resource: SessionTokenResourceRef,
): SessionCommandScope => ({
  lane: 'token',
  resource: cloneTokenResource(resource),
  field: DELETE_TOKEN_COMMAND_SCOPE_FIELD,
  ...(resource.mapSlug === undefined ? {} : { mapSlug: resource.mapSlug }),
})

export const createSendOutPokemonTrainerCommandScope = (
  resource: SessionTokenResourceRef,
): SessionCommandScope => ({
  lane: 'token',
  resource: cloneTokenResource(resource),
  field: SEND_OUT_POKEMON_TRAINER_SCOPE_FIELD,
  ...(resource.mapSlug === undefined ? {} : { mapSlug: resource.mapSlug }),
})

export const createSendOutPokemonSpawnCommandScope = (
  resource: SessionTokenResourceRef,
): SessionCommandScope => ({
  lane: 'token',
  resource: cloneTokenResource(resource),
  field: SEND_OUT_POKEMON_SPAWN_SCOPE_FIELD,
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

const addSpawnIssue = (
  issues: MutableIssueList,
  path: string,
  code: SpawnTokenCommandValidationCode,
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

const addDeleteIssue = (
  issues: MutableIssueList,
  path: string,
  code: DeleteTokenCommandValidationCode,
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

const addSendOutIssue = (
  issues: MutableIssueList,
  path: string,
  code: SendOutPokemonCommandValidationCode,
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

const collectSpawnTokenPayloadIssues = (
  payload: unknown,
  issues: MutableIssueList,
): SpawnTokenCommandPayload | undefined => {
  if (!isRecord(payload)) {
    addSpawnIssue(
      issues,
      'payload',
      'invalid-payload',
      'spawnToken payload must be an object.',
      EXPECTED_OBJECT,
      payload,
    )
    return undefined
  }

  if (!isRecord(payload.placement)) {
    addSpawnIssue(
      issues,
      'payload.placement',
      'invalid-payload',
      'spawnToken payload.placement must be an object.',
      EXPECTED_OBJECT,
      payload.placement,
    )
    return undefined
  }

  const placement = payload.placement
  const tokenId = placement.id
  const sheetKind = placement.sheetKind
  const sheetSlug = placement.sheetSlug

  if (!isNonEmptyString(tokenId)) {
    addSpawnIssue(
      issues,
      'payload.placement.id',
      'invalid-token-id',
      'spawnToken payload.placement.id must be a non-empty token ID string.',
      EXPECTED_NON_EMPTY_STRING,
      tokenId,
    )
  }

  if (!isSheetKind(sheetKind)) {
    addSpawnIssue(
      issues,
      'payload.placement.sheetKind',
      'invalid-sheet-kind',
      'spawnToken payload.placement.sheetKind must be pokemon or trainer.',
      EXPECTED_SHEET_KIND,
      sheetKind,
    )
  }

  if (!isNonEmptyString(sheetSlug)) {
    addSpawnIssue(
      issues,
      'payload.placement.sheetSlug',
      'invalid-sheet-slug',
      'spawnToken payload.placement.sheetSlug must be a non-empty string.',
      EXPECTED_NON_EMPTY_STRING,
      sheetSlug,
    )
  }

  if (!isRecord(placement.position)) {
    addSpawnIssue(
      issues,
      'payload.placement.position',
      'invalid-position',
      'spawnToken payload.placement.position must be a grid position object.',
      EXPECTED_OBJECT,
      placement.position,
    )
  } else {
    for (const axis of ['x', 'y', 'z'] as const) {
      if (!isGridCoordinate(placement.position[axis])) {
        addSpawnIssue(
          issues,
          `payload.placement.position.${axis}`,
          'invalid-position',
          `spawnToken payload.placement.position.${axis} must be a ${EXPECTED_GRID_COORDINATE}.`,
          EXPECTED_GRID_COORDINATE,
          placement.position[axis],
        )
      }
    }
  }

  if (placement.facing !== undefined && !isSessionTokenFacingDirection(placement.facing)) {
    addSpawnIssue(
      issues,
      'payload.placement.facing',
      'invalid-facing',
      `spawnToken payload.placement.facing must be one of ${EXPECTED_TOKEN_FACING} when provided.`,
      EXPECTED_TOKEN_FACING,
      placement.facing,
    )
  }

  if (
    placement.initiative !== undefined &&
    placement.initiative !== null &&
    !(typeof placement.initiative === 'number' && Number.isSafeInteger(placement.initiative))
  ) {
    addSpawnIssue(
      issues,
      'payload.placement.initiative',
      'invalid-initiative',
      'spawnToken payload.placement.initiative must be a safe integer or null when provided.',
      `${EXPECTED_SAFE_INTEGER} | null`,
      placement.initiative,
    )
  }

  if (issues.some((issue) => issue.path.startsWith('payload.'))) {
    return undefined
  }

  return {
    placement: cloneSpawnTokenPlacement(placement as unknown as SpawnTokenPlacementPayload),
  }
}

const findSpawnTokenResource = (
  command: SpawnTokenCommand,
  payload: SpawnTokenCommandPayload | undefined,
  issues: MutableIssueList,
): SessionTokenResourceRef | undefined => {
  if (payload === undefined) return undefined

  const matchingTokenScope = command.scopes
    .map((scope, index) => ({
      index,
      scope,
      resource: tokenResourceFromScope(scope, `scopes[${index}]`, issues, 'spawnToken'),
    }))
    .find(({ scope, resource }) =>
      resource !== undefined &&
      scope.lane === 'token' &&
      scope.field === SPAWN_TOKEN_COMMAND_SCOPE_FIELD &&
      resource.tokenId === payload.placement.id &&
      (resource.sheetKind === undefined || resource.sheetKind === payload.placement.sheetKind) &&
      (resource.sheetSlug === undefined || resource.sheetSlug === payload.placement.sheetSlug),
    )

  if (matchingTokenScope?.resource === undefined) {
    addSpawnIssue(
      issues,
      'scopes',
      'invalid-token-scope',
      'spawnToken commands must include a token scope with resource.kind "token", field "spawn", tokenId matching payload.placement.id, and any sheet identity matching payload.placement.',
      'matching token spawn scope',
      command.scopes,
    )
    return undefined
  }

  if (
    hasOwn(matchingTokenScope.scope, 'mapSlug') &&
    typeof matchingTokenScope.scope.mapSlug === 'string' &&
    matchingTokenScope.scope.mapSlug.trim().length === 0
  ) {
    addSpawnIssue(
      issues,
      `scopes[${matchingTokenScope.index}].mapSlug`,
      'invalid-token-scope',
      'spawnToken token scope mapSlug must be a non-empty string when provided.',
      EXPECTED_NON_EMPTY_STRING,
      matchingTokenScope.scope.mapSlug,
    )
  }

  return cloneTokenResource(matchingTokenScope.resource)
}

const collectDeleteTokenPayloadIssues = (
  payload: unknown,
  issues: MutableIssueList,
): DeleteTokenCommandPayload | undefined => {
  if (!isRecord(payload)) {
    addDeleteIssue(
      issues,
      'payload',
      'invalid-payload',
      'deleteToken payload must be an object.',
      EXPECTED_OBJECT,
      payload,
    )
    return undefined
  }

  const tokenId = payload.tokenId
  if (!isNonEmptyString(tokenId)) {
    addDeleteIssue(
      issues,
      'payload.tokenId',
      'invalid-token-id',
      'deleteToken payload.tokenId must be a non-empty token ID string.',
      EXPECTED_NON_EMPTY_STRING,
      tokenId,
    )
  }

  if (issues.some((issue) => issue.path.startsWith('payload.'))) {
    return undefined
  }

  return {
    tokenId: tokenId as string,
  }
}

const findDeleteTokenResource = (
  command: DeleteTokenCommand,
  payload: DeleteTokenCommandPayload | undefined,
  issues: MutableIssueList,
): SessionTokenResourceRef | undefined => {
  if (payload === undefined) return undefined

  const matchingTokenScope = command.scopes
    .map((scope, index) => ({
      index,
      scope,
      resource: tokenResourceFromScope(scope, `scopes[${index}]`, issues, 'deleteToken'),
    }))
    .find(({ scope, resource }) =>
      resource !== undefined &&
      scope.lane === 'token' &&
      scope.field === DELETE_TOKEN_COMMAND_SCOPE_FIELD &&
      resource.tokenId === payload.tokenId,
    )

  if (matchingTokenScope?.resource === undefined) {
    addDeleteIssue(
      issues,
      'scopes',
      'invalid-token-scope',
      'deleteToken commands must include a token scope with resource.kind "token", field "delete", and a tokenId matching payload.tokenId.',
      'matching token delete scope',
      command.scopes,
    )
    return undefined
  }

  if (
    hasOwn(matchingTokenScope.scope, 'mapSlug') &&
    typeof matchingTokenScope.scope.mapSlug === 'string' &&
    matchingTokenScope.scope.mapSlug.trim().length === 0
  ) {
    addDeleteIssue(
      issues,
      `scopes[${matchingTokenScope.index}].mapSlug`,
      'invalid-token-scope',
      'deleteToken token scope mapSlug must be a non-empty string when provided.',
      EXPECTED_NON_EMPTY_STRING,
      matchingTokenScope.scope.mapSlug,
    )
  }

  return cloneTokenResource(matchingTokenScope.resource)
}


const collectSendOutPokemonPayloadIssues = (
  payload: unknown,
  issues: MutableIssueList,
): SendOutPokemonCommandPayload | undefined => {
  if (!isRecord(payload)) {
    addSendOutIssue(
      issues,
      'payload',
      'invalid-payload',
      'sendOutPokemon payload must be an object.',
      EXPECTED_OBJECT,
      payload,
    )
    return undefined
  }

  const trainerTokenId = payload.trainerTokenId
  const pokemonSlug = payload.pokemonSlug
  const tokenId = payload.tokenId

  if (!isNonEmptyString(trainerTokenId)) {
    addSendOutIssue(
      issues,
      'payload.trainerTokenId',
      'invalid-trainer-token-id',
      'sendOutPokemon payload.trainerTokenId must be a non-empty trainer token ID string.',
      EXPECTED_NON_EMPTY_STRING,
      trainerTokenId,
    )
  }

  if (!isNonEmptyString(pokemonSlug)) {
    addSendOutIssue(
      issues,
      'payload.pokemonSlug',
      'invalid-pokemon-slug',
      'sendOutPokemon payload.pokemonSlug must be a non-empty Pokémon sheet slug.',
      EXPECTED_NON_EMPTY_STRING,
      pokemonSlug,
    )
  }

  if (!isNonEmptyString(tokenId)) {
    addSendOutIssue(
      issues,
      'payload.tokenId',
      'invalid-token-id',
      'sendOutPokemon payload.tokenId must be a non-empty spawned Pokémon token ID string.',
      EXPECTED_NON_EMPTY_STRING,
      tokenId,
    )
  } else if (isNonEmptyString(trainerTokenId) && tokenId === trainerTokenId) {
    addSendOutIssue(
      issues,
      'payload.tokenId',
      'invalid-token-id',
      'sendOutPokemon payload.tokenId must be different from payload.trainerTokenId.',
      'spawned token ID distinct from trainer token ID',
      tokenId,
    )
  }

  if (!isRecord(payload.position)) {
    addSendOutIssue(
      issues,
      'payload.position',
      'invalid-position',
      'sendOutPokemon payload.position must be a grid position object.',
      EXPECTED_OBJECT,
      payload.position,
    )
  } else {
    for (const axis of ['x', 'y', 'z'] as const) {
      if (!isGridCoordinate(payload.position[axis])) {
        addSendOutIssue(
          issues,
          `payload.position.${axis}`,
          'invalid-position',
          `sendOutPokemon payload.position.${axis} must be a ${EXPECTED_GRID_COORDINATE}.`,
          EXPECTED_GRID_COORDINATE,
          payload.position[axis],
        )
      }
    }
  }

  if (payload.facing !== undefined && !isSessionTokenFacingDirection(payload.facing)) {
    addSendOutIssue(
      issues,
      'payload.facing',
      'invalid-facing',
      `sendOutPokemon payload.facing must be one of ${EXPECTED_TOKEN_FACING} when provided.`,
      EXPECTED_TOKEN_FACING,
      payload.facing,
    )
  }

  if (issues.some((issue) => issue.path.startsWith('payload.'))) {
    return undefined
  }

  return cloneSendOutPokemonPayload(payload as unknown as SendOutPokemonCommandPayload)
}

const findSendOutPokemonResources = (
  command: SendOutPokemonCommand,
  payload: SendOutPokemonCommandPayload | undefined,
  issues: MutableIssueList,
): {
  readonly trainerResource?: SessionTokenResourceRef
  readonly pokemonResource?: SessionTokenResourceRef
} => {
  if (payload === undefined) return {}

  const tokenScopeResources = command.scopes.map((scope, index) => ({
    index,
    scope,
    resource: tokenResourceFromScope(scope, `scopes[${index}]`, issues, 'sendOutPokemon'),
  }))

  const matchingTrainerScope = tokenScopeResources.find(({ scope, resource }) =>
    resource !== undefined &&
    scope.lane === 'token' &&
    scope.field === SEND_OUT_POKEMON_TRAINER_SCOPE_FIELD &&
    resource.tokenId === payload.trainerTokenId &&
    (resource.sheetKind === undefined || resource.sheetKind === 'trainer'),
  )

  if (matchingTrainerScope?.resource === undefined) {
    addSendOutIssue(
      issues,
      'scopes',
      'invalid-token-scope',
      'sendOutPokemon commands must include a trainer token scope with resource.kind "token", field "sendOut", tokenId matching payload.trainerTokenId, and sheetKind "trainer" when provided.',
      'matching trainer send-out scope',
      command.scopes,
    )
  } else if (
    hasOwn(matchingTrainerScope.scope, 'mapSlug') &&
    typeof matchingTrainerScope.scope.mapSlug === 'string' &&
    matchingTrainerScope.scope.mapSlug.trim().length === 0
  ) {
    addSendOutIssue(
      issues,
      `scopes[${matchingTrainerScope.index}].mapSlug`,
      'invalid-token-scope',
      'sendOutPokemon trainer token scope mapSlug must be a non-empty string when provided.',
      EXPECTED_NON_EMPTY_STRING,
      matchingTrainerScope.scope.mapSlug,
    )
  }

  const matchingPokemonScope = tokenScopeResources.find(({ scope, resource }) =>
    resource !== undefined &&
    scope.lane === 'token' &&
    scope.field === SEND_OUT_POKEMON_SPAWN_SCOPE_FIELD &&
    resource.tokenId === payload.tokenId &&
    (resource.sheetKind === undefined || resource.sheetKind === 'pokemon') &&
    (resource.sheetSlug === undefined || resource.sheetSlug === payload.pokemonSlug),
  )

  if (matchingPokemonScope?.resource === undefined) {
    addSendOutIssue(
      issues,
      'scopes',
      'invalid-token-scope',
      'sendOutPokemon commands must include a spawned Pokémon token scope with resource.kind "token", field "spawn", tokenId matching payload.tokenId, sheetKind "pokemon" when provided, and sheetSlug matching payload.pokemonSlug when provided.',
      'matching Pokémon spawn scope',
      command.scopes,
    )
  } else if (
    hasOwn(matchingPokemonScope.scope, 'mapSlug') &&
    typeof matchingPokemonScope.scope.mapSlug === 'string' &&
    matchingPokemonScope.scope.mapSlug.trim().length === 0
  ) {
    addSendOutIssue(
      issues,
      `scopes[${matchingPokemonScope.index}].mapSlug`,
      'invalid-token-scope',
      'sendOutPokemon spawned Pokémon token scope mapSlug must be a non-empty string when provided.',
      EXPECTED_NON_EMPTY_STRING,
      matchingPokemonScope.scope.mapSlug,
    )
  }

  const trainerResource = matchingTrainerScope?.resource
  const pokemonResource = matchingPokemonScope?.resource
  if (
    trainerResource?.mapSlug !== undefined &&
    pokemonResource?.mapSlug !== undefined &&
    trainerResource.mapSlug !== pokemonResource.mapSlug
  ) {
    addSendOutIssue(
      issues,
      'scopes',
      'invalid-token-scope',
      'sendOutPokemon trainer and spawned Pokémon token scopes must target the same map when both mapSlug values are provided.',
      'matching trainer and Pokémon map slugs',
      command.scopes,
    )
  }

  return {
    ...(trainerResource === undefined ? {} : { trainerResource: cloneTokenResource(trainerResource) }),
    ...(pokemonResource === undefined ? {} : { pokemonResource: cloneTokenResource(pokemonResource) }),
  }
}

export const validateSpawnTokenCommand = <
  TActor extends SessionActor = SessionActor,
>(
  value: unknown,
  _context: SpawnTokenCommandValidationContext = {},
): SpawnTokenCommandValidationResult<TActor> => {
  const envelopeResult = validateSessionCommandEnvelope<SpawnTokenCommand<TActor>>(value)
  if (!envelopeResult.valid) {
    return { valid: false, issues: envelopeResult.issues }
  }

  const command = envelopeResult.command
  const issues: MutableIssueList = []

  if (command.type !== SPAWN_TOKEN_COMMAND_TYPE) {
    addSpawnIssue(
      issues,
      'type',
      'invalid-command-type',
      'spawnToken validators only accept command envelopes with type "spawnToken".',
      SPAWN_TOKEN_COMMAND_TYPE,
      command.type,
    )
  }

  const payload = collectSpawnTokenPayloadIssues(command.payload, issues)
  const resource = findSpawnTokenResource(command, payload, issues)
  const permission = canUseGmAuthority(command.actor)
  if (!permission.allowed) {
    addSpawnIssue(
      issues,
      'actor',
      'permission-denied',
      permission.message,
      'GM actor',
      command.actor,
    )
  }

  if (issues.length > 0) {
    return {
      valid: false,
      issues,
      ...(permission.allowed ? {} : { permission }),
    }
  }

  return {
    valid: true,
    command,
    payload: payload as SpawnTokenCommandPayload,
    resource: resource as SessionTokenResourceRef,
    permission: permission as Extract<PermissionResult, { readonly allowed: true }>,
    issues: [],
  }
}

export const assertValidSpawnTokenCommand = <
  TActor extends SessionActor = SessionActor,
>(
  value: unknown,
  context: SpawnTokenCommandValidationContext = {},
  label = 'spawnToken command',
): SpawnTokenCommand<TActor> => {
  const result = validateSpawnTokenCommand<TActor>(value, context)
  if (result.valid) return result.command

  const summary = result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')
  throw new Error(`${label} is invalid: ${summary}`)
}

export const validateDeleteTokenCommand = <
  TActor extends SessionActor = SessionActor,
>(
  value: unknown,
  _context: DeleteTokenCommandValidationContext = {},
): DeleteTokenCommandValidationResult<TActor> => {
  const envelopeResult = validateSessionCommandEnvelope<DeleteTokenCommand<TActor>>(value)
  if (!envelopeResult.valid) {
    return { valid: false, issues: envelopeResult.issues }
  }

  const command = envelopeResult.command
  const issues: MutableIssueList = []

  if (command.type !== DELETE_TOKEN_COMMAND_TYPE) {
    addDeleteIssue(
      issues,
      'type',
      'invalid-command-type',
      'deleteToken validators only accept command envelopes with type "deleteToken".',
      DELETE_TOKEN_COMMAND_TYPE,
      command.type,
    )
  }

  const payload = collectDeleteTokenPayloadIssues(command.payload, issues)
  const resource = findDeleteTokenResource(command, payload, issues)
  const permission = canUseGmAuthority(command.actor)
  if (!permission.allowed) {
    addDeleteIssue(
      issues,
      'actor',
      'permission-denied',
      permission.message,
      'GM actor',
      command.actor,
    )
  }

  if (issues.length > 0) {
    return {
      valid: false,
      issues,
      ...(permission.allowed ? {} : { permission }),
    }
  }

  return {
    valid: true,
    command,
    payload: payload as DeleteTokenCommandPayload,
    resource: resource as SessionTokenResourceRef,
    permission: permission as Extract<PermissionResult, { readonly allowed: true }>,
    issues: [],
  }
}

export const assertValidDeleteTokenCommand = <
  TActor extends SessionActor = SessionActor,
>(
  value: unknown,
  context: DeleteTokenCommandValidationContext = {},
  label = 'deleteToken command',
): DeleteTokenCommand<TActor> => {
  const result = validateDeleteTokenCommand<TActor>(value, context)
  if (result.valid) return result.command

  const summary = result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')
  throw new Error(`${label} is invalid: ${summary}`)
}

export const validateSendOutPokemonCommand = <
  TActor extends SessionActor = SessionActor,
>(
  value: unknown,
  context: SendOutPokemonCommandValidationContext = {},
): SendOutPokemonCommandValidationResult<TActor> => {
  const envelopeResult = validateSessionCommandEnvelope<SendOutPokemonCommand<TActor>>(value)
  if (!envelopeResult.valid) {
    return { valid: false, issues: envelopeResult.issues }
  }

  const command = envelopeResult.command
  const issues: MutableIssueList = []

  if (command.type !== SEND_OUT_POKEMON_COMMAND_TYPE) {
    addSendOutIssue(
      issues,
      'type',
      'invalid-command-type',
      'sendOutPokemon validators only accept command envelopes with type "sendOutPokemon".',
      SEND_OUT_POKEMON_COMMAND_TYPE,
      command.type,
    )
  }

  const payload = collectSendOutPokemonPayloadIssues(command.payload, issues)
  const { trainerResource, pokemonResource } = findSendOutPokemonResources(command, payload, issues)

  let permission: PermissionResult | undefined
  if (trainerResource !== undefined) {
    permission = canActorControlResource(command.actor, context.assignments ?? [], trainerResource)
    if (!permission.allowed) {
      addSendOutIssue(
        issues,
        'actor',
        'permission-denied',
        permission.message,
        'GM actor or player actor assigned to the trainer token resource',
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
    payload: payload as SendOutPokemonCommandPayload,
    resource: trainerResource as SessionTokenResourceRef,
    trainerResource: trainerResource as SessionTokenResourceRef,
    pokemonResource: pokemonResource as SessionTokenResourceRef,
    permission: permission as Extract<PermissionResult, { readonly allowed: true }>,
    issues: [],
  }
}

export const assertValidSendOutPokemonCommand = <
  TActor extends SessionActor = SessionActor,
>(
  value: unknown,
  context: SendOutPokemonCommandValidationContext = {},
  label = 'sendOutPokemon command',
): SendOutPokemonCommand<TActor> => {
  const result = validateSendOutPokemonCommand<TActor>(value, context)
  if (result.valid) return result.command

  const summary = result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')
  throw new Error(`${label} is invalid: ${summary}`)
}


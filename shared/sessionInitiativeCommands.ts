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
  canUseGmAuthority,
  type PermissionDenied,
  type PermissionResult,
  type SessionActor,
} from './sessionPermissions'
import type { SessionRevision } from './sessionRevisions'

export const SET_INITIATIVE_COMMAND_TYPE = 'setInitiative' as const
export const NEXT_INITIATIVE_COMMAND_TYPE = 'nextInitiative' as const
export const PREVIOUS_INITIATIVE_COMMAND_TYPE = 'previousInitiative' as const
export const INITIATIVE_COMMAND_TYPES = [
  SET_INITIATIVE_COMMAND_TYPE,
  NEXT_INITIATIVE_COMMAND_TYPE,
  PREVIOUS_INITIATIVE_COMMAND_TYPE,
] as const

export type InitiativeCommandType = (typeof INITIATIVE_COMMAND_TYPES)[number]

export const INITIATIVE_COMMAND_SCOPE_FIELD = 'initiative' as const
export const INITIATIVE_MIN_VALUE = -999 as const
export const INITIATIVE_MAX_VALUE = 999 as const

export interface SetInitiativeCommandPayload {
  /** Optional map target. When omitted, the server uses the initiative scope map or selected session map. */
  readonly mapSlug?: string
  /** Placement whose map-local initiative score should change. Required when `initiative` is present. */
  readonly tokenId?: string
  /** Absolute map-local initiative score. `null` clears the placement override. */
  readonly initiative?: number | null
  /** Placement id whose turn should become active. `null` clears the active turn. */
  readonly activeId?: string | null
  /** 1-based combat round counter. */
  readonly round?: number
}

export interface AdvanceInitiativeCommandPayload {
  /** Optional map target. When omitted, the server uses the initiative scope map or selected session map. */
  readonly mapSlug?: string
}

export type NextInitiativeCommandPayload = AdvanceInitiativeCommandPayload
export type PreviousInitiativeCommandPayload = AdvanceInitiativeCommandPayload

export type SetInitiativeCommand<
  TActor extends SessionActor = SessionActor,
> = SessionCommandEnvelope<
  typeof SET_INITIATIVE_COMMAND_TYPE,
  SetInitiativeCommandPayload,
  TActor,
  SessionRevision
>

export type NextInitiativeCommand<
  TActor extends SessionActor = SessionActor,
> = SessionCommandEnvelope<
  typeof NEXT_INITIATIVE_COMMAND_TYPE,
  NextInitiativeCommandPayload,
  TActor,
  SessionRevision
>

export type PreviousInitiativeCommand<
  TActor extends SessionActor = SessionActor,
> = SessionCommandEnvelope<
  typeof PREVIOUS_INITIATIVE_COMMAND_TYPE,
  PreviousInitiativeCommandPayload,
  TActor,
  SessionRevision
>

export type InitiativeCommand<TActor extends SessionActor = SessionActor> =
  | SetInitiativeCommand<TActor>
  | NextInitiativeCommand<TActor>
  | PreviousInitiativeCommand<TActor>

export type InitiativeCommandPayload =
  | SetInitiativeCommandPayload
  | NextInitiativeCommandPayload
  | PreviousInitiativeCommandPayload

export const INITIATIVE_COMMAND_VALIDATION_CODES = [
  'invalid-command-type',
  'invalid-payload',
  'invalid-map-slug',
  'invalid-token-id',
  'invalid-initiative',
  'invalid-active-id',
  'invalid-round',
  'invalid-initiative-scope',
  'permission-denied',
] as const

export type InitiativeCommandValidationCode =
  (typeof INITIATIVE_COMMAND_VALIDATION_CODES)[number]

export interface InitiativeCommandValidationContext {
  /** Initiative controls are GM-only in Track 2; this context is reserved for later finer-grained policy. */
  readonly assignments?: readonly unknown[]
}

export interface InitiativeCommandValidationSuccess<
  TCommand extends InitiativeCommand = InitiativeCommand,
> {
  readonly valid: true
  readonly command: TCommand
  readonly payload: TCommand['payload']
  readonly mapSlug?: string
  readonly permission: Extract<PermissionResult, { readonly allowed: true }>
  readonly issues: readonly []
}

export interface InitiativeCommandValidationFailure {
  readonly valid: false
  readonly issues: readonly SessionCommandValidationIssue[]
  readonly permission?: PermissionDenied
}

export type InitiativeCommandValidationResult<
  TCommand extends InitiativeCommand = InitiativeCommand,
> = InitiativeCommandValidationSuccess<TCommand> | InitiativeCommandValidationFailure

type MutableIssueList = SessionCommandValidationIssue[]
type UnknownRecord = Record<string, unknown>

const EXPECTED_OBJECT = 'object'
const EXPECTED_NON_EMPTY_STRING = 'non-empty string'
const EXPECTED_SAFE_INTEGER = 'safe integer'
const EXPECTED_ROUND = 'safe integer >= 1'
const EXPECTED_INITIATIVE_VALUE = `${INITIATIVE_MIN_VALUE}..${INITIATIVE_MAX_VALUE} integer or null`

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
  code: InitiativeCommandValidationCode,
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

const isSafeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value)

const isInitiativeValue = (value: unknown): value is number | null =>
  value === null || (
    isSafeInteger(value) &&
    value >= INITIATIVE_MIN_VALUE &&
    value <= INITIATIVE_MAX_VALUE
  )

const cloneSetPayload = (payload: SetInitiativeCommandPayload): SetInitiativeCommandPayload => ({
  ...(payload.mapSlug === undefined ? {} : { mapSlug: payload.mapSlug }),
  ...(payload.tokenId === undefined ? {} : { tokenId: payload.tokenId }),
  ...(payload.initiative === undefined ? {} : { initiative: payload.initiative }),
  ...(payload.activeId === undefined ? {} : { activeId: payload.activeId }),
  ...(payload.round === undefined ? {} : { round: payload.round }),
})

const cloneAdvancePayload = (payload: AdvanceInitiativeCommandPayload): AdvanceInitiativeCommandPayload => ({
  ...(payload.mapSlug === undefined ? {} : { mapSlug: payload.mapSlug }),
})

export const isInitiativeCommandType = (value: unknown): value is InitiativeCommandType =>
  (INITIATIVE_COMMAND_TYPES as readonly unknown[]).includes(value)

export const isInitiativeCommandValidationCode = (
  value: unknown,
): value is InitiativeCommandValidationCode =>
  (INITIATIVE_COMMAND_VALIDATION_CODES as readonly unknown[]).includes(value)

export const createInitiativeCommandScope = (mapSlug?: string): SessionCommandScope => ({
  lane: 'initiative',
  field: INITIATIVE_COMMAND_SCOPE_FIELD,
  ...(mapSlug === undefined ? {} : { mapSlug }),
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
      'initiative payload.mapSlug must be a non-empty string when provided.',
      EXPECTED_NON_EMPTY_STRING,
      payload.mapSlug,
    )
    return undefined
  }
  return payload.mapSlug
}

const collectSetInitiativePayloadIssues = (
  payload: unknown,
  issues: MutableIssueList,
): SetInitiativeCommandPayload | undefined => {
  if (!isRecord(payload)) {
    addIssue(
      issues,
      'payload',
      'invalid-payload',
      'setInitiative payload must be an object.',
      EXPECTED_OBJECT,
      payload,
    )
    return undefined
  }

  const mapSlug = collectPayloadMapSlugIssue(payload, issues)
  const tokenId = payload.tokenId
  const initiative = payload.initiative
  const activeId = payload.activeId
  const round = payload.round
  const setsInitiative = hasOwn(payload, 'initiative')
  const setsActive = hasOwn(payload, 'activeId')
  const setsRound = hasOwn(payload, 'round')

  if (!setsInitiative && !setsActive && !setsRound) {
    addIssue(
      issues,
      'payload',
      'invalid-payload',
      'setInitiative payload must set at least one of initiative, activeId, or round.',
      'one or more initiative changes',
      payload,
    )
  }

  if (setsInitiative) {
    if (!isNonEmptyString(tokenId)) {
      addIssue(
        issues,
        'payload.tokenId',
        'invalid-token-id',
        'setInitiative payload.tokenId must be a non-empty token ID string when initiative is provided.',
        EXPECTED_NON_EMPTY_STRING,
        tokenId,
      )
    }

    if (!isInitiativeValue(initiative)) {
      addIssue(
        issues,
        'payload.initiative',
        'invalid-initiative',
        `setInitiative payload.initiative must be an integer from ${INITIATIVE_MIN_VALUE} to ${INITIATIVE_MAX_VALUE}, or null to clear it.`,
        EXPECTED_INITIATIVE_VALUE,
        initiative,
      )
    }
  } else if (hasOwn(payload, 'tokenId')) {
    addIssue(
      issues,
      'payload.tokenId',
      'invalid-token-id',
      'setInitiative payload.tokenId is only valid when payload.initiative is provided.',
      'tokenId with initiative',
      tokenId,
    )
  }

  if (setsActive && activeId !== null && !isNonEmptyString(activeId)) {
    addIssue(
      issues,
      'payload.activeId',
      'invalid-active-id',
      'setInitiative payload.activeId must be a non-empty token ID string or null.',
      'non-empty string or null',
      activeId,
    )
  }

  if (setsRound && !(isSafeInteger(round) && round >= 1)) {
    addIssue(
      issues,
      'payload.round',
      'invalid-round',
      'setInitiative payload.round must be a safe integer greater than or equal to 1.',
      EXPECTED_ROUND,
      round,
    )
  }

  if (issues.some((issue) => issue.path.startsWith('payload'))) return undefined

  return cloneSetPayload({
    ...(mapSlug === undefined ? {} : { mapSlug }),
    ...(setsInitiative ? { tokenId: tokenId as string, initiative: initiative as number | null } : {}),
    ...(setsActive ? { activeId: activeId as string | null } : {}),
    ...(setsRound ? { round: round as number } : {}),
  })
}

const collectAdvancePayloadIssues = (
  payload: unknown,
  commandLabel: string,
  issues: MutableIssueList,
): AdvanceInitiativeCommandPayload | undefined => {
  if (!isRecord(payload)) {
    addIssue(
      issues,
      'payload',
      'invalid-payload',
      `${commandLabel} payload must be an object.`,
      EXPECTED_OBJECT,
      payload,
    )
    return undefined
  }

  const mapSlug = collectPayloadMapSlugIssue(payload, issues)
  if (issues.some((issue) => issue.path.startsWith('payload'))) return undefined
  return cloneAdvancePayload({ ...(mapSlug === undefined ? {} : { mapSlug }) })
}

const findInitiativeScopeMapSlug = (
  command: Pick<InitiativeCommand, 'scopes' | 'payload' | 'type'>,
  payload: InitiativeCommandPayload | undefined,
  issues: MutableIssueList,
): string | undefined => {
  const initiativeScopes = command.scopes.filter(
    (scope) => scope.lane === 'initiative' && scope.field === INITIATIVE_COMMAND_SCOPE_FIELD,
  )

  if (initiativeScopes.length === 0) {
    addIssue(
      issues,
      'scopes',
      'invalid-initiative-scope',
      `${command.type} commands must include an initiative scope with field "initiative".`,
      'initiative scope',
      command.scopes,
    )
    return payload?.mapSlug
  }

  const mapSlugs = new Set(
    initiativeScopes
      .map((scope) => scope.mapSlug)
      .filter((mapSlug): mapSlug is string => mapSlug !== undefined),
  )
  if (mapSlugs.size > 1) {
    addIssue(
      issues,
      'scopes',
      'invalid-initiative-scope',
      `${command.type} initiative scopes must not target multiple maps.`,
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
      `${command.type} payload.mapSlug must match the initiative scope mapSlug when both are provided.`,
      scopeMapSlug,
      payload.mapSlug,
    )
  }

  return payload?.mapSlug ?? scopeMapSlug
}

const createValidationFailure = (
  issues: readonly SessionCommandValidationIssue[],
  permission: PermissionResult,
): InitiativeCommandValidationFailure => ({
  valid: false,
  issues,
  ...(permission.allowed ? {} : { permission }),
})

const validatePermission = (
  command: InitiativeCommand,
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

export const validateSetInitiativeCommand = <
  TActor extends SessionActor = SessionActor,
>(
  value: unknown,
  _context: InitiativeCommandValidationContext = {},
): InitiativeCommandValidationResult<SetInitiativeCommand<TActor>> => {
  const envelopeResult = validateSessionCommandEnvelope<SetInitiativeCommand<TActor>>(value)
  if (!envelopeResult.valid) return { valid: false, issues: envelopeResult.issues }

  const command = envelopeResult.command
  const issues: MutableIssueList = []

  if (command.type !== SET_INITIATIVE_COMMAND_TYPE) {
    addIssue(
      issues,
      'type',
      'invalid-command-type',
      'setInitiative validators only accept command envelopes with type "setInitiative".',
      SET_INITIATIVE_COMMAND_TYPE,
      command.type,
    )
  }

  const payload = collectSetInitiativePayloadIssues(command.payload, issues)
  const mapSlug = findInitiativeScopeMapSlug(command, payload, issues)
  const permission = validatePermission(command, issues)

  if (issues.length > 0) return createValidationFailure(issues, permission)

  return {
    valid: true,
    command,
    payload: payload as SetInitiativeCommandPayload,
    ...(mapSlug === undefined ? {} : { mapSlug }),
    permission: permission as Extract<PermissionResult, { readonly allowed: true }>,
    issues: [],
  }
}

const validateAdvanceInitiativeCommand = <
  TCommand extends NextInitiativeCommand | PreviousInitiativeCommand,
>(
  value: unknown,
  type: TCommand['type'],
  label: 'nextInitiative' | 'previousInitiative',
): InitiativeCommandValidationResult<TCommand> => {
  const envelopeResult = validateSessionCommandEnvelope<TCommand>(value)
  if (!envelopeResult.valid) return { valid: false, issues: envelopeResult.issues }

  const command = envelopeResult.command
  const issues: MutableIssueList = []

  if (command.type !== type) {
    addIssue(
      issues,
      'type',
      'invalid-command-type',
      `${label} validators only accept command envelopes with type "${type}".`,
      type,
      command.type,
    )
  }

  const payload = collectAdvancePayloadIssues(command.payload, label, issues)
  const mapSlug = findInitiativeScopeMapSlug(command, payload, issues)
  const permission = validatePermission(command, issues)

  if (issues.length > 0) return createValidationFailure(issues, permission)

  return {
    valid: true,
    command,
    payload: payload as TCommand['payload'],
    ...(mapSlug === undefined ? {} : { mapSlug }),
    permission: permission as Extract<PermissionResult, { readonly allowed: true }>,
    issues: [],
  }
}

export const validateNextInitiativeCommand = <
  TActor extends SessionActor = SessionActor,
>(
  value: unknown,
  _context: InitiativeCommandValidationContext = {},
): InitiativeCommandValidationResult<NextInitiativeCommand<TActor>> =>
  validateAdvanceInitiativeCommand<NextInitiativeCommand<TActor>>(
    value,
    NEXT_INITIATIVE_COMMAND_TYPE,
    'nextInitiative',
  )

export const validatePreviousInitiativeCommand = <
  TActor extends SessionActor = SessionActor,
>(
  value: unknown,
  _context: InitiativeCommandValidationContext = {},
): InitiativeCommandValidationResult<PreviousInitiativeCommand<TActor>> =>
  validateAdvanceInitiativeCommand<PreviousInitiativeCommand<TActor>>(
    value,
    PREVIOUS_INITIATIVE_COMMAND_TYPE,
    'previousInitiative',
  )

export const validateInitiativeCommand = <
  TActor extends SessionActor = SessionActor,
>(
  value: unknown,
  context: InitiativeCommandValidationContext = {},
): InitiativeCommandValidationResult<InitiativeCommand<TActor>> => {
  const envelopeResult = validateSessionCommandEnvelope<InitiativeCommand<TActor>>(value)
  if (!envelopeResult.valid) return { valid: false, issues: envelopeResult.issues }

  if (envelopeResult.command.type === SET_INITIATIVE_COMMAND_TYPE) {
    return validateSetInitiativeCommand<TActor>(value, context) as InitiativeCommandValidationResult<InitiativeCommand<TActor>>
  }
  if (envelopeResult.command.type === NEXT_INITIATIVE_COMMAND_TYPE) {
    return validateNextInitiativeCommand<TActor>(value, context) as InitiativeCommandValidationResult<InitiativeCommand<TActor>>
  }
  if (envelopeResult.command.type === PREVIOUS_INITIATIVE_COMMAND_TYPE) {
    return validatePreviousInitiativeCommand<TActor>(value, context) as InitiativeCommandValidationResult<InitiativeCommand<TActor>>
  }

  return {
    valid: false,
    issues: [
      {
        path: 'type',
        code: 'invalid-command-type',
        message: 'initiative validators only accept setInitiative, nextInitiative, or previousInitiative command envelopes.',
        expected: INITIATIVE_COMMAND_TYPES.join(' | '),
        received: describeReceived(isRecord(value) ? value.type : undefined),
      },
    ],
  }
}

export const assertValidInitiativeCommand = <
  TActor extends SessionActor = SessionActor,
>(
  value: unknown,
  context: InitiativeCommandValidationContext = {},
  label = 'initiative command',
): InitiativeCommand<TActor> => {
  const result = validateInitiativeCommand<TActor>(value, context)
  if (result.valid) return result.command

  const summary = result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')
  throw new Error(`${label} is invalid: ${summary}`)
}

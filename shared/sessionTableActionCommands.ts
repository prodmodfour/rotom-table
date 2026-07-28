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
  type SessionSheetResourceRef,
  type SessionTokenResourceRef,
} from './sessionPermissions'
import type { SessionRevision } from './sessionRevisions'
import { isSheetKind, type SheetKind } from './sheets'

export const MODIFY_HP_COMMAND_TYPE = 'modifyHp' as const
export const MODIFY_HP_COMMAND_SCOPE_FIELD = 'hp' as const

export const MODIFY_COMBAT_STAGES_COMMAND_TYPE = 'modifyCombatStages' as const
export const MODIFY_COMBAT_STAGES_COMMAND_SCOPE_FIELD = 'combatStages' as const
export const SESSION_COMBAT_STAGE_KEYS = ['atk', 'def', 'satk', 'sdef', 'spd', 'acc'] as const

export const MODIFY_CONDITIONS_COMMAND_TYPE = 'modifyConditions' as const
export const MODIFY_CONDITIONS_COMMAND_SCOPE_FIELD = 'conditions' as const
export const MODIFY_CONDITIONS_ACTIONS = ['add', 'remove', 'replace'] as const

export const USE_MOVE_COMMAND_TYPE = 'useMove' as const
export const USE_MOVE_COMMAND_SCOPE_FIELD = 'moveUsage' as const

export const USE_MANEUVER_COMMAND_TYPE = 'useManeuver' as const
export const USE_MANEUVER_COMMAND_SCOPE_FIELD = 'maneuver' as const

/** @deprecated Historical session wire-reader identity; production execution is retired. */
export const USE_ABILITY_COMMAND_TYPE = 'useAbility' as const
/** @deprecated Historical session scope field only. */
export const USE_ABILITY_COMMAND_SCOPE_FIELD = 'ability' as const

export const USE_ORDER_COMMAND_TYPE = 'useOrder' as const
export const USE_ORDER_COMMAND_SCOPE_FIELD = 'order' as const

export type SessionCombatStageKey = (typeof SESSION_COMBAT_STAGE_KEYS)[number]
export type SessionCombatStageMap = Record<SessionCombatStageKey, number>
export type ModifyConditionsAction = (typeof MODIFY_CONDITIONS_ACTIONS)[number]

export interface ModifyHpCommandPayload {
  readonly tokenId: string
  /** Absolute current HP requested by the client. Server-side sheet formulas cap healing but preserve overkill. */
  readonly currentHp: number
  /** Optional absolute Injury count after PTU injury automation. */
  readonly injuries?: number
}

export type ModifyHpCommand<
  TActor extends SessionActor = SessionActor,
> = SessionCommandEnvelope<
  typeof MODIFY_HP_COMMAND_TYPE,
  ModifyHpCommandPayload,
  TActor,
  SessionRevision
>

export interface ModifyCombatStagesCommandPayload {
  readonly tokenId: string
  /** Absolute combat stage values requested by the client. Each stage must be an integer from -6 to +6. */
  readonly stages: SessionCombatStageMap
}

export type ModifyCombatStagesCommand<
  TActor extends SessionActor = SessionActor,
> = SessionCommandEnvelope<
  typeof MODIFY_COMBAT_STAGES_COMMAND_TYPE,
  ModifyCombatStagesCommandPayload,
  TActor,
  SessionRevision
>

export interface ModifyConditionsCommandPayload {
  readonly tokenId: string
  /** Whether the server should add to, remove from, or replace the authoritative condition list. */
  readonly action: ModifyConditionsAction
  /** PTU condition entries. Replace may be empty to clear explicit conditions; add/remove require at least one entry. */
  readonly conditions: readonly string[]
}

export type ModifyConditionsCommand<
  TActor extends SessionActor = SessionActor,
> = SessionCommandEnvelope<
  typeof MODIFY_CONDITIONS_COMMAND_TYPE,
  ModifyConditionsCommandPayload,
  TActor,
  SessionRevision
>

export interface UseMoveCommandPayload {
  readonly tokenId: string
  /** Display or canonical move name selected by the acting client. The server resolves it against the placed sheet. */
  readonly moveName: string
}

export type UseMoveCommand<
  TActor extends SessionActor = SessionActor,
> = SessionCommandEnvelope<
  typeof USE_MOVE_COMMAND_TYPE,
  UseMoveCommandPayload,
  TActor,
  SessionRevision
>

export interface UseManeuverCommandPayload {
  readonly tokenId: string
  /** Display or canonical maneuver name selected by the acting client. */
  readonly maneuverName: string
  /** Optional map-local target token selected by clients after targeting UI. */
  readonly targetTokenId?: string
}

export type UseManeuverCommand<
  TActor extends SessionActor = SessionActor,
> = SessionCommandEnvelope<
  typeof USE_MANEUVER_COMMAND_TYPE,
  UseManeuverCommandPayload,
  TActor,
  SessionRevision
>

/** @deprecated Historical session payload reader only. */
export interface UseAbilityCommandPayload {
  readonly tokenId: string
  /** Display or canonical ability name selected by the acting client. */
  readonly abilityName: string
  /** Optional map-local target token selected by clients after targeting UI. */
  readonly targetTokenId?: string
}

/** @deprecated Historical session command reader only; sockets reject it non-retryably. */
export type UseAbilityCommand<
  TActor extends SessionActor = SessionActor,
> = SessionCommandEnvelope<
  typeof USE_ABILITY_COMMAND_TYPE,
  UseAbilityCommandPayload,
  TActor,
  SessionRevision
>

export interface UseOrderCommandPayload {
  readonly tokenId: string
  /** Display or canonical order name selected by the acting trainer client. */
  readonly orderName: string
  /** Optional map-local target token selected by clients after targeting UI. */
  readonly targetTokenId?: string
}

export type UseOrderCommand<
  TActor extends SessionActor = SessionActor,
> = SessionCommandEnvelope<
  typeof USE_ORDER_COMMAND_TYPE,
  UseOrderCommandPayload,
  TActor,
  SessionRevision
>

export const MODIFY_HP_COMMAND_VALIDATION_CODES = [
  'invalid-command-type',
  'invalid-payload',
  'invalid-token-id',
  'invalid-current-hp',
  'invalid-injuries',
  'invalid-token-scope',
  'invalid-sheet-scope',
  'permission-denied',
] as const

export type ModifyHpCommandValidationCode =
  (typeof MODIFY_HP_COMMAND_VALIDATION_CODES)[number]

export interface ModifyHpCommandValidationContext {
  /** Current GM-managed assignments. GM actors are allowed; player actors must control the target token or sheet. */
  readonly assignments?: readonly PlayerAssignmentRecord[]
}

export interface ModifyHpCommandValidationSuccess<
  TActor extends SessionActor = SessionActor,
> {
  readonly valid: true
  readonly command: ModifyHpCommand<TActor>
  readonly payload: ModifyHpCommandPayload
  /** Token resource used to locate the map placement. */
  readonly resource: SessionTokenResourceRef
  readonly tokenResource: SessionTokenResourceRef
  /** Optional sheet resource used to authorize sheet-assigned players. */
  readonly sheetResource?: SessionSheetResourceRef
  readonly permittedResource: SessionTokenResourceRef | SessionSheetResourceRef
  readonly permission: Extract<PermissionResult, { readonly allowed: true }>
  readonly issues: readonly []
}

export interface ModifyHpCommandValidationFailure {
  readonly valid: false
  readonly issues: readonly SessionCommandValidationIssue[]
  readonly permission?: PermissionDenied
}

export type ModifyHpCommandValidationResult<
  TActor extends SessionActor = SessionActor,
> = ModifyHpCommandValidationSuccess<TActor> | ModifyHpCommandValidationFailure

export const MODIFY_COMBAT_STAGES_COMMAND_VALIDATION_CODES = [
  'invalid-command-type',
  'invalid-payload',
  'invalid-token-id',
  'invalid-stages',
  'invalid-token-scope',
  'invalid-sheet-scope',
  'permission-denied',
] as const

export type ModifyCombatStagesCommandValidationCode =
  (typeof MODIFY_COMBAT_STAGES_COMMAND_VALIDATION_CODES)[number]

export interface ModifyCombatStagesCommandValidationContext {
  /** Current GM-managed assignments. GM actors are allowed; player actors must control the target token or sheet. */
  readonly assignments?: readonly PlayerAssignmentRecord[]
}

export interface ModifyCombatStagesCommandValidationSuccess<
  TActor extends SessionActor = SessionActor,
> {
  readonly valid: true
  readonly command: ModifyCombatStagesCommand<TActor>
  readonly payload: ModifyCombatStagesCommandPayload
  /** Token resource used to locate the map placement. */
  readonly resource: SessionTokenResourceRef
  readonly tokenResource: SessionTokenResourceRef
  /** Optional sheet resource used to authorize sheet-assigned players. */
  readonly sheetResource?: SessionSheetResourceRef
  readonly permittedResource: SessionTokenResourceRef | SessionSheetResourceRef
  readonly permission: Extract<PermissionResult, { readonly allowed: true }>
  readonly issues: readonly []
}

export interface ModifyCombatStagesCommandValidationFailure {
  readonly valid: false
  readonly issues: readonly SessionCommandValidationIssue[]
  readonly permission?: PermissionDenied
}

export type ModifyCombatStagesCommandValidationResult<
  TActor extends SessionActor = SessionActor,
> = ModifyCombatStagesCommandValidationSuccess<TActor> | ModifyCombatStagesCommandValidationFailure

export const MODIFY_CONDITIONS_COMMAND_VALIDATION_CODES = [
  'invalid-command-type',
  'invalid-payload',
  'invalid-token-id',
  'invalid-action',
  'invalid-conditions',
  'invalid-token-scope',
  'invalid-sheet-scope',
  'permission-denied',
] as const

export type ModifyConditionsCommandValidationCode =
  (typeof MODIFY_CONDITIONS_COMMAND_VALIDATION_CODES)[number]

export interface ModifyConditionsCommandValidationContext {
  /** Current GM-managed assignments. GM actors are allowed; player actors must control the target token or sheet. */
  readonly assignments?: readonly PlayerAssignmentRecord[]
}

export interface ModifyConditionsCommandValidationSuccess<
  TActor extends SessionActor = SessionActor,
> {
  readonly valid: true
  readonly command: ModifyConditionsCommand<TActor>
  readonly payload: ModifyConditionsCommandPayload
  /** Token resource used to locate the map placement. */
  readonly resource: SessionTokenResourceRef
  readonly tokenResource: SessionTokenResourceRef
  /** Optional sheet resource used to authorize sheet-assigned players. */
  readonly sheetResource?: SessionSheetResourceRef
  readonly permittedResource: SessionTokenResourceRef | SessionSheetResourceRef
  readonly permission: Extract<PermissionResult, { readonly allowed: true }>
  readonly issues: readonly []
}

export interface ModifyConditionsCommandValidationFailure {
  readonly valid: false
  readonly issues: readonly SessionCommandValidationIssue[]
  readonly permission?: PermissionDenied
}

export type ModifyConditionsCommandValidationResult<
  TActor extends SessionActor = SessionActor,
> = ModifyConditionsCommandValidationSuccess<TActor> | ModifyConditionsCommandValidationFailure

export const USE_MOVE_COMMAND_VALIDATION_CODES = [
  'invalid-command-type',
  'invalid-payload',
  'invalid-token-id',
  'invalid-move-name',
  'invalid-token-scope',
  'invalid-sheet-scope',
  'permission-denied',
] as const

export type UseMoveCommandValidationCode =
  (typeof USE_MOVE_COMMAND_VALIDATION_CODES)[number]

export interface UseMoveCommandValidationContext {
  /** Current GM-managed assignments. GM actors are allowed; player actors must control the target token or sheet. */
  readonly assignments?: readonly PlayerAssignmentRecord[]
}

export interface UseMoveCommandValidationSuccess<
  TActor extends SessionActor = SessionActor,
> {
  readonly valid: true
  readonly command: UseMoveCommand<TActor>
  readonly payload: UseMoveCommandPayload
  /** Token resource used to locate the map placement whose move is being used. */
  readonly resource: SessionTokenResourceRef
  readonly tokenResource: SessionTokenResourceRef
  /** Optional sheet resource used to authorize sheet-assigned players and stale daily-frequency checks. */
  readonly sheetResource?: SessionSheetResourceRef
  readonly permittedResource: SessionTokenResourceRef | SessionSheetResourceRef
  readonly permission: Extract<PermissionResult, { readonly allowed: true }>
  readonly issues: readonly []
}

export interface UseMoveCommandValidationFailure {
  readonly valid: false
  readonly issues: readonly SessionCommandValidationIssue[]
  readonly permission?: PermissionDenied
}

export type UseMoveCommandValidationResult<
  TActor extends SessionActor = SessionActor,
> = UseMoveCommandValidationSuccess<TActor> | UseMoveCommandValidationFailure

export const USE_MANEUVER_COMMAND_VALIDATION_CODES = [
  'invalid-command-type',
  'invalid-payload',
  'invalid-token-id',
  'invalid-maneuver-name',
  'invalid-target-token-id',
  'invalid-token-scope',
  'invalid-sheet-scope',
  'permission-denied',
] as const

export type UseManeuverCommandValidationCode =
  (typeof USE_MANEUVER_COMMAND_VALIDATION_CODES)[number]

export const USE_ABILITY_COMMAND_VALIDATION_CODES = [
  'invalid-command-type',
  'invalid-payload',
  'invalid-token-id',
  'invalid-ability-name',
  'invalid-target-token-id',
  'invalid-token-scope',
  'invalid-sheet-scope',
  'permission-denied',
] as const

export type UseAbilityCommandValidationCode =
  (typeof USE_ABILITY_COMMAND_VALIDATION_CODES)[number]

export const USE_ORDER_COMMAND_VALIDATION_CODES = [
  'invalid-command-type',
  'invalid-payload',
  'invalid-token-id',
  'invalid-order-name',
  'invalid-target-token-id',
  'invalid-token-scope',
  'invalid-sheet-scope',
  'permission-denied',
] as const

export type UseOrderCommandValidationCode =
  (typeof USE_ORDER_COMMAND_VALIDATION_CODES)[number]

export interface UseTableActionCommandValidationContext {
  /** Current GM-managed assignments. GM actors are allowed; player actors must control the acting token or sheet. */
  readonly assignments?: readonly PlayerAssignmentRecord[]
}

export type UseManeuverCommandValidationContext = UseTableActionCommandValidationContext
export type UseAbilityCommandValidationContext = UseTableActionCommandValidationContext
export type UseOrderCommandValidationContext = UseTableActionCommandValidationContext

export interface UseTableActionCommandValidationSuccess<
  TCommand extends SessionCommandEnvelope<string, unknown, TActor, SessionRevision>,
  TPayload,
  TActor extends SessionActor = SessionActor,
> {
  readonly valid: true
  readonly command: TCommand
  readonly payload: TPayload
  /** Token resource used to locate the map placement whose action is being used. */
  readonly resource: SessionTokenResourceRef
  readonly tokenResource: SessionTokenResourceRef
  /** Optional sheet resource used to authorize sheet-assigned players. */
  readonly sheetResource?: SessionSheetResourceRef
  readonly permittedResource: SessionTokenResourceRef | SessionSheetResourceRef
  readonly permission: Extract<PermissionResult, { readonly allowed: true }>
  readonly issues: readonly []
}

export interface UseTableActionCommandValidationFailure {
  readonly valid: false
  readonly issues: readonly SessionCommandValidationIssue[]
  readonly permission?: PermissionDenied
}

export type UseManeuverCommandValidationResult<
  TActor extends SessionActor = SessionActor,
> =
  | UseTableActionCommandValidationSuccess<UseManeuverCommand<TActor>, UseManeuverCommandPayload, TActor>
  | UseTableActionCommandValidationFailure

export type UseAbilityCommandValidationResult<
  TActor extends SessionActor = SessionActor,
> =
  | UseTableActionCommandValidationSuccess<UseAbilityCommand<TActor>, UseAbilityCommandPayload, TActor>
  | UseTableActionCommandValidationFailure

export type UseOrderCommandValidationResult<
  TActor extends SessionActor = SessionActor,
> =
  | UseTableActionCommandValidationSuccess<UseOrderCommand<TActor>, UseOrderCommandPayload, TActor>
  | UseTableActionCommandValidationFailure

type MutableIssueList = SessionCommandValidationIssue[]
type UnknownRecord = Record<string, unknown>

const EXPECTED_OBJECT = 'object'
const EXPECTED_NON_EMPTY_STRING = 'non-empty string'
const EXPECTED_SAFE_INTEGER = 'safe integer'
const EXPECTED_NON_NEGATIVE_SAFE_INTEGER = 'safe non-negative integer'
const EXPECTED_SHEET_KIND = 'pokemon | trainer'
const EXPECTED_CONDITION_ACTION = 'add | remove | replace'
const EXPECTED_CONDITION_LIST = 'array of non-empty condition strings'

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
  code:
    | ModifyHpCommandValidationCode
    | ModifyCombatStagesCommandValidationCode
    | ModifyConditionsCommandValidationCode
    | UseMoveCommandValidationCode
    | UseManeuverCommandValidationCode
    | UseAbilityCommandValidationCode
    | UseOrderCommandValidationCode,
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

const isNonNegativeSafeInteger = (value: unknown): value is number =>
  isSafeInteger(value) && value >= 0

const cloneTokenResource = (resource: SessionTokenResourceRef): SessionTokenResourceRef => ({
  ...resource,
})

const cloneSheetResource = (resource: SessionSheetResourceRef): SessionSheetResourceRef => ({
  ...resource,
})

const clonePayload = (payload: ModifyHpCommandPayload): ModifyHpCommandPayload => ({
  tokenId: payload.tokenId,
  currentHp: payload.currentHp,
  ...(payload.injuries === undefined ? {} : { injuries: payload.injuries }),
})

export const isModifyHpCommandValidationCode = (
  value: unknown,
): value is ModifyHpCommandValidationCode =>
  (MODIFY_HP_COMMAND_VALIDATION_CODES as readonly unknown[]).includes(value)

export const createModifyHpTokenCommandScope = (
  resource: SessionTokenResourceRef,
): SessionCommandScope => ({
  lane: 'token',
  resource: cloneTokenResource(resource),
  field: MODIFY_HP_COMMAND_SCOPE_FIELD,
  ...(resource.mapSlug === undefined ? {} : { mapSlug: resource.mapSlug }),
})

export const createModifyHpSheetCommandScope = (
  resource: SessionSheetResourceRef,
): SessionCommandScope => ({
  lane: 'sheet',
  resource: cloneSheetResource(resource),
  field: MODIFY_HP_COMMAND_SCOPE_FIELD,
})

const collectModifyHpPayloadIssues = (
  payload: unknown,
  issues: MutableIssueList,
): ModifyHpCommandPayload | undefined => {
  if (!isRecord(payload)) {
    addIssue(
      issues,
      'payload',
      'invalid-payload',
      'modifyHp payload must be an object.',
      EXPECTED_OBJECT,
      payload,
    )
    return undefined
  }

  const tokenId = payload.tokenId
  const currentHp = payload.currentHp
  const injuries = payload.injuries

  if (!isNonEmptyString(tokenId)) {
    addIssue(
      issues,
      'payload.tokenId',
      'invalid-token-id',
      'modifyHp payload.tokenId must be a non-empty token ID string.',
      EXPECTED_NON_EMPTY_STRING,
      tokenId,
    )
  }

  if (!isSafeInteger(currentHp)) {
    addIssue(
      issues,
      'payload.currentHp',
      'invalid-current-hp',
      'modifyHp payload.currentHp must be a safe integer.',
      EXPECTED_SAFE_INTEGER,
      currentHp,
    )
  }

  if (injuries !== undefined && !isNonNegativeSafeInteger(injuries)) {
    addIssue(
      issues,
      'payload.injuries',
      'invalid-injuries',
      'modifyHp payload.injuries must be a safe non-negative integer when provided.',
      EXPECTED_NON_NEGATIVE_SAFE_INTEGER,
      injuries,
    )
  }

  if (issues.some((issue) => issue.path.startsWith('payload.'))) {
    return undefined
  }

  return clonePayload({
    tokenId: tokenId as string,
    currentHp: currentHp as number,
    ...(injuries === undefined ? {} : { injuries: injuries as number }),
  })
}

const tokenResourceFromScope = (
  scope: SessionCommandScope,
  path: string,
  issues: MutableIssueList,
): SessionTokenResourceRef | undefined => {
  if (scope.resource?.kind !== 'token') return undefined

  const tokenResource = scope.resource
  if (hasOwn(tokenResource, 'sheetKind') && tokenResource.sheetKind !== undefined && !isSheetKind(tokenResource.sheetKind)) {
    addIssue(
      issues,
      `${path}.resource.sheetKind`,
      'invalid-token-scope',
      'modifyHp token scope sheetKind must be pokemon or trainer when provided.',
      EXPECTED_SHEET_KIND,
      tokenResource.sheetKind,
    )
  }

  if (hasOwn(tokenResource, 'sheetSlug') && tokenResource.sheetSlug !== undefined && !isNonEmptyString(tokenResource.sheetSlug)) {
    addIssue(
      issues,
      `${path}.resource.sheetSlug`,
      'invalid-token-scope',
      'modifyHp token scope sheetSlug must be a non-empty string when provided.',
      EXPECTED_NON_EMPTY_STRING,
      tokenResource.sheetSlug,
    )
  }

  if (hasOwn(tokenResource, 'mapSlug') && tokenResource.mapSlug !== undefined && !isNonEmptyString(tokenResource.mapSlug)) {
    addIssue(
      issues,
      `${path}.resource.mapSlug`,
      'invalid-token-scope',
      'modifyHp token scope mapSlug must be a non-empty string when provided.',
      EXPECTED_NON_EMPTY_STRING,
      tokenResource.mapSlug,
    )
  }

  if (hasOwn(tokenResource, 'mapSlug') && hasOwn(scope, 'mapSlug') && tokenResource.mapSlug !== scope.mapSlug) {
    addIssue(
      issues,
      `${path}.mapSlug`,
      'invalid-token-scope',
      'modifyHp token scope mapSlug must match the token resource mapSlug when both are provided.',
      'matching token scope map slug',
      scope.mapSlug,
    )
  }

  return {
    ...tokenResource,
    ...(tokenResource.mapSlug === undefined && typeof scope.mapSlug === 'string'
      ? { mapSlug: scope.mapSlug }
      : {}),
  }
}

const sheetResourceFromScope = (
  scope: SessionCommandScope,
  path: string,
  issues: MutableIssueList,
): SessionSheetResourceRef | undefined => {
  if (scope.resource?.kind !== 'sheet') return undefined

  const sheetResource = scope.resource as unknown as UnknownRecord
  if (!isSheetKind(sheetResource.sheetKind)) {
    addIssue(
      issues,
      `${path}.resource.sheetKind`,
      'invalid-sheet-scope',
      'modifyHp sheet scope sheetKind must be pokemon or trainer.',
      EXPECTED_SHEET_KIND,
      sheetResource.sheetKind,
    )
  }

  if (!isNonEmptyString(sheetResource.sheetSlug)) {
    addIssue(
      issues,
      `${path}.resource.sheetSlug`,
      'invalid-sheet-scope',
      'modifyHp sheet scope sheetSlug must be a non-empty string.',
      EXPECTED_NON_EMPTY_STRING,
      sheetResource.sheetSlug,
    )
  }

  if (issues.some((issue) => issue.path.startsWith(path))) return undefined

  return cloneSheetResource(scope.resource as SessionSheetResourceRef)
}

const findModifyHpResources = (
  command: ModifyHpCommand,
  payload: ModifyHpCommandPayload | undefined,
  issues: MutableIssueList,
): {
  readonly tokenResource?: SessionTokenResourceRef
  readonly sheetResource?: SessionSheetResourceRef
} => {
  if (payload === undefined) return {}

  const tokenScopeResources = command.scopes.map((scope, index) => ({
    index,
    scope,
    resource: tokenResourceFromScope(scope, `scopes[${index}]`, issues),
  }))
  const matchingTokenScope = tokenScopeResources.find(({ scope, resource }) =>
    resource !== undefined &&
    scope.lane === 'token' &&
    scope.field === MODIFY_HP_COMMAND_SCOPE_FIELD &&
    resource.tokenId === payload.tokenId,
  )

  if (matchingTokenScope?.resource === undefined) {
    addIssue(
      issues,
      'scopes',
      'invalid-token-scope',
      'modifyHp commands must include a token scope with resource.kind "token", field "hp", and a tokenId matching payload.tokenId.',
      'matching token hp scope',
      command.scopes,
    )
  } else if (
    hasOwn(matchingTokenScope.scope, 'mapSlug') &&
    typeof matchingTokenScope.scope.mapSlug === 'string' &&
    matchingTokenScope.scope.mapSlug.trim().length === 0
  ) {
    addIssue(
      issues,
      `scopes[${matchingTokenScope.index}].mapSlug`,
      'invalid-token-scope',
      'modifyHp token scope mapSlug must be a non-empty string when provided.',
      EXPECTED_NON_EMPTY_STRING,
      matchingTokenScope.scope.mapSlug,
    )
  }

  const matchingSheetScope = command.scopes
    .map((scope, index) => ({
      index,
      scope,
      resource: sheetResourceFromScope(scope, `scopes[${index}]`, issues),
    }))
    .find(({ scope, resource }) =>
      resource !== undefined &&
      scope.lane === 'sheet' &&
      scope.field === MODIFY_HP_COMMAND_SCOPE_FIELD,
    )

  const tokenResource = matchingTokenScope?.resource
  const sheetResource = matchingSheetScope?.resource
  if (
    tokenResource !== undefined &&
    sheetResource !== undefined &&
    (
      (tokenResource.sheetKind !== undefined && tokenResource.sheetKind !== sheetResource.sheetKind) ||
      (tokenResource.sheetSlug !== undefined && tokenResource.sheetSlug !== sheetResource.sheetSlug)
    )
  ) {
    addIssue(
      issues,
      'scopes',
      'invalid-sheet-scope',
      'modifyHp sheet scope must match the token scope sheet identity when both are provided.',
      'matching token and sheet resource identity',
      command.scopes,
    )
  }

  return {
    ...(tokenResource === undefined ? {} : { tokenResource: cloneTokenResource(tokenResource) }),
    ...(sheetResource === undefined ? {} : { sheetResource: cloneSheetResource(sheetResource) }),
  }
}

export const validateModifyHpCommand = <
  TActor extends SessionActor = SessionActor,
>(
  value: unknown,
  context: ModifyHpCommandValidationContext = {},
): ModifyHpCommandValidationResult<TActor> => {
  const envelopeResult = validateSessionCommandEnvelope<ModifyHpCommand<TActor>>(value)
  if (!envelopeResult.valid) {
    return { valid: false, issues: envelopeResult.issues }
  }

  const command = envelopeResult.command
  const issues: MutableIssueList = []

  if (command.type !== MODIFY_HP_COMMAND_TYPE) {
    addIssue(
      issues,
      'type',
      'invalid-command-type',
      'modifyHp validators only accept command envelopes with type "modifyHp".',
      MODIFY_HP_COMMAND_TYPE,
      command.type,
    )
  }

  const payload = collectModifyHpPayloadIssues(command.payload, issues)
  const { tokenResource, sheetResource } = findModifyHpResources(command, payload, issues)

  let permission: PermissionResult | undefined
  let permittedResource: SessionTokenResourceRef | SessionSheetResourceRef | undefined
  if (tokenResource !== undefined) {
    const tokenPermission = canActorControlResource(command.actor, context.assignments ?? [], tokenResource)
    if (tokenPermission.allowed) {
      permission = tokenPermission
      permittedResource = tokenResource
    } else if (sheetResource !== undefined) {
      const sheetPermission = canActorControlResource(command.actor, context.assignments ?? [], sheetResource)
      if (sheetPermission.allowed) {
        permission = sheetPermission
        permittedResource = sheetResource
      } else {
        permission = tokenPermission
      }
    } else {
      permission = tokenPermission
    }

    if (permission !== undefined && !permission.allowed) {
      addIssue(
        issues,
        'actor',
        'permission-denied',
        permission.message,
        'GM actor, assigned visible token resource, or assigned visible sheet resource',
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
    payload: payload as ModifyHpCommandPayload,
    resource: tokenResource as SessionTokenResourceRef,
    tokenResource: tokenResource as SessionTokenResourceRef,
    ...(sheetResource === undefined ? {} : { sheetResource }),
    permittedResource: permittedResource as SessionTokenResourceRef | SessionSheetResourceRef,
    permission: permission as Extract<PermissionResult, { readonly allowed: true }>,
    issues: [],
  }
}

export const assertValidModifyHpCommand = <
  TActor extends SessionActor = SessionActor,
>(
  value: unknown,
  context: ModifyHpCommandValidationContext = {},
  label = 'modifyHp command',
): ModifyHpCommand<TActor> => {
  const result = validateModifyHpCommand<TActor>(value, context)
  if (result.valid) return result.command

  const summary = result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')
  throw new Error(`${label} is invalid: ${summary}`)
}

const isCombatStageValue = (value: unknown): value is number =>
  isSafeInteger(value) && value >= -6 && value <= 6

const cloneCombatStages = (stages: SessionCombatStageMap): SessionCombatStageMap => ({
  atk: stages.atk,
  def: stages.def,
  satk: stages.satk,
  sdef: stages.sdef,
  spd: stages.spd,
  acc: stages.acc,
})

const cloneModifyCombatStagesPayload = (
  payload: ModifyCombatStagesCommandPayload,
): ModifyCombatStagesCommandPayload => ({
  tokenId: payload.tokenId,
  stages: cloneCombatStages(payload.stages),
})

export const isModifyCombatStagesCommandValidationCode = (
  value: unknown,
): value is ModifyCombatStagesCommandValidationCode =>
  (MODIFY_COMBAT_STAGES_COMMAND_VALIDATION_CODES as readonly unknown[]).includes(value)

export const createModifyCombatStagesTokenCommandScope = (
  resource: SessionTokenResourceRef,
): SessionCommandScope => ({
  lane: 'token',
  resource: cloneTokenResource(resource),
  field: MODIFY_COMBAT_STAGES_COMMAND_SCOPE_FIELD,
  ...(resource.mapSlug === undefined ? {} : { mapSlug: resource.mapSlug }),
})

export const createModifyCombatStagesSheetCommandScope = (
  resource: SessionSheetResourceRef,
): SessionCommandScope => ({
  lane: 'sheet',
  resource: cloneSheetResource(resource),
  field: MODIFY_COMBAT_STAGES_COMMAND_SCOPE_FIELD,
})

const collectModifyCombatStagesPayloadIssues = (
  payload: unknown,
  issues: MutableIssueList,
): ModifyCombatStagesCommandPayload | undefined => {
  if (!isRecord(payload)) {
    addIssue(
      issues,
      'payload',
      'invalid-payload',
      'modifyCombatStages payload must be an object.',
      EXPECTED_OBJECT,
      payload,
    )
    return undefined
  }

  const tokenId = payload.tokenId
  const stages = payload.stages

  if (!isNonEmptyString(tokenId)) {
    addIssue(
      issues,
      'payload.tokenId',
      'invalid-token-id',
      'modifyCombatStages payload.tokenId must be a non-empty token ID string.',
      EXPECTED_NON_EMPTY_STRING,
      tokenId,
    )
  }

  if (!isRecord(stages)) {
    addIssue(
      issues,
      'payload.stages',
      'invalid-stages',
      'modifyCombatStages payload.stages must be an object containing atk/def/satk/sdef/spd/acc.',
      'combat stage object',
      stages,
    )
  } else {
    for (const key of SESSION_COMBAT_STAGE_KEYS) {
      if (!isCombatStageValue(stages[key])) {
        addIssue(
          issues,
          `payload.stages.${key}`,
          'invalid-stages',
          `modifyCombatStages payload.stages.${key} must be a safe integer from -6 to 6.`,
          'safe integer from -6 to 6',
          stages[key],
        )
      }
    }
  }

  if (issues.some((issue) => issue.path.startsWith('payload.'))) {
    return undefined
  }

  return cloneModifyCombatStagesPayload({
    tokenId: tokenId as string,
    stages: {
      atk: (stages as UnknownRecord).atk as number,
      def: (stages as UnknownRecord).def as number,
      satk: (stages as UnknownRecord).satk as number,
      sdef: (stages as UnknownRecord).sdef as number,
      spd: (stages as UnknownRecord).spd as number,
      acc: (stages as UnknownRecord).acc as number,
    },
  })
}

const combatStagesTokenResourceFromScope = (
  scope: SessionCommandScope,
  path: string,
  issues: MutableIssueList,
): SessionTokenResourceRef | undefined => {
  if (scope.resource?.kind !== 'token') return undefined

  const tokenResource = scope.resource
  if (hasOwn(tokenResource, 'sheetKind') && tokenResource.sheetKind !== undefined && !isSheetKind(tokenResource.sheetKind)) {
    addIssue(
      issues,
      `${path}.resource.sheetKind`,
      'invalid-token-scope',
      'modifyCombatStages token scope sheetKind must be pokemon or trainer when provided.',
      EXPECTED_SHEET_KIND,
      tokenResource.sheetKind,
    )
  }

  if (hasOwn(tokenResource, 'sheetSlug') && tokenResource.sheetSlug !== undefined && !isNonEmptyString(tokenResource.sheetSlug)) {
    addIssue(
      issues,
      `${path}.resource.sheetSlug`,
      'invalid-token-scope',
      'modifyCombatStages token scope sheetSlug must be a non-empty string when provided.',
      EXPECTED_NON_EMPTY_STRING,
      tokenResource.sheetSlug,
    )
  }

  if (hasOwn(tokenResource, 'mapSlug') && tokenResource.mapSlug !== undefined && !isNonEmptyString(tokenResource.mapSlug)) {
    addIssue(
      issues,
      `${path}.resource.mapSlug`,
      'invalid-token-scope',
      'modifyCombatStages token scope mapSlug must be a non-empty string when provided.',
      EXPECTED_NON_EMPTY_STRING,
      tokenResource.mapSlug,
    )
  }

  if (hasOwn(tokenResource, 'mapSlug') && hasOwn(scope, 'mapSlug') && tokenResource.mapSlug !== scope.mapSlug) {
    addIssue(
      issues,
      `${path}.mapSlug`,
      'invalid-token-scope',
      'modifyCombatStages token scope mapSlug must match the token resource mapSlug when both are provided.',
      'matching token scope map slug',
      scope.mapSlug,
    )
  }

  return {
    ...tokenResource,
    ...(tokenResource.mapSlug === undefined && typeof scope.mapSlug === 'string'
      ? { mapSlug: scope.mapSlug }
      : {}),
  }
}

const combatStagesSheetResourceFromScope = (
  scope: SessionCommandScope,
  path: string,
  issues: MutableIssueList,
): SessionSheetResourceRef | undefined => {
  if (scope.resource?.kind !== 'sheet') return undefined

  const sheetResource = scope.resource as unknown as UnknownRecord
  if (!isSheetKind(sheetResource.sheetKind)) {
    addIssue(
      issues,
      `${path}.resource.sheetKind`,
      'invalid-sheet-scope',
      'modifyCombatStages sheet scope sheetKind must be pokemon or trainer.',
      EXPECTED_SHEET_KIND,
      sheetResource.sheetKind,
    )
  }

  if (!isNonEmptyString(sheetResource.sheetSlug)) {
    addIssue(
      issues,
      `${path}.resource.sheetSlug`,
      'invalid-sheet-scope',
      'modifyCombatStages sheet scope sheetSlug must be a non-empty string.',
      EXPECTED_NON_EMPTY_STRING,
      sheetResource.sheetSlug,
    )
  }

  if (issues.some((issue) => issue.path.startsWith(path))) return undefined

  return cloneSheetResource(scope.resource as SessionSheetResourceRef)
}

const findModifyCombatStagesResources = (
  command: ModifyCombatStagesCommand,
  payload: ModifyCombatStagesCommandPayload | undefined,
  issues: MutableIssueList,
): {
  readonly tokenResource?: SessionTokenResourceRef
  readonly sheetResource?: SessionSheetResourceRef
} => {
  if (payload === undefined) return {}

  const tokenScopeResources = command.scopes.map((scope, index) => ({
    index,
    scope,
    resource: combatStagesTokenResourceFromScope(scope, `scopes[${index}]`, issues),
  }))
  const matchingTokenScope = tokenScopeResources.find(({ scope, resource }) =>
    resource !== undefined &&
    scope.lane === 'token' &&
    scope.field === MODIFY_COMBAT_STAGES_COMMAND_SCOPE_FIELD &&
    resource.tokenId === payload.tokenId,
  )

  if (matchingTokenScope?.resource === undefined) {
    addIssue(
      issues,
      'scopes',
      'invalid-token-scope',
      'modifyCombatStages commands must include a token scope with resource.kind "token", field "combatStages", and a tokenId matching payload.tokenId.',
      'matching token combatStages scope',
      command.scopes,
    )
  } else if (
    hasOwn(matchingTokenScope.scope, 'mapSlug') &&
    typeof matchingTokenScope.scope.mapSlug === 'string' &&
    matchingTokenScope.scope.mapSlug.trim().length === 0
  ) {
    addIssue(
      issues,
      `scopes[${matchingTokenScope.index}].mapSlug`,
      'invalid-token-scope',
      'modifyCombatStages token scope mapSlug must be a non-empty string when provided.',
      EXPECTED_NON_EMPTY_STRING,
      matchingTokenScope.scope.mapSlug,
    )
  }

  const matchingSheetScope = command.scopes
    .map((scope, index) => ({
      index,
      scope,
      resource: combatStagesSheetResourceFromScope(scope, `scopes[${index}]`, issues),
    }))
    .find(({ scope, resource }) =>
      resource !== undefined &&
      scope.lane === 'sheet' &&
      scope.field === MODIFY_COMBAT_STAGES_COMMAND_SCOPE_FIELD,
    )

  const tokenResource = matchingTokenScope?.resource
  const sheetResource = matchingSheetScope?.resource
  if (
    tokenResource !== undefined &&
    sheetResource !== undefined &&
    (
      (tokenResource.sheetKind !== undefined && tokenResource.sheetKind !== sheetResource.sheetKind) ||
      (tokenResource.sheetSlug !== undefined && tokenResource.sheetSlug !== sheetResource.sheetSlug)
    )
  ) {
    addIssue(
      issues,
      'scopes',
      'invalid-sheet-scope',
      'modifyCombatStages sheet scope must match the token scope sheet identity when both are provided.',
      'matching token and sheet resource identity',
      command.scopes,
    )
  }

  return {
    ...(tokenResource === undefined ? {} : { tokenResource: cloneTokenResource(tokenResource) }),
    ...(sheetResource === undefined ? {} : { sheetResource: cloneSheetResource(sheetResource) }),
  }
}

export const validateModifyCombatStagesCommand = <
  TActor extends SessionActor = SessionActor,
>(
  value: unknown,
  context: ModifyCombatStagesCommandValidationContext = {},
): ModifyCombatStagesCommandValidationResult<TActor> => {
  const envelopeResult = validateSessionCommandEnvelope<ModifyCombatStagesCommand<TActor>>(value)
  if (!envelopeResult.valid) {
    return { valid: false, issues: envelopeResult.issues }
  }

  const command = envelopeResult.command
  const issues: MutableIssueList = []

  if (command.type !== MODIFY_COMBAT_STAGES_COMMAND_TYPE) {
    addIssue(
      issues,
      'type',
      'invalid-command-type',
      'modifyCombatStages validators only accept command envelopes with type "modifyCombatStages".',
      MODIFY_COMBAT_STAGES_COMMAND_TYPE,
      command.type,
    )
  }

  const payload = collectModifyCombatStagesPayloadIssues(command.payload, issues)
  const { tokenResource, sheetResource } = findModifyCombatStagesResources(command, payload, issues)

  let permission: PermissionResult | undefined
  let permittedResource: SessionTokenResourceRef | SessionSheetResourceRef | undefined
  if (tokenResource !== undefined) {
    const tokenPermission = canActorControlResource(command.actor, context.assignments ?? [], tokenResource)
    if (tokenPermission.allowed) {
      permission = tokenPermission
      permittedResource = tokenResource
    } else if (sheetResource !== undefined) {
      const sheetPermission = canActorControlResource(command.actor, context.assignments ?? [], sheetResource)
      if (sheetPermission.allowed) {
        permission = sheetPermission
        permittedResource = sheetResource
      } else {
        permission = tokenPermission
      }
    } else {
      permission = tokenPermission
    }

    if (permission !== undefined && !permission.allowed) {
      addIssue(
        issues,
        'actor',
        'permission-denied',
        permission.message,
        'GM actor, assigned visible token resource, or assigned visible sheet resource',
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
    payload: payload as ModifyCombatStagesCommandPayload,
    resource: tokenResource as SessionTokenResourceRef,
    tokenResource: tokenResource as SessionTokenResourceRef,
    ...(sheetResource === undefined ? {} : { sheetResource }),
    permittedResource: permittedResource as SessionTokenResourceRef | SessionSheetResourceRef,
    permission: permission as Extract<PermissionResult, { readonly allowed: true }>,
    issues: [],
  }
}

export const assertValidModifyCombatStagesCommand = <
  TActor extends SessionActor = SessionActor,
>(
  value: unknown,
  context: ModifyCombatStagesCommandValidationContext = {},
  label = 'modifyCombatStages command',
): ModifyCombatStagesCommand<TActor> => {
  const result = validateModifyCombatStagesCommand<TActor>(value, context)
  if (result.valid) return result.command

  const summary = result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')
  throw new Error(`${label} is invalid: ${summary}`)
}

const isModifyConditionsAction = (value: unknown): value is ModifyConditionsAction =>
  (MODIFY_CONDITIONS_ACTIONS as readonly unknown[]).includes(value)

const cloneConditionList = (conditions: readonly string[]): string[] =>
  conditions.map((condition) => condition.trim())

const cloneModifyConditionsPayload = (
  payload: ModifyConditionsCommandPayload,
): ModifyConditionsCommandPayload => ({
  tokenId: payload.tokenId,
  action: payload.action,
  conditions: cloneConditionList(payload.conditions),
})

export const isModifyConditionsCommandValidationCode = (
  value: unknown,
): value is ModifyConditionsCommandValidationCode =>
  (MODIFY_CONDITIONS_COMMAND_VALIDATION_CODES as readonly unknown[]).includes(value)

export const createModifyConditionsTokenCommandScope = (
  resource: SessionTokenResourceRef,
): SessionCommandScope => ({
  lane: 'token',
  resource: cloneTokenResource(resource),
  field: MODIFY_CONDITIONS_COMMAND_SCOPE_FIELD,
  ...(resource.mapSlug === undefined ? {} : { mapSlug: resource.mapSlug }),
})

export const createModifyConditionsSheetCommandScope = (
  resource: SessionSheetResourceRef,
): SessionCommandScope => ({
  lane: 'sheet',
  resource: cloneSheetResource(resource),
  field: MODIFY_CONDITIONS_COMMAND_SCOPE_FIELD,
})

const collectModifyConditionsPayloadIssues = (
  payload: unknown,
  issues: MutableIssueList,
): ModifyConditionsCommandPayload | undefined => {
  if (!isRecord(payload)) {
    addIssue(
      issues,
      'payload',
      'invalid-payload',
      'modifyConditions payload must be an object.',
      EXPECTED_OBJECT,
      payload,
    )
    return undefined
  }

  const tokenId = payload.tokenId
  const action = payload.action
  const conditions = payload.conditions

  if (!isNonEmptyString(tokenId)) {
    addIssue(
      issues,
      'payload.tokenId',
      'invalid-token-id',
      'modifyConditions payload.tokenId must be a non-empty token ID string.',
      EXPECTED_NON_EMPTY_STRING,
      tokenId,
    )
  }

  if (!isModifyConditionsAction(action)) {
    addIssue(
      issues,
      'payload.action',
      'invalid-action',
      'modifyConditions payload.action must be add, remove, or replace.',
      EXPECTED_CONDITION_ACTION,
      action,
    )
  }

  if (!Array.isArray(conditions)) {
    addIssue(
      issues,
      'payload.conditions',
      'invalid-conditions',
      'modifyConditions payload.conditions must be an array of condition names.',
      EXPECTED_CONDITION_LIST,
      conditions,
    )
  } else {
    conditions.forEach((condition, index) => {
      if (!isNonEmptyString(condition)) {
        addIssue(
          issues,
          `payload.conditions[${index}]`,
          'invalid-conditions',
          'modifyConditions condition entries must be non-empty strings.',
          EXPECTED_NON_EMPTY_STRING,
          condition,
        )
      }
    })

    if (isModifyConditionsAction(action) && action !== 'replace' && conditions.length === 0) {
      addIssue(
        issues,
        'payload.conditions',
        'invalid-conditions',
        'modifyConditions add/remove actions require at least one condition entry.',
        'non-empty condition list for add/remove',
        conditions,
      )
    }
  }

  if (issues.some((issue) => issue.path.startsWith('payload.'))) {
    return undefined
  }

  return cloneModifyConditionsPayload({
    tokenId: tokenId as string,
    action: action as ModifyConditionsAction,
    conditions: conditions as string[],
  })
}

const conditionsTokenResourceFromScope = (
  scope: SessionCommandScope,
  path: string,
  issues: MutableIssueList,
): SessionTokenResourceRef | undefined => {
  if (scope.resource?.kind !== 'token') return undefined

  const tokenResource = scope.resource
  if (hasOwn(tokenResource, 'sheetKind') && tokenResource.sheetKind !== undefined && !isSheetKind(tokenResource.sheetKind)) {
    addIssue(
      issues,
      `${path}.resource.sheetKind`,
      'invalid-token-scope',
      'modifyConditions token scope sheetKind must be pokemon or trainer when provided.',
      EXPECTED_SHEET_KIND,
      tokenResource.sheetKind,
    )
  }

  if (hasOwn(tokenResource, 'sheetSlug') && tokenResource.sheetSlug !== undefined && !isNonEmptyString(tokenResource.sheetSlug)) {
    addIssue(
      issues,
      `${path}.resource.sheetSlug`,
      'invalid-token-scope',
      'modifyConditions token scope sheetSlug must be a non-empty string when provided.',
      EXPECTED_NON_EMPTY_STRING,
      tokenResource.sheetSlug,
    )
  }

  if (hasOwn(tokenResource, 'mapSlug') && tokenResource.mapSlug !== undefined && !isNonEmptyString(tokenResource.mapSlug)) {
    addIssue(
      issues,
      `${path}.resource.mapSlug`,
      'invalid-token-scope',
      'modifyConditions token scope mapSlug must be a non-empty string when provided.',
      EXPECTED_NON_EMPTY_STRING,
      tokenResource.mapSlug,
    )
  }

  if (hasOwn(tokenResource, 'mapSlug') && hasOwn(scope, 'mapSlug') && tokenResource.mapSlug !== scope.mapSlug) {
    addIssue(
      issues,
      `${path}.mapSlug`,
      'invalid-token-scope',
      'modifyConditions token scope mapSlug must match the token resource mapSlug when both are provided.',
      'matching token scope map slug',
      scope.mapSlug,
    )
  }

  return {
    ...tokenResource,
    ...(tokenResource.mapSlug === undefined && typeof scope.mapSlug === 'string'
      ? { mapSlug: scope.mapSlug }
      : {}),
  }
}

const conditionsSheetResourceFromScope = (
  scope: SessionCommandScope,
  path: string,
  issues: MutableIssueList,
): SessionSheetResourceRef | undefined => {
  if (scope.resource?.kind !== 'sheet') return undefined

  const sheetResource = scope.resource as unknown as UnknownRecord
  if (!isSheetKind(sheetResource.sheetKind)) {
    addIssue(
      issues,
      `${path}.resource.sheetKind`,
      'invalid-sheet-scope',
      'modifyConditions sheet scope sheetKind must be pokemon or trainer.',
      EXPECTED_SHEET_KIND,
      sheetResource.sheetKind,
    )
  }

  if (!isNonEmptyString(sheetResource.sheetSlug)) {
    addIssue(
      issues,
      `${path}.resource.sheetSlug`,
      'invalid-sheet-scope',
      'modifyConditions sheet scope sheetSlug must be a non-empty string.',
      EXPECTED_NON_EMPTY_STRING,
      sheetResource.sheetSlug,
    )
  }

  if (issues.some((issue) => issue.path.startsWith(path))) return undefined

  return cloneSheetResource(scope.resource as SessionSheetResourceRef)
}

const findModifyConditionsResources = (
  command: ModifyConditionsCommand,
  payload: ModifyConditionsCommandPayload | undefined,
  issues: MutableIssueList,
): {
  readonly tokenResource?: SessionTokenResourceRef
  readonly sheetResource?: SessionSheetResourceRef
} => {
  if (payload === undefined) return {}

  const tokenScopeResources = command.scopes.map((scope, index) => ({
    index,
    scope,
    resource: conditionsTokenResourceFromScope(scope, `scopes[${index}]`, issues),
  }))
  const matchingTokenScope = tokenScopeResources.find(({ scope, resource }) =>
    resource !== undefined &&
    scope.lane === 'token' &&
    scope.field === MODIFY_CONDITIONS_COMMAND_SCOPE_FIELD &&
    resource.tokenId === payload.tokenId,
  )

  if (matchingTokenScope?.resource === undefined) {
    addIssue(
      issues,
      'scopes',
      'invalid-token-scope',
      'modifyConditions commands must include a token scope with resource.kind "token", field "conditions", and a tokenId matching payload.tokenId.',
      'matching token conditions scope',
      command.scopes,
    )
  } else if (
    hasOwn(matchingTokenScope.scope, 'mapSlug') &&
    typeof matchingTokenScope.scope.mapSlug === 'string' &&
    matchingTokenScope.scope.mapSlug.trim().length === 0
  ) {
    addIssue(
      issues,
      `scopes[${matchingTokenScope.index}].mapSlug`,
      'invalid-token-scope',
      'modifyConditions token scope mapSlug must be a non-empty string when provided.',
      EXPECTED_NON_EMPTY_STRING,
      matchingTokenScope.scope.mapSlug,
    )
  }

  const matchingSheetScope = command.scopes
    .map((scope, index) => ({
      index,
      scope,
      resource: conditionsSheetResourceFromScope(scope, `scopes[${index}]`, issues),
    }))
    .find(({ scope, resource }) =>
      resource !== undefined &&
      scope.lane === 'sheet' &&
      scope.field === MODIFY_CONDITIONS_COMMAND_SCOPE_FIELD,
    )

  const tokenResource = matchingTokenScope?.resource
  const sheetResource = matchingSheetScope?.resource
  if (
    tokenResource !== undefined &&
    sheetResource !== undefined &&
    (
      (tokenResource.sheetKind !== undefined && tokenResource.sheetKind !== sheetResource.sheetKind) ||
      (tokenResource.sheetSlug !== undefined && tokenResource.sheetSlug !== sheetResource.sheetSlug)
    )
  ) {
    addIssue(
      issues,
      'scopes',
      'invalid-sheet-scope',
      'modifyConditions sheet scope must match the token scope sheet identity when both are provided.',
      'matching token and sheet resource identity',
      command.scopes,
    )
  }

  return {
    ...(tokenResource === undefined ? {} : { tokenResource: cloneTokenResource(tokenResource) }),
    ...(sheetResource === undefined ? {} : { sheetResource: cloneSheetResource(sheetResource) }),
  }
}

export const validateModifyConditionsCommand = <
  TActor extends SessionActor = SessionActor,
>(
  value: unknown,
  context: ModifyConditionsCommandValidationContext = {},
): ModifyConditionsCommandValidationResult<TActor> => {
  const envelopeResult = validateSessionCommandEnvelope<ModifyConditionsCommand<TActor>>(value)
  if (!envelopeResult.valid) {
    return { valid: false, issues: envelopeResult.issues }
  }

  const command = envelopeResult.command
  const issues: MutableIssueList = []

  if (command.type !== MODIFY_CONDITIONS_COMMAND_TYPE) {
    addIssue(
      issues,
      'type',
      'invalid-command-type',
      'modifyConditions validators only accept command envelopes with type "modifyConditions".',
      MODIFY_CONDITIONS_COMMAND_TYPE,
      command.type,
    )
  }

  const payload = collectModifyConditionsPayloadIssues(command.payload, issues)
  const { tokenResource, sheetResource } = findModifyConditionsResources(command, payload, issues)

  let permission: PermissionResult | undefined
  let permittedResource: SessionTokenResourceRef | SessionSheetResourceRef | undefined
  if (tokenResource !== undefined) {
    const tokenPermission = canActorControlResource(command.actor, context.assignments ?? [], tokenResource)
    if (tokenPermission.allowed) {
      permission = tokenPermission
      permittedResource = tokenResource
    } else if (sheetResource !== undefined) {
      const sheetPermission = canActorControlResource(command.actor, context.assignments ?? [], sheetResource)
      if (sheetPermission.allowed) {
        permission = sheetPermission
        permittedResource = sheetResource
      } else {
        permission = tokenPermission
      }
    } else {
      permission = tokenPermission
    }

    if (permission !== undefined && !permission.allowed) {
      addIssue(
        issues,
        'actor',
        'permission-denied',
        permission.message,
        'GM actor, assigned visible token resource, or assigned visible sheet resource',
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
    payload: payload as ModifyConditionsCommandPayload,
    resource: tokenResource as SessionTokenResourceRef,
    tokenResource: tokenResource as SessionTokenResourceRef,
    ...(sheetResource === undefined ? {} : { sheetResource }),
    permittedResource: permittedResource as SessionTokenResourceRef | SessionSheetResourceRef,
    permission: permission as Extract<PermissionResult, { readonly allowed: true }>,
    issues: [],
  }
}

export const assertValidModifyConditionsCommand = <
  TActor extends SessionActor = SessionActor,
>(
  value: unknown,
  context: ModifyConditionsCommandValidationContext = {},
  label = 'modifyConditions command',
): ModifyConditionsCommand<TActor> => {
  const result = validateModifyConditionsCommand<TActor>(value, context)
  if (result.valid) return result.command

  const summary = result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')
  throw new Error(`${label} is invalid: ${summary}`)
}

const cloneUseMovePayload = (payload: UseMoveCommandPayload): UseMoveCommandPayload => ({
  tokenId: payload.tokenId,
  moveName: payload.moveName,
})

export const isUseMoveCommandValidationCode = (
  value: unknown,
): value is UseMoveCommandValidationCode =>
  (USE_MOVE_COMMAND_VALIDATION_CODES as readonly unknown[]).includes(value)

export const createUseMoveTokenCommandScope = (
  resource: SessionTokenResourceRef,
): SessionCommandScope => ({
  lane: 'token',
  resource: cloneTokenResource(resource),
  field: USE_MOVE_COMMAND_SCOPE_FIELD,
  ...(resource.mapSlug === undefined ? {} : { mapSlug: resource.mapSlug }),
})

export const createUseMoveSheetCommandScope = (
  resource: SessionSheetResourceRef,
): SessionCommandScope => ({
  lane: 'sheet',
  resource: cloneSheetResource(resource),
  field: USE_MOVE_COMMAND_SCOPE_FIELD,
})

const collectUseMovePayloadIssues = (
  payload: unknown,
  issues: MutableIssueList,
): UseMoveCommandPayload | undefined => {
  if (!isRecord(payload)) {
    addIssue(
      issues,
      'payload',
      'invalid-payload',
      'useMove payload must be an object.',
      EXPECTED_OBJECT,
      payload,
    )
    return undefined
  }

  const tokenId = payload.tokenId
  const moveName = payload.moveName

  if (!isNonEmptyString(tokenId)) {
    addIssue(
      issues,
      'payload.tokenId',
      'invalid-token-id',
      'useMove payload.tokenId must be a non-empty token ID string.',
      EXPECTED_NON_EMPTY_STRING,
      tokenId,
    )
  }

  if (!isNonEmptyString(moveName)) {
    addIssue(
      issues,
      'payload.moveName',
      'invalid-move-name',
      'useMove payload.moveName must be a non-empty move name string.',
      EXPECTED_NON_EMPTY_STRING,
      moveName,
    )
  }

  if (issues.some((issue) => issue.path.startsWith('payload.'))) {
    return undefined
  }

  return cloneUseMovePayload({
    tokenId: (tokenId as string).trim(),
    moveName: (moveName as string).trim(),
  })
}

const useMoveTokenResourceFromScope = (
  scope: SessionCommandScope,
  path: string,
  issues: MutableIssueList,
): SessionTokenResourceRef | undefined => {
  if (scope.resource?.kind !== 'token') return undefined

  const tokenResource = scope.resource
  if (hasOwn(tokenResource, 'sheetKind') && tokenResource.sheetKind !== undefined && !isSheetKind(tokenResource.sheetKind)) {
    addIssue(
      issues,
      `${path}.resource.sheetKind`,
      'invalid-token-scope',
      'useMove token scope sheetKind must be pokemon or trainer when provided.',
      EXPECTED_SHEET_KIND,
      tokenResource.sheetKind,
    )
  }

  if (hasOwn(tokenResource, 'sheetSlug') && tokenResource.sheetSlug !== undefined && !isNonEmptyString(tokenResource.sheetSlug)) {
    addIssue(
      issues,
      `${path}.resource.sheetSlug`,
      'invalid-token-scope',
      'useMove token scope sheetSlug must be a non-empty string when provided.',
      EXPECTED_NON_EMPTY_STRING,
      tokenResource.sheetSlug,
    )
  }

  if (hasOwn(tokenResource, 'mapSlug') && tokenResource.mapSlug !== undefined && !isNonEmptyString(tokenResource.mapSlug)) {
    addIssue(
      issues,
      `${path}.resource.mapSlug`,
      'invalid-token-scope',
      'useMove token scope mapSlug must be a non-empty string when provided.',
      EXPECTED_NON_EMPTY_STRING,
      tokenResource.mapSlug,
    )
  }

  if (hasOwn(tokenResource, 'mapSlug') && hasOwn(scope, 'mapSlug') && tokenResource.mapSlug !== scope.mapSlug) {
    addIssue(
      issues,
      `${path}.mapSlug`,
      'invalid-token-scope',
      'useMove token scope mapSlug must match the token resource mapSlug when both are provided.',
      'matching token scope map slug',
      scope.mapSlug,
    )
  }

  return {
    ...tokenResource,
    ...(tokenResource.mapSlug === undefined && typeof scope.mapSlug === 'string'
      ? { mapSlug: scope.mapSlug }
      : {}),
  }
}

const useMoveSheetResourceFromScope = (
  scope: SessionCommandScope,
  path: string,
  issues: MutableIssueList,
): SessionSheetResourceRef | undefined => {
  if (scope.resource?.kind !== 'sheet') return undefined

  const sheetResource = scope.resource as unknown as UnknownRecord
  if (!isSheetKind(sheetResource.sheetKind)) {
    addIssue(
      issues,
      `${path}.resource.sheetKind`,
      'invalid-sheet-scope',
      'useMove sheet scope sheetKind must be pokemon or trainer.',
      EXPECTED_SHEET_KIND,
      sheetResource.sheetKind,
    )
  }

  if (!isNonEmptyString(sheetResource.sheetSlug)) {
    addIssue(
      issues,
      `${path}.resource.sheetSlug`,
      'invalid-sheet-scope',
      'useMove sheet scope sheetSlug must be a non-empty string.',
      EXPECTED_NON_EMPTY_STRING,
      sheetResource.sheetSlug,
    )
  }

  if (issues.some((issue) => issue.path.startsWith(path))) return undefined

  return cloneSheetResource(scope.resource as SessionSheetResourceRef)
}

const findUseMoveResources = (
  command: UseMoveCommand,
  payload: UseMoveCommandPayload | undefined,
  issues: MutableIssueList,
): {
  readonly tokenResource?: SessionTokenResourceRef
  readonly sheetResource?: SessionSheetResourceRef
} => {
  if (payload === undefined) return {}

  const tokenScopeResources = command.scopes.map((scope, index) => ({
    index,
    scope,
    resource: useMoveTokenResourceFromScope(scope, `scopes[${index}]`, issues),
  }))
  const matchingTokenScope = tokenScopeResources.find(({ scope, resource }) =>
    resource !== undefined &&
    scope.lane === 'token' &&
    scope.field === USE_MOVE_COMMAND_SCOPE_FIELD &&
    resource.tokenId === payload.tokenId,
  )

  if (matchingTokenScope?.resource === undefined) {
    addIssue(
      issues,
      'scopes',
      'invalid-token-scope',
      'useMove commands must include a token scope with resource.kind "token", field "moveUsage", and a tokenId matching payload.tokenId.',
      'matching token moveUsage scope',
      command.scopes,
    )
  } else if (
    hasOwn(matchingTokenScope.scope, 'mapSlug') &&
    typeof matchingTokenScope.scope.mapSlug === 'string' &&
    matchingTokenScope.scope.mapSlug.trim().length === 0
  ) {
    addIssue(
      issues,
      `scopes[${matchingTokenScope.index}].mapSlug`,
      'invalid-token-scope',
      'useMove token scope mapSlug must be a non-empty string when provided.',
      EXPECTED_NON_EMPTY_STRING,
      matchingTokenScope.scope.mapSlug,
    )
  }

  const matchingSheetScope = command.scopes
    .map((scope, index) => ({
      index,
      scope,
      resource: useMoveSheetResourceFromScope(scope, `scopes[${index}]`, issues),
    }))
    .find(({ scope, resource }) =>
      resource !== undefined &&
      scope.lane === 'sheet' &&
      scope.field === USE_MOVE_COMMAND_SCOPE_FIELD,
    )

  const tokenResource = matchingTokenScope?.resource
  const sheetResource = matchingSheetScope?.resource
  if (
    tokenResource !== undefined &&
    sheetResource !== undefined &&
    (
      (tokenResource.sheetKind !== undefined && tokenResource.sheetKind !== sheetResource.sheetKind) ||
      (tokenResource.sheetSlug !== undefined && tokenResource.sheetSlug !== sheetResource.sheetSlug)
    )
  ) {
    addIssue(
      issues,
      'scopes',
      'invalid-sheet-scope',
      'useMove sheet scope must match the token scope sheet identity when both are provided.',
      'matching token and sheet resource identity',
      command.scopes,
    )
  }

  return {
    ...(tokenResource === undefined ? {} : { tokenResource: cloneTokenResource(tokenResource) }),
    ...(sheetResource === undefined ? {} : { sheetResource: cloneSheetResource(sheetResource) }),
  }
}

export const validateUseMoveCommand = <
  TActor extends SessionActor = SessionActor,
>(
  value: unknown,
  context: UseMoveCommandValidationContext = {},
): UseMoveCommandValidationResult<TActor> => {
  const envelopeResult = validateSessionCommandEnvelope<UseMoveCommand<TActor>>(value)
  if (!envelopeResult.valid) {
    return { valid: false, issues: envelopeResult.issues }
  }

  const command = envelopeResult.command
  const issues: MutableIssueList = []

  if (command.type !== USE_MOVE_COMMAND_TYPE) {
    addIssue(
      issues,
      'type',
      'invalid-command-type',
      'useMove validators only accept command envelopes with type "useMove".',
      USE_MOVE_COMMAND_TYPE,
      command.type,
    )
  }

  const payload = collectUseMovePayloadIssues(command.payload, issues)
  const { tokenResource, sheetResource } = findUseMoveResources(command, payload, issues)

  let permission: PermissionResult | undefined
  let permittedResource: SessionTokenResourceRef | SessionSheetResourceRef | undefined
  if (tokenResource !== undefined) {
    const tokenPermission = canActorControlResource(command.actor, context.assignments ?? [], tokenResource)
    if (tokenPermission.allowed) {
      permission = tokenPermission
      permittedResource = tokenResource
    } else if (sheetResource !== undefined) {
      const sheetPermission = canActorControlResource(command.actor, context.assignments ?? [], sheetResource)
      if (sheetPermission.allowed) {
        permission = sheetPermission
        permittedResource = sheetResource
      } else {
        permission = tokenPermission
      }
    } else {
      permission = tokenPermission
    }

    if (permission !== undefined && !permission.allowed) {
      addIssue(
        issues,
        'actor',
        'permission-denied',
        permission.message,
        'GM actor, assigned visible token resource, or assigned visible sheet resource',
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
    payload: payload as UseMoveCommandPayload,
    resource: tokenResource as SessionTokenResourceRef,
    tokenResource: tokenResource as SessionTokenResourceRef,
    ...(sheetResource === undefined ? {} : { sheetResource }),
    permittedResource: permittedResource as SessionTokenResourceRef | SessionSheetResourceRef,
    permission: permission as Extract<PermissionResult, { readonly allowed: true }>,
    issues: [],
  }
}

export const assertValidUseMoveCommand = <
  TActor extends SessionActor = SessionActor,
>(
  value: unknown,
  context: UseMoveCommandValidationContext = {},
  label = 'useMove command',
): UseMoveCommand<TActor> => {
  const result = validateUseMoveCommand<TActor>(value, context)
  if (result.valid) return result.command

  const summary = result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')
  throw new Error(`${label} is invalid: ${summary}`)
}

type UseTableActionPayload =
  | UseManeuverCommandPayload
  | UseAbilityCommandPayload
  | UseOrderCommandPayload

type UseTableActionCommand<TActor extends SessionActor = SessionActor> =
  | UseManeuverCommand<TActor>
  | UseAbilityCommand<TActor>
  | UseOrderCommand<TActor>

type UseTableActionNameField = 'maneuverName' | 'abilityName' | 'orderName'

type UseTableActionInvalidNameCode =
  | 'invalid-maneuver-name'
  | 'invalid-ability-name'
  | 'invalid-order-name'

type UseTableActionCommandType =
  | typeof USE_MANEUVER_COMMAND_TYPE
  | typeof USE_ABILITY_COMMAND_TYPE
  | typeof USE_ORDER_COMMAND_TYPE

type UseTableActionScopeField =
  | typeof USE_MANEUVER_COMMAND_SCOPE_FIELD
  | typeof USE_ABILITY_COMMAND_SCOPE_FIELD
  | typeof USE_ORDER_COMMAND_SCOPE_FIELD

interface UseTableActionSpec {
  readonly commandType: UseTableActionCommandType
  readonly scopeField: UseTableActionScopeField
  readonly nameField: UseTableActionNameField
  readonly invalidNameCode: UseTableActionInvalidNameCode
  readonly label: 'useManeuver' | 'useAbility' | 'useOrder'
  readonly noun: 'maneuver' | 'ability' | 'order'
}

const USE_MANEUVER_SPEC: UseTableActionSpec = {
  commandType: USE_MANEUVER_COMMAND_TYPE,
  scopeField: USE_MANEUVER_COMMAND_SCOPE_FIELD,
  nameField: 'maneuverName',
  invalidNameCode: 'invalid-maneuver-name',
  label: 'useManeuver',
  noun: 'maneuver',
}

const USE_ABILITY_SPEC: UseTableActionSpec = {
  commandType: USE_ABILITY_COMMAND_TYPE,
  scopeField: USE_ABILITY_COMMAND_SCOPE_FIELD,
  nameField: 'abilityName',
  invalidNameCode: 'invalid-ability-name',
  label: 'useAbility',
  noun: 'ability',
}

const USE_ORDER_SPEC: UseTableActionSpec = {
  commandType: USE_ORDER_COMMAND_TYPE,
  scopeField: USE_ORDER_COMMAND_SCOPE_FIELD,
  nameField: 'orderName',
  invalidNameCode: 'invalid-order-name',
  label: 'useOrder',
  noun: 'order',
}

const createUseTableActionPayload = (
  spec: UseTableActionSpec,
  tokenId: string,
  actionName: string,
  targetTokenId: string | undefined,
): UseTableActionPayload => {
  const base = {
    tokenId: tokenId.trim(),
    ...(targetTokenId === undefined ? {} : { targetTokenId: targetTokenId.trim() }),
  }

  if (spec.nameField === 'maneuverName') return { ...base, maneuverName: actionName.trim() }
  if (spec.nameField === 'abilityName') return { ...base, abilityName: actionName.trim() }
  return { ...base, orderName: actionName.trim() }
}

const collectUseTableActionPayloadIssues = (
  payload: unknown,
  issues: MutableIssueList,
  spec: UseTableActionSpec,
): UseTableActionPayload | undefined => {
  if (!isRecord(payload)) {
    addIssue(
      issues,
      'payload',
      'invalid-payload',
      `${spec.label} payload must be an object.`,
      EXPECTED_OBJECT,
      payload,
    )
    return undefined
  }

  const tokenId = payload.tokenId
  const actionName = payload[spec.nameField]
  const targetTokenId = payload.targetTokenId

  if (!isNonEmptyString(tokenId)) {
    addIssue(
      issues,
      'payload.tokenId',
      'invalid-token-id',
      `${spec.label} payload.tokenId must be a non-empty token ID string.`,
      EXPECTED_NON_EMPTY_STRING,
      tokenId,
    )
  }

  if (!isNonEmptyString(actionName)) {
    addIssue(
      issues,
      `payload.${spec.nameField}`,
      spec.invalidNameCode,
      `${spec.label} payload.${spec.nameField} must be a non-empty ${spec.noun} name string.`,
      EXPECTED_NON_EMPTY_STRING,
      actionName,
    )
  }

  if (targetTokenId !== undefined && !isNonEmptyString(targetTokenId)) {
    addIssue(
      issues,
      'payload.targetTokenId',
      'invalid-target-token-id',
      `${spec.label} payload.targetTokenId must be a non-empty token ID string when provided.`,
      EXPECTED_NON_EMPTY_STRING,
      targetTokenId,
    )
  }

  if (issues.some((issue) => issue.path.startsWith('payload.'))) return undefined

  return createUseTableActionPayload(
    spec,
    tokenId as string,
    actionName as string,
    targetTokenId as string | undefined,
  )
}

const useTableActionTokenResourceFromScope = (
  scope: SessionCommandScope,
  path: string,
  issues: MutableIssueList,
  spec: UseTableActionSpec,
): SessionTokenResourceRef | undefined => {
  if (scope.resource?.kind !== 'token') return undefined

  const tokenResource = scope.resource
  if (hasOwn(tokenResource, 'sheetKind') && tokenResource.sheetKind !== undefined && !isSheetKind(tokenResource.sheetKind)) {
    addIssue(
      issues,
      `${path}.resource.sheetKind`,
      'invalid-token-scope',
      `${spec.label} token scope sheetKind must be pokemon or trainer when provided.`,
      EXPECTED_SHEET_KIND,
      tokenResource.sheetKind,
    )
  }

  if (hasOwn(tokenResource, 'sheetSlug') && tokenResource.sheetSlug !== undefined && !isNonEmptyString(tokenResource.sheetSlug)) {
    addIssue(
      issues,
      `${path}.resource.sheetSlug`,
      'invalid-token-scope',
      `${spec.label} token scope sheetSlug must be a non-empty string when provided.`,
      EXPECTED_NON_EMPTY_STRING,
      tokenResource.sheetSlug,
    )
  }

  if (hasOwn(tokenResource, 'mapSlug') && tokenResource.mapSlug !== undefined && !isNonEmptyString(tokenResource.mapSlug)) {
    addIssue(
      issues,
      `${path}.resource.mapSlug`,
      'invalid-token-scope',
      `${spec.label} token scope mapSlug must be a non-empty string when provided.`,
      EXPECTED_NON_EMPTY_STRING,
      tokenResource.mapSlug,
    )
  }

  if (hasOwn(tokenResource, 'mapSlug') && hasOwn(scope, 'mapSlug') && tokenResource.mapSlug !== scope.mapSlug) {
    addIssue(
      issues,
      `${path}.mapSlug`,
      'invalid-token-scope',
      `${spec.label} token scope mapSlug must match the token resource mapSlug when both are provided.`,
      'matching token scope map slug',
      scope.mapSlug,
    )
  }

  return {
    ...tokenResource,
    ...(tokenResource.mapSlug === undefined && typeof scope.mapSlug === 'string'
      ? { mapSlug: scope.mapSlug }
      : {}),
  }
}

const useTableActionSheetResourceFromScope = (
  scope: SessionCommandScope,
  path: string,
  issues: MutableIssueList,
  spec: UseTableActionSpec,
): SessionSheetResourceRef | undefined => {
  if (scope.resource?.kind !== 'sheet') return undefined

  const sheetResource = scope.resource as unknown as UnknownRecord
  if (!isSheetKind(sheetResource.sheetKind)) {
    addIssue(
      issues,
      `${path}.resource.sheetKind`,
      'invalid-sheet-scope',
      `${spec.label} sheet scope sheetKind must be pokemon or trainer.`,
      EXPECTED_SHEET_KIND,
      sheetResource.sheetKind,
    )
  }

  if (!isNonEmptyString(sheetResource.sheetSlug)) {
    addIssue(
      issues,
      `${path}.resource.sheetSlug`,
      'invalid-sheet-scope',
      `${spec.label} sheet scope sheetSlug must be a non-empty string.`,
      EXPECTED_NON_EMPTY_STRING,
      sheetResource.sheetSlug,
    )
  }

  if (issues.some((issue) => issue.path.startsWith(path))) return undefined

  return cloneSheetResource(scope.resource as SessionSheetResourceRef)
}

const findUseTableActionResources = (
  command: UseTableActionCommand,
  payload: UseTableActionPayload | undefined,
  issues: MutableIssueList,
  spec: UseTableActionSpec,
): {
  readonly tokenResource?: SessionTokenResourceRef
  readonly sheetResource?: SessionSheetResourceRef
} => {
  if (payload === undefined) return {}

  const tokenScopeResources = command.scopes.map((scope, index) => ({
    index,
    scope,
    resource: useTableActionTokenResourceFromScope(scope, `scopes[${index}]`, issues, spec),
  }))
  const matchingTokenScope = tokenScopeResources.find(({ scope, resource }) =>
    resource !== undefined &&
    scope.lane === 'token' &&
    scope.field === spec.scopeField &&
    resource.tokenId === payload.tokenId,
  )

  if (matchingTokenScope?.resource === undefined) {
    addIssue(
      issues,
      'scopes',
      'invalid-token-scope',
      `${spec.label} commands must include a token scope with resource.kind "token", field "${spec.scopeField}", and a tokenId matching payload.tokenId.`,
      `matching token ${spec.scopeField} scope`,
      command.scopes,
    )
  } else if (
    hasOwn(matchingTokenScope.scope, 'mapSlug') &&
    typeof matchingTokenScope.scope.mapSlug === 'string' &&
    matchingTokenScope.scope.mapSlug.trim().length === 0
  ) {
    addIssue(
      issues,
      `scopes[${matchingTokenScope.index}].mapSlug`,
      'invalid-token-scope',
      `${spec.label} token scope mapSlug must be a non-empty string when provided.`,
      EXPECTED_NON_EMPTY_STRING,
      matchingTokenScope.scope.mapSlug,
    )
  }

  const matchingSheetScope = command.scopes
    .map((scope, index) => ({
      index,
      scope,
      resource: useTableActionSheetResourceFromScope(scope, `scopes[${index}]`, issues, spec),
    }))
    .find(({ scope, resource }) =>
      resource !== undefined &&
      scope.lane === 'sheet' &&
      scope.field === spec.scopeField,
    )

  const tokenResource = matchingTokenScope?.resource
  const sheetResource = matchingSheetScope?.resource
  if (
    tokenResource !== undefined &&
    sheetResource !== undefined &&
    (
      (tokenResource.sheetKind !== undefined && tokenResource.sheetKind !== sheetResource.sheetKind) ||
      (tokenResource.sheetSlug !== undefined && tokenResource.sheetSlug !== sheetResource.sheetSlug)
    )
  ) {
    addIssue(
      issues,
      'scopes',
      'invalid-sheet-scope',
      `${spec.label} sheet scope must match the token scope sheet identity when both are provided.`,
      'matching token and sheet resource identity',
      command.scopes,
    )
  }

  return {
    ...(tokenResource === undefined ? {} : { tokenResource: cloneTokenResource(tokenResource) }),
    ...(sheetResource === undefined ? {} : { sheetResource: cloneSheetResource(sheetResource) }),
  }
}

const validateUseTableActionCommand = <
  TCommand extends UseTableActionCommand<TActor>,
  TPayload extends UseTableActionPayload,
  TResult extends
    | UseManeuverCommandValidationResult<TActor>
    | UseAbilityCommandValidationResult<TActor>
    | UseOrderCommandValidationResult<TActor>,
  TActor extends SessionActor = SessionActor,
>(
  value: unknown,
  context: UseTableActionCommandValidationContext,
  spec: UseTableActionSpec,
): TResult => {
  const envelopeResult = validateSessionCommandEnvelope<TCommand>(value)
  if (!envelopeResult.valid) {
    return { valid: false, issues: envelopeResult.issues } as TResult
  }

  const command = envelopeResult.command
  const issues: MutableIssueList = []

  if (command.type !== spec.commandType) {
    addIssue(
      issues,
      'type',
      'invalid-command-type',
      `${spec.label} validators only accept command envelopes with type "${spec.commandType}".`,
      spec.commandType,
      command.type,
    )
  }

  const payload = collectUseTableActionPayloadIssues(command.payload, issues, spec)
  const { tokenResource, sheetResource } = findUseTableActionResources(command, payload, issues, spec)

  let permission: PermissionResult | undefined
  let permittedResource: SessionTokenResourceRef | SessionSheetResourceRef | undefined
  if (tokenResource !== undefined) {
    const tokenPermission = canActorControlResource(command.actor, context.assignments ?? [], tokenResource)
    if (tokenPermission.allowed) {
      permission = tokenPermission
      permittedResource = tokenResource
    } else if (sheetResource !== undefined) {
      const sheetPermission = canActorControlResource(command.actor, context.assignments ?? [], sheetResource)
      if (sheetPermission.allowed) {
        permission = sheetPermission
        permittedResource = sheetResource
      } else {
        permission = tokenPermission
      }
    } else {
      permission = tokenPermission
    }

    if (permission !== undefined && !permission.allowed) {
      addIssue(
        issues,
        'actor',
        'permission-denied',
        permission.message,
        'GM actor, assigned visible token resource, or assigned visible sheet resource',
        command.actor,
      )
    }
  }

  if (issues.length > 0) {
    return {
      valid: false,
      issues,
      ...(permission !== undefined && !permission.allowed ? { permission } : {}),
    } as unknown as TResult
  }

  return {
    valid: true,
    command,
    payload: payload as TPayload,
    resource: tokenResource as SessionTokenResourceRef,
    tokenResource: tokenResource as SessionTokenResourceRef,
    ...(sheetResource === undefined ? {} : { sheetResource }),
    permittedResource: permittedResource as SessionTokenResourceRef | SessionSheetResourceRef,
    permission: permission as Extract<PermissionResult, { readonly allowed: true }>,
    issues: [],
  } as unknown as TResult
}

export const isUseManeuverCommandValidationCode = (
  value: unknown,
): value is UseManeuverCommandValidationCode =>
  (USE_MANEUVER_COMMAND_VALIDATION_CODES as readonly unknown[]).includes(value)

export const createUseManeuverTokenCommandScope = (
  resource: SessionTokenResourceRef,
): SessionCommandScope => ({
  lane: 'token',
  resource: cloneTokenResource(resource),
  field: USE_MANEUVER_COMMAND_SCOPE_FIELD,
  ...(resource.mapSlug === undefined ? {} : { mapSlug: resource.mapSlug }),
})

export const createUseManeuverSheetCommandScope = (
  resource: SessionSheetResourceRef,
): SessionCommandScope => ({
  lane: 'sheet',
  resource: cloneSheetResource(resource),
  field: USE_MANEUVER_COMMAND_SCOPE_FIELD,
})

export const validateUseManeuverCommand = <
  TActor extends SessionActor = SessionActor,
>(
  value: unknown,
  context: UseManeuverCommandValidationContext = {},
): UseManeuverCommandValidationResult<TActor> =>
  validateUseTableActionCommand<
    UseManeuverCommand<TActor>,
    UseManeuverCommandPayload,
    UseManeuverCommandValidationResult<TActor>,
    TActor
  >(value, context, USE_MANEUVER_SPEC)

export const assertValidUseManeuverCommand = <
  TActor extends SessionActor = SessionActor,
>(
  value: unknown,
  context: UseManeuverCommandValidationContext = {},
  label = 'useManeuver command',
): UseManeuverCommand<TActor> => {
  const result = validateUseManeuverCommand<TActor>(value, context)
  if (result.valid) return result.command

  const summary = result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')
  throw new Error(`${label} is invalid: ${summary}`)
}

export const isUseAbilityCommandValidationCode = (
  value: unknown,
): value is UseAbilityCommandValidationCode =>
  (USE_ABILITY_COMMAND_VALIDATION_CODES as readonly unknown[]).includes(value)

export const createUseAbilityTokenCommandScope = (
  resource: SessionTokenResourceRef,
): SessionCommandScope => ({
  lane: 'token',
  resource: cloneTokenResource(resource),
  field: USE_ABILITY_COMMAND_SCOPE_FIELD,
  ...(resource.mapSlug === undefined ? {} : { mapSlug: resource.mapSlug }),
})

export const createUseAbilitySheetCommandScope = (
  resource: SessionSheetResourceRef,
): SessionCommandScope => ({
  lane: 'sheet',
  resource: cloneSheetResource(resource),
  field: USE_ABILITY_COMMAND_SCOPE_FIELD,
})

export const validateUseAbilityCommand = <
  TActor extends SessionActor = SessionActor,
>(
  value: unknown,
  context: UseAbilityCommandValidationContext = {},
): UseAbilityCommandValidationResult<TActor> =>
  validateUseTableActionCommand<
    UseAbilityCommand<TActor>,
    UseAbilityCommandPayload,
    UseAbilityCommandValidationResult<TActor>,
    TActor
  >(value, context, USE_ABILITY_SPEC)

export const assertValidUseAbilityCommand = <
  TActor extends SessionActor = SessionActor,
>(
  value: unknown,
  context: UseAbilityCommandValidationContext = {},
  label = 'useAbility command',
): UseAbilityCommand<TActor> => {
  const result = validateUseAbilityCommand<TActor>(value, context)
  if (result.valid) return result.command

  const summary = result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')
  throw new Error(`${label} is invalid: ${summary}`)
}

export const isUseOrderCommandValidationCode = (
  value: unknown,
): value is UseOrderCommandValidationCode =>
  (USE_ORDER_COMMAND_VALIDATION_CODES as readonly unknown[]).includes(value)

export const createUseOrderTokenCommandScope = (
  resource: SessionTokenResourceRef,
): SessionCommandScope => ({
  lane: 'token',
  resource: cloneTokenResource(resource),
  field: USE_ORDER_COMMAND_SCOPE_FIELD,
  ...(resource.mapSlug === undefined ? {} : { mapSlug: resource.mapSlug }),
})

export const createUseOrderSheetCommandScope = (
  resource: SessionSheetResourceRef,
): SessionCommandScope => ({
  lane: 'sheet',
  resource: cloneSheetResource(resource),
  field: USE_ORDER_COMMAND_SCOPE_FIELD,
})

export const validateUseOrderCommand = <
  TActor extends SessionActor = SessionActor,
>(
  value: unknown,
  context: UseOrderCommandValidationContext = {},
): UseOrderCommandValidationResult<TActor> =>
  validateUseTableActionCommand<
    UseOrderCommand<TActor>,
    UseOrderCommandPayload,
    UseOrderCommandValidationResult<TActor>,
    TActor
  >(value, context, USE_ORDER_SPEC)

export const assertValidUseOrderCommand = <
  TActor extends SessionActor = SessionActor,
>(
  value: unknown,
  context: UseOrderCommandValidationContext = {},
  label = 'useOrder command',
): UseOrderCommand<TActor> => {
  const result = validateUseOrderCommand<TActor>(value, context)
  if (result.valid) return result.command

  const summary = result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')
  throw new Error(`${label} is invalid: ${summary}`)
}

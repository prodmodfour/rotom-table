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

export const SET_FIELD_EFFECT_COMMAND_TYPE = 'setFieldEffect' as const
export const REMOVE_FIELD_EFFECT_COMMAND_TYPE = 'removeFieldEffect' as const
export const TICK_FIELD_EFFECT_DURATIONS_COMMAND_TYPE = 'tickFieldEffectDurations' as const
export const FIELD_EFFECT_COMMAND_TYPES = [
  SET_FIELD_EFFECT_COMMAND_TYPE,
  REMOVE_FIELD_EFFECT_COMMAND_TYPE,
  TICK_FIELD_EFFECT_DURATIONS_COMMAND_TYPE,
] as const

export type FieldEffectCommandType = (typeof FIELD_EFFECT_COMMAND_TYPES)[number]

export const FIELD_EFFECT_COMMAND_SCOPE_FIELD = 'fieldEffects' as const

export const SESSION_FIELD_EFFECT_CATEGORIES = ['weather', 'terrain', 'room'] as const
export type SessionFieldEffectCategory = (typeof SESSION_FIELD_EFFECT_CATEGORIES)[number]

export const SESSION_WEATHER_KINDS = ['sunny', 'rainy', 'hail', 'sandstorm'] as const
export const SESSION_TERRAIN_EFFECT_KINDS = ['electric', 'grassy', 'misty', 'psychic'] as const
export const SESSION_ROOM_KINDS = ['magic', 'trick', 'wonder'] as const
export const SESSION_FIELD_EFFECT_KINDS = [
  ...SESSION_WEATHER_KINDS,
  ...SESSION_TERRAIN_EFFECT_KINDS,
  ...SESSION_ROOM_KINDS,
] as const

export type SessionWeatherKind = (typeof SESSION_WEATHER_KINDS)[number]
export type SessionTerrainEffectKind = (typeof SESSION_TERRAIN_EFFECT_KINDS)[number]
export type SessionRoomKind = (typeof SESSION_ROOM_KINDS)[number]
export type SessionFieldEffectKind = (typeof SESSION_FIELD_EFFECT_KINDS)[number]

export const FIELD_EFFECT_WEATHER_MODES = ['replace', 'append'] as const
export type FieldEffectWeatherMode = (typeof FIELD_EFFECT_WEATHER_MODES)[number]

export const FIELD_EFFECT_TERRAIN_SCOPES = ['field', 'area'] as const
export type FieldEffectTerrainScope = (typeof FIELD_EFFECT_TERRAIN_SCOPES)[number]

export interface SetFieldEffectCommandPayload {
  /** Optional map target. When omitted, the server uses the field-effect scope map or selected session map. */
  readonly mapSlug?: string
  readonly category: SessionFieldEffectCategory
  readonly kind: SessionFieldEffectKind
  /** Remaining duration. `null` means untracked/sustained; `0` removes the effect. */
  readonly rounds?: number | null
  /** Optional player-safe source label such as a move or GM note. */
  readonly source?: string
  /** Weather is one-at-a-time by default; append allows a bounded two-weather coexistence for special cases. */
  readonly weatherMode?: FieldEffectWeatherMode
  /** Terrain effects are field-wide by default; `area` is reserved for local move-created terrain. */
  readonly terrainScope?: FieldEffectTerrainScope
  /** Trick Room normally starts next round; this may be overridden by automation. */
  readonly startsNextRound?: boolean
}

export interface RemoveFieldEffectCommandPayload {
  /** Optional map target. When omitted, the server uses the field-effect scope map or selected session map. */
  readonly mapSlug?: string
  /** `all` clears every Weather, Terrain, and Room effect. A concrete category clears one category or kind. */
  readonly category: SessionFieldEffectCategory | 'all'
  /** When omitted for a concrete category, every effect in that category is removed. */
  readonly kind?: SessionFieldEffectKind
}

export interface TickFieldEffectDurationsCommandPayload {
  /** Optional map target. When omitted, the server uses the field-effect scope map or selected session map. */
  readonly mapSlug?: string
  /** Number of rounds to decrement from finite durations. Defaults to 1. */
  readonly amount?: number
}

export type SetFieldEffectCommand<
  TActor extends SessionActor = SessionActor,
> = SessionCommandEnvelope<
  typeof SET_FIELD_EFFECT_COMMAND_TYPE,
  SetFieldEffectCommandPayload,
  TActor,
  SessionRevision
>

export type RemoveFieldEffectCommand<
  TActor extends SessionActor = SessionActor,
> = SessionCommandEnvelope<
  typeof REMOVE_FIELD_EFFECT_COMMAND_TYPE,
  RemoveFieldEffectCommandPayload,
  TActor,
  SessionRevision
>

export type TickFieldEffectDurationsCommand<
  TActor extends SessionActor = SessionActor,
> = SessionCommandEnvelope<
  typeof TICK_FIELD_EFFECT_DURATIONS_COMMAND_TYPE,
  TickFieldEffectDurationsCommandPayload,
  TActor,
  SessionRevision
>

export type FieldEffectCommand<TActor extends SessionActor = SessionActor> =
  | SetFieldEffectCommand<TActor>
  | RemoveFieldEffectCommand<TActor>
  | TickFieldEffectDurationsCommand<TActor>

export type FieldEffectCommandPayload =
  | SetFieldEffectCommandPayload
  | RemoveFieldEffectCommandPayload
  | TickFieldEffectDurationsCommandPayload

export const FIELD_EFFECT_COMMAND_VALIDATION_CODES = [
  'invalid-command-type',
  'invalid-payload',
  'invalid-map-slug',
  'invalid-category',
  'invalid-kind',
  'invalid-rounds',
  'invalid-source',
  'invalid-weather-mode',
  'invalid-terrain-scope',
  'invalid-starts-next-round',
  'invalid-tick-amount',
  'invalid-field-effect-scope',
  'permission-denied',
] as const

export type FieldEffectCommandValidationCode =
  (typeof FIELD_EFFECT_COMMAND_VALIDATION_CODES)[number]

export interface FieldEffectCommandValidationContext {
  /** Field-effect controls are GM-only in live session mode; this context is reserved for later table policy. */
  readonly assignments?: readonly unknown[]
}

export interface FieldEffectCommandValidationSuccess<
  TCommand extends FieldEffectCommand = FieldEffectCommand,
> {
  readonly valid: true
  readonly command: TCommand
  readonly payload: TCommand['payload']
  readonly mapSlug?: string
  readonly permission: Extract<PermissionResult, { readonly allowed: true }>
  readonly issues: readonly []
}

export interface FieldEffectCommandValidationFailure {
  readonly valid: false
  readonly issues: readonly SessionCommandValidationIssue[]
  readonly permission?: PermissionDenied
}

export type FieldEffectCommandValidationResult<
  TCommand extends FieldEffectCommand = FieldEffectCommand,
> = FieldEffectCommandValidationSuccess<TCommand> | FieldEffectCommandValidationFailure

type MutableIssueList = SessionCommandValidationIssue[]
type UnknownRecord = Record<string, unknown>

const EXPECTED_OBJECT = 'object'
const EXPECTED_NON_EMPTY_STRING = 'non-empty string'
const EXPECTED_CATEGORY = SESSION_FIELD_EFFECT_CATEGORIES.join(' | ')
const EXPECTED_REMOVE_CATEGORY = `${EXPECTED_CATEGORY} | all`
const EXPECTED_FIELD_EFFECT_KIND = SESSION_FIELD_EFFECT_KINDS.join(' | ')
const EXPECTED_ROUNDS = 'safe non-negative integer or null'
const EXPECTED_TICK_AMOUNT = 'safe integer >= 1'
const EXPECTED_WEATHER_MODE = FIELD_EFFECT_WEATHER_MODES.join(' | ')
const EXPECTED_TERRAIN_SCOPE = FIELD_EFFECT_TERRAIN_SCOPES.join(' | ')

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
  code: FieldEffectCommandValidationCode,
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

const isSafeNonNegativeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

const isPositiveSafeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 1

export const isSessionFieldEffectCategory = (
  value: unknown,
): value is SessionFieldEffectCategory =>
  (SESSION_FIELD_EFFECT_CATEGORIES as readonly unknown[]).includes(value)

export const isSessionWeatherKind = (value: unknown): value is SessionWeatherKind =>
  (SESSION_WEATHER_KINDS as readonly unknown[]).includes(value)

export const isSessionTerrainEffectKind = (
  value: unknown,
): value is SessionTerrainEffectKind =>
  (SESSION_TERRAIN_EFFECT_KINDS as readonly unknown[]).includes(value)

export const isSessionRoomKind = (value: unknown): value is SessionRoomKind =>
  (SESSION_ROOM_KINDS as readonly unknown[]).includes(value)

export const isSessionFieldEffectKind = (
  value: unknown,
): value is SessionFieldEffectKind =>
  (SESSION_FIELD_EFFECT_KINDS as readonly unknown[]).includes(value)

export const isFieldEffectWeatherMode = (
  value: unknown,
): value is FieldEffectWeatherMode =>
  (FIELD_EFFECT_WEATHER_MODES as readonly unknown[]).includes(value)

export const isFieldEffectTerrainScope = (
  value: unknown,
): value is FieldEffectTerrainScope =>
  (FIELD_EFFECT_TERRAIN_SCOPES as readonly unknown[]).includes(value)

export const isFieldEffectCommandType = (
  value: unknown,
): value is FieldEffectCommandType =>
  (FIELD_EFFECT_COMMAND_TYPES as readonly unknown[]).includes(value)

export const isFieldEffectCommandValidationCode = (
  value: unknown,
): value is FieldEffectCommandValidationCode =>
  (FIELD_EFFECT_COMMAND_VALIDATION_CODES as readonly unknown[]).includes(value)

export const fieldEffectKindMatchesCategory = (
  category: SessionFieldEffectCategory,
  kind: unknown,
): kind is SessionFieldEffectKind => {
  if (category === 'weather') return isSessionWeatherKind(kind)
  if (category === 'terrain') return isSessionTerrainEffectKind(kind)
  return isSessionRoomKind(kind)
}

export const createFieldEffectCommandScope = (mapSlug?: string): SessionCommandScope => ({
  lane: 'field-effect',
  field: FIELD_EFFECT_COMMAND_SCOPE_FIELD,
  ...(mapSlug === undefined ? {} : { mapSlug }),
})

const cloneSetPayload = (payload: SetFieldEffectCommandPayload): SetFieldEffectCommandPayload => ({
  ...(payload.mapSlug === undefined ? {} : { mapSlug: payload.mapSlug }),
  category: payload.category,
  kind: payload.kind,
  ...(payload.rounds === undefined ? {} : { rounds: payload.rounds }),
  ...(payload.source === undefined ? {} : { source: payload.source }),
  ...(payload.weatherMode === undefined ? {} : { weatherMode: payload.weatherMode }),
  ...(payload.terrainScope === undefined ? {} : { terrainScope: payload.terrainScope }),
  ...(payload.startsNextRound === undefined ? {} : { startsNextRound: payload.startsNextRound }),
})

const cloneRemovePayload = (payload: RemoveFieldEffectCommandPayload): RemoveFieldEffectCommandPayload => ({
  ...(payload.mapSlug === undefined ? {} : { mapSlug: payload.mapSlug }),
  category: payload.category,
  ...(payload.kind === undefined ? {} : { kind: payload.kind }),
})

const cloneTickPayload = (payload: TickFieldEffectDurationsCommandPayload): TickFieldEffectDurationsCommandPayload => ({
  ...(payload.mapSlug === undefined ? {} : { mapSlug: payload.mapSlug }),
  ...(payload.amount === undefined ? {} : { amount: payload.amount }),
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
      'field-effect payload.mapSlug must be a non-empty string when provided.',
      EXPECTED_NON_EMPTY_STRING,
      payload.mapSlug,
    )
    return undefined
  }
  return payload.mapSlug
}

const collectSetFieldEffectPayloadIssues = (
  payload: unknown,
  issues: MutableIssueList,
): SetFieldEffectCommandPayload | undefined => {
  if (!isRecord(payload)) {
    addIssue(
      issues,
      'payload',
      'invalid-payload',
      'setFieldEffect payload must be an object.',
      EXPECTED_OBJECT,
      payload,
    )
    return undefined
  }

  const mapSlug = collectPayloadMapSlugIssue(payload, issues)
  const category = payload.category
  const kind = payload.kind
  if (!isSessionFieldEffectCategory(category)) {
    addIssue(
      issues,
      'payload.category',
      'invalid-category',
      'setFieldEffect payload.category must be weather, terrain, or room.',
      EXPECTED_CATEGORY,
      category,
    )
  } else if (!fieldEffectKindMatchesCategory(category, kind)) {
    addIssue(
      issues,
      'payload.kind',
      'invalid-kind',
      `setFieldEffect payload.kind must be a supported ${category} effect kind.`,
      EXPECTED_FIELD_EFFECT_KIND,
      kind,
    )
  }

  if (hasOwn(payload, 'rounds') && !(payload.rounds === null || isSafeNonNegativeInteger(payload.rounds))) {
    addIssue(
      issues,
      'payload.rounds',
      'invalid-rounds',
      'setFieldEffect payload.rounds must be a safe non-negative integer or null when provided.',
      EXPECTED_ROUNDS,
      payload.rounds,
    )
  }

  let source: string | undefined
  if (hasOwn(payload, 'source') && payload.source !== undefined) {
    if (!isNonEmptyString(payload.source)) {
      addIssue(
        issues,
        'payload.source',
        'invalid-source',
        'setFieldEffect payload.source must be a non-empty string when provided.',
        EXPECTED_NON_EMPTY_STRING,
        payload.source,
      )
    } else {
      source = payload.source.trim().slice(0, 80)
    }
  }

  if (hasOwn(payload, 'weatherMode') && payload.weatherMode !== undefined) {
    if (category !== 'weather') {
      addIssue(
        issues,
        'payload.weatherMode',
        'invalid-weather-mode',
        'setFieldEffect payload.weatherMode is only valid for weather effects.',
        'weather category',
        payload.weatherMode,
      )
    } else if (!isFieldEffectWeatherMode(payload.weatherMode)) {
      addIssue(
        issues,
        'payload.weatherMode',
        'invalid-weather-mode',
        'setFieldEffect payload.weatherMode must be replace or append.',
        EXPECTED_WEATHER_MODE,
        payload.weatherMode,
      )
    }
  }

  if (hasOwn(payload, 'terrainScope') && payload.terrainScope !== undefined) {
    if (category !== 'terrain') {
      addIssue(
        issues,
        'payload.terrainScope',
        'invalid-terrain-scope',
        'setFieldEffect payload.terrainScope is only valid for terrain effects.',
        'terrain category',
        payload.terrainScope,
      )
    } else if (!isFieldEffectTerrainScope(payload.terrainScope)) {
      addIssue(
        issues,
        'payload.terrainScope',
        'invalid-terrain-scope',
        'setFieldEffect payload.terrainScope must be field or area.',
        EXPECTED_TERRAIN_SCOPE,
        payload.terrainScope,
      )
    }
  }

  if (hasOwn(payload, 'startsNextRound') && payload.startsNextRound !== undefined) {
    if (category !== 'room') {
      addIssue(
        issues,
        'payload.startsNextRound',
        'invalid-starts-next-round',
        'setFieldEffect payload.startsNextRound is only valid for room effects.',
        'room category',
        payload.startsNextRound,
      )
    } else if (typeof payload.startsNextRound !== 'boolean') {
      addIssue(
        issues,
        'payload.startsNextRound',
        'invalid-starts-next-round',
        'setFieldEffect payload.startsNextRound must be boolean when provided.',
        'boolean',
        payload.startsNextRound,
      )
    }
  }

  if (issues.some((issue) => issue.path.startsWith('payload'))) return undefined

  return cloneSetPayload({
    ...(mapSlug === undefined ? {} : { mapSlug }),
    category: category as SessionFieldEffectCategory,
    kind: kind as SessionFieldEffectKind,
    ...(hasOwn(payload, 'rounds') ? { rounds: payload.rounds as number | null } : {}),
    ...(source === undefined ? {} : { source }),
    ...(payload.weatherMode === undefined ? {} : { weatherMode: payload.weatherMode as FieldEffectWeatherMode }),
    ...(payload.terrainScope === undefined ? {} : { terrainScope: payload.terrainScope as FieldEffectTerrainScope }),
    ...(payload.startsNextRound === undefined ? {} : { startsNextRound: payload.startsNextRound as boolean }),
  })
}

const collectRemoveFieldEffectPayloadIssues = (
  payload: unknown,
  issues: MutableIssueList,
): RemoveFieldEffectCommandPayload | undefined => {
  if (!isRecord(payload)) {
    addIssue(
      issues,
      'payload',
      'invalid-payload',
      'removeFieldEffect payload must be an object.',
      EXPECTED_OBJECT,
      payload,
    )
    return undefined
  }

  const mapSlug = collectPayloadMapSlugIssue(payload, issues)
  const category = payload.category
  const kind = payload.kind
  if (!(isSessionFieldEffectCategory(category) || category === 'all')) {
    addIssue(
      issues,
      'payload.category',
      'invalid-category',
      'removeFieldEffect payload.category must be weather, terrain, room, or all.',
      EXPECTED_REMOVE_CATEGORY,
      category,
    )
  }

  if (hasOwn(payload, 'kind') && kind !== undefined) {
    if (category === 'all') {
      addIssue(
        issues,
        'payload.kind',
        'invalid-kind',
        'removeFieldEffect payload.kind must be omitted when category is all.',
        'omitted kind',
        kind,
      )
    } else if (!isSessionFieldEffectCategory(category) || !fieldEffectKindMatchesCategory(category, kind)) {
      addIssue(
        issues,
        'payload.kind',
        'invalid-kind',
        'removeFieldEffect payload.kind must match the selected field-effect category.',
        EXPECTED_FIELD_EFFECT_KIND,
        kind,
      )
    }
  }

  if (issues.some((issue) => issue.path.startsWith('payload'))) return undefined

  return cloneRemovePayload({
    ...(mapSlug === undefined ? {} : { mapSlug }),
    category: category as SessionFieldEffectCategory | 'all',
    ...(kind === undefined ? {} : { kind: kind as SessionFieldEffectKind }),
  })
}

const collectTickFieldEffectDurationsPayloadIssues = (
  payload: unknown,
  issues: MutableIssueList,
): TickFieldEffectDurationsCommandPayload | undefined => {
  if (!isRecord(payload)) {
    addIssue(
      issues,
      'payload',
      'invalid-payload',
      'tickFieldEffectDurations payload must be an object.',
      EXPECTED_OBJECT,
      payload,
    )
    return undefined
  }

  const mapSlug = collectPayloadMapSlugIssue(payload, issues)
  if (hasOwn(payload, 'amount') && payload.amount !== undefined && !isPositiveSafeInteger(payload.amount)) {
    addIssue(
      issues,
      'payload.amount',
      'invalid-tick-amount',
      'tickFieldEffectDurations payload.amount must be a safe integer greater than or equal to 1 when provided.',
      EXPECTED_TICK_AMOUNT,
      payload.amount,
    )
  }

  if (issues.some((issue) => issue.path.startsWith('payload'))) return undefined

  return cloneTickPayload({
    ...(mapSlug === undefined ? {} : { mapSlug }),
    ...(payload.amount === undefined ? {} : { amount: payload.amount as number }),
  })
}

const findFieldEffectScopeMapSlug = (
  command: Pick<FieldEffectCommand, 'scopes' | 'payload' | 'type'>,
  payload: FieldEffectCommandPayload | undefined,
  issues: MutableIssueList,
): string | undefined => {
  const fieldEffectScopes = command.scopes.filter(
    (scope) => scope.lane === 'field-effect' && scope.field === FIELD_EFFECT_COMMAND_SCOPE_FIELD,
  )

  if (fieldEffectScopes.length === 0) {
    addIssue(
      issues,
      'scopes',
      'invalid-field-effect-scope',
      `${command.type} commands must include a field-effect scope with field "fieldEffects".`,
      'field-effect scope',
      command.scopes,
    )
    return payload?.mapSlug
  }

  const mapSlugs = new Set(
    fieldEffectScopes
      .map((scope) => scope.mapSlug)
      .filter((mapSlug): mapSlug is string => mapSlug !== undefined),
  )
  if (mapSlugs.size > 1) {
    addIssue(
      issues,
      'scopes',
      'invalid-field-effect-scope',
      `${command.type} field-effect scopes must not target multiple maps.`,
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
      `${command.type} payload.mapSlug must match the field-effect scope mapSlug when both are provided.`,
      scopeMapSlug,
      payload.mapSlug,
    )
  }

  return payload?.mapSlug ?? scopeMapSlug
}

const createValidationFailure = (
  issues: readonly SessionCommandValidationIssue[],
  permission: PermissionResult,
): FieldEffectCommandValidationFailure => ({
  valid: false,
  issues,
  ...(permission.allowed ? {} : { permission }),
})

const validatePermission = (
  command: FieldEffectCommand,
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

export const validateSetFieldEffectCommand = <
  TActor extends SessionActor = SessionActor,
>(
  value: unknown,
  _context: FieldEffectCommandValidationContext = {},
): FieldEffectCommandValidationResult<SetFieldEffectCommand<TActor>> => {
  const envelopeResult = validateSessionCommandEnvelope<SetFieldEffectCommand<TActor>>(value)
  if (!envelopeResult.valid) return { valid: false, issues: envelopeResult.issues }

  const command = envelopeResult.command
  const issues: MutableIssueList = []

  if (command.type !== SET_FIELD_EFFECT_COMMAND_TYPE) {
    addIssue(
      issues,
      'type',
      'invalid-command-type',
      'setFieldEffect validators only accept command envelopes with type "setFieldEffect".',
      SET_FIELD_EFFECT_COMMAND_TYPE,
      command.type,
    )
  }

  const payload = collectSetFieldEffectPayloadIssues(command.payload, issues)
  const mapSlug = findFieldEffectScopeMapSlug(command, payload, issues)
  const permission = validatePermission(command, issues)

  if (issues.length > 0) return createValidationFailure(issues, permission)

  return {
    valid: true,
    command,
    payload: payload as SetFieldEffectCommandPayload,
    ...(mapSlug === undefined ? {} : { mapSlug }),
    permission: permission as Extract<PermissionResult, { readonly allowed: true }>,
    issues: [],
  }
}

export const validateRemoveFieldEffectCommand = <
  TActor extends SessionActor = SessionActor,
>(
  value: unknown,
  _context: FieldEffectCommandValidationContext = {},
): FieldEffectCommandValidationResult<RemoveFieldEffectCommand<TActor>> => {
  const envelopeResult = validateSessionCommandEnvelope<RemoveFieldEffectCommand<TActor>>(value)
  if (!envelopeResult.valid) return { valid: false, issues: envelopeResult.issues }

  const command = envelopeResult.command
  const issues: MutableIssueList = []

  if (command.type !== REMOVE_FIELD_EFFECT_COMMAND_TYPE) {
    addIssue(
      issues,
      'type',
      'invalid-command-type',
      'removeFieldEffect validators only accept command envelopes with type "removeFieldEffect".',
      REMOVE_FIELD_EFFECT_COMMAND_TYPE,
      command.type,
    )
  }

  const payload = collectRemoveFieldEffectPayloadIssues(command.payload, issues)
  const mapSlug = findFieldEffectScopeMapSlug(command, payload, issues)
  const permission = validatePermission(command, issues)

  if (issues.length > 0) return createValidationFailure(issues, permission)

  return {
    valid: true,
    command,
    payload: payload as RemoveFieldEffectCommandPayload,
    ...(mapSlug === undefined ? {} : { mapSlug }),
    permission: permission as Extract<PermissionResult, { readonly allowed: true }>,
    issues: [],
  }
}

export const validateTickFieldEffectDurationsCommand = <
  TActor extends SessionActor = SessionActor,
>(
  value: unknown,
  _context: FieldEffectCommandValidationContext = {},
): FieldEffectCommandValidationResult<TickFieldEffectDurationsCommand<TActor>> => {
  const envelopeResult = validateSessionCommandEnvelope<TickFieldEffectDurationsCommand<TActor>>(value)
  if (!envelopeResult.valid) return { valid: false, issues: envelopeResult.issues }

  const command = envelopeResult.command
  const issues: MutableIssueList = []

  if (command.type !== TICK_FIELD_EFFECT_DURATIONS_COMMAND_TYPE) {
    addIssue(
      issues,
      'type',
      'invalid-command-type',
      'tickFieldEffectDurations validators only accept command envelopes with type "tickFieldEffectDurations".',
      TICK_FIELD_EFFECT_DURATIONS_COMMAND_TYPE,
      command.type,
    )
  }

  const payload = collectTickFieldEffectDurationsPayloadIssues(command.payload, issues)
  const mapSlug = findFieldEffectScopeMapSlug(command, payload, issues)
  const permission = validatePermission(command, issues)

  if (issues.length > 0) return createValidationFailure(issues, permission)

  return {
    valid: true,
    command,
    payload: payload as TickFieldEffectDurationsCommandPayload,
    ...(mapSlug === undefined ? {} : { mapSlug }),
    permission: permission as Extract<PermissionResult, { readonly allowed: true }>,
    issues: [],
  }
}

export const validateFieldEffectCommand = <
  TActor extends SessionActor = SessionActor,
>(
  value: unknown,
  context: FieldEffectCommandValidationContext = {},
): FieldEffectCommandValidationResult<FieldEffectCommand<TActor>> => {
  const envelopeResult = validateSessionCommandEnvelope<FieldEffectCommand<TActor>>(value)
  if (!envelopeResult.valid) return { valid: false, issues: envelopeResult.issues }

  if (envelopeResult.command.type === SET_FIELD_EFFECT_COMMAND_TYPE) {
    return validateSetFieldEffectCommand<TActor>(value, context) as FieldEffectCommandValidationResult<FieldEffectCommand<TActor>>
  }
  if (envelopeResult.command.type === REMOVE_FIELD_EFFECT_COMMAND_TYPE) {
    return validateRemoveFieldEffectCommand<TActor>(value, context) as FieldEffectCommandValidationResult<FieldEffectCommand<TActor>>
  }
  if (envelopeResult.command.type === TICK_FIELD_EFFECT_DURATIONS_COMMAND_TYPE) {
    return validateTickFieldEffectDurationsCommand<TActor>(value, context) as FieldEffectCommandValidationResult<FieldEffectCommand<TActor>>
  }

  return {
    valid: false,
    issues: [
      {
        path: 'type',
        code: 'invalid-command-type',
        message: 'field-effect validators only accept setFieldEffect, removeFieldEffect, or tickFieldEffectDurations command envelopes.',
        expected: FIELD_EFFECT_COMMAND_TYPES.join(' | '),
        received: describeReceived(isRecord(value) ? value.type : undefined),
      },
    ],
  }
}

export const assertValidFieldEffectCommand = <
  TActor extends SessionActor = SessionActor,
>(
  value: unknown,
  context: FieldEffectCommandValidationContext = {},
  label = 'field-effect command',
): FieldEffectCommand<TActor> => {
  const result = validateFieldEffectCommand<TActor>(value, context)
  if (result.valid) return result.command

  const summary = result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')
  throw new Error(`${label} is invalid: ${summary}`)
}

import { isSlug } from '../paths'
import { ABILITY_SPEC_PHASES, type AbilitySpecPhase } from './spec'
import { cloneStrictJson, deepFreezeStrictJson, isPlainJsonObject } from '../automation/strictJson'
import {
  parseAcceptedEncounterPresentation,
  type AcceptedEncounterPresentation,
} from '../encounterPresentation'

export const ABILITY_RESOLUTION_RESULT_SCHEMA_VERSION = 1 as const

export const ABILITY_RESOLUTION_RESULT_LIMITS = Object.freeze({
  identifierLength: 200,
  canonicalIdLength: 160,
  windows: 64,
  options: 512,
  operations: 512,
  presentationKeyLength: 160,
  jsonDepth: 12,
  jsonNodes: 8_192,
})

export type AbilityResolutionPublicOutcome = 'applied' | 'prevented' | 'no-op'

export interface AbilityResolutionPublicPresentation {
  readonly key: string
  readonly outcome: AbilityResolutionPublicOutcome | null
}

interface AbilityResolutionPublicResultBase {
  readonly schemaVersion: typeof ABILITY_RESOLUTION_RESULT_SCHEMA_VERSION
  readonly operationId: string
  readonly resolutionId: string
  readonly mapSlug: string
  readonly previousRevision: number
  readonly revision: number
  readonly presentation: AbilityResolutionPublicPresentation
}

export interface AcceptedAbilityResolutionPublicResult
  extends AbilityResolutionPublicResultBase {
  readonly kind: 'accepted'
  readonly status: 'committed'
  readonly presentation: AbilityResolutionPublicPresentation & {
    readonly outcome: AbilityResolutionPublicOutcome
  }
  /** Generic accepted outcome; absent only when reading a pre-contract row. */
  readonly encounterPresentation?: AcceptedEncounterPresentation
}

export interface PendingAbilityResolutionPublicResult
  extends AbilityResolutionPublicResultBase {
  readonly kind: 'pending'
  readonly status: 'pending'
  readonly phase: AbilitySpecPhase
  readonly outstandingWindowCount: number
  readonly createdAt: number
  readonly updatedAt: number
  readonly presentation: AbilityResolutionPublicPresentation & {
    readonly outcome: null
  }
}

export type AbilityResolutionPublicResult =
  | AcceptedAbilityResolutionPublicResult
  | PendingAbilityResolutionPublicResult

export interface AbilityResolutionAuthorizedIdentity {
  readonly canonicalId: string
  readonly modeId: string
  readonly actorPlacementId: string
}

export interface AbilityResolutionAuthorizedOperationSummary {
  readonly operationId: string
  readonly operationKind: string
  readonly outcome: AbilityResolutionPublicOutcome | 'pending'
  readonly recipientCount: number
  readonly presentationKey: string
}

export interface AcceptedAbilityResolutionAuthorizedView {
  readonly schemaVersion: typeof ABILITY_RESOLUTION_RESULT_SCHEMA_VERSION
  readonly kind: 'accepted-view'
  readonly summary: AcceptedAbilityResolutionPublicResult
  readonly ability: AbilityResolutionAuthorizedIdentity
  readonly operations: readonly AbilityResolutionAuthorizedOperationSummary[]
}

export interface AbilityResolutionAuthorizedOption {
  readonly id: string
  readonly presentationKey: string
}

export interface AbilityResolutionAuthorizedWindow {
  readonly windowId: string
  readonly kind: 'choice' | 'reaction'
  readonly phase: AbilitySpecPhase
  readonly promptKey: string
  readonly options: readonly AbilityResolutionAuthorizedOption[]
  readonly allowPass: boolean
}

export interface PendingAbilityResolutionAuthorizedView {
  readonly schemaVersion: typeof ABILITY_RESOLUTION_RESULT_SCHEMA_VERSION
  readonly kind: 'pending-view'
  readonly summary: PendingAbilityResolutionPublicResult
  /** Hidden from eligible responders; only an audited GM projection carries identity. */
  readonly ability: AbilityResolutionAuthorizedIdentity | null
  readonly window: AbilityResolutionAuthorizedWindow
}

export type AbilityResolutionAuthorizedView =
  | AcceptedAbilityResolutionAuthorizedView
  | PendingAbilityResolutionAuthorizedView

export type AbilityResolutionResultValidationCode =
  | 'invalid-result'
  | 'unsupported-schema-version'
  | 'limit-exceeded'
  | 'duplicate-id'
  | 'not-json'
  | 'inconsistent-result'

export class AbilityResolutionResultValidationError extends Error {
  readonly code: AbilityResolutionResultValidationCode
  readonly path: string

  constructor(code: AbilityResolutionResultValidationCode, path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'AbilityResolutionResultValidationError'
    this.code = code
    this.path = path
  }
}

type UnknownRecord = Record<string, unknown>
const PUBLIC_BASE_FIELDS = [
  'schemaVersion',
  'kind',
  'operationId',
  'resolutionId',
  'mapSlug',
  'previousRevision',
  'revision',
  'status',
  'presentation',
] as const
const PENDING_PUBLIC_FIELDS = [
  ...PUBLIC_BASE_FIELDS,
  'phase',
  'outstandingWindowCount',
  'createdAt',
  'updatedAt',
] as const
const PRESENTATION_FIELDS = ['key', 'outcome'] as const
const ACCEPTED_VIEW_FIELDS = ['schemaVersion', 'kind', 'summary', 'ability', 'operations'] as const
const PENDING_VIEW_FIELDS = ['schemaVersion', 'kind', 'summary', 'ability', 'window'] as const
const IDENTITY_FIELDS = ['canonicalId', 'modeId', 'actorPlacementId'] as const
const OPERATION_FIELDS = [
  'operationId',
  'operationKind',
  'outcome',
  'recipientCount',
  'presentationKey',
] as const
const WINDOW_FIELDS = ['windowId', 'kind', 'phase', 'promptKey', 'options', 'allowPass'] as const
const OPTION_FIELDS = ['id', 'presentationKey'] as const
const STABLE_ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const PHASE_SET = new Set<string>(ABILITY_SPEC_PHASES)

const fail = (
  code: AbilityResolutionResultValidationCode,
  path: string,
  detail: string,
): never => {
  throw new AbilityResolutionResultValidationError(code, path, detail)
}

const clone = (value: unknown, path: string) => cloneStrictJson(value, path, {
  limits: {
    depth: ABILITY_RESOLUTION_RESULT_LIMITS.jsonDepth,
    nodes: ABILITY_RESOLUTION_RESULT_LIMITS.jsonNodes,
    objectFields: 64,
    arrayEntries: ABILITY_RESOLUTION_RESULT_LIMITS.options,
    stringLength: ABILITY_RESOLUTION_RESULT_LIMITS.identifierLength,
    objectKeyLength: ABILITY_RESOLUTION_RESULT_LIMITS.identifierLength,
  },
  rootLabel: 'ability result data',
  valueLabel: 'ability results',
  failNotJson: (failurePath, detail) => fail('not-json', failurePath, detail),
  failLimit: (failurePath, detail) => fail('limit-exceeded', failurePath, detail),
})

const record = (value: unknown, path: string): UnknownRecord => {
  if (!isPlainJsonObject(value)) return fail('invalid-result', path, 'must be an object.')
  return value
}

const exact = (value: UnknownRecord, fields: readonly string[], path: string): void => {
  const expected = new Set(fields)
  const missing = fields.filter(field => !Object.prototype.hasOwnProperty.call(value, field))
  const unknown = Object.keys(value).filter(field => !expected.has(field))
  if (missing.length || unknown.length) fail('invalid-result', path, 'has an invalid shape.')
}

const stableId = (value: unknown, path: string): string => {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > ABILITY_RESOLUTION_RESULT_LIMITS.identifierLength
    || !STABLE_ID_PATTERN.test(value)
  ) {
    return fail('invalid-result', path, 'must be a bounded stable identifier.')
  }
  return value
}

const text = (value: unknown, path: string, maximum: number): string => {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > maximum
    || value.trim() !== value
    || /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return fail('invalid-result', path, 'must be bounded non-empty text.')
  }
  return value
}

const integer = (value: unknown, path: string, maximum = Number.MAX_SAFE_INTEGER): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > maximum) {
    return fail('invalid-result', path, `must be an integer from 0 through ${maximum}.`)
  }
  return Number(value)
}

const enumValue = <Value extends string>(
  value: unknown,
  allowed: readonly Value[],
  path: string,
): Value => {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    return fail('invalid-result', path, 'is unsupported.')
  }
  return value as Value
}

const parsePhase = (value: unknown, path: string): AbilitySpecPhase => {
  if (typeof value !== 'string' || !PHASE_SET.has(value)) {
    return fail('invalid-result', path, 'must be a supported AbilitySpec phase.')
  }
  return value as AbilitySpecPhase
}

const parsePresentation = (
  value: unknown,
  path: string,
  pending: boolean,
): AbilityResolutionPublicPresentation => {
  const input = record(value, path)
  exact(input, PRESENTATION_FIELDS, path)
  const outcome = input.outcome === null
    ? null
    : enumValue(input.outcome, ['applied', 'prevented', 'no-op'], `${path}.outcome`)
  if (pending !== (outcome === null)) {
    fail('inconsistent-result', `${path}.outcome`, pending ? 'must be null while pending.' : 'must be terminal.')
  }
  return Object.freeze({
    key: stableId(input.key, `${path}.key`),
    outcome,
  })
}

const parsePublic = (value: unknown, path: string): AbilityResolutionPublicResult => {
  const input = record(value, path)
  const pending = input.kind === 'pending'
  exact(
    input,
    pending
      ? PENDING_PUBLIC_FIELDS
      : Object.prototype.hasOwnProperty.call(input, 'encounterPresentation')
        ? [...PUBLIC_BASE_FIELDS, 'encounterPresentation']
        : PUBLIC_BASE_FIELDS,
    path,
  )
  if (input.schemaVersion !== ABILITY_RESOLUTION_RESULT_SCHEMA_VERSION) {
    fail('unsupported-schema-version', `${path}.schemaVersion`, 'is unsupported.')
  }
  if (input.kind !== 'accepted' && input.kind !== 'pending') {
    fail('invalid-result', `${path}.kind`, 'must be accepted or pending.')
  }
  const previousRevision = integer(input.previousRevision, `${path}.previousRevision`)
  const revision = integer(input.revision, `${path}.revision`)
  if (revision !== previousRevision + 1) {
    fail('inconsistent-result', `${path}.revision`, 'must advance exactly once.')
  }
  const common = {
    schemaVersion: ABILITY_RESOLUTION_RESULT_SCHEMA_VERSION,
    operationId: stableId(input.operationId, `${path}.operationId`),
    resolutionId: stableId(input.resolutionId, `${path}.resolutionId`),
    mapSlug: typeof input.mapSlug === 'string' && isSlug(input.mapSlug)
      ? input.mapSlug
      : fail('invalid-result', `${path}.mapSlug`, 'must be a valid slug.'),
    previousRevision,
    revision,
  }
  if (input.kind === 'accepted') {
    if (input.status !== 'committed') fail('inconsistent-result', `${path}.status`, 'must be committed.')
    const encounterPresentation = Object.prototype.hasOwnProperty.call(input, 'encounterPresentation')
      ? parseAcceptedEncounterPresentation(input.encounterPresentation)
      : undefined
    if (encounterPresentation && (
      encounterPresentation.operationId !== common.operationId
      || encounterPresentation.mapSlug !== common.mapSlug
      || encounterPresentation.previousRevision !== previousRevision
      || encounterPresentation.revision !== revision
    )) {
      fail('inconsistent-result', `${path}.encounterPresentation`, 'must match the Ability result identity and revisions.')
    }
    return Object.freeze({
      ...common,
      kind: 'accepted',
      status: 'committed',
      presentation: parsePresentation(input.presentation, `${path}.presentation`, false) as AcceptedAbilityResolutionPublicResult['presentation'],
      ...(encounterPresentation === undefined ? {} : { encounterPresentation }),
    })
  }
  if (input.status !== 'pending') fail('inconsistent-result', `${path}.status`, 'must be pending.')
  const createdAt = integer(input.createdAt, `${path}.createdAt`)
  const updatedAt = integer(input.updatedAt, `${path}.updatedAt`)
  if (updatedAt < createdAt) fail('inconsistent-result', `${path}.updatedAt`, 'cannot precede creation.')
  return Object.freeze({
    ...common,
    kind: 'pending',
    status: 'pending',
    phase: parsePhase(input.phase, `${path}.phase`),
    outstandingWindowCount: integer(
      input.outstandingWindowCount,
      `${path}.outstandingWindowCount`,
      ABILITY_RESOLUTION_RESULT_LIMITS.windows,
    ),
    createdAt,
    updatedAt,
    presentation: parsePresentation(input.presentation, `${path}.presentation`, true) as PendingAbilityResolutionPublicResult['presentation'],
  })
}

export const parseAbilityResolutionPublicResult = (
  value: unknown,
): AbilityResolutionPublicResult => deepFreezeStrictJson(parsePublic(
  clone(value, 'abilityResult'),
  'abilityResult',
))

const parseIdentity = (value: unknown, path: string): AbilityResolutionAuthorizedIdentity => {
  const input = record(value, path)
  exact(input, IDENTITY_FIELDS, path)
  return Object.freeze({
    canonicalId: text(input.canonicalId, `${path}.canonicalId`, ABILITY_RESOLUTION_RESULT_LIMITS.canonicalIdLength),
    modeId: stableId(input.modeId, `${path}.modeId`),
    actorPlacementId: text(input.actorPlacementId, `${path}.actorPlacementId`, ABILITY_RESOLUTION_RESULT_LIMITS.identifierLength),
  })
}

const parseOperations = (
  value: unknown,
  path: string,
): readonly AbilityResolutionAuthorizedOperationSummary[] => {
  if (!Array.isArray(value) || value.length > ABILITY_RESOLUTION_RESULT_LIMITS.operations) {
    return fail('limit-exceeded', path, 'must be a bounded operation array.')
  }
  const operations = value.map((value, index): AbilityResolutionAuthorizedOperationSummary => {
    const itemPath = `${path}[${index}]`
    const input = record(value, itemPath)
    exact(input, OPERATION_FIELDS, itemPath)
    return Object.freeze({
      operationId: stableId(input.operationId, `${itemPath}.operationId`),
      operationKind: stableId(input.operationKind, `${itemPath}.operationKind`),
      outcome: enumValue(
        input.outcome,
        ['applied', 'prevented', 'no-op', 'pending'],
        `${itemPath}.outcome`,
      ),
      recipientCount: integer(
        input.recipientCount,
        `${itemPath}.recipientCount`,
        ABILITY_RESOLUTION_RESULT_LIMITS.options,
      ),
      presentationKey: stableId(input.presentationKey, `${itemPath}.presentationKey`),
    })
  })
  if (new Set(operations.map(operation => operation.operationId)).size !== operations.length) {
    fail('duplicate-id', path, 'must not repeat operation IDs.')
  }
  return Object.freeze(operations)
}

const parseWindow = (value: unknown, path: string): AbilityResolutionAuthorizedWindow => {
  const input = record(value, path)
  exact(input, WINDOW_FIELDS, path)
  if (!Array.isArray(input.options) || input.options.length > ABILITY_RESOLUTION_RESULT_LIMITS.options) {
    fail('limit-exceeded', `${path}.options`, 'must be a bounded option array.')
  }
  const options = (input.options as readonly unknown[]).map((value, index) => {
    const itemPath = `${path}.options[${index}]`
    const item = record(value, itemPath)
    exact(item, OPTION_FIELDS, itemPath)
    return Object.freeze({
      id: stableId(item.id, `${itemPath}.id`),
      presentationKey: stableId(item.presentationKey, `${itemPath}.presentationKey`),
    })
  })
  if (new Set(options.map(option => option.id)).size !== options.length) {
    fail('duplicate-id', `${path}.options`, 'must not repeat option IDs.')
  }
  const allowPass = input.allowPass
  if (typeof allowPass !== 'boolean') fail('invalid-result', `${path}.allowPass`, 'must be boolean.')
  return Object.freeze({
    windowId: stableId(input.windowId, `${path}.windowId`),
    kind: enumValue(input.kind, ['choice', 'reaction'], `${path}.kind`),
    phase: parsePhase(input.phase, `${path}.phase`),
    promptKey: stableId(input.promptKey, `${path}.promptKey`),
    options: Object.freeze(options),
    allowPass: allowPass as boolean,
  })
}

export const parseAbilityResolutionAuthorizedView = (
  value: unknown,
): AbilityResolutionAuthorizedView => {
  const detached = clone(value, 'abilityAuthorizedView')
  const input = record(detached, 'abilityAuthorizedView')
  const accepted = input.kind === 'accepted-view'
  exact(input, accepted ? ACCEPTED_VIEW_FIELDS : PENDING_VIEW_FIELDS, 'abilityAuthorizedView')
  if (input.schemaVersion !== ABILITY_RESOLUTION_RESULT_SCHEMA_VERSION) {
    fail('unsupported-schema-version', 'abilityAuthorizedView.schemaVersion', 'is unsupported.')
  }
  if (accepted) {
    const summary = parsePublic(input.summary, 'abilityAuthorizedView.summary')
    if (summary.kind !== 'accepted') {
      return fail('inconsistent-result', 'abilityAuthorizedView.summary', 'must be accepted.')
    }
    return deepFreezeStrictJson({
      schemaVersion: ABILITY_RESOLUTION_RESULT_SCHEMA_VERSION,
      kind: 'accepted-view',
      summary,
      ability: parseIdentity(input.ability, 'abilityAuthorizedView.ability'),
      operations: parseOperations(input.operations, 'abilityAuthorizedView.operations'),
    })
  }
  if (input.kind !== 'pending-view') {
    return fail('invalid-result', 'abilityAuthorizedView.kind', 'must be accepted-view or pending-view.')
  }
  const summary = parsePublic(input.summary, 'abilityAuthorizedView.summary')
  if (summary.kind !== 'pending') {
    return fail('inconsistent-result', 'abilityAuthorizedView.summary', 'must be pending.')
  }
  const window = parseWindow(input.window, 'abilityAuthorizedView.window')
  if (window.phase !== summary.phase) {
    fail('inconsistent-result', 'abilityAuthorizedView.window.phase', 'must match pending phase.')
  }
  return deepFreezeStrictJson({
    schemaVersion: ABILITY_RESOLUTION_RESULT_SCHEMA_VERSION,
    kind: 'pending-view',
    summary,
    ability: input.ability === null
      ? null
      : parseIdentity(input.ability, 'abilityAuthorizedView.ability'),
    window,
  })
}

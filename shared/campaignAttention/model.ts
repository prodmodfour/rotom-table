import type { EncounterSettlementAuthorityRef } from '../encounterSettlement/document'

export const CAMPAIGN_ATTENTION_ITEM_SCHEMA_VERSION = 1 as const

export const CAMPAIGN_ATTENTION_REASONS = [
  'level-threshold',
  'advancement-review',
  'unspent-advancement',
  'invalid-advancement',
  'move-learning',
  'ability-choice',
  'evolution-choice',
  'form-choice',
  'post-evolution-review',
  'trainer-advancement',
  'capture-review',
  'team-overflow',
  'hatch-review',
  'ownership-review',
  'medical-review',
  'recovery-review',
  'equipment-review',
  'continuation-review',
] as const
export type CampaignAttentionReason = typeof CAMPAIGN_ATTENTION_REASONS[number]

export const CAMPAIGN_ATTENTION_AUDIENCES = ['gm', 'owner'] as const
export type CampaignAttentionAudience = typeof CAMPAIGN_ATTENTION_AUDIENCES[number]

export const CAMPAIGN_ATTENTION_URGENCIES = ['blocking', 'urgent', 'normal', 'informational'] as const
export type CampaignAttentionUrgency = typeof CAMPAIGN_ATTENTION_URGENCIES[number]

export const CAMPAIGN_ATTENTION_ENTITY_KINDS = [
  'trainer-sheet', 'pokemon-sheet', 'group-inventory', 'profile',
  'encounter', 'settlement', 'breeding-project', 'egg', 'campaign',
] as const
export type CampaignAttentionEntityKind = typeof CAMPAIGN_ATTENTION_ENTITY_KINDS[number]

export const CAMPAIGN_ATTENTION_AUTHORITY_KINDS = [
  'encounter-document', 'map', 'sheet', 'group-inventory', 'campaign-clock',
  'capture-operation', 'item-operation', 'equipment-operation', 'inventory-operation',
  'objective', 'clock', 'phase', 'effect', 'resource', 'profile', 'settlement',
  'breeding-project', 'egg', 'operation',
] as const
export type CampaignAttentionAuthorityKind = typeof CAMPAIGN_ATTENTION_AUTHORITY_KINDS[number]

export const CAMPAIGN_ATTENTION_SOURCE_EVENT_KINDS = [
  'encounter-settlement', 'campaign-day', 'sheet-authority', 'profile-authority',
  'item-operation', 'equipment-operation', 'breeding-operation', 'capture-operation',
] as const
export type CampaignAttentionSourceEventKind = typeof CAMPAIGN_ATTENTION_SOURCE_EVENT_KINDS[number]

export const CAMPAIGN_ATTENTION_DECISION_KINDS = [
  'allocate-advancement', 'repair-advancement', 'choose-move', 'choose-ability',
  'choose-evolution', 'choose-form', 'review-post-evolution',
  'review-trainer-build', 'review-capture', 'repair-team',
  'review-hatch', 'assign-ownership', 'choose-treatment', 'review-recovery',
  'repair-equipment', 'review-continuation',
] as const
export type CampaignAttentionDecisionKind = typeof CAMPAIGN_ATTENTION_DECISION_KINDS[number]

export const CAMPAIGN_ATTENTION_ACTION_INTENTS = [
  'review-advancement', 'review-moves', 'review-abilities', 'review-evolution',
  'review-form', 'review-post-evolution', 'review-trainer', 'review-capture', 'review-team', 'review-hatch', 'review-ownership',
  'start-treatment', 'review-recovery', 'review-equipment', 'continue-campaign',
] as const
export type CampaignAttentionActionIntent = typeof CAMPAIGN_ATTENTION_ACTION_INTENTS[number]

export const CAMPAIGN_ATTENTION_RESOLUTION_STATES = ['open', 'resolved', 'superseded'] as const
export type CampaignAttentionResolutionState = typeof CAMPAIGN_ATTENTION_RESOLUTION_STATES[number]
export const CAMPAIGN_ATTENTION_RESOLUTION_CODES = [
  'completed', 'no-longer-applicable', 'superseded-by-authority',
] as const
export type CampaignAttentionResolutionCode = typeof CAMPAIGN_ATTENTION_RESOLUTION_CODES[number]

export const CAMPAIGN_ATTENTION_LIMITS = Object.freeze({
  idChars: 200,
  hrefChars: 1_000,
  actions: 8,
} as const)

export interface CampaignAttentionAuthorityRef {
  readonly kind: CampaignAttentionAuthorityKind
  readonly id: string
  readonly revision: number
}

export interface CampaignAttentionEntityRef {
  readonly kind: CampaignAttentionEntityKind
  readonly id: string
}

export interface CampaignAttentionSourceEventRef {
  readonly kind: CampaignAttentionSourceEventKind
  readonly eventId: string
  readonly campaignMinute: number
}

export interface CampaignAttentionRequiredDecision {
  readonly decisionId: string
  readonly kind: CampaignAttentionDecisionKind
  readonly authority: CampaignAttentionAuthorityRef
}

export interface CampaignAttentionLegalAction {
  readonly actionId: string
  readonly intent: CampaignAttentionActionIntent
  readonly href: string
  readonly authority: CampaignAttentionAuthorityRef
  readonly requiresConfirmation: boolean
}

export interface CampaignAttentionResolution {
  readonly state: CampaignAttentionResolutionState
  readonly revision: number
  readonly code: CampaignAttentionResolutionCode | null
  readonly resolutionEventId: string | null
  readonly resolvedAtCampaignMinute: number | null
}

export interface CampaignAttentionItem {
  readonly schemaVersion: typeof CAMPAIGN_ATTENTION_ITEM_SCHEMA_VERSION
  readonly itemId: string
  readonly reason: CampaignAttentionReason
  readonly audience: CampaignAttentionAudience
  readonly urgency: CampaignAttentionUrgency
  readonly entity: CampaignAttentionEntityRef
  readonly sourceEvent: CampaignAttentionSourceEventRef
  readonly authority: CampaignAttentionAuthorityRef
  readonly requiredDecision: CampaignAttentionRequiredDecision | null
  readonly legalActions: readonly CampaignAttentionLegalAction[]
  readonly resolution: CampaignAttentionResolution
  readonly createdAtCampaignMinute: number
}

export class CampaignAttentionValidationError extends Error {
  constructor(readonly path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'CampaignAttentionValidationError'
  }
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/
const fail = (path: string, message: string): never => { throw new CampaignAttentionValidationError(path, message) }
const object = (value: unknown, path: string): Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : fail(path, 'must be an object.')
)
const exact = (value: Record<string, unknown>, fields: readonly string[], path: string): void => {
  const actual = Object.keys(value).sort()
  const expected = [...fields].sort()
  if (actual.length !== expected.length || actual.some((field, index) => field !== expected[index])) {
    fail(path, `must contain exactly ${fields.join(', ')}.`)
  }
}
const oneOf = <Value extends string>(
  value: unknown,
  values: readonly Value[],
  path: string,
): Value => typeof value === 'string' && values.includes(value as Value)
  ? value as Value
  : fail(path, `must be one of ${values.join(', ')}.`)
const id = (value: unknown, path: string): string => typeof value === 'string' && ID.test(value)
  ? value : fail(path, 'must be a stable bounded identity.')
const integer = (value: unknown, path: string): number => Number.isSafeInteger(value) && Number(value) >= 0
  ? Number(value) : fail(path, 'must be a non-negative safe integer.')
const bool = (value: unknown, path: string): boolean => typeof value === 'boolean'
  ? value : fail(path, 'must be a boolean.')
const text = (value: unknown, path: string, maximum: number): string => {
  if (typeof value !== 'string' || value.trim() !== value || value.length < 1 || value.length > maximum || /\p{C}/u.test(value)) {
    return fail(path, `must be trimmed visible text from 1 through ${maximum} characters.`)
  }
  return value
}
const nullable = <Value>(value: unknown, parse: (input: unknown) => Value): Value | null => value === null ? null : parse(value)
const appHref = (value: unknown, path: string): string => {
  const href = text(value, path, CAMPAIGN_ATTENTION_LIMITS.hrefChars)
  if (!href.startsWith('/') || href.startsWith('//') || href.includes('\\')) {
    fail(path, 'must be one app-relative route.')
  }
  return href
}

const parseAuthority = (value: unknown, path: string): CampaignAttentionAuthorityRef => {
  const input = object(value, path)
  exact(input, ['kind', 'id', 'revision'], path)
  return Object.freeze({
    kind: oneOf(input.kind, CAMPAIGN_ATTENTION_AUTHORITY_KINDS, `${path}.kind`),
    id: id(input.id, `${path}.id`),
    revision: integer(input.revision, `${path}.revision`),
  })
}
const parseEntity = (value: unknown, path: string): CampaignAttentionEntityRef => {
  const input = object(value, path)
  exact(input, ['kind', 'id'], path)
  return Object.freeze({
    kind: oneOf(input.kind, CAMPAIGN_ATTENTION_ENTITY_KINDS, `${path}.kind`),
    id: id(input.id, `${path}.id`),
  })
}
const parseSourceEvent = (value: unknown, path: string): CampaignAttentionSourceEventRef => {
  const input = object(value, path)
  exact(input, ['kind', 'eventId', 'campaignMinute'], path)
  return Object.freeze({
    kind: oneOf(input.kind, CAMPAIGN_ATTENTION_SOURCE_EVENT_KINDS, `${path}.kind`),
    eventId: id(input.eventId, `${path}.eventId`),
    campaignMinute: integer(input.campaignMinute, `${path}.campaignMinute`),
  })
}
const parseDecision = (value: unknown, path: string): CampaignAttentionRequiredDecision => {
  const input = object(value, path)
  exact(input, ['decisionId', 'kind', 'authority'], path)
  return Object.freeze({
    decisionId: id(input.decisionId, `${path}.decisionId`),
    kind: oneOf(input.kind, CAMPAIGN_ATTENTION_DECISION_KINDS, `${path}.kind`),
    authority: parseAuthority(input.authority, `${path}.authority`),
  })
}
const parseAction = (value: unknown, path: string): CampaignAttentionLegalAction => {
  const input = object(value, path)
  exact(input, ['actionId', 'intent', 'href', 'authority', 'requiresConfirmation'], path)
  return Object.freeze({
    actionId: id(input.actionId, `${path}.actionId`),
    intent: oneOf(input.intent, CAMPAIGN_ATTENTION_ACTION_INTENTS, `${path}.intent`),
    href: appHref(input.href, `${path}.href`),
    authority: parseAuthority(input.authority, `${path}.authority`),
    requiresConfirmation: bool(input.requiresConfirmation, `${path}.requiresConfirmation`),
  })
}
const parseResolution = (value: unknown, path: string): CampaignAttentionResolution => {
  const input = object(value, path)
  exact(input, ['state', 'revision', 'code', 'resolutionEventId', 'resolvedAtCampaignMinute'], path)
  const state = oneOf(input.state, CAMPAIGN_ATTENTION_RESOLUTION_STATES, `${path}.state`)
  const revision = integer(input.revision, `${path}.revision`)
  const code = nullable(input.code, row => oneOf(row, CAMPAIGN_ATTENTION_RESOLUTION_CODES, `${path}.code`))
  const resolutionEventId = nullable(input.resolutionEventId, row => id(row, `${path}.resolutionEventId`))
  const resolvedAtCampaignMinute = nullable(input.resolvedAtCampaignMinute, row => integer(row, `${path}.resolvedAtCampaignMinute`))
  if (state === 'open') {
    if (revision !== 0 || code !== null || resolutionEventId !== null || resolvedAtCampaignMinute !== null) {
      fail(path, 'open state must begin at revision zero without resolution evidence.')
    }
  }
  else if (revision < 1 || code === null || resolutionEventId === null || resolvedAtCampaignMinute === null) {
    fail(path, 'terminal state requires a positive revision and complete resolution evidence.')
  }
  if (state === 'superseded' && code !== 'superseded-by-authority') {
    fail(`${path}.code`, 'superseded state requires superseded-by-authority.')
  }
  return Object.freeze({ state, revision, code, resolutionEventId, resolvedAtCampaignMinute })
}

export const parseCampaignAttentionItem = (value: unknown, path = 'campaignAttentionItem'): CampaignAttentionItem => {
  const input = object(value, path)
  exact(input, [
    'schemaVersion', 'itemId', 'reason', 'audience', 'urgency', 'entity',
    'sourceEvent', 'authority', 'requiredDecision', 'legalActions', 'resolution',
    'createdAtCampaignMinute',
  ], path)
  if (input.schemaVersion !== CAMPAIGN_ATTENTION_ITEM_SCHEMA_VERSION) fail(`${path}.schemaVersion`, 'must be 1.')
  if (!Array.isArray(input.legalActions)) {
    fail(`${path}.legalActions`, 'must be an array.')
  }
  const actionInputs = input.legalActions as unknown[]
  if (actionInputs.length > CAMPAIGN_ATTENTION_LIMITS.actions) {
    fail(`${path}.legalActions`, `must contain at most ${CAMPAIGN_ATTENTION_LIMITS.actions} actions.`)
  }
  const legalActions = actionInputs.map((action, index) => parseAction(action, `${path}.legalActions[${index}]`))
  if (new Set(legalActions.map(action => action.actionId)).size !== legalActions.length) {
    fail(`${path}.legalActions`, 'must use unique action identities.')
  }
  const sourceEvent = parseSourceEvent(input.sourceEvent, `${path}.sourceEvent`)
  const createdAtCampaignMinute = integer(input.createdAtCampaignMinute, `${path}.createdAtCampaignMinute`)
  const requiredDecision = nullable(input.requiredDecision, row => parseDecision(row, `${path}.requiredDecision`))
  const resolution = parseResolution(input.resolution, `${path}.resolution`)
  if (resolution.state === 'open' && legalActions.length === 0) {
    fail(`${path}.legalActions`, 'open attention requires at least one current legal action.')
  }
  if (resolution.state !== 'open' && (requiredDecision !== null || legalActions.length !== 0)) {
    fail(path, 'terminal attention cannot retain a required decision or legal next action.')
  }
  if (sourceEvent.campaignMinute > createdAtCampaignMinute) {
    fail(`${path}.createdAtCampaignMinute`, 'cannot precede the immutable source event.')
  }
  if (resolution.resolvedAtCampaignMinute !== null
    && resolution.resolvedAtCampaignMinute < createdAtCampaignMinute) {
    fail(`${path}.resolution.resolvedAtCampaignMinute`, 'cannot precede item creation.')
  }
  return Object.freeze({
    schemaVersion: CAMPAIGN_ATTENTION_ITEM_SCHEMA_VERSION,
    itemId: id(input.itemId, `${path}.itemId`),
    reason: oneOf(input.reason, CAMPAIGN_ATTENTION_REASONS, `${path}.reason`),
    audience: oneOf(input.audience, CAMPAIGN_ATTENTION_AUDIENCES, `${path}.audience`),
    urgency: oneOf(input.urgency, CAMPAIGN_ATTENTION_URGENCIES, `${path}.urgency`),
    entity: parseEntity(input.entity, `${path}.entity`),
    sourceEvent,
    authority: parseAuthority(input.authority, `${path}.authority`),
    requiredDecision,
    legalActions: Object.freeze(legalActions),
    resolution,
    createdAtCampaignMinute,
  })
}

export const createOpenCampaignAttentionItem = (
  input: Omit<CampaignAttentionItem, 'schemaVersion' | 'resolution'>,
): CampaignAttentionItem => parseCampaignAttentionItem({
  ...input,
  schemaVersion: CAMPAIGN_ATTENTION_ITEM_SCHEMA_VERSION,
  resolution: {
    state: 'open', revision: 0, code: null,
    resolutionEventId: null, resolvedAtCampaignMinute: null,
  },
})

export const resolveCampaignAttentionItem = (input: {
  readonly current: CampaignAttentionItem
  readonly state?: 'resolved' | 'superseded'
  readonly code: CampaignAttentionResolutionCode
  readonly resolutionEventId: string
  readonly resolvedAtCampaignMinute: number
}): CampaignAttentionItem => {
  const current = parseCampaignAttentionItem(input.current)
  if (current.resolution.state !== 'open') {
    return fail('campaignAttentionItem.resolution', 'only an open attention item may resolve.')
  }
  return parseCampaignAttentionItem({
    ...current,
    requiredDecision: null,
    legalActions: [],
    resolution: {
      state: input.state ?? 'resolved',
      revision: current.resolution.revision + 1,
      code: input.code,
      resolutionEventId: input.resolutionEventId,
      resolvedAtCampaignMinute: input.resolvedAtCampaignMinute,
    },
  })
}

export const campaignAttentionAuthorityFromSettlement = (
  authority: EncounterSettlementAuthorityRef,
): CampaignAttentionAuthorityRef => Object.freeze({
  kind: authority.kind,
  id: authority.id,
  revision: authority.revision,
})

import { cloneStrictJson, deepFreezeStrictJson, isPlainJsonObject, type StrictJsonObject } from '../automation/strictJson'
import { SLUG_RE } from '../paths'
import type { EquipmentOwnerKind } from './equipment'

export const ITEM_GUIDED_ADJUDICATION_SCHEMA_VERSION = 1 as const
export const ITEM_GUIDED_REQUEST_ID_RE = /^item-guided:v1:[a-f0-9]{32}$/
export const ITEM_GUIDED_OPERATION_ID_RE = /^item-guided-operation:v1:[a-f0-9]{32}$/

export const ITEM_GUIDED_LOYALTY_CHOICE_ID = 'gm-loyalty-outcome' as const
export const ITEM_GUIDED_LOYALTY_NO_CHANGE_OPTION_ID = 'record-no-loyalty-change' as const
export const ITEM_GUIDED_LOYALTY_DECREASE_OPTION_ID = 'lower-loyalty-by-one' as const
export const ITEM_GUIDED_RE_BREATHER_ACTIVATE_OPTION_ID = 'activate-for-one-hour' as const
export const ITEM_GUIDED_RE_BREATHER_REFILL_OPTION_ID = 'begin-open-air-refill' as const
export const ITEM_GUIDED_CAMPAIGN_TOOL_CHOICE_ID = 'gm-campaign-tool-outcome' as const
export const ITEM_GUIDED_CAMPAIGN_TOOL_ACCEPT_OPTION_ID = 'accept-reviewed-use' as const

export type ItemGuidedRequestKind =
  | 'loyalty-consequence'
  | 'campaign-tool-adjudication'
  | 're-breather-activation'
  | 're-breather-refill'
export type ItemGuidedRequestStatus = 'pending' | 'accepted' | 'cancelled'

export interface ItemGuidedDecisionOptionV1 {
  readonly optionId: string
  readonly label: string
  readonly description: string
}

export interface ItemGuidedRequestProjectionV1 {
  readonly schemaVersion: typeof ITEM_GUIDED_ADJUDICATION_SCHEMA_VERSION
  readonly requestId: string
  readonly revision: number
  readonly status: ItemGuidedRequestStatus
  readonly requestKind: ItemGuidedRequestKind
  readonly canonicalItemId: string
  readonly itemLabel: string
  readonly actorLabel: string
  readonly targetLabel: string
  readonly targetKindLabel: 'Pokémon' | 'Trainer'
  readonly timingLabel: string
  readonly prompt: string
  readonly canonicalFacts: readonly string[]
  /** Empty outside an authenticated GM projection. */
  readonly choices: readonly ItemGuidedDecisionOptionV1[]
  readonly settlementFacts: readonly string[]
  readonly reservationLabel: string | null
  readonly boundaryLabel: string
  readonly canCancel: boolean
  readonly acceptedSummary: string | null
}

export type ItemGuidedReBreatherActionKind = 'activate' | 'begin-open-air-refill'

export interface ItemGuidedReBreatherOfferV1 {
  readonly schemaVersion: typeof ITEM_GUIDED_ADJUDICATION_SCHEMA_VERSION
  readonly offerId: string
  readonly canonicalItemId: 'Re-Breather'
  readonly itemLabel: 'Re-Breather'
  readonly ownerKind: EquipmentOwnerKind
  readonly ownerSlug: string
  readonly ownerLabel: string
  readonly actionKind: ItemGuidedReBreatherActionKind
  readonly actionLabel: string
  readonly timingLabel: 'Standard Action' | 'Open-air refill'
  readonly statusLabel: string
  readonly enabled: boolean
  readonly unavailableReason: string | null
}

export interface ItemGuidedAdjudicationProjectionV1 {
  readonly schemaVersion: typeof ITEM_GUIDED_ADJUDICATION_SCHEMA_VERSION
  readonly requests: readonly ItemGuidedRequestProjectionV1[]
  readonly reBreatherOffers: readonly ItemGuidedReBreatherOfferV1[]
}

export interface DeclareItemGuidedReBreatherCommandV1 {
  readonly schemaVersion: typeof ITEM_GUIDED_ADJUDICATION_SCHEMA_VERSION
  readonly operationId: string
  readonly action: 'declare-re-breather'
  readonly ownerKind: EquipmentOwnerKind
  readonly ownerSlug: string
  readonly ownerRevision: number
  readonly offerId: string
}

export interface ResolveItemGuidedRequestCommandV1 {
  readonly schemaVersion: typeof ITEM_GUIDED_ADJUDICATION_SCHEMA_VERSION
  readonly operationId: string
  readonly action: 'resolve'
  readonly requestId: string
  readonly expectedRevision: number
  readonly optionId: string
}

export interface CancelItemGuidedRequestCommandV1 {
  readonly schemaVersion: typeof ITEM_GUIDED_ADJUDICATION_SCHEMA_VERSION
  readonly operationId: string
  readonly action: 'cancel'
  readonly requestId: string
  readonly expectedRevision: number
}

export type ItemGuidedAdjudicationCommandV1 =
  | DeclareItemGuidedReBreatherCommandV1
  | ResolveItemGuidedRequestCommandV1
  | CancelItemGuidedRequestCommandV1

export interface ItemGuidedAdjudicationResultV1 {
  readonly schemaVersion: typeof ITEM_GUIDED_ADJUDICATION_SCHEMA_VERSION
  readonly operationId: string
  readonly request: ItemGuidedRequestProjectionV1
  readonly exactReplay: boolean
}

export type ItemReBreatherModeV1 = 'ready' | 'active' | 'depleted' | 'refilling'

export interface ItemReBreatherTransitionReceiptV1 {
  readonly requestId: string
  readonly transition: 'activated' | 'depleted' | 'refill-started' | 'refilled'
  readonly campaignMinute: number
}

export interface ItemReBreatherStateV1 {
  readonly schemaVersion: typeof ITEM_GUIDED_ADJUDICATION_SCHEMA_VERSION
  readonly mode: ItemReBreatherModeV1
  readonly activeFromCampaignMinute: number | null
  readonly activeUntilCampaignMinute: number | null
  readonly refillStartedAtCampaignMinute: number | null
  readonly refillCompletesAtCampaignMinute: number | null
  readonly lastTransition: ItemReBreatherTransitionReceiptV1 | null
}

export interface ItemGuidedCampaignToolReceiptV1 {
  readonly schemaVersion: typeof ITEM_GUIDED_ADJUDICATION_SCHEMA_VERSION
  readonly sourceOperationId: string
  readonly canonicalItemId: string
  readonly canonicalDefinitionSha256: string
  readonly outcomeOptionId: typeof ITEM_GUIDED_CAMPAIGN_TOOL_ACCEPT_OPTION_ID
  readonly sourceDisposition: 'consumed-one' | 'retained-reusable'
  readonly decidedAt: number
}

export interface ItemGuidedCampaignToolStateV1 {
  readonly schemaVersion: typeof ITEM_GUIDED_ADJUDICATION_SCHEMA_VERSION
  readonly receipts: readonly ItemGuidedCampaignToolReceiptV1[]
}

export interface ItemGuidedLoyaltyReceiptV1 {
  readonly schemaVersion: typeof ITEM_GUIDED_ADJUDICATION_SCHEMA_VERSION
  readonly sourceOperationId: string
  readonly canonicalItemId: string
  readonly canonicalDefinitionSha256: string
  readonly outcome: 'no-change' | 'decrease-one'
  readonly previousLoyalty: number
  readonly currentLoyalty: number
  readonly decidedAt: number
}

export interface ItemGuidedLoyaltyStateV1 {
  readonly schemaVersion: typeof ITEM_GUIDED_ADJUDICATION_SCHEMA_VERSION
  readonly receipts: readonly ItemGuidedLoyaltyReceiptV1[]
}

export class ItemGuidedAdjudicationValidationError extends Error {
  constructor(readonly path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'ItemGuidedAdjudicationValidationError'
  }
}

type UnknownRecord = Record<string, unknown>
const CONTROL = /[\u0000-\u001f\u007f]/u
const SHA256 = /^[a-f0-9]{64}$/
const ITEM_OPERATION_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{7,199}$/
const STATUS = new Set<ItemGuidedRequestStatus>(['pending', 'accepted', 'cancelled'])
const REQUEST_KIND = new Set<ItemGuidedRequestKind>([
  'loyalty-consequence', 'campaign-tool-adjudication',
  're-breather-activation', 're-breather-refill',
])
const OWNER_KIND = new Set<EquipmentOwnerKind>(['trainer', 'pokemon'])
const RE_BREATHER_MODE = new Set<ItemReBreatherModeV1>(['ready', 'active', 'depleted', 'refilling'])

const fail = (path: string, detail: string): never => { throw new ItemGuidedAdjudicationValidationError(path, detail) }
const record = (value: unknown, path: string): UnknownRecord => {
  if (!isPlainJsonObject(value)) fail(path, 'must be a plain object.')
  return value as UnknownRecord
}
const exact = (value: UnknownRecord, fields: readonly string[], path: string): void => {
  const expected = new Set(fields)
  const missing = fields.filter(field => !Object.hasOwn(value, field))
  const unknown = Object.keys(value).filter(field => !expected.has(field))
  if (missing.length || unknown.length) fail(path, `has an invalid shape (missing: ${missing.join(', ') || 'none'}; unknown: ${unknown.join(', ') || 'none'}).`)
}
const text = (value: unknown, path: string, maximum = 500): string => {
  if (typeof value !== 'string' || !value || value !== value.trim() || value.length > maximum || CONTROL.test(value)) {
    fail(path, `must be non-empty trimmed text of at most ${maximum} characters.`)
  }
  return value as string
}
const nullableText = (value: unknown, path: string): string | null => value === null ? null : text(value, path)
const integer = (value: unknown, path: string, maximum = Number.MAX_SAFE_INTEGER): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > maximum) fail(path, `must be a safe integer from 0 through ${maximum}.`)
  return Number(value)
}
const requestId = (value: unknown, path: string): string => {
  const id = text(value, path, 64)
  if (!ITEM_GUIDED_REQUEST_ID_RE.test(id)) fail(path, 'must be an opaque guided-request identity.')
  return id
}
const operationId = (value: unknown, path: string): string => {
  const id = text(value, path, 80)
  if (!ITEM_GUIDED_OPERATION_ID_RE.test(id)) fail(path, 'must be a guided-operation identity.')
  return id
}
const slug = (value: unknown, path: string): string => {
  const result = text(value, path, 200)
  if (!SLUG_RE.test(result)) fail(path, 'must be a valid slug.')
  return result
}
const boolean = (value: unknown, path: string): boolean => typeof value === 'boolean'
  ? value
  : fail(path, 'must be boolean.')
const strings = (value: unknown, path: string, maximum = 16): readonly string[] => {
  if (!Array.isArray(value) || value.length > maximum) fail(path, `must contain at most ${maximum} entries.`)
  return (value as unknown[]).map((entry, index) => text(entry, `${path}[${index}]`))
}
const clone = (value: unknown, root: string): unknown => cloneStrictJson(value, root, {
  limits: { depth: 12, nodes: 4_096, objectFields: 32, arrayEntries: 64, stringLength: 1_000, objectKeyLength: 100 },
  rootLabel: `${root} data`, valueLabel: root,
  failNotJson: (path, detail) => fail(path, detail),
  failLimit: (path, detail) => fail(path, detail),
})

export const parseItemGuidedAdjudicationCommand = (value: unknown): ItemGuidedAdjudicationCommandV1 => {
  const input = record(clone(value, 'itemGuidedCommand'), 'itemGuidedCommand')
  if (input.schemaVersion !== ITEM_GUIDED_ADJUDICATION_SCHEMA_VERSION) fail('itemGuidedCommand.schemaVersion', 'must be 1.')
  const id = operationId(input.operationId, 'itemGuidedCommand.operationId')
  if (input.action === 'declare-re-breather') {
    exact(input, ['schemaVersion', 'operationId', 'action', 'ownerKind', 'ownerSlug', 'ownerRevision', 'offerId'], 'itemGuidedCommand')
    if (typeof input.ownerKind !== 'string' || !OWNER_KIND.has(input.ownerKind as EquipmentOwnerKind)) {
      fail('itemGuidedCommand.ownerKind', 'must be trainer or pokemon.')
    }
    return deepFreezeStrictJson({
      schemaVersion: 1, operationId: id, action: 'declare-re-breather',
      ownerKind: input.ownerKind as EquipmentOwnerKind,
      ownerSlug: slug(input.ownerSlug, 'itemGuidedCommand.ownerSlug'),
      ownerRevision: integer(input.ownerRevision, 'itemGuidedCommand.ownerRevision'),
      offerId: text(input.offerId, 'itemGuidedCommand.offerId', 200),
    })
  }
  if (input.action === 'resolve') {
    exact(input, ['schemaVersion', 'operationId', 'action', 'requestId', 'expectedRevision', 'optionId'], 'itemGuidedCommand')
    return deepFreezeStrictJson({
      schemaVersion: 1, operationId: id, action: 'resolve',
      requestId: requestId(input.requestId, 'itemGuidedCommand.requestId'),
      expectedRevision: integer(input.expectedRevision, 'itemGuidedCommand.expectedRevision'),
      optionId: text(input.optionId, 'itemGuidedCommand.optionId', 200),
    })
  }
  if (input.action === 'cancel') {
    exact(input, ['schemaVersion', 'operationId', 'action', 'requestId', 'expectedRevision'], 'itemGuidedCommand')
    return deepFreezeStrictJson({
      schemaVersion: 1, operationId: id, action: 'cancel',
      requestId: requestId(input.requestId, 'itemGuidedCommand.requestId'),
      expectedRevision: integer(input.expectedRevision, 'itemGuidedCommand.expectedRevision'),
    })
  }
  return fail('itemGuidedCommand.action', 'is unsupported.')
}

const parseDecisionOption = (value: unknown, path: string): ItemGuidedDecisionOptionV1 => {
  const input = record(value, path)
  exact(input, ['optionId', 'label', 'description'], path)
  return { optionId: text(input.optionId, `${path}.optionId`, 200), label: text(input.label, `${path}.label`), description: text(input.description, `${path}.description`) }
}

const parseRequestProjection = (value: unknown, path: string): ItemGuidedRequestProjectionV1 => {
  const input = record(value, path)
  exact(input, [
    'schemaVersion', 'requestId', 'revision', 'status', 'requestKind', 'canonicalItemId',
    'itemLabel', 'actorLabel', 'targetLabel', 'targetKindLabel', 'timingLabel', 'prompt',
    'canonicalFacts', 'choices', 'settlementFacts', 'reservationLabel', 'boundaryLabel',
    'canCancel', 'acceptedSummary',
  ], path)
  if (input.schemaVersion !== 1 || typeof input.status !== 'string' || !STATUS.has(input.status as ItemGuidedRequestStatus)
    || typeof input.requestKind !== 'string' || !REQUEST_KIND.has(input.requestKind as ItemGuidedRequestKind)
    || (input.targetKindLabel !== 'Pokémon' && input.targetKindLabel !== 'Trainer')) fail(path, 'contains unsupported request projection values.')
  if (!Array.isArray(input.choices) || input.choices.length > 16) fail(`${path}.choices`, 'must contain at most 16 choices.')
  const choices = (input.choices as unknown[]).map((entry, index) => parseDecisionOption(entry, `${path}.choices[${index}]`))
  if (new Set(choices.map(choice => choice.optionId)).size !== choices.length) fail(`${path}.choices`, 'must contain unique options.')
  return {
    schemaVersion: 1,
    requestId: requestId(input.requestId, `${path}.requestId`),
    revision: integer(input.revision, `${path}.revision`),
    status: input.status as ItemGuidedRequestStatus,
    requestKind: input.requestKind as ItemGuidedRequestKind,
    canonicalItemId: text(input.canonicalItemId, `${path}.canonicalItemId`, 200),
    itemLabel: text(input.itemLabel, `${path}.itemLabel`),
    actorLabel: text(input.actorLabel, `${path}.actorLabel`),
    targetLabel: text(input.targetLabel, `${path}.targetLabel`),
    targetKindLabel: input.targetKindLabel as 'Pokémon' | 'Trainer',
    timingLabel: text(input.timingLabel, `${path}.timingLabel`),
    prompt: text(input.prompt, `${path}.prompt`, 1_000),
    canonicalFacts: strings(input.canonicalFacts, `${path}.canonicalFacts`),
    choices,
    settlementFacts: strings(input.settlementFacts, `${path}.settlementFacts`),
    reservationLabel: nullableText(input.reservationLabel, `${path}.reservationLabel`),
    boundaryLabel: text(input.boundaryLabel, `${path}.boundaryLabel`, 1_000),
    canCancel: boolean(input.canCancel, `${path}.canCancel`),
    acceptedSummary: nullableText(input.acceptedSummary, `${path}.acceptedSummary`),
  }
}

const parseOffer = (value: unknown, path: string): ItemGuidedReBreatherOfferV1 => {
  const input = record(value, path)
  exact(input, [
    'schemaVersion', 'offerId', 'canonicalItemId', 'itemLabel', 'ownerKind', 'ownerSlug',
    'ownerLabel', 'actionKind', 'actionLabel', 'timingLabel', 'statusLabel', 'enabled',
    'unavailableReason',
  ], path)
  if (input.schemaVersion !== 1 || input.canonicalItemId !== 'Re-Breather' || input.itemLabel !== 'Re-Breather'
    || typeof input.ownerKind !== 'string' || !OWNER_KIND.has(input.ownerKind as EquipmentOwnerKind)
    || (input.actionKind !== 'activate' && input.actionKind !== 'begin-open-air-refill')
    || (input.timingLabel !== 'Standard Action' && input.timingLabel !== 'Open-air refill')) fail(path, 'contains unsupported Re-Breather offer values.')
  return {
    schemaVersion: 1,
    offerId: text(input.offerId, `${path}.offerId`, 200),
    canonicalItemId: 'Re-Breather', itemLabel: 'Re-Breather',
    ownerKind: input.ownerKind as EquipmentOwnerKind,
    ownerSlug: slug(input.ownerSlug, `${path}.ownerSlug`),
    ownerLabel: text(input.ownerLabel, `${path}.ownerLabel`),
    actionKind: input.actionKind as ItemGuidedReBreatherActionKind,
    actionLabel: text(input.actionLabel, `${path}.actionLabel`),
    timingLabel: input.timingLabel as ItemGuidedReBreatherOfferV1['timingLabel'],
    statusLabel: text(input.statusLabel, `${path}.statusLabel`),
    enabled: boolean(input.enabled, `${path}.enabled`),
    unavailableReason: nullableText(input.unavailableReason, `${path}.unavailableReason`),
  }
}

export const parseItemGuidedAdjudicationProjection = (value: unknown): ItemGuidedAdjudicationProjectionV1 => {
  const input = record(clone(value, 'itemGuidedProjection'), 'itemGuidedProjection')
  exact(input, ['schemaVersion', 'requests', 'reBreatherOffers'], 'itemGuidedProjection')
  if (input.schemaVersion !== 1 || !Array.isArray(input.requests) || input.requests.length > 256
    || !Array.isArray(input.reBreatherOffers) || input.reBreatherOffers.length > 64) fail('itemGuidedProjection', 'has invalid collection bounds.')
  return deepFreezeStrictJson({
    schemaVersion: 1,
    requests: (input.requests as unknown[]).map((entry, index) => parseRequestProjection(entry, `itemGuidedProjection.requests[${index}]`)),
    reBreatherOffers: (input.reBreatherOffers as unknown[]).map((entry, index) => parseOffer(entry, `itemGuidedProjection.reBreatherOffers[${index}]`)),
  })
}

export const parseItemGuidedAdjudicationResult = (value: unknown): ItemGuidedAdjudicationResultV1 => {
  const input = record(clone(value, 'itemGuidedResult'), 'itemGuidedResult')
  exact(input, ['schemaVersion', 'operationId', 'request', 'exactReplay'], 'itemGuidedResult')
  if (input.schemaVersion !== 1) fail('itemGuidedResult.schemaVersion', 'must be 1.')
  return deepFreezeStrictJson({
    schemaVersion: 1,
    operationId: operationId(input.operationId, 'itemGuidedResult.operationId'),
    request: parseRequestProjection(input.request, 'itemGuidedResult.request'),
    exactReplay: boolean(input.exactReplay, 'itemGuidedResult.exactReplay'),
  })
}

const nullableMinute = (value: unknown, path: string): number | null => value === null ? null : integer(value, path)

export const initialItemReBreatherState = (): ItemReBreatherStateV1 => Object.freeze({
  schemaVersion: 1,
  mode: 'ready',
  activeFromCampaignMinute: null,
  activeUntilCampaignMinute: null,
  refillStartedAtCampaignMinute: null,
  refillCompletesAtCampaignMinute: null,
  lastTransition: null,
})

export const parseItemReBreatherState = (value: unknown): ItemReBreatherStateV1 => {
  if (value === undefined || (isPlainJsonObject(value) && Object.keys(value).length === 0)) return initialItemReBreatherState()
  const input = record(clone(value, 'itemReBreatherState'), 'itemReBreatherState')
  exact(input, [
    'schemaVersion', 'mode', 'activeFromCampaignMinute', 'activeUntilCampaignMinute',
    'refillStartedAtCampaignMinute', 'refillCompletesAtCampaignMinute', 'lastTransition',
  ], 'itemReBreatherState')
  if (input.schemaVersion !== 1 || typeof input.mode !== 'string' || !RE_BREATHER_MODE.has(input.mode as ItemReBreatherModeV1)) {
    fail('itemReBreatherState', 'has unsupported version or mode.')
  }
  const mode = input.mode as ItemReBreatherModeV1
  const activeFrom = nullableMinute(input.activeFromCampaignMinute, 'itemReBreatherState.activeFromCampaignMinute')
  const activeUntil = nullableMinute(input.activeUntilCampaignMinute, 'itemReBreatherState.activeUntilCampaignMinute')
  const refillStarted = nullableMinute(input.refillStartedAtCampaignMinute, 'itemReBreatherState.refillStartedAtCampaignMinute')
  const refillCompletes = nullableMinute(input.refillCompletesAtCampaignMinute, 'itemReBreatherState.refillCompletesAtCampaignMinute')
  let lastTransition: ItemReBreatherTransitionReceiptV1 | null = null
  if (input.lastTransition !== null) {
    const receipt = record(input.lastTransition, 'itemReBreatherState.lastTransition')
    exact(receipt, ['requestId', 'transition', 'campaignMinute'], 'itemReBreatherState.lastTransition')
    if (!['activated', 'depleted', 'refill-started', 'refilled'].includes(String(receipt.transition))) fail('itemReBreatherState.lastTransition.transition', 'is unsupported.')
    lastTransition = {
      requestId: requestId(receipt.requestId, 'itemReBreatherState.lastTransition.requestId'),
      transition: receipt.transition as ItemReBreatherTransitionReceiptV1['transition'],
      campaignMinute: integer(receipt.campaignMinute, 'itemReBreatherState.lastTransition.campaignMinute'),
    }
  }
  const valid = mode === 'active'
    ? activeFrom !== null && activeUntil === activeFrom + 60 && refillStarted === null && refillCompletes === null
    : mode === 'refilling'
      ? activeFrom === null && activeUntil === null && refillStarted !== null && refillCompletes === refillStarted + 5
      : activeFrom === null && activeUntil === null && refillStarted === null && refillCompletes === null
  if (!valid) fail('itemReBreatherState', 'timing fields do not match its reviewed mode.')
  return deepFreezeStrictJson({
    schemaVersion: 1, mode,
    activeFromCampaignMinute: activeFrom, activeUntilCampaignMinute: activeUntil,
    refillStartedAtCampaignMinute: refillStarted, refillCompletesAtCampaignMinute: refillCompletes,
    lastTransition,
  })
}

export const materializeItemReBreatherState = (input: {
  readonly state: ItemReBreatherStateV1
  readonly campaignMinute: number
}): ItemReBreatherStateV1 => {
  const minute = integer(input.campaignMinute, 'campaignMinute')
  const state = parseItemReBreatherState(input.state)
  if (state.mode === 'active' && state.activeUntilCampaignMinute !== null && minute >= state.activeUntilCampaignMinute) {
    return parseItemReBreatherState({
      ...initialItemReBreatherState(), mode: 'depleted',
      lastTransition: {
        requestId: state.lastTransition?.requestId ?? fail('itemReBreatherState.lastTransition', 'active state requires activation evidence.'),
        transition: 'depleted', campaignMinute: state.activeUntilCampaignMinute,
      },
    })
  }
  if (state.mode === 'refilling' && state.refillCompletesAtCampaignMinute !== null && minute >= state.refillCompletesAtCampaignMinute) {
    return parseItemReBreatherState({
      ...initialItemReBreatherState(), mode: 'ready',
      lastTransition: {
        requestId: state.lastTransition?.requestId ?? fail('itemReBreatherState.lastTransition', 'refilling state requires request evidence.'),
        transition: 'refilled', campaignMinute: state.refillCompletesAtCampaignMinute,
      },
    })
  }
  return state
}

export const parseItemGuidedCampaignToolState = (value: unknown): ItemGuidedCampaignToolStateV1 => {
  if (value === undefined) return Object.freeze({ schemaVersion: 1, receipts: Object.freeze([]) })
  const input = record(clone(value, 'itemGuidedCampaignToolState'), 'itemGuidedCampaignToolState')
  exact(input, ['schemaVersion', 'receipts'], 'itemGuidedCampaignToolState')
  if (input.schemaVersion !== 1 || !Array.isArray(input.receipts) || input.receipts.length > 128) {
    fail('itemGuidedCampaignToolState', 'has invalid version or receipt bounds.')
  }
  const receipts = (input.receipts as unknown[]).map((entry, index): ItemGuidedCampaignToolReceiptV1 => {
    const path = `itemGuidedCampaignToolState.receipts[${index}]`
    const receipt = record(entry, path)
    exact(receipt, [
      'schemaVersion', 'sourceOperationId', 'canonicalItemId', 'canonicalDefinitionSha256',
      'outcomeOptionId', 'sourceDisposition', 'decidedAt',
    ], path)
    if (receipt.schemaVersion !== 1
      || receipt.outcomeOptionId !== ITEM_GUIDED_CAMPAIGN_TOOL_ACCEPT_OPTION_ID
      || (receipt.sourceDisposition !== 'consumed-one' && receipt.sourceDisposition !== 'retained-reusable')) {
      fail(path, 'has unsupported version, outcome, or source disposition.')
    }
    const digest = text(receipt.canonicalDefinitionSha256, `${path}.canonicalDefinitionSha256`, 64)
    if (!SHA256.test(digest)) fail(`${path}.canonicalDefinitionSha256`, 'must be a lowercase SHA-256 digest.')
    const sourceOperationId = text(receipt.sourceOperationId, `${path}.sourceOperationId`, 200)
    if (!ITEM_OPERATION_ID.test(sourceOperationId)) fail(`${path}.sourceOperationId`, 'must be an item operation identity.')
    return {
      schemaVersion: 1,
      sourceOperationId,
      canonicalItemId: text(receipt.canonicalItemId, `${path}.canonicalItemId`, 200),
      canonicalDefinitionSha256: digest,
      outcomeOptionId: ITEM_GUIDED_CAMPAIGN_TOOL_ACCEPT_OPTION_ID,
      sourceDisposition: receipt.sourceDisposition as ItemGuidedCampaignToolReceiptV1['sourceDisposition'],
      decidedAt: integer(receipt.decidedAt, `${path}.decidedAt`),
    }
  })
  if (new Set(receipts.map(receipt => receipt.sourceOperationId)).size !== receipts.length) {
    fail('itemGuidedCampaignToolState.receipts', 'must contain unique operation receipts.')
  }
  return deepFreezeStrictJson({ schemaVersion: 1, receipts })
}

export const parseItemGuidedLoyaltyState = (value: unknown): ItemGuidedLoyaltyStateV1 => {
  if (value === undefined) return Object.freeze({ schemaVersion: 1, receipts: Object.freeze([]) })
  const input = record(clone(value, 'itemGuidedLoyaltyState'), 'itemGuidedLoyaltyState')
  exact(input, ['schemaVersion', 'receipts'], 'itemGuidedLoyaltyState')
  if (input.schemaVersion !== 1 || !Array.isArray(input.receipts) || input.receipts.length > 128) fail('itemGuidedLoyaltyState', 'has invalid version or receipt bounds.')
  const receipts = (input.receipts as unknown[]).map((entry, index): ItemGuidedLoyaltyReceiptV1 => {
    const path = `itemGuidedLoyaltyState.receipts[${index}]`
    const receipt = record(entry, path)
    exact(receipt, [
      'schemaVersion', 'sourceOperationId', 'canonicalItemId', 'canonicalDefinitionSha256',
      'outcome', 'previousLoyalty', 'currentLoyalty', 'decidedAt',
    ], path)
    if (receipt.schemaVersion !== 1 || (receipt.outcome !== 'no-change' && receipt.outcome !== 'decrease-one')) fail(path, 'has unsupported version or outcome.')
    const previous = integer(receipt.previousLoyalty, `${path}.previousLoyalty`, 6)
    const current = integer(receipt.currentLoyalty, `${path}.currentLoyalty`, 6)
    if (current !== (receipt.outcome === 'decrease-one' ? Math.max(0, previous - 1) : previous)) fail(path, 'does not match its bounded Loyalty outcome.')
    const digest = text(receipt.canonicalDefinitionSha256, `${path}.canonicalDefinitionSha256`, 64)
    if (!SHA256.test(digest)) fail(`${path}.canonicalDefinitionSha256`, 'must be a lowercase SHA-256 digest.')
    const sourceOperationId = text(receipt.sourceOperationId, `${path}.sourceOperationId`, 200)
    if (!ITEM_OPERATION_ID.test(sourceOperationId)) fail(`${path}.sourceOperationId`, 'must be an item operation identity.')
    return {
      schemaVersion: 1, sourceOperationId,
      canonicalItemId: text(receipt.canonicalItemId, `${path}.canonicalItemId`, 200),
      canonicalDefinitionSha256: digest,
      outcome: receipt.outcome as ItemGuidedLoyaltyReceiptV1['outcome'],
      previousLoyalty: previous, currentLoyalty: current,
      decidedAt: integer(receipt.decidedAt, `${path}.decidedAt`),
    }
  })
  if (new Set(receipts.map(receipt => receipt.sourceOperationId)).size !== receipts.length) fail('itemGuidedLoyaltyState.receipts', 'must contain unique operation receipts.')
  return deepFreezeStrictJson({ schemaVersion: 1, receipts })
}

export const itemReBreatherStateAsStrictJson = (value: ItemReBreatherStateV1): StrictJsonObject => (
  structuredClone(parseItemReBreatherState(value)) as unknown as StrictJsonObject
)

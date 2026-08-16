import { createHash } from 'node:crypto'
import { parseAbilityEncounterEvent, type AbilityEncounterEvent } from '#shared/abilityAutomation/events'
import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  EQUIPMENT_PROVIDER_RECEIPT_LIMIT,
  createEmptyEquipmentProviderReceiptState,
  parseEquipmentProviderReceiptState,
  type EquipmentProviderReceiptRollV1,
  type EquipmentProviderReceiptV1,
} from '#shared/itemAutomation/equipmentProviderReceipts'
import { parseEncounterState, type EncounterState } from '#shared/moveAutomation/encounterState'
import { recordAcceptedAbilityEvent } from '../abilityAutomation/eventReceipts'
import type { EquipmentEventProviderRoute } from './equipmentEventProviderRouter'

export type EquipmentProviderExecutionStatus =
  | 'applied' | 'no-effect' | 'passed' | 'pending-choice' | 'frequency-spent' | 'duplicate'
export interface EquipmentProviderExecutionResult {
  readonly status: EquipmentProviderExecutionStatus
  readonly event: AbilityEncounterEvent
  readonly effect: EquipmentEventProviderRoute['effect'] | null
  readonly receipt: EquipmentProviderReceiptV1 | null
  readonly encounterState: EncounterState
}
export interface EquipmentProviderEffectAcceptance {
  readonly outcome: 'applied' | 'no-effect'
  /** Bounded strict-JSON reducer evidence. It is digest-bound, not persisted verbatim. */
  readonly evidence?: unknown
  /** Optional encounter update from the same pure reduction. */
  readonly encounterState?: EncounterState
}

export class EquipmentProviderReceiptError extends Error {
  constructor(readonly code:
    | 'route-event-mismatch' | 'event-replay-conflict' | 'scene-anchor-missing'
    | 'invalid-choice' | 'invalid-roll' | 'receipt-limit-exceeded', detail: string) {
    super(detail)
    this.name = 'EquipmentProviderReceiptError'
  }
}
const fail = (code: EquipmentProviderReceiptError['code'], detail: string): never => {
  throw new EquipmentProviderReceiptError(code, detail)
}
const sha256 = (value: unknown, path = 'equipmentProviderReceipt'): string => createHash('sha256')
  .update(stableJsonStringify(value, {
    path,
    limits: { maxDepth: 12, maxNodes: 10_000, maxObjectFields: 64, maxArrayEntries: 256, maxStringLength: 2_000 },
  }))
  .digest('hex')
const eventHash = (event: AbilityEncounterEvent): string => sha256(event, 'equipmentProviderEvent')
const routeHash = (route: EquipmentEventProviderRoute): string => sha256({
  schemaVersion: 1,
  routeId: route.routeId,
  eventId: route.eventId,
  checkpoint: route.checkpoint,
  ownerPlacementId: route.ownerPlacementId,
  providerId: route.providerId,
  providerDefinitionSha256: route.providerDefinitionSha256,
  sourceBindingSha256: route.sourceBindingSha256,
  sourceInstanceRevision: route.sourceInstanceRevision,
  effect: route.effect,
  frequency: route.frequency,
  oncePerCausalChain: route.oncePerCausalChain,
  response: route.response,
  choice: route.choice,
}, 'equipmentProviderRouteReceipt')
const frequencyKey = (route: EquipmentEventProviderRoute, sceneId: string): string => sha256({
  schemaVersion: 1,
  sourceBindingSha256: route.sourceBindingSha256,
  ownerPlacementId: route.ownerPlacementId,
  sceneId,
  frequency: route.frequency.kind,
}, 'equipmentProviderFrequency')
const receiptId = (eventId: string, routeSha256: string): string => (
  `equipment-provider-receipt:v1:${sha256({ eventId, routeSha256 }).slice(0, 32)}`
)
const routeChoice = (input: {
  readonly route: EquipmentEventProviderRoute
  readonly selectedChoiceId?: string | null
}): { readonly status: 'ready'; readonly choiceId: string | null } | { readonly status: 'pending' } => {
  if (input.route.choice.kind === 'automatic') {
    if (input.selectedChoiceId !== undefined && input.selectedChoiceId !== null) {
      fail('invalid-choice', 'Automatic equipment provider received an owner choice.')
    }
    return { status: 'ready', choiceId: null }
  }
  if (input.selectedChoiceId === undefined || input.selectedChoiceId === null) return { status: 'pending' }
  if (!input.route.choice.options.some(option => option.optionId === input.selectedChoiceId)) {
    fail('invalid-choice', 'Equipment provider choice is not currently authorized.')
  }
  return { status: 'ready', choiceId: input.selectedChoiceId }
}
const providerRolls = (input: {
  readonly route: EquipmentEventProviderRoute
  readonly event: AbilityEncounterEvent
  readonly rollDie?: (input: { readonly rollId: string; readonly sides: number }) => number
}): readonly EquipmentProviderReceiptRollV1[] => {
  if (input.route.effect.kind !== 'survive-at-one' || input.route.effect.roll === null) return []
  const rollId = `equipment-provider-roll:v1:${sha256({
    eventId: input.event.eventId,
    routeId: input.route.routeId,
    sourceBindingSha256: input.route.sourceBindingSha256,
  }).slice(0, 32)}`
  const result = input.rollDie?.({ rollId, sides: input.route.effect.roll.sides })
  if (!Number.isSafeInteger(result) || Number(result) < 1 || Number(result) > input.route.effect.roll.sides) {
    fail('invalid-roll', 'Equipment provider random source returned an invalid die result.')
  }
  return [{ rollId, sides: input.route.effect.roll.sides, result: Number(result) }]
}
const survivesRoll = (
  route: EquipmentEventProviderRoute,
  rolls: readonly EquipmentProviderReceiptRollV1[],
): boolean => route.effect.kind !== 'survive-at-one'
  || route.effect.roll === null
  || (rolls[0]?.result ?? 0) >= route.effect.roll.minimum

/**
 * Resolve and receipt one routed provider against an accepted typed event.
 * Existing receipts are returned before source re-authorization or randomness,
 * so retries never reroll and accepted durable effects survive later source loss.
 */
export const executeEquipmentProviderRoute = (input: {
  readonly encounterState: unknown
  readonly event: unknown
  readonly route: EquipmentEventProviderRoute
  readonly selectedChoiceId?: string | null
  readonly rollDie?: (input: { readonly rollId: string; readonly sides: number }) => number
  readonly applyEffect?: (input: {
    readonly event: AbilityEncounterEvent
    readonly route: EquipmentEventProviderRoute
    readonly rolls: readonly EquipmentProviderReceiptRollV1[]
  }) => EquipmentProviderEffectAcceptance
}): EquipmentProviderExecutionResult => {
  const originalState = parseEncounterState(input.encounterState)
  const event = parseAbilityEncounterEvent(input.event)
  if (input.route.eventId !== event.eventId) fail('route-event-mismatch', 'Provider route belongs to a different event.')
  const routeSha256 = routeHash(input.route)
  const eventSha256 = eventHash(event)
  const receipts = parseEquipmentProviderReceiptState(
    originalState.equipmentProviderReceipts ?? createEmptyEquipmentProviderReceiptState(),
  )
  const prior = receipts.entries.find(entry => entry.eventId === event.eventId
    && entry.routeSha256 === routeSha256)
  if (prior) {
    if (prior.eventSha256 !== eventSha256 || prior.eventSequence !== event.sequence) {
      fail('event-replay-conflict', 'Provider event identity was reused with different facts.')
    }
    return Object.freeze({ status: 'duplicate', event, effect: null, receipt: prior, encounterState: originalState })
  }
  const choice = routeChoice({ route: input.route, selectedChoiceId: input.selectedChoiceId })
  if (choice.status === 'pending') {
    return Object.freeze({ status: 'pending-choice', event, effect: null, receipt: null, encounterState: originalState })
  }
  const sceneFrequencyKey = input.route.frequency.kind === 'scene'
    ? event.sceneId === null
      ? fail('scene-anchor-missing', 'Scene-frequency provider requires an accepted scene identity.')
      : frequencyKey(input.route, event.sceneId)
    : null
  if (sceneFrequencyKey && receipts.entries.some(entry => (
    entry.frequencyKeySha256 === sceneFrequencyKey
    && (entry.outcome === 'applied'
      || (input.route.frequency.consume === 'on-matched' && entry.outcome === 'no-effect'))
  ))) {
    return Object.freeze({ status: 'frequency-spent', event, effect: null, receipt: null, encounterState: originalState })
  }
  const rolls = providerRolls({ route: input.route, event, rollDie: input.rollDie })
  const passed = choice.choiceId === 'pass'
  const rollApplied = survivesRoll(input.route, rolls)
  let accepted: EquipmentProviderEffectAcceptance = { outcome: 'no-effect' }
  if (!passed && rollApplied) {
    accepted = input.applyEffect?.({ event, route: input.route, rolls }) ?? { outcome: 'applied' }
  }
  const outcome: EquipmentProviderReceiptV1['outcome'] = passed
    ? 'passed'
    : accepted.outcome
  let state = accepted.encounterState ? parseEncounterState(accepted.encounterState) : originalState
  // Bind the authoritative event once. Duplicate status is expected for a
  // second provider routed from the same accepted event.
  state = recordAcceptedAbilityEvent(state, event).encounterState
  const currentReceipts = parseEquipmentProviderReceiptState(
    state.equipmentProviderReceipts ?? createEmptyEquipmentProviderReceiptState(),
  )
  if (currentReceipts.entries.length >= EQUIPMENT_PROVIDER_RECEIPT_LIMIT) {
    fail('receipt-limit-exceeded', 'Equipment provider receipt budget is exhausted.')
  }
  const effectSha256 = sha256({
    schemaVersion: 1,
    effect: input.route.effect,
    outcome,
    choiceId: choice.choiceId,
    rolls,
    evidence: accepted.evidence ?? null,
  }, 'equipmentProviderAcceptedEffect')
  const receipt: EquipmentProviderReceiptV1 = {
    receiptId: receiptId(event.eventId, routeSha256),
    eventId: event.eventId,
    eventSequence: event.sequence,
    eventSha256,
    routeSha256,
    frequencyKeySha256: sceneFrequencyKey,
    sceneId: event.sceneId,
    outcome,
    choiceId: choice.choiceId,
    rolls,
    effectSha256,
  }
  const equipmentProviderReceipts = parseEquipmentProviderReceiptState({
    schemaVersion: 1,
    entries: [...currentReceipts.entries, receipt],
  })
  state = parseEncounterState({ ...state, equipmentProviderReceipts })
  return Object.freeze({
    status: outcome,
    event,
    effect: outcome === 'applied' ? input.route.effect : null,
    receipt,
    encounterState: state,
  })
}

/** Privacy-safe accepted replay lookup that requires no current source. */
export const replayAcceptedEquipmentProviderEvent = (input: {
  readonly encounterState: unknown
  readonly event: unknown
}): readonly EquipmentProviderReceiptV1[] => {
  const state = parseEncounterState(input.encounterState)
  const event = parseAbilityEncounterEvent(input.event)
  const hash = eventHash(event)
  const entries = (state.equipmentProviderReceipts?.entries ?? [])
    .filter(entry => entry.eventId === event.eventId)
  if (entries.some(entry => entry.eventSha256 !== hash || entry.eventSequence !== event.sequence)) {
    fail('event-replay-conflict', 'Provider event identity was reused with different facts.')
  }
  return Object.freeze([...entries])
}

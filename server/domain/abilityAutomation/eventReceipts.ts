import { createHash } from 'node:crypto'
import {
  ABILITY_EVENT_RECEIPT_LIMIT,
  createEmptyAbilityEventReceiptState,
  parseAbilityEventReceiptState,
} from '#shared/abilityAutomation/eventReceipts'
import {
  parseAbilityEncounterEvent,
  type AbilityEncounterEvent,
} from '#shared/abilityAutomation/events'
import { stableJsonStringify } from '#shared/automation/stableJson'
import { parseEncounterState, type EncounterState } from '#shared/moveAutomation/encounterState'

export type AbilityEventEmissionStatus = 'emitted' | 'duplicate'

export interface AbilityEventEmissionResult {
  readonly status: AbilityEventEmissionStatus
  readonly event: AbilityEncounterEvent | null
  readonly encounterState: EncounterState
}

export type AbilityEventEmissionErrorCode =
  | 'event-replay-conflict'
  | 'event-receipt-limit-exceeded'

export class AbilityEventEmissionError extends Error {
  readonly code: AbilityEventEmissionErrorCode

  constructor(code: AbilityEventEmissionErrorCode, detail: string) {
    super(detail)
    this.name = 'AbilityEventEmissionError'
    this.code = code
  }
}

const fail = (code: AbilityEventEmissionErrorCode, detail: string): never => {
  throw new AbilityEventEmissionError(code, detail)
}

const eventHash = (event: AbilityEncounterEvent): string => createHash('sha256')
  .update(stableJsonStringify(event))
  .digest('hex')

/**
 * Attach an accepted derived event receipt to the same encounter value as its
 * reducer outcome. A retry returns no event, preventing trigger duplication.
 */
export const recordAcceptedAbilityEvent = (
  encounterValue: unknown,
  eventValue: unknown,
): AbilityEventEmissionResult => {
  const encounterState = parseEncounterState(encounterValue)
  const event = parseAbilityEncounterEvent(eventValue)
  const receipts = parseAbilityEventReceiptState(
    encounterState.abilityEventReceipts ?? createEmptyAbilityEventReceiptState(),
  )
  const applicationId = event.kind === 'hp'
    || event.kind === 'condition'
    || event.kind === 'combat-stage'
    || event.kind === 'stat'
    || event.kind === 'movement'
    || event.kind === 'presence'
    || event.kind === 'initiative'
    || event.kind === 'item'
    || event.kind === 'field'
    ? event.payload.applicationId
    : event.eventId
  const hash = eventHash(event)
  const priorApplication = receipts.entries.find(entry => entry.applicationId === applicationId)
  const priorEvent = receipts.entries.find(entry => entry.eventId === event.eventId)
  if (priorApplication || priorEvent) {
    if (
      priorApplication !== priorEvent
      || priorApplication?.eventSha256 !== hash
      || priorApplication.eventSequence !== event.sequence
    ) fail('event-replay-conflict', 'Derived event identity was reused with different facts.')
    return Object.freeze({ status: 'duplicate', event: null, encounterState })
  }
  if (receipts.entries.length >= ABILITY_EVENT_RECEIPT_LIMIT) {
    fail('event-receipt-limit-exceeded', 'Derived event receipt budget is exhausted.')
  }
  const abilityEventReceipts = parseAbilityEventReceiptState({
    schemaVersion: 1,
    entries: [...receipts.entries, {
      applicationId,
      eventId: event.eventId,
      eventSha256: hash,
      eventSequence: event.sequence,
    }],
  })
  return Object.freeze({
    status: 'emitted',
    event,
    encounterState: parseEncounterState({ ...encounterState, abilityEventReceipts }),
  })
}

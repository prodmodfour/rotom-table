import { stableJsonStringify } from '../automation/stableJson'
import type { AcceptedEncounterPresentation } from '../encounterPresentation/contracts'

export const ENCOUNTER_ACCEPTED_QUEUE_LIMIT = 512 as const

export type EncounterAcceptedDeliverySource = 'local-http' | 'realtime' | 'replay' | 'snapshot'

export interface EncounterAcceptedQueueEntry {
  readonly presentation: AcceptedEncounterPresentation
  readonly deliverySource: EncounterAcceptedDeliverySource
  readonly firstDeliverySequence: number
  readonly lastDeliverySequence: number
  readonly settled: boolean
}

export interface EncounterAcceptedQueueState {
  readonly mapSlug: string
  readonly adoptedRevision: number
  readonly nextDeliverySequence: number
  readonly entries: readonly EncounterAcceptedQueueEntry[]
}

export type EncounterAcceptedQueueEvent =
  | {
      readonly type: 'delivered'
      readonly presentation: AcceptedEncounterPresentation
      readonly source: Exclude<EncounterAcceptedDeliverySource, 'snapshot'>
    }
  | {
      readonly type: 'snapshot-adopted'
      readonly mapSlug: string
      readonly mapRevision: number
      readonly presentations: readonly AcceptedEncounterPresentation[]
      readonly replace: boolean
    }
  | { readonly type: 'settled', readonly presentationId: string }
  | { readonly type: 'cleared', readonly mapSlug: string, readonly mapRevision: number }

export const createEncounterAcceptedQueue = (
  mapSlug: string,
  adoptedRevision = 0,
): EncounterAcceptedQueueState => ({
  mapSlug,
  adoptedRevision,
  nextDeliverySequence: 1,
  entries: [],
})

const sourcePriority: Readonly<Record<EncounterAcceptedDeliverySource, number>> = Object.freeze({
  'local-http': 4,
  realtime: 3,
  replay: 2,
  snapshot: 1,
})

const ordered = (entries: readonly EncounterAcceptedQueueEntry[]): EncounterAcceptedQueueEntry[] => [...entries]
  .sort((left, right) => (
    left.presentation.revision - right.presentation.revision
    || left.presentation.causal.depth - right.presentation.causal.depth
    || left.presentation.causal.sequence - right.presentation.causal.sequence
    || left.presentation.presentationId.localeCompare(right.presentation.presentationId)
  ))
  .slice(-ENCOUNTER_ACCEPTED_QUEUE_LIMIT)

const assertPresentation = (
  state: EncounterAcceptedQueueState,
  presentation: AcceptedEncounterPresentation,
): void => {
  if (presentation.mapSlug !== state.mapSlug) {
    throw new Error(`Accepted presentation belongs to ${presentation.mapSlug}, not ${state.mapSlug}.`)
  }
  if (presentation.revision < presentation.previousRevision) {
    throw new Error('Accepted presentation revision cannot precede its previous revision.')
  }
}

const mergeDelivery = (
  state: EncounterAcceptedQueueState,
  presentation: AcceptedEncounterPresentation,
  source: EncounterAcceptedDeliverySource,
): EncounterAcceptedQueueState => {
  assertPresentation(state, presentation)
  const existing = state.entries.find(entry => entry.presentation.presentationId === presentation.presentationId)
  const sequence = state.nextDeliverySequence
  if (existing) {
    if (stableJsonStringify(existing.presentation) !== stableJsonStringify(presentation)) {
      throw new Error(`Accepted presentation ${presentation.presentationId} changed across deliveries.`)
    }
    const replacement: EncounterAcceptedQueueEntry = {
      ...existing,
      deliverySource: sourcePriority[source] > sourcePriority[existing.deliverySource]
        ? source
        : existing.deliverySource,
      lastDeliverySequence: sequence,
    }
    return {
      ...state,
      adoptedRevision: Math.max(state.adoptedRevision, presentation.revision),
      nextDeliverySequence: sequence + 1,
      entries: state.entries.map(entry => entry === existing ? replacement : entry),
    }
  }
  return {
    ...state,
    adoptedRevision: Math.max(state.adoptedRevision, presentation.revision),
    nextDeliverySequence: sequence + 1,
    entries: ordered([...state.entries, {
      presentation,
      deliverySource: source,
      firstDeliverySequence: sequence,
      lastDeliverySequence: sequence,
      settled: false,
    }]),
  }
}

export const reduceEncounterAcceptedQueue = (
  state: EncounterAcceptedQueueState,
  event: EncounterAcceptedQueueEvent,
): EncounterAcceptedQueueState => {
  if (event.type === 'cleared') return createEncounterAcceptedQueue(event.mapSlug, event.mapRevision)
  if (event.type === 'settled') {
    let found = false
    const entries = state.entries.map((entry) => {
      if (entry.presentation.presentationId !== event.presentationId) return entry
      found = true
      return entry.settled ? entry : { ...entry, settled: true }
    })
    if (!found) throw new Error(`Cannot settle unknown accepted presentation ${event.presentationId}.`)
    return { ...state, entries }
  }
  if (event.type === 'delivered') return mergeDelivery(state, event.presentation, event.source)
  if (event.mapSlug !== state.mapSlug) {
    if (!event.replace) throw new Error('A different-map snapshot must replace the accepted queue.')
    let replaced = createEncounterAcceptedQueue(event.mapSlug, event.mapRevision)
    for (const presentation of event.presentations) replaced = mergeDelivery(replaced, presentation, 'snapshot')
    return { ...replaced, adoptedRevision: event.mapRevision }
  }
  if (event.mapRevision < state.adoptedRevision) throw new Error('Accepted snapshot revision is stale.')
  let next = event.replace
    ? createEncounterAcceptedQueue(state.mapSlug, event.mapRevision)
    : { ...state, adoptedRevision: event.mapRevision }
  const previouslySettled = new Set(state.entries.filter(entry => entry.settled).map(entry => entry.presentation.presentationId))
  for (const presentation of event.presentations) next = mergeDelivery(next, presentation, 'snapshot')
  if (event.replace && previouslySettled.size > 0) {
    next = {
      ...next,
      entries: next.entries.map(entry => previouslySettled.has(entry.presentation.presentationId)
        ? { ...entry, settled: true }
        : entry),
    }
  }
  return { ...next, adoptedRevision: event.mapRevision }
}

export const nextEncounterAcceptedPresentation = (
  state: EncounterAcceptedQueueState,
): AcceptedEncounterPresentation | null => (
  state.entries.find(entry => !entry.settled)?.presentation ?? null
)

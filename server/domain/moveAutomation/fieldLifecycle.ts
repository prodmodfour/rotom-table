import { createHash } from 'node:crypto'
import {
  ENCOUNTER_ZONE_LIMITS,
  isEncounterGlobalFieldZone,
  parseEncounterZone,
  parseEncounterZones,
  type EncounterGlobalFieldKind,
  type EncounterGlobalFieldZone,
  type EncounterZone,
  type EncounterZoneDuration,
  type EncounterZoneOperationSource,
} from '#shared/moveAutomation/encounterZones'
import type { EncounterSideId } from '#shared/moveAutomation/encounterState'

export const GLOBAL_FIELD_DEFAULT_PRIORITY = 0 as const

export const GLOBAL_FIELD_REPLACEMENT_SCOPES = ['group', 'kind', 'category'] as const
export type GlobalFieldReplacementScope = (typeof GLOBAL_FIELD_REPLACEMENT_SCOPES)[number]

export const GLOBAL_FIELD_TRANSITION_KINDS = [
  'added',
  'replaced',
  'retained',
  'prevented',
  'activated',
  'duration-decremented',
  'expired',
  'removed',
  'suppression-cleared',
] as const
export type GlobalFieldTransitionKind = (typeof GLOBAL_FIELD_TRANSITION_KINDS)[number]

export type GlobalFieldTransitionReasonCode =
  | 'field-added'
  | 'field-replaced'
  | 'field-already-current'
  | 'field-priority-prevented'
  | 'field-room-activated'
  | 'field-duration-decremented'
  | 'field-duration-expired'
  | 'field-scene-expired'
  | 'field-gm-duration-correction'
  | 'field-explicitly-removed'
  | 'field-suppression-source-removed'

export interface GlobalFieldTransition {
  readonly zoneId: string
  readonly fieldKind: EncounterGlobalFieldKind
  readonly fieldId: string
  readonly kind: GlobalFieldTransitionKind
  readonly reasonCode: GlobalFieldTransitionReasonCode
  readonly previous: EncounterGlobalFieldZone | null
  readonly current: EncounterGlobalFieldZone | null
  /** Replacement is one decision even when a category-level policy removes several fields. */
  readonly replacedZoneIds: readonly string[]
}

export interface GlobalFieldLifecycleResult {
  readonly zones: readonly EncounterZone[]
  readonly changed: boolean
  readonly transitions: readonly GlobalFieldTransition[]
}

export type GlobalFieldLifecycleEvent =
  | { readonly kind: 'round-start' | 'round-end' | 'scene-end' }
  | { readonly kind: 'gm-duration-correction'; readonly amount: number }

export type GlobalFieldLifecycleErrorCode =
  | 'invalid-field-zone'
  | 'invalid-duration-correction'
  | 'zone-limit-exceeded'

export class GlobalFieldLifecycleError extends Error {
  readonly code: GlobalFieldLifecycleErrorCode

  constructor(code: GlobalFieldLifecycleErrorCode, message: string) {
    super(message)
    this.name = 'GlobalFieldLifecycleError'
    this.code = code
  }
}

const fail = (code: GlobalFieldLifecycleErrorCode, message: string): never => {
  throw new GlobalFieldLifecycleError(code, message)
}

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

export const encounterGlobalFieldId = (zone: EncounterGlobalFieldZone): string => {
  if (zone.kind === 'weather') return zone.payload.weatherId
  if (zone.kind === 'terrain') return zone.payload.terrainId
  return zone.payload.roomId
}

const parsedGlobalField = (zone: EncounterZone, label: string): EncounterGlobalFieldZone => {
  const parsed = parseEncounterZone(zone, label)
  if (!isEncounterGlobalFieldZone(parsed)) {
    return fail('invalid-field-zone', `${label} must be a battlefield-wide Weather, Terrain, or Room zone.`)
  }
  return parsed
}

const fieldZoneId = (
  kind: EncounterGlobalFieldKind,
  replacementGroup: string,
): string => {
  const digest = createHash('sha256')
    .update(`${kind}\u0000${replacementGroup}`, 'utf8')
    .digest('hex')
    .slice(0, 32)
  return `zone.field.${kind}.${digest}`
}

/** Build one strict server-owned global field instance with no concrete mechanics yet. */
export const createEncounterGlobalFieldZone = (input: {
  readonly kind: EncounterGlobalFieldKind
  readonly fieldId: string
  readonly source: EncounterZoneOperationSource
  readonly sideId: EncounterSideId | null
  readonly duration: EncounterZoneDuration
  readonly replacementGroup: string
  readonly priority?: number
  readonly startsNextRound?: boolean
}): EncounterGlobalFieldZone => {
  const common = {
    id: fieldZoneId(input.kind, input.replacementGroup),
    kind: input.kind,
    source: input.source,
    sideId: input.sideId,
    geometry: { kind: 'battlefield' as const },
    layer: 1,
    duration: input.duration,
    stacking: { kind: 'replace' as const, maxLayers: null },
    fieldPolicy: {
      priority: input.priority ?? GLOBAL_FIELD_DEFAULT_PRIORITY,
      replacementGroup: input.replacementGroup,
      suppression: { sources: [] },
    },
    hooks: { entry: [], exit: [] },
    modifiers: { targeting: [], damage: [], movement: [] },
    tags: ['global-field', input.kind, input.fieldId],
  }
  const zone = input.kind === 'weather'
    ? { ...common, kind: input.kind, payload: { weatherId: input.fieldId } }
    : input.kind === 'terrain'
      ? { ...common, kind: input.kind, payload: { terrainId: input.fieldId } }
      : {
          ...common,
          kind: input.kind,
          payload: {
            roomId: input.fieldId,
            startsNextRound: input.startsNextRound ?? false,
          },
        }
  return parsedGlobalField(zone as EncounterZone, 'globalField.zone')
}

const fieldMatchesReplacement = (
  candidate: EncounterGlobalFieldZone,
  incoming: EncounterGlobalFieldZone,
  scope: GlobalFieldReplacementScope,
): boolean => {
  const sameIdentity = candidate.kind === incoming.kind
    && encounterGlobalFieldId(candidate) === encounterGlobalFieldId(incoming)
  if (sameIdentity) return true
  if (scope === 'kind') return false
  if (scope === 'category') return candidate.kind === incoming.kind
  return candidate.fieldPolicy.replacementGroup === incoming.fieldPolicy.replacementGroup
}

const activeForPriority = (zone: EncounterGlobalFieldZone): boolean => (
  zone.fieldPolicy.suppression.sources.length === 0
)

const transition = (input: Omit<GlobalFieldTransition, 'replacedZoneIds'> & {
  readonly replacedZoneIds?: readonly string[]
}): GlobalFieldTransition => deepFreeze({
  ...input,
  replacedZoneIds: [...(input.replacedZoneIds ?? [])],
})

const sameJson = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right)

const clearRemovedSuppressionSources = (
  zones: readonly EncounterZone[],
  removedZoneIds: ReadonlySet<string>,
): {
  readonly zones: readonly EncounterZone[]
  readonly transitions: readonly GlobalFieldTransition[]
} => {
  if (removedZoneIds.size === 0) return { zones, transitions: [] }
  const transitions: GlobalFieldTransition[] = []
  const current = zones.map((zone): EncounterZone => {
    if (!isEncounterGlobalFieldZone(zone)) return zone
    const sources = zone.fieldPolicy.suppression.sources.filter(
      source => !removedZoneIds.has(source.zoneId),
    )
    if (sources.length === zone.fieldPolicy.suppression.sources.length) return zone
    const next = parsedGlobalField({
      ...zone,
      fieldPolicy: {
        ...zone.fieldPolicy,
        suppression: { sources },
      },
    }, `globalField.suppression.${zone.id}`)
    transitions.push(transition({
      zoneId: zone.id,
      fieldKind: zone.kind,
      fieldId: encounterGlobalFieldId(zone),
      kind: 'suppression-cleared',
      reasonCode: 'field-suppression-source-removed',
      previous: zone,
      current: next,
    }))
    return next
  })
  return { zones: current, transitions }
}

const lifecycleResult = (
  zones: readonly EncounterZone[],
  transitions: readonly GlobalFieldTransition[],
  changed = transitions.some(entry => entry.kind !== 'retained' && entry.kind !== 'prevented'),
): GlobalFieldLifecycleResult => deepFreeze({
  zones: parseEncounterZones(zones, 'globalFieldLifecycle.zones'),
  changed,
  transitions,
})

/**
 * Apply one reviewed field with one deterministic priority/replacement decision.
 * Equal priority is last-authoritative-application wins; a lower priority leaves
 * the complete prior field set untouched.
 */
export const applyEncounterGlobalField = (input: {
  readonly zones: readonly EncounterZone[]
  readonly incoming: EncounterGlobalFieldZone
  readonly replacementScope: GlobalFieldReplacementScope
}): GlobalFieldLifecycleResult => {
  const zones = parseEncounterZones(input.zones, 'globalFieldApply.zones')
  const incoming = parsedGlobalField(input.incoming, 'globalFieldApply.incoming')
  const candidates = zones.filter(isEncounterGlobalFieldZone).filter(candidate => (
    fieldMatchesReplacement(candidate, incoming, input.replacementScope)
  ))
  const blocker = candidates
    .filter(activeForPriority)
    .sort((left, right) => (
      right.fieldPolicy.priority - left.fieldPolicy.priority
      || left.id.localeCompare(right.id)
    ))[0]
  if (blocker && blocker.fieldPolicy.priority > incoming.fieldPolicy.priority) {
    return lifecycleResult(zones, [transition({
      zoneId: incoming.id,
      fieldKind: incoming.kind,
      fieldId: encounterGlobalFieldId(incoming),
      kind: 'prevented',
      reasonCode: 'field-priority-prevented',
      previous: blocker,
      current: blocker,
      replacedZoneIds: [],
    })], false)
  }

  if (candidates.length === 1 && sameJson(candidates[0], incoming)) {
    return lifecycleResult(zones, [transition({
      zoneId: incoming.id,
      fieldKind: incoming.kind,
      fieldId: encounterGlobalFieldId(incoming),
      kind: 'retained',
      reasonCode: 'field-already-current',
      previous: candidates[0]!,
      current: candidates[0]!,
    })], false)
  }

  const candidateIds = new Set(candidates.map(candidate => candidate.id))
  const firstCandidateIndex = zones.findIndex(zone => candidateIds.has(zone.id))
  const retained = zones.filter(zone => !candidateIds.has(zone.id))
  const insertionIndex = firstCandidateIndex < 0 ? retained.length : firstCandidateIndex
  retained.splice(insertionIndex, 0, incoming)
  const removedIds = new Set(
    candidates.map(candidate => candidate.id).filter(id => id !== incoming.id),
  )
  const cleaned = clearRemovedSuppressionSources(retained, removedIds)
  const previous = candidates.find(candidate => candidate.id === incoming.id)
    ?? candidates[0]
    ?? null
  const applied = transition({
    zoneId: incoming.id,
    fieldKind: incoming.kind,
    fieldId: encounterGlobalFieldId(incoming),
    kind: candidates.length === 0 ? 'added' : 'replaced',
    reasonCode: candidates.length === 0 ? 'field-added' : 'field-replaced',
    previous,
    current: incoming,
    replacedZoneIds: candidates.map(candidate => candidate.id),
  })
  return lifecycleResult(cleaned.zones, [applied, ...cleaned.transitions])
}

/** Remove an exact reviewed set and clear suppression links that it owned. */
export const removeEncounterGlobalFields = (input: {
  readonly zones: readonly EncounterZone[]
  readonly matches: (zone: EncounterGlobalFieldZone) => boolean
}): GlobalFieldLifecycleResult => {
  const zones = parseEncounterZones(input.zones, 'globalFieldRemove.zones')
  const removed = zones.filter(isEncounterGlobalFieldZone).filter(input.matches)
  if (removed.length === 0) return lifecycleResult(zones, [], false)
  const removedIds = new Set(removed.map(zone => zone.id))
  const retained = zones.filter(zone => !removedIds.has(zone.id))
  const cleaned = clearRemovedSuppressionSources(retained, removedIds)
  const transitions = removed.map(zone => transition({
    zoneId: zone.id,
    fieldKind: zone.kind,
    fieldId: encounterGlobalFieldId(zone),
    kind: 'removed',
    reasonCode: 'field-explicitly-removed',
    previous: zone,
    current: null,
  }))
  return lifecycleResult(cleaned.zones, [...transitions, ...cleaned.transitions])
}

const decrementedField = (
  zone: EncounterGlobalFieldZone,
  amount: number,
  correction: boolean,
): { readonly current: EncounterGlobalFieldZone | null; readonly transition: GlobalFieldTransition } => {
  if (zone.duration.kind !== 'rounds') throw new Error('decrementedField requires a fixed duration.')
  if (zone.duration.remaining <= amount) {
    return {
      current: null,
      transition: transition({
        zoneId: zone.id,
        fieldKind: zone.kind,
        fieldId: encounterGlobalFieldId(zone),
        kind: 'expired',
        reasonCode: 'field-duration-expired',
        previous: zone,
        current: null,
      }),
    }
  }
  const current = parsedGlobalField({
    ...zone,
    duration: { ...zone.duration, remaining: zone.duration.remaining - amount },
  }, `globalField.duration.${zone.id}`)
  return {
    current,
    transition: transition({
      zoneId: zone.id,
      fieldKind: zone.kind,
      fieldId: encounterGlobalFieldId(zone),
      kind: 'duration-decremented',
      reasonCode: correction
        ? 'field-gm-duration-correction'
        : 'field-duration-decremented',
      previous: zone,
      current,
    }),
  }
}

/** Advance only global fields from an authoritative boundary or typed GM correction. */
export const advanceEncounterGlobalFields = (input: {
  readonly zones: readonly EncounterZone[]
  readonly event: GlobalFieldLifecycleEvent
}): GlobalFieldLifecycleResult => {
  if (
    input.event.kind === 'gm-duration-correction'
    && (!Number.isSafeInteger(input.event.amount) || input.event.amount < 1)
  ) {
    return fail('invalid-duration-correction', 'GM field-duration correction amount must be a positive safe integer.')
  }
  const zones = parseEncounterZones(input.zones, 'globalFieldAdvance.zones')
  const current: EncounterZone[] = []
  const transitions: GlobalFieldTransition[] = []
  const removedIds = new Set<string>()

  for (const zone of zones) {
    if (!isEncounterGlobalFieldZone(zone)) {
      current.push(zone)
      continue
    }

    if (
      zone.kind === 'room'
      && zone.payload.startsNextRound
      && input.event.kind === 'round-start'
    ) {
      const activated = parsedGlobalField({
        ...zone,
        payload: { ...zone.payload, startsNextRound: false },
      }, `globalField.activation.${zone.id}`)
      current.push(activated)
      transitions.push(transition({
        zoneId: zone.id,
        fieldKind: zone.kind,
        fieldId: zone.payload.roomId,
        kind: 'activated',
        reasonCode: 'field-room-activated',
        previous: zone,
        current: activated,
      }))
      continue
    }

    if (
      zone.kind === 'room'
      && zone.payload.startsNextRound
      && input.event.kind !== 'gm-duration-correction'
    ) {
      current.push(zone)
      continue
    }

    if (input.event.kind === 'scene-end' && zone.duration.kind === 'scene') {
      transitions.push(transition({
        zoneId: zone.id,
        fieldKind: zone.kind,
        fieldId: encounterGlobalFieldId(zone),
        kind: 'expired',
        reasonCode: 'field-scene-expired',
        previous: zone,
        current: null,
      }))
      removedIds.add(zone.id)
      continue
    }

    const correction = input.event.kind === 'gm-duration-correction'
    const boundary = input.event.kind === 'round-start'
      ? 'start'
      : input.event.kind === 'round-end'
        ? 'end'
        : null
    const shouldDecrement = zone.duration.kind === 'rounds' && (
      correction || zone.duration.boundary === boundary
    )
    if (!shouldDecrement) {
      current.push(zone)
      continue
    }

    const outcome = decrementedField(
      zone,
      correction ? input.event.amount : 1,
      correction,
    )
    transitions.push(outcome.transition)
    if (outcome.current) current.push(outcome.current)
    else removedIds.add(zone.id)
  }

  const cleaned = clearRemovedSuppressionSources(current, removedIds)
  if (current.length > ENCOUNTER_ZONE_LIMITS.count) {
    return fail(
      'zone-limit-exceeded',
      `Global field lifecycle cannot exceed ${ENCOUNTER_ZONE_LIMITS.count} zones.`,
    )
  }
  return lifecycleResult(cleaned.zones, [...transitions, ...cleaned.transitions])
}

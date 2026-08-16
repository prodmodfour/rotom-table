import { createHash } from 'node:crypto'
import {
  parseAbilityEncounterEvent,
  type AbilityEncounterEvent,
  type AbilityEventCheckpoint,
} from '#shared/abilityAutomation/events'
import { stableJsonStringify } from '#shared/automation/stableJson'
import type { EquipmentProviderEffectV1 } from '#shared/itemAutomation/equipmentEventProviders'
import type {
  ResolvedEquipmentEventProvider,
  ResolveEquipmentEventProvidersResult,
} from './equipmentEventProviders'

export const EQUIPMENT_PROVIDER_ROUTE_LIMIT = 2_048 as const
export interface EquipmentEventProviderRoutingPlacement {
  readonly placementId: string
  readonly providers: ResolveEquipmentEventProvidersResult | null
}
export interface EquipmentEventProviderRoute {
  readonly routeId: string
  readonly eventId: string
  readonly checkpoint: AbilityEventCheckpoint
  readonly ownerPlacementId: string
  readonly providerId: string
  readonly label: string
  readonly priority: number
  readonly response: 'mandatory' | 'optional'
  readonly choice: ResolvedEquipmentEventProvider['provider']['choice']
  readonly frequency: ResolvedEquipmentEventProvider['provider']['frequency']
  readonly privacy: ResolvedEquipmentEventProvider['provider']['privacy']
  readonly oncePerCausalChain: true
  readonly acceptedEffectSurvivesSourceLoss: true
  readonly effect: EquipmentProviderEffectV1
  readonly providerDefinitionSha256: string
  readonly sourceBindingSha256: string
  /** Private source values are retained only until atomic commit. */
  readonly sourceInstanceId: string
  readonly sourceInstanceRevision: number
  readonly canonicalItemId: string
}
export interface EquipmentEventProviderRoutingResult {
  readonly event: AbilityEncounterEvent
  readonly routes: readonly EquipmentEventProviderRoute[]
  readonly stats: {
    readonly activeProviders: number
    readonly eventKindRejected: number
    readonly checkpointRejected: number
    readonly predicateRejected: number
    readonly routes: number
  }
}
export interface EquipmentEventProviderPredicateAuthority {
  readonly relationship?: (leftPlacementId: string, rightPlacementId: string) => 'self' | 'ally' | 'foe' | 'neutral'
  readonly sourceMoveId?: (event: AbilityEncounterEvent) => string | null
}

export class EquipmentEventProviderRouterError extends Error {
  constructor(readonly code: 'map-identity-mismatch' | 'duplicate-placement' | 'limit-exceeded', detail: string) {
    super(detail)
    this.name = 'EquipmentEventProviderRouterError'
  }
}
const fail = (code: EquipmentEventProviderRouterError['code'], detail: string): never => {
  throw new EquipmentEventProviderRouterError(code, detail)
}
const hash = (value: unknown): string => createHash('sha256')
  .update(stableJsonStringify(value, {
    path: 'equipmentProviderRoute',
    limits: { maxDepth: 12, maxNodes: 2_000, maxObjectFields: 32, maxArrayEntries: 128, maxStringLength: 500 },
  }))
  .digest('hex')
const eventTargets = (event: AbilityEncounterEvent): readonly string[] => {
  if (event.kind === 'action') return event.payload.targetPlacementIds
  if (event.kind === 'move') return [...new Set([
    ...event.payload.declaredTargetIds,
    ...event.payload.attackedTargetIds,
    ...event.payload.hitTargetIds,
    ...event.payload.missedTargetIds,
  ])]
  return []
}
const configurationType = (source: ResolvedEquipmentEventProvider): string | null => {
  const configuration = source.configuration
  if (!configuration || typeof configuration !== 'object' || Array.isArray(configuration)) return null
  const values = (configuration as { readonly values?: unknown }).values
  if (!values || typeof values !== 'object' || Array.isArray(values)) return null
  const typeId = (values as { readonly typeId?: unknown }).typeId
  return typeof typeId === 'string' ? typeId.toLowerCase() : null
}
const predicateMatches = (input: {
  readonly event: AbilityEncounterEvent
  readonly ownerPlacementId: string
  readonly source: ResolvedEquipmentEventProvider
  readonly authority: EquipmentEventProviderPredicateAuthority
}): boolean => {
  const { event, ownerPlacementId, source } = input
  const predicate = source.provider.predicate
  if (predicate.kind !== event.kind) return false
  if (event.kind === 'action' && predicate.kind === 'action') {
    return predicate.actionIds.includes(event.payload.actionId)
      && predicate.timings.includes(event.payload.timing)
      && (predicate.ownerRole === 'actor'
        ? event.actorPlacementId === ownerPlacementId
        : eventTargets(event).includes(ownerPlacementId))
  }
  if (event.kind === 'move' && predicate.kind === 'move') {
    const role = predicate.ownerRole === 'user'
      ? event.payload.userPlacementId === ownerPlacementId
      : eventTargets(event).includes(ownerPlacementId)
    const configured = !predicate.configuredType
      || configurationType(source) === event.payload.moveType.toLowerCase()
    return role && configured
      && predicate.timings.includes(event.payload.timing)
      && (!predicate.canonicalMoveIds.length || predicate.canonicalMoveIds.includes(event.payload.canonicalMoveId))
      && (!predicate.keywordsAny.length || predicate.keywordsAny.some(keyword => event.payload.keywords.includes(keyword)))
      && (!predicate.damageClasses.length || predicate.damageClasses.includes(event.payload.damageClass))
  }
  if (event.kind === 'strike' && predicate.kind === 'strike') {
    const role = predicate.ownerRole === 'attacker'
      ? event.payload.attackerPlacementId === ownerPlacementId
      : event.payload.defenderPlacementId === ownerPlacementId
    const opposite = predicate.ownerRole === 'attacker'
      ? event.payload.defenderPlacementId
      : event.payload.attackerPlacementId
    return role
      && predicate.timings.includes(event.payload.timing)
      && predicate.accuracyOutcomes.includes(event.payload.accuracyOutcome)
      && (!predicate.directOnly || event.payload.directness === 'direct')
      && (predicate.minimumTotalLoss === null || (event.payload.totalLoss ?? 0) >= predicate.minimumTotalLoss)
      && (predicate.naturalAccuracyMinimum === null
        || (event.payload.naturalAccuracyRoll ?? 0) >= predicate.naturalAccuracyMinimum)
      && (!predicate.canonicalMoveIds?.length || predicate.canonicalMoveIds.includes(event.payload.canonicalMoveId))
      && (predicate.relationship !== 'foe'
        || input.authority.relationship?.(ownerPlacementId, opposite) === 'foe')
  }
  if (event.kind === 'hp' && predicate.kind === 'hp') {
    const role = predicate.ownerRole === 'subject'
      ? event.payload.placementId === ownerPlacementId
      : event.actorPlacementId === ownerPlacementId
    return role
      && predicate.changeKinds.includes(event.payload.changeKind)
      && (!predicate.faintTransitions.length || predicate.faintTransitions.includes(event.payload.faintTransition))
      && (predicate.beforeAtMaximum === null
        || predicate.beforeAtMaximum === (event.payload.before === event.payload.maximumBefore))
      && (!predicate.reasonCodes.length || predicate.reasonCodes.includes(event.payload.reasonCode))
      && (predicate.moveSourced === null
        || predicate.moveSourced === (event.sourceResolutionId !== null))
  }
  if (event.kind === 'condition' && predicate.kind === 'condition') {
    return event.payload.placementId === ownerPlacementId
      && predicate.conditionIds.includes(event.payload.conditionId)
      && predicate.operations.includes(event.payload.operation)
      && (!predicate.sourceMoveIds.length
        || predicate.sourceMoveIds.includes(input.authority.sourceMoveId?.(event) ?? ''))
  }
  if (event.kind === 'item' && predicate.kind === 'item') {
    const before = event.payload.ownerIdBefore === ownerPlacementId
      || event.payload.sourcePlacementId === ownerPlacementId
    const after = event.payload.ownerIdAfter === ownerPlacementId
      || event.payload.sourcePlacementId === ownerPlacementId
    const role = predicate.ownerRole === 'before' ? before : predicate.ownerRole === 'after' ? after : before || after
    return role && predicate.changes.includes(event.payload.change)
  }
  if (event.kind === 'lifecycle' && predicate.kind === 'lifecycle') {
    const role = predicate.ownerRole === 'global'
      ? event.payload.subjectPlacementId === null
      : event.payload.subjectPlacementId === ownerPlacementId
    return role && predicate.boundaries.includes(event.payload.boundary)
      && predicate.transitions.includes(event.payload.transition)
  }
  if (event.kind === 'movement' && predicate.kind === 'movement') {
    return event.payload.placementId === ownerPlacementId
      && predicate.checkpoints.includes(event.payload.checkpoint)
  }
  return false
}

export const routeEquipmentEventProviders = (input: {
  readonly event: unknown
  readonly checkpoint: AbilityEventCheckpoint
  readonly mapSlug: string
  readonly mapRevision: number
  readonly placements: readonly EquipmentEventProviderRoutingPlacement[]
  readonly authority?: EquipmentEventProviderPredicateAuthority
}): EquipmentEventProviderRoutingResult => {
  const event = parseAbilityEncounterEvent(input.event)
  if (event.mapSlug !== input.mapSlug || event.mapRevision !== input.mapRevision) {
    fail('map-identity-mismatch', 'Equipment provider event does not match the routed map revision.')
  }
  if (new Set(input.placements.map(placement => placement.placementId)).size !== input.placements.length) {
    fail('duplicate-placement', 'Equipment provider routing placements must be unique.')
  }
  const authority = input.authority ?? {}
  const routes: EquipmentEventProviderRoute[] = []
  let activeProviders = 0
  let eventKindRejected = 0
  let checkpointRejected = 0
  let predicateRejected = 0
  for (const placement of [...input.placements].sort((a, b) => a.placementId.localeCompare(b.placementId))) {
    for (const source of placement.providers?.active ?? []) {
      activeProviders += 1
      const provider = source.provider
      if (provider.eventKind !== event.kind) {
        eventKindRejected += 1
        continue
      }
      if (provider.checkpoint !== input.checkpoint) {
        checkpointRejected += 1
        continue
      }
      if (!predicateMatches({ event, ownerPlacementId: placement.placementId, source, authority })) {
        predicateRejected += 1
        continue
      }
      if (routes.length >= EQUIPMENT_PROVIDER_ROUTE_LIMIT) fail('limit-exceeded', 'Equipment provider route budget exceeded.')
      const routeIdentity = hash({
        schemaVersion: 1,
        eventId: event.eventId,
        checkpoint: input.checkpoint,
        ownerPlacementId: placement.placementId,
        sourceBindingSha256: source.sourceBindingSha256,
        providerId: provider.providerId,
        providerDefinitionSha256: source.providerDefinitionSha256,
      })
      routes.push(Object.freeze({
        routeId: `equipment-provider-route:v1:${routeIdentity.slice(0, 32)}`,
        eventId: event.eventId,
        checkpoint: input.checkpoint,
        ownerPlacementId: placement.placementId,
        providerId: provider.providerId,
        label: provider.label,
        priority: provider.priority,
        response: provider.response,
        choice: provider.choice,
        frequency: provider.frequency,
        privacy: provider.privacy,
        oncePerCausalChain: true,
        acceptedEffectSurvivesSourceLoss: true,
        effect: provider.effect,
        providerDefinitionSha256: source.providerDefinitionSha256,
        sourceBindingSha256: source.sourceBindingSha256,
        sourceInstanceId: source.instanceId,
        sourceInstanceRevision: source.instanceRevision,
        canonicalItemId: source.canonicalItemId,
      }))
    }
  }
  routes.sort((left, right) => right.priority - left.priority
    || left.providerId.localeCompare(right.providerId)
    || left.routeId.localeCompare(right.routeId))
  return Object.freeze({
    event,
    routes: Object.freeze(routes),
    stats: Object.freeze({ activeProviders, eventKindRejected, checkpointRejected, predicateRejected, routes: routes.length }),
  })
}

export interface EquipmentProviderRouteProjection {
  readonly routeId: string
  readonly eventId: string
  readonly priority: number
  readonly response: 'mandatory' | 'optional'
  readonly label: string | null
  readonly choice: { readonly kind: 'automatic' } | {
    readonly kind: 'owner-choice'
    readonly options: readonly { readonly optionId: string; readonly label: string }[]
  } | null
  readonly effectKind: string | null
}
/** Never projects serialized identity, hashes, configuration, provenance, or raw provider IDs. */
export const projectEquipmentProviderRoute = (input: {
  readonly route: EquipmentEventProviderRoute
  readonly audience: 'gm' | 'owner' | 'public'
}): EquipmentProviderRouteProjection => {
  const canSeeSource = input.route.privacy.source === 'public' || input.audience !== 'public'
  const canSeeOutcome = input.route.privacy.outcome === 'public' || input.audience !== 'public'
  const canRespond = input.audience === 'gm' || input.audience === 'owner'
  return Object.freeze({
    routeId: input.route.routeId,
    eventId: input.route.eventId,
    priority: input.route.priority,
    response: input.route.response,
    label: canSeeSource ? input.route.label : null,
    choice: canRespond ? input.route.choice : null,
    effectKind: canSeeOutcome ? input.route.effect.kind : null,
  })
}

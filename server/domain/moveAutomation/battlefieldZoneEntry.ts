import { createHash } from 'node:crypto'
import {
  parseMoveEffectOperation,
  type MoveCombatStageEffectOperation,
  type MoveConditionEffectOperation,
  type MoveDirectHpEffectOperation,
  type MoveEffectOperation,
  type MoveHazardEffectOperation,
} from '#shared/moveAutomation/effects'
import type { EncounterEvent } from '#shared/moveAutomation/events'
import type { EncounterZone, EncounterZoneHook } from '#shared/moveAutomation/encounterZones'
import { isEncounterSideId } from '#shared/moveAutomation/encounterState'
import type { TabletopMap } from '~/types/map'
import { queryBattlefieldZones } from './battlefieldZones'
import {
  DEFAULT_BATTLEFIELD_ZONE_ENTRY_REGISTRY,
  canonicalBattlefieldZoneComponents,
  type BattlefieldZoneEntryDefinitionRegistry,
  type BattlefieldZoneEntryEffect,
  type BattlefieldZoneEntryHandlerDefinition,
} from './battlefieldZoneDefinitions'
import {
  evaluateBattlefieldZoneEntryEligibility,
  type BattlefieldZoneEntryEligibilityOutcome,
  type BattlefieldZoneMovementSubject,
} from './battlefieldZoneEligibility'
import {
  createAuthoritativeMovementLifecycleEvents,
  type CreateAuthoritativeMovementLifecycleEventsInput,
} from './movementLifecycle'
import type {
  EncounterLifecycleTrigger,
  EncounterLifecycleTriggerHandler,
} from './reduceLifecycle'

export const BATTLEFIELD_ZONE_ENTRY_LIFECYCLE_HANDLER_ID =
  'handler.battlefield-zone-entry' as const

export type BattlefieldZoneEntryDecisionOutcome =
  | BattlefieldZoneEntryEligibilityOutcome
  | 'triggered'
  | 'guarded-once-per-movement'
  | 'zone-already-removed'
  | 'no-layer-effect'

export interface BattlefieldZoneEntryDecision {
  readonly eventId: string
  readonly movementId: string
  readonly step: number
  readonly zoneId: string
  readonly zoneKind: EncounterZone['kind']
  readonly hookId: string
  readonly handlerId: string
  readonly outcome: BattlefieldZoneEntryDecisionOutcome
  readonly matchedTypeId: string | null
  readonly operationIds: readonly string[]
}

export interface MaterializedBattlefieldZoneEntryLifecycle {
  readonly events: readonly EncounterEvent[]
  readonly decisions: readonly BattlefieldZoneEntryDecision[]
  readonly handler: EncounterLifecycleTriggerHandler
}

export type BattlefieldZoneEntryErrorCode =
  | 'invalid-subject'
  | 'invalid-hook'
  | 'unknown-hook-handler'
  | 'canonical-hook-conflict'
  | 'invalid-entry-operation'

export class BattlefieldZoneEntryError extends Error {
  readonly code: BattlefieldZoneEntryErrorCode

  constructor(code: BattlefieldZoneEntryErrorCode, message: string) {
    super(message)
    this.name = 'BattlefieldZoneEntryError'
    this.code = code
  }
}

const fail = (
  code: BattlefieldZoneEntryErrorCode,
  message: string,
): never => {
  throw new BattlefieldZoneEntryError(code, message)
}

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

const zoneEffectId = (zone: EncounterZone): string | null => {
  if (zone.kind === 'hazard') return zone.payload.hazardId
  if (zone.kind === 'pledge') return zone.payload.pledgeId
  return null
}

const canonicalEntryHooks = (zone: EncounterZone): readonly EncounterZoneHook[] => {
  const effectId = zoneEffectId(zone)
  return effectId === null
    ? []
    : canonicalBattlefieldZoneComponents({ kind: zone.kind, effectId }).hooks.entry
}

const effectiveEntryHooks = (zone: EncounterZone): readonly EncounterZoneHook[] => {
  const hooks = [...zone.hooks.entry]
  for (const canonical of canonicalEntryHooks(zone)) {
    const byId = hooks.find(hook => hook.id === canonical.id)
    if (byId && (
      byId.handlerId !== canonical.handlerId
      || byId.oncePerMovement !== canonical.oncePerMovement
    )) {
      return fail(
        'canonical-hook-conflict',
        `Zone ${zone.id} overrides canonical hook ${canonical.id} with conflicting mechanics.`,
      )
    }
    if (
      !byId
      && !hooks.some(hook => hook.handlerId === canonical.handlerId)
    ) hooks.push(canonical)
  }
  return hooks
}

const definitionForHook = (
  hook: EncounterZoneHook,
  registry: BattlefieldZoneEntryDefinitionRegistry,
): BattlefieldZoneEntryHandlerDefinition => {
  if (!hook || typeof hook !== 'object' || hook.id.length === 0 || hook.handlerId.length === 0) {
    return fail('invalid-hook', 'Battlefield zone entry hooks must have stable identities.')
  }
  return registry.get(hook.handlerId)
    ?? fail(
      'unknown-hook-handler',
      `Battlefield zone entry hook ${hook.id} references unregistered handler ${hook.handlerId}.`,
    )
}

const effectAppliesAtLayer = (
  effect: BattlefieldZoneEntryEffect,
  layer: number,
): boolean => layer >= effect.minimumLayer
  && (effect.maximumLayer === null || layer <= effect.maximumLayer)

const operationDigest = (input: {
  readonly eventId: string
  readonly zoneId: string
  readonly hookId: string
  readonly ordinal: number
  readonly kind: string
}): string => createHash('sha256')
  .update(`${input.eventId}\u0000${input.zoneId}\u0000${input.hookId}\u0000${input.ordinal}\u0000${input.kind}`)
  .digest('hex')
  .slice(0, 32)

const operationId = (input: {
  readonly eventId: string
  readonly zoneId: string
  readonly hookId: string
  readonly ordinal: number
  readonly kind: string
}): string => `zone.entry.${operationDigest(input)}`

const commonOperation = (input: {
  readonly eventId: string
  readonly zoneId: string
  readonly hookId: string
  readonly ordinal: number
  readonly kind: string
  readonly reasonCode: string
}) => ({
  id: operationId(input),
  source: { kind: 'lifecycle-event' as const, id: input.eventId },
  recipients: { kind: 'actor' as const },
  phase: 'movement' as const,
  reasonCode: input.reasonCode,
})

const directHpOperation = (input: {
  readonly eventId: string
  readonly zone: EncounterZone
  readonly hook: EncounterZoneHook
  readonly effect: Extract<BattlefieldZoneEntryEffect, { readonly kind: 'direct-hp' }>
  readonly ordinal: number
}): MoveDirectHpEffectOperation => parseMoveEffectOperation({
  ...commonOperation({
    eventId: input.eventId,
    zoneId: input.zone.id,
    hookId: input.hook.id,
    ordinal: input.ordinal,
    kind: input.effect.kind,
    reasonCode: input.effect.reasonCode,
  }),
  kind: 'direct-hp',
  payload: {
    mode: 'lose',
    pool: 'hit-points',
    calculation: input.effect.amount.kind === 'tick'
      ? { kind: 'percent-max', percent: 10 }
      : { kind: 'fixed', value: input.effect.amount.value },
    copySource: null,
    bounds: { minimum: null, maximum: null },
    rounding: 'floor',
    applyTypeImmunity: false,
    cost: null,
    injury: { hitPointMarkers: 'apply-after-operation', massiveDamage: 'never' },
  },
}, `battlefieldZone.${input.zone.id}.directHp`) as MoveDirectHpEffectOperation

const conditionOperation = (input: {
  readonly eventId: string
  readonly zone: EncounterZone
  readonly hook: EncounterZoneHook
  readonly effect: Extract<BattlefieldZoneEntryEffect, { readonly kind: 'condition' }>
  readonly ordinal: number
}): MoveConditionEffectOperation => {
  const common = commonOperation({
    eventId: input.eventId,
    zoneId: input.zone.id,
    hookId: input.hook.id,
    ordinal: input.ordinal,
    kind: input.effect.kind,
    reasonCode: input.effect.reasonCode,
  })
  return parseMoveEffectOperation({
    ...common,
    kind: 'condition',
    payload: {
      action: 'apply',
      conditionId: input.effect.conditionId,
      conditionSource: null,
      filter: null,
      randomChoice: null,
      duration: input.effect.duration === null
        ? null
        : {
            effectId: `${common.id}.effect`,
            duration: input.effect.duration,
            transferPolicy: 'expire',
          },
      saveTiming: input.effect.duration === null ? 'canonical' : 'none',
      stackPolicy: { kind: 'refresh', maxStacks: null },
    },
  }, `battlefieldZone.${input.zone.id}.condition`) as MoveConditionEffectOperation
}

const combatStageOperation = (input: {
  readonly eventId: string
  readonly zone: EncounterZone
  readonly hook: EncounterZoneHook
  readonly effect: Extract<BattlefieldZoneEntryEffect, { readonly kind: 'combat-stage' }>
  readonly ordinal: number
}): MoveCombatStageEffectOperation => parseMoveEffectOperation({
  ...commonOperation({
    eventId: input.eventId,
    zoneId: input.zone.id,
    hookId: input.hook.id,
    ordinal: input.ordinal,
    kind: input.effect.kind,
    reasonCode: input.effect.reasonCode,
  }),
  kind: 'combat-stage',
  payload: {
    action: 'modify',
    stage: input.effect.stage,
    selectedStage: null,
    value: input.effect.value,
    stageSource: null,
    rounding: null,
  },
}, `battlefieldZone.${input.zone.id}.combatStage`) as MoveCombatStageEffectOperation

const removalOperation = (input: {
  readonly eventId: string
  readonly zone: EncounterZone
  readonly hook: EncounterZoneHook
  readonly ordinal: number
  readonly reasonCode: string
}): MoveHazardEffectOperation => parseMoveEffectOperation({
  ...commonOperation({
    eventId: input.eventId,
    zoneId: input.zone.id,
    hookId: input.hook.id,
    ordinal: input.ordinal,
    kind: 'hazard-remove',
    reasonCode: input.reasonCode,
  }),
  kind: 'hazard',
  recipients: { kind: 'none' },
  payload: {
    action: 'remove',
    target: { kind: 'zone-id', zoneId: input.zone.id },
  },
}, `battlefieldZone.${input.zone.id}.removal`) as MoveHazardEffectOperation

const effectOperation = (input: {
  readonly eventId: string
  readonly zone: EncounterZone
  readonly hook: EncounterZoneHook
  readonly effect: BattlefieldZoneEntryEffect
  readonly ordinal: number
}): MoveEffectOperation => {
  try {
    if (input.effect.kind === 'direct-hp') return directHpOperation({ ...input, effect: input.effect })
    if (input.effect.kind === 'condition') return conditionOperation({ ...input, effect: input.effect })
    return combatStageOperation({ ...input, effect: input.effect })
  }
  catch (error) {
    return fail(
      'invalid-entry-operation',
      `Zone ${input.zone.id} could not materialize ${input.effect.kind}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

interface PrecomputedTrigger {
  readonly decision: BattlefieldZoneEntryDecision
  readonly trigger: EncounterLifecycleTrigger | null
}

const decision = (input: {
  readonly event: Extract<EncounterEvent, { readonly kind: 'placement-entering' }>
  readonly zone: EncounterZone
  readonly hook: EncounterZoneHook
  readonly outcome: BattlefieldZoneEntryDecisionOutcome
  readonly matchedTypeId?: string | null
  readonly operations?: readonly MoveEffectOperation[]
}): BattlefieldZoneEntryDecision => deepFreeze({
  eventId: input.event.eventId,
  movementId: input.event.movement.movementId,
  step: input.event.movement.step,
  zoneId: input.zone.id,
  zoneKind: input.zone.kind,
  hookId: input.hook.id,
  handlerId: input.hook.handlerId,
  outcome: input.outcome,
  matchedTypeId: input.matchedTypeId ?? null,
  operationIds: (input.operations ?? []).map(operation => operation.id),
})

const precomputeHook = (input: {
  readonly event: Extract<EncounterEvent, { readonly kind: 'placement-entering' }>
  readonly zone: EncounterZone
  readonly hook: EncounterZoneHook
  readonly definition: BattlefieldZoneEntryHandlerDefinition
  readonly subject: BattlefieldZoneMovementSubject
  readonly guarded: boolean
  readonly removed: boolean
}): PrecomputedTrigger => {
  if (input.removed) {
    return {
      decision: decision({ ...input, outcome: 'zone-already-removed' }),
      trigger: null,
    }
  }
  if (input.guarded) {
    return {
      decision: decision({ ...input, outcome: 'guarded-once-per-movement' }),
      trigger: null,
    }
  }

  const eligibility = evaluateBattlefieldZoneEntryEligibility(input)
  if (eligibility.outcome !== 'eligible' && eligibility.outcome !== 'absorbed') {
    return {
      decision: decision({
        ...input,
        outcome: eligibility.outcome,
        matchedTypeId: eligibility.matchedTypeId,
      }),
      trigger: null,
    }
  }

  if (eligibility.outcome === 'absorbed') {
    const operation = removalOperation({
      eventId: input.event.eventId,
      zone: input.zone,
      hook: input.hook,
      ordinal: 1,
      reasonCode: `${input.hook.handlerId}.absorbed`,
    })
    return {
      decision: decision({
        ...input,
        outcome: 'absorbed',
        matchedTypeId: eligibility.matchedTypeId,
        operations: [operation],
      }),
      trigger: {
        effectId: null,
        reasonCode: `${input.hook.handlerId}.absorbed`,
        operations: [operation],
        emittedEvents: [],
      },
    }
  }

  const effects = input.definition.effects.filter(effect => (
    effectAppliesAtLayer(effect, input.zone.layer)
  ))
  const operations = effects.map((effect, index) => effectOperation({
    eventId: input.event.eventId,
    zone: input.zone,
    hook: input.hook,
    effect,
    ordinal: index + 1,
  }))
  if (input.definition.removeOnTrigger) {
    operations.push(removalOperation({
      eventId: input.event.eventId,
      zone: input.zone,
      hook: input.hook,
      ordinal: operations.length + 1,
      reasonCode: `${input.hook.handlerId}.consumed`,
    }))
  }
  if (operations.length === 0) {
    return {
      decision: decision({ ...input, outcome: 'no-layer-effect' }),
      trigger: null,
    }
  }
  return {
    decision: decision({ ...input, outcome: 'triggered', operations }),
    trigger: {
      effectId: null,
      reasonCode: `${input.hook.handlerId}.triggered`,
      operations,
      emittedEvents: [],
    },
  }
}

/**
 * Precompute one immutable event-to-trigger table for an authoritative path.
 * Recreating it after reconnect yields the same IDs and guards, so resuming at
 * a path cursor cannot rely on mutable closure history.
 */
export const materializeBattlefieldZoneEntryLifecycle = (input: {
  readonly map: Pick<TabletopMap, 'dimensions' | 'hazards' | 'fieldEffects' | 'encounterState'>
  readonly movement: CreateAuthoritativeMovementLifecycleEventsInput
  readonly subject: BattlefieldZoneMovementSubject
  readonly registry?: BattlefieldZoneEntryDefinitionRegistry
}): MaterializedBattlefieldZoneEntryLifecycle => {
  if (
    input.subject.placementId !== input.movement.movement.placementId
    || (input.subject.sideId !== null && !isEncounterSideId(input.subject.sideId))
    || (input.subject.grounding !== 'grounded' && input.subject.grounding !== 'airborne')
    || !Array.isArray(input.subject.typeIds)
    || input.subject.typeIds.some(typeId => (
      typeof typeId !== 'string'
      || typeId.length === 0
      || typeId !== typeId.trim().toLowerCase()
    ))
    || new Set(input.subject.typeIds).size !== input.subject.typeIds.length
  ) {
    return fail(
      'invalid-subject',
      'Battlefield zone entry subject must match the path and contain canonical side, grounding, and type facts.',
    )
  }
  const registry = input.registry ?? DEFAULT_BATTLEFIELD_ZONE_ENTRY_REGISTRY
  const events = createAuthoritativeMovementLifecycleEvents(input.movement)
  const decisions: BattlefieldZoneEntryDecision[] = []
  const triggersByEvent = new Map<string, EncounterLifecycleTrigger[]>()
  const guardedKeys = new Set<string>()
  const removedZoneIds = new Set<string>()

  for (const candidate of events) {
    if (candidate.kind !== 'placement-entering') continue
    const exactZones = queryBattlefieldZones(input.map, { kind: 'cell', cell: candidate.cell })
    const nearbyStealthRockZones = queryBattlefieldZones(input.map, { kind: 'all' }, { kinds: ['hazard'] })
      .filter(zone => 'hazardId' in zone.payload
        && zone.payload.hazardId === 'stealth-rock'
        && zone.geometry.kind === 'cells'
        && zone.geometry.cells.some(cell => Math.max(
          Math.abs(cell.x - candidate.cell.x),
          Math.abs(cell.y - candidate.cell.y),
          Math.abs(cell.z - candidate.cell.z),
        ) <= 2))
    const zones = [...new Map(
      [...exactZones, ...nearbyStealthRockZones].map(zone => [zone.id, zone]),
    ).values()]
    for (const zone of zones) {
      for (const hook of effectiveEntryHooks(zone)) {
        const definition = definitionForHook(hook, registry)
        const guardKey = `${candidate.movement.movementId}:${zone.id}:${hook.id}`
        const precomputed = precomputeHook({
          event: candidate,
          zone,
          hook,
          definition,
          subject: input.subject,
          guarded: hook.oncePerMovement && guardedKeys.has(guardKey),
          removed: removedZoneIds.has(zone.id),
        })
        decisions.push(precomputed.decision)
        if (!precomputed.trigger) continue
        const existing = triggersByEvent.get(candidate.eventId) ?? []
        existing.push(precomputed.trigger)
        triggersByEvent.set(candidate.eventId, existing)
        if (hook.oncePerMovement) guardedKeys.add(guardKey)
        if (
          precomputed.decision.outcome === 'absorbed'
          || definition.removeOnTrigger
        ) removedZoneIds.add(zone.id)
      }
    }
  }

  const handler: EncounterLifecycleTriggerHandler = Object.freeze({
    id: BATTLEFIELD_ZONE_ENTRY_LIFECYCLE_HANDLER_ID,
    resolve: ({ event }: Parameters<EncounterLifecycleTriggerHandler['resolve']>[0]) => (
      triggersByEvent.get(event.eventId) ?? []
    ),
  })
  return deepFreeze({ events, decisions, handler })
}

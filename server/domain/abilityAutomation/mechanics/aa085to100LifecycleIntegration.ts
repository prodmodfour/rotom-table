import { createHash } from 'node:crypto'
import { parseEncounterState } from '#shared/moveAutomation/encounterState'
import {
  createEmptyAbilityDailyUsageLedger,
  createEmptyAbilitySceneUsageLedger,
  parseAbilityDailyUsageLedger,
  parseAbilitySceneUsageLedger,
} from '#shared/abilityAutomation/resources'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { EncounterEffect } from '#shared/moveAutomation/encounterEffects'
import type { AnyLiveSheet } from '~/utils/sheetMutations'
import { applyHpToSheet } from '~/utils/sheetMutations'
import { computeTickValue } from '~/utils/ptuHp'
import {
  effectiveRuntimeAbilities,
  effectiveRuntimeAbilityIds,
} from '../effectiveRuntimeAbilities'
import type { AbilityAutomationRuntimeRegistry } from '../registry'
import { planEncounterMoveResourceCosts } from '../../moveAutomation/planMoveResources'
import { authoritativeAbilityHealingBlocked } from '../healingPrevention'
import {
  parseMoveEffectOperation,
  type MoveCombatStageEffectOperation,
  type MoveConditionEffectOperation,
  type MoveHealEffectOperation,
  type MoveTemporaryEffectOperation,
} from '#shared/moveAutomation/effects'
import type {
  EncounterLifecycleTrigger,
  EncounterLifecycleTriggerContext,
  EncounterLifecycleTriggerHandler,
} from '../../moveAutomation/reduceLifecycle'
import type { AuthoritativeMoveRulesContext } from '../../moveAutomation/context'

export const AA087_ROCKET_TRIGGER_REASON = 'ability.rocket.round-start-trigger' as const
export const AA091_SPEED_BOOST_REASON = 'ability.speed-boost.turn-end-speed' as const
export const AA091_STAKEOUT_LAST_TURN_REASON = 'ability.stakeout.record-last-turn' as const
export const AA092_STICKY_SMOKE_REASON = 'ability.sticky-smoke.boundary-accuracy' as const
export const AA092_STEAM_ENGINE_RAIN_TRIGGER_REASON = 'ability.steam-engine.rain-turn-start-trigger' as const
export const AA093_SUN_BLANKET_TRIGGER_REASON = 'ability.sun-blanket.initiative-trigger' as const
export const AA096_TRUANT_HEAL_REASON = 'ability.truant.turn-start-heal' as const
export const WISH_DELAYED_HEAL_REASON = 'move.wish.delayed-heal' as const

const digest = (...values: readonly string[]): string => createHash('sha256')
  .update(values.join('\u0000')).digest('hex').slice(0, 24)

const stage = (eventId: string, placementId: string): MoveCombatStageEffectOperation => (
  parseMoveEffectOperation({
    id: `ability.speed-boost.stage.${digest(eventId, placementId)}`,
    kind: 'combat-stage', source: { kind: 'lifecycle-event', id: eventId },
    recipients: { kind: 'actor' }, phase: 'cleanup', reasonCode: AA091_SPEED_BOOST_REASON,
    payload: {
      action: 'modify', stage: 'spd', selectedStage: null, value: 1,
      stageSource: null, rounding: null, applyTypeImmunity: false,
    },
  }, 'aa091.speedBoost.stage') as MoveCombatStageEffectOperation
)

const stakeoutLastTurnMarker = (
  eventId: string,
  placementId: string,
): MoveTemporaryEffectOperation => parseMoveEffectOperation({
  id: `ability.stakeout.last-turn.operation.${digest(eventId, placementId)}`,
  kind: 'temporary-effect',
  source: { kind: 'lifecycle-event', id: eventId },
  recipients: { kind: 'actor' },
  phase: 'cleanup',
  reasonCode: AA091_STAKEOUT_LAST_TURN_REASON,
  payload: {
    action: 'add',
    effectId: `ability.stakeout.last-turn.${digest(placementId)}`,
    recipientScope: 'placements',
    definition: {
      kind: 'capability',
      duration: { kind: 'scene', remaining: null },
      stacks: 1,
      charges: null,
      stackPolicy: { kind: 'replace', maxStacks: null },
      chargePolicy: { kind: 'none', amount: null },
      tags: ['ability', 'aa091-stakeout-last-turn'],
      payload: { capabilityId: 'aa091.stakeout.last-turn', action: 'grant' },
      dispel: { policy: 'matching-tags', tags: ['aa091-stakeout-last-turn'] },
      transferPolicy: 'expire',
    },
  },
}, 'aa091.stakeout.lastTurn') as MoveTemporaryEffectOperation

export interface Aa085To100StickySmokeExposure {
  readonly placementId: string
  readonly sourcePlacementId: string
  readonly zoneId: string
  readonly sourceOperationId: string
}

const stickySmokeStageId = (
  eventId: string,
  exposure: Aa085To100StickySmokeExposure,
): string => `ability.sticky-smoke.stage.${digest(
  eventId,
  exposure.placementId,
  exposure.sourcePlacementId,
  exposure.zoneId,
  exposure.sourceOperationId,
)}`

const stickySmokeStage = (
  eventId: string,
  exposure: Aa085To100StickySmokeExposure,
): MoveCombatStageEffectOperation => (
  parseMoveEffectOperation({
    id: stickySmokeStageId(eventId, exposure),
    kind: 'combat-stage', source: { kind: 'lifecycle-event', id: eventId },
    recipients: { kind: 'actor' }, phase: 'cleanup', reasonCode: AA092_STICKY_SMOKE_REASON,
    payload: {
      action: 'modify', stage: 'acc', selectedStage: null, value: -1,
      stageSource: null, rounding: null, applyTypeImmunity: false,
    },
  }, 'aa092.stickySmoke.stage') as MoveCombatStageEffectOperation
)

/** Recover the exact native zone operation owner for stage-drop immunity checks. */
export const aa085to100StickySmokeSourceOwnerId = (input: {
  readonly operation: MoveCombatStageEffectOperation
  readonly exposures: readonly Aa085To100StickySmokeExposure[]
}): string | null => {
  if (input.operation.reasonCode !== AA092_STICKY_SMOKE_REASON
    || input.operation.source.kind !== 'lifecycle-event') return null
  return input.exposures.find(exposure => (
    stickySmokeStageId(input.operation.source.id, exposure) === input.operation.id
  ))?.sourcePlacementId ?? null
}

const lifecycleTriggerMarker = (input: {
  readonly eventId: string
  readonly placementId: string
  readonly slug: 'rocket' | 'steam-engine-rain' | 'sun-blanket' | 'truant-refusal'
  readonly reasonCode: string
  readonly tag: string
  readonly capabilityId: string
  readonly recipients?: 'actor' | 'area-targets'
}): MoveTemporaryEffectOperation => (
  parseMoveEffectOperation({
    id: `ability.${input.slug}.trigger.${digest(input.eventId, input.placementId)}`,
    kind: 'temporary-effect', source: { kind: 'lifecycle-event', id: input.eventId },
    recipients: { kind: input.recipients ?? 'actor' }, phase: 'cleanup', reasonCode: input.reasonCode,
    payload: {
      action: 'add', effectId: `ability.${input.slug}.trigger.${digest(input.eventId, input.placementId)}`,
      recipientScope: 'placements',
      definition: {
        kind: 'capability',
        duration: { kind: 'turns', subject: 'source', boundary: 'end', remaining: 1 },
        stacks: 1, charges: 1,
        stackPolicy: { kind: 'replace', maxStacks: null },
        chargePolicy: { kind: 'consume-on-trigger', amount: 1 },
        tags: ['ability', input.tag],
        payload: { capabilityId: input.capabilityId, action: 'grant' },
        dispel: { policy: 'matching-tags', tags: [input.tag] },
        transferPolicy: 'expire',
      },
    },
  }, `ability.${input.slug}.trigger`) as MoveTemporaryEffectOperation
)

const sunBlanketTrigger = (eventId: string, placementId: string): MoveTemporaryEffectOperation => (
  lifecycleTriggerMarker({
    eventId, placementId, slug: 'sun-blanket',
    reasonCode: AA093_SUN_BLANKET_TRIGGER_REASON,
    tag: 'aa093-sun-blanket-trigger',
    capabilityId: 'aa093.sun-blanket.initiative-trigger',
  })
)

const wishDelayedOperations = (
  eventId: string,
  effect: EncounterEffect,
): readonly (MoveHealEffectOperation | MoveCombatStageEffectOperation | MoveConditionEffectOperation)[] => {
  const source = { kind: 'encounter-effect' as const, id: effect.id }
  const recipients = { kind: 'area-targets' as const }
  const suffix = digest(eventId, effect.id)
  const operations: Array<MoveHealEffectOperation | MoveCombatStageEffectOperation | MoveConditionEffectOperation> = [
    parseMoveEffectOperation({
      id: `move.wish.delayed-heal.${suffix}`,
      kind: 'heal', source, recipients, phase: 'cleanup', reasonCode: WISH_DELAYED_HEAL_REASON,
      payload: {
        mode: 'gain', pool: 'hit-points',
        calculation: { kind: 'percent-max', percent: 50 },
        bounds: { minimum: 0, maximum: null }, rounding: 'floor',
        injury: { hitPointMarkers: 'ignore', massiveDamage: 'never' },
      },
    }, 'move.wish.delayedHeal') as MoveHealEffectOperation,
  ]
  const stageTag = effect.tags.find(tag => tag.startsWith('aa099-wishmaster-stage-'))
  const stageId = stageTag?.slice('aa099-wishmaster-stage-'.length)
  if (stageId && ['atk', 'def', 'satk', 'sdef', 'spd'].includes(stageId)) operations.push(
    parseMoveEffectOperation({
      id: `ability.wishmaster.stage.${stageId}.${suffix}`,
      kind: 'combat-stage', source, recipients, phase: 'cleanup',
      reasonCode: `ability.wishmaster.stage.${stageId}`,
      payload: {
        action: 'modify', stage: stageId, selectedStage: null, value: 2,
        stageSource: null, rounding: null, applyTypeImmunity: false,
      },
    }, 'ability.wishmaster.delayedStage') as MoveCombatStageEffectOperation,
  )
  if (effect.tags.includes('aa099-wishmaster-cure')) operations.push(
    parseMoveEffectOperation({
      id: `ability.wishmaster.cure.${suffix}`,
      kind: 'condition', source, recipients, phase: 'cleanup',
      reasonCode: 'ability.wishmaster.cure',
      payload: {
        action: 'clear', conditionId: null, conditionSource: null,
        filter: {
          groups: ['persistent', 'volatile'],
          conditionIds: [],
          excludedConditionIds: ['Fainted'],
        },
        randomChoice: null, duration: null, saveTiming: 'canonical',
        stackPolicy: { kind: 'refresh', maxStacks: null },
      },
    }, 'ability.wishmaster.delayedCure') as MoveConditionEffectOperation,
  )
  return operations
}

const truantHeal = (eventId: string, placementId: string): MoveHealEffectOperation => (
  parseMoveEffectOperation({
    id: `ability.truant.heal.${digest(eventId, placementId)}`,
    kind: 'heal', source: { kind: 'lifecycle-event', id: eventId },
    recipients: { kind: 'actor' }, phase: 'cleanup', reasonCode: AA096_TRUANT_HEAL_REASON,
    payload: {
      mode: 'gain', pool: 'hit-points',
      calculation: { kind: 'percent-max', percent: 10 },
      bounds: { minimum: 0, maximum: null }, rounding: 'floor',
      injury: { hitPointMarkers: 'ignore', massiveDamage: 'never' },
    },
  }, 'aa096.truant.heal') as MoveHealEffectOperation
)

/** Speed Boost and Truant use the shared, retained lifecycle random ledger. */
export const createAa085To100LifecycleHandler = (input: {
  readonly rocketPlacementIds?: readonly string[]
  readonly speedBoostPlacementIds: readonly string[]
  readonly stakeoutPlacementIds?: readonly string[]
  readonly stickySmokeExposures?: readonly Aa085To100StickySmokeExposure[]
  readonly steamEngineRainPlacementIds?: readonly string[]
  readonly sunBlanketPlacementIds?: readonly string[]
  readonly truantPlacementIds: readonly string[]
  readonly wishEffects?: readonly EncounterEffect[]
}): EncounterLifecycleTriggerHandler => {
  const rocket = new Set(input.rocketPlacementIds ?? [])
  const speedBoost = new Set(input.speedBoostPlacementIds)
  const stakeout = new Set(input.stakeoutPlacementIds ?? [])
  const stickySmoke = Object.freeze([...(input.stickySmokeExposures ?? [])])
  const steamEngineRain = new Set(input.steamEngineRainPlacementIds ?? [])
  const sunBlanket = new Set(input.sunBlanketPlacementIds ?? [])
  const truant = new Set(input.truantPlacementIds)
  const wishEffects = (input.wishEffects ?? []).filter(effect => (
    effect.tags.includes('wish')
    && effect.tags.includes('delayed-heal')
    && effect.suppression.sources.length === 0
  ))
  return Object.freeze({
    id: 'handler.ability.aa085-to-aa100.lifecycle',
    resolve: ({ event, random }: EncounterLifecycleTriggerContext): readonly EncounterLifecycleTrigger[] => {
      const triggers: EncounterLifecycleTrigger[] = []
      if (event.kind === 'round-start') {
        for (const placementId of [...rocket].sort()) triggers.push({
          effectId: null,
          reasonCode: AA087_ROCKET_TRIGGER_REASON,
          operations: [lifecycleTriggerMarker({
            eventId: event.eventId,
            placementId,
            slug: 'rocket',
            reasonCode: `${AA087_ROCKET_TRIGGER_REASON}:${placementId}`,
            tag: 'aa087-rocket-trigger',
            capabilityId: 'aa087.rocket.round-start-trigger',
            recipients: 'area-targets',
          })],
          emittedEvents: [],
        })
      }
      if (event.kind === 'turn-end') {
        for (const effect of wishEffects.filter(candidate => (
          candidate.source.placementId === event.placementId
          && candidate.duration.kind === 'turns'
          && candidate.duration.subject === 'source'
          && candidate.duration.boundary === 'end'
          && candidate.duration.remaining === 1
        ))) triggers.push({
          effectId: effect.id,
          reasonCode: WISH_DELAYED_HEAL_REASON,
          operations: wishDelayedOperations(event.eventId, effect),
          emittedEvents: [],
        })
      }
      if (event.kind === 'turn-end' && speedBoost.has(event.placementId)) triggers.push({
        effectId: null,
        reasonCode: 'ability.speed-boost.turn-end-trigger',
        operations: [stage(event.eventId, event.placementId)], emittedEvents: [],
      })
      if (event.kind === 'turn-end' && stakeout.has(event.placementId)) triggers.push({
        effectId: null,
        reasonCode: AA091_STAKEOUT_LAST_TURN_REASON,
        operations: [stakeoutLastTurnMarker(event.eventId, event.placementId)],
        emittedEvents: [],
      })
      if (event.kind === 'turn-start' || event.kind === 'turn-end') {
        for (const exposure of stickySmoke.filter(candidate => (
          candidate.placementId === event.placementId
        ))) triggers.push({
          effectId: null,
          reasonCode: `ability.sticky-smoke.boundary-trigger:${exposure.zoneId}`,
          operations: [stickySmokeStage(event.eventId, exposure)], emittedEvents: [],
        })
      }
      if (event.kind === 'turn-start' && steamEngineRain.has(event.placementId)) triggers.push({
        effectId: null,
        reasonCode: AA092_STEAM_ENGINE_RAIN_TRIGGER_REASON,
        operations: [lifecycleTriggerMarker({
          eventId: event.eventId,
          placementId: event.placementId,
          slug: 'steam-engine-rain',
          reasonCode: AA092_STEAM_ENGINE_RAIN_TRIGGER_REASON,
          tag: 'aa092-steam-engine-rain-trigger',
          capabilityId: 'aa092.steam-engine.rain-trigger',
        })],
        emittedEvents: [],
      })
      if (event.kind === 'turn-start' && sunBlanket.has(event.placementId)) triggers.push({
        effectId: null,
        reasonCode: AA093_SUN_BLANKET_TRIGGER_REASON,
        operations: [sunBlanketTrigger(event.eventId, event.placementId)], emittedEvents: [],
      })
      if (event.kind !== 'turn-start' || !truant.has(event.placementId)) return triggers
      const id = digest(event.eventId, event.placementId)
      const roll = random.roll({
        rollId: `ability.truant.refusal.${id}`,
        parentEffectId: `ability.truant.turn-start.${id}`,
        reason: `Truant refusal check for ${event.placementId}`,
        formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 },
      }).finalValue
      if (roll <= 7) triggers.push({
        effectId: null,
        reasonCode: 'ability.truant.refused-turn',
        operations: [
          truantHeal(event.eventId, event.placementId),
          lifecycleTriggerMarker({
            eventId: event.eventId,
            placementId: event.placementId,
            slug: 'truant-refusal',
            reasonCode: 'ability.truant.refused-turn-save-bonus',
            tag: 'aa096-truant-refused-turn',
            capabilityId: 'aa096.truant.condition-save-bonus-3',
          }),
        ],
        emittedEvents: [],
      })
      return triggers
    },
  })
}

export interface Aa085To100RegeneratorTriggerResult {
  readonly map: TabletopMap
  readonly sheet: AnyLiveSheet
  readonly applied: boolean
}

/** Recall/Take-a-Breather Regenerator payment and healing share one accepted command. */
export const applyAa085to100RegeneratorTrigger = (input: {
  readonly map: TabletopMap
  readonly placement: SheetPlacement
  readonly sheet: AnyLiveSheet
  readonly operationId: string
  readonly trigger: 'recall' | 'take-a-breather'
  readonly maximumHp: number
  /** Test/recovery seam; production callers use the manifest-selected registry. */
  readonly abilityRuntimeRegistry?: AbilityAutomationRuntimeRegistry
}): Aa085To100RegeneratorTriggerResult => {
  const sceneId = input.map.encounterState?.history.sceneId ?? null
  if (!sceneId
    || !effectiveRuntimeAbilityIds({
      map: input.map,
      placement: input.placement,
      sheet: input.sheet,
      abilityRuntimeRegistry: input.abilityRuntimeRegistry,
    }).includes('Regenerator')
    || authoritativeAbilityHealingBlocked({ map: input.map, placementId: input.placement.id })) {
    return { map: input.map, sheet: input.sheet, applied: false }
  }
  const combat = 'combat' in input.sheet ? input.sheet.combat : null
  const currentHp = combat?.currentHp ?? 0
  const maximumHp = Math.max(1, input.maximumHp)
  if (currentHp >= maximumHp) return { map: input.map, sheet: input.sheet, applied: false }
  const abilityInstance = effectiveRuntimeAbilities({
    map: input.map,
    placement: input.placement,
    sheet: input.sheet,
    abilityRuntimeRegistry: input.abilityRuntimeRegistry,
  }).find(ability => ability.canonicalId === 'Regenerator')
  if (!abilityInstance) return { map: input.map, sheet: input.sheet, applied: false }
  const operationId = `${input.operationId}:regenerator:${input.trigger}`
  const encounter = parseEncounterState(input.map.encounterState)
  const sceneUsage = encounter.abilityUsage?.sceneId === sceneId
    ? parseAbilitySceneUsageLedger(encounter.abilityUsage)
    : { ...createEmptyAbilitySceneUsageLedger(), sceneId }
  const sceneExisting = sceneUsage.entries.find(entry => (
    entry.ownerId === input.placement.id
    && entry.abilityInstanceId === abilityInstance.instanceId
    && entry.canonicalId === 'Regenerator'
    && entry.clauseId === 'scene-cap'
  ))
  if ((sceneExisting?.spent ?? 0) >= 1 && !sceneExisting?.operationIds.includes(operationId)) {
    return { map: input.map, sheet: input.sheet, applied: false }
  }
  const daily = parseAbilityDailyUsageLedger(
    input.sheet.abilityUsage ?? createEmptyAbilityDailyUsageLedger(),
  )
  const dailyOwnerId = `sheet:${input.placement.sheetKind}:${input.placement.sheetSlug}`
  const dailyExisting = daily.entries.find(entry => (
    entry.ownerId === dailyOwnerId
    && entry.abilityInstanceId === abilityInstance.instanceId
    && entry.canonicalId === 'Regenerator'
    && entry.clauseId === 'base'
  ))
  if ((dailyExisting?.spent ?? 0) >= 2 && !dailyExisting?.operationIds.includes(operationId)) {
    return { map: input.map, sheet: input.sheet, applied: false }
  }
  const action = planEncounterMoveResourceCosts({
    map: input.map, placementId: input.placement.id,
    canonicalMoveId: 'ability:Regenerator', moveKey: 'ability:regenerator',
    range: 'Free Action', resolutionId: input.operationId,
    sourceOperationId: `${operationId}:action`, movement: null,
    reviewedCosts: [{
      id: 'ability.action.free', phase: 'pay',
      cost: { kind: 'action-resource', resource: 'free', amount: 1 },
    }],
    allowLegacyFallback: false, minimumPhaseExclusive: null, maximumPhaseInclusive: 'pay',
  })
  const sceneEntry = sceneExisting?.operationIds.includes(operationId) ? sceneExisting : {
    ownerId: input.placement.id, abilityInstanceId: abilityInstance.instanceId,
    canonicalId: 'Regenerator', clauseId: 'scene-cap', limit: 1,
    spent: (sceneExisting?.spent ?? 0) + 1,
    operationIds: [...(sceneExisting?.operationIds ?? []), operationId],
  }
  const dailyEntry = dailyExisting?.operationIds.includes(operationId) ? dailyExisting : {
    ownerId: dailyOwnerId, abilityInstanceId: abilityInstance.instanceId,
    canonicalId: 'Regenerator', clauseId: 'base',
    limit: 2, spent: (dailyExisting?.spent ?? 0) + 1,
    operationIds: [...(dailyExisting?.operationIds ?? []), operationId],
  }
  const nextEncounter = parseEncounterState({
    ...action.currentEncounterState,
    abilityUsage: {
      schemaVersion: 1, sceneId,
      entries: sceneExisting
        ? sceneUsage.entries.map(entry => entry === sceneExisting ? sceneEntry : entry)
        : [...sceneUsage.entries, sceneEntry],
    },
  })
  const healed = applyHpToSheet(
    input.placement.sheetKind,
    input.sheet,
    Math.min(maximumHp, currentHp + Math.floor(maximumHp / 3)),
    combat?.injuries ?? 0,
  )
  return {
    map: { ...action.nextMap, encounterState: nextEncounter },
    sheet: {
      ...healed,
      abilityUsage: {
        schemaVersion: 1, dayKey: daily.dayKey,
        entries: dailyExisting
          ? daily.entries.map(entry => entry === dailyExisting ? dailyEntry : entry)
          : [...daily.entries, dailyEntry],
      },
    } as AnyLiveSheet,
    applied: true,
  }
}

/** Revalidate lifecycle operations against current effective ability authority. */
export const aa085to100LifecycleRecipientIds = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly operation: { readonly reasonCode: string }
  readonly candidateRecipientIds: readonly string[]
}): readonly string[] => input.operation.reasonCode === AA091_SPEED_BOOST_REASON
  ? input.candidateRecipientIds.filter(id => input.context.queries.abilities.has(id, 'Speed Boost'))
  : input.operation.reasonCode === AA091_STAKEOUT_LAST_TURN_REASON
    ? input.candidateRecipientIds.filter(id => input.context.queries.abilities.has(id, 'Stakeout'))
  : input.operation.reasonCode.startsWith(`${AA087_ROCKET_TRIGGER_REASON}:`)
    ? input.candidateRecipientIds.filter(id => (
        id === input.operation.reasonCode.slice(AA087_ROCKET_TRIGGER_REASON.length + 1)
        && input.context.queries.abilities.has(id, 'Rocket')
      ))
  : input.operation.reasonCode === AA092_STEAM_ENGINE_RAIN_TRIGGER_REASON
    ? input.candidateRecipientIds.filter(id => input.context.queries.abilities.has(id, 'Steam Engine'))
  : input.operation.reasonCode === AA093_SUN_BLANKET_TRIGGER_REASON
    ? input.candidateRecipientIds.filter(id => input.context.queries.abilities.has(id, 'Sun Blanket'))
  : input.operation.reasonCode === AA096_TRUANT_HEAL_REASON
    || input.operation.reasonCode === 'ability.truant.refused-turn-save-bonus'
    ? input.candidateRecipientIds.filter(id => input.context.queries.abilities.has(id, 'Truant'))
  : input.operation.reasonCode.startsWith('ability.wishmaster.stage.')
    || input.operation.reasonCode === 'ability.wishmaster.cure'
    ? input.candidateRecipientIds.filter(id => !authoritativeAbilityHealingBlocked({
        map: input.context.map,
        placementId: id,
      }))
    : input.candidateRecipientIds

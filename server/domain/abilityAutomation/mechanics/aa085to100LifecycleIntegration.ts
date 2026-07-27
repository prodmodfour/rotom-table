import { createHash } from 'node:crypto'
import { parseEncounterState } from '#shared/moveAutomation/encounterState'
import {
  createEmptyAbilityDailyUsageLedger,
  createEmptyAbilitySceneUsageLedger,
  parseAbilityDailyUsageLedger,
  parseAbilitySceneUsageLedger,
} from '#shared/abilityAutomation/resources'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { AnyLiveSheet } from '~/utils/sheetMutations'
import { applyHpToSheet } from '~/utils/sheetMutations'
import { computeTickValue } from '~/utils/ptuHp'
import { effectiveRuntimeAbilityIds } from '../effectiveRuntimeAbilities'
import { resolveSheetAbilityInstances } from '../instanceParameters'
import { planEncounterMoveResourceCosts } from '../../moveAutomation/planMoveResources'
import { authoritativeAbilityHealingBlocked } from '../healingPrevention'
import {
  parseMoveEffectOperation,
  type MoveCombatStageEffectOperation,
  type MoveHealEffectOperation,
} from '#shared/moveAutomation/effects'
import type {
  EncounterLifecycleTrigger,
  EncounterLifecycleTriggerHandler,
} from '../../moveAutomation/reduceLifecycle'
import type { AuthoritativeMoveRulesContext } from '../../moveAutomation/context'

export const AA091_SPEED_BOOST_REASON = 'ability.speed-boost.turn-end-speed' as const
export const AA096_TRUANT_HEAL_REASON = 'ability.truant.turn-start-heal' as const

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
  readonly speedBoostPlacementIds: readonly string[]
  readonly truantPlacementIds: readonly string[]
}): EncounterLifecycleTriggerHandler => {
  const speedBoost = new Set(input.speedBoostPlacementIds)
  const truant = new Set(input.truantPlacementIds)
  return Object.freeze({
    id: 'handler.ability.aa085-to-aa100.lifecycle',
    resolve: ({ event, random }): readonly EncounterLifecycleTrigger[] => {
      if (event.kind === 'turn-end' && speedBoost.has(event.placementId)) return [{
        effectId: null,
        reasonCode: 'ability.speed-boost.turn-end-trigger',
        operations: [stage(event.eventId, event.placementId)], emittedEvents: [],
      }]
      if (event.kind !== 'turn-start' || !truant.has(event.placementId)) return []
      const id = digest(event.eventId, event.placementId)
      const roll = random.roll({
        rollId: `ability.truant.refusal.${id}`,
        parentEffectId: `ability.truant.turn-start.${id}`,
        reason: `Truant refusal check for ${event.placementId}`,
        formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 },
      }).finalValue
      return roll <= 7 ? [{
        effectId: null,
        reasonCode: 'ability.truant.refused-turn',
        operations: [truantHeal(event.eventId, event.placementId)], emittedEvents: [],
      }] : []
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
}): Aa085To100RegeneratorTriggerResult => {
  const sceneId = input.map.encounterState?.history.sceneId ?? null
  if (!sceneId
    || !effectiveRuntimeAbilityIds({ map: input.map, placement: input.placement, sheet: input.sheet })
      .includes('Regenerator')
    || authoritativeAbilityHealingBlocked({ map: input.map, placementId: input.placement.id })) {
    return { map: input.map, sheet: input.sheet, applied: false }
  }
  const combat = 'combat' in input.sheet ? input.sheet.combat : null
  const currentHp = combat?.currentHp ?? 0
  const maximumHp = Math.max(1, input.maximumHp)
  if (currentHp >= maximumHp) return { map: input.map, sheet: input.sheet, applied: false }
  const abilityInstance = resolveSheetAbilityInstances(input.sheet.abilities)
    .find(ability => ability.canonicalId === 'Regenerator')
  if (!abilityInstance) return { map: input.map, sheet: input.sheet, applied: false }
  const operationId = `${input.operationId}:regenerator:${input.trigger}`
  const encounter = parseEncounterState(input.map.encounterState)
  const sceneUsage = encounter.abilityUsage?.sceneId === sceneId
    ? parseAbilitySceneUsageLedger(encounter.abilityUsage)
    : { ...createEmptyAbilitySceneUsageLedger(), sceneId }
  const sceneExisting = sceneUsage.entries.find(entry => (
    entry.ownerId === input.placement.id && entry.canonicalId === 'Regenerator' && entry.clauseId === 'scene-cap'
  ))
  if ((sceneExisting?.spent ?? 0) >= 1 && !sceneExisting?.operationIds.includes(operationId)) {
    return { map: input.map, sheet: input.sheet, applied: false }
  }
  const daily = parseAbilityDailyUsageLedger(
    input.sheet.abilityUsage ?? createEmptyAbilityDailyUsageLedger(),
  )
  const dailyExisting = daily.entries.find(entry => (
    entry.canonicalId === 'Regenerator' && entry.clauseId === 'base'
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
    ownerId: `sheet:${input.placement.sheetKind}:${input.placement.sheetSlug}`,
    abilityInstanceId: `base:Regenerator`, canonicalId: 'Regenerator', clauseId: 'base',
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
  : input.operation.reasonCode === AA096_TRUANT_HEAL_REASON
    ? input.candidateRecipientIds.filter(id => input.context.queries.abilities.has(id, 'Truant'))
    : input.candidateRecipientIds

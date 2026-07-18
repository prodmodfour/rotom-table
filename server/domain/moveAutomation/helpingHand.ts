import type { MoveAutomationRollLedgerEntry } from '#shared/moveAutomation/random'
import {
  createEmptyEncounterState,
  parseEncounterState,
} from '#shared/moveAutomation/encounterState'
import type {
  EncounterConditionEffect,
  EncounterEffect,
} from '#shared/moveAutomation/encounterEffects'
import type { MoveSpecPhase } from '#shared/moveAutomation/spec'
import type {
  MoveResolutionAuditTrace,
  MoveResolutionTraceJsonValue,
} from '#shared/moveAutomation/trace'
import type { TabletopMap } from '~/types/map'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'
import { conditionBaseName, normalizeConditionName } from '~/utils/statusConditions'
import { deepCloneJson } from '~/utils/serialization'
import type { MoveSpecEmittedOperation } from './executeSpec'
import { applyEncounterEffectLifecycleEvent } from './effectLifecycle'
import { reduceMoveResolutionTrace } from './trace'

export const HELPING_HAND_MOVE_SOURCE_ID = 'move.helping-hand' as const
export const HELPING_HAND_OPERATION_ID = 'helping-hand.apply-bonus' as const
export const HELPING_HAND_EFFECT_BASE_ID = 'helping-hand.bonus' as const
export const HELPING_HAND_ACCURACY_BONUS = 2 as const
export const HELPING_HAND_DAMAGE_BONUS = 10 as const

const HELPING_HAND_CONDITION = 'Helping Hand' as const

export type HelpingHandBonusResolutionStatus =
  | 'applied'
  | 'not-qualifying'
  | 'suppressed'

/** Server-only evidence used to consume one reviewed bonus in the atomic move plan. */
export interface HelpingHandBonusResolution {
  readonly status: HelpingHandBonusResolutionStatus
  readonly reasonCode:
    | 'helping-hand.applied-and-consumed'
    | 'helping-hand.no-qualifying-roll'
    | 'helping-hand.suppressed'
  readonly actorPlacementId: string
  readonly effectIds: readonly string[]
  readonly suppressedEffectIds: readonly string[]
  readonly effectIdsToConsume: readonly string[]
  readonly accuracyRollIds: readonly string[]
  readonly damageRollIds: readonly string[]
  readonly accuracyBonus: 0 | typeof HELPING_HAND_ACCURACY_BONUS
  readonly damageBonus: 0 | typeof HELPING_HAND_DAMAGE_BONUS
}

const effectAddressesPlacement = (
  effect: EncounterConditionEffect,
  placementId: string,
): boolean => effect.affected.placementIds.includes(placementId)

/** Match only effects emitted by the reviewed Helping Hand native operation. */
export const isHelpingHandBonusEffect = (
  effect: EncounterEffect,
): effect is EncounterConditionEffect => (
  effect.kind === 'condition'
  && effect.source.moveId === HELPING_HAND_MOVE_SOURCE_ID
  && effect.source.operationId === HELPING_HAND_OPERATION_ID
  && effect.payload.action === 'apply'
  && effect.payload.conditionId === 'helping-hand'
  && effect.duration.kind === 'rounds'
  && effect.duration.boundary === 'end'
  && effect.duration.remaining === 1
  && effect.affected.placementIds.length === 1
  && effect.affected.sideIds.length === 0
  && effect.affected.cells.length === 0
  && effect.stacks === 1
  && effect.charges === 1
  && effect.stackPolicy.kind === 'refresh'
  && effect.chargePolicy.kind === 'consume-on-trigger'
  && effect.chargePolicy.amount === 1
  && (effect.transferPolicy ?? 'retain') === 'retain'
)

/** Active direct bonuses for one placement, preserving encounter-state order. */
export const activeHelpingHandBonusEffects = (input: {
  readonly map: Pick<TabletopMap, 'encounterState'>
  readonly placementId: string
}): readonly EncounterConditionEffect[] => Object.freeze(
  (input.map.encounterState?.effects ?? []).filter((effect): effect is EncounterConditionEffect => (
    isHelpingHandBonusEffect(effect)
    && effectAddressesPlacement(effect, input.placementId)
    && effect.charges !== 0
    && effect.suppression.sources.length === 0
  )),
)

/** Remove the projected marker before adding an explicitly attributed modifier. */
export const withoutHelpingHandCondition = (
  token: SpawnedPokemon,
): SpawnedPokemon => ({
  ...token,
  conditions: token.conditions.filter((condition) => (
    (conditionBaseName(condition) ?? normalizeConditionName(condition) ?? condition)
    !== HELPING_HAND_CONDITION
  )),
})

const accuracyRollUsesEffect = (
  entry: MoveAutomationRollLedgerEntry,
  effectIds: ReadonlySet<string>,
): boolean => entry.modifiers.some(modifier => effectIds.has(modifier.sourceId))

const legacyAccuracyRoll = (entry: MoveAutomationRollLedgerEntry): boolean => (
  entry.parentEffectId === 'legacy-v1.accuracy'
  || entry.parentEffectId.startsWith('legacy-v1.accuracy.')
  || entry.modifiers.some(modifier => modifier.sourceId === 'user-accuracy')
)

const legacyDamageRoll = (entry: MoveAutomationRollLedgerEntry): boolean => (
  entry.parentEffectId === 'legacy-v1.damage'
  || entry.parentEffectId === 'legacy-v1.critical-damage'
)

const rootNativeDamageOperationIds = (
  operations: readonly MoveSpecEmittedOperation[],
): ReadonlySet<string> => new Set(operations.flatMap(({ operation, childResolutionId }) => (
  childResolutionId === undefined
  && (operation.kind === 'damage' || operation.kind === 'multi-hit')
    ? [operation.id]
    : []
)))

const frozenResolution = (
  value: HelpingHandBonusResolution,
): HelpingHandBonusResolution => Object.freeze({
  ...value,
  effectIds: Object.freeze([...value.effectIds]),
  suppressedEffectIds: Object.freeze([...value.suppressedEffectIds]),
  effectIdsToConsume: Object.freeze([...value.effectIdsToConsume]),
  accuracyRollIds: Object.freeze([...value.accuracyRollIds]),
  damageRollIds: Object.freeze([...value.damageRollIds]),
})

/**
 * Decide from the completed authoritative calculation whether Helping Hand
 * contributed to this move. A non-rolling status move retains the effect; an
 * Accuracy or Damage Roll consumes every equivalent active instance once.
 */
export const resolveHelpingHandBonusUse = (input: {
  readonly map: Pick<TabletopMap, 'encounterState'>
  readonly actorPlacementId: string
  readonly script: MoveAutomationScript
  readonly rollLedger: readonly MoveAutomationRollLedgerEntry[]
  readonly auditTrace: MoveResolutionAuditTrace
  readonly nativeOperations?: readonly MoveSpecEmittedOperation[]
}): HelpingHandBonusResolution | null => {
  const matching = (input.map.encounterState?.effects ?? []).filter((effect): effect is EncounterConditionEffect => (
    isHelpingHandBonusEffect(effect)
    && effectAddressesPlacement(effect, input.actorPlacementId)
    && effect.charges !== 0
  ))
  if (matching.length === 0) return null

  const active = matching.filter(effect => effect.suppression.sources.length === 0)
  const suppressed = matching.filter(effect => effect.suppression.sources.length > 0)
  if (active.length === 0) {
    return frozenResolution({
      status: 'suppressed',
      reasonCode: 'helping-hand.suppressed',
      actorPlacementId: input.actorPlacementId,
      effectIds: matching.map(effect => effect.id),
      suppressedEffectIds: suppressed.map(effect => effect.id),
      effectIdsToConsume: [],
      accuracyRollIds: [],
      damageRollIds: [],
      accuracyBonus: 0,
      damageBonus: 0,
    })
  }

  const activeIds = new Set(active.map(effect => effect.id))
  const nativeDamageOperationIds = rootNativeDamageOperationIds(input.nativeOperations ?? [])
  const legacy = input.auditTrace.program.runtimeKind === 'legacy-v1'
  const accuracyRollIds = input.rollLedger.filter(entry => (
    accuracyRollUsesEffect(entry, activeIds)
    || (legacy && legacyAccuracyRoll(entry))
  )).map(entry => entry.rollId)
  const damageRollIds = input.rollLedger.filter(entry => (
    legacy
      ? legacyDamageRoll(entry) && input.script.directHpLoss === undefined
      : nativeDamageOperationIds.has(entry.parentEffectId)
  )).map(entry => entry.rollId)
  const accuracyBonusApplied = accuracyRollIds.length > 0
  const damageBonusApplied = damageRollIds.length > 0
  const qualifying = accuracyBonusApplied || damageBonusApplied

  return frozenResolution({
    status: qualifying ? 'applied' : 'not-qualifying',
    reasonCode: qualifying
      ? 'helping-hand.applied-and-consumed'
      : 'helping-hand.no-qualifying-roll',
    actorPlacementId: input.actorPlacementId,
    effectIds: matching.map(effect => effect.id),
    suppressedEffectIds: suppressed.map(effect => effect.id),
    effectIdsToConsume: qualifying ? active.map(effect => effect.id) : [],
    accuracyRollIds,
    damageRollIds,
    accuracyBonus: accuracyBonusApplied ? HELPING_HAND_ACCURACY_BONUS : 0,
    damageBonus: damageBonusApplied ? HELPING_HAND_DAMAGE_BONUS : 0,
  })
}

const activeTracePhase = (
  trace: MoveResolutionAuditTrace,
): MoveSpecPhase | null => {
  let phase: MoveSpecPhase | null = null
  for (const event of trace.events) {
    if (event.kind === 'phase-transition') phase = event.to
  }
  return phase
}

/** Add bounded private/public-safe decision evidence after mechanics calculation. */
export const appendHelpingHandBonusTrace = (
  trace: MoveResolutionAuditTrace,
  resolution: HelpingHandBonusResolution,
): MoveResolutionAuditTrace => {
  const phase = activeTracePhase(trace)
  if (phase === null) return trace
  return reduceMoveResolutionTrace(trace, {
    kind: 'predicate',
    phase,
    predicateId: 'helping-hand.bonus-use',
    outcome: resolution.status === 'applied',
    reasonCode: resolution.reasonCode,
    input: {
      actorPlacementId: resolution.actorPlacementId,
      effectIds: resolution.effectIds,
      suppressedEffectIds: resolution.suppressedEffectIds,
      effectIdsToConsume: resolution.effectIdsToConsume,
      accuracyRollIds: resolution.accuracyRollIds,
      damageRollIds: resolution.damageRollIds,
      accuracyBonus: resolution.accuracyBonus,
      damageBonus: resolution.damageBonus,
    } as MoveResolutionTraceJsonValue,
  })
}

export interface HelpingHandResolutionCarrier {
  readonly actorPlacementId: string
  readonly script: MoveAutomationScript
  readonly rollLedger: readonly MoveAutomationRollLedgerEntry[]
  readonly auditTrace: MoveResolutionAuditTrace
  readonly nativeV2?: {
    readonly operations: readonly MoveSpecEmittedOperation[]
    readonly trace?: MoveResolutionAuditTrace
  }
}

/** Attach server-only consumption evidence without changing any mechanics result. */
export const attachHelpingHandBonusResolution = <Resolution extends HelpingHandResolutionCarrier>(
  map: Pick<TabletopMap, 'encounterState'>,
  resolution: Resolution,
): Resolution & { readonly helpingHandBonus?: HelpingHandBonusResolution } => {
  const bonus = resolveHelpingHandBonusUse({
    map,
    actorPlacementId: resolution.actorPlacementId,
    script: resolution.script,
    rollLedger: resolution.rollLedger,
    auditTrace: resolution.auditTrace,
    ...(resolution.nativeV2 ? { nativeOperations: resolution.nativeV2.operations } : {}),
  })
  if (!bonus) return resolution
  const auditTrace = appendHelpingHandBonusTrace(resolution.auditTrace, bonus)
  return Object.freeze({
    ...resolution,
    auditTrace,
    ...(resolution.nativeV2
      ? { nativeV2: Object.freeze({ ...resolution.nativeV2, trace: auditTrace }) }
      : {}),
    helpingHandBonus: bonus,
  })
}

export interface HelpingHandBonusConsumptionResult {
  readonly map: TabletopMap
  readonly changed: boolean
  readonly consumedEffectIds: readonly string[]
}

/** Consume exact reviewed effects through the generic charge lifecycle reducer. */
export const consumeHelpingHandBonus = (input: {
  readonly map: TabletopMap
  readonly resolution?: HelpingHandBonusResolution
}): HelpingHandBonusConsumptionResult => {
  const requested = input.resolution?.effectIdsToConsume ?? []
  if (requested.length === 0) {
    return Object.freeze({ map: input.map, changed: false, consumedEffectIds: [] })
  }

  const map = deepCloneJson(input.map)
  let encounterState = parseEncounterState(
    map.encounterState ?? createEmptyEncounterState(),
  )
  const consumedEffectIds: string[] = []
  for (const effectId of [...new Set(requested)]) {
    const effect = encounterState.effects.find(candidate => candidate.id === effectId)
    if (
      !effect
      || !isHelpingHandBonusEffect(effect)
      || !effectAddressesPlacement(effect, input.resolution!.actorPlacementId)
      || effect.suppression.sources.length > 0
      || effect.charges === 0
    ) {
      continue
    }
    const result = applyEncounterEffectLifecycleEvent(
      { effects: encounterState.effects },
      { kind: 'effect-triggered', effectId },
    )
    encounterState = parseEncounterState({ ...encounterState, effects: result.effects })
    if (result.changed) consumedEffectIds.push(effectId)
  }
  if (consumedEffectIds.length > 0) map.encounterState = encounterState

  return Object.freeze({
    map,
    changed: consumedEffectIds.length > 0,
    consumedEffectIds: Object.freeze(consumedEffectIds),
  })
}

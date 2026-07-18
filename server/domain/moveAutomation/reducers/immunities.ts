import {
  moveAutomationCombatStageBlockSource,
  tokenHasShieldDust,
} from '~/utils/moveAutomationAbilityProtection'
import { SHIELD_DUST_ABILITY_NAME } from '~/utils/abilityAutomation'
import {
  moveAutomationConditionImmunitySource,
  type MoveAutomationConditionImmunityContext,
} from '~/utils/moveAutomationConditionImmunity'
import {
  computeSheetAbilityAwareMultiplier,
  getPassiveTypeEffectivenessSource,
} from '~/utils/sheetPassiveAbilityEffects'
import { projectEffectiveConditions } from '~/utils/encounterConditions'
import { conditionBaseName, normalizeConditionName } from '~/utils/statusConditions'
import type { AuthoritativeMoveRulesContext } from '../context'
import { computeMultiplier } from '~/utils/typeChart'
import type {
  MoveConditionImmunityDecision,
  MoveCoreTokenEffectImmunityDecision,
  MoveCoreTokenEffectImmunityQueries,
} from './coreTokenEffectTypes'

export interface StandardMoveCoreTokenEffectImmunityOptions {
  /** Null is allowed for typeless effects; type-immunity-enabled HP loss then fails closed. */
  readonly moveType: string | null
  readonly conditionContext?: MoveAutomationConditionImmunityContext
  /** Enables side-relationship and typed placement/side/cell prevention queries. */
  readonly context?: AuthoritativeMoveRulesContext
}

const decision = (
  blockedBy: string | null,
  consultedPlacementIds: readonly string[] = [],
): MoveCoreTokenEffectImmunityDecision => ({
  blockedBy,
  consultedPlacementIds,
})

const conditionDecision = (
  blockedBy: string | null,
  consultedPlacementIds: readonly string[] = [],
  firstTurnConditionProtection: MoveConditionImmunityDecision['firstTurnConditionProtection'] = null,
  terrainTrace: MoveConditionImmunityDecision['terrainTrace'] = [],
): MoveConditionImmunityDecision => ({
  blockedBy,
  consultedPlacementIds,
  ...(firstTurnConditionProtection ? { firstTurnConditionProtection } : {}),
  ...(terrainTrace && terrainTrace.length > 0 ? { terrainTrace } : {}),
})

const conditionProviderIds = (
  condition: string,
  recipientId: string,
  context: MoveAutomationConditionImmunityContext | undefined,
): readonly string[] => condition === 'Sleep'
  ? (context?.sweetVeilProviderCandidates ?? [])
      .map(provider => provider.id)
      .filter(id => id !== recipientId)
  : []

const authoritativeConditionContext = (
  context: AuthoritativeMoveRulesContext | undefined,
): MoveAutomationConditionImmunityContext | undefined => context
  ? {
      sweetVeilProviderCandidates: context.queries.tokens.all(),
      isAlly: (provider, target) => context.queries.relationships.match(
        provider.id,
        target.id,
        'ally',
      ).matches,
    }
  : undefined

const encounterConditionPrevention = (options: {
  readonly condition: string
  readonly recipientId: string
  readonly context: AuthoritativeMoveRulesContext | undefined
}): { readonly blockedBy: string | null; readonly consultedPlacementIds: readonly string[] } => {
  const context = options.context
  if (!context) return { blockedBy: null, consultedPlacementIds: [] }
  const recipient = context.queries.tokens.get(options.recipientId)
  const placement = context.queries.placements.get(options.recipientId)
  if (!recipient || !placement) return { blockedBy: null, consultedPlacementIds: [] }
  const canonical = normalizeConditionName(options.condition) ?? options.condition
  const projection = projectEffectiveConditions({
    sheetConditions: recipient.sheetConditions,
    encounterEffects: context.map.encounterState?.effects,
    target: {
      placementId: placement.id,
      ...(placement.sideId ? { sideId: placement.sideId } : {}),
      position: recipient.position,
      base: recipient.base,
      clearance: recipient.clearance,
    },
  })
  const prevention = projection.modifiers.find(({ condition, effect }) => (
    effect.kind === 'condition'
    && effect.payload.action === 'prevent'
    && (conditionBaseName(condition) ?? condition) === canonical
  ))
  if (!prevention) return { blockedBy: null, consultedPlacementIds: [] }
  const sourceId = prevention.effect.source.placementId
  return {
    blockedBy: `Encounter effect ${prevention.effect.id}`,
    consultedPlacementIds: sourceId !== placement.id && context.queries.placements.get(sourceId)
      ? [sourceId]
      : [],
  }
}

/**
 * Bridge the current authoritative type/condition/stage query helpers into the
 * injected v2 reducer seam. Richer encounter overlays can replace this object
 * without changing reducer math.
 */
export const createStandardMoveCoreTokenEffectImmunityQueries = (
  options: StandardMoveCoreTokenEffectImmunityOptions,
): MoveCoreTokenEffectImmunityQueries => {
  const conditionContext = options.conditionContext
    ?? authoritativeConditionContext(options.context)
  return {
    directHp: ({ recipient }) => {
      if (!options.moveType) return decision('unresolved move type')
      const target = recipient.token
      const baseMultiplier = computeMultiplier(options.moveType, target.defenderTypes)
      const multiplier = computeSheetAbilityAwareMultiplier(
        options.moveType,
        target.defenderTypes,
        target.abilityNames,
        target.defenderCapabilities,
        { baseMultiplier },
      )
      if (multiplier !== 0) return decision(null)
      if (baseMultiplier === 0) return decision(`${options.moveType} type`)
      return decision(getPassiveTypeEffectivenessSource(
        options.moveType,
        target.abilityNames,
        target.defenderCapabilities,
        { baseMultiplier },
      ) ?? `${options.moveType} immunity`)
    },
    condition: ({ operation, condition, recipient }) => {
      const providerIds = conditionProviderIds(
        condition,
        recipient.placement.id,
        conditionContext,
      )
      const passiveBlocker = moveAutomationConditionImmunitySource(
        condition,
        recipient.token,
        options.moveType,
        conditionContext,
      )
      if (passiveBlocker) return conditionDecision(passiveBlocker, providerIds)
      if (operation.payload.accuracyRollTrigger && tokenHasShieldDust(recipient.token)) {
        return conditionDecision(SHIELD_DUST_ABILITY_NAME)
      }
      const terrain = options.context?.queries.terrain.condition({
        placementId: recipient.placement.id,
        conditionId: condition,
      })
      if (terrain?.blockedBy) {
        return conditionDecision(terrain.blockedBy, [], null, terrain.trace)
      }
      const encounter = encounterConditionPrevention({
        condition,
        recipientId: recipient.placement.id,
        context: options.context,
      })
      const consultedPlacementIds = [
        ...providerIds,
        ...encounter.consultedPlacementIds.filter(id => !providerIds.includes(id)),
      ]
      return encounter.blockedBy
        ? conditionDecision(
            encounter.blockedBy,
            consultedPlacementIds,
            null,
            terrain?.trace ?? [],
          )
        : conditionDecision(
            null,
            consultedPlacementIds,
            terrain?.firstTurnProtection ?? null,
            terrain?.trace ?? [],
          )
    },
    combatStage: ({ stage, delta, recipient }) => decision(
      moveAutomationCombatStageBlockSource({
        target: recipient.token,
        key: stage,
        delta,
      }),
    ),
  }
}

import {
  moveAutomationCombatStageBlockSource,
} from '~/utils/moveAutomationAbilityProtection'
import {
  moveAutomationConditionImmunitySource,
  type MoveAutomationConditionImmunityContext,
} from '~/utils/moveAutomationConditionImmunity'
import {
  computeSheetAbilityAwareMultiplier,
  getPassiveTypeEffectivenessSource,
} from '~/utils/sheetPassiveAbilityEffects'
import { computeMultiplier } from '~/utils/typeChart'
import type {
  MoveCoreTokenEffectImmunityDecision,
  MoveCoreTokenEffectImmunityQueries,
} from './coreTokenEffectTypes'

export interface StandardMoveCoreTokenEffectImmunityOptions {
  /** Null is allowed for typeless effects; type-immunity-enabled HP loss then fails closed. */
  readonly moveType: string | null
  readonly conditionContext?: MoveAutomationConditionImmunityContext
}

const decision = (
  blockedBy: string | null,
  consultedPlacementIds: readonly string[] = [],
): MoveCoreTokenEffectImmunityDecision => ({
  blockedBy,
  consultedPlacementIds,
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

/**
 * Bridge the current authoritative type/condition/stage query helpers into the
 * injected v2 reducer seam. Richer encounter overlays can replace this object
 * without changing reducer math.
 */
export const createStandardMoveCoreTokenEffectImmunityQueries = (
  options: StandardMoveCoreTokenEffectImmunityOptions,
): MoveCoreTokenEffectImmunityQueries => ({
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
  condition: ({ condition, recipient }) => decision(
    moveAutomationConditionImmunitySource(
      condition,
      recipient.token,
      options.moveType,
      options.conditionContext,
    ),
    conditionProviderIds(condition, recipient.placement.id, options.conditionContext),
  ),
  combatStage: ({ stage, delta, recipient }) => decision(
    moveAutomationCombatStageBlockSource({
      target: recipient.token,
      key: stage,
      delta,
    }),
  ),
})

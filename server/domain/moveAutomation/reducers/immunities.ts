import {
  moveAutomationCombatStageBlockSource,
  tokenHasShieldDust,
} from '~/utils/moveAutomationAbilityProtection'
import { SHIELD_DUST_ABILITY_NAME } from '#shared/abilityAutomation/legacyNames'
import {
  PASTEL_VEIL_RANGE_METERS,
  SWEET_VEIL_RANGE_METERS,
  moveAutomationConditionImmunitySource,
  type MoveAutomationConditionImmunityContext,
} from '~/utils/moveAutomationConditionImmunity'
import { tokenGridDistance } from '~/utils/moveAutomationRange'
import { moveAutomationMoveImmunitySource } from '~/utils/moveAutomationMoveImmunity'
import {
  computeSheetAbilityAwareMultiplier,
  getPassiveTypeEffectivenessSource,
} from '~/utils/sheetPassiveAbilityEffects'
import { projectEffectiveConditions } from '~/utils/encounterConditions'
import { conditionBaseName, normalizeConditionName } from '~/utils/statusConditions'
import type { AuthoritativeMoveRulesContext } from '../context'
import { computeMultiplier } from '~/utils/typeChart'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import { aa064CorrosionCanPoison } from '../../abilityAutomation/mechanics/aa064MoveIntegration'
import type {
  MoveConditionImmunityDecision,
  MoveCoreTokenEffectImmunityDecision,
  MoveCoreTokenEffectImmunityQueries,
  MoveCoreTokenEffectRecipient,
} from './coreTokenEffectTypes'

export interface StandardMoveCoreTokenEffectImmunityOptions {
  /** Null is allowed for typeless effects; type-immunity-enabled HP loss then fails closed. */
  readonly moveType: string | null
  /** Reviewed move keywords used for whole-move immunity such as Powder and Sonic. */
  readonly moveScript?: Pick<MoveAutomationScript, 'keywords'>
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
  recipient: MoveCoreTokenEffectRecipient,
  context: MoveAutomationConditionImmunityContext | undefined,
): readonly string[] => {
  const candidates = context?.sweetVeilProviderCandidates
  const isAlly = context?.isAlly
  if (!candidates || !isAlly) return []
  const range = condition === 'Sleep'
    ? SWEET_VEIL_RANGE_METERS
    : condition === 'Poisoned' || condition === 'Badly Poisoned'
      ? PASTEL_VEIL_RANGE_METERS
      : null
  if (range === null) return []
  return candidates
    .filter(provider => provider.id !== recipient.placement.id
      && tokenGridDistance(provider, recipient.token) <= range
      && isAlly(provider, recipient.token))
    .map(provider => provider.id)
}

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

const aromaVeilPrevention = (options: {
  readonly condition: string
  readonly recipient: MoveCoreTokenEffectRecipient
  readonly context: AuthoritativeMoveRulesContext | undefined
}): { readonly blockedBy: string | null; readonly consultedPlacementIds: readonly string[] } => {
  const context = options.context
  if (!context) return { blockedBy: null, consultedPlacementIds: [] }
  const canonical = normalizeConditionName(options.condition) ?? options.condition
  if (!['Confused', 'Rage', 'Enraged', 'Suppressed'].includes(canonical)) {
    return { blockedBy: null, consultedPlacementIds: [] }
  }
  const provider = context.queries.placements.all().find(placement => {
    const token = context.queries.tokens.get(placement.id)
    return token
      && context.queries.abilities.has(placement.id, 'Aroma Veil')
      && tokenGridDistance(token, options.recipient.token) <= 1
  })
  return provider
    ? {
        blockedBy: 'Aroma Veil',
        consultedPlacementIds: provider.id === options.recipient.placement.id ? [] : [provider.id],
      }
    : { blockedBy: null, consultedPlacementIds: [] }
}

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
  const moveImmunity = (recipient: MoveCoreTokenEffectRecipient): string | null => {
    const ordinary = options.moveScript
      ? moveAutomationMoveImmunitySource(options.moveScript, recipient.token)
      : null
    if (ordinary) return ordinary
    const sourceId = options.context?.actor.placement.id
    const glisten = options.moveType?.trim().toLowerCase() === 'fairy'
      && sourceId !== undefined
      && sourceId !== recipient.placement.id
      && options.context?.queries.abilities.has(recipient.placement.id, 'Glisten')
    return glisten ? 'Glisten' : null
  }
  const typedAttackImmunity = (
    recipient: MoveCoreTokenEffectRecipient,
    typeSource: 'attacking' | 'defending',
  ): string | null => {
    if (!options.moveType) return 'unresolved move type'
    const target = recipient.token
    const baseMultiplier = computeMultiplier(options.moveType, target.defenderTypes)
    const multiplier = computeSheetAbilityAwareMultiplier(
      options.moveType,
      target.defenderTypes,
      target.abilityNames,
      target.defenderCapabilities,
      { baseMultiplier },
    )
    if (multiplier !== 0) return null
    if (baseMultiplier === 0) {
      if (typeSource === 'attacking') return `${options.moveType} type`
      const defenderType = target.defenderTypes.find(type => (
        computeMultiplier(options.moveType!, [type]) === 0
      ))
      return `${defenderType ?? options.moveType} type`
    }
    return getPassiveTypeEffectivenessSource(
      options.moveType,
      target.abilityNames,
      target.defenderCapabilities,
      { baseMultiplier },
    ) ?? `${options.moveType} immunity`
  }
  return {
    directHp: ({ recipient }) => {
      const wholeMoveBlocker = moveImmunity(recipient)
      if (wholeMoveBlocker) return decision(wholeMoveBlocker)
      return decision(typedAttackImmunity(recipient, 'attacking'))
    },
    condition: ({ operation, condition, recipient }) => {
      const corrosiveToxinsBypass = operation.reasonCode === 'ability.corrosive-toxins.apply-badly-poisoned'
        && normalizeConditionName(condition) === 'Badly Poisoned'
        && options.context?.queries.abilities.has(options.context.actor.placement.id, 'Corrosive Toxins')
      if (corrosiveToxinsBypass) return conditionDecision(null)
      const wholeMoveBlocker = operation.payload.applyMoveImmunity === false
        ? null
        : moveImmunity(recipient)
      if (wholeMoveBlocker) return conditionDecision(wholeMoveBlocker)
      // Cleanses are still blocked by whole-move immunities such as Soundproof,
      // but a target's immunity to the ailment itself must never block removal.
      if (operation.payload.action === 'remove' || operation.payload.action === 'clear') {
        return conditionDecision(null)
      }
      const corrosionBypass = aa064CorrosionCanPoison({
        context: options.context, condition, recipientTypes: recipient.token.defenderTypes,
      })
      if (operation.payload.applyTypeImmunity && !corrosionBypass) {
        const typedBlocker = typedAttackImmunity(recipient, 'defending')
        if (typedBlocker) return conditionDecision(typedBlocker)
      }
      const aromaVeil = aromaVeilPrevention({ condition, recipient, context: options.context })
      if (aromaVeil.blockedBy) {
        return conditionDecision(aromaVeil.blockedBy, aromaVeil.consultedPlacementIds)
      }
      const providerIds = conditionProviderIds(
        condition,
        recipient,
        conditionContext,
      )
      const passiveBlocker = moveAutomationConditionImmunitySource(
        condition,
        corrosionBypass
          ? {
              ...recipient.token,
              defenderTypes: recipient.token.defenderTypes.filter(type => (
                !['poison', 'steel'].includes(type.trim().toLowerCase())
              )),
            }
          : recipient.token,
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
    combatStage: ({ operation, stage, delta, recipient, sourceOwnerId }) => {
      const stageSourceOwnerId = sourceOwnerId ?? options.context?.actor.placement.id ?? null
      const sourceIsEnemy = stageSourceOwnerId !== null && options.context
        ? options.context.queries.relationships.resolve(
            stageSourceOwnerId,
            recipient.placement.id,
          ).relationship === 'enemy'
        : false
      const ordinaryBlocker = moveImmunity(recipient)
        ?? (
          operation.payload.applyTypeImmunity
          && operation.recipients.kind !== 'actor'
            ? typedAttackImmunity(recipient, 'defending')
            : null
        )
        ?? (
          operation.payload.trigger?.kind === 'accuracy-roll'
          && operation.recipients.kind !== 'actor'
          && tokenHasShieldDust(recipient.token)
            ? SHIELD_DUST_ABILITY_NAME
            : null
        )
        ?? (
          delta < 0
          && options.context?.queries.abilities.has(recipient.placement.id, 'Clear Body')
          && sourceIsEnemy
            ? 'Clear Body'
            : null
        )
        ?? (
          delta < 0
          && options.context?.queries.abilities.has(recipient.placement.id, 'Full Metal Body')
          && sourceIsEnemy
            ? 'Full Metal Body'
            : null
        )
        ?? (
          stage === 'def'
          && delta < 0
          && options.context?.queries.abilities.has(recipient.placement.id, 'Big Pecks')
            ? 'Big Pecks'
            : null
        )
        ?? moveAutomationCombatStageBlockSource({
          target: recipient.token,
          key: stage,
          delta,
        })
      if (ordinaryBlocker || delta >= 0) return decision(ordinaryBlocker)
      const flowerVeilProviders = options.context?.queries.placements.all().flatMap((placement) => {
        if (!options.context?.queries.abilities.has(placement.id, 'Flower Veil')) return []
        const token = options.context.queries.tokens.get(placement.id)
        return token && tokenGridDistance(token, recipient.token) <= 5 ? [placement.id] : []
      }) ?? []
      const protectedRecipient = flowerVeilProviders.includes(recipient.placement.id)
        || recipient.token.defenderTypes.some(type => type.trim().toLowerCase() === 'grass')
      return protectedRecipient && flowerVeilProviders.length > 0
        ? decision('Flower Veil', flowerVeilProviders)
        : decision(null)
    },
  }
}

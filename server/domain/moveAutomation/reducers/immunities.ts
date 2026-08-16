import {
  SHIELD_DUST_ABILITY_NAME,
  moveAutomationCombatStageBlockSource,
  tokenHasShieldDust,
} from '~/utils/moveAutomationAbilityProtection'
import {
  PASTEL_VEIL_RANGE_METERS,
  SWEET_VEIL_RANGE_METERS,
  moveAutomationConditionImmunitySource,
  type MoveAutomationConditionImmunityContext,
} from '~/utils/moveAutomationConditionImmunity'
import { tokenGridDistance } from '~/utils/moveAutomationRange'
import { moveAutomationMoveImmunitySource } from '~/utils/moveAutomationMoveImmunity'
import { moveAutomationTargetSuppressesGroundsourceImmunity } from '~/utils/moveAutomationKeywordImmunity'
import {
  computeSheetAbilityAwareMultiplier,
  getPassiveTypeEffectivenessSource,
} from '~/utils/sheetPassiveAbilityEffects'
import { projectEffectiveConditions } from '~/utils/encounterConditions'
import { conditionBaseName, normalizeConditionName } from '~/utils/statusConditions'
import type { AuthoritativeMoveRulesContext } from '../context'
import type { MoveEffectOperation } from '#shared/moveAutomation/effects'
import { computeMultiplier } from '~/utils/typeChart'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import { aa064CorrosionCanPoison } from '../../abilityAutomation/mechanics/aa064MoveIntegration'
import {
  AA073_GULP_MISSILE_DEFENSE_REASON,
  AA073_GULP_MISSILE_HP_REASON,
  AA073_GULP_MISSILE_PARALYZE_REASON,
  aa073GulpMissileAccuracyOutcome,
} from '../../abilityAutomation/mechanics/aa073MoveIntegration'
import { aa074HyperCutterBlocksStage } from '../../abilityAutomation/mechanics/aa074StaticIntegration'
import { AA076_IRON_BARBS_HP_REASON } from '../../abilityAutomation/mechanics/aa076MoveIntegration'
import { aa078LightningRodBlocksElectric } from '../../abilityAutomation/mechanics/aa078StaticIntegration'
import {
  aa080MojoIgnoresNormalImmunity,
  aa080MotorDriveBlocksElectric,
} from '../../abilityAutomation/mechanics/aa080StaticIntegration'
import { AA080_MOTOR_DRIVE_STAGE_REASON } from '../../abilityAutomation/mechanics/aa080MoveIntegration'
import { authoritativeUnnerveBlocksTarget } from '../unnerve'
import { itemMoveCombatStageReductionBlocker } from '../../itemAutomation/combatEffects'
import {
  equipmentConditionImmunityReason,
  equipmentHpChangePreventionReason,
  equipmentMoveImmunityReason,
  equipmentRemovesTypeImmunity,
} from '../equipmentProviderMechanics'
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
  readonly moveScript?: MoveAutomationScript
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
  const gulpMissileAccuracyBlocker = (operation: MoveEffectOperation): string | null => {
    if (![AA073_GULP_MISSILE_HP_REASON, AA073_GULP_MISSILE_PARALYZE_REASON, AA073_GULP_MISSILE_DEFENSE_REASON]
      .includes(operation.reasonCode as typeof AA073_GULP_MISSILE_HP_REASON)) return null
    if (!options.context || !options.moveScript) return 'Gulp Missile unresolved accuracy'
    const outcome = aa073GulpMissileAccuracyOutcome({
      context: options.context,
      operation,
      parentScript: options.moveScript,
    })
    if (!outcome?.hit) return 'Gulp Missile missed'
    if (operation.reasonCode === AA073_GULP_MISSILE_PARALYZE_REASON
      && outcome.naturalResult % 2 !== 0) return 'Gulp Missile odd-roll branch'
    if (operation.reasonCode === AA073_GULP_MISSILE_DEFENSE_REASON
      && outcome.naturalResult % 2 === 0) return 'Gulp Missile even-roll branch'
    return null
  }
  const motorDriveBlocksOperation = (
    recipient: MoveCoreTokenEffectRecipient,
    operation: MoveEffectOperation | undefined,
  ): boolean => operation?.recipients.kind !== 'actor'
    && operation?.reasonCode !== AA080_MOTOR_DRIVE_STAGE_REASON
    && aa080MotorDriveBlocksElectric({
      context: options.context,
      recipientId: recipient.placement.id,
      moveType: options.moveType,
    })
  const moveImmunity = (
    recipient: MoveCoreTokenEffectRecipient,
    operation?: MoveEffectOperation,
  ): string | null => {
    if (motorDriveBlocksOperation(recipient, operation)) return 'Motor Drive'
    const equipment = equipmentMoveImmunityReason({
      context: options.context,
      placementId: recipient.placement.id,
      script: options.moveScript,
    })
    if (equipment) return equipment
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
    operation?: MoveEffectOperation,
  ): string | null => {
    if (!options.moveType) return 'unresolved move type'
    const target = recipient.token
    if (typeSource === 'attacking' && aa078LightningRodBlocksElectric({
      context: options.context,
      recipientId: recipient.placement.id,
      moveType: options.moveType,
    })) return 'Lightning Rod'
    if (typeSource === 'attacking' && motorDriveBlocksOperation(recipient, operation)) return 'Motor Drive'
    const equipmentSuppressesImmunity = equipmentRemovesTypeImmunity({
      context: options.context,
      placementId: recipient.placement.id,
      typeId: options.moveType,
    })
    const effectiveLevitate = typeSource === 'attacking'
      && options.moveType.trim().toLowerCase() === 'ground'
      && !equipmentSuppressesImmunity
      && options.context?.queries.abilities.has(recipient.placement.id, 'Levitate') === true
      && options.context.queries.gravity.groundInteraction({
        placementId: recipient.placement.id,
        moveType: options.moveType,
      }).suppressesLevitateResistance === false
      && !moveAutomationTargetSuppressesGroundsourceImmunity(target)
    if (effectiveLevitate) return 'Levitate'
    // Levitate is managed by exact effective-ability authority. Excluding the
    // raw sheet name prevents suppressed/stale instances from contributing.
    const passiveAbilityNames = target.abilityNames?.filter(name => (
      !['Levitate', 'Motor Drive'].includes(name.trim())
    ))
    const defenderTypes = (options.context
      ? target.defenderTypes.filter(defenderType => !aa080MojoIgnoresNormalImmunity({
          context: options.context!,
          moveType: options.moveType!,
          defenderType,
        }))
      : target.defenderTypes).filter(defenderType => (
      !equipmentSuppressesImmunity || computeMultiplier(options.moveType!, [defenderType]) !== 0
    ))
    const baseMultiplier = computeMultiplier(options.moveType, defenderTypes)
    const multiplier = equipmentSuppressesImmunity
      ? baseMultiplier
      : computeSheetAbilityAwareMultiplier(
          options.moveType,
          defenderTypes,
          passiveAbilityNames,
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
      passiveAbilityNames,
      target.defenderCapabilities,
      { baseMultiplier },
    ) ?? `${options.moveType} immunity`
  }
  return {
    directHp: ({ operation, recipient }) => {
      const equipmentBlocker = equipmentHpChangePreventionReason({
        context: options.context,
        placementId: recipient.placement.id,
        reasonCode: operation.reasonCode,
      })
      if (equipmentBlocker) return decision(equipmentBlocker)
      if (operation.reasonCode === AA073_GULP_MISSILE_HP_REASON) {
        return decision(gulpMissileAccuracyBlocker(operation))
      }
      if (operation.reasonCode === AA076_IRON_BARBS_HP_REASON) {
        const blockedBy = ['Permafrost', 'Magic Guard'].find(canonicalId => (
          options.context?.queries.abilities.has(recipient.placement.id, canonicalId)
        )) ?? null
        return decision(blockedBy)
      }
      const wholeMoveBlocker = moveImmunity(recipient, operation)
      if (wholeMoveBlocker) return decision(wholeMoveBlocker)
      return decision(typedAttackImmunity(recipient, 'attacking', operation))
    },
    condition: ({ operation, condition, recipient }) => {
      const gulpMissileBlocker = gulpMissileAccuracyBlocker(operation)
      if (gulpMissileBlocker) return conditionDecision(gulpMissileBlocker)
      const corrosiveToxinsBypass = operation.reasonCode === 'ability.corrosive-toxins.apply-badly-poisoned'
        && normalizeConditionName(condition) === 'Badly Poisoned'
        && options.context?.queries.abilities.has(options.context.actor.placement.id, 'Corrosive Toxins')
      if (corrosiveToxinsBypass) return conditionDecision(null)
      const candidateMoveBlocker = moveImmunity(recipient, operation)
      const wholeMoveBlocker = candidateMoveBlocker === 'Motor Drive'
        || operation.payload.applyMoveImmunity !== false
        ? candidateMoveBlocker
        : null
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
        const typedBlocker = typedAttackImmunity(recipient, 'defending', operation)
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
      const canonicalCondition = normalizeConditionName(condition) ?? condition
      const equipmentConditionBlocker = equipmentConditionImmunityReason({
        context: options.context,
        placementId: recipient.placement.id,
        conditionId: canonicalCondition,
        script: options.moveScript,
      })
      if (equipmentConditionBlocker) return conditionDecision(equipmentConditionBlocker, providerIds)
      const poisonCondition = canonicalCondition === 'Poisoned' || canonicalCondition === 'Badly Poisoned'
      const toxicBoostAllowsPoison = poisonCondition
        && options.context?.queries.abilities.has(recipient.placement.id, 'Toxic Boost')
        && options.context.queries.abilities.has(recipient.placement.id, 'Immunity')
      const effectiveConditionImmunity = poisonCondition
        && !toxicBoostAllowsPoison
        && options.context?.queries.abilities.has(recipient.placement.id, 'Immunity')
        ? 'Immunity'
        : canonicalCondition === 'Sleep'
          && (options.context?.queries.abilities.has(recipient.placement.id, 'Insomnia')
            || options.context?.queries.abilities.has(recipient.placement.id, 'Vital Spirit'))
          ? options.context?.queries.abilities.has(recipient.placement.id, 'Vital Spirit')
            ? 'Vital Spirit'
            : 'Insomnia'
          : canonicalCondition === 'Burned'
            && (options.context?.queries.abilities.has(recipient.placement.id, 'Water Veil')
              || options.context?.queries.abilities.has(recipient.placement.id, 'Water Bubble'))
            ? options.context?.queries.abilities.has(recipient.placement.id, 'Water Bubble')
              ? 'Water Bubble'
              : 'Water Veil'
          : canonicalCondition === 'Vulnerable'
            && options.context?.queries.abilities.has(recipient.placement.id, 'Tangled Feet')
            ? 'Tangled Feet'
          : canonicalCondition === 'Flinch'
            && options.context?.queries.abilities.has(recipient.placement.id, 'Inner Focus')
            ? 'Inner Focus'
            : canonicalCondition === 'Paralysis'
              && options.context?.queries.abilities.has(recipient.placement.id, 'Limber')
              ? 'Limber'
            : canonicalCondition === 'Blindness'
              && options.context?.queries.abilities.has(recipient.placement.id, 'Keen Eye')
              ? 'Keen Eye'
            : canonicalCondition === 'Blindness'
              && options.context?.queries.creatureRules.hasCapability(recipient.placement.id, 'Blindsense')
              ? 'Blindsense'
              : null
      if (effectiveConditionImmunity) return conditionDecision(effectiveConditionImmunity, providerIds)
      const typedRecipient = corrosionBypass
        ? {
            ...recipient.token,
            defenderTypes: recipient.token.defenderTypes.filter(type => (
              !['poison', 'steel'].includes(type.trim().toLowerCase())
            )),
          }
        : recipient.token
      // Runtime token abilityNames already contain only current effective abilities,
      // including legacy-compatible rows that are not yet natively promoted. Reusing
      // that projection here preserves suppression without dropping rollout rows.
      const passiveBlocker = moveAutomationConditionImmunitySource(
        condition,
        toxicBoostAllowsPoison
          ? { ...typedRecipient, abilityNames: (typedRecipient.abilityNames ?? []).filter(name => name !== 'Immunity') }
          : typedRecipient,
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
      const gulpMissileBlocker = gulpMissileAccuracyBlocker(operation)
      if (gulpMissileBlocker) return decision(gulpMissileBlocker)
      const stageSourceOwnerId = sourceOwnerId ?? options.context?.actor.placement.id ?? null
      const sourceIsEnemy = stageSourceOwnerId !== null && options.context
        ? options.context.queries.relationships.resolve(
            stageSourceOwnerId,
            recipient.placement.id,
          ).relationship === 'enemy'
        : false
      const ordinaryBlocker = itemMoveCombatStageReductionBlocker({
        effects: options.context?.map.encounterState?.effects,
        placementId: recipient.placement.id,
        delta,
        // Parser-authorized runtime operations always carry a source. A few
        // direct immunity-query fixtures intentionally construct the older
        // source-less shape; treat those as ordinary Move-authored effects.
        operationSourceKind: operation.source?.kind ?? 'move',
      })
        ?? moveImmunity(recipient, operation)
        ?? (
          operation.payload.applyTypeImmunity
          && operation.recipients.kind !== 'actor'
            ? typedAttackImmunity(recipient, 'defending', operation)
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
          delta < 0
          && options.context?.queries.abilities.has(recipient.placement.id, 'White Smoke')
          && stageSourceOwnerId !== recipient.placement.id
            ? 'White Smoke'
            : null
        )
        ?? (
          delta > 0
          && authoritativeUnnerveBlocksTarget(
            options.context?.map.encounterState?.effects,
            recipient.placement.id,
          )
            ? 'Unnerve'
            : null
        )
        ?? (
          options.context && aa074HyperCutterBlocksStage({
            context: options.context,
            placementId: recipient.placement.id,
            stage,
            delta,
          }) ? 'Hyper Cutter' : null
        )
        ?? (
          stage === 'acc'
          && delta < 0
          && options.context?.queries.abilities.has(recipient.placement.id, 'Keen Eye')
            ? 'Keen Eye'
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
          target: options.context
            ? {
                ...recipient.token,
                abilityNames: recipient.token.abilityNames?.filter(name => (
                  name.trim().toLowerCase() !== 'keen eye'
                )),
              }
            : recipient.token,
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

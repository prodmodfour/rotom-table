import { createHash } from 'node:crypto'
import type { ItemAggregateRef, ItemOperationPlanV1, PlannedItemOperation, UseItemCommandV1 } from '#shared/itemAutomation/operations'
import type { ItemNonEncounterExecutionSnapshotV1 } from '#shared/itemAutomation/nonEncounter'
import type { StrictJsonObject } from '#shared/automation/strictJson'
import type { ItemEffectSpec, ItemRuntimeDefinition } from '#shared/itemAutomation/spec'
import type { AuthoritativeItemInventoryInstance } from '#shared/itemAutomation/inventory'
import type { SheetKind } from '#shared/sheets'
import type { AnyLiveSheet } from '~/utils/sheetMutations'
import type { TrainerSheet } from '~/types/trainerSheet'
import type { CharacterSheet } from '~/types/characterSheet'
import { sheetHasCanonicalEdge } from '#shared/edgeAutomation/sheetEdges'
import { ITEM_RESTORATIVE_NEXT_TURN_FLAG_ID } from '../moveAutomation/reduceEncounterResources'
import { resolveItemHpRestoration, type ItemHealingDieRoller } from './healing'
import { itemApDrainId, previewItemApDrain } from './ap'
import { resolveItemConditionRemoval } from './conditionRemoval'
import { previewItemRevival } from './revival'
import { itemDigestionBuffPreviewDescription } from './digestionBuffs'
import { itemMedicalTreatmentId } from './medicalTreatments'
import { resolvePermanentItemAdvancement } from './permanentAdvancement'
import { resolveMachineMoveLearning } from './moveLearning'
import { resolveItemEvolution } from './evolution'
import {
  applyItemRepelCampaignEffect,
  ITEM_DOWSING_SKILL_STUNT_CHOICE_ID,
  ITEM_DOWSING_TERRAIN_CHOICE_ID,
  ITEM_EXPLORATION_USE_MODE_CHOICE_ID,
  resolveItemDowsing,
  startItemRouteLure,
  type ItemDowsingTerrain,
} from './exploration'
import { resolveSkills } from '~/utils/sheets/pokemonDerived'
import { placementToSpawned } from '~/utils/placement'
import {
  ITEM_GUIDED_CAMPAIGN_TOOL_ACCEPT_OPTION_ID,
  ITEM_GUIDED_CAMPAIGN_TOOL_CHOICE_ID,
  ITEM_GUIDED_LOYALTY_CHOICE_ID,
  ITEM_GUIDED_LOYALTY_DECREASE_OPTION_ID,
  ITEM_GUIDED_LOYALTY_NO_CHANGE_OPTION_ID,
} from '#shared/itemAutomation/guidedAdjudication'
import {
  moveAutomationUserAccuracy,
  resolveMoveAutomationTargetEvasion,
} from '~/utils/moveAutomationAccuracy'
import {
  createItemTemporaryCombatEffect,
  itemCombatStagePreviewDescription,
  itemTemporaryEffectPreviewDescription,
  resolveItemCombatStageModification,
} from './combatEffects'

export interface ItemPlanTarget {
  readonly participantId: string
  readonly sheetKind: SheetKind
  readonly sheetSlug: string
  readonly revision: number
  readonly sheet: AnyLiveSheet
}

export interface PlanItemOperationInput {
  readonly command: UseItemCommandV1
  readonly definition: ItemRuntimeDefinition
  readonly source: AuthoritativeItemInventoryInstance
  readonly targets: readonly ItemPlanTarget[]
  /** Detached authoritative actor sheet used for reviewed actor-owned exceptions. */
  readonly actorSheet?: AnyLiveSheet
  /** Server-owned entropy. Called only for reviewed rolled healing effects. */
  readonly rollHealingDie?: ItemHealingDieRoller
  /** Detached authoritative map used to materialize durable temporary effects. */
  readonly map?: import('~/types/map').TabletopMap | null
  /** Persisted singleton clock minute, required only for reviewed daily effects. */
  readonly campaignMinute?: number
  /** Server-owned operation boundary used for AP expiry checks and immutable drain evidence. */
  readonly operationTimestamp?: number
  /** Server-authored and persisted campaign/ownership/activity evidence. */
  readonly nonEncounterContext?: ItemNonEncounterExecutionSnapshotV1 | null
}

const aggregateKey = (value: ItemAggregateRef): string => value.kind === 'sheet'
  ? `${value.kind}:${value.sheetKind}:${value.id}`
  : `${value.kind}:${value.id}`

const targetAggregate = (target: ItemPlanTarget, readSet: readonly ItemAggregateRef[]): ItemAggregateRef => {
  const key = `sheet:${target.sheetKind}:${target.sheetSlug}`
  const aggregate = readSet.find(value => aggregateKey(value) === key)
  if (!aggregate || aggregate.kind !== 'sheet' || aggregate.revision !== target.revision) {
    throw new Error(`Item target ${target.participantId} is absent from the authoritative read set.`)
  }
  return aggregate
}

const actorAggregate = (input: PlanItemOperationInput): Extract<ItemAggregateRef, { readonly kind: 'sheet' }> => {
  const aggregate = input.command.readSet.find(value => value.kind === 'sheet'
    && value.sheetKind === input.command.actorSheet.kind
    && value.id === input.command.actorSheet.slug)
  if (!aggregate || aggregate.kind !== 'sheet'
    || aggregate.revision !== input.command.actorSheet.expectedRevision) {
    throw new Error('Item actor sheet is absent from the authoritative read set.')
  }
  return aggregate
}

const sourceAggregate = (input: PlanItemOperationInput): ItemAggregateRef => {
  const key = input.source.containerKind === 'trainer'
    ? `sheet:trainer:${input.source.containerSlug}`
    : `group-inventory:${input.source.containerSlug}`
  const aggregate = input.command.readSet.find(value => aggregateKey(value) === key)
  if (!aggregate || aggregate.revision !== input.source.revision) throw new Error('Item source inventory is absent from the authoritative read set.')
  return aggregate
}

const operation = (input: Omit<PlannedItemOperation, 'ordinal'>, ordinal: number): PlannedItemOperation => ({ ...input, ordinal })

const executionSnapshotForPlan = (
  input: PlanItemOperationInput,
  requireCompletion: boolean,
): ItemNonEncounterExecutionSnapshotV1 | null => {
  if (input.command.context === 'encounter') {
    if (input.nonEncounterContext) throw new Error('Encounter item planning rejects non-encounter authority.')
    return null
  }
  const snapshot = input.nonEncounterContext
    ?? (() => { throw new Error('Non-encounter item planning requires authoritative execution context evidence.') })()
  if (snapshot.context !== input.command.context
    || snapshot.actor.sheetKind !== input.command.actorSheet.kind
    || snapshot.actor.sheetSlug !== input.command.actorSheet.slug
    || snapshot.actor.sheetRevision !== input.command.actorSheet.expectedRevision) {
    throw new Error('Non-encounter item execution evidence does not match the command actor or context.')
  }
  const clock = input.command.readSet.find(ref => ref.kind === 'campaign-clock')
  if (!clock || clock.revision !== snapshot.campaignTime.clockRevision
    || input.campaignMinute !== snapshot.campaignTime.campaignMinute) {
    throw new Error('Non-encounter item execution evidence does not match the campaign clock read.')
  }
  const targets = new Set(snapshot.targetAuthorities.map(target => target.targetId))
  if (input.targets.some(target => !targets.has(target.participantId))) {
    throw new Error('Non-encounter item execution evidence omitted a selected target authority.')
  }
  if (requireCompletion && snapshot.extendedAction.mode === 'extended'
    && snapshot.extendedAction.phase !== 'completion') {
    throw new Error('An Extended Action item can resolve only at its authoritative completion boundary.')
  }
  if (snapshot.gmConfirmation.required && snapshot.gmConfirmation.status !== 'confirmed') {
    throw new Error('Required GM confirmation is absent from non-encounter item execution evidence.')
  }
  return snapshot
}

const explorationRollDie = (
  roller: ItemHealingDieRoller | undefined,
  sides: number,
): number => (roller ?? (() => { throw new Error('Exploration item resolution requires server-owned entropy.') }))(sides)

const pokemonSkillDice = (sheet: CharacterSheet, skillId: 'focus'): {
  readonly expression: string
  readonly diceCount: number
  readonly modifier: number
} => {
  const expression = resolveSkills(sheet).find(skill => skill.key === skillId)?.value ?? '2d6'
  const match = /^\s*(\d+)d6(?:\s*([+-])\s*(\d+))?\s*$/iu.exec(expression)
  if (!match) throw new Error(`The target ${skillId} skill has unsupported dice authority.`)
  const diceCount = Number.parseInt(match[1]!, 10)
  const magnitude = Number.parseInt(match[3] ?? '0', 10)
  const modifier = match[2] === '-' ? -magnitude : magnitude
  if (!Number.isSafeInteger(diceCount) || diceCount < 1 || diceCount > 8
    || !Number.isSafeInteger(modifier) || Math.abs(modifier) > 20) {
    throw new Error(`The target ${skillId} skill is outside supported roll bounds.`)
  }
  return { expression: `${diceCount}d6${modifier === 0 ? '' : modifier > 0 ? `+${modifier}` : modifier}`, diceCount, modifier }
}

const directRepelAccuracy = (input: {
  readonly map: import('~/types/map').TabletopMap
  readonly actorSheet: AnyLiveSheet
  readonly actorSheetKind: SheetKind
  readonly actorSheetSlug: string
  readonly actorPlacementId: string
  readonly target: ItemPlanTarget
  readonly rollHealingDie?: ItemHealingDieRoller
}): {
  readonly naturalRoll: number
  readonly userAccuracy: number
  readonly targetSpeedEvasion: number
  readonly accuracyCheck: number
  readonly hit: boolean
} => {
  const actorPlacement = input.map.placements.find(placement => placement.id === input.actorPlacementId)
  const targetPlacement = input.map.placements.find(placement => placement.id === input.target.participantId)
  if (!actorPlacement || !targetPlacement || targetPlacement.sheetKind !== 'pokemon') {
    throw new Error('Direct Repel requires exact actor and wild Pokémon placements.')
  }
  const pokemon = new Map<string, CharacterSheet>()
  const trainer = new Map<string, TrainerSheet>()
  if (input.actorSheetKind === 'pokemon') pokemon.set(input.actorSheetSlug, input.actorSheet as CharacterSheet)
  else trainer.set(input.actorSheetSlug, input.actorSheet as TrainerSheet)
  pokemon.set(input.target.sheetSlug, input.target.sheet as CharacterSheet)
  const sheets = { pokemon, trainer }
  const actorToken = placementToSpawned(actorPlacement, sheets, input.map)
  const targetToken = placementToSpawned(targetPlacement, sheets, input.map)
  if (!actorToken || !targetToken) throw new Error('Direct Repel could not resolve authoritative encounter tokens.')
  const naturalRoll = explorationRollDie(input.rollHealingDie, 20)
  const userAccuracy = moveAutomationUserAccuracy(actorToken)
  const targetSpeedEvasion = resolveMoveAutomationTargetEvasion(null, targetToken, { attacker: actorToken }).value
  const accuracyCheck = 6 + targetSpeedEvasion
  const hit = naturalRoll === 20 || (naturalRoll !== 1 && naturalRoll + userAccuracy >= accuracyCheck)
  return { naturalRoll, userAccuracy, targetSpeedEvasion, accuracyCheck, hit }
}

const effectPayload = (input: {
  readonly effect: Exclude<ItemEffectSpec, { readonly operation: 'guided' }>
  readonly target: ItemPlanTarget
  readonly selectedChoices: ReadonlyMap<string, readonly string[]>
  readonly definition: ItemRuntimeDefinition
  readonly command: UseItemCommandV1
  readonly map?: import('~/types/map').TabletopMap | null
  readonly campaignMinute?: number
  readonly rollHealingDie?: ItemHealingDieRoller
  readonly actorSheet?: AnyLiveSheet
  readonly source: AuthoritativeItemInventoryInstance
  readonly operationTimestamp?: number
  readonly nonEncounterContext?: ItemNonEncounterExecutionSnapshotV1 | null
}): PlannedItemOperation['payload'] => {
  const effect = input.effect
  if (effect.operation === 'heal-hp') {
    const healing = resolveItemHpRestoration({
      restoration: effect.restoration,
      sheetKind: input.target.sheetKind,
      sheet: input.target.sheet,
      actorSheetKind: input.command.actorSheet.kind,
      actorSheet: input.actorSheet,
      rollDie: input.rollHealingDie ?? (() => { throw new Error('Rolled item healing requires server-owned entropy.') }),
    })
    return {
      action: 'heal',
      calculationKind: healing.calculationKind,
      currentHp: healing.currentHp,
      fullFormulaMaximumHp: healing.fullFormulaMaximumHp,
      effectiveMaximumHp: healing.effectiveMaximumHp,
      injuries: healing.injuries,
      requestedHealing: healing.requestedHealing,
      effectiveHealing: healing.effectiveHealing,
      overheal: healing.overheal,
      resultingHp: healing.resultingHp,
      roll: healing.roll
        ? healing.calculationKind === 'skill-check'
          ? {
              expression: healing.roll.expression,
              rolls: [...healing.roll.rolls],
              modifier: healing.roll.modifier,
              total: healing.roll.total,
              skillId: healing.roll.skillId
                ?? (() => { throw new Error('Item skill-check healing omitted skill identity.') })(),
              rankValue: healing.roll.rankValue
                ?? (() => { throw new Error('Item skill-check healing omitted rank evidence.') })(),
              dieSides: healing.roll.dieSides
                ?? (() => { throw new Error('Item skill-check healing omitted die evidence.') })(),
              actorSheetKind: input.command.actorSheet.kind,
              actorSheetSlug: input.command.actorSheet.slug,
              actorSheetRevision: input.command.actorSheet.expectedRevision,
            }
          : {
              expression: healing.roll.expression,
              rolls: [...healing.roll.rolls],
              modifier: healing.roll.modifier,
              total: healing.roll.total,
            }
        : null,
      cap: effect.restoration.cap,
      faintedState: effect.restoration.faintedState,
    }
  }
  if (effect.operation === 'revive') {
    const revival = previewItemRevival({
      revival: effect.revival,
      sheetKind: input.target.sheetKind,
      sheet: input.target.sheet,
    })
    return {
      action: 'revive',
      calculationKind: revival.calculationKind,
      currentHp: revival.currentHp,
      fullFormulaMaximumHp: revival.fullFormulaMaximumHp,
      effectiveMaximumHp: revival.effectiveMaximumHp,
      injuries: revival.injuries,
      requestedHp: revival.requestedHp,
      resultingHp: revival.resultingHp,
      capReducedAmount: revival.capReducedAmount,
      cap: effect.revival.cap,
      targetKind: effect.revival.targetKind,
      faintedState: effect.revival.faintedState,
    }
  }
  if (effect.operation === 'remove-conditions') {
    const choiceId = `condition:${effect.effectId}`
    const resolved = resolveItemConditionRemoval({
      spec: effect,
      sheetKind: input.target.sheetKind,
      sheet: input.target.sheet,
      selectedConditionIds: effect.selection === 'choose-one'
        ? input.selectedChoices.get(choiceId) ?? []
        : [],
      allowNoApplicable: effect.selection === 'all-applicable'
        && input.definition.spec.effects.some(candidate => candidate.effectId !== effect.effectId),
    })
    return {
      action: 'remove',
      mode: effect.mode,
      selection: effect.selection,
      currentConditions: [...resolved.currentConditions],
      removedConditionIds: [...resolved.removedConditionIds],
      removedEntries: [...resolved.removedEntries],
      resultingConditions: [...resolved.resultingConditions],
    }
  }
  if (effect.operation === 'modify-stage') {
    const stage = resolveItemCombatStageModification({
      sheetKind: input.target.sheetKind,
      sheet: input.target.sheet,
      stat: effect.stat,
      amount: effect.amount,
    })
    return {
      action: 'modify',
      stat: stage.stat,
      previous: stage.previous,
      requestedDelta: stage.requestedDelta,
      appliedDelta: stage.appliedDelta,
      current: stage.current,
      minimum: stage.minimum,
      maximum: stage.maximum,
      capped: stage.capped,
    }
  }
  if (effect.operation === 'store-digestion-buff') {
    return {
      action: 'store-digestion-buff',
      canonicalItemId: input.definition.canonicalId,
      buffKind: effect.buffKind,
      amount: effect.amount,
      denominator: effect.denominator,
      requiredPokemonType: effect.requiredPokemonType,
    }
  }
  if (effect.operation === 'modify-base-stat'
    || effect.operation === 'grant-tutor-points'
    || effect.operation === 'increase-move-frequency'
    || effect.operation === 'gain-next-level-experience') {
    const appliedAt = input.operationTimestamp
    if (!Number.isSafeInteger(appliedAt) || Number(appliedAt) < 0) {
      throw new Error('Permanent advancement requires a server-owned operation timestamp.')
    }
    return resolvePermanentItemAdvancement({
      definition: input.definition,
      sheetKind: input.target.sheetKind,
      sheet: input.target.sheet,
      selectedChoices: input.selectedChoices,
      operationId: input.command.operationId,
      appliedAt: Number(appliedAt),
    }).payload as StrictJsonObject
  }
  if (effect.operation === 'learn-machine-move') {
    const appliedAt = input.operationTimestamp
    const campaignMinute = input.campaignMinute
    if (!Number.isSafeInteger(appliedAt) || Number(appliedAt) < 0
      || !Number.isSafeInteger(campaignMinute) || Number(campaignMinute) < 0
      || input.command.actorSheet.kind !== 'trainer' || !input.actorSheet) {
      throw new Error('Machine Move learning requires Trainer, campaign-time, and server-timestamp authority.')
    }
    const activity = input.nonEncounterContext?.extendedAction
    if (activity?.mode !== 'extended' || activity.phase !== 'completion'
      || activity.startedAtCampaignMinute === null) {
      throw new Error('Machine Move learning requires an authoritative Extended Action completion boundary.')
    }
    return resolveMachineMoveLearning({
      definition: input.definition,
      sheetKind: input.target.sheetKind,
      sheet: input.target.sheet,
      actorKind: input.command.actorSheet.kind,
      actorSheet: input.actorSheet,
      sourceInstanceId: input.source.instanceId,
      campaignMinute: Number(campaignMinute),
      selectedChoices: input.selectedChoices,
      operationId: input.command.operationId,
      appliedAt: Number(appliedAt),
    }).targetPayload as StrictJsonObject
  }
  if (effect.operation === 'evolve-pokemon') {
    const appliedAt = input.operationTimestamp
    if (!Number.isSafeInteger(appliedAt) || Number(appliedAt) < 0
      || input.command.actorSheet.kind !== 'trainer') {
      throw new Error('Item evolution requires Trainer and server-timestamp authority.')
    }
    return resolveItemEvolution({
      definition: input.definition,
      sheetKind: input.target.sheetKind,
      sheet: input.target.sheet as CharacterSheet,
      actorKind: input.command.actorSheet.kind,
      sourceInstanceId: input.source.instanceId,
      selectedChoices: input.selectedChoices,
      operationId: input.command.operationId,
      appliedAt: Number(appliedAt),
    }).payload as StrictJsonObject
  }
  if (effect.operation === 'use-bait' || effect.operation === 'use-snack-or-bait') {
    const mode = input.selectedChoices.get(ITEM_EXPLORATION_USE_MODE_CHOICE_ID)?.[0]
      ?? (() => { throw new Error('Bait use requires one exact reviewed mode.') })()
    if (mode === 'snack' && effect.operation === 'use-snack-or-bait') {
      return {
        action: 'store-digestion-buff',
        canonicalItemId: input.definition.canonicalId,
        buffKind: effect.buffKind,
        amount: effect.amount,
        denominator: effect.denominator,
        requiredPokemonType: effect.requiredPokemonType,
      }
    }
    if (mode === 'route-lure') {
      if (input.command.context === 'encounter' || input.target.sheetKind !== 'trainer'
        || input.target.sheetSlug !== input.command.actorSheet.slug) {
        throw new Error('Route lure activation requires the acting Trainer as its non-encounter target.')
      }
      const campaignMinute = input.campaignMinute
      if (!Number.isSafeInteger(campaignMinute) || Number(campaignMinute) < 0) {
        throw new Error('Route lure activation requires campaign-clock authority.')
      }
      const resolved = startItemRouteLure({
        current: (input.target.sheet as TrainerSheet).serverPrivate?.itemExploration,
        definition: input.definition,
        sourceOperationId: input.command.operationId,
        sourceInstanceId: input.source.instanceId,
        campaignMinute: Number(campaignMinute),
      })
      return { action: 'start-route-lure', activity: structuredClone(resolved.activity) as unknown as StrictJsonObject }
    }
    if (mode !== 'wild-distraction' || input.command.context !== 'encounter'
      || input.target.sheetKind !== 'pokemon') {
      throw new Error('The selected Bait mode is unavailable in this context.')
    }
    const profile = pokemonSkillDice(input.target.sheet as CharacterSheet, 'focus')
    const rolls = Array.from({ length: profile.diceCount }, () => explorationRollDie(input.rollHealingDie, 6))
    const total = rolls.reduce((sum, roll) => sum + roll, profile.modifier)
    return {
      action: 'wild-distraction',
      focusDc: effect.focusDc,
      focus: {
        expression: profile.expression,
        rolls,
        modifier: profile.modifier,
        total,
      },
      failed: total < effect.focusDc,
    }
  }
  if (effect.operation === 'start-route-lure') {
    if (input.command.context === 'encounter' || input.target.sheetKind !== 'trainer'
      || input.target.sheetSlug !== input.command.actorSheet.slug) {
      throw new Error('Fishing Lure activation requires the acting Trainer as its non-encounter target.')
    }
    const campaignMinute = input.campaignMinute
    if (!Number.isSafeInteger(campaignMinute) || Number(campaignMinute) < 0) {
      throw new Error('Fishing Lure activation requires campaign-clock authority.')
    }
    const resolved = startItemRouteLure({
      current: (input.target.sheet as TrainerSheet).serverPrivate?.itemExploration,
      definition: input.definition,
      sourceOperationId: input.command.operationId,
      sourceInstanceId: input.source.instanceId,
      campaignMinute: Number(campaignMinute),
    })
    return { action: 'start-route-lure', activity: structuredClone(resolved.activity) as unknown as StrictJsonObject }
  }
  if (effect.operation === 'use-repel') {
    const mode = input.selectedChoices.get(ITEM_EXPLORATION_USE_MODE_CHOICE_ID)?.[0]
      ?? (() => { throw new Error('Repel use requires one exact reviewed mode.') })()
    if (mode === 'route-ward') {
      if (input.command.context === 'encounter' || input.target.sheetKind !== 'trainer'
        || input.target.sheetSlug !== input.command.actorSheet.slug) {
        throw new Error('Route Repel activation requires the acting Trainer as its non-encounter target.')
      }
      const campaignMinute = input.campaignMinute
      if (!Number.isSafeInteger(campaignMinute) || Number(campaignMinute) < 0) {
        throw new Error('Route Repel activation requires campaign-clock authority.')
      }
      const resolved = applyItemRepelCampaignEffect({
        current: (input.target.sheet as TrainerSheet).serverPrivate?.itemExploration,
        definition: input.definition,
        sourceOperationId: input.command.operationId,
        sourceInstanceId: input.source.instanceId,
        campaignMinute: Number(campaignMinute),
      })
      return { action: 'apply-route-repel', effect: structuredClone(resolved.effect) as unknown as StrictJsonObject }
    }
    if (mode !== 'wild-spray' || input.command.context !== 'encounter'
      || input.target.sheetKind !== 'pokemon' || !input.actorSheet || !input.map
      || !input.command.actorParticipantId) {
      throw new Error('The selected direct Repel mode is unavailable in this context.')
    }
    const accuracy = directRepelAccuracy({
      map: input.map,
      actorSheet: input.actorSheet,
      actorSheetKind: input.command.actorSheet.kind,
      actorSheetSlug: input.command.actorSheet.slug,
      actorPlacementId: input.command.actorParticipantId,
      target: input.target,
      rollHealingDie: input.rollHealingDie,
    })
    const decision = accuracy.hit ? {
      decisionId: `item-repel-position:v1:${createHash('sha256').update(`${input.command.operationId}\0${input.target.participantId}`).digest('hex').slice(0, 32)}`,
      sourceOperationId: input.command.operationId,
      canonicalItemId: input.definition.canonicalId,
      canonicalDefinitionSha256: input.definition.definitionSha256,
      sourceInstanceId: input.source.instanceId,
      sourcePlacementId: input.command.actorParticipantId,
      targetPlacementId: input.target.participantId,
      maximumAffectedWildLevel: effect.maximumAffectedWildLevel,
      accuracy: { ...accuracy, hit: true as const },
      status: 'pending-position' as const,
    } : null
    return {
      action: 'direct-repel-spray',
      maximumAffectedWildLevel: effect.maximumAffectedWildLevel,
      accuracy,
      decision,
    }
  }
  if (effect.operation === 'search-for-shards') {
    if (input.command.context !== 'extended-action' || input.target.sheetKind !== 'trainer'
      || input.target.sheetSlug !== input.command.actorSheet.slug) {
      throw new Error('Dowsing requires the acting Trainer’s durable Extended Action.')
    }
    const campaignMinute = input.campaignMinute
    const startedAt = input.nonEncounterContext?.extendedAction.startedAtCampaignMinute
    if (!Number.isSafeInteger(campaignMinute) || Number(campaignMinute) < 0
      || !Number.isSafeInteger(startedAt) || Number(startedAt) < 0
      || Number(campaignMinute) < Number(startedAt) + effect.searchMinutes) {
      throw new Error('Dowsing cannot complete before ten authoritative campaign minutes elapse.')
    }
    const terrainId = input.selectedChoices.get(ITEM_DOWSING_TERRAIN_CHOICE_ID)?.[0] as ItemDowsingTerrain | undefined
    const stuntIds = input.selectedChoices.get(ITEM_DOWSING_SKILL_STUNT_CHOICE_ID) ?? []
    if (!terrainId || stuntIds.length > 1) throw new Error('Dowsing choices are incomplete or malformed.')
    const resolved = resolveItemDowsing({
      current: (input.target.sheet as TrainerSheet).serverPrivate?.itemExploration,
      definition: input.definition,
      sheet: input.target.sheet as TrainerSheet,
      sourceOperationId: input.command.operationId,
      sourceInstanceId: input.source.instanceId,
      campaignMinute: Number(campaignMinute),
      terrainId,
      skillStuntInstanceId: stuntIds[0] ?? null,
      rollDie: sides => explorationRollDie(input.rollHealingDie, sides),
    })
    return {
      action: 'resolve-dowsing',
      use: structuredClone(resolved.use) as unknown as StrictJsonObject,
      shardRows: structuredClone(resolved.shardRows) as unknown as StrictJsonObject[],
    }
  }
  if (effect.operation === 'apply-medical-treatment') {
    const appliedAtCampaignMinute = input.campaignMinute
    if (!Number.isSafeInteger(appliedAtCampaignMinute) || Number(appliedAtCampaignMinute) < 0) {
      throw new Error('Medical treatment requires an authoritative campaign minute.')
    }
    return {
      action: 'apply-medical-treatment',
      treatmentId: itemMedicalTreatmentId({
        operationId: input.command.operationId,
        targetKind: input.target.sheetKind,
        targetSlug: input.target.sheetSlug,
      }),
      treatmentKind: effect.treatmentKind,
      canonicalItemId: input.definition.canonicalId,
      canonicalDefinitionSha256: input.definition.definitionSha256,
      sourceOperationId: input.command.operationId,
      targetKind: input.target.sheetKind,
      targetSlug: input.target.sheetSlug,
      appliedAtCampaignMinute: Number(appliedAtCampaignMinute),
      durationMinutes: effect.durationMinutes,
      tickMinutes: effect.tickMinutes,
      healingNumerator: effect.healingNumerator,
      healingDenominator: effect.healingDenominator,
      injuryAtCompletion: effect.injuryAtCompletion,
      stopOnHpLoss: effect.stopOnHpLoss,
      obeyDailyInjuryLimit: effect.obeyDailyInjuryLimit,
    }
  }
  if (input.command.context !== 'encounter') {
    throw new Error('Temporary item combat effects require authoritative encounter context.')
  }
  const map = input.map ?? (() => { throw new Error('Temporary item combat effects require authoritative encounter state.') })()
  const sourcePlacementId = input.command.actorParticipantId
    ?? (() => { throw new Error('Temporary item combat effects require an authoritative actor placement.') })()
  return {
    action: 'apply-temporary-combat-effect',
    family: effect.family,
    amount: effect.amount,
    duration: structuredClone(input.definition.spec.duration) as unknown as StrictJsonObject,
    stackPolicy: effect.stackPolicy,
    switchPolicy: effect.switchPolicy,
    effect: structuredClone(createItemTemporaryCombatEffect({
      operationId: input.command.operationId,
      canonicalItemId: input.definition.canonicalId,
      sourcePlacementId,
      targetPlacementId: input.target.participantId,
      family: effect.family,
      amount: effect.amount,
      duration: input.definition.spec.duration,
      stackPolicy: effect.stackPolicy,
      map,
      ...(input.campaignMinute === undefined ? {} : { campaignMinute: input.campaignMinute }),
    })) as unknown as StrictJsonObject,
  }
}

/** Produce a reservation-only plan while private/GM choices remain unresolved. */
export const planPendingItemReservation = (input: PlanItemOperationInput): ItemOperationPlanV1 => {
  const spec = input.definition.spec
  const nonEncounterContext = executionSnapshotForPlan(input, false)
  if (!spec.consumption.reserveWhilePending) {
    return Object.freeze({
      schemaVersion: 1,
      operationId: input.command.operationId,
      canonicalItemId: input.definition.canonicalId,
      canonicalDefinitionSha256: input.definition.definitionSha256,
      readSet: Object.freeze([...input.command.readSet]),
      operations: Object.freeze([]),
      receiptFacts: Object.freeze([]),
      ...(nonEncounterContext ? { nonEncounterContext } : {}),
    })
  }
  const source = sourceAggregate(input)
  return Object.freeze({
    schemaVersion: 1,
    operationId: input.command.operationId,
    canonicalItemId: input.definition.canonicalId,
    canonicalDefinitionSha256: input.definition.definitionSha256,
    readSet: Object.freeze([...input.command.readSet]),
    operations: Object.freeze([Object.freeze({
      operationId: 'inventory.reserve',
      ordinal: 0,
      kind: 'inventory' as const,
      aggregate: source,
      subjectId: input.source.rowId,
      payload: Object.freeze({
        action: 'consume',
        quantity: spec.consumption.quantity,
        sourceInstanceId: input.source.instanceId,
        reservationOnly: true,
      }),
      label: `Reserve ${spec.consumption.quantity} ${input.source.displayLabel}`,
    })]),
    receiptFacts: Object.freeze([]),
    ...(nonEncounterContext ? { nonEncounterContext } : {}),
  })
}

/** Produce a deterministic, immutable operation vocabulary before storage mutation. */
export const planDeterministicItemOperation = (input: PlanItemOperationInput): ItemOperationPlanV1 => {
  const spec = input.definition.spec
  const nonEncounterContext = executionSnapshotForPlan(input, true)
  if (spec.implementationState !== 'native' && spec.implementationState !== 'guided') {
    throw new Error('Only native or settled guided ItemSpecs can be reduced.')
  }
  const wonderLauncherDelivery = input.command.delivery?.kind === 'wonder-launcher'
  const xItemDelivery = spec.effects.some(effect => effect.operation === 'modify-stage'
    || effect.operation === 'temporary-combat-effect')
  if (wonderLauncherDelivery && (input.command.context !== 'encounter'
    || input.command.actorSheet.kind !== 'trainer' || !xItemDelivery)) {
    throw new Error('Wonder Launcher delivery is valid only for a reviewed encounter X-Item.')
  }
  if (spec.targets.length > 1) throw new Error('Multiple independent item target requirements require the pending-choice runtime.')
  const targetRequirement = spec.targets[0]
  if (targetRequirement && (targetRequirement.minimum > input.targets.length || targetRequirement.maximum < input.targets.length)) {
    throw new Error('Item target cardinality does not satisfy the registered ItemSpec.')
  }
  if (!targetRequirement && input.targets.length > 0) throw new Error('This ItemSpec does not accept participant targets.')
  const commandChoices = new Map(input.command.choices.map(choice => [choice.choiceId, choice.optionIds]))
  for (const choice of spec.choices) {
    const selected = commandChoices.get(choice.choiceId) ?? []
    if (selected.length < choice.minimum || selected.length > choice.maximum) {
      throw new Error(`Item choice ${choice.choiceId} does not satisfy its registered cardinality.`)
    }
    if (choice.optionSource === 'spec') {
      const legal = new Set(choice.options.map(option => option.optionId))
      if (selected.some(optionId => !legal.has(optionId))) throw new Error(`Item choice ${choice.choiceId} contains an unauthorized option.`)
    }
    else {
      const conditionProvider = choice.kind === 'condition' && choice.choiceId.startsWith('condition:')
      const permanentProvider = (choice.kind === 'move' || choice.kind === 'stat')
        && spec.effects.some(effect => [
          'modify-base-stat', 'increase-move-frequency', 'learn-machine-move',
        ].includes(effect.operation))
      const evolutionProvider = choice.kind === 'destination'
        && spec.effects.some(effect => effect.operation === 'evolve-pokemon')
      const explorationProvider = choice.kind === 'mode'
        && spec.effects.some(effect => [
          'use-bait', 'use-snack-or-bait', 'use-repel', 'search-for-shards',
        ].includes(effect.operation))
      if (!conditionProvider && !permanentProvider && !evolutionProvider && !explorationProvider) {
        throw new Error(`Item choice ${choice.choiceId} has no registered authority provider.`)
      }
    }
  }
  if (input.command.choices.some(choice => !spec.choices.some(specChoice => specChoice.choiceId === choice.choiceId)
    && choice.choiceId !== targetRequirement?.targetId)) {
    throw new Error('Item command contains a choice that is absent from the registered ItemSpec.')
  }
  const targetByParticipant = new Map(input.targets.map(target => [target.participantId, target]))
  if (targetByParticipant.size !== input.targets.length || input.command.targetIds.some(id => !targetByParticipant.has(id))) {
    throw new Error('Item target identities are incomplete or duplicated.')
  }
  const operations: PlannedItemOperation[] = []
  if (!spec.consumption.reusable
    && (spec.consumption.phase === 'accepted-use'
      || spec.consumption.phase === 'extended-action-completion'
      || spec.consumption.phase === 'gm-adjudication')) {
    operations.push(operation({
      operationId: 'inventory.consume',
      kind: 'inventory',
      aggregate: sourceAggregate(input),
      subjectId: input.source.rowId,
      payload: {
        action: 'consume',
        quantity: spec.consumption.quantity,
        sourceInstanceId: input.source.instanceId,
      },
      label: `Consume ${spec.consumption.quantity} ${input.source.displayLabel}`,
    }, operations.length))
  }
  const apCosts = [
    ...spec.costs.filter(candidate => candidate.kind === 'ap'),
    ...(wonderLauncherDelivery ? [{
      kind: 'ap' as const,
      resourceId: 'drain',
      amount: 1,
      label: '1 AP to activate Wonder Launcher',
    }] : []),
  ]
  for (const cost of apCosts) {
    if (cost.resourceId !== 'drain' || input.command.actorSheet.kind !== 'trainer' || !input.actorSheet) {
      throw new Error('Only reviewed Trainer AP drains are supported for native item tools.')
    }
    const createdAt = input.operationTimestamp
    if (!Number.isSafeInteger(createdAt) || Number(createdAt) < 0) {
      throw new Error('Item AP drain requires a server-owned operation timestamp.')
    }
    const round = input.map?.initiative?.round ?? null
    const preview = previewItemApDrain({
      sheet: input.actorSheet as TrainerSheet,
      cost,
      now: Number(createdAt),
      round,
    })
    operations.push(operation({
      operationId: `actor.ap-drain.${operations.filter(candidate => candidate.payload.action === 'drain-ap').length + 1}`,
      kind: 'resource',
      aggregate: actorAggregate(input),
      subjectId: input.command.actorSheet.slug,
      payload: {
        action: 'drain-ap',
        resourceId: 'ap',
        amount: preview.amount,
        availableBefore: preview.availableBefore,
        availableAfter: preview.availableAfter,
        drainId: itemApDrainId(input.command.operationId),
        sourceInstanceId: wonderLauncherDelivery
          ? input.command.delivery!.equipmentBindingId
          : input.source.instanceId,
        canonicalItemId: input.definition.canonicalId,
        createdAt: Number(createdAt),
        round,
      },
      label: cost.label,
    }, operations.length))
  }
  for (const target of input.targets) {
    const aggregate = targetAggregate(target, input.command.readSet)
    for (const effect of spec.effects) {
      if (effect.operation === 'guided') {
        const campaignToolChoice = commandChoices.get(ITEM_GUIDED_CAMPAIGN_TOOL_CHOICE_ID)
        if (spec.implementationState === 'guided'
          && effect.outcomeKinds.includes('campaign-fact')
          && target.sheetKind === 'trainer'
          && campaignToolChoice !== undefined) {
          if (campaignToolChoice.length !== 1
            || campaignToolChoice[0] !== ITEM_GUIDED_CAMPAIGN_TOOL_ACCEPT_OPTION_ID
            || spec.choices.filter(choice => choice.choiceId === ITEM_GUIDED_CAMPAIGN_TOOL_CHOICE_ID).length !== 1) {
            throw new Error('Guided campaign-tool adjudication requires one exact bounded GM outcome.')
          }
          const decidedAt = input.operationTimestamp
          if (!Number.isSafeInteger(decidedAt) || Number(decidedAt) < 0) {
            throw new Error('Guided campaign-tool adjudication requires a server-owned decision timestamp.')
          }
          operations.push(operation({
            operationId: `target.${target.participantId}.${effect.effectId}`,
            kind: 'campaign-fact',
            aggregate,
            subjectId: target.participantId,
            payload: {
              action: 'adjudicate-campaign-tool',
              canonicalItemId: input.definition.canonicalId,
              canonicalDefinitionSha256: input.definition.definitionSha256,
              sourceOperationId: input.command.operationId,
              outcomeOptionId: ITEM_GUIDED_CAMPAIGN_TOOL_ACCEPT_OPTION_ID,
              sourceDisposition: spec.consumption.reusable ? 'retained-reusable' : 'consumed-one',
              decidedAt: Number(decidedAt),
            },
            label: `${input.definition.canonicalId} guided use accepted`,
          }, operations.length))
          continue
        }
        if (spec.implementationState !== 'guided'
          || !effect.outcomeKinds.includes('campaign-fact')
          || target.sheetKind !== 'pokemon') {
          if (spec.implementationState === 'guided' && target.sheetKind === 'trainer') {
            const selected = commandChoices.get(ITEM_GUIDED_LOYALTY_CHOICE_ID)
            if (selected?.length !== 1 || selected[0] !== ITEM_GUIDED_LOYALTY_NO_CHANGE_OPTION_ID) {
              throw new Error('Trainer-targeted Poultices require the exact no-Loyalty-change GM outcome.')
            }
            continue
          }
          throw new Error('Guided effects require one reviewed Pokémon Loyalty adjudication.')
        }
        const selected = commandChoices.get(ITEM_GUIDED_LOYALTY_CHOICE_ID)
        if (selected?.length !== 1
          || (selected[0] !== ITEM_GUIDED_LOYALTY_NO_CHANGE_OPTION_ID
            && selected[0] !== ITEM_GUIDED_LOYALTY_DECREASE_OPTION_ID)) {
          throw new Error('Guided Loyalty adjudication requires one exact bounded GM outcome.')
        }
        const decidedAt = input.operationTimestamp
        if (!Number.isSafeInteger(decidedAt) || Number(decidedAt) < 0) {
          throw new Error('Guided Loyalty adjudication requires a server-owned decision timestamp.')
        }
        const rawLoyalty = (target.sheet as CharacterSheet).loyalty
        const previousLoyalty = rawLoyalty === undefined ? 3 : rawLoyalty
        if (!Number.isSafeInteger(previousLoyalty) || Number(previousLoyalty) < 0 || Number(previousLoyalty) > 6) {
          throw new Error('Guided Loyalty adjudication requires current bounded Pokémon Loyalty authority.')
        }
        const outcome = selected[0] === ITEM_GUIDED_LOYALTY_DECREASE_OPTION_ID
          ? 'decrease-one' as const : 'no-change' as const
        const currentLoyalty = outcome === 'decrease-one'
          ? Math.max(0, Number(previousLoyalty) - 1) : Number(previousLoyalty)
        operations.push(operation({
          operationId: `target.${target.participantId}.${effect.effectId}`,
          kind: 'campaign-fact',
          aggregate,
          subjectId: target.participantId,
          payload: {
            action: 'adjudicate-loyalty',
            canonicalItemId: input.definition.canonicalId,
            canonicalDefinitionSha256: input.definition.definitionSha256,
            sourceOperationId: input.command.operationId,
            outcome,
            previousLoyalty: Number(previousLoyalty),
            currentLoyalty,
            decidedAt: Number(decidedAt),
          },
          label: `${spec.presentation.label}: record bounded GM Loyalty outcome`,
        }, operations.length))
        continue
      }
      const payload = effectPayload({
        effect,
        target,
        selectedChoices: commandChoices,
        definition: input.definition,
        command: input.command,
        map: input.map,
        campaignMinute: input.campaignMinute,
        rollHealingDie: input.rollHealingDie,
        actorSheet: input.actorSheet,
        source: input.source,
        operationTimestamp: input.operationTimestamp,
        nonEncounterContext: input.nonEncounterContext,
      })
      const temporary = effect.operation === 'temporary-combat-effect'
      const explorationEncounter = payload.action === 'wild-distraction'
        || payload.action === 'direct-repel-spray'
      const kind = effect.operation === 'heal-hp' || effect.operation === 'revive'
        ? 'hp' as const
        : effect.operation === 'remove-conditions' ? 'condition' as const
          : effect.operation === 'store-digestion-buff' || payload.action === 'store-digestion-buff'
            ? 'inventory' as const
            : effect.operation === 'apply-medical-treatment'
              || effect.operation === 'modify-base-stat'
              || effect.operation === 'grant-tutor-points'
              || effect.operation === 'increase-move-frequency'
              || effect.operation === 'gain-next-level-experience'
              || effect.operation === 'learn-machine-move'
              || effect.operation === 'evolve-pokemon'
              || payload.action === 'start-route-lure'
              || payload.action === 'apply-route-repel'
              || payload.action === 'resolve-dowsing'
              ? 'campaign-fact' as const
              : temporary || explorationEncounter ? 'effect' as const : 'stage' as const
      const effectAggregate = temporary || explorationEncounter
        ? input.command.readSet.find(value => value.kind === 'encounter')
          ?? (() => { throw new Error('Encounter item effects require encounter read authority.') })()
        : aggregate
      operations.push(operation({
        operationId: `target.${target.participantId}.${effect.effectId}`,
        kind,
        aggregate: effectAggregate,
        subjectId: target.participantId,
        payload,
        label: `${spec.presentation.label}: ${effect.operation}`,
      }, operations.length))
      if (effect.operation === 'learn-machine-move') {
        const dailyUse = payload.dailyUse
        if ((effect.machineKind === 'HM') !== (dailyUse !== null)) {
          throw new Error('Machine Move-learning daily-use evidence does not match the machine kind.')
        }
        if (dailyUse !== null) {
          if (!dailyUse || typeof dailyUse !== 'object' || Array.isArray(dailyUse)) {
            throw new Error('HM Move learning requires exact daily-use evidence.')
          }
          operations.push(operation({
            operationId: 'actor.machine-daily-use',
            kind: 'campaign-fact',
            aggregate: actorAggregate(input),
            subjectId: input.command.actorSheet.slug,
            payload: {
              action: 'record-machine-daily-use',
              canonicalItemId: input.definition.canonicalId,
              canonicalDefinitionSha256: input.definition.definitionSha256,
              sourceOperationId: input.command.operationId,
              sourceInstanceId: input.source.instanceId,
              dailyUse: structuredClone(dailyUse) as StrictJsonObject,
            },
            label: `${spec.presentation.label}: record campaign-day use`,
          }, operations.length))
        }
      }
    }
  }
  const encounterAggregate = input.command.readSet.find(value => value.kind === 'encounter')
  const actionCost = spec.costs.find(cost => cost.kind === 'action')
  const restorative = spec.effects.some(effect => effect.operation === 'heal-hp'
    || effect.operation === 'revive' || effect.operation === 'remove-conditions')
  const xItem = spec.effects.some(effect => effect.operation === 'modify-stage'
    || effect.operation === 'temporary-combat-effect')
  const selfTargeted = Boolean(input.command.actorParticipantId)
    && input.targets.length === 1
    && input.targets[0]?.participantId === input.command.actorParticipantId
  const medicTraining = input.command.actorSheet.kind === 'trainer'
    && input.actorSheet !== undefined
    && sheetHasCanonicalEdge(input.actorSheet as TrainerSheet, 'trainer', 'Medic Training')
  if (input.command.context === 'encounter' && (restorative || xItem) && !selfTargeted
    && !medicTraining && !wonderLauncherDelivery) {
    if (!encounterAggregate || !input.command.actorParticipantId) {
      throw new Error('Restorative item forfeiture requires actor and encounter read authority.')
    }
    for (const target of input.targets) {
      operations.push(operation({
        operationId: `target.${target.participantId}.restorative-forfeit`,
        kind: 'resource',
        aggregate: encounterAggregate,
        subjectId: target.participantId,
        payload: {
          action: 'schedule-next-turn-forfeit',
          resourceId: ITEM_RESTORATIVE_NEXT_TURN_FLAG_ID,
          amount: 1,
        },
        label: 'Target forfeits its next Standard and Shift Actions',
      }, operations.length))
    }
  }
  if (input.command.context === 'encounter' && actionCost) {
    if (!encounterAggregate || !input.command.actorParticipantId) throw new Error('Encounter item action costs require actor and encounter read authority.')
    const selfRestorative = (restorative || xItem) && selfTargeted
    operations.push(operation({
      operationId: 'encounter.spend-action',
      kind: 'resource',
      aggregate: encounterAggregate,
      subjectId: input.command.actorParticipantId,
      payload: {
        action: 'spend',
        resourceId: selfRestorative ? 'full' : actionCost.resourceId ?? spec.timing,
        amount: actionCost.amount,
      },
      label: selfRestorative ? '1 Full Action' : actionCost.label,
    }, operations.length))
  }
  const apFacts: ItemOperationPlanV1['receiptFacts'] = operations.flatMap(operation => operation.kind === 'resource' && operation.payload.action === 'drain-ap'
    ? [{
        factId: `ap-drain-${operation.operationId}`,
        audience: spec.privacy.outcome === 'public' ? 'public' as const : spec.privacy.outcome === 'gm' ? 'gm' as const : 'owner' as const,
        label: `${operation.payload.amount} AP drained; ${operation.payload.availableAfter} AP remains available.`,
      }]
    : [])
  const healingFacts: ItemOperationPlanV1['receiptFacts'] = operations.flatMap(operation => operation.kind === 'hp' && operation.payload.action === 'heal'
    ? [{
        factId: `healing-${operation.subjectId}`,
        audience: spec.privacy.outcome === 'public' ? 'public' as const : spec.privacy.outcome === 'gm' ? 'gm' as const : 'owner' as const,
        label: `${operation.payload.effectiveHealing} HP restored${Number(operation.payload.overheal) > 0 ? `; ${operation.payload.overheal} overheal` : ''}.`,
      }]
    : [])
  const revivalFacts: ItemOperationPlanV1['receiptFacts'] = operations.flatMap(operation => operation.kind === 'hp' && operation.payload.action === 'revive'
    ? [{
        factId: `revival-${operation.subjectId}`,
        audience: spec.privacy.outcome === 'public' ? 'public' as const : spec.privacy.outcome === 'gm' ? 'gm' as const : 'owner' as const,
        label: `Revived at ${operation.payload.resultingHp} HP; Fainted cleared.`,
      }]
    : [])
  const stageFacts: ItemOperationPlanV1['receiptFacts'] = operations.flatMap(operation => operation.kind === 'stage'
    ? [{
        factId: `stage-${operation.subjectId}-${operation.operationId}`,
        audience: spec.privacy.outcome === 'public' ? 'public' as const : spec.privacy.outcome === 'gm' ? 'gm' as const : 'owner' as const,
        label: itemCombatStagePreviewDescription({
          stat: operation.payload.stat as import('#shared/itemAutomation/spec').ItemCombatStageStat,
          previous: Number(operation.payload.previous),
          requestedDelta: Number(operation.payload.requestedDelta),
          appliedDelta: Number(operation.payload.appliedDelta),
          current: Number(operation.payload.current),
          minimum: -6,
          maximum: 6,
          capped: operation.payload.capped === true,
        }),
      }]
    : [])
  const digestionFacts: ItemOperationPlanV1['receiptFacts'] = operations.flatMap(operation => operation.kind === 'inventory'
    && operation.payload.action === 'store-digestion-buff'
    ? [{
        factId: `digestion-buff-${operation.subjectId}-${operation.operationId}`,
        audience: spec.privacy.outcome === 'public' ? 'public' as const : spec.privacy.outcome === 'gm' ? 'gm' as const : 'owner' as const,
        label: itemDigestionBuffPreviewDescription(input.definition)
          ?? `${input.definition.canonicalId} Digestion Buff stored.`,
      }]
    : [])
  const medicalTreatmentFacts: ItemOperationPlanV1['receiptFacts'] = operations.flatMap(operation => operation.kind === 'campaign-fact'
    && operation.payload.action === 'apply-medical-treatment'
    ? [{
        factId: `medical-treatment-${operation.subjectId}-${operation.operationId}`,
        audience: spec.privacy.outcome === 'public' ? 'public' as const : spec.privacy.outcome === 'gm' ? 'gm' as const : 'owner' as const,
        label: 'Bandages applied for 6 campaign hours; half-hour healing and final Injury removal remain pending and stop on HP loss.',
      }]
    : [])
  const permanentAdvancementFacts: ItemOperationPlanV1['receiptFacts'] = operations.flatMap(operation => operation.kind === 'campaign-fact'
    && operation.payload.action === 'apply-permanent-advancement'
    && Array.isArray(operation.payload.previewFacts)
    ? (operation.payload.previewFacts as readonly Record<string, unknown>[]).flatMap((fact, index) => (
        typeof fact.label === 'string' && typeof fact.value === 'string'
          ? [{
              factId: `permanent-advancement-${operation.subjectId}-${index}`,
              audience: 'owner' as const,
              label: `${fact.label}: ${fact.value}.`,
            }]
          : []
      ))
    : [])
  const machineLearningFacts: ItemOperationPlanV1['receiptFacts'] = operations.flatMap(operation => operation.kind === 'campaign-fact'
    && operation.payload.action === 'learn-machine-move'
    && Array.isArray(operation.payload.previewFacts)
    ? (operation.payload.previewFacts as readonly Record<string, unknown>[]).flatMap((fact, index) => (
        typeof fact.label === 'string' && typeof fact.value === 'string'
          ? [{
              factId: `machine-move-learning-${operation.subjectId}-${index}`,
              audience: 'owner' as const,
              label: `${fact.label}: ${fact.value}.`,
            }]
          : []
      ))
    : [])
  const temporaryFacts: ItemOperationPlanV1['receiptFacts'] = operations.flatMap(operation => operation.kind === 'effect'
    && operation.payload.action === 'apply-temporary-combat-effect'
    ? [{
        factId: `temporary-effect-${operation.subjectId}-${operation.operationId}`,
        audience: spec.privacy.outcome === 'public' ? 'public' as const : spec.privacy.outcome === 'gm' ? 'gm' as const : 'owner' as const,
        label: itemTemporaryEffectPreviewDescription({
          family: operation.payload.family as import('#shared/itemAutomation/spec').ItemTemporaryEffectFamily,
          amount: Number(operation.payload.amount),
          duration: operation.payload.duration as unknown as import('#shared/itemAutomation/spec').ItemDurationSpec,
        }),
      }]
    : [])
  const explorationFacts: ItemOperationPlanV1['receiptFacts'] = operations.flatMap((operation): ItemOperationPlanV1['receiptFacts'] => {
    if (operation.payload.action === 'start-route-lure') return [{
      factId: `route-lure-${operation.subjectId}`,
      audience: 'owner' as const,
      label: 'Route lure started; its first server-owned check is due after 15 campaign minutes.',
    }]
    if (operation.payload.action === 'apply-route-repel') {
      const effect = operation.payload.effect as Record<string, unknown>
      return [{
        factId: `route-repel-${operation.subjectId}`,
        audience: 'owner' as const,
        label: `Repel ward active through campaign minute ${effect.expiresAtCampaignMinute}.`,
      }]
    }
    if (operation.payload.action === 'wild-distraction') return [{
      factId: `bait-distraction-${operation.subjectId}`,
      audience: 'public' as const,
      label: operation.payload.failed === true
        ? 'The wild Pokémon failed its Focus check and will forfeit its next Standard Action.'
        : 'The wild Pokémon passed its Focus check.',
    }]
    if (operation.payload.action === 'direct-repel-spray') {
      const accuracy = operation.payload.accuracy as Record<string, unknown>
      return [{
        factId: `direct-repel-${operation.subjectId}`,
        audience: 'public' as const,
        label: accuracy.hit === true
          ? 'Repel spray hit; GM positioning and the target’s next-Shift forfeiture are pending.'
          : 'Repel spray missed.',
      }]
    }
    if (operation.payload.action === 'resolve-dowsing') {
      const use = operation.payload.use as Record<string, unknown>
      const roll = use.roll as Record<string, unknown>
      return [{
        factId: `dowsing-${operation.subjectId}`,
        audience: 'owner' as const,
        label: `Dowsing found ${Number(roll.successes ?? 0)} color-preserving Shard${Number(roll.successes ?? 0) === 1 ? '' : 's'}.`,
      }]
    }
    return []
  })
  const deliveryFacts: ItemOperationPlanV1['receiptFacts'] = wonderLauncherDelivery ? [{
    factId: 'wonder-launcher-delivery',
    audience: 'public' as const,
    label: `${input.definition.canonicalId} was delivered by Wonder Launcher; the target keeps its actions.`,
  }] : []
  const guidedFacts: ItemOperationPlanV1['receiptFacts'] = operations.flatMap(operation => {
    if (operation.kind !== 'campaign-fact') return []
    if (operation.payload.action === 'adjudicate-loyalty') return [{
      factId: `guided-loyalty-${operation.subjectId}`,
      audience: 'gm' as const,
      label: operation.payload.outcome === 'decrease-one'
        ? 'GM recorded a bounded Loyalty decrease of 1.'
        : 'GM recorded this use without a Loyalty Rank change.',
    }]
    if (operation.payload.action === 'adjudicate-campaign-tool') return [{
      factId: `guided-campaign-tool-${operation.subjectId}`,
      audience: 'gm' as const,
      label: `GM accepted the bounded ${input.definition.canonicalId} use and exact source disposition.`,
    }]
    return []
  })
  const contextFacts: ItemOperationPlanV1['receiptFacts'] = nonEncounterContext ? [{
    factId: 'non-encounter-context',
    audience: 'gm' as const,
    label: `${nonEncounterContext.context} item use resolved at campaign minute ${nonEncounterContext.campaignTime.campaignMinute}.`,
  }, ...(nonEncounterContext.gmConfirmation.status === 'confirmed' ? [{
    factId: 'gm-confirmation',
    audience: 'gm' as const,
    label: 'Current GM confirmation was recorded for this exact item operation.',
  }] : [])] : []
  const conditionFacts: ItemOperationPlanV1['receiptFacts'] = operations.flatMap(operation => operation.kind === 'condition'
    && operation.payload.action === 'remove'
    && Array.isArray(operation.payload.removedConditionIds)
    && operation.payload.removedConditionIds.length > 0
    ? [{
        factId: `conditions-${operation.subjectId}-${operation.operationId}`,
        audience: spec.privacy.outcome === 'public' ? 'public' as const : spec.privacy.outcome === 'gm' ? 'gm' as const : 'owner' as const,
        label: `${(operation.payload.removedConditionIds as readonly string[]).join(', ')} cured.`,
      }]
    : [])
  return Object.freeze({
    schemaVersion: 1,
    operationId: input.command.operationId,
    canonicalItemId: input.definition.canonicalId,
    canonicalDefinitionSha256: input.definition.definitionSha256,
    readSet: Object.freeze([...input.command.readSet]),
    operations: Object.freeze(operations.map(value => Object.freeze(value))),
    receiptFacts: Object.freeze([{
      factId: 'item-used', audience: spec.privacy.outcome === 'public' ? 'public' as const : spec.privacy.outcome === 'gm' ? 'gm' as const : 'owner' as const,
      label: `${input.source.displayLabel} was used.`,
    }, ...contextFacts, ...deliveryFacts, ...apFacts, ...healingFacts, ...revivalFacts, ...conditionFacts, ...stageFacts, ...digestionFacts, ...medicalTreatmentFacts, ...permanentAdvancementFacts, ...machineLearningFacts, ...temporaryFacts, ...explorationFacts, ...guidedFacts]),
    ...(nonEncounterContext ? { nonEncounterContext } : {}),
  })
}

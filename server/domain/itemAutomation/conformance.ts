import type { ItemOperationPlanV1, PlannedItemOperation, UseItemCommandV1 } from '#shared/itemAutomation/operations'
import type { ItemRuntimeDefinition } from '#shared/itemAutomation/spec'
import type { ItemOperationCompensationV1 } from '../../storage/itemOperationRepository'
import {
  conditionBaseName,
  conditionByName,
  isStatusAfflictionCondition,
  normalizeConditionNames,
} from '~/utils/statusConditions'
import { parseEncounterEffect } from '#shared/moveAutomation/encounterEffects'
import { ITEM_SKILL_CHECK_IDS, type ItemSkillCheckId } from '#shared/itemAutomation/spec'
import { itemApDrainId } from './ap'
import { parseItemPermanentAdvancementState } from '#shared/itemAutomation/permanentAdvancement'
import {
  parseItemMachineUsageState,
  parseItemMoveLearningState,
} from '#shared/itemAutomation/moveLearning'
import { parseItemEvolutionState } from '#shared/itemAutomation/evolution'
import {
  parseItemExplorationEncounterState,
  parseItemExplorationState,
} from '#shared/itemAutomation/exploration'
import { isPlainJsonObject } from '#shared/automation/strictJson'
import {
  ITEM_GUIDED_CAMPAIGN_TOOL_ACCEPT_OPTION_ID,
  parseItemGuidedCampaignToolState,
  parseItemGuidedLoyaltyState,
} from '#shared/itemAutomation/guidedAdjudication'
import {
  ITEM_COMBAT_EFFECT_TAG,
  isItemTemporaryCombatEffect,
  itemTemporaryEffectCapabilityId,
} from './combatEffects'

export type ItemRuntimeConformanceCode =
  | 'identity-drift'
  | 'read-set-drift'
  | 'operation-drift'
  | 'payload-drift'
  | 'write-set-drift'
  | 'unsafe-compensation'

export class ItemRuntimeConformanceError extends Error {
  readonly code: ItemRuntimeConformanceCode

  constructor(code: ItemRuntimeConformanceCode, message: string) {
    super(message)
    this.name = 'ItemRuntimeConformanceError'
    this.code = code
  }
}

const fail = (code: ItemRuntimeConformanceCode, message: string): never => {
  throw new ItemRuntimeConformanceError(code, message)
}
const exactFields = (operation: PlannedItemOperation, fields: readonly string[]): void => {
  const keys = Object.keys(operation.payload)
  const expected = new Set(fields)
  if (keys.length !== fields.length || keys.some(key => !expected.has(key))) {
    fail('payload-drift', `${operation.operationId} has a payload outside the runtime operation contract.`)
  }
}
const permanentChoicesConform = (
  value: unknown,
  definition: ItemRuntimeDefinition,
): boolean => {
  if (!Array.isArray(value) || value.length !== definition.spec.choices.length) return false
  const seenChoices = new Set<string>()
  for (const entry of value) {
    if (!isPlainJsonObject(entry) || Object.keys(entry).length !== 2
      || !Object.hasOwn(entry, 'choiceId') || !Object.hasOwn(entry, 'optionIds')
      || typeof entry.choiceId !== 'string' || seenChoices.has(entry.choiceId)
      || !Array.isArray(entry.optionIds)) return false
    const choice = definition.spec.choices.find(candidate => candidate.choiceId === entry.choiceId)
    if (!choice || entry.optionIds.length < choice.minimum || entry.optionIds.length > choice.maximum
      || entry.optionIds.some(optionId => typeof optionId !== 'string' || !optionId
        || optionId.length > 500)
      || new Set(entry.optionIds).size !== entry.optionIds.length
      || (choice.optionSource === 'spec'
        && entry.optionIds.some(optionId => !choice.options.some(option => option.optionId === optionId)))) return false
    seenChoices.add(entry.choiceId)
  }
  return definition.spec.choices.every(choice => seenChoices.has(choice.choiceId))
}

const permanentPreviewFactsConform = (value: unknown): boolean => Array.isArray(value)
  && value.length <= 32
  && value.every(fact => isPlainJsonObject(fact)
    && Object.keys(fact).length === 3
    && Object.hasOwn(fact, 'label') && Object.hasOwn(fact, 'value') && Object.hasOwn(fact, 'tone')
    && typeof fact.label === 'string' && fact.label.length > 0 && fact.label.length <= 500
    && typeof fact.value === 'string' && fact.value.length > 0 && fact.value.length <= 500
    && ['neutral', 'positive', 'warning'].includes(String(fact.tone)))

const aggregateKey = (operation: PlannedItemOperation): string => operation.aggregate.kind === 'sheet'
  ? `sheet:${operation.aggregate.sheetKind}:${operation.aggregate.id}`
  : operation.aggregate.kind === 'encounter' ? `map:${operation.aggregate.id}`
    : `${operation.aggregate.kind}:${operation.aggregate.id}`

/** Enforce the accepted runtime vocabulary before any item write can commit. */
export const assertItemRuntimePlanConformance = (input: {
  readonly definition: ItemRuntimeDefinition
  readonly plan: ItemOperationPlanV1
  readonly compensation: ItemOperationCompensationV1
  readonly command?: UseItemCommandV1
}): void => {
  const { definition, plan, compensation } = input
  if (plan.canonicalItemId !== definition.canonicalId
    || plan.canonicalDefinitionSha256 !== definition.definitionSha256
    || (input.command && (input.command.operationId !== plan.operationId
      || JSON.stringify(input.command.readSet) !== JSON.stringify(plan.readSet)))) {
    fail('identity-drift', 'Item plan no longer matches its registered canonical definition.')
  }
  const encounterRead = plan.readSet.some(ref => ref.kind === 'map' || ref.kind === 'encounter')
  if (plan.nonEncounterContext) {
    const context = plan.nonEncounterContext
    const clock = plan.readSet.find(ref => ref.kind === 'campaign-clock')
    const actor = plan.readSet.find(ref => ref.kind === 'sheet'
      && ref.sheetKind === context.actor.sheetKind && ref.id === context.actor.sheetSlug)
    if (encounterRead || !clock || clock.revision !== context.campaignTime.clockRevision
      || !actor || actor.revision !== context.actor.sheetRevision
      || (context.extendedAction.mode === 'extended' && context.extendedAction.phase !== 'completion')
      || (context.gmConfirmation.required && context.gmConfirmation.status !== 'confirmed')) {
      fail('read-set-drift', 'Non-encounter item evidence does not match its exact campaign, actor, activity, or confirmation reads.')
    }
  }
  else if (!encounterRead) {
    fail('read-set-drift', 'A new non-encounter item plan requires immutable execution-context evidence.')
  }
  if (plan.operations.some((operation, index) => operation.ordinal !== index)) {
    fail('operation-drift', 'Item plan operation order is not contiguous.')
  }
  const operationIds = new Set<string>()
  for (const operation of plan.operations) {
    if (operationIds.has(operation.operationId)) fail('operation-drift', 'Item plan contains duplicate operation identities.')
    operationIds.add(operation.operationId)
    if (operation.kind === 'inventory') {
      if (operation.payload.action === 'store-digestion-buff') {
        exactFields(operation, [
          'action', 'canonicalItemId', 'buffKind', 'amount', 'denominator', 'requiredPokemonType',
        ])
        const reviewed = definition.spec.effects.find(effect => (
          effect.operation === 'store-digestion-buff' || effect.operation === 'use-snack-or-bait'
        ))
        if (operation.aggregate.kind !== 'sheet'
          || operation.payload.canonicalItemId !== definition.canonicalId
          || !reviewed
          || operation.payload.buffKind !== reviewed.buffKind
          || operation.payload.amount !== reviewed.amount
          || operation.payload.denominator !== reviewed.denominator
          || operation.payload.requiredPokemonType !== reviewed.requiredPokemonType) {
          fail('payload-drift', `${operation.operationId} has an invalid Digestion Buff payload.`)
        }
      }
      else {
        exactFields(operation, ['action', 'quantity', 'sourceInstanceId'])
        if (operation.payload.action !== 'consume' || operation.payload.reservationOnly === true
          || !Number.isSafeInteger(operation.payload.quantity) || Number(operation.payload.quantity) < 1) {
          fail('payload-drift', `${operation.operationId} is not an accepted-use inventory consumption.`)
        }
      }
    }
    else if (operation.kind === 'hp') {
      if (operation.payload.action === 'heal') {
        exactFields(operation, [
          'action', 'calculationKind', 'currentHp', 'fullFormulaMaximumHp', 'effectiveMaximumHp',
          'injuries', 'requestedHealing', 'effectiveHealing', 'overheal', 'resultingHp', 'roll',
          'cap', 'faintedState',
        ])
        const integerFields = [
          'currentHp', 'fullFormulaMaximumHp', 'effectiveMaximumHp', 'injuries', 'requestedHealing',
          'effectiveHealing', 'overheal', 'resultingHp',
        ] as const
        if (!['fixed', 'rolled', 'skill-check', 'maximum-relative'].includes(String(operation.payload.calculationKind))
          || operation.payload.cap !== 'injury-adjusted-effective-maximum-hp'
          || operation.payload.faintedState !== 'preserve'
          || integerFields.some(field => !Number.isSafeInteger(operation.payload[field]) || Number(operation.payload[field]) < 0)
          || (operation.payload.calculationKind === 'skill-check'
            ? Number(operation.payload.requestedHealing) < 0
            : Number(operation.payload.requestedHealing) < 1)
          || Number(operation.payload.fullFormulaMaximumHp) < Number(operation.payload.effectiveMaximumHp)
          || Number(operation.payload.currentHp) > Number(operation.payload.effectiveMaximumHp)
          || Number(operation.payload.resultingHp) !== Number(operation.payload.currentHp) + Number(operation.payload.effectiveHealing)
          || Number(operation.payload.overheal) !== Number(operation.payload.requestedHealing) - Number(operation.payload.effectiveHealing)
          || Number(operation.payload.effectiveHealing) !== Math.min(
            Number(operation.payload.requestedHealing),
            Number(operation.payload.effectiveMaximumHp) - Number(operation.payload.currentHp),
          )) fail('payload-drift', `${operation.operationId} has an invalid resolved healing payload.`)
        const calculationKind = operation.payload.calculationKind
        const expectsRoll = calculationKind === 'rolled' || calculationKind === 'skill-check'
        if (expectsRoll !== (operation.payload.roll !== null)) {
          fail('payload-drift', `${operation.operationId} has inconsistent healing roll evidence.`)
        }
        if (expectsRoll) {
          const roll = operation.payload.roll
          const skillCheck = calculationKind === 'skill-check'
          const fields = skillCheck
            ? [
                'expression', 'rolls', 'modifier', 'total', 'skillId', 'rankValue', 'dieSides',
                'actorSheetKind', 'actorSheetSlug', 'actorSheetRevision',
              ]
            : ['expression', 'rolls', 'modifier', 'total']
          if (!roll || typeof roll !== 'object' || Array.isArray(roll)
            || Object.keys(roll).length !== fields.length
            || fields.some(field => !Object.hasOwn(roll, field))) {
            fail('payload-drift', `${operation.operationId} has malformed healing roll evidence.`)
          }
          const evidence = roll as Record<string, unknown>
          const rolls = Array.isArray(evidence.rolls)
            ? evidence.rolls
            : fail('payload-drift', `${operation.operationId} has inconsistent healing roll evidence.`)
          if (typeof evidence.expression !== 'string'
            || rolls.length < 1 || rolls.length > 32
            || rolls.some(value => !Number.isSafeInteger(value) || Number(value) < 1)
            || !Number.isSafeInteger(evidence.modifier) || !Number.isSafeInteger(evidence.total)
            || rolls.reduce((total, value) => total + Number(value), Number(evidence.modifier)) !== evidence.total
            || (skillCheck ? Math.max(0, Number(evidence.total)) : Number(evidence.total)) !== Number(operation.payload.requestedHealing)) {
            fail('payload-drift', `${operation.operationId} has inconsistent healing roll evidence.`)
          }
          if (skillCheck) {
            const reviewed = definition.spec.effects.flatMap((effect) => {
              if (effect.operation !== 'heal-hp' || effect.restoration.amount.kind !== 'skill-check') return []
              return [effect.restoration.amount]
            })
            const actorRef = plan.readSet.find(ref => ref.kind === 'sheet'
              && ref.sheetKind === 'trainer' && ref.id === evidence.actorSheetSlug)
            if (reviewed.length !== 1
              || !ITEM_SKILL_CHECK_IDS.includes(evidence.skillId as ItemSkillCheckId)
              || evidence.skillId !== reviewed[0]!.skillId
              || evidence.dieSides !== 6
              || !Number.isSafeInteger(evidence.rankValue)
              || Number(evidence.rankValue) < 1 || Number(evidence.rankValue) > 6
              || rolls.length !== evidence.rankValue
              || rolls.some(value => Number(value) > 6)
              || evidence.actorSheetKind !== 'trainer'
              || typeof evidence.actorSheetSlug !== 'string'
              || !actorRef || actorRef.revision !== evidence.actorSheetRevision) {
              fail('payload-drift', `${operation.operationId} has invalid item skill-check evidence.`)
            }
          }
        }
      }
      else {
        exactFields(operation, [
          'action', 'calculationKind', 'currentHp', 'fullFormulaMaximumHp', 'effectiveMaximumHp',
          'injuries', 'requestedHp', 'resultingHp', 'capReducedAmount', 'cap', 'targetKind',
          'faintedState',
        ])
        const integerFields = [
          'currentHp', 'fullFormulaMaximumHp', 'effectiveMaximumHp', 'injuries',
          'requestedHp', 'resultingHp', 'capReducedAmount',
        ] as const
        if (operation.payload.action !== 'revive'
          || !['fixed', 'maximum-relative'].includes(String(operation.payload.calculationKind))
          || operation.payload.cap !== 'injury-adjusted-effective-maximum-hp'
          || operation.payload.targetKind !== 'pokemon'
          || operation.payload.faintedState !== 'require-and-clear'
          || integerFields.some(field => !Number.isSafeInteger(operation.payload[field]))
          || Number(operation.payload.requestedHp) < 1 || Number(operation.payload.resultingHp) < 1
          || Number(operation.payload.fullFormulaMaximumHp) < Number(operation.payload.effectiveMaximumHp)
          || Number(operation.payload.resultingHp) !== Math.min(
            Number(operation.payload.requestedHp), Number(operation.payload.effectiveMaximumHp),
          )
          || Number(operation.payload.capReducedAmount) !== Number(operation.payload.requestedHp) - Number(operation.payload.resultingHp)) {
          fail('payload-drift', `${operation.operationId} has an invalid resolved revival payload.`)
        }
      }
    }
    else if (operation.kind === 'condition') {
      exactFields(operation, [
        'action', 'mode', 'selection', 'currentConditions', 'removedConditionIds',
        'removedEntries', 'resultingConditions',
      ])
      if (operation.payload.action !== 'remove'
        || !['listed', 'persistent', 'volatile', 'all-status'].includes(String(operation.payload.mode))
        || !['all-applicable', 'choose-one'].includes(String(operation.payload.selection))
        || !Array.isArray(operation.payload.currentConditions)
        || !Array.isArray(operation.payload.removedConditionIds)
        || !Array.isArray(operation.payload.removedEntries)
        || !Array.isArray(operation.payload.resultingConditions)) {
        fail('payload-drift', `${operation.operationId} has an invalid condition action.`)
      }
      const current = normalizeConditionNames(operation.payload.currentConditions as readonly unknown[])
      const removed = normalizeConditionNames(operation.payload.removedEntries as readonly unknown[])
      const resulting = normalizeConditionNames(operation.payload.resultingConditions as readonly unknown[])
      const removedIds = normalizeConditionNames(operation.payload.removedConditionIds as readonly unknown[])
      const expectedResult = current.filter(value => !removed.includes(value))
      const canonicalRemoved = [...new Set(removed.map(value => conditionBaseName(value)).filter(Boolean))]
      const inScope = (value: string): boolean => {
        const canonical = conditionBaseName(value)
        const category = canonical ? conditionByName.get(canonical)?.category : null
        if (operation.payload.mode === 'persistent') return category === 'Persistent Affliction'
        if (operation.payload.mode === 'volatile') return category === 'Volatile Affliction'
        if (operation.payload.mode === 'all-status') return isStatusAfflictionCondition(canonical)
        return true
      }
      const compoundEmptyCure = removed.length === 0 && plan.operations.some(candidate => (
        candidate.kind === 'hp'
        && candidate.subjectId === operation.subjectId
        && candidate.aggregate.kind === 'sheet'
        && operation.aggregate.kind === 'sheet'
        && candidate.aggregate.sheetKind === operation.aggregate.sheetKind
        && candidate.aggregate.id === operation.aggregate.id
      ))
      if (JSON.stringify(resulting) !== JSON.stringify(expectedResult)
        || JSON.stringify(removedIds) !== JSON.stringify(canonicalRemoved)
        || removed.some(value => !current.includes(value) || !inScope(value))
        || (removed.length === 0 && !compoundEmptyCure)
        || (operation.payload.selection === 'choose-one' && removedIds.length !== 1)) {
        fail('payload-drift', `${operation.operationId} has inconsistent authoritative condition evidence.`)
      }
    }
    else if (operation.kind === 'stage') {
      exactFields(operation, [
        'action', 'stat', 'previous', 'requestedDelta', 'appliedDelta',
        'current', 'minimum', 'maximum', 'capped',
      ])
      const stat = String(operation.payload.stat)
      const previous = Number(operation.payload.previous)
      const requestedDelta = Number(operation.payload.requestedDelta)
      const appliedDelta = Number(operation.payload.appliedDelta)
      const current = Number(operation.payload.current)
      if (operation.aggregate.kind !== 'sheet'
        || operation.payload.action !== 'modify'
        || !['atk', 'def', 'satk', 'sdef', 'spd', 'acc'].includes(stat)
        || ![previous, requestedDelta, appliedDelta, current].every(Number.isSafeInteger)
        || requestedDelta === 0 || requestedDelta < -6 || requestedDelta > 6
        || previous < -6 || previous > 6 || current < -6 || current > 6
        || operation.payload.minimum !== -6 || operation.payload.maximum !== 6
        || current !== Math.max(-6, Math.min(6, previous + requestedDelta))
        || appliedDelta !== current - previous
        || operation.payload.capped !== (appliedDelta !== requestedDelta)
        || appliedDelta === 0) {
        fail('payload-drift', `${operation.operationId} has an invalid resolved stage payload.`)
      }
    }
    else if (operation.kind === 'campaign-fact') {
      if (operation.payload.action === 'adjudicate-loyalty') {
        exactFields(operation, [
          'action', 'canonicalItemId', 'canonicalDefinitionSha256', 'sourceOperationId',
          'outcome', 'previousLoyalty', 'currentLoyalty', 'decidedAt',
        ])
        const guided = definition.spec.effects.find(effect => effect.operation === 'guided')
        const previous = Number(operation.payload.previousLoyalty)
        const current = Number(operation.payload.currentLoyalty)
        const outcome = operation.payload.outcome
        let parsed = false
        try {
          parsed = parseItemGuidedLoyaltyState({
            schemaVersion: 1,
            receipts: [{
              schemaVersion: 1,
              sourceOperationId: operation.payload.sourceOperationId,
              canonicalItemId: operation.payload.canonicalItemId,
              canonicalDefinitionSha256: operation.payload.canonicalDefinitionSha256,
              outcome,
              previousLoyalty: previous,
              currentLoyalty: current,
              decidedAt: operation.payload.decidedAt,
            }],
          }).receipts.length === 1
        }
        catch { parsed = false }
        if (definition.spec.implementationState !== 'guided' || !guided
          || !guided.outcomeKinds.includes('campaign-fact')
          || operation.aggregate.kind !== 'sheet' || operation.aggregate.sheetKind !== 'pokemon'
          || operation.payload.canonicalItemId !== definition.canonicalId
          || operation.payload.canonicalDefinitionSha256 !== definition.definitionSha256
          || operation.payload.sourceOperationId !== plan.operationId
          || operation.subjectId.length === 0
          || !Number.isSafeInteger(previous) || previous < 0 || previous > 6
          || !Number.isSafeInteger(current) || current < 0 || current > 6
          || (outcome === 'decrease-one' ? current !== Math.max(0, previous - 1) : current !== previous)
          || (outcome !== 'decrease-one' && outcome !== 'no-change')
          || !Number.isSafeInteger(operation.payload.decidedAt)
          || Number(operation.payload.decidedAt) < 0
          || !parsed) {
          fail('payload-drift', `${operation.operationId} has an invalid bounded Loyalty adjudication payload.`)
        }
      }
      else if (operation.payload.action === 'adjudicate-campaign-tool') {
        exactFields(operation, [
          'action', 'canonicalItemId', 'canonicalDefinitionSha256', 'sourceOperationId',
          'outcomeOptionId', 'sourceDisposition', 'decidedAt',
        ])
        const guided = definition.spec.effects.find(effect => effect.operation === 'guided')
        const expectedDisposition = definition.spec.consumption.reusable
          ? 'retained-reusable'
          : 'consumed-one'
        let parsed = false
        try {
          parsed = parseItemGuidedCampaignToolState({
            schemaVersion: 1,
            receipts: [{
              schemaVersion: 1,
              sourceOperationId: operation.payload.sourceOperationId,
              canonicalItemId: operation.payload.canonicalItemId,
              canonicalDefinitionSha256: operation.payload.canonicalDefinitionSha256,
              outcomeOptionId: operation.payload.outcomeOptionId,
              sourceDisposition: operation.payload.sourceDisposition,
              decidedAt: operation.payload.decidedAt,
            }],
          }).receipts.length === 1
        }
        catch { parsed = false }
        if (definition.spec.implementationState !== 'guided' || !guided
          || !guided.outcomeKinds.includes('campaign-fact')
          || operation.aggregate.kind !== 'sheet' || operation.aggregate.sheetKind !== 'trainer'
          || operation.payload.canonicalItemId !== definition.canonicalId
          || operation.payload.canonicalDefinitionSha256 !== definition.definitionSha256
          || operation.payload.sourceOperationId !== plan.operationId
          || operation.payload.outcomeOptionId !== ITEM_GUIDED_CAMPAIGN_TOOL_ACCEPT_OPTION_ID
          || operation.payload.sourceDisposition !== expectedDisposition
          || operation.subjectId.length === 0
          || !Number.isSafeInteger(operation.payload.decidedAt)
          || Number(operation.payload.decidedAt) < 0
          || !parsed) {
          fail('payload-drift', `${operation.operationId} has an invalid bounded campaign-tool adjudication payload.`)
        }
      }
      else if (operation.payload.action === 'start-route-lure') {
        exactFields(operation, ['action', 'activity'])
        const reviewed = definition.spec.effects.find(effect => (
          effect.operation === 'use-bait' || effect.operation === 'start-route-lure'
          || effect.operation === 'use-snack-or-bait'
        ))
        let activity
        try {
          activity = parseItemExplorationState({
            schemaVersion: 1, routeLures: [operation.payload.activity], repels: [], dowsingUses: [],
          }).routeLures[0]
        }
        catch { fail('payload-drift', `${operation.operationId} has malformed route lure authority.`) }
        if (!reviewed || operation.aggregate.kind !== 'sheet' || operation.aggregate.sheetKind !== 'trainer'
          || activity?.sourceOperationId !== plan.operationId
          || activity?.canonicalItemId !== definition.canonicalId
          || activity?.canonicalDefinitionSha256 !== definition.definitionSha256
          || activity?.startedAtCampaignMinute !== plan.nonEncounterContext?.campaignTime.campaignMinute) {
          fail('payload-drift', `${operation.operationId} has an invalid route lure payload.`)
        }
      }
      else if (operation.payload.action === 'apply-route-repel') {
        exactFields(operation, ['action', 'effect'])
        const reviewed = definition.spec.effects.find(effect => effect.operation === 'use-repel')
        let repel
        try {
          repel = parseItemExplorationState({
            schemaVersion: 1, routeLures: [], repels: [operation.payload.effect], dowsingUses: [],
          }).repels[0]
        }
        catch { fail('payload-drift', `${operation.operationId} has malformed route Repel authority.`) }
        if (!reviewed || operation.aggregate.kind !== 'sheet' || operation.aggregate.sheetKind !== 'trainer'
          || repel?.sourceOperationId !== plan.operationId
          || repel?.canonicalItemId !== definition.canonicalId
          || repel?.canonicalDefinitionSha256 !== definition.definitionSha256
          || repel?.startedAtCampaignMinute !== plan.nonEncounterContext?.campaignTime.campaignMinute
          || repel?.maximumAffectedWildLevel !== reviewed.maximumAffectedWildLevel
          || repel?.expiresAtCampaignMinute !== repel.startedAtCampaignMinute + reviewed.durationMinutes) {
          fail('payload-drift', `${operation.operationId} has an invalid route Repel payload.`)
        }
      }
      else if (operation.payload.action === 'resolve-dowsing') {
        exactFields(operation, ['action', 'use', 'shardRows'])
        const reviewed = definition.spec.effects.find(effect => effect.operation === 'search-for-shards')
        let use
        try {
          use = parseItemExplorationState({
            schemaVersion: 1, routeLures: [], repels: [], dowsingUses: [operation.payload.use],
          }).dowsingUses[0]
        }
        catch { fail('payload-drift', `${operation.operationId} has malformed Dowsing authority.`) }
        if (!reviewed || operation.aggregate.kind !== 'sheet' || operation.aggregate.sheetKind !== 'trainer'
          || use?.sourceOperationId !== plan.operationId
          || use?.canonicalDefinitionSha256 !== definition.definitionSha256
          || use?.resolvedAtCampaignMinute !== plan.nonEncounterContext?.campaignTime.campaignMinute
          || !Array.isArray(operation.payload.shardRows)
          || operation.payload.shardRows.length !== use?.shardAwards.length) {
          fail('payload-drift', `${operation.operationId} has an invalid Dowsing payload.`)
        }
      }
      else if (operation.payload.action === 'evolve-pokemon') {
        exactFields(operation, [
          'action', 'canonicalItemId', 'canonicalDefinitionSha256', 'sourceOperationId',
          'sourceInstanceId', 'selectedChoices', 'application', 'resultingSpecies',
          'resultingAbilityNames', 'requiredStatPoints', 'moveOpportunityIds',
          'inactiveEquipmentItemIds', 'appliedAt', 'previewFacts',
        ])
        const reviewed = definition.spec.effects.find(effect => effect.operation === 'evolve-pokemon')
        const application = (() => {
          try {
            return parseItemEvolutionState({
              schemaVersion: 1,
              applications: [operation.payload.application],
              statResolutions: [],
            }).applications[0]
          }
          catch {
            return fail('payload-drift', `${operation.operationId} has malformed evolution provenance.`)
          }
        })()
        if (!reviewed || operation.aggregate.kind !== 'sheet' || operation.aggregate.sheetKind !== 'pokemon'
          || operation.payload.canonicalItemId !== definition.canonicalId
          || operation.payload.canonicalDefinitionSha256 !== definition.definitionSha256
          || operation.payload.sourceOperationId !== plan.operationId
          || typeof operation.payload.sourceInstanceId !== 'string'
          || operation.payload.sourceInstanceId.length === 0
          || !Number.isSafeInteger(operation.payload.appliedAt)
          || Number(operation.payload.appliedAt) < 0
          || application?.sourceOperationId !== plan.operationId
          || application?.sourceInstanceId !== operation.payload.sourceInstanceId
          || application?.canonicalItemId !== definition.canonicalId
          || application?.canonicalDefinitionSha256 !== definition.definitionSha256
          || application?.fromSpeciesId === application?.toSpeciesId
          || application?.toSpeciesId !== operation.payload.resultingSpecies
          || application?.requiredStatPoints !== operation.payload.requiredStatPoints
          || application?.appliedAt !== operation.payload.appliedAt
          || !Array.isArray(operation.payload.resultingAbilityNames)
          || operation.payload.resultingAbilityNames.some(value => typeof value !== 'string')
          || !Array.isArray(operation.payload.moveOpportunityIds)
          || JSON.stringify(application?.moveOpportunityIds) !== JSON.stringify(operation.payload.moveOpportunityIds)
          || !Array.isArray(operation.payload.inactiveEquipmentItemIds)
          || JSON.stringify(application?.inactiveEquipmentItemIds) !== JSON.stringify(operation.payload.inactiveEquipmentItemIds)
          || !permanentChoicesConform(operation.payload.selectedChoices, definition)
          || !permanentPreviewFactsConform(operation.payload.previewFacts)) {
          fail('payload-drift', `${operation.operationId} has an invalid evolution payload.`)
        }
      }
      else if (operation.payload.action === 'learn-machine-move') {
        exactFields(operation, [
          'action', 'canonicalItemId', 'canonicalDefinitionSha256', 'sourceOperationId',
          'sourceInstanceId', 'appliedAt', 'campaignMinute', 'selectedChoices',
          'application', 'dailyUse', 'previewFacts',
        ])
        const reviewed = definition.spec.effects.find(effect => effect.operation === 'learn-machine-move')
        const application = (() => {
          try {
            return parseItemMoveLearningState({
              schemaVersion: 1,
              applications: [operation.payload.application],
            }).applications[0]
          }
          catch {
            return fail('payload-drift', `${operation.operationId} has malformed machine Move-learning provenance.`)
          }
        })()
        const context = plan.nonEncounterContext
        const dailyUseMatches = reviewed?.machineKind === 'HM'
          ? (() => {
              try {
                const dailyUse = parseItemMachineUsageState({
                  schemaVersion: 1,
                  latestUses: [operation.payload.dailyUse],
                }).latestUses[0]
                return dailyUse?.sourceOperationId === plan.operationId
                  && dailyUse.sourceInstanceId === operation.payload.sourceInstanceId
                  && dailyUse.canonicalItemId === definition.canonicalId
                  && dailyUse.canonicalDefinitionSha256 === definition.definitionSha256
                  && dailyUse.campaignMinute === operation.payload.campaignMinute
              }
              catch { return false }
            })()
          : operation.payload.dailyUse === null
        if (!reviewed || operation.aggregate.kind !== 'sheet' || operation.aggregate.sheetKind !== 'pokemon'
          || operation.payload.canonicalItemId !== definition.canonicalId
          || operation.payload.canonicalDefinitionSha256 !== definition.definitionSha256
          || operation.payload.sourceOperationId !== plan.operationId
          || typeof operation.payload.sourceInstanceId !== 'string'
          || operation.payload.sourceInstanceId.length === 0
          || !Number.isSafeInteger(operation.payload.appliedAt)
          || Number(operation.payload.appliedAt) < 0
          || !Number.isSafeInteger(operation.payload.campaignMinute)
          || Number(operation.payload.campaignMinute) < 0
          || context?.campaignTime.campaignMinute !== operation.payload.campaignMinute
          || application?.sourceOperationId !== plan.operationId
          || application?.sourceInstanceId !== operation.payload.sourceInstanceId
          || application?.canonicalItemId !== definition.canonicalId
          || application?.canonicalDefinitionSha256 !== definition.definitionSha256
          || application?.machineKind !== reviewed.machineKind
          || application?.machineNumber !== reviewed.machineNumber
          || application?.moveId !== reviewed.moveId
          || application?.campaignMinute !== operation.payload.campaignMinute
          || application?.appliedAt !== operation.payload.appliedAt
          || !dailyUseMatches
          || !permanentChoicesConform(operation.payload.selectedChoices, definition)
          || !permanentPreviewFactsConform(operation.payload.previewFacts)) {
          fail('payload-drift', `${operation.operationId} has an invalid machine Move-learning payload.`)
        }
      }
      else if (operation.payload.action === 'record-machine-daily-use') {
        exactFields(operation, [
          'action', 'canonicalItemId', 'canonicalDefinitionSha256', 'sourceOperationId',
          'sourceInstanceId', 'dailyUse',
        ])
        const reviewed = definition.spec.effects.find(effect => effect.operation === 'learn-machine-move')
        const dailyUse = (() => {
          try {
            return parseItemMachineUsageState({
              schemaVersion: 1,
              latestUses: [operation.payload.dailyUse],
            }).latestUses[0]
          }
          catch {
            return fail('payload-drift', `${operation.operationId} has malformed HM campaign-day evidence.`)
          }
        })()
        const targetOperation = plan.operations.find(candidate => (
          candidate.kind === 'campaign-fact' && candidate.payload.action === 'learn-machine-move'
        ))
        if (reviewed?.machineKind !== 'HM'
          || operation.aggregate.kind !== 'sheet' || operation.aggregate.sheetKind !== 'trainer'
          || operation.subjectId !== operation.aggregate.id
          || operation.aggregate.id !== plan.nonEncounterContext?.actor.sheetSlug
          || operation.payload.canonicalItemId !== definition.canonicalId
          || operation.payload.canonicalDefinitionSha256 !== definition.definitionSha256
          || operation.payload.sourceOperationId !== plan.operationId
          || operation.payload.sourceInstanceId !== dailyUse?.sourceInstanceId
          || dailyUse?.sourceOperationId !== plan.operationId
          || dailyUse?.canonicalItemId !== definition.canonicalId
          || dailyUse?.canonicalDefinitionSha256 !== definition.definitionSha256
          || dailyUse?.campaignMinute !== plan.nonEncounterContext?.campaignTime.campaignMinute
          || !targetOperation
          || JSON.stringify(targetOperation.payload.dailyUse) !== JSON.stringify(operation.payload.dailyUse)) {
          fail('payload-drift', `${operation.operationId} has an invalid HM campaign-day payload.`)
        }
      }
      else if (operation.payload.action === 'apply-permanent-advancement') {
        exactFields(operation, [
          'action', 'advancementKind', 'canonicalItemId', 'canonicalDefinitionSha256',
          'sourceOperationId', 'appliedAt', 'selectedChoices', 'application', 'previewFacts',
        ])
        const reviewed = definition.spec.effects.find(effect => [
          'modify-base-stat', 'grant-tutor-points', 'increase-move-frequency', 'gain-next-level-experience',
        ].includes(effect.operation))
        const application = (() => {
          try {
            return parseItemPermanentAdvancementState({
              schemaVersion: 1,
              applications: [operation.payload.application],
            }).applications[0]
          }
          catch {
            return fail('payload-drift', `${operation.operationId} has malformed permanent advancement provenance.`)
          }
        })()
        const expectedKind = reviewed?.operation === 'modify-base-stat'
          ? reviewed.amount === 1 ? 'stat-vitamin' : 'stat-suppressant'
          : reviewed?.operation === 'grant-tutor-points' ? 'heart-booster'
            : reviewed?.operation === 'increase-move-frequency' ? 'pp-up'
              : reviewed?.operation === 'gain-next-level-experience' ? 'rare-candy' : null
        if (!reviewed || operation.aggregate.kind !== 'sheet' || operation.aggregate.sheetKind !== 'pokemon'
          || operation.payload.canonicalItemId !== definition.canonicalId
          || operation.payload.canonicalDefinitionSha256 !== definition.definitionSha256
          || operation.payload.sourceOperationId !== plan.operationId
          || operation.payload.advancementKind !== expectedKind
          || application?.sourceOperationId !== plan.operationId
          || application?.canonicalItemId !== definition.canonicalId
          || application?.canonicalDefinitionSha256 !== definition.definitionSha256
          || application?.kind !== expectedKind
          || (reviewed.operation === 'modify-base-stat' && reviewed.amount === 1
            && application?.stat !== reviewed.stat)
          || !Number.isSafeInteger(operation.payload.appliedAt)
          || Number(operation.payload.appliedAt) < 0
          || application?.appliedAt !== operation.payload.appliedAt
          || !permanentChoicesConform(operation.payload.selectedChoices, definition)
          || !permanentPreviewFactsConform(operation.payload.previewFacts)) {
          fail('payload-drift', `${operation.operationId} has an invalid permanent advancement payload.`)
        }
      }
      else {
        exactFields(operation, [
          'action', 'treatmentId', 'treatmentKind', 'canonicalItemId',
          'canonicalDefinitionSha256', 'sourceOperationId', 'targetKind', 'targetSlug',
          'appliedAtCampaignMinute', 'durationMinutes', 'tickMinutes', 'healingNumerator',
          'healingDenominator', 'injuryAtCompletion', 'stopOnHpLoss', 'obeyDailyInjuryLimit',
        ])
        const reviewed = definition.spec.effects.find(effect => effect.operation === 'apply-medical-treatment')
        if (!reviewed || operation.aggregate.kind !== 'sheet'
          || operation.payload.action !== 'apply-medical-treatment'
          || operation.payload.treatmentKind !== reviewed.treatmentKind
          || operation.payload.canonicalItemId !== definition.canonicalId
          || operation.payload.canonicalDefinitionSha256 !== definition.definitionSha256
          || operation.payload.sourceOperationId !== plan.operationId
          || operation.payload.targetKind !== operation.aggregate.sheetKind
          || operation.payload.targetSlug !== operation.aggregate.id
          || typeof operation.payload.treatmentId !== 'string'
          || !/^item-treatment:v1:[a-f0-9]{32}$/.test(operation.payload.treatmentId)
          || !Number.isSafeInteger(operation.payload.appliedAtCampaignMinute)
          || Number(operation.payload.appliedAtCampaignMinute) < 0
          || operation.payload.durationMinutes !== reviewed.durationMinutes
          || operation.payload.tickMinutes !== reviewed.tickMinutes
          || operation.payload.healingNumerator !== reviewed.healingNumerator
          || operation.payload.healingDenominator !== reviewed.healingDenominator
          || operation.payload.injuryAtCompletion !== reviewed.injuryAtCompletion
          || operation.payload.stopOnHpLoss !== reviewed.stopOnHpLoss
          || operation.payload.obeyDailyInjuryLimit !== reviewed.obeyDailyInjuryLimit) {
          fail('payload-drift', `${operation.operationId} has an invalid medical treatment payload.`)
        }
      }
    }
    else if (operation.kind === 'effect') {
      if (operation.payload.action === 'wild-distraction') {
        exactFields(operation, ['action', 'focusDc', 'focus', 'failed'])
        const reviewed = definition.spec.effects.find(effect => (
          effect.operation === 'use-bait' || effect.operation === 'use-snack-or-bait'
        ))
        const focus = operation.payload.focus as Record<string, unknown> | null
        if (!reviewed || operation.aggregate.kind !== 'encounter'
          || operation.payload.focusDc !== reviewed.focusDc
          || !focus || !Array.isArray(focus.rolls)
          || focus.rolls.length < 1 || focus.rolls.length > 8
          || focus.rolls.some(value => !Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 6)
          || !Number.isSafeInteger(focus.modifier) || !Number.isSafeInteger(focus.total)
          || focus.rolls.reduce((sum, value) => sum + Number(value), Number(focus.modifier)) !== focus.total
          || operation.payload.failed !== (Number(focus.total) < reviewed.focusDc)) {
          fail('payload-drift', `${operation.operationId} has an invalid Bait distraction payload.`)
        }
      }
      else if (operation.payload.action === 'direct-repel-spray') {
        exactFields(operation, ['action', 'maximumAffectedWildLevel', 'accuracy', 'decision'])
        const reviewed = definition.spec.effects.find(effect => effect.operation === 'use-repel')
        const accuracy = operation.payload.accuracy as Record<string, unknown> | null
        const hit = accuracy?.hit === true
        let decisionValid = operation.payload.decision === null && !hit
        if (hit) {
          try {
            const decision = parseItemExplorationEncounterState({
              schemaVersion: 1, repelPositioning: [operation.payload.decision],
            }).repelPositioning[0]
            decisionValid = decision?.sourceOperationId === plan.operationId
              && decision.canonicalItemId === definition.canonicalId
              && decision.canonicalDefinitionSha256 === definition.definitionSha256
              && decision.targetPlacementId === operation.subjectId
              && decision.maximumAffectedWildLevel === reviewed?.maximumAffectedWildLevel
          }
          catch { decisionValid = false }
        }
        if (!reviewed || operation.aggregate.kind !== 'encounter'
          || operation.payload.maximumAffectedWildLevel !== reviewed.maximumAffectedWildLevel
          || !accuracy || !Number.isSafeInteger(accuracy.naturalRoll)
          || Number(accuracy.naturalRoll) < 1 || Number(accuracy.naturalRoll) > 20
          || !Number.isSafeInteger(accuracy.userAccuracy)
          || !Number.isSafeInteger(accuracy.targetSpeedEvasion)
          || !Number.isSafeInteger(accuracy.accuracyCheck)
          || Number(accuracy.accuracyCheck) !== 6 + Number(accuracy.targetSpeedEvasion)
          || hit !== (Number(accuracy.naturalRoll) === 20
            || (Number(accuracy.naturalRoll) !== 1
              && Number(accuracy.naturalRoll) + Number(accuracy.userAccuracy) >= Number(accuracy.accuracyCheck)))
          || !decisionValid) {
          fail('payload-drift', `${operation.operationId} has an invalid direct Repel payload.`)
        }
      }
      else {
        exactFields(operation, [
          'action', 'family', 'amount', 'duration', 'stackPolicy', 'switchPolicy', 'effect',
        ])
        const family = operation.payload.family
        const amount = Number(operation.payload.amount)
        const duration = operation.payload.duration as Record<string, unknown> | null
        const durationMatches = family === 'critical-range'
          ? duration?.kind === 'encounter' && duration.amount === null
            && operation.payload.stackPolicy === 'replace'
          : family === 'move-stage-reduction-immunity'
            && duration?.kind === 'turns' && duration.amount === 5
            && operation.payload.stackPolicy === 'refresh'
        let effect: ReturnType<typeof parseEncounterEffect>
        try { effect = parseEncounterEffect(operation.payload.effect, `${operation.operationId}.effect`) }
        catch { fail('payload-drift', `${operation.operationId} has an invalid typed temporary combat effect.`) }
        if (operation.aggregate.kind !== 'encounter'
          || operation.payload.action !== 'apply-temporary-combat-effect'
          || !durationMatches
          || !Number.isSafeInteger(amount) || amount < 1
          || operation.payload.switchPolicy !== 'expire'
          || !isItemTemporaryCombatEffect(effect!)
          || effect!.payload.capabilityId !== itemTemporaryEffectCapabilityId(family as 'critical-range' | 'move-stage-reduction-immunity')
          || effect!.payload.value !== amount
          || effect!.affected.placementIds.length !== 1
          || effect!.affected.placementIds[0] !== operation.subjectId
          || effect!.stackPolicy.kind !== operation.payload.stackPolicy
          || effect!.transferPolicy !== 'expire'
          || !effect!.tags.includes(ITEM_COMBAT_EFFECT_TAG)
          || (family === 'critical-range'
            ? effect!.duration.kind !== 'encounter'
            : effect!.duration.kind !== 'turns'
              || effect!.duration.subject !== 'target'
              || effect!.duration.boundary !== 'end'
              || effect!.duration.remaining !== 5)) {
          fail('payload-drift', `${operation.operationId} has an invalid temporary combat-effect payload.`)
        }
      }
    }
    else if (operation.kind === 'resource') {
      if (operation.payload.action === 'drain-ap') {
        exactFields(operation, [
          'action', 'resourceId', 'amount', 'availableBefore', 'availableAfter', 'drainId',
          'sourceInstanceId', 'canonicalItemId', 'createdAt', 'round',
        ])
        const reviewedCosts = definition.spec.costs.filter(cost => cost.kind === 'ap' && cost.resourceId === 'drain')
        const launcherDelivery = input.command?.delivery?.kind === 'wonder-launcher'
          && input.command.context === 'encounter'
          && input.command.actorSheet.kind === 'trainer'
          && /^equipment-delivery:v1:[a-f0-9]{32}$/.test(input.command.delivery.equipmentBindingId)
          && definition.spec.effects.some(effect => effect.operation === 'modify-stage'
            || effect.operation === 'temporary-combat-effect')
        const reviewedAmount = launcherDelivery && reviewedCosts.length === 0
          ? 1
          : reviewedCosts.length === 1 ? reviewedCosts[0]!.amount : null
        if (operation.aggregate.kind !== 'sheet' || operation.aggregate.sheetKind !== 'trainer'
          || operation.subjectId !== operation.aggregate.id
          || reviewedAmount === null
          || operation.payload.resourceId !== 'ap'
          || operation.payload.amount !== reviewedAmount
          || operation.payload.canonicalItemId !== definition.canonicalId
          || operation.payload.drainId !== itemApDrainId(plan.operationId)
          || typeof operation.payload.sourceInstanceId !== 'string'
          || operation.payload.sourceInstanceId.length === 0
          || (launcherDelivery && operation.payload.sourceInstanceId !== input.command!.delivery!.equipmentBindingId)
          || !Number.isSafeInteger(operation.payload.availableBefore)
          || !Number.isSafeInteger(operation.payload.availableAfter)
          || Number(operation.payload.availableBefore) < Number(operation.payload.amount)
          || Number(operation.payload.availableAfter) !== Number(operation.payload.availableBefore) - Number(operation.payload.amount)
          || !Number.isSafeInteger(operation.payload.createdAt) || Number(operation.payload.createdAt) < 0
          || (operation.payload.round !== null
            && (!Number.isSafeInteger(operation.payload.round) || Number(operation.payload.round) < 0))) {
          fail('payload-drift', `${operation.operationId} has an invalid AP drain action.`)
        }
      }
      else {
        exactFields(operation, ['action', 'resourceId', 'amount'])
        if (operation.payload.action !== 'spend' && operation.payload.action !== 'schedule-next-turn-forfeit') {
          fail('payload-drift', `${operation.operationId} has an invalid resource action.`)
        }
        if (operation.payload.action === 'schedule-next-turn-forfeit'
          && (operation.payload.resourceId !== 'item.restorative.target-next-turn-forfeit'
            || operation.payload.amount !== 1)) {
          fail('payload-drift', `${operation.operationId} has an invalid restorative forfeiture.`)
        }
      }
    }
    else fail('operation-drift', `${operation.operationId} uses an unsupported runtime operation kind.`)
  }
  const reviewedEvolution = definition.spec.effects.find(effect => effect.operation === 'evolve-pokemon')
  if (reviewedEvolution) {
    const evolutionOperations = plan.operations.filter(operation => (
      operation.kind === 'campaign-fact' && operation.payload.action === 'evolve-pokemon'
    ))
    if (evolutionOperations.length !== 1) {
      fail('operation-drift', 'Evolutionary Item use requires one exact Pokémon species mutation.')
    }
  }
  const reviewedMachine = definition.spec.effects.find(effect => effect.operation === 'learn-machine-move')
  if (reviewedMachine) {
    const learningOperations = plan.operations.filter(operation => (
      operation.kind === 'campaign-fact' && operation.payload.action === 'learn-machine-move'
    ))
    const dailyUseOperations = plan.operations.filter(operation => (
      operation.kind === 'campaign-fact' && operation.payload.action === 'record-machine-daily-use'
    ))
    if (learningOperations.length !== 1
      || dailyUseOperations.length !== (reviewedMachine.machineKind === 'HM' ? 1 : 0)) {
      fail('operation-drift', 'Machine Move learning requires one exact target mutation and HM-specific campaign-day evidence.')
    }
  }
  const plannedWrites = new Set(plan.operations.map(aggregateKey))
  const evidenceWrites = new Set<string>()
  if (compensation.map) evidenceWrites.add(`map:${compensation.map.slug}`)
  if (compensation.groupInventory) evidenceWrites.add(`group-inventory:${compensation.groupInventory.slug}`)
  for (const sheet of compensation.sheets) evidenceWrites.add(`sheet:${sheet.kind}:${sheet.slug}`)
  if (plannedWrites.size !== evidenceWrites.size || [...plannedWrites].some(key => !evidenceWrites.has(key))) {
    fail('write-set-drift', 'Item compensation write set does not exactly match the deterministic plan.')
  }
  const consumptionOperations = plan.operations.filter(operation => operation.kind === 'inventory'
    && operation.payload.action === 'consume')
  if (definition.spec.consumption.reusable) {
    if (consumptionOperations.length > 0) {
      fail('unsafe-compensation', 'Reusable item plans cannot consume their authoritative source row.')
    }
  }
  else if (consumptionOperations.length !== 1) {
    fail('unsafe-compensation', 'Accepted consumable runtime plans require exactly one inventory disposition.')
  }
  const apDrainOperations = plan.operations.filter(operation => operation.kind === 'resource'
    && operation.payload.action === 'drain-ap')
  const reviewedApDrains = definition.spec.costs.filter(cost => cost.kind === 'ap' && cost.resourceId === 'drain')
  const launcherApDrainCount = input.command?.delivery?.kind === 'wonder-launcher'
    && definition.spec.effects.some(effect => effect.operation === 'modify-stage'
      || effect.operation === 'temporary-combat-effect')
    ? 1 : 0
  if (apDrainOperations.length !== reviewedApDrains.length + launcherApDrainCount) {
    fail('operation-drift', 'Item AP drain operations do not match the reviewed cost declaration.')
  }
}

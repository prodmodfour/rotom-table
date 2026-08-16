import type { ItemOperationPlanV1, PlannedItemOperation } from '#shared/itemAutomation/operations'
import { ITEM_SKILL_CHECK_IDS, type ItemSkillCheckId } from '#shared/itemAutomation/spec'
import { createEncounterTurnResourceLedger, type EncounterTurnResourceDirectory } from '#shared/moveAutomation/encounterResources'
import {
  ITEM_RESTORATIVE_NEXT_TURN_FLAG_ID,
  spendEncounterMoveResourceCosts,
} from '../moveAutomation/reduceEncounterResources'
import type { MoveSpecCostDeclaration } from '#shared/moveAutomation/spec'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { applyCombatStagesToSheet, applyConditionsToSheet, applyHpToSheet, type AnyLiveSheet } from '~/utils/sheetMutations'
import { computePokemonHealingVitals, computeTrainerHealingVitals } from '~/utils/sheets/healing'
import {
  conditionBaseName,
  conditionByName,
  isStatusAfflictionCondition,
  normalizeConditionNames,
} from '~/utils/statusConditions'
import { clampCombatStage, normalizeCombatStages } from '~/utils/combatStages'
import { resolveStats } from '~/utils/sheets/pokemonDerived'
import { consumeAuthoritativeItemSourceRow } from './sourceInventory'
import type { GroupInventoryDocument } from '~/types/groupInventory'
import { reconcileCapabilityHpState } from '../capabilityAutomation/reconcileHpState'
import { capabilityActorIsFainted } from '../capabilityAutomation/actionEligibility'
import { sameJsonValue } from '~/utils/serialization'
import { parseEncounterEffect } from '#shared/moveAutomation/encounterEffects'
import { parseEncounterState } from '#shared/moveAutomation/encounterState'
import { applyEncounterEffectLifecycleEvent } from '../moveAutomation/effectLifecycle'
import { storeAuthoritativeDigestionBuff } from './digestionBuffs'
import { ITEM_AUTOMATION_RUNTIME_REGISTRY } from './registry'
import { applyItemApDrain, itemApDrainId } from './ap'
import { resolveItemSkillCheckProfile } from './healing'
import { applyBandageTreatment, itemMedicalTreatmentId } from './medicalTreatments'
import { resolvePermanentItemAdvancement } from './permanentAdvancement'
import { applyItemMachineDailyUsage, resolveMachineMoveLearning } from './moveLearning'
import { resolveItemEvolution } from './evolution'
import {
  applyItemRepelCampaignEffect,
  applyResolvedItemDowsing,
  resolveItemDowsing,
  startItemRouteLure,
} from './exploration'
import {
  ITEM_GUIDED_CAMPAIGN_TOOL_ACCEPT_OPTION_ID,
  parseItemGuidedCampaignToolState,
  parseItemGuidedLoyaltyState,
  type ItemGuidedCampaignToolReceiptV1,
  type ItemGuidedLoyaltyReceiptV1,
} from '#shared/itemAutomation/guidedAdjudication'
import {
  ITEM_BAIT_NEXT_TURN_STANDARD_FLAG_ID,
  parseItemExplorationEncounterState,
  parseItemExplorationState,
  type ItemDowsingUseV1,
  type ItemRepelPositioningDecisionV1,
  type ItemRouteLureActivityV1,
} from '#shared/itemAutomation/exploration'
import { resolveSkills } from '~/utils/sheets/pokemonDerived'
import {
  ITEM_COMBAT_EFFECT_TAG,
  isItemTemporaryCombatEffect,
  itemTemporaryEffectCapabilityId,
} from './combatEffects'

export interface ReduceItemOperationInput {
  readonly plan: ItemOperationPlanV1
  readonly map: TabletopMap | null
  readonly sheets: ReadonlyMap<string, AnyLiveSheet>
  readonly groupInventory: GroupInventoryDocument | null
}

export interface ReducedItemOperation {
  readonly map: TabletopMap | null
  readonly sheets: ReadonlyMap<string, AnyLiveSheet>
  readonly groupInventory: GroupInventoryDocument | null
  readonly changedSheetKeys: readonly string[]
  readonly mapChanged: boolean
  readonly groupInventoryChanged: boolean
}

const sheetKey = (kind: 'pokemon' | 'trainer', slug: string): string => `${kind}:${slug}`
const asNumber = (value: unknown, label: string): number => {
  if (!Number.isSafeInteger(value)) throw new Error(`${label} must be a safe integer.`)
  return Number(value)
}
const payload = (operation: PlannedItemOperation): Record<string, unknown> => operation.payload as Record<string, unknown>
const exactPayload = (operation: PlannedItemOperation, fields: readonly string[]): Record<string, unknown> => {
  const data = payload(operation)
  const expected = new Set(fields)
  if (Object.keys(data).some(field => !expected.has(field)) || fields.some(field => !Object.hasOwn(data, field))) {
    throw new Error(`${operation.operationId} has an invalid payload shape.`)
  }
  return data
}

const currentConditions = (kind: 'pokemon' | 'trainer', sheet: AnyLiveSheet): string[] => kind === 'pokemon'
  ? normalizeConditionNames((sheet as CharacterSheet).combat?.conditions)
  : normalizeConditionNames((sheet as TrainerSheet).conditions)

const currentStages = (kind: 'pokemon' | 'trainer', sheet: AnyLiveSheet) => {
  if (kind === 'pokemon') {
    const pokemon = sheet as CharacterSheet
    const stats = resolveStats(pokemon)
    const stage = (key: 'atk' | 'def' | 'satk' | 'sdef' | 'spd'): number => stats.find(value => value.key === key)?.stage ?? 0
    return normalizeCombatStages({ atk: stage('atk'), def: stage('def'), satk: stage('satk'), sdef: stage('sdef'), spd: stage('spd'), acc: pokemon.combatStages?.acc })
  }
  const trainer = sheet as TrainerSheet
  return normalizeCombatStages({
    atk: trainer.stats?.atk?.stage ?? trainer.combatStages?.atk,
    def: trainer.stats?.def?.stage ?? trainer.combatStages?.def,
    satk: trainer.stats?.satk?.stage ?? trainer.combatStages?.satk,
    sdef: trainer.stats?.sdef?.stage ?? trainer.combatStages?.sdef,
    spd: trainer.stats?.spd?.stage ?? trainer.combatStages?.spd,
    acc: trainer.combatStages?.acc,
  })
}

const reduceSheetEffect = (
  operation: PlannedItemOperation,
  sheet: AnyLiveSheet,
  sheets: ReadonlyMap<string, AnyLiveSheet>,
  plan: ItemOperationPlanV1,
): AnyLiveSheet => {
  if (operation.aggregate.kind !== 'sheet') throw new Error(`${operation.operationId} requires a sheet aggregate.`)
  const kind = operation.aggregate.sheetKind
  const hpPayloadFields = operation.kind === 'hp' && payload(operation).action === 'heal'
    ? [
        'action', 'calculationKind', 'currentHp', 'fullFormulaMaximumHp', 'effectiveMaximumHp',
        'injuries', 'requestedHealing', 'effectiveHealing', 'overheal', 'resultingHp', 'roll',
        'cap', 'faintedState',
      ]
    : [
        'action', 'calculationKind', 'currentHp', 'fullFormulaMaximumHp', 'effectiveMaximumHp',
        'injuries', 'requestedHp', 'resultingHp', 'capReducedAmount', 'cap', 'targetKind',
        'faintedState',
      ]
  const data = operation.kind === 'hp'
    ? exactPayload(operation, hpPayloadFields)
    : operation.kind === 'condition'
      ? exactPayload(operation, [
          'action', 'mode', 'selection', 'currentConditions', 'removedConditionIds',
          'removedEntries', 'resultingConditions',
        ])
      : operation.kind === 'stage'
        ? exactPayload(operation, [
            'action', 'stat', 'previous', 'requestedDelta', 'appliedDelta',
            'current', 'minimum', 'maximum', 'capped',
          ])
        : payload(operation)
  if (operation.kind === 'hp') {
    const vitals = kind === 'pokemon'
      ? computePokemonHealingVitals(sheet as CharacterSheet)
      : computeTrainerHealingVitals(sheet as TrainerSheet)
    const action = data.action
    let next: number
    if (action === 'heal') {
      const currentHp = asNumber(data.currentHp, `${operation.operationId}.currentHp`)
      const fullMaximum = asNumber(data.fullFormulaMaximumHp, `${operation.operationId}.fullFormulaMaximumHp`)
      const effectiveMaximum = asNumber(data.effectiveMaximumHp, `${operation.operationId}.effectiveMaximumHp`)
      const injuries = asNumber(data.injuries, `${operation.operationId}.injuries`)
      const requested = asNumber(data.requestedHealing, `${operation.operationId}.requestedHealing`)
      const restored = asNumber(data.effectiveHealing, `${operation.operationId}.effectiveHealing`)
      const overheal = asNumber(data.overheal, `${operation.operationId}.overheal`)
      const resultingHp = asNumber(data.resultingHp, `${operation.operationId}.resultingHp`)
      if (!['fixed', 'rolled', 'skill-check', 'maximum-relative'].includes(String(data.calculationKind))
        || data.cap !== 'injury-adjusted-effective-maximum-hp' || data.faintedState !== 'preserve'
        || currentHp !== vitals.currentHp || fullMaximum !== vitals.fullMaxHp || effectiveMaximum !== vitals.maxHp
        || injuries !== vitals.injuries
        || (data.calculationKind === 'skill-check' ? requested < 0 : requested < 1)
        || restored < 0 || overheal < 0
        || restored !== Math.min(requested, Math.max(0, vitals.maxHp - vitals.currentHp))
        || overheal !== requested - restored || resultingHp !== vitals.currentHp + restored) {
        throw new Error(`${operation.operationId} healing resolution does not match authoritative target vitals.`)
      }
      const roll = data.roll
      if (data.calculationKind === 'rolled' || data.calculationKind === 'skill-check') {
        const skillCheck = data.calculationKind === 'skill-check'
        const expectedRollFields = skillCheck
          ? [
              'expression', 'rolls', 'modifier', 'total', 'skillId', 'rankValue', 'dieSides',
              'actorSheetKind', 'actorSheetSlug', 'actorSheetRevision',
            ]
          : ['expression', 'rolls', 'modifier', 'total']
        if (!roll || typeof roll !== 'object' || Array.isArray(roll)
          || Object.keys(roll).length !== expectedRollFields.length
          || expectedRollFields.some(field => !Object.hasOwn(roll, field))) {
          throw new Error(`${operation.operationId}.roll is invalid.`)
        }
        const evidence = roll as Record<string, unknown>
        if (typeof evidence.expression !== 'string' || !Array.isArray(evidence.rolls)
          || !Number.isSafeInteger(evidence.modifier) || !Number.isSafeInteger(evidence.total)
          || evidence.rolls.some(value => !Number.isSafeInteger(value) || Number(value) < 1)
          || evidence.rolls.reduce((total, value) => total + Number(value), Number(evidence.modifier)) !== evidence.total
          || (skillCheck ? Math.max(0, Number(evidence.total)) : evidence.total) !== requested) {
          throw new Error(`${operation.operationId}.roll does not match resolved healing.`)
        }
        if (skillCheck) {
          if (!ITEM_SKILL_CHECK_IDS.includes(evidence.skillId as ItemSkillCheckId)
            || evidence.dieSides !== 6
            || evidence.actorSheetKind !== 'trainer'
            || typeof evidence.actorSheetSlug !== 'string'
            || !Number.isSafeInteger(evidence.actorSheetRevision)) {
            throw new Error(`${operation.operationId}.roll has invalid skill-check authority.`)
          }
          const actorRef = plan.readSet.find(ref => ref.kind === 'sheet'
            && ref.sheetKind === 'trainer'
            && ref.id === evidence.actorSheetSlug)
          const actorSheet = sheets.get(`trainer:${String(evidence.actorSheetSlug)}`)
          if (!actorRef || actorRef.revision !== evidence.actorSheetRevision || !actorSheet) {
            throw new Error(`${operation.operationId}.roll actor is absent from the authoritative read set.`)
          }
          const profile = resolveItemSkillCheckProfile({
            amount: { kind: 'skill-check', skillId: evidence.skillId as ItemSkillCheckId, dieSides: 6 },
            actorSheetKind: 'trainer',
            actorSheet,
          })
          if (evidence.rankValue !== profile.diceCount
            || evidence.modifier !== profile.modifier
            || evidence.rolls.length !== profile.diceCount
            || evidence.rolls.some(value => Number(value) > 6)
            || evidence.expression !== `${profile.diceCount}d6${profile.modifier === 0 ? '' : profile.modifier > 0 ? `+${profile.modifier}` : profile.modifier}`) {
            throw new Error(`${operation.operationId}.roll does not match the authoritative Trainer skill.`)
          }
        }
      }
      else if (roll !== null) throw new Error(`${operation.operationId}.roll is only valid for rolled or skill-check healing.`)
      next = resultingHp
    }
    else if (action === 'revive') {
      const currentHp = asNumber(data.currentHp, `${operation.operationId}.currentHp`)
      const fullMaximum = asNumber(data.fullFormulaMaximumHp, `${operation.operationId}.fullFormulaMaximumHp`)
      const effectiveMaximum = asNumber(data.effectiveMaximumHp, `${operation.operationId}.effectiveMaximumHp`)
      const injuries = asNumber(data.injuries, `${operation.operationId}.injuries`)
      const requestedHp = asNumber(data.requestedHp, `${operation.operationId}.requestedHp`)
      const resultingHp = asNumber(data.resultingHp, `${operation.operationId}.resultingHp`)
      const capReducedAmount = asNumber(data.capReducedAmount, `${operation.operationId}.capReducedAmount`)
      if (kind !== 'pokemon'
        || !['fixed', 'maximum-relative'].includes(String(data.calculationKind))
        || data.cap !== 'injury-adjusted-effective-maximum-hp'
        || data.targetKind !== 'pokemon' || data.faintedState !== 'require-and-clear'
        || (vitals.currentHp > 0 && !currentConditions(kind, sheet).includes('Fainted'))
        || currentHp !== vitals.currentHp || fullMaximum !== vitals.fullMaxHp
        || effectiveMaximum !== vitals.maxHp || injuries !== vitals.injuries
        || requestedHp < 1 || resultingHp !== Math.min(requestedHp, vitals.maxHp)
        || resultingHp < 1 || capReducedAmount !== requestedHp - resultingHp) {
        throw new Error(`${operation.operationId} revival resolution does not match authoritative target state.`)
      }
      next = resultingHp
    }
    else throw new Error(`${operation.operationId} has an invalid HP action.`)
    let updated = applyHpToSheet(kind, sheet, next)
    if (action === 'revive') {
      updated = applyConditionsToSheet(kind, updated, currentConditions(kind, updated).filter(value => value !== 'Fainted'))
    }
    return updated
  }
  if (operation.kind === 'condition') {
    if (data.action !== 'remove'
      || !['listed', 'persistent', 'volatile', 'all-status'].includes(String(data.mode))
      || !['all-applicable', 'choose-one'].includes(String(data.selection))
      || !Array.isArray(data.currentConditions)
      || !Array.isArray(data.removedConditionIds)
      || !Array.isArray(data.removedEntries)
      || !Array.isArray(data.resultingConditions)) {
      throw new Error(`${operation.operationId} has an invalid condition removal payload.`)
    }
    const current = currentConditions(kind, sheet)
    const plannedCurrent = normalizeConditionNames(data.currentConditions)
    const removedEntries = normalizeConditionNames(data.removedEntries)
    const removedConditionIds = normalizeConditionNames(data.removedConditionIds)
    const resulting = normalizeConditionNames(data.resultingConditions)
    const canonicalRemoved = [...new Set(removedEntries
      .map(value => conditionBaseName(value))
      .filter((value): value is string => Boolean(value)))]
    const inScope = (value: string): boolean => {
      const canonical = conditionBaseName(value)
      const category = canonical ? conditionByName.get(canonical)?.category : null
      if (data.mode === 'persistent') return category === 'Persistent Affliction'
      if (data.mode === 'volatile') return category === 'Volatile Affliction'
      if (data.mode === 'all-status') return isStatusAfflictionCondition(canonical)
      return true
    }
    const compoundEmptyCure = removedEntries.length === 0 && plan.operations.some(candidate => (
      candidate.kind === 'hp'
      && candidate.subjectId === operation.subjectId
      && candidate.aggregate.kind === 'sheet'
      && candidate.aggregate.sheetKind === kind
      && candidate.aggregate.id === operation.aggregate.id
    ))
    if (JSON.stringify(current) !== JSON.stringify(plannedCurrent)
      || (removedEntries.length === 0 && !compoundEmptyCure)
      || removedEntries.some(value => !inScope(value))
      || JSON.stringify(removedConditionIds) !== JSON.stringify(canonicalRemoved)
      || (data.selection === 'choose-one' && removedConditionIds.length !== 1)
      || JSON.stringify(current.filter(value => !removedEntries.includes(value))) !== JSON.stringify(resulting)) {
      throw new Error(`${operation.operationId} condition removal does not match authoritative target state.`)
    }
    return applyConditionsToSheet(kind, sheet, resulting)
  }
  if (operation.kind === 'stage') {
    const stat = data.stat
    if (data.action !== 'modify' || !['atk', 'def', 'satk', 'sdef', 'spd', 'acc'].includes(String(stat))) {
      throw new Error(`${operation.operationId}.stat is unsupported.`)
    }
    const stages = currentStages(kind, sheet)
    const key = stat as keyof typeof stages
    const previous = asNumber(data.previous, `${operation.operationId}.previous`)
    const requestedDelta = asNumber(data.requestedDelta, `${operation.operationId}.requestedDelta`)
    const appliedDelta = asNumber(data.appliedDelta, `${operation.operationId}.appliedDelta`)
    const current = asNumber(data.current, `${operation.operationId}.current`)
    const expected = clampCombatStage(stages[key] + requestedDelta)
    if (data.minimum !== -6 || data.maximum !== 6
      || previous !== stages[key]
      || requestedDelta === 0 || requestedDelta < -6 || requestedDelta > 6
      || current !== expected
      || appliedDelta !== current - previous
      || data.capped !== (appliedDelta !== requestedDelta)
      || appliedDelta === 0) {
      throw new Error(`${operation.operationId} stage resolution does not match authoritative target state.`)
    }
    return applyCombatStagesToSheet(kind, sheet, { ...stages, [key]: current })
  }
  throw new Error(`${operation.operationId} is not a supported sheet item effect.`)
}

const addNextTurnItemFlag = (input: {
  readonly map: TabletopMap
  readonly placementId: string
  readonly flagId: typeof ITEM_BAIT_NEXT_TURN_STANDARD_FLAG_ID
  readonly sourceOperationId: string
}): TabletopMap => {
  const encounter = parseEncounterState(input.map.encounterState)
  const previous = encounter.turnResources[input.placementId] ?? createEncounterTurnResourceLedger({
    placementId: input.placementId,
    round: input.map.initiative?.round ?? null,
    turn: null,
  })
  if (previous.oncePerTurnFlags.some(flag => flag.id === input.flagId)) {
    throw new Error(`${input.placementId} already owes this item action forfeiture.`)
  }
  if (previous.oncePerTurnFlags.length >= 64) throw new Error('Encounter item action forfeiture exceeds its safe bound.')
  return structuredClone({
    ...input.map,
    encounterState: {
      ...encounter,
      turnResources: {
        ...encounter.turnResources,
        [input.placementId]: {
          ...previous,
          oncePerTurnFlags: [...previous.oncePerTurnFlags, {
            id: input.flagId,
            sourceOperationId: input.sourceOperationId,
            resetOn: ['turn-start' as const],
          }].sort((left, right) => left.id.localeCompare(right.id)),
        },
      },
    },
  })
}

const pokemonFocusProfile = (sheet: CharacterSheet): {
  readonly expression: string
  readonly diceCount: number
  readonly modifier: number
} => {
  const value = resolveSkills(sheet).find(skill => skill.key === 'focus')?.value ?? '2d6'
  const match = /^\s*(\d+)d6(?:\s*([+-])\s*(\d+))?\s*$/iu.exec(value)
  if (!match) throw new Error('The target Focus skill has unsupported dice authority.')
  const diceCount = Number.parseInt(match[1]!, 10)
  const magnitude = Number.parseInt(match[3] ?? '0', 10)
  const modifier = match[2] === '-' ? -magnitude : magnitude
  return {
    expression: `${diceCount}d6${modifier === 0 ? '' : modifier > 0 ? `+${modifier}` : modifier}`,
    diceCount,
    modifier,
  }
}

const applyMapExplorationEffect = (input: {
  readonly operation: PlannedItemOperation
  readonly map: TabletopMap
  readonly sheets: ReadonlyMap<string, AnyLiveSheet>
  readonly plan: ItemOperationPlanV1
}): TabletopMap => {
  const raw = payload(input.operation)
  if (input.operation.aggregate.kind !== 'encounter'
    || input.operation.aggregate.id !== input.map.slug
    || !input.map.placements.some(placement => placement.id === input.operation.subjectId)) {
    throw new Error(`${input.operation.operationId} has invalid exploration encounter authority.`)
  }
  if (raw.action === 'wild-distraction') {
    const data = exactPayload(input.operation, ['action', 'focusDc', 'focus', 'failed'])
    const targetPlacement = input.map.placements.find(placement => placement.id === input.operation.subjectId)!
    const target = input.sheets.get(`${targetPlacement.sheetKind}:${targetPlacement.sheetSlug}`)
    if (targetPlacement.sheetKind !== 'pokemon' || !target
      || data.focusDc !== 12 || typeof data.failed !== 'boolean'
      || !data.focus || typeof data.focus !== 'object' || Array.isArray(data.focus)) {
      throw new Error(`${input.operation.operationId} has invalid Bait distraction authority.`)
    }
    const focus = data.focus as Record<string, unknown>
    const fields = ['expression', 'rolls', 'modifier', 'total']
    if (Object.keys(focus).length !== fields.length || fields.some(field => !Object.hasOwn(focus, field))
      || !Array.isArray(focus.rolls)) throw new Error(`${input.operation.operationId}.focus is invalid.`)
    const profile = pokemonFocusProfile(target as CharacterSheet)
    const rolls = focus.rolls.map((value, index) => asNumber(value, `${input.operation.operationId}.focus.rolls[${index}]`))
    const total = rolls.reduce((sum, roll) => sum + roll, profile.modifier)
    if (focus.expression !== profile.expression || focus.modifier !== profile.modifier
      || rolls.length !== profile.diceCount || rolls.some(roll => roll < 1 || roll > 6)
      || focus.total !== total || data.failed !== (total < 12)) {
      throw new Error(`${input.operation.operationId} Bait Focus check drifted from target authority.`)
    }
    return data.failed ? addNextTurnItemFlag({
      map: input.map,
      placementId: input.operation.subjectId,
      flagId: ITEM_BAIT_NEXT_TURN_STANDARD_FLAG_ID,
      sourceOperationId: input.plan.operationId,
    }) : input.map
  }
  if (raw.action === 'direct-repel-spray') {
    const data = exactPayload(input.operation, [
      'action', 'maximumAffectedWildLevel', 'accuracy', 'decision',
    ])
    const targetPlacement = input.map.placements.find(placement => placement.id === input.operation.subjectId)!
    const target = input.sheets.get(`${targetPlacement.sheetKind}:${targetPlacement.sheetSlug}`)
    if (targetPlacement.sheetKind !== 'pokemon' || !target
      || Number((target as CharacterSheet).level ?? 0) > Number(data.maximumAffectedWildLevel)
      || !data.accuracy || typeof data.accuracy !== 'object' || Array.isArray(data.accuracy)) {
      throw new Error(`${input.operation.operationId} direct Repel target is not eligible.`)
    }
    const accuracy = data.accuracy as Record<string, unknown>
    const fields = ['naturalRoll', 'userAccuracy', 'targetSpeedEvasion', 'accuracyCheck', 'hit']
    if (Object.keys(accuracy).length !== fields.length || fields.some(field => !Object.hasOwn(accuracy, field))) {
      throw new Error(`${input.operation.operationId} direct Repel accuracy is malformed.`)
    }
    const naturalRoll = asNumber(accuracy.naturalRoll, `${input.operation.operationId}.accuracy.naturalRoll`)
    const userAccuracy = asNumber(accuracy.userAccuracy, `${input.operation.operationId}.accuracy.userAccuracy`)
    const targetEvasion = asNumber(accuracy.targetSpeedEvasion, `${input.operation.operationId}.accuracy.targetSpeedEvasion`)
    const accuracyCheck = asNumber(accuracy.accuracyCheck, `${input.operation.operationId}.accuracy.accuracyCheck`)
    const hit = naturalRoll === 20 || (naturalRoll !== 1 && naturalRoll + userAccuracy >= accuracyCheck)
    if (naturalRoll < 1 || naturalRoll > 20 || targetEvasion < 0 || accuracyCheck !== 6 + targetEvasion
      || accuracy.hit !== hit || (hit !== (data.decision !== null))) {
      throw new Error(`${input.operation.operationId} direct Repel accuracy is inconsistent.`)
    }
    if (!hit) return input.map
    const encounter = parseEncounterState(input.map.encounterState)
    const parsed = parseItemExplorationEncounterState({
      schemaVersion: 1,
      repelPositioning: [data.decision],
    }).repelPositioning[0] as ItemRepelPositioningDecisionV1 | undefined
    if (!parsed || parsed.sourceOperationId !== input.plan.operationId
      || parsed.targetPlacementId !== input.operation.subjectId
      || parsed.maximumAffectedWildLevel !== data.maximumAffectedWildLevel
      || parsed.accuracy.naturalRoll !== naturalRoll
      || parsed.accuracy.userAccuracy !== userAccuracy
      || parsed.accuracy.targetSpeedEvasion !== targetEvasion
      || parsed.accuracy.accuracyCheck !== accuracyCheck
      || !input.map.placements.some(placement => placement.id === parsed.sourcePlacementId)
      || encounter.itemExploration?.repelPositioning.some(row => (
        row.targetPlacementId === parsed.targetPlacementId || row.decisionId === parsed.decisionId
      ))) {
      throw new Error(`${input.operation.operationId} direct Repel positioning decision drifted.`)
    }
    return structuredClone({
      ...input.map,
      encounterState: parseEncounterState({
        ...encounter,
        itemExploration: parseItemExplorationEncounterState({
          schemaVersion: 1,
          repelPositioning: [...(encounter.itemExploration?.repelPositioning ?? []), parsed],
        }),
      }),
    })
  }
  throw new Error(`${input.operation.operationId} has an unsupported exploration encounter action.`)
}

const applyMapTemporaryCombatEffect = (
  operation: PlannedItemOperation,
  map: TabletopMap,
): TabletopMap => {
  const data = exactPayload(operation, [
    'action', 'family', 'amount', 'duration', 'stackPolicy', 'switchPolicy', 'effect',
  ])
  if (operation.aggregate.kind !== 'encounter'
    || operation.aggregate.id !== map.slug
    || data.action !== 'apply-temporary-combat-effect'
    || (data.family !== 'critical-range' && data.family !== 'move-stage-reduction-immunity')
    || !Number.isSafeInteger(data.amount) || Number(data.amount) < 1
    || (data.stackPolicy !== 'replace' && data.stackPolicy !== 'refresh')
    || data.switchPolicy !== 'expire') {
    throw new Error(`${operation.operationId} has an invalid temporary combat-effect payload.`)
  }
  const duration = data.duration as Record<string, unknown>
  const durationMatches = data.family === 'critical-range'
    ? duration?.kind === 'encounter' && duration.amount === null && data.stackPolicy === 'replace'
    : duration?.kind === 'turns' && duration.amount === 5 && data.stackPolicy === 'refresh'
  const effect = parseEncounterEffect(data.effect, `${operation.operationId}.effect`)
  if (!durationMatches
    || !isItemTemporaryCombatEffect(effect)
    || effect.payload.capabilityId !== itemTemporaryEffectCapabilityId(data.family)
    || effect.payload.value !== data.amount
    || effect.affected.placementIds.length !== 1
    || effect.affected.placementIds[0] !== operation.subjectId
    || !map.placements.some(placement => placement.id === operation.subjectId)
    || !map.placements.some(placement => placement.id === effect.source.placementId)
    || effect.stackPolicy.kind !== data.stackPolicy
    || effect.transferPolicy !== 'expire'
    || !effect.tags.includes(ITEM_COMBAT_EFFECT_TAG)
    || (data.family === 'critical-range'
      ? effect.duration.kind !== 'encounter'
      : effect.duration.kind !== 'turns'
        || effect.duration.subject !== 'target'
        || effect.duration.boundary !== 'end'
        || effect.duration.remaining !== 5)) {
    throw new Error(`${operation.operationId} temporary combat effect does not match its authoritative payload.`)
  }
  const encounter = parseEncounterState(map.encounterState)
  const transition = applyEncounterEffectLifecycleEvent(
    { effects: encounter.effects },
    { kind: 'effect-applied', effect },
  )
  if (!transition.changed) {
    throw new Error(`${operation.operationId} temporary combat effect produced no authoritative change.`)
  }
  return structuredClone({
    ...map,
    encounterState: parseEncounterState({ ...encounter, effects: transition.effects }),
  })
}

const drainTrainerAp = (input: {
  readonly operation: PlannedItemOperation
  readonly plan: ItemOperationPlanV1
  readonly sheets: Map<string, AnyLiveSheet>
}): void => {
  const data = exactPayload(input.operation, [
    'action', 'resourceId', 'amount', 'availableBefore', 'availableAfter', 'drainId',
    'sourceInstanceId', 'canonicalItemId', 'createdAt', 'round',
  ])
  const aggregate = input.operation.aggregate
  if (aggregate.kind !== 'sheet' || aggregate.sheetKind !== 'trainer'
    || input.operation.subjectId !== aggregate.id
    || data.action !== 'drain-ap' || data.resourceId !== 'ap'
    || data.canonicalItemId !== input.plan.canonicalItemId
    || data.drainId !== itemApDrainId(input.plan.operationId)
    || typeof data.sourceInstanceId !== 'string' || data.sourceInstanceId.length === 0
    || !Number.isSafeInteger(data.amount) || Number(data.amount) < 1
    || !Number.isSafeInteger(data.availableBefore) || Number(data.availableBefore) < Number(data.amount)
    || !Number.isSafeInteger(data.availableAfter)
    || Number(data.availableAfter) !== Number(data.availableBefore) - Number(data.amount)
    || !Number.isSafeInteger(data.createdAt) || Number(data.createdAt) < 0
    || (data.round !== null && (!Number.isSafeInteger(data.round) || Number(data.round) < 0))) {
    throw new Error(`${input.operation.operationId} has an invalid AP drain payload.`)
  }
  const key = sheetKey('trainer', aggregate.id)
  const sheet = input.sheets.get(key)
  if (!sheet) throw new Error(`Item AP actor sheet ${key} is unavailable.`)
  input.sheets.set(key, applyItemApDrain({
    sheet: sheet as TrainerSheet,
    operationId: input.plan.operationId,
    canonicalItemId: input.plan.canonicalItemId,
    sourceInstanceId: String(data.sourceInstanceId),
    amount: Number(data.amount),
    availableBefore: Number(data.availableBefore),
    availableAfter: Number(data.availableAfter),
    createdAt: Number(data.createdAt),
    round: data.round === null ? null : Number(data.round),
  }))
}

const spendMapAction = (operation: PlannedItemOperation, map: TabletopMap): TabletopMap => {
  const data = exactPayload(operation, ['action', 'resourceId', 'amount'])
  if (typeof data.resourceId !== 'string') throw new Error(`${operation.operationId} has an invalid resource payload.`)
  const encounter = map.encounterState
  if (!encounter) throw new Error('Encounter item action requires authoritative encounter state.')
  const currentResources = encounter.turnResources
  const ledger = currentResources[operation.subjectId] ?? createEncounterTurnResourceLedger({
    placementId: operation.subjectId,
    round: map.initiative?.round ?? null,
    turn: null,
  })
  const resources: EncounterTurnResourceDirectory = { ...currentResources, [operation.subjectId]: ledger }
  if (data.action === 'schedule-next-turn-forfeit') {
    if (data.resourceId !== ITEM_RESTORATIVE_NEXT_TURN_FLAG_ID || asNumber(data.amount, `${operation.operationId}.amount`) !== 1) {
      throw new Error(`${operation.operationId} has an invalid restorative forfeiture payload.`)
    }
    if (ledger.oncePerTurnFlags.some(flag => flag.id === ITEM_RESTORATIVE_NEXT_TURN_FLAG_ID)) {
      throw new Error(`${operation.subjectId} already owes a restorative-item next-turn forfeiture.`)
    }
    const nextLedger = {
      ...ledger,
      oncePerTurnFlags: [...ledger.oncePerTurnFlags, {
        id: ITEM_RESTORATIVE_NEXT_TURN_FLAG_ID,
        sourceOperationId: operation.operationId,
        resetOn: ['turn-start' as const],
      }].sort((left, right) => left.id.localeCompare(right.id)),
    }
    return structuredClone({ ...map, encounterState: { ...encounter, turnResources: { ...resources, [operation.subjectId]: nextLedger } } })
  }
  if (data.action !== 'spend') throw new Error(`${operation.operationId} has an invalid resource payload.`)
  const resource = data.resourceId === 'standard' ? 'standard'
    : data.resourceId === 'shift' ? 'shift'
      : data.resourceId === 'swift' ? 'swift'
        : data.resourceId === 'full' ? 'full' : null
  if (!resource) throw new Error(`Item action resource ${data.resourceId} is unsupported.`)
  const costs: readonly MoveSpecCostDeclaration[] = [{
    id: 'item-action-cost', phase: 'pay', cost: { kind: 'action-resource', resource, amount: asNumber(data.amount, `${operation.operationId}.amount`) },
  }]
  const spent = spendEncounterMoveResourceCosts(resources, {
    placementId: operation.subjectId,
    canonicalMoveId: `item:${operation.operationId}`,
    resolutionId: operation.operationId,
    sourceOperationId: operation.operationId,
    costs,
    movementBudget: null,
    movementDistance: 0,
    round: ledger.round,
    turn: ledger.turn,
    actedThisRound: false,
  })
  return structuredClone({ ...map, encounterState: { ...encounter, turnResources: spent.resources } })
}

/** Purely reduce a validated operation plan; persistence decides whether all resulting documents commit. */
export const reduceItemOperationPlan = (input: ReduceItemOperationInput): ReducedItemOperation => {
  const sheets = new Map([...input.sheets].map(([key, value]) => [key, structuredClone(value)]))
  let map = input.map ? structuredClone(input.map) : null
  let groupInventory = input.groupInventory ? structuredClone(input.groupInventory) : null
  const changedSheetKeys = new Set<string>()
  let mapChanged = false
  let groupInventoryChanged = false
  for (const operation of input.plan.operations) {
    if (operation.kind === 'inventory') {
      const raw = payload(operation)
      if (raw.action === 'store-digestion-buff') {
        const data = exactPayload(operation, [
          'action', 'canonicalItemId', 'buffKind', 'amount', 'denominator', 'requiredPokemonType',
        ])
        if (operation.aggregate.kind !== 'sheet') throw new Error(`${operation.operationId} Digestion Buff requires a sheet aggregate.`)
        const aggregate = operation.aggregate
        const key = sheetKey(aggregate.sheetKind, aggregate.id)
        const targetSheet = sheets.get(key)
        if (!targetSheet) throw new Error(`Item target sheet ${key} is unavailable.`)
        const definition = ITEM_AUTOMATION_RUNTIME_REGISTRY.resolve(String(data.canonicalItemId))
        if (!definition || definition.canonicalId !== input.plan.canonicalItemId) {
          throw new Error(`${operation.operationId} Digestion Buff identity drifted.`)
        }
        const reviewed = definition.spec.effects.find(effect => (
          effect.operation === 'store-digestion-buff' || effect.operation === 'use-snack-or-bait'
        ))
        if (!reviewed
          || data.buffKind !== reviewed.buffKind
          || data.amount !== reviewed.amount
          || data.denominator !== reviewed.denominator
          || data.requiredPokemonType !== reviewed.requiredPokemonType) {
          throw new Error(`${operation.operationId} Digestion Buff mechanics drifted.`)
        }
        const placementCandidates = map?.placements.filter(placement => (
          placement.sheetKind === aggregate.sheetKind
          && placement.sheetSlug === aggregate.id
          && placement.id === operation.subjectId
        )) ?? []
        const placement = placementCandidates.length === 1 ? placementCandidates[0]! : null
        if (map && !placement) throw new Error(`${operation.operationId} Digestion Buff target placement is unavailable.`)
        sheets.set(key, storeAuthoritativeDigestionBuff({
          kind: aggregate.sheetKind,
          sheet: targetSheet,
          placement,
          map,
          definition,
        }))
        changedSheetKeys.add(key)
        continue
      }
      const data = exactPayload(operation, Object.hasOwn(raw, 'reservationOnly')
        ? ['action', 'quantity', 'sourceInstanceId', 'reservationOnly']
        : ['action', 'quantity', 'sourceInstanceId'])
      if (data.action !== 'consume' || data.reservationOnly === true) throw new Error(`${operation.operationId} has an unsupported inventory action.`)
      const aggregate = operation.aggregate
      if (aggregate.kind === 'sheet') {
        const key = sheetKey(aggregate.sheetKind, aggregate.id)
        const sourceSheet = sheets.get(key)
        if (!sourceSheet || aggregate.sheetKind !== 'trainer') throw new Error('Trainer item source sheet is unavailable.')
        const section = input.plan.operations[0]?.payload.sourceInstanceId
        void section
        const sourceRef = input.plan.readSet.find(value => value.kind === 'sheet' && value.sheetKind === 'trainer' && value.id === aggregate.id)
        if (!sourceRef) throw new Error('Trainer source is outside the read set.')
        const sourceInstance = String(data.sourceInstanceId ?? '')
        const parsed = sourceInstance.split(':')
        const inventorySection = parsed[3] as keyof TrainerSheet['inventory']
        const consumed = consumeAuthoritativeItemSourceRow({
          source: { kind: 'trainer', slug: aggregate.id, section: inventorySection, rowId: operation.subjectId, expectedRevision: aggregate.revision },
          quantity: asNumber(data.quantity, `${operation.operationId}.quantity`),
          trainerSheet: sourceSheet as TrainerSheet,
        })
        sheets.set(key, consumed.trainerSheet!)
        changedSheetKeys.add(key)
      }
      else if (aggregate.kind === 'group-inventory') {
        const sourceInstance = String(data.sourceInstanceId ?? '')
        const parsed = sourceInstance.split(':')
        const inventorySection = parsed[3] as keyof GroupInventoryDocument['inventory']
        const consumed = consumeAuthoritativeItemSourceRow({
          source: { kind: 'group', slug: aggregate.id, section: inventorySection, rowId: operation.subjectId, expectedRevision: aggregate.revision },
          quantity: asNumber(data.quantity, `${operation.operationId}.quantity`),
          groupInventory,
        })
        groupInventory = consumed.groupInventory!
        groupInventoryChanged = true
      }
      else throw new Error('Inventory operation has an unsupported aggregate.')
      continue
    }
    if (operation.kind === 'resource') {
      if (operation.aggregate.kind === 'sheet') {
        drainTrainerAp({ operation, plan: input.plan, sheets })
        changedSheetKeys.add(sheetKey('trainer', operation.aggregate.id))
      }
      else {
        if (!map) throw new Error('Encounter item resource operation requires a map.')
        map = spendMapAction(operation, map)
        mapChanged = true
      }
      continue
    }
    if (operation.kind === 'campaign-fact') {
      const raw = payload(operation)
      if (raw.action === 'adjudicate-campaign-tool') {
        const data = exactPayload(operation, [
          'action', 'canonicalItemId', 'canonicalDefinitionSha256', 'sourceOperationId',
          'outcomeOptionId', 'sourceDisposition', 'decidedAt',
        ])
        if (operation.aggregate.kind !== 'sheet' || operation.aggregate.sheetKind !== 'trainer'
          || data.canonicalItemId !== input.plan.canonicalItemId
          || data.canonicalDefinitionSha256 !== input.plan.canonicalDefinitionSha256
          || data.sourceOperationId !== input.plan.operationId
          || data.outcomeOptionId !== ITEM_GUIDED_CAMPAIGN_TOOL_ACCEPT_OPTION_ID
          || (data.sourceDisposition !== 'consumed-one' && data.sourceDisposition !== 'retained-reusable')) {
          throw new Error(`${operation.operationId} has invalid guided campaign-tool identity evidence.`)
        }
        const inventoryOperations = input.plan.operations.filter(candidate => candidate.kind === 'inventory')
        if ((data.sourceDisposition === 'consumed-one') !== (inventoryOperations.length === 1)
          || (data.sourceDisposition === 'consumed-one'
            && asNumber(inventoryOperations[0]!.payload.quantity, `${inventoryOperations[0]!.operationId}.quantity`) !== 1)) {
          throw new Error(`${operation.operationId} guided campaign-tool source disposition drifted.`)
        }
        const key = sheetKey('trainer', operation.aggregate.id)
        const target = sheets.get(key) as TrainerSheet | undefined
        if (!target) {
          throw new Error(`Guided campaign-tool target sheet ${key} is unavailable.`)
        }
        const currentState = parseItemGuidedCampaignToolState(target.serverPrivate?.itemGuidedCampaignTools)
        if (currentState.receipts.some(receipt => receipt.sourceOperationId === input.plan.operationId)
          || currentState.receipts.length >= 128) {
          throw new Error(`${operation.operationId} guided campaign-tool receipt is duplicate or exceeds its bound.`)
        }
        const receipt: ItemGuidedCampaignToolReceiptV1 = {
          schemaVersion: 1,
          sourceOperationId: input.plan.operationId,
          canonicalItemId: String(data.canonicalItemId),
          canonicalDefinitionSha256: String(data.canonicalDefinitionSha256),
          outcomeOptionId: ITEM_GUIDED_CAMPAIGN_TOOL_ACCEPT_OPTION_ID,
          sourceDisposition: data.sourceDisposition,
          decidedAt: asNumber(data.decidedAt, `${operation.operationId}.decidedAt`),
        }
        const next = structuredClone(target)
        next.serverPrivate = {
          ...(next.serverPrivate ?? {}),
          itemGuidedCampaignTools: parseItemGuidedCampaignToolState({
            schemaVersion: 1,
            receipts: [...currentState.receipts, receipt],
          }),
        }
        sheets.set(key, next)
        changedSheetKeys.add(key)
        continue
      }
      if (raw.action === 'adjudicate-loyalty') {
        const data = exactPayload(operation, [
          'action', 'canonicalItemId', 'canonicalDefinitionSha256', 'sourceOperationId',
          'outcome', 'previousLoyalty', 'currentLoyalty', 'decidedAt',
        ])
        if (operation.aggregate.kind !== 'sheet' || operation.aggregate.sheetKind !== 'pokemon'
          || data.canonicalItemId !== input.plan.canonicalItemId
          || data.canonicalDefinitionSha256 !== input.plan.canonicalDefinitionSha256
          || data.sourceOperationId !== input.plan.operationId
          || (data.outcome !== 'no-change' && data.outcome !== 'decrease-one')) {
          throw new Error(`${operation.operationId} has invalid guided Loyalty identity evidence.`)
        }
        const key = sheetKey('pokemon', operation.aggregate.id)
        const target = sheets.get(key) as CharacterSheet | undefined
        if (!target) throw new Error(`Guided Loyalty target sheet ${key} is unavailable.`)
        const previous = target.loyalty === undefined ? 3 : target.loyalty
        const plannedPrevious = asNumber(data.previousLoyalty, `${operation.operationId}.previousLoyalty`)
        const plannedCurrent = asNumber(data.currentLoyalty, `${operation.operationId}.currentLoyalty`)
        const expectedCurrent = data.outcome === 'decrease-one' ? Math.max(0, previous - 1) : previous
        if (!Number.isSafeInteger(previous) || previous < 0 || previous > 6
          || plannedPrevious !== previous || plannedCurrent !== expectedCurrent
          || plannedCurrent < 0 || plannedCurrent > 6) {
          throw new Error(`${operation.operationId} Loyalty adjudication changed before reduction.`)
        }
        const currentState = parseItemGuidedLoyaltyState(target.serverPrivate?.itemGuidedLoyalty)
        if (currentState.receipts.some(receipt => receipt.sourceOperationId === input.plan.operationId)
          || currentState.receipts.length >= 128) {
          throw new Error(`${operation.operationId} guided Loyalty receipt is duplicate or exceeds its bound.`)
        }
        const receipt: ItemGuidedLoyaltyReceiptV1 = {
          schemaVersion: 1,
          sourceOperationId: input.plan.operationId,
          canonicalItemId: String(data.canonicalItemId),
          canonicalDefinitionSha256: String(data.canonicalDefinitionSha256),
          outcome: data.outcome,
          previousLoyalty: previous,
          currentLoyalty: plannedCurrent,
          decidedAt: asNumber(data.decidedAt, `${operation.operationId}.decidedAt`),
        }
        const next = structuredClone(target)
        next.loyalty = plannedCurrent
        next.serverPrivate = {
          ...(next.serverPrivate ?? {}),
          itemGuidedLoyalty: parseItemGuidedLoyaltyState({
            schemaVersion: 1,
            receipts: [...currentState.receipts, receipt],
          }),
        }
        sheets.set(key, next)
        changedSheetKeys.add(key)
        continue
      }
      if (raw.action === 'start-route-lure') {
        const data = exactPayload(operation, ['action', 'activity'])
        if (operation.aggregate.kind !== 'sheet' || operation.aggregate.sheetKind !== 'trainer'
          || !data.activity || typeof data.activity !== 'object' || Array.isArray(data.activity)) {
          throw new Error(`${operation.operationId} has invalid route lure authority.`)
        }
        const activity = parseItemExplorationState({
          schemaVersion: 1,
          routeLures: [data.activity],
          repels: [],
          dowsingUses: [],
        }).routeLures[0] as ItemRouteLureActivityV1 | undefined
        const definition = ITEM_AUTOMATION_RUNTIME_REGISTRY.resolve(activity?.canonicalItemId ?? '')
        const key = sheetKey('trainer', operation.aggregate.id)
        const trainer = sheets.get(key) as TrainerSheet | undefined
        if (!activity || !definition || !trainer
          || definition.definitionSha256 !== input.plan.canonicalDefinitionSha256
          || activity.canonicalDefinitionSha256 !== definition.definitionSha256
          || activity.sourceOperationId !== input.plan.operationId) {
          throw new Error(`${operation.operationId} route lure identity drifted.`)
        }
        const resolved = startItemRouteLure({
          current: trainer.serverPrivate?.itemExploration,
          definition,
          sourceOperationId: input.plan.operationId,
          sourceInstanceId: activity.sourceInstanceId,
          campaignMinute: activity.startedAtCampaignMinute,
        })
        if (!sameJsonValue(resolved.activity, activity)) {
          throw new Error(`${operation.operationId} route lure mechanics drifted.`)
        }
        const next = structuredClone(trainer)
        next.serverPrivate = { ...(next.serverPrivate ?? {}), itemExploration: resolved.state }
        sheets.set(key, next)
        changedSheetKeys.add(key)
        continue
      }
      if (raw.action === 'apply-route-repel') {
        const data = exactPayload(operation, ['action', 'effect'])
        if (operation.aggregate.kind !== 'sheet' || operation.aggregate.sheetKind !== 'trainer'
          || !data.effect || typeof data.effect !== 'object' || Array.isArray(data.effect)) {
          throw new Error(`${operation.operationId} has invalid route Repel authority.`)
        }
        const repel = parseItemExplorationState({
          schemaVersion: 1,
          routeLures: [],
          repels: [data.effect],
          dowsingUses: [],
        }).repels[0]
        const definition = ITEM_AUTOMATION_RUNTIME_REGISTRY.resolve(repel?.canonicalItemId ?? '')
        const key = sheetKey('trainer', operation.aggregate.id)
        const trainer = sheets.get(key) as TrainerSheet | undefined
        if (!repel || !definition || !trainer
          || definition.definitionSha256 !== input.plan.canonicalDefinitionSha256
          || repel.canonicalDefinitionSha256 !== definition.definitionSha256
          || repel.sourceOperationId !== input.plan.operationId) {
          throw new Error(`${operation.operationId} route Repel identity drifted.`)
        }
        const resolved = applyItemRepelCampaignEffect({
          current: trainer.serverPrivate?.itemExploration,
          definition,
          sourceOperationId: input.plan.operationId,
          sourceInstanceId: repel.sourceInstanceId,
          campaignMinute: repel.startedAtCampaignMinute,
        })
        if (!sameJsonValue(resolved.effect, repel)) {
          throw new Error(`${operation.operationId} route Repel mechanics drifted.`)
        }
        const next = structuredClone(trainer)
        next.serverPrivate = { ...(next.serverPrivate ?? {}), itemExploration: resolved.state }
        sheets.set(key, next)
        changedSheetKeys.add(key)
        continue
      }
      if (raw.action === 'resolve-dowsing') {
        const data = exactPayload(operation, ['action', 'use', 'shardRows'])
        if (operation.aggregate.kind !== 'sheet' || operation.aggregate.sheetKind !== 'trainer'
          || !data.use || typeof data.use !== 'object' || Array.isArray(data.use)
          || !Array.isArray(data.shardRows)) {
          throw new Error(`${operation.operationId} has invalid Dowsing authority.`)
        }
        const use = parseItemExplorationState({
          schemaVersion: 1,
          routeLures: [],
          repels: [],
          dowsingUses: [data.use],
        }).dowsingUses[0] as ItemDowsingUseV1 | undefined
        const definition = ITEM_AUTOMATION_RUNTIME_REGISTRY.resolve('Dowsing Rod')
        const key = sheetKey('trainer', operation.aggregate.id)
        const trainer = sheets.get(key) as TrainerSheet | undefined
        if (!use || !definition || !trainer
          || definition.definitionSha256 !== input.plan.canonicalDefinitionSha256
          || use.canonicalDefinitionSha256 !== definition.definitionSha256
          || use.sourceOperationId !== input.plan.operationId) {
          throw new Error(`${operation.operationId} Dowsing identity drifted.`)
        }
        const colorRolls = use.shardAwards.map(color => {
          const index = ['Red', 'Orange', 'Yellow', 'Green', 'Blue', 'Violet'].indexOf(color)
          if (index < 0) throw new Error(`${operation.operationId} has an unsupported Shard color.`)
          return index + 1
        })
        const queuedRolls = [...use.roll.rolls, ...colorRolls]
        const resolved = resolveItemDowsing({
          current: trainer.serverPrivate?.itemExploration,
          definition,
          sheet: trainer,
          sourceOperationId: input.plan.operationId,
          sourceInstanceId: use.sourceInstanceId,
          campaignMinute: use.resolvedAtCampaignMinute,
          terrainId: use.terrainId,
          skillStuntInstanceId: use.skillStuntInstanceId,
          rollDie: (sides) => {
            if (sides !== 6 || queuedRolls.length === 0) {
              throw new Error(`${operation.operationId} Dowsing roll evidence is incomplete.`)
            }
            return queuedRolls.shift()!
          },
        })
        if (queuedRolls.length > 0 || !sameJsonValue(resolved.use, use)
          || !sameJsonValue(resolved.shardRows, data.shardRows)) {
          throw new Error(`${operation.operationId} Dowsing mechanics drifted.`)
        }
        sheets.set(key, applyResolvedItemDowsing({
          sheet: trainer,
          use,
          shardRows: structuredClone(data.shardRows) as import('~/types/trainerSheet').InventoryEntry[],
        }))
        changedSheetKeys.add(key)
        continue
      }
      if (raw.action === 'evolve-pokemon') {
        const data = exactPayload(operation, [
          'action', 'canonicalItemId', 'canonicalDefinitionSha256', 'sourceOperationId',
          'sourceInstanceId', 'selectedChoices', 'application', 'resultingSpecies',
          'resultingAbilityNames', 'requiredStatPoints', 'moveOpportunityIds',
          'inactiveEquipmentItemIds', 'appliedAt', 'previewFacts',
        ])
        if (operation.aggregate.kind !== 'sheet' || operation.aggregate.sheetKind !== 'pokemon'
          || data.canonicalItemId !== input.plan.canonicalItemId
          || data.canonicalDefinitionSha256 !== input.plan.canonicalDefinitionSha256
          || data.sourceOperationId !== input.plan.operationId
          || typeof data.sourceInstanceId !== 'string' || data.sourceInstanceId.length === 0
          || !Array.isArray(data.selectedChoices)) {
          throw new Error(`${operation.operationId} has invalid evolution identity evidence.`)
        }
        const choices = new Map<string, readonly string[]>()
        for (const [index, entry] of data.selectedChoices.entries()) {
          if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            throw new Error(`${operation.operationId}.selectedChoices[${index}] is invalid.`)
          }
          const choice = entry as Record<string, unknown>
          if (Object.keys(choice).length !== 2 || typeof choice.choiceId !== 'string'
            || !Array.isArray(choice.optionIds)
            || choice.optionIds.some(value => typeof value !== 'string')
            || new Set(choice.optionIds).size !== choice.optionIds.length
            || choices.has(choice.choiceId)) {
            throw new Error(`${operation.operationId}.selectedChoices[${index}] is invalid.`)
          }
          choices.set(choice.choiceId, choice.optionIds as readonly string[])
        }
        const definition = ITEM_AUTOMATION_RUNTIME_REGISTRY.resolve(String(data.canonicalItemId))
        if (!definition || definition.definitionSha256 !== input.plan.canonicalDefinitionSha256) {
          throw new Error(`${operation.operationId} evolution definition drifted.`)
        }
        const actorAuthority = input.plan.nonEncounterContext?.actor
        if (!actorAuthority || actorAuthority.sheetKind !== 'trainer') {
          throw new Error(`${operation.operationId} evolution omitted Trainer authority.`)
        }
        const key = sheetKey('pokemon', operation.aggregate.id)
        const target = sheets.get(key)
        if (!target) throw new Error(`${operation.operationId} evolution target is unavailable.`)
        const resolved = resolveItemEvolution({
          definition,
          sheetKind: 'pokemon',
          sheet: target as CharacterSheet,
          actorKind: 'trainer',
          sourceInstanceId: String(data.sourceInstanceId),
          selectedChoices: choices,
          operationId: input.plan.operationId,
          appliedAt: asNumber(data.appliedAt, `${operation.operationId}.appliedAt`),
        })
        if (!sameJsonValue(resolved.payload, operation.payload)) {
          throw new Error(`${operation.operationId} evolution mechanics drifted.`)
        }
        sheets.set(key, resolved.sheet)
        changedSheetKeys.add(key)
        continue
      }
      if (raw.action === 'learn-machine-move') {
        const data = exactPayload(operation, [
          'action', 'canonicalItemId', 'canonicalDefinitionSha256', 'sourceOperationId',
          'sourceInstanceId', 'appliedAt', 'campaignMinute', 'selectedChoices',
          'application', 'dailyUse', 'previewFacts',
        ])
        if (operation.aggregate.kind !== 'sheet' || operation.aggregate.sheetKind !== 'pokemon'
          || data.canonicalItemId !== input.plan.canonicalItemId
          || data.canonicalDefinitionSha256 !== input.plan.canonicalDefinitionSha256
          || data.sourceOperationId !== input.plan.operationId
          || typeof data.sourceInstanceId !== 'string' || data.sourceInstanceId.length === 0
          || !Array.isArray(data.selectedChoices)) {
          throw new Error(`${operation.operationId} has invalid machine Move-learning identity evidence.`)
        }
        const choices = new Map<string, readonly string[]>()
        for (const [index, entry] of data.selectedChoices.entries()) {
          if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            throw new Error(`${operation.operationId}.selectedChoices[${index}] is invalid.`)
          }
          const choice = entry as Record<string, unknown>
          if (Object.keys(choice).length !== 2 || typeof choice.choiceId !== 'string'
            || !Array.isArray(choice.optionIds)
            || choice.optionIds.some(value => typeof value !== 'string')
            || new Set(choice.optionIds).size !== choice.optionIds.length
            || choices.has(choice.choiceId)) {
            throw new Error(`${operation.operationId}.selectedChoices[${index}] is invalid.`)
          }
          choices.set(choice.choiceId, choice.optionIds as readonly string[])
        }
        const definition = ITEM_AUTOMATION_RUNTIME_REGISTRY.resolve(String(data.canonicalItemId))
        if (!definition || definition.definitionSha256 !== input.plan.canonicalDefinitionSha256) {
          throw new Error(`${operation.operationId} machine Move-learning definition drifted.`)
        }
        const actorAuthority = input.plan.nonEncounterContext?.actor
        if (!actorAuthority || actorAuthority.sheetKind !== 'trainer') {
          throw new Error(`${operation.operationId} machine Move learning omitted Trainer authority.`)
        }
        const actor = sheets.get(sheetKey('trainer', actorAuthority.sheetSlug))
        const key = sheetKey('pokemon', operation.aggregate.id)
        const target = sheets.get(key)
        if (!actor || !target) throw new Error(`${operation.operationId} machine Move-learning sheets are unavailable.`)
        const resolved = resolveMachineMoveLearning({
          definition,
          sheetKind: 'pokemon',
          sheet: target,
          actorKind: 'trainer',
          actorSheet: actor,
          sourceInstanceId: String(data.sourceInstanceId),
          campaignMinute: asNumber(data.campaignMinute, `${operation.operationId}.campaignMinute`),
          selectedChoices: choices,
          operationId: input.plan.operationId,
          appliedAt: asNumber(data.appliedAt, `${operation.operationId}.appliedAt`),
        })
        if (!sameJsonValue(resolved.targetPayload, operation.payload)) {
          throw new Error(`${operation.operationId} machine Move-learning mechanics drifted.`)
        }
        sheets.set(key, resolved.sheet)
        changedSheetKeys.add(key)
        continue
      }
      if (raw.action === 'record-machine-daily-use') {
        const data = exactPayload(operation, [
          'action', 'canonicalItemId', 'canonicalDefinitionSha256', 'sourceOperationId',
          'sourceInstanceId', 'dailyUse',
        ])
        if (operation.aggregate.kind !== 'sheet' || operation.aggregate.sheetKind !== 'trainer'
          || operation.subjectId !== operation.aggregate.id
          || data.canonicalItemId !== input.plan.canonicalItemId
          || data.canonicalDefinitionSha256 !== input.plan.canonicalDefinitionSha256
          || data.sourceOperationId !== input.plan.operationId
          || typeof data.sourceInstanceId !== 'string' || data.sourceInstanceId.length === 0
          || !data.dailyUse || typeof data.dailyUse !== 'object' || Array.isArray(data.dailyUse)) {
          throw new Error(`${operation.operationId} has invalid HM daily-use identity evidence.`)
        }
        const definition = ITEM_AUTOMATION_RUNTIME_REGISTRY.resolve(String(data.canonicalItemId))
        const reviewed = definition?.spec.effects.find(effect => effect.operation === 'learn-machine-move')
        const targetOperation = input.plan.operations.find(candidate => (
          candidate.kind === 'campaign-fact' && candidate.payload.action === 'learn-machine-move'
        ))
        if (!definition || definition.definitionSha256 !== input.plan.canonicalDefinitionSha256
          || reviewed?.machineKind !== 'HM'
          || !targetOperation || !sameJsonValue(targetOperation.payload.dailyUse, data.dailyUse)
          || (data.dailyUse as Record<string, unknown>).sourceInstanceId !== data.sourceInstanceId
          || (data.dailyUse as Record<string, unknown>).sourceOperationId !== input.plan.operationId) {
          throw new Error(`${operation.operationId} HM daily-use mechanics drifted.`)
        }
        const key = sheetKey('trainer', operation.aggregate.id)
        const actor = sheets.get(key)
        if (!actor) throw new Error(`Item actor sheet ${key} is unavailable.`)
        sheets.set(key, applyItemMachineDailyUsage({
          sheet: actor as TrainerSheet,
          use: structuredClone(data.dailyUse) as import('#shared/itemAutomation/moveLearning').ItemMachineDailyUseV1,
        }))
        changedSheetKeys.add(key)
        continue
      }
      if (raw.action === 'apply-permanent-advancement') {
        const data = exactPayload(operation, [
          'action', 'advancementKind', 'canonicalItemId', 'canonicalDefinitionSha256',
          'sourceOperationId', 'appliedAt', 'selectedChoices', 'application', 'previewFacts',
        ])
        if (operation.aggregate.kind !== 'sheet' || operation.aggregate.sheetKind !== 'pokemon'
          || data.canonicalItemId !== input.plan.canonicalItemId
          || data.canonicalDefinitionSha256 !== input.plan.canonicalDefinitionSha256
          || data.sourceOperationId !== input.plan.operationId
          || !Array.isArray(data.selectedChoices)) {
          throw new Error(`${operation.operationId} has invalid permanent advancement identity evidence.`)
        }
        const choices = new Map<string, readonly string[]>()
        for (const [index, entry] of data.selectedChoices.entries()) {
          if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            throw new Error(`${operation.operationId}.selectedChoices[${index}] is invalid.`)
          }
          const choice = entry as Record<string, unknown>
          if (Object.keys(choice).length !== 2 || typeof choice.choiceId !== 'string'
            || !Array.isArray(choice.optionIds)
            || choice.optionIds.some(value => typeof value !== 'string')
            || new Set(choice.optionIds).size !== choice.optionIds.length
            || choices.has(choice.choiceId)) {
            throw new Error(`${operation.operationId}.selectedChoices[${index}] is invalid.`)
          }
          choices.set(choice.choiceId, choice.optionIds as readonly string[])
        }
        const definition = ITEM_AUTOMATION_RUNTIME_REGISTRY.resolve(String(data.canonicalItemId))
        if (!definition || definition.definitionSha256 !== input.plan.canonicalDefinitionSha256) {
          throw new Error(`${operation.operationId} permanent advancement definition drifted.`)
        }
        const key = sheetKey('pokemon', operation.aggregate.id)
        const target = sheets.get(key)
        if (!target) throw new Error(`Item target sheet ${key} is unavailable.`)
        const resolved = resolvePermanentItemAdvancement({
          definition,
          sheetKind: 'pokemon',
          sheet: target,
          selectedChoices: choices,
          operationId: input.plan.operationId,
          appliedAt: asNumber(data.appliedAt, `${operation.operationId}.appliedAt`),
        })
        if (!sameJsonValue(resolved.payload, operation.payload)) {
          throw new Error(`${operation.operationId} permanent advancement mechanics drifted.`)
        }
        sheets.set(key, resolved.sheet)
        changedSheetKeys.add(key)
        continue
      }
      const data = exactPayload(operation, [
        'action', 'treatmentId', 'treatmentKind', 'canonicalItemId',
        'canonicalDefinitionSha256', 'sourceOperationId', 'targetKind', 'targetSlug',
        'appliedAtCampaignMinute', 'durationMinutes', 'tickMinutes', 'healingNumerator',
        'healingDenominator', 'injuryAtCompletion', 'stopOnHpLoss', 'obeyDailyInjuryLimit',
      ])
      if (operation.aggregate.kind !== 'sheet'
        || data.action !== 'apply-medical-treatment'
        || data.treatmentKind !== 'bandages'
        || data.canonicalItemId !== input.plan.canonicalItemId
        || data.canonicalDefinitionSha256 !== input.plan.canonicalDefinitionSha256
        || data.sourceOperationId !== input.plan.operationId
        || data.targetKind !== operation.aggregate.sheetKind
        || data.targetSlug !== operation.aggregate.id
        || data.treatmentId !== itemMedicalTreatmentId({
          operationId: input.plan.operationId,
          targetKind: operation.aggregate.sheetKind,
          targetSlug: operation.aggregate.id,
        })) {
        throw new Error(`${operation.operationId} has invalid medical treatment identity evidence.`)
      }
      const definition = ITEM_AUTOMATION_RUNTIME_REGISTRY.resolve(String(data.canonicalItemId))
      const reviewed = definition?.spec.effects.find(effect => effect.operation === 'apply-medical-treatment')
      if (!definition || definition.definitionSha256 !== input.plan.canonicalDefinitionSha256
        || !reviewed
        || data.durationMinutes !== reviewed.durationMinutes
        || data.tickMinutes !== reviewed.tickMinutes
        || data.healingNumerator !== reviewed.healingNumerator
        || data.healingDenominator !== reviewed.healingDenominator
        || data.injuryAtCompletion !== reviewed.injuryAtCompletion
        || data.stopOnHpLoss !== reviewed.stopOnHpLoss
        || data.obeyDailyInjuryLimit !== reviewed.obeyDailyInjuryLimit) {
        throw new Error(`${operation.operationId} medical treatment mechanics drifted.`)
      }
      const key = sheetKey(operation.aggregate.sheetKind, operation.aggregate.id)
      const target = sheets.get(key)
      if (!target) throw new Error(`Item target sheet ${key} is unavailable.`)
      sheets.set(key, applyBandageTreatment({
        sheetKind: operation.aggregate.sheetKind,
        sheet: target,
        targetSlug: operation.aggregate.id,
        operationId: input.plan.operationId,
        canonicalItemId: input.plan.canonicalItemId === 'Poultices' ? 'Poultices' : 'Bandages',
        canonicalDefinitionSha256: input.plan.canonicalDefinitionSha256,
        campaignMinute: asNumber(data.appliedAtCampaignMinute, `${operation.operationId}.appliedAtCampaignMinute`),
      }))
      changedSheetKeys.add(key)
      continue
    }
    if (operation.kind === 'effect') {
      if (!map) throw new Error('Encounter item effect requires a map.')
      map = operation.payload.action === 'wild-distraction'
        || operation.payload.action === 'direct-repel-spray'
        ? applyMapExplorationEffect({ operation, map, sheets, plan: input.plan })
        : applyMapTemporaryCombatEffect(operation, map)
      mapChanged = true
      continue
    }
    if (operation.aggregate.kind !== 'sheet') throw new Error(`${operation.operationId} effect aggregate is unsupported.`)
    const key = sheetKey(operation.aggregate.sheetKind, operation.aggregate.id)
    const sheet = sheets.get(key)
    if (!sheet) throw new Error(`Item target sheet ${key} is unavailable.`)
    sheets.set(key, reduceSheetEffect(operation, sheet, sheets, input.plan))
    changedSheetKeys.add(key)
  }
  const touchedHpPlacementIds = new Set(input.plan.operations
    // Ordinary restorative items deliberately preserve Fainted even after
    // positive HP; only explicit revival participates in cross-capability
    // consciousness reconciliation.
    .filter(operation => operation.kind === 'hp' && operation.payload.action === 'revive')
    .map(operation => operation.subjectId))
  if (map && input.map && touchedHpPlacementIds.size > 0) {
    const snapshots = new Map([...sheets].map(([key, sheet]) => {
      const [kind, ...slugParts] = key.split(':') as ['pokemon' | 'trainer', ...string[]]
      const slug = slugParts.join(':')
      const ref = input.plan.readSet.find(value => value.kind === 'sheet'
        && value.sheetKind === kind && value.id === slug)
      return [key, { kind, slug, revision: ref?.revision ?? 0, sheet }] as const
    }))
    const previousSnapshots = new Map([...input.sheets].map(([key, sheet]) => {
      const [kind, ...slugParts] = key.split(':') as ['pokemon' | 'trainer', ...string[]]
      const slug = slugParts.join(':')
      const ref = input.plan.readSet.find(value => value.kind === 'sheet'
        && value.sheetKind === kind && value.id === slug)
      return [key, { kind, slug, revision: ref?.revision ?? 0, sheet }] as const
    }))
    const reconciled = reconcileCapabilityHpState({
      previousMap: input.map,
      nextMap: map,
      sheets: snapshots,
      previousSheets: previousSnapshots,
      touchedPlacementIds: touchedHpPlacementIds,
    })
    if (!sameJsonValue(map, reconciled.nextMap)) mapChanged = true
    map = structuredClone(reconciled.nextMap)
    for (const [key, snapshot] of reconciled.sheets) {
      const previous = sheets.get(key)
      sheets.set(key, structuredClone(snapshot.sheet))
      if (!sameJsonValue(previous, snapshot.sheet)) changedSheetKeys.add(key)
    }
    for (const operation of input.plan.operations.filter(candidate => (
      candidate.kind === 'hp' && candidate.payload.action === 'revive'
    ))) {
      if (operation.aggregate.kind !== 'sheet') throw new Error(`${operation.operationId} revival requires a sheet aggregate.`)
      const revived = sheets.get(sheetKey(operation.aggregate.sheetKind, operation.aggregate.id))
      const expectedHp = asNumber(operation.payload.resultingHp, `${operation.operationId}.resultingHp`)
      const actualHp = operation.aggregate.sheetKind === 'pokemon'
        ? (revived as CharacterSheet | undefined)?.combat?.currentHp
        : (revived as TrainerSheet | undefined)?.currentHp
      if (!revived || actualHp !== expectedHp || capabilityActorIsFainted(revived)) {
        throw new Error(`${operation.operationId} revival conflicts with authoritative cross-capability HP state.`)
      }
    }
  }
  return Object.freeze({
    map,
    sheets,
    groupInventory,
    changedSheetKeys: Object.freeze([...changedSheetKeys].sort()),
    mapChanged,
    groupInventoryChanged,
  })
}

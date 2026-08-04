import { createEmptyEncounterState, parseEncounterState } from '#shared/moveAutomation/encounterState'
import {
  createEmptyAbilitySceneUsageLedger,
  parseAbilitySceneUsageLedger,
} from '#shared/abilityAutomation/resources'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { AnyLiveSheet } from '~/utils/sheetMutations'
import { applyConditionsToSheet } from '~/utils/sheetMutations'
import { normalizeConditionNames } from '~/utils/statusConditions'
import { sheetConditionNames } from '~/utils/sheetConditions'
import { projectAuthoritativeEffectiveAbilities } from '../effectiveAbilities'
import { resolveSheetAndEdgeAbilityInstances } from '../../edgeAutomation/permanentGrants'
import { ABILITY_AUTOMATION_RUNTIME_REGISTRY } from '../registry'
import { planEncounterMoveResourceCosts } from '../../moveAutomation/planMoveResources'

const PERSISTENT_CONDITIONS = new Set(['Burned', 'Frozen', 'Paralysis', 'Poisoned', 'Badly Poisoned'])

export interface Aa081NaturalCureResult {
  readonly map: TabletopMap
  readonly sheet: AnyLiveSheet
  readonly applied: boolean
}

/**
 * Resolve a recall or Take a Breather choice as the affirmative Natural Cure
 * trigger. The accepted command is the durable opt-in; authority still
 * rechecks the effective runtime, Free Action, Scene usage, and conditions.
 */
export const applyAa081NaturalCureTrigger = (input: {
  readonly map: TabletopMap
  readonly placement: SheetPlacement
  readonly sheet: AnyLiveSheet
  readonly operationId: string
  readonly trigger: 'recall' | 'take-a-breather'
}): Aa081NaturalCureResult => {
  const runtime = ABILITY_AUTOMATION_RUNTIME_REGISTRY.resolve('Natural Cure')
  const sceneId = input.map.encounterState?.history.sceneId ?? null
  if (!runtime || !sceneId) return { map: input.map, sheet: input.sheet, applied: false }
  const ability = projectAuthoritativeEffectiveAbilities({
    baseAbilities: resolveSheetAndEdgeAbilityInstances(input.sheet),
    target: {
      placementId: input.placement.id,
      ...(input.placement.sideId ? { sideId: input.placement.sideId } : {}),
      position: input.placement.position,
    },
    effects: input.map.encounterState?.effects ?? [],
    transformationSnapshots: input.map.encounterState?.abilityTransformations,
  }).find(candidate => candidate.effective
    && candidate.canonicalId === 'Natural Cure'
    && (candidate.definitionHash === null || candidate.definitionHash === runtime.definitionHash))
  if (!ability) return { map: input.map, sheet: input.sheet, applied: false }

  const conditions = normalizeConditionNames(sheetConditionNames(input.placement.sheetKind, input.sheet))
  const cured = conditions.filter(condition => !PERSISTENT_CONDITIONS.has(condition))
  if (cured.length === conditions.length) return { map: input.map, sheet: input.sheet, applied: false }

  const encounter = parseEncounterState(input.map.encounterState ?? createEmptyEncounterState())
  const usage = encounter.abilityUsage?.sceneId === sceneId
    ? parseAbilitySceneUsageLedger(encounter.abilityUsage)
    : { ...createEmptyAbilitySceneUsageLedger(), sceneId }
  const existing = usage.entries.find(entry => entry.ownerId === input.placement.id
    && entry.abilityInstanceId === ability.instanceId
    && entry.canonicalId === 'Natural Cure'
    && entry.clauseId === 'base')
  const operationId = `${input.operationId}:natural-cure:${input.trigger}`
  if ((existing?.spent ?? 0) >= 1 && !existing?.operationIds.includes(operationId)) {
    return { map: input.map, sheet: input.sheet, applied: false }
  }

  const action = planEncounterMoveResourceCosts({
    map: input.map,
    placementId: input.placement.id,
    canonicalMoveId: 'ability:Natural Cure',
    moveKey: 'ability:natural-cure',
    range: 'Free Action',
    resolutionId: input.operationId,
    sourceOperationId: `${operationId}:action`,
    movement: null,
    reviewedCosts: [{
      id: 'ability.action.free', phase: 'pay',
      cost: { kind: 'action-resource', resource: 'free', amount: 1 },
    }],
    allowLegacyFallback: false,
    minimumPhaseExclusive: null,
    maximumPhaseInclusive: 'pay',
  })
  const nextEntry = existing?.operationIds.includes(operationId)
    ? existing
    : {
        ownerId: input.placement.id,
        abilityInstanceId: ability.instanceId,
        canonicalId: 'Natural Cure',
        clauseId: 'base',
        limit: 1,
        spent: (existing?.spent ?? 0) + 1,
        operationIds: [...(existing?.operationIds ?? []), operationId],
      }
  const paidEncounter = parseEncounterState({
    ...action.currentEncounterState,
    abilityUsage: {
      schemaVersion: 1,
      sceneId,
      entries: existing
        ? usage.entries.map(entry => entry === existing ? nextEntry : entry)
        : [...usage.entries, nextEntry],
    },
  })
  return {
    map: { ...input.map, encounterState: paidEncounter },
    sheet: applyConditionsToSheet(input.placement.sheetKind, input.sheet, cured),
    applied: true,
  }
}

export const applyAa081NaturalCureForBreather = (
  input: Omit<Parameters<typeof applyAa081NaturalCureTrigger>[0], 'trigger'>,
): Aa081NaturalCureResult => applyAa081NaturalCureTrigger({ ...input, trigger: 'take-a-breather' })

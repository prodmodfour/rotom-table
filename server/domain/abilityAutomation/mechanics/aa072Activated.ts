import { nextRevision, normalizeRevision } from '#shared/sessionRevisions'
import type { AbilityFrequencyDeclaration } from '#shared/abilityAutomation/frequency'
import type { AbilityDeclarationOptionValue } from '#shared/abilityAutomation/declarationIntent'
import type { AbilityMechanicOperation } from '#shared/abilityAutomation/mechanics'
import {
  AA072_GARDENER_METADATA_KEY,
  aa072IsYieldingPlantCell,
  aa072PlantCellId,
  parseAa072GardenerMetadata,
} from '#shared/abilityAutomation/aa072'
import { createEmptyEncounterState, parseEncounterState } from '#shared/moveAutomation/encounterState'
import { createEmptyAbilityDailyUsageLedger, parseAbilityDailyUsageLedger } from '#shared/abilityAutomation/resources'
import type { EncounterEffect } from '#shared/moveAutomation/encounterEffects'
import type { GridAnchor } from '~/types/map'
import type { AnyLiveSheet } from '~/utils/sheetMutations'
import { applyCombatStagesToSheet, applyConditionsToSheet } from '~/utils/sheetMutations'
import { deepCloneJson } from '~/utils/serialization'
import { ptuGridDistanceBetweenFootprints } from '~/utils/ptuGridDistance'
import { computeTickValue } from '~/utils/ptuHp'
import { conditionByName, normalizeConditionName } from '~/utils/statusConditions'
import { sheetConditionNames } from '~/utils/sheetConditions'
import {
  createMoveStateChangePlan,
  RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  type MoveStateChangeInput,
  type MoveStateChangePlan,
} from '../../moveAutomation/plan'
import { planEncounterMoveResourceCosts } from '../../moveAutomation/planMoveResources'
import type { AuthoritativeAbilityContext } from '../context'
import { authoritativeAbilityHealingBlocked } from '../healingPrevention'
import { planAbilityFrequencyPayment } from '../usage'
import { aa084PowerConstructBlocksTemporaryHp } from './aa084StaticIntegration'

const SCENE_FREQUENCY = Object.freeze({
  raw: 'Scene', actionText: '', kind: 'scene', uses: 1, exceptionId: null,
} satisfies AbilityFrequencyDeclaration)
const DAILY_X3_FREQUENCY = Object.freeze({
  raw: 'Daily x3', actionText: '', kind: 'daily', uses: 3, exceptionId: null,
} satisfies AbilityFrequencyDeclaration)

export class Aa072ActivatedExecutionError extends Error {
  constructor(detail: string) { super(detail); this.name = 'Aa072ActivatedExecutionError' }
}
const fail = (detail: string): never => { throw new Aa072ActivatedExecutionError(detail) }

const selectedValues = (
  choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[],
  declarationId: string,
): readonly AbilityDeclarationOptionValue[] => choices.find(choice => choice.declarationId === declarationId)
  ?.options.map(option => option.value) ?? []

const effectiveInstanceId = (context: AuthoritativeAbilityContext, canonicalId: string): string => (
  context.actor.effectiveAbilities.find(ability => ability.effective && ability.canonicalId === canonicalId)?.instanceId
  ?? fail(`${canonicalId} effective instance disappeared.`)
)

const paySceneAction = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly canonicalId: string
  readonly resource: 'standard' | 'swift'
}) => {
  const action = planEncounterMoveResourceCosts({
    map: input.context.map,
    placementId: input.context.actor.placement.id,
    canonicalMoveId: `ability:${input.canonicalId}`,
    moveKey: `ability:${input.canonicalId.toLowerCase().replaceAll(' ', '-')}`,
    range: `${input.resource} action`,
    resolutionId: input.context.resolutionId,
    sourceOperationId: `${input.operationId}:action`,
    movement: null,
    reviewedCosts: [{
      id: `ability.action.${input.resource}`, phase: 'pay',
      cost: { kind: 'action-resource', resource: input.resource, amount: 1 },
    }],
    allowLegacyFallback: false,
    minimumPhaseExclusive: null,
    maximumPhaseInclusive: 'pay',
  })
  const context: AuthoritativeAbilityContext = {
    ...input.context,
    map: { ...input.context.map, encounterState: action.currentEncounterState },
  }
  const frequency = planAbilityFrequencyPayment({
    context,
    frequency: SCENE_FREQUENCY,
    abilityInstanceId: effectiveInstanceId(context, input.canonicalId),
    clauseId: 'base',
    operationId: `${input.operationId}:frequency`,
    sceneId: context.map.encounterState?.history.sceneId ?? undefined,
  })
  const change = frequency.plan.changes.find(candidate => candidate.kind === 'encounter-state')
  return parseEncounterState(change?.kind === 'encounter-state' ? change.current : action.currentEncounterState)
}

const encounterChange = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly reasonCode: string
  readonly current: unknown
}): MoveStateChangeInput => ({
  kind: 'encounter-state',
  scope: { kind: 'encounter', mapSlug: input.context.map.slug },
  expectedRevision: normalizeRevision(input.context.map.revision),
  sourceOperationId: input.operationId,
  reasonCode: input.reasonCode,
  previous: parseEncounterState(input.context.map.encounterState ?? createEmptyEncounterState()),
  current: parseEncounterState(input.current),
  compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
})

const gardener = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[]
}): Aa072ActivatedExecution => {
  const selected = selectedValues(input.choices, 'cultivate.plant')[0]
  const cell = selected?.kind === 'cell' ? selected.cell : fail('Gardener requires one issued yielding plant cell.')
  if (!aa072IsYieldingPlantCell(input.context.map, cell)) fail('Gardener target is no longer a yielding plant.')
  const dayLedger = parseAbilityDailyUsageLedger(
    input.context.actor.sheet.sheet.abilityUsage ?? createEmptyAbilityDailyUsageLedger(),
  )
  const dayKey = dayLedger.dayKey ?? 'campaign-day:initial'
  const metadata = input.context.map.metadata ?? {}
  const gardenerState = parseAa072GardenerMetadata(metadata[AA072_GARDENER_METADATA_KEY])
  const plantId = aa072PlantCellId(cell)
  const plant = gardenerState.plants[plantId] ?? { soilQuality: 0, lastAppliedDayKey: null }
  if (plant.lastAppliedDayKey === dayKey) fail('Gardener may target this yielding plant only once per campaign day.')
  if (plant.soilQuality >= 1_000) fail('Gardener soil quality reached its authoritative bound.')
  const frequency = planAbilityFrequencyPayment({
    context: input.context,
    frequency: DAILY_X3_FREQUENCY,
    abilityInstanceId: effectiveInstanceId(input.context, 'Gardener'),
    clauseId: 'base',
    operationId: `${input.operationId}:frequency`,
    dayKey,
  })
  const payment = frequency.plan.changes.find(change => change.kind === 'sheet-state')
    ?? fail('Gardener did not produce its Daily payment.')
  const currentMetadata = deepCloneJson({
    ...metadata,
    [AA072_GARDENER_METADATA_KEY]: {
      schemaVersion: 1,
      plants: {
        ...gardenerState.plants,
        [plantId]: { soilQuality: plant.soilQuality + 1, lastAppliedDayKey: dayKey },
      },
    },
  })
  return Object.freeze({
    plan: createMoveStateChangePlan([
      payment,
      {
        kind: 'map-metadata',
        scope: { kind: 'map', mapSlug: input.context.map.slug },
        expectedRevision: normalizeRevision(input.context.map.revision),
        sourceOperationId: `${input.operationId}:soil-quality`,
        reasonCode: 'ability.aa072.gardener.soil-quality-raised',
        previous: deepCloneJson(input.context.map.metadata),
        current: currentMetadata,
        compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
      },
    ]),
    presentationKey: 'ability.aa072.gardener.applied',
  })
}

const isVolatile = (condition: string): boolean => {
  const canonical = normalizeConditionName(condition) ?? condition
  return conditionByName.get(canonical)?.category === 'Volatile Affliction'
}
const isVolatileConditionEffect = (effect: EncounterEffect): boolean => (
  effect.kind === 'condition'
  && effect.payload.action === 'apply'
  && effect.payload.conditionId !== null
  && isVolatile(effect.payload.conditionId)
)

const gentleVibe = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
}): Aa072ActivatedExecution => {
  const paid = paySceneAction({ ...input, canonicalId: 'Gentle Vibe', resource: 'standard' })
  const affected = input.context.queries.placements.all().filter((placement) => {
    const token = input.context.queries.tokens.get(placement.id)
    return token && ptuGridDistanceBetweenFootprints(input.context.actor.token, token) <= 2
  }).sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
  const affectedIds = new Set(affected.map(placement => placement.id))
  const changes: MoveStateChangeInput[] = []
  for (const placement of affected) {
    const token = input.context.queries.tokens.get(placement.id)
    const resolved = input.context.queries.sheets.forPlacement(placement)
    if (!token || !resolved) continue
    const previous = deepCloneJson(resolved.sheet) as AnyLiveSheet
    let current = applyCombatStagesToSheet(resolved.kind, previous, {
      atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0,
    })
    current = applyConditionsToSheet(
      resolved.kind,
      current,
      sheetConditionNames(resolved.kind, resolved.sheet).filter(condition => !isVolatile(condition)),
    )
    if (JSON.stringify(previous) === JSON.stringify(current)) continue
    current.revision = nextRevision(resolved.revision)
    changes.push({
      kind: 'sheet-state',
      scope: { kind: 'sheet', sheetKind: resolved.kind, sheetSlug: resolved.slug },
      expectedRevision: resolved.revision,
      sourceOperationId: `${input.operationId}:${placement.id}`,
      reasonCode: 'ability.aa072.gentle-vibe.reset-and-cure',
      previous,
      current,
      changedFields: ['combatStages', 'conditions'],
      compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
    })
  }
  const effects = paid.effects.flatMap((effect): EncounterEffect[] => {
    if (!isVolatileConditionEffect(effect)) return [effect]
    const placementIds = effect.affected.placementIds.filter(id => !affectedIds.has(id))
    return placementIds.length === 0 && effect.affected.sideIds.length === 0 && effect.affected.cells.length === 0
      ? []
      : [{ ...effect, affected: { ...effect.affected, placementIds } }]
  })
  changes.unshift(encounterChange({
    ...input,
    reasonCode: 'ability.aa072.gentle-vibe.resources-and-cure',
    current: { ...paid, effects },
  }))
  return Object.freeze({
    plan: createMoveStateChangePlan(changes),
    presentationKey: 'ability.aa072.gentle-vibe.applied',
  })
}

const grassPelt = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
}): Aa072ActivatedExecution => {
  const paid = paySceneAction({ ...input, canonicalId: 'Grass Pelt', resource: 'swift' })
  const activeScene = input.context.map.activeScene ?? fail('Grass Pelt requires an active Scene.')
  const previous = input.context.map.temporaryHitPoints
  const base = previous
    && previous.scene.name === activeScene.name
    && previous.scene.startedAt === activeScene.startedAt
    ? previous
    : { scene: { ...activeScene }, byPlacementId: {} }
  const tick = computeTickValue(input.context.actor.token.fullMaxHp ?? input.context.actor.token.maxHp)
  const ownerId = input.context.actor.placement.id
  const currentTemporaryHp = base.byPlacementId[ownerId] ?? 0
  const nextTemporaryHp = authoritativeAbilityHealingBlocked({
    map: input.context.map,
    placementId: ownerId,
  }) || aa084PowerConstructBlocksTemporaryHp({
    context: input.context,
    placementId: ownerId,
  })
    ? currentTemporaryHp
    : Math.max(currentTemporaryHp, tick * 2)
  const changes: MoveStateChangeInput[] = [encounterChange({
    ...input,
    reasonCode: 'ability.aa072.grass-pelt.resources',
    current: paid,
  })]
  if (nextTemporaryHp !== currentTemporaryHp) changes.push({
    kind: 'map-temporary-hit-points',
    scope: { kind: 'map', mapSlug: input.context.map.slug },
    expectedRevision: normalizeRevision(input.context.map.revision),
    sourceOperationId: `${input.operationId}:temporary-hp`,
    reasonCode: 'ability.aa072.grass-pelt.temporary-hp',
    previous: deepCloneJson(previous),
    current: {
      scene: { ...base.scene },
      byPlacementId: { ...base.byPlacementId, [ownerId]: nextTemporaryHp },
    },
    compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  })
  return Object.freeze({
    plan: createMoveStateChangePlan(changes),
    presentationKey: 'ability.aa072.grass-pelt.applied',
  })
}

export interface Aa072ActivatedExecution {
  readonly plan: MoveStateChangePlan
  readonly presentationKey: string
}

export const executeAa072ActivatedMechanic = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operation: AbilityMechanicOperation
  readonly operationId: string
  readonly choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[]
}): Aa072ActivatedExecution | null => {
  if (input.operation.mechanicId === 'aa072.gardener') return gardener(input)
  if (input.operation.mechanicId === 'aa072.gentle-vibe') return gentleVibe(input)
  if (input.operation.mechanicId === 'aa072.grass-pelt') return grassPelt(input)
  return null
}

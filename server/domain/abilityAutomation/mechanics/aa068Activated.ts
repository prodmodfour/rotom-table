import { nextRevision, normalizeRevision } from '#shared/sessionRevisions'
import type { AbilityFrequencyDeclaration } from '#shared/abilityAutomation/frequency'
import type { AbilityMechanicOperation } from '#shared/abilityAutomation/mechanics'
import {
  createEmptyEncounterState,
  parseEncounterState,
} from '#shared/moveAutomation/encounterState'
import type { MapFieldEffects } from '~/types/map'
import { applyHpToSheet, type AnyLiveSheet } from '~/utils/sheetMutations'
import { authoritativeAbilityHealingBlocked } from '../healingPrevention'
import { normalizeConditionNames } from '~/utils/statusConditions'
import { ptuGridDistanceBetweenFootprints } from '~/utils/ptuGridDistance'
import { computeTickValue, normalizeInjuryCount } from '~/utils/ptuHp'
import { computePtuInjuryAutomation } from '~/utils/ptuInjuries'
import { deepCloneJson } from '~/utils/serialization'
import { applyMapGlobalField } from '../../moveAutomation/fieldMapState'
import {
  createMoveStateChangePlan,
  RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  type MoveStateChangeInput,
  type MoveStateChangePlan,
} from '../../moveAutomation/plan'
import { planEncounterMoveResourceCosts } from '../../moveAutomation/planMoveResources'
import type { AuthoritativeAbilityContext } from '../context'
import { planAbilityFrequencyPayment } from '../usage'

const SCENE_X3_FREQUENCY: AbilityFrequencyDeclaration = Object.freeze({
  raw: 'Scene x3', actionText: '', kind: 'scene', uses: 3, exceptionId: null,
})

export class Aa068ActivatedExecutionError extends Error {
  constructor(detail: string) { super(detail); this.name = 'Aa068ActivatedExecutionError' }
}
const fail = (detail: string): never => { throw new Aa068ActivatedExecutionError(detail) }

const sameJson = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right)

const mapWithEncounter = (
  context: AuthoritativeAbilityContext,
  encounter: unknown,
): AuthoritativeAbilityContext => ({
  ...context,
  map: { ...context.map, encounterState: parseEncounterState(encounter) },
})

const paidSceneX3Encounter = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly abilityInstanceId: string
  readonly canonicalId: string
}) => {
  const action = planEncounterMoveResourceCosts({
    map: input.context.map,
    placementId: input.context.actor.placement.id,
    canonicalMoveId: `ability:${input.canonicalId}`,
    moveKey: `ability:${input.canonicalId.toLowerCase().replaceAll(' ', '-')}`,
    range: 'Swift Action',
    resolutionId: input.context.resolutionId,
    sourceOperationId: `${input.operationId}:action`,
    movement: null,
    reviewedCosts: [{
      id: 'ability.action.swift', phase: 'pay',
      cost: { kind: 'action-resource', resource: 'swift', amount: 1 },
    }],
    allowLegacyFallback: false,
    minimumPhaseExclusive: null,
    maximumPhaseInclusive: 'pay',
  })
  const actionContext = mapWithEncounter(input.context, action.currentEncounterState)
  const frequency = planAbilityFrequencyPayment({
    context: actionContext,
    frequency: SCENE_X3_FREQUENCY,
    abilityInstanceId: input.abilityInstanceId,
    clauseId: 'base',
    operationId: `${input.operationId}:frequency`,
    sceneId: actionContext.map.encounterState?.history.sceneId ?? undefined,
  })
  const change = frequency.plan.changes.find(candidate => candidate.kind === 'encounter-state')
  return parseEncounterState(change?.kind === 'encounter-state'
    ? change.current
    : action.currentEncounterState)
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

const dreamspinnerExecution = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly abilityInstanceId: string
}): Aa068ActivatedExecution => {
  const paidEncounter = paidSceneX3Encounter({ ...input, canonicalId: 'Dreamspinner' })
  const changes: MoveStateChangeInput[] = [encounterChange({
    context: input.context,
    operationId: input.operationId,
    reasonCode: 'ability.aa068.dreamspinner.paid',
    current: paidEncounter,
  })]

  const actorId = input.context.actor.placement.id
  const changedSheets = new Set<string>()
  for (const placement of input.context.queries.placements.all()) {
    if (input.context.queries.relationships.relation(actorId, placement.id) !== 'enemy') continue
    const token = input.context.queries.tokens.get(placement.id)
    if (!token || ptuGridDistanceBetweenFootprints(input.context.actor.token, token) > 3) continue
    if (!normalizeConditionNames(token.conditions).includes('Sleep')) continue
    const resolved = input.context.queries.sheets.forPlacement(placement)
    if (!resolved) continue
    const sheetKey = `${resolved.kind}:${resolved.slug}`
    if (changedSheets.has(sheetKey)) fail('Dreamspinner cannot mutate one backing sheet through multiple placements.')
    changedSheets.add(sheetKey)
    const previous = deepCloneJson(resolved.sheet) as AnyLiveSheet
    const tick = computeTickValue(token.fullMaxHp ?? token.maxHp)
    const currentHp = Math.max(0, token.currentHp - tick)
    if (currentHp === token.currentHp) continue
    const injury = computePtuInjuryAutomation({
      beforeHp: token.currentHp,
      afterHp: currentHp,
      fullMaxHp: token.fullMaxHp ?? token.maxHp,
      currentInjuries: normalizeInjuryCount(token.injuries),
      source: 'hp-loss',
    })
    const current = applyHpToSheet(resolved.kind, previous, currentHp, injury.injuries)
    current.revision = nextRevision(resolved.revision)
    changes.push({
      kind: 'sheet-state',
      scope: { kind: 'sheet', sheetKind: resolved.kind, sheetSlug: resolved.slug },
      expectedRevision: resolved.revision,
      sourceOperationId: `${input.operationId}:foe-hp:${placement.id}`,
      reasonCode: 'ability.aa068.dreamspinner.sleeping-foe-tick',
      previous,
      current,
      changedFields: ['hp'],
      compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
    })
  }

  if (!authoritativeAbilityHealingBlocked({ map: input.context.map, placementId: actorId })) {
    const activeScene = input.context.map.activeScene
      ?? fail('Dreamspinner requires an active Scene for Temporary Hit Points.')
    const previous = input.context.map.temporaryHitPoints
    const currentBase = previous
      && previous.scene.name === activeScene.name
      && previous.scene.startedAt === activeScene.startedAt
      ? previous
      : { scene: { ...activeScene }, byPlacementId: {} }
    const tick = computeTickValue(
      input.context.actor.token.fullMaxHp ?? input.context.actor.token.maxHp,
    )
    changes.push({
      kind: 'map-temporary-hit-points',
      scope: { kind: 'map', mapSlug: input.context.map.slug },
      expectedRevision: normalizeRevision(input.context.map.revision),
      sourceOperationId: `${input.operationId}:temporary-hp`,
      reasonCode: 'ability.aa068.dreamspinner.temporary-hp',
      previous: deepCloneJson(previous),
      current: {
        scene: { ...currentBase.scene },
        byPlacementId: {
          ...currentBase.byPlacementId,
          [actorId]: (currentBase.byPlacementId[actorId] ?? 0) + tick,
        },
      },
      compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
    })
  }

  return Object.freeze({
    plan: createMoveStateChangePlan(changes),
    presentationKey: 'ability.aa068.dreamspinner.applied',
  })
}

const fieldExecution = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly abilityInstanceId: string
  readonly canonicalId: 'Drizzle' | 'Drought' | 'Electric Surge'
  readonly kind: 'weather' | 'terrain'
  readonly fieldId: 'rainy' | 'sunny' | 'electric'
}): Aa068ActivatedExecution => {
  const paidEncounter = paidSceneX3Encounter(input)
  const reduced = applyMapGlobalField({
    map: { ...input.context.map, encounterState: paidEncounter },
    kind: input.kind,
    fieldId: input.fieldId,
    source: {
      kind: 'operation',
      operationId: input.operationId,
      moveId: `ability.${input.canonicalId.toLowerCase().replaceAll(' ', '-')}`,
      placementId: input.context.actor.placement.id,
    },
    sideId: input.context.actor.placement.sideId ?? null,
    duration: { kind: 'rounds', boundary: 'end', remaining: 1 },
    replacementGroup: input.kind === 'weather'
      ? 'field.weather'
      : `field.terrain.${input.fieldId}`,
    replacementScope: input.kind === 'weather' ? 'category' : 'kind',
    sourceLabel: input.canonicalId,
  })
  const changes: MoveStateChangeInput[] = [encounterChange({
    context: input.context,
    operationId: input.operationId,
    reasonCode: `ability.aa068.${input.canonicalId.toLowerCase().replaceAll(' ', '-')}.field-applied`,
    current: reduced.map.encounterState,
  })]
  const previousFields: MapFieldEffects = input.context.map.fieldEffects
    ?? { weather: [], terrains: [], rooms: [] }
  const currentFields: MapFieldEffects = reduced.map.fieldEffects
    ?? { weather: [], terrains: [], rooms: [] }
  if (!sameJson(previousFields, currentFields)) {
    changes.push({
      kind: 'map-field-effects',
      scope: { kind: 'map', mapSlug: input.context.map.slug },
      expectedRevision: normalizeRevision(input.context.map.revision),
      sourceOperationId: `${input.operationId}:field-projection`,
      reasonCode: `ability.aa068.${input.canonicalId.toLowerCase().replaceAll(' ', '-')}.field-projection`,
      previous: deepCloneJson(previousFields),
      current: deepCloneJson(currentFields),
      compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
    })
  }
  return Object.freeze({
    plan: createMoveStateChangePlan(changes),
    presentationKey: `ability.aa068.${input.canonicalId.toLowerCase().replaceAll(' ', '-')}.applied`,
  })
}

export interface Aa068ActivatedExecution {
  readonly plan: MoveStateChangePlan
  readonly presentationKey: string
}

export const executeAa068ActivatedMechanic = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operation: AbilityMechanicOperation
  readonly operationId: string
  readonly abilityInstanceId: string
}): Aa068ActivatedExecution | null => {
  if (input.context.runtime.canonicalId === 'Dreamspinner'
    && input.operation.mechanicId === 'aa068.dreamspinner') {
    return dreamspinnerExecution(input)
  }
  if (input.context.runtime.canonicalId === 'Drizzle'
    && input.operation.mechanicId === 'aa068.drizzle') {
    return fieldExecution({ ...input, canonicalId: 'Drizzle', kind: 'weather', fieldId: 'rainy' })
  }
  if (input.context.runtime.canonicalId === 'Drought'
    && input.operation.mechanicId === 'aa068.drought') {
    return fieldExecution({ ...input, canonicalId: 'Drought', kind: 'weather', fieldId: 'sunny' })
  }
  if (input.context.runtime.canonicalId === 'Electric Surge'
    && input.operation.mechanicId === 'aa068.electric-surge') {
    return fieldExecution({ ...input, canonicalId: 'Electric Surge', kind: 'terrain', fieldId: 'electric' })
  }
  return null
}

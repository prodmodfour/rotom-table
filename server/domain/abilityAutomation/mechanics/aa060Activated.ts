import { createHash } from 'node:crypto'
import type { AbilityFrequencyDeclaration } from '#shared/abilityAutomation/frequency'
import type { AbilityDeclarationOptionValue } from '#shared/abilityAutomation/declarationIntent'
import { createEmptyEncounterState, parseEncounterState } from '#shared/moveAutomation/encounterState'
import { normalizeRevision } from '#shared/sessionRevisions'
import { stableJsonStringify } from '#shared/automation/stableJson'
import type { GridAnchor, TabletopMap } from '~/types/map'
import { ptuGridDistanceBetweenFootprints } from '~/utils/ptuGridDistance'
import { sameJsonValue } from '~/utils/serialization'
import { moveUsageKey } from '~/utils/moveUsage'
import {
  RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  createMoveStateChangePlan,
  type MoveStateChangePlan,
} from '../../moveAutomation/plan'
import { planEncounterMoveResourceCosts } from '../../moveAutomation/planMoveResources'
import type { AuthoritativeAbilityContext } from '../context'
import { planAbilityFrequencyPayment } from '../usage'
import { planAbilityOwnedStateCommand } from '../ownedState'
import { planAbilityEntityCommand, type AbilityEntityCommand } from '../entities'
import type { AbilityMechanicOperation } from '#shared/abilityAutomation/mechanics'
import { resolveAa060AnchorShift, resolveAa060Anticipation, type Aa060AnticipationResult } from './aa060'
import { aa060MoveMarkId } from './aa060MoveIntegration'

const AA060_FREQUENCIES: Readonly<Record<string, AbilityFrequencyDeclaration>> = Object.freeze({
  Accelerate: Object.freeze({ raw: 'Scene x2 – Free Action', actionText: 'Free Action', kind: 'scene', uses: 2, exceptionId: null }),
  'Air Lock': Object.freeze({ raw: 'Scene – Free Action', actionText: 'Free Action', kind: 'scene', uses: 1, exceptionId: null }),
  Aerilate: Object.freeze({ raw: 'At-Will – Free Action', actionText: 'Free Action', kind: 'at-will', uses: null, exceptionId: null }),
  Ambush: Object.freeze({ raw: 'Scene – Free Action', actionText: 'Free Action', kind: 'scene', uses: 1, exceptionId: null }),
  Anchored: Object.freeze({ raw: 'Static', actionText: null, kind: 'static', uses: null, exceptionId: null }),
  Anticipation: Object.freeze({ raw: 'At-Will – Swift Action', actionText: 'Swift Action', kind: 'at-will', uses: null, exceptionId: null }),
})
const AA060_ACTION_COSTS = Object.freeze({
  Accelerate: 'free', Aerilate: 'free', 'Air Lock': 'free', Ambush: 'free', Anchored: 'swift', Anticipation: 'swift',
} as const)
const slugHash = (value: unknown): string => createHash('sha256').update(stableJsonStringify(value)).digest('hex').slice(0, 24)
const value = (choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[], id: string): AbilityDeclarationOptionValue | null => (
  choices.find(choice => choice.declarationId === id)?.options[0]?.value ?? null
)
type RequiredChoiceValue<Kind extends 'move' | 'cell' | 'token'> =
  Kind extends 'move' ? { readonly kind: 'move'; readonly canonicalMoveId: string }
    : Kind extends 'cell' ? { readonly kind: 'cell'; readonly cellId: string; readonly cell: { readonly x: number; readonly y: number; readonly z: number } }
      : { readonly kind: 'token'; readonly placementId: string }
const requiredValue = <Kind extends 'move' | 'cell' | 'token'>(
  choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[],
  id: string,
  kind: Kind,
): RequiredChoiceValue<Kind> => {
  const selected = value(choices, id)
  if (!selected || selected.kind !== kind) fail('invalid-choice', `${id} requires one issued ${kind} choice.`)
  return selected as RequiredChoiceValue<Kind>
}
const withMap = (context: AuthoritativeAbilityContext, map: TabletopMap): AuthoritativeAbilityContext => ({ ...context, map })
const mapWithEncounter = (map: TabletopMap, encounter: unknown): TabletopMap => ({ ...map, encounterState: parseEncounterState(encounter) })
const planEncounterCurrent = (plan: MoveStateChangePlan, fallback: unknown): ReturnType<typeof parseEncounterState> => {
  const change = plan.changes.find(entry => entry.kind === 'encounter-state')
  return parseEncounterState(change?.kind === 'encounter-state' ? change.current : fallback)
}
const spendAction = (
  context: AuthoritativeAbilityContext,
  operationId: string,
  action: 'free' | 'swift',
): TabletopMap => {
  const encounter = parseEncounterState(context.map.encounterState ?? createEmptyEncounterState())
  const observation = planEncounterMoveResourceCosts({
    map: context.map,
    placementId: context.actor.placement.id,
    canonicalMoveId: `ability:${context.runtime.canonicalId}`,
    moveKey: `ability:${context.runtime.canonicalId.toLowerCase().replaceAll(' ', '-')}`,
    range: `${action[0]!.toUpperCase()}${action.slice(1)} Action`,
    resolutionId: context.resolutionId,
    sourceOperationId: operationId,
    movement: null,
    reviewedCosts: [{ id: `ability.action.${action}`, phase: 'pay', cost: { kind: 'action-resource', resource: action, amount: 1 } }],
    allowLegacyFallback: false,
    minimumPhaseExclusive: null,
    maximumPhaseInclusive: 'pay',
  })
  return observation.changed ? observation.nextMap : mapWithEncounter(context.map, encounter)
}
const spendFrequency = (
  context: AuthoritativeAbilityContext,
  operationId: string,
  abilityInstanceId: string,
): TabletopMap => {
  const frequency = AA060_FREQUENCIES[context.runtime.canonicalId]
  if (!frequency || frequency.kind === 'static') return context.map
  const sceneId = context.map.encounterState?.history.sceneId ?? undefined
  const payment = planAbilityFrequencyPayment({
    context, frequency, abilityInstanceId, clauseId: 'base', operationId,
    ...(frequency.kind === 'scene' ? { sceneId } : {}),
  })
  return mapWithEncounter(context.map, planEncounterCurrent(payment.plan, context.map.encounterState))
}
const createMark = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly abilityInstanceId: string
  readonly markId: string
  readonly stateSuffix: string
  readonly targets?: readonly string[]
  readonly lifecycle?: 'turn' | 'scene' | 'source-ability'
}): TabletopMap => {
  const planned = planAbilityOwnedStateCommand({
    context: input.context,
    command: {
      operationId: input.operationId,
      kind: 'create', stateId: `${input.abilityInstanceId}:${input.stateSuffix}`,
      expectedVersion: null,
      entry: {
        stateId: `${input.abilityInstanceId}:${input.stateSuffix}`,
        ownerPlacementId: input.context.actor.placement.id,
        sourceAbilityInstanceId: input.abilityInstanceId,
        canonicalId: input.context.runtime.canonicalId,
        targetPlacementIds: input.targets ?? [],
        lifecycle: { kind: input.lifecycle ?? 'scene', targetPolicy: null },
        payload: { kind: 'mark', markId: input.markId },
      },
    },
  })
  return mapWithEncounter(input.context.map, planEncounterCurrent(planned.plan, input.context.map.encounterState))
}

export interface Aa060ActivatedExecution {
  readonly plan: MoveStateChangePlan
  readonly presentationKey: string
  readonly anticipation: Aa060AnticipationResult | null
}
export class Aa060ActivatedExecutionError extends Error {
  constructor(readonly code: 'unsupported' | 'invalid-choice' | 'anchor-missing' | 'nested-move-required' | 'scene-unavailable', detail: string) {
    super(detail)
    this.name = 'Aa060ActivatedExecutionError'
  }
}
const fail = (code: Aa060ActivatedExecutionError['code'], detail: string): never => { throw new Aa060ActivatedExecutionError(code, detail) }

/** Execute one selected AA-060 activated operation into a single encounter CAS replacement. */
export const executeAa060ActivatedMechanic = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operation: AbilityMechanicOperation
  readonly operationId: string
  readonly abilityInstanceId: string
  readonly choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[]
  readonly targetMoveFacts?: readonly { readonly moveId: string; readonly type: string; readonly damageClass: 'physical' | 'special' | 'status' }[]
}): Aa060ActivatedExecution => {
  const canonicalId = input.context.runtime.canonicalId
  if (!input.operation.mechanicId.startsWith('aa060.')) fail('unsupported', 'Mechanic is outside AA-060.')
  if (!(canonicalId in AA060_ACTION_COSTS)) fail('unsupported', `${canonicalId} has no AA-060 activated adapter.`)
  const previous = parseEncounterState(input.context.map.encounterState ?? createEmptyEncounterState())
  if (canonicalId === 'Anticipation') {
    const selected = requiredValue(input.choices, 'activate.target', 'token')
    const receiptId = `${input.abilityInstanceId}:anticipation:${selected.placementId}`
    if ((previous.abilityOwnedState?.entries ?? []).some(entry => entry.stateId === receiptId)) {
      fail('invalid-choice', 'Anticipation target was already queried this encounter.')
    }
  }
  let map = input.context.map
  try {
    const action = canonicalId === 'Air Lock' && input.context.request.modeId === 'sustain'
      ? 'swift'
      : AA060_ACTION_COSTS[canonicalId as keyof typeof AA060_ACTION_COSTS]
    map = spendAction(withMap(input.context, map), `${input.operationId}:action`, action)
    if (!(canonicalId === 'Air Lock' && input.context.request.modeId === 'sustain')) {
      map = spendFrequency(withMap(input.context, map), `${input.operationId}:frequency`, input.abilityInstanceId)
    }
  }
  catch (error) {
    if (String(error).includes('Scene payment requires')) fail('scene-unavailable', 'AA-060 Scene use requires an active encounter scene.')
    throw error
  }
  let presentationKey = `ability.${input.operation.mechanicId}.accepted`
  let anticipation: Aa060AnticipationResult | null = null
  if (canonicalId === 'Accelerate' || canonicalId === 'Aerilate' || canonicalId === 'Ambush') {
    const selected = requiredValue(input.choices, 'activate.move', 'move')
    const selectedMove = input.context.actor.sheet.sheet.movelist?.find(move => move.name === selected.canonicalMoveId)
    const damaging = selectedMove?.category === 'Physical' || selectedMove?.category === 'Special'
    if (!selectedMove || !damaging) fail('invalid-choice', `${canonicalId} requires a damaging move.`)
    const eligibleMove = selectedMove!
    if (canonicalId === 'Accelerate') {
      const moveType = eligibleMove.type?.trim().toLowerCase() ?? ''
      const hasStab = input.context.actor.token.defenderTypes.some(type => type.trim().toLowerCase() === moveType)
      if (!hasStab) fail('invalid-choice', 'Accelerate requires a damaging move that receives STAB.')
    }
    if (canonicalId === 'Aerilate' && eligibleMove.type?.trim().toLowerCase() !== 'normal') {
      fail('invalid-choice', 'Aerilate requires a Normal-Type damaging move.')
    }
    if (canonicalId === 'Ambush' && (eligibleMove.db === undefined || eligibleMove.db > 6)) {
      fail('invalid-choice', 'Ambush requires a move with Damage Base 6 or lower before modifiers.')
    }
    const pendingMarkPrefix = canonicalId === 'Accelerate'
      ? 'aa060.accelerate.next-move:'
      : canonicalId === 'Aerilate'
        ? 'aa060.aerilate.next-move:'
        : 'aa060.ambush.next-move:'
    if ((map.encounterState?.abilityOwnedState?.entries ?? []).some(entry => (
      entry.sourceAbilityInstanceId === input.abilityInstanceId
      && entry.payload.kind === 'mark'
      && entry.payload.markId.startsWith(pendingMarkPrefix)
    ))) fail('invalid-choice', `${canonicalId} already has an unconsumed move declaration.`)
    map = createMark({
      context: withMap(input.context, map), operationId: `${input.operationId}:mark`, abilityInstanceId: input.abilityInstanceId,
      markId: aa060MoveMarkId(canonicalId, selected.canonicalMoveId),
      stateSuffix: `${canonicalId.toLowerCase()}:${slugHash(input.operationId)}`,
      lifecycle: 'turn',
    })
  }
  else if (canonicalId === 'Air Lock') {
    const round = input.context.map.initiative?.round ?? 0
    if (input.context.request.modeId === 'sustain') {
      const previousRoundMark = (map.encounterState?.abilityOwnedState?.entries ?? []).some(entry => (
        entry.sourceAbilityInstanceId === input.abilityInstanceId
        && entry.payload.kind === 'mark'
        && entry.payload.markId === `aa060.air-lock.active:${round - 1}`
      ))
      if (round < 2 || !previousRoundMark) fail('invalid-choice', 'Air Lock can be sustained only from the immediately previous round.')
    }
    map = createMark({
      context: withMap(input.context, map), operationId: `${input.operationId}:mode`, abilityInstanceId: input.abilityInstanceId,
      markId: `aa060.air-lock.active:${round}`, stateSuffix: `air-lock:${round}`, lifecycle: 'source-ability',
    })
  }
  else if (canonicalId === 'Anchored') {
    const selectedCell = requiredValue(input.choices, 'shift-anchor.cell', 'cell')
    const selectedMove = value(input.choices, 'shift-anchor.move')
    const selectedMoveSheet = selectedMove?.kind === 'move'
      ? input.context.actor.sheet.sheet.movelist?.find(move => move.name === selectedMove.canonicalMoveId)
      : null
    const selectedMoveDamaging = selectedMoveSheet?.category === 'Physical' || selectedMoveSheet?.category === 'Special'
    if (selectedMove?.kind === 'move' && !selectedMoveDamaging) {
      fail('invalid-choice', 'Anchored optional attack requires a damaging move.')
    }
    if (selectedMove?.kind === 'move' && selectedMoveSheet) {
      planEncounterMoveResourceCosts({
        map,
        placementId: input.context.actor.placement.id,
        canonicalMoveId: selectedMove.canonicalMoveId,
        moveKey: moveUsageKey(selectedMove.canonicalMoveId) ?? `anchored-${slugHash(selectedMove.canonicalMoveId)}`,
        range: selectedMoveSheet.range ?? 'Standard Action',
        resolutionId: input.context.resolutionId,
        sourceOperationId: `${input.operationId}:attack-action-check`,
        movement: null,
        allowLegacyFallback: true,
        minimumPhaseExclusive: null,
        maximumPhaseInclusive: 'pay',
      })
    }
    const entityId = `${input.abilityInstanceId}:anchor`
    let entity = map.encounterState?.abilityEntities?.entries.find(entry => entry.entityId === entityId)
    if (!entity) {
      const setup = planAa060AnchoredSetup({
        context: withMap(input.context, map),
        abilityInstanceId: input.abilityInstanceId,
        operationId: `${input.operationId}:setup`,
      })
      map = mapWithEncounter(map, planEncounterCurrent(setup, map.encounterState))
      entity = map.encounterState?.abilityEntities?.entries.find(entry => entry.entityId === entityId)
        ?? fail('anchor-missing', 'Anchored source entity could not be initialized.')
    }
    const shift = resolveAa060AnchorShift({
      sourcePosition: input.context.actor.placement.position,
      destination: selectedCell.cell,
      controllerAuthorized: entity.ownerPlacementId === input.context.actor.placement.id,
      destinationOpen: !input.context.tokens.some(token => ptuGridDistanceBetweenFootprints(
        { position: selectedCell.cell, base: 1, clearance: 1 }, token,
      ) === 0),
      optionalMoveInstanceId: selectedMove?.kind === 'move' ? selectedMove.canonicalMoveId : null,
      damagingMove: selectedMoveDamaging,
      attackActionAvailable: true,
    })
    if (!shift.legal) fail('invalid-choice', `Anchored shift is illegal: ${shift.reasonCode}.`)
    const planned = planAbilityEntityCommand({
      context: withMap(input.context, map),
      command: {
        operationId: `${input.operationId}:entity`, kind: 'move', entityId,
        expectedVersion: entity.version, position: selectedCell.cell,
      },
    })
    map = mapWithEncounter(map, planEncounterCurrent(planned.plan, map.encounterState))
    if (selectedMove?.kind === 'move') {
      const pendingPrefix = 'aa060.anchored.next-move:'
      if ((map.encounterState?.abilityOwnedState?.entries ?? []).some(entry => (
        entry.sourceAbilityInstanceId === input.abilityInstanceId
        && entry.payload.kind === 'mark'
        && entry.payload.markId.startsWith(pendingPrefix)
      ))) fail('invalid-choice', 'Anchored already has an unconsumed immediate attack.')
      map = createMark({
        context: withMap(input.context, map),
        operationId: `${input.operationId}:attack`,
        abilityInstanceId: input.abilityInstanceId,
        markId: aa060MoveMarkId('Anchored', selectedMove.canonicalMoveId),
        stateSuffix: `anchored-attack:${slugHash(input.operationId)}`,
        lifecycle: 'turn',
      })
      presentationKey = 'ability.aa060.anchored.attack-ready'
    }
  }
  else if (canonicalId === 'Anticipation') {
    const selected = requiredValue(input.choices, 'activate.target', 'token')
    const receiptId = `${input.abilityInstanceId}:anticipation:${selected.placementId}`
    const owned = parseEncounterState(map.encounterState ?? createEmptyEncounterState()).abilityOwnedState
    const existingReceiptIds = owned?.entries
      .filter(entry => entry.sourceAbilityInstanceId === input.abilityInstanceId && entry.payload.kind === 'mark' && entry.payload.markId === 'aa060.anticipation.used')
      .map(entry => entry.stateId) ?? []
    anticipation = resolveAa060Anticipation({
      actorTypeIds: input.context.actor.token.defenderTypes, targetPlacementId: selected.placementId,
      targetMoves: input.targetMoveFacts ?? [], existingReceiptIds, receiptId,
    })
    map = createMark({
      context: withMap(input.context, map), operationId: `${input.operationId}:receipt`, abilityInstanceId: input.abilityInstanceId,
      markId: 'aa060.anticipation.used', stateSuffix: `anticipation:${selected.placementId}`,
      targets: [selected.placementId], lifecycle: 'scene',
    })
    presentationKey = anticipation.hasSuperEffectiveMove
      ? 'ability.anticipation.super-effective-present'
      : 'ability.anticipation.super-effective-absent'
  }
  const current = parseEncounterState(map.encounterState ?? createEmptyEncounterState())
  return Object.freeze({
    plan: createMoveStateChangePlan(sameJsonValue(previous, current) ? [] : [{
      kind: 'encounter-state', scope: { kind: 'encounter', mapSlug: input.context.map.slug },
      expectedRevision: normalizeRevision(input.context.map.revision), sourceOperationId: input.operationId,
      reasonCode: `ability.${input.operation.mechanicId}.activated`, previous, current,
      compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
    }]),
    presentationKey,
    anticipation,
  })
}

export const aa060AnchoredEntityCreateCommand = (input: {
  readonly placement: AuthoritativeAbilityContext['actor']['placement']
  readonly abilityInstanceId: string
  readonly operationId: string
}): Extract<AbilityEntityCommand, { readonly kind: 'create' }> => {
  const entityId = `${input.abilityInstanceId}:anchor`
  return {
    operationId: input.operationId, kind: 'create', entityId, expectedVersion: null,
    entity: {
      entityId, kind: 'anchor', labelKey: 'ability.anchored.anchor',
      ownerPlacementId: input.placement.id,
      sourceAbilityInstanceId: input.abilityInstanceId, canonicalId: 'Anchored',
      sourceOperationId: input.operationId,
      controller: { kind: 'source-controller', id: input.placement.id }, sideId: input.placement.sideId ?? null,
      position: input.placement.position, base: 1, clearance: 1,
      occupancy: 'non-blocking', targetability: 'untargetable', movementMode: 'controlled', movementSpeed: 3,
      maximumHp: null, currentHp: null, damageReduction: null,
      duration: { kind: 'source-ability' }, tags: ['aa060.anchored'],
      payload: { kind: 'anchor', anchorKind: 'aa060.anchored', anchoredPlacementIds: [input.placement.id], preventedMovementModes: [] },
    },
  }
}

/** Idempotently initialize the durable sheetless Anchor at the source position. */
export const planAa060AnchoredSetup = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly abilityInstanceId: string
  readonly operationId: string
}): MoveStateChangePlan => {
  const entityId = `${input.abilityInstanceId}:anchor`
  const existing = input.context.abilityEntities.entries.find(entry => entry.entityId === entityId)
  if (existing) return createMoveStateChangePlan([])
  return planAbilityEntityCommand({
    context: input.context,
    command: aa060AnchoredEntityCreateCommand({
      placement: input.context.actor.placement,
      abilityInstanceId: input.abilityInstanceId,
      operationId: input.operationId,
    }),
  }).plan
}

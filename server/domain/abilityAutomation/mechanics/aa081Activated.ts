import { createHash } from 'node:crypto'
import { normalizeRevision } from '#shared/sessionRevisions'
import type { AbilityDeclarationOptionValue } from '#shared/abilityAutomation/declarationIntent'
import type { AbilityFrequencyDeclaration } from '#shared/abilityAutomation/frequency'
import type { AbilityMechanicOperation } from '#shared/abilityAutomation/mechanics'
import {
  createEmptyAbilityTransformationState,
  parseAbilityTransformationState,
} from '#shared/abilityAutomation/transformations'
import { createEmptyEncounterState, parseEncounterState } from '#shared/moveAutomation/encounterState'
import { computeTickValue } from '~/utils/ptuHp'
import { deepCloneJson } from '~/utils/serialization'
import { planEncounterMoveResourceCosts } from '../../moveAutomation/planMoveResources'
import {
  createMoveStateChangePlan,
  RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  type MoveStateChangeInput,
  type MoveStateChangePlan,
} from '../../moveAutomation/plan'
import type { AuthoritativeAbilityContext } from '../context'
import { reduceAbilityTransformationCommand } from '../transformations'
import { planAbilityFrequencyPayment } from '../usage'
import { authoritativeAbilityHealingBlocked } from '../healingPrevention'
import { aa084PowerConstructBlocksTemporaryHp } from './aa084StaticIntegration'

const SCENE_FREQUENCY = Object.freeze({
  raw: 'Scene', actionText: '', kind: 'scene', uses: 1, exceptionId: null,
} satisfies AbilityFrequencyDeclaration)

export interface Aa081ActivatedExecution {
  readonly plan: MoveStateChangePlan
  readonly presentationKey: string
  readonly controllerPresentationValues?: readonly string[]
}
export class Aa081ActivatedExecutionError extends Error {
  constructor(detail: string) { super(detail); this.name = 'Aa081ActivatedExecutionError' }
}
const fail = (detail: string): never => { throw new Aa081ActivatedExecutionError(detail) }
const shortHash = (...values: readonly string[]): string => createHash('sha256')
  .update(values.join('\u0000')).digest('hex').slice(0, 24)

const selectedValue = (
  choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[],
  declarationId: string,
): AbilityDeclarationOptionValue | null => choices.find(choice => choice.declarationId === declarationId)
  ?.options[0]?.value ?? null

const effectiveInstanceId = (context: AuthoritativeAbilityContext, canonicalId: string): string => (
  context.actor.effectiveAbilities.find(ability => ability.effective && ability.canonicalId === canonicalId)?.instanceId
  ?? fail(`${canonicalId} effective instance disappeared.`)
)

const payAction = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly canonicalId: string
  readonly resource: 'free' | 'swift'
}) => planEncounterMoveResourceCosts({
  map: input.context.map,
  placementId: input.context.actor.placement.id,
  canonicalMoveId: `ability:${input.canonicalId}`,
  moveKey: `ability:${input.canonicalId.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
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

const mudShield = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly abilityInstanceId: string
}): Aa081ActivatedExecution => {
  const action = payAction({ ...input, canonicalId: 'Mud Shield', resource: 'swift' })
  const actionContext: AuthoritativeAbilityContext = {
    ...input.context,
    map: { ...input.context.map, encounterState: action.currentEncounterState },
  }
  const frequency = planAbilityFrequencyPayment({
    context: actionContext,
    frequency: SCENE_FREQUENCY,
    abilityInstanceId: input.abilityInstanceId,
    clauseId: 'base',
    operationId: `${input.operationId}:frequency`,
    sceneId: action.currentEncounterState.history.sceneId ?? undefined,
  })
  const encounter = frequency.plan.changes.find(change => change.kind === 'encounter-state')
  const paidEncounter = encounter?.kind === 'encounter-state'
    ? parseEncounterState(encounter.current)
    : action.currentEncounterState
  const activeScene = input.context.map.activeScene
    ?? fail('Mud Shield requires an active authoritative Scene for Temporary Hit Points.')
  const previousTemporaryHp = input.context.map.temporaryHitPoints
  const sceneState = previousTemporaryHp
    && previousTemporaryHp.scene.name === activeScene.name
    && previousTemporaryHp.scene.startedAt === activeScene.startedAt
    ? previousTemporaryHp
    : { scene: { ...activeScene }, byPlacementId: {} }
  const actorId = input.context.actor.placement.id
  const amount = computeTickValue(input.context.actor.token.fullMaxHp ?? input.context.actor.token.maxHp) * 2
  const currentTemporaryHp = sceneState.byPlacementId[actorId] ?? 0
  const nextTemporaryHp = authoritativeAbilityHealingBlocked({
    map: input.context.map,
    placementId: actorId,
  }) || aa084PowerConstructBlocksTemporaryHp({
    context: input.context,
    placementId: actorId,
  }) ? currentTemporaryHp : Math.max(currentTemporaryHp, amount)
  const changes: MoveStateChangeInput[] = [encounterChange({
    ...input,
    current: paidEncounter,
    reasonCode: 'ability.aa081.mud-shield.paid',
  })]
  if (nextTemporaryHp !== currentTemporaryHp) changes.push({
    kind: 'map-temporary-hit-points',
    scope: { kind: 'map', mapSlug: input.context.map.slug },
    expectedRevision: normalizeRevision(input.context.map.revision),
    sourceOperationId: `${input.operationId}:temporary-hp`,
    reasonCode: 'ability.aa081.mud-shield.temporary-hp',
    previous: deepCloneJson(previousTemporaryHp),
    current: {
      scene: { ...sceneState.scene },
      byPlacementId: {
        ...sceneState.byPlacementId,
        [actorId]: nextTemporaryHp,
      },
    },
    compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  })
  return Object.freeze({
    plan: createMoveStateChangePlan(changes),
    presentationKey: 'ability.aa081.mud-shield.applied',
    controllerPresentationValues: [String(amount)],
  })
}

const multitype = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly abilityInstanceId: string
  readonly choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[]
}): Aa081ActivatedExecution => {
  const selection = selectedValue(input.choices, 'activate.type')
  const typeId = selection?.kind === 'type'
    ? selection.typeId
    : fail('Multitype requires one server-issued Elemental Type.')
  const action = payAction({ ...input, canonicalId: 'Multitype', resource: 'free' })
  let encounter = parseEncounterState(action.currentEncounterState)
  let transformations = parseAbilityTransformationState(
    encounter.abilityTransformations ?? createEmptyAbilityTransformationState(),
  )
  const existing = transformations.entries.filter(snapshot => (
    snapshot.placementId === input.context.actor.placement.id
    && snapshot.sourceAbilityInstanceId === input.abilityInstanceId
    && snapshot.canonicalId === 'Multitype'
  ))
  for (const [index, snapshot] of existing.entries()) {
    transformations = reduceAbilityTransformationCommand(transformations, {
      operationId: `${input.operationId}:remove:${index + 1}`,
      kind: 'remove', snapshotId: snapshot.snapshotId, expectedVersion: 1,
    }).state
  }
  const identity = shortHash(input.operationId, input.context.actor.placement.id, typeId)
  const snapshotId = `ability.multitype.${identity}`
  transformations = reduceAbilityTransformationCommand(transformations, {
    operationId: `${input.operationId}:create`,
    kind: 'create', snapshotId, expectedVersion: null,
    snapshot: {
      snapshotId,
      kind: 'form',
      placementId: input.context.actor.placement.id,
      ownerPlacementId: input.context.actor.placement.id,
      sourceAbilityInstanceId: input.abilityInstanceId,
      canonicalId: 'Multitype',
      sourceOperationId: input.operationId,
      duration: { kind: 'source-ability' },
      mechanics: {
        formId: `multitype-${typeId}`,
        abilityPolicy: 'preserve', abilities: [], moves: [], typeIds: [typeId],
        footprint: null, weightClass: null, capabilityTags: [],
      },
      copyBase: null,
      presentation: {
        public: {
          presentationId: `multitype-${typeId}`,
          labelKey: `ability.multitype.type.${typeId}`,
          formId: `multitype-${typeId}`,
          assetId: null,
        },
        private: null,
      },
    },
  }).state
  encounter = parseEncounterState({ ...encounter, abilityTransformations: transformations })
  return Object.freeze({
    plan: createMoveStateChangePlan([encounterChange({
      ...input,
      current: encounter,
      reasonCode: 'ability.aa081.multitype.changed-type',
    })]),
    presentationKey: 'ability.aa081.multitype.changed-type',
    controllerPresentationValues: [typeId],
  })
}

export const executeAa081ActivatedMechanic = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operation: AbilityMechanicOperation
  readonly operationId: string
  readonly abilityInstanceId: string
  readonly choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[]
}): Aa081ActivatedExecution | null => {
  if (input.context.actor.token.currentHp <= 0) {
    fail(`${input.context.runtime.canonicalId} cannot be activated while its user is Fainted.`)
  }
  switch (input.operation.mechanicId) {
    case 'aa081.mud-shield': return mudShield(input)
    case 'aa081.multitype': return multitype(input)
    default: return null
  }
}

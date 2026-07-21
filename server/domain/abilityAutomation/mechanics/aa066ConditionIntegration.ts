import { createHash } from 'node:crypto'
import { createEmptyEncounterState, parseEncounterState } from '#shared/moveAutomation/encounterState'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import { normalizeConditionNames } from '~/utils/statusConditions'
import type { AuthoritativeMoveRulesContext } from '../../moveAutomation/context'
import type { MoveStateChangePlan } from '../../moveAutomation/plan'
import type {
  MoveSpecChildExecution,
  MoveSpecEmittedOperation,
} from '../../moveAutomation/executeSpec'
import { reduceAbilityOwnedStateCommand } from '../ownedState'

export const AA066_DEADLY_POISON_MARK_PREFIX = 'aa066.deadly-poison.poisoned:' as const
const shortHash = (value: string): string => createHash('sha256').update(value).digest('hex').slice(0, 24)

export const aa066DeadlyPoisonStateIds = (input: {
  readonly map: TabletopMap
  readonly ownerPlacementId: string
  readonly abilityInstanceId: string
  readonly targetPlacementId?: string
}): readonly string[] => Object.freeze((input.map.encounterState?.abilityOwnedState?.entries ?? []).flatMap(entry => (
  entry.ownerPlacementId === input.ownerPlacementId
  && entry.sourceAbilityInstanceId === input.abilityInstanceId
  && entry.canonicalId === 'Deadly Poison'
  && entry.payload.kind === 'mark'
  && entry.payload.markId.startsWith(AA066_DEADLY_POISON_MARK_PREFIX)
  && (input.targetPlacementId === undefined || entry.targetPlacementIds.includes(input.targetPlacementId))
    ? [entry.stateId]
    : []
)))

const sheetConditions = (value: unknown): readonly string[] => normalizeConditionNames(
  (value as CharacterSheet | null | undefined)?.combat?.conditions ?? [],
)

/** Convert an actually applied Poison sheet transition into one short-lived server-owned upgrade entitlement. */
export const recordAa066DeadlyPoisonTriggers = (input: {
  readonly map: TabletopMap
  readonly context: AuthoritativeMoveRulesContext
  readonly coreStateChanges: MoveStateChangePlan
  readonly operations: readonly MoveSpecEmittedOperation[]
  readonly childExecutions: readonly MoveSpecChildExecution[]
  readonly operationId: string
}): TabletopMap => {
  const actorId = input.context.actor.placement.id
  const ability = input.context.queries.abilities.activeForPlacement(actorId)
    .find(candidate => candidate.canonicalId === 'Deadly Poison')
  if (!ability) return input.map
  const childActorByResolutionId = new Map(input.childExecutions.map(child => [
    child.resolutionId,
    child.actorPlacementId,
  ]))
  const operationTargets = new Set(input.operations.flatMap(({
    operation, recipientIds, childResolutionId,
  }) => (
    operation.kind === 'condition'
    && operation.payload.action === 'apply'
    && operation.payload.conditionId === 'poisoned'
    && (childResolutionId === undefined || childActorByResolutionId.get(childResolutionId) === actorId)
      ? [...recipientIds]
      : []
  )))
  const targetIds = new Set<string>()
  for (const change of input.coreStateChanges.changes) {
    if (change.kind !== 'sheet-state' || change.scope.sheetKind !== 'pokemon') continue
    const previous = new Set(sheetConditions(change.previous))
    const current = new Set(sheetConditions(change.current))
    if (previous.has('Poisoned') || !current.has('Poisoned') || current.has('Badly Poisoned')) continue
    for (const placement of input.map.placements) {
      if (placement.sheetKind === 'pokemon' && placement.sheetSlug === change.scope.sheetSlug
        && placement.id !== actorId
        && operationTargets.has(placement.id)) targetIds.add(placement.id)
    }
  }
  if (targetIds.size === 0) return input.map
  let encounter = parseEncounterState(input.map.encounterState ?? createEmptyEncounterState())
  for (const targetId of [...targetIds].sort()) {
    const identity = shortHash(`${input.operationId}:${actorId}:${targetId}:${ability.instanceId}`)
    const stateId = `${ability.instanceId}:deadly-poison:${identity}`
    encounter = parseEncounterState({
      ...encounter,
      abilityOwnedState: reduceAbilityOwnedStateCommand(encounter.abilityOwnedState, {
        operationId: `${input.operationId}:deadly-poison:${identity}`,
        kind: 'create', stateId, expectedVersion: null,
        entry: {
          stateId, ownerPlacementId: actorId, sourceAbilityInstanceId: ability.instanceId,
          canonicalId: 'Deadly Poison', targetPlacementIds: [targetId],
          lifecycle: { kind: 'turn', targetPolicy: null },
          payload: { kind: 'mark', markId: `${AA066_DEADLY_POISON_MARK_PREFIX}${shortHash(targetId)}` },
        },
      }).state,
    })
  }
  return { ...input.map, encounterState: encounter }
}

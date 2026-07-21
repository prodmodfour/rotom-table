import { createHash } from 'node:crypto'
import { createEmptyEncounterState, parseEncounterState } from '#shared/moveAutomation/encounterState'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import { deepCloneJson } from '~/utils/serialization'
import type { AuthoritativeMoveRulesContext } from '../../moveAutomation/context'
import type { MoveConsumedItemRecord } from '../../moveAutomation/itemMutationTypes'
import {
  createMoveStateChangePlan,
  type MoveStateChangeInput,
  type MoveStateChangePlan,
} from '../../moveAutomation/plan'
import { reduceAbilityOwnedStateCommand } from '../ownedState'

export const AA065_CUD_CHEW_CONSUMED_PREFIX = 'aa065.cud-chew.consumed:' as const
const CUD_CHEW_EVIDENCE_LIMIT = 32
const shortHash = (value: string): string => createHash('sha256').update(value).digest('hex').slice(0, 24)

export interface Aa065CudChewConsumptionRecording {
  readonly map: TabletopMap
  readonly itemStateChanges: MoveStateChangePlan
}

/** Persist an opaque scene mark plus private sheet evidence for consumables actually removed from this Cud Chew owner. */
export const recordAa065CudChewConsumptions = (input: {
  readonly map: TabletopMap
  readonly context: AuthoritativeMoveRulesContext
  readonly consumedItems: readonly MoveConsumedItemRecord[]
  readonly itemStateChanges: MoveStateChangePlan
  readonly operationId: string
}): Aa065CudChewConsumptionRecording => {
  const actorId = input.context.actor.placement.id
  const ability = input.context.queries.abilities.activeForPlacement(actorId)
    .find(candidate => candidate.canonicalId === 'Cud Chew')
  const scene = input.map.activeScene
  if (!ability || !scene || input.consumedItems.length === 0) {
    return Object.freeze({ map: input.map, itemStateChanges: input.itemStateChanges })
  }

  const sceneStartedAt = Number.isSafeInteger(scene.startedAt) ? scene.startedAt! : 0
  let encounter = parseEncounterState(input.map.encounterState ?? createEmptyEncounterState())
  const evidence: NonNullable<NonNullable<CharacterSheet['serverPrivate']>['abilityItemEvidence']> = []
  for (const consumed of input.consumedItems) {
    if (consumed.source.owner.kind !== 'sheet'
      || consumed.source.owner.sheetKind !== input.context.actor.sheet.kind
      || consumed.source.owner.slug !== input.context.actor.sheet.slug) continue
    const identity = shortHash(`${consumed.consumptionId}:${consumed.sourceOperationId}:${consumed.canonicalItemId}`)
    const stateId = `${ability.instanceId}:cud-chew:${identity}`
    const reduced = reduceAbilityOwnedStateCommand(encounter.abilityOwnedState, {
      operationId: `${input.operationId}:cud-chew:${identity}`,
      kind: 'create', stateId, expectedVersion: null,
      entry: {
        stateId, ownerPlacementId: actorId, sourceAbilityInstanceId: ability.instanceId,
        canonicalId: 'Cud Chew', targetPlacementIds: [],
        lifecycle: { kind: 'scene', targetPolicy: null },
        payload: {
          kind: 'mark',
          // Never put the canonical item identity in map-visible encounter state.
          markId: `${AA065_CUD_CHEW_CONSUMED_PREFIX}${identity}`,
        },
      },
    })
    encounter = parseEncounterState({ ...encounter, abilityOwnedState: reduced.state })
    evidence.push({
      stateId,
      canonicalItemId: consumed.canonicalItemId,
      consumptionId: consumed.consumptionId,
      sourceOperationId: consumed.sourceOperationId,
      sceneName: scene.name,
      sceneStartedAt,
    })
  }
  if (evidence.length === 0) {
    return Object.freeze({ map: input.map, itemStateChanges: input.itemStateChanges })
  }

  let evidenceAttached = false
  const itemInputs = input.itemStateChanges.changes.map((change): MoveStateChangeInput => {
    if (change.kind !== 'sheet-state'
      || change.scope.sheetKind !== 'pokemon'
      || change.scope.sheetSlug !== input.context.actor.sheet.slug) return deepCloneJson(change)
    const current = deepCloneJson(change.current) as CharacterSheet
    const retained = (current.serverPrivate?.abilityItemEvidence ?? []).filter(record => (
      record.sceneName === scene.name && record.sceneStartedAt === sceneStartedAt
    ))
    current.serverPrivate = {
      ...current.serverPrivate,
      abilityItemEvidence: [...retained, ...evidence].slice(-CUD_CHEW_EVIDENCE_LIMIT),
    }
    evidenceAttached = true
    return { ...deepCloneJson(change), current }
  })
  if (!evidenceAttached) {
    throw new Error('Cud Chew consumption did not retain its authoritative actor sheet mutation.')
  }

  return Object.freeze({
    map: { ...input.map, encounterState: encounter },
    itemStateChanges: createMoveStateChangePlan(itemInputs),
  })
}

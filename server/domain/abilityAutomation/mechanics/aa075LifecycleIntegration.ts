import { createHash } from 'node:crypto'
import type { MoveEffectOperation, MoveHealEffectOperation } from '#shared/moveAutomation/effects'
import { parseEncounterState, type EncounterState } from '#shared/moveAutomation/encounterState'
import { AA075_ICE_FACE_FORM_MARKER_CAPABILITY } from '#shared/abilityAutomation/aa075'
import type { MoveCoreTokenEffectOperationResult } from '../../moveAutomation/reducers/coreTokenEffectTypes'
import type { TabletopMap } from '~/types/map'
import type { AuthoritativeMoveRulesContext } from '../../moveAutomation/context'
import type {
  EncounterLifecycleTrigger,
  EncounterLifecycleTriggerHandler,
} from '../../moveAutomation/reduceLifecycle'
import { createAa075IceFaceTemporaryHpMarker } from './aa075TemporaryHpIntegration'

export const AA075_ICE_FACE_BATTLE_START_REASON = 'ability.ice-face.battle-start' as const

const operationId = (eventId: string, recipientId: string): string => `ability.ice-face.battle-start.${createHash('sha256')
  .update(`${eventId}\u0000${recipientId}`)
  .digest('hex').slice(0, 24)}`

const healing = (input: {
  readonly eventId: string
  readonly recipientId: string
  readonly temporaryHp: number
}): MoveHealEffectOperation => ({
  id: operationId(input.eventId, input.recipientId),
  kind: 'heal',
  source: { kind: 'lifecycle-event', id: input.eventId },
  recipients: { kind: 'area-targets' },
  phase: 'cleanup',
  reasonCode: `${AA075_ICE_FACE_BATTLE_START_REASON}:${input.recipientId}`,
  payload: {
    mode: 'gain',
    pool: 'temporary-hit-points',
    calculation: { kind: 'fixed', value: input.temporaryHp },
    bounds: { minimum: 0, maximum: null },
    rounding: 'floor',
    injury: { hitPointMarkers: 'ignore', massiveDamage: 'never' },
  },
})

export const aa075IceFaceLifecycleRecipientIds = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly operation: { readonly reasonCode: string }
  readonly candidateRecipientIds: readonly string[]
}): readonly string[] => {
  if (!input.operation.reasonCode.startsWith(`${AA075_ICE_FACE_BATTLE_START_REASON}:`)) {
    return input.candidateRecipientIds
  }
  const ownerId = input.operation.reasonCode.slice(AA075_ICE_FACE_BATTLE_START_REASON.length + 1)
  return input.candidateRecipientIds.filter(id => id === ownerId
    && input.context.queries.abilities.has(id, 'Ice Face'))
}

export const applyAa075IceFaceLifecycleTemporaryHpOwnership = (input: {
  readonly map: TabletopMap
  readonly state: EncounterState
  readonly operations: readonly MoveEffectOperation[]
  readonly results: readonly MoveCoreTokenEffectOperationResult[]
}): EncounterState => {
  const applied = input.operations.flatMap((operation) => {
    if (!operation.reasonCode.startsWith(`${AA075_ICE_FACE_BATTLE_START_REASON}:`)) return []
    const result = input.results.find(candidate => candidate.operationId === operation.id)
    if (!result) return []
    return result.recipients.flatMap(recipient => (
      recipient.outcome === 'applied'
      && recipient.previous.kind === 'hp'
      && recipient.current.kind === 'hp'
      && recipient.current.temporaryHp > recipient.previous.temporaryHp
        ? [{ placementId: recipient.recipientId, operationId: operation.id }]
        : []
    ))
  })
  if (applied.length === 0) return input.state
  const owners = new Set(applied.map(entry => entry.placementId))
  return parseEncounterState({
    ...input.state,
    effects: [
      ...input.state.effects.filter(effect => !(
        effect.kind === 'capability'
        && effect.payload.capabilityId === AA075_ICE_FACE_FORM_MARKER_CAPABILITY
        && effect.affected.placementIds.some(id => owners.has(id))
      )),
      ...applied.map(entry => createAa075IceFaceTemporaryHpMarker({
        map: input.map,
        placementId: entry.placementId,
        sourceOperationId: entry.operationId,
      })),
    ],
  })
}

/** Grant exactly two authoritative ticks at the first round-start boundary. */
export const createAa075IceFaceLifecycleHandler = (input: {
  readonly temporaryHpByPlacementId: ReadonlyMap<string, number>
}): EncounterLifecycleTriggerHandler => Object.freeze({
  id: 'handler.ability.aa075.ice-face',
  resolve: ({ event }: Parameters<EncounterLifecycleTriggerHandler['resolve']>[0]) => {
    if (event.kind !== 'round-start' || event.round !== 1) return []
    const triggers: EncounterLifecycleTrigger[] = [...input.temporaryHpByPlacementId.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([recipientId, temporaryHp]) => ({
        effectId: null,
        reasonCode: `${AA075_ICE_FACE_BATTLE_START_REASON}-trigger`,
        operations: [healing({ eventId: event.eventId, recipientId, temporaryHp })],
        emittedEvents: [],
      }))
    return triggers
  },
})

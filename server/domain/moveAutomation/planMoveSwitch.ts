import { createHash } from 'node:crypto'
import {
  ENCOUNTER_EVENT_SCHEMA_VERSION,
  parseEncounterEvent,
  type EncounterRecallEvent,
  type EncounterSwitchEvent,
} from '#shared/moveAutomation/events'
import {
  createEmptyEncounterState,
  parseEncounterState,
} from '#shared/moveAutomation/encounterState'
import { parseEncounterEffect } from '#shared/moveAutomation/encounterEffects'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import { mapWithTemporaryHpForPlacement } from '~/utils/mapTemporaryHitPoints'
import { deepCloneJson, sameJsonValue } from '~/utils/serialization'
import type { AuthoritativeMoveSwitchTransition } from '../resolveAuthoritativeMove'
import {
  resolveEncounterEffectRecall,
  resolveEncounterEffectSwitchTransfer,
} from './effectTransfer'
import { reduceEncounterLifecycle } from './reduceLifecycle'
import { createMoveSemiInvulnerableLifecycleHandler } from './semiInvulnerableLifecycle'
import { createVortexLifecycleHandler } from './vortex'
import { createYawnLifecycleHandler } from './yawn'
import {
  activelyCommandingTrainerPlacementId,
  recordActivelyCommandedPokemon,
} from './activePokemonCommands'
import { clearPhysicalPowerLoadsForPlacements } from '../capabilityAutomation/physicalPower'
import { rebindItemDigestionEffectsForPlacement } from '../itemAutomation/digestionEffectIdentity'
import { removeCapabilityPresenceGroup } from '../capabilityAutomation/presenceLifecycle'

export type MoveSwitchPlanningErrorCode =
  | 'switch-source-missing'
  | 'switch-replacement-conflict'
  | 'switch-policy-mismatch'
  | 'switch-trainer-missing'
  | 'switch-lifecycle-operation-unsupported'
  | 'switch-effect-transfer-conflict'

export class MoveSwitchPlanningError extends Error {
  readonly code: MoveSwitchPlanningErrorCode

  constructor(code: MoveSwitchPlanningErrorCode, message: string) {
    super(message)
    this.name = 'MoveSwitchPlanningError'
    this.code = code
  }
}

export interface PlannedMoveSwitch {
  readonly previousMap: TabletopMap
  readonly nextMap: TabletopMap
  readonly recalledPlacement: SheetPlacement
  readonly sentOutPlacement: SheetPlacement | null
  readonly event: EncounterSwitchEvent | EncounterRecallEvent
  readonly transferredEffectIds: readonly string[]
  readonly expiredEffectIds: readonly string[]
  readonly cleanupEventIds: readonly string[]
}

const fail = (code: MoveSwitchPlanningErrorCode, message: string): never => {
  throw new MoveSwitchPlanningError(code, message)
}

const sameAnchor = (
  left: SheetPlacement['position'],
  right: SheetPlacement['position'],
): boolean => left.x === right.x && left.y === right.y && left.z === right.z

const eventSourceId = (operationId: string): string => (
  `switch.${createHash('sha256').update(operationId, 'utf8').digest('hex').slice(0, 24)}`
)

const replaceInitiativeSlot = (
  map: TabletopMap,
  recalledPlacementId: string,
  sentOutPlacementId: string | null,
): TabletopMap['initiative'] => {
  if (!map.initiative) return undefined
  if (
    sentOutPlacementId !== null
    && sentOutPlacementId !== recalledPlacementId
    && map.initiative.manualOrderIds?.includes(sentOutPlacementId)
  ) {
    return fail(
      'switch-replacement-conflict',
      `Initiative order already contains replacement placement ${sentOutPlacementId}.`,
    )
  }
  return {
    ...deepCloneJson(map.initiative),
    ...(map.initiative.activeId === recalledPlacementId
      ? { activeId: sentOutPlacementId }
      : {}),
    ...(map.initiative.manualOrderIds
      ? {
          manualOrderIds: sentOutPlacementId === null
            ? map.initiative.manualOrderIds.filter(id => id !== recalledPlacementId)
            : map.initiative.manualOrderIds.map(placementId => (
                placementId === recalledPlacementId ? sentOutPlacementId : placementId
              )),
        }
      : {}),
  }
}

const recalledPlacement = (
  map: TabletopMap,
  transition: AuthoritativeMoveSwitchTransition,
): SheetPlacement => {
  const matches = map.placements.filter(
    placement => placement.id === transition.recalledPlacementId,
  )
  if (matches.length !== 1 || matches[0]?.sheetKind !== 'pokemon') {
    return fail(
      'switch-source-missing',
      `Switch source ${transition.recalledPlacementId} must resolve to one Pokémon placement.`,
    )
  }
  return matches[0]
}

const assertReplacementTransition = (
  map: TabletopMap,
  transition: Extract<AuthoritativeMoveSwitchTransition, { readonly kind: 'recall-and-send-out' }>,
  recalled: SheetPlacement,
): void => {
  const replacement = transition.sentOutPlacement
  if (
    transition.positionPolicy !== 'recalled-position'
    || transition.initiativePolicy !== 'inherit-slot'
    || !sameAnchor(recalled.position, replacement.position)
    || recalled.sideId !== replacement.sideId
    || recalled.initiative !== replacement.initiative
  ) {
    return fail(
      'switch-policy-mismatch',
      'The selected replacement no longer preserves the reviewed position, side, and initiative slot.',
    )
  }
  if (
    replacement.id === recalled.id
    || replacement.sheetKind !== 'pokemon'
    || map.placements.some(placement => placement.id === replacement.id)
  ) {
    return fail(
      'switch-replacement-conflict',
      `Switch replacement placement ${replacement.id} is missing, duplicated, or aliases its source.`,
    )
  }
  const trainer = map.placements.find(placement => (
    placement.id === transition.trainerPlacementId
    && placement.sheetKind === 'trainer'
    && placement.sheetSlug === transition.trainerSheetSlug
  ))
  if (!trainer) {
    return fail(
      'switch-trainer-missing',
      `Authoritative trainer placement ${transition.trainerPlacementId} is no longer present.`,
    )
  }
}

/**
 * Apply one already revalidated move-driven recall, optionally paired with a
 * server-issued replacement. Placement/initiative changes, temporary-HP and
 * source-leave cleanup, history, and resources remain one pure plan.
 */
export const planAuthoritativeMoveSwitch = (input: {
  readonly map: TabletopMap
  readonly transition: AuthoritativeMoveSwitchTransition
}): PlannedMoveSwitch => {
  const previousMap = deepCloneJson(input.map)
  const recalled = recalledPlacement(previousMap, input.transition)
  const commandingTrainerId = activelyCommandingTrainerPlacementId({
    map: previousMap,
    pokemonPlacementId: recalled.id,
  })
  const sentOutPlacement = input.transition.kind === 'recall-and-send-out'
    ? deepCloneJson(input.transition.sentOutPlacement)
    : null
  if (input.transition.kind === 'recall-and-send-out') {
    assertReplacementTransition(previousMap, input.transition, recalled)
  }

  const sourceOperationId = eventSourceId(input.transition.operationId)
  const event = input.transition.kind === 'recall-and-send-out'
    ? parseEncounterEvent({
        schemaVersion: ENCOUNTER_EVENT_SCHEMA_VERSION,
        eventId: `${sourceOperationId}.event`,
        kind: 'switch',
        sourceOperationId,
        causalParentEventId: null,
        reasonCode: 'move.switch.recall-and-send-out',
        recalledPlacementId: recalled.id,
        sentOutPlacementId: input.transition.sentOutPlacement.id,
        sideId: recalled.sideId ?? null,
        causalProviderId: input.transition.causalProviderId ?? null,
      }) as EncounterSwitchEvent
    : parseEncounterEvent({
        schemaVersion: ENCOUNTER_EVENT_SCHEMA_VERSION,
        eventId: `${sourceOperationId}.event`,
        kind: 'recall',
        sourceOperationId,
        causalParentEventId: null,
        reasonCode: 'move.switch.recall-only',
        placementId: recalled.id,
        sideId: recalled.sideId ?? null,
        causalProviderId: input.transition.causalProviderId ?? null,
      }) as EncounterRecallEvent
  const previousEncounterState = parseEncounterState(
    previousMap.encounterState ?? createEmptyEncounterState(),
  )
  const effectTransfer = sentOutPlacement
    ? resolveEncounterEffectSwitchTransfer({
        effects: previousEncounterState.effects,
        recalledPlacementId: recalled.id,
        sentOutPlacementId: sentOutPlacement.id,
        stateTransferPolicy: input.transition.stateTransferPolicy,
      })
    : resolveEncounterEffectRecall({
        effects: previousEncounterState.effects,
        recalledPlacementId: recalled.id,
      })
  const transferState = parseEncounterState({
    ...previousEncounterState,
    effects: effectTransfer.effects,
  })
  const lifecycle = reduceEncounterLifecycle(
    transferState,
    [event],
    [
      createMoveSemiInvulnerableLifecycleHandler(),
      createVortexLifecycleHandler(),
      createYawnLifecycleHandler(),
    ],
  )
  if (lifecycle.operations.length > 0) {
    return fail(
      'switch-lifecycle-operation-unsupported',
      'Source-leave switch cleanup emitted mechanics that require a dedicated switch reducer.',
    )
  }
  const transferredIds = new Set(effectTransfer.transferredEffectIds)
  const cleanupRemovedTransferred = lifecycle.transitions.some(({ transition }) => (
    transferredIds.has(transition.effectId) && transition.current === null
  ))
  if (cleanupRemovedTransferred) {
    return fail(
      'switch-effect-transfer-conflict',
      'Source-leave cleanup cannot remove an effect transferred to the replacement.',
    )
  }

  const placements = sentOutPlacement
    ? previousMap.placements.map(placement => (
        placement.id === recalled.id ? sentOutPlacement : deepCloneJson(placement)
      ))
    : previousMap.placements
        .filter(placement => placement.id !== recalled.id)
        .map(placement => deepCloneJson(placement))
  const entryEffect = sentOutPlacement ? parseEncounterEffect({
    id: `encounter.entry.${createHash('sha256').update(`${sourceOperationId}\u0000${sentOutPlacement.id}`).digest('hex').slice(0, 24)}`,
    kind: 'capability',
    source: {
      operationId: sourceOperationId,
      moveId: 'encounter.switch',
      placementId: sentOutPlacement.id,
    },
    affected: {
      placementIds: [sentOutPlacement.id],
      sideIds: [],
      cells: [{ ...sentOutPlacement.position }],
    },
    createdRound: Math.max(1, previousMap.initiative?.round ?? lifecycle.state.history.currentRound ?? 1),
    createdTurn: Math.max(0, lifecycle.state.history.currentTurn?.turn ?? 0),
    duration: { kind: 'scene', remaining: null },
    stacks: 1,
    charges: null,
    stackPolicy: { kind: 'replace', maxStacks: null },
    chargePolicy: { kind: 'none', amount: null },
    tags: ['encounter-entry', 'send-out'],
    payload: { capabilityId: 'encounter.recent-entry', action: 'grant' },
    dispel: { policy: 'matching-tags', tags: ['encounter-entry'] },
    transferPolicy: 'expire',
    suppression: { sources: [] },
  }, 'moveSwitch.entryEffect') : null
  const sentOutReboundEffects = sentOutPlacement
    ? rebindItemDigestionEffectsForPlacement({
        effects: lifecycle.state.effects,
        placement: sentOutPlacement,
      })
    : lifecycle.state.effects
  const nextEncounterState = entryEffect ? parseEncounterState({
    ...lifecycle.state,
    effects: [
      ...sentOutReboundEffects.filter(effect => !(
        effect.tags.includes('encounter-entry')
        && effect.affected.placementIds.includes(sentOutPlacement!.id)
      )),
      entryEffect,
    ],
  }) : parseEncounterState({ ...lifecycle.state, effects: sentOutReboundEffects })
  let nextMap = mapWithTemporaryHpForPlacement(
    clearPhysicalPowerLoadsForPlacements(previousMap, new Set([recalled.id])),
    recalled.id,
    0,
  )
  nextMap = {
    ...nextMap,
    placements,
    encounterState: nextEncounterState,
  }
  if (sentOutPlacement && input.transition.kind === 'recall-and-send-out'
    && commandingTrainerId === input.transition.trainerPlacementId) {
    nextMap = recordActivelyCommandedPokemon({
      map: nextMap,
      trainerPlacementId: commandingTrainerId,
      pokemonPlacementId: sentOutPlacement.id,
      operationId: input.transition.operationId,
    })
  }
  const initiative = replaceInitiativeSlot(
    previousMap,
    recalled.id,
    sentOutPlacement?.id ?? null,
  )
  if (initiative === undefined) delete nextMap.initiative
  else nextMap.initiative = initiative

  const presence = removeCapabilityPresenceGroup({
    map: nextMap,
    ownerPlacementId: recalled.id,
  })
  nextMap = presence.map
  for (const placementId of presence.removedPlacementIds) {
    nextMap = mapWithTemporaryHpForPlacement(nextMap, placementId, 0)
  }

  if (sameJsonValue(previousMap.placements, nextMap.placements)) {
    return fail('switch-replacement-conflict', 'A move-driven recall must change placements.')
  }
  return Object.freeze({
    previousMap,
    nextMap: deepCloneJson(nextMap),
    recalledPlacement: deepCloneJson(recalled),
    sentOutPlacement,
    event,
    transferredEffectIds: effectTransfer.transferredEffectIds,
    expiredEffectIds: effectTransfer.expiredEffectIds,
    cleanupEventIds: Object.freeze(lifecycle.emittedEvents.map(item => item.eventId)),
  })
}

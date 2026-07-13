import { createHash } from 'node:crypto'
import {
  ENCOUNTER_EVENT_SCHEMA_VERSION,
  parseEncounterEvent,
  type EncounterSwitchEvent,
} from '#shared/moveAutomation/events'
import {
  createEmptyEncounterState,
  parseEncounterState,
} from '#shared/moveAutomation/encounterState'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import { mapWithTemporaryHpForPlacement } from '~/utils/mapTemporaryHitPoints'
import { deepCloneJson, sameJsonValue } from '~/utils/serialization'
import type { AuthoritativeMoveSwitchTransition } from '../resolveAuthoritativeMove'
import { resolveEncounterEffectSwitchTransfer } from './effectTransfer'
import { reduceEncounterLifecycle } from './reduceLifecycle'
import { createMoveSemiInvulnerableLifecycleHandler } from './semiInvulnerableLifecycle'

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
  readonly sentOutPlacement: SheetPlacement
  readonly event: EncounterSwitchEvent
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
  sentOutPlacementId: string,
): TabletopMap['initiative'] => {
  if (!map.initiative) return undefined
  if (
    sentOutPlacementId !== recalledPlacementId
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
          manualOrderIds: map.initiative.manualOrderIds.map(placementId => (
            placementId === recalledPlacementId ? sentOutPlacementId : placementId
          )),
        }
      : {}),
  }
}

const assertTransition = (
  map: TabletopMap,
  transition: AuthoritativeMoveSwitchTransition,
): {
  readonly recalled: SheetPlacement
  readonly trainer: SheetPlacement
} => {
  const recalledMatches = map.placements.filter(
    placement => placement.id === transition.recalledPlacementId,
  )
  if (recalledMatches.length !== 1 || recalledMatches[0]?.sheetKind !== 'pokemon') {
    return fail(
      'switch-source-missing',
      `Switch source ${transition.recalledPlacementId} must resolve to one Pokémon placement.`,
    )
  }
  const recalled = recalledMatches[0]
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
  return { recalled, trainer }
}

/**
 * Apply one already revalidated switch as a map-local recall/send-out pair.
 * Placement replacement, initiative-slot inheritance, temporary-HP cleanup,
 * history/resources, and source-leave lifecycle cleanup remain one pure plan.
 */
export const planAuthoritativeMoveSwitch = (input: {
  readonly map: TabletopMap
  readonly transition: AuthoritativeMoveSwitchTransition
}): PlannedMoveSwitch => {
  const previousMap = deepCloneJson(input.map)
  const { recalled } = assertTransition(previousMap, input.transition)
  const sentOutPlacement = deepCloneJson(input.transition.sentOutPlacement)
  const sourceOperationId = eventSourceId(input.transition.operationId)
  const event = parseEncounterEvent({
    schemaVersion: ENCOUNTER_EVENT_SCHEMA_VERSION,
    eventId: `${sourceOperationId}.event`,
    kind: 'switch',
    sourceOperationId,
    causalParentEventId: null,
    reasonCode: 'move.switch.recall-and-send-out',
    recalledPlacementId: recalled.id,
    sentOutPlacementId: sentOutPlacement.id,
  }) as EncounterSwitchEvent
  const previousEncounterState = parseEncounterState(
    previousMap.encounterState ?? createEmptyEncounterState(),
  )
  const effectTransfer = resolveEncounterEffectSwitchTransfer({
    effects: previousEncounterState.effects,
    recalledPlacementId: recalled.id,
    sentOutPlacementId: sentOutPlacement.id,
    stateTransferPolicy: input.transition.stateTransferPolicy,
  })
  const transferState = parseEncounterState({
    ...previousEncounterState,
    effects: effectTransfer.effects,
  })
  const lifecycle = reduceEncounterLifecycle(
    transferState,
    [event],
    [createMoveSemiInvulnerableLifecycleHandler()],
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

  const sourceIndex = previousMap.placements.findIndex(
    placement => placement.id === recalled.id,
  )
  const placements = previousMap.placements.map((placement, index) => (
    index === sourceIndex ? sentOutPlacement : deepCloneJson(placement)
  ))
  let nextMap = mapWithTemporaryHpForPlacement(previousMap, recalled.id, 0)
  nextMap = {
    ...nextMap,
    placements,
    encounterState: lifecycle.state,
  }
  const initiative = replaceInitiativeSlot(
    previousMap,
    recalled.id,
    sentOutPlacement.id,
  )
  if (initiative === undefined) delete nextMap.initiative
  else nextMap.initiative = initiative

  if (sameJsonValue(previousMap.placements, nextMap.placements)) {
    return fail('switch-replacement-conflict', 'A move-driven switch must change placements.')
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

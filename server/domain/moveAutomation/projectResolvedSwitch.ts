import type {
  AuthoritativeMoveSwitchTransition,
} from '../resolveAuthoritativeMove'
import type {
  MoveSpecExecutionCompleteResult,
  MoveSpecExecutionPendingResult,
} from './executeSpec'

export class ResolvedMoveSwitchProjectionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ResolvedMoveSwitchProjectionError'
  }
}

/**
 * Project at most one interpreter-owned switch result into the authoritative
 * placement transition consumed by map planning. A pass may recall without a
 * replacement, but it can never transfer Baton Pass state.
 */
export const projectResolvedMoveSwitchTransition = (
  execution: MoveSpecExecutionCompleteResult | MoveSpecExecutionPendingResult,
): AuthoritativeMoveSwitchTransition | null => {
  if (execution.resolvedSwitches.length === 0) return null
  if (execution.resolvedSwitches.length > 1) {
    throw new ResolvedMoveSwitchProjectionError(
      'A MoveSpec resolved more than one durable switch choice.',
    )
  }

  const resolved = execution.resolvedSwitches[0]!
  const choice = resolved.choice
  if (!choice) {
    if (resolved.optionId !== null || resolved.stateTransferPolicy !== 'none') {
      throw new ResolvedMoveSwitchProjectionError(
        'A recall-only switch must come from a pass and cannot transfer state.',
      )
    }
    return Object.freeze({
      kind: 'recall-only',
      operationId: resolved.operationId,
      recalledPlacementId: resolved.recalledPlacementId,
      stateTransferPolicy: 'none',
    })
  }
  if (
    resolved.optionId === null
    || resolved.recalledPlacementId !== choice.recalledPlacementId
  ) {
    throw new ResolvedMoveSwitchProjectionError(
      'A replacement switch lost its selected option or recalled placement identity.',
    )
  }

  return Object.freeze({
    kind: 'recall-and-send-out',
    operationId: resolved.operationId,
    recalledPlacementId: choice.recalledPlacementId,
    sentOutPlacement: Object.freeze({
      ...choice.sentOutPlacement,
      position: Object.freeze({ ...choice.sentOutPlacement.position }),
    }),
    trainerPlacementId: choice.trainerPlacementId,
    trainerSheetSlug: choice.trainerSheetSlug,
    positionPolicy: 'recalled-position',
    initiativePolicy: 'inherit-slot',
    stateTransferPolicy: resolved.stateTransferPolicy,
  })
}

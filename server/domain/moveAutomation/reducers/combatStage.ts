import type { MoveCombatStageEffectOperation } from '#shared/moveAutomation/effects'
import {
  COMBAT_STAGE_KEYS,
  clampCombatStage,
  normalizeCombatStages,
} from '~/utils/combatStages'
import type { MoveAutomationCombatStageUpdateAccumulator } from '~/utils/moveAutomationStatusUpdates'
import type { CombatStageKey } from '~/types/combatStages'
import type {
  MoveCoreCombatStageStateSnapshot,
  MoveCoreTokenEffectBlocker,
  MoveCoreTokenEffectImmunityQueries,
  MoveCoreTokenEffectRecipient,
  MoveCoreTokenEffectRecipientResult,
} from './coreTokenEffectTypes'

const combatStageSnapshot = (
  accumulator: MoveAutomationCombatStageUpdateAccumulator,
  recipient: MoveCoreTokenEffectRecipient,
): MoveCoreCombatStageStateSnapshot => ({
  kind: 'combat-stages',
  stages: normalizeCombatStages(accumulator.get(recipient.token)),
})

const operationStages = (
  operation: MoveCombatStageEffectOperation,
): readonly CombatStageKey[] => operation.payload.stage === 'all'
  ? COMBAT_STAGE_KEYS
  : [operation.payload.stage]

const requestedStage = (
  operation: MoveCombatStageEffectOperation,
  current: number,
): number => {
  if (operation.payload.action === 'reset') return 0
  if (operation.payload.action === 'set') return clampCombatStage(operation.payload.value)
  return clampCombatStage(current + (operation.payload.value ?? 0))
}

export const reduceCombatStageEffectForRecipient = (options: {
  readonly operation: MoveCombatStageEffectOperation
  readonly recipient: MoveCoreTokenEffectRecipient
  readonly accumulator: MoveAutomationCombatStageUpdateAccumulator
  readonly immunities: MoveCoreTokenEffectImmunityQueries
}): MoveCoreTokenEffectRecipientResult => {
  const { operation, recipient, accumulator } = options
  const previous = combatStageSnapshot(accumulator, recipient)
  const next = { ...previous.stages }
  const blockers: MoveCoreTokenEffectBlocker[] = []
  const consultedPlacementIds = new Set<string>()
  let changed = false

  for (const stage of operationStages(operation)) {
    const requested = requestedStage(operation, previous.stages[stage])
    const delta = requested - previous.stages[stage]
    if (delta === 0) continue

    const immunity = options.immunities.combatStage({
      operation,
      stage,
      delta,
      recipient,
    })
    for (const placementId of immunity.consultedPlacementIds) {
      consultedPlacementIds.add(placementId)
    }
    if (immunity.blockedBy) {
      blockers.push({ subject: stage, source: immunity.blockedBy })
      continue
    }
    next[stage] = requested
    changed = true
  }

  if (changed) accumulator.set(recipient.token, next)
  const current = changed
    ? combatStageSnapshot(accumulator, recipient)
    : previous

  if (!changed) {
    return {
      recipientId: recipient.placement.id,
      outcome: blockers.length > 0 ? 'prevented' : 'no-op',
      reasonCode: blockers.length > 0 ? 'combat-stage-immunity' : 'combat-stage-unchanged',
      blockers,
      consultedPlacementIds: [...consultedPlacementIds],
      previous,
      current,
      changedFields: [],
    }
  }

  return {
    recipientId: recipient.placement.id,
    outcome: 'applied',
    reasonCode: operation.reasonCode,
    blockers,
    consultedPlacementIds: [...consultedPlacementIds],
    previous,
    current,
    changedFields: ['combatStages'],
  }
}

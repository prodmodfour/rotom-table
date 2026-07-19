import { DARK_VOID_BURST_BRANCH_ID } from '#shared/moveAutomation/canonicalMoveBranches'
import type { MoveEffectOperation } from '#shared/moveAutomation/effects'
import type {
  RegisteredMoveHandlerContext,
  RegisteredMoveHandlerRegistration,
} from './registry'

export const DARK_VOID_HANDLER_ID = 'dark-void.alternate-frequency' as const
export const DARK_VOID_BURST_USAGE_OPERATION_ID = 'dark-void.burst-scene-usage' as const
export const DARK_VOID_BURST_USAGE_MOVE_KEY = 'dark-void-burst-5' as const

const burstUsageOperation = (): MoveEffectOperation => ({
  id: DARK_VOID_BURST_USAGE_OPERATION_ID,
  kind: 'usage',
  source: { kind: 'move', id: 'move.dark-void' },
  recipients: { kind: 'actor' },
  phase: 'usage',
  reasonCode: 'dark-void.burst-once-per-scene',
  payload: {
    action: 'spend',
    resourceId: 'dark-void.burst-scene-use',
    amount: 1,
    resource: {
      moveName: 'Dark Void (Burst 5)',
      moveKey: DARK_VOID_BURST_USAGE_MOVE_KEY,
      frequency: 'Scene',
    },
  },
})

const runDarkVoidHandler = (context: RegisteredMoveHandlerContext) => {
  const burstSelected = context.intent.targetBranchId === DARK_VOID_BURST_BRANCH_ID
  return {
    operations: burstSelected ? [burstUsageOperation()] : [],
    traceEntries: [{
      kind: 'predicate' as const,
      phase: 'target' as const,
      predicateId: 'dark-void.burst-branch-selected',
      outcome: burstSelected,
      reasonCode: burstSelected
        ? 'dark-void.burst-branch-selected'
        : 'dark-void.single-target-branch-selected',
      input: {
        targetBranchId: context.intent.targetBranchId ?? null,
      },
    }],
  }
}

export const DARK_VOID_MOVE_HANDLER_REGISTRATION: RegisteredMoveHandlerRegistration =
  Object.freeze({
    id: DARK_VOID_HANDLER_ID,
    version: 1,
    run: runDarkVoidHandler,
  })

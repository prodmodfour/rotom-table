import { describe, expect, it } from 'vitest'
import { appendMoveAutomationLogEntry } from '~/utils/moveAutomationLog'
import { appendMoveLogEntry } from '~/utils/moveLog'
import type { MoveAutomationTransaction } from '~/types/moveAutomation'

describe('move log projections', () => {
  it('stores detached structured MoveSpec projections beside display lines', () => {
    const structured = [{
      operationId: 'operation.log',
      phase: 'cleanup' as const,
      reasonCode: 'move.scratch.completed',
      messageKey: 'move.scratch.completed',
      recipientIds: ['target-token'],
      arguments: [{ key: 'damage', value: 12 }],
    }]

    const metadata = appendMoveLogEntry(
      { note: 'keep' },
      {
        operationId: 'op_movelog0001',
        userId: 'actor-token',
        userName: 'Sparky',
        moveName: 'Scratch',
        lines: ['Sparky used Scratch.'],
        scriptKind: 'movespec-v2',
        scriptVersion: 2,
        definitionHash: 'a'.repeat(64),
        structured,
      },
      { now: () => 1_000 },
    )
    structured[0]!.recipientIds = []
    structured[0]!.arguments[0]!.value = 99

    expect(metadata).toEqual({
      note: 'keep',
      moveLog: [{
        at: 1_000,
        operationId: 'op_movelog0001',
        userId: 'actor-token',
        userName: 'Sparky',
        moveName: 'Scratch',
        lines: ['Sparky used Scratch.'],
        scriptKind: 'movespec-v2',
        scriptVersion: 2,
        definitionHash: 'a'.repeat(64),
        structured: [{
          operationId: 'operation.log',
          phase: 'cleanup',
          reasonCode: 'move.scratch.completed',
          messageKey: 'move.scratch.completed',
          recipientIds: ['target-token'],
          arguments: [{ key: 'damage', value: 12 }],
        }],
      }],
    })
  })

  it('keeps legacy automation entries on the shared append boundary', () => {
    const transaction: MoveAutomationTransaction = {
      userId: 'actor-token',
      userName: 'Sparky',
      moveName: 'Scratch',
      scriptKind: 'explicit',
      scriptVersion: 1,
      attackedTargetIds: ['target-token'],
      hitTargetIds: ['target-token'],
      hpUpdates: [],
      conditionUpdates: [],
      combatStageUpdates: [],
      hazardsToAdd: [],
      fieldEffectsToApply: [],
      logLines: ['Sparky used Scratch.'],
    }

    expect(appendMoveAutomationLogEntry(undefined, transaction, {
      now: () => 2_000,
      operationId: 'op_legacymove01',
    })).toEqual({
      moveLog: [{
        at: 2_000,
        operationId: 'op_legacymove01',
        userId: 'actor-token',
        userName: 'Sparky',
        moveName: 'Scratch',
        lines: ['Sparky used Scratch.'],
        scriptKind: 'explicit',
        scriptVersion: 1,
      }],
    })
  })
})

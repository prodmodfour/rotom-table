import { describe, expect, it } from 'vitest'
import {
  runAndAssertMoveAutomationSemanticScenario,
  type MoveAutomationSemanticScenario,
} from '../fixtures/moveAutomation/scenario'
import {
  scratchV2PassHitSemanticScenario,
} from '../fixtures/moveAutomation/scratchV2'

describe('move automation semantic scenario harness', () => {
  it('proves one seeded scenario at interpreter, planner, and accepted-command layers', async () => {
    const scenario = scratchV2PassHitSemanticScenario()

    const result = await runAndAssertMoveAutomationSemanticScenario(scenario)

    expect([
      result.interpreter.status,
      result.plan.status,
      result.command.status,
    ]).toEqual(['completed', 'completed', 'completed'])
    expect(result.committedDocuments.operationResult).toEqual(result.command.value?.result)
  })

  it('represents an expected command rejection without changing committed documents', async () => {
    const acceptedScenario = scratchV2PassHitSemanticScenario()
    const scenario: MoveAutomationSemanticScenario = {
      ...acceptedScenario,
      scenarioId: 'scratch.v2-pass-hit.stale-command',
      command: {
        ...acceptedScenario.command,
        baseRevision: 6,
      },
      expected: {
        ...acceptedScenario.expected,
        command: {
          rejection: {
            source: 'result',
            reason: 'stale-revision',
            messageIncludes: 'revision',
          },
        },
        committedDocuments: {
          map: {
            revision: 7,
            placements: [
              { id: 'actor-token', position: { x: 1, y: 0, z: 1 } },
              { id: 'target-token' },
              { id: 'occupied-end' },
            ],
            encounterState: { turnResources: {} },
          },
          sheets: {
            pokemon: {
              actor: { revision: 3, combat: { currentHp: 50 } },
              target: { revision: 3, combat: { currentHp: 100 } },
              blocker: { revision: 3, combat: { currentHp: 50 } },
            },
            trainer: {},
          },
          operationResult: {
            ok: false,
            opId: 'op_semanticscratch1',
            reason: 'stale-revision',
          },
          realtimeEvents: [],
        },
        trace: {
          interpreter: acceptedScenario.expected.trace?.interpreter,
          plan: acceptedScenario.expected.trace?.plan,
        },
      },
    }

    const result = await runAndAssertMoveAutomationSemanticScenario(scenario)

    expect(result.command.status).toBe('rejected')
    expect(result.traces.command).toBeNull()
  })
})

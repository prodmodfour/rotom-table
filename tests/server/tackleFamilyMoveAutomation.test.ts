import { describe, expect, it } from 'vitest'
import manifestJson from '../../data/move-automation/manifest.json'
import {
  TAKE_DOWN_V2_SEMANTIC_SCENARIOS,
  TACKLE_V2_SEMANTIC_SCENARIOS,
  allTackleV2SemanticScenarios,
} from '../fixtures/moveAutomation/tackleFamilyV2'
import { runAndAssertMoveAutomationSemanticScenario } from '../fixtures/moveAutomation/scenario'
import {
  REVIEWED_MOVE_SPEC_V2_REGISTRATIONS,
  registeredMoveAutomationRuntimeFor,
} from '~~/server/domain/moveAutomation/registry'
import { TACKLE_MOVE_SPEC } from '~~/server/domain/moveAutomation/specs/tackle'
import { TAKE_DOWN_MOVE_SPEC } from '~~/server/domain/moveAutomation/specs/takeDown'

const tackleRow = manifestJson.moves.find(row => row.canonicalId === 'Tackle')!
const takeDownRow = manifestJson.moves.find(row => row.canonicalId === 'Take Down')!

describe('Tackle and Take Down native automation', () => {
  it('selects complete reviewed runtimes and links their evidence', () => {
    expect(tackleRow).toMatchObject({
      baseStatus: 'complete',
      runtime: {
        kind: 'movespec-v2',
        version: 2,
        definitionHash: '7458a7dda77ab66db9dce470287bff326681d34c1b63f6bfe66d0026e1cba780',
        sourceModule: 'server/domain/moveAutomation/specs/tackle.ts',
      },
      blockerCodes: [],
      limitations: [],
      manualSteps: [],
    })
    expect(takeDownRow).toMatchObject({
      baseStatus: 'complete',
      runtime: {
        kind: 'movespec-v2',
        version: 2,
        definitionHash: '4f157f1b5fe7fb8270c67e2b8d8ca633383394ec3c0217c002b8e5c73fb5e827',
        sourceModule: 'server/domain/moveAutomation/specs/takeDown.ts',
      },
      blockerCodes: [],
      limitations: [],
      manualSteps: [],
    })
    expect(tackleRow.scenarioIds).toEqual(
      TACKLE_V2_SEMANTIC_SCENARIOS.map(({ scenarioId }) => scenarioId),
    )
    expect(takeDownRow.scenarioIds).toEqual(
      TAKE_DOWN_V2_SEMANTIC_SCENARIOS.map(({ scenarioId }) => scenarioId),
    )
    expect(registeredMoveAutomationRuntimeFor('Tackle')).toMatchObject({
      kind: 'movespec-v2',
      definition: { spec: TACKLE_MOVE_SPEC },
      definitionHash: tackleRow.runtime.definitionHash,
    })
    expect(registeredMoveAutomationRuntimeFor('Take Down')).toMatchObject({
      kind: 'movespec-v2',
      definition: { spec: TAKE_DOWN_MOVE_SPEC },
      definitionHash: takeDownRow.runtime.definitionHash,
    })
    expect(REVIEWED_MOVE_SPEC_V2_REGISTRATIONS).toEqual(expect.arrayContaining([
      expect.objectContaining({ canonicalId: 'Tackle' }),
      expect.objectContaining({ canonicalId: 'Take Down' }),
    ]))
  })

  it.each(allTackleV2SemanticScenarios())(
    'proves $scenarioId through interpreter, planner, and accepted command',
    async (scenario) => {
      const result = await runAndAssertMoveAutomationSemanticScenario(scenario)
      expect([
        result.interpreter.status,
        result.plan.status,
        result.command.status,
      ]).toEqual(['completed', 'completed', 'completed'])
    },
  )
})

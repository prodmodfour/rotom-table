import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import type { CharacterSheet } from '~/types/characterSheet'
import {
  isAuthoritativePendingMoveStatePlan,
  planAuthoritativeMoveStateExecution,
} from '../../server/domain/planAuthoritativeMoveState'
import { isAuthoritativePendingMoveResolution } from '../../server/domain/resolveAuthoritativeMove'
import { resumeMoveSpec } from '../../server/domain/moveAutomation/resumeSpec'
import { planResumedMoveState } from '../../server/domain/moveAutomation/planResumedMoveState'
import { scratchV2PassHitFixture } from '../fixtures/moveAutomation/scratchV2'

const fixture = () => {
  const base = scratchV2PassHitFixture()
  const target = structuredClone(base.pokemonSheets.get('target')!)
  target.types = ['Normal']
  target.stats = { def: { added: 10 }, sdef: { added: 10 } }
  target.abilities = [{
    name: 'Absorb Force',
    automation: {
      schemaVersion: 1,
      instanceId: 'base:target:absorb-force',
      canonicalId: 'Absorb Force',
      definitionVersion: null,
      selections: [],
    },
  }]
  const actor = structuredClone(base.pokemonSheets.get('actor')!)
  actor.types = ['Normal']
  actor.stats = { atk: { added: 10 }, def: { added: 10 }, sdef: { added: 10 } }
  const encounter = createEmptyEncounterState()
  return {
    ...base,
    map: {
      ...base.map,
      encounterState: {
        ...encounter,
        history: { ...encounter.history, sceneId: 'scene:absorb-force' },
        turnResources: {
          'target-token': createEncounterTurnResourceLedger({ placementId: 'target-token', round: 1 }),
        },
      },
    },
    pokemonSheets: new Map<string, CharacterSheet>([
      ['actor', actor],
      ['target', target],
      ['blocker', base.pokemonSheets.get('blocker')!],
    ]),
  }
}

const declare = (operationId: string) => {
  const resources = fixture()
  const values = [...resources.randomValues]
  const declaration = planAuthoritativeMoveStateExecution({
    ...resources,
    random: () => values.shift() ?? 0,
    now: () => 1_000,
    operationId,
    pendingResolutionId: `resolution:${operationId}`,
  })
  expect(isAuthoritativePendingMoveStatePlan(declaration)).toBe(true)
  if (!isAuthoritativePendingMoveStatePlan(declaration)) throw new Error('Expected Absorb Force response.')
  return { resources, declaration }
}

const resume = (input: {
  readonly operationId: string
  readonly optionId: string | null
}) => {
  const { resources, declaration } = declare(input.operationId)
  const pending = declaration.suspension.pendingResolution
  const window = pending.outstandingWindows[0]!
  const execution = resumeMoveSpec({
    pendingResolution: structuredClone(pending),
    map: structuredClone(declaration.nextMap),
    pokemonSheets: resources.pokemonSheets,
    trainerSheets: resources.trainerSheets,
    response: { requestId: window.windowId, optionId: input.optionId },
    now: 2_000,
    random: () => 0,
  })
  expect(isAuthoritativePendingMoveResolution(execution)).toBe(false)
  if (isAuthoritativePendingMoveResolution(execution)) throw new Error('Expected completed Scratch.')
  const plan = planResumedMoveState({
    pendingResolution: pending,
    declarationPlan: declaration.suspension.preWindowPlan,
    responseOpId: `op_absorbresponse_${input.operationId.replaceAll(/[^a-z0-9]/gi, '').slice(-24)}`,
    responseWindowId: window.windowId,
    responseOptionId: input.optionId,
    chosenBy: { kind: 'target', id: 'target-token' },
    map: declaration.nextMap,
    pokemonSheets: resources.pokemonSheets,
    trainerSheets: resources.trainerSheets,
    execution,
    plannedAt: 2_000,
  })
  return { declaration, execution, plan, window }
}

describe('AA-060 Absorb Force durable trigger', () => {
  it('aa060.absorb-force.optional-resistance suspends privately, resists one step, and pays once', () => {
    const { declaration, execution, plan, window } = resume({
      operationId: 'op_absorb_force_select',
      optionId: 'ability.absorb-force.use',
    })
    expect(window).toMatchObject({
      kind: 'reaction',
      ownership: [{ kind: 'target', id: 'target-token' }],
      options: [{ id: 'ability.absorb-force.use' }],
      allowPass: true,
    })
    expect(declaration.nextMap.encounterState?.abilityUsage?.entries).toEqual([])
    expect(execution.auditTrace.events).toContainEqual(expect.objectContaining({
      kind: 'operation',
      reasonCode: 'ability.absorb-force.optional-resistance',
      recipientIds: ['target-token'],
      outcome: 'applied',
    }))
    expect(JSON.stringify(execution.auditTrace)).toContain('Absorb Force')
    expect(plan.nextMap.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      ownerId: 'target-token',
      abilityInstanceId: 'base:target:absorb-force',
      canonicalId: 'Absorb Force',
      limit: 1,
      spent: 1,
    }))
    expect(plan.nextMap.encounterState?.turnResources['target-token']?.actions.free.spent).toBe(1)
  }, 15_000)

  it('pass leaves type, usage, and action resources unchanged and reconnect replay is deterministic', () => {
    const first = resume({ operationId: 'op_absorb_force_pass', optionId: null })
    const second = resume({ operationId: 'op_absorb_force_pass', optionId: null })
    const selected = resume({ operationId: 'op_absorb_force_compare', optionId: 'ability.absorb-force.use' })
    const passedHp = first.execution.transaction.hpUpdates.find(update => update.id === 'target-token')?.currentHp
    const selectedHp = selected.execution.transaction.hpUpdates.find(update => update.id === 'target-token')?.currentHp
    expect(selectedHp).toBeGreaterThan(passedHp ?? 0)
    expect(first.plan.nextMap.encounterState?.abilityUsage?.entries).toEqual([])
    expect(first.plan.nextMap.encounterState?.turnResources['target-token']?.actions.free.spent).toBe(0)
    expect(second.execution.auditTrace).toEqual(first.execution.auditTrace)
  }, 15_000)
})

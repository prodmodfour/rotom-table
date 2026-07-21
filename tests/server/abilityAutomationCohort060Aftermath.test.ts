import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import type { CharacterSheet } from '~/types/characterSheet'
import { isAuthoritativePendingMoveStatePlan, planAuthoritativeMoveStateExecution } from '../../server/domain/planAuthoritativeMoveState'
import { isAuthoritativePendingMoveResolution } from '../../server/domain/resolveAuthoritativeMove'
import { resumeMoveSpec } from '../../server/domain/moveAutomation/resumeSpec'
import { planResumedMoveState } from '../../server/domain/moveAutomation/planResumedMoveState'
import { scratchV2PassHitFixture } from '../fixtures/moveAutomation/scratchV2'

const resources = (options: { readonly ability?: boolean; readonly faint?: boolean } = {}) => {
  const base = scratchV2PassHitFixture()
  const actor = structuredClone(base.pokemonSheets.get('actor')!)
  actor.types = ['Normal']
  actor.stats = { hp: { added: 20 }, atk: { added: 10 }, def: { added: 10 }, sdef: { added: 10 } }
  const target = structuredClone(base.pokemonSheets.get('target')!)
  target.types = ['Normal']
  target.stats = { hp: { added: 20 }, def: { added: 10 }, sdef: { added: 10 } }
  target.combat = { ...(target.combat ?? {}), currentHp: options.faint === false ? 100 : 1 }
  target.abilities = options.ability === false ? [] : [{
    name: 'Aftermath',
    automation: {
      schemaVersion: 1, instanceId: 'base:target:aftermath', canonicalId: 'Aftermath',
      definitionVersion: null, selections: [],
    },
  }]
  const encounter = createEmptyEncounterState()
  return {
    ...base,
    map: {
      ...base.map,
      encounterState: {
        ...encounter,
        history: { ...encounter.history, sceneId: 'scene:aftermath' },
        turnResources: {
          'target-token': createEncounterTurnResourceLedger({ placementId: 'target-token', round: 1 }),
        },
      },
    },
    pokemonSheets: new Map<string, CharacterSheet>([
      ['actor', actor], ['target', target], ['blocker', base.pokemonSheets.get('blocker')!],
    ]),
  }
}

const declare = (operationId: string, fixture = resources()) => {
  const draws = [...fixture.randomValues]
  return {
    fixture,
    declaration: planAuthoritativeMoveStateExecution({
      ...fixture,
      random: () => draws.shift() ?? 0,
      now: () => 1_000,
      operationId,
      pendingResolutionId: `resolution:${operationId}`,
    }),
  }
}

const finish = (optionId: string | null) => {
  const { fixture, declaration } = declare(`op_aftermath_${optionId ? 'use' : 'pass'}`)
  expect(isAuthoritativePendingMoveStatePlan(declaration)).toBe(true)
  if (!isAuthoritativePendingMoveStatePlan(declaration)) throw new Error('Expected Aftermath response.')
  const pending = declaration.suspension.pendingResolution
  const window = pending.outstandingWindows[0]!
  const execution = resumeMoveSpec({
    pendingResolution: structuredClone(pending), map: structuredClone(declaration.nextMap),
    pokemonSheets: fixture.pokemonSheets, trainerSheets: fixture.trainerSheets,
    response: { requestId: window.windowId, optionId }, now: 2_000, random: () => 0,
  })
  expect(isAuthoritativePendingMoveResolution(execution)).toBe(false)
  if (isAuthoritativePendingMoveResolution(execution)) throw new Error('Expected completed Aftermath move.')
  const plan = planResumedMoveState({
    pendingResolution: pending,
    declarationPlan: declaration.suspension.preWindowPlan,
    responseOpId: `op_aftermathresponse_${optionId ? 'use' : 'pass'}`,
    responseWindowId: window.windowId,
    responseOptionId: optionId,
    chosenBy: { kind: 'target', id: 'target-token' },
    map: declaration.nextMap,
    pokemonSheets: fixture.pokemonSheets,
    trainerSheets: fixture.trainerSheets,
    execution,
    plannedAt: 2_000,
  })
  return { declaration, execution, plan, window }
}

describe('AA-060 Aftermath durable trigger', () => {
  it('aa060.aftermath.fainted-burst offers on faint and applies a three-tick Burst 1', () => {
    const accepted = finish('ability.aftermath.use')
    expect(accepted.window).toMatchObject({
      kind: 'reaction', ownership: [{ kind: 'target', id: 'target-token' }],
      options: [{ id: 'ability.aftermath.use' }], allowPass: true,
    })
    expect(accepted.declaration.nextMap.encounterState?.abilityUsage?.entries).toEqual([])
    expect(accepted.execution.transaction.hpUpdates).toContainEqual(expect.objectContaining({ id: 'actor-token' }))
    expect(accepted.execution.auditTrace.events).toContainEqual(expect.objectContaining({
      kind: 'operation', reasonCode: 'ability.aftermath.three-tick-burst', outcome: 'applied',
      recipientIds: expect.arrayContaining(['actor-token', 'target-token']),
    }))
    expect(accepted.plan.nextMap.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      ownerId: 'target-token', canonicalId: 'Aftermath', abilityInstanceId: 'base:target:aftermath', spent: 1,
    }))
    expect(accepted.plan.nextMap.encounterState?.turnResources['target-token']?.actions.free.spent).toBe(1)
  }, 15_000)

  it('pass is a no-op and an absent source or non-fainting hit never opens the window', () => {
    const passed = finish(null)
    expect(passed.execution.transaction.hpUpdates.some(update => update.id === 'actor-token')).toBe(false)
    expect(passed.plan.nextMap.encounterState?.abilityUsage?.entries).toEqual([])

    for (const [id, fixture] of [
      ['op_aftermath_absent', resources({ ability: false })],
      ['op_aftermath_not_fainted', resources({ faint: false })],
    ] as const) {
      const result = declare(id, fixture).declaration
      expect(isAuthoritativePendingMoveStatePlan(result)).toBe(false)
    }
  }, 15_000)
})

import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import type { CharacterSheet } from '~/types/characterSheet'
import { isAuthoritativePendingMoveStatePlan, planAuthoritativeMoveStateExecution } from '../../server/domain/planAuthoritativeMoveState'
import { isAuthoritativePendingMoveResolution } from '../../server/domain/resolveAuthoritativeMove'
import { resumeMoveSpec } from '../../server/domain/moveAutomation/resumeSpec'
import { planResumedMoveState } from '../../server/domain/moveAutomation/planResumedMoveState'
import { scratchV2PassHitFixture } from '../fixtures/moveAutomation/scratchV2'

const resources = (options: { readonly critical?: boolean; readonly stage?: number; readonly preventCritical?: boolean } = {}) => {
  const base = scratchV2PassHitFixture()
  const actor = structuredClone(base.pokemonSheets.get('actor')!)
  actor.types = ['Normal']
  actor.stats = { atk: { added: 10 }, def: { added: 10 }, sdef: { added: 10 } }
  const target = structuredClone(base.pokemonSheets.get('target')!)
  target.types = ['Normal']
  target.stats = { atk: { added: 10 }, def: { added: 10 }, sdef: { added: 10 } }
  target.combatStages = { atk: options.stage ?? 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 }
  target.abilities = [
    {
      name: 'Anger Point',
      automation: {
        schemaVersion: 1, instanceId: 'base:target:anger-point', canonicalId: 'Anger Point',
        definitionVersion: null, selections: [],
      },
    },
    ...(options.preventCritical ? [{ name: 'Battle Armor' }] : []),
  ]
  const encounter = createEmptyEncounterState()
  return {
    ...base,
    map: {
      ...base.map,
      encounterState: {
        ...encounter,
        history: { ...encounter.history, sceneId: 'scene:anger-point' },
        turnResources: {
          'target-token': createEncounterTurnResourceLedger({ placementId: 'target-token', round: 1 }),
        },
      },
    },
    pokemonSheets: new Map<string, CharacterSheet>([
      ['actor', actor], ['target', target], ['blocker', base.pokemonSheets.get('blocker')!],
    ]),
    randomValues: [options.critical === false ? 0.5 : 0.999, 0],
  }
}

const declare = (operationId: string, fixture = resources()) => {
  const draws = [...fixture.randomValues]
  return {
    fixture,
    declaration: planAuthoritativeMoveStateExecution({
      ...fixture, random: () => draws.shift() ?? 0, now: () => 1_000,
      operationId, pendingResolutionId: `resolution:${operationId}`,
    }),
  }
}

const accept = (stage = 0) => {
  const { fixture, declaration } = declare(`op_angerpoint_${stage}`, resources({ stage }))
  expect(isAuthoritativePendingMoveStatePlan(declaration)).toBe(true)
  if (!isAuthoritativePendingMoveStatePlan(declaration)) throw new Error('Expected Anger Point response.')
  const pending = declaration.suspension.pendingResolution
  const window = pending.outstandingWindows[0]!
  const execution = resumeMoveSpec({
    pendingResolution: structuredClone(pending), map: structuredClone(declaration.nextMap),
    pokemonSheets: fixture.pokemonSheets, trainerSheets: fixture.trainerSheets,
    response: { requestId: window.windowId, optionId: 'ability.anger-point.use' },
    now: 2_000, random: () => 0,
  })
  expect(isAuthoritativePendingMoveResolution(execution)).toBe(false)
  if (isAuthoritativePendingMoveResolution(execution)) throw new Error('Expected completed Anger Point move.')
  const plan = planResumedMoveState({
    pendingResolution: pending, declarationPlan: declaration.suspension.preWindowPlan,
    responseOpId: `op_angerpointresponse_${stage}`,
    responseWindowId: window.windowId, responseOptionId: 'ability.anger-point.use',
    chosenBy: { kind: 'target', id: 'target-token' }, map: declaration.nextMap,
    pokemonSheets: fixture.pokemonSheets, trainerSheets: fixture.trainerSheets,
    execution, plannedAt: 2_000,
  })
  return { execution, plan, window }
}

describe('AA-060 Anger Point durable trigger', () => {
  it('aa060.anger-point.critical-stage-cap offers only on a critical and raises Attack once', () => {
    const accepted = accept(0)
    expect(accepted.window).toMatchObject({
      kind: 'reaction', ownership: [{ kind: 'target', id: 'target-token' }],
      options: [{ id: 'ability.anger-point.use' }], allowPass: true,
    })
    expect(accepted.execution.transaction.combatStageUpdates).toContainEqual(expect.objectContaining({
      id: 'target-token', stages: expect.objectContaining({ atk: 6 }),
    }))
    expect(accepted.execution.transaction.conditionUpdates).toContainEqual(expect.objectContaining({
      id: 'target-token', conditions: expect.arrayContaining(['Rage']),
    }))
    expect(accepted.plan.nextMap.encounterState?.abilityUsage?.entries).toEqual([])
    expect(accepted.plan.nextMap.encounterState?.turnResources['target-token']?.actions.free.spent).toBe(1)
  }, 15_000)

  it('caps at +6 and suppresses the response for ordinary or prevented critical hits', () => {
    const capped = accept(6)
    const cappedWrite = capped.plan.sheetWrites.find(write => write.slug === 'target')
    expect((cappedWrite?.nextSheet as CharacterSheet | undefined)?.combatStages?.atk).toBe(6)

    for (const [id, fixture] of [
      ['op_angerpoint_normal', resources({ critical: false })],
      ['op_angerpoint_prevented', resources({ preventCritical: true })],
    ] as const) {
      expect(isAuthoritativePendingMoveStatePlan(declare(id, fixture).declaration)).toBe(false)
    }
  }, 15_000)
})

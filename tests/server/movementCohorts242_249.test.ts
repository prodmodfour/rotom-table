import { describe, expect, it } from 'vitest'
import manifestJson from '../../data/move-automation/manifest.json'
import {
  MOVEMENT_242_249_HANDLER_REGISTRATION,
} from '~~/server/domain/moveAutomation/handlers/movement242_249'
import {
  REGISTERED_MOVE_HANDLER_REGISTRY,
  validateRegisteredMoveHandlerOutput,
} from '~~/server/domain/moveAutomation/handlers/registry'
import { registeredMoveAutomationRuntimeFor } from '~~/server/domain/moveAutomation/registry'
import {
  MA_242_249_MOVE_NAMES,
  MOVEMENT_COHORTS_242_249_MOVE_SPEC_REGISTRATIONS,
  type MovementCohort242249MoveName,
} from '~~/server/domain/moveAutomation/specs/movementCohorts242_249'
import { validateMoveSpec } from '~~/server/domain/moveAutomation/validateSpec'
import { MA_242_249_SCENARIOS_BY_MOVE } from '../fixtures/moveAutomation/movementCohorts242_249'

const context = {
  map: { voxels: [], initiative: { round: 2 } },
  actor: {
    placement: { id: 'actor', position: { x: 0, y: 0, z: 0 } },
    token: { injuries: 1 },
  },
  candidatePlacements: [],
  selectedPlacements: [{ id: 'target', position: { x: 1, y: 0, z: 0 } }],
  resolvedSheets: [], ruleset: {}, reads: { recordPlacement: () => undefined },
  queries: {
    tokens: { get: () => ({ fullMaxHp: 100, maxHp: 100 }) },
    targetStates: { resolve: (id: string) => ({
      conditionIds: id === 'actor' ? ['burned'] : [],
      weightClass: id === 'actor' ? 4 : 2,
      damagedThisRound: true,
      semiInvulnerable: 'none',
    }) },
    resources: { setupExecuteState: () => null },
    history: { lastCompletedMove: () => null, consecutiveUseCount: () => 0 },
  },
}
const run = (moveName: string) => validateRegisteredMoveHandlerOutput(
  MOVEMENT_242_249_HANDLER_REGISTRATION.run({ ...context, intent: { moveName } } as never),
)

describe('MA-242 through MA-249 movement and switch cohorts', () => {
  it('registers exactly 64 reviewed definitions with matching hashes', () => {
    expect(MOVEMENT_COHORTS_242_249_MOVE_SPEC_REGISTRATIONS.map(value => value.canonicalId))
      .toEqual(MA_242_249_MOVE_NAMES)
    expect(new Set(MA_242_249_MOVE_NAMES).size).toBe(64)
    for (const registration of MOVEMENT_COHORTS_242_249_MOVE_SPEC_REGISTRATIONS) {
      const name = registration.canonicalId as MovementCohort242249MoveName
      const row = manifestJson.moves.find(value => value.canonicalId === name)!
      const definition = validateMoveSpec(registration.spec, {
        capabilityIds: row.capabilityTags,
        rulesetVersion: row.rulesProvenance,
        handlerRegistry: REGISTERED_MOVE_HANDLER_REGISTRY,
      })
      expect(row.runtime.definitionHash).toBe(definition.definitionHash)
      expect(row.baseStatus).toBe('complete')
      expect(row.scenarioIds).toEqual(MA_242_249_SCENARIOS_BY_MOVE[name].map(value => value.scenarioId))
      expect(registeredMoveAutomationRuntimeFor(name)?.definitionHash).toBe(definition.definitionHash)
    }
  })

  it('emits strict canonical programs for every movement cohort move', () => {
    for (const moveName of MA_242_249_MOVE_NAMES) {
      expect(() => run(moveName), moveName).not.toThrow()
      expect(run(moveName).operations.length, moveName).toBeGreaterThan(0)
    }
  })

  it('encodes authoritative push distances, recoil/drain, and contextual weight', () => {
    expect(run('Circle Throw').operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'circle-throw.push', kind: 'movement-request', payload: expect.objectContaining({ distance: 4 }) }),
    ]))
    expect(run('Brave Bird').operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'brave-bird.push', kind: 'movement-request' }),
      expect.objectContaining({ id: 'brave-bird.recoil', kind: 'direct-hp' }),
    ]))
    expect(run('Horn Leech').operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'horn-leech.drain', kind: 'heal' }),
    ]))
    expect(run('Heat Crash').operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'heat-crash.damage', payload: expect.objectContaining({ damageBase: 8 }) }),
    ]))
  })

  it('encodes switch, semi-invulnerable setup, cleanup, and destination requests', () => {
    expect(run('Baton Pass').operations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'switch-request',
        payload: expect.objectContaining({ required: true, stateTransferPolicy: 'baton-pass' }),
      }),
    ]))
    expect(run('Dig').operations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'dig.semi-user', kind: 'temporary-effect',
        payload: expect.objectContaining({ definition: expect.objectContaining({
          payload: { capabilityId: 'movement.semi-invulnerable.underground', action: 'grant' },
        }) }),
      }),
    ]))
    expect(run('Rapid Spin').operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'rapid-spin.remove-hazards', kind: 'field' }),
      expect.objectContaining({ id: 'rapid-spin.clear-movement-conditions', kind: 'condition' }),
    ]))
    expect(run('Splash').operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'splash.shift', kind: 'movement-request', payload: expect.objectContaining({ choice: expect.objectContaining({ kind: 'destination' }) }) }),
    ]))
  })
})

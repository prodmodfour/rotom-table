import { describe, expect, it } from 'vitest'
import manifestJson from '../../data/move-automation/manifest.json'
import { parseMoveEffectOperation } from '#shared/moveAutomation/effects'
import {
  PERSISTENT_234_241_HANDLER_REGISTRATION,
} from '~~/server/domain/moveAutomation/handlers/persistent234_241'
import {
  REGISTERED_MOVE_HANDLER_REGISTRY,
  validateRegisteredMoveHandlerOutput,
} from '~~/server/domain/moveAutomation/handlers/registry'
import {
  registeredMoveAutomationRuntimeFor,
  REVIEWED_MOVE_SPEC_V2_REGISTRATIONS,
} from '~~/server/domain/moveAutomation/registry'
import {
  MA_234_241_MOVE_NAMES,
  PERSISTENT_COHORTS_234_241_MOVE_SPEC_REGISTRATIONS,
  type PersistentCohort234241MoveName,
} from '~~/server/domain/moveAutomation/specs/persistentCohorts234_241'
import { validateMoveSpec } from '~~/server/domain/moveAutomation/validateSpec'
import { MA_234_241_SCENARIOS_BY_MOVE } from '../fixtures/moveAutomation/persistentCohorts234_241'

const completed = [{ canonicalId: 'Stockpile', resolutionId: 'stockpile.one' }]
const context = {
  map: { initiative: { round: 2 }, voxels: [] },
  actor: {
    placement: { id: 'actor', sheetSlug: 'actor', position: { x: 0, y: 0, z: 0 }, sideId: 'heroes' },
    token: {},
  },
  candidatePlacements: [],
  selectedPlacements: [{ id: 'target', position: { x: 1, y: 0, z: 0 }, sideId: 'foes' }],
  resolvedSheets: [], ruleset: {}, reads: { recordPlacement: () => undefined },
  queries: {
    targetStates: { resolve: (id: string) => ({
      conditionIds: id === 'target' ? ['sleep'] : [],
      typeIds: id === 'actor' ? ['ghost', 'flying'] : ['normal'],
      weightClass: 3,
    }) },
    tokens: { get: () => ({ abilityNames: ['Pressure', 'Levitate'] }) },
    history: {
      lastDamagingMoveReceived: () => ({ moveType: 'fire' }),
      completedMovesThisScene: () => completed,
      lastCompletedMove: () => null,
    },
    rules: { legacyScriptFor: () => null },
    abilities: { has: () => false },
    creatureRules: { hasCapability: () => false },
    relationships: { resolve: () => ({ relationship: 'ally' }) },
  },
}

const run = (moveName: string) => validateRegisteredMoveHandlerOutput(
  PERSISTENT_234_241_HANDLER_REGISTRATION.run({
    ...context, intent: { moveName },
  } as never),
)

describe('MA-234 through MA-241 persistent and delayed-effect cohorts', () => {
  it('registers exactly 61 reviewed definitions with matching hashes', () => {
    expect(PERSISTENT_COHORTS_234_241_MOVE_SPEC_REGISTRATIONS.map(value => value.canonicalId))
      .toEqual(MA_234_241_MOVE_NAMES)
    expect(new Set(MA_234_241_MOVE_NAMES).size).toBe(61)
    for (const registration of PERSISTENT_COHORTS_234_241_MOVE_SPEC_REGISTRATIONS) {
      const moveName = registration.canonicalId as PersistentCohort234241MoveName
      const row = manifestJson.moves.find(value => value.canonicalId === moveName)!
      const definition = validateMoveSpec(registration.spec, {
        capabilityIds: row.capabilityTags,
        rulesetVersion: row.rulesProvenance,
        handlerRegistry: REGISTERED_MOVE_HANDLER_REGISTRY,
      })
      expect(row.runtime).toMatchObject({
        kind: 'movespec-v2', version: 2,
        definitionHash: definition.definitionHash,
        sourceModule: registration.sourceModule,
      })
      expect(row).toMatchObject({ baseStatus: 'complete', blockerCodes: [], limitations: [], manualSteps: [] })
      expect(row.scenarioIds).toEqual(MA_234_241_SCENARIOS_BY_MOVE[moveName].map(value => value.scenarioId))
      expect(registeredMoveAutomationRuntimeFor(moveName)?.definitionHash).toBe(definition.definitionHash)
      expect(REVIEWED_MOVE_SPEC_V2_REGISTRATIONS.filter(value => value.canonicalId === moveName)).toHaveLength(1)
    }
  })

  it('emits strict canonical operation programs for every contextual move', () => {
    for (const moveName of MA_234_241_MOVE_NAMES) {
      expect(() => run(moveName), moveName).not.toThrow()
      expect(run(moveName).operations.length, moveName).toBeGreaterThan(0)
    }
  })

  it('encodes type and ability overlays as durable server-owned choices', () => {
    expect(run('Conversion').operations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'conversion.become-normal', kind: 'temporary-effect',
        payload: expect.objectContaining({ definition: expect.objectContaining({
          payload: expect.objectContaining({ domain: 'type', values: ['normal'] }),
        }) }),
      }),
    ]))
    const core = run('Core Enforcer').operations
    expect(core).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'core-enforcer.choose-ability', kind: 'branch' }),
      expect.objectContaining({ id: 'core-enforcer.suppress-ability-1', kind: 'temporary-effect' }),
    ]))
  })

  it('encodes delayed markers, bounded Vortexes, stockpile coupling, and Substitute HP', () => {
    expect(run('Doom Desire').operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'doom-desire.delayed-attack', kind: 'temporary-effect' }),
    ]))
    expect(run('Snap Trap').operations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'snap-trap.vortex', kind: 'temporary-effect',
        payload: expect.objectContaining({ definition: expect.objectContaining({
          kind: 'vortex', payload: expect.objectContaining({ escapeDcs: [23, 17, 11, 5] }),
        }) }),
      }),
    ]))
    expect(run('Spit Up').operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'spit-up.damage', payload: expect.objectContaining({ damageBase: 8 }) }),
    ]))
    const substitute = run('Substitute').operations.map(value => parseMoveEffectOperation(value))
    expect(substitute).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'substitute.hp-cost', kind: 'direct-hp' }),
      expect.objectContaining({ id: 'substitute.temporary-hp', kind: 'heal' }),
    ]))
  })

  it('makes Mind Reader automatically miss an effective Mindlock target', () => {
    const ordinary = run('Mind Reader')
    expect(ordinary.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'mind-reader.read', kind: 'temporary-effect' }),
    ]))

    const blocked = validateRegisteredMoveHandlerOutput(
      PERSISTENT_234_241_HANDLER_REGISTRATION.run({
        ...context,
        intent: { moveName: 'Mind Reader' },
        queries: {
          ...context.queries,
          creatureRules: { hasCapability: (placementId: string, canonicalId: string) => (
            placementId === 'target' && canonicalId === 'Mindlock'
          ) },
        },
      } as never),
    )
    expect(blocked.operations).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'mind-reader.read' }),
    ]))
    expect(blocked.traceEntries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        outcome: false,
        reasonCode: 'capability.mindlock.mind-reader-auto-miss',
      }),
    ]))
  })

  it('encodes alternate defenses, sacrifice heals, and miss branches structurally', () => {
    expect(run('Psyshock').operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'psyshock.damage', payload: expect.objectContaining({
        defenseStat: expect.objectContaining({ stat: 'defense' }),
      }) }),
    ]))
    expect(run('Healing Wish').operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'healing-wish.self-faint', kind: 'direct-hp' }),
      expect.objectContaining({ id: 'healing-wish.full-heal', kind: 'heal' }),
    ]))
    expect(run('Sing').operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ recipients: { kind: 'hit-targets' }, kind: 'condition' }),
      expect.objectContaining({ recipients: { kind: 'missed-targets' }, kind: 'condition' }),
    ]))
  })
})

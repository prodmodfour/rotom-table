import { describe, expect, it } from 'vitest'
import manifestJson from '../../data/move-automation/manifest.json'
import menuStatusJson from '../../data/move-automation/menu-status.json'
import { parseMoveEffectOperation } from '#shared/moveAutomation/effects'
import { nativeMoveAutomationPresentationScriptForMove } from '~/utils/move-automation/nativePresentation'
import {
  FIELD_HAZARD_226_233_HANDLER_REGISTRATION,
} from '~~/server/domain/moveAutomation/handlers/fieldHazard226_233'
import {
  REGISTERED_MOVE_HANDLER_REGISTRY,
  validateRegisteredMoveHandlerOutput,
} from '~~/server/domain/moveAutomation/handlers/registry'
import {
  registeredMoveAutomationRuntimeFor,
  REVIEWED_MOVE_SPEC_V2_REGISTRATIONS,
} from '~~/server/domain/moveAutomation/registry'
import {
  ACID_ARMOR_MOVE_SPEC,
  AURORA_VEIL_MOVE_SPEC,
  BARRIER_MOVE_SPEC,
  BLIZZARD_MOVE_SPEC,
  BURN_UP_MOVE_SPEC,
  COURT_CHANGE_MOVE_SPEC,
  FIELD_HAZARD_COHORTS_226_233_MOVE_SPEC_REGISTRATIONS,
  GRASSY_TERRAIN_MOVE_SPEC,
  MA_226_233_MOVE_NAMES,
  SPIKES_MOVE_SPEC,
  STONE_AXE_MOVE_SPEC,
  TAILWIND_MOVE_SPEC,
  TRICK_ROOM_MOVE_SPEC,
  type FieldHazardCohort226233MoveName,
} from '~~/server/domain/moveAutomation/specs/fieldHazardCohorts226_233'
import { validateMoveSpec } from '~~/server/domain/moveAutomation/validateSpec'
import { MA_226_233_SCENARIOS_BY_MOVE } from '../fixtures/moveAutomation/fieldHazardCohorts226_233'

const operations = (spec: typeof GRASSY_TERRAIN_MOVE_SPEC) => spec.phases.flatMap(
  block => block.operations.map(operation => parseMoveEffectOperation(operation)),
)
const operation = (spec: typeof GRASSY_TERRAIN_MOVE_SPEC, id: string) => (
  operations(spec).find(candidate => candidate.id === id)
)

describe('MA-226 through MA-233 field, weather, hazard, and coat cohorts', () => {
  it('registers exactly 54 reviewed definitions with matching hashes and evidence', () => {
    expect(FIELD_HAZARD_COHORTS_226_233_MOVE_SPEC_REGISTRATIONS.map(value => value.canonicalId))
      .toEqual(MA_226_233_MOVE_NAMES)
    expect(new Set(MA_226_233_MOVE_NAMES).size).toBe(54)
    for (const registration of FIELD_HAZARD_COHORTS_226_233_MOVE_SPEC_REGISTRATIONS) {
      const moveName = registration.canonicalId as FieldHazardCohort226233MoveName
      const row = manifestJson.moves.find(value => value.canonicalId === moveName)!
      const definition = validateMoveSpec(registration.spec, {
        capabilityIds: row.capabilityTags,
        rulesetVersion: row.rulesProvenance,
        handlerRegistry: REGISTERED_MOVE_HANDLER_REGISTRY,
      })
      expect(row).toMatchObject({
        baseStatus: 'complete', blockerCodes: [], limitations: [], manualSteps: [],
        runtime: {
          kind: 'movespec-v2', version: 2, definitionHash: definition.definitionHash,
          sourceModule: registration.sourceModule,
        },
      })
      expect(row.scenarioIds).toEqual(
        MA_226_233_SCENARIOS_BY_MOVE[moveName].map(value => value.scenarioId),
      )
      expect(registeredMoveAutomationRuntimeFor(moveName)?.definitionHash)
        .toBe(definition.definitionHash)
      expect(REVIEWED_MOVE_SPEC_V2_REGISTRATIONS.filter(value => value.canonicalId === moveName))
        .toHaveLength(1)
    }
  })

  it('publishes complete browser-safe metadata for every move', () => {
    for (const moveName of MA_226_233_MOVE_NAMES) {
      expect(menuStatusJson.moves.find(value => value.canonicalId === moveName)).toMatchObject({
        baseStatus: 'complete', runtimeKind: 'movespec-v2', blockerCodes: [],
      })
      expect(nativeMoveAutomationPresentationScriptForMove(moveName)).toMatchObject({
        automationNotes: [],
      })
    }
  })

  it('encodes global fields, side effects, setup costs, and durable cell selection', () => {
    expect(operation(GRASSY_TERRAIN_MOVE_SPEC, 'grassy-terrain.apply-grassy')).toMatchObject({
      kind: 'field', payload: { action: 'apply', category: 'terrain', fieldId: 'grassy', rounds: 5 },
    })
    expect(operation(TRICK_ROOM_MOVE_SPEC, 'trick-room.apply-trick')).toMatchObject({
      kind: 'field', payload: { category: 'room', fieldId: 'trick' },
    })
    expect(operation(COURT_CHANGE_MOVE_SPEC, 'court-change.swap-sides')).toMatchObject({
      kind: 'field', payload: { action: 'mutate', mutation: { kind: 'swap-sides' } },
    })
    expect(operation(SPIKES_MOVE_SPEC, 'spikes.place-hazard')).toMatchObject({
      kind: 'hazard',
      payload: {
        effectId: 'spikes',
        geometry: { kind: 'selection', count: { kind: 'exact', count: 8 } },
        cellSelection: { range: 6, occupancy: 'empty-of-placements' },
      },
    })
    expect(operation(BARRIER_MOVE_SPEC, 'barrier.place-hazard')).toMatchObject({
      kind: 'hazard', payload: { geometry: { count: { count: 4 } } },
    })
    expect(ACID_ARMOR_MOVE_SPEC.costs.map(value => value.cost)).toEqual([
      { kind: 'action-resource', resource: 'standard', amount: 1 },
      { kind: 'setup-execute', step: 'auto' },
    ])
  })

  it('encodes finite blessings, side initiative, thresholds, and optional Vortex', () => {
    expect(operation(AURORA_VEIL_MOVE_SPEC, 'aurora-veil.blessing')).toMatchObject({
      kind: 'temporary-effect',
      payload: {
        recipientScope: 'actor-side',
        definition: {
          charges: 2,
          payload: { attribute: 'damage-reduction', operation: 'resist-step', damageClass: 'any' },
        },
      },
    })
    expect(operation(TAILWIND_MOVE_SPEC, 'tailwind.initiative')).toMatchObject({
      kind: 'temporary-effect', payload: { definition: { payload: { attribute: 'initiative', value: 5 } } },
    })
    expect(operation(STONE_AXE_MOVE_SPEC, 'stone-axe.choose-vortex')).toMatchObject({
      kind: 'branch', payload: { kind: 'choice', requestId: 'stone-axe.vortex' },
    })
    expect(BLIZZARD_MOVE_SPEC.registeredHandlerId).toBe('ma226-233.field-hazard-context')
    expect(BURN_UP_MOVE_SPEC.registeredHandlerId).toBe('ma226-233.field-hazard-context')
  })

  it('validates authoritative contextual handler outputs across field branches', () => {
    const context = {
      map: { initiative: { round: 2 }, voxels: [] },
      actor: {
        placement: { id: 'actor', position: { x: 0, y: 0, z: 0 }, sideId: 'heroes' },
        token: {},
      },
      candidatePlacements: [],
      selectedPlacements: [{ id: 'target', position: { x: 1, y: 0, z: 0 }, sideId: 'foes' }],
      resolvedSheets: [], ruleset: {}, reads: { recordPlacement: () => undefined },
      queries: {
        targetStates: { resolve: (id: string) => ({
          conditionIds: id === 'target' ? ['poisoned'] : [], typeIds: ['fire'],
          weightClass: 3, actedThisRound: false,
        }) },
        tokens: { get: () => ({}) },
        terrain: { membership: () => ({ terrains: [] }) },
        weather: {
          active: () => [], healing: () => ({ percent: 50 }),
          charge: () => ({ setup: 'required', damageBaseOverride: null }),
        },
        resources: { setupExecuteState: () => null },
        history: { lastCompletedMove: () => null },
        relationships: { resolve: () => ({ relationship: 'ally' }) },
      },
    }
    const run = (moveName: string) => validateRegisteredMoveHandlerOutput(
      FIELD_HAZARD_226_233_HANDLER_REGISTRATION.run({
        ...context, intent: { moveName },
      } as never),
    )

    expect(run('Blizzard').operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'blizzard.damage', kind: 'damage' }),
      expect.objectContaining({ id: 'blizzard.frozen', kind: 'condition' }),
    ]))
    expect(run('Bitter Malice').operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'bitter-malice.choose-alternate', kind: 'branch' }),
      expect.objectContaining({ id: 'bitter-malice.damage-boosted', kind: 'damage' }),
    ]))
    expect(run('Geomancy').operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'geomancy.rough-terrain', kind: 'hazard' }),
    ]))
    expect(run('Camouflage').operations.find(value => value.kind === 'temporary-effect'))
      .toMatchObject({ payload: { definition: { payload: { domain: 'type', values: ['normal'] } } } })
  })
})

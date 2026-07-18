import { describe, expect, it } from 'vitest'
import manifestJson from '../../data/move-automation/manifest.json'
import legacyFingerprintsJson from '../../data/move-automation/legacy-v1-fingerprints.json'
import type { MoveAutomationManifest } from '#shared/moveAutomation/manifest'
import { scratchV2PassHitFixture } from '../fixtures/moveAutomation/scratchV2'
import { planAuthoritativeMoveState } from '~~/server/domain/planAuthoritativeMoveState'
import {
  createFiniteAuthoritativeMoveRandomStream,
} from '~~/server/domain/moveAutomation/random'
import {
  createMoveAutomationRuntimeRegistry,
  registeredMoveAutomationRuntimeFor,
  REVIEWED_MOVE_SPEC_V2_REGISTRATIONS,
} from '~~/server/domain/moveAutomation/registry'
import { SCRATCH_MOVE_SPEC } from '~~/server/domain/moveAutomation/specs/scratch'
import {
  EXPLICIT_MOVE_AUTOMATION_REGISTRY_SOURCES,
} from '~/utils/move-automation/registry'

const scratchRow = manifestJson.moves.find(row => row.canonicalId === 'Scratch')!
const scratchLegacy = legacyFingerprintsJson.entries
  .find(entry => entry.canonicalId === 'Scratch')!

const runtimeRegistry = (kind: 'legacy-v1' | 'movespec-v2') => {
  const manifest = structuredClone(manifestJson) as unknown as MoveAutomationManifest
  const row = manifest.moves.find(item => item.canonicalId === 'Scratch')!
  if (kind === 'legacy-v1') {
    ;(row as { runtime: unknown }).runtime = {
      kind,
      version: scratchLegacy.version,
      definitionHash: scratchLegacy.definitionHash,
      sourceModule: scratchLegacy.sourceModule,
    }
  }
  return createMoveAutomationRuntimeRegistry({
    manifest,
    legacySources: EXPLICIT_MOVE_AUTOMATION_REGISTRY_SOURCES,
    moveSpecs: REVIEWED_MOVE_SPEC_V2_REGISTRATIONS,
  })
}

const plan = (kind: 'legacy-v1' | 'movespec-v2') => {
  const fixture = scratchV2PassHitFixture()
  return planAuthoritativeMoveState({
    ...fixture,
    random: createFiniteAuthoritativeMoveRandomStream(fixture.randomValues),
    now: () => 5_000,
    operationId: 'op_scratchv2test',
    runtimeRegistry: runtimeRegistry(kind),
  })
}

const mechanicsMap = (value: ReturnType<typeof plan>['nextMap']) => {
  const clone = structuredClone(value)
  delete clone.metadata
  return clone
}

describe('Scratch native MoveSpec v2', () => {
  it('registers the reviewed definition selected by the one manifest row', () => {
    expect(scratchRow.runtime).toEqual({
      kind: 'movespec-v2',
      version: 2,
      definitionHash: 'f5c5ec2eb2e430bf9ce325c5bd1ba7fc9c1e7fcbb2f5408729f3301385de0681',
      sourceModule: 'server/domain/moveAutomation/specs/scratch.ts',
    })
    expect(scratchRow.scenarioIds).toContain('scratch.v2-pass-hit')
    expect(registeredMoveAutomationRuntimeFor('Scratch')).toMatchObject({
      kind: 'movespec-v2',
      definition: { spec: SCRATCH_MOVE_SPEC },
      definitionHash: scratchRow.runtime.definitionHash,
    })
  })

  it('shadow-plans v1 and v2 to the same authoritative mechanics before selecting v2', () => {
    const legacy = plan('legacy-v1')
    const native = plan('movespec-v2')

    expect(mechanicsMap(native.nextMap)).toEqual(mechanicsMap(legacy.nextMap))
    expect(native.sheetWrites).toEqual(legacy.sheetWrites)
    expect(native.previousUsage).toEqual(legacy.previousUsage)
    expect(native.usage).toEqual(legacy.usage)
    expect(native.resolution.selectedTargetIds).toEqual(legacy.resolution.selectedTargetIds)
    expect(native.resolution.transaction.attackedTargetIds)
      .toEqual(legacy.resolution.transaction.attackedTargetIds)
    expect(native.resolution.transaction.hitTargetIds)
      .toEqual(legacy.resolution.transaction.hitTargetIds)
    expect(native.resolution.movement).toEqual(legacy.resolution.movement)

    expect(legacy.resolution.auditTrace.program.runtimeKind).toBe('legacy-v1')
    expect(native.resolution.auditTrace.program).toEqual({
      canonicalId: 'Scratch',
      runtimeKind: 'movespec-v2',
      runtimeVersion: 2,
      definitionHash: scratchRow.runtime.definitionHash,
    })
    expect(native.resolution.rollLedger.map(roll => roll.rollId)).toEqual([
      'scratch.accuracy-roll.1',
      'scratch.damage.roll.1',
    ])
    expect(native.stateChanges.changes.map(change => [change.kind, change.sourceOperationId])).toEqual([
      ['sheet-state', 'scratch.damage'],
      ['placement-state', 'scratch.pass-movement'],
      ['map-metadata', 'scratch.log-completed'],
      ['encounter-state', 'op_scratchv2test'],
    ])
    expect(native.nextMap.encounterState?.turnResources['actor-token']).toMatchObject({
      actions: { standard: { spent: 1 } },
      movement: { spent: 3 },
      oncePerTurnFlags: [
        { id: 'encounter.acted-since-entry', sourceOperationId: 'op_scratchv2test' },
        { id: 'move.scratch', sourceOperationId: 'op_scratchv2test' },
      ],
    })
    expect(native.nextMap.metadata?.moveLog).toEqual([
      expect.objectContaining({
        moveName: 'Scratch',
        scriptKind: 'movespec-v2',
        scriptVersion: 2,
        definitionHash: scratchRow.runtime.definitionHash,
      }),
    ])
    expect('nativeV2' in native.resolution).toBe(false)
  })

  it('keeps rollback to legacy execution as a manifest-only runtime selection', () => {
    const legacyRegistry = runtimeRegistry('legacy-v1')
    const selected = legacyRegistry.resolve('Scratch')

    expect(selected).toMatchObject({
      kind: 'legacy-v1',
      version: scratchLegacy.version,
      definitionHash: scratchLegacy.definitionHash,
      sourceModule: scratchLegacy.sourceModule,
    })
    expect(REVIEWED_MOVE_SPEC_V2_REGISTRATIONS).toContainEqual(
      expect.objectContaining({ canonicalId: 'Scratch' }),
    )
  })
})

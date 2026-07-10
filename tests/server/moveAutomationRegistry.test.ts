import { describe, expect, it } from 'vitest'
import manifestJson from '../../data/move-automation/manifest.json'
import {
  MoveAutomationManifestValidationError,
  type MoveAutomationManifest,
} from '#shared/moveAutomation/manifest'
import {
  EXPLICIT_MOVE_AUTOMATION_REGISTRY_SOURCES,
  EXPLICIT_MOVE_AUTOMATION_SCRIPTS,
  type ExplicitMoveAutomationRegistrySource,
} from '~/utils/move-automation/registry'
import {
  MOVE_AUTOMATION_RUNTIME_REGISTRY,
  MoveAutomationRuntimeRegistryValidationError,
  createMoveAutomationRuntimeRegistry,
  registeredMoveAutomationRuntimeFor,
  type MoveSpecV2Registration,
} from '~~/server/domain/moveAutomation/registry'
import { validateMoveSpec } from '~~/server/domain/moveAutomation/validateSpec'

const scratchManifestRow = manifestJson.moves.find(row => row.canonicalId === 'Scratch')!
const scratchScript = EXPLICIT_MOVE_AUTOMATION_SCRIPTS.get('Scratch')!
const scratchLegacySource = EXPLICIT_MOVE_AUTOMATION_REGISTRY_SOURCES
  .find(({ scripts }) => scripts.has('Scratch'))!

const manifestForScratch = (): MoveAutomationManifest => ({
  schemaVersion: 2,
  moves: [structuredClone(scratchManifestRow)],
}) as unknown as MoveAutomationManifest

const legacySourcesForScratch = (): readonly ExplicitMoveAutomationRegistrySource[] => [{
  sourceModule: scratchLegacySource.sourceModule,
  scripts: new Map([['Scratch', scratchScript]]),
}]

const scratchSpec = () => ({
  schemaVersion: 2,
  canonicalId: 'Scratch',
  version: 2,
  targeting: {
    kind: 'none',
    minTargets: 0,
    maxTargets: 0,
    selector: null,
  },
  preconditions: [],
  costs: [],
  phases: [],
  registeredHandlerId: null,
  presentation: {
    displayName: 'Scratch',
    vfxKey: null,
    tags: ['test-only'],
  },
})

const TEST_SPEC_SOURCE = 'tests/fixtures/moveAutomation/scratch.test-spec.ts'

const scratchV2Registration = (): MoveSpecV2Registration => ({
  canonicalId: 'Scratch',
  sourceModule: TEST_SPEC_SOURCE,
  spec: scratchSpec(),
})

const manifestSelectingScratchV2 = (): {
  manifest: MoveAutomationManifest
  definitionHash: string
} => {
  const manifest = manifestForScratch()
  const row = manifest.moves[0]!
  const definition = validateMoveSpec(scratchSpec(), {
    capabilityIds: row.capabilityTags,
    rulesetVersion: row.rulesProvenance,
  })
  ;(row as { runtime: unknown }).runtime = {
    kind: 'movespec-v2',
    version: definition.spec.version,
    definitionHash: definition.definitionHash,
    sourceModule: TEST_SPEC_SOURCE,
  }
  return { manifest, definitionHash: definition.definitionHash }
}

describe('authoritative move automation dual-runtime registry', () => {
  it('keeps all 258 reviewed v1 scripts selected with their exact existing definitions', () => {
    expect(MOVE_AUTOMATION_RUNTIME_REGISTRY.size).toBe(EXPLICIT_MOVE_AUTOMATION_SCRIPTS.size)
    expect(MOVE_AUTOMATION_RUNTIME_REGISTRY.entries()).toHaveLength(
      EXPLICIT_MOVE_AUTOMATION_SCRIPTS.size,
    )

    for (const row of manifestJson.moves) {
      const selected = registeredMoveAutomationRuntimeFor(row.canonicalId)
      if (row.runtime.kind === 'legacy-v1') {
        expect(selected).toMatchObject({
          canonicalId: row.canonicalId,
          kind: 'legacy-v1',
          version: row.runtime.version,
          definitionHash: row.runtime.definitionHash,
          sourceModule: row.runtime.sourceModule,
        })
        expect(selected?.kind === 'legacy-v1' ? selected.script : null)
          .toBe(EXPLICIT_MOVE_AUTOMATION_SCRIPTS.get(row.canonicalId))
      }
      else {
        expect(selected).toBeNull()
      }
    }
  })

  it('keeps an unselected v2 definition inert and selects it only after server manifest review', () => {
    const legacyManifest = manifestForScratch()
    const withUnselectedV2 = createMoveAutomationRuntimeRegistry({
      manifest: legacyManifest,
      legacySources: legacySourcesForScratch(),
      moveSpecs: [scratchV2Registration()],
    })

    expect(withUnselectedV2.resolve('Scratch')).toMatchObject({
      kind: 'legacy-v1',
      script: scratchScript,
    })
    expect(withUnselectedV2.resolve('scratch')).toBeNull()

    const { manifest, definitionHash } = manifestSelectingScratchV2()
    const selectedV2 = createMoveAutomationRuntimeRegistry({
      manifest,
      legacySources: legacySourcesForScratch(),
      moveSpecs: [scratchV2Registration()],
    }).resolve('Scratch')

    expect(selectedV2).toMatchObject({
      canonicalId: 'Scratch',
      kind: 'movespec-v2',
      version: 2,
      definitionHash,
      sourceModule: TEST_SPEC_SOURCE,
      definition: {
        spec: { canonicalId: 'Scratch', version: 2 },
      },
    })
  })

  it('rejects duplicate IDs and registration/spec identity mismatches', () => {
    expect(() => createMoveAutomationRuntimeRegistry({
      manifest: manifestForScratch(),
      legacySources: legacySourcesForScratch(),
      moveSpecs: [scratchV2Registration(), scratchV2Registration()],
    })).toThrowError(expect.objectContaining({
      name: MoveAutomationRuntimeRegistryValidationError.name,
      code: 'duplicate-id',
      canonicalId: 'Scratch',
    }))

    expect(() => createMoveAutomationRuntimeRegistry({
      manifest: manifestForScratch(),
      legacySources: legacySourcesForScratch(),
      moveSpecs: [{
        ...scratchV2Registration(),
        canonicalId: 'Tackle',
      }],
    })).toThrowError(expect.objectContaining({
      name: MoveAutomationRuntimeRegistryValidationError.name,
      code: 'unknown-canonical-id',
      canonicalId: 'Tackle',
    }))

    expect(() => createMoveAutomationRuntimeRegistry({
      manifest: manifestForScratch(),
      legacySources: [{
        sourceModule: scratchLegacySource.sourceModule,
        scripts: new Map([['Tackle', scratchScript]]),
      }],
    })).toThrowError(expect.objectContaining({
      name: MoveAutomationRuntimeRegistryValidationError.name,
      code: 'canonical-id-mismatch',
      canonicalId: 'Tackle',
    }))
  })

  it('rejects missing registrations and every selected metadata mismatch', () => {
    const selected = manifestSelectingScratchV2()
    expect(() => createMoveAutomationRuntimeRegistry({
      manifest: selected.manifest,
      legacySources: legacySourcesForScratch(),
      moveSpecs: [],
    })).toThrowError(expect.objectContaining({
      name: MoveAutomationManifestValidationError.name,
      code: 'missing-runtime-registration',
    }))

    const invalidManifests = [
      (() => {
        const value = manifestSelectingScratchV2().manifest
        ;(value.moves[0]!.runtime as { version: number }).version += 1
        return value
      })(),
      (() => {
        const value = manifestSelectingScratchV2().manifest
        ;(value.moves[0]!.runtime as { definitionHash: string }).definitionHash = 'a'.repeat(64)
        return value
      })(),
      (() => {
        const value = manifestSelectingScratchV2().manifest
        ;(value.moves[0]!.runtime as { sourceModule: string }).sourceModule = 'server/specs/other.ts'
        return value
      })(),
    ]

    for (const manifest of invalidManifests) {
      expect(() => createMoveAutomationRuntimeRegistry({
        manifest,
        legacySources: legacySourcesForScratch(),
        moveSpecs: [scratchV2Registration()],
      })).toThrowError(expect.objectContaining({
        name: MoveAutomationManifestValidationError.name,
        code: 'runtime-registration-mismatch',
      }))
    }
  })

  it('rejects legacy source duplication and stale v1 version/hash metadata', () => {
    expect(() => createMoveAutomationRuntimeRegistry({
      manifest: manifestForScratch(),
      legacySources: [...legacySourcesForScratch(), ...legacySourcesForScratch()],
    })).toThrowError(expect.objectContaining({
      name: MoveAutomationRuntimeRegistryValidationError.name,
      code: 'duplicate-id',
      canonicalId: 'Scratch',
    }))

    for (const field of ['version', 'definitionHash'] as const) {
      const manifest = manifestForScratch()
      const runtime = manifest.moves[0]!.runtime as {
        version: number
        definitionHash: string
      }
      if (field === 'version') runtime.version += 1
      else runtime.definitionHash = 'a'.repeat(64)

      expect(() => createMoveAutomationRuntimeRegistry({
        manifest,
        legacySources: legacySourcesForScratch(),
      })).toThrowError(expect.objectContaining({
        name: MoveAutomationManifestValidationError.name,
        code: 'runtime-registration-mismatch',
      }))
    }
  })
})

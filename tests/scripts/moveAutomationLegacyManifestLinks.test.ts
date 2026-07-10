import { describe, expect, it } from 'vitest'
import fingerprintJson from '../../data/move-automation/legacy-v1-fingerprints.json'
import manifestJson from '../../data/move-automation/manifest.json'
import {
  EXPLICIT_MOVE_AUTOMATION_SCRIPTS,
  type ExplicitMoveAutomationRegistrySource,
} from '../../src/utils/move-automation/registry'
import { hashLegacyMoveAutomationDefinition } from '../../scripts/move_automation_definition_hash'
import { buildLegacyMoveAutomationAudit } from '../../scripts/move_automation_legacy_audit'
import {
  assertLegacyMoveAutomationFingerprintIndexCurrent,
  assertLegacyMoveAutomationManifestLinksCurrent,
  buildLegacyMoveAutomationFingerprintIndex,
  linkLegacyMoveAutomationManifest,
  type LegacyMoveAutomationFingerprintIndex,
} from '../../scripts/move_automation_legacy_manifest_links'

const committedFingerprints = fingerprintJson as LegacyMoveAutomationFingerprintIndex

describe('legacy move automation implementation fingerprints', () => {
  it('links every manifest-selected legacy implementation to its exact registry definition', () => {
    const audit = buildLegacyMoveAutomationAudit()
    const generatedIndex = buildLegacyMoveAutomationFingerprintIndex(audit)
    const manifestById = new Map(manifestJson.moves.map(row => [row.canonicalId, row]))

    expect(generatedIndex).toEqual(committedFingerprints)
    expect(generatedIndex.entries).toHaveLength(EXPLICIT_MOVE_AUTOMATION_SCRIPTS.size)
    expect(new Set(generatedIndex.entries.map(entry => entry.canonicalId)).size)
      .toBe(generatedIndex.entries.length)
    expect(new Set(generatedIndex.entries.map(entry => entry.definitionHash)).size)
      .toBe(generatedIndex.entries.length)

    const selectedLegacyEntries = generatedIndex.entries.filter(entry => (
      manifestById.get(entry.canonicalId)?.runtime.kind === 'legacy-v1'
    ))
    expect(selectedLegacyEntries).toHaveLength(
      manifestJson.moves.filter(row => row.runtime.kind === 'legacy-v1').length,
    )
    for (const entry of selectedLegacyEntries) {
      expect(manifestById.get(entry.canonicalId)).toMatchObject({
        runtime: {
          kind: 'legacy-v1',
          version: entry.version,
          definitionHash: entry.definitionHash,
          sourceModule: entry.sourceModule,
        },
      })
    }
  })

  it('hashes evaluated definitions deterministically and detects behavior changes', () => {
    const scratch = EXPLICIT_MOVE_AUTOMATION_SCRIPTS.get('Scratch')
    expect(scratch).toBeDefined()

    const clone = structuredClone(scratch!)
    expect(hashLegacyMoveAutomationDefinition(clone))
      .toBe(hashLegacyMoveAutomationDefinition(scratch!))
    expect(hashLegacyMoveAutomationDefinition({ ...clone, damageBase: (clone.damageBase ?? 0) + 1 }))
      .not.toBe(hashLegacyMoveAutomationDefinition(scratch!))
    expect(hashLegacyMoveAutomationDefinition({ ...clone, version: clone.version + 1 }))
      .not.toBe(hashLegacyMoveAutomationDefinition(scratch!))
  })

  it('rejects two canonical registry rows that share one implementation object', () => {
    const scratch = EXPLICIT_MOVE_AUTOMATION_SCRIPTS.get('Scratch')
    expect(scratch).toBeDefined()
    const duplicateSources: readonly ExplicitMoveAutomationRegistrySource[] = [{
      sourceModule: 'src/utils/move-automation/scripts/area.ts',
      scripts: new Map([
        ['Scratch', scratch!],
        ['Pound', scratch!],
      ]),
    }]

    expect(() => buildLegacyMoveAutomationAudit({
      registrySources: duplicateSources,
      registry: duplicateSources[0].scripts,
    })).toThrow(/resolve to the same script implementation/)
  })

  it('fails checks when committed source or hash links drift', () => {
    expect(() => assertLegacyMoveAutomationFingerprintIndexCurrent(
      committedFingerprints,
      buildLegacyMoveAutomationFingerprintIndex(buildLegacyMoveAutomationAudit()),
    )).not.toThrow()
    expect(() => assertLegacyMoveAutomationManifestLinksCurrent(
      manifestJson,
      committedFingerprints,
    )).not.toThrow()
    expect(linkLegacyMoveAutomationManifest(manifestJson, committedFingerprints))
      .toEqual(manifestJson)

    const staleManifest = structuredClone(manifestJson)
    const selectedLegacyRow = staleManifest.moves.find(row => row.runtime.kind === 'legacy-v1')
    expect(selectedLegacyRow).toBeDefined()
    selectedLegacyRow!.runtime.definitionHash = '0'.repeat(64)
    expect(() => assertLegacyMoveAutomationManifestLinksCurrent(
      staleManifest,
      committedFingerprints,
    )).toThrow(/source, version, or definition hash drifted/)

    const staleIndex: LegacyMoveAutomationFingerprintIndex = {
      ...committedFingerprints,
      entries: committedFingerprints.entries.map((entry, index) =>
        index === 0 ? { ...entry, sourceModule: 'stale.ts' } : entry,
      ),
    }
    expect(() => assertLegacyMoveAutomationFingerprintIndexCurrent(
      staleIndex,
      committedFingerprints,
    )).toThrow(/fingerprint index drifted/)
  })
})

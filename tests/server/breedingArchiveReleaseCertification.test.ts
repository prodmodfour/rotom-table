import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import reportJson from '../../data/breeding-automation/archive-release-certification.json'
import archiveContractJson from '../../data/breeding-automation/archive-contract.json'
import archiveRuntimeJson from '../../data/breeding-automation/archive-storage-runtime-contract.json'
import semanticClosureJson from '../../data/breeding-automation/semantic-closure-manifest.json'
import wholeSpeciesJson from '../../data/breeding-automation/whole-species-conformance.json'
import interactionJson from '../../data/breeding-automation/interaction-certification.json'
import resilienceJson from '../../data/breeding-automation/resilience-certification.json'
import securityJson from '../../data/breeding-automation/security-certification.json'
import storageSchemaV28Json from '../../data/breeding-automation/storage-schema-v28.json'
import { stableJsonStringify } from '../../shared/automation/stableJson'
import { BREEDING_ARCHIVE_MAXIMUM_BYTES } from '../../shared/breeding/archives'

const ROOT = resolve(import.meta.dirname, '../..')
const report = reportJson as Record<string, any>
const hash = (value: unknown): string => createHash('sha256')
  .update(stableJsonStringify(value))
  .digest('hex')

const EXPECTED_DIMENSIONS = [
  'legacy-migration',
  'export-import',
  'backup-restore',
  'reference-version',
  'orphan-repair',
]
const EXPECTED_BACKUP_KINDS = [
  'adjudication',
  'authorization-receipt',
  'campaign-clock',
  'check',
  'consent',
  'egg',
  'egg-transfer-consent',
  'gm-override',
  'incubation-segment',
  'inheritance-learning',
  'offer',
  'operation-command',
  'operation-result',
  'origin',
  'project',
  'read-set',
  'roll',
  'species-acquisition',
  'species-acquisition-source-settlement',
]

describe('BR-085 Breeding archive release certification', () => {
  it('is self-hashed and bound to the current closure, contracts, reports, and storage schema', () => {
    expect(report).toMatchObject({
      schemaVersion: 1,
      reportId: 'ptu-1.05-breeding-archive-release-certification-v1',
      rulesetId: semanticClosureJson.rulesetId,
      rulesetDefinitionSha256: semanticClosureJson.rulesetDefinitionSha256,
      sourceManifestSha256: semanticClosureJson.sourceManifestSha256,
      definitionSha256: hash(report.definition),
      definition: {
        ticket: 'BR-085',
        status: 'certified',
        dimensions: EXPECTED_DIMENSIONS,
        bindings: {
          semanticClosureDefinitionSha256: semanticClosureJson.definitionSha256,
          wholeSpeciesConformanceDefinitionSha256: wholeSpeciesJson.definitionSha256,
          interactionCertificationDefinitionSha256: interactionJson.definitionSha256,
          resilienceCertificationDefinitionSha256: resilienceJson.definitionSha256,
          securityCertificationDefinitionSha256: securityJson.definitionSha256,
          archiveContractDefinitionSha256: archiveContractJson.definitionSha256,
          archiveStorageRuntimeContractDefinitionSha256: archiveRuntimeJson.definitionSha256,
          storageSchemaV28DefinitionSha256: storageSchemaV28Json.definitionSha256,
        },
      },
    })
    expect(semanticClosureJson.definition.operations).toMatchObject({
      archiveReleaseCertificationOwner: 'BR-085',
      archiveReleaseCertificationStatus: 'certified-current-archive-and-repair-semantics',
      artifactIds: expect.arrayContaining(['breeding-archive-release-certification']),
    })
    expect(semanticClosureJson.definition.semanticRegistry.expectedArtifactCountIncludingThisManifest).toBe(106)
  })

  it('closes all restorable record kinds without omitting private durable authority', () => {
    expect(report.definition.archiveAuthority.backupRecordKinds).toEqual(EXPECTED_BACKUP_KINDS)
    expect(archiveContractJson.definition.purposePolicy['campaign-backup'].allowed)
      .toEqual(EXPECTED_BACKUP_KINDS)
    expect(report.definition.archiveAuthority.maximumEnvelopeBytes)
      .toBe(BREEDING_ARCHIVE_MAXIMUM_BYTES)
    expect(report.definition.archiveAuthority.requiredPrivateFamilies).toEqual(expect.arrayContaining([
      'dual-Egg-transfer-consent-history',
      'GM-override-evidence',
      'external-species-acquisition-source-settlement',
    ]))
    expect(report.definition.releaseInvariants).toEqual(expect.arrayContaining([
      'backup-never-omits-or-reconstructs-private-authority',
      'external-acquisition-settlements-never-create-fake-Breeding-commands',
      'new-campaign-restore-never-overwrites-nonempty-authority',
    ]))
  })

  it('binds every migration and release acceptance case to an existing exact assertion', () => {
    expect(report.definition.migrationMatrix.map((row: any) => row.kind)).toEqual([
      'archive-schema-upgrade',
      'legacy-lineage-review',
      'legacy-map-metadata-quarantine',
      'pre-breeding-campaign-audit',
    ])
    const cases = report.definition.acceptanceCases as Record<string, string>[]
    expect(cases).toHaveLength(14)
    expect(new Set(cases.map(row => row.caseId)).size).toBe(14)
    for (const row of cases) {
      const path = resolve(ROOT, row.evidencePath)
      expect(existsSync(path), row.evidencePath).toBe(true)
      expect(readFileSync(path, 'utf8'), `${row.evidencePath}: ${row.requiredNeedle}`)
        .toContain(row.requiredNeedle)
    }
    expect(report.definition.runtimePaths.every((path: string) => existsSync(resolve(ROOT, path))))
      .toBe(true)
    expect(report.definition.summary).toEqual({
      dimensionsCertified: 5,
      backupRecordKindsCertified: 19,
      migrationKindsCertified: 4,
      acceptanceCases: 14,
      result: 'pass',
    })
  })
})

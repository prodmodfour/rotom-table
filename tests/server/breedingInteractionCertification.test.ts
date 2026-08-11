import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import interactionCertificationJson from '../../data/breeding-automation/interaction-certification.json'
import modifierInventoryJson from '../../data/breeding-automation/modifier-inventory.json'
import featureProviderContractJson from '../../data/breeding-automation/feature-provider-handoff-contract.json'
import modifierProviderContractJson from '../../data/breeding-automation/modifier-provider-handoff-contract.json'
import semanticClosureJson from '../../data/breeding-automation/semantic-closure-manifest.json'
import wholeSpeciesConformanceJson from '../../data/breeding-automation/whole-species-conformance.json'
import rulesetJson from '../../data/breeding-automation/ruleset.json'
import { stableJsonStringify } from '../../shared/automation/stableJson'

const ROOT = resolve(import.meta.dirname, '../..')
const hash = (value: unknown): string => createHash('sha256').update(stableJsonStringify(value)).digest('hex')
const readJson = (path: string): Record<string, any> => JSON.parse(readFileSync(resolve(ROOT, path), 'utf8')) as Record<string, any>
const report = interactionCertificationJson as Record<string, any>
const inventory = modifierInventoryJson as Record<string, any>
const featureContract = featureProviderContractJson as Record<string, any>
const modifierContract = modifierProviderContractJson as Record<string, any>
const mechanicFields = (record: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(
  ['prerequisites', 'frequency', 'trigger', 'target', 'condition', 'effect', 'effects', 'text']
    .filter(field => Object.hasOwn(record, field))
    .map(field => [field, record[field]]),
)

const ACTIVE_IDS = [
  'trainer-edge:Breeder',
  'trainer-edge:Paleontologist',
  'feature:Dilettante',
  'feature:Playing God',
  'feature:Fossil Restoration',
  'feature:Prehistoric Bond',
  'item:Egg Warmer',
  'item:Reanimation Machine',
  'item:Chemistry Set',
  'ability:Serpent’s Mark',
  'ability:Parental Bond',
  'capability:Egg Warmer',
  'capability:Marsupial',
  'rule:Tutor Points',
  'rule:Loyalty',
  'rule:3-TM/Tutor Move Limit',
]
const UPSTREAM_IDS = [
  'feature:Egg Tutor',
  'feature:Ancient Heritage',
  'feature:Genetic Memory',
  'feature:Tutoring',
]
const FAIL_CLOSED_IDS = ['feature:This One’s Special, I Know It']

const sorted = (values: readonly string[]): string[] => [...values].sort()

describe('BR-082 breeding interaction certification', () => {
  it('is self-hashed and bound to the current closed ruleset, Species suite, and owning contracts', () => {
    expect(report).toMatchObject({
      schemaVersion: 1,
      reportId: 'ptu-1.05-breeding-interaction-certification-v1',
      rulesetId: rulesetJson.rulesetId,
      rulesetDefinitionSha256: rulesetJson.definitionSha256,
      sourceManifestSha256: semanticClosureJson.sourceManifestSha256,
      definitionSha256: hash(report.definition),
    })
    expect(report.definition).toMatchObject({
      ticket: 'BR-082',
      status: 'certified',
      certificationSemantics: {
        clientAuthority: 'none',
        documentaryRuntimeUse: 'forbidden',
        facilityRegistry: 'empty-no-authority',
        unknownOrUnparameterizedInteraction: 'fail-closed-unavailable',
      },
      bindings: {
        semanticClosureDefinitionSha256: semanticClosureJson.definitionSha256,
        wholeSpeciesConformanceDefinitionSha256: wholeSpeciesConformanceJson.definitionSha256,
        breederEdgeHandoffContractDefinitionSha256: readJson('data/breeding-automation/breeder-edge-handoff-contract.json').definitionSha256,
        featureProviderHandoffContractDefinitionSha256: featureContract.definitionSha256,
        modifierProviderHandoffContractDefinitionSha256: modifierContract.definitionSha256,
        fossilEggContractDefinitionSha256: readJson('data/breeding-automation/fossil-egg-contract.json').definitionSha256,
        babyTemplateContractDefinitionSha256: readJson('data/breeding-automation/baby-template-contract.json').definitionSha256,
        inheritanceLearningContractDefinitionSha256: readJson('data/breeding-automation/inheritance-learning-contract.json').definitionSha256,
        campaignClockBatchContractDefinitionSha256: readJson('data/breeding-automation/campaign-clock-incubation-batch-contract.json').definitionSha256,
        familyGraphPolicyDefinitionSha256: readJson('data/breeding-automation/family-graph-policy.json').definitionSha256,
      },
    })
    expect(semanticClosureJson.definition.interactions).toMatchObject({
      certificationOwner: 'BR-082',
      certificationStatus: 'certified-current-semantics',
      artifactIds: expect.arrayContaining(['breeding-interaction-certification']),
    })
  })

  it('certifies every reviewed inventory row exactly once against its app-owned canonical record', () => {
    const entries = report.definition.entries as Record<string, any>[]
    const inventoryRows = inventory.definition.entries as Record<string, any>[]
    expect(entries).toHaveLength(21)
    expect(entries.map(row => row.inventoryEntryId)).toEqual(inventoryRows.map(row => row.id))
    expect(new Set(entries.map(row => row.inventoryEntryId)).size).toBe(entries.length)
    expect(report.definition.inventory).toEqual({
      inventoryId: inventory.inventoryId,
      definitionSha256: inventory.definitionSha256,
      entryCount: inventory.entryCount,
      categoryCounts: inventory.definition.categoryCounts,
    })

    for (const [index, entry] of entries.entries()) {
      const inventoryRow = inventoryRows[index]!
      expect(entry).toMatchObject({
        inventoryEntryId: inventoryRow.id,
        sourceKind: inventoryRow.sourceKind,
        canonicalId: inventoryRow.canonicalId,
        sourcePath: inventoryRow.sourcePath,
        recordSha256: inventoryRow.recordSha256,
        mechanicFieldsSha256: inventoryRow.mechanicFieldsSha256,
        snapshotCheckpoint: inventoryRow.snapshotCheckpoint,
        contributionIds: inventoryRow.contributionIds,
        authorityOwner: inventoryRow.authorityOwner,
      })
      const canonicalRecord = readJson(inventoryRow.sourcePath)[inventoryRow.canonicalId] as Record<string, unknown> | undefined
      expect(canonicalRecord, inventoryRow.id).toBeDefined()
      expect(hash(canonicalRecord), `${inventoryRow.id} canonical record`).toBe(inventoryRow.recordSha256)
      expect(hash(mechanicFields(canonicalRecord!)), `${inventoryRow.id} mechanic fields`).toBe(inventoryRow.mechanicFieldsSha256)
      expect(entry.runtimePaths.length, `${inventoryRow.id} runtime evidence`).toBeGreaterThan(0)
      expect(entry.evidencePaths.length, `${inventoryRow.id} test evidence`).toBeGreaterThan(0)
      expect(entry.runtimePaths.every((path: string) => existsSync(resolve(ROOT, path)) && !path.startsWith('src/'))).toBe(true)
      expect(entry.evidencePaths.every((path: string) => existsSync(resolve(ROOT, path)) && path.startsWith('tests/'))).toBe(true)
      expect(entry.certifiedBehavior).toEqual(expect.any(String))
      expect(entry.certifiedBehavior.length).toBeGreaterThan(40)
    }
  })

  it('distinguishes active reducers, upstream operation boundaries, and explicit fail-closed semantics', () => {
    const entries = report.definition.entries as Record<string, any>[]
    const idsFor = (status: string): string[] => entries
      .filter(row => row.certificationStatus === status)
      .map(row => row.inventoryEntryId)
    expect(sorted(idsFor('active-owning-runtime'))).toEqual(sorted(ACTIVE_IDS))
    expect(sorted(idsFor('upstream-operation-boundary'))).toEqual(sorted(UPSTREAM_IDS))
    expect(idsFor('fail-closed-no-consumption-authority')).toEqual(FAIL_CLOSED_IDS)
    expect(report.definition.summary).toEqual({
      inventoryEntriesCertified: 21,
      activeOwningRuntime: 16,
      upstreamOperationBoundary: 4,
      failClosedNoConsumptionAuthority: 1,
      dimensionsCertified: 10,
      recoveryCases: 6,
      result: 'pass',
    })

    const featureInventoryIds = inventory.definition.entries
      .filter((row: Record<string, any>) => row.sourceKind === 'feature')
      .map((row: Record<string, any>) => row.id)
    const contractFeatureIds = featureContract.definition.checkpoints.map((row: Record<string, any>) => `feature:${row.providerCanonicalId}`)
    expect(sorted(contractFeatureIds)).toEqual(sorted(featureInventoryIds))
    const closedModifierIds = modifierContract.definition.closedPolicies.map((row: Record<string, any>) => row.inventoryEntryId)
    expect(sorted(closedModifierIds)).toEqual(sorted([
      'ability:Parental Bond',
      'ability:Serpent’s Mark',
      'capability:Egg Warmer',
      'capability:Marsupial',
      'item:Chemistry Set',
      'item:Egg Warmer',
      'item:Reanimation Machine',
      'rule:Loyalty',
      'rule:Tutor Points',
    ]))
    expect(report.definition.negativeBoundaries).toContain('this-ones-special-provider-force-cannot-execute-without-durable-use-consumption')
    expect(report.definition.negativeBoundaries).toContain('post-hatch-feature-handoffs-cannot-forge-inherited-origin-or-bypass-permanent-move-authority')
  })

  it('closes all ten interaction dimensions with server-owned evidence and no parallel Egg path', () => {
    const expectedDimensions = ['edge', 'feature', 'item', 'ability', 'capability', 'move', 'form', 'fossil', 'baby-template', 'campaign-clock']
    expect(report.definition.dimensions).toEqual(expectedDimensions)
    expect(report.definition.crossCutting.map((row: Record<string, any>) => row.dimension)).toEqual(expectedDimensions)
    const inventoryIds = new Set(inventory.definition.entries.map((row: Record<string, any>) => row.id))
    for (const row of report.definition.crossCutting as Record<string, any>[]) {
      expect(row.status).toBe('certified')
      expect(row.inventoryEntryIds.every((id: string) => inventoryIds.has(id))).toBe(true)
      expect(row.runtimePaths.length).toBeGreaterThan(0)
      expect(row.runtimePaths.every((path: string) => existsSync(resolve(ROOT, path)))).toBe(true)
      expect(row.evidencePaths.length).toBeGreaterThan(0)
      expect(row.evidencePaths.every((path: string) => existsSync(resolve(ROOT, path)))).toBe(true)
      expect(row.invariants.length).toBeGreaterThanOrEqual(3)
      expect(new Set(row.invariants).size).toBe(row.invariants.length)
    }
    expect(report.definition.crossCutting.find((row: Record<string, any>) => row.dimension === 'fossil').invariants)
      .toContain('ordinary-durable-egg-and-hatch-pipeline')
    expect(report.definition.crossCutting.find((row: Record<string, any>) => row.dimension === 'baby-template').invariants)
      .toContain('species-reference-data-never-mutated')
    expect(report.definition.crossCutting.find((row: Record<string, any>) => row.dimension === 'campaign-clock').invariants)
      .toContain('sole-lifecycle-cooldown-expiry-authority')
  })

  it('binds recovery evidence for randomness, source costs, learning, and bounded clock prefixes', () => {
    const recovery = report.definition.recoveryMatrix as Record<string, any>[]
    expect(recovery).toHaveLength(6)
    expect(new Set(recovery.map(row => `${row.interactionId}:${row.failureMode}`)).size).toBe(recovery.length)
    expect(recovery.map(row => row.interactionId)).toEqual([
      'item:Egg Warmer',
      'capability:Egg Warmer',
      'trainer-edge:Paleontologist',
      'feature:Playing God',
      'rule:3-TM/Tutor Move Limit',
      'campaign-clock',
    ])
    for (const row of recovery) {
      expect(existsSync(resolve(ROOT, row.evidencePath))).toBe(true)
      expect(row.expectedOutcome).toEqual(expect.any(String))
      expect(row.expectedOutcome).toMatch(/(resume|reused|replay|roll-back|retained)/u)
    }
    expect(report.definition.evidencePaths).toContain('tests/server/breedingInteractionCertification.test.ts')
    expect(report.definition.evidencePaths.every((path: string) => existsSync(resolve(ROOT, path)))).toBe(true)
    expect(new Set(report.definition.evidencePaths).size).toBe(report.definition.evidencePaths.length)
  })
})

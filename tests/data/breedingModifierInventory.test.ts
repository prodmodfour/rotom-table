import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { stableJsonStringify } from '#shared/automation/stableJson'

const ROOT = resolve(import.meta.dirname, '../..')
const readJson = <T>(path: string): T => JSON.parse(readFileSync(resolve(ROOT, path), 'utf8')) as T
const sha256 = (value: Buffer | string): string => createHash('sha256').update(value).digest('hex')

const SOURCE_PATHS = {
  'trainer-edge': 'data/reference/edges.json',
  'poke-edge': 'data/reference/poke-edges.json',
  feature: 'data/reference/features.json',
  item: 'data/reference/items.json',
  ability: 'data/reference/abilities.json',
  capability: 'data/reference/capabilities.json',
  rule: 'data/reference/rules.json',
} as const

type SourceKind = keyof typeof SOURCE_PATHS
interface InventoryEntry {
  id: string
  sourceKind: SourceKind
  canonicalId: string
  sourcePath: string
  recordSha256: string
  mechanicFieldsSha256: string
  discovery: string
  phases: string[]
  contributionIds: string[]
  snapshotCheckpoint: string
  authorityOwner: string
  integrationStatus: string
  clientAuthority: string
}
interface Inventory {
  schemaVersion: number
  inventoryId: string
  rulesetId: string
  rulesetDefinitionSha256: string
  sourceManifestSha256: string
  definitionSha256: string
  entryCount: number
  definition: {
    entries: InventoryEntry[]
    categoryCounts: Record<string, number>
    campaignOptionIds: string[]
    facilityInventory: Record<string, unknown>
    resourceGaps: Array<{ id: string, status: string, policy: string }>
    reviewedFalsePositives: Array<{ sourceKind: SourceKind, canonicalId: string, reason: string }>
    keywordAudit: Record<string, string | number>
    providerPolicy: Record<string, string>
  }
}

const inventory = readJson<Inventory>('data/breeding-automation/modifier-inventory.json')
const ruleset = readJson<{
  rulesetId: string
  definitionSha256: string
  definition: { campaignOptions: Array<{ id: string }> }
}>('data/breeding-automation/ruleset.json')
const catalogs = Object.fromEntries(Object.entries(SOURCE_PATHS).map(([kind, path]) => [
  kind,
  readJson<Record<string, Record<string, unknown>>>(path),
])) as Record<SourceKind, Record<string, Record<string, unknown>>>

const mechanicFields = (record: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(
  ['prerequisites', 'frequency', 'trigger', 'target', 'condition', 'effect', 'effects', 'text']
    .filter(field => Object.hasOwn(record, field))
    .map(field => [field, record[field]]),
)

const KEYWORD_PATTERN = /(breed|egg|hatch|fossil|born|inherit|offspring|parent|baby template|reanimat)/i

describe('breeding provider and modifier inventory', () => {
  it('is source- and ruleset-bound with a closed family-qualified identity inventory', () => {
    expect(inventory).toMatchObject({
      schemaVersion: 1,
      inventoryId: 'ptu-1.05-breeding-modifier-inventory-v1',
      rulesetId: ruleset.rulesetId,
      rulesetDefinitionSha256: ruleset.definitionSha256,
      entryCount: 21,
    })
    expect(inventory.sourceManifestSha256).toBe(sha256(readFileSync(resolve(ROOT, 'data/breeding-automation/source-manifest.json'))))
    expect(inventory.definitionSha256).toBe(sha256(stableJsonStringify(inventory.definition)))
    expect(inventory.entryCount).toBe(inventory.definition.entries.length)
    expect(new Set(inventory.definition.entries.map(entry => entry.id)).size).toBe(inventory.entryCount)
    expect(inventory.definition.entries.every(entry => entry.id === `${entry.sourceKind}:${entry.canonicalId}`)).toBe(true)
  })

  it('binds every accepted provider to an exact canonical record and reviewed mechanic fields', () => {
    const contributionIds = new Set<string>()
    for (const entry of inventory.definition.entries) {
      expect(entry.sourcePath, entry.id).toBe(SOURCE_PATHS[entry.sourceKind])
      const record = catalogs[entry.sourceKind][entry.canonicalId]
      expect(record, entry.id).toBeDefined()
      expect(entry.recordSha256, entry.id).toBe(sha256(stableJsonStringify(record)))
      expect(entry.mechanicFieldsSha256, entry.id).toBe(sha256(stableJsonStringify(mechanicFields(record))))
      expect(entry.phases.length, entry.id).toBeGreaterThan(0)
      expect(entry.snapshotCheckpoint.trim(), entry.id).not.toBe('')
      expect(entry.authorityOwner.trim(), entry.id).not.toBe('')
      expect(entry.integrationStatus.trim(), entry.id).not.toBe('')
      expect(entry.clientAuthority, entry.id).toBe('none')
      expect(entry.contributionIds.length, entry.id).toBeGreaterThan(0)
      for (const contributionId of entry.contributionIds) {
        expect(contributionId, entry.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
        expect(contributionIds.has(contributionId), contributionId).toBe(false)
        contributionIds.add(contributionId)
      }
    }
  })

  it('covers every broad canonical keyword match or records a reviewed false positive', () => {
    const matchingRows = new Set<string>()
    for (const [sourceKind, catalog] of Object.entries(catalogs) as Array<[SourceKind, Record<string, Record<string, unknown>>]>) {
      for (const [canonicalId, record] of Object.entries(catalog)) {
        if (KEYWORD_PATTERN.test(JSON.stringify(record))) matchingRows.add(`${sourceKind}:${canonicalId}`)
      }
    }
    const acceptedKeywordRows = new Set(inventory.definition.entries
      .filter(entry => entry.discovery === 'keyword-scan')
      .map(entry => entry.id))
    const falsePositiveRows = new Set(inventory.definition.reviewedFalsePositives
      .map(entry => `${entry.sourceKind}:${entry.canonicalId}`))
    const dependencyRows = inventory.definition.entries.filter(entry => entry.discovery === 'provider-dependency')

    // The frozen inventory retains Iron's reviewed historical parser-overrun
    // false positive. Later source-hash-bound Complete Play Loop rules add
    // three reviewed non-Breeding keyword matches without changing a provider.
    const reviewedSuccessorFalsePositives = new Set([
      'rule:Evolutionary Items',
      'rule:Item-Driven Form Changes',
      'rule:Pokémon Advancement Choices',
    ])
    const reviewedHistoricalMatches = new Set([
      ...matchingRows,
      ...falsePositiveRows.has('item:Iron') ? ['item:Iron'] : [],
    ])
    const frozenHistoricalMatches = new Set(
      [...reviewedHistoricalMatches].filter(id => !reviewedSuccessorFalsePositives.has(id)),
    )
    expect(matchingRows.size).toBe(27)
    expect(reviewedHistoricalMatches.size).toBe(28)
    expect(frozenHistoricalMatches.size).toBe(25)
    expect(acceptedKeywordRows.size).toBe(19)
    expect(falsePositiveRows.size).toBe(6)
    expect(dependencyRows.map(entry => entry.id)).toEqual([
      'item:Chemistry Set',
      'rule:3-TM/Tutor Move Limit',
    ])
    expect(new Set([
      ...acceptedKeywordRows,
      ...falsePositiveRows,
      ...reviewedSuccessorFalsePositives,
    ])).toEqual(reviewedHistoricalMatches)
    expect([...acceptedKeywordRows].some(id => (
      falsePositiveRows.has(id) || reviewedSuccessorFalsePositives.has(id)
    ))).toBe(false)
    for (const excluded of inventory.definition.reviewedFalsePositives) {
      expect(excluded.reason.trim().length, `${excluded.sourceKind}:${excluded.canonicalId}`).toBeGreaterThan(30)
      expect(catalogs[excluded.sourceKind][excluded.canonicalId]).toBeDefined()
    }
    expect(inventory.definition.keywordAudit).toMatchObject({
      matchingCanonicalRows: frozenHistoricalMatches.size,
      acceptedKeywordRows: acceptedKeywordRows.size,
      reviewedFalsePositiveRows: falsePositiveRows.size,
      acceptedDependencyRows: dependencyRows.length,
    })
  })

  it('accounts for all provider families, campaign options, facilities, and source gaps', () => {
    const counts = Object.fromEntries(Object.keys(inventory.definition.categoryCounts).map(kind => [kind, 0]))
    for (const entry of inventory.definition.entries) counts[entry.sourceKind] = (counts[entry.sourceKind] ?? 0) + 1
    counts.facility = 0
    counts['campaign-option'] = ruleset.definition.campaignOptions.length
    expect(counts).toEqual(inventory.definition.categoryCounts)
    expect(inventory.definition.campaignOptionIds).toEqual(ruleset.definition.campaignOptions.map(option => option.id))
    expect(inventory.definition.facilityInventory).toEqual({
      canonicalRegistryPresent: false,
      entryCount: 0,
      recognizedToolAdapters: ['item:Reanimation Machine', 'item:Chemistry Set', 'item:Egg Warmer'],
      portableReanimationMachineIdentity: 'unresolved-no-canonical-item-id',
      unknownFacilityPolicy: 'fail-closed-until-app-owned-registry-migration',
    })
    expect(inventory.definition.resourceGaps).toEqual([
      {
        id: 'breeding.resource.fossil-item-identities',
        status: 'missing',
        policy: 'typed-campaign-resource-or-reviewed-app-owned-item-migration-required',
      },
      {
        id: 'breeding.resource.portable-reanimation-machine',
        status: 'unresolved',
        policy: 'cannot-alias-at-runtime',
      },
      {
        id: 'breeding.resource.facility-registry',
        status: 'missing',
        policy: 'no-facility-contribution-may-execute',
      },
    ])
  })

  it('requires effective, hash-bound, server-owned contributions at declared checkpoints', () => {
    expect(inventory.definition.providerPolicy).toEqual({
      effectiveProvidersOnly: 'required',
      suppressedOrUnavailableProvider: 'no-contribution',
      snapshotAtDeclaredCheckpoint: 'required',
      definitionHashesOnProjectAndEgg: 'required',
      freeFormProvider: 'forbidden',
      clientSubmittedEffect: 'forbidden',
      unknownCanonicalIdentity: 'fail-closed',
      duplicateContribution: 'deduplicate-by-stable-contribution-id-and-retain-provenance',
    })
    expect(inventory.definition.entries.find(entry => entry.id === 'trainer-edge:Breeder')).toMatchObject({
      authorityOwner: 'edge-automation',
      integrationStatus: 'delegated-to-breeding',
      snapshotCheckpoint: 'project-creation',
    })
    expect(inventory.definition.entries.find(entry => entry.id === 'capability:Egg Warmer')).toMatchObject({
      phases: ['incubation'],
      snapshotCheckpoint: 'incubation-operation',
      integrationStatus: 'requires-breeding-integration',
    })
    expect(inventory.definition.entries.find(entry => entry.id === 'feature:Playing God')?.contributionIds).toContain('artificial-egg-source')
    expect(inventory.definition.entries.find(entry => entry.id === 'ability:Serpent’s Mark')?.contributionIds).toContain('arbok-pattern-inheritance')
    expect(inventory.definition.entries.find(entry => entry.id === 'capability:Marsupial')?.contributionIds).toContain('kangaskhan-forced-baby-template-minus-5')
  })
})

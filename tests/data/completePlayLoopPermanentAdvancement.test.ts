import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import itemsJson from '~~/data/reference/items.json'
import rulesJson from '~~/data/reference/rules.json'
import contractJson from '~~/data/complete-play-loop/permanent-advancement-items.v1.json'
import inventoryJson from '~~/data/complete-play-loop/item-inventory.v1.json'
import itemFixturesJson from '~~/data/complete-play-loop/fixtures/items.v1.json'
import remediationJson from '~~/data/complete-play-loop/canonical-data-remediation.v1.json'
import specsJson from '~~/data/complete-play-loop/specs.v1.json'
import { stableJsonStringify } from '#shared/automation/stableJson'

const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex')
const items = itemsJson as Record<string, { readonly effects: readonly string[] }>
const contract = contractJson as unknown as {
  readonly catalogSha256: string
  readonly status: string
  readonly ruleAuthority: {
    readonly fileSha256: string
    readonly recordSha256: string
    readonly migrationId: string
    readonly migrationAfterFileSha256: string
    readonly catalogSuccessorMigrationIds: readonly string[]
    readonly reviewEvidence: { readonly path: string, readonly fileSha256: string, readonly gitBlob: string }
    readonly runtimeDocumentaryParsingForbidden: boolean
  }
  readonly items: {
    readonly statVitamins: readonly { readonly canonicalId: string, readonly stat: string, readonly recordSha256: string, readonly effectSha256: string }[]
    readonly heartBooster: { readonly canonicalId: string, readonly recordSha256: string, readonly effectSha256: string }
    readonly ppUp: { readonly canonicalId: string, readonly recordSha256: string, readonly effectSha256: string }
    readonly rareCandy: { readonly canonicalId: string, readonly recordSha256: string, readonly effectSha256: string }
    readonly statSuppressants: { readonly canonicalId: string, readonly recordSha256: string, readonly effectSha256: string }
  }
  readonly execution: Record<string, unknown>
  readonly provenance: Record<string, unknown>
  readonly certification: Record<string, unknown>
}

const itemRows = (): readonly { readonly canonicalId: string, readonly recordSha256: string, readonly effectSha256: string }[] => [
  ...contract.items.statVitamins,
  contract.items.heartBooster,
  contract.items.ppUp,
  contract.items.rareCandy,
  contract.items.statSuppressants,
]

describe('P8-053 permanent advancement evidence', () => {
  it('binds every native item and the structured rule to exact canonical fingerprints', () => {
    expect(contract.status).toBe('reviewed-native')
    expect(sha256(readFileSync('data/reference/items.json'))).toBe(contract.catalogSha256)
    expect(sha256(readFileSync('data/reference/rules.json'))).toBe(contract.ruleAuthority.fileSha256)
    expect(sha256(stableJsonStringify((rulesJson as Record<string, unknown>)['Vitamins and Related Items'])))
      .toBe(contract.ruleAuthority.recordSha256)
    expect(itemRows()).toHaveLength(10)
    expect(new Set(itemRows().map(row => row.canonicalId)).size).toBe(10)
    for (const row of itemRows()) {
      const canonical = items[row.canonicalId]
      expect(canonical, row.canonicalId).toBeDefined()
      expect(sha256(stableJsonStringify(canonical))).toBe(row.recordSha256)
      expect(sha256(canonical!.effects.join('\n'))).toBe(row.effectSha256)
    }
    expect(contract.items.statVitamins.map(row => [row.canonicalId, row.stat])).toEqual([
      ['HP Up', 'hp'], ['Protein', 'atk'], ['Iron', 'def'],
      ['Calcium', 'satk'], ['Zinc', 'sdef'], ['Carbos', 'spd'],
    ])
  })

  it('records a reviewed source-bound migration while forbidding documentary runtime authority', () => {
    const migration = remediationJson.reviewedMigrations.find(row => (
      row.migrationId === contract.ruleAuthority.migrationId
    ))
    expect(migration).toMatchObject({
      canonicalId: 'Vitamins and Related Items',
      canonicalPath: 'data/reference/rules.json',
      afterFileSha256: contract.ruleAuthority.migrationAfterFileSha256,
      afterRecordSha256: contract.ruleAuthority.recordSha256,
      reviewStatus: 'accepted',
      sourceEvidence: {
        path: contract.ruleAuthority.reviewEvidence.path,
        fileSha256: contract.ruleAuthority.reviewEvidence.fileSha256,
      },
    })
    let currentCatalogSha = contract.ruleAuthority.migrationAfterFileSha256
    for (const migrationId of contract.ruleAuthority.catalogSuccessorMigrationIds) {
      const successor = remediationJson.reviewedMigrations.find(row => row.migrationId === migrationId)
      expect(successor).toMatchObject({
        canonicalPath: 'data/reference/rules.json',
        beforeFileSha256: currentCatalogSha,
        reviewStatus: 'accepted',
      })
      currentCatalogSha = successor!.afterFileSha256
    }
    expect(currentCatalogSha).toBe(contract.ruleAuthority.fileSha256)
    expect(sha256(readFileSync(contract.ruleAuthority.reviewEvidence.path)))
      .toBe(contract.ruleAuthority.reviewEvidence.fileSha256)
    expect(contract.ruleAuthority.reviewEvidence.gitBlob).toMatch(/^[a-f0-9]{40}$/u)
    expect(contract.ruleAuthority.runtimeDocumentaryParsingForbidden).toBe(true)
  })

  it('keeps generated support state, reviewed specs, completion authority, and private provenance synchronized', () => {
    const ids = new Set(itemRows().map(row => row.canonicalId))
    const inventoryRows = inventoryJson.rows.filter(row => ids.has(row.canonicalId))
    expect(inventoryRows).toHaveLength(10)
    for (const row of inventoryRows) {
      expect(row.behaviorInventory).toMatchObject({
        mechanicalRole: 'permanent-advancement',
        contexts: ['sheet', 'campaign', 'extended-action'],
        timing: 'extended',
        targets: expect.arrayContaining(['participant']),
        consumption: { phase: 'extended-action-completion', quantity: 1, reusable: false },
        currentProductSupport: {
          state: 'native-runtime-wired', gaps: [],
          authorities: expect.arrayContaining([
            'shared/itemAutomation/permanentAdvancement.ts',
            'server/domain/itemAutomation/permanentAdvancement.ts',
            'server/domain/itemAutomation/reducer.ts',
            'server/useCases/manageItemExtendedAction.ts',
          ]),
        },
      })
    }
    expect(specsJson.ruleEvidence.permanentAdvancementPolicy).toMatchObject({
      ruleCanonicalId: 'Vitamins and Related Items',
      ruleRecordSha256: contract.ruleAuthority.recordSha256,
      timing: 'extended', targetKind: 'pokemon',
      consumptionPhase: 'extended-action-completion', vitaminLifetimeLimit: 5,
      heartBooster: { lifetimeLimit: 1, tutorPoints: 2 },
      ppUp: { lifetimeLimit: 1, atWillPolicy: 'ineligible', eotResult: 'At-Will', additionalUses: 1 },
      rareCandy: { lifetimeLimit: 5, maximumLevel: 100, experienceResult: 'minimum-for-next-level' },
      statSuppressants: { baseStatDelta: -1, minimumBaseStat: 1, consent: 'owning-trainer-explicit' },
      sheetValidity: {
        baseRelations: 'required-after-application', statPointBudget: 'must-not-exceed',
        provenance: 'server-private-immutable-application-ledger',
      },
    })
    expect(contract.execution).toMatchObject({
      actorKind: 'trainer', targetKind: 'owned-pokemon', timing: 'extended',
      startAppliesMechanics: false, interruptAppliesMechanics: false,
      consumeAt: 'extended-action-completion', quantity: 1,
    })
    expect(contract.provenance).toMatchObject({
      storage: 'CharacterSheet.serverPrivate.itemPermanentAdvancement',
      uniqueness: 'one application per source operation identity',
      clientProjection: expect.stringContaining('never expose'),
      setupSavePolicy: expect.stringContaining('read-only'),
    })
    const fixtureIds = itemFixturesJson.fixtures
      .filter(fixture => Object.hasOwn(fixture, 'p8_053Evidence'))
      .map(fixture => fixture.id)
    expect(fixtureIds).toEqual([
      'permanent-stat-vitamins',
      'permanent-pp-up-choice',
      'permanent-rare-candy',
      'permanent-stat-suppressant-consent',
    ])
    expect(contract.certification).toMatchObject({
      focusedMechanicsAndIntegration: { files: 49, tests: 361, result: 'passed' },
      liveplayDesktopAndMobile: { tests: 4, result: 'passed' },
      liveplayProductionBuild: 'passed',
      nuxtTypecheck: 'passed', focusedEslint: 'passed',
      generatedInventoryCheck: 'passed', breedingSuccessorCheck: 'passed',
      gitDiffCheck: 'passed', manualSheetRepairRequired: false,
    })
  })
})

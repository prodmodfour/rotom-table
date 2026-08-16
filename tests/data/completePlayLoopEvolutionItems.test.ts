import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import contract from '../../data/complete-play-loop/evolution-items.v1.json'
import items from '../../data/reference/items.json'
import rules from '../../data/reference/rules.json'
import pokedex from '../../data/reference/pokedex.json'
import specs from '../../data/complete-play-loop/specs.v1.json'
import inventory from '../../data/complete-play-loop/item-inventory.v1.json'
import remediation from '../../data/complete-play-loop/canonical-data-remediation.v1.json'
import { stableJsonStringify } from '#shared/automation/stableJson'
import { ITEM_AUTOMATION_RUNTIME_REGISTRY } from '../../server/domain/itemAutomation/registry'

const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex')
const itemById = items as Record<string, (typeof items)[keyof typeof items]>
const speciesById = new Map(pokedex.map(row => [row.species, row]))

const excerptSha256 = (path: string, range: readonly number[]): string => {
  const lines = readFileSync(path, 'utf8').split(/(?<=\n)/u)
  return sha256(lines.slice(range[0]! - 1, range[1]).join(''))
}

describe('P8-055 Evolutionary Item evidence', () => {
  it('binds 24 items and 62 exact transitions to app-owned canonical authority', () => {
    expect(contract.status).toBe('reviewed-native')
    expect(sha256(readFileSync(contract.canonicalAuthority.items.path))).toBe(contract.canonicalAuthority.items.fileSha256)
    expect(sha256(readFileSync(contract.canonicalAuthority.rules.path))).toBe(contract.canonicalAuthority.rules.fileSha256)
    expect(sha256(readFileSync(contract.canonicalAuthority.pokedex.path))).toBe(contract.canonicalAuthority.pokedex.fileSha256)
    expect(sha256(stableJsonStringify(rules['Evolutionary Items']))).toBe(contract.canonicalAuthority.rules.recordSha256)
    expect(contract.items).toHaveLength(24)
    expect(new Set(contract.items.map(row => row.canonicalId)).size).toBe(24)
    expect(contract.items.reduce((total, row) => total + row.transitionCount, 0)).toBe(62)

    for (const row of contract.items) {
      const item = itemById[row.canonicalId]
      expect(item, row.canonicalId).toBeDefined()
      expect(sha256(stableJsonStringify(item))).toBe(row.recordSha256)
      expect(sha256(item!.effects.join('\n'))).toBe(row.effectSha256)
      expect(row.transitions).toHaveLength(row.transitionCount)
      expect(ITEM_AUTOMATION_RUNTIME_REGISTRY.require(row.canonicalId).spec.effects).toEqual([
        expect.objectContaining({ operation: 'evolve-pokemon', transitionPolicyId: row.canonicalId }),
      ])
      for (const transition of row.transitions) {
        const source = speciesById.get(transition.fromSpecies)
        const target = speciesById.get(transition.toSpecies)
        expect(source, transition.fromSpecies).toBeDefined()
        expect(target, transition.toSpecies).toBeDefined()
        expect(sha256(stableJsonStringify(source))).toBe(transition.fromSpeciesRecordSha256)
        expect(sha256(stableJsonStringify(target))).toBe(transition.toSpeciesRecordSha256)
      }
    }
  })

  it('binds the accepted rules migration and exact documentary excerpts without runtime parsing', () => {
    const migration = remediation.reviewedMigrations.find(row => row.migrationId === contract.canonicalAuthority.rules.migrationId)
    expect(migration).toMatchObject({
      canonicalId: 'Evolutionary Items', canonicalPath: 'data/reference/rules.json',
      beforeFileSha256: 'adb35beee81da45794f97b52997366854e84484b0a357712b33810f5e8836192',
      afterFileSha256: contract.canonicalAuthority.rules.migrationAfterFileSha256,
      afterRecordSha256: contract.canonicalAuthority.rules.recordSha256,
      reviewStatus: 'accepted',
    })
    let currentRulesSha = contract.canonicalAuthority.rules.migrationAfterFileSha256
    for (const migrationId of contract.canonicalAuthority.rules.catalogSuccessorMigrationIds) {
      const successor = remediation.reviewedMigrations.find(row => row.migrationId === migrationId)
      expect(successor).toMatchObject({
        canonicalPath: 'data/reference/rules.json',
        beforeFileSha256: currentRulesSha,
        reviewStatus: 'accepted',
      })
      currentRulesSha = successor!.afterFileSha256
    }
    expect(currentRulesSha).toBe(contract.canonicalAuthority.rules.fileSha256)
    for (const source of contract.sourceEvidence) {
      expect(sha256(readFileSync(source.path))).toBe(source.fileSha256)
      expect(excerptSha256(source.path, source.lineRanges[0]!)).toBe(source.excerptSha256)
      expect(source.gitBlob).toMatch(/^[a-f0-9]{40}$/u)
    }
    expect(contract.canonicalAuthority.runtimeDocumentaryParsingForbidden).toBe(true)
  })

  it('keeps specs, generated inventory classification, privacy, and atomic execution synchronized', () => {
    const ids = new Set(contract.items.map(row => row.canonicalId))
    const specRows = specs.specs.filter(row => ids.has(row.canonicalId))
    expect(specRows).toHaveLength(24)
    expect(specRows.every(row => row.effect.kind === 'evolve-pokemon')).toBe(true)
    const inventoryRows = inventory.rows.filter(row => ids.has(row.canonicalId))
    expect(inventoryRows).toHaveLength(24)
    for (const row of inventoryRows) {
      expect(row.behaviorInventory).toMatchObject({
        mechanicalRole: 'evolution-trigger',
        contexts: ['sheet', 'campaign'],
        timing: 'standard',
        targets: ['participant', 'destination'],
        consumption: { phase: 'accepted-use', quantity: 1, reusable: false },
        currentProductSupport: {
          state: 'native-runtime-wired', gaps: [],
          authorities: expect.arrayContaining([
            'data/complete-play-loop/evolution-items.v1.json',
            'server/domain/itemAutomation/evolution.ts',
            'server/domain/itemAutomation/reducer.ts',
            'server/storage/sheetRepository.ts',
          ]),
        },
      })
    }
    expect(contract.execution.atomicWrites).toEqual([
      'source-inventory', 'pokemon-sheet', 'equipment-state', 'private-evolution-ledger', 'owner-attention',
    ])
    expect(contract.privacy.privateFields).toEqual(expect.arrayContaining([
      'source-operation', 'source-row', 'source-instance', 'hashes',
    ]))
    expect(contract.certification.status).toBe('certified')
  })
})

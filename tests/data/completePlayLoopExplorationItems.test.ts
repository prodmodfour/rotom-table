import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import contract from '../../data/complete-play-loop/exploration-items.v1.json'
import remediation from '../../data/complete-play-loop/canonical-data-remediation.v1.json'
import rules from '../../data/reference/rules.json'
import items from '../../data/reference/items.json'
import features from '../../data/reference/features.json'
import { stableJsonStringify } from '#shared/automation/stableJson'
import { ITEM_AUTOMATION_RUNTIME_REGISTRY } from '../../server/domain/itemAutomation/registry'
import { ITEM_EXPLORATION_SHARD_COLORS } from '#shared/itemAutomation/exploration'

const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex')
const valueSha256 = (value: unknown): string => sha256(stableJsonStringify(value))
const excerptSha256 = (path: string, ranges: readonly (readonly number[])[]): string => {
  const lines = readFileSync(path, 'utf8').split(/(?<=\n)/u)
  return sha256(ranges.map(([start, end]) => lines.slice(start! - 1, end).join('')).join(''))
}

describe('P8-057 reviewed exploration-item authority', () => {
  it('locks exactly seven canonical reviewed item mechanics without documentary runtime parsing', () => {
    expect(contract).toMatchObject({ schemaVersion: 1, ticket: 'P8-057', status: 'reviewed-native', itemCount: 7 })
    expect(contract.canonicalAuthority.runtimeDocumentaryParsingForbidden).toBe(true)
    expect(contract.items.map(row => row.canonicalId)).toEqual([
      'Bait', 'Fishing Lure', 'Honey', 'Repel', 'Super Repel', 'Max Repel', 'Dowsing Rod',
    ])
    for (const row of contract.items) {
      expect(valueSha256(items[row.canonicalId as keyof typeof items])).toBe(row.recordSha256)
      const definition = ITEM_AUTOMATION_RUNTIME_REGISTRY.require(row.canonicalId)
      expect(definition.spec.implementationState).toBe('native')
      expect(definition.spec.evidence.status).toBe('reviewed')
      expect(definition.spec.effects).toHaveLength(1)
    }
    expect(contract.items.find(row => row.canonicalId === 'Fishing Lure')?.reviewedEffect)
      .toMatchObject({ kind: 'start-route-lure', reusable: true, lossPolicy: 'never-automatic-bounded-gm-adjudication' })
    expect(contract.items.find(row => row.canonicalId === 'Dowsing Rod')?.reviewedEffect)
      .toMatchObject({ searchMinutes: 10, shardColors: [...ITEM_EXPLORATION_SHARD_COLORS] })
  })

  it('binds current canonical files, structured records, accepted migration, and source excerpts', () => {
    expect(sha256(readFileSync(contract.canonicalAuthority.rules.path))).toBe(contract.canonicalAuthority.rules.fileSha256)
    expect(sha256(readFileSync(contract.canonicalAuthority.items.path))).toBe(contract.canonicalAuthority.items.fileSha256)
    expect(sha256(readFileSync(contract.canonicalAuthority.features.path))).toBe(contract.canonicalAuthority.features.fileSha256)
    expect(sha256(readFileSync(contract.canonicalAuthority.specs.path))).toBe(contract.canonicalAuthority.specs.fileSha256)
    expect(valueSha256(rules['Exploration Items'])).toBe(contract.canonicalAuthority.rules.recordSha256)
    expect(valueSha256(items.Shards)).toBe(contract.canonicalAuthority.items.shardsRecordSha256)
    expect(valueSha256(features['Crystal Resonance'])).toBe(contract.canonicalAuthority.features.crystalResonanceRecordSha256)
    expect(sha256(readFileSync(contract.reviewedTranscription.path))).toBe(contract.reviewedTranscription.fileSha256)
    expect(contract.reviewedTranscription).toMatchObject({ runtimeAuthority: false, reviewStatus: 'accepted' })

    const migration = remediation.reviewedMigrations.find(row => row.migrationId === contract.canonicalAuthority.rules.migrationId)
    expect(migration).toMatchObject({
      canonicalId: 'Exploration Items',
      canonicalPath: 'data/reference/rules.json',
      beforeFileSha256: 'bc0ff520e94cd81e83a77fc1bad5ee005f028452ecf8989ff6f416cefafa99df',
      afterFileSha256: 'ff0e220165887fec69ce11f70c0db84210ae289a51145196fe885fe0937ce0a8',
      afterRecordSha256: contract.canonicalAuthority.rules.recordSha256,
      reviewStatus: 'accepted',
    })
    let currentRulesSha = migration!.afterFileSha256
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
      expect(excerptSha256(source.path, source.lineRanges)).toBe(source.excerptSha256)
      expect(source.gitBlob).toMatch(/^[a-f0-9]{40}$/u)
    }
  })

  it('certifies explicit clock, GM boundary, privacy, replay, Shard, and positioning policies', () => {
    expect(contract.policy).toEqual({
      routeLureClock: 'campaign-minute-checks-at-fifteen-minute-boundaries',
      routeEncounter: 'bounded-gm-comparable-party-level-prompt',
      wildIdentity: 'exact-map-wild-placement-only',
      repelPositioning: 'server-hit-and-forfeit-with-bounded-gm-positioning-prompt',
      dowsingArea: 'gm-confirmed-route-cave-or-outside-area',
      dowsingRewards: 'atomic-color-preserving-shard-inventory-grants',
      privacy: 'public-consequence-owner-or-gm-detail-private-provenance',
      replay: 'exact-command-idempotency-and-current-authority-revalidation',
    })
    expect(items.Shards.name).toBe('Shards')
    expect(Object.keys(items).filter(name => /^(Red|Orange|Yellow|Green|Blue|Violet) Shard$/u.test(name))).toEqual([])
  })
})

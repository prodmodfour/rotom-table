import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import abilitiesJson from '../../data/reference/abilities.json'
import itemsJson from '../../data/reference/items.json'
import movesJson from '../../data/reference/moves.json'
import pokedexJson from '../../data/reference/pokedex.json'
import rulesJson from '../../data/reference/rules.json'
import contractJson from '../../data/complete-play-loop/move-learning-items.v1.json'
import remediationJson from '../../data/complete-play-loop/canonical-data-remediation.v1.json'
import { stableJsonStringify } from '#shared/automation/stableJson'
import { projectLegacyMoveMechanicalAuthority } from '#shared/ruleset/moveMechanicalAuthority'
import { ITEM_AUTOMATION_RUNTIME_REGISTRY } from '../../server/domain/itemAutomation/registry'

const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex')
const contract = contractJson as unknown as {
  schemaVersion: number
  ticket: string
  status: string
  canonicalAuthority: Record<string, Record<string, unknown>>
  sourceEvidence: readonly { path: string, fileSha256: string, lineRanges: readonly (readonly [number, number])[], excerptSha256: string }[]
  roster: {
    total: number
    tms: number
    hms: number
    items: readonly {
      canonicalId: string
      machineKind: 'TM' | 'HM'
      machineNumber: string
      moveId: string
      canonicalRecordSha256: string
      canonicalEffectSha256: string
      moveRecordSha256: string
      compatibleSpeciesCount: number
      compatibleSpeciesSha256: string
    }[]
  }
  certification: { status: string }
}

const sourceExcerpt = (path: string, ranges: readonly (readonly [number, number])[]): string => {
  const lines = readFileSync(path, 'utf8').split(/(?<=\n)/u)
  return ranges.map(([start, end]) => lines.slice(start - 1, end).join('')).join('')
}

describe('P8-054 machine Move-learning contract', () => {
  it('binds reviewed structured rules and source excerpts without runtime prose parsing', () => {
    expect(contract).toMatchObject({
      schemaVersion: 1,
      ticket: 'P8-054',
      status: 'reviewed-native',
      certification: { status: 'certified' },
    })
    expect(contract.canonicalAuthority.rules.machineRuleRecordSha256)
      .toBe(sha256(stableJsonStringify(rulesJson['TMs and HMs'])))
    expect(contract.canonicalAuthority.rules.tmTutorLimitRecordSha256)
      .toBe(sha256(stableJsonStringify(rulesJson['3-TM/Tutor Move Limit'])))
    expect(contract.canonicalAuthority.rules.tutorPointsRecordSha256)
      .toBe(sha256(stableJsonStringify(rulesJson['Tutor Points'])))
    expect(contract.canonicalAuthority.clusterMind.recordSha256)
      .toBe(sha256(stableJsonStringify(abilitiesJson['Cluster Mind'])))
    expect(contract.canonicalAuthority.runtimeDocumentaryParsingForbidden).toBe(true)
    for (const evidence of contract.sourceEvidence) {
      expect(sha256(readFileSync(evidence.path))).toBe(evidence.fileSha256)
      expect(sha256(sourceExcerpt(evidence.path, evidence.lineRanges))).toBe(evidence.excerptSha256)
    }
  })

  it('covers every exact canonical TM/HM item with one Move and species-compatibility authority', () => {
    const canonicalMachines = Object.values(itemsJson).filter(item => (
      item.categories.length === 1 && (item.categories[0] === 'TM' || item.categories[0] === 'HM')
    ))
    expect(contract.roster).toMatchObject({ total: 106, tms: 100, hms: 6 })
    expect(contract.roster.items).toHaveLength(canonicalMachines.length)
    expect(new Set(contract.roster.items.map(row => row.canonicalId)).size).toBe(106)
    for (const row of contract.roster.items) {
      const item = itemsJson[row.canonicalId as keyof typeof itemsJson]
      const move = movesJson[row.moveId as keyof typeof movesJson]
      expect(item?.name).toBe(row.canonicalId)
      expect(item?.categories).toEqual([row.machineKind])
      expect(sha256(stableJsonStringify(item))).toBe(row.canonicalRecordSha256)
      expect(sha256(item.effects.join('\n'))).toBe(row.canonicalEffectSha256)
      expect(move?.name).toBe(row.moveId)
      expect(sha256(stableJsonStringify(projectLegacyMoveMechanicalAuthority(move!)))).toBe(row.moveRecordSha256)
      const compatibleSpecies = pokedexJson.filter(species => species.tm_hm_moves?.some(entry => (
        entry.kind === row.machineKind && entry.number === row.machineNumber && entry.name === row.moveId
      ))).map(species => species.species).sort()
      expect(compatibleSpecies).toHaveLength(row.compatibleSpeciesCount)
      expect(sha256(stableJsonStringify(compatibleSpecies))).toBe(row.compatibleSpeciesSha256)
      expect(ITEM_AUTOMATION_RUNTIME_REGISTRY.require(row.canonicalId).spec.effects).toEqual([
        expect.objectContaining({
          operation: 'learn-machine-move',
          machineKind: row.machineKind,
          machineNumber: row.machineNumber,
          moveId: row.moveId,
        }),
      ])
    }
  })

  it('records exact accepted rule and Facade successor migrations', () => {
    const migrations = new Map(remediationJson.reviewedMigrations.map(row => [row.migrationId, row]))
    expect(migrations.get('rule-data-machine-move-learning-mechanics-v1')).toMatchObject({
      beforeFileSha256: '924233a88593c7178bc2e32356de55a80d2f1235c2a7825e39a097ae8690acd9',
      afterFileSha256: 'adb35beee81da45794f97b52997366854e84484b0a357712b33810f5e8836192',
      afterRecordSha256: '4660d7ac403b12cd107c68fee363bb89568664b507d7366c58263e3e7ceeee61',
      reviewStatus: 'accepted',
    })
    let currentRulesSha = 'adb35beee81da45794f97b52997366854e84484b0a357712b33810f5e8836192'
    for (const migrationId of contract.canonicalAuthority.rules.catalogSuccessorMigrationIds) {
      const successor = migrations.get(migrationId)
      expect(successor).toMatchObject({
        canonicalPath: 'data/reference/rules.json',
        beforeFileSha256: currentRulesSha,
        reviewStatus: 'accepted',
      })
      currentRulesSha = successor!.afterFileSha256
    }
    expect(currentRulesSha).toBe(contract.canonicalAuthority.rules.fileSha256)
    expect(migrations.get('move-data-facade-identity-normalization-v1')).toMatchObject({
      beforeFileSha256: 'f90491826349afd7d1f2809fd9d74b7acc555f5163b99264205ee369249e9815',
      afterFileSha256: '418d20378d61383295da0c6d4a8a3752e6ed001300c604df9fe7e3f04276089e',
      afterRecordSha256: 'b26f4a5f2e31b96ed7e725ebfca8f6787aae83d41d55687cc0bb3b31063b22d1',
      reviewStatus: 'accepted',
    })
  })
})

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import contract from '../../data/complete-play-loop/item-form-changes.v1.json'
import remediation from '../../data/complete-play-loop/canonical-data-remediation.v1.json'
import rules from '../../data/reference/rules.json'
import items from '../../data/reference/items.json'
import pokedex from '../../data/reference/pokedex.json'
import abilities from '../../data/reference/abilities.json'
import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  ITEM_FORM_CHANGE_FORM_COUNT,
  ITEM_FORM_CHANGE_RULE_RECORD_SHA256,
  canonicalItemFormChangeAbilityRecordSha256,
  canonicalItemFormChangeSpeciesRecordSha256,
  reviewedItemFormChangeForId,
  reviewedItemFormChanges,
} from '../../server/domain/itemAutomation/formChangeRegistry'

const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex')
const valueSha256 = (value: unknown): string => sha256(stableJsonStringify(value))

const excerptSha256 = (path: string, ranges: readonly (readonly number[])[]): string => {
  const lines = readFileSync(path, 'utf8').split(/(?<=\n)/u)
  return sha256(ranges.map(([start, end]) => lines.slice(start! - 1, end).join('')).join(''))
}

describe('P8-056 reviewed item-driven form-change authority', () => {
  it('binds exactly 50 reviewed Mega forms across 48 canonical base species', () => {
    expect(contract.status).toBe('reviewed-native')
    expect(contract.formCount).toBe(50)
    expect(contract.speciesCount).toBe(48)
    expect(ITEM_FORM_CHANGE_FORM_COUNT).toBe(50)
    expect(reviewedItemFormChanges()).toHaveLength(50)
    expect(new Set(contract.forms.map(form => form.formId)).size).toBe(50)
    expect(new Set(contract.forms.map(form => form.baseSpeciesId)).size).toBe(48)
    expect(contract.forms.filter(form => form.baseSpeciesId === 'Charizard')).toHaveLength(2)
    expect(contract.forms.filter(form => form.baseSpeciesId === 'Mewtwo')).toHaveLength(2)
    expect(contract.forms.filter(form => form.baseSpeciesId === 'Rayquaza')).toEqual([
      expect.objectContaining({ formId: 'mega-rayquaza', requiresMegaStone: false }),
    ])

    const mechanics = rules['Item-Driven Form Changes'].itemFormChangeMechanics
    expect(mechanics.forms).toHaveLength(50)
    for (const row of contract.forms) {
      const authority = mechanics.forms.find(form => form.formId === row.formId)
      expect(authority, row.formId).toBeDefined()
      expect(valueSha256(authority)).toBe(row.formRecordSha256)
      expect(reviewedItemFormChangeForId(row.formId)).toMatchObject({
        ...authority,
        recordSha256: row.formRecordSha256,
      })
      expect(canonicalItemFormChangeSpeciesRecordSha256(row.baseSpeciesId)).toBe(row.baseSpeciesRecordSha256)
      expect(canonicalItemFormChangeAbilityRecordSha256(row.abilityId)).toBe(row.abilityRecordSha256)
      expect(pokedex.some(species => species.species === row.baseSpeciesId)).toBe(true)
      expect(Object.hasOwn(abilities, row.abilityId)).toBe(true)
      expect(Object.values(row.statDeltas).every(delta => Number.isSafeInteger(delta))).toBe(true)
    }
  })

  it('locks canonical catalogs, accepted migration evidence, and documentary excerpts', () => {
    expect(sha256(readFileSync(contract.canonicalAuthority.rules.path))).toBe(contract.canonicalAuthority.rules.fileSha256)
    expect(sha256(readFileSync(contract.canonicalAuthority.items.path))).toBe(contract.canonicalAuthority.items.fileSha256)
    expect(sha256(readFileSync(contract.canonicalAuthority.pokedex.path))).toBe(contract.canonicalAuthority.pokedex.fileSha256)
    expect(sha256(readFileSync(contract.canonicalAuthority.abilities.path))).toBe(contract.canonicalAuthority.abilities.fileSha256)
    expect(valueSha256(rules['Item-Driven Form Changes'])).toBe(contract.canonicalAuthority.rules.recordSha256)
    expect(ITEM_FORM_CHANGE_RULE_RECORD_SHA256).toBe(contract.canonicalAuthority.rules.recordSha256)
    expect(valueSha256(items['Mega Ring'])).toBe(contract.canonicalAuthority.items.ringRecordSha256)
    expect(valueSha256(items['Mega Stone'])).toBe(contract.canonicalAuthority.items.stoneRecordSha256)
    expect(contract.canonicalAuthority.runtimeDocumentaryParsingForbidden).toBe(true)

    const migration = remediation.reviewedMigrations.find(row => row.migrationId === contract.canonicalAuthority.rules.migrationId)
    expect(migration).toMatchObject({
      canonicalId: 'Item-Driven Form Changes',
      canonicalPath: 'data/reference/rules.json',
      beforeFileSha256: '68c0f55a4038423de752ece05afa44830babe5ab0e642add524da46f4a49373e',
      afterFileSha256: 'bc0ff520e94cd81e83a77fc1bad5ee005f028452ecf8989ff6f416cefafa99df',
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
    expect(sha256(readFileSync(contract.reviewedTranscription.path))).toBe(contract.reviewedTranscription.fileSha256)
    expect(contract.reviewedTranscription.runtimeAuthority).toBe(false)
    for (const source of contract.sourceEvidence) {
      expect(sha256(readFileSync(source.path))).toBe(source.fileSha256)
      expect(excerptSha256(source.path, source.lineRanges)).toBe(source.excerptSha256)
      expect(source.gitBlob).toMatch(/^[a-f0-9]{40}$/u)
    }
  })

  it('certifies the reviewed Scene lifecycle and privacy policy without unsupported forms', () => {
    expect(contract.policy).toEqual({
      timing: 'swift-action-on-trainer-or-pokemon-turn',
      duration: 'scene',
      trainerSceneLimit: 1,
      hp: 'unchanged',
      stats: 'add-reviewed-non-hp-deltas-to-effective-stats',
      types: 'replace-only-when-form-record-declares-types',
      abilities: 'add-reviewed-ability-or-select-distinct-natural-ability-on-duplicate',
      identity: 'retain-sheet-character-history-and-customization',
      sources: 'active-matching-ring-and-form-bound-stone-or-reviewed-delta-exception',
      sourceLoss: 'accepted-scene-form-survives-suppression-and-stone-is-removal-locked',
      reversal: 'automatic-at-scene-end',
      persistentForms: 'supported-by-state-model-but-no-reviewed-item-trigger',
      privacy: 'public-form-consequence-private-source-and-operation-evidence',
      replay: 'exact-command-idempotency-and-current-authority-revalidation',
    })
    expect(contract.forms.some(form => /primal|origin|crowned|fusion|appliance/iu.test(form.formId))).toBe(false)
  })
})

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  BREEDING_OFFER_OPTION_KINDS,
  breedingFamilyIdForRoot,
  compileBreedingCanonicalLocalId,
  isBreedingCanonicalLocalIdSyntax,
  parseBreedingCampaignOptionIdSyntax,
  parseBreedingFamilyIdSyntax,
  parseBreedingOfferOptionIdSyntax,
  parseBreedingSpeciesIdSyntax,
} from '#shared/breeding/ids'
import {
  BREEDING_CANONICAL_ABILITIES,
  BREEDING_CANONICAL_ABILITY_COUNT,
  BREEDING_CANONICAL_CAMPAIGN_OPTION_COUNT,
  BREEDING_CANONICAL_CAMPAIGN_OPTIONS,
  BREEDING_CANONICAL_EGG_GROUP_COUNT,
  BREEDING_CANONICAL_EGG_GROUPS,
  BREEDING_CANONICAL_ID_DEFINITION_SHA256,
  BREEDING_CANONICAL_MOVE_COUNT,
  BREEDING_CANONICAL_MOVES,
  BREEDING_CANONICAL_SPECIES,
  BREEDING_CANONICAL_SPECIES_COUNT,
  canonicalBreedingAbilityIdentity,
  canonicalBreedingCampaignOptionIdentity,
  canonicalBreedingEggGroupIdentity,
  canonicalBreedingMoveIdentity,
  canonicalBreedingSpeciesIdentity,
  isCanonicalBreedingSpeciesId,
} from '../../server/domain/breeding/canonicalIds'

const ROOT = resolve(import.meta.dirname, '../..')
const readJson = <T>(path: string): T => JSON.parse(readFileSync(resolve(ROOT, path), 'utf8')) as T
const sha256 = (value: Buffer | string): string => createHash('sha256').update(value).digest('hex')

interface CatalogSourceRow { id: string, sourceName: string, sourceIndex: number, sourceRecordSha256: string }
interface CanonicalIdCatalog {
  schemaVersion: number
  catalogId: string
  rulesetId: string
  rulesetDefinitionSha256: string
  taxonomyDefinitionSha256: string
  sourceManifestSha256: string
  definitionSha256: string
  definition: {
    identityVersion: number
    canonicalLocalId: Record<string, unknown>
    maintenanceSourceNameToIdAlgorithm: Record<string, unknown>
    idKinds: Array<{ id: string, typescriptBrand: string, value: string, membership: string }>
    catalogOrder: string
    catalogs: {
      species: CatalogSourceRow[]
      moves: CatalogSourceRow[]
      abilities: CatalogSourceRow[]
      eggGroups: Array<{ id: string, sourceName: string, taxonomyRecordSha256: string }>
      campaignOptions: Array<{ id: string, kind: string, definitionSha256: string }>
    }
    offerOptionKinds: string[]
    diagnostics: Record<string, number>
    sourceBindings: Record<string, string>
    unknownIdentity: Record<string, string>
  }
}

const catalog = readJson<CanonicalIdCatalog>('data/breeding-automation/canonical-ids.json')
const sourceManifestBytes = readFileSync(resolve(ROOT, 'data/breeding-automation/source-manifest.json'))
const ruleset = readJson<{ rulesetId: string, definitionSha256: string, definition: { campaignOptions: Array<Record<string, unknown> & { id: string }> } }>('data/breeding-automation/ruleset.json')
const taxonomy = readJson<{ definitionSha256: string, definition: { eggGroups: Array<Record<string, unknown> & { id: string, label: string }> } }>('data/breeding-automation/taxonomies.json')
const pokedex = readJson<Array<Record<string, unknown> & { species: string }>>('data/reference/pokedex.json')
const moves = readJson<Record<string, Record<string, unknown>>>('data/reference/moves.json')
const abilities = readJson<Record<string, Record<string, unknown>>>('data/reference/abilities.json')

describe('breeding canonical IDs', () => {
  it('freezes a source-, ruleset-, and taxonomy-bound definition', () => {
    expect(catalog).toMatchObject({
      schemaVersion: 1,
      catalogId: 'ptu-1.05-breeding-canonical-ids-v1',
      rulesetId: ruleset.rulesetId,
      rulesetDefinitionSha256: ruleset.definitionSha256,
      taxonomyDefinitionSha256: taxonomy.definitionSha256,
      sourceManifestSha256: sha256(sourceManifestBytes),
    })
    expect(catalog.definitionSha256).toBe(sha256(stableJsonStringify(catalog.definition)))
    expect(BREEDING_CANONICAL_ID_DEFINITION_SHA256).toBe(catalog.definitionSha256)
    expect(catalog.definition.catalogOrder).toBe('canonical-id-unicode-code-point')
    expect(catalog.definition.unknownIdentity).toEqual({
      syntaxValidButUnknown: 'reject',
      sourceLabelAtRuntime: 'reject',
      caseOrTypographyVariant: 'reject',
      clientAuthoredOption: 'reject',
      diagnosticIncludesRawValue: 'never-public',
    })
  })

  it('implements the frozen maintenance-only source-name mapping without fuzzy runtime identity', () => {
    expect(compileBreedingCanonicalLocalId('Abra')).toEqual({ ok: true, id: 'abra' })
    expect(compileBreedingCanonicalLocalId('Nidoran♀')).toEqual({ ok: true, id: 'nidoran-female' })
    expect(compileBreedingCanonicalLocalId('Nidoran♂')).toEqual({ ok: true, id: 'nidoran-male' })
    expect(compileBreedingCanonicalLocalId('Flabébé')).toEqual({ ok: true, id: 'flabebe' })
    expect(compileBreedingCanonicalLocalId('Type: Null')).toEqual({ ok: true, id: 'type-null' })
    expect(compileBreedingCanonicalLocalId('Nature’s Madness')).toEqual({ ok: true, id: 'natures-madness' })
    expect(compileBreedingCanonicalLocalId('Rock & Roll')).toEqual({ ok: true, id: 'rock-and-roll' })
    expect(compileBreedingCanonicalLocalId('')).toEqual({ ok: false, reason: 'invalid-source-name' })
    expect(compileBreedingCanonicalLocalId('\u0000Abra')).toEqual({ ok: false, reason: 'invalid-source-name' })
    expect(compileBreedingCanonicalLocalId('!!!')).toEqual({ ok: false, reason: 'empty-canonical-id' })
    expect(compileBreedingCanonicalLocalId('a'.repeat(65))).toEqual({ ok: false, reason: 'overlong-canonical-id' })

    expect(isBreedingCanonicalLocalIdSyntax('nidoran-female')).toBe(true)
    expect(isBreedingCanonicalLocalIdSyntax('Nidoran♀')).toBe(false)
    expect(isBreedingCanonicalLocalIdSyntax(' nidoran-female ')).toBe(false)
    expect(isBreedingCanonicalLocalIdSyntax('nidoran_female')).toBe(false)
    expect(isBreedingCanonicalLocalIdSyntax('a'.repeat(65))).toBe(false)
  })

  it('maps the frozen app-owned baseline with exact provenance and excludes only reviewed successor records', () => {
    expect(BREEDING_CANONICAL_SPECIES_COUNT).toBe(1_149)
    expect(BREEDING_CANONICAL_MOVE_COUNT).toBe(777)
    expect(BREEDING_CANONICAL_ABILITY_COUNT).toBe(483)
    expect(BREEDING_CANONICAL_SPECIES).toHaveLength(pokedex.length)
    expect(BREEDING_CANONICAL_MOVES).toHaveLength(Object.keys(moves).length)
    expect(BREEDING_CANONICAL_ABILITIES).toHaveLength(Object.keys(abilities).length)
    expect(Object.keys(moves).filter(name => !BREEDING_CANONICAL_MOVES.some(row => row.sourceName === name)))
      .toEqual(['Facade'])
    expect(BREEDING_CANONICAL_MOVES.filter(row => !Object.hasOwn(moves, row.sourceName)).map(row => row.sourceName))
      .toEqual(['Façade'])

    const validateRows = (
      rows: readonly CatalogSourceRow[],
      sourceRows: readonly [string, Record<string, unknown>][],
    ): void => {
      expect(new Set(rows.map(row => row.id)).size).toBe(rows.length)
      expect(new Set(rows.map(row => row.sourceName)).size).toBe(rows.length)
      expect(rows.map(row => row.id)).toEqual([...rows.map(row => row.id)].sort())
      for (const row of rows) {
        const source = sourceRows[row.sourceIndex]
        expect(source?.[0], row.id).toBe(row.sourceName)
        expect(row.sourceRecordSha256, row.id).toBe(sha256(stableJsonStringify(source?.[1])))
        expect(compileBreedingCanonicalLocalId(row.sourceName), row.sourceName).toEqual({ ok: true, id: row.id })
      }
    }
    validateRows(catalog.definition.catalogs.species, pokedex.map(row => [row.species, row]))
    const frozenMoveSources = Object.entries(moves)
    frozenMoveSources[503] = ['Façade', {
      name: 'Façade', type: 'Normal', frequency: 'EOT', ac: 2, damage_base: 7,
      damage_roll: '2d6+10 / 17', damage_class: 'Physical', range: 'Melee, 1 Target',
      effect: 'If the user is afflicted with a Persistent Status Affliction, Façade’s Damage Base is doubled to DB 14 (4d10+15 / 40).',
    }]
    validateRows(catalog.definition.catalogs.moves, frozenMoveSources)
    validateRows(catalog.definition.catalogs.abilities, Object.entries(abilities))
    expect(catalog.definition.diagnostics).toMatchObject({
      speciesCount: 1_149,
      moveCount: 777,
      abilityCount: 483,
      speciesIdCollisions: 0,
      moveIdCollisions: 0,
      abilityIdCollisions: 0,
      emptyIds: 0,
      overlongIds: 0,
    })
  })

  it('maps the closed Egg Group and campaign-option catalogs with exact definition provenance', () => {
    expect(BREEDING_CANONICAL_EGG_GROUP_COUNT).toBe(14)
    expect(BREEDING_CANONICAL_CAMPAIGN_OPTION_COUNT).toBe(15)
    expect(BREEDING_CANONICAL_EGG_GROUPS.map(row => row.id)).toEqual(
      [...taxonomy.definition.eggGroups.map(row => row.id)].sort(),
    )
    for (const row of BREEDING_CANONICAL_EGG_GROUPS) {
      const source = taxonomy.definition.eggGroups.find(group => group.id === row.id)
      expect(row.sourceName).toBe(source?.label)
      expect(row.taxonomyRecordSha256).toBe(sha256(stableJsonStringify(source)))
      expect(canonicalBreedingEggGroupIdentity(row.id)).toEqual(row)
    }
    expect(BREEDING_CANONICAL_CAMPAIGN_OPTIONS.map(row => row.id)).toEqual(
      [...ruleset.definition.campaignOptions.map(row => row.id)].sort(),
    )
    for (const row of BREEDING_CANONICAL_CAMPAIGN_OPTIONS) {
      const source = ruleset.definition.campaignOptions.find(option => option.id === row.id)
      expect(row.definitionSha256).toBe(sha256(stableJsonStringify(source)))
      expect(canonicalBreedingCampaignOptionIdentity(row.id)).toEqual(row)
    }
  })

  it('requires exact catalog membership in server identity resolution', () => {
    expect(canonicalBreedingSpeciesIdentity('abra')).toMatchObject({ id: 'abra', sourceName: 'Abra', sourceIndex: 0 })
    expect(canonicalBreedingSpeciesIdentity('ditto')).toMatchObject({ id: 'ditto', sourceName: 'Ditto' })
    expect(canonicalBreedingMoveIdentity('natures-madness')).toMatchObject({ sourceName: 'Nature’s Madness' })
    expect(canonicalBreedingAbilityIdentity('synchronize')).toMatchObject({ sourceName: 'Synchronize' })
    expect(isCanonicalBreedingSpeciesId('abra')).toBe(true)

    for (const value of ['Abra', ' abra', 'ABRA', 'unknown-species', '', null, 4]) {
      expect(canonicalBreedingSpeciesIdentity(value), String(value)).toBeNull()
      expect(isCanonicalBreedingSpeciesId(value), String(value)).toBe(false)
    }
    expect(canonicalBreedingMoveIdentity('Facade')).toBeNull()
    expect(canonicalBreedingMoveIdentity('facade')).toMatchObject({ sourceName: 'Façade' })
    expect(canonicalBreedingAbilityIdentity('SYNCHRONIZE')).toBeNull()
    expect(canonicalBreedingEggGroupIdentity('Field')).toBeNull()
    expect(canonicalBreedingCampaignOptionIdentity('breeding.unknown-option')).toBeNull()
  })

  it('separates family, campaign-option, and current-offer identity syntax', () => {
    const abra = parseBreedingSpeciesIdSyntax('abra')!
    expect(breedingFamilyIdForRoot(abra)).toBe('family:abra')
    expect(parseBreedingFamilyIdSyntax('family:abra')).toBe('family:abra')
    expect(parseBreedingFamilyIdSyntax('abra')).toBeNull()
    expect(parseBreedingFamilyIdSyntax('family:Abra')).toBeNull()
    expect(parseBreedingFamilyIdSyntax('family:unknown')).toBe('family:unknown') // syntax only; BR-013 owns membership

    expect(parseBreedingCampaignOptionIdSyntax('breeding.maturity-policy')).toBe('breeding.maturity-policy')
    expect(parseBreedingCampaignOptionIdSyntax('Breeding.maturity-policy')).toBeNull()
    expect(parseBreedingCampaignOptionIdSyntax('breeding.maturity.policy')).toBeNull()
    expect(parseBreedingOfferOptionIdSyntax('option:v1:0123456789abcdef0123456789abcdef')).toBe('option:v1:0123456789abcdef0123456789abcdef')
    expect(parseBreedingOfferOptionIdSyntax('option:v1:0123456789ABCDEF0123456789ABCDEF')).toBeNull()
    expect(parseBreedingOfferOptionIdSyntax('option:v1:0123')).toBeNull()
    expect(catalog.definition.offerOptionKinds).toEqual(BREEDING_OFFER_OPTION_KINDS)
    expect(catalog.definition.idKinds.map(row => row.id)).toEqual([
      'species', 'family', 'egg-group', 'move', 'ability', 'campaign-option', 'offer-option',
    ])
  })
})

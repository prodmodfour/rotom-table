import canonicalIdsJson from '../../../data/breeding-automation/canonical-ids.json'
import {
  parseBreedingAbilityIdSyntax,
  parseBreedingCampaignOptionIdSyntax,
  parseBreedingEggGroupIdSyntax,
  parseBreedingMoveIdSyntax,
  parseBreedingSpeciesIdSyntax,
  type BreedingAbilityId,
  type BreedingCampaignOptionId,
  type BreedingEggGroupId,
  type BreedingMoveId,
  type BreedingSpeciesId,
} from '#shared/breeding/ids'

export const BREEDING_CANONICAL_ID_CATALOG_VERSION = 1 as const
export const BREEDING_CANONICAL_SPECIES_COUNT = 1_149 as const
export const BREEDING_CANONICAL_MOVE_COUNT = 777 as const
export const BREEDING_CANONICAL_ABILITY_COUNT = 483 as const
export const BREEDING_CANONICAL_EGG_GROUP_COUNT = 14 as const
export const BREEDING_CANONICAL_CAMPAIGN_OPTION_COUNT = 15 as const

export interface BreedingCanonicalSourceIdentity<Id extends string> {
  readonly id: Id
  readonly sourceName: string
  readonly sourceIndex: number
  readonly sourceRecordSha256: string
}

export interface BreedingCanonicalEggGroupIdentity {
  readonly id: BreedingEggGroupId
  readonly sourceName: string
  readonly taxonomyRecordSha256: string
}

export interface BreedingCanonicalCampaignOptionIdentity {
  readonly id: BreedingCampaignOptionId
  readonly kind: 'enum' | 'integer'
  readonly definitionSha256: string
}

interface RawSourceIdentity {
  id: string
  sourceName: string
  sourceIndex: number
  sourceRecordSha256: string
}
interface RawEggGroupIdentity {
  id: string
  sourceName: string
  taxonomyRecordSha256: string
}
interface RawCampaignOptionIdentity {
  id: string
  kind: 'enum' | 'integer'
  definitionSha256: string
}
interface RawCanonicalIdCatalog {
  schemaVersion: number
  catalogId: string
  definitionSha256: string
  definition: {
    catalogs: {
      species: RawSourceIdentity[]
      moves: RawSourceIdentity[]
      abilities: RawSourceIdentity[]
      eggGroups: RawEggGroupIdentity[]
      campaignOptions: RawCampaignOptionIdentity[]
    }
    diagnostics: {
      speciesCount: number
      moveCount: number
      abilityCount: number
      eggGroupCount: number
      campaignOptionCount: number
    }
  }
}

const raw = canonicalIdsJson as RawCanonicalIdCatalog
if (raw.schemaVersion !== BREEDING_CANONICAL_ID_CATALOG_VERSION
  || raw.catalogId !== 'ptu-1.05-breeding-canonical-ids-v1') {
  throw new Error('Breeding canonical ID catalog identity is invalid.')
}

const freezeSourceRows = <Id extends string>(
  rows: readonly RawSourceIdentity[],
  parse: (value: unknown) => Id | null,
  label: string,
  expectedCount: number,
): readonly BreedingCanonicalSourceIdentity<Id>[] => {
  if (rows.length !== expectedCount) throw new Error(`${label} canonical ID count is invalid.`)
  const seenIds = new Set<string>()
  const seenNames = new Set<string>()
  const result = rows.map((row, index) => {
    const id = parse(row.id)
    if (!id || seenIds.has(id) || seenNames.has(row.sourceName)
      || row.sourceIndex < 0 || !Number.isSafeInteger(row.sourceIndex)
      || !/^[0-9a-f]{64}$/.test(row.sourceRecordSha256)) {
      throw new Error(`${label} canonical ID row ${index} is invalid.`)
    }
    seenIds.add(id)
    seenNames.add(row.sourceName)
    return Object.freeze({ ...row, id })
  })
  if (result.some((row, index) => index > 0 && result[index - 1]!.id >= row.id)) {
    throw new Error(`${label} canonical IDs are not in strict code-point order.`)
  }
  return Object.freeze(result)
}

export const BREEDING_CANONICAL_SPECIES = freezeSourceRows(
  raw.definition.catalogs.species,
  parseBreedingSpeciesIdSyntax,
  'Species',
  BREEDING_CANONICAL_SPECIES_COUNT,
)
export const BREEDING_CANONICAL_MOVES = freezeSourceRows(
  raw.definition.catalogs.moves,
  parseBreedingMoveIdSyntax,
  'Move',
  BREEDING_CANONICAL_MOVE_COUNT,
)
export const BREEDING_CANONICAL_ABILITIES = freezeSourceRows(
  raw.definition.catalogs.abilities,
  parseBreedingAbilityIdSyntax,
  'Ability',
  BREEDING_CANONICAL_ABILITY_COUNT,
)

const eggGroups: BreedingCanonicalEggGroupIdentity[] = raw.definition.catalogs.eggGroups.map((row, index) => {
  const id = parseBreedingEggGroupIdSyntax(row.id)
  if (!id || !/^[0-9a-f]{64}$/.test(row.taxonomyRecordSha256)) {
    throw new Error(`Egg Group canonical ID row ${index} is invalid.`)
  }
  return Object.freeze({ ...row, id })
})
if (eggGroups.length !== BREEDING_CANONICAL_EGG_GROUP_COUNT
  || new Set(eggGroups.map(row => row.id)).size !== eggGroups.length) {
  throw new Error('Egg Group canonical IDs are incomplete or duplicated.')
}
export const BREEDING_CANONICAL_EGG_GROUPS = Object.freeze(eggGroups)

const campaignOptions: BreedingCanonicalCampaignOptionIdentity[] = raw.definition.catalogs.campaignOptions.map((row, index) => {
  const id = parseBreedingCampaignOptionIdSyntax(row.id)
  if (!id || !['enum', 'integer'].includes(row.kind) || !/^[0-9a-f]{64}$/.test(row.definitionSha256)) {
    throw new Error(`Campaign option canonical ID row ${index} is invalid.`)
  }
  return Object.freeze({ ...row, id })
})
if (campaignOptions.length !== BREEDING_CANONICAL_CAMPAIGN_OPTION_COUNT
  || new Set(campaignOptions.map(row => row.id)).size !== campaignOptions.length) {
  throw new Error('Campaign option canonical IDs are incomplete or duplicated.')
}
export const BREEDING_CANONICAL_CAMPAIGN_OPTIONS = Object.freeze(campaignOptions)

const speciesById = new Map(BREEDING_CANONICAL_SPECIES.map(row => [row.id, row]))
const movesById = new Map(BREEDING_CANONICAL_MOVES.map(row => [row.id, row]))
const abilitiesById = new Map(BREEDING_CANONICAL_ABILITIES.map(row => [row.id, row]))
const eggGroupsById = new Map(BREEDING_CANONICAL_EGG_GROUPS.map(row => [row.id, row]))
const campaignOptionsById = new Map(BREEDING_CANONICAL_CAMPAIGN_OPTIONS.map(row => [row.id, row]))

export const canonicalBreedingSpeciesIdentity = (value: unknown): BreedingCanonicalSourceIdentity<BreedingSpeciesId> | null => {
  const id = parseBreedingSpeciesIdSyntax(value)
  return id ? speciesById.get(id) ?? null : null
}
export const canonicalBreedingMoveIdentity = (value: unknown): BreedingCanonicalSourceIdentity<BreedingMoveId> | null => {
  const id = parseBreedingMoveIdSyntax(value)
  return id ? movesById.get(id) ?? null : null
}
export const canonicalBreedingAbilityIdentity = (value: unknown): BreedingCanonicalSourceIdentity<BreedingAbilityId> | null => {
  const id = parseBreedingAbilityIdSyntax(value)
  return id ? abilitiesById.get(id) ?? null : null
}
export const canonicalBreedingEggGroupIdentity = (value: unknown): BreedingCanonicalEggGroupIdentity | null => {
  const id = parseBreedingEggGroupIdSyntax(value)
  return id ? eggGroupsById.get(id) ?? null : null
}
export const canonicalBreedingCampaignOptionIdentity = (value: unknown): BreedingCanonicalCampaignOptionIdentity | null => {
  const id = parseBreedingCampaignOptionIdSyntax(value)
  return id ? campaignOptionsById.get(id) ?? null : null
}

export const isCanonicalBreedingSpeciesId = (value: unknown): value is BreedingSpeciesId => canonicalBreedingSpeciesIdentity(value) !== null
export const isCanonicalBreedingMoveId = (value: unknown): value is BreedingMoveId => canonicalBreedingMoveIdentity(value) !== null
export const isCanonicalBreedingAbilityId = (value: unknown): value is BreedingAbilityId => canonicalBreedingAbilityIdentity(value) !== null
export const isCanonicalBreedingEggGroupId = (value: unknown): value is BreedingEggGroupId => canonicalBreedingEggGroupIdentity(value) !== null
export const isCanonicalBreedingCampaignOptionId = (value: unknown): value is BreedingCampaignOptionId => canonicalBreedingCampaignOptionIdentity(value) !== null

export const BREEDING_CANONICAL_ID_DEFINITION_SHA256 = raw.definitionSha256

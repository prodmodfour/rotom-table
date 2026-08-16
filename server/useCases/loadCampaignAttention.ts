import type { AuthRole } from '../../shared/auth'
import { POKEMON_EGG_STATUSES, type PokemonEggDocumentV1 } from '../../shared/breeding/egg'
import type { PokemonBreedingOriginV1 } from '../../shared/breeding/lineage'
import type { PlayerProfile } from '../../shared/playerProfiles'
import { isSlug } from '../../shared/paths'
import type { CampaignAttentionItem } from '../../shared/campaignAttention/model'
import type { CampaignAttentionProjectionV1 } from '../../shared/campaignAttention/projection'
import { stableJsonStringify } from '../../shared/automation/stableJson'
import { projectCampaignAdvancementAttention } from '../domain/campaignAttention/advancementDetector'
import { projectCampaignPokemonChoiceAttention } from '../domain/campaignAttention/pokemonChoiceDetector'
import { projectCampaignTrainerChoiceAttention } from '../domain/campaignAttention/trainerChoiceDetector'
import { projectCampaignRecoveryAttention } from '../domain/campaignAttention/recoveryDetector'
import {
  campaignProfileAuthorityDefinitionSha256,
  projectCampaignRosterOwnershipAttention,
  type CampaignProfileAuthorityV1,
} from '../domain/campaignAttention/rosterOwnershipDetector'
import { campaignAttentionItemsFromSettlementSources } from '../domain/campaignAttention/settlementProvider'
import {
  mergeCampaignAttentionItems,
  projectCampaignAttentionForViewer,
} from '../domain/campaignAttention/projection'
import {
  getRotomDatabase,
  type RotomDatabase,
} from '../storage/database'
import {
  createSqliteEncounterSettlementRepository,
  type StoredEncounterSettlementAttentionSource,
  type StoredEncounterSettlementHistoryFact,
} from '../storage/encounterSettlementRepository'
import {
  createSqliteItemOperationRepository,
  type StoredItemOperationRecord,
} from '../storage/itemOperationRepository'
import {
  createSqliteBreedingOperationRepository,
  type BreedingOperationLedgerRecord,
} from '../storage/breedingOperationRepository'
import { createSqlitePokemonEggRepository } from '../storage/pokemonEggRepository'
import { createSqliteBreedingLineageRepository } from '../storage/breedingLineageRepository'
import { createSqliteCampaignClockRepository } from '../storage/campaignClockRepository'
import { createSqliteSheetRepository, type StoredSheetDocument } from '../storage/sheetRepository'
import { listPlayerProfiles } from '../utils/playerProfileStorage'

export const CAMPAIGN_ATTENTION_AUTHORITY_READ_LIMIT = 10_000

export interface CampaignAttentionAuthoritySnapshot {
  readonly sheets: readonly StoredSheetDocument[]
  readonly profiles: readonly CampaignProfileAuthorityV1[]
  readonly settlementSources: readonly StoredEncounterSettlementAttentionSource[]
  readonly historyFacts: readonly StoredEncounterSettlementHistoryFact[]
  readonly itemOperations: readonly StoredItemOperationRecord[]
  readonly eggs: readonly PokemonEggDocumentV1[]
  readonly breedingOrigins: readonly PokemonBreedingOriginV1[]
  readonly breedingOperations: readonly BreedingOperationLedgerRecord[]
  readonly campaignClock: unknown
  readonly campaignMinute: number
  readonly completeness: {
    readonly sheets: true
    readonly profiles: true
    readonly settlementSources: true
    readonly historyFacts: true
    readonly itemOperations: true
    readonly eggs: true
    readonly breedingOrigins: true
    readonly breedingOperations: true
    readonly campaignClock: true
  }
}

export interface LoadCampaignAttentionInput {
  readonly role: AuthRole
  readonly playerProfile?: PlayerProfile | null
}

export interface LoadCampaignAttentionDependencies {
  readonly loadAuthority?: () => CampaignAttentionAuthoritySnapshot
  readonly database?: RotomDatabase
  readonly listProfiles?: () => readonly PlayerProfile[]
}

interface CountRow { readonly count: unknown }
interface IdentityRow { readonly id: unknown }

const exactCount = (database: RotomDatabase, table: string): number => {
  const row = database.connection.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as unknown as CountRow
  if (!Number.isSafeInteger(row?.count) || Number(row.count) < 0) {
    throw new Error(`Campaign attention could not establish a complete ${table} read.`)
  }
  const count = Number(row.count)
  if (count > CAMPAIGN_ATTENTION_AUTHORITY_READ_LIMIT) {
    throw new Error(`Campaign attention ${table} authority exceeds the complete ${CAMPAIGN_ATTENTION_AUTHORITY_READ_LIMIT}-record limit.`)
  }
  return count
}

const identities = (
  database: RotomDatabase,
  table: string,
  column: string,
): readonly string[] => {
  const count = exactCount(database, table)
  const rows = database.connection.prepare(
    `SELECT ${column} AS id FROM ${table} ORDER BY ${column} ASC LIMIT ?`,
  ).all(CAMPAIGN_ATTENTION_AUTHORITY_READ_LIMIT + 1) as unknown as IdentityRow[]
  if (rows.length !== count || rows.some(row => typeof row.id !== 'string' || row.id.length < 1)) {
    throw new Error(`Campaign attention lost its complete ${table} identity read.`)
  }
  const ids = rows.map(row => row.id as string)
  if (new Set(ids).size !== ids.length) {
    throw new Error(`Campaign attention ${table} authority contains duplicate identities.`)
  }
  return Object.freeze(ids)
}

const required = <Value>(value: Value | null, label: string): Value => value ?? (() => {
  throw new Error(`Campaign attention ${label} disappeared during its complete authority read.`)
})()

export const readCampaignAttentionAuthority = (input: {
  readonly database?: RotomDatabase
  readonly listProfiles?: () => readonly PlayerProfile[]
} = {}): CampaignAttentionAuthoritySnapshot => {
  const database = input.database ?? getRotomDatabase()
  const readProfiles = input.listProfiles ?? listPlayerProfiles
  return database.withTransaction(() => {
    exactCount(database, 'sheets')
    const sheetsRepository = createSqliteSheetRepository(database)
    const sheets = Object.freeze([
      ...sheetsRepository.list('pokemon'),
      ...sheetsRepository.list('trainer'),
    ])
    if (sheets.length > CAMPAIGN_ATTENTION_AUTHORITY_READ_LIMIT
      || new Set(sheets.map(sheet => `${sheet.kind}:${sheet.slug}`)).size !== sheets.length) {
      throw new Error('Campaign attention sheet authority is incomplete, duplicated, or over limit.')
    }

    const profiles = Object.freeze(readProfiles().map((profile) => Object.freeze({
      profileId: profile.id,
      revision: 0,
      definitionSha256: campaignProfileAuthorityDefinitionSha256(profile),
      profile,
    })))
    if (profiles.length > CAMPAIGN_ATTENTION_AUTHORITY_READ_LIMIT) {
      throw new Error(`Campaign attention Profile authority exceeds the complete ${CAMPAIGN_ATTENTION_AUTHORITY_READ_LIMIT}-record limit.`)
    }

    const settlements = createSqliteEncounterSettlementRepository(database)
    const settlementIds = identities(database, 'encounter_settlements', 'settlement_id')
    exactCount(database, 'encounter_settlement_history_facts')
    exactCount(database, 'encounter_settlement_attention_sources')
    const historyFacts = Object.freeze(settlementIds.flatMap(id => settlements.listHistoryFacts(id)))
    const settlementSources = Object.freeze(settlementIds.flatMap(id => settlements.listAttentionSources(id)))
    if (historyFacts.length > CAMPAIGN_ATTENTION_AUTHORITY_READ_LIMIT
      || settlementSources.length > CAMPAIGN_ATTENTION_AUTHORITY_READ_LIMIT) {
      throw new Error('Campaign attention settlement authority exceeds its complete bounded read.')
    }

    const itemRepository = createSqliteItemOperationRepository({ database })
    const itemOperations = Object.freeze(identities(database, 'item_operations', 'operation_id')
      .map(id => required(itemRepository.get(id), `item operation ${id}`)))

    const eggRepository = createSqlitePokemonEggRepository(database)
    const eggs = Object.freeze(identities(database, 'pokemon_eggs', 'egg_id')
      .map(id => required(eggRepository.get(id), `Egg ${id}`)))
    if (eggs.some(egg => !POKEMON_EGG_STATUSES.includes(egg.status))) {
      throw new Error('Campaign attention found an Egg outside the strict lifecycle authority.')
    }

    const lineageRepository = createSqliteBreedingLineageRepository(database)
    const breedingOrigins = Object.freeze(identities(database, 'pokemon_breeding_origins', 'origin_id')
      .map(id => required(lineageRepository.getOrigin(id), `breeding origin ${id}`)))

    const operationRepository = createSqliteBreedingOperationRepository(database)
    const breedingOperations = Object.freeze(identities(database, 'breeding_operations', 'operation_id')
      .map(id => required(operationRepository.get(id), `breeding operation ${id}`)))

    const campaignClock = createSqliteCampaignClockRepository(database).get()
    return Object.freeze({
      sheets,
      profiles,
      settlementSources,
      historyFacts,
      itemOperations,
      eggs,
      breedingOrigins,
      breedingOperations,
      campaignClock,
      campaignMinute: campaignClock.campaignMinute,
      completeness: Object.freeze({
        sheets: true,
        profiles: true,
        settlementSources: true,
        historyFacts: true,
        itemOperations: true,
        eggs: true,
        breedingOrigins: true,
        breedingOperations: true,
        campaignClock: true,
      }),
    })
  })
}

const documentRecord = (value: unknown): Record<string, unknown> | null => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
)

const exactRosterSlugs = (value: unknown): readonly string[] => (
  Array.isArray(value) && value.length <= CAMPAIGN_ATTENTION_AUTHORITY_READ_LIMIT
    ? value.filter((slug): slug is string => typeof slug === 'string' && isSlug(slug) && slug.length <= 160)
    : []
)

/**
 * Selects campaign-owned character authority from the complete sheet read.
 * Unowned wild/NPC Pokémon are not advancement or recovery work merely because
 * they have a saved encounter sheet. Capture, hatch, Profile, and roster
 * authority can each make a sheet relevant without inferring from its name.
 */
export const campaignAttentionRelevantSheets = (
  authority: CampaignAttentionAuthoritySnapshot,
): readonly StoredSheetDocument[] => {
  const relevant = new Set<string>()
  const trainers = authority.sheets.filter(sheet => sheet.kind === 'trainer')
  const pokemon = authority.sheets.filter(sheet => sheet.kind === 'pokemon')
  const trainerBySlug = new Map(trainers.map(sheet => [sheet.slug, sheet]))
  const pokemonBySlug = new Map(pokemon.map(sheet => [sheet.slug, sheet]))
  const add = (kind: 'trainer' | 'pokemon', slug: string): boolean => {
    if (!(kind === 'trainer' ? trainerBySlug : pokemonBySlug).has(slug)) return false
    const key = `${kind}:${slug}`
    const size = relevant.size
    relevant.add(key)
    return relevant.size !== size
  }

  for (const profileAuthority of authority.profiles) {
    for (const link of profileAuthority.profile.linkedCharacters) add(link.sheetKind, link.sheetSlug)
  }
  for (const sheet of authority.sheets) {
    if (documentRecord(sheet.document)?.player === true) add(sheet.kind, sheet.slug)
  }
  for (const source of authority.settlementSources) {
    if (source.entityKind === 'trainer-sheet') add('trainer', source.entityId)
    if (source.entityKind === 'pokemon-sheet') add('pokemon', source.entityId)
  }
  for (const fact of authority.historyFacts) {
    if (fact.kind === 'capture-settled') add('pokemon', fact.subjectId)
  }
  for (const egg of authority.eggs) {
    add('trainer', egg.ownerTrainerSlug)
    if (egg.childSheetSlug) add('pokemon', egg.childSheetSlug)
  }
  for (const origin of authority.breedingOrigins) add('pokemon', origin.childSheetSlug)

  let changed = true
  while (changed) {
    changed = false
    for (const trainer of trainers) {
      const document = documentRecord(trainer.document)
      const roster = [
        ...exactRosterSlugs(document?.currentTeam),
        ...exactRosterSlugs(document?.boxedPokemon),
      ]
      if (relevant.has(`trainer:${trainer.slug}`)) {
        for (const slug of roster) changed = add('pokemon', slug) || changed
      }
      if (roster.some(slug => relevant.has(`pokemon:${slug}`))) {
        changed = add('trainer', trainer.slug) || changed
      }
    }
  }
  return Object.freeze(authority.sheets.filter(sheet => relevant.has(`${sheet.kind}:${sheet.slug}`)))
}

export const collectCampaignAttentionItems = (
  authority: CampaignAttentionAuthoritySnapshot,
): readonly CampaignAttentionItem[] => {
  const complete = authority.completeness
  if (complete.sheets !== true || complete.profiles !== true || complete.settlementSources !== true
    || complete.historyFacts !== true || complete.itemOperations !== true || complete.eggs !== true
    || complete.breedingOrigins !== true || complete.breedingOperations !== true
    || complete.campaignClock !== true) {
    throw new Error('Campaign attention aggregation requires one explicitly complete authority snapshot.')
  }
  const sheets = campaignAttentionRelevantSheets(authority)
  return mergeCampaignAttentionItems([
    campaignAttentionItemsFromSettlementSources(authority.settlementSources),
    projectCampaignAdvancementAttention({
      sheets,
      settlementSources: authority.settlementSources,
      campaignMinute: authority.campaignMinute,
    }),
    projectCampaignPokemonChoiceAttention({
      sheets,
      settlementSources: authority.settlementSources,
      historyFacts: authority.historyFacts,
      itemOperations: authority.itemOperations,
      campaignMinute: authority.campaignMinute,
      completeness: {
        sheets: true,
        settlementSources: true,
        historyFacts: true,
        itemOperations: true,
      },
    }),
    projectCampaignTrainerChoiceAttention({
      sheets,
      campaignMinute: authority.campaignMinute,
      completeness: { sheets: true },
    }),
    projectCampaignRecoveryAttention({
      sheets,
      campaignClock: authority.campaignClock,
      itemOperations: authority.itemOperations,
      completeness: { sheets: true, campaignClock: true, itemOperations: true },
    }),
    projectCampaignRosterOwnershipAttention({
      sheets,
      profiles: authority.profiles,
      settlementSources: authority.settlementSources,
      historyFacts: authority.historyFacts,
      eggs: authority.eggs,
      breedingOrigins: authority.breedingOrigins,
      breedingOperations: authority.breedingOperations,
      campaignMinute: authority.campaignMinute,
      completeness: {
        sheets: true,
        profiles: true,
        settlementSources: true,
        historyFacts: true,
        eggs: true,
        breedingOrigins: true,
        breedingOperations: true,
      },
    }),
  ])
}

export const loadCampaignAttentionUseCase = (
  input: LoadCampaignAttentionInput,
  dependencies: LoadCampaignAttentionDependencies = {},
): CampaignAttentionProjectionV1 => {
  const authority = dependencies.loadAuthority?.()
    ?? readCampaignAttentionAuthority({ database: dependencies.database, listProfiles: dependencies.listProfiles })
  let playerProfile = input.playerProfile ?? null
  if (input.role === 'gm') playerProfile = null
  else if (playerProfile) {
    const current = authority.profiles.find(profile => profile.profileId === playerProfile!.id)?.profile ?? null
    if (!current || stableJsonStringify(current) !== stableJsonStringify(playerProfile)) {
      throw new Error('Selected Player Profile changed during campaign attention projection.')
    }
    playerProfile = current
  }
  const items = collectCampaignAttentionItems(authority)
  return projectCampaignAttentionForViewer({
    role: input.role,
    playerProfile,
    sheets: authority.sheets,
    campaignMinute: authority.campaignMinute,
    items,
  })
}

import { createHash } from 'node:crypto'
import type { AuthRole } from '#shared/auth'
import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  breedingSpeciesIdFromSheetSpecies,
  createBreedingSpeciesAcquisitionSourceEvidenceV1,
  type BreedingSpeciesAcquisitionSourceEvidenceV1,
} from '../domain/breeding/speciesAcquisitionIntegration'
import { createSqliteCampaignClockRepository } from '../storage/campaignClockRepository'
import type { RotomDatabase } from '../storage/database'
import {
  createSqliteSheetRepository,
  type PersistedSheet,
} from '../storage/sheetRepository'
import { UseCaseHttpError } from '../utils/useCaseErrors'
import { recordSpeciesAcquisition } from './recordTrainerSpeciesAcquisition'

export class SetupSheetSpeciesAcquisitionUseCaseError extends UseCaseHttpError<403 | 409> {}

export interface SettleSetupSheetSpeciesAcquisitionsInput {
  readonly database: RotomDatabase
  readonly role: AuthRole
  readonly actorProfileId: string | null
  readonly previousSheet: PersistedSheet
  readonly savedSheet: PersistedSheet
  readonly sheetUpdatedAt: number
}

export interface SettleSetupSheetSpeciesAcquisitionsResult {
  readonly primarySheet: PersistedSheet
  readonly additionalUpdatedTrainerSheets: readonly PersistedSheet[]
  readonly sourceOperationDefinitionSha256s: readonly string[]
}

const sha256 = (value: unknown): string => createHash('sha256')
  .update(stableJsonStringify(value))
  .digest('hex')

const fail = (status: 403 | 409, message: string): never => {
  throw new SetupSheetSpeciesAcquisitionUseCaseError(status, message)
}

const roster = (sheet: Record<string, unknown>, label: string): readonly string[] => {
  const currentTeam = Array.isArray(sheet.currentTeam) ? sheet.currentTeam : []
  const boxedPokemon = Array.isArray(sheet.boxedPokemon) ? sheet.boxedPokemon : []
  const values = [...currentTeam, ...boxedPokemon]
  if (values.some(value => typeof value !== 'string' || value.length === 0)) {
    return fail(409, `${label} roster authority is malformed`)
  }
  const slugs = values as string[]
  if (new Set(slugs).size !== slugs.length) {
    return fail(409, `${label} roster must link each Pokémon exactly once`)
  }
  return Object.freeze([...slugs].sort())
}

const currentTrainerClaims = (
  database: RotomDatabase,
  pokemonSheetSlug: string,
): readonly PersistedSheet[] => {
  const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
  const claims: PersistedSheet[] = []
  for (const stored of sheets.list('trainer')) {
    const trainer = sheets.getByRef('trainer', stored.slug)
      ?? fail(409, `Trainer ${stored.slug} disappeared during ownership resolution`)
    const links = roster(trainer.sheet, `Trainer ${trainer.slug}`)
    if (links.includes(pokemonSheetSlug)) claims.push(trainer)
  }
  return Object.freeze(claims.sort((left, right) => left.slug.localeCompare(right.slug)))
}

const exactOwner = (
  database: RotomDatabase,
  pokemonSheetSlug: string,
  allowUnowned: boolean,
): PersistedSheet | null => {
  const claims = currentTrainerClaims(database, pokemonSheetSlug)
  if (claims.length === 0 && allowUnowned) return null
  if (claims.length !== 1) {
    return fail(409, `Pokémon ${pokemonSheetSlug} must belong exactly once to one current Trainer roster`)
  }
  return claims[0]!
}

const actorAuthorityId = (
  role: AuthRole,
  profileId: string | null,
): string => profileId ?? (role === 'gm'
  ? 'system:gm-setup-edit'
  : fail(403, 'Species acquisition requires the selected controlling Profile'))

const noSpeciesAcquisition = (
  savedSheet: PersistedSheet,
): SettleSetupSheetSpeciesAcquisitionsResult => Object.freeze({
  primarySheet: savedSheet,
  additionalUpdatedTrainerSheets: Object.freeze([]),
  sourceOperationDefinitionSha256s: Object.freeze([]),
})

const settleEvolution = (
  input: SettleSetupSheetSpeciesAcquisitionsInput,
): SettleSetupSheetSpeciesAcquisitionsResult => {
  const previousSpecies = input.previousSheet.sheet.species
  const savedSpecies = input.savedSheet.sheet.species
  const previousSpeciesId = breedingSpeciesIdFromSheetSpecies(previousSpecies)
  const speciesId = breedingSpeciesIdFromSheetSpecies(savedSpecies)
  if (!previousSpeciesId) {
    const previousIsBlankScaffold = previousSpecies === ''
    const savedIsBlankScaffold = savedSpecies === ''
    if (!previousIsBlankScaffold || (!speciesId && !savedIsBlankScaffold)) {
      return fail(409, 'Evolution acquisition requires canonical before-and-after Species authority')
    }
    if (exactOwner(input.database, input.savedSheet.slug, true)) {
      return fail(409, 'An owned Pokémon cannot gain initial Species authority through a setup save')
    }
    return noSpeciesAcquisition(input.savedSheet)
  }
  if (!speciesId) {
    return fail(409, 'Evolution acquisition requires canonical before-and-after Species authority')
  }
  if (previousSpeciesId === speciesId) return noSpeciesAcquisition(input.savedSheet)

  const owner = exactOwner(input.database, input.savedSheet.slug, true)
  if (!owner) {
    return Object.freeze({
      primarySheet: input.savedSheet,
      additionalUpdatedTrainerSheets: Object.freeze([]),
      sourceOperationDefinitionSha256s: Object.freeze([]),
    })
  }
  const actorId = actorAuthorityId(input.role, input.actorProfileId)
  const campaignMinute = createSqliteCampaignClockRepository(input.database).get().campaignMinute
  const sourceAuthority = Object.freeze({
    schemaVersion: 1 as const,
    authorityKind: 'pokemon-evolution' as const,
    actorAuthorityId: actorId,
    pokemonSheetSlug: input.savedSheet.slug,
    pokemonRevisionBefore: input.previousSheet.revision,
    pokemonRevisionAfter: input.savedSheet.revision,
    pokemonDocumentBeforeSha256: sha256(input.previousSheet.sheet),
    pokemonDocumentAfterSha256: sha256(input.savedSheet.sheet),
    speciesIdBefore: previousSpeciesId,
    speciesIdAfter: speciesId,
    ownerTrainerSlug: owner.slug,
    ownerTrainerRevisionBeforeReward: owner.revision,
    setupSheetUpdatedAt: input.sheetUpdatedAt,
  })
  const sourceAuthorityDefinitionSha256 = sha256(sourceAuthority)
  const evidence = createBreedingSpeciesAcquisitionSourceEvidenceV1({
    sourceKind: 'evolution',
    sourceAuthorityKind: 'pokemon-evolution',
    sourceEventId: `evolution:${sha256({
      pokemonSheetSlug: input.savedSheet.slug,
      pokemonRevisionAfter: input.savedSheet.revision,
      speciesId,
    }).slice(0, 32)}`,
    sourceAuthorityDefinitionSha256,
    trainerSheetSlug: owner.slug,
    trainerRevisionBeforeReward: owner.revision,
    speciesId,
    pokemonSheetSlug: input.savedSheet.slug,
    pokemonSheetRevision: input.savedSheet.revision,
    campaignMinute,
  })
  const settled = recordSpeciesAcquisition({ sourceEvidence: evidence }, {
    database: input.database,
    sheetUpdatedAt: Math.max(input.sheetUpdatedAt, owner.updatedAt),
    validateCurrentSourceAuthority: (current: BreedingSpeciesAcquisitionSourceEvidenceV1) => {
      const pokemon = createSqliteSheetRepository<Record<string, unknown>>(input.database)
        .getByRef('pokemon', input.savedSheet.slug)
      const currentOwner = exactOwner(input.database, input.savedSheet.slug, false)
      if (!pokemon || !currentOwner
        || pokemon.revision !== input.savedSheet.revision
        || sha256(pokemon.sheet) !== sourceAuthority.pokemonDocumentAfterSha256
        || breedingSpeciesIdFromSheetSpecies(pokemon.sheet.species) !== speciesId
        || currentOwner.slug !== owner.slug
        || currentOwner.revision !== current.trainerRevisionBeforeReward
        || current.definitionSha256 !== evidence.definitionSha256
        || sha256(sourceAuthority) !== sourceAuthorityDefinitionSha256) {
        throw new Error('Evolution source authority changed.')
      }
      return true
    },
  })
  return Object.freeze({
    primarySheet: input.savedSheet,
    additionalUpdatedTrainerSheets: settled.appliedRewardAmount === 1
      ? Object.freeze([settled.trainerSheet])
      : Object.freeze([]),
    sourceOperationDefinitionSha256s: Object.freeze([settled.sourceOperation.definitionSha256]),
  })
}

const settleTradeAdditions = (
  input: SettleSetupSheetSpeciesAcquisitionsInput,
): SettleSetupSheetSpeciesAcquisitionsResult => {
  const beforeRoster = roster(input.previousSheet.sheet, `Trainer ${input.previousSheet.slug}`)
  const afterRoster = roster(input.savedSheet.sheet, `Trainer ${input.savedSheet.slug}`)
  const before = new Set(beforeRoster)
  const additions = afterRoster.filter(slug => !before.has(slug))
  if (additions.length === 0) {
    return Object.freeze({
      primarySheet: input.savedSheet,
      additionalUpdatedTrainerSheets: Object.freeze([]),
      sourceOperationDefinitionSha256s: Object.freeze([]),
    })
  }

  const actorId = actorAuthorityId(input.role, input.actorProfileId)
  const sheets = createSqliteSheetRepository<Record<string, unknown>>(input.database)
  const campaignMinute = createSqliteCampaignClockRepository(input.database).get().campaignMinute
  const setupAuthority = Object.freeze({
    trainerSheetSlug: input.savedSheet.slug,
    trainerRevisionBefore: input.previousSheet.revision,
    trainerRevisionAfterSetupSave: input.savedSheet.revision,
    trainerDocumentBeforeSha256: sha256(input.previousSheet.sheet),
    trainerDocumentAfterSetupSaveSha256: sha256(input.savedSheet.sheet),
    rosterBefore: beforeRoster,
    rosterAfter: afterRoster,
    setupSheetUpdatedAt: input.sheetUpdatedAt,
  })
  let currentTrainer = input.savedSheet
  const settlements: string[] = []
  for (const pokemonSheetSlug of additions) {
    const owner = exactOwner(input.database, pokemonSheetSlug, false)
    if (!owner || owner.slug !== input.savedSheet.slug) {
      return fail(409, `Trade destination does not uniquely own Pokémon ${pokemonSheetSlug}`)
    }
    const pokemon = sheets.getByRef('pokemon', pokemonSheetSlug)
      ?? fail(409, `Trade acquisition Pokémon ${pokemonSheetSlug} is missing`)
    const speciesId = breedingSpeciesIdFromSheetSpecies(pokemon.sheet.species)
      ?? fail(409, `Trade acquisition Pokémon ${pokemonSheetSlug} has no canonical Species authority`)
    const sourceAuthority = Object.freeze({
      schemaVersion: 1 as const,
      authorityKind: 'pokemon-trade' as const,
      actorAuthorityId: actorId,
      ...setupAuthority,
      pokemonSheetSlug: pokemon.slug,
      pokemonSheetRevision: pokemon.revision,
      pokemonDocumentSha256: sha256(pokemon.sheet),
      destinationTrainerRevisionBeforeReward: currentTrainer.revision,
    })
    const sourceAuthorityDefinitionSha256 = sha256(sourceAuthority)
    const evidence = createBreedingSpeciesAcquisitionSourceEvidenceV1({
      sourceKind: 'trade',
      sourceAuthorityKind: 'pokemon-trade',
      sourceEventId: `trade:${sha256({
        trainerSheetSlug: input.savedSheet.slug,
        trainerRevisionAfterSetupSave: input.savedSheet.revision,
        pokemonSheetSlug: pokemon.slug,
      }).slice(0, 32)}`,
      sourceAuthorityDefinitionSha256,
      trainerSheetSlug: currentTrainer.slug,
      trainerRevisionBeforeReward: currentTrainer.revision,
      speciesId,
      pokemonSheetSlug: pokemon.slug,
      pokemonSheetRevision: pokemon.revision,
      campaignMinute,
    })
    const settled = recordSpeciesAcquisition({ sourceEvidence: evidence }, {
      database: input.database,
      sheetUpdatedAt: Math.max(input.sheetUpdatedAt, currentTrainer.updatedAt),
      validateCurrentSourceAuthority: (current: BreedingSpeciesAcquisitionSourceEvidenceV1) => {
        const currentPokemon = sheets.getByRef('pokemon', pokemon.slug)
        const currentOwner = exactOwner(input.database, pokemon.slug, false)
        if (!currentPokemon || !currentOwner
          || currentOwner.slug !== input.savedSheet.slug
          || currentOwner.revision !== current.trainerRevisionBeforeReward
          || roster(currentOwner.sheet, `Trainer ${currentOwner.slug}`).join('\0') !== afterRoster.join('\0')
          || currentPokemon.revision !== pokemon.revision
          || sha256(currentPokemon.sheet) !== sourceAuthority.pokemonDocumentSha256
          || breedingSpeciesIdFromSheetSpecies(currentPokemon.sheet.species) !== speciesId
          || current.definitionSha256 !== evidence.definitionSha256
          || sha256(sourceAuthority) !== sourceAuthorityDefinitionSha256) {
          throw new Error('Trade source authority changed.')
        }
        return true
      },
    })
    currentTrainer = settled.trainerSheet
    settlements.push(settled.sourceOperation.definitionSha256)
  }
  return Object.freeze({
    primarySheet: currentTrainer,
    additionalUpdatedTrainerSheets: Object.freeze([]),
    sourceOperationDefinitionSha256s: Object.freeze(settlements),
  })
}

/**
 * Reuses immutable history for setup/edit evolution and destination-roster
 * trade mutations. Roster removals deliberately create no write: release can
 * never erase first-acquisition history.
 */
export const settleSetupSheetSpeciesAcquisitions = (
  input: SettleSetupSheetSpeciesAcquisitionsInput,
): SettleSetupSheetSpeciesAcquisitionsResult => {
  if (input.previousSheet.kind !== input.savedSheet.kind
    || input.previousSheet.slug !== input.savedSheet.slug
    || input.savedSheet.revision !== input.previousSheet.revision + 1) {
    return fail(409, 'Species acquisition setup-save authority must bind one exact sheet successor')
  }
  if (input.savedSheet.kind === 'pokemon') return settleEvolution(input)
  return settleTradeAdditions(input)
}

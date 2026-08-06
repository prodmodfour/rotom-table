import { createHash } from 'node:crypto'
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

export class CaptureSpeciesAcquisitionUseCaseError extends UseCaseHttpError<403 | 404 | 409> {}

export interface SettleCaptureSpeciesAcquisitionsInput {
  readonly database: RotomDatabase
  readonly livePlayOperationId: string
  readonly actorProfileId: string | null
  readonly mapSlug: string
  readonly acceptedMapRevision: number
  readonly trainerSheetBefore: PersistedSheet
  readonly captureTargetSheetSlug: string
  readonly captureSucceeded: boolean
}

const sha256 = (value: unknown): string => createHash('sha256')
  .update(stableJsonStringify(value))
  .digest('hex')

const rosterPokemonSlugs = (sheet: Record<string, unknown>): readonly string[] => {
  const values = [
    ...(Array.isArray(sheet.currentTeam) ? sheet.currentTeam : []),
    ...(Array.isArray(sheet.boxedPokemon) ? sheet.boxedPokemon : []),
  ]
  if (values.some(value => typeof value !== 'string' || value.length === 0)) {
    throw new CaptureSpeciesAcquisitionUseCaseError(409, 'Captured Trainer roster authority is malformed')
  }
  return Object.freeze([...new Set(values as string[])].sort())
}

/**
 * Settles every Pokémon added by one successful capture (the target and any
 * authoritative companions) inside the caller-owned capture transaction.
 */
export const settleCaptureSpeciesAcquisitions = (
  input: SettleCaptureSpeciesAcquisitionsInput,
): PersistedSheet => {
  const sheets = createSqliteSheetRepository<Record<string, unknown>>(input.database)
  const beforeRoster = new Set(rosterPokemonSlugs(input.trainerSheetBefore.sheet))
  const trainerAfterCapture = sheets.getByRef('trainer', input.trainerSheetBefore.slug)
    ?? (() => {
      throw new CaptureSpeciesAcquisitionUseCaseError(
        404,
        `Trainer sheet ${input.trainerSheetBefore.slug} not found after capture`,
      )
    })()

  if (!input.captureSucceeded) return trainerAfterCapture

  const capturedSlugs = rosterPokemonSlugs(trainerAfterCapture.sheet)
    .filter(slug => !beforeRoster.has(slug))
  if (!capturedSlugs.includes(input.captureTargetSheetSlug)) {
    throw new CaptureSpeciesAcquisitionUseCaseError(
      409,
      'Successful capture did not add the authoritative target to the Trainer roster',
    )
  }
  if (!input.actorProfileId) {
    throw new CaptureSpeciesAcquisitionUseCaseError(
      403,
      'Player capture acquisition requires the selected controlling Profile',
    )
  }

  const campaignMinute = createSqliteCampaignClockRepository(input.database).get().campaignMinute
  let currentTrainer = trainerAfterCapture
  for (const pokemonSlug of capturedSlugs) {
    const pokemon = sheets.getByRef('pokemon', pokemonSlug)
      ?? (() => {
        throw new CaptureSpeciesAcquisitionUseCaseError(
          409,
          `Captured Pokémon sheet ${pokemonSlug} is missing`,
        )
      })()
    const speciesId = breedingSpeciesIdFromSheetSpecies(pokemon.sheet.species)
    if (!speciesId) {
      throw new CaptureSpeciesAcquisitionUseCaseError(
        409,
        `Captured Pokémon ${pokemonSlug} has no canonical Species authority`,
      )
    }

    const sourceAuthority = Object.freeze({
      schemaVersion: 1 as const,
      authorityKind: 'live-play-capture' as const,
      livePlayOperationId: input.livePlayOperationId,
      actorProfileId: input.actorProfileId,
      mapSlug: input.mapSlug,
      acceptedMapRevision: input.acceptedMapRevision,
      trainerSheetSlug: currentTrainer.slug,
      pokemonSheetSlug: pokemon.slug,
      pokemonSheetRevision: pokemon.revision,
      captureTargetSheetSlug: input.captureTargetSheetSlug,
      captureSucceeded: true as const,
    })
    const sourceAuthorityDefinitionSha256 = sha256(sourceAuthority)
    const evidence = createBreedingSpeciesAcquisitionSourceEvidenceV1({
      sourceKind: 'capture',
      sourceAuthorityKind: 'live-play-capture',
      sourceEventId: `capture:${sha256({
        livePlayOperationId: input.livePlayOperationId,
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
      sheetUpdatedAt: currentTrainer.updatedAt,
      validateCurrentSourceAuthority: (current: BreedingSpeciesAcquisitionSourceEvidenceV1) => {
        if (current.definitionSha256 !== evidence.definitionSha256
          || current.sourceAuthorityDefinitionSha256 !== sourceAuthorityDefinitionSha256
          || sha256(sourceAuthority) !== sourceAuthorityDefinitionSha256) {
          throw new Error('Capture source authority changed.')
        }
        return true
      },
    })
    currentTrainer = settled.trainerSheet
  }
  return currentTrainer
}

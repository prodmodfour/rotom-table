import type { AuthRole } from '#shared/auth'
import type { PlayerProfile } from '#shared/playerProfiles'
import {
  parseDeclareSheetItemActionIntent,
  SheetItemActionValidationError,
  type AuthorizedSheetItemActionOffer,
  type DeclareSheetItemActionIntentV1,
} from '#shared/itemAutomation/sheetActions'
import { attachSheetItemCommandTemplate } from '../domain/itemAutomation/sheetActionCommandTemplate'
import { createSqliteCampaignClockRepository, type CampaignClockRepository } from '../storage/campaignClockRepository'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import {
  loadTrainerSheetItemActionAuthority,
  type LoadSheetItemActionsDependencies,
  type TrainerSheetItemActionAuthority,
} from './loadSheetItemActions'
import { UseCaseHttpError } from '../utils/useCaseErrors'

export class DeclareSheetItemActionUseCaseError extends UseCaseHttpError<400 | 404 | 409> {}

export interface DeclareSheetItemActionInput {
  readonly role: AuthRole
  readonly playerProfile?: PlayerProfile | null
  readonly intent: unknown
}

export interface DeclareSheetItemActionDependencies extends LoadSheetItemActionsDependencies {
  readonly loadAuthority?: (
    input: Omit<DeclareSheetItemActionInput, 'intent'> & { readonly trainerSlug: string },
  ) => TrainerSheetItemActionAuthority
  readonly campaignClockRepository?: Pick<CampaignClockRepository, 'get'> & { readonly database?: RotomDatabase }
}

const fail = (statusCode: 400 | 404 | 409, message: string): never => {
  throw new DeclareSheetItemActionUseCaseError(statusCode, message)
}

const parseIntent = (value: unknown): DeclareSheetItemActionIntentV1 => {
  try { return parseDeclareSheetItemActionIntent(value) }
  catch (error) {
    if (error instanceof SheetItemActionValidationError) return fail(400, 'Invalid sheet item action declaration.')
    throw error
  }
}

/** Reproject an owner-safe offer, then issue one fresh private command template. */
export const declareSheetItemActionUseCase = (
  input: DeclareSheetItemActionInput,
  dependencies: DeclareSheetItemActionDependencies = {},
): AuthorizedSheetItemActionOffer => {
  const intent = parseIntent(input.intent)
  const authority = dependencies.loadAuthority?.({
    role: input.role,
    playerProfile: input.playerProfile,
    trainerSlug: intent.trainerSlug,
  }) ?? loadTrainerSheetItemActionAuthority({
    role: input.role,
    playerProfile: input.playerProfile,
    trainerSlug: intent.trainerSlug,
  }, dependencies)
  if (authority.projection.trainerRevision !== intent.trainerRevision) {
    fail(409, 'The Trainer inventory changed. Refresh item actions before retrying.')
  }
  const offer = authority.projection.offers.find(candidate => candidate.offerId === intent.offerId)
    ?? fail(404, 'The sheet item action is no longer available.')
  const useAction = offer.actions.find(action => action.kind === 'use')
  if (!offer.availability.enabled || !useAction?.enabled) {
    fail(409, useAction?.unavailableReason?.label
      ?? offer.availability.unavailableReason?.label
      ?? 'The sheet item action is unavailable.')
  }

  const database = dependencies.database
    ?? dependencies.sheetRepository?.database
    ?? dependencies.campaignClockRepository?.database
    ?? getRotomDatabase()
  if (dependencies.campaignClockRepository?.database
    && dependencies.campaignClockRepository.database !== database) {
    throw new Error('Sheet item action declaration must use one RotomDatabase.')
  }
  const campaignClock = (dependencies.campaignClockRepository
    ?? createSqliteCampaignClockRepository(database)).get()
  const authorized = attachSheetItemCommandTemplate({
    offer,
    trainerSheet: authority.trainerSheet,
    pokemonSheets: authority.pokemonSheets,
    trainerSheets: authority.trainerSheets,
    campaignClock,
  })
  if (!authorized.itemCommand) fail(409, 'The item source no longer has complete command authority.')
  return authorized as AuthorizedSheetItemActionOffer
}

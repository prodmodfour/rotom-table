import type { AuthRole } from '#shared/auth'
import {
  GROUP_INVENTORY_ITEM_ACTION_SCHEMA_VERSION,
  GroupInventoryItemActionValidationError,
  parseDeclareGroupInventoryItemActionIntent,
  type AuthorizedGroupInventoryItemActionV1,
  type DeclareGroupInventoryItemActionIntentV1,
} from '#shared/itemAutomation/groupInventoryItemActions'
import type { AuthorizedSheetItemActionOffer } from '#shared/itemAutomation/sheetActions'
import type { PlayerProfile } from '#shared/playerProfiles'
import { attachGroupInventoryItemCommandTemplate } from '../domain/itemAutomation/sheetActionCommandTemplate'
import { createSqliteCampaignClockRepository, type CampaignClockRepository } from '../storage/campaignClockRepository'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import { UseCaseHttpError } from '../utils/useCaseErrors'
import {
  loadGroupInventoryItemActionAuthority,
  type GroupInventoryItemActionAuthority,
  type LoadGroupInventoryItemActionsDependencies,
} from './loadGroupInventoryItemActions'

export class DeclareGroupInventoryItemActionUseCaseError extends UseCaseHttpError<400 | 404 | 409> {}

export interface DeclareGroupInventoryItemActionInput {
  readonly role: AuthRole
  readonly playerProfile?: PlayerProfile | null
  readonly intent: unknown
}

export interface DeclareGroupInventoryItemActionDependencies extends LoadGroupInventoryItemActionsDependencies {
  readonly loadAuthority?: (input: {
    readonly role: AuthRole
    readonly playerProfile?: PlayerProfile | null
    readonly groupSlug: string
    readonly actorSelectionId: string
  }) => GroupInventoryItemActionAuthority
  readonly campaignClockRepository?: Pick<CampaignClockRepository, 'get'> & { readonly database?: RotomDatabase }
}

const fail = (statusCode: 400 | 404 | 409, message: string): never => {
  throw new DeclareGroupInventoryItemActionUseCaseError(statusCode, message)
}
const parseIntent = (value: unknown): DeclareGroupInventoryItemActionIntentV1 => {
  try { return parseDeclareGroupInventoryItemActionIntent(value) }
  catch (error) {
    if (error instanceof GroupInventoryItemActionValidationError) {
      return fail(400, 'Invalid shared item action declaration.')
    }
    throw error
  }
}

/** Reproject the selected actor and exact shared row, then issue one private command template. */
export const declareGroupInventoryItemActionUseCase = (
  input: DeclareGroupInventoryItemActionInput,
  dependencies: DeclareGroupInventoryItemActionDependencies = {},
): AuthorizedGroupInventoryItemActionV1 => {
  const intent = parseIntent(input.intent)
  const authority = dependencies.loadAuthority?.({
    role: input.role,
    playerProfile: input.playerProfile,
    groupSlug: intent.groupSlug,
    actorSelectionId: intent.actorSelectionId,
  }) ?? loadGroupInventoryItemActionAuthority({
    role: input.role,
    playerProfile: input.playerProfile,
    groupSlug: intent.groupSlug,
    actorSelectionId: intent.actorSelectionId,
  }, dependencies)
  if (authority.projection.groupRevision !== intent.groupRevision) {
    return fail(409, 'The group inventory changed. Refresh shared item actions before retrying.')
  }
  if (!authority.trainerSheet || authority.actorSelectionId !== intent.actorSelectionId) {
    return fail(409, 'The selected shared item actor is stale or unavailable.')
  }
  const offer = authority.projection.offers.find(candidate => candidate.offerId === intent.offerId)
    ?? fail(404, 'The shared item action is no longer available.')
  const use = offer.actions.find(action => action.kind === 'use')
  if (!offer.availability.enabled || !use?.enabled) {
    return fail(409, use?.unavailableReason?.label
      ?? offer.availability.unavailableReason?.label
      ?? 'The shared item action is unavailable.')
  }

  const database = dependencies.database
    ?? dependencies.groupInventoryRepository?.database
    ?? dependencies.sheetRepository?.database
    ?? dependencies.itemOperationRepository?.database
    ?? dependencies.campaignClockRepository?.database
    ?? getRotomDatabase()
  if (dependencies.campaignClockRepository?.database
    && dependencies.campaignClockRepository.database !== database) {
    throw new Error('Shared item declaration must use one RotomDatabase.')
  }
  const campaignClock = (dependencies.campaignClockRepository
    ?? createSqliteCampaignClockRepository(database)).get()
  const authorized = attachGroupInventoryItemCommandTemplate({
    offer,
    groupInventory: authority.groupInventory,
    trainerSheet: authority.trainerSheet,
    pokemonSheets: authority.pokemonSheets,
    trainerSheets: authority.trainerSheets,
    campaignClock,
  })
  if (!authorized.itemCommand) {
    return fail(409, 'The shared item source no longer has complete command authority.')
  }
  return Object.freeze({
    schemaVersion: GROUP_INVENTORY_ITEM_ACTION_SCHEMA_VERSION,
    groupSlug: authority.groupInventory.slug,
    groupRevision: authority.groupInventory.revision,
    actorSelectionId: intent.actorSelectionId,
    offer: authorized as AuthorizedSheetItemActionOffer,
  })
}

import { createError } from 'h3'
import type { AuthRole } from '#shared/auth'
import {
  EncounterPresentationValidationError,
  parseEncounterActionDeclarationIntent,
  type EncounterActionDeclarationIntent,
  type EncounterActionOffer,
  type EncounterPresentationProjection,
} from '#shared/encounterPresentation'
import type { PlayerProfile } from '#shared/playerProfiles'
import { loadLiveTableSnapshotUseCase } from './loadLiveTableSnapshot'

export interface DeclareEncounterActionInput {
  readonly role: AuthRole
  readonly playerProfile?: PlayerProfile | null
  readonly intent: unknown
}

export interface DeclareEncounterActionDependencies {
  readonly loadProjection?: (input: {
    readonly role: AuthRole
    readonly playerProfile?: PlayerProfile | null
    readonly mapSlug: string
  }) => EncounterPresentationProjection
}

const fail = (statusCode: number, statusMessage: string): never => {
  throw createError({ statusCode, statusMessage })
}

const parseIntent = (value: unknown): EncounterActionDeclarationIntent => {
  try {
    return parseEncounterActionDeclarationIntent(value)
  }
  catch (error) {
    if (error instanceof EncounterPresentationValidationError) {
      fail(400, 'Invalid encounter action declaration.')
    }
    throw error
  }
}

/**
 * Authorize a generic offer identity before a compatibility workflow gathers
 * source-owned targets or spatial input. Final mechanics still re-authorize in
 * their owning command use case; this receipt never grants authority.
 */
export const declareEncounterActionUseCase = (
  input: DeclareEncounterActionInput,
  dependencies: DeclareEncounterActionDependencies = {},
): EncounterActionOffer => {
  const intent = parseIntent(input.intent)
  const projection = dependencies.loadProjection
    ? dependencies.loadProjection({
        role: input.role,
        playerProfile: input.playerProfile,
        mapSlug: intent.mapSlug,
      })
    : loadLiveTableSnapshotUseCase({
        role: input.role,
        playerProfile: input.playerProfile,
        slug: intent.mapSlug,
      }).encounterPresentation
  if (projection.mapSlug !== intent.mapSlug || projection.mapRevision !== intent.baseRevision) {
    fail(409, 'Encounter action projection is stale.')
  }
  const offer = projection.offers.find(candidate => candidate.offerId === intent.offerId)
    ?? fail(404, 'Encounter action offer is unavailable.')
  if (offer.actor.participantId !== intent.actorParticipantId
    || offer.intent.actionId !== intent.actionId) {
    fail(409, 'Encounter action identity does not match the authoritative offer.')
  }
  if (offer.availability.status !== 'available') {
    fail(409, offer.availability.reasons[0]?.label ?? 'Encounter action is unavailable.')
  }
  return offer
}

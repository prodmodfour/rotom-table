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
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { loadLiveTableSnapshotUseCase } from './loadLiveTableSnapshot'
import { attachEncounterItemCommandTemplate, type ItemCommandTemplateOffer } from '../domain/itemAutomation/commandTemplate'
import { ITEM_AUTOMATION_RUNTIME_REGISTRY } from '../domain/itemAutomation/registry'
import { createSqliteCampaignClockRepository, type CampaignClockRepository } from '../storage/campaignClockRepository'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import {
  attachEncounterItemFormChangeCommandTemplate,
  type ItemFormChangeCommandTemplateOffer,
} from '../domain/itemAutomation/formChangeCommandTemplate'
import { ITEM_FORM_CHANGE_ACTION_ID } from '#shared/itemAutomation/formChanges'

export interface DeclareEncounterActionInput {
  readonly role: AuthRole
  readonly playerProfile?: PlayerProfile | null
  readonly intent: unknown
}

export interface EncounterItemCommandAuthoritySnapshot {
  readonly map: TabletopMap
  readonly mapRevision: number
  readonly pokemonSheets: readonly CharacterSheet[]
  readonly trainerSheets: readonly TrainerSheet[]
}

export interface DeclareEncounterActionDependencies {
  readonly loadProjection?: (input: {
    readonly role: AuthRole
    readonly playerProfile?: PlayerProfile | null
    readonly mapSlug: string
  }) => EncounterPresentationProjection
  readonly loadItemAuthority?: (input: {
    readonly role: AuthRole
    readonly playerProfile?: PlayerProfile | null
    readonly mapSlug: string
  }) => EncounterItemCommandAuthoritySnapshot
  readonly database?: RotomDatabase
  readonly campaignClockRepository?: Pick<CampaignClockRepository, 'get'> & { readonly database?: RotomDatabase }
}

const fail = (statusCode: number, statusMessage: string): never => {
  throw createError({ statusCode, statusMessage })
}

const parseIntent = (value: unknown): EncounterActionDeclarationIntent => {
  try {
    return parseEncounterActionDeclarationIntent(value)
  }
  catch (error) {
    if (error instanceof EncounterPresentationValidationError) fail(400, 'Invalid encounter action declaration.')
    throw error
  }
}

const loadDefaultSnapshot = (input: DeclareEncounterActionInput, mapSlug: string) => loadLiveTableSnapshotUseCase({
  role: input.role,
  playerProfile: input.playerProfile,
  slug: mapSlug,
})

/**
 * Authorize a generic offer identity. Item offers additionally receive a
 * private, revision-bound command template; final execution still reprojects
 * and reauthorizes before mutation.
 */
export const declareEncounterActionUseCase = (
  input: DeclareEncounterActionInput,
  dependencies: DeclareEncounterActionDependencies = {},
): ItemCommandTemplateOffer | ItemFormChangeCommandTemplateOffer => {
  const intent = parseIntent(input.intent)
  const defaultSnapshot = dependencies.loadProjection ? null : loadDefaultSnapshot(input, intent.mapSlug)
  const projection = dependencies.loadProjection
    ? dependencies.loadProjection({
        role: input.role,
        playerProfile: input.playerProfile,
        mapSlug: intent.mapSlug,
      })
    : defaultSnapshot!.encounterPresentation
  if (projection.mapSlug !== intent.mapSlug || projection.mapRevision !== intent.baseRevision) {
    fail(409, 'Encounter action projection is stale.')
  }
  const offer = projection.offers.find(candidate => candidate.offerId === intent.offerId)
    ?? fail(404, 'Encounter action offer is unavailable.')
  if (offer.actor.participantId !== intent.actorParticipantId || offer.intent.actionId !== intent.actionId) {
    fail(409, 'Encounter action identity does not match the authoritative offer.')
  }
  if (offer.availability.status !== 'available') {
    fail(409, offer.availability.reasons[0]?.label ?? 'Encounter action is unavailable.')
  }
  if (offer.source.sourceKind !== 'item') return offer

  const authority = dependencies.loadItemAuthority?.({
    role: input.role,
    playerProfile: input.playerProfile,
    mapSlug: intent.mapSlug,
  }) ?? defaultSnapshot ?? loadDefaultSnapshot(input, intent.mapSlug)
  if (authority.mapRevision !== projection.mapRevision || authority.map.slug !== projection.mapSlug) {
    fail(409, 'Item command authority changed while the offer was declared.')
  }
  const visibleParticipantIds = new Set<string>()
  const collect = (candidate: EncounterActionOffer): void => {
    visibleParticipantIds.add(candidate.actor.participantId)
    for (const option of candidate.selectionOptions ?? []) {
      if (option.kind === 'participant') visibleParticipantIds.add(option.value)
    }
  }
  for (const candidate of projection.offers) collect(candidate)
  for (const passive of projection.passives) visibleParticipantIds.add(passive.participant.participantId)
  for (const affordance of projection.affordances) {
    if (affordance.actor) visibleParticipantIds.add(affordance.actor.participantId)
  }
  for (const accepted of projection.accepted) {
    if (accepted.actor) visibleParticipantIds.add(accepted.actor.participantId)
    for (const participant of accepted.affectedParticipants) visibleParticipantIds.add(participant.participantId)
  }
  if (offer.intent.actionId === ITEM_FORM_CHANGE_ACTION_ID) {
    const templated = attachEncounterItemFormChangeCommandTemplate({
      offer,
      intent,
      map: authority.map,
      mapRevision: authority.mapRevision,
      pokemonSheets: authority.pokemonSheets,
      trainerSheets: authority.trainerSheets,
    })
    if (!templated.itemFormChangeCommand) {
      fail(409, 'The item form-change source or choices no longer have complete command authority.')
    }
    return templated
  }

  const requiresCampaignClock = ITEM_AUTOMATION_RUNTIME_REGISTRY.resolve(offer.source.canonicalId)?.spec.duration.kind === 'daily'
  let campaignClock: ReturnType<CampaignClockRepository['get']> | undefined
  if (requiresCampaignClock) {
    const database = dependencies.database ?? dependencies.campaignClockRepository?.database ?? getRotomDatabase()
    if (dependencies.campaignClockRepository?.database
      && dependencies.campaignClockRepository.database !== database) {
      throw new Error('Encounter item command authority must use one RotomDatabase.')
    }
    campaignClock = (dependencies.campaignClockRepository
      ?? createSqliteCampaignClockRepository(database)).get()
  }
  const templated = attachEncounterItemCommandTemplate({
    offer,
    map: authority.map,
    mapRevision: authority.mapRevision,
    pokemonSheets: authority.pokemonSheets,
    trainerSheets: authority.trainerSheets,
    visibleParticipantIds: [...visibleParticipantIds],
    ...(campaignClock ? { campaignClock } : {}),
  })
  if (!templated.itemCommand) fail(409, 'The item source no longer has complete command authority.')
  return templated
}

import type { AuthRole } from '#shared/auth'
import type { PlayerProfile } from '#shared/playerProfiles'
import type { EncounterWorkspaceAudience, EncounterWorkspaceViewModel } from '#shared/encounterWorkspace/model'
import type { LiveTableSnapshot } from '#shared/liveTableSnapshot'
import type { EncounterDocument } from '#shared/encounterDocuments/model'
import type { PlayerSessionAccessGrant } from '../utils/sessionPlayerAccess'
import { actorControlledMapPlacementIds } from '../policies/playerProfileTokenControlPolicy'
import { projectMapBackedEncounterWorkspace } from '../domain/encounterWorkspace/projection'
import { loadLiveTableSnapshotUseCase } from './loadLiveTableSnapshot'
import { createSqliteEncounterDocumentRepository } from '../storage/encounterDocumentRepository'
import { createSqliteItemOperationRepository, type StoredItemOperationRecord } from '../storage/itemOperationRepository'
import { projectItemOperationPresentations } from '../domain/itemAutomation/presentation'
import { projectEquipmentActionPresentations } from '../domain/itemAutomation/equipmentActionPresentation'
import {
  createSqliteEquipmentActionOperationRepository,
  type StoredEquipmentActionOperation,
} from '../storage/equipmentActionOperationRepository'
import {
  createSqliteItemGuidedRequestRepository,
  type StoredItemGuidedRequestRecord,
} from '../storage/itemGuidedRequestRepository'

export interface LoadEncounterWorkspaceInput {
  readonly role: AuthRole
  readonly slug?: unknown
  readonly playerProfile?: PlayerProfile | null
  readonly sessionAccess?: PlayerSessionAccessGrant | null
  readonly audience?: unknown
}

export interface LoadEncounterWorkspaceDependencies {
  readonly loadSnapshot?: (input: {
    readonly role: AuthRole
    readonly slug?: unknown
    readonly playerProfile?: PlayerProfile | null
    readonly sessionAccess?: PlayerSessionAccessGrant | null
  }) => LiveTableSnapshot
  readonly loadEncounterDocument?: (encounterId: string) => EncounterDocument | null
  readonly findEncounterDocumentByMap?: (mapSlug: string) => EncounterDocument | null
  readonly listItemOperations?: (mapSlug: string) => readonly StoredItemOperationRecord[]
  readonly listEquipmentActionOperations?: (mapSlug: string) => readonly StoredEquipmentActionOperation[]
  readonly listGuidedItemRequests?: (mapSlug: string) => readonly StoredItemGuidedRequestRecord[]
}

export const resolveEncounterWorkspaceAudience = (
  role: AuthRole,
  value: unknown,
): EncounterWorkspaceAudience => {
  const requested = typeof value === 'string' ? value.trim() : ''
  if (role === 'gm') {
    if (requested === 'public') return 'public'
    if (requested === 'diagnostic') return 'diagnostic'
    return 'gm'
  }
  return requested === 'public' ? 'public' : 'player-owner'
}

export const loadEncounterWorkspaceUseCase = (
  input: LoadEncounterWorkspaceInput,
  dependencies: LoadEncounterWorkspaceDependencies = {},
): EncounterWorkspaceViewModel => {
  const loadSnapshot = dependencies.loadSnapshot ?? loadLiveTableSnapshotUseCase
  const repository = dependencies.loadSnapshot && !dependencies.loadEncounterDocument && !dependencies.findEncounterDocumentByMap
    ? null
    : createSqliteEncounterDocumentRepository()
  const requestedId = typeof input.slug === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(input.slug.trim())
    ? input.slug.trim()
    : null
  const loadEncounterDocument = dependencies.loadEncounterDocument ?? ((encounterId: string) => repository?.get(encounterId) ?? null)
  const findEncounterDocumentByMap = dependencies.findEncounterDocumentByMap ?? ((mapSlug: string) => repository?.findByMapSlug(mapSlug) ?? null)
  const itemRepository = dependencies.loadSnapshot && !dependencies.listItemOperations
    ? null
    : createSqliteItemOperationRepository()
  const listItemOperations = dependencies.listItemOperations
    ?? ((mapSlug: string) => itemRepository?.listForMap(mapSlug, 200) ?? [])
  const equipmentActionRepository = dependencies.loadSnapshot && !dependencies.listEquipmentActionOperations
    ? null
    : createSqliteEquipmentActionOperationRepository()
  const listEquipmentActionOperations = dependencies.listEquipmentActionOperations
    ?? ((mapSlug: string) => equipmentActionRepository?.listForMap(mapSlug, 200) ?? [])
  const guidedRequestRepository = dependencies.loadSnapshot && !dependencies.listGuidedItemRequests
    ? null
    : createSqliteItemGuidedRequestRepository()
  const listGuidedItemRequests = dependencies.listGuidedItemRequests
    ?? ((mapSlug: string) => guidedRequestRepository?.listForMap(mapSlug, 200) ?? [])
  let encounterDocument = requestedId ? loadEncounterDocument(requestedId) : null
  const snapshot = loadSnapshot({
    role: input.role,
    slug: encounterDocument?.linkedMapSlug ?? input.slug,
    playerProfile: input.playerProfile,
    sessionAccess: input.sessionAccess,
  })
  if (!encounterDocument) encounterDocument = findEncounterDocumentByMap(snapshot.map.slug)
  if (encounterDocument && encounterDocument.linkedMapSlug !== snapshot.map.slug) {
    throw new Error('Encounter document and authoritative battlefield disagree.')
  }
  const placementIds = new Set(snapshot.map.placements.map(placement => placement.id))
  if (encounterDocument) {
    const referencedParticipants = [
      ...encounterDocument.hiddenParticipantIds,
      ...encounterDocument.castRoles.map(role => role.participantId),
      ...encounterDocument.waves.flatMap(wave => wave.participantIds),
      ...encounterDocument.reserves.flatMap(reserve => reserve.placementId ? [reserve.placementId] : []),
    ]
    if (!referencedParticipants.every(participantId => placementIds.has(participantId))) {
      throw new Error('Encounter document references a participant absent from its authoritative battlefield.')
    }
  }
  const audience = resolveEncounterWorkspaceAudience(input.role, input.audience)
  const hidden = new Set(encounterDocument?.hiddenParticipantIds ?? [])
  const visibleParticipantIds = snapshot.map.placements
    .filter(placement => audience === 'gm' || audience === 'diagnostic' || !hidden.has(placement.id))
    .map(placement => placement.id)
  const visibleSet = new Set(visibleParticipantIds)
  const controlledParticipantIds = audience === 'public'
    ? []
    : actorControlledMapPlacementIds({
        role: input.role,
        profile: input.playerProfile,
        placements: snapshot.map.placements,
        linkedTrainerSheets: snapshot.trainerSheets,
      }).filter(participantId => visibleSet.has(participantId))
  const hiddenParticipantCountsBySide: Record<string, number> = {}
  if (audience === 'gm' || audience === 'diagnostic') {
    for (const placement of snapshot.map.placements) {
      if (!hidden.has(placement.id) || !placement.sideId) continue
      hiddenParticipantCountsBySide[placement.sideId] = (hiddenParticipantCountsBySide[placement.sideId] ?? 0) + 1
    }
  }
  const itemPresentations = projectItemOperationPresentations({
    records: listItemOperations(snapshot.map.slug),
    audience,
    role: input.role,
    playerProfile: input.playerProfile,
    map: snapshot.map,
    pokemonSheets: snapshot.pokemonSheets,
    trainerSheets: snapshot.trainerSheets,
  })
  const equipmentPresentations = projectEquipmentActionPresentations({
    equipmentRecords: listEquipmentActionOperations(snapshot.map.slug),
    guidedRecords: listGuidedItemRequests(snapshot.map.slug),
    map: snapshot.map,
    pokemonSheets: snapshot.pokemonSheets,
    trainerSheets: snapshot.trainerSheets,
  })
  const pendingById = new Map(snapshot.encounterPresentation.pending.map(value => [value.interactionId, value]))
  for (const pending of [...itemPresentations.pending, ...equipmentPresentations.pending]) pendingById.set(pending.interactionId, pending)
  const acceptedByOperation = new Map(snapshot.encounterPresentation.accepted.map(value => [value.operationId, value]))
  for (const accepted of [...itemPresentations.accepted, ...equipmentPresentations.accepted]) acceptedByOperation.set(accepted.operationId, accepted)
  const projectedPending = [...pendingById.values()]
  const projectedAccepted = [...acceptedByOperation.values()]
    .sort((left, right) => left.revision - right.revision || left.presentationId.localeCompare(right.presentationId))
    .slice(-100)
  const itemProjectionIdentity = [
    ...projectedPending.map(value => value.interactionId),
    ...projectedAccepted.map(value => value.presentationId),
  ].sort((left, right) => left.localeCompare(right)).join(':') || 'none'
  const projectedSnapshot: LiveTableSnapshot = {
    ...snapshot,
    encounterPresentation: {
      ...snapshot.encounterPresentation,
      projectionId: `${snapshot.encounterPresentation.projectionId}:items:${itemProjectionIdentity}`,
      pending: projectedPending,
      accepted: projectedAccepted,
    },
  }
  const authorizedInteractionIds = [
    ...itemPresentations.authorizedInteractionIds,
    ...snapshot.encounterPresentation.pending.flatMap(pending => (
      pending.projection === 'actor-owner' || pending.projection === 'responder-owner' ? [pending.interactionId] : []
    )),
  ]
  return projectMapBackedEncounterWorkspace({
    encounterDocument,
    snapshot: projectedSnapshot,
    policy: {
      audience,
      visibleParticipantIds,
      controlledParticipantIds,
      authorizedInteractionIds,
      hiddenParticipantCountsBySide,
      canUseExactGeometry: audience !== 'public',
    },
  })
}

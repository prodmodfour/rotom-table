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
  return projectMapBackedEncounterWorkspace({
    encounterDocument,
    snapshot,
    policy: {
      audience,
      visibleParticipantIds,
      controlledParticipantIds,
      hiddenParticipantCountsBySide,
      canUseExactGeometry: audience !== 'public',
    },
  })
}

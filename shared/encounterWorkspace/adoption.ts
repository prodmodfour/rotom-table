import type { EncounterWorkspaceViewModel } from './model'

export interface EncounterWorkspaceDeepLink {
  readonly participantId: string | null
  readonly interactionId: string | null
  readonly presentationId: string | null
  readonly tactical: boolean
}

export const ENCOUNTER_WORKSPACE_DEEP_LINK_KEYS = ['participant', 'decision', 'history', 'tactical'] as const
const SAFE_DEEP_LINK_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/

const parseDeepLinkId = (value: string | null): string | null => {
  if (value === null || value === '') return null
  return SAFE_DEEP_LINK_ID.test(value) ? value : null
}

export const parseEncounterWorkspaceDeepLink = (
  query: URLSearchParams | Readonly<Record<string, string | readonly (string | null | undefined)[] | null | undefined>>,
): EncounterWorkspaceDeepLink => {
  const read = (key: typeof ENCOUNTER_WORKSPACE_DEEP_LINK_KEYS[number]): string | null => {
    if (query instanceof URLSearchParams) return query.get(key)
    const value = query[key]
    if (typeof value === 'string' || value === null || value === undefined) return value ?? null
    return value[0] ?? null
  }
  return {
    participantId: parseDeepLinkId(read('participant')),
    interactionId: parseDeepLinkId(read('decision')),
    presentationId: parseDeepLinkId(read('history')),
    tactical: read('tactical') === '1',
  }
}

export const serializeEncounterWorkspaceDeepLink = (
  link: EncounterWorkspaceDeepLink,
): URLSearchParams => {
  const query = new URLSearchParams()
  if (link.participantId) query.set('participant', link.participantId)
  if (link.interactionId) query.set('decision', link.interactionId)
  if (link.presentationId) query.set('history', link.presentationId)
  if (link.tactical) query.set('tactical', '1')
  return query
}

export interface ReconciledEncounterWorkspaceDeepLink extends EncounterWorkspaceDeepLink {
  readonly rejectedKeys: readonly typeof ENCOUNTER_WORKSPACE_DEEP_LINK_KEYS[number][]
}

/** Adopt only identities present in the authorized workspace projection. */
export const reconcileEncounterWorkspaceDeepLink = (
  link: EncounterWorkspaceDeepLink,
  workspace: EncounterWorkspaceViewModel,
): ReconciledEncounterWorkspaceDeepLink => {
  const participants = new Set(workspace.participants.map(participant => participant.participantId))
  const interactions = new Set(workspace.pending.map(pending => pending.interactionId))
  const presentations = new Set(workspace.accepted.map(accepted => accepted.presentationId))
  const participantId = link.participantId && participants.has(link.participantId) ? link.participantId : null
  const interactionId = link.interactionId && interactions.has(link.interactionId) ? link.interactionId : null
  const presentationId = link.presentationId && presentations.has(link.presentationId) ? link.presentationId : null
  const tactical = link.tactical && workspace.viewer.canUseExactGeometry
  const rejectedKeys: typeof ENCOUNTER_WORKSPACE_DEEP_LINK_KEYS[number][] = []
  if (link.participantId && !participantId) rejectedKeys.push('participant')
  if (link.interactionId && !interactionId) rejectedKeys.push('decision')
  if (link.presentationId && !presentationId) rejectedKeys.push('history')
  if (link.tactical && !tactical) rejectedKeys.push('tactical')
  return { participantId, interactionId, presentationId, tactical, rejectedKeys }
}

export type EncounterWorkspaceAdoptionSource =
  | 'initial'
  | 'reload'
  | 'reconnect'
  | 'replay-gap'
  | 'tab-echo'
  | 'back-forward'

export interface EncounterWorkspaceAdoptionCursor {
  readonly mapSlug: string
  readonly mapRevision: number
  readonly presentationProjectionId: string
  readonly acceptedPresentationIds: readonly string[]
  readonly pendingIntentIds: readonly string[]
}

export interface EncounterWorkspaceAdoptionPlan {
  readonly kind: 'adopt' | 'ignore' | 'reject'
  readonly reason:
    | 'initial-authority'
    | 'newer-authority'
    | 'projection-changed'
    | 'replay-gap-replacement'
    | 'blocking-authority'
    | 'exact-duplicate'
    | 'stale-snapshot'
    | 'map-mismatch'
  readonly replaceWorkspace: boolean
  readonly replaceAcceptedHistory: boolean
  readonly clearTransientSelection: boolean
  readonly clearOptimisticOutbox: boolean
  readonly settlePendingIntentIds: readonly string[]
}

export const planEncounterWorkspaceAdoption = (input: {
  readonly current: EncounterWorkspaceAdoptionCursor | null
  readonly incoming: EncounterWorkspaceViewModel
  readonly source: EncounterWorkspaceAdoptionSource
  /** Operation intent identities echoed by this authoritative update. */
  readonly echoedIntentIds?: readonly string[]
}): EncounterWorkspaceAdoptionPlan => {
  const incoming = input.incoming
  if (input.current === null) return {
    kind: 'adopt',
    reason: incoming.system.commandsBlocked ? 'blocking-authority' : 'initial-authority',
    replaceWorkspace: true,
    replaceAcceptedHistory: true,
    clearTransientSelection: incoming.system.commandsBlocked,
    clearOptimisticOutbox: incoming.system.replayGap,
    settlePendingIntentIds: [...new Set(input.echoedIntentIds ?? [])],
  }
  if (input.current.mapSlug !== incoming.source.mapSlug) return {
    kind: 'reject',
    reason: 'map-mismatch',
    replaceWorkspace: false,
    replaceAcceptedHistory: false,
    clearTransientSelection: false,
    clearOptimisticOutbox: false,
    settlePendingIntentIds: [],
  }
  if (incoming.source.mapRevision < input.current.mapRevision) return {
    kind: 'ignore',
    reason: 'stale-snapshot',
    replaceWorkspace: false,
    replaceAcceptedHistory: false,
    clearTransientSelection: false,
    clearOptimisticOutbox: false,
    settlePendingIntentIds: [],
  }
  if (input.source === 'replay-gap' || incoming.system.replayGap) return {
    kind: 'adopt',
    reason: 'replay-gap-replacement',
    replaceWorkspace: true,
    replaceAcceptedHistory: true,
    clearTransientSelection: true,
    clearOptimisticOutbox: true,
    settlePendingIntentIds: [...new Set(input.echoedIntentIds ?? [])],
  }
  const sameRevision = incoming.source.mapRevision === input.current.mapRevision
  const sameProjection = incoming.source.presentationProjectionId === input.current.presentationProjectionId
  const incomingAccepted = incoming.accepted.map(presentation => presentation.presentationId)
  const sameAccepted = incomingAccepted.length === input.current.acceptedPresentationIds.length
    && incomingAccepted.every((id, index) => input.current?.acceptedPresentationIds[index] === id)
  if (sameRevision && sameProjection && sameAccepted && !incoming.system.commandsBlocked) return {
    kind: 'ignore',
    reason: 'exact-duplicate',
    replaceWorkspace: false,
    replaceAcceptedHistory: false,
    clearTransientSelection: false,
    clearOptimisticOutbox: false,
    settlePendingIntentIds: [...new Set(input.echoedIntentIds ?? [])]
      .filter(id => input.current?.pendingIntentIds.includes(id)),
  }
  if (incoming.system.commandsBlocked) return {
    kind: 'adopt',
    reason: 'blocking-authority',
    replaceWorkspace: true,
    replaceAcceptedHistory: false,
    clearTransientSelection: true,
    clearOptimisticOutbox: false,
    settlePendingIntentIds: [...new Set(input.echoedIntentIds ?? [])],
  }
  return {
    kind: 'adopt',
    reason: sameRevision ? 'projection-changed' : 'newer-authority',
    replaceWorkspace: true,
    replaceAcceptedHistory: false,
    clearTransientSelection: false,
    clearOptimisticOutbox: false,
    settlePendingIntentIds: [...new Set(input.echoedIntentIds ?? [])]
      .filter(id => input.current?.pendingIntentIds.includes(id)),
  }
}

export const encounterWorkspaceAdoptionCursor = (
  workspace: EncounterWorkspaceViewModel,
  pendingIntentIds: readonly string[] = [],
): EncounterWorkspaceAdoptionCursor => ({
  mapSlug: workspace.source.mapSlug,
  mapRevision: workspace.source.mapRevision,
  presentationProjectionId: workspace.source.presentationProjectionId,
  acceptedPresentationIds: workspace.accepted.map(presentation => presentation.presentationId),
  pendingIntentIds: [...new Set(pendingIntentIds)],
})

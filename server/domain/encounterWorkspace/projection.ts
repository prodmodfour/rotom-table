import {
  ENCOUNTER_PRESENTATION_SCHEMA_VERSION,
  projectEncounterPresentation,
  type AcceptedEncounterPresentation,
  type EncounterPresentationProjection,
  type EncounterProjectionAudience,
  type RuleSourceRef,
} from '#shared/encounterPresentation'
import type { EncounterWorkspaceAudience, EncounterWorkspaceViewModel } from '#shared/encounterWorkspace/model'
import type { LiveTableSnapshot } from '#shared/liveTableSnapshot'
import type { EncounterDocument } from '#shared/encounterDocuments/model'
import { buildMapBackedEncounterWorkspace } from './mapAdapter'

export interface EncounterWorkspaceProjectionPolicy {
  readonly audience: EncounterWorkspaceAudience
  readonly visibleParticipantIds?: readonly string[]
  readonly controlledParticipantIds?: readonly string[]
  readonly authorizedInteractionIds?: readonly string[]
  readonly hiddenSourceKeys?: readonly string[]
  readonly hiddenParticipantCountsBySide?: Readonly<Record<string, number>>
  readonly canUseExactGeometry?: boolean
  /** Player projections may own actions, responses, or both in separate server requests. */
  readonly ownerPresentationAudience?: Extract<EncounterProjectionAudience, 'actor-owner' | 'responder-owner'>
}

const privateSource = (): RuleSourceRef => ({
  sourceKind: 'system',
  canonicalId: 'private-rule',
  instanceId: null,
  displayName: 'Private encounter event',
  referenceHref: null,
})

const presentationAudience = (
  policy: EncounterWorkspaceProjectionPolicy,
): EncounterProjectionAudience => {
  if (policy.audience === 'player-owner') return policy.ownerPresentationAudience ?? 'actor-owner'
  return policy.audience
}

const sanitizeAcceptedForVisibleParticipants = (
  accepted: AcceptedEncounterPresentation,
  visible: ReadonlySet<string> | null,
): AcceptedEncounterPresentation => {
  if (visible === null) return accepted
  const actorVisible = accepted.actor === null || visible.has(accepted.actor.participantId)
  const affected = accepted.affectedParticipants.filter(participant => visible.has(participant.participantId))
  const hiddenParticipantInFacts = accepted.outcomes.some(outcome => (
    outcome.participantId !== null && !visible.has(outcome.participantId)
  )) || accepted.changes.some(change => (
    change.participantId !== null && !visible.has(change.participantId)
  ))
  const hidden = !actorVisible || affected.length !== accepted.affectedParticipants.length || hiddenParticipantInFacts
  return {
    ...accepted,
    source: hidden ? privateSource() : accepted.source,
    actor: actorVisible ? accepted.actor : null,
    affectedParticipants: affected,
    outcomes: accepted.outcomes.filter(outcome => outcome.participantId === null || visible.has(outcome.participantId)),
    changes: accepted.changes.filter(change => change.participantId === null || visible.has(change.participantId)),
    explanations: hidden
      ? accepted.explanations.filter(explanation => visible.has(explanation.subjectId))
      : accepted.explanations,
    headline: hidden ? {
      label: 'Encounter state changed.',
      description: null,
      iconKey: 'encounter.private-change',
      tone: 'neutral',
    } : accepted.headline,
    splash: hidden ? null : accepted.splash,
    vfx: accepted.vfx.map(vfx => ({
      ...vfx,
      sourceParticipantId: vfx.sourceParticipantId && visible.has(vfx.sourceParticipantId)
        ? vfx.sourceParticipantId
        : null,
      targetParticipantIds: vfx.targetParticipantIds.filter(id => visible.has(id)),
      label: hidden ? 'Encounter effect' : vfx.label,
    })),
    announcements: hidden ? accepted.announcements.map(announcement => ({
      ...announcement,
      message: 'Encounter state changed.',
      dedupeKey: `private:${accepted.presentationId}`,
    })) : accepted.announcements,
    history: accepted.history.map(entry => ({
      ...entry,
      headline: hidden ? 'Encounter state changed.' : entry.headline,
      detail: hidden ? null : entry.detail,
      participantIds: entry.participantIds.filter(id => visible.has(id)),
    })),
  }
}

const sanitizePresentationParticipants = (
  projection: EncounterPresentationProjection,
  visibleParticipantIds: readonly string[] | undefined,
): EncounterPresentationProjection => {
  const visible = visibleParticipantIds ? new Set(visibleParticipantIds) : null
  if (visible === null) return projection
  return {
    ...projection,
    accepted: projection.accepted.map(accepted => sanitizeAcceptedForVisibleParticipants(accepted, visible)),
    pending: projection.pending.map(pending => ({
      ...pending,
      actor: pending.actor && visible.has(pending.actor.participantId) ? pending.actor : null,
    })),
  }
}

const validatePolicy = (
  snapshot: LiveTableSnapshot,
  policy: EncounterWorkspaceProjectionPolicy,
): void => {
  const placementIds = new Set(snapshot.map.placements.map(placement => placement.id))
  const visible = policy.visibleParticipantIds ? new Set(policy.visibleParticipantIds) : null
  if ((policy.audience === 'player-owner' || policy.audience === 'public') && visible === null) {
    throw new Error(`${policy.audience} workspace projection requires an explicit visible participant set.`)
  }
  for (const id of visible ?? []) {
    if (!placementIds.has(id)) throw new Error(`Visible workspace participant ${id} is not on the map.`)
  }
  for (const id of policy.controlledParticipantIds ?? []) {
    if (!placementIds.has(id) || (visible !== null && !visible.has(id))) {
      throw new Error(`Controlled workspace participant ${id} must be visible on the map.`)
    }
  }
  if (policy.audience === 'public' && (policy.controlledParticipantIds?.length ?? 0) > 0) {
    throw new Error('Public workspace projection cannot control participants.')
  }
  if (policy.audience !== 'gm' && policy.audience !== 'diagnostic'
    && Object.keys(policy.hiddenParticipantCountsBySide ?? {}).length > 0) {
    throw new Error('Hidden participant counts are GM/diagnostic-only.')
  }
}

/**
 * Server-only role projection. The client receives a complete structural view;
 * it never hides private rows with CSS or re-projects a diagnostic model.
 */
export const projectMapBackedEncounterWorkspace = (input: {
  readonly snapshot: LiveTableSnapshot
  readonly policy: EncounterWorkspaceProjectionPolicy
  readonly connection?: 'ready' | 'saving' | 'reconnecting' | 'reconciling' | 'stale' | 'error'
  readonly replayGap?: boolean
  readonly blockingMessage?: string | null
  readonly encounterDocument?: EncounterDocument | null
}): EncounterWorkspaceViewModel => {
  validatePolicy(input.snapshot, input.policy)
  const presentation = projectEncounterPresentation({
    source: input.snapshot.encounterPresentation,
    policy: {
      audience: presentationAudience(input.policy),
      controlledParticipantIds: input.policy.controlledParticipantIds,
      authorizedInteractionIds: input.policy.authorizedInteractionIds,
      visibleParticipantIds: input.policy.visibleParticipantIds,
      hiddenSourceKeys: input.policy.hiddenSourceKeys,
    },
  })
  const safePresentation = sanitizePresentationParticipants(presentation, input.policy.visibleParticipantIds)
  const snapshot: LiveTableSnapshot = {
    ...input.snapshot,
    schemaVersion: input.snapshot.schemaVersion,
    encounterPresentation: {
      ...safePresentation,
      schemaVersion: ENCOUNTER_PRESENTATION_SCHEMA_VERSION,
    },
  }
  return buildMapBackedEncounterWorkspace({
    snapshot,
    encounterDocument: input.encounterDocument,
    options: {
      audience: input.policy.audience,
      controlledParticipantIds: input.policy.controlledParticipantIds,
      visibleParticipantIds: input.policy.visibleParticipantIds,
      hiddenParticipantCountsBySide: input.policy.hiddenParticipantCountsBySide,
      hiddenParticipantIds: input.encounterDocument?.hiddenParticipantIds,
      canUseExactGeometry: input.policy.canUseExactGeometry
        ?? (input.policy.audience !== 'public'),
      connection: input.connection,
      replayGap: input.replayGap,
      blockingMessage: input.blockingMessage,
    },
  })
}

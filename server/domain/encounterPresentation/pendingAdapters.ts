import {
  ENCOUNTER_PRESENTATION_SCHEMA_VERSION,
  parseEncounterPendingInteractionView,
  type EncounterChoiceKind,
  type EncounterChoiceOptionPreview,
  type EncounterParticipantPresentationRef,
  type EncounterPendingInteractionView,
  type RuleSourceRef,
} from '#shared/encounterPresentation'
import type {
  PendingMoveResponseWindowList,
  PendingMoveResponseWindowView,
} from '#shared/moveAutomation/responseViews'
import type { PendingMoveResolutionPublicSummary } from '#shared/moveAutomation/pendingResolutionSummary'
import type {
  AbilityPendingAuthorizedView,
  AbilityPendingMapExistenceSummary,
} from '../abilityAutomation/responseViews'

const sourceFor = (canonicalMoveId: string): RuleSourceRef => ({
  sourceKind: 'move',
  canonicalId: canonicalMoveId,
  instanceId: null,
  displayName: canonicalMoveId,
  referenceHref: null,
})

const actorFor = (
  actorPlacementId: string,
  participants: ReadonlyMap<string, EncounterParticipantPresentationRef>,
): EncounterParticipantPresentationRef => participants.get(actorPlacementId) ?? {
  participantId: actorPlacementId,
  displayName: actorPlacementId,
  portraitUrl: null,
  sideId: null,
  sideLabel: null,
  sideAccent: null,
  sheetKind: null,
  statusLabels: [],
}

const choiceKind = (view: PendingMoveResponseWindowView): EncounterChoiceKind => {
  if (view.window.kind === 'choice' && view.window.hazardCellSelection) return 'cell'
  if (view.window.options.some(option => option.selection?.kind === 'movement-direction')) return 'direction'
  if (view.window.options.some(option => option.selection?.kind === 'movement-destination')) return 'destination'
  if (view.window.options.some(option => option.itemChoice !== undefined)) return 'item'
  return 'branch'
}

const optionPreview = (
  option: PendingMoveResponseWindowView['window']['options'][number],
): EncounterChoiceOptionPreview => {
  if (option.selection) {
    return {
      kind: 'spatial',
      cells: [{ ...option.selection.destination }],
      destination: { ...option.selection.destination },
      path: [],
      direction: option.selection.kind === 'movement-direction' ? option.selection.direction : null,
    }
  }
  if (option.itemChoice?.canonicalItemId) {
    const itemSource: RuleSourceRef = {
      sourceKind: 'item',
      canonicalId: option.itemChoice.canonicalItemId,
      instanceId: null,
      displayName: option.itemChoice.canonicalItemId,
      referenceHref: null,
    }
    return { kind: 'item', source: itemSource, quantity: null }
  }
  return { kind: 'none' }
}

const interactionId = (resolutionId: string): string => `pending:${resolutionId}`

const publicView = (input: {
  readonly mapSlug: string
  readonly mapRevision: number
  readonly summary: PendingMoveResolutionPublicSummary
  readonly participants: ReadonlyMap<string, EncounterParticipantPresentationRef>
}): EncounterPendingInteractionView => parseEncounterPendingInteractionView({
  schemaVersion: ENCOUNTER_PRESENTATION_SCHEMA_VERSION,
  projection: 'public',
  interactionId: interactionId(input.summary.resolutionId),
  mapSlug: input.mapSlug,
  mapRevision: input.mapRevision,
  status: input.summary.status,
  source: sourceFor(input.summary.canonicalMoveId),
  actor: actorFor(input.summary.actorPlacementId, input.participants),
  prompt: `${input.summary.canonicalMoveId} is waiting for a response.`,
  outstandingChoiceCount: input.summary.outstandingWindowCount,
  allowPass: false,
  allowCancel: false,
  expiresAt: null,
  announcement: {
    announcementId: `announcement:${input.summary.resolutionId}:public`,
    priority: 'polite',
    message: `${input.summary.canonicalMoveId} is waiting for a response.`,
    dedupeKey: `pending:${input.summary.resolutionId}`,
  },
})

const authorizedView = (input: {
  readonly mapSlug: string
  readonly mapRevision: number
  readonly views: readonly PendingMoveResponseWindowView[]
  readonly participants: ReadonlyMap<string, EncounterParticipantPresentationRef>
  readonly gm: boolean
}): EncounterPendingInteractionView => {
  const first = input.views[0]!
  const summary = first.resolution
  const choices = input.views.map((view, index) => ({
    schemaVersion: ENCOUNTER_PRESENTATION_SCHEMA_VERSION,
    choiceOfferId: `choice-offer:${summary.resolutionId}:${view.window.windowId}`,
    interactionId: interactionId(summary.resolutionId),
    mapSlug: input.mapSlug,
    mapRevision: input.mapRevision,
    choiceId: view.window.windowId,
    kind: choiceKind(view),
    prompt: view.window.promptKey,
    helpText: view.window.reasonCode,
    cardinality: view.window.kind === 'choice' && view.window.hazardCellSelection
      ? view.window.hazardCellSelection.count.kind === 'exact'
        ? {
            minimum: view.window.hazardCellSelection.count.count,
            maximum: view.window.hazardCellSelection.count.count,
          }
        : {
            minimum: view.window.hazardCellSelection.count.minimum,
            maximum: view.window.hazardCellSelection.count.maximum,
          }
      : { minimum: 1, maximum: 1 },
    ordering: view.window.kind === 'choice' && view.window.hazardCellSelection
      ? 'spatial' as const
      : 'server' as const,
    options: view.window.options.map(option => ({
      optionId: option.id,
      label: option.labelKey,
      description: option.itemChoice?.destinationLabelKey ?? null,
      disabled: false,
      unavailableReason: null,
      preview: optionPreview(option),
    })),
    defaultOptionIds: [],
    requiresConfirmation: view.window.kind === 'choice'
      && view.window.hazardCellSelection !== undefined,
    allowPass: view.window.allowPass,
    allowCancel: input.gm,
    expiresAt: null,
    _order: index,
  })).map(({ _order: _discarded, ...choice }) => choice)
  const prompt = `${summary.canonicalMoveId} needs a response.`
  return parseEncounterPendingInteractionView({
    schemaVersion: ENCOUNTER_PRESENTATION_SCHEMA_VERSION,
    projection: input.gm ? 'gm' : 'responder-owner',
    interactionId: interactionId(summary.resolutionId),
    mapSlug: input.mapSlug,
    mapRevision: input.mapRevision,
    status: summary.status,
    source: sourceFor(summary.canonicalMoveId),
    actor: actorFor(summary.actorPlacementId, input.participants),
    prompt,
    choices,
    responseIdentity: {
      interactionId: interactionId(summary.resolutionId),
      resolutionId: summary.resolutionId,
      windowId: first.window.windowId,
      retryKey: `retry:${summary.resolutionId}:${first.window.windowId}`,
    },
    allowPass: input.views.some(view => view.window.allowPass),
    allowCancel: input.gm,
    expiresAt: null,
    recoveryActions: input.gm ? [
      {
        action: 'force-pass',
        actionId: `recovery:${summary.resolutionId}:force-pass`,
        label: 'Force pass',
        enabled: true,
        unavailableReason: null,
      },
      {
        action: 'cancel',
        actionId: `recovery:${summary.resolutionId}:cancel`,
        label: 'Cancel resolution',
        enabled: true,
        unavailableReason: null,
      },
    ] : [],
    announcement: {
      announcementId: `announcement:${summary.resolutionId}:authorized`,
      priority: 'assertive',
      message: prompt,
      dedupeKey: `pending:${summary.resolutionId}`,
    },
  })
}

export const pendingEncounterInteractionFromAbilityView = (input: {
  readonly view: AbilityPendingAuthorizedView | AbilityPendingMapExistenceSummary
  readonly mapRevision: number
  readonly participants: readonly EncounterParticipantPresentationRef[]
}): EncounterPendingInteractionView => {
  if (input.view.revision !== input.mapRevision) {
    throw new Error('Ability pending view revision does not match the encounter projection revision.')
  }
  const participants = new Map(input.participants.map(participant => [participant.participantId, participant]))
  if (input.view.kind === 'ability-pending-existence') {
    const prompt = `${input.view.pendingWindowCount} Ability response${input.view.pendingWindowCount === 1 ? '' : 's'} pending.`
    return parseEncounterPendingInteractionView({
      schemaVersion: ENCOUNTER_PRESENTATION_SCHEMA_VERSION,
      projection: 'public',
      interactionId: `pending:ability:${input.view.mapSlug}:${input.view.revision}`,
      mapSlug: input.view.mapSlug,
      mapRevision: input.mapRevision,
      status: 'pending',
      source: null,
      actor: null,
      prompt,
      outstandingChoiceCount: input.view.pendingWindowCount,
      allowPass: false,
      allowCancel: false,
      expiresAt: null,
      announcement: {
        announcementId: `announcement:ability:${input.view.mapSlug}:${input.view.revision}`,
        priority: 'polite',
        message: prompt,
        dedupeKey: `pending:ability:${input.view.mapSlug}:${input.view.revision}`,
      },
    })
  }
  const view = input.view
  const gm = view.kind === 'ability-pending-gm-view'
  const source = gm ? {
    sourceKind: 'ability' as const,
    canonicalId: view.ability.canonicalId,
    instanceId: view.ability.abilityInstanceId,
    displayName: view.ability.canonicalId,
    referenceHref: null,
  } : null
  const actor = gm ? actorFor(view.ability.ownerPlacementId, participants) : null
  const interaction = `pending:${view.resolutionId}`
  return parseEncounterPendingInteractionView({
    schemaVersion: ENCOUNTER_PRESENTATION_SCHEMA_VERSION,
    projection: gm ? 'gm' : 'responder-owner',
    interactionId: interaction,
    mapSlug: view.mapSlug,
    mapRevision: input.mapRevision,
    status: 'pending',
    source,
    actor,
    prompt: view.window.promptKey,
    choices: [{
      schemaVersion: ENCOUNTER_PRESENTATION_SCHEMA_VERSION,
      choiceOfferId: `choice-offer:${view.resolutionId}:${view.window.windowId}`,
      interactionId: interaction,
      mapSlug: view.mapSlug,
      mapRevision: input.mapRevision,
      choiceId: view.window.windowId,
      kind: 'branch',
      prompt: view.window.promptKey,
      helpText: null,
      cardinality: { minimum: 1, maximum: 1 },
      ordering: 'server',
      options: view.window.options.map(option => ({
        optionId: option.id,
        label: option.presentationKey,
        description: null,
        disabled: false,
        unavailableReason: null,
        preview: { kind: 'none' },
      })),
      defaultOptionIds: [],
      requiresConfirmation: false,
      allowPass: view.window.allowPass,
      allowCancel: gm,
      expiresAt: view.expiresAt,
    }],
    responseIdentity: {
      interactionId: interaction,
      resolutionId: view.resolutionId,
      windowId: view.window.windowId,
      retryKey: `retry:${view.resolutionId}:${view.window.windowId}`,
    },
    allowPass: view.window.allowPass,
    allowCancel: gm,
    expiresAt: view.expiresAt,
    recoveryActions: gm ? [{
      action: 'force-pass',
      actionId: `recovery:${view.resolutionId}:force-pass`,
      label: 'Force pass',
      enabled: true,
      unavailableReason: null,
    }] : [],
    announcement: {
      announcementId: `announcement:${view.resolutionId}:${view.window.windowId}`,
      priority: 'assertive',
      message: view.window.promptKey,
      dedupeKey: interaction,
    },
  })
}

/** Merge map-visible existence with separately authorized response options. */
export const pendingEncounterInteractionsFromMoveResponses = (input: {
  readonly mapSlug: string
  readonly mapRevision: number
  readonly summaries: readonly PendingMoveResolutionPublicSummary[]
  readonly authorized: PendingMoveResponseWindowList | null
  readonly participants: readonly EncounterParticipantPresentationRef[]
  readonly gm: boolean
}): readonly EncounterPendingInteractionView[] => {
  const participants = new Map(input.participants.map(participant => [participant.participantId, participant]))
  const byResolution = new Map<string, PendingMoveResponseWindowView[]>()
  for (const view of input.authorized?.windows ?? []) {
    const values = byResolution.get(view.resolution.resolutionId) ?? []
    values.push(view)
    byResolution.set(view.resolution.resolutionId, values)
  }
  const summaries = new Map(input.summaries.map(summary => [summary.resolutionId, summary]))
  for (const views of byResolution.values()) summaries.set(views[0]!.resolution.resolutionId, views[0]!.resolution)
  return [...summaries.values()].map(summary => {
    const views = byResolution.get(summary.resolutionId)
    return views?.length
      ? authorizedView({
          mapSlug: input.mapSlug,
          mapRevision: input.mapRevision,
          views,
          participants,
          gm: input.gm,
        })
      : publicView({
          mapSlug: input.mapSlug,
          mapRevision: input.mapRevision,
          summary,
          participants,
        })
  })
}

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import AppNavigation from '~/components/AppNavigation.vue'
import EncounterWorkspaceNavigation from '~/components/encounter/workspace/EncounterWorkspaceNavigation.vue'
import EncounterWorkspaceShell from '~/components/encounter/workspace/EncounterWorkspaceShell.vue'
import EncounterWorkspaceSystemStatus from '~/components/encounter/workspace/EncounterWorkspaceSystemStatus.vue'
import EncounterTurnRail from '~/components/encounter/workspace/EncounterTurnRail.vue'
import EncounterSideRoster from '~/components/encounter/workspace/EncounterSideRoster.vue'
import EncounterBattleStage from '~/components/encounter/workspace/EncounterBattleStage.vue'
import EncounterActionDock from '~/components/encounter/workspace/EncounterActionDock.vue'
import EncounterDecisionLayer from '~/components/encounter/workspace/EncounterDecisionLayer.vue'
import EncounterResolutionStack from '~/components/encounter/workspace/EncounterResolutionStack.vue'
import EncounterEventFeed, { type EncounterUncertainCommandView } from '~/components/encounter/workspace/EncounterEventFeed.vue'
import EncounterRelationshipView from '~/components/encounter/workspace/EncounterRelationshipView.vue'
import EncounterTacticalLens from '~/components/encounter/workspace/EncounterTacticalLens.vue'
import EncounterDirectorPanel from '~/components/encounter/workspace/EncounterDirectorPanel.vue'
import EncounterFinishExperience from '~/components/encounter/workspace/EncounterFinishExperience.vue'
import EncounterWorkspaceAnnouncements from '~/components/encounter/workspace/EncounterWorkspaceAnnouncements.vue'
import EncounterWorkspaceSettings from '~/components/encounter/workspace/EncounterWorkspaceSettings.vue'
import { useEncounterWorkspaceFeaturePolicy } from '~/composables/encounter/useEncounterWorkspaceFeaturePolicy'
import { useEncounterWorkspaceLoader } from '~/composables/encounter/useEncounterWorkspaceLoader'
import { useEncounterWorkspaceMetrics } from '~/composables/encounter/useEncounterWorkspaceMetrics'
import { useEncounterWorkspacePreferences } from '~/composables/encounter/useEncounterWorkspacePreferences'
import { useFinishEncounter } from '~/composables/encounter/useFinishEncounter'
import type { FinishEncounterGateAction } from '#shared/encounterSettlement/finish'
import { usePendingMoveResponses, type PendingMoveResponseDispatchResult } from '~/composables/map-editor/usePendingMoveResponses'
import { useLivePlayCommands } from '~/composables/map-editor/useLivePlayCommands'
import {
  parseEncounterWorkspaceDeepLink,
  reconcileEncounterWorkspaceDeepLink,
  type EncounterWorkspaceDeepLink,
} from '#shared/encounterWorkspace/adoption'
import {
  arbitrateEncounterWorkspaceFocus,
  resolveEncounterWorkspacePriority,
  type EncounterWorkspacePriority,
} from '#shared/encounterWorkspace/decisionPriority'
import {
  emptyEncounterWorkspaceSelection,
  reduceEncounterWorkspaceSelection,
} from '#shared/encounterWorkspace/selection'
import {
  createEncounterWorkspaceMachine,
  transitionEncounterWorkspace,
} from '#shared/encounterWorkspace/stateMachine'
import {
  ENCOUNTER_PRESENTATION_SCHEMA_VERSION,
  parseEncounterActionDeclarationIntent,
  type EncounterActionOffer,
  type EncounterChoiceSelection,
  type EncounterPendingInteractionAuthorizedView,
  type EncounterPendingRecoveryAction,
} from '#shared/encounterPresentation'
import {
  buildEncounterActionDecision,
  buildEncounterPendingDecision,
  type EncounterDecisionModel,
} from '#shared/encounterWorkspace/decision'
import type { EncounterWorkspaceSide } from '#shared/encounterWorkspace/model'
import type { EncounterDirectorCommand } from '#shared/encounterDocuments/commands'
import type {
  EncounterDocument,
  EncounterDocumentClock,
  EncounterDocumentObjective,
  EncounterDocumentPhase,
  EncounterDocumentReserve,
  EncounterDocumentWave,
} from '#shared/encounterDocuments/model'
import { ENCOUNTER_TACTICAL_MODES, type EncounterTacticalMode } from '#shared/encounterWorkspace/preferences'
import { encounterSpatialPresentationForOffer } from '#shared/encounterWorkspace/spatiality'
import { acceptedParticipantPresentationStates } from '#shared/encounterWorkspace/participantPresentation'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  createLivePlayOpId,
  type SetFieldEffectPayload,
} from '#shared/livePlayCommands'
import { battlefieldWorkshopPath, encounterLibraryPath } from '#shared/encounterWorkspace/routes'
import { routeParamAsString } from '~/utils/routeParams'
import { ENCOUNTER_WORKSPACE_API_PATHS, ITEM_API_PATHS, MAP_API_PATHS } from '~/utils/apiRoutes'
import {
  equipmentActionCommandFromAuthorizedOffer,
  itemCommandFromAuthorizedOffer,
  itemFormChangeCommandFromAuthorizedOffer,
  parseAuthorizedItemActionOffer,
} from '#shared/itemAutomation/projection'
import { parseItemFormChangePublicResult } from '#shared/itemAutomation/formChanges'
import { parseEquipmentActionPublicResult } from '#shared/itemAutomation/equipmentActions'
import type { ItemOperationRecoveryCommandV1 } from '#shared/itemAutomation/recovery'
import { getClientId } from '~/utils/clientId'

const featurePolicy = useEncounterWorkspaceFeaturePolicy()
if (!featurePolicy.value.enabled) {
  throw createError({ statusCode: 404, statusMessage: 'Encounter Workspace is not enabled.' })
}

const route = useRoute()
const router = useRouter()
const encounterId = computed(() => routeParamAsString(route.params.encounterId).trim())
if (!encounterId.value || encounterId.value.length > 200) {
  throw createError({ statusCode: 404, statusMessage: 'Encounter not found.' })
}
const audience = computed(() => {
  const value = Array.isArray(route.query.view) ? route.query.view[0] : route.query.view
  return value === 'public' || value === 'diagnostic' ? value : null
})
const loader = useEncounterWorkspaceLoader({ mapSlug: encounterId, audience })
const preferenceState = useEncounterWorkspacePreferences()
const { isGm, role } = useAuth()
const uxMetrics = useEncounterWorkspaceMetrics({ audience, role, preferences: preferenceState.preferences })
const metricNow = (): number => import.meta.client ? performance.now() : 0
const workspaceOpenedAt = metricNow()
const workspaceReadyRecorded = ref(false)
const decisionPresentedAt = ref<number | null>(null)
const tacticalOpenedAt = ref<number | null>(null)
const requestedTacticalMode = computed(() => {
  const value = Array.isArray(route.query.lens) ? route.query.lens[0] : route.query.lens
  return ENCOUNTER_TACTICAL_MODES.find(mode => mode === value) ?? null
})
watch(requestedTacticalMode, (mode) => {
  if (mode && mode !== preferenceState.preferences.value.tacticalMode) preferenceState.update({ tacticalMode: mode })
}, { immediate: true })
const { postJson } = useApiClient()
const workspace = computed(() => loader.workspace.value)
const mapRevision = computed(() => workspace.value?.source.mapRevision ?? 0)
const responseCommandsEnabled = computed(() => (
  !loader.commandsBlocked.value
  && (workspace.value?.viewer.audience === 'gm' || workspace.value?.viewer.audience === 'player-owner')
))
const pendingMoveResponses = usePendingMoveResponses({
  slug: encounterId.value,
  authRole: role,
  playerProfileId: loader.selectedProfileId,
  mapRevision,
  enabled: responseCommandsEnabled,
})
const initiativeBusy = ref(false)
const initiativeError = ref<string | null>(null)
const decisionBusy = ref(false)
const decisionError = ref<string | null>(null)
const pendingBusyInteractionId = ref<string | null>(null)
const actionInspectorOffer = ref<EncounterActionOffer | null>(null)
const actionInspectorHeading = ref<HTMLElement | null>(null)
const actionNoticeRef = ref<HTMLElement | null>(null)
const actionDeclarationNotice = ref<string | null>(null)
const actionDeclarationGuided = ref(false)
let actionInspectorOrigin: HTMLElement | null = null
const uncertainCommands = ref<readonly EncounterUncertainCommandView[]>([])
const tacticalStartupMs = ref<number | null>(null)
const directorOpen = ref(false)
const settingsOpen = ref(false)
const directorBusy = ref(false)
const directorError = ref<string | null>(null)
const finishEncounter = useFinishEncounter({
  encounterId,
  enabled: computed(() => Boolean(isGm.value && workspace.value?.viewer.canUseDirector)),
})
let finishEncounterOrigin: HTMLElement | null = null
const encounterLifecycleCommands = useLivePlayCommands({
  slug: encounterId.value,
  authRole: role,
  mapRevision,
  livePlayCommandBlocked: loader.commandsBlocked,
})
const lifecycleRecoveryEntry = computed(() => encounterLifecycleCommands.outboxEntries.value.find(entry => (
  entry.commandType === LIVE_PLAY_COMMAND_TYPES.END_ENCOUNTER
  || entry.commandType === LIVE_PLAY_COMMAND_TYPES.DISMISS_ENCOUNTER_EFFECT
)) ?? null)
const lifecycleRecoveryBusy = ref(false)

const selection = ref(emptyEncounterWorkspaceSelection())
const machine = ref(createEncounterWorkspaceMachine())
const previousPriority = ref<EncounterWorkspacePriority | null>(null)
const activeDeepLink = ref<ReturnType<typeof reconcileEncounterWorkspaceDeepLink> | null>(null)

const visibleParticipantIds = computed(() => new Set(workspace.value?.participants.map(value => value.participantId) ?? []))
const primaryPriority = computed(() => workspace.value
  ? resolveEncounterWorkspacePriority(workspace.value, machine.value)
  : null)
const encounterName = computed(() => workspace.value?.source.encounterName || workspace.value?.scene.name || workspace.value?.source.mapSlug || encounterId.value)
const rosterSides = computed<readonly EncounterWorkspaceSide[]>(() => {
  if (!workspace.value) return []
  const unalignedIds = workspace.value.participants.filter(participant => participant.side === null).map(participant => participant.participantId)
  return unalignedIds.length === 0 ? workspace.value.sides : [...workspace.value.sides, {
    sideId: 'unaligned',
    label: 'Unaligned',
    accent: null,
    symbol: '◇',
    status: 'active',
    participantIds: unalignedIds,
    hiddenParticipantCount: null,
  }]
})
const acceptedParticipantStates = computed(() => acceptedParticipantPresentationStates(workspace.value?.accepted ?? []))
const teamOperationOffers = computed(() => (workspace.value?.offers ?? []).filter(offer => (
  offer.roles.includes('campaign-operation')
  && /send out|recall|switch|reserve/i.test(offer.presentation.label)
)))
const actionActor = computed(() => workspace.value?.participants.find(participant => (
  participant.participantId === (selection.value.selectedActorId ?? workspace.value?.turn.currentParticipantId)
)) ?? null)
const selectedActionOffer = computed(() => workspace.value?.offers.find(offer => (
  offer.offerId === machine.value.actionOfferId
)) ?? null)
const selectedActionSpatiality = computed(() => selectedActionOffer.value
  ? encounterSpatialPresentationForOffer(selectedActionOffer.value)
  : null)
const relationshipActor = computed(() => selectedActionOffer.value
  ? workspace.value?.participants.find(participant => participant.participantId === selectedActionOffer.value?.actor.participantId) ?? null
  : null)
const activePending = computed(() => {
  const interactionId = activeDeepLink.value?.interactionId ?? primaryPriority.value?.interactionId ?? null
  return interactionId
    ? workspace.value?.pending.find(interaction => interaction.interactionId === interactionId) ?? null
    : null
})
const decision = computed<EncounterDecisionModel | null>(() => {
  if (activePending.value && activePending.value.projection !== 'public') {
    return buildEncounterPendingDecision(activePending.value)
  }
  if (selectedActionOffer.value && workspace.value) {
    return buildEncounterActionDecision({
      offer: selectedActionOffer.value,
      participants: workspace.value.participants,
      sides: workspace.value.sides,
      defaultParticipantIds: selection.value.targetPreviewParticipantIds,
    })
  }
  return null
})

const queryForDeepLink = (patch: Partial<EncounterWorkspaceDeepLink>) => {
  const query = { ...route.query }
  delete query.participant
  delete query.decision
  delete query.history
  delete query.tactical
  if (patch.participantId) query.participant = patch.participantId
  if (patch.interactionId) query.decision = patch.interactionId
  if (patch.presentationId) query.history = patch.presentationId
  if (patch.tactical) query.tactical = '1'
  return { path: route.path, query }
}

const deepLinkFocusId = (link: ReturnType<typeof reconcileEncounterWorkspaceDeepLink>): string | null => {
  if (link.interactionId) return `decision-${link.interactionId}`
  if (link.presentationId) return `history-${link.presentationId}`
  if (link.participantId) return `participant-${link.participantId}`
  if (link.tactical) return 'encounter-tactical-focus'
  return null
}

const applyRouteDeepLink = async (): Promise<void> => {
  if (!workspace.value) return
  const parsed = parseEncounterWorkspaceDeepLink(route.query)
  const reconciled = reconcileEncounterWorkspaceDeepLink(parsed, workspace.value)
  activeDeepLink.value = reconciled.participantId || reconciled.interactionId || reconciled.presentationId || reconciled.tactical
    ? reconciled
    : null
  let next = reduceEncounterWorkspaceSelection(selection.value, { type: 'workspace-adopted', workspace: workspace.value })
  if (reconciled.participantId) {
    next = reduceEncounterWorkspaceSelection(next, { type: 'participant-inspected', participantId: reconciled.participantId }, visibleParticipantIds.value)
  }
  if (reconciled.tactical) {
    next = reduceEncounterWorkspaceSelection(next, {
      type: 'tactical-focus-opened',
      focus: {
        originKind: 'director',
        originId: 'deep-link:tactical',
        participantIds: reconciled.participantId ? [reconciled.participantId] : [],
        cells: [],
        mode: preferenceState.preferences.value.tacticalMode,
      },
    }, visibleParticipantIds.value)
  }
  else if (next.tacticalFocus) {
    next = reduceEncounterWorkspaceSelection(next, { type: 'tactical-focus-closed' }, visibleParticipantIds.value)
  }
  selection.value = next
  await nextTick()
  const id = deepLinkFocusId(reconciled)
  if (id) document.getElementById(id)?.focus({ preventScroll: false })
}

watch(mapRevision, (revision, previous) => {
  if (revision === previous || !finishEncounter.isOpen.value || finishEncounter.busy.value
    || finishEncounter.state.value === 'accepted') return
  void finishEncounter.refresh()
})

watch(workspace, (nextWorkspace) => {
  if (!nextWorkspace) return
  if (!workspaceReadyRecorded.value) {
    workspaceReadyRecorded.value = true
    void uxMetrics.record('workspace-ready', metricNow() - workspaceOpenedAt)
    void uxMetrics.record('action-dock-opened', nextWorkspace.offers.length)
  }
  if (!nextWorkspace.viewer.canUseDirector) directorOpen.value = false
  selection.value = reduceEncounterWorkspaceSelection(selection.value, { type: 'workspace-adopted', workspace: nextWorkspace })
  try {
    machine.value = transitionEncounterWorkspace(machine.value, {
      type: 'workspace-adopted',
      mapRevision: nextWorkspace.source.mapRevision,
      currentActorId: nextWorkspace.turn.currentParticipantId,
      commandsBlocked: loader.commandsBlocked.value,
      replayGap: nextWorkspace.system.replayGap,
      primaryInteractionId: nextWorkspace.pending[0]?.interactionId ?? null,
    })
  }
  catch {
    machine.value = transitionEncounterWorkspace(createEncounterWorkspaceMachine(nextWorkspace.source.mapRevision), {
      type: 'workspace-adopted',
      mapRevision: nextWorkspace.source.mapRevision,
      currentActorId: nextWorkspace.turn.currentParticipantId,
      commandsBlocked: loader.commandsBlocked.value,
      replayGap: nextWorkspace.system.replayGap,
      primaryInteractionId: nextWorkspace.pending[0]?.interactionId ?? null,
    })
  }
  void applyRouteDeepLink()
}, { immediate: true })

watch(() => route.fullPath, () => { void applyRouteDeepLink() })
watch(actionDeclarationNotice, async (notice) => {
  if (!notice) return
  await nextTick()
  actionNoticeRef.value?.focus({ preventScroll: true })
})
watch(decision, (nextDecision, previousDecision) => {
  if (nextDecision && !previousDecision) {
    decisionPresentedAt.value = metricNow()
    void uxMetrics.record('decision-presented', 1)
  }
  else if (!nextDecision) decisionPresentedAt.value = null
})
watch(() => workspace.value?.accepted[0]?.presentationId ?? null, async (nextId, previousId) => {
  if (!nextId || !previousId || nextId === previousId) return
  const startedAt = metricNow()
  void uxMetrics.record('accepted-presentation-started', 1)
  await nextTick()
  void uxMetrics.record('accepted-presentation-settled', metricNow() - startedAt, { terminalStatus: 'accepted' })
})
watch(primaryPriority, async (nextPriority) => {
  if (!nextPriority) return
  const arbitration = arbitrateEncounterWorkspaceFocus({
    previous: previousPriority.value,
    next: nextPriority,
    focusOriginId: machine.value.focusOriginId,
  })
  previousPriority.value = nextPriority
  if (!arbitration.moveFocus || activeDeepLink.value) return
  await nextTick()
  document.querySelector<HTMLElement>(`[data-encounter-focus="${arbitration.target}"]`)?.focus({ preventScroll: true })
})

const inspectParticipant = (participantId: string): void => {
  selection.value = reduceEncounterWorkspaceSelection(selection.value, { type: 'participant-inspected', participantId }, visibleParticipantIds.value)
  void router.push(queryForDeepLink({ participantId }))
}

const targetModeForOffer = (offer: EncounterActionOffer): 'participant' | 'relationship' | 'tactical' | null => {
  if (offer.targeting.some(value => value.requiresSpatialInput)) return 'tactical'
  if (offer.targeting.some(value => value.kind === 'participant' || value.kind === 'side')) return 'participant'
  if (offer.targeting.length > 0) return 'relationship'
  return null
}
const canChooseAction = (offer: EncounterActionOffer): boolean => (
  !loader.commandsBlocked.value
  && offer.availability.status === 'available'
  && (machine.value.phase === 'observe' || machine.value.phase === 'choose')
)
const chooseActionOffer = (offer: EncounterActionOffer, origin: string | null): void => {
  if (!canChooseAction(offer)) return
  machine.value = transitionEncounterWorkspace(machine.value.phase === 'observe'
    ? transitionEncounterWorkspace(machine.value, { type: 'actor-selected', participantId: offer.actor.participantId, focusOriginId: origin })
    : machine.value, {
    type: 'action-chosen',
    offerId: offer.offerId,
    actorParticipantId: offer.actor.participantId,
    targetMode: targetModeForOffer(offer),
    focusOriginId: origin,
  })
  selection.value = reduceEncounterWorkspaceSelection(selection.value, { type: 'actor-selected', participantId: offer.actor.participantId }, visibleParticipantIds.value)
  void uxMetrics.record('actor-selected', 1)
  void uxMetrics.record('action-activated', 1)
}
const chooseAction = (offer: EncounterActionOffer): void => {
  decisionError.value = null
  actionDeclarationNotice.value = null
  actionDeclarationGuided.value = false
  activeDeepLink.value = null
  chooseActionOffer(offer, `action-${offer.offerId}`)
  void router.replace(queryForDeepLink({}))
}
const noteActionFilter = (remainingCount: number): void => {
  void uxMetrics.record('action-filtered', remainingCount)
}
const inspectAction = async (offer: EncounterActionOffer): Promise<void> => {
  actionInspectorOrigin = document.activeElement instanceof HTMLElement ? document.activeElement : null
  actionInspectorOffer.value = offer
  selection.value = reduceEncounterWorkspaceSelection(selection.value, {
    type: 'participant-inspected',
    participantId: offer.actor.participantId,
  }, visibleParticipantIds.value)
  await nextTick()
  actionInspectorHeading.value?.focus({ preventScroll: true })
}
const closeActionInspector = async (): Promise<void> => {
  actionInspectorOffer.value = null
  await nextTick()
  if (actionInspectorOrigin?.isConnected) actionInspectorOrigin.focus({ preventScroll: true })
  actionInspectorOrigin = null
}
const chooseTeamOperation = (offerId: string): void => {
  const offer = workspace.value?.offers.find(value => value.offerId === offerId)
  if (offer) chooseActionOffer(offer, `team-operation-${offerId}`)
}
const selectParticipant = (participantId: string): void => {
  selection.value = reduceEncounterWorkspaceSelection(selection.value, { type: 'actor-selected', participantId }, visibleParticipantIds.value)
}
const selectRelationshipTarget = (participantId: string): void => {
  const requirement = selectedActionOffer.value?.targeting.find(target => target.kind === 'participant')
  if (!requirement || !visibleParticipantIds.value.has(participantId)) return
  const current = [...selection.value.targetPreviewParticipantIds]
  const existing = current.indexOf(participantId)
  if (existing >= 0) current.splice(existing, 1)
  else if (requirement.maxSelections === 1) current.splice(0, current.length, participantId)
  else if (current.length < requirement.maxSelections) current.push(participantId)
  selection.value = reduceEncounterWorkspaceSelection(selection.value, {
    type: 'target-previewed',
    participantIds: current,
  }, visibleParticipantIds.value)
}
const openTacticalFocus = (participantId: string | null): void => {
  tacticalStartupMs.value = null
  tacticalOpenedAt.value = metricNow()
  void uxMetrics.record('tactical-lens-opened', 1, { spatialityLevel: 'exact' })
  void router.push(queryForDeepLink({ participantId, tactical: true }))
}
const handleTacticalReady = (startupMs: number): void => {
  tacticalStartupMs.value = startupMs
  const measured = tacticalOpenedAt.value === null ? startupMs : metricNow() - tacticalOpenedAt.value
  tacticalOpenedAt.value = null
  void uxMetrics.record('tactical-lens-ready', measured, { spatialityLevel: 'exact' })
}
const closeTacticalFocus = async (): Promise<void> => {
  if (selection.value.tacticalFocus) {
    selection.value = reduceEncounterWorkspaceSelection(selection.value, { type: 'tactical-focus-closed' }, visibleParticipantIds.value)
  }
  await router.push(queryForDeepLink({ participantId: selection.value.inspectedParticipantId }))
  await nextTick()
  const originId = machine.value.focusOriginId
  if (originId) document.getElementById(originId)?.focus({ preventScroll: false })
}
const selectFromTacticalLens = (participantId: string | null): void => {
  if (!participantId || !visibleParticipantIds.value.has(participantId)) return
  if (selectedActionOffer.value?.targeting.some(target => target.kind === 'participant')) {
    selectRelationshipTarget(participantId)
  }
  else selectParticipant(participantId)
}
const updateTacticalMode = (mode: EncounterTacticalMode): void => {
  preferenceState.update({ tacticalMode: mode })
}
const handleTacticalStale = (revision: number): void => {
  decisionError.value = `The tactical battlefield adopted revision ${revision}; refreshing the cockpit before commands resume.`
  void loader.refresh()
}
const openDecisionTacticalFocus = (choiceId: string): void => {
  if (!decision.value) return
  tacticalOpenedAt.value = metricNow()
  void uxMetrics.record('tactical-lens-opened', 1, { spatialityLevel: 'exact' })
  selection.value = reduceEncounterWorkspaceSelection(selection.value, {
    type: 'tactical-focus-opened',
    focus: {
      originKind: decision.value.kind === 'action' ? 'action' : 'decision',
      originId: choiceId,
      participantIds: decision.value.kind === 'action' ? [decision.value.offer.actor.participantId] : [],
      cells: [],
      mode: preferenceState.preferences.value.tacticalMode,
    },
  }, visibleParticipantIds.value)
  void router.push(queryForDeepLink({
    participantId: decision.value.kind === 'action' ? decision.value.offer.actor.participantId : null,
    tactical: true,
  }))
}
const openPendingDecision = (interactionId: string): void => {
  decisionError.value = null
  void router.push(queryForDeepLink({ interactionId }))
}
const openAcceptedPresentation = (presentationId: string): void => {
  void router.push(queryForDeepLink({ presentationId }))
}
const restoreActionFocus = async (): Promise<void> => {
  await nextTick()
  const focusOriginId = machine.value.focusOriginId
  if (focusOriginId) document.getElementById(focusOriginId)?.focus({ preventScroll: true })
  else document.getElementById('encounter-action-dock')?.focus({ preventScroll: true })
}
const dismissActionDeclarationNotice = async (): Promise<void> => {
  actionDeclarationNotice.value = null
  actionDeclarationGuided.value = false
  await restoreActionFocus()
}
const dismissDecision = async (): Promise<void> => {
  const active = decision.value
  const focusOriginId = active?.kind === 'pending'
    ? `decision-${active.interaction.interactionId}`
    : machine.value.focusOriginId
  decisionError.value = null
  if (active?.kind === 'action') {
    machine.value = transitionEncounterWorkspace(machine.value, { type: 'reset' })
  }
  await router.push(queryForDeepLink({}))
  await nextTick()
  if (focusOriginId) document.getElementById(focusOriginId)?.focus({ preventScroll: true })
  else document.getElementById('encounter-action-dock')?.focus({ preventScroll: true })
}

const upsertUncertainCommand = (result: PendingMoveResponseDispatchResult, label: string): void => {
  if (!result.uncertain || !result.opId) return
  const command: EncounterUncertainCommandView = {
    operationId: result.opId,
    label,
    message: result.message ?? 'The server outcome is unknown. Retry only with the exact journaled command.',
    canRetry: true,
    canAbandon: true,
  }
  uncertainCommands.value = [
    command,
    ...uncertainCommands.value.filter(value => value.operationId !== command.operationId),
  ]
}
const settlePendingResponse = async (
  interaction: EncounterPendingInteractionAuthorizedView,
  result: PendingMoveResponseDispatchResult,
): Promise<void> => {
  upsertUncertainCommand(result, interaction.prompt)
  if (!result.dispatched) {
    decisionError.value = result.message ?? 'The response was not accepted.'
    if (result.uncertain) {
      machine.value = transitionEncounterWorkspace(machine.value, { type: 'system-blocked', reason: 'uncertain' })
    }
    return
  }
  if (result.opId) {
    uncertainCommands.value = uncertainCommands.value.filter(value => value.operationId !== result.opId)
  }
  decisionError.value = result.message ?? null
  await loader.refresh()
}
const refreshResponseWindows = async (): Promise<boolean> => {
  try {
    await pendingMoveResponses.refresh()
    return true
  }
  catch (error) {
    decisionError.value = error instanceof Error ? error.message : 'Authorized response options could not be refreshed.'
    return false
  }
}
const isItemPendingInteraction = (interaction: EncounterPendingInteractionAuthorizedView): boolean => (
  interaction.responseIdentity.windowId.startsWith('item-decision:')
)
const submitPendingDecision = async (
  interaction: EncounterPendingInteractionAuthorizedView,
  selections: readonly EncounterChoiceSelection[],
): Promise<void> => {
  if (decisionBusy.value || loader.commandsBlocked.value) return
  decisionBusy.value = true
  pendingBusyInteractionId.value = interaction.interactionId
  decisionError.value = null
  void uxMetrics.record('resolution-waiting', 1)
  try {
    if (isItemPendingInteraction(interaction)) {
      const execution = await postJson<{ readonly result: { readonly status: string, readonly exactReplay: boolean } }>(ITEM_API_PATHS.resume, {
        command: {
          schemaVersion: 1,
          operationId: interaction.responseIdentity.resolutionId,
          decisionId: interaction.responseIdentity.windowId,
          choices: selections.map(selection => ({ choiceId: selection.choiceId, optionIds: [...selection.optionIds] })),
        },
        clientId: getClientId(),
        ...(loader.selectedProfileId.value ? { profileId: loader.selectedProfileId.value } : {}),
      })
      if (execution.result.status !== 'accepted') throw new Error('The item decision did not reach an accepted result.')
      actionDeclarationGuided.value = false
      actionDeclarationNotice.value = 'The item decision was applied authoritatively.'
      await loader.refresh()
      void uxMetrics.record('resolution-settled', 1, { terminalStatus: 'accepted' })
      return
    }
    if (!(await refreshResponseWindows())) return
    const selected = selections.find(selection => selection.optionIds.length > 0)
    let result: PendingMoveResponseDispatchResult
    if (!selected) {
      result = await pendingMoveResponses.pass({
        resolutionId: interaction.responseIdentity.resolutionId,
        windowId: interaction.responseIdentity.windowId,
      })
    }
    else {
      const choice = interaction.choices.find(value => value.choiceId === selected.choiceId)
      result = choice?.kind === 'cell' || selected.optionIds.length > 1
        ? await pendingMoveResponses.chooseHazardCells({
            resolutionId: interaction.responseIdentity.resolutionId,
            windowId: selected.choiceId,
            optionIds: selected.optionIds,
          })
        : await pendingMoveResponses.choose({
            resolutionId: interaction.responseIdentity.resolutionId,
            windowId: selected.choiceId,
            optionId: selected.optionIds[0]!,
          })
    }
    await settlePendingResponse(interaction, result)
    void uxMetrics.record('resolution-settled', 1, {
      terminalStatus: result.dispatched ? 'accepted' : 'rejected',
    })
  }
  catch (error) {
    decisionError.value = error instanceof Error ? error.message : 'The pending decision was rejected.'
    void uxMetrics.record('resolution-settled', 1, { terminalStatus: 'rejected' })
  }
  finally {
    pendingBusyInteractionId.value = null
    decisionBusy.value = false
  }
}
const submitActionDecision = async (
  offer: EncounterActionOffer,
  selections: readonly EncounterChoiceSelection[],
): Promise<void> => {
  if (decisionBusy.value || loader.commandsBlocked.value) return
  decisionBusy.value = true
  decisionError.value = null
  void uxMetrics.record('resolution-waiting', 1)
  try {
    const intent = parseEncounterActionDeclarationIntent({
      schemaVersion: ENCOUNTER_PRESENTATION_SCHEMA_VERSION,
      intentId: createLivePlayOpId(),
      offerId: offer.offerId,
      mapSlug: offer.mapSlug,
      baseRevision: offer.mapRevision,
      actorParticipantId: offer.actor.participantId,
      actionId: offer.intent.actionId,
      selections,
    })
    const authorizedOffer = parseAuthorizedItemActionOffer(await postJson<unknown>(MAP_API_PATHS.declareEncounterAction, {
      intent,
      ...(loader.selectedProfileId.value ? { profileId: loader.selectedProfileId.value } : {}),
    }))
    if (authorizedOffer.offerId !== offer.offerId
      || authorizedOffer.mapSlug !== offer.mapSlug
      || authorizedOffer.mapRevision !== offer.mapRevision
      || authorizedOffer.actor.participantId !== offer.actor.participantId
      || authorizedOffer.intent.actionId !== offer.intent.actionId
      || authorizedOffer.source.sourceKind !== offer.source.sourceKind
      || authorizedOffer.source.canonicalId !== offer.source.canonicalId
      || authorizedOffer.source.instanceId !== offer.source.instanceId) {
      throw new Error('The declaration receipt did not match the selected authoritative offer.')
    }
    machine.value = transitionEncounterWorkspace(machine.value, { type: 'intent-submitted' })
    let itemPending = false
    if (authorizedOffer.source.sourceKind === 'item') {
      if (authorizedOffer.equipmentActionCommand) {
        const command = equipmentActionCommandFromAuthorizedOffer({
          offer: authorizedOffer,
          operationId: intent.intentId,
        })
        const execution = await postJson<{ readonly result: unknown }>(ITEM_API_PATHS.equipmentActions, {
          command,
          clientId: getClientId(),
          ...(loader.selectedProfileId.value ? { profileId: loader.selectedProfileId.value } : {}),
        })
        const result = parseEquipmentActionPublicResult(execution.result)
        if (result.status !== 'accepted' && result.status !== 'guided-pending') {
          throw new Error('The equipment action was not accepted.')
        }
        itemPending = result.status === 'guided-pending'
        actionDeclarationGuided.value = itemPending
        actionDeclarationNotice.value = itemPending
          ? `${offer.presentation.label} is waiting for an authorised decision.`
          : `${offer.presentation.label} was applied authoritatively.`
      }
      else if (authorizedOffer.itemFormChangeCommand) {
        const command = itemFormChangeCommandFromAuthorizedOffer({
          offer: authorizedOffer,
          operationId: intent.intentId,
        })
        const execution = await postJson<{ readonly result: unknown }>(ITEM_API_PATHS.formChanges, {
          command,
          clientId: getClientId(),
          ...(loader.selectedProfileId.value ? { profileId: loader.selectedProfileId.value } : {}),
        })
        const result = parseItemFormChangePublicResult(execution.result)
        if (result.status !== 'accepted') throw new Error('The item form change was not accepted.')
        actionDeclarationGuided.value = false
        actionDeclarationNotice.value = result.message
      }
      else {
        const command = itemCommandFromAuthorizedOffer({
          offer: authorizedOffer,
          operationId: intent.intentId,
          choices: selections.map(selection => ({ choiceId: selection.choiceId, optionIds: [...selection.optionIds] })),
        })
        const execution = await postJson<{ readonly result: { readonly status: string, readonly exactReplay: boolean } }>(ITEM_API_PATHS.use, {
          command,
          clientId: getClientId(),
          ...(loader.selectedProfileId.value ? { profileId: loader.selectedProfileId.value } : {}),
        })
        if (execution.result.status !== 'accepted' && execution.result.status !== 'pending') {
          throw new Error('The item operation was not accepted.')
        }
        itemPending = execution.result.status === 'pending'
        actionDeclarationGuided.value = false
        actionDeclarationNotice.value = itemPending
          ? `${offer.presentation.label} is waiting for an authorised decision.`
          : `${offer.presentation.label} was applied authoritatively.`
      }
      await loader.refresh()
    }
    else {
      actionDeclarationGuided.value = false
      actionDeclarationNotice.value = `${offer.presentation.label} was authorized at revision ${offer.mapRevision}. Final source-owned targeting and mechanics remain available in the Battlefield Workshop.`
    }
    machine.value = transitionEncounterWorkspace(machine.value, { type: 'presentation-settled' })
    if (!itemPending) void uxMetrics.record('resolution-settled', 1, { terminalStatus: 'accepted' })
    await router.push(queryForDeepLink({}))
  }
  catch (error) {
    void uxMetrics.record('resolution-settled', 1, { terminalStatus: 'rejected' })
    decisionError.value = error instanceof Error ? error.message : 'The action declaration was rejected.'
  }
  finally {
    decisionBusy.value = false
  }
}
const submitDecision = (selections: readonly EncounterChoiceSelection[]): void => {
  const active = decision.value
  if (!active) return
  void uxMetrics.record('decision-submitted', decisionPresentedAt.value === null ? 0 : metricNow() - decisionPresentedAt.value)
  if (active.kind === 'action') void submitActionDecision(active.offer, selections)
  else void submitPendingDecision(active.interaction, selections)
}
const passPendingDecision = async (interaction: EncounterPendingInteractionAuthorizedView): Promise<void> => {
  if (decisionBusy.value || loader.commandsBlocked.value) return
  decisionBusy.value = true
  pendingBusyInteractionId.value = interaction.interactionId
  decisionError.value = null
  try {
    if (!(await refreshResponseWindows())) return
    await settlePendingResponse(interaction, await pendingMoveResponses.pass({
      resolutionId: interaction.responseIdentity.resolutionId,
      windowId: interaction.responseIdentity.windowId,
    }))
  }
  finally {
    pendingBusyInteractionId.value = null
    decisionBusy.value = false
  }
}
const cancelPendingDecision = async (interaction: EncounterPendingInteractionAuthorizedView): Promise<void> => {
  if (decisionBusy.value || loader.commandsBlocked.value) return
  decisionBusy.value = true
  pendingBusyInteractionId.value = interaction.interactionId
  decisionError.value = null
  try {
    if (!(await refreshResponseWindows())) return
    await settlePendingResponse(interaction, await pendingMoveResponses.cancel(interaction.responseIdentity.resolutionId))
  }
  finally {
    pendingBusyInteractionId.value = null
    decisionBusy.value = false
  }
}
const cancelDecision = (): void => {
  const active = decision.value
  if (!active) return
  if (active.kind === 'action') dismissDecision()
  else void cancelPendingDecision(active.interaction)
}
const passDecision = (): void => {
  const active = decision.value
  if (active?.kind === 'pending') void passPendingDecision(active.interaction)
}
const pendingById = (interactionId: string): EncounterPendingInteractionAuthorizedView | null => {
  const interaction = workspace.value?.pending.find(value => value.interactionId === interactionId)
  return interaction && interaction.projection !== 'public' ? interaction : null
}
const passPendingById = (interactionId: string): void => {
  const interaction = pendingById(interactionId)
  if (interaction) void passPendingDecision(interaction)
}
const cancelPendingById = (interactionId: string): void => {
  const interaction = pendingById(interactionId)
  if (interaction) void cancelPendingDecision(interaction)
}
const abandonItemDecision = async (interaction: EncounterPendingInteractionAuthorizedView): Promise<void> => {
  decisionBusy.value = true
  pendingBusyInteractionId.value = interaction.interactionId
  decisionError.value = null
  try {
    const command: ItemOperationRecoveryCommandV1 = {
      schemaVersion: 1,
      operationId: interaction.responseIdentity.resolutionId,
      action: 'abandon',
      reason: 'The GM abandoned this unresolved item decision.',
    }
    const response = await postJson<{ readonly result: { readonly message: string } }>(ITEM_API_PATHS.recover, {
      command,
      profileId: loader.selectedProfileId.value,
      clientId: getClientId(),
    })
    actionDeclarationGuided.value = false
    actionDeclarationNotice.value = response.result.message
    await loader.refresh()
    void uxMetrics.record('system-recovery-terminal', 1, { terminalStatus: 'cancelled' })
  }
  catch (error) {
    decisionError.value = error instanceof Error ? error.message : 'The item decision could not be abandoned safely.'
  }
  finally {
    pendingBusyInteractionId.value = null
    decisionBusy.value = false
  }
}
const correctItemOperation = async (operationId: string): Promise<void> => {
  if (!workspace.value?.viewer.canUseDirector || decisionBusy.value || loader.commandsBlocked.value) return
  const accepted = workspace.value.accepted.find(value => value.operationId === operationId
    && value.source.sourceKind === 'item'
    && value.presentationId.startsWith('accepted-item:')
    && value.correction === null)
  if (!accepted) {
    decisionError.value = 'This item receipt is no longer available for correction.'
    return
  }
  const confirmed = !import.meta.client || window.confirm(
    `Correct ${accepted.headline.label}? This restores the consumed item and reverses the accepted receipt only if all affected state is unchanged.`,
  )
  if (!confirmed) return
  decisionBusy.value = true
  decisionError.value = null
  try {
    const command: ItemOperationRecoveryCommandV1 = {
      schemaVersion: 1,
      operationId,
      action: 'correct',
      correctionOperationId: createLivePlayOpId(),
      reason: 'The GM corrected this accepted item use.',
    }
    const response = await postJson<{ readonly result: { readonly message: string } }>(ITEM_API_PATHS.recover, {
      command,
      clientId: getClientId(),
    })
    actionDeclarationGuided.value = false
    actionDeclarationNotice.value = response.result.message
    await loader.refresh()
    void uxMetrics.record('system-recovery-terminal', 1, { terminalStatus: 'accepted' })
  }
  catch (error) {
    decisionError.value = error instanceof Error ? error.message : 'The item receipt could not be corrected safely.'
  }
  finally { decisionBusy.value = false }
}
const recoverPending = async (
  interactionId: string,
  action: EncounterPendingRecoveryAction['action'],
): Promise<void> => {
  const interaction = pendingById(interactionId)
  if (!interaction || decisionBusy.value || loader.commandsBlocked.value) return
  void uxMetrics.record('system-recovery-opened', 1)
  if (action === 'cancel') {
    const isItemDecision = interaction.source?.sourceKind === 'item'
      || interaction.responseIdentity.windowId.startsWith('item-decision:')
    if (isItemDecision) await abandonItemDecision(interaction)
    else {
      cancelPendingById(interactionId)
      void uxMetrics.record('system-recovery-terminal', 1, { terminalStatus: 'cancelled' })
    }
    return
  }
  if (action !== 'force-pass') {
    decisionError.value = `${action} requires a source-owned recovery workflow that is not projected as a generic command.`
    return
  }
  decisionBusy.value = true
  pendingBusyInteractionId.value = interactionId
  decisionError.value = null
  try {
    if (!(await refreshResponseWindows())) return
    await settlePendingResponse(interaction, await pendingMoveResponses.forcePass({
      resolutionId: interaction.responseIdentity.resolutionId,
      windowId: interaction.responseIdentity.windowId,
    }))
    void uxMetrics.record('system-recovery-terminal', 1, { terminalStatus: 'accepted' })
  }
  finally {
    pendingBusyInteractionId.value = null
    decisionBusy.value = false
  }
}
const retryUncertainCommand = async (operationId: string): Promise<void> => {
  const result = await pendingMoveResponses.retry(operationId)
  if (result.dispatched) {
    uncertainCommands.value = uncertainCommands.value.filter(value => value.operationId !== operationId)
    decisionError.value = result.message ?? null
    await loader.refresh()
  }
  else {
    upsertUncertainCommand(result, uncertainCommands.value.find(value => value.operationId === operationId)?.label ?? 'Pending response')
    decisionError.value = result.message ?? 'The exact retry did not settle.'
  }
}
const abandonUncertainCommand = async (operationId: string): Promise<void> => {
  const result = await pendingMoveResponses.abandon(operationId)
  if (result.dispatched) {
    uncertainCommands.value = uncertainCommands.value.filter(value => value.operationId !== operationId)
    decisionError.value = result.message ?? null
    await loader.refresh()
  }
  else decisionError.value = result.message ?? 'The operation could not be abandoned safely.'
}
type EncounterDirectorCommandIntent = EncounterDirectorCommand extends infer Command
  ? Command extends EncounterDirectorCommand ? Pick<Command, 'type' | 'payload'> : never
  : never

const initializeDirector = async (): Promise<void> => {
  if (!workspace.value?.viewer.canUseDirector || directorBusy.value) return
  directorBusy.value = true
  directorError.value = null
  try {
    await postJson<EncounterDocument>(ENCOUNTER_WORKSPACE_API_PATHS.initialize, {
      encounterId: workspace.value.source.encounterId,
      mapSlug: workspace.value.source.mapSlug,
      name: encounterName.value,
      recipe: 'blank',
    })
    await loader.refresh()
  }
  catch (error) {
    directorError.value = error instanceof Error ? error.message : 'Encounter authoring could not be enabled.'
  }
  finally { directorBusy.value = false }
}

const issueDirectorCommand = async (intent: EncounterDirectorCommandIntent): Promise<void> => {
  if (!workspace.value?.viewer.canUseDirector || workspace.value.source.encounterRevision === null || directorBusy.value) return
  directorBusy.value = true
  directorError.value = null
  const command: EncounterDirectorCommand = {
    schemaVersion: 1,
    commandId: createLivePlayOpId(),
    encounterId: workspace.value.source.encounterId,
    baseRevision: workspace.value.source.encounterRevision,
    ...intent,
  } as EncounterDirectorCommand
  try {
    await postJson(ENCOUNTER_WORKSPACE_API_PATHS.directorCommand, command)
    await loader.refresh()
  }
  catch (error) {
    directorError.value = error instanceof Error ? error.message : 'Director command was not accepted.'
  }
  finally { directorBusy.value = false }
}

const setDirectorParticipantVisibility = (participantId: string, visibility: 'hidden' | 'revealed'): void => {
  void issueDirectorCommand({ type: 'set-participant-visibility', payload: { participantId, visibility } })
}
const upsertDirectorReserve = (reserve: EncounterDocumentReserve): void => {
  void issueDirectorCommand({ type: 'upsert-reserve', payload: { reserve } })
}
const removeDirectorReserve = (reserveId: string): void => {
  void issueDirectorCommand({ type: 'remove-reserve', payload: { reserveId } })
}
const upsertDirectorWave = (wave: EncounterDocumentWave): void => {
  void issueDirectorCommand({ type: 'upsert-wave', payload: { wave } })
}
const setDirectorWaveStatus = (waveId: string, status: EncounterDocumentWave['status']): void => {
  void issueDirectorCommand({ type: 'set-wave-status', payload: { waveId, status } })
}
const upsertDirectorObjective = (objective: EncounterDocumentObjective): void => {
  void issueDirectorCommand({ type: 'upsert-objective', payload: { objective } })
}
const removeDirectorObjective = (objectiveId: string): void => {
  void issueDirectorCommand({ type: 'remove-objective', payload: { objectiveId } })
}
const upsertDirectorClock = (clock: EncounterDocumentClock): void => {
  void issueDirectorCommand({ type: 'upsert-clock', payload: { clock } })
}
const removeDirectorClock = (clockId: string): void => {
  void issueDirectorCommand({ type: 'remove-clock', payload: { clockId } })
}
const upsertDirectorPhase = (phase: EncounterDocumentPhase): void => {
  void issueDirectorCommand({ type: 'upsert-phase', payload: { phase } })
}
const activateDirectorPhase = (phaseId: string): void => {
  void issueDirectorCommand({ type: 'activate-phase', payload: { phaseId } })
}
const setDirectorStory = (value: {
  name: string
  lifecycle: EncounterDocument['lifecycle']
  publicStakes: string | null
  gmStakes: string | null
  notes: string | null
}): void => {
  void issueDirectorCommand({ type: 'set-story', payload: value })
}

const issueDirectorMapCommand = async (input: {
  path: string
  type: typeof LIVE_PLAY_COMMAND_TYPES.SET_SCENE | typeof LIVE_PLAY_COMMAND_TYPES.SET_FIELD_EFFECT | typeof LIVE_PLAY_COMMAND_TYPES.CLEAR_FIELD_EFFECTS
  lane: 'scene' | 'fieldEffects'
  payload: unknown
}): Promise<void> => {
  if (!workspace.value?.viewer.canUseDirector || directorBusy.value || loader.commandsBlocked.value) return
  directorBusy.value = true
  directorError.value = null
  try {
    const result = await postJson<{ readonly ok?: boolean, readonly message?: string }>(input.path, {
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
      opId: createLivePlayOpId(),
      mapSlug: workspace.value.source.mapSlug,
      baseRevision: workspace.value.source.mapRevision,
      type: input.type,
      scopes: [{ kind: 'map', lane: input.lane }],
      payload: input.payload,
      clientId: getClientId(),
    })
    if (result.ok === false) throw new Error(result.message || 'Director map command was rejected.')
    await loader.refresh()
  }
  catch (error) {
    directorError.value = error instanceof Error ? error.message : 'Director map command was not accepted.'
  }
  finally { directorBusy.value = false }
}
const setDirectorScene = (name: string | null): void => {
  void issueDirectorMapCommand({ path: MAP_API_PATHS.setScene, type: LIVE_PLAY_COMMAND_TYPES.SET_SCENE, lane: 'scene', payload: { name } })
}
const setDirectorFieldEffect = (payload: SetFieldEffectPayload): void => {
  void issueDirectorMapCommand({ path: MAP_API_PATHS.setFieldEffect, type: LIVE_PLAY_COMMAND_TYPES.SET_FIELD_EFFECT, lane: 'fieldEffects', payload })
}
const clearDirectorFieldEffects = (): void => {
  void issueDirectorMapCommand({ path: MAP_API_PATHS.clearFieldEffects, type: LIVE_PLAY_COMMAND_TYPES.CLEAR_FIELD_EFFECTS, lane: 'fieldEffects', payload: { category: 'all' } })
}
const retryDirectorLifecycleCommand = async (): Promise<void> => {
  const entry = lifecycleRecoveryEntry.value
  if (!entry || lifecycleRecoveryBusy.value) return
  lifecycleRecoveryBusy.value = true
  directorError.value = null
  try {
    const result = await encounterLifecycleCommands.retryOutboxCommand(entry.opId)
    if (result.uncertain || !result.dispatched) {
      directorError.value = result.message || 'The exact lifecycle command retry did not settle.'
      return
    }
    await loader.refresh()
  }
  finally { lifecycleRecoveryBusy.value = false }
}
const checkDirectorLifecycleCommand = async (): Promise<void> => {
  const entry = lifecycleRecoveryEntry.value
  if (!entry || lifecycleRecoveryBusy.value) return
  lifecycleRecoveryBusy.value = true
  directorError.value = null
  try {
    const result = await encounterLifecycleCommands.checkOutboxCommandStatus(entry.opId)
    if (result.status === 'accepted' || result.status === 'rejected') await loader.refresh()
    else directorError.value = result.message
  }
  finally { lifecycleRecoveryBusy.value = false }
}
const issueEncounterLifecycleCommand = async (
  action: () => Promise<{ readonly dispatched: boolean, readonly message?: string, readonly uncertain?: boolean }>,
  fallback: string,
): Promise<void> => {
  if (!workspace.value?.viewer.canUseDirector || directorBusy.value || loader.commandsBlocked.value
    || lifecycleRecoveryEntry.value) return
  directorBusy.value = true
  directorError.value = null
  try {
    const result = await action()
    if (result.uncertain) {
      directorError.value = result.message || 'The cleanup outcome is uncertain. Recover the exact journaled command before issuing another command.'
      return
    }
    if (!result.dispatched) throw new Error(result.message || fallback)
    await loader.refresh()
  }
  catch (error) {
    directorError.value = error instanceof Error ? error.message : fallback
  }
  finally { directorBusy.value = false }
}
const dismissDirectorEffect = (dismissalRef: string): void => {
  void issueEncounterLifecycleCommand(
    () => encounterLifecycleCommands.dismissEncounterEffect({ effectId: dismissalRef }),
    'The active effect could not be dismissed.',
  )
}
const openFinishEncounter = async (): Promise<void> => {
  if (!workspace.value?.viewer.canUseDirector || finishEncounter.isOpen.value) return
  finishEncounterOrigin = document.activeElement instanceof HTMLElement ? document.activeElement : null
  directorOpen.value = false
  await finishEncounter.open()
}
const closeFinishEncounter = async (): Promise<void> => {
  const restoreDirectorOrigin = finishEncounterOrigin?.classList.contains('encounter-director__finish')
    && finishEncounter.state.value !== 'accepted'
  finishEncounter.close()
  if (restoreDirectorOrigin) directorOpen.value = true
  await nextTick()
  if (restoreDirectorOrigin) await nextTick()
  const target = finishEncounterOrigin?.isConnected
    ? finishEncounterOrigin
    : restoreDirectorOrigin
      ? document.querySelector<HTMLElement>('.encounter-director__finish')
      : document.getElementById('encounter-director-toggle')
  target?.focus({ preventScroll: true })
  finishEncounterOrigin = null
}
const handleFinishEncounterGateAction = async (action: FinishEncounterGateAction): Promise<void> => {
  if (action === 'refresh-review') {
    await finishEncounter.refresh()
    return
  }
  await closeFinishEncounter()
  if (action === 'open-director') await setDirectorOpen(true)
}
const commitFinishEncounter = async (): Promise<void> => {
  await finishEncounter.commit()
  if (finishEncounter.state.value === 'accepted') await loader.refresh()
}
const openDirectorHistory = (presentationId: string): void => {
  openAcceptedPresentation(presentationId)
  void setDirectorOpen(false)
}

const setDirectorOpen = async (open: boolean): Promise<void> => {
  if (open && !workspace.value?.viewer.canUseDirector) return
  directorOpen.value = open
  if (!open) {
    await nextTick()
    document.getElementById('encounter-director-toggle')?.focus({ preventScroll: true })
  }
}

const setSettingsOpen = async (open: boolean): Promise<void> => {
  settingsOpen.value = open
  if (!open) {
    await nextTick()
    document.getElementById('encounter-display-settings-toggle')?.focus({ preventScroll: true })
  }
}

const openDirectorWorkshop = async (): Promise<void> => {
  if (!workspace.value?.viewer.canUseDirector) return
  await router.push(battlefieldWorkshopPath(workspace.value.source.mapSlug))
}

const advanceInitiative = async (direction: 'previous' | 'next'): Promise<void> => {
  if (!workspace.value || !isGm.value || loader.commandsBlocked.value || initiativeBusy.value) return
  initiativeBusy.value = true
  initiativeError.value = null
  try {
    const result = await postJson<{ readonly ok?: boolean, readonly message?: string }>(
      direction === 'next' ? MAP_API_PATHS.nextInitiative : MAP_API_PATHS.previousInitiative,
      {
        schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
        opId: createLivePlayOpId(),
        mapSlug: workspace.value.source.mapSlug,
        baseRevision: workspace.value.source.mapRevision,
        type: direction === 'next' ? LIVE_PLAY_COMMAND_TYPES.NEXT_INITIATIVE : LIVE_PLAY_COMMAND_TYPES.PREVIOUS_INITIATIVE,
        scopes: [{ kind: 'map', lane: 'initiative' }, { kind: 'map', lane: 'metadata' }],
        payload: {
          orderIds: workspace.value.turn.entries.map(entry => entry.participantId),
          activeId: workspace.value.turn.currentParticipantId,
          round: workspace.value.turn.round,
        },
        clientId: getClientId(),
      },
    )
    if (result.ok === false) throw new Error(result.message || 'Initiative command was rejected.')
    await loader.refresh()
  }
  catch (error) {
    initiativeError.value = error instanceof Error ? error.message : 'Initiative could not advance.'
  }
  finally {
    initiativeBusy.value = false
  }
}

useHead(() => ({ title: `${encounterName.value} · Encounter` }))
</script>

<template>
  <div
    class="encounter-workspace-page rt-design-system"
    data-rt-design-system="1"
    data-rt-context="live-encounter"
    v-bind="preferenceState.attributes.value"
  >
    <nav class="encounter-workspace-skip-links" aria-label="Skip to encounter region">
      <a href="#encounter-battle-stage">Skip to battle</a>
      <a href="#encounter-action-dock">Skip to actions</a>
      <a href="#encounter-decision-history">Skip to decisions and history</a>
      <a href="#encounter-participant-roster">Skip to participants</a>
    </nav>
    <main v-if="!workspace" class="encounter-workspace-load-state">
      <AppNavigation />
      <div v-if="loader.status.value === 'loading' || loader.status.value === 'idle'" role="status">
        <span class="encounter-workspace-load-state__pulse" aria-hidden="true" />
        <h1>Opening encounter workspace</h1>
        <p>Loading the authoritative map, participants, actions, and pending decisions…</p>
      </div>
      <div v-else-if="loader.status.value === 'inaccessible'" role="alert">
        <h1>Encounter unavailable</h1>
        <p>{{ loader.message.value || 'This encounter does not exist or is not available to the selected role and profile.' }}</p>
        <NuxtLink :to="encounterLibraryPath()">Return to Encounter Library</NuxtLink>
      </div>
      <div v-else role="alert">
        <h1>Could not open encounter</h1>
        <p>{{ loader.message.value }}</p>
        <button type="button" @click="loader.refresh()">Try again</button>
        <NuxtLink :to="encounterLibraryPath()">Encounter Library</NuxtLink>
      </div>
    </main>

    <EncounterWorkspaceAnnouncements
      v-if="workspace"
      :workspace="workspace"
      :error="decisionError || initiativeError || directorError"
    />

    <EncounterWorkspaceShell
      v-if="workspace"
      :preferences="preferenceState.preferences.value"
      :primary-decision-active="Boolean(decision || actionInspectorOffer || actionDeclarationNotice || selection.tacticalFocus || finishEncounter.isOpen.value)"
      @update-preferences="preferenceState.update"
    >
      <template #navigation>
        <EncounterWorkspaceNavigation
          :map-slug="workspace.source.mapSlug"
          :encounter-name="encounterName"
          :can-use-director="workspace.viewer.canUseDirector"
          :director-open="directorOpen"
          :settings-open="settingsOpen"
          @toggle-director="setDirectorOpen(!directorOpen)"
          @toggle-settings="setSettingsOpen(!settingsOpen)"
        />
      </template>
      <template #status>
        <EncounterWorkspaceSystemStatus
          :workspace="workspace"
          :load-status="loader.status.value"
          :connection="loader.connection.value"
          :commands-blocked="loader.commandsBlocked.value"
          :message="loader.message.value"
          @retry="loader.refresh()"
        />
      </template>
      <template #timeline>
        <EncounterTurnRail
          :turn="workspace.turn"
          :participants="workspace.participants"
          :can-advance="isGm"
          :commands-blocked="loader.commandsBlocked.value"
          :busy="initiativeBusy"
          @inspect="inspectParticipant"
          @previous="advanceInitiative('previous')"
          @next="advanceInitiative('next')"
        />
        <p v-if="initiativeError" class="encounter-initiative-error" role="alert">{{ initiativeError }}</p>
      </template>

      <template #roster>
        <section class="encounter-roster-content">
          <EncounterSideRoster
            v-for="side in rosterSides"
            :key="side.sideId"
            :side="side"
            :participants="workspace.participants"
            :teams="workspace.teams"
            :audience="workspace.viewer.audience"
            :selected-participant-id="selection.selectedActorId"
            :inspected-participant-id="selection.inspectedParticipantId"
            :accepted-states="acceptedParticipantStates"
            :team-operations="teamOperationOffers"
            @select="selectParticipant"
            @inspect="inspectParticipant"
            @activate-team-operation="chooseTeamOperation"
          />
        </section>
      </template>

      <template #stage>
        <EncounterBattleStage
          :participants="workspace.participants"
          :current-participant-id="workspace.turn.currentParticipantId"
          :selected-participant-id="selection.selectedActorId"
          :inspected-participant-id="selection.inspectedParticipantId"
          :audience="workspace.viewer.audience"
          :environment="workspace.environment"
          :objectives="workspace.objectives"
          :clocks="workspace.clocks"
          :phase="workspace.phase"
          :stakes="workspace.stakes"
          :limitations="workspace.mapBackedLimitations"
          :accepted-states="acceptedParticipantStates"
          @select="selectParticipant"
          @inspect="inspectParticipant"
          @open-tactical="openTacticalFocus"
        >
          <template #empty>
            <p class="encounter-battle-stage__eyebrow">Empty battlefield</p>
            <h1>No encounter participants</h1>
            <p>Prepare this battlefield in the Workshop, then return to begin live play.</p>
            <NuxtLink :to="battlefieldWorkshopPath(workspace.source.mapSlug)">Open Battlefield Workshop</NuxtLink>
          </template>
          <template #tactical>
            <EncounterRelationshipView
              v-if="selectedActionOffer && selectedActionSpatiality === 'relationship' && relationshipActor"
              :offer="selectedActionOffer"
              :actor="relationshipActor"
              :participants="workspace.participants"
              :environment="workspace.environment"
              :selected-participant-ids="selection.targetPreviewParticipantIds"
              @select="selectRelationshipTarget"
              @inspect="inspectParticipant"
              @open-tactical="openTacticalFocus(selectedActionOffer.actor.participantId)"
            />
            <EncounterDecisionLayer
              v-if="decision"
              :decision="decision"
              :busy="decisionBusy"
              :error="decisionError"
              @submit="submitDecision"
              @pass="passDecision"
              @cancel="cancelDecision"
              @dismiss="dismissDecision"
              @open-tactical="openDecisionTacticalFocus"
            />
            <EncounterSubjectSkillChecks
              v-else
              :profile-id="loader.selectedProfileId.value"
              :gm="workspace.viewer.audience === 'gm'"
              :commands-blocked="loader.commandsBlocked.value"
            />
            <section
              v-if="actionInspectorOffer"
              class="encounter-action-inspector rt-surface"
              data-rt-elevation="2"
              role="dialog"
              aria-modal="false"
              aria-labelledby="encounter-action-inspector-title"
              @keydown.esc.stop.prevent="closeActionInspector"
            >
              <header>
                <div>
                  <p class="encounter-battle-stage__eyebrow">Action details</p>
                  <h2 id="encounter-action-inspector-title" ref="actionInspectorHeading" tabindex="-1">{{ actionInspectorOffer.presentation.label }}</h2>
                </div>
                <button type="button" aria-label="Close action details" @click="closeActionInspector">×</button>
              </header>
              <p>{{ actionInspectorOffer.presentation.description || 'No additional public description is projected.' }}</p>
              <p><strong>Source:</strong> {{ actionInspectorOffer.source.displayName }} · <strong>Timing:</strong> {{ actionInspectorOffer.timing.label }}</p>
              <p v-if="actionInspectorOffer.sourceContextLabel"><strong>From:</strong> {{ actionInspectorOffer.sourceContextLabel }}</p>
              <p v-if="actionInspectorOffer.costs.length"><strong>Base cost:</strong> {{ actionInspectorOffer.costs.map(cost => cost.label).join(' · ') }}</p>
              <ul v-if="actionInspectorOffer.availability.reasons.length" aria-label="Unavailable reasons">
                <li v-for="reason in actionInspectorOffer.availability.reasons" :key="reason.code">{{ reason.label }}</li>
              </ul>
              <section v-if="actionInspectorOffer.selectionOptions?.length" class="encounter-action-inspector__options" aria-labelledby="action-inspector-options-heading">
                <h3 id="action-inspector-options-heading">Authorized options</h3>
                <ul>
                  <li v-for="option in actionInspectorOffer.selectionOptions" :key="`${option.kind}:${option.value}`" :data-unavailable="option.disabled || undefined">
                    <strong>{{ option.label }}</strong>
                    <span v-if="option.description">{{ option.description }}</span>
                    <span v-if="option.unavailableReason">Unavailable · {{ option.unavailableReason.label }}</span>
                    <small v-if="option.costs?.length">{{ option.costs.map(cost => cost.label).join(' · ') }}</small>
                  </li>
                </ul>
              </section>
            </section>
            <div
              v-if="actionDeclarationNotice"
              ref="actionNoticeRef"
              class="encounter-action-declaration-notice"
              role="status"
              tabindex="-1"
            >
              <p>{{ actionDeclarationNotice }}</p>
              <p v-if="actionDeclarationGuided && !isGm">Track or cancel the reconnectable request from the declaring owner’s sheet.</p>
              <div>
                <NuxtLink v-if="actionDeclarationGuided && isGm" to="/campaign#guided-workshop-title">Open guided adjudication</NuxtLink>
                <NuxtLink v-else-if="!actionDeclarationGuided" :to="battlefieldWorkshopPath(workspace.source.mapSlug)">Continue in Battlefield Workshop</NuxtLink>
                <button type="button" aria-label="Dismiss action declaration receipt" @click="dismissActionDeclarationNotice">Dismiss</button>
              </div>
            </div>
            <div v-if="selection.tacticalFocus" id="encounter-tactical-focus" tabindex="-1">
              <EncounterTacticalLens
                v-if="workspace.viewer.canUseExactGeometry"
                :map-slug="workspace.source.mapSlug"
                :map-revision="workspace.source.mapRevision"
                :open="true"
                :mode="preferenceState.preferences.value.tacticalMode"
                :selected-participant-id="selection.selectedActorId"
                :action-offer-id="selectedActionOffer?.offerId ?? null"
                :selected-target-ids="selection.targetPreviewParticipantIds"
                @close="closeTacticalFocus"
                @select-participant="selectFromTacticalLens"
                @update-mode="updateTacticalMode"
                @ready="handleTacticalReady"
                @stale="handleTacticalStale"
              />
              <section v-else class="encounter-tactical-placeholder">
                <p class="encounter-battle-stage__eyebrow">Tactical focus unavailable</p>
                <h2>Exact geometry is not authorized in this view</h2>
                <p>The workspace projection intentionally contains no positions or token dimensions. Ask the GM to share a permitted tactical view.</p>
              </section>
              <p v-if="tacticalStartupMs !== null" class="encounter-tactical-performance rt-numeric" role="status">
                Tactical renderer ready in {{ tacticalStartupMs }} ms
              </p>
            </div>
            <details v-if="workspace.mapBackedLimitations.length" class="encounter-map-limitations">
              <summary>Map-backed workspace limitations</summary>
              <p>Structured {{ workspace.mapBackedLimitations.join(', ') }} are not authored by the current battlefield document and are not fabricated by this workspace.</p>
            </details>
          </template>
        </EncounterBattleStage>
      </template>

      <template #events>
        <section class="encounter-events-content">
          <EncounterResolutionStack
            :pending="workspace.pending"
            :primary-interaction-id="primaryPriority?.interactionId ?? null"
            :active-interaction-id="activeDeepLink?.interactionId ?? null"
            :busy-interaction-id="pendingBusyInteractionId"
            :guided-item-href="workspace.viewer.canUseDirector ? '/campaign#guided-workshop-title' : null"
            @open="openPendingDecision"
            @pass="passPendingById"
            @cancel="cancelPendingById"
            @recover="recoverPending"
          />
          <p v-if="decisionError && !decision" class="encounter-decision-error" role="alert">{{ decisionError }}</p>
          <EncounterSkillCheckPublicFeed v-if="!workspace.viewer.canUseDirector" />
          <EncounterEventFeed
            :accepted="workspace.accepted"
            :active-presentation-id="activeDeepLink?.presentationId ?? null"
            :uncertain="uncertainCommands"
            @open="openAcceptedPresentation"
            @retry="retryUncertainCommand"
            @abandon="abandonUncertainCommand"
          />
        </section>
      </template>

      <template #dock>
        <EncounterActionDock
          id="encounter-action-dock"
          :offers="workspace.offers"
          :affordances="workspace.affordances"
          :actor-participant-id="actionActor?.participantId ?? null"
          :actor-label="actionActor?.displayName || 'Select an actor'"
          :selected-offer-id="machine.actionOfferId"
          :commands-blocked="loader.commandsBlocked.value || (machine.phase !== 'observe' && machine.phase !== 'choose')"
          @activate="chooseAction"
          @inspect="inspectAction"
          @filter="noteActionFilter"
        />
      </template>
    </EncounterWorkspaceShell>

    <EncounterWorkspaceSettings
      v-if="workspace"
      :open="settingsOpen"
      :preferences="preferenceState.preferences.value"
      @close="setSettingsOpen(false)"
      @reset="preferenceState.reset()"
      @update="preferenceState.update"
    />

    <EncounterDirectorPanel
      v-if="workspace?.viewer.canUseDirector"
      :workspace="workspace"
      :open="directorOpen"
      :commands-blocked="loader.commandsBlocked.value"
      :busy="directorBusy || initiativeBusy || decisionBusy || lifecycleRecoveryBusy"
      :error="directorError"
      :lifecycle-recovery="lifecycleRecoveryEntry ? {
        state: lifecycleRecoveryEntry.state,
        label: lifecycleRecoveryEntry.commandType === LIVE_PLAY_COMMAND_TYPES.END_ENCOUNTER
          ? 'Encounter cleanup'
          : 'Effect dismissal',
      } : null"
      @update:open="setDirectorOpen"
      @refresh="loader.refresh()"
      @open-workshop="openDirectorWorkshop"
      @initialize="initializeDirector"
      @set-participant-visibility="setDirectorParticipantVisibility"
      @upsert-reserve="upsertDirectorReserve"
      @remove-reserve="removeDirectorReserve"
      @upsert-wave="upsertDirectorWave"
      @set-wave-status="setDirectorWaveStatus"
      @upsert-objective="upsertDirectorObjective"
      @remove-objective="removeDirectorObjective"
      @upsert-clock="upsertDirectorClock"
      @remove-clock="removeDirectorClock"
      @upsert-phase="upsertDirectorPhase"
      @activate-phase="activateDirectorPhase"
      @set-story="setDirectorStory"
      @previous-initiative="advanceInitiative('previous')"
      @next-initiative="advanceInitiative('next')"
      @set-scene="setDirectorScene"
      @set-field-effect="setDirectorFieldEffect"
      @clear-field-effects="clearDirectorFieldEffects"
      @dismiss-effect="dismissDirectorEffect"
      @finish-encounter="openFinishEncounter"
      @retry-lifecycle="retryDirectorLifecycleCommand"
      @check-lifecycle="checkDirectorLifecycleCommand"
      @recover="recoverPending"
      @correct-item="correctItemOperation"
      @open-history="openDirectorHistory"
    />

    <EncounterFinishExperience
      v-if="isGm"
      :open="finishEncounter.isOpen.value"
      :state="finishEncounter.state.value"
      :view="finishEncounter.view.value"
      :error="finishEncounter.error.value"
      :online="finishEncounter.online.value"
      :can-commit="finishEncounter.canCommit.value"
      :can-retry="finishEncounter.canRetry.value"
      :can-discard="finishEncounter.canDiscard.value"
      @close="closeFinishEncounter"
      @refresh="finishEncounter.refresh"
      @commit="commitFinishEncounter"
      @check-server="finishEncounter.checkServer"
      @retry-exact="finishEncounter.retryExact"
      @discard-and-review-fresh="finishEncounter.discardAndReviewFresh"
      @gate-action="handleFinishEncounterGateAction"
    />
  </div>
</template>

<style scoped>
.encounter-workspace-page { min-height: 100dvh; background: var(--rt-bg-world); color: var(--rt-text); }
.encounter-workspace-skip-links { position: fixed; z-index: calc(var(--rt-layer-modal) + 1); inset: .5rem auto auto .5rem; pointer-events: none; }
.encounter-workspace-skip-links a:not(:focus) { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; border: 0; clip-path: inset(50%); white-space: nowrap; }
.encounter-workspace-skip-links a:focus { min-height: var(--rt-touch-minimum); display: flex; align-items: center; padding: .45rem .7rem; border: 2px solid var(--rt-focus); border-radius: var(--rt-radius-small); background: var(--rt-bg-canvas); color: var(--rt-text-strong); font-weight: 700; text-decoration: none; pointer-events: auto; }
.encounter-workspace-load-state { min-height: 100dvh; padding: 1rem; background: var(--rt-bg-canvas); }
.encounter-workspace-load-state > div { max-width: 44rem; margin: 15vh auto; padding: 2rem; text-align: center; }
.encounter-workspace-load-state a,
.encounter-workspace-load-state button,
.encounter-battle-stage a,
.encounter-tactical-placeholder a { min-height: var(--rt-touch-minimum); display: inline-flex; align-items: center; margin: 0.25rem; padding: 0.6rem 0.9rem; border: 1px solid var(--rt-rule); border-radius: var(--rt-radius-small); background: var(--rt-surface-2); color: var(--rt-text-strong); font: inherit; font-weight: 700; text-decoration: none; }
.encounter-workspace-load-state__pulse { display: inline-block; width: 3rem; height: 3rem; border: 4px solid var(--rt-rule); border-top-color: var(--rt-focus); border-radius: 50%; animation: encounter-workspace-loading 0.8s linear 3; }
@keyframes encounter-workspace-loading { to { transform: rotate(1turn); } }
.encounter-turn-spine { display: flex; align-items: stretch; min-width: 0; height: 4.25rem; border-bottom: 1px solid var(--rt-rule); background: var(--rt-surface-1); }
.encounter-turn-spine__round { width: 5rem; display: grid; place-items: center; flex: 0 0 auto; border-right: 1px solid var(--rt-rule); }
.encounter-turn-spine__round span { color: var(--rt-text-muted); font-size: var(--rt-type-meta-xs-size); text-transform: uppercase; }
.encounter-turn-spine__round strong { font-size: 1.35rem; }
.encounter-turn-spine ol { display: flex; gap: 0.35rem; min-width: 0; margin: 0; padding: 0.35rem; overflow-x: auto; list-style: none; }
.encounter-turn-spine li button { min-width: 9rem; height: 100%; display: flex; align-items: center; justify-content: space-between; gap: 0.6rem; padding: 0.45rem 0.65rem; border: 1px solid var(--rt-rule); border-radius: var(--rt-radius-small); background: var(--rt-surface-2); color: var(--rt-text); font: inherit; }
.encounter-turn-spine li[data-state='current'] button { border-color: var(--rt-focus); background: color-mix(in srgb, var(--rt-info) 14%, var(--rt-surface-2)); color: var(--rt-text-strong); }
.encounter-roster-content,
.encounter-events-content { padding: 0.75rem; }
.encounter-side-group + .encounter-side-group { margin-top: 1.25rem; }
.encounter-side-group h2,
.encounter-events-content h2 { margin: 0 0 0.5rem; font-size: var(--rt-type-heading-md-size); }
.encounter-side-group ul,
.encounter-event-list { display: grid; gap: 0.35rem; margin: 0; padding: 0; list-style: none; }
.encounter-side-group a,
.encounter-event-list a { min-height: var(--rt-touch-minimum); display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 0.55rem; padding: 0.45rem; border: 1px solid transparent; border-radius: var(--rt-radius-small); color: var(--rt-text); text-decoration: none; }
.encounter-side-group a:hover,
.encounter-side-group a[aria-current='true'],
.encounter-event-list a:hover,
.encounter-event-list a[data-primary='true'] { border-color: var(--rt-focus); background: var(--rt-surface-2); }
.encounter-side-group a > span:nth-child(2) { min-width: 0; }
.encounter-side-group a strong,
.encounter-side-group a small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.encounter-side-group a small,
.encounter-event-list span { color: var(--rt-text-muted); font-size: var(--rt-type-body-sm-size); }
.encounter-side-group__portrait,
.encounter-stage-cast__portrait { display: grid; place-items: center; width: 2.25rem; height: 2.25rem; border-radius: 50%; background: var(--rt-surface-3); color: var(--rt-text-strong); font-weight: 800; }
.encounter-side-group__hidden { color: var(--rt-text-muted); font-size: var(--rt-type-body-sm-size); }
.encounter-battle-stage { min-height: 100%; padding: clamp(1rem, 3vw, 2.5rem); background: radial-gradient(circle at 50% 0, color-mix(in srgb, var(--rt-info) 11%, transparent), transparent 34rem); }
.encounter-battle-stage__eyebrow { margin: 0 0 0.2rem; color: var(--rt-info); font-size: var(--rt-type-label-sm-size); font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; }
.encounter-current-actor { text-align: center; }
.encounter-current-actor h1 { margin: 0; color: var(--rt-text-strong); font-size: var(--rt-type-display-lg-size); }
.encounter-current-actor p:last-child { color: var(--rt-text-muted); }
.encounter-battle-stage__empty { max-width: 42rem; margin: 15vh auto; text-align: center; }
.encounter-inspector-preview { max-width: 48rem; display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin: 1.5rem auto; padding: 1rem; border: 1px solid var(--rt-rule); border-radius: var(--rt-radius-medium); background: var(--rt-surface-1); }
.encounter-inspector-preview h2 { margin: 0; }
.encounter-inspector-preview dl { display: grid; grid-template-columns: repeat(2, auto); gap: 0.35rem 1rem; margin: 0; }
.encounter-inspector-preview dl div { display: contents; }
.encounter-inspector-preview dt { color: var(--rt-text-muted); }
.encounter-inspector-preview dd { margin: 0; text-align: right; }
.encounter-stage-cast { max-width: 64rem; margin: 2rem auto; }
.encounter-stage-cast h2 { text-align: center; }
.encounter-stage-cast > div { display: flex; justify-content: center; gap: 0.75rem; flex-wrap: wrap; }
.encounter-stage-cast button { min-width: 8rem; min-height: 8rem; display: grid; place-items: center; gap: 0.25rem; padding: 0.75rem; border: 1px solid var(--rt-rule); border-radius: var(--rt-radius-medium); background: var(--rt-surface-1); color: var(--rt-text); font: inherit; }
.encounter-stage-cast button.selected { border-color: var(--rt-focus); box-shadow: 0 0 0 2px color-mix(in srgb, var(--rt-focus) 28%, transparent); }
.encounter-stage-cast__portrait { width: 3.5rem; height: 3.5rem; font-size: 1.5rem; }
.encounter-tactical-placeholder,
.encounter-map-limitations,
.encounter-action-inspector,
.encounter-action-declaration-notice { max-width: 52rem; margin: 1.5rem auto; padding: 1rem; border: 1px solid var(--rt-rule); border-radius: var(--rt-radius-medium); background: var(--rt-surface-1); }
.encounter-action-inspector > header { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; }
.encounter-action-inspector h2 { margin: 0; }
.encounter-action-inspector > header button { width: var(--rt-touch-minimum); height: var(--rt-touch-minimum); border: 1px solid var(--rt-rule); border-radius: var(--rt-radius-small); background: var(--rt-surface-2); color: var(--rt-text-strong); font: 800 1.25rem/1 var(--rt-font-interface); }
.encounter-action-inspector__options { margin-top: 0.85rem; padding-top: 0.75rem; border-top: 1px solid var(--rt-rule); }
.encounter-action-inspector__options h3 { margin: 0 0 0.45rem; color: var(--rt-text-strong); font-size: var(--rt-type-action-md-size); }
.encounter-action-inspector__options ul { display: grid; gap: 0.4rem; margin: 0; padding: 0; list-style: none; }
.encounter-action-inspector__options li { display: grid; gap: 0.1rem; padding: 0.55rem 0.65rem; border-left: 3px solid var(--rt-rule); background: var(--rt-surface-2); }
.encounter-action-inspector__options li[data-unavailable='true'] { border-left-color: var(--rt-danger); }
.encounter-action-inspector__options span,
.encounter-action-inspector__options small { color: var(--rt-text-muted); }
.encounter-action-declaration-notice { border-color: var(--rt-info); }
.encounter-action-inspector h2:focus-visible,
.encounter-action-declaration-notice:focus-visible { outline: 3px solid var(--rt-focus); outline-offset: 3px; }
.encounter-action-declaration-notice > p { margin-top: 0; }
.encounter-action-declaration-notice > div { display: flex; flex-wrap: wrap; gap: 0.4rem; }
.encounter-action-declaration-notice button { min-height: var(--rt-touch-minimum); border: 1px solid var(--rt-rule); border-radius: var(--rt-radius-small); background: var(--rt-surface-2); color: var(--rt-text-strong); font: inherit; font-weight: 700; }
.encounter-decision-error { padding: 0.65rem; border-left: 3px solid var(--rt-danger); background: color-mix(in srgb, var(--rt-danger) 10%, var(--rt-surface-1)); }
.encounter-event-list a { grid-template-columns: 1fr; }
.encounter-events-content header { margin: 0.5rem 0 0.75rem; }
.encounter-events-content header:not(:first-child) { margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid var(--rt-rule); }
.encounter-events-content__empty { color: var(--rt-text-muted); }
.encounter-action-preview { min-height: 100%; padding: 0.7rem; }
.encounter-action-preview > header { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
.encounter-action-preview h2 { margin: 0; font-size: var(--rt-type-heading-md-size); }
.encounter-action-preview__scroller { display: flex; gap: 0.6rem; padding: 0.5rem 0; overflow-x: auto; }
.encounter-action-preview__scroller button { min-width: 12rem; min-height: 7rem; display: grid; align-content: center; gap: 0.25rem; padding: 0.75rem; border: 1px solid var(--rt-rule); border-radius: var(--rt-radius-medium); background: var(--rt-surface-2); color: var(--rt-text); font: inherit; text-align: left; }
.encounter-action-preview__scroller button > span { color: var(--rt-info); font-size: var(--rt-type-meta-xs-size); text-transform: uppercase; }
.encounter-action-preview__scroller button > small { color: var(--rt-text-muted); }
.encounter-action-preview__scroller button[data-selected='true'] { border-color: var(--rt-focus); }
.encounter-action-preview__scroller button:disabled { opacity: 0.55; }
[data-encounter-focus]:focus-visible,
[id^='participant-']:focus-visible,
[id^='decision-']:focus-visible,
[id^='history-']:focus-visible { outline: 3px solid var(--rt-focus); outline-offset: 3px; }
@media (prefers-reduced-motion: reduce) { .encounter-workspace-load-state__pulse { animation: none; } }
@media (max-width: 42rem) {
  .encounter-inspector-preview { align-items: stretch; flex-direction: column; }
  .encounter-inspector-preview dl { width: 100%; }
}
</style>

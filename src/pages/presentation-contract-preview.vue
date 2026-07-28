<script setup lang="ts">
import { computed, ref } from 'vue'
import EncounterPresentationPanel from '~/components/map/EncounterPresentationPanel.vue'
import EncounterVfxOverlay from '~/components/map/EncounterVfxOverlay.vue'
import { useEncounterPresentationRuntime } from '~/composables/map-editor/useEncounterPresentationRuntime'
import {
  parseAcceptedEncounterPresentation,
  parseEncounterPresentationProjection,
  projectEncounterPresentation,
  type EncounterActionOffer,
  type EncounterPendingInteractionAuthorizedView,
} from '#shared/encounterPresentation'

const runtimeConfig = useRuntimeConfig()
if (!import.meta.dev && runtimeConfig.public.presentationContractPreview !== true) {
  throw createError({ statusCode: 404, statusMessage: 'Not found' })
}

definePageMeta({ layout: false })
useHead({ title: 'Encounter Presentation Contract Preview' })

const actor = {
  participantId: 'actor:preview',
  displayName: 'Pikachu',
  portraitUrl: null,
  sideId: 'side:heroes',
  sideLabel: 'Heroes',
  sideAccent: '#7658ff',
  sheetKind: 'pokemon' as const,
  statusLabels: ['Focused'],
}
const target = {
  participantId: 'target:preview',
  displayName: 'Squirtle',
  portraitUrl: null,
  sideId: 'side:rivals',
  sideLabel: 'Rivals',
  sideAccent: '#45a9d8',
  sheetKind: 'pokemon' as const,
  statusLabels: [],
}
const moveSource = {
  sourceKind: 'move' as const,
  canonicalId: 'Thunder Shock',
  instanceId: null,
  displayName: 'Thunder Shock',
  referenceHref: '/moves/thunder-shock',
}
const accepted = parseAcceptedEncounterPresentation({
  schemaVersion: 1,
  presentationId: 'accepted:preview',
  operationId: 'operation:preview',
  mapSlug: 'preview-arena',
  previousRevision: 8,
  revision: 9,
  source: moveSource,
  actor,
  affectedParticipants: [target],
  outcomes: [{
    outcomeId: 'outcome:preview:hit',
    kind: 'hit',
    participantId: target.participantId,
    label: 'Hit',
    tone: 'positive',
    preventedBy: [],
  }],
  changes: [{
    changeId: 'change:preview:hp',
    kind: 'hp',
    operation: 'decrease',
    participantId: target.participantId,
    subjectId: target.participantId,
    field: 'current-hp',
    before: { kind: 'number', numberValue: 40, textValue: null, booleanValue: null, unit: 'HP' },
    after: { kind: 'number', numberValue: 31, textValue: null, booleanValue: null, unit: 'HP' },
    delta: -9,
    label: 'Squirtle lost 9 HP',
  }],
  explanations: [],
  causal: { groupId: 'causal:preview', parentPresentationId: null, depth: 0, sequence: 0 },
  headline: { label: 'Thunder Shock hit Squirtle', description: null, iconKey: 'source.move', tone: 'positive' },
  splash: { label: 'Thunder Shock', description: 'Pikachu used Thunder Shock', iconKey: 'source.move', tone: 'positive' },
  vfx: [{
    vfxId: 'vfx:preview:impact',
    kind: 'impact',
    sourceParticipantId: actor.participantId,
    targetParticipantIds: [target.participantId],
    cells: [],
    tone: 'positive',
    duration: 'short',
    reducedMotionKind: 'static',
    label: 'Electrical impact',
  }],
  announcements: [{
    announcementId: 'announcement:preview',
    priority: 'polite',
    message: 'Thunder Shock hit Squirtle for 9 damage.',
    dedupeKey: 'preview:accepted',
  }],
  history: [{
    entryId: 'history:preview',
    occurredAt: 100,
    headline: 'Thunder Shock hit Squirtle',
    detail: 'Squirtle lost 9 HP.',
    tone: 'positive',
    participantIds: [actor.participantId, target.participantId],
  }],
  correction: null,
})
const gmProjection = parseEncounterPresentationProjection({
  schemaVersion: 1,
  projectionId: 'projection:preview-arena:9:gm',
  audience: 'gm',
  mapSlug: 'preview-arena',
  mapRevision: 9,
  generatedAt: 100,
  offers: [{
    schemaVersion: 1,
    offerId: 'offer:preview:thunder-shock',
    mapSlug: 'preview-arena',
    mapRevision: 9,
    actor,
    source: moveSource,
    roles: ['activated-action'],
    group: 'attack',
    groupOrder: 10,
    offerOrder: 0,
    timing: { kind: 'standard', label: 'Standard Action', triggerLabel: null, priority: null },
    costs: [{ kind: 'standard-action', resourceId: null, amount: 1, label: '1 Standard Action' }],
    targeting: [{
      requirementId: 'target',
      kind: 'participant',
      minSelections: 1,
      maxSelections: 1,
      rangeLabel: 'Range 6',
      relationshipLabel: 'Any creature',
      requiresLineOfSight: true,
      requiresSpatialInput: false,
    }],
    usage: { frequencyLabel: 'At-Will', remaining: null, maximum: null, cooldownLabel: null, resetLabel: null },
    availability: { status: 'available', reasons: [] },
    presentation: { label: 'Thunder Shock', description: 'Make a ranged attack.', iconKey: 'source.move', tone: 'neutral' },
    intent: { actionId: 'move.declare', input: 'choices' },
  }],
  passives: [{
    schemaVersion: 1,
    summaryId: 'passive:preview:static',
    participant: actor,
    source: {
      sourceKind: 'ability', canonicalId: 'Static', instanceId: 'ability:static', displayName: 'Static', referenceHref: '/abilities/static',
    },
    roles: ['passive-provider', 'triggered-automatic'],
    active: true,
    facts: [],
    presentation: { label: 'Static', description: 'May paralyze attackers.', iconKey: 'source.ability', tone: 'neutral' },
    explanation: null,
  }],
  affordances: [],
  pending: [{
    schemaVersion: 1,
    projection: 'gm',
    interactionId: 'pending:preview',
    mapSlug: 'preview-arena',
    mapRevision: 9,
    status: 'pending',
    source: moveSource,
    actor,
    prompt: 'Choose whether to use the reaction.',
    choices: [{
      schemaVersion: 1,
      choiceOfferId: 'choice-offer:preview',
      interactionId: 'pending:preview',
      mapSlug: 'preview-arena',
      mapRevision: 9,
      choiceId: 'choice:preview',
      kind: 'branch',
      prompt: 'Use the reaction?',
      helpText: null,
      cardinality: { minimum: 1, maximum: 1 },
      ordering: 'server',
      options: [
        { optionId: 'option:use', label: 'Use reaction', description: null, disabled: false, unavailableReason: null, preview: { kind: 'none' } },
        { optionId: 'option:decline', label: 'Decline', description: null, disabled: false, unavailableReason: null, preview: { kind: 'none' } },
      ],
      defaultOptionIds: [],
      requiresConfirmation: false,
      allowPass: true,
      allowCancel: true,
      expiresAt: null,
    }],
    responseIdentity: {
      interactionId: 'pending:preview', resolutionId: 'resolution:preview', windowId: 'choice:preview', retryKey: 'retry:preview',
    },
    allowPass: true,
    allowCancel: true,
    expiresAt: null,
    recoveryActions: [{
      action: 'force-pass', actionId: 'recovery:preview:force-pass', label: 'Force pass', enabled: true, unavailableReason: null,
    }],
    announcement: {
      announcementId: 'announcement:pending:preview', priority: 'assertive', message: 'A response is required.', dedupeKey: 'pending:preview',
    },
  }],
  accepted: [accepted],
  diagnostics: [],
})
const route = useRoute()
const projection = computed(() => route.query.audience === 'public'
  ? projectEncounterPresentation({
      source: gmProjection,
      policy: {
        audience: 'public',
        visibleParticipantIds: [actor.participantId, target.participantId],
      },
    })
  : gmProjection)
const presentationRuntime = useEncounterPresentationRuntime()
presentationRuntime.replaceSnapshotHistory([accepted])
const status = ref('No action selected')
const activate = (offer: EncounterActionOffer) => { status.value = `Activated ${offer.presentation.label}` }
const respond = (payload: { interaction: EncounterPendingInteractionAuthorizedView; decision: string; optionIds?: readonly string[] }) => {
  status.value = `Response ${payload.decision}: ${payload.optionIds?.join(', ') ?? 'none'}`
}
const replayAccepted = (): void => {
  presentationRuntime.ingest(accepted)
  status.value = `Accepted presentations: ${presentationRuntime.accepted.value.length}`
}
</script>

<template>
  <main class="preview-page">
    <h1>Encounter presentation contract preview</h1>
    <p data-testid="preview-status" aria-live="polite">{{ status }}</p>
    <button type="button" @click="replayAccepted">Replay accepted outcome</button>
    <div class="preview-stage">
      <EncounterVfxOverlay
        :presentations="presentationRuntime.activeVfxPresentations.value"
        :reduced-motion="presentationRuntime.reducedMotion.value"
      />
      <EncounterPresentationPanel
        :projection="projection"
        :accepted="presentationRuntime.accepted.value"
        selected-participant-id="actor:preview"
        @activate="activate"
        @respond="respond"
      />
    </div>
  </main>
</template>

<style scoped>
.preview-page { min-height: 100vh; margin: 0; background: #10131d; padding: 1rem; color: white; font-family: sans-serif; }
.preview-stage { position: relative; min-height: 46rem; border: 1px solid #363b4d; border-radius: 1rem; background: radial-gradient(circle at center, #252a3e, #121520); }
</style>

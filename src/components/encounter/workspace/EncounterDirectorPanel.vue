<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { EncounterWorkspaceViewModel } from '#shared/encounterWorkspace/model'
import type {
  EncounterPendingInteractionAuthorizedView,
  EncounterPendingRecoveryAction,
} from '#shared/encounterPresentation'
import type { SetFieldEffectPayload } from '#shared/livePlayCommands'
import { useMapItemExploration } from '~/composables/encounter/useMapItemExploration'
import type {
  EncounterDocumentClock,
  EncounterDocumentObjective,
  EncounterDocumentPhase,
  EncounterDocumentReserve,
  EncounterDocumentWave,
} from '#shared/encounterDocuments/model'

const props = withDefaults(defineProps<{
  workspace: EncounterWorkspaceViewModel
  open: boolean
  commandsBlocked?: boolean
  busy?: boolean
  error?: string | null
  lifecycleRecovery?: { readonly state: 'queued' | 'sending' | 'uncertain', readonly label: string } | null
}>(), {
  commandsBlocked: false,
  busy: false,
  error: null,
  lifecycleRecovery: null,
})

const exportHref = computed(() => `/api/encounter-documents/export?encounterId=${encodeURIComponent(props.workspace.source.encounterId)}`)

const emit = defineEmits<{
  (event: 'update:open', value: boolean): void
  (event: 'refresh'): void
  (event: 'openWorkshop'): void
  (event: 'initialize'): void
  (event: 'setParticipantVisibility', participantId: string, visibility: 'hidden' | 'revealed'): void
  (event: 'upsertReserve', reserve: EncounterDocumentReserve): void
  (event: 'removeReserve', reserveId: string): void
  (event: 'upsertWave', wave: EncounterDocumentWave): void
  (event: 'setWaveStatus', waveId: string, status: EncounterDocumentWave['status']): void
  (event: 'upsertObjective', objective: EncounterDocumentObjective): void
  (event: 'removeObjective', objectiveId: string): void
  (event: 'upsertClock', clock: EncounterDocumentClock): void
  (event: 'removeClock', clockId: string): void
  (event: 'upsertPhase', phase: EncounterDocumentPhase): void
  (event: 'activatePhase', phaseId: string): void
  (event: 'setStory', value: {
    name: string
    lifecycle: 'draft' | 'active' | 'paused' | 'completed' | 'archived'
    publicStakes: string | null
    gmStakes: string | null
    notes: string | null
  }): void
  (event: 'previousInitiative'): void
  (event: 'nextInitiative'): void
  (event: 'setScene', name: string | null): void
  (event: 'setFieldEffect', payload: SetFieldEffectPayload): void
  (event: 'clearFieldEffects'): void
  (event: 'dismissEffect', dismissalRef: string): void
  (event: 'finishEncounter'): void
  (event: 'retryLifecycle'): void
  (event: 'checkLifecycle'): void
  (event: 'recover', interactionId: string, action: EncounterPendingRecoveryAction['action']): void
  (event: 'correctItem', operationId: string): void
  (event: 'openHistory', presentationId: string): void
}>()

const mapExploration = useMapItemExploration({
  mapSlug: () => props.workspace.source.mapSlug,
  mapRevision: () => props.workspace.source.mapRevision,
  enabled: () => props.workspace.viewer.canUseDirector,
  commandsBlocked: () => props.commandsBlocked || props.busy,
  afterAccepted: async () => { emit('refresh') },
})

const tabs = ['overview', 'cast', 'story', 'system'] as const
type DirectorTab = typeof tabs[number]
const tabLabels: Readonly<Record<DirectorTab, string>> = Object.freeze({
  overview: 'Overview', cast: 'Cast', story: 'Story', system: 'System',
})
const activeTab = ref<DirectorTab>('overview')
const panel = ref<HTMLElement | null>(null)
const reserveId = ref('')
const reserveSheetKind = ref<'pokemon' | 'trainer'>('pokemon')
const reserveSheetSlug = ref('')
const reserveName = ref('')
const reserveSideId = ref('')
const waveId = ref('')
const waveLabel = ref('')
const waveParticipantIds = ref<string[]>([])
const objectiveId = ref('')
const objectiveLabel = ref('')
const objectiveVisibility = ref<'public' | 'gm'>('public')
const clockId = ref('')
const clockLabel = ref('')
const clockVisibility = ref<'public' | 'gm'>('public')
const clockMaximum = ref(4)
const phaseId = ref('')
const phaseLabel = ref('')
const phaseVisibility = ref<'public' | 'gm'>('public')
const phaseSummary = ref('')
const storyName = ref('')
const storyLifecycle = ref<'draft' | 'active' | 'paused' | 'completed' | 'archived'>('draft')
const publicStakes = ref('')
const gmStakes = ref('')
const directorNotes = ref('')
const sceneName = ref('')
const fieldCategory = ref<'weather' | 'terrain' | 'room'>('weather')
const fieldKind = ref<SetFieldEffectPayload['kind']>('rainy')
const fieldRounds = ref<number | null>(null)
const director = computed(() => props.workspace.director)
const activeEffects = computed(() => props.workspace.activeEffects ?? [])
const visibleParticipantCount = computed(() => props.workspace.participants.filter(participant => !participant.hidden).length)
const hiddenParticipantCount = computed(() => director.value?.hiddenParticipantIds.length ?? props.workspace.sides.reduce((total, side) => (
  total + (side.hiddenParticipantCount ?? 0)
), 0))
const activeObjectives = computed(() => props.workspace.objectives.filter(objective => objective.status === 'active'))
const activePending = computed(() => props.workspace.pending.filter(interaction => (
  interaction.status === 'pending' || interaction.status === 'resuming'
)))
const recoverablePending = computed<readonly EncounterPendingInteractionAuthorizedView[]>(() => props.workspace.pending.filter(
  (interaction): interaction is EncounterPendingInteractionAuthorizedView => (
    interaction.projection !== 'public' && interaction.recoveryActions.length > 0
  ),
))
const correctedAccepted = computed(() => props.workspace.accepted.filter(accepted => accepted.correction !== null))
const correctableItems = computed(() => props.workspace.accepted.filter(accepted => (
  accepted.source.sourceKind === 'item' && accepted.correction === null
)))
const fieldKinds = computed<readonly SetFieldEffectPayload['kind'][]>(() => {
  if (fieldCategory.value === 'weather') return ['sunny', 'rainy', 'hail', 'sandstorm']
  if (fieldCategory.value === 'terrain') return ['electric', 'grassy', 'misty', 'psychic']
  return ['magic', 'trick', 'wonder', 'gravity']
})
const unavailableDirectorConcepts = computed(() => props.workspace.mapBackedLimitations.map((value) => {
  if (value === 'objectives') return 'Objectives'
  if (value === 'phases') return 'Phases'
  if (value === 'stakes') return 'Stakes'
  if (value === 'notes') return 'Notes'
  return 'Waves'
}))
const commandDisabled = computed(() => props.commandsBlocked || props.busy || director.value === null)
const lifecycleDisabled = computed(() => props.commandsBlocked || props.busy || props.lifecycleRecovery !== null || !props.workspace.viewer.canUseDirector)

const close = (): void => emit('update:open', false)
const onKeydown = (event: KeyboardEvent): void => {
  if (event.key === 'Escape') {
    event.preventDefault()
    close()
  }
}
const chooseTab = (tab: DirectorTab): void => { activeTab.value = tab }
const submitReserve = (): void => {
  if (!reserveId.value.trim() || !reserveSheetSlug.value.trim() || !reserveName.value.trim()) return
  emit('upsertReserve', {
    reserveId: reserveId.value.trim(),
    sheetKind: reserveSheetKind.value,
    sheetSlug: reserveSheetSlug.value.trim(),
    displayName: reserveName.value.trim(),
    sideId: reserveSideId.value || null,
    ownerParticipantId: null,
    visibility: 'gm',
    status: 'ready',
    placementId: null,
  })
}
const toggleWaveParticipant = (participantId: string): void => {
  waveParticipantIds.value = waveParticipantIds.value.includes(participantId)
    ? waveParticipantIds.value.filter(id => id !== participantId)
    : [...waveParticipantIds.value, participantId]
}
const submitWave = (): void => {
  if (!waveId.value.trim() || !waveLabel.value.trim()) return
  emit('upsertWave', {
    waveId: waveId.value.trim(),
    label: waveLabel.value.trim(),
    status: 'planned',
    participantIds: [...waveParticipantIds.value],
    reserveIds: [],
    revealOnDeploy: true,
  })
}
const nextWaveStatus = (status: EncounterDocumentWave['status']): EncounterDocumentWave['status'] => {
  if (status === 'planned') return 'ready'
  if (status === 'ready') return 'deployed'
  return 'completed'
}
const submitObjective = (): void => {
  if (!objectiveId.value.trim() || !objectiveLabel.value.trim()) return
  emit('upsertObjective', {
    objectiveId: objectiveId.value.trim(), label: objectiveLabel.value.trim(), visibility: objectiveVisibility.value,
    status: 'active', progress: null, maximum: null,
  })
}
const submitClock = (): void => {
  if (!clockId.value.trim() || !clockLabel.value.trim()) return
  emit('upsertClock', {
    clockId: clockId.value.trim(), label: clockLabel.value.trim(), visibility: clockVisibility.value,
    status: 'active', progress: 0, maximum: Math.max(1, Math.min(100, Math.trunc(clockMaximum.value))),
  })
}
const submitPhase = (): void => {
  if (!phaseId.value.trim() || !phaseLabel.value.trim()) return
  emit('upsertPhase', {
    phaseId: phaseId.value.trim(), label: phaseLabel.value.trim(), visibility: phaseVisibility.value,
    status: 'upcoming', summary: phaseSummary.value.trim() || null,
  })
}
const submitStory = (): void => emit('setStory', {
  name: storyName.value.trim(),
  lifecycle: storyLifecycle.value,
  publicStakes: publicStakes.value.trim() || null,
  gmStakes: gmStakes.value.trim() || null,
  notes: directorNotes.value.trim() || null,
})
const submitScene = (): void => emit('setScene', sceneName.value.trim() || null)
const submitFieldEffect = (): void => emit('setFieldEffect', {
  category: fieldCategory.value,
  kind: fieldKind.value,
  rounds: fieldRounds.value === null ? null : Math.max(1, Math.min(100, Math.trunc(fieldRounds.value))),
  ...(fieldCategory.value === 'weather' ? { weatherMode: 'replace' as const } : {}),
  ...(fieldCategory.value === 'terrain' ? { terrainScope: 'field' as const } : {}),
})
const dismissEffect = (dismissalRef: string | null): void => {
  if (!dismissalRef || lifecycleDisabled.value) return
  emit('dismissEffect', dismissalRef)
}
const openFinishEncounter = (): void => {
  if (lifecycleDisabled.value) return
  emit('finishEncounter')
}

watch(fieldCategory, () => { fieldKind.value = fieldKinds.value[0]! })
watch(() => mapExploration.decisions.value.length, (count, previous = 0) => {
  if (count <= 0) return
  activeTab.value = 'system'
  if (previous === 0 && !props.open) emit('update:open', true)
})
watch(() => props.open, async (open) => {
  if (!open) return
  await nextTick()
  panel.value?.focus({ preventScroll: true })
})
watch(() => director.value?.encounterRevision, () => {
  if (!director.value) return
  storyName.value = director.value.name
  storyLifecycle.value = director.value.lifecycle
  publicStakes.value = director.value.stakes.public ?? ''
  gmStakes.value = director.value.stakes.gm ?? ''
  directorNotes.value = director.value.notes ?? ''
  sceneName.value = props.workspace.scene.name ?? ''
}, { immediate: true })
watch(() => props.busy, (busy, prior) => {
  if (prior && !busy && !props.error) {
    reserveId.value = ''
    reserveSheetSlug.value = ''
    reserveName.value = ''
    waveId.value = ''
    waveLabel.value = ''
    waveParticipantIds.value = []
  }
})
</script>

<template>
  <Transition name="encounter-director">
    <aside
      v-if="open"
      ref="panel"
      class="encounter-director rt-surface"
      aria-labelledby="encounter-director-heading"
      tabindex="-1"
      @keydown="onKeydown"
    >
      <header class="encounter-director__header">
        <div>
          <p class="encounter-director__eyebrow">GM only</p>
          <h2 id="encounter-director-heading">Director</h2>
          <p>Stage the encounter without mixing table controls into player actions.</p>
        </div>
        <button type="button" class="encounter-director__close" aria-label="Close Director" @click="close">×</button>
      </header>

      <div class="encounter-director__status" role="status">
        <span>{{ workspace.scene.active ? (workspace.scene.name || 'Active scene') : 'Scene not started' }}</span>
        <span>Round {{ workspace.turn.round }}</span>
        <span>Map revision {{ workspace.source.mapRevision }}</span>
        <span v-if="workspace.source.encounterRevision !== null">Encounter revision {{ workspace.source.encounterRevision }}</span>
      </div>
      <p v-if="error" class="encounter-director__error" role="alert">{{ error }}</p>

      <div class="encounter-director__tabs" role="tablist" aria-label="Director sections">
        <button
          v-for="tab in tabs"
          :id="`director-tab-${tab}`"
          :key="tab"
          type="button"
          role="tab"
          :aria-selected="activeTab === tab"
          :aria-controls="`director-panel-${tab}`"
          :tabindex="activeTab === tab ? 0 : -1"
          @click="chooseTab(tab)"
        >
          {{ tabLabels[tab] }}
        </button>
      </div>

      <section
        v-if="activeTab === 'overview'"
        id="director-panel-overview"
        role="tabpanel"
        aria-labelledby="director-tab-overview"
        class="encounter-director__section"
      >
        <h3>Encounter at a glance</h3>
        <div v-if="!director" class="encounter-director__limitations">
          <h4>Enable encounter authoring</h4>
          <p>Create a revisioned encounter record for hidden cast, waves, objectives, phases, stakes, and notes. Battlefield mechanics remain map-owned.</p>
          <button type="button" :disabled="commandsBlocked || busy" @click="emit('initialize')">Enable Director authoring</button>
        </div>
        <dl class="encounter-director__metrics">
          <div><dt>Visible cast</dt><dd>{{ visibleParticipantCount }}</dd></div>
          <div><dt>Hidden cast</dt><dd>{{ hiddenParticipantCount }}</dd></div>
          <div><dt>Waiting decisions</dt><dd>{{ activePending.length }}</dd></div>
          <div><dt>Active objectives</dt><dd>{{ activeObjectives.length }}</dd></div>
        </dl>
        <p v-if="commandsBlocked" class="encounter-director__warning">Director commands wait until authority reconnects.</p>
      </section>

      <section
        v-else-if="activeTab === 'cast'"
        id="director-panel-cast"
        role="tabpanel"
        aria-labelledby="director-tab-cast"
        class="encounter-director__section"
      >
        <h3>Cast and sides</h3>
        <article v-for="participant in workspace.participants" :key="participant.participantId" class="encounter-director__row encounter-director__row--action">
          <span aria-hidden="true">{{ participant.side?.symbol ?? '◇' }}</span>
          <div>
            <strong>{{ participant.displayName }}</strong>
            <p>{{ participant.side?.label ?? 'Unaligned' }} · {{ participant.hidden ? 'Hidden from players' : 'Revealed' }}</p>
          </div>
          <button
            type="button"
            :disabled="commandDisabled"
            :aria-label="`${participant.hidden ? 'Reveal' : 'Hide'} ${participant.displayName}`"
            @click="emit('setParticipantVisibility', participant.participantId, participant.hidden ? 'revealed' : 'hidden')"
          >
            {{ participant.hidden ? 'Reveal' : 'Hide' }}
          </button>
        </article>
        <p v-if="workspace.participants.length === 0" class="encounter-director__empty">No battlefield participants are configured.</p>

        <template v-if="director">
          <div class="encounter-director__subhead"><h4>Reserves</h4><span>{{ director.reserves.length }}</span></div>
          <article v-for="reserve in director.reserves" :key="reserve.reserveId" class="encounter-director__row encounter-director__row--action">
            <span aria-hidden="true">○</span>
            <div><strong>{{ reserve.displayName }}</strong><p>{{ reserve.status }} · {{ reserve.visibility }}</p></div>
            <button type="button" :disabled="commandDisabled" :aria-label="`Remove reserve ${reserve.displayName}`" @click="emit('removeReserve', reserve.reserveId)">Remove</button>
          </article>
          <details class="encounter-director__editor">
            <summary>Add reserve reference</summary>
            <form @submit.prevent="submitReserve">
              <label>Reserve ID<input v-model="reserveId" required autocomplete="off" placeholder="reserve-claydol"></label>
              <label>Kind<select v-model="reserveSheetKind"><option value="pokemon">Pokémon</option><option value="trainer">Trainer</option></select></label>
              <label>Sheet slug<input v-model="reserveSheetSlug" required autocomplete="off"></label>
              <label>Display name<input v-model="reserveName" required autocomplete="off"></label>
              <label>Side<select v-model="reserveSideId"><option value="">Unaligned</option><option v-for="side in workspace.sides" :key="side.sideId" :value="side.sideId">{{ side.label }}</option></select></label>
              <button type="submit" :disabled="commandDisabled">Add reserve</button>
            </form>
          </details>

          <div class="encounter-director__subhead"><h4>Waves</h4><span>{{ director.waves.length }}</span></div>
          <article v-for="wave in director.waves" :key="wave.waveId" class="encounter-director__wave">
            <div><strong>{{ wave.label }}</strong><p>{{ wave.status }} · {{ wave.participantIds.length + wave.reserveIds.length }} members</p></div>
            <button v-if="wave.status !== 'completed'" type="button" :disabled="commandDisabled" @click="emit('setWaveStatus', wave.waveId, nextWaveStatus(wave.status))">
              {{ wave.status === 'ready' ? 'Deploy and reveal' : wave.status === 'planned' ? 'Mark ready' : 'Complete' }}
            </button>
          </article>
          <details class="encounter-director__editor">
            <summary>Create participant wave</summary>
            <form @submit.prevent="submitWave">
              <label>Wave ID<input v-model="waveId" required autocomplete="off" placeholder="wave-reinforcements"></label>
              <label>Label<input v-model="waveLabel" required autocomplete="off" placeholder="Reinforcements"></label>
              <fieldset>
                <legend>Pre-staged participants</legend>
                <label v-for="participant in workspace.participants" :key="participant.participantId" class="encounter-director__check">
                  <input type="checkbox" :checked="waveParticipantIds.includes(participant.participantId)" @change="toggleWaveParticipant(participant.participantId)">
                  {{ participant.displayName }}<span v-if="participant.hidden"> · hidden</span>
                </label>
              </fieldset>
              <button type="submit" :disabled="commandDisabled">Create wave</button>
            </form>
          </details>
        </template>
      </section>

      <section
        v-else-if="activeTab === 'story'"
        id="director-panel-story"
        role="tabpanel"
        aria-labelledby="director-tab-story"
        class="encounter-director__section"
      >
        <h3>Story state</h3>
        <div v-if="!director" class="encounter-director__limitations">
          <h4>Awaiting encounter authoring</h4>
          <p>{{ unavailableDirectorConcepts.join(', ') }}</p>
          <button type="button" :disabled="commandsBlocked || busy" @click="emit('initialize')">Enable Director authoring</button>
        </div>
        <template v-else>
          <form class="encounter-director__story" @submit.prevent="submitStory">
            <label>Encounter name<input v-model="storyName" required maxlength="200"></label>
            <label>Lifecycle<select v-model="storyLifecycle"><option value="draft">Draft</option><option value="active">Active</option><option value="paused">Paused</option><option value="completed">Completed</option><option value="archived">Archived</option></select></label>
            <label>Public stakes<textarea v-model="publicStakes" maxlength="4000" rows="2" placeholder="What everyone knows is at risk"></textarea></label>
            <label>GM stakes<textarea v-model="gmStakes" maxlength="4000" rows="2" placeholder="Private consequences or escalation"></textarea></label>
            <label>GM notes<textarea v-model="directorNotes" maxlength="20000" rows="4" placeholder="Private encounter notes"></textarea></label>
            <button type="submit" :disabled="commandDisabled || !storyName.trim()">Save story state</button>
          </form>

          <div class="encounter-director__subhead"><h4>Objectives</h4><span>{{ director.objectives.length }}</span></div>
          <article v-for="objective in director.objectives" :key="objective.objectiveId" class="encounter-director__row encounter-director__row--action">
            <span aria-hidden="true">◇</span>
            <div><strong>{{ objective.label }}</strong><p>{{ objective.status }} · {{ objective.visibility }}</p></div>
            <div class="encounter-director__mini-actions">
              <button v-if="objective.status === 'active'" type="button" :disabled="commandDisabled" @click="emit('upsertObjective', { ...objective, status: 'completed' })">Complete</button>
              <button type="button" :disabled="commandDisabled" :aria-label="`Remove objective ${objective.label}`" @click="emit('removeObjective', objective.objectiveId)">Remove</button>
            </div>
          </article>
          <details class="encounter-director__editor">
            <summary>Add objective</summary>
            <form @submit.prevent="submitObjective">
              <label>Objective ID<input v-model="objectiveId" required autocomplete="off" placeholder="objective-escape"></label>
              <label>Label<input v-model="objectiveLabel" required maxlength="200"></label>
              <label>Visibility<select v-model="objectiveVisibility"><option value="public">Public</option><option value="gm">GM only</option></select></label>
              <button type="submit" :disabled="commandDisabled">Add objective</button>
            </form>
          </details>

          <div class="encounter-director__subhead"><h4>Clocks</h4><span>{{ director.clocks.length }}</span></div>
          <article v-for="clock in director.clocks" :key="clock.clockId" class="encounter-director__clock">
            <div><strong>{{ clock.label }}</strong><span>{{ clock.progress }}/{{ clock.maximum }} · {{ clock.status }} · {{ clock.visibility }}</span></div>
            <progress :value="clock.progress" :max="clock.maximum">{{ clock.progress }} of {{ clock.maximum }}</progress>
            <div class="encounter-director__mini-actions">
              <button type="button" :disabled="commandDisabled || clock.progress === 0" @click="emit('upsertClock', { ...clock, progress: Math.max(0, clock.progress - 1), status: 'active' })">−</button>
              <button type="button" :disabled="commandDisabled || clock.progress >= clock.maximum" @click="emit('upsertClock', { ...clock, progress: Math.min(clock.maximum, clock.progress + 1), status: clock.progress + 1 >= clock.maximum ? 'completed' : 'active' })">+</button>
              <button type="button" :disabled="commandDisabled" :aria-label="`Remove clock ${clock.label}`" @click="emit('removeClock', clock.clockId)">Remove</button>
            </div>
          </article>
          <details class="encounter-director__editor">
            <summary>Add clock</summary>
            <form @submit.prevent="submitClock">
              <label>Clock ID<input v-model="clockId" required autocomplete="off" placeholder="clock-gate"></label>
              <label>Label<input v-model="clockLabel" required maxlength="200"></label>
              <label>Segments<input v-model.number="clockMaximum" type="number" min="1" max="100" required></label>
              <label>Visibility<select v-model="clockVisibility"><option value="public">Public</option><option value="gm">GM only</option></select></label>
              <button type="submit" :disabled="commandDisabled">Add clock</button>
            </form>
          </details>

          <div class="encounter-director__subhead"><h4>Phases</h4><span>{{ director.phases.length }}</span></div>
          <article v-for="phase in director.phases" :key="phase.phaseId" class="encounter-director__row encounter-director__row--action">
            <span aria-hidden="true">▸</span>
            <div><strong>{{ phase.label }}</strong><p>{{ phase.status }} · {{ phase.visibility }}<template v-if="phase.summary"> · {{ phase.summary }}</template></p></div>
            <button v-if="phase.status !== 'active'" type="button" :disabled="commandDisabled" @click="emit('activatePhase', phase.phaseId)">Activate</button>
          </article>
          <details class="encounter-director__editor">
            <summary>Add phase</summary>
            <form @submit.prevent="submitPhase">
              <label>Phase ID<input v-model="phaseId" required autocomplete="off" placeholder="phase-overclock"></label>
              <label>Label<input v-model="phaseLabel" required maxlength="200"></label>
              <label>Summary<textarea v-model="phaseSummary" maxlength="4000" rows="2"></textarea></label>
              <label>Visibility<select v-model="phaseVisibility"><option value="public">Public</option><option value="gm">GM only</option></select></label>
              <button type="submit" :disabled="commandDisabled">Add phase</button>
            </form>
          </details>
        </template>
      </section>

      <section
        v-else
        id="director-panel-system"
        role="tabpanel"
        aria-labelledby="director-tab-system"
        class="encounter-director__section"
      >
        <h3>Live controls and recovery</h3>

        <EncounterDirectRepelDecision
          :decisions="mapExploration.decisions.value"
          :status="mapExploration.status.value"
          :message="mapExploration.message.value"
          :busy="mapExploration.busy.value"
          :commands-blocked="commandsBlocked || busy"
          @settle="mapExploration.settle"
          @retry-exact="mapExploration.retryExact"
          @refresh="mapExploration.load"
          @dismiss="mapExploration.dismiss"
        />

        <section v-if="lifecycleRecovery" class="encounter-director__lifecycle-recovery" aria-labelledby="encounter-lifecycle-recovery-heading">
          <h4 id="encounter-lifecycle-recovery-heading">Encounter cleanup recovery</h4>
          <p>{{ lifecycleRecovery.label }} is {{ lifecycleRecovery.state }}. Check the server or retry the exact journaled command before issuing another lifecycle command.</p>
          <div class="encounter-director__mini-actions">
            <button type="button" :disabled="busy" @click="emit('checkLifecycle')">Check server</button>
            <button type="button" :disabled="busy || lifecycleRecovery.state === 'sending'" @click="emit('retryLifecycle')">Retry exact command</button>
          </div>
        </section>

        <div class="encounter-director__subhead"><h4>Active effects</h4><span>{{ activeEffects.length }}</span></div>
        <div v-if="activeEffects.length" class="encounter-director__effects" aria-label="Authoritative active effects">
          <article v-for="effect in activeEffects" :key="effect.effectRef" class="encounter-director__effect">
            <div class="encounter-director__effect-copy">
              <strong>{{ effect.label }}</strong>
              <p>Affected: {{ effect.affectedLabel }} <span aria-hidden="true">·</span> Source: {{ effect.sourceLabel }}</p>
              <p class="encounter-director__duration"><span aria-hidden="true">⌛</span>{{ effect.durationLabel }}</p>
            </div>
            <button
              v-if="effect.dismissible && effect.dismissalRef"
              type="button"
              :disabled="lifecycleDisabled"
              :aria-label="`Dismiss ${effect.label} from ${effect.affectedLabel}`"
              @click="dismissEffect(effect.dismissalRef)"
            >Dismiss effect</button>
          </article>
        </div>
        <p v-else class="encounter-director__empty">No active duration effects.</p>

        <div class="encounter-director__subhead"><h4>Encounter boundary</h4></div>
        <section class="encounter-director__encounter-boundary" aria-labelledby="encounter-finish-heading">
          <h5 id="encounter-finish-heading">Settle the complete encounter</h5>
          <p id="encounter-finish-consequences">Review persistent consequences, rewards, outcomes, and temporary cleanup together before one atomic commit.</p>
          <button
            type="button"
            class="encounter-director__finish rt-control"
            :disabled="lifecycleDisabled"
            aria-describedby="encounter-finish-consequences"
            @click="openFinishEncounter"
          >Finish Encounter</button>
        </section>

        <div class="encounter-director__subhead"><h4>Initiative</h4><span>Round {{ workspace.turn.round }}</span></div>
        <div class="encounter-director__actions" role="group" aria-label="Director initiative controls">
          <button type="button" :disabled="commandsBlocked || busy" @click="emit('previousInitiative')">Previous turn</button>
          <button type="button" :disabled="commandsBlocked || busy" @click="emit('nextInitiative')">Next turn</button>
        </div>

        <div class="encounter-director__subhead"><h4>Scene</h4><span>{{ workspace.scene.active ? 'Active' : 'Ended' }}</span></div>
        <form class="encounter-director__inline-form" @submit.prevent="submitScene">
          <label>Scene name<input v-model="sceneName" maxlength="200" placeholder="Moonlit rooftop"></label>
          <button type="submit" :disabled="commandsBlocked || busy">{{ sceneName.trim() ? 'Start or rename' : 'End scene' }}</button>
        </form>

        <div class="encounter-director__subhead"><h4>Field</h4><span>{{ workspace.environment.length }} effects</span></div>
        <form class="encounter-director__inline-form" @submit.prevent="submitFieldEffect">
          <label>Category<select v-model="fieldCategory"><option value="weather">Weather</option><option value="terrain">Terrain</option><option value="room">Room</option></select></label>
          <label>Effect<select v-model="fieldKind"><option v-for="kind in fieldKinds" :key="kind" :value="kind">{{ kind }}</option></select></label>
          <label>Rounds<input v-model.number="fieldRounds" type="number" min="1" max="100" placeholder="Sustained"></label>
          <button type="submit" :disabled="commandsBlocked || busy">Set field effect</button>
          <button type="button" :disabled="commandsBlocked || busy || workspace.environment.length === 0" @click="emit('clearFieldEffects')">Clear all field effects</button>
        </form>

        <div class="encounter-director__subhead"><h4>Sides</h4><span>{{ workspace.sides.length }}</span></div>
        <p class="encounter-director__empty">Side creation and reassignment change battlefield setup and remain in the Workshop.</p>
        <button type="button" @click="emit('openWorkshop')">Edit sides in Battlefield Workshop</button>

        <template v-if="recoverablePending.length">
          <div class="encounter-director__subhead"><h4>Pending recovery</h4><span>{{ recoverablePending.length }}</span></div>
          <article v-for="interaction in recoverablePending" :key="interaction.interactionId" class="encounter-director__recovery">
            <strong>{{ interaction.prompt }}</strong>
            <div class="encounter-director__mini-actions">
              <button
                v-for="action in interaction.recoveryActions"
                :key="action.actionId"
                type="button"
                :disabled="commandsBlocked || busy || !action.enabled"
                :title="action.unavailableReason?.label ?? undefined"
                @click="emit('recover', interaction.interactionId, action.action)"
              >{{ action.label }}</button>
            </div>
          </article>
        </template>

        <template v-if="correctableItems.length">
          <div class="encounter-director__subhead"><h4>Item correction</h4><span>{{ correctableItems.length }}</span></div>
          <article v-for="accepted in correctableItems" :key="accepted.presentationId" class="encounter-director__recovery">
            <div>
              <strong>{{ accepted.headline.label }}</strong>
              <p>Restore the consumed item and reverse the receipt only if every affected resource is unchanged.</p>
            </div>
            <button
              type="button"
              :disabled="commandsBlocked || busy"
              @click="emit('correctItem', accepted.operationId)"
            >Correct item use</button>
          </article>
        </template>

        <template v-if="correctedAccepted.length">
          <div class="encounter-director__subhead"><h4>Corrections</h4><span>{{ correctedAccepted.length }}</span></div>
          <button v-for="accepted in correctedAccepted" :key="accepted.presentationId" type="button" @click="emit('openHistory', accepted.presentationId)">
            Inspect {{ accepted.headline.label }}
          </button>
        </template>

        <dl class="encounter-director__system">
          <div><dt>Connection</dt><dd>{{ workspace.system.connection }}</dd></div>
          <div><dt>Replay gap</dt><dd>{{ workspace.system.replayGap ? 'Refresh required' : 'Clear' }}</dd></div>
          <div><dt>Commands</dt><dd>{{ workspace.system.commandsBlocked ? 'Paused' : 'Ready' }}</dd></div>
        </dl>
        <div class="encounter-director__actions">
          <button type="button" @click="emit('refresh')">Refresh authority</button>
          <a v-if="workspace.source.encounterRevision !== null" :href="exportHref" download>Export encounter backup</a>
          <button type="button" @click="emit('openWorkshop')">Open Battlefield Workshop</button>
        </div>
      </section>
    </aside>
  </Transition>
</template>

<style scoped>
.encounter-director {
  position: fixed;
  z-index: 74;
  inset: var(--rt-space-4) var(--rt-space-4) var(--rt-space-4) auto;
  width: min(29rem, calc(100vw - 2 * var(--rt-space-4)));
  overflow: auto;
  padding: var(--rt-space-4);
  background: var(--rt-surface-1);
  border: 1px solid var(--rt-rule);
  box-shadow: var(--rt-elevation-5);
}
.encounter-director__header { display: flex; justify-content: space-between; gap: var(--rt-space-4); }
.encounter-director__eyebrow { margin: 0; color: var(--rt-pending); font-size: var(--rt-type-label-sm-size); font-weight: 800; text-transform: uppercase; letter-spacing: .08em; }
.encounter-director h2, .encounter-director h3, .encounter-director h4 { margin: 0; }
.encounter-director__header p:not(.encounter-director__eyebrow) { margin: .35rem 0 0; color: var(--rt-text-muted); }
.encounter-director__close { min-width: var(--rt-touch-minimum); min-height: var(--rt-touch-minimum); font-size: 1.5rem; }
.encounter-director__status { display: flex; flex-wrap: wrap; gap: .4rem 1rem; margin: var(--rt-space-4) 0; padding: .65rem .8rem; border-block: 1px solid var(--rt-rule); font-size: var(--rt-type-label-sm-size); }
.encounter-director__tabs { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: .25rem; }
.encounter-director__tabs button { min-height: var(--rt-touch-minimum); padding: .4rem; }
.encounter-director__tabs button[aria-selected="true"] { color: var(--rt-focus); border-color: var(--rt-focus); background: var(--rt-surface-2); }
.encounter-director__section { display: grid; gap: var(--rt-space-4); padding-block: var(--rt-space-4); }
.encounter-director__metrics { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .6rem; margin: 0; }
.encounter-director__metrics div, .encounter-director__system div { padding: .75rem; background: var(--rt-surface-2); border: 1px solid var(--rt-rule); }
.encounter-director__metrics dt, .encounter-director__system dt { color: var(--rt-text-muted); font-size: var(--rt-type-label-sm-size); }
.encounter-director__metrics dd { margin: .2rem 0 0; font-family: var(--rt-font-numeric); font-size: 1.4rem; }
.encounter-director__system { display: grid; gap: .5rem; margin: 0; }
.encounter-director__system div { display: flex; justify-content: space-between; gap: 1rem; }
.encounter-director__system dd { margin: 0; }
.encounter-director__row { display: grid; grid-template-columns: auto 1fr; gap: .65rem; align-items: start; padding: .7rem; border-block-end: 1px solid var(--rt-rule); }
.encounter-director__row--action { grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; }
.encounter-director__row p, .encounter-director__wave p, .encounter-director__empty { margin: .2rem 0 0; color: var(--rt-text-muted); }
.encounter-director__subhead { display: flex; align-items: center; justify-content: space-between; padding-top: .5rem; border-top: 1px solid var(--rt-rule); }
.encounter-director__wave { display: flex; align-items: center; justify-content: space-between; gap: .75rem; padding: .7rem; background: var(--rt-surface-2); border-inline-start: 3px solid var(--rt-pending); }
.encounter-director__editor { padding: .7rem; border: 1px solid var(--rt-rule); background: var(--rt-surface-2); }
.encounter-director__editor summary { cursor: pointer; font-weight: 800; }
.encounter-director__editor form { display: grid; gap: .65rem; padding-top: .75rem; }
.encounter-director__editor label:not(.encounter-director__check) { display: grid; gap: .25rem; color: var(--rt-text-muted); font-size: var(--rt-type-label-sm-size); }
.encounter-director__editor input:not([type='checkbox']), .encounter-director__editor select, .encounter-director__story input, .encounter-director__story select, .encounter-director__story textarea { min-height: var(--rt-touch-minimum); width: 100%; padding: .45rem; border: 1px solid var(--rt-rule); border-radius: var(--rt-radius-small); background: var(--rt-bg-canvas); color: var(--rt-text); font: inherit; }
.encounter-director__story, .encounter-director__inline-form { display: grid; gap: .65rem; padding: .75rem; border: 1px solid var(--rt-rule); background: var(--rt-surface-2); }
.encounter-director__story label, .encounter-director__inline-form label { display: grid; gap: .25rem; color: var(--rt-text-muted); font-size: var(--rt-type-label-sm-size); }
.encounter-director__inline-form input, .encounter-director__inline-form select { min-height: var(--rt-touch-minimum); width: 100%; padding: .45rem; border: 1px solid var(--rt-rule); border-radius: var(--rt-radius-small); background: var(--rt-bg-canvas); color: var(--rt-text); font: inherit; }
.encounter-director__lifecycle-recovery { display: grid; gap: var(--rt-space-2); padding: var(--rt-space-3); border-inline-start: 3px solid var(--rt-pending); background: var(--rt-surface-2); }
.encounter-director__lifecycle-recovery p { margin: 0; }
.encounter-director__effects { display: grid; gap: var(--rt-space-2); }
.encounter-director__effect { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: var(--rt-space-3); padding: .75rem; border-inline-start: 3px solid var(--rt-pending); background: var(--rt-surface-2); }
.encounter-director__effect-copy { min-width: 0; }
.encounter-director__effect p { margin: .2rem 0 0; color: var(--rt-text-muted); font-size: var(--rt-type-body-sm-size); overflow-wrap: anywhere; }
.encounter-director__effect .encounter-director__duration { display: flex; align-items: center; gap: .35rem; color: var(--rt-pending); font-weight: 700; }
.encounter-director__effect button { min-height: var(--rt-touch-minimum); }
.encounter-director__encounter-boundary { display: grid; gap: var(--rt-space-3); padding: var(--rt-space-3); border: 1px solid var(--rt-rule); border-left: 3px solid var(--rt-focus); background: var(--rt-surface-2); }
.encounter-director__encounter-boundary h5 { margin: 0; color: var(--rt-text-strong); font-size: var(--rt-type-body-md-size); }
.encounter-director__encounter-boundary p { margin: 0; color: var(--rt-text-muted); line-height: 1.5; }
.encounter-director__finish { width: 100%; min-height: var(--rt-touch-minimum); justify-content: center; border-color: var(--rt-focus); background: color-mix(in srgb, var(--rt-focus) 10%, var(--rt-surface-2)); color: var(--rt-text-strong); font-weight: 800; }
.encounter-director__recovery { display: grid; gap: .5rem; padding: .7rem; border-inline-start: 3px solid var(--rt-danger); background: var(--rt-surface-2); }
.encounter-director__clock { display: grid; gap: .4rem; padding: .7rem; border-inline-start: 3px solid var(--rt-pending); background: var(--rt-surface-2); }
.encounter-director__clock > div:first-child { display: flex; justify-content: space-between; gap: 1rem; }
.encounter-director__clock progress { width: 100%; }
.encounter-director__mini-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: .3rem; }
.encounter-director__editor fieldset { display: grid; gap: .35rem; margin: 0; padding: .65rem; border: 1px solid var(--rt-rule); }
.encounter-director__check { display: flex; gap: .5rem; align-items: center; min-height: 2rem; }
.encounter-director__error { padding: .65rem; border-inline-start: 3px solid var(--rt-danger); background: color-mix(in srgb, var(--rt-danger) 10%, var(--rt-surface-1)); }
.encounter-director__limitations { padding: .8rem; border-inline-start: 3px solid var(--rt-pending); background: var(--rt-surface-2); }
.encounter-director__limitations p { margin: .35rem 0 0; }
.encounter-director__warning { color: var(--rt-pending); }
.encounter-director__actions { display: flex; flex-wrap: wrap; gap: .5rem; }
.encounter-director__actions a { min-height: var(--rt-touch-minimum); display: inline-flex; align-items: center; padding: .45rem .7rem; border: 1px solid var(--rt-rule); border-radius: var(--rt-radius-small); color: var(--rt-text-strong); background: var(--rt-surface-2); font-weight: 700; text-decoration: none; }
.encounter-director-enter-active, .encounter-director-leave-active { transition: transform var(--rt-motion-focus) var(--rt-ease-standard), opacity var(--rt-motion-focus) var(--rt-ease-standard); }
.encounter-director-enter-from, .encounter-director-leave-to { transform: translateX(1rem); opacity: 0; }
@media (max-width: 42rem) {
  .encounter-director { inset: 0; width: 100%; border: 0; border-radius: 0; }
  .encounter-director__tabs { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .encounter-director__effect { grid-template-columns: 1fr; }
  .encounter-director__effect button { width: 100%; }
}
@media (prefers-reduced-motion: reduce) {
  .encounter-director-enter-active, .encounter-director-leave-active { transition: none; }
}
</style>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import type {
  CancelSkillCheckCommandV1,
  RequestSkillCheckCommandV1,
  ResolveSkillCheckCommandV1,
  SkillCheckDocumentV1,
  SkillCheckDcPresetId,
} from '#shared/skillChecks/contract'
import type { TrainerSkillKey } from '~/types/trainerSheet'
import {
  parseLoadGmSkillChecksResponse,
  parseManageGmSkillCheckResponse,
  type LoadGmSkillChecksResponseV1,
  type SkillCheckGmSubjectOptionV1,
} from '#shared/skillChecks/gmWorkflow'
import { useApiClient } from '~/composables/useApiClient'
import { SKILL_CHECK_API_PATHS } from '~/utils/apiRoutes'

const props = withDefaults(defineProps<{
  commandsBlocked?: boolean
}>(), { commandsBlocked: false })

const api = useApiClient()
const authority = ref<LoadGmSkillChecksResponseV1 | null>(null)
const loading = ref(false)
const mutating = ref(false)
const error = ref<string | null>(null)
const announcement = ref('')
const statusRegion = ref<HTMLElement | null>(null)
const subjectFilter = ref('')
const selectedSubjects = ref<Record<string, boolean>>({})
const selectedSkills = ref<Record<string, TrainerSkillKey>>({})
const publicLabel = ref('')
const prompt = ref('')
const gmNotes = ref('')
const comparisonKind = ref<'dc' | 'opposed'>('dc')
const difficultyChoice = ref('skill-check-dc-preset:v1:challenging')
const explicitDifficultyClass = ref(10)
const concealment = ref<'public' | 'gm-only' | 'subjects-after-acceptance'>('subjects-after-acceptance')
const visibility = ref<'public-results' | 'participants-results' | 'gm-only-results'>('public-results')
const situationalModifier = ref(0)
const expiryMinutes = ref<'none' | '5' | '10' | '30'>('10')
const cancelTargetId = ref<string | null>(null)
const cancelReason = ref('')
const activeCheckLimit = ref(20)
let cancelOrigin: HTMLElement | null = null
const uncertainCommand = ref<RequestSkillCheckCommandV1 | CancelSkillCheckCommandV1 | ResolveSkillCheckCommandV1 | null>(null)
const now = ref(Date.now())
let refreshTimer: ReturnType<typeof setInterval> | null = null
let clockTimer: ReturnType<typeof setInterval> | null = null

const subjectKey = (subject: Pick<SkillCheckGmSubjectOptionV1, 'kind' | 'sheetSlug'>): string => (
  `${subject.kind}:${subject.sheetSlug}`
)
const titleCase = (value: string): string => value
  .split('-')
  .map(part => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
  .join(' ')

const activeChecks = computed(() => (authority.value?.checks ?? []).filter(check => (
  check.state === 'pending' || check.state === 'ready'
)))
const visibleActiveChecks = computed(() => activeChecks.value.slice(0, activeCheckLimit.value))
const completedChecks = computed(() => (authority.value?.checks ?? []).filter(check => (
  check.state !== 'pending' && check.state !== 'ready'
)).slice(0, 20))
const visibleSubjects = computed(() => {
  const needle = subjectFilter.value.trim().toLocaleLowerCase()
  const subjects = authority.value?.subjects ?? []
  if (!needle) return subjects.slice(0, 100)
  return subjects.filter(subject => (
    subject.label.toLocaleLowerCase().includes(needle)
    || subject.sheetSlug.toLocaleLowerCase().includes(needle)
    || subject.kind.includes(needle)
  )).slice(0, 100)
})
const chosenSubjects = computed(() => (authority.value?.subjects ?? []).filter(subject => (
  selectedSubjects.value[subjectKey(subject)] === true
)))
const formUnavailableReason = computed(() => {
  if (props.commandsBlocked) return 'Commands are paused while authority reconnects.'
  if (mutating.value) return 'A Skill Check command is already being sent.'
  if (uncertainCommand.value) return 'Retry or refresh the uncertain command before issuing another.'
  if (!publicLabel.value.trim()) return 'Add a public label.'
  if (!prompt.value.trim()) return 'Add a prompt for the subjects.'
  if (chosenSubjects.value.length === 0) return 'Choose at least one subject.'
  if (chosenSubjects.value.length > 32) return 'Choose no more than 32 subjects.'
  if (comparisonKind.value === 'opposed' && chosenSubjects.value.length !== 2) return 'Opposed checks require exactly two subjects.'
  if (chosenSubjects.value.some(subject => !selectedSkills.value[subjectKey(subject)])) return 'Choose a skill for every subject.'
  if (!Number.isSafeInteger(situationalModifier.value) || situationalModifier.value < -20 || situationalModifier.value > 20) {
    return 'Situational modifier must be an integer from −20 through 20.'
  }
  if (comparisonKind.value === 'dc' && difficultyChoice.value === 'explicit'
    && (!Number.isSafeInteger(explicitDifficultyClass.value) || explicitDifficultyClass.value < 1 || explicitDifficultyClass.value > 100)) {
    return 'Explicit DC must be an integer from 1 through 100.'
  }
  return null
})

const operationId = (): `skill-check-op:v1:${string}` => {
  if (!globalThis.crypto?.randomUUID) throw new Error('Secure operation identity is unavailable in this browser.')
  return `skill-check-op:v1:${globalThis.crypto.randomUUID().toLowerCase()}`
}
const newCheckId = (): `skill-check:v1:${string}` => {
  if (!globalThis.crypto?.randomUUID) throw new Error('Secure check identity is unavailable in this browser.')
  return `skill-check:v1:${globalThis.crypto.randomUUID().toLowerCase()}`
}
const newSubjectId = (seed: string, index: number): `skill-check-subject:v1:${string}` => (
  `skill-check-subject:v1:subject-${seed.slice(0, 24)}-${index}`
)

const errorMessage = (candidate: unknown): string => {
  if (candidate && typeof candidate === 'object') {
    const data = (candidate as { data?: unknown }).data
    if (data && typeof data === 'object' && typeof (data as { message?: unknown }).message === 'string') {
      return (data as { message: string }).message
    }
    if (typeof (candidate as { message?: unknown }).message === 'string') return (candidate as { message: string }).message
  }
  return 'The Skill Check command could not be confirmed.'
}

const announce = async (message: string): Promise<void> => {
  announcement.value = message
  await nextTick()
  statusRegion.value?.focus({ preventScroll: true })
}

const load = async (quiet = false): Promise<void> => {
  if (loading.value) return
  loading.value = true
  if (!quiet) error.value = null
  try {
    try { await api.postJson(SKILL_CHECK_API_PATHS.settleExpired, {}) }
    catch { /* Loading remains useful when campaign writes are temporarily unavailable. */ }
    const [openResponse, recentResponse] = await Promise.all([
      api.getJson(SKILL_CHECK_API_PATHS.gm, { params: { states: 'pending,ready', limit: 200 } }),
      api.getJson(SKILL_CHECK_API_PATHS.gm, { params: { states: 'accepted,cancelled,timed-out', limit: 20 } }),
    ])
    const openAuthority = parseLoadGmSkillChecksResponse(openResponse)
    const recentAuthority = parseLoadGmSkillChecksResponse(recentResponse)
    const checks = [...openAuthority.checks, ...recentAuthority.checks]
      .filter((check, index, rows) => rows.findIndex(candidate => candidate.checkId === check.checkId) === index)
    authority.value = { ...openAuthority, checks }
    if (uncertainCommand.value) {
      const uncertain = uncertainCommand.value
      const operationWasAccepted = checks.some(check => check.checkId === uncertain.checkId
        && check.history.some(entry => entry.operationId === uncertain.operationId))
      if (operationWasAccepted) {
        uncertainCommand.value = null
        await announce('The server confirmed the previously uncertain Skill Check command.')
      }
    }
  }
  catch (candidate) {
    if (!quiet) error.value = errorMessage(candidate)
  }
  finally { loading.value = false }
}

const send = async (
  command: RequestSkillCheckCommandV1 | CancelSkillCheckCommandV1 | ResolveSkillCheckCommandV1,
): Promise<SkillCheckDocumentV1 | null> => {
  if (mutating.value) return null
  mutating.value = true
  error.value = null
  uncertainCommand.value = command
  try {
    const response = parseManageGmSkillCheckResponse(await api.postJson(SKILL_CHECK_API_PATHS.gm, { command }))
    uncertainCommand.value = null
    authority.value = authority.value
      ? { ...authority.value, checks: [response.document, ...authority.value.checks.filter(check => check.checkId !== response.document.checkId)] }
      : authority.value
    await announce(`${response.document.publicLabel}: ${response.document.state}.`)
    void load(true)
    return response.document
  }
  catch (candidate) {
    error.value = `${errorMessage(candidate)} Retry the exact command or refresh server authority before continuing.`
    await announce('Skill Check command outcome is uncertain.')
    return null
  }
  finally { mutating.value = false }
}

const retryExact = async (): Promise<void> => {
  if (!uncertainCommand.value) return
  const command = uncertainCommand.value
  await send(command)
}

const resetComposer = (): void => {
  publicLabel.value = ''
  prompt.value = ''
  gmNotes.value = ''
  selectedSubjects.value = {}
  selectedSkills.value = {}
  situationalModifier.value = 0
}

const submitRequest = async (): Promise<void> => {
  if (formUnavailableReason.value) return
  try {
    const check = newCheckId()
    const seed = check.slice('skill-check:v1:'.length)
    const subjects = chosenSubjects.value.map((subject, index) => ({
      subjectId: newSubjectId(seed, index),
      kind: subject.kind,
      sheetSlug: subject.sheetSlug,
      skillId: selectedSkills.value[subjectKey(subject)]!,
    }))
    const command: RequestSkillCheckCommandV1 = {
      schemaVersion: 1,
      operationId: operationId(),
      expectedRevision: 0,
      commandKind: 'request',
      checkId: check,
      publicLabel: publicLabel.value.trim(),
      prompt: prompt.value.trim(),
      gmNotes: gmNotes.value.trim(),
      visibility: visibility.value,
      comparison: comparisonKind.value === 'opposed'
        ? { kind: 'opposed', tiePolicy: 'reroll-both-up-to-10-then-journaled-server-coin' }
        : {
            kind: 'dc',
            difficulty: difficultyChoice.value === 'explicit'
              ? { kind: 'explicit', difficultyClass: explicitDifficultyClass.value }
              : { kind: 'preset', presetId: difficultyChoice.value as SkillCheckDcPresetId },
            concealment: concealment.value,
          },
      situationalModifier: situationalModifier.value,
      expiresAt: expiryMinutes.value === 'none' ? null : Date.now() + Number(expiryMinutes.value) * 60_000,
      subjects,
    }
    if (await send(command)) resetComposer()
  }
  catch (candidate) { error.value = errorMessage(candidate) }
}

const resolveCheck = async (check: SkillCheckDocumentV1): Promise<void> => {
  if (check.state !== 'ready' || props.commandsBlocked || uncertainCommand.value) return
  const command: ResolveSkillCheckCommandV1 = {
    schemaVersion: 1,
    operationId: operationId(),
    expectedRevision: check.revision,
    commandKind: 'resolve',
    checkId: check.checkId,
  }
  await send(command)
}

const beginCancel = async (check: SkillCheckDocumentV1, event: MouseEvent): Promise<void> => {
  cancelOrigin = event.currentTarget instanceof HTMLElement ? event.currentTarget : null
  cancelTargetId.value = check.checkId
  cancelReason.value = ''
  await nextTick()
  document.getElementById(`cancel-reason-${check.checkId}`)?.focus({ preventScroll: true })
}
const dismissCancel = async (): Promise<void> => {
  cancelTargetId.value = null
  cancelReason.value = ''
  await nextTick()
  if (cancelOrigin?.isConnected) cancelOrigin.focus({ preventScroll: true })
  cancelOrigin = null
}
const cancelCheck = async (check: SkillCheckDocumentV1): Promise<void> => {
  if (!cancelReason.value.trim() || props.commandsBlocked || uncertainCommand.value) return
  const command: CancelSkillCheckCommandV1 = {
    schemaVersion: 1,
    operationId: operationId(),
    expectedRevision: check.revision,
    commandKind: 'cancel',
    checkId: check.checkId,
    reason: cancelReason.value.trim(),
  }
  if (await send(command)) await dismissCancel()
}

const toggleSubject = (subject: SkillCheckGmSubjectOptionV1, checked: boolean): void => {
  const key = subjectKey(subject)
  selectedSubjects.value = { ...selectedSubjects.value, [key]: checked }
  if (checked && !selectedSkills.value[key]) {
    selectedSkills.value = { ...selectedSkills.value, [key]: subject.skillIds[0]! }
  }
}
const responseCount = (check: SkillCheckDocumentV1): number => check.subjects.filter(subject => subject.response === 'accepted').length
const responseLabel = (response: SkillCheckDocumentV1['subjects'][number]['response']): string => (
  response === 'accepted' ? 'Ready' : titleCase(response)
)
const expiryLabel = (expiresAt: number | null): string => {
  if (expiresAt === null) return 'No expiry'
  const seconds = Math.max(0, Math.ceil((expiresAt - now.value) / 1000))
  const minutes = Math.floor(seconds / 60)
  return seconds === 0 ? 'Expired' : `${minutes}:${String(seconds % 60).padStart(2, '0')} remaining`
}
const resultSummary = (check: SkillCheckDocumentV1): string => {
  if (check.state === 'accepted') {
    const successes = check.acceptedResults.filter(result => result.outcome === 'success' || result.outcome === 'winner').length
    return `${successes} of ${check.acceptedResults.length} successful`
  }
  return titleCase(check.state)
}

onMounted(() => {
  void load()
  refreshTimer = setInterval(() => { if (activeChecks.value.length > 0) void load(true) }, 5_000)
  clockTimer = setInterval(() => { now.value = Date.now() }, 1_000)
})
onBeforeUnmount(() => {
  if (refreshTimer) clearInterval(refreshTimer)
  if (clockTimer) clearInterval(clockTimer)
})
</script>

<template>
  <section class="gm-checks" aria-labelledby="gm-skill-checks-heading" :aria-busy="loading || mutating">
    <header class="gm-checks__heading">
      <div>
        <p class="gm-checks__eyebrow">Private GM authority</p>
        <h3 id="gm-skill-checks-heading">Skill checks</h3>
      </div>
      <button type="button" :disabled="loading" @click="load()">{{ loading ? 'Refreshing…' : 'Refresh' }}</button>
    </header>

    <p
      ref="statusRegion"
      class="gm-checks__announcement"
      role="status"
      tabindex="-1"
    >{{ announcement }}</p>
    <div v-if="error" class="gm-checks__error" role="alert">
      <p>{{ error }}</p>
      <div class="gm-checks__actions">
        <button v-if="uncertainCommand" type="button" :disabled="mutating" @click="retryExact">Retry exact command</button>
        <button type="button" :disabled="loading" @click="load()">Refresh server authority</button>
      </div>
    </div>

    <div v-if="loading && !authority" class="gm-checks__empty" aria-busy="true">Loading authoritative checks…</div>

    <template v-else>
      <div class="gm-checks__subhead">
        <h4>Open requests</h4>
        <span>{{ activeChecks.length }}</span>
      </div>
      <p v-if="activeChecks.length === 0" class="gm-checks__empty">No subjects are waiting on a Skill Check.</p>

      <article
        v-for="check in visibleActiveChecks"
        :key="check.checkId"
        class="gm-checks__request"
        :class="`gm-checks__request--${check.state}`"
      >
        <header>
          <p class="gm-checks__state">{{ check.state === 'ready' ? 'Ready to resolve' : 'Waiting for subjects' }}</p>
          <h4 :id="`gm-check-${check.checkId}`">{{ check.publicLabel }}</h4>
          <p>
            {{ titleCase(check.mode) }}
            <template v-if="check.comparison.kind === 'dc'"> · DC {{ check.comparison.difficultyClass }}</template>
            · {{ responseCount(check) }} of {{ check.subjects.length }} ready
            · {{ expiryLabel(check.expiresAt) }}
          </p>
        </header>
        <p class="gm-checks__prompt">{{ check.prompt }}</p>
        <ul class="gm-checks__subjects" :aria-label="`${check.publicLabel} subjects`">
          <li v-for="subject in check.subjects" :key="subject.subjectId">
            <span><strong>{{ subject.sheetSlug }}</strong><small>{{ titleCase(subject.skillId) }}</small></span>
            <span :class="`gm-checks__response gm-checks__response--${subject.response}`">{{ responseLabel(subject.response) }}</span>
          </li>
        </ul>
        <div class="gm-checks__actions">
          <button
            v-if="check.state === 'ready'"
            type="button"
            class="gm-checks__primary"
            :disabled="commandsBlocked || mutating || Boolean(uncertainCommand)"
            @click="resolveCheck(check)"
          >Resolve check</button>
          <button
            type="button"
            :disabled="commandsBlocked || mutating || Boolean(uncertainCommand)"
            :aria-label="`Cancel ${check.publicLabel}`"
            @click="beginCancel(check, $event)"
          >Cancel</button>
        </div>
        <form
          v-if="cancelTargetId === check.checkId"
          class="gm-checks__cancel"
          role="group"
          :aria-labelledby="`gm-check-${check.checkId}`"
          @submit.prevent="cancelCheck(check)"
          @keydown.esc.prevent="dismissCancel"
        >
          <label :for="`cancel-reason-${check.checkId}`">Private cancellation reason</label>
          <textarea :id="`cancel-reason-${check.checkId}`" v-model="cancelReason" maxlength="1000" rows="2" required />
          <div class="gm-checks__actions">
            <button type="submit" :disabled="!cancelReason.trim() || mutating">Confirm cancellation</button>
            <button type="button" :disabled="mutating" @click="dismissCancel">Keep request</button>
          </div>
        </form>
      </article>
      <button
        v-if="visibleActiveChecks.length < activeChecks.length"
        type="button"
        class="gm-checks__more"
        @click="activeCheckLimit = Math.min(activeCheckLimit + 20, activeChecks.length)"
      >Show {{ Math.min(20, activeChecks.length - visibleActiveChecks.length) }} more open requests</button>

      <details class="gm-checks__composer" open>
        <summary>Request a Skill Check</summary>
        <form aria-describedby="gm-check-server-note gm-check-validation" @submit.prevent="submitRequest">
          <label for="gm-check-public-label">Public label
            <input id="gm-check-public-label" v-model="publicLabel" required maxlength="120" autocomplete="off" placeholder="Cross the ravine">
          </label>
          <label for="gm-check-prompt">Prompt
            <textarea id="gm-check-prompt" v-model="prompt" required maxlength="2000" rows="3" placeholder="Tell the subjects what they are checking." />
          </label>

          <fieldset class="gm-checks__subject-picker">
            <legend>Subjects and skills</legend>
            <label for="gm-check-subject-filter" class="gm-checks__filter">Find a Trainer or Pokémon
              <input id="gm-check-subject-filter" v-model="subjectFilter" type="search" autocomplete="off" placeholder="Search sheets">
            </label>
            <p v-if="visibleSubjects.length === 100" class="gm-checks__hint">Showing the first 100 matches. Refine the search to find another sheet.</p>
            <div class="gm-checks__subject-options">
              <div v-for="subject in visibleSubjects" :key="subjectKey(subject)" class="gm-checks__subject-option">
                <label>
                  <input
                    type="checkbox"
                    :checked="selectedSubjects[subjectKey(subject)] === true"
                    @change="toggleSubject(subject, ($event.target as HTMLInputElement).checked)"
                  >
                  <span><strong>{{ subject.label }}</strong><small>{{ titleCase(subject.kind) }}</small></span>
                </label>
                <label :for="`skill-${subject.kind}-${subject.sheetSlug}`" class="gm-checks__skill-label">
                  <span class="sr-only">Skill for {{ subject.label }}</span>
                  <select
                    :id="`skill-${subject.kind}-${subject.sheetSlug}`"
                    :value="selectedSkills[subjectKey(subject)]"
                    :disabled="selectedSubjects[subjectKey(subject)] !== true"
                    @change="selectedSkills = { ...selectedSkills, [subjectKey(subject)]: ($event.target as HTMLSelectElement).value as TrainerSkillKey }"
                  >
                    <option v-for="skillId in subject.skillIds" :key="skillId" :value="skillId">{{ titleCase(skillId) }}</option>
                  </select>
                </label>
              </div>
            </div>
          </fieldset>

          <div class="gm-checks__grid">
            <label for="gm-check-comparison">Comparison
              <select id="gm-check-comparison" v-model="comparisonKind">
                <option value="dc">Difficulty class</option>
                <option value="opposed">Opposed</option>
              </select>
            </label>
            <label v-if="comparisonKind === 'dc'" for="gm-check-difficulty">Difficulty
              <select id="gm-check-difficulty" v-model="difficultyChoice">
                <option v-for="preset in authority?.dcPresets" :key="preset.presetId" :value="preset.presetId">{{ preset.label }} — {{ preset.difficultyClass }}</option>
                <option value="explicit">Custom DC</option>
              </select>
            </label>
            <label v-if="comparisonKind === 'dc' && difficultyChoice === 'explicit'" for="gm-check-explicit-dc">Custom DC
              <input id="gm-check-explicit-dc" v-model.number="explicitDifficultyClass" type="number" min="1" max="100" step="1" required>
            </label>
            <label v-if="comparisonKind === 'dc'" for="gm-check-concealment">DC visibility
              <select id="gm-check-concealment" v-model="concealment">
                <option value="public">Public while pending</option>
                <option value="subjects-after-acceptance">After acceptance</option>
                <option value="gm-only">GM only</option>
              </select>
            </label>
            <label for="gm-check-result-visibility">Results
              <select id="gm-check-result-visibility" v-model="visibility">
                <option value="public-results">Public</option>
                <option value="participants-results">Subjects only</option>
                <option value="gm-only-results">GM only</option>
              </select>
            </label>
            <label for="gm-check-modifier">Situational modifier
              <input id="gm-check-modifier" v-model.number="situationalModifier" type="number" min="-20" max="20" step="1">
            </label>
            <label for="gm-check-expiry">Expires in
              <select id="gm-check-expiry" v-model="expiryMinutes">
                <option value="none">No expiry</option>
                <option value="5">5 minutes</option>
                <option value="10">10 minutes</option>
                <option value="30">30 minutes</option>
              </select>
            </label>
          </div>

          <details class="gm-checks__notes">
            <summary>GM notes · private</summary>
            <label for="gm-check-notes" class="sr-only">Private GM notes</label>
            <textarea id="gm-check-notes" v-model="gmNotes" maxlength="4000" rows="3" />
          </details>
          <p id="gm-check-server-note" class="gm-checks__hint">Dice are rolled by the server after every required response.</p>
          <p id="gm-check-validation" class="gm-checks__validation" aria-live="polite">{{ formUnavailableReason ?? 'Request inputs are valid.' }}</p>
          <button type="submit" class="gm-checks__primary" :disabled="Boolean(formUnavailableReason)">
            {{ mutating ? 'Requesting…' : 'Request check' }}
          </button>
        </form>
      </details>

      <details v-if="completedChecks.length" class="gm-checks__history">
        <summary>Recent Skill Check history · {{ completedChecks.length }}</summary>
        <ol>
          <li v-for="check in completedChecks" :key="check.checkId">
            <span><strong>{{ check.publicLabel }}</strong><small>{{ resultSummary(check) }}</small></span>
            <time :datetime="new Date(check.updatedAt).toISOString()">{{ new Date(check.updatedAt).toLocaleString() }}</time>
          </li>
        </ol>
      </details>
    </template>
  </section>
</template>

<style scoped>
.gm-checks { display: grid; gap: var(--rt-space-4); }
.gm-checks__heading, .gm-checks__subhead { display: flex; align-items: center; justify-content: space-between; gap: var(--rt-space-3); }
.gm-checks button { min-height: var(--rt-touch-minimum); border: 1px solid var(--rt-rule); background: var(--rt-bg-canvas); color: var(--rt-text-strong); font: inherit; font-weight: 700; }
.gm-checks__heading h3, .gm-checks__subhead h4, .gm-checks__request h4 { margin: 0; }
.gm-checks__eyebrow, .gm-checks__state { margin: 0 0 .2rem; color: var(--rt-pending); font-size: var(--rt-type-label-sm-size); font-weight: 800; letter-spacing: .07em; text-transform: uppercase; }
.gm-checks__announcement:empty { position: absolute; }
.gm-checks__announcement:not(:empty), .gm-checks__error, .gm-checks__validation { margin: 0; padding: .65rem; border-inline-start: 3px solid var(--rt-focus); background: var(--rt-surface-2); }
.gm-checks__announcement:focus { outline: 2px solid var(--rt-focus); outline-offset: 2px; }
.gm-checks__error { border-inline-start-color: var(--rt-danger); }
.gm-checks__error p { margin: 0 0 .5rem; }
.gm-checks__subhead { padding-top: .25rem; border-top: 1px solid var(--rt-rule); }
.gm-checks__empty { margin: 0; color: var(--rt-text-muted); }
.gm-checks__request { display: grid; gap: var(--rt-space-3); padding: var(--rt-space-3); border: 1px solid var(--rt-rule); border-inline-start: 3px solid var(--rt-pending); background: var(--rt-surface-2); }
.gm-checks__request--ready { border-inline-start-color: var(--rt-success); }
.gm-checks__request--ready .gm-checks__state { color: var(--rt-success); }
.gm-checks__request header > p:last-child, .gm-checks__prompt, .gm-checks__hint { margin: .25rem 0 0; color: var(--rt-text-muted); font-size: var(--rt-type-body-sm-size); line-height: 1.45; }
.gm-checks__subjects { display: grid; margin: 0; padding: 0; border: 1px solid var(--rt-rule); list-style: none; }
.gm-checks__subjects li { display: flex; align-items: center; justify-content: space-between; gap: .75rem; min-height: var(--rt-touch-minimum); padding: .45rem .6rem; }
.gm-checks__subjects li + li { border-top: 1px solid var(--rt-rule); }
.gm-checks__subjects li > span:first-child, .gm-checks__history li > span, .gm-checks__subject-option label > span { display: grid; min-width: 0; }
.gm-checks small { color: var(--rt-text-muted); }
.gm-checks__response { font-weight: 800; }
.gm-checks__response--accepted { color: var(--rt-success); }
.gm-checks__response--pending { color: var(--rt-pending); }
.gm-checks__response--declined { color: var(--rt-danger); }
.gm-checks__actions { display: flex; flex-wrap: wrap; gap: var(--rt-space-2); }
.gm-checks__actions > * { flex: 1 1 9rem; }
.gm-checks__primary, .gm-checks__more { min-height: var(--rt-touch-minimum); border-color: var(--rt-focus); background: color-mix(in srgb, var(--rt-focus) 14%, var(--rt-surface-2)); color: var(--rt-text-strong); font-weight: 800; }
.gm-checks__more { width: 100%; }
.gm-checks__cancel { display: grid; gap: var(--rt-space-2); padding: var(--rt-space-3); border-inline-start: 3px solid var(--rt-danger); background: var(--rt-bg-canvas); }
.gm-checks__composer, .gm-checks__history { border: 1px solid var(--rt-rule); background: var(--rt-surface-2); }
.gm-checks__composer > summary, .gm-checks__history > summary, .gm-checks__notes > summary { min-height: var(--rt-touch-minimum); padding: .65rem; cursor: pointer; font-weight: 800; }
.gm-checks__composer > form { display: grid; gap: var(--rt-space-3); padding: var(--rt-space-3); border-top: 1px solid var(--rt-rule); }
.gm-checks label:not(.gm-checks__skill-label), .gm-checks__filter { display: grid; gap: .3rem; color: var(--rt-text-muted); font-size: var(--rt-type-label-sm-size); }
.gm-checks input:not([type='checkbox']), .gm-checks select, .gm-checks textarea { width: 100%; min-height: var(--rt-touch-minimum); padding: .5rem; border: 1px solid var(--rt-rule); border-radius: var(--rt-radius-small); background: var(--rt-bg-canvas); color: var(--rt-text); font: inherit; }
.gm-checks textarea { resize: vertical; }
.gm-checks__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--rt-space-3); }
.gm-checks__subject-picker { display: grid; gap: var(--rt-space-2); min-width: 0; margin: 0; padding: var(--rt-space-3); border: 1px solid var(--rt-rule); }
.gm-checks__subject-picker legend { padding-inline: .25rem; font-weight: 800; }
.gm-checks__subject-options { display: grid; max-height: 18rem; overflow: auto; border: 1px solid var(--rt-rule); }
.gm-checks__subject-option { display: grid; grid-template-columns: minmax(0, 1fr) minmax(8rem, .8fr); align-items: center; gap: var(--rt-space-2); min-height: var(--rt-touch-minimum); padding: .35rem .5rem; }
.gm-checks__subject-option + .gm-checks__subject-option { border-top: 1px solid var(--rt-rule); }
.gm-checks__subject-option > label:first-child { display: flex; align-items: center; gap: .5rem; min-width: 0; color: var(--rt-text); }
.gm-checks__request h4, .gm-checks__subjects strong, .gm-checks__subject-option strong { overflow-wrap: anywhere; }
.gm-checks__subject-option input[type='checkbox'] { width: 1.25rem; height: 1.25rem; flex: 0 0 auto; accent-color: var(--rt-focus); }
.gm-checks__subject-option select { min-height: var(--rt-touch-minimum); padding: .3rem; }
.gm-checks__notes { border: 1px solid var(--rt-rule); background: var(--rt-bg-canvas); }
.gm-checks__notes textarea { border: 0; border-top: 1px solid var(--rt-rule); border-radius: 0; }
.gm-checks__validation { border-inline-start-color: var(--rt-pending); color: var(--rt-text); }
.gm-checks__history ol { display: grid; margin: 0; padding: 0; border-top: 1px solid var(--rt-rule); list-style: none; }
.gm-checks__history li { display: flex; justify-content: space-between; gap: .75rem; padding: .65rem; }
.gm-checks__history li + li { border-top: 1px solid var(--rt-rule); }
.gm-checks__history time { color: var(--rt-text-muted); font-size: var(--rt-type-label-sm-size); text-align: end; }
@media (max-width: 30rem) {
  .gm-checks__grid, .gm-checks__subject-option { grid-template-columns: 1fr; }
  .gm-checks__history li { display: grid; }
  .gm-checks__history time { text-align: start; }
}
@media (prefers-reduced-motion: reduce) {
  .gm-checks *, .gm-checks *::before, .gm-checks *::after { scroll-behavior: auto !important; }
}
</style>

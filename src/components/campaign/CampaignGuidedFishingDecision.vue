<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { SkillCheckId } from '#shared/skillChecks/contract'
import { parseSkillCheckRoleProjectionResponse, type SkillCheckGmProjectionV1 } from '#shared/skillChecks/projections'
import type { ItemGuidedRequestProjectionV1 } from '#shared/itemAutomation/guidedAdjudication'
import type { TrainerSkillKey } from '~/types/trainerSheet'
import { useApiClient } from '~/composables/useApiClient'
import { SKILL_CHECK_API_PATHS } from '~/utils/apiRoutes'

const props = defineProps<{
  request: ItemGuidedRequestProjectionV1
  busy: boolean
}>()
const emit = defineEmits<{
  submit: [choice: {
    skillId: TrainerSkillKey
    skillCheckId: SkillCheckId
    hookSpeciesId: string | null
    hookLevel: number | null
    gmNote: string | null
  }]
  cancel: []
}>()

const api = useApiClient()
const authority = computed(() => props.request.resolution?.kind === 'fishing'
  ? props.request.resolution : null)
const acceptedChecks = ref<readonly SkillCheckGmProjectionV1[]>([])
const selectedCheckId = ref<SkillCheckId | ''>('')
const loadingChecks = ref(false)
const checkError = ref<string | null>(null)
const outcome = ref<'no-hook' | 'hook'>('no-hook')
const hookSpeciesId = ref('')
const hookLevel = ref(1)
const gmNote = ref('')

const matchingChecks = computed(() => {
  const binding = authority.value
  if (!binding) return []
  return acceptedChecks.value.filter(check => {
    const document = check.document
    const subject = document.subjects[0]
    return document.state === 'accepted'
      && document.mode === 'single'
      && document.comparison.kind === 'dc'
      && document.subjects.length === 1
      && subject?.kind === binding.actorKind
      && subject.sheetSlug === binding.actorSheetSlug
      && binding.skillOptions.some(option => option.skillId === subject.skillId)
  })
})
const selectedCheck = computed(() => matchingChecks.value.find(check => check.document.checkId === selectedCheckId.value) ?? null)
const selectedSubject = computed(() => selectedCheck.value?.document.subjects[0] ?? null)
const selectedResult = computed(() => selectedCheck.value?.document.acceptedResults[0] ?? null)

const checkOptionLabel = (check: SkillCheckGmProjectionV1): string => {
  const subject = check.document.subjects[0]!
  const result = check.document.acceptedResults[0]!
  const skillLabel = authority.value?.skillOptions.find(option => option.skillId === subject.skillId)?.label ?? subject.skillId
  const outcomeLabel = `${result.outcome.slice(0, 1).toLocaleUpperCase('en-US')}${result.outcome.slice(1)}`
  return `${check.document.publicLabel} · ${skillLabel} · Total ${result.finalTotal} · ${outcomeLabel}`
}
const errorMessage = (candidate: unknown): string => {
  if (candidate && typeof candidate === 'object' && typeof (candidate as { message?: unknown }).message === 'string') {
    return (candidate as { message: string }).message
  }
  return 'Accepted Skill Checks are temporarily unavailable.'
}
const loadChecks = async (): Promise<void> => {
  if (loadingChecks.value || !authority.value) return
  loadingChecks.value = true
  checkError.value = null
  try {
    const response = parseSkillCheckRoleProjectionResponse(await api.getJson(SKILL_CHECK_API_PATHS.projections, {
      params: { states: 'accepted', limit: 100 },
    }))
    if (response.audience !== 'gm') throw new Error('The server returned the wrong Skill Check audience.')
    acceptedChecks.value = response.checks
    if (selectedCheckId.value && !matchingChecks.value.some(check => check.document.checkId === selectedCheckId.value)) {
      selectedCheckId.value = ''
    }
  }
  catch (candidate) {
    acceptedChecks.value = []
    selectedCheckId.value = ''
    checkError.value = errorMessage(candidate)
  }
  finally { loadingChecks.value = false }
}

watch(() => props.request.requestId, () => {
  outcome.value = 'no-hook'
  selectedCheckId.value = ''
  hookSpeciesId.value = ''
  hookLevel.value = 1
  gmNote.value = ''
  void loadChecks()
}, { immediate: true })

const valid = computed(() => Boolean(authority.value && selectedCheck.value && selectedSubject.value && selectedResult.value)
  && (outcome.value === 'no-hook' || (
    authority.value!.hookOptions.some(option => option.speciesId === hookSpeciesId.value)
    && Number.isSafeInteger(hookLevel.value)
    && hookLevel.value >= 1
    && hookLevel.value <= authority.value!.maximumHookLevel
  )))

const submit = (): void => {
  const subject = selectedSubject.value
  if (!valid.value || props.busy || !subject || !selectedCheckId.value) return
  const note = gmNote.value.trim()
  emit('submit', {
    skillId: subject.skillId,
    skillCheckId: selectedCheckId.value,
    hookSpeciesId: outcome.value === 'hook' ? hookSpeciesId.value : null,
    hookLevel: outcome.value === 'hook' ? hookLevel.value : null,
    gmNote: note || null,
  })
}
</script>

<template>
  <div v-if="authority" class="guided-fishing" :aria-busy="loadingChecks || busy">
    <section aria-labelledby="guided-fishing-check-title" aria-describedby="guided-fishing-check-instructions">
      <h4 id="guided-fishing-check-title">Accepted Skill Check evidence</h4>
      <p id="guided-fishing-check-instructions">Request and resolve this actor’s check in Live Encounter → Director → Checks, then refresh.</p>
      <p class="guided-fishing__actor"><strong>{{ authority.actorKind === 'trainer' ? 'Trainer' : 'Pokémon' }} · {{ request.actorLabel }}</strong><span>Single-subject DC check required</span></p>
      <label>
        <span>Accepted check</span>
        <select
          v-model="selectedCheckId"
          :disabled="busy || loadingChecks"
          aria-describedby="guided-fishing-check-instructions guided-fishing-check-status"
        >
          <option value="">Choose matching server evidence</option>
          <option v-for="check in matchingChecks" :key="check.document.checkId" :value="check.document.checkId">
            {{ checkOptionLabel(check) }}
          </option>
        </select>
      </label>
      <button type="button" class="guided-fishing__refresh" :disabled="busy || loadingChecks" @click="loadChecks">
        {{ loadingChecks ? 'Refreshing checks…' : 'Refresh checks' }}
      </button>
      <p v-if="checkError" id="guided-fishing-check-status" class="guided-fishing__error" role="alert">{{ checkError }}</p>
      <p v-else-if="matchingChecks.length === 0" id="guided-fishing-check-status" class="guided-fishing__empty" role="status">No matching accepted check yet. Manual IDs, rolls, and totals are not accepted.</p>
      <p v-else-if="!selectedCheck" id="guided-fishing-check-status" class="guided-fishing__empty">Choose one matching accepted check before adjudicating the hook.</p>
      <p v-if="selectedCheck" id="guided-fishing-check-status" class="guided-fishing__linked" role="status">
        <strong>Accepted check linked</strong>
        <span>{{ authority.skillOptions.find(option => option.skillId === selectedSubject?.skillId)?.label }} · Result recorded by server</span>
      </p>
    </section>

    <fieldset :disabled="busy || !selectedCheck">
      <legend>Hook outcome</legend>
      <label class="guided-fishing__outcome">
        <input v-model="outcome" type="radio" value="no-hook">
        <span><strong>No hook</strong><small>Record the completed fishing attempt without selecting a Pokémon.</small></span>
      </label>
      <label class="guided-fishing__outcome">
        <input v-model="outcome" type="radio" value="hook">
        <span><strong>One bounded hook</strong><small>Select one server-issued canonical species and Level.</small></span>
      </label>
    </fieldset>

    <section v-if="outcome === 'hook'" class="guided-fishing__hook" aria-labelledby="guided-fishing-hook-title">
      <h4 id="guided-fishing-hook-title">Canonical hook</h4>
      <label>
        <span>Species</span>
        <select v-model="hookSpeciesId" :disabled="busy || !selectedCheck" required>
          <option value="" disabled>Choose an eligible species</option>
          <option v-for="option in authority.hookOptions" :key="option.speciesId" :value="option.speciesId">
            {{ option.label }}
          </option>
        </select>
      </label>
      <label>
        <span>Level (1–{{ authority.maximumHookLevel }})</span>
        <input v-model.number="hookLevel" type="number" min="1" :max="authority.maximumHookLevel" inputmode="numeric" :disabled="busy || !selectedCheck" required>
      </label>
      <p>{{ authority.hookOptions.length }} canonical species satisfy this rod’s reviewed stage and size bounds.</p>
    </section>

    <label class="guided-fishing__note">
      <span>Private GM note <small>(optional)</small></span>
      <textarea v-model="gmNote" :disabled="busy" maxlength="500" rows="3" placeholder="Private evidence for this bounded outcome"></textarea>
      <small>Never shown in owner or public encounter projections.</small>
    </label>

    <div class="guided-fishing__actions">
      <button type="button" :disabled="busy || !request.canCancel" @click="emit('cancel')">Cancel request</button>
      <button type="button" class="guided-fishing__accept" :disabled="busy || !valid" @click="submit">
        {{ busy ? 'Accepting…' : outcome === 'hook' ? 'Accept hook outcome' : 'Accept no-hook outcome' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.guided-fishing { display: grid; min-width: 0; gap: .75rem; }
.guided-fishing section,
.guided-fishing fieldset,
.guided-fishing__note { display: grid; min-width: 0; gap: .5rem; margin: 0; border: 1px solid var(--rt-border, var(--rule-soft)); border-radius: var(--rt-radius-medium, 8px); padding: .75rem .85rem; }
.guided-fishing h4,
.guided-fishing legend { margin: 0; color: var(--rt-text-strong, var(--ink-bright)); font-weight: 800; }
.guided-fishing label { color: var(--rt-text, var(--ink)); }
.guided-fishing label > span { display: block; margin-bottom: .25rem; font-size: .78rem; font-weight: 750; }
.guided-fishing select,
.guided-fishing input[type='number'],
.guided-fishing textarea { width: 100%; min-height: 44px; border: 1px solid var(--rt-border-strong, var(--rule)); border-radius: var(--rt-radius-small, 6px); background: var(--rt-surface-3, var(--paper)); color: var(--rt-text-strong, var(--ink-bright)); padding: .55rem .65rem; font: inherit; }
.guided-fishing textarea { min-height: 5rem; resize: vertical; }
.guided-fishing section > p { margin: 0; overflow-wrap: anywhere; color: var(--rt-text-muted, var(--ink-muted)); font-size: .78rem; }
.guided-fishing__actor { display: grid; gap: .15rem; padding-block: .4rem; border-block: 1px solid var(--rt-border, var(--rule-soft)); text-transform: none; }
.guided-fishing__actor strong { color: var(--rt-text-strong, var(--ink-bright)); letter-spacing: .04em; text-transform: uppercase; }
.guided-fishing__refresh { min-height: 44px; border: 1px solid var(--rt-focus, #20c8e5); background: transparent; color: var(--rt-focus, #20c8e5); padding: .55rem .75rem; font: inherit; font-weight: 800; }
.guided-fishing section > .guided-fishing__linked { display: grid; gap: .15rem; padding: .65rem; border-inline-start: 3px solid var(--rt-success, #68d06f); background: var(--rt-surface-2, var(--paper-inset)); color: var(--rt-text-muted, var(--ink-muted)); }
.guided-fishing__linked strong { color: var(--rt-success, #68d06f); }
.guided-fishing section > .guided-fishing__error { padding: .6rem; border-inline-start: 3px solid var(--rt-danger, #ff6b6b); color: var(--rt-text, var(--ink)); }
.guided-fishing section > .guided-fishing__empty { padding: .6rem; border-inline-start: 3px solid var(--rt-pending, #ffc247); color: var(--rt-text, var(--ink)); }
.guided-fishing__outcome { min-height: 44px; display: flex; align-items: flex-start; gap: .65rem; border: 1px solid var(--rt-border, var(--rule-soft)); border-radius: var(--rt-radius-small, 6px); padding: .62rem .7rem; cursor: pointer; }
.guided-fishing__outcome:has(input:checked) { border-color: var(--rt-focus, #20c8e5); box-shadow: inset 0 0 0 1px var(--rt-focus, #20c8e5); }
.guided-fishing__outcome input { width: 1.25rem; height: 1.25rem; flex: 0 0 auto; margin: .08rem 0 0; accent-color: var(--rt-focus, #20c8e5); }
.guided-fishing__outcome span { display: grid; gap: .12rem; margin: 0; }
.guided-fishing__outcome small,
.guided-fishing__note > small { color: var(--rt-text-muted, var(--ink-muted)); }
.guided-fishing__actions { display: flex; align-items: stretch; gap: .75rem; }
.guided-fishing__actions button { min-height: 44px; border: 1px solid var(--rt-border-strong, var(--rule)); border-radius: var(--rt-radius-medium, 8px); background: var(--rt-surface-2, var(--paper-inset)); color: var(--rt-text, var(--ink)); padding: .65rem .9rem; font: inherit; font-weight: 750; cursor: pointer; }
.guided-fishing__actions .guided-fishing__accept { flex: 1; border: 2px solid var(--rt-pending, #ffc247); background: var(--rt-brand, #df2d32); color: var(--rt-on-brand, #fff); font-weight: 900; }
.guided-fishing :focus-visible { outline: 3px solid color-mix(in srgb, var(--rt-focus, #20c8e5) 55%, transparent); outline-offset: 2px; }
.guided-fishing :disabled { cursor: not-allowed; opacity: .52; }
@media (max-width: 35rem) {
  .guided-fishing__actions { flex-direction: column; }
  .guided-fishing__actions button { width: 100%; }
}
</style>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { PhArrowClockwise, PhCheck, PhFlask, PhLockKey, PhSparkle, PhWarning } from '@phosphor-icons/vue'
import type { WildGenerationExplorationRefV1 } from '#shared/gmToolkit/generation'
import { ENCOUNTER_TIME_OF_DAY_VALUES, ENCOUNTER_WEATHER_VALUES } from '#shared/gmToolkit/encounterTables'
import AppNavigation from '~/components/AppNavigation.vue'
import EncounterToolkitNavigation from '~/components/encounters/EncounterToolkitNavigation.vue'
import { useAuth } from '~/composables/useAuth'
import { useApiClient } from '~/composables/useApiClient'
import { useWildGenerationToolkit } from '~/composables/encounters/useWildGenerationToolkit'
import {
  parseTrainerItemExplorationAuthority,
  type TrainerItemExplorationAuthority,
} from '~/composables/sheets/useTrainerItemExploration'
import { ITEM_API_PATHS } from '~/utils/apiRoutes'

useHead({ title: 'Campaign Toolkit · Wild encounter · Rotom Table' })

const { isGm } = useAuth()
const route = useRoute()
const { getJson } = useApiClient()
const routeRepelTrainerSlug = computed(() => {
  const value = typeof route.query.trainer === 'string' ? route.query.trainer : ''
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) ? value : ''
})
const routeRepelAuthority = ref<TrainerItemExplorationAuthority | null>(null)
const routeRepelLoading = ref(false)
const routeRepelError = ref<string | null>(null)
let routeRepelLoadSequence = 0

watch(routeRepelTrainerSlug, async (trainerSlug) => {
  const sequence = ++routeRepelLoadSequence
  routeRepelAuthority.value = null
  routeRepelError.value = null
  if (!trainerSlug) return
  routeRepelLoading.value = true
  try {
    const loaded = parseTrainerItemExplorationAuthority(await getJson<unknown>(ITEM_API_PATHS.exploration, {
      params: { trainerSlug },
    }), trainerSlug)
    if (sequence !== routeRepelLoadSequence) return
    if (!loaded.projection.repels.some(repel => repel.active)) {
      routeRepelError.value = 'This Trainer no longer has an active route Repel. Refresh Trainer activity before previewing.'
      return
    }
    routeRepelAuthority.value = loaded
  } catch (error) {
    if (sequence === routeRepelLoadSequence) routeRepelError.value = error instanceof Error ? error.message : 'Route Repel authority could not be loaded.'
  } finally {
    if (sequence === routeRepelLoadSequence) routeRepelLoading.value = false
  }
}, { immediate: true })

const activeRouteRepel = computed(() => routeRepelAuthority.value?.projection.repels
  .filter(repel => repel.active)
  .sort((left, right) => right.maximumAffectedWildLevel - left.maximumAffectedWildLevel
    || right.expiresAtCampaignMinute - left.expiresAtCampaignMinute)[0] ?? null)
const exploration = computed<WildGenerationExplorationRefV1 | null>(() => (
  routeRepelAuthority.value && activeRouteRepel.value
    ? {
        trainerSlug: routeRepelAuthority.value.trainerSlug,
        trainerRevision: routeRepelAuthority.value.trainerRevision,
        campaignClockRevision: routeRepelAuthority.value.campaignClockRevision,
      }
    : null
))
const routeRepelBlocked = computed(() => Boolean(routeRepelTrainerSlug.value) && exploration.value === null)

const {
  tables,
  tableId,
  selectedTable,
  requestedSlots,
  timeOfDay,
  weather,
  shinyChancePercent,
  heldItemName,
  loadingTables,
  previewing,
  committing,
  error,
  announcement,
  preview,
  committed,
  selectedCandidateIds,
  canPreview,
  canCommit,
  loadTables,
  requestPreview: requestPreviewAuthority,
  toggleCandidate,
  commitPackage: commitPackageAuthority,
  startAnother: clearGeneration,
} = useWildGenerationToolkit({ exploration, commandsBlocked: routeRepelBlocked })

const setupHeading = ref<HTMLElement | null>(null)
const reviewHeading = ref<HTMLElement | null>(null)
const acceptedHeading = ref<HTMLElement | null>(null)
const requestPreview = async (): Promise<void> => {
  await requestPreviewAuthority()
  await nextTick()
  if (preview.value) reviewHeading.value?.focus()
}
const commitPackage = async (): Promise<void> => {
  await commitPackageAuthority()
  await nextTick()
  if (committed.value) acceptedHeading.value?.focus()
}
const startAnother = async (): Promise<void> => {
  clearGeneration()
  await nextTick()
  setupHeading.value?.focus()
}
const selected = (candidateId: string): boolean => selectedCandidateIds.value.includes(candidateId)
</script>

<template>
  <div class="toolkit-page">
    <AppNavigation />

    <header class="toolkit-header">
      <div class="toolkit-title">
        <div>
          <p class="eyebrow">GM Workshop</p>
          <h1>Campaign Toolkit</h1>
        </div>
        <button class="icon-action" type="button" aria-label="Refresh encounter tables" :disabled="loadingTables" @click="loadTables">
          <PhArrowClockwise :size="20" :class="{ spinning: loadingTables }" aria-hidden="true" />
        </button>
      </div>
      <p class="toolkit-subtitle">Generate exact, reviewable wild Pokémon from campaign tables, then commit only the package you accept.</p>
      <EncounterToolkitNavigation active="wild" />
    </header>

    <main v-if="isGm" class="wild-workspace">
      <div v-if="error" class="notice notice--error" role="alert">
        <PhWarning :size="22" weight="fill" aria-hidden="true" />
        <div><strong>Generation could not finish</strong><span>{{ error }}</span></div>
      </div>

      <section v-if="routeRepelTrainerSlug" class="repel-context" :class="{ 'repel-context--blocked': routeRepelBlocked }" aria-labelledby="repel-heading" :aria-busy="routeRepelLoading">
        <div>
          <p class="section-kicker">Exploration authority</p>
          <h2 id="repel-heading">Route Repel</h2>
        </div>
        <p v-if="routeRepelLoading" role="status">Loading current Trainer and campaign clock…</p>
        <p v-else-if="routeRepelError" role="alert">{{ routeRepelError }}</p>
        <p v-else-if="activeRouteRepel && routeRepelAuthority">
          <strong>{{ activeRouteRepel.itemLabel }}</strong> filters wild Pokémon at Level {{ activeRouteRepel.maximumAffectedWildLevel }} or lower. The server rechecks Trainer revision {{ routeRepelAuthority.trainerRevision }} and current campaign time before commit.
        </p>
        <NuxtLink to="/generate">Clear route context</NuxtLink>
      </section>

      <div class="wild-grid">
        <section class="setup-panel" aria-labelledby="setup-heading">
          <div class="panel-heading">
            <div>
              <p class="section-kicker">1 · Configure</p>
              <h2 id="setup-heading" ref="setupHeading" tabindex="-1">Wild encounter</h2>
            </div>
            <PhFlask :size="28" weight="duotone" aria-hidden="true" />
          </div>

          <div class="field-stack">
            <label>
              <span>Campaign table</span>
              <select v-model="tableId" :disabled="loadingTables || previewing || committing">
                <option value="">Choose a table</option>
                <option v-for="table in tables" :key="table.tableId" :value="table.tableId">{{ table.name }}</option>
              </select>
            </label>
            <div v-if="selectedTable" class="table-summary">
              <strong>{{ selectedTable.speciesRowCount }} species rows</strong>
              <span>Levels {{ selectedTable.levelRange.minimum }}–{{ selectedTable.levelRange.maximum }} · revision {{ selectedTable.revision }}</span>
              <small>{{ selectedTable.environmentTags.join(' · ') || 'No habitat tags' }}</small>
            </div>
            <label>
              <span>Encounter slots</span>
              <input v-model.number="requestedSlots" type="number" min="1" max="30" inputmode="numeric" :disabled="previewing || committing">
              <small>Up to 30 rolls; at most 10 Pokémon can be committed.</small>
            </label>
            <div class="field-pair">
              <label>
                <span>Time of day</span>
                <select v-model="timeOfDay" :disabled="previewing || committing">
                  <option :value="null">Not specified</option>
                  <option v-for="value in ENCOUNTER_TIME_OF_DAY_VALUES" :key="value" :value="value">{{ value }}</option>
                </select>
              </label>
              <label>
                <span>Weather</span>
                <select v-model="weather" :disabled="previewing || committing">
                  <option :value="null">Not specified</option>
                  <option v-for="value in ENCOUNTER_WEATHER_VALUES" :key="value" :value="value">{{ value }}</option>
                </select>
              </label>
            </div>
            <details>
              <summary>Optional generation policy</summary>
              <div class="details-fields">
                <label>
                  <span>Shiny chance (%)</span>
                  <input v-model.number="shinyChancePercent" type="number" min="0" max="100" step="0.01" :disabled="previewing || committing">
                </label>
                <label>
                  <span>Held item</span>
                  <input v-model="heldItemName" type="text" maxlength="120" placeholder="Canonical item name" :disabled="previewing || committing">
                </label>
              </div>
            </details>
          </div>

          <button class="preview-action" type="button" :disabled="!canPreview || previewing || committing" @click="requestPreview">
            <PhSparkle :size="19" weight="fill" aria-hidden="true" />
            {{ previewing ? 'Building exact preview…' : 'Preview encounter' }}
          </button>
          <p class="inert-note">Preview is inert. No sheet, map, operation, or realtime row is saved.</p>
        </section>

        <section class="review-panel" aria-labelledby="review-heading">
          <div class="panel-heading review-heading">
            <div>
              <p class="section-kicker">2 · Review</p>
              <h2 id="review-heading" ref="reviewHeading" tabindex="-1">Generated candidates</h2>
            </div>
            <span v-if="preview" class="selection-count">{{ selectedCandidateIds.length }} selected</span>
          </div>

          <div v-if="!preview" class="empty-state">
            <PhSparkle :size="36" weight="duotone" aria-hidden="true" />
            <strong>Nothing has been rolled</strong>
            <span>Choose a table and ask the server for an exact preview.</span>
          </div>
          <template v-else>
            <div class="preview-banner">
              <strong>Preview only — nothing has been saved</strong>
              <span>{{ preview.requestedSlots }} slots · {{ preview.nothingSlots }} Nothing · {{ preview.repelledSlots }} repelled</span>
            </div>
            <div v-if="preview.candidates.length" class="candidate-list">
              <article v-for="candidate in preview.candidates" :key="candidate.candidateId" class="candidate-card" :class="{ 'candidate-card--selected': selected(candidate.candidateId) }">
                <label class="candidate-select">
                  <input type="checkbox" :checked="selected(candidate.candidateId)" :disabled="committing || (!selected(candidate.candidateId) && selectedCandidateIds.length >= 10)" @change="toggleCandidate(candidate.candidateId, ($event.target as HTMLInputElement).checked)">
                  <span class="sr-only">Select {{ candidate.speciesId }} at Level {{ candidate.level }}</span>
                </label>
                <div class="candidate-main">
                  <div class="candidate-title">
                    <div>
                      <span class="slot-label">Slot {{ candidate.slot }}</span>
                      <h3>{{ candidate.speciesId }}</h3>
                    </div>
                    <div class="level-chip">Level {{ candidate.level }}</div>
                  </div>
                  <div class="candidate-tags">
                    <span>{{ candidate.gender }}</span><span>{{ candidate.nature }}</span><span v-if="candidate.shiny" class="shiny">Shiny</span><span v-if="candidate.heldItemName">Holding {{ candidate.heldItemName }}</span>
                  </div>
                  <dl class="candidate-facts">
                    <div><dt>Abilities</dt><dd>{{ candidate.abilityNames.join(', ') }}</dd></div>
                    <div><dt>Moves</dt><dd>{{ candidate.moveNames.join(', ') }}</dd></div>
                    <div><dt>Capabilities</dt><dd>{{ candidate.capabilitySummary.join(' · ') }}</dd></div>
                  </dl>
                  <div class="stat-strip" aria-label="Generated stat totals">
                    <span v-for="(value, key) in candidate.statTotals" :key="key"><small>{{ key }}</small><strong>{{ value }}</strong></span>
                  </div>
                </div>
              </article>
            </div>
            <div v-else class="empty-state compact">
              <strong>No Pokémon passed this preview</strong>
              <span>Nothing rows and active Repel effects used every requested slot. Adjust the request or preview again with changed authority.</span>
            </div>

            <div class="commit-bar">
              <div>
                <strong>Commit selected package</strong>
                <span>Creates ordinary GM-owned campaign sheets. This action is atomic.</span>
              </div>
              <button class="commit-action" type="button" :disabled="!canCommit" @click="commitPackage">
                <PhCheck :size="19" weight="bold" aria-hidden="true" />
                {{ committing ? 'Committing…' : 'Commit package' }}
              </button>
            </div>
          </template>
        </section>
      </div>

      <section v-if="committed" class="accepted-panel" aria-labelledby="accepted-heading">
        <div>
          <p class="section-kicker">Accepted package</p>
          <h2 id="accepted-heading" ref="acceptedHeading" tabindex="-1">{{ committed.sheets.length }} ordinary Pokémon sheets committed</h2>
          <p>{{ committed.exactRetry ? 'Recovered the original accepted result without duplicate writes.' : 'The package is now campaign authority and ready for Encounter Builder assembly.' }}</p>
        </div>
        <ul>
          <li v-for="(sheet, index) in committed.sheets" :key="sheet.slug">
            <NuxtLink :to="`/sheets/${sheet.slug}`">{{ committed.candidates[index]?.speciesId ?? sheet.slug }} · Level {{ committed.candidates[index]?.level }}</NuxtLink>
          </li>
        </ul>
        <div class="accepted-actions">
          <NuxtLink class="builder-action" :to="{ path: '/encounters/new', query: { package: committed.packageId } }">Open in Encounter Builder</NuxtLink>
          <NuxtLink class="prep-action" :to="{ path: '/session-prep', query: { packageKind: 'wild', package: committed.packageId } }">Add to Session prep</NuxtLink>
          <button type="button" @click="startAnother">Generate another</button>
        </div>
      </section>
    </main>

    <main v-else class="access-gate">
      <PhLockKey :size="42" weight="duotone" aria-hidden="true" />
      <h2>GM preparation workspace</h2>
      <p>Wild generation and private candidate material are available only to the active GM.</p>
    </main>

    <p class="sr-only" aria-live="polite">{{ announcement }}</p>
  </div>
</template>

<style scoped>
.toolkit-page { min-height: 100vh; background: radial-gradient(circle at 72% -8%, color-mix(in srgb, var(--accent) 9%, transparent), transparent 30rem), var(--paper); color: var(--ink); }
.toolkit-header { border-bottom: 1px solid var(--rule); padding: 1.5rem clamp(1rem, 4vw, 3rem) 0; background: color-mix(in srgb, var(--paper-soft) 90%, transparent); }
.toolkit-title { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; }
.eyebrow, .section-kicker { margin: 0 0 0.3rem; color: var(--accent); font: 800 0.72rem var(--font-mono); letter-spacing: 0.13em; text-transform: uppercase; }
h1 { margin: 0; font-size: clamp(1.8rem, 4vw, 3rem); letter-spacing: -0.035em; }
h2, h3 { margin: 0; color: var(--ink-bright); }
.toolkit-subtitle { max-width: 760px; margin: 0.65rem 0 1.25rem; color: var(--ink-muted); line-height: 1.55; }
.icon-action { width: 44px; min-height: 44px; display: grid; place-items: center; border: 1px solid var(--rule); border-radius: 9px; background: var(--paper-soft); color: var(--ink); cursor: pointer; }
.icon-action:hover { border-color: var(--accent); color: var(--accent); }
.spinning { animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.wild-workspace { max-width: 1580px; margin: 0 auto; padding: 1.15rem clamp(.75rem, 2vw, 1.5rem) 2rem; }
.notice { display: flex; align-items: flex-start; gap: .65rem; margin-bottom: .8rem; border: 1px solid var(--rule); border-left: 4px solid var(--rt-danger, #ff4553); border-radius: 9px; padding: .75rem .85rem; background: var(--paper-soft); }
.notice > div { display: grid; gap: .15rem; }
.notice span { color: var(--ink-muted); }
.repel-context { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 1rem; margin-bottom: .8rem; border: 1px solid var(--rule); border-left: 4px solid var(--rt-pending, #efb34c); border-radius: 9px; padding: .75rem .9rem; background: var(--paper-soft); }
.repel-context--blocked { border-left-color: var(--rt-danger, #ff4553); }
.repel-context p { margin: 0; color: var(--ink-muted); line-height: 1.45; }
.repel-context a { color: var(--accent); min-height: 44px; display: inline-flex; align-items: center; }
.wild-grid { display: grid; grid-template-columns: minmax(270px, 350px) minmax(0, 1fr); align-items: start; gap: .85rem; }
.setup-panel, .review-panel, .accepted-panel { border: 1px solid var(--rule); border-radius: 12px; background: var(--paper-soft); box-shadow: var(--shadow-card); }
.setup-panel { position: sticky; top: .75rem; padding: 1rem; }
.review-panel { min-height: 32rem; padding: 1rem; }
.panel-heading { display: flex; justify-content: space-between; align-items: flex-start; gap: .75rem; padding-bottom: .8rem; border-bottom: 1px solid var(--rule); }
.panel-heading > svg { color: var(--accent); }
.field-stack { display: grid; gap: .8rem; padding: .9rem 0; }
.field-stack label, .details-fields label { display: grid; gap: .35rem; color: var(--ink); font-size: .82rem; font-weight: 750; }
.field-stack input, .field-stack select, .details-fields input { width: 100%; min-height: 44px; border: 1px solid var(--rule); border-radius: 8px; padding: .55rem .65rem; background: var(--paper); color: var(--ink); font: inherit; }
.field-stack input:focus, .field-stack select:focus, .details-fields input:focus { border-color: var(--accent); outline: 2px solid color-mix(in srgb, var(--accent) 30%, transparent); }
.field-stack small { color: var(--ink-muted); font-weight: 500; line-height: 1.4; }
.field-pair, .details-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .65rem; }
.table-summary { display: grid; gap: .16rem; border-left: 3px solid var(--accent); padding: .45rem .6rem; background: color-mix(in srgb, var(--accent) 6%, transparent); font-size: .78rem; }
.table-summary span, .table-summary small { color: var(--ink-muted); }
details { border: 1px solid var(--rule); border-radius: 8px; padding: .65rem; }
summary { cursor: pointer; font-size: .82rem; font-weight: 750; }
.details-fields { margin-top: .7rem; }
.preview-action, .commit-action, .builder-action, .accepted-actions button { min-height: 44px; display: inline-flex; align-items: center; justify-content: center; gap: .4rem; border-radius: 9px; padding: .65rem .9rem; font: inherit; font-weight: 800; cursor: pointer; text-decoration: none; }
.preview-action { width: 100%; border: 1px solid var(--accent); background: var(--accent); color: var(--paper); }
.preview-action:disabled, .commit-action:disabled { opacity: .48; cursor: not-allowed; }
.inert-note { margin: .55rem 0 0; color: var(--ink-muted); font-size: .74rem; line-height: 1.4; }
.selection-count { border: 1px solid var(--accent); border-radius: 999px; padding: .28rem .55rem; color: var(--accent); font-size: .76rem; font-weight: 800; }
.empty-state { min-height: 24rem; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: .35rem; text-align: center; color: var(--ink-muted); }
.empty-state strong { color: var(--ink); }
.empty-state.compact { min-height: 10rem; }
.preview-banner { display: flex; justify-content: space-between; gap: 1rem; margin: .8rem 0; border: 1px solid color-mix(in srgb, var(--rt-pending, #efb34c) 55%, var(--rule)); border-radius: 8px; padding: .65rem .75rem; background: color-mix(in srgb, var(--rt-pending, #efb34c) 8%, transparent); }
.preview-banner strong { color: var(--rt-pending, #efb34c); }
.preview-banner span { color: var(--ink-muted); }
.candidate-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: .65rem; }
.candidate-card { position: relative; display: grid; grid-template-columns: auto minmax(0, 1fr); gap: .6rem; border: 1px solid var(--rule); border-radius: 10px; padding: .75rem; background: var(--paper); }
.candidate-card--selected { border-color: var(--accent); box-shadow: inset 3px 0 var(--accent); }
.candidate-select { width: 44px; min-height: 44px; display: grid; place-items: center; cursor: pointer; }
.candidate-select input { width: 20px; height: 20px; accent-color: var(--accent); }
.candidate-main { min-width: 0; }
.candidate-title { display: flex; justify-content: space-between; gap: .6rem; }
.slot-label { color: var(--ink-muted); font: 700 .68rem var(--font-mono); text-transform: uppercase; }
.candidate-title h3 { margin-top: .1rem; font-size: 1.2rem; }
.level-chip { align-self: start; border-radius: 999px; padding: .25rem .5rem; background: color-mix(in srgb, var(--accent) 10%, transparent); color: var(--accent); font-size: .72rem; font-weight: 800; }
.candidate-tags { display: flex; flex-wrap: wrap; gap: .28rem; margin: .5rem 0; }
.candidate-tags span { border: 1px solid var(--rule); border-radius: 999px; padding: .18rem .4rem; color: var(--ink-muted); font-size: .7rem; }
.candidate-tags .shiny { border-color: var(--rt-pending, #efb34c); color: var(--rt-pending, #efb34c); }
.candidate-facts { display: grid; gap: .42rem; margin: .6rem 0; }
.candidate-facts div { display: grid; gap: .1rem; }
.candidate-facts dt { color: var(--ink-muted); font: 700 .65rem var(--font-mono); text-transform: uppercase; }
.candidate-facts dd { margin: 0; color: var(--ink-soft); font-size: .76rem; line-height: 1.35; }
.stat-strip { display: grid; grid-template-columns: repeat(6, 1fr); gap: .25rem; }
.stat-strip span { display: grid; justify-items: center; border-top: 1px solid var(--rule); padding-top: .35rem; }
.stat-strip small { color: var(--ink-muted); font: 700 .6rem var(--font-mono); text-transform: uppercase; }
.stat-strip strong { font-size: .8rem; }
.commit-bar { display: flex; justify-content: space-between; align-items: center; gap: 1rem; margin-top: .9rem; border-top: 1px solid var(--rule); padding-top: .9rem; }
.commit-bar > div { display: grid; gap: .15rem; }
.commit-bar span { color: var(--ink-muted); font-size: .76rem; }
.commit-action { flex: 0 0 auto; border: 1px solid var(--rt-danger, #d9424e); background: var(--rt-danger, #d9424e); color: var(--rt-on-brand, #07090d); }
.accepted-panel { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: .75rem 1.25rem; margin-top: .85rem; border-left: 4px solid var(--rt-success, #64d6aa); padding: 1rem; }
.accepted-panel p { margin: .3rem 0 0; color: var(--ink-muted); }
.accepted-panel ul { grid-row: span 2; margin: 0; padding-left: 1.2rem; }
.accepted-panel li + li { margin-top: .25rem; }
.accepted-panel a { color: var(--accent); }
.accepted-actions { display: flex; flex-wrap: wrap; gap: .5rem; }
.builder-action { border: 1px solid var(--accent); background: var(--accent); color: var(--paper) !important; }
.prep-action { min-height: 44px; display: inline-flex; align-items: center; border: 1px solid var(--rule); border-radius: 9px; padding: .65rem .9rem; color: var(--accent); text-decoration: none; font-weight: 800; }
.accepted-actions button { border: 1px solid var(--rule); background: var(--paper); color: var(--ink); }
.access-gate { min-height: 55vh; display: grid; place-content: center; justify-items: center; gap: .45rem; padding: 2rem; text-align: center; color: var(--ink-muted); }
.access-gate h2, .access-gate p { margin: 0; }
button:focus-visible, a:focus-visible, input:focus-visible, select:focus-visible, summary:focus-visible, h2[tabindex]:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
@media (max-width: 850px) {
  .wild-grid { grid-template-columns: 1fr; }
  .setup-panel { position: static; }
  .repel-context, .accepted-panel { grid-template-columns: 1fr; }
  .accepted-panel ul { grid-row: auto; }
}
@media (max-width: 520px) {
  .toolkit-title { align-items: stretch; flex-direction: column; }
  .icon-action { align-self: flex-end; }
  .field-pair, .details-fields { grid-template-columns: 1fr; }
  .preview-banner, .commit-bar { align-items: stretch; flex-direction: column; }
  .commit-action { width: 100%; }
  .candidate-list { grid-template-columns: 1fr; }
}
@media (prefers-reduced-motion: reduce) { .spinning { animation: none; } }
</style>

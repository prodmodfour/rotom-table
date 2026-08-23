<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { parseSkillCheckRoleProjectionResponse, type SkillCheckSpectatorProjectionV1 } from '#shared/skillChecks/projections'
import { useApiClient } from '~/composables/useApiClient'
import { SKILL_CHECK_API_PATHS } from '~/utils/apiRoutes'

const api = useApiClient()
const checks = ref<readonly SkillCheckSpectatorProjectionV1[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const announcement = ref('')
const visibleLimit = ref(20)
const historyLimits = ref<Record<string, number>>({})
let timer: ReturnType<typeof setInterval> | null = null

const visibleChecks = computed(() => checks.value.slice(0, visibleLimit.value))
const historyLimit = (check: SkillCheckSpectatorProjectionV1): number => historyLimits.value[check.checkId] ?? 4
const visibleHistory = (check: SkillCheckSpectatorProjectionV1) => check.history.slice(-historyLimit(check))
const hiddenHistoryCount = (check: SkillCheckSpectatorProjectionV1): number => Math.max(0, check.history.length - visibleHistory(check).length)
const showOlderHistory = (check: SkillCheckSpectatorProjectionV1): void => {
  historyLimits.value = {
    ...historyLimits.value,
    [check.checkId]: Math.min(historyLimit(check) + 20, check.history.length),
  }
}

const errorMessage = (candidate: unknown): string => {
  if (candidate && typeof candidate === 'object') {
    const data = (candidate as { data?: unknown }).data
    if (data && typeof data === 'object' && typeof (data as { message?: unknown }).message === 'string') {
      return (data as { message: string }).message
    }
    if (typeof (candidate as { message?: unknown }).message === 'string') return (candidate as { message: string }).message
  }
  return 'Public Skill Check history is temporarily unavailable.'
}

const load = async (quiet = false): Promise<void> => {
  if (loading.value) return
  loading.value = true
  if (!quiet) error.value = null
  try {
    try { await api.postJson(SKILL_CHECK_API_PATHS.settleExpired, {}) }
    catch { /* Durable public history can still load while writes are paused. */ }
    const response = parseSkillCheckRoleProjectionResponse(await api.getJson(SKILL_CHECK_API_PATHS.projections, {
      params: { limit: 50 },
    }))
    if (response.audience !== 'spectator') throw new Error('The server returned the wrong Skill Check audience.')
    const previous = checks.value.map(check => `${check.checkId}:${check.revision}`).join('|')
    checks.value = response.checks
    const current = response.checks.map(check => `${check.checkId}:${check.revision}`).join('|')
    if (!quiet || (previous && previous !== current)) {
      announcement.value = `${response.checks.length} public Skill Check ${response.checks.length === 1 ? 'update' : 'updates'} loaded.`
    }
  }
  catch (candidate) {
    if (!quiet) error.value = errorMessage(candidate)
  }
  finally { loading.value = false }
}

const stateLabel = (check: SkillCheckSpectatorProjectionV1): string => {
  if (check.state === 'pending') return 'Waiting'
  if (check.state === 'ready') return 'Awaiting resolution'
  if (check.state === 'accepted') return 'Resolved'
  if (check.state === 'cancelled') return 'Cancelled'
  return 'Timed out'
}
const summary = (check: SkillCheckSpectatorProjectionV1): string => {
  if (check.state === 'pending') return `${check.pendingCount} ${check.pendingCount === 1 ? 'response' : 'responses'} pending`
  if (check.state === 'ready') return 'Every required response is ready'
  if (check.state === 'cancelled') return 'The request was cancelled'
  if (check.state === 'timed-out') return 'The request expired'
  if (check.result?.visibility !== 'visible') return 'Result kept private'
  if ((check.result.winners ?? 0) + (check.result.losers ?? 0) > 0) {
    return `${check.result.winners} ${check.result.winners === 1 ? 'winner' : 'winners'} · ${check.result.losers} ${check.result.losers === 1 ? 'loser' : 'losers'}`
  }
  return `${check.result.successfulSubjects} ${check.result.successfulSubjects === 1 ? 'success' : 'successes'} · ${check.result.failedSubjects} ${check.result.failedSubjects === 1 ? 'failure' : 'failures'}`
}

onMounted(() => {
  void load()
  timer = setInterval(() => { if (checks.value.length > 0) void load(true) }, 5_000)
})
onBeforeUnmount(() => { if (timer) clearInterval(timer) })
</script>

<template>
  <section v-if="loading || checks.length || error" class="public-checks" aria-labelledby="public-skill-checks-heading" :aria-busy="loading">
    <header>
      <div>
        <h3 id="public-skill-checks-heading">Skill checks</h3>
        <span>{{ checks.length }}</span>
      </div>
      <button type="button" :disabled="loading" @click="load()">{{ loading ? 'Refreshing…' : 'Refresh' }}</button>
    </header>
    <p class="sr-only" role="status">{{ announcement }}</p>
    <p v-if="error" class="public-checks__error" role="alert">{{ error }}</p>
    <article
      v-for="(check, index) in visibleChecks"
      :key="check.checkId"
      class="public-checks__entry"
      :class="`public-checks__entry--${check.state}`"
      :aria-labelledby="`public-check-${index}`"
    >
      <div class="public-checks__copy">
        <p>{{ stateLabel(check) }}</p>
        <h4 :id="`public-check-${index}`">{{ check.publicLabel }}</h4>
        <span>{{ summary(check) }}</span>
      </div>
      <details class="public-checks__history">
        <summary>Public history · {{ check.history.length }}</summary>
        <ol>
          <li v-for="entry in visibleHistory(check)" :key="entry.entryId">
            <span>{{ entry.headline }}</span>
            <time :datetime="new Date(entry.createdAt).toISOString()">{{ new Date(entry.createdAt).toLocaleString() }}</time>
          </li>
        </ol>
        <button
          v-if="hiddenHistoryCount(check)"
          type="button"
          class="public-checks__history-more"
          @click="showOlderHistory(check)"
        >Show {{ Math.min(20, hiddenHistoryCount(check)) }} older history entries</button>
      </details>
    </article>
    <button
      v-if="visibleChecks.length < checks.length"
      type="button"
      class="public-checks__more"
      @click="visibleLimit = Math.min(visibleLimit + 20, checks.length)"
    >Show {{ Math.min(20, checks.length - visibleChecks.length) }} more Skill Check updates</button>
  </section>
</template>

<style scoped>
.public-checks { display: grid; gap: var(--rt-space-3); padding-block: var(--rt-space-3); border-block: 1px solid var(--rt-rule); }
.public-checks > header { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--rt-space-3); }
.public-checks button { min-height: var(--rt-touch-minimum); border: 1px solid var(--rt-rule); background: var(--rt-bg-canvas); color: var(--rt-text-strong); font: inherit; font-weight: 700; }
.public-checks > header > div { display: flex; align-items: center; gap: var(--rt-space-2); }
.public-checks h3, .public-checks h4 { margin: 0; overflow-wrap: anywhere; }
.public-checks > header span { display: grid; place-items: center; min-width: 2rem; min-height: 2rem; border: 1px solid var(--rt-rule); color: var(--rt-text-muted); font-family: var(--rt-font-numeric); }
.public-checks__error { margin: 0; padding: .6rem; border-inline-start: 3px solid var(--rt-danger); background: var(--rt-surface-2); }
.public-checks__entry { display: grid; border: 1px solid var(--rt-rule); border-inline-start: 3px solid var(--rt-pending); background: var(--rt-surface-2); }
.public-checks__entry--accepted { border-inline-start-color: var(--rt-success); }
.public-checks__entry--cancelled, .public-checks__entry--timed-out { border-inline-start-color: var(--rt-text-muted); }
.public-checks__copy { display: grid; gap: .2rem; padding: var(--rt-space-3); }
.public-checks__copy p { margin: 0; color: var(--rt-pending); font-size: var(--rt-type-label-sm-size); font-weight: 800; letter-spacing: .07em; text-transform: uppercase; }
.public-checks__entry--accepted .public-checks__copy p { color: var(--rt-success); }
.public-checks__entry--cancelled .public-checks__copy p, .public-checks__entry--timed-out .public-checks__copy p { color: var(--rt-text-muted); }
.public-checks__copy span { color: var(--rt-text-muted); }
.public-checks__history { border-top: 1px solid var(--rt-rule); }
.public-checks__history summary { min-height: var(--rt-touch-minimum); display: flex; align-items: center; padding: .6rem var(--rt-space-3); cursor: pointer; color: var(--rt-text-muted); font-weight: 700; }
.public-checks__history ol { display: grid; margin: 0; padding: 0; border-top: 1px solid var(--rt-rule); list-style: none; }
.public-checks__history li { display: grid; gap: .15rem; padding: .55rem var(--rt-space-3); }
.public-checks__history li + li { border-top: 1px solid var(--rt-rule); }
.public-checks__history time { color: var(--rt-text-muted); font-size: var(--rt-type-label-sm-size); }
.public-checks__history-more, .public-checks__more { width: 100%; min-height: var(--rt-touch-minimum); border-color: var(--rt-rule); background: var(--rt-bg-canvas); color: var(--rt-focus); font-weight: 800; }
.public-checks__history-more { border: 0; border-top: 1px solid var(--rt-rule); border-radius: 0; }
@media (prefers-reduced-motion: reduce) {
  .public-checks { scroll-behavior: auto; }
}
</style>

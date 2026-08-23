<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { RespondSkillCheckCommandV1 } from '#shared/skillChecks/contract'
import {
  parseLoadSubjectSkillChecksResponse,
  parseRespondSubjectSkillCheckResponse,
  type SkillCheckSubjectRequestViewV1,
} from '#shared/skillChecks/subjectWorkflow'
import { useApiClient } from '~/composables/useApiClient'
import { SKILL_CHECK_API_PATHS } from '~/utils/apiRoutes'

const props = withDefaults(defineProps<{
  profileId?: string | null
  gm?: boolean
  commandsBlocked?: boolean
}>(), {
  profileId: null,
  gm: false,
  commandsBlocked: false,
})

const api = useApiClient()
const requests = ref<readonly SkillCheckSubjectRequestViewV1[]>([])
const serverNow = ref(Date.now())
const loading = ref(false)
const busy = ref(false)
const error = ref<string | null>(null)
const announcement = ref('')
const uncertainCommand = ref<RespondSkillCheckCommandV1 | null>(null)
const dismissed = ref<ReadonlySet<string>>(new Set())
const heading = ref<HTMLElement | null>(null)
const statusRegion = ref<HTMLElement | null>(null)
const historyLimit = ref(20)
let refreshTimer: ReturnType<typeof setInterval> | null = null
let clockTimer: ReturnType<typeof setInterval> | null = null

const requestKey = (request: SkillCheckSubjectRequestViewV1): string => `${request.checkId}:${request.subjectId}:${request.revision}`
const requestIdentity = (request: SkillCheckSubjectRequestViewV1): string => `${request.checkId}:${request.subjectId}`
const priority = (request: SkillCheckSubjectRequestViewV1): number => {
  if (request.canRespond) return 0
  if (request.state === 'accepted') return 1
  if (request.response === 'declined' || request.state === 'timed-out') return 2
  return 3
}
const activeRequest = computed(() => [...requests.value]
  .filter(request => !dismissed.value.has(requestKey(request)))
  .sort((left, right) => priority(left) - priority(right) || right.updatedAt - left.updatedAt)[0] ?? null)
const otherRequestCount = computed(() => requests.value.filter(request => (
  activeRequest.value && requestKey(request) !== requestKey(activeRequest.value)
  && !dismissed.value.has(requestKey(request))
)).length)
const visibleHistory = computed(() => activeRequest.value?.history.slice(-historyLimit.value) ?? [])
const hiddenHistoryCount = computed(() => Math.max(0, (activeRequest.value?.history.length ?? 0) - visibleHistory.value.length))

const titleCase = (value: string): string => value.split('-')
  .map(part => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join(' ')
const modifierText = (value: number): string => value === 0 ? '' : value > 0 ? ` + ${value}` : ` − ${Math.abs(value)}`
const poolLabel = (request: SkillCheckSubjectRequestViewV1): string => request.skillAuthority.status === 'available'
  ? `${request.skillAuthority.diceCount}d6${modifierText(request.skillAuthority.visibleFlatModifier)}`
  : 'Unavailable'
const comparisonLabel = (request: SkillCheckSubjectRequestViewV1): string => {
  if (request.comparison.kind === 'opposed') return 'Opposed check'
  if (request.comparison.difficultyClass !== null) return `DC ${request.comparison.difficultyClass}`
  return request.comparison.disclosure === 'gm-only' ? 'Known only to the GM' : 'Revealed after acceptance'
}
const stateLabel = (request: SkillCheckSubjectRequestViewV1): string => {
  if (request.canRespond) return 'Skill Check requested'
  if (request.state === 'accepted') return request.result?.visibility === 'visible' ? 'Skill Check resolved' : 'Result withheld'
  if (request.state === 'timed-out') return 'Skill Check timed out'
  if (request.response === 'declined') return 'Skill Check declined'
  if (request.response === 'accepted') return 'Response recorded'
  return 'Skill Check unavailable'
}
const expiryLabel = (expiresAt: number | null): string => {
  if (expiresAt === null) return 'No expiry'
  const seconds = Math.max(0, Math.ceil((expiresAt - serverNow.value) / 1000))
  if (seconds === 0) return 'Expired'
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
const unavailableLabel = (reason: SkillCheckSubjectRequestViewV1['unavailableReason']): string | null => {
  if (reason === 'skill-authority-unavailable') return 'The authoritative sheet or skill changed. Ask the GM to issue a current request.'
  if (reason === 'expired-awaiting-timeout') return 'This request expired and is waiting for server settlement.'
  if (reason === 'already-responded') return null
  if (reason === 'check-not-pending') return 'This request no longer accepts responses.'
  return null
}

const operationId = (): RespondSkillCheckCommandV1['operationId'] => {
  if (!globalThis.crypto?.randomUUID) throw new Error('Secure response identity is unavailable in this browser.')
  return `skill-check-op:v1:${globalThis.crypto.randomUUID().toLowerCase()}`
}
const errorMessage = (candidate: unknown): string => {
  if (candidate && typeof candidate === 'object') {
    const data = (candidate as { data?: unknown }).data
    if (data && typeof data === 'object' && typeof (data as { message?: unknown }).message === 'string') {
      return (data as { message: string }).message
    }
    if (typeof (candidate as { message?: unknown }).message === 'string') return (candidate as { message: string }).message
  }
  return 'The Skill Check response could not be confirmed.'
}

const load = async (quiet = false): Promise<void> => {
  if (loading.value || (!props.gm && !props.profileId)) return
  loading.value = true
  if (!quiet) error.value = null
  try {
    try { await api.postJson(SKILL_CHECK_API_PATHS.settleExpired, {}) }
    catch { /* A read-only/reconnecting client can still load the last durable projection. */ }
    const response = parseLoadSubjectSkillChecksResponse(await api.getJson(SKILL_CHECK_API_PATHS.subject, {
      params: {
        ...(props.gm ? {} : { profileId: props.profileId }),
        limit: 100,
      },
    }))
    requests.value = response.requests
    serverNow.value = response.serverNow
  }
  catch (candidate) {
    if (!quiet) error.value = errorMessage(candidate)
  }
  finally { loading.value = false }
}

const announce = async (message: string): Promise<void> => {
  announcement.value = message
  await nextTick()
  statusRegion.value?.focus({ preventScroll: true })
}

const send = async (command: RespondSkillCheckCommandV1): Promise<void> => {
  if (busy.value) return
  busy.value = true
  error.value = null
  uncertainCommand.value = command
  try {
    const response = parseRespondSubjectSkillCheckResponse(await api.postJson(SKILL_CHECK_API_PATHS.subject, {
      command,
      ...(props.gm ? {} : { profileId: props.profileId }),
    }))
    uncertainCommand.value = null
    requests.value = [response.request, ...requests.value.filter(request => (
      request.checkId !== response.request.checkId || request.subjectId !== response.request.subjectId
    ))]
    await announce(response.receipt.response === 'accepted'
      ? `${response.request.publicLabel}: response recorded.`
      : `${response.request.publicLabel}: declined.`)
    void load(true)
  }
  catch (candidate) {
    error.value = `${errorMessage(candidate)} Retry the exact response before choosing again.`
    await announce('Skill Check response outcome is uncertain.')
  }
  finally { busy.value = false }
}

const respond = async (decision: 'accept' | 'decline'): Promise<void> => {
  const request = activeRequest.value
  if (!request || !request.canRespond || props.commandsBlocked || uncertainCommand.value) return
  if (decision === 'decline' && !request.canDecline) return
  try {
    await send({
      schemaVersion: 1,
      operationId: operationId(),
      expectedRevision: request.revision,
      commandKind: 'respond',
      checkId: request.checkId,
      subjectId: request.subjectId,
      decision,
    })
  }
  catch (candidate) { error.value = errorMessage(candidate) }
}
const retryExact = async (): Promise<void> => {
  if (uncertainCommand.value) await send(uncertainCommand.value)
}
const dismiss = async (): Promise<void> => {
  const request = activeRequest.value
  if (!request || request.canRespond) return
  dismissed.value = new Set([...dismissed.value, requestKey(request)])
  await nextTick()
  if (!activeRequest.value) document.getElementById('encounter-action-dock')?.focus({ preventScroll: true })
}
const handleDialogEscape = (): void => {
  if (activeRequest.value && !activeRequest.value.canRespond) void dismiss()
}

watch(activeRequest, async (next, prior) => {
  if (!next || requestIdentity(next) === (prior ? requestIdentity(prior) : null)) return
  historyLimit.value = 20
  await nextTick()
  heading.value?.focus({ preventScroll: true })
}, { immediate: true })
watch(() => [props.profileId, props.gm] as const, () => { void load() })

onMounted(() => {
  void load()
  refreshTimer = setInterval(() => { if (requests.value.length > 0) void load(true) }, 5_000)
  clockTimer = setInterval(() => { serverNow.value += 1_000 }, 1_000)
})
onBeforeUnmount(() => {
  if (refreshTimer) clearInterval(refreshTimer)
  if (clockTimer) clearInterval(clockTimer)
})
</script>

<template>
  <p v-if="error && !activeRequest" class="subject-check-load-error" role="alert">{{ error }}</p>
  <section
    v-if="activeRequest"
    class="subject-check rt-surface"
    :class="`subject-check--${activeRequest.state}`"
    role="dialog"
    aria-modal="false"
    aria-labelledby="subject-check-heading"
    aria-describedby="subject-check-prompt subject-check-announcement"
    :aria-busy="loading || busy"
    data-rt-elevation="3"
    @keydown.esc="handleDialogEscape"
  >
    <header>
      <div>
        <p class="subject-check__eyebrow">{{ stateLabel(activeRequest) }}</p>
        <h2 id="subject-check-heading" ref="heading" tabindex="-1">{{ activeRequest.publicLabel }}</h2>
      </div>
      <button
        v-if="!activeRequest.canRespond"
        type="button"
        aria-label="Dismiss Skill Check status"
        @click="dismiss"
      >×</button>
    </header>

    <p id="subject-check-announcement" ref="statusRegion" class="subject-check__announcement" role="status" tabindex="-1">{{ announcement }}</p>
    <p id="subject-check-prompt" class="subject-check__prompt">{{ activeRequest.prompt }}</p>

    <div class="subject-check__identity">
      <span aria-hidden="true">{{ activeRequest.subjectKind === 'trainer' ? '◇' : '◈' }}</span>
      <div>
        <strong>{{ activeRequest.subjectLabel }}</strong>
        <small>{{ titleCase(activeRequest.subjectKind) }} · {{ titleCase(activeRequest.skillAuthority.skillId) }}</small>
      </div>
    </div>

    <section class="subject-check__authority" aria-labelledby="subject-check-authority-heading">
      <p id="subject-check-authority-heading">Your check</p>
      <strong class="subject-check__pool">{{ poolLabel(activeRequest) }}</strong>
      <template v-if="activeRequest.skillAuthority.status === 'available'">
        <dl v-if="activeRequest.skillAuthority.contributors.length">
          <div v-for="(contributor, index) in activeRequest.skillAuthority.contributors" :key="`${contributor.label}:${index}`">
            <dt>{{ contributor.label }}</dt>
            <dd>{{ contributor.value > 0 ? `+${contributor.value}` : contributor.value }}</dd>
          </div>
        </dl>
        <p v-else class="subject-check__muted">No visible flat modifiers.</p>
        <p v-if="activeRequest.skillAuthority.privateGmAdjustment === 'may-apply'" class="subject-check__private">
          <span aria-hidden="true">▣</span> A private GM adjustment may apply.
        </p>
      </template>
    </section>

    <dl class="subject-check__facts">
      <div><dt>Difficulty</dt><dd>{{ comparisonLabel(activeRequest) }}</dd></div>
      <div><dt>Group response</dt><dd>{{ activeRequest.group.acceptedCount }} of {{ activeRequest.group.subjectCount }} ready</dd></div>
      <div><dt>Expires in</dt><dd>{{ expiryLabel(activeRequest.expiresAt) }}</dd></div>
    </dl>

    <section v-if="activeRequest.state === 'accepted'" class="subject-check__result" aria-labelledby="subject-check-result-heading">
      <h3 id="subject-check-result-heading">Your result</h3>
      <template v-if="activeRequest.result?.visibility === 'visible'">
        <strong>{{ activeRequest.result.finalTotal }}</strong>
        <span>{{ titleCase(activeRequest.result.outcome ?? '') }}</span>
      </template>
      <p v-else>The GM kept this result private.</p>
    </section>
    <p v-else-if="activeRequest.response === 'accepted'" class="subject-check__notice">Your response is recorded. The server will roll only when every required subject is ready and the GM resolves the check.</p>
    <p v-else-if="activeRequest.response === 'declined'" class="subject-check__notice">You declined this request. The response is durable; the GM may cancel it or let it time out.</p>
    <p v-else-if="activeRequest.state === 'timed-out'" class="subject-check__notice">This request expired before it was resolved.</p>
    <p v-else-if="unavailableLabel(activeRequest.unavailableReason)" class="subject-check__notice">{{ unavailableLabel(activeRequest.unavailableReason) }}</p>
    <p v-else class="subject-check__server-note">The server rolls after every required subject accepts.</p>

    <details class="subject-check__history">
      <summary>Request history · {{ activeRequest.history.length }}</summary>
      <ol>
        <li v-for="entry in visibleHistory" :key="entry.entryId">
          <span>{{ entry.headline }}</span>
          <time :datetime="new Date(entry.createdAt).toISOString()">{{ new Date(entry.createdAt).toLocaleString() }}</time>
        </li>
      </ol>
      <button
        v-if="hiddenHistoryCount"
        type="button"
        class="subject-check__history-more"
        @click="historyLimit = Math.min(historyLimit + 20, activeRequest.history.length)"
      >Show {{ Math.min(20, hiddenHistoryCount) }} older history entries</button>
    </details>

    <div v-if="error" class="subject-check__error" role="alert">
      <p>{{ error }}</p>
      <button v-if="uncertainCommand" type="button" :disabled="busy" @click="retryExact">Retry exact response</button>
      <button type="button" :disabled="loading" @click="load()">Refresh authority</button>
    </div>

    <footer>
      <template v-if="activeRequest.canRespond">
        <button
          type="button"
          class="subject-check__primary"
          :disabled="commandsBlocked || busy || Boolean(uncertainCommand)"
          @click="respond('accept')"
        >{{ busy ? 'Sending…' : 'Take the check' }}</button>
        <button
          v-if="activeRequest.canDecline"
          type="button"
          :disabled="commandsBlocked || busy || Boolean(uncertainCommand)"
          @click="respond('decline')"
        >Decline</button>
      </template>
      <button v-else type="button" @click="dismiss">Dismiss</button>
    </footer>
    <p v-if="otherRequestCount" class="subject-check__queue">{{ otherRequestCount }} more Skill Check {{ otherRequestCount === 1 ? 'update' : 'updates' }} waiting</p>
  </section>
</template>

<style scoped>
.subject-check-load-error { width: min(28rem, calc(100% - 1.5rem)); margin: 1rem auto; padding: .65rem; border-inline-start: 3px solid var(--rt-danger); background: var(--rt-surface-1); }
.subject-check { width: min(28rem, calc(100% - 1.5rem)); max-height: min(82dvh, 48rem); display: grid; gap: var(--rt-space-3); margin: 1rem auto; overflow: auto; padding: var(--rt-space-4); border: 1px solid var(--rt-rule); border-inline-start: 3px solid var(--rt-pending); background: var(--rt-surface-1); }
.subject-check--accepted { border-inline-start-color: var(--rt-success); }
.subject-check > header { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--rt-space-3); }
.subject-check button, .subject-check summary { min-height: var(--rt-touch-minimum); }
.subject-check button { border: 1px solid var(--rt-rule); background: var(--rt-bg-canvas); color: var(--rt-text-strong); font: inherit; font-weight: 700; }
.subject-check h2, .subject-check h3 { margin: 0; color: var(--rt-text-strong); }
.subject-check__eyebrow, .subject-check__authority > p:first-child { margin: 0 0 .25rem; color: var(--rt-pending); font-size: var(--rt-type-label-sm-size); font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
.subject-check--accepted .subject-check__eyebrow { color: var(--rt-success); }
.subject-check > header button { width: var(--rt-touch-minimum); height: var(--rt-touch-minimum); flex: 0 0 auto; font-size: 1.25rem; }
.subject-check__announcement:empty { position: absolute; }
.subject-check__announcement:not(:empty) { margin: 0; padding: .55rem; border-inline-start: 3px solid var(--rt-focus); background: var(--rt-surface-2); }
.subject-check__announcement:focus { outline: 2px solid var(--rt-focus); outline-offset: 2px; }
.subject-check__prompt { margin: 0; color: var(--rt-text); line-height: 1.5; }
.subject-check__identity { display: flex; align-items: center; gap: var(--rt-space-3); padding-block: var(--rt-space-2); }
.subject-check__identity > span { display: grid; place-items: center; width: 2.75rem; height: 2.75rem; flex: 0 0 auto; border: 1px solid var(--rt-rule); background: var(--rt-surface-2); color: var(--rt-focus); }
.subject-check__identity > div { display: grid; }
.subject-check small, .subject-check__muted { color: var(--rt-text-muted); }
.subject-check__authority { display: grid; gap: var(--rt-space-2); padding: var(--rt-space-3); border: 1px solid var(--rt-rule); background: var(--rt-bg-canvas); }
.subject-check__pool { color: var(--rt-text-strong); font-family: var(--rt-font-numeric); font-size: clamp(1.8rem, 8vw, 2.35rem); text-align: center; }
.subject-check__authority dl, .subject-check__facts { margin: 0; }
.subject-check__authority dl > div, .subject-check__facts > div { display: flex; justify-content: space-between; gap: var(--rt-space-3); padding: .45rem 0; border-top: 1px solid var(--rt-rule); }
.subject-check__authority dd, .subject-check__facts dd { margin: 0; color: var(--rt-text-strong); font-family: var(--rt-font-numeric); font-weight: 800; text-align: end; }
.subject-check__private { margin: 0; color: var(--rt-text-muted); }
.subject-check__private span { color: var(--rt-pending); }
.subject-check__facts dt { color: var(--rt-text-muted); }
.subject-check__result { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: .25rem var(--rt-space-3); padding: var(--rt-space-3); border-inline-start: 3px solid var(--rt-success); background: var(--rt-surface-2); }
.subject-check__result h3, .subject-check__result p { grid-column: 1 / -1; }
.subject-check__result strong { color: var(--rt-text-strong); font-family: var(--rt-font-numeric); font-size: 2rem; }
.subject-check__result span { color: var(--rt-success); font-weight: 800; text-transform: uppercase; }
.subject-check__notice, .subject-check__server-note { margin: 0; padding: .65rem; border-inline-start: 3px solid var(--rt-pending); background: var(--rt-surface-2); line-height: 1.45; }
.subject-check__server-note { color: var(--rt-text-muted); }
.subject-check__history { border: 1px solid var(--rt-rule); background: var(--rt-surface-2); }
.subject-check__history summary { min-height: var(--rt-touch-minimum); padding: .65rem; cursor: pointer; font-weight: 800; }
.subject-check__history ol { display: grid; margin: 0; padding: 0; border-top: 1px solid var(--rt-rule); list-style: none; }
.subject-check__history li { display: grid; gap: .15rem; padding: .6rem; }
.subject-check__history li + li { border-top: 1px solid var(--rt-rule); }
.subject-check__history time { color: var(--rt-text-muted); font-size: var(--rt-type-label-sm-size); }
.subject-check__history-more { width: 100%; min-height: var(--rt-touch-minimum); border: 0; border-top: 1px solid var(--rt-rule); border-radius: 0; background: var(--rt-bg-canvas); color: var(--rt-focus); font-weight: 800; }
.subject-check__error { display: grid; gap: var(--rt-space-2); padding: .65rem; border-inline-start: 3px solid var(--rt-danger); background: color-mix(in srgb, var(--rt-danger) 10%, var(--rt-surface-2)); }
.subject-check__error p { margin: 0; }
.subject-check footer { display: grid; gap: var(--rt-space-2); }
.subject-check footer button { min-height: var(--rt-touch-minimum); width: 100%; }
.subject-check__primary { border-color: var(--rt-focus); background: color-mix(in srgb, var(--rt-focus) 14%, var(--rt-surface-2)); color: var(--rt-text-strong); font-weight: 800; }
.subject-check__queue { margin: 0; color: var(--rt-text-muted); font-size: var(--rt-type-label-sm-size); text-align: center; }
@media (max-width: 32rem) {
  .subject-check { width: 100%; max-height: 86dvh; margin: auto 0 0; border-inline: 0; border-block-end: 0; border-radius: var(--rt-radius-medium) var(--rt-radius-medium) 0 0; }
  .subject-check__facts > div { display: grid; gap: .15rem; }
  .subject-check__facts dd { text-align: start; }
}
@media (prefers-reduced-motion: reduce) {
  .subject-check { scroll-behavior: auto; }
}
</style>

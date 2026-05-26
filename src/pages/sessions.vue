<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import AppNavigation from '~/components/AppNavigation.vue'
import { useSessionLobby } from '~/composables/useSessionLobby'
import {
  SESSION_LOBBY_GM_SECTION_ID,
  SESSION_LOBBY_PLAYER_SECTION_ID,
  SESSION_LOBBY_REMEMBERED_SECTION_ID,
} from '~/utils/appRoutes'
import type {
  PlayerAssignmentRecord,
  SessionControllableResourceRef,
  SessionVisibleResourceRef,
} from '#shared/sessionPermissions'

useHead({ title: 'Live session lobby · Rotom Table' })

const { isGm, roleLabel } = useAuth()
const joinCode = ref('')
const displayName = ref('')

const {
  identity,
  gmManagement,
  playerState,
  safetyStatus,
  safetyError,
  busy,
  lastError,
  lastNotice,
  gmJoinCode,
  gmSession,
  playerSession,
  playerIdentity,
  loadSafetyStatus,
  startGmSession,
  joinPlayerSession,
  refreshSessionSummary,
  loadRememberedIdentity,
  clearRememberedIdentity,
} = useSessionLobby()

const hasGmIdentity = computed(() => identity.value?.role === 'gm')
const hasPlayerIdentity = computed(() => identity.value?.role === 'player')
const canJoin = computed(() =>
  joinCode.value.trim().length > 0 && displayName.value.trim().length > 0 && !busy.value,
)
const currentSessionId = computed(() => gmSession.value?.sessionId ?? playerSession.value?.sessionId ?? null)
const safetyBannerSeverity = computed(() => safetyStatus.value?.severity ?? 'unknown')
const safetyTitle = computed(() => safetyStatus.value?.title ?? 'Checking live session hosting safety')
const safetySummary = computed(() => safetyStatus.value?.summary
  ?? 'Rotom Table is checking whether live session hosting is disabled, local-only, LAN reachable, or remotely exposed.')
const safetyFlagLabel = computed(() => {
  if (!safetyStatus.value) return 'Checking'
  return safetyStatus.value.hostEnabled ? 'Enabled' : 'Disabled'
})
const safetyExposureLabel = computed(() => safetyStatus.value?.exposure ?? 'checking')
const safetyHostLabel = computed(() => safetyStatus.value?.effectiveHost ?? '—')
const safetySessionReadinessLabel = computed(() => {
  const status = safetyStatus.value
  if (!status) return 'Checking'

  const activeCount = status.sessionSettings.activeSessionCount
  const activeLabel = activeCount === null
    ? 'unknown active sessions'
    : `${activeCount} active session${activeCount === 1 ? '' : 's'}`
  return `${status.sessionReadiness} · ${activeLabel}`
})
const safetyWarnings = computed(() => safetyStatus.value?.warnings ?? [
  'Until the safety check responds, treat this page as local prep and do not share join codes.',
])
const safetyActions = computed(() => safetyStatus.value?.recommendedActions ?? [
  'Refresh the page if the safety banner does not finish loading.',
])

const safeRefresh = async () => {
  try {
    await refreshSessionSummary()
  } catch {
    // The composable stores a user-safe error string for the page.
  }
}

const handleStartSession = async () => {
  try {
    await startGmSession()
  } catch {
    // The composable stores a user-safe error string for the page.
  }
}

const handleJoinSession = async () => {
  if (!canJoin.value) return

  try {
    await joinPlayerSession({ joinCode: joinCode.value, displayName: displayName.value })
    joinCode.value = ''
  } catch {
    // The composable stores a user-safe error string for the page.
  }
}

const resourceLabel = (resource: SessionControllableResourceRef | SessionVisibleResourceRef): string => {
  if (resource.kind === 'map') return `Map ${resource.mapSlug}`
  if (resource.kind === 'sheet') return `${resource.sheetKind} sheet ${resource.sheetSlug}`

  const tokenParts = [resource.tokenId]
  if (resource.mapSlug) tokenParts.push(`map ${resource.mapSlug}`)
  if (resource.sheetSlug) tokenParts.push(`sheet ${resource.sheetSlug}`)
  return `Token ${tokenParts.join(' · ')}`
}

const assignmentSummary = (assignment: PlayerAssignmentRecord): string =>
  `${assignment.controllableResources.length} controllable · ${assignment.visibleResources.length} visible`

onMounted(() => {
  void loadSafetyStatus().catch(() => undefined)
  void loadRememberedIdentity({ refresh: true }).catch(() => undefined)
})
</script>

<template>
  <main class="session-lobby-page">
    <AppNavigation />

    <section
      class="safety-banner panel-card"
      :class="`safety-banner--${safetyBannerSeverity}`"
      aria-labelledby="session-safety-title"
    >
      <div class="safety-banner__main">
        <p class="eyebrow">Live session safety</p>
        <h2 id="session-safety-title">{{ safetyTitle }}</h2>
        <p>{{ safetySummary }}</p>
        <p v-if="safetyError" class="safety-banner__error" role="status">
          Could not refresh hosting safety status: {{ safetyError }}
        </p>
      </div>
      <dl class="safety-facts" aria-label="Live session hosting safety state">
        <div>
          <dt>Host flag</dt>
          <dd>{{ safetyFlagLabel }}</dd>
        </div>
        <div>
          <dt>Exposure</dt>
          <dd>{{ safetyExposureLabel }}</dd>
        </div>
        <div>
          <dt>Effective host</dt>
          <dd>{{ safetyHostLabel }}</dd>
        </div>
        <div>
          <dt>Live session readiness</dt>
          <dd>{{ safetySessionReadinessLabel }}</dd>
        </div>
      </dl>
      <div class="safety-banner__lists">
        <section aria-labelledby="session-safety-warnings-title">
          <h3 id="session-safety-warnings-title">Warnings</h3>
          <ul>
            <li v-for="warning in safetyWarnings" :key="warning">{{ warning }}</li>
          </ul>
        </section>
        <section aria-labelledby="session-safety-actions-title">
          <h3 id="session-safety-actions-title">Before sharing</h3>
          <ul>
            <li v-for="action in safetyActions" :key="action">{{ action }}</li>
          </ul>
        </section>
      </div>
    </section>

    <section class="session-hero panel-card" aria-labelledby="session-lobby-title">
      <p class="eyebrow">Session hosting</p>
      <h1 id="session-lobby-title">Live session lobby</h1>
      <p class="hero-copy">
        Start a GM-hosted live session, share a join code, or join with a
        session-local display name. This lobby is additive: the existing local
        trust login still gates the app while live session identity is active.
      </p>
      <dl class="session-facts">
        <div>
          <dt>Local login</dt>
          <dd>{{ roleLabel }}</dd>
        </div>
        <div>
          <dt>Remembered live session</dt>
          <dd>{{ identity ? identity.role.toUpperCase() : 'None' }}</dd>
        </div>
        <div>
          <dt>Session ID</dt>
          <dd>{{ currentSessionId ?? '—' }}</dd>
        </div>
      </dl>
    </section>

    <p v-if="lastError" class="lobby-message lobby-message--error" role="alert">
      {{ lastError }}
    </p>
    <p v-else-if="lastNotice" class="lobby-message" role="status">
      {{ lastNotice }}
    </p>

    <section class="lobby-grid" aria-label="Live session lobby actions">
      <article class="lobby-card panel-card" aria-labelledby="gm-lobby-title">
        <div class="card-heading">
          <p class="eyebrow">Session hosting</p>
          <h2 :id="SESSION_LOBBY_GM_SECTION_ID">Start and manage live session</h2>
        </div>
        <p class="card-copy">
          Creates a server-owned live session, a private GM key stored only
          in this browser, and a player join code. Session hosting still requires
          <code>ROTOM_ENABLE_SESSION_HOST=1</code> and the local GM role.
        </p>

        <div class="action-row">
          <button
            type="button"
            class="primary-button"
            :disabled="busy || !isGm"
            @click="handleStartSession"
          >
            {{ hasGmIdentity ? 'Start another live session' : 'Start GM live session' }}
          </button>
          <button
            type="button"
            class="secondary-button"
            :disabled="busy || !hasGmIdentity"
            @click="safeRefresh"
          >
            Refresh lobby
          </button>
        </div>

        <p v-if="!isGm" class="hint-text">
          Choose the existing GM Login before starting a live session. This is
          not public authentication; it is only the current local trust picker.
        </p>

        <div v-if="hasGmIdentity" class="session-summary">
          <div class="code-panel" aria-label="Player join code">
            <span>Player join code</span>
            <strong>{{ gmJoinCode ?? 'Refresh required' }}</strong>
          </div>

          <dl class="detail-list">
            <div>
              <dt>Status</dt>
              <dd>{{ gmSession?.status ?? '—' }}</dd>
            </div>
            <div>
              <dt>Revision</dt>
              <dd>{{ gmSession?.revision ?? '—' }}</dd>
            </div>
            <div>
              <dt>Players</dt>
              <dd>{{ gmManagement?.players.length ?? 0 }}</dd>
            </div>
            <div>
              <dt>Assignments</dt>
              <dd>{{ gmManagement?.assignments.length ?? 0 }}</dd>
            </div>
          </dl>

          <section class="mini-section" aria-labelledby="joined-players-title">
            <h3 id="joined-players-title">Joined players</h3>
            <p v-if="!gmManagement || gmManagement.players.length === 0" class="empty-text">
              No players have joined this live session yet.
            </p>
            <ul v-else class="player-list">
              <li v-for="player in gmManagement.players" :key="player.playerId">
                <span>{{ player.displayName }}</span>
                <small>{{ player.playerId }}</small>
              </li>
            </ul>
          </section>

          <section class="mini-section" aria-labelledby="assignments-title">
            <h3 id="assignments-title">Assignments</h3>
            <p v-if="!gmManagement || gmManagement.assignments.length === 0" class="empty-text">
              No live session sheet or token assignments yet.
            </p>
            <ul v-else class="assignment-list">
              <li v-for="assignment in gmManagement.assignments" :key="assignment.playerId">
                <span>{{ assignment.displayName }}</span>
                <small>{{ assignmentSummary(assignment) }}</small>
              </li>
            </ul>
          </section>
        </div>
      </article>

      <article class="lobby-card panel-card" aria-labelledby="player-lobby-title">
        <div class="card-heading">
          <p class="eyebrow">Player join</p>
          <h2 :id="SESSION_LOBBY_PLAYER_SECTION_ID">Join live session</h2>
        </div>
        <p class="card-copy">
          Enter the GM's join code and a table display name. The returned player
          ID and client ID are remembered locally for later reconnect and
          session socket handshakes.
        </p>

        <form class="join-form" @submit.prevent="handleJoinSession">
          <label>
            <span>Join code</span>
            <input
              v-model="joinCode"
              autocomplete="off"
              inputmode="text"
              placeholder="ABCD-2345"
              :disabled="busy"
            >
          </label>
          <label>
            <span>Display name</span>
            <input
              v-model="displayName"
              autocomplete="nickname"
              maxlength="32"
              placeholder="Riley"
              :disabled="busy"
            >
          </label>
          <button type="submit" class="primary-button" :disabled="!canJoin">
            Join live session
          </button>
        </form>

        <div v-if="hasPlayerIdentity" class="session-summary">
          <dl class="detail-list">
            <div>
              <dt>Player</dt>
              <dd>{{ playerIdentity?.displayName ?? '—' }}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{{ playerSession?.status ?? '—' }}</dd>
            </div>
            <div>
              <dt>Revision</dt>
              <dd>{{ playerSession?.revision ?? '—' }}</dd>
            </div>
            <div>
              <dt>Session map visible</dt>
              <dd>{{ playerState?.visibility.currentMapVisible ? 'Yes' : 'No' }}</dd>
            </div>
          </dl>

          <section class="mini-section" aria-labelledby="player-assignments-title">
            <h3 id="player-assignments-title">Your assignments</h3>
            <p v-if="!playerState || playerState.assignment.controllableResources.length === 0" class="empty-text">
              The GM has not assigned controllable sheets or tokens yet.
            </p>
            <ul v-else class="assignment-list">
              <li
                v-for="resource in playerState.assignment.controllableResources"
                :key="resourceLabel(resource)"
              >
                <span>{{ resourceLabel(resource) }}</span>
                <small>Controllable</small>
              </li>
            </ul>
          </section>
        </div>
      </article>
    </section>

    <section class="lobby-footer panel-card" aria-labelledby="remembered-session-title">
      <div>
        <p class="eyebrow">Browser memory</p>
        <h2 :id="SESSION_LOBBY_REMEMBERED_SECTION_ID">Remembered live session identity</h2>
        <p>
          Rotom Table stores one live session identity in this browser's local
          storage. The cookie hint is non-secret; GM keys are not placed in cookies.
        </p>
      </div>
      <div class="action-row action-row--end">
        <button
          type="button"
          class="secondary-button"
          :disabled="busy || !identity"
          @click="safeRefresh"
        >
          Refresh remembered live session
        </button>
        <button
          type="button"
          class="danger-button"
          :disabled="busy || !identity"
          @click="clearRememberedIdentity"
        >
          Forget in this browser
        </button>
      </div>
    </section>
  </main>
</template>

<style scoped>
.session-lobby-page {
  min-height: 100vh;
  padding: clamp(0.9rem, 2vw, 1.5rem);
  background:
    radial-gradient(circle at top left, rgba(255, 31, 45, 0.12), transparent 32rem),
    var(--paper);
}

.session-lobby-page > * + * {
  margin-top: 1rem;
}

.session-hero,
.safety-banner {
  display: grid;
  gap: 0.75rem;
}

.safety-banner {
  border-color: rgba(232, 151, 55, 0.55);
  background:
    linear-gradient(135deg, rgba(232, 151, 55, 0.12), transparent 22rem),
    var(--paper-soft);
}

.safety-banner--safe {
  border-color: rgba(70, 180, 122, 0.45);
  background:
    linear-gradient(135deg, rgba(70, 180, 122, 0.11), transparent 22rem),
    var(--paper-soft);
}

.safety-banner--danger {
  border-color: rgba(255, 31, 45, 0.62);
  background:
    linear-gradient(135deg, rgba(255, 31, 45, 0.14), transparent 22rem),
    var(--paper-soft);
}

.safety-banner--unknown {
  border-style: dashed;
}

.safety-banner__main {
  display: grid;
  gap: 0.45rem;
}

.safety-banner__main p,
.safety-banner__lists li {
  color: var(--ink-soft);
  line-height: 1.5;
}

.safety-banner__main p {
  margin: 0;
}

.safety-banner__error {
  color: var(--accent) !important;
  font-weight: 700;
}

.safety-facts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 0.65rem;
  margin: 0;
}

.safety-facts div {
  min-width: 0;
  padding: 0.65rem;
  border: 1px solid var(--rule-soft);
  background: var(--paper-inset);
}

.safety-facts dt {
  color: var(--ink-muted);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.safety-facts dd {
  margin: 0.25rem 0 0;
  overflow-wrap: anywhere;
  color: var(--ink-bright);
  font-weight: 800;
}

.safety-banner__lists {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr));
  gap: 0.75rem;
}

.safety-banner__lists h3 {
  margin-bottom: 0.35rem;
}

.safety-banner__lists ul {
  display: grid;
  gap: 0.35rem;
  margin: 0;
  padding-left: 1.15rem;
}

.eyebrow {
  margin: 0;
  color: var(--accent);
  font-size: 0.76rem;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

h1,
h2,
h3,
p {
  margin-top: 0;
}

h1,
h2,
h3 {
  color: var(--ink-bright);
}

h1 {
  margin-bottom: 0;
  font-family: var(--font-book);
  font-size: clamp(2.25rem, 7vw, 4rem);
}

h2 {
  margin-bottom: 0;
  font-size: 1.35rem;
}

h3 {
  margin-bottom: 0.45rem;
  font-size: 1rem;
}

.hero-copy,
.card-copy,
.lobby-footer p,
.hint-text,
.empty-text {
  color: var(--ink-soft);
  line-height: 1.55;
}

.session-facts,
.detail-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 0.65rem;
  margin: 0;
}

.session-facts div,
.detail-list div {
  min-width: 0;
  padding: 0.65rem;
  border: 1px solid var(--rule-soft);
  background: var(--paper-inset);
}

.session-facts dt,
.detail-list dt {
  color: var(--ink-muted);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.session-facts dd,
.detail-list dd {
  margin: 0.25rem 0 0;
  overflow-wrap: anywhere;
  color: var(--ink-bright);
  font-weight: 700;
}

.lobby-message {
  padding: 0.8rem 0.95rem;
  border: 1px solid var(--rule-soft);
  background: rgba(143, 184, 255, 0.12);
  color: var(--info);
}

.lobby-message--error {
  border-color: rgba(255, 31, 45, 0.55);
  background: var(--accent-soft);
  color: var(--ink-bright);
}

.lobby-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr));
  gap: 1rem;
}

.lobby-card,
.lobby-footer {
  display: grid;
  align-content: start;
  gap: 0.9rem;
}

.card-heading {
  display: grid;
  gap: 0.25rem;
}

.action-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
}

.action-row--end {
  justify-content: flex-end;
}

.primary-button,
.secondary-button,
.danger-button {
  border: 1px solid var(--rule-soft);
  background: var(--paper);
  color: var(--ink-bright);
  padding: 0.7rem 0.9rem;
  cursor: pointer;
  font-weight: 800;
  letter-spacing: 0.04em;
}

.primary-button {
  border-color: rgba(255, 31, 45, 0.7);
  background: var(--accent-soft);
  color: var(--ink-bright);
}

.secondary-button:hover,
.primary-button:hover,
.danger-button:hover {
  border-color: var(--accent);
  background: var(--paper-hover);
}

.primary-button:disabled,
.secondary-button:disabled,
.danger-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.danger-button {
  border-color: rgba(255, 31, 45, 0.45);
  color: var(--accent);
}

.session-summary {
  display: grid;
  gap: 0.85rem;
  padding-top: 0.25rem;
}

.code-panel {
  display: grid;
  gap: 0.35rem;
  padding: 0.9rem;
  border: 1px dashed rgba(255, 31, 45, 0.7);
  background: rgba(255, 31, 45, 0.10);
}

.code-panel span {
  color: var(--ink-muted);
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.code-panel strong {
  color: var(--ink-bright);
  font-family: var(--font-mono);
  font-size: clamp(1.45rem, 5vw, 2.2rem);
  letter-spacing: 0.08em;
}

.join-form {
  display: grid;
  gap: 0.75rem;
}

.join-form label {
  display: grid;
  gap: 0.35rem;
  color: var(--ink-muted);
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.join-form input {
  width: 100%;
  border: 1px solid var(--rule-soft);
  background: var(--paper-inset);
  color: var(--ink-bright);
  padding: 0.7rem 0.75rem;
  text-transform: none;
}

.join-form input:focus {
  border-color: var(--accent);
  outline: none;
}

.mini-section {
  padding-top: 0.3rem;
  border-top: 1px solid var(--rule-soft);
}

.player-list,
.assignment-list {
  display: grid;
  gap: 0.45rem;
  list-style: none;
  margin: 0;
  padding: 0;
}

.player-list li,
.assignment-list li {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 0.4rem 0.75rem;
  padding: 0.6rem;
  border: 1px solid var(--rule-soft);
  background: var(--paper-inset);
}

.player-list span,
.assignment-list span {
  color: var(--ink-bright);
  font-weight: 800;
}

.player-list small,
.assignment-list small {
  color: var(--ink-muted);
  overflow-wrap: anywhere;
}

.lobby-footer {
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
}

code {
  color: var(--ink-bright);
}

@media (max-width: 760px) {
  .lobby-footer {
    grid-template-columns: 1fr;
  }

  .action-row--end {
    justify-content: flex-start;
  }
}
</style>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import AppNavigation from '~/components/AppNavigation.vue'
import { useSessionLobby } from '~/composables/useSessionLobby'
import {
  LOGIN_PATH,
  SESSION_LOBBY_GM_SECTION_ID,
  SESSION_LOBBY_PLAYER_SECTION_ID,
  SESSION_LOBBY_REMEMBERED_SECTION_ID,
} from '~/utils/appRoutes'
import { MAP_LIBRARY_PATH } from '~/utils/mapRoutes'
import { POKEDEX_PATH } from '~/utils/pokedex/routes'

useHead({ title: 'Legacy live-session lobby · Rotom Table' })

const { isGm, roleLabel } = useAuth()
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
  gmSession,
  playerSession,
  playerIdentity,
  playerProfileSession,
  playerProfiles,
  loadSafetyStatus,
  loadPlayerProfiles,
  startGmSession,
  joinPlayerSession,
  refreshSessionSummary,
  loadRememberedIdentity,
  clearRememberedIdentity,
} = useSessionLobby()

const hasGmIdentity = computed(() => identity.value?.role === 'gm')
const hasPlayerIdentity = computed(() => identity.value?.role === 'player')
const canJoin = computed(() => displayName.value.trim().length > 0 && !busy.value)
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
  'Until the safety check responds, treat this page as local prep and do not share the player URL.',
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
    await loadProfilesQuietly()
  } catch {
    // The composable stores a user-safe error string for the page.
  }
}

const loadProfilesQuietly = async () => {
  try {
    await loadPlayerProfiles({ silent: true })
  } catch {
    // The safety banner explains disabled hosting; profile refresh is best-effort.
  }
}

const handleJoinSession = async () => {
  if (!canJoin.value) return

  try {
    await joinPlayerSession({ displayName: displayName.value })
    displayName.value = ''
    await loadProfilesQuietly()
  } catch {
    // The composable stores a user-safe error string for the page.
  }
}

const handlePickPlayerProfile = async (playerId: string) => {
  if (busy.value) return

  try {
    await joinPlayerSession({ playerId })
  } catch {
    // The composable stores a user-safe error string for the page.
  }
}

onMounted(() => {
  void loadSafetyStatus()
    .then((status) => {
      if (status.hostEnabled) void loadProfilesQuietly()
    })
    .catch(() => undefined)
  void loadRememberedIdentity({ refresh: true }).catch(() => undefined)
})
</script>

<template>
  <main class="session-lobby-page">
    <AppNavigation />

    <section class="normal-play-banner panel-card" aria-labelledby="normal-play-title">
      <div>
        <p class="eyebrow">Legacy session surface</p>
        <h2 id="normal-play-title">Normal play does not use the session lobby</h2>
        <p>
          Players normally choose a persistent profile from Login, open a player-visible map,
          and control profile-linked characters on the regular map route. This direct lobby page
          remains only for legacy session identity/socket smoke checks and is no longer linked
          from the app navigation.
        </p>
      </div>
      <div class="normal-play-links" aria-label="Normal play routes">
        <NuxtLink class="primary-button" :to="MAP_LIBRARY_PATH">
          Open maps
        </NuxtLink>
        <NuxtLink class="secondary-button" :to="LOGIN_PATH">
          Choose profile
        </NuxtLink>
        <NuxtLink class="secondary-button" :to="POKEDEX_PATH">
          Browse Pokédex
        </NuxtLink>
      </div>
    </section>

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
      <p class="eyebrow">Legacy session hosting</p>
      <h1 id="session-lobby-title">Legacy live-session lobby</h1>
      <p class="hero-copy">
        This page is intentionally isolated from the normal play flow. Use it only
        when you deliberately need the old session-local identity and socket lobby
        for maintenance or smoke testing; profile-based map play uses the normal
        app navigation and regular <code>/maps/&lt;slug&gt;</code> route.
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

    <section class="lobby-grid" aria-label="Legacy live-session lobby actions">
      <article class="lobby-card panel-card" aria-labelledby="gm-lobby-title">
        <div class="card-heading">
          <p class="eyebrow">Legacy session hosting</p>
          <h2 :id="SESSION_LOBBY_GM_SECTION_ID">Start and manage legacy live session</h2>
        </div>
        <p class="card-copy">
          Creates a server-owned legacy live session and a private GM key stored only
          in this browser. This is not required for normal profile-based play. Session
          hosting still requires <code>ROTOM_ENABLE_SESSION_HOST=1</code> and the local GM role.
        </p>

        <div class="action-row">
          <button
            type="button"
            class="primary-button"
            :disabled="busy || !isGm"
            @click="handleStartSession"
          >
            {{ hasGmIdentity ? 'Start fresh live session' : 'Start GM live session' }}
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
        </div>
      </article>

      <article class="lobby-card panel-card" aria-labelledby="player-lobby-title">
        <div class="card-heading">
          <p class="eyebrow">Legacy player join</p>
          <h2 :id="SESSION_LOBBY_PLAYER_SECTION_ID">Join legacy live session</h2>
        </div>
        <p class="card-copy">
          This legacy join flow creates or reuses a session-local player identity
          for the currently running live session on this server. It does not create
          persistent player profiles for normal maps and sheets.
        </p>

        <dl class="detail-list" aria-label="Current player lobby session">
          <div>
            <dt>Active table</dt>
            <dd>{{ playerProfileSession ? 'Live session running' : 'Waiting for GM' }}</dd>
          </div>
          <div>
            <dt>Profiles</dt>
            <dd>{{ playerProfiles.length }}</dd>
          </div>
        </dl>

        <div class="action-row">
          <button
            type="button"
            class="secondary-button"
            :disabled="busy"
            @click="loadProfilesQuietly"
          >
            Refresh profiles
          </button>
        </div>

        <form class="join-form" @submit.prevent="handleJoinSession">
          <label>
            <span>New session display name</span>
            <input
              v-model="displayName"
              autocomplete="nickname"
              maxlength="32"
              placeholder="Riley"
              :disabled="busy"
            >
          </label>
          <button type="submit" class="primary-button" :disabled="!canJoin">
            Join with new session identity
          </button>
        </form>

        <section class="mini-section" aria-labelledby="existing-player-profiles-title">
          <h3 id="existing-player-profiles-title">Existing session players</h3>
          <p v-if="!playerProfileSession" class="empty-text">
            Ask the GM to start the live session. This lobby will use it automatically once it is running.
          </p>
          <p v-else-if="playerProfiles.length === 0" class="empty-text">
            No session player identities have been created for this live session yet.
          </p>
          <ul v-else class="profile-list">
            <li v-for="profile in playerProfiles" :key="profile.playerId">
              <button
                type="button"
                class="profile-button"
                :disabled="busy"
                @click="handlePickPlayerProfile(profile.playerId)"
              >
                <span>{{ profile.displayName }}</span>
                <small>{{ profile.playerId }}</small>
              </button>
            </li>
          </ul>
        </section>

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
          </dl>

          <section class="mini-section" aria-labelledby="legacy-session-boundary-title">
            <h3 id="legacy-session-boundary-title">Legacy session boundary</h3>
            <p class="empty-text">
              This page now keeps only the old session-local identity and socket smoke surface.
              Map links, token assignment panels, and session-map controls have been removed;
              use persistent player profiles for normal map and sheet control.
            </p>
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

.normal-play-banner,
.session-hero,
.safety-banner {
  display: grid;
  gap: 0.75rem;
}

.normal-play-banner {
  border-color: rgba(70, 180, 122, 0.5);
  background:
    linear-gradient(135deg, rgba(70, 180, 122, 0.12), transparent 24rem),
    var(--paper-soft);
}

.normal-play-banner p {
  margin-bottom: 0;
  color: var(--ink-soft);
  line-height: 1.55;
}

.normal-play-links {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
}

.normal-play-links a {
  text-decoration: none;
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
.profile-list {
  display: grid;
  gap: 0.45rem;
  list-style: none;
  margin: 0;
  padding: 0;
}

.player-list li,
.profile-list li {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 0.4rem 0.75rem;
  padding: 0.6rem;
  border: 1px solid var(--rule-soft);
  background: var(--paper-inset);
}

.profile-button {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 0.4rem 0.75rem;
  width: 100%;
  border: 0;
  background: transparent;
  color: inherit;
  padding: 0;
  cursor: pointer;
  text-align: left;
}

.profile-button:hover,
.profile-button:focus-visible {
  color: var(--accent);
  outline: none;
}

.profile-button:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.player-list span,
.profile-button span {
  color: var(--ink-bright);
  font-weight: 800;
}

.player-list small,
.profile-button small {
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

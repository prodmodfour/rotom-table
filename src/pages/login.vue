<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { AuthRole } from '#shared/auth'
import type { PlayerProfile } from '#shared/playerProfiles'
import { resolveLoginRedirectTarget } from '~/utils/loginRedirect'

useHead({ title: 'Login · Rotom Table' })

const route = useRoute()
const router = useRouter()
const { role, roleLabel, loginAs } = useAuth()
const {
  profiles,
  selectedProfileId,
  selectedProfileDisplayName,
  hasSelectedProfile,
  busy: profilesBusy,
  lastError: profileError,
  lastNotice: profileNotice,
  reloadProfiles,
  rememberProfile,
  createProfile,
} = usePlayerProfiles()

const playerProfilePickerRequested = ref(false)
const newProfileDisplayName = ref('')

const redirectTarget = (nextRole: AuthRole) =>
  resolveLoginRedirectTarget(route.query.redirect, nextRole)

const showPlayerProfilePicker = computed(() => (
  playerProfilePickerRequested.value || role.value === 'player'
))

const trimmedNewProfileDisplayName = computed(() => newProfileDisplayName.value.trim())
const canCreatePlayerProfile = computed(() => (
  trimmedNewProfileDisplayName.value.length > 0 && !profilesBusy.value
))

const loadPlayerProfilesForLogin = async () => {
  playerProfilePickerRequested.value = true
  try {
    await reloadProfiles({ clearMissingSelection: true })
  } catch {
    // The composable records a safe player-facing error; keep the picker open.
  }
}

const chooseGmLogin = async () => {
  loginAs('gm')
  await router.replace(redirectTarget('gm'))
}

const choosePlayerLogin = async () => {
  loginAs('player')
  await loadPlayerProfilesForLogin()
}

const continueAsSelectedProfile = async () => {
  if (!hasSelectedProfile.value) return
  await router.replace(redirectTarget('player'))
}

const chooseExistingProfile = async (profile: PlayerProfile) => {
  rememberProfile(profile)
  await continueAsSelectedProfile()
}

const createAndContinue = async () => {
  const displayName = trimmedNewProfileDisplayName.value
  if (!displayName) return

  try {
    await createProfile(displayName)
    newProfileDisplayName.value = ''
    await continueAsSelectedProfile()
  } catch {
    // The composable records a safe player-facing error; keep the form editable.
  }
}

const isSelectedProfile = (profile: PlayerProfile) => selectedProfileId.value === profile.id

const linkedCharacterSummary = (profile: PlayerProfile) => {
  const count = profile.linkedCharacters.length
  return count === 1 ? '1 linked character' : `${count} linked characters`
}

onMounted(() => {
  if (role.value === 'player') void loadPlayerProfilesForLogin()
})
</script>

<template>
  <main class="login-page">
    <section class="login-card" aria-labelledby="login-title">
      <p class="eyebrow">Rotom Table</p>
      <h1 id="login-title">Choose a login</h1>
      <p class="login-copy">
        For now this uses the table's trust system: no passwords, just pick the role
        you are using for local-first access.
      </p>

      <div class="login-actions" role="group" aria-label="Login options">
        <button type="button" class="login-button login-button--gm" @click="chooseGmLogin">
          <span>GM Login</span>
          <small>Full map, sheet, encounter, and control-panel access</small>
        </button>
        <button
          type="button"
          class="login-button"
          :aria-expanded="showPlayerProfilePicker ? 'true' : 'false'"
          aria-controls="player-profile-picker"
          @click="choosePlayerLogin"
        >
          <span>Player Login</span>
          <small>Choose or create your player profile for player-visible maps and sheets</small>
        </button>
      </div>

      <section
        v-if="showPlayerProfilePicker"
        id="player-profile-picker"
        class="profile-picker"
        aria-labelledby="player-profile-picker-title"
      >
        <div class="profile-picker__header">
          <div>
            <p class="eyebrow profile-picker__eyebrow">Player profile</p>
            <h2 id="player-profile-picker-title">Who are you playing as?</h2>
          </div>
          <button
            type="button"
            class="secondary-button"
            :disabled="profilesBusy"
            @click="loadPlayerProfilesForLogin"
          >
            Refresh
          </button>
        </div>

        <p class="profile-picker__copy">
          Pick an existing persistent profile or create a new one. The selected
          profile is remembered in this browser for future player logins.
        </p>

        <p v-if="profileNotice" class="profile-message profile-message--notice">
          {{ profileNotice }}
        </p>
        <p v-if="profileError" class="profile-message profile-message--error" role="alert">
          {{ profileError }}
        </p>

        <div v-if="hasSelectedProfile" class="remembered-profile">
          <div>
            <span class="remembered-profile__label">Remembered profile</span>
            <strong>{{ selectedProfileDisplayName }}</strong>
          </div>
          <button type="button" class="continue-button" :disabled="profilesBusy" @click="continueAsSelectedProfile">
            Continue as {{ selectedProfileDisplayName }}
          </button>
        </div>

        <p v-if="profilesBusy" class="profile-loading">Loading player profiles…</p>

        <ul v-else-if="profiles.length > 0" class="profile-list" aria-label="Existing player profiles">
          <li v-for="profile in profiles" :key="profile.id">
            <button
              type="button"
              class="profile-option"
              :class="{ 'profile-option--selected': isSelectedProfile(profile) }"
              @click="chooseExistingProfile(profile)"
            >
              <span>{{ profile.displayName }}</span>
              <small>{{ linkedCharacterSummary(profile) }}</small>
              <strong v-if="isSelectedProfile(profile)">Remembered</strong>
            </button>
          </li>
        </ul>

        <p v-else class="profile-empty">
          No player profiles exist yet. Create one below to continue as a player.
        </p>

        <form class="profile-create-form" @submit.prevent="createAndContinue">
          <label for="new-player-profile-name">Create a new player profile</label>
          <div class="profile-create-form__row">
            <input
              id="new-player-profile-name"
              v-model="newProfileDisplayName"
              type="text"
              name="displayName"
              maxlength="64"
              autocomplete="nickname"
              placeholder="Display name"
            >
            <button type="submit" class="continue-button" :disabled="!canCreatePlayerProfile">
              Create profile
            </button>
          </div>
        </form>
      </section>

      <p v-if="role" class="current-role">
        Current login: <strong>{{ roleLabel }}</strong>
      </p>
    </section>
  </main>
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 1rem;
  background:
    radial-gradient(circle at top, rgba(255, 31, 45, 0.12), transparent 34rem),
    var(--paper);
}

.login-card {
  width: min(640px, 100%);
  border: 1px solid var(--rule);
  border-radius: 18px;
  background: var(--paper-soft);
  box-shadow: var(--shadow-card);
  padding: 1.35rem;
}

.eyebrow {
  margin: 0 0 0.35rem;
  color: var(--accent);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

h1,
h2 {
  margin: 0;
  font-family: var(--font-book);
  color: var(--ink-bright);
}

h1 {
  font-size: clamp(2rem, 8vw, 3rem);
}

h2 {
  font-size: clamp(1.35rem, 5vw, 2rem);
}

.login-copy,
.profile-picker__copy {
  margin: 0.75rem 0 1.1rem;
  color: var(--ink-soft);
  line-height: 1.55;
}

.login-actions {
  display: grid;
  gap: 0.7rem;
}

.login-button,
.profile-option,
.secondary-button,
.continue-button {
  border: 1px solid var(--rule-soft);
  border-radius: 14px;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease, transform 0.15s ease;
}

.login-button {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.25rem;
  width: 100%;
  background: var(--paper);
  color: var(--ink);
  padding: 0.9rem 1rem;
  text-align: left;
}

.login-button:hover,
.login-button:focus-visible,
.profile-option:hover,
.profile-option:focus-visible,
.secondary-button:hover,
.secondary-button:focus-visible,
.continue-button:hover,
.continue-button:focus-visible {
  border-color: var(--accent);
  background: var(--paper-hover);
  outline: none;
  transform: translateY(-1px);
}

.login-button--gm {
  border-color: rgba(255, 31, 45, 0.6);
  background: var(--accent-soft);
}

.login-button span {
  color: var(--ink-bright);
  font-size: 1.05rem;
  font-weight: 700;
}

.login-button small,
.profile-option small {
  color: var(--ink-muted);
  line-height: 1.35;
}

.profile-picker {
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid var(--rule);
}

.profile-picker__header {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  align-items: flex-start;
}

.profile-picker__eyebrow {
  margin-bottom: 0.15rem;
}

.secondary-button,
.continue-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 2.35rem;
  background: var(--paper);
  color: var(--ink-bright);
  font-weight: 700;
  padding: 0.55rem 0.85rem;
}

.continue-button {
  border-color: rgba(255, 31, 45, 0.6);
  background: var(--accent-soft);
}

.secondary-button:disabled,
.continue-button:disabled {
  cursor: not-allowed;
  opacity: 0.58;
  transform: none;
}

.profile-message,
.profile-loading,
.profile-empty {
  margin: 0.75rem 0 0;
  color: var(--ink-muted);
  line-height: 1.45;
}

.profile-message {
  border: 1px solid var(--rule-soft);
  border-radius: 12px;
  padding: 0.7rem 0.8rem;
  background: var(--paper);
}

.profile-message--notice {
  border-color: rgba(143, 184, 255, 0.44);
  color: var(--info);
}

.profile-message--error {
  border-color: rgba(255, 31, 45, 0.56);
  color: var(--bad);
}

.remembered-profile {
  display: flex;
  justify-content: space-between;
  gap: 0.9rem;
  align-items: center;
  margin-top: 0.9rem;
  padding: 0.8rem;
  border: 1px solid var(--rule-soft);
  border-radius: 14px;
  background: var(--paper-inset);
}

.remembered-profile__label {
  display: block;
  margin-bottom: 0.2rem;
  color: var(--ink-muted);
  font-size: 0.78rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.remembered-profile strong {
  color: var(--ink-bright);
}

.profile-list {
  display: grid;
  gap: 0.55rem;
  margin: 0.9rem 0 0;
  padding: 0;
  list-style: none;
}

.profile-option {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 0.2rem 0.75rem;
  align-items: center;
  width: 100%;
  background: var(--paper);
  color: var(--ink);
  padding: 0.85rem;
  text-align: left;
}

.profile-option--selected {
  border-color: var(--accent);
  background: var(--paper-active);
}

.profile-option span {
  color: var(--ink-bright);
  font-weight: 700;
}

.profile-option strong {
  color: var(--accent);
  font-size: 0.76rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.profile-create-form {
  display: grid;
  gap: 0.55rem;
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid var(--rule);
}

.profile-create-form label {
  color: var(--ink-bright);
  font-weight: 700;
}

.profile-create-form__row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.6rem;
}

.profile-create-form input {
  min-width: 0;
  border: 1px solid var(--rule-soft);
  border-radius: 12px;
  background: var(--paper);
  color: var(--ink-bright);
  padding: 0.7rem 0.75rem;
}

.profile-create-form input:focus {
  border-color: var(--accent);
  outline: none;
}

.current-role {
  margin: 1rem 0 0;
  color: var(--ink-muted);
}

.current-role strong {
  color: var(--accent);
}

@media (max-width: 560px) {
  .profile-picker__header,
  .remembered-profile,
  .profile-create-form__row {
    grid-template-columns: 1fr;
  }

  .profile-picker__header,
  .remembered-profile {
    display: grid;
  }

  .continue-button,
  .secondary-button {
    width: 100%;
  }
}
</style>

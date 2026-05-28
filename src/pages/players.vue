<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import AppNavigation from '~/components/AppNavigation.vue'
import { useGmPlayerProfileManagement } from '~/composables/useGmPlayerProfileManagement'
import {
  PLAYER_PROFILE_MANAGEMENT_EMPTY_TEXT,
  PLAYER_PROFILE_MANAGEMENT_NO_LINKS_TEXT,
  PLAYER_PROFILE_MANAGEMENT_NO_SELECTION_TEXT,
  buildPlayerProfileManagementDetail,
  linkableCharacterOptionByKey,
} from '~/utils/playerProfileManagement'
import { DEFAULT_LOGIN_REDIRECT } from '~/utils/loginRedirect'

useHead({ title: 'Players · Rotom Table' })

definePageMeta({
  middleware: () => {
    const { isPlayer } = useAuth()
    if (isPlayer.value) return navigateTo(DEFAULT_LOGIN_REDIRECT)
  },
})

const { isGm, roleLabel } = useAuth()
const {
  profiles,
  selectedProfileId,
  selectedProfile,
  profileCount,
  linkableCharacterOptions,
  availableLinkOptions,
  loading,
  loadingLinkableCharacters,
  creatingProfile,
  savingProfileLinks,
  lastError,
  lastNotice,
  loadProfiles,
  loadLinkableCharacters,
  createProfile,
  selectProfile,
  linkCharacterToSelectedProfile,
  unlinkCharacterFromSelectedProfile,
} = useGmPlayerProfileManagement()

const linkCandidateKey = ref('')
const newProfileDisplayName = ref('')
const selectedProfileDetail = computed(() => buildPlayerProfileManagementDetail(
  selectedProfile.value,
  linkableCharacterOptions.value,
))
const linkedCharacterCount = computed(() => selectedProfile.value?.linkedCharacters.length ?? 0)
const selectedLinkCandidate = computed(() => (
  linkCandidateKey.value
    ? linkableCharacterOptionByKey(availableLinkOptions.value, linkCandidateKey.value)
    : null
))
const trimmedNewProfileDisplayName = computed(() => newProfileDisplayName.value.trim())
const canCreatePlayerProfile = computed(() => (
  isGm.value && trimmedNewProfileDisplayName.value.length > 0 && !loading.value && !creatingProfile.value
))

const refreshProfiles = async () => {
  await Promise.allSettled([loadProfiles(), loadLinkableCharacters()])
}

const refreshLinkableCharacters = async () => {
  try {
    await loadLinkableCharacters()
  } catch {
    // The composable stores a user-safe error message for this page.
  }
}

const createNewProfile = async () => {
  const displayName = trimmedNewProfileDisplayName.value
  if (!displayName || !canCreatePlayerProfile.value) return

  try {
    await createProfile(displayName)
    newProfileDisplayName.value = ''
    linkCandidateKey.value = ''
  } catch {
    // The composable stores a user-safe error message for this page.
  }
}

const openProfile = (profileId: string) => {
  try {
    selectProfile(profileId)
    linkCandidateKey.value = ''
  } catch {
    // The composable stores a user-safe error message for this page.
  }
}

const linkSelectedCharacter = async () => {
  if (!selectedLinkCandidate.value) return
  try {
    await linkCharacterToSelectedProfile(selectedLinkCandidate.value.ref)
    linkCandidateKey.value = ''
  } catch {
    // The composable stores a user-safe error message for this page.
  }
}

const unlinkCharacter = async (ref: { sheetKind: string; sheetSlug: string }) => {
  try {
    await unlinkCharacterFromSelectedProfile(ref)
  } catch {
    // The composable stores a user-safe error message for this page.
  }
}

onMounted(() => {
  if (isGm.value) void refreshProfiles()
})
</script>

<template>
  <main class="profile-management-page">
    <AppNavigation />

    <section class="profile-hero panel-card" aria-labelledby="player-profile-management-title">
      <div>
        <p class="eyebrow">GM tools</p>
        <h1 id="player-profile-management-title">Players</h1>
        <p class="hero-copy">
          Review persistent player profiles and the Pokémon or trainer sheets
          linked to each profile. These links drive player sheet editing and
          map token control while the profile management surface stays GM-only.
        </p>
      </div>
      <dl class="profile-facts" aria-label="Player profile management summary">
        <div>
          <dt>Local login</dt>
          <dd>{{ roleLabel }}</dd>
        </div>
        <div>
          <dt>Profiles</dt>
          <dd>{{ profileCount }}</dd>
        </div>
        <div>
          <dt>Selected</dt>
          <dd>{{ selectedProfile?.displayName ?? '—' }}</dd>
        </div>
      </dl>
    </section>

    <p v-if="lastError" class="manager-message manager-message--error" role="alert">
      {{ lastError }}
    </p>
    <p v-else-if="lastNotice" class="manager-message" role="status">
      {{ lastNotice }}
    </p>

    <section v-if="!isGm" class="permission-card panel-card" role="status">
      <p class="eyebrow">GM-only</p>
      <h2>Player profile management requires GM Login</h2>
      <p>
        Players can choose profiles from the login flow, but they cannot manage
        profile links or open this GM management surface.
      </p>
    </section>

    <section v-else class="profile-manager-grid" aria-label="GM player profile management">
      <aside class="profile-list-panel panel-card" aria-labelledby="profile-list-title">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Profiles</p>
            <h2 id="profile-list-title">Persistent profiles</h2>
          </div>
          <button
            type="button"
            class="secondary-button"
            :disabled="loading || loadingLinkableCharacters"
            @click="refreshProfiles"
          >
            Refresh
          </button>
        </div>

        <form class="profile-create-form" aria-label="Create player profile" @submit.prevent="createNewProfile">
          <label for="new-gm-player-profile-name">Create player profile</label>
          <div class="profile-create-controls">
            <input
              id="new-gm-player-profile-name"
              v-model="newProfileDisplayName"
              type="text"
              name="displayName"
              maxlength="64"
              autocomplete="nickname"
              placeholder="Display name"
              :disabled="creatingProfile"
            >
            <button type="submit" class="secondary-button" :disabled="!canCreatePlayerProfile">
              Create
            </button>
          </div>
          <p class="state-text">Only GMs can create player profiles.</p>
        </form>

        <p v-if="loading" class="state-text">Loading player profiles…</p>
        <p v-else-if="profiles.length === 0" class="state-text">
          {{ PLAYER_PROFILE_MANAGEMENT_EMPTY_TEXT }}
        </p>
        <ul v-else class="profile-list" aria-label="Player profiles">
          <li v-for="profile in profiles" :key="profile.id">
            <button
              type="button"
              class="profile-list-button"
              :class="{ 'profile-list-button--active': selectedProfileId === profile.id }"
              :aria-pressed="selectedProfileId === profile.id ? 'true' : 'false'"
              @click="openProfile(profile.id)"
            >
              <span>{{ profile.displayName }}</span>
              <small>
                {{ profile.linkedCharacters.length }} linked
                {{ profile.linkedCharacters.length === 1 ? 'character' : 'characters' }}
              </small>
            </button>
          </li>
        </ul>
      </aside>

      <article class="profile-detail-panel panel-card" aria-live="polite">
        <template v-if="selectedProfileDetail">
          <div class="panel-heading panel-heading--detail">
            <div>
              <p class="eyebrow">Manage profile</p>
              <h2>{{ selectedProfileDetail.displayName }}</h2>
            </div>
            <span class="link-count-pill">{{ selectedProfileDetail.linkedCharacterCountLabel }}</span>
          </div>

          <p class="detail-copy">
            Review the character links that currently drive this player's sheet
            and token access. Link editing controls are GM-only and are not shown
            to players.
          </p>

          <dl class="detail-list" aria-label="Selected player profile details">
            <div>
              <dt>Profile ID</dt>
              <dd><code>{{ selectedProfileDetail.id }}</code></dd>
            </div>
            <div>
              <dt>Display name</dt>
              <dd>{{ selectedProfileDetail.displayName }}</dd>
            </div>
            <div>
              <dt>Linked characters</dt>
              <dd>{{ selectedProfileDetail.linkedCharacterCountLabel }}</dd>
            </div>
          </dl>

          <section class="linked-characters" aria-labelledby="linked-characters-title">
            <div class="linked-characters-heading">
              <div>
                <h3 id="linked-characters-title">Linked characters</h3>
                <p class="state-text">
                  Select existing Pokémon or trainer sheets from the current sheet library.
                </p>
              </div>
              <button
                type="button"
                class="secondary-button"
                :disabled="loadingLinkableCharacters"
                @click="refreshLinkableCharacters"
              >
                Refresh sheets
              </button>
            </div>

            <form class="link-character-form" aria-label="Link a character sheet" @submit.prevent="linkSelectedCharacter">
              <label for="link-character-select">Link an existing sheet</label>
              <div class="link-character-controls">
                <select
                  id="link-character-select"
                  v-model="linkCandidateKey"
                  :disabled="loadingLinkableCharacters || savingProfileLinks || availableLinkOptions.length === 0"
                >
                  <option value="">Choose a Pokémon or trainer sheet…</option>
                  <option v-for="option in availableLinkOptions" :key="option.key" :value="option.key">
                    {{ option.label }} — {{ option.detailsLabel }}
                  </option>
                </select>
                <button
                  type="submit"
                  class="secondary-button"
                  :disabled="!selectedLinkCandidate || savingProfileLinks"
                >
                  Link character
                </button>
              </div>
              <p v-if="loadingLinkableCharacters" class="state-text">Loading sheet library…</p>
              <p v-else-if="linkableCharacterOptions.length === 0" class="state-text">
                No Pokémon or trainer sheets are available to link.
              </p>
              <p v-else-if="availableLinkOptions.length === 0" class="state-text">
                Every loaded character sheet is already linked to this profile.
              </p>
            </form>

            <p v-if="linkedCharacterCount === 0" class="state-text">
              {{ PLAYER_PROFILE_MANAGEMENT_NO_LINKS_TEXT }}
            </p>
            <ul v-else class="linked-character-list">
              <li v-for="character in selectedProfileDetail.linkedCharacters" :key="character.key">
                <div class="linked-character-row">
                  <NuxtLink class="linked-character-card" :to="character.href">
                    <span>{{ character.label }}</span>
                    <small>{{ character.kindLabel }} · {{ character.sheetSlug }}</small>
                  </NuxtLink>
                  <button
                    type="button"
                    class="secondary-button danger-button"
                    :disabled="savingProfileLinks"
                    @click="unlinkCharacter(character.ref)"
                  >
                    Unlink
                  </button>
                </div>
              </li>
            </ul>
          </section>
        </template>

        <template v-else>
          <p class="eyebrow">Manage profile</p>
          <h2>Select a profile</h2>
          <p class="state-text">{{ PLAYER_PROFILE_MANAGEMENT_NO_SELECTION_TEXT }}</p>
        </template>
      </article>
    </section>
  </main>
</template>

<style scoped>
.profile-management-page {
  min-height: 100vh;
  display: grid;
  align-content: start;
  gap: 1rem;
  padding: 1rem;
  background:
    radial-gradient(circle at top left, rgba(255, 31, 45, 0.12), transparent 32rem),
    var(--paper);
}

.profile-hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(16rem, 24rem);
  gap: 1rem;
  align-items: stretch;
}

.eyebrow {
  margin: 0 0 0.35rem;
  color: var(--accent);
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

h1,
h2,
h3 {
  margin: 0;
  color: var(--ink-bright);
  font-family: var(--font-book);
}

h1 {
  font-size: clamp(2.2rem, 7vw, 3.6rem);
}

h2 {
  font-size: clamp(1.5rem, 4vw, 2.1rem);
}

h3 {
  font-size: 1.3rem;
}

.hero-copy,
.detail-copy,
.permission-card p,
.state-text {
  color: var(--ink-soft);
  line-height: 1.55;
}

.hero-copy,
.detail-copy,
.state-text {
  margin: 0.65rem 0 0;
}

.profile-facts,
.detail-list {
  display: grid;
  gap: 0.55rem;
  margin: 0;
}

.profile-facts div,
.detail-list div {
  display: grid;
  gap: 0.2rem;
  padding: 0.65rem;
  border: 1px solid var(--rule-soft);
  background: var(--paper-inset);
}

.profile-facts dt,
.detail-list dt {
  color: var(--ink-muted);
  font-size: 0.74rem;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.profile-facts dd,
.detail-list dd {
  margin: 0;
  color: var(--ink-bright);
  font-weight: 800;
  overflow-wrap: anywhere;
}

.manager-message {
  margin: 0;
  padding: 0.8rem 0.9rem;
  border: 1px solid rgba(143, 184, 255, 0.44);
  background: rgba(143, 184, 255, 0.08);
  color: var(--info);
}

.manager-message--error {
  border-color: rgba(255, 31, 45, 0.56);
  background: rgba(255, 31, 45, 0.09);
  color: var(--bad);
}

.profile-manager-grid {
  display: grid;
  grid-template-columns: minmax(18rem, 0.8fr) minmax(0, 1.4fr);
  gap: 1rem;
  align-items: start;
}

.panel-heading {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  align-items: flex-start;
}

.panel-heading--detail {
  align-items: center;
}

.secondary-button,
.profile-list-button,
.linked-character-card,
.profile-create-controls input,
.link-character-controls select {
  border: 1px solid var(--rule-soft);
  background: var(--paper);
  color: var(--ink);
}

.secondary-button,
.profile-list-button {
  cursor: pointer;
}

.secondary-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 2.35rem;
  padding: 0.55rem 0.85rem;
  color: var(--ink-bright);
  font-weight: 800;
}

.secondary-button:hover,
.secondary-button:focus-visible,
.profile-list-button:hover,
.profile-list-button:focus-visible,
.linked-character-card:hover,
.linked-character-card:focus-visible,
.profile-create-controls input:hover,
.profile-create-controls input:focus-visible,
.link-character-controls select:hover,
.link-character-controls select:focus-visible {
  border-color: var(--accent);
  background: var(--paper-hover);
  outline: none;
}

.secondary-button:disabled,
.profile-create-controls input:disabled,
.link-character-controls select:disabled {
  cursor: not-allowed;
  opacity: 0.58;
}

.danger-button {
  border-color: rgba(255, 31, 45, 0.42);
  color: var(--bad);
}

.profile-list,
.linked-character-list {
  display: grid;
  gap: 0.55rem;
  margin: 0.9rem 0 0;
  padding: 0;
  list-style: none;
}

.profile-list-button {
  display: grid;
  gap: 0.2rem;
  width: 100%;
  padding: 0.8rem;
  text-align: left;
}

.profile-list-button--active {
  border-color: var(--accent);
  background: var(--paper-active);
}

.profile-list-button span,
.linked-character-card span {
  color: var(--ink-bright);
  font-weight: 800;
}

.profile-list-button small,
.linked-character-card small {
  color: var(--ink-muted);
}

.link-count-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.35rem 0.6rem;
  border: 1px solid var(--rule-soft);
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 0.78rem;
  font-weight: 900;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  white-space: nowrap;
}

.detail-list {
  margin-top: 1rem;
}

.linked-characters {
  margin-top: 1.1rem;
  padding-top: 1rem;
  border-top: 1px solid var(--rule-soft);
}

.linked-characters-heading,
.profile-create-controls,
.link-character-controls,
.linked-character-row {
  display: flex;
  gap: 0.75rem;
  align-items: flex-start;
  justify-content: space-between;
}

.profile-create-form,
.link-character-form {
  display: grid;
  gap: 0.45rem;
  margin-top: 1rem;
  padding: 0.8rem;
  border: 1px solid var(--rule-soft);
  background: var(--paper-inset);
}

.profile-create-form label,
.link-character-form label {
  color: var(--ink-bright);
  font-weight: 800;
}

.profile-create-controls input,
.link-character-controls select {
  flex: 1 1 18rem;
  min-height: 2.35rem;
  padding: 0.5rem 0.65rem;
  font: inherit;
}

.profile-create-controls input {
  min-width: 0;
}

.linked-character-card {
  display: grid;
  flex: 1 1 auto;
  gap: 0.2rem;
  padding: 0.8rem;
  text-decoration: none;
}

@media (max-width: 820px) {
  .profile-hero,
  .profile-manager-grid {
    grid-template-columns: 1fr;
  }

  .panel-heading,
  .panel-heading--detail,
  .linked-characters-heading,
  .profile-create-controls,
  .link-character-controls,
  .linked-character-row {
    display: grid;
  }
}
</style>

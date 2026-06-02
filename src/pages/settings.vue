<script setup lang="ts">
import { computed, ref } from 'vue'
import AppNavigation from '~/components/AppNavigation.vue'
import { useMoveAnimationSettings } from '~/composables/useMoveAnimationSettings'
import { DEFAULT_LOGIN_REDIRECT } from '~/utils/loginRedirect'

useHead({ title: 'Settings · Rotom Table' })

definePageMeta({
  middleware: () => {
    const { isPlayer } = useAuth()
    if (isPlayer.value) return navigateTo(DEFAULT_LOGIN_REDIRECT)
  },
})

const campaignFolderInput = ref<HTMLInputElement | null>(null)
const selectedCampaignFolderName = ref('')
const campaignFolderPickerAttrs: Record<string, string> = {
  webkitdirectory: '',
  directory: '',
}

const campaignFolderStatus = computed(() => (
  selectedCampaignFolderName.value
    ? `Selected folder: ${selectedCampaignFolderName.value}`
    : 'No campaign folder selected.'
))

const {
  appThemeModeLabel,
  appThemeModeTitle,
  appThemeToggleLabel,
  isLightAppTheme,
  toggleAppThemeMode,
} = useAppTheme()
const {
  moveAnimationsEnabled,
  moveAnimationsReducedMotion,
  moveAnimationsStatusLabel,
  moveAnimationsStatusTitle,
  moveAnimationsToggleLabel,
  toggleMoveAnimationsEnabled,
} = useMoveAnimationSettings()

const appThemeToggleText = computed(() => (
  isLightAppTheme.value ? 'Light mode' : 'Dark mode'
))
const moveAnimationsToggleText = computed(() => (
  moveAnimationsEnabled.value ? 'Animations on' : 'Animations off'
))

const openCampaignFolderBrowser = () => {
  campaignFolderInput.value?.click()
}

const handleCampaignFolderSelection = (event: Event) => {
  const input = event.target as HTMLInputElement
  const firstFile = input.files?.[0]
  if (!firstFile) return

  const [folderName] = firstFile.webkitRelativePath.split('/')
  selectedCampaignFolderName.value = folderName || firstFile.name
}
</script>

<template>
  <main class="settings-page">
    <AppNavigation />

    <section class="settings-panel panel-card" aria-label="Settings">
      <div>
        <p class="eyebrow">Settings</p>
      </div>

      <button
        type="button"
        class="campaign-folder-button"
        @click="openCampaignFolderBrowser"
      >
        Select campaign folder
      </button>

      <input
        ref="campaignFolderInput"
        class="campaign-folder-input"
        type="file"
        multiple
        aria-label="Campaign folder"
        v-bind="campaignFolderPickerAttrs"
        @change="handleCampaignFolderSelection"
      >

      <p class="campaign-folder-status" aria-live="polite">
        {{ campaignFolderStatus }}
      </p>

      <section class="settings-group" aria-labelledby="appearance-settings-title">
        <div class="settings-group__copy">
          <h2 id="appearance-settings-title">Appearance</h2>
          <p>{{ appThemeModeTitle }}</p>
        </div>

        <div class="settings-group__control">
          <span class="settings-status">{{ appThemeModeLabel }}</span>
          <button
            type="button"
            class="settings-toggle"
            :class="{ 'is-light': isLightAppTheme }"
            :aria-pressed="isLightAppTheme"
            :aria-label="appThemeToggleLabel"
            :title="appThemeToggleLabel"
            @click="toggleAppThemeMode"
          >
            <span class="settings-toggle__eyebrow">Theme</span>
            <span>{{ appThemeToggleText }}</span>
          </button>
        </div>
      </section>

      <section class="settings-group" aria-labelledby="move-vfx-settings-title">
        <div class="settings-group__copy">
          <h2 id="move-vfx-settings-title">Move VFX</h2>
          <p>{{ moveAnimationsStatusTitle }}</p>
          <p
            v-if="moveAnimationsReducedMotion"
            class="settings-note"
          >
            Your system prefers reduced motion, so move VFX render with reduced-motion safeguards.
          </p>
        </div>

        <div class="settings-group__control">
          <span
            class="settings-status"
            :class="{ 'is-disabled': !moveAnimationsEnabled }"
          >
            {{ moveAnimationsStatusLabel }}
          </span>
          <button
            type="button"
            class="settings-toggle move-animation-toggle"
            :class="{ 'is-disabled': !moveAnimationsEnabled }"
            :aria-pressed="moveAnimationsEnabled"
            :aria-label="moveAnimationsToggleLabel"
            :title="moveAnimationsStatusTitle"
            @click="toggleMoveAnimationsEnabled"
          >
            <span class="settings-toggle__eyebrow">Move VFX</span>
            <span>{{ moveAnimationsToggleText }}</span>
          </button>
        </div>
      </section>
    </section>
  </main>
</template>

<style scoped>
.settings-page {
  min-height: 100vh;
  display: grid;
  align-content: start;
  gap: 1rem;
  padding: 1rem;
  background:
    radial-gradient(circle at top left, rgba(255, 31, 45, 0.12), transparent 32rem),
    var(--paper);
}

.settings-panel {
  display: grid;
  gap: 1rem;
  justify-items: start;
}

.settings-group {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  max-width: 44rem;
  padding: 0.9rem;
  border: 1px solid var(--rule-soft);
  border-radius: 12px;
  background: color-mix(in srgb, var(--paper-soft) 72%, transparent);
}

.settings-group__copy {
  display: grid;
  gap: 0.35rem;
  min-width: min(22rem, 100%);
  max-width: 32rem;
}

.settings-group__copy h2,
.settings-group__copy p {
  margin: 0;
}

.settings-group__copy h2 {
  color: var(--ink-bright);
  font-size: 1rem;
}

.settings-group__copy p {
  color: var(--ink-soft);
  line-height: 1.5;
}

.settings-note {
  color: color-mix(in srgb, var(--accent) 72%, var(--ink-soft));
  font-size: 0.9rem;
}

.settings-group__control {
  display: grid;
  gap: 0.4rem;
  justify-items: start;
}

.settings-status {
  color: var(--accent);
  font-size: 0.72rem;
  font-weight: 900;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.settings-status.is-disabled {
  color: var(--ink-muted);
}

.eyebrow {
  margin: 0 0 0.35rem;
  color: var(--accent);
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.campaign-folder-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 2.6rem;
  padding: 0.65rem 1rem;
  border: 1px solid var(--accent);
  background: var(--accent-soft);
  color: var(--ink-bright);
  cursor: pointer;
  font-weight: 900;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    color 0.15s ease;
}

.campaign-folder-button:hover,
.campaign-folder-button:focus-visible {
  border-color: var(--rule-strong);
  background: var(--paper-hover);
  color: var(--accent);
  outline: none;
}

.campaign-folder-input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

.campaign-folder-status {
  margin: 0;
  color: var(--ink-soft);
  line-height: 1.5;
}

.settings-toggle {
  display: inline-flex;
  flex-direction: column;
  gap: 0.08rem;
  align-items: flex-start;
  min-width: 9.5rem;
  padding: 0.54rem 0.72rem;
  border: 1px solid color-mix(in srgb, var(--accent) 55%, var(--rule-soft));
  border-radius: 0.8rem;
  background: color-mix(in srgb, var(--paper) 86%, var(--accent-soft));
  color: var(--ink-bright);
  box-shadow: 0 14px 34px color-mix(in srgb, var(--pokemon-black) 22%, transparent);
  font: inherit;
  font-size: 0.78rem;
  font-weight: 900;
  line-height: 1.15;
  cursor: pointer;
}

.settings-toggle:not(.is-disabled):hover,
.settings-toggle:focus-visible {
  border-color: color-mix(in srgb, var(--accent) 78%, var(--ink-bright) 12%);
  background: color-mix(in srgb, var(--paper-hover) 72%, var(--accent-soft));
  outline: none;
}

.settings-toggle.is-light {
  background: color-mix(in srgb, var(--accent-soft) 58%, var(--paper));
}

.settings-toggle.is-disabled {
  border-color: color-mix(in srgb, var(--ink-muted) 44%, var(--rule-soft));
  color: color-mix(in srgb, var(--ink-muted) 88%, var(--paper));
}

.settings-toggle__eyebrow {
  color: color-mix(in srgb, currentColor 64%, transparent);
  font-size: 0.64rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
</style>

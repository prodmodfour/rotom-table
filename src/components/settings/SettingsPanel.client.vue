<script setup lang="ts">
import { computed, ref } from 'vue'
import { useActionSplashSettings } from '~/composables/useActionSplashSettings'
import { useInitiativeAutoFocusSettings } from '~/composables/useInitiativeAutoFocusSettings'
import { useMoveAnimationSettings } from '~/composables/useMoveAnimationSettings'
import { useSoundEffectSettings } from '~/composables/useSoundEffectSettings'
import {
  ACTION_SPLASH_DISPLAY_DURATION_STEP_MS,
  ACTION_SPLASH_SPEED_LINES_DURATION_STEP_MS,
  DEFAULT_ACTION_SPLASH_DISPLAY_DURATION_MS,
  DEFAULT_ACTION_SPLASH_SPEED_LINES_DURATION_MS,
  MAX_ACTION_SPLASH_DISPLAY_DURATION_MS,
  MAX_ACTION_SPLASH_SPEED_LINES_DURATION_MS,
  MIN_ACTION_SPLASH_DISPLAY_DURATION_MS,
  MIN_ACTION_SPLASH_SPEED_LINES_DURATION_MS,
} from '~/utils/actionSplashSettings'

const { isGm } = useAuth()

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
const campaignFolderToggleText = computed(() => (
  selectedCampaignFolderName.value ? 'Change folder' : 'Select folder'
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
const {
  initiativeAutoFocusEnabled,
  initiativeAutoFocusStatusLabel,
  initiativeAutoFocusStatusTitle,
  initiativeAutoFocusToggleLabel,
  toggleInitiativeAutoFocusEnabled,
} = useInitiativeAutoFocusSettings()
const {
  soundEffectsEnabled,
  soundEffectsStatusLabel,
  soundEffectsStatusTitle,
  soundEffectsToggleLabel,
  toggleSoundEffectsEnabled,
} = useSoundEffectSettings()
const {
  actionSplashDisplayDurationMs,
  actionSplashDisplayDurationLabel,
  actionSplashDisplayDurationTitle,
  setActionSplashDisplayDurationMs,
  resetActionSplashDisplayDurationMs,
  actionSplashSpeedLinesDurationMs,
  actionSplashSpeedLinesDurationLabel,
  actionSplashSpeedLinesDurationTitle,
  setActionSplashSpeedLinesDurationMs,
  resetActionSplashSpeedLinesDurationMs,
} = useActionSplashSettings()

const actionSplashDisplayDurationRange = computed({
  get: () => actionSplashDisplayDurationMs.value,
  set: (durationMs: number) => setActionSplashDisplayDurationMs(durationMs),
})

const actionSplashSpeedLinesDurationRange = computed({
  get: () => actionSplashSpeedLinesDurationMs.value,
  set: (durationMs: number) => setActionSplashSpeedLinesDurationMs(durationMs),
})

const appThemeToggleText = computed(() => (
  isLightAppTheme.value ? 'Light mode' : 'Dark mode'
))
const moveAnimationsToggleText = computed(() => (
  moveAnimationsEnabled.value ? 'Animations on' : 'Animations off'
))
const initiativeAutoFocusToggleText = computed(() => (
  initiativeAutoFocusEnabled.value ? 'Auto-focus on' : 'Auto-focus off'
))
const soundEffectsToggleText = computed(() => (
  soundEffectsEnabled.value ? 'SFX on' : 'SFX off'
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
  <section class="settings-panel panel-card" aria-label="Settings">
    <section
      v-if="isGm"
      class="settings-group"
      aria-labelledby="campaign-folder-settings-title"
    >
      <div class="settings-group__copy">
        <h2 id="campaign-folder-settings-title">Campaign folder</h2>
        <p aria-live="polite">{{ campaignFolderStatus }}</p>
      </div>

      <div class="settings-group__control">
        <span class="settings-status">Local files</span>
        <button
          type="button"
          class="settings-toggle"
          @click="openCampaignFolderBrowser"
        >
          <span class="settings-toggle__eyebrow">Campaign</span>
          <span>{{ campaignFolderToggleText }}</span>
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
      </div>
    </section>

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

    <section class="settings-group" aria-labelledby="map-display-settings-title">
      <div class="settings-group__copy">
        <h2 id="map-display-settings-title">Map display</h2>
        <p>{{ initiativeAutoFocusStatusTitle }}</p>
      </div>

      <div class="settings-group__control">
        <span
          class="settings-status"
          :class="{ 'is-disabled': !initiativeAutoFocusEnabled }"
        >
          {{ initiativeAutoFocusStatusLabel }}
        </span>
        <button
          type="button"
          class="settings-toggle initiative-auto-focus-toggle"
          :class="{ 'is-disabled': !initiativeAutoFocusEnabled }"
          :aria-pressed="initiativeAutoFocusEnabled"
          :aria-label="initiativeAutoFocusToggleLabel"
          :title="initiativeAutoFocusStatusTitle"
          @click="toggleInitiativeAutoFocusEnabled"
        >
          <span class="settings-toggle__eyebrow">Camera</span>
          <span>Auto-focus active initiative</span>
          <span class="settings-toggle__meta">{{ initiativeAutoFocusToggleText }}</span>
        </button>
      </div>
    </section>

    <section class="settings-group" aria-labelledby="action-splash-settings-title">
      <div class="settings-group__copy">
        <h2 id="action-splash-settings-title">Action splash</h2>
        <p>{{ actionSplashDisplayDurationTitle }}</p>
        <p>{{ actionSplashSpeedLinesDurationTitle }}</p>
      </div>

      <div class="settings-group__control settings-group__control--wide settings-range-stack">
        <div class="settings-range-control">
          <span class="settings-status">{{ actionSplashDisplayDurationLabel }}</span>
          <label class="settings-range">
            <span class="settings-toggle__eyebrow">Display duration</span>
            <input
              v-model.number="actionSplashDisplayDurationRange"
              type="range"
              :min="MIN_ACTION_SPLASH_DISPLAY_DURATION_MS"
              :max="MAX_ACTION_SPLASH_DISPLAY_DURATION_MS"
              :step="ACTION_SPLASH_DISPLAY_DURATION_STEP_MS"
              :aria-valuetext="actionSplashDisplayDurationLabel"
            >
          </label>
          <button
            type="button"
            class="settings-reset"
            @click="resetActionSplashDisplayDurationMs"
          >
            Reset to {{ DEFAULT_ACTION_SPLASH_DISPLAY_DURATION_MS }} ms
          </button>
        </div>

        <div class="settings-range-control">
          <span class="settings-status">{{ actionSplashSpeedLinesDurationLabel }}</span>
          <label class="settings-range">
            <span class="settings-toggle__eyebrow">Speed lines</span>
            <input
              v-model.number="actionSplashSpeedLinesDurationRange"
              type="range"
              :min="MIN_ACTION_SPLASH_SPEED_LINES_DURATION_MS"
              :max="MAX_ACTION_SPLASH_SPEED_LINES_DURATION_MS"
              :step="ACTION_SPLASH_SPEED_LINES_DURATION_STEP_MS"
              :aria-valuetext="actionSplashSpeedLinesDurationLabel"
            >
          </label>
          <button
            type="button"
            class="settings-reset"
            @click="resetActionSplashSpeedLinesDurationMs"
          >
            Reset to {{ DEFAULT_ACTION_SPLASH_SPEED_LINES_DURATION_MS }} ms
          </button>
        </div>
      </div>
    </section>

    <section class="settings-group" aria-labelledby="sound-effects-settings-title">
      <div class="settings-group__copy">
        <h2 id="sound-effects-settings-title">Sound effects</h2>
        <p>{{ soundEffectsStatusTitle }}</p>
      </div>

      <div class="settings-group__control">
        <span
          class="settings-status"
          :class="{ 'is-disabled': !soundEffectsEnabled }"
        >
          {{ soundEffectsStatusLabel }}
        </span>
        <button
          type="button"
          class="settings-toggle sound-effect-toggle"
          :class="{ 'is-disabled': !soundEffectsEnabled }"
          :aria-pressed="soundEffectsEnabled"
          :aria-label="soundEffectsToggleLabel"
          :title="soundEffectsStatusTitle"
          @click="toggleSoundEffectsEnabled"
        >
          <span class="settings-toggle__eyebrow">Audio</span>
          <span>{{ soundEffectsToggleText }}</span>
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
</template>

<style scoped>
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

.settings-group__control--wide {
  min-width: min(16rem, 100%);
}

.settings-range-stack {
  gap: 0.85rem;
}

.settings-range-control {
  display: grid;
  gap: 0.35rem;
  width: 100%;
}

.settings-range {
  display: grid;
  gap: 0.35rem;
  width: 100%;
  color: var(--ink-bright);
  font-size: 0.78rem;
  font-weight: 900;
}

.settings-range input {
  width: 100%;
  accent-color: var(--accent);
}

.settings-reset {
  border: 0;
  padding: 0;
  background: transparent;
  color: color-mix(in srgb, var(--accent) 82%, var(--ink-bright));
  font: inherit;
  font-size: 0.72rem;
  font-weight: 900;
  cursor: pointer;
}

.settings-reset:hover,
.settings-reset:focus-visible {
  color: var(--accent);
  outline: none;
  text-decoration: underline;
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

.campaign-folder-input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
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

.settings-toggle__meta {
  color: color-mix(in srgb, currentColor 72%, transparent);
  font-size: 0.66rem;
}
</style>

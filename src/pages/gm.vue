<script setup lang="ts">
import { computed, ref } from 'vue'
import AppNavigation from '~/components/AppNavigation.vue'
import { DEFAULT_LOGIN_REDIRECT } from '~/utils/loginRedirect'

useHead({ title: 'GM · Rotom Table' })

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
  <main class="gm-page">
    <AppNavigation />

    <section class="gm-panel panel-card" aria-labelledby="gm-page-title">
      <div>
        <p class="eyebrow">GM tools</p>
        <h1 id="gm-page-title">GM</h1>
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
    </section>
  </main>
</template>

<style scoped>
.gm-page {
  min-height: 100vh;
  display: grid;
  align-content: start;
  gap: 1rem;
  padding: 1rem;
  background:
    radial-gradient(circle at top left, rgba(255, 31, 45, 0.12), transparent 32rem),
    var(--paper);
}

.gm-panel {
  display: grid;
  gap: 1rem;
  justify-items: start;
}

.eyebrow {
  margin: 0 0 0.35rem;
  color: var(--accent);
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

h1 {
  margin: 0;
  color: var(--ink-bright);
  font-family: var(--font-book);
  font-size: clamp(2.2rem, 7vw, 3.6rem);
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
</style>

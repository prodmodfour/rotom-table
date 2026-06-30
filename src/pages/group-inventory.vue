<script setup lang="ts">
import { computed } from 'vue'
import AppNavigation from '~/components/AppNavigation.vue'
import GroupInventoryPanel from '~/components/inventory/GroupInventoryPanel.vue'
import { groupInventoryChannel } from '#shared/realtime'
import { useGroupInventoryEditor } from '~/composables/useGroupInventoryEditor'
import { useGroupInventoryTransfers } from '~/composables/useGroupInventoryTransfers'
import { useRealtimeChannel, type RealtimeEvent } from '~/composables/useRealtime'
import { GROUP_INVENTORY_API_PATHS } from '~/utils/apiRoutes'
import { getClientId } from '~/utils/clientId'
import { getErrorMessage } from '~/utils/errorMessages'
import { applyGroupInventoryRealtimeEvent } from '~/utils/groupInventoryRealtime'
import {
  GROUP_INVENTORY_MAIN_SLUG,
  type GroupInventoryDocument,
} from '~/types/groupInventory'

const { isGm, isPlayer } = useAuth()
const {
  selectedProfileId,
  loadRememberedProfile,
} = usePlayerProfiles()

if (import.meta.client && isPlayer.value) loadRememberedProfile()

const {
  data: groupInventoryDocument,
  error: groupInventoryError,
  refresh: refreshGroupInventory,
  status: groupInventoryStatus,
} = await useFetch<GroupInventoryDocument | null>(GROUP_INVENTORY_API_PATHS.load, {
  default: () => null,
  key: 'group-inventory-main',
})

const groupInventoryEditor = useGroupInventoryEditor(groupInventoryDocument, { canEdit: isGm })
const transferBlockedByUnsavedEdits = computed(() => (
  groupInventoryEditor.isDirty.value || groupInventoryEditor.saveStatus.value === 'saving'
))
const adoptGroupInventoryDocument = (document: GroupInventoryDocument) => {
  groupInventoryDocument.value = document
  groupInventoryEditor.adoptAuthoritativeDocument(document)
}
const groupInventoryTransfers = useGroupInventoryTransfers({
  groupInventoryDocument: groupInventoryEditor.document,
  adoptGroupInventoryDocument,
  isGm,
  isPlayer,
  selectedProfileId,
  transferBlocked: transferBlockedByUnsavedEdits,
})
const clientId = getClientId()
const handleGroupInventoryRealtimeEvent = (event: RealtimeEvent) => {
  const result = applyGroupInventoryRealtimeEvent(event, {
    currentDocument: groupInventoryEditor.document.value,
    clientId,
    expectedSlug: GROUP_INVENTORY_MAIN_SLUG,
  })
  if (result.status === 'adopted') adoptGroupInventoryDocument(result.document)
}

if (import.meta.client) {
  useRealtimeChannel(groupInventoryChannel(GROUP_INVENTORY_MAIN_SLUG), handleGroupInventoryRealtimeEvent)
}

const isGroupInventoryLoading = computed(() => (
  groupInventoryStatus.value === 'idle' || groupInventoryStatus.value === 'pending'
))
const groupInventoryErrorMessage = computed(() => (
  groupInventoryError.value
    ? getErrorMessage(groupInventoryError.value, { fallback: 'The shared inventory could not be loaded.' })
    : null
))

const reloadGroupInventory = async () => {
  await refreshGroupInventory()
}

useHead({
  title: 'Inventory · Rotom Table',
  meta: [
    {
      name: 'description',
      content: 'Shared party inventory workspace for Rotom Table live-play campaigns.',
    },
  ],
})
</script>

<template>
  <main class="group-inventory-page">
    <AppNavigation />

    <header class="group-inventory-hero panel-card">
      <div>
        <p class="group-inventory-eyebrow">Party inventory</p>
        <h1>Inventory</h1>
        <p>
          View the shared campaign inventory for the table. GMs can edit and save the authoritative document with revision protection; GMs and players can transfer items with eligible trainer sheets after revision checks pass.
        </p>
      </div>
    </header>

    <section class="group-inventory-state" aria-label="Shared inventory status">
      <article
        v-if="isGroupInventoryLoading && !groupInventoryDocument"
        class="group-inventory-panel panel-card"
        aria-busy="true"
        aria-live="polite"
      >
        <p class="group-inventory-eyebrow">Loading</p>
        <h2>Loading shared inventory…</h2>
        <p>Checking the campaign inventory state from the live-play storage API.</p>
      </article>

      <article
        v-else-if="groupInventoryErrorMessage"
        class="group-inventory-panel group-inventory-panel--error panel-card"
        role="alert"
      >
        <p class="group-inventory-eyebrow">Unavailable</p>
        <h2>Could not open shared inventory</h2>
        <p>{{ groupInventoryErrorMessage }}</p>
        <button type="button" class="group-inventory-retry" @click="refreshGroupInventory()">
          Retry loading inventory
        </button>
      </article>

      <GroupInventoryPanel
        v-else-if="groupInventoryEditor.document.value"
        :document="groupInventoryEditor.document.value"
        :can-edit="isGm"
        :is-dirty="groupInventoryEditor.isDirty.value"
        :save-status="groupInventoryEditor.saveStatus.value"
        :save-error="groupInventoryEditor.saveError.value"
        :can-transfer="groupInventoryTransfers.canTransfer.value"
        :transfer-unavailable-reason="groupInventoryTransfers.transferUnavailableReason.value"
        :transfer-trainers="groupInventoryTransfers.eligibleTrainers.value"
        :trainer-load-status="groupInventoryTransfers.trainerLoadStatus.value"
        :trainer-load-error="groupInventoryTransfers.trainerLoadError.value"
        :transfer-status="groupInventoryTransfers.transferStatus.value"
        :transfer-error="groupInventoryTransfers.transferError.value"
        :transfer-notice="groupInventoryTransfers.transferNotice.value"
        @save="groupInventoryEditor.save"
        @reload-after-conflict="reloadGroupInventory"
        @refresh-transfer-trainers="groupInventoryTransfers.loadTrainers"
        @transfer-to-trainer="groupInventoryTransfers.transferToTrainer"
        @transfer-to-group="groupInventoryTransfers.transferToGroup"
      />

      <article v-else class="group-inventory-panel panel-card" role="status">
        <p class="group-inventory-eyebrow">Empty</p>
        <h2>No shared inventory document loaded</h2>
        <p>The campaign inventory API returned no document. Try refreshing the page to request the default shared inventory again.</p>
      </article>
    </section>
  </main>
</template>

<style scoped>
.group-inventory-page {
  min-height: 100vh;
  display: grid;
  align-content: start;
  gap: 1rem;
  padding: 1rem;
  background:
    radial-gradient(circle at top left, rgba(var(--accent-rgb), 0.14), transparent 30rem),
    var(--paper);
  color: var(--ink);
}

.group-inventory-hero,
.group-inventory-panel {
  display: grid;
  gap: 0.7rem;
}

.group-inventory-hero p,
.group-inventory-panel p {
  max-width: 68ch;
  margin: 0;
  color: var(--ink-soft);
  line-height: 1.55;
}

.group-inventory-hero .group-inventory-eyebrow,
.group-inventory-panel .group-inventory-eyebrow {
  color: var(--accent);
  font-size: 0.76rem;
  font-weight: 900;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.group-inventory-hero h1,
.group-inventory-panel h2 {
  margin: 0;
  color: var(--ink-bright);
  font-family: var(--font-book);
  letter-spacing: 0.04em;
}

.group-inventory-hero h1 {
  font-size: clamp(2rem, 5vw, 3.4rem);
}

.group-inventory-panel h2 {
  font-size: clamp(1.45rem, 3vw, 2.1rem);
}

.group-inventory-state {
  display: grid;
  gap: 1rem;
}

.group-inventory-panel--error {
  border-color: color-mix(in srgb, var(--bad) 60%, var(--rule-soft));
}

.group-inventory-retry {
  justify-self: start;
  border: 1px solid var(--rule-soft);
  border-radius: 999px;
  background: var(--paper-inset);
  color: var(--accent);
  cursor: pointer;
  font: inherit;
  font-size: 0.82rem;
  font-weight: 900;
  letter-spacing: 0.08em;
  padding: 0.55rem 0.85rem;
  text-transform: uppercase;
}

.group-inventory-retry:hover,
.group-inventory-retry:focus-visible {
  border-color: var(--rule-active);
  background: var(--paper-hover);
  outline: none;
}
</style>

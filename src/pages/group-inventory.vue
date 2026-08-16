<script setup lang="ts">
import { computed, watch } from 'vue'
import AppNavigation from '~/components/AppNavigation.vue'
import GroupInventoryPanel from '~/components/inventory/GroupInventoryPanel.vue'
import { groupInventoryChannel } from '#shared/realtime'
import { useGroupInventoryEditor } from '~/composables/useGroupInventoryEditor'
import { useGroupInventoryActionFlows } from '~/composables/useGroupInventoryActionFlows'
import { useGroupInventoryItemActions } from '~/composables/useGroupInventoryItemActions'
import { useInventoryHistory } from '~/composables/inventory/useInventoryHistory'
import { useRealtimeChannel, type RealtimeEvent } from '~/composables/useRealtime'
import { GROUP_INVENTORY_API_PATHS } from '~/utils/apiRoutes'
import { getClientId } from '~/utils/clientId'
import { getErrorMessage } from '~/utils/errorMessages'
import { parseInventoryContinuationRouteIntent } from '~/utils/inventoryContinuationRoute'
import { applyGroupInventoryRealtimeEvent } from '~/utils/groupInventoryRealtime'
import {
  GROUP_INVENTORY_MAIN_SLUG,
  type GroupInventoryDocument,
} from '~/types/groupInventory'

const route = useRoute()
const { isGm, isPlayer } = useAuth()
const inventoryContinuation = computed(() => parseInventoryContinuationRouteIntent(route.query))
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
const inventoryHistoryScope = computed(() => groupInventoryEditor.document.value?.slug
  ? { kind: 'group' as const, slug: groupInventoryEditor.document.value.slug }
  : null)
const inventoryHistory = useInventoryHistory({
  scope: inventoryHistoryScope,
  profileId: selectedProfileId,
})
const transferBlockedByUnsavedEdits = computed(() => (
  groupInventoryEditor.isDirty.value || groupInventoryEditor.saveStatus.value === 'saving'
))
const adoptGroupInventoryDocument = (document: GroupInventoryDocument) => {
  groupInventoryDocument.value = document
  groupInventoryEditor.adoptAuthoritativeDocument(document)
}
const reconcileGroupInventoryAuthority = async (): Promise<void> => {
  await refreshGroupInventory()
  if (groupInventoryError.value) throw new Error(getErrorMessage(groupInventoryError.value))
  const authoritative = groupInventoryDocument.value
  if (!authoritative) throw new Error('The authoritative shared inventory could not be reloaded.')
  groupInventoryEditor.adoptAuthoritativeDocument(authoritative)
}
const groupInventoryActions = useGroupInventoryActionFlows({
  document: groupInventoryEditor.document,
  hasUnsavedEdits: transferBlockedByUnsavedEdits,
  profileId: selectedProfileId,
  reconcileAuthority: reconcileGroupInventoryAuthority,
  onAccepted: (response) => {
    const authoritative = response.groupInventories.find(document => document.slug === groupInventoryEditor.document.value?.slug)
    if (!authoritative) throw new Error('Accepted inventory action did not return authoritative group inventory.')
    adoptGroupInventoryDocument(authoritative)
    void inventoryHistory.refresh()
  },
})
const groupInventoryItemActions = useGroupInventoryItemActions({
  document: groupInventoryEditor.document,
  hasUnsavedEdits: transferBlockedByUnsavedEdits,
  externallyBlocked: groupInventoryActions.mutationBlocked,
  profileId: selectedProfileId,
  reconcileAuthority: reconcileGroupInventoryAuthority,
  onAccepted: async (response) => {
    if (response.groupInventory) adoptGroupInventoryDocument(response.groupInventory)
    else await refreshGroupInventory()
    await Promise.all([
      groupInventoryActions.load(),
      inventoryHistory.refresh(),
    ])
  },
  onPending: async () => {
    await groupInventoryActions.load()
  },
})
let handledContinuationSignature: string | null = null
watch(
  [
    inventoryContinuation,
    () => groupInventoryActions.projection.value?.generatedAt ?? null,
    () => groupInventoryItemActions.projection.value?.generatedAt ?? null,
  ],
  async ([intent]) => {
    if (!intent || typeof intent !== 'object') return
    const signature = `${intent.action}:${intent.sourceSelectionId}:${intent.itemActorSelectionId ?? ''}`
    if (handledContinuationSignature === signature) return
    if (intent.action === 'use') {
      if (intent.itemActorSelectionId
        && groupInventoryItemActions.projection.value?.selectedActorSelectionId !== intent.itemActorSelectionId) {
        await groupInventoryItemActions.chooseActor(intent.itemActorSelectionId)
        return
      }
      const offer = groupInventoryItemActions.projection.value?.offers.find(candidate => (
        candidate.source.sourceSelectionId === intent.sourceSelectionId
        && candidate.availability.enabled
        && candidate.actions.find(action => action.kind === 'use')?.enabled
      ))
      if (!offer) return
      handledContinuationSignature = signature
      groupInventoryItemActions.openOffer(offer)
      return
    }
    if (intent.action !== 'transfer') return
    const offer = groupInventoryActions.projection.value?.offers.find(candidate => (
      candidate.action === 'transfer'
      && candidate.source.locationKind === 'group-inventory'
      && candidate.source.sourceSelectionId === intent.sourceSelectionId
      && candidate.enabled
    ))
    if (!offer) return
    handledContinuationSignature = signature
    groupInventoryActions.open(offer)
  },
  { immediate: true },
)

const inventoryActionCanBegin = computed(() => (
  groupInventoryActions.canBegin.value && !groupInventoryItemActions.mutationBlocked.value
))
const inventoryActionUnavailableReason = computed(() => {
  if (!isGm.value && !isPlayer.value) return 'Log in as a GM or player before changing shared inventory.'
  if (isPlayer.value && !selectedProfileId.value) return 'Choose a player profile before using shared inventory actions for linked Trainer sheets.'
  if (transferBlockedByUnsavedEdits.value) return 'Save or reload shared inventory edits before changing items.'
  if (groupInventoryItemActions.uncertain.value) return 'Recover the exact uncertain shared item use before changing inventory.'
  if (groupInventoryItemActions.mutationBlocked.value) return 'Finish or close the current shared item use before another inventory action.'
  if (groupInventoryActions.status.value === 'error' || groupInventoryActions.status.value === 'conflict') {
    return groupInventoryActions.message.value
  }
  return null
})
const itemUseUnavailableReason = computed(() => {
  if (!isGm.value && !isPlayer.value) return 'Log in as a GM or player before using shared inventory.'
  if (isPlayer.value && !selectedProfileId.value) return 'Choose a player profile to select its linked acting Trainer.'
  if (transferBlockedByUnsavedEdits.value) return 'Save or reload shared inventory edits before using an item.'
  if (groupInventoryActions.uncertain.value) return 'Recover the exact uncertain inventory action before using a shared item.'
  if (groupInventoryActions.mutationBlocked.value) return 'Finish or close the current inventory action before using a shared item.'
  if (groupInventoryItemActions.status.value === 'error' || groupInventoryItemActions.status.value === 'conflict') {
    return groupInventoryItemActions.message.value
  }
  return null
})
const canEditGroupInventory = computed(() => isGm.value
  && !groupInventoryActions.mutationBlocked.value
  && !groupInventoryItemActions.mutationBlocked.value)
const clientId = getClientId()
const handleGroupInventoryRealtimeEvent = (event: RealtimeEvent) => {
  const result = applyGroupInventoryRealtimeEvent(event, {
    currentDocument: groupInventoryEditor.document.value,
    clientId,
    expectedSlug: GROUP_INVENTORY_MAIN_SLUG,
  })
  if (result.status === 'adopted') {
    adoptGroupInventoryDocument(result.document)
    void inventoryHistory.refresh()
  }
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
  title: 'Group Inventory · Rotom Table',
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
        :can-edit="canEditGroupInventory"
        :is-dirty="groupInventoryEditor.isDirty.value"
        :save-status="groupInventoryEditor.saveStatus.value"
        :save-error="groupInventoryEditor.saveError.value"
        :action-offers="groupInventoryActions.projection.value?.offers ?? []"
        :selected-action-offer="groupInventoryActions.selectedOffer.value"
        :selected-destination-id="groupInventoryActions.selectedDestinationId.value"
        :selected-quantity="groupInventoryActions.selectedQuantity.value"
        :selected-confirmation-option-id="groupInventoryActions.selectedConfirmationOptionId.value"
        :action-status="groupInventoryActions.status.value"
        :action-message="groupInventoryActions.message.value"
        :action-busy="groupInventoryActions.busy.value"
        :action-recovery-online="groupInventoryActions.online.value"
        :action-exact-retry-available="groupInventoryActions.exactRetryAvailable.value"
        :action-can-begin="inventoryActionCanBegin"
        :action-unavailable-reason="inventoryActionUnavailableReason"
        :item-actors="groupInventoryItemActions.projection.value?.actors ?? []"
        :selected-item-actor-id="groupInventoryItemActions.projection.value?.selectedActorSelectionId ?? null"
        :item-action-offers="groupInventoryItemActions.projection.value?.offers ?? []"
        :selected-item-offer="groupInventoryItemActions.selectedOffer.value"
        :item-selected-target-ids="groupInventoryItemActions.selectedTargetIds.value"
        :item-selected-choices="groupInventoryItemActions.selectedChoices.value"
        :item-status="groupInventoryItemActions.status.value"
        :item-message="groupInventoryItemActions.message.value"
        :item-accepted-sheet-links="groupInventoryItemActions.acceptedSheetLinks.value"
        :item-busy="groupInventoryItemActions.busy.value"
        :item-recovery-online="groupInventoryItemActions.online.value"
        :item-exact-retry-available="groupInventoryItemActions.exactRetryAvailable.value"
        :item-can-begin="groupInventoryItemActions.canBegin.value"
        :item-unavailable-reason="itemUseUnavailableReason"
        :inventory-history="inventoryHistory.projection.value"
        :inventory-history-status="inventoryHistory.status.value"
        :inventory-history-error="inventoryHistory.error.value"
        @save="groupInventoryEditor.save"
        @reload-after-conflict="reloadGroupInventory"
        @refresh-actions="groupInventoryActions.refresh"
        @open-action="groupInventoryActions.open"
        @choose-destination="groupInventoryActions.chooseDestination"
        @set-quantity="groupInventoryActions.setQuantity"
        @set-confirmation="groupInventoryActions.setConfirmation"
        @confirm-action="groupInventoryActions.submit"
        @cancel-action="groupInventoryActions.close"
        @retry-exact="groupInventoryActions.retryExact"
        @dismiss-action="groupInventoryActions.dismiss"
        @choose-item-actor="groupInventoryItemActions.chooseActor"
        @open-item-use="groupInventoryItemActions.openOffer"
        @choose-item-target="groupInventoryItemActions.chooseTarget"
        @choose-item-option="groupInventoryItemActions.chooseOption"
        @confirm-item-use="groupInventoryItemActions.submit"
        @cancel-item-use="groupInventoryItemActions.closeDecision"
        @retry-exact-item-use="groupInventoryItemActions.retryExact"
        @refresh-item-uses="groupInventoryItemActions.refresh"
        @refresh-inventory-history="inventoryHistory.refresh"
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
  min-width: 0;
  max-width: 100%;
  display: grid;
  align-content: start;
  gap: 1rem;
  padding: 1rem;
  background:
    radial-gradient(circle at top left, rgba(var(--accent-rgb), 0.14), transparent 30rem),
    var(--paper);
  color: var(--ink);
}

.group-inventory-panel {
  display: grid;
  gap: 0.7rem;
}

.group-inventory-panel p {
  max-width: 68ch;
  margin: 0;
  color: var(--ink-soft);
  line-height: 1.55;
}

.group-inventory-panel .group-inventory-eyebrow {
  color: var(--accent);
  font-size: 0.76rem;
  font-weight: 900;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.group-inventory-panel h2 {
  margin: 0;
  color: var(--ink-bright);
  font-family: var(--font-book);
  font-size: clamp(1.45rem, 3vw, 2.1rem);
  letter-spacing: 0.04em;
}

.group-inventory-state {
  display: grid;
  min-width: 0;
  max-width: 100%;
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

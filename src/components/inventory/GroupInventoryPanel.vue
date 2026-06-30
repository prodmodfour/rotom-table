<script setup lang="ts">
import { computed, ref } from 'vue'
import InventoryItemTable from '~/components/inventory/InventoryItemTable.vue'
import InventorySectionTabs from '~/components/inventory/InventorySectionTabs.vue'
import { TRAINER_INVENTORY_SECTIONS } from '~/utils/sheets/trainerInventorySections'
import type { GroupInventoryDocument } from '~/types/groupInventory'
import type { TrainerInventoryKey } from '~/utils/sheets/trainerInventorySections'

const props = defineProps<{
  document: GroupInventoryDocument
}>()

const activeSectionKey = ref<TrainerInventoryKey>(TRAINER_INVENTORY_SECTIONS[0].key)
const activeSection = computed(() => (
  TRAINER_INVENTORY_SECTIONS.find((section) => section.key === activeSectionKey.value)
  ?? TRAINER_INVENTORY_SECTIONS[0]
))
const inventorySectionCounts = computed<Partial<Record<TrainerInventoryKey, number>>>(() => (
  TRAINER_INVENTORY_SECTIONS.reduce<Partial<Record<TrainerInventoryKey, number>>>((counts, section) => {
    counts[section.key] = props.document.inventory[section.key]?.length ?? 0
    return counts
  }, {})
))
const activeSectionItems = computed(() => props.document.inventory[activeSection.value.key] ?? [])
const totalItemRows = computed(() => (
  TRAINER_INVENTORY_SECTIONS.reduce((total, section) => total + (props.document.inventory[section.key]?.length ?? 0), 0)
))
const isInventoryEmpty = computed(() => totalItemRows.value === 0)
const moneyDisplay = computed(() => `$${props.document.money.toLocaleString('en-US')}`)
const notes = computed(() => props.document.notes?.trim() ?? '')
</script>

<template>
  <article class="group-inventory-panel panel-card" aria-labelledby="group-inventory-panel-title">
    <header class="group-inventory-panel__header">
      <div>
        <p class="group-inventory-panel__eyebrow">Shared campaign state</p>
        <h2 id="group-inventory-panel-title">Shared party inventory</h2>
        <p>
          This read-only view shows the authoritative campaign inventory document for both GMs and players.
        </p>
      </div>

      <dl class="group-inventory-panel__summary" aria-label="Group inventory summary">
        <div>
          <dt>Money</dt>
          <dd>{{ moneyDisplay }}</dd>
        </div>
        <div>
          <dt>Rows</dt>
          <dd>{{ totalItemRows }}</dd>
        </div>
        <div>
          <dt>Revision</dt>
          <dd>{{ document.revision }}</dd>
        </div>
      </dl>
    </header>

    <p
      v-if="isInventoryEmpty"
      class="group-inventory-panel__empty"
      role="status"
      aria-live="polite"
    >
      No shared inventory rows yet. The campaign inventory exists, but every section is empty.
    </p>

    <InventorySectionTabs
      v-model:active-section-key="activeSectionKey"
      :counts="inventorySectionCounts"
    />

    <div class="group-inventory-panel__section">
      <InventoryItemTable
        :key="activeSection.key"
        :section-key="activeSection.key"
        :title="activeSection.title"
        :items="activeSectionItems"
        :name-placeholder="activeSection.namePlaceholder"
        :variant="activeSection.variant"
        read-only
      />
    </div>

    <aside v-if="notes" class="group-inventory-panel__notes" aria-label="Group inventory notes">
      <h3>Notes</h3>
      <p>{{ notes }}</p>
    </aside>
  </article>
</template>

<style scoped>
.group-inventory-panel {
  display: grid;
  gap: 1rem;
}

.group-inventory-panel__header {
  display: flex;
  flex-wrap: wrap;
  align-items: start;
  justify-content: space-between;
  gap: 1rem;
}

.group-inventory-panel__header p {
  max-width: 68ch;
  margin: 0.35rem 0 0;
  color: var(--ink-soft);
  line-height: 1.55;
}

.group-inventory-panel__header .group-inventory-panel__eyebrow {
  color: var(--accent);
  font-size: 0.76rem;
  font-weight: 900;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.group-inventory-panel h2,
.group-inventory-panel h3 {
  margin: 0;
  color: var(--ink-bright);
  font-family: var(--font-book);
  letter-spacing: 0.04em;
}

.group-inventory-panel h2 {
  font-size: clamp(1.45rem, 3vw, 2.1rem);
}

.group-inventory-panel h3 {
  font-size: 1.1rem;
}

.group-inventory-panel__summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(5.5rem, 1fr));
  gap: 0.5rem;
  min-width: min(100%, 24rem);
  margin: 0;
}

.group-inventory-panel__summary div {
  display: grid;
  gap: 0.2rem;
  padding: 0.65rem 0.75rem;
  border: 1px solid var(--rule-soft);
  border-radius: 12px;
  background: var(--paper-inset);
}

.group-inventory-panel__summary dt {
  color: var(--ink-muted);
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.group-inventory-panel__summary dd {
  margin: 0;
  color: var(--ink-bright);
  font-weight: 900;
}

.group-inventory-panel__empty,
.group-inventory-panel__notes {
  border: 1px dashed var(--rule-soft);
  border-radius: 12px;
  background: var(--paper-inset);
  padding: 0.8rem 0.9rem;
  color: var(--ink-soft);
}

.group-inventory-panel__empty,
.group-inventory-panel__notes p {
  margin: 0;
  line-height: 1.55;
}

.group-inventory-panel__section {
  min-width: 0;
}
</style>

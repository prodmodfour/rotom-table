<script setup lang="ts">
import { PhPlus, PhX } from '@phosphor-icons/vue'
import type { TrainerSheetOrderRow } from '~/composables/sheets/useTrainerSheetDerived'
import type { TrainerOrder } from '~/types/trainerSheet'

defineProps<{
  orderRows: readonly TrainerSheetOrderRow[]
  orderTagsCsv: (order: TrainerOrder) => string
}>()

const emit = defineEmits<{
  add: []
  remove: [index: number]
  setTags: [order: TrainerOrder, raw: string]
}>()

const orderTagsLabel = (row: TrainerSheetOrderRow): string => row.tags.join(', ')

const orderMetaLabel = (row: TrainerSheetOrderRow): string => [row.frequency, row.target]
  .filter((value): value is string => Boolean(value))
  .join(' · ')
</script>

<template>
  <div class="block">
    <h2 class="block-title">
      Pokémon Training &amp; Orders
      <span class="move-lookup-note">feature/training orders auto-added</span>
      <button type="button" class="row-add" @click="emit('add')">
        <PhPlus :size="14" weight="bold" /> Add row
      </button>
    </h2>
    <ul class="kv-list">
      <li
        v-for="(row, i) in orderRows"
        :key="row.automatic ? `auto-${row.name}-${i}` : `sheet-${row.sheetIndex ?? i}`"
        :class="{ 'order-row--automatic': row.automatic }"
      >
        <template v-if="row.order">
          <span>
            <strong><EditableCell v-model="row.order.name" placeholder="Order" /></strong>
            <span class="muted"> · </span>
            <EditableCell
              :model-value="orderTagsCsv(row.order)"
              placeholder="Orders"
              @update:model-value="(value) => emit('setTags', row.order!, (value as string) ?? '')"
            />
          </span>
          <span class="effect-col">
            <EditableCell v-model="row.order.effect" type="textarea" placeholder="—" multiline />
          </span>
          <button type="button" class="row-remove" title="Remove order" @click="emit('remove', row.sheetIndex ?? i)">
            <PhX :size="14" weight="bold" />
          </button>
        </template>

        <template v-else>
          <span>
            <strong>{{ row.name }}</strong>
            <span class="order-auto-badge" :title="`Auto-added from ${row.sourceLabel || 'trainer features'}`">auto</span>
            <span class="muted"> · </span>
            <span class="muted">{{ orderTagsLabel(row) || 'Orders' }}</span>
          </span>
          <span class="effect-col">
            <span v-if="orderMetaLabel(row)" class="order-meta">{{ orderMetaLabel(row) }}</span>
            <span>{{ row.effect || '—' }}</span>
          </span>
          <span class="row-auto-note" :title="`Auto-added from ${row.sourceLabel || 'trainer features'}`">Auto</span>
        </template>
      </li>
      <li v-if="!orderRows.length" class="muted">No orders yet.</li>
    </ul>
  </div>
</template>

<style scoped src="./trainerCombatActionPanel.css"></style>
<style scoped>
.kv-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.kv-list li {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.28rem 0;
  border-bottom: 1px dashed var(--rule);
  font-size: 0.88rem;
}

.kv-list li:last-child {
  border-bottom: 0;
}

.order-row--automatic {
  background: rgba(184, 187, 38, 0.06);
  border-radius: 8px;
  padding-inline: 0.35rem;
}

.order-auto-badge,
.row-auto-note {
  display: inline-flex;
  align-items: center;
  margin-left: 0.35rem;
  color: var(--ink-muted);
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  vertical-align: middle;
}

.row-auto-note {
  margin-left: auto;
}

.order-meta {
  display: block;
  margin-bottom: 0.16rem;
  color: var(--ink-muted);
  font-size: 0.72rem;
  white-space: normal;
}
</style>

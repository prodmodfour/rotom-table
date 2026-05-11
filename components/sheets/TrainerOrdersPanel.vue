<script setup lang="ts">
import { PhPlus, PhX } from '@phosphor-icons/vue'
import type { TrainerOrder } from '~/types/trainerSheet'

defineProps<{
  orders?: TrainerOrder[]
  orderTagsCsv: (order: TrainerOrder) => string
}>()

const emit = defineEmits<{
  add: []
  remove: [index: number]
  setTags: [order: TrainerOrder, raw: string]
}>()
</script>

<template>
  <div class="block">
    <h2 class="block-title">
      Pokémon Training &amp; Orders
      <button type="button" class="row-add" @click="emit('add')">
        <PhPlus :size="14" weight="bold" /> Add row
      </button>
    </h2>
    <ul class="kv-list">
      <li v-for="(order, i) in orders" :key="i">
        <span>
          <strong><EditableCell v-model="order.name" placeholder="Order" /></strong>
          <span class="muted"> · </span>
          <EditableCell
            :model-value="orderTagsCsv(order)"
            placeholder="Orders"
            @update:model-value="(value) => emit('setTags', order, (value as string) ?? '')"
          />
        </span>
        <span class="effect-col">
          <EditableCell v-model="order.effect" type="textarea" placeholder="—" multiline />
        </span>
        <button type="button" class="row-remove" title="Remove order" @click="emit('remove', i)">
          <PhX :size="14" weight="bold" />
        </button>
      </li>
      <li v-if="!orders?.length" class="muted">No orders yet.</li>
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
</style>

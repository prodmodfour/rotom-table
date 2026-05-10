<script setup lang="ts">
import { toSlug } from '~/data/ptuReference'
import type { PtuItem } from '~/types/ptuReference'

defineProps<{
  items: PtuItem[]
}>()
</script>

<template>
  <main class="ref-list">
    <NuxtLink
      v-for="item in items"
      :key="item.name"
      :to="`/items/${toSlug(item.name)}`"
      class="ref-row"
    >
      <div class="item-row__top">
        <ItemSprite :item="item" size="lg" />
        <div class="item-row__summary">
          <div class="ref-row__heading">
            <h2>{{ item.name }}</h2>
            <div class="row-tags">
              <span v-for="category in item.categories" :key="category" class="badge tag-badge">
                {{ category }}
              </span>
            </div>
          </div>

          <div class="ref-row__pills">
            <span v-for="cost in item.costs.slice(0, 2)" :key="cost" class="badge cost-badge">
              {{ cost }}
            </span>
            <span v-if="item.costs.length > 2" class="badge cost-badge">
              +{{ item.costs.length - 2 }} costs
            </span>
            <span v-for="section in item.sections.slice(0, 2)" :key="section" class="badge section-badge">
              {{ section }}
            </span>
            <span v-if="item.sections.length > 2" class="badge section-badge">
              +{{ item.sections.length - 2 }} sections
            </span>
          </div>
        </div>
      </div>

      <p v-if="item.effects.length" class="ref-row__effect">
        {{ item.effects.join(' ') }}
      </p>
    </NuxtLink>
    <ReferenceEmptyState v-if="items.length === 0" message="No items match." />
  </main>
</template>

<style scoped>
.item-row__top {
  display: flex;
  align-items: flex-start;
  gap: 0.65rem;
}

.item-row__summary {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.row-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
}

.tag-badge {
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 0.68rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 0.1rem 0.5rem;
  border-radius: 999px;
}

.cost-badge,
.section-badge {
  max-width: 100%;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.section-badge {
  background: var(--paper-inset);
  color: var(--ink-soft);
  border: 1px solid var(--rule-soft);
}
</style>

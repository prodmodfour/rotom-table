<script setup lang="ts">
import { computed } from 'vue'
import { findItem, items, toSlug } from '~/data/ptuReference'

const route = useRoute()

const item = computed(() => findItem(String(route.params.slug ?? '')))

useHead(() => ({
  title: item.value
    ? `${item.value.name} · Items`
    : 'Item not found · Rotom Table',
}))

const relatedItems = computed(() => {
  const current = item.value
  const primaryCategory = current?.categories[0]
  if (!current || !primaryCategory) return []

  return items
    .filter((entry) => entry.name !== current.name && entry.categories.includes(primaryCategory))
    .slice(0, 12)
})
</script>

<template>
  <div class="ref-detail">
    <header class="ref-header">
      <AppNavigation />
      <div class="back-row">
        <NuxtLink to="/items" class="back-link">← All items</NuxtLink>
      </div>
    </header>

    <main>
      <article v-if="item" class="panel-card">
        <div class="detail-heading item-detail-heading">
          <div class="item-detail-title">
            <ItemSprite :item="item" size="xl" :alt="`${item.name} sprite`" />
            <h1>{{ item.name }}</h1>
          </div>
          <div class="detail-pills">
            <span v-for="category in item.categories" :key="category" class="badge tag-badge">
              {{ category }}
            </span>
            <span v-if="item.source" class="badge source-badge">{{ item.source }}</span>
          </div>
        </div>

        <dl v-if="item.costs.length || item.sections.length" class="stat-strip">
          <div v-if="item.costs.length">
            <dt>Cost</dt>
            <dd>{{ item.costs.join(', ') }}</dd>
          </div>
          <div v-if="item.sections.length">
            <dt>Section</dt>
            <dd>{{ item.sections.join(', ') }}</dd>
          </div>
        </dl>

        <section v-if="item.aliases.length" class="field-block">
          <h3>Aliases</h3>
          <p>{{ item.aliases.join(', ') }}</p>
        </section>

        <section v-if="item.effects.length" class="field-block">
          <h3>Effect</h3>
          <p v-if="item.effects.length === 1">{{ item.effects[0] }}</p>
          <ul v-else class="detail-list">
            <li v-for="effect in item.effects" :key="effect">{{ effect }}</li>
          </ul>
        </section>

        <section v-if="item.notes.length" class="field-block">
          <h3>Notes</h3>
          <ul class="detail-list">
            <li v-for="note in item.notes" :key="note">{{ note }}</li>
          </ul>
        </section>

        <section v-if="relatedItems.length" class="field-block">
          <h3>More {{ item.categories[0] }} items</h3>
          <ul class="related-list">
            <li v-for="related in relatedItems" :key="related.name">
              <ItemSprite :item="related" size="sm" />
              <span class="related-main">
                <NuxtLink :to="`/items/${toSlug(related.name)}`">{{ related.name }}</NuxtLink>
                <span v-if="related.costs.length" class="related-cost">{{ related.costs.join(', ') }}</span>
              </span>
            </li>
          </ul>
        </section>
      </article>

      <article v-else class="panel-card">
        <h1>Item not found</h1>
        <p>No entry for slug <code>{{ route.params.slug }}</code>.</p>
        <NuxtLink to="/items" class="back-link">← Back to all items</NuxtLink>
      </article>
    </main>
  </div>
</template>

<style scoped>
.item-detail-title {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-width: 0;
}

.item-detail-title h1 {
  min-width: 0;
}

.tag-badge {
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 0.7rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 0.12rem 0.55rem;
  border-radius: 999px;
}

.source-badge {
  background: var(--paper-inset);
  color: var(--ink-soft);
  border: 1px solid var(--rule-soft);
}

.detail-list {
  margin: 0;
  padding-left: 1.2rem;
  color: var(--ink);
  line-height: 1.6;
  white-space: pre-wrap;
  font-family: var(--font-book);
  font-size: 1.02rem;
}

.detail-list li + li {
  margin-top: 0.35rem;
}

.related-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 0.4rem;
}

.related-list li {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.45rem 0.6rem;
  border: 1px solid var(--rule-soft);
  border-radius: 8px;
  background: var(--paper-inset);
}

.related-main {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 0.2rem;
}

.related-list a {
  color: var(--ink-bright);
  text-decoration: underline;
  text-decoration-color: var(--rule-strong);
  text-underline-offset: 0.18em;
}

.related-cost {
  color: var(--ink-muted);
  font-size: 0.78rem;
  letter-spacing: 0.04em;
}
</style>

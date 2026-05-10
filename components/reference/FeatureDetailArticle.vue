<script setup lang="ts">
import { toSlug } from '~/data/ptuReference'
import type { PtuFeature } from '~/types/ptuReference'

defineProps<{
  feature: PtuFeature
  siblings: PtuFeature[]
}>()
</script>

<template>
  <article class="panel-card">
    <ReferenceDetailHeading :title="feature.name">
      <template #pills>
        <span v-for="tag in feature.tags" :key="tag" class="badge tag-badge">{{ tag }}</span>
      </template>
    </ReferenceDetailHeading>

    <p v-if="feature.className && feature.className !== feature.name" class="class-note">
      From the
      <NuxtLink :to="`/features/${toSlug(feature.className)}`">{{ feature.className }}</NuxtLink>
      class.
    </p>

    <ReferenceFieldBlock v-if="feature.prerequisites" title="Prerequisites">
      <p>{{ feature.prerequisites }}</p>
    </ReferenceFieldBlock>

    <ReferenceFieldBlock v-if="feature.frequency" title="Frequency &amp; Action">
      <p>{{ feature.frequency }}</p>
    </ReferenceFieldBlock>

    <ReferenceFieldBlock v-if="feature.trigger" title="Trigger">
      <p>{{ feature.trigger }}</p>
    </ReferenceFieldBlock>

    <ReferenceFieldBlock v-if="feature.target" title="Target">
      <p>{{ feature.target }}</p>
    </ReferenceFieldBlock>

    <ReferenceFieldBlock v-if="feature.condition" title="Condition">
      <p>{{ feature.condition }}</p>
    </ReferenceFieldBlock>

    <ReferenceFieldBlock v-if="feature.effect" title="Effect">
      <p>{{ feature.effect }}</p>
    </ReferenceFieldBlock>

    <ReferenceFieldBlock v-if="siblings.length" :title="`Other features in ${feature.className}`">
      <ul class="sibling-list">
        <li v-for="sibling in siblings" :key="sibling.name">
          <NuxtLink :to="`/features/${toSlug(sibling.name)}`">{{ sibling.name }}</NuxtLink>
          <span v-if="sibling.tags?.length" class="sibling-tags">
            <span v-for="tag in sibling.tags" :key="tag" class="badge tag-badge">{{ tag }}</span>
          </span>
        </li>
      </ul>
    </ReferenceFieldBlock>
  </article>
</template>

<style scoped>
.tag-badge {
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 0.7rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 0.12rem 0.55rem;
  border-radius: 999px;
}

.class-note {
  margin: 0 0 0.7rem;
  color: var(--ink-soft);
  font-size: 0.92rem;
  font-style: italic;
}

.class-note a {
  color: var(--accent);
  text-decoration: underline;
  text-decoration-color: var(--rule-strong);
  text-underline-offset: 0.18em;
}

.sibling-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 0.4rem;
}

.sibling-list li {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  padding: 0.45rem 0.6rem;
  border: 1px solid var(--rule-soft);
  border-radius: 8px;
  background: var(--paper-inset);
}

.sibling-list a {
  color: var(--ink-bright);
  text-decoration: underline;
  text-decoration-color: var(--rule-strong);
  text-underline-offset: 0.18em;
}

.sibling-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.18rem;
}
</style>

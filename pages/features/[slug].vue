<script setup lang="ts">
import { computed } from 'vue'
import { featureBySlug, features, toSlug } from '~/data/ptuReference'
import { siblingFeaturesInClass } from '~/utils/reference/featureDetails'

const route = useRoute()

const feat = computed(() => featureBySlug.get(String(route.params.slug ?? '')) ?? null)

useHead(() => ({
  title: feat.value
    ? `${feat.value.name} · Features`
    : 'Feature not found · Rotom Table',
}))

/** Sibling features in the same Trainer Class (if this is a class feature). */
const siblings = computed(() => siblingFeaturesInClass(feat.value, features))
</script>

<template>
  <ReferenceDetailShell back-to="/features" back-label="← All features">
      <article v-if="feat" class="panel-card">
        <ReferenceDetailHeading :title="feat.name">
          <template #pills>
            <span v-for="tag in feat.tags" :key="tag" class="badge tag-badge">{{ tag }}</span>
          </template>
        </ReferenceDetailHeading>

        <p v-if="feat.className && feat.className !== feat.name" class="class-note">
          From the
          <NuxtLink :to="`/features/${toSlug(feat.className)}`">{{ feat.className }}</NuxtLink>
          class.
        </p>

        <ReferenceFieldBlock v-if="feat.prerequisites" title="Prerequisites">
          <p>{{ feat.prerequisites }}</p>
        </ReferenceFieldBlock>

        <ReferenceFieldBlock v-if="feat.frequency" title="Frequency &amp; Action">
          <p>{{ feat.frequency }}</p>
        </ReferenceFieldBlock>

        <ReferenceFieldBlock v-if="feat.trigger" title="Trigger">
          <p>{{ feat.trigger }}</p>
        </ReferenceFieldBlock>

        <ReferenceFieldBlock v-if="feat.target" title="Target">
          <p>{{ feat.target }}</p>
        </ReferenceFieldBlock>

        <ReferenceFieldBlock v-if="feat.condition" title="Condition">
          <p>{{ feat.condition }}</p>
        </ReferenceFieldBlock>

        <ReferenceFieldBlock v-if="feat.effect" title="Effect">
          <p>{{ feat.effect }}</p>
        </ReferenceFieldBlock>

        <ReferenceFieldBlock v-if="siblings.length" :title="`Other features in ${feat.className}`">
          <ul class="sibling-list">
            <li v-for="s in siblings" :key="s.name">
              <NuxtLink :to="`/features/${toSlug(s.name)}`">{{ s.name }}</NuxtLink>
              <span v-if="s.tags?.length" class="sibling-tags">
                <span v-for="t in s.tags" :key="t" class="badge tag-badge">{{ t }}</span>
              </span>
            </li>
          </ul>
        </ReferenceFieldBlock>
      </article>

      <ReferenceNotFoundCard
        v-else
        title="Feature not found"
        :slug="route.params.slug"
        back-to="/features"
        back-label="← Back to all features"
      />
  </ReferenceDetailShell>
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

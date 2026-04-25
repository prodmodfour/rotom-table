<script setup lang="ts">
import { computed } from 'vue'
import { featureBySlug, features, toSlug } from '~/data/ptuReference'

const route = useRoute()

const feat = computed(() => featureBySlug.get(String(route.params.slug ?? '')) ?? null)

useHead(() => ({
  title: feat.value
    ? `${feat.value.name} · Features`
    : 'Feature not found · Rotom Table',
}))

/** Sibling features in the same Trainer Class (if this is a class feature). */
const siblings = computed(() => {
  const f = feat.value
  if (!f?.className) return []
  return features
    .filter((x) => x.className === f.className && x.name !== f.name)
    .slice(0, 30)
})
</script>

<template>
  <div class="ref-detail">
    <header class="ref-header">
      <AppNavigation />
      <div class="back-row">
        <NuxtLink to="/features" class="back-link">← All features</NuxtLink>
      </div>
    </header>

    <main>
      <article v-if="feat" class="panel-card">
        <div class="detail-heading">
          <h1>{{ feat.name }}</h1>
          <div class="detail-pills">
            <span v-for="tag in feat.tags" :key="tag" class="badge tag-badge">{{ tag }}</span>
          </div>
        </div>

        <p v-if="feat.className && feat.className !== feat.name" class="class-note">
          From the
          <NuxtLink :to="`/features/${toSlug(feat.className)}`">{{ feat.className }}</NuxtLink>
          class.
        </p>

        <section v-if="feat.prerequisites" class="field-block">
          <h3>Prerequisites</h3>
          <p>{{ feat.prerequisites }}</p>
        </section>

        <section v-if="feat.frequency" class="field-block">
          <h3>Frequency &amp; Action</h3>
          <p>{{ feat.frequency }}</p>
        </section>

        <section v-if="feat.trigger" class="field-block">
          <h3>Trigger</h3>
          <p>{{ feat.trigger }}</p>
        </section>

        <section v-if="feat.target" class="field-block">
          <h3>Target</h3>
          <p>{{ feat.target }}</p>
        </section>

        <section v-if="feat.condition" class="field-block">
          <h3>Condition</h3>
          <p>{{ feat.condition }}</p>
        </section>

        <section v-if="feat.effect" class="field-block">
          <h3>Effect</h3>
          <p>{{ feat.effect }}</p>
        </section>

        <section v-if="siblings.length" class="field-block">
          <h3>Other features in {{ feat.className }}</h3>
          <ul class="sibling-list">
            <li v-for="s in siblings" :key="s.name">
              <NuxtLink :to="`/features/${toSlug(s.name)}`">{{ s.name }}</NuxtLink>
              <span v-if="s.tags?.length" class="sibling-tags">
                <span v-for="t in s.tags" :key="t" class="badge tag-badge">{{ t }}</span>
              </span>
            </li>
          </ul>
        </section>
      </article>

      <article v-else class="panel-card">
        <h1>Feature not found</h1>
        <p>No entry for slug <code>{{ route.params.slug }}</code>.</p>
        <NuxtLink to="/features" class="back-link">← Back to all features</NuxtLink>
      </article>
    </main>
  </div>
</template>

<style scoped>
.detail-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}

.tag-badge {
  background: rgba(168, 85, 247, 0.18);
  color: #ddd6fe;
  font-size: 0.74rem;
  padding: 0.12rem 0.5rem;
}

.class-note {
  margin: 0 0 0.7rem;
  color: rgba(191, 219, 254, 0.78);
  font-size: 0.92rem;
}

.class-note a {
  color: #bae6fd;
  text-decoration: underline;
  text-decoration-color: rgba(186, 230, 253, 0.45);
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
  padding: 0.4rem 0.55rem;
  border: 1px solid rgba(96, 165, 250, 0.18);
  border-radius: 10px;
  background: rgba(15, 23, 42, 0.62);
}

.sibling-list a {
  color: #f0f9ff;
  text-decoration: underline;
  text-decoration-color: rgba(186, 230, 253, 0.4);
  text-underline-offset: 0.18em;
}

.sibling-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.18rem;
}
</style>

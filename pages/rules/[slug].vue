<script setup lang="ts">
import { computed } from 'vue'
import { ruleBySlug } from '~/data/ptuReference'

const route = useRoute()

const rule = computed(() => ruleBySlug.get(String(route.params.slug ?? '')) ?? null)

useHead(() => ({
  title: rule.value
    ? `${rule.value.name} · Rules`
    : 'Rule not found · Rotom Table',
}))
</script>

<template>
  <div class="ref-detail">
    <header class="ref-header">
      <AppNavigation />
      <div class="back-row">
        <NuxtLink to="/rules" class="back-link">← All rules</NuxtLink>
      </div>
    </header>

    <main>
      <article v-if="rule" class="panel-card">
        <div class="detail-heading">
          <h1>{{ rule.name }}</h1>
          <div class="detail-pills">
            <span class="badge">{{ rule.category }}</span>
            <span v-if="rule.source" class="badge">{{ rule.source }}</span>
          </div>
        </div>

        <section v-if="rule.text" class="field-block">
          <h3>Rule Text</h3>
          <p>{{ rule.text }}</p>
        </section>
      </article>

      <ReferenceNotFoundCard
        v-else
        title="Rule not found"
        :slug="route.params.slug"
        back-to="/rules"
        back-label="← Back to all rules"
      />
    </main>
  </div>
</template>

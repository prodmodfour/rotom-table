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
  <ReferenceDetailShell back-to="/rules" back-label="← All rules">
      <article v-if="rule" class="panel-card">
        <div class="detail-heading">
          <h1>{{ rule.name }}</h1>
          <div class="detail-pills">
            <span class="badge">{{ rule.category }}</span>
            <span v-if="rule.source" class="badge">{{ rule.source }}</span>
          </div>
        </div>

        <ReferenceFieldBlock v-if="rule.text" title="Rule Text">
          <p>{{ rule.text }}</p>
        </ReferenceFieldBlock>
      </article>

      <ReferenceNotFoundCard
        v-else
        title="Rule not found"
        :slug="route.params.slug"
        back-to="/rules"
        back-label="← Back to all rules"
      />
  </ReferenceDetailShell>
</template>

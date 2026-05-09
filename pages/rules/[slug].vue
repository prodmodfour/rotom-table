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
        <ReferenceDetailHeading :title="rule.name">
          <template #pills>
            <span class="badge">{{ rule.category }}</span>
            <span v-if="rule.source" class="badge">{{ rule.source }}</span>
          </template>
        </ReferenceDetailHeading>

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

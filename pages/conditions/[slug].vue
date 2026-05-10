<script setup lang="ts">
import { computed } from 'vue'
import { conditionBySlug } from '~/data/ptuReference'

const route = useRoute()

const condition = computed(() => conditionBySlug.get(String(route.params.slug ?? '')) ?? null)

useHead(() => ({
  title: condition.value
    ? `${condition.value.name} · Conditions`
    : 'Condition not found · Rotom Table',
}))
</script>

<template>
  <ReferenceDetailShell back-to="/conditions" back-label="← All conditions">
      <ConditionDetailArticle v-if="condition" :condition="condition" />

      <ReferenceNotFoundCard
        v-else
        title="Condition not found"
        :slug="route.params.slug"
        back-to="/conditions"
        back-label="← Back to all conditions"
      />
  </ReferenceDetailShell>
</template>

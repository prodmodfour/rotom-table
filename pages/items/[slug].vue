<script setup lang="ts">
import { computed } from 'vue'
import { findItem, items } from '~/data/ptuReference'
import { relatedItemsByPrimaryCategory } from '~/utils/reference/itemDetails'

const route = useRoute()

const item = computed(() => findItem(String(route.params.slug ?? '')))

useHead(() => ({
  title: item.value
    ? `${item.value.name} · Items`
    : 'Item not found · Rotom Table',
}))

const relatedItems = computed(() => relatedItemsByPrimaryCategory(item.value, items))
</script>

<template>
  <ReferenceDetailShell back-to="/items" back-label="← All items">
    <ItemDetailArticle
      v-if="item"
      :item="item"
      :related-items="relatedItems"
    />

    <ReferenceNotFoundCard
      v-else
      title="Item not found"
      :slug="route.params.slug"
      back-to="/items"
      back-label="← Back to all items"
    />
  </ReferenceDetailShell>
</template>

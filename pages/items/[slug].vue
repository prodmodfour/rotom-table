<script setup lang="ts">
import { computed } from 'vue'
import { findItem, items } from '~/data/ptuReference'
import { relatedItemsByPrimaryCategory } from '~/utils/reference/itemDetails'
import { referenceDetailTitle } from '~/utils/reference/pageTitles'
import { routeSlugParam } from '~/utils/routeParams'

const route = useRoute()

const item = computed(() => findItem(routeSlugParam(route.params)))

useHead(() => ({
  title: referenceDetailTitle(item.value?.name, 'Items', 'Item not found'),
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

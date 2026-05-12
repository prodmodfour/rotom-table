<script setup lang="ts">
import { computed } from 'vue'
import { findItem, items } from '~~/data/ptuReference'
import { relatedItemsByPrimaryCategory } from '~/utils/reference/itemDetails'
import { referenceDetailTitle } from '~/utils/reference/pageTitles'
import { referenceAllBackLabel, referenceIndexPath, referenceNotFoundBackLabel } from '~/utils/reference/routes'
import { routeSlugParam } from '~/utils/routeParams'

const route = useRoute()
const slug = computed(() => routeSlugParam(route.params))

const item = computed(() => findItem(slug.value))
const itemsPath = referenceIndexPath('item')
const itemsBackLabel = referenceAllBackLabel('item')
const itemsNotFoundBackLabel = referenceNotFoundBackLabel('item')

useHead(() => ({
  title: referenceDetailTitle(item.value?.name, 'Items', 'Item not found'),
}))

const relatedItems = computed(() => relatedItemsByPrimaryCategory(item.value, items))
</script>

<template>
  <ReferenceDetailShell :back-to="itemsPath" :back-label="itemsBackLabel">
    <ItemDetailArticle
      v-if="item"
      :item="item"
      :related-items="relatedItems"
    />

    <ReferenceNotFoundCard
      v-else
      title="Item not found"
      :slug="slug"
      :back-to="itemsPath"
      :back-label="itemsNotFoundBackLabel"
    />
  </ReferenceDetailShell>
</template>

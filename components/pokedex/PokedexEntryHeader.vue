<script setup lang="ts">
import { formatNationalDexNumber } from '~/utils/pokedex/searchText'

defineProps<{
  species: string
  nationalDexNumber?: number | null
  sourceGen?: string | null
  isPlacementOnly?: boolean
}>()
</script>

<template>
  <header class="book-page__header">
    <h2 class="species-name">{{ species.toUpperCase() }}</h2>
    <div class="header-badges">
      <span v-if="nationalDexNumber" class="badge">
        {{ formatNationalDexNumber(nationalDexNumber) }}
      </span>
      <span v-if="sourceGen" class="badge">{{ sourceGen }}</span>
      <span v-if="isPlacementOnly" class="badge warn">Placement only</span>
    </div>
  </header>
</template>

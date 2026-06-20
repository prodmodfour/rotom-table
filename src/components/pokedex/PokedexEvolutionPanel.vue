<script setup lang="ts">
import type { DisplayedPokedexEvolution } from '~/utils/pokedex/entryDetails'

defineProps<{
  displayedEvolutions: DisplayedPokedexEvolution[]
}>()
</script>

<template>
  <section v-if="displayedEvolutions.length" class="book-section">
    <h3 class="book-section__title">Evolution:</h3>
    <p
      v-for="evolution in displayedEvolutions"
      :key="`${evolution.stage}-${evolution.species}`"
      class="info-line"
    >
      {{ evolution.stage }} -
      <NuxtLink
        v-if="evolution.href"
        :to="evolution.href"
        class="evolution-link"
        prefetch-on="interaction"
      >{{ evolution.displaySpecies }}</NuxtLink><span v-else>{{ evolution.displaySpecies }}</span><template v-if="evolution.displayCondition"> {{ evolution.displayCondition }}</template><template v-if="evolution.min_level && evolution.min_level > 0"> Minimum {{ evolution.min_level }}</template>
    </p>
  </section>
</template>

<script setup lang="ts">
defineProps<{
  dietSummary: string | null
  eggGroupSummary: string | null
  genderSummary: string | null
  habitatSummary: string | null
  hatchRate: string | number | null | undefined
  heightLabel: string | null
  weightLabel: string | null
}>()
</script>

<template>
  <section v-if="heightLabel || weightLabel" class="book-section">
    <h3 class="book-section__title">Size Information</h3>
    <p v-if="heightLabel" class="info-line">Height : {{ heightLabel }}</p>
    <p v-if="weightLabel" class="info-line">Weight : {{ weightLabel }}</p>
  </section>

  <section
    v-if="genderSummary || eggGroupSummary || hatchRate"
    class="book-section"
  >
    <h3 class="book-section__title">Breeding Information</h3>
    <p v-if="genderSummary" class="info-line">Gender Ratio : {{ genderSummary }}</p>
    <p v-if="eggGroupSummary" class="info-line">Egg Group : {{ eggGroupSummary }}</p>
    <p v-if="hatchRate" class="info-line">
      Average Hatch Rate: {{ hatchRate }}
    </p>
  </section>

  <section v-if="dietSummary || habitatSummary" class="book-section book-section--plain">
    <p v-if="dietSummary" class="info-line">Diet : {{ dietSummary }}</p>
    <p v-if="habitatSummary" class="info-line">Habitat : {{ habitatSummary }}</p>
  </section>
</template>

<script setup lang="ts">
import type { DisplayedPokedexEvolution } from '~/utils/pokedex/entryDetails'
import type { DisplayPokedexEntry } from '~/utils/pokedex/entryIndex'

defineProps<{
  dietSummary: string | null
  displayedEvolutions: DisplayedPokedexEvolution[]
  eggGroupSummary: string | null
  entry: DisplayPokedexEntry
  genderSummary: string | null
  habitatSummary: string | null
  heightLabel: string | null
  spriteUrl: string | null
  weightLabel: string | null
}>()
</script>

<template>
  <section class="book-column book-column--left">
    <div class="sprite-frame">
      <div class="sprite-frame__inner">
        <img
          v-if="spriteUrl"
          :src="spriteUrl"
          :alt="entry.species"
        />
        <span v-else class="sprite-missing">no sprite</span>
      </div>
      <span class="bracket bracket--tl" />
      <span class="bracket bracket--tr" />
      <span class="bracket bracket--bl" />
      <span class="bracket bracket--br" />
    </div>

    <section v-if="entry.base_stats" class="book-section">
      <h3 class="book-section__title">Base Stats:</h3>
      <dl class="stat-list">
        <div><dt>HP:</dt><dd>{{ entry.base_stats.hp }}</dd></div>
        <div><dt>Attack:</dt><dd>{{ entry.base_stats.atk }}</dd></div>
        <div><dt>Defense:</dt><dd>{{ entry.base_stats.def }}</dd></div>
        <div><dt>Special Attack:</dt><dd>{{ entry.base_stats.spatk }}</dd></div>
        <div><dt>Special Defense:</dt><dd>{{ entry.base_stats.spdef }}</dd></div>
        <div><dt>Speed:</dt><dd>{{ entry.base_stats.spd }}</dd></div>
      </dl>
    </section>

    <section class="book-section">
      <h3 class="book-section__title">Basic Information</h3>
      <p class="info-line info-line--types">
        <span>Type :</span>
        <span v-if="entry.types?.length" class="type-badge-row">
          <TypeBadge
            v-for="type in entry.types"
            :key="`selected-${type}`"
            :type="type"
            size="xs"
          />
        </span>
        <span v-else>Unknown type</span>
      </p>
      <template v-if="entry.abilities">
        <p
          v-for="(ability, index) in entry.abilities.basic ?? []"
          :key="`basic-${ability}`"
          class="info-line"
        >
          Basic Ability {{ index + 1 }}: <RefLink kind="ability" :name="ability" />
        </p>
        <p
          v-for="(ability, index) in entry.abilities.advanced ?? []"
          :key="`adv-${ability}`"
          class="info-line"
        >
          Adv Ability {{ index + 1 }}: <RefLink kind="ability" :name="ability" />
        </p>
        <p
          v-for="ability in entry.abilities.high ?? []"
          :key="`high-${ability}`"
          class="info-line"
        >
          High Ability: <RefLink kind="ability" :name="ability" />
        </p>
      </template>
    </section>

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
        >{{ evolution.species }}</NuxtLink><span v-else>{{ evolution.species }}</span><template v-if="evolution.min_level && evolution.min_level > 0"> Minimum {{ evolution.min_level }}</template>
      </p>
    </section>

    <section v-if="heightLabel || weightLabel" class="book-section">
      <h3 class="book-section__title">Size Information</h3>
      <p v-if="heightLabel" class="info-line">Height : {{ heightLabel }}</p>
      <p v-if="weightLabel" class="info-line">Weight : {{ weightLabel }}</p>
    </section>

    <section
      v-if="genderSummary || eggGroupSummary || entry.hatch_rate"
      class="book-section"
    >
      <h3 class="book-section__title">Breeding Information</h3>
      <p v-if="genderSummary" class="info-line">Gender Ratio : {{ genderSummary }}</p>
      <p v-if="eggGroupSummary" class="info-line">Egg Group : {{ eggGroupSummary }}</p>
      <p v-if="entry.hatch_rate" class="info-line">
        Average Hatch Rate: {{ entry.hatch_rate }}
      </p>
    </section>

    <section v-if="dietSummary || habitatSummary" class="book-section book-section--plain">
      <p v-if="dietSummary" class="info-line">Diet : {{ dietSummary }}</p>
      <p v-if="habitatSummary" class="info-line">Habitat : {{ habitatSummary }}</p>
    </section>
  </section>
</template>

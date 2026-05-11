<script setup lang="ts">
import type { DisplayPokedexEntry } from '~/utils/pokedex/entryIndex'

defineProps<{
  entry: DisplayPokedexEntry
}>()
</script>

<template>
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
</template>

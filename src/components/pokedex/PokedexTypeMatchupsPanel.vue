<script setup lang="ts">
import type { TypeMatchupGroup } from '~/utils/pokedex/typeMatchups'

defineProps<{
  groups: TypeMatchupGroup[]
}>()
</script>

<template>
  <section v-if="groups.length" class="book-section book-section--matchups">
    <h3 class="book-section__title">Weaknesses &amp; Resistances</h3>
    <div class="type-matchups">
      <div
        v-for="group in groups"
        :key="group.key"
        class="type-matchup-group"
      >
        <p class="matchup-label">{{ group.label }}</p>
        <ul class="type-effect-list">
          <li
            v-for="item in group.items"
            :key="`${group.key}-${item.type}`"
          >
            <span :class="['type-effect-chip', `type-effect-chip--${item.type.toLowerCase()}`]">
              <TypeBadge :type="item.type" size="xs" />
              <span class="type-effect-mult">{{ item.label }}</span>
            </span>
          </li>
        </ul>
      </div>
    </div>
  </section>
</template>

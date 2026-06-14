<script setup lang="ts">
withDefaults(defineProps<{
  types: readonly string[]
  size?: 'xs' | 'sm' | 'md' | 'lg'
  ariaLabel?: string
}>(), {
  size: 'xs',
  ariaLabel: 'Pokémon types',
})
</script>

<template>
  <span v-if="types.length" class="pokemon-type-badge-row" :aria-label="ariaLabel">
    <TypeBadge
      v-for="(type, index) in types"
      :key="`${type}-${index}`"
      :type="type"
      :size="size"
    />
  </span>
</template>

<style scoped>
.pokemon-type-badge-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.18rem;
  min-width: 0;
}
</style>

<script setup lang="ts">
defineProps<{
  statPointsBudget: number | null
  titleId: string
}>()

const emit = defineEmits<{
  (event: 'randomize-added-stats'): void
}>()
</script>

<template>
  <section class="pokemon-added-stats-admin-card" :aria-labelledby="titleId">
    <div>
      <h3 :id="titleId">Randomise Added Stats</h3>
      <p>
        Overwrite the Added column with a random legal allocation of this Pokémon's
        {{ statPointsBudget ?? 'Level + 10' }} Stat Points. Combat Stages are unchanged.
      </p>
    </div>
    <button
      type="button"
      class="pokemon-added-stats-admin-card__primary-action"
      @click="emit('randomize-added-stats')"
    >
      Randomise added stats
    </button>
  </section>
</template>

<style scoped>
.pokemon-added-stats-admin-card {
  display: grid;
  gap: 0.85rem;
  padding: 0.85rem;
  border: 1px solid var(--rule-soft);
  border-radius: 14px;
  background: var(--paper-inset);
}

.pokemon-added-stats-admin-card h3 {
  margin: 0;
  color: var(--ink-bright);
  font-family: var(--font-book);
  font-size: 1rem;
}

.pokemon-added-stats-admin-card p {
  margin: 0.3rem 0 0;
  color: var(--ink-soft);
  font-size: 0.82rem;
  line-height: 1.45;
}

.pokemon-added-stats-admin-card__primary-action {
  width: 100%;
  border: 1px solid var(--accent);
  border-radius: 14px;
  background: var(--accent);
  color: var(--accent-contrast);
  cursor: pointer;
  font: inherit;
  font-weight: 900;
  padding: 0.8rem 1rem;
}

.pokemon-added-stats-admin-card__primary-action:hover,
.pokemon-added-stats-admin-card__primary-action:focus-visible {
  filter: brightness(1.08);
  outline: none;
}
</style>

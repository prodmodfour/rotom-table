<script setup lang="ts">
withDefaults(defineProps<{
  title: string
  subtitle?: string | null
  titleSize?: 'default' | 'compact'
  subtitleTone?: 'soft' | 'muted'
  subtitleSize?: 'default' | 'compact'
}>(), {
  subtitle: null,
  titleSize: 'default',
  subtitleTone: 'soft',
  subtitleSize: 'default',
})
</script>

<template>
  <div class="library-card-text">
    <div class="library-card-text__heading">
      <h3
        class="library-card-text__title"
        :class="titleSize === 'compact' ? 'library-card-text__title--compact' : ''"
        :title="title"
      >
        {{ title }}
      </h3>
      <slot name="title-extra" />
    </div>
    <p
      v-if="subtitle"
      class="library-card-text__subtitle"
      :class="[
        subtitleTone === 'muted' ? 'library-card-text__subtitle--muted' : '',
        subtitleSize === 'compact' ? 'library-card-text__subtitle--compact' : '',
      ]"
    >
      {{ subtitle }}
    </p>
    <slot />
  </div>
</template>

<style scoped>
.library-card-text {
  min-width: 0;
}

.library-card-text__heading {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.library-card-text__title {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  color: var(--ink-bright);
  font-family: var(--font-book);
  font-size: 1.1rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.library-card-text__title--compact {
  font-size: 1.05rem;
}

.library-card-text__subtitle {
  margin: 0.2rem 0 0;
  color: var(--ink-soft);
  font-size: 0.88rem;
}

.library-card-text__subtitle--muted {
  color: var(--ink-muted);
}

.library-card-text__subtitle--compact {
  font-size: 0.8rem;
  letter-spacing: 0.04em;
}
</style>

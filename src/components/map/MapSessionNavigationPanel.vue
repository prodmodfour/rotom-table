<script setup lang="ts">
import { computed } from 'vue'
import { buildMapSessionNavigationModel } from '~/utils/mapSessionNavigation'

const props = withDefaults(defineProps<{
  mapSlug?: string | null
  sessionModeEnabled?: boolean
}>(), {
  mapSlug: null,
  sessionModeEnabled: false,
})

const model = computed(() => buildMapSessionNavigationModel({
  mapSlug: props.mapSlug,
  sessionModeEnabled: props.sessionModeEnabled,
}))
</script>

<template>
  <section class="map-session-navigation" aria-labelledby="map-session-navigation-title">
    <p class="map-session-navigation__eyebrow">Live session</p>
    <h2 id="map-session-navigation-title">{{ model.heading }}</h2>
    <p class="map-session-navigation__summary">{{ model.summary }}</p>
    <p
      class="map-session-navigation__status"
      :class="{ 'map-session-navigation__status--active': props.sessionModeEnabled }"
    >
      {{ model.statusLabel }}
    </p>

    <div class="map-session-navigation__links" aria-label="Live session navigation shortcuts">
      <NuxtLink
        v-for="link in model.links"
        :key="link.key"
        :to="link.to"
        class="map-session-navigation__link"
        :class="`map-session-navigation__link--${link.kind}`"
        :aria-label="`${link.label}. ${link.description}`"
      >
        <span>{{ link.label }}</span>
        <small>{{ link.description }}</small>
      </NuxtLink>
    </div>
  </section>
</template>

<style scoped>
.map-session-navigation {
  display: grid;
  gap: 0.5rem;
  margin-top: 0.65rem;
  padding: 0.65rem;
  border: 1px solid var(--rule-soft);
  border-radius: 12px;
  background: var(--paper-inset);
}

.map-session-navigation__eyebrow {
  margin: 0;
  color: var(--accent);
  font-size: 0.68rem;
  font-weight: 900;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.map-session-navigation h2,
.map-session-navigation__summary,
.map-session-navigation__status {
  margin: 0;
}

.map-session-navigation h2 {
  color: var(--ink-bright);
  font-size: 0.95rem;
  line-height: 1.2;
}

.map-session-navigation__summary,
.map-session-navigation__status,
.map-session-navigation__link small {
  color: var(--ink-soft);
  line-height: 1.35;
}

.map-session-navigation__summary {
  font-size: 0.76rem;
}

.map-session-navigation__status {
  padding: 0.45rem 0.5rem;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: rgba(143, 184, 255, 0.10);
  font-size: 0.72rem;
  font-weight: 700;
}

.map-session-navigation__status--active {
  border-color: rgba(70, 180, 122, 0.45);
  background: rgba(70, 180, 122, 0.12);
  color: var(--ink-bright);
}

.map-session-navigation__links {
  display: grid;
  gap: 0.45rem;
}

.map-session-navigation__link {
  display: grid;
  gap: 0.22rem;
  min-width: 0;
  padding: 0.52rem 0.55rem;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink-bright);
  text-decoration: none;
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    color 0.15s ease;
}

.map-session-navigation__link:hover,
.map-session-navigation__link:focus-visible {
  border-color: var(--accent);
  background: var(--paper-hover);
  color: var(--accent);
  outline: none;
}

.map-session-navigation__link:focus-visible {
  outline: 2px solid rgba(255, 31, 45, 0.35);
  outline-offset: 2px;
}

.map-session-navigation__link span {
  font-size: 0.78rem;
  font-weight: 850;
  letter-spacing: 0.03em;
}

.map-session-navigation__link small {
  overflow-wrap: anywhere;
  font-size: 0.68rem;
}

.map-session-navigation__link--map {
  border-color: rgba(255, 31, 45, 0.45);
  background: var(--paper-accent, var(--paper));
}
</style>

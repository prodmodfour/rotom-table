<script setup lang="ts">
import { ref } from 'vue'
import AppNavigation from '~/components/AppNavigation.vue'

const expanded = ref(false)
const pointerExpanded = ref(false)
const focusExpanded = ref(false)
const railRef = ref<HTMLElement | null>(null)
const navigationContentId = 'map-navigation-rail-content'

const expandNavigation = () => {
  expanded.value = true
}

const expandNavigationFromPointer = () => {
  if (!expanded.value) pointerExpanded.value = true
  expandNavigation()
}

const expandNavigationFromFocus = () => {
  if (!expanded.value) focusExpanded.value = true
  expandNavigation()
}

const focusedElementIsInsideRail = () => {
  const activeElement = document.activeElement
  return Boolean(activeElement && railRef.value?.contains(activeElement))
}

const collapseNavigation = () => {
  pointerExpanded.value = false
  if (focusedElementIsInsideRail()) return
  focusExpanded.value = false
  expanded.value = false
}

const toggleNavigation = () => {
  if (!expanded.value || pointerExpanded.value || focusExpanded.value) {
    expanded.value = true
    pointerExpanded.value = false
    focusExpanded.value = false
    return
  }

  expanded.value = false
}

const handleFocusOut = (event: FocusEvent) => {
  const nextTarget = event.relatedTarget as Node | null
  if (nextTarget && railRef.value?.contains(nextTarget)) return

  focusExpanded.value = false
  expanded.value = false
}
</script>

<template>
  <aside
    ref="railRef"
    class="map-navigation-rail"
    :class="{
      'map-navigation-rail--expanded': expanded,
      'map-navigation-rail--collapsed': !expanded,
    }"
    aria-label="Map navigation"
    @pointerenter="expandNavigationFromPointer"
    @pointerleave="collapseNavigation"
    @focusin="expandNavigationFromFocus"
    @focusout="handleFocusOut"
  >
    <button
      type="button"
      class="map-navigation-rail__toggle"
      :aria-controls="navigationContentId"
      :aria-expanded="expanded"
      :aria-label="expanded ? 'Collapse map navigation' : 'Expand map navigation'"
      :title="expanded ? 'Collapse navigation' : 'Expand navigation'"
      @click.stop="toggleNavigation"
    >
      <span aria-hidden="true">‹</span>
    </button>

    <div
      v-show="expanded"
      :id="navigationContentId"
      class="map-navigation-rail__content"
    >
      <AppNavigation orientation="vertical" :show-role-badge="false" />
    </div>
  </aside>
</template>

<style scoped>
.map-navigation-rail {
  --map-navigation-toggle-size: clamp(42px, 3.2vw, 50px);

  position: absolute;
  bottom: 0;
  left: 0;
  min-width: 0;
  pointer-events: auto;
  transition:
    width 0.18s ease,
    height 0.18s ease,
    background 0.18s ease,
    border-color 0.18s ease,
    box-shadow 0.18s ease;
}

.map-navigation-rail--expanded {
  width: 100%;
  height: 100%;
  padding: 0.55rem;
  border: 1px solid var(--rule);
  border-radius: 18px;
  background: var(--map-glass-surface, var(--paper));
  box-shadow:
    0 24px 70px rgba(0, 0, 0, 0.30),
    inset 0 1px 0 rgba(255, 255, 255, 0.10);
  backdrop-filter: blur(18px) saturate(140%);
  -webkit-backdrop-filter: blur(18px) saturate(140%);
  overflow: hidden;
}

.map-navigation-rail--collapsed {
  width: var(--map-navigation-toggle-size);
  height: var(--map-navigation-toggle-size);
  border: 0;
  background: transparent;
  box-shadow: none;
  overflow: visible;
}

.map-navigation-rail__toggle {
  position: absolute;
  z-index: 2;
  bottom: 0;
  left: 0;
  display: grid;
  place-items: center;
  width: var(--map-navigation-toggle-size);
  height: var(--map-navigation-toggle-size);
  border: 1px solid var(--rule-soft);
  border-radius: 999px !important;
  background: var(--map-glass-surface-strong, var(--paper-soft));
  box-shadow:
    0 14px 34px rgba(0, 0, 0, 0.34),
    inset 0 1px 0 rgba(255, 255, 255, 0.14);
  color: var(--accent);
  cursor: pointer;
  font: inherit;
  font-size: clamp(1.35rem, 2vw, 1.75rem);
  font-weight: 900;
  line-height: 1;
  padding: 0;
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    color 0.15s ease,
    transform 0.15s ease;
}

.map-navigation-rail__toggle:hover,
.map-navigation-rail__toggle:focus-visible {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: #ff5c67;
  outline: none;
  transform: translateY(-1px);
}

.map-navigation-rail__toggle:focus-visible {
  outline: 2px solid rgba(255, 31, 45, 0.35);
  outline-offset: 3px;
}

.map-navigation-rail--expanded .map-navigation-rail__toggle {
  bottom: 0.55rem;
  left: 0.55rem;
}

.map-navigation-rail__content {
  height: 100%;
  min-width: 0;
  overflow: auto;
  overscroll-behavior: contain;
  padding-bottom: calc(var(--map-navigation-toggle-size) + 0.75rem);
}
</style>

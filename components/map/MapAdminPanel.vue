<script setup lang="ts">
import MapAdminGroundLevelControl from '~/components/map/MapAdminGroundLevelControl.vue'
import MapAdminYSummary from '~/components/map/MapAdminYSummary.vue'

defineProps<{
  groundLevelYMax: number
  mapGroundLevelY: number
  mapSpecificYMin: number
  mapSpecificYMax: number
}>()

const emit = defineEmits<{
  (event: 'close'): void
  (event: 'set-ground-level-y', value: string): void
}>()

</script>

<template>
  <div
    class="admin-panel-backdrop"
    role="presentation"
    @pointerdown.self="emit('close')"
  >
    <section
      class="admin-panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="admin-panel-title"
      @pointerdown.stop
    >
      <div class="admin-panel__header">
        <div>
          <p class="admin-panel__eyebrow">Admin · Ctrl+Shift+A</p>
          <h2 id="admin-panel-title">Map control panel</h2>
        </div>
        <button
          type="button"
          class="admin-panel__close"
          aria-label="Close admin control panel"
          @click="emit('close')"
        >
          ×
        </button>
      </div>

      <MapAdminGroundLevelControl
        :ground-level-y-max="groundLevelYMax"
        :map-ground-level-y="mapGroundLevelY"
        @set-ground-level-y="emit('set-ground-level-y', $event)"
      />

      <MapAdminYSummary
        :map-ground-level-y="mapGroundLevelY"
        :map-specific-y-min="mapSpecificYMin"
        :map-specific-y-max="mapSpecificYMax"
      />
    </section>
  </div>
</template>

<style scoped>
.admin-panel-backdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: grid;
  place-items: center;
  padding: 1rem;
  background: rgba(29, 32, 33, 0.58);
  backdrop-filter: blur(2px);
}

.admin-panel {
  width: min(440px, 100%);
  border: 1px solid var(--rule-strong);
  border-radius: 18px;
  background: var(--paper);
  box-shadow: var(--shadow-card);
  padding: 1rem;
}

.admin-panel__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1rem;
}

.admin-panel__eyebrow {
  margin: 0 0 0.2rem;
  color: var(--ink-muted);
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.admin-panel h2 {
  margin: 0;
  font-family: var(--font-book);
  color: var(--ink-bright);
}

.admin-panel__close {
  width: 34px;
  height: 34px;
  border: 1px solid var(--rule-soft);
  border-radius: 999px;
  background: var(--paper-soft);
  color: var(--ink);
  cursor: pointer;
  font: inherit;
  font-size: 1.4rem;
  line-height: 1;
}

.admin-panel__close:hover,
.admin-panel__close:focus-visible {
  border-color: var(--accent);
  color: var(--accent);
  outline: none;
}

</style>

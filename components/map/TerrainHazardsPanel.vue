<script setup lang="ts">
import LayerVisibilityControls from '~/components/map/LayerVisibilityControls.vue'
import { hexColorString, type VoxelMaterialDef } from '~/utils/voxels'
import type { BuildTool } from '~/shared/mapEditor'
import type { LayerVisibility, MapHazardKind, VoxelMaterial } from '~/types/map'
import type { MapHazardDefinition } from '~/utils/mapHazards'

type LayerVisibilityKey = keyof LayerVisibility

defineProps<{
  collapsed: boolean
  canEditMap: boolean
  buildMode: boolean
  hazardMode: boolean
  buildTool: BuildTool
  buildMaterial: VoxelMaterial
  buildColor: string | null
  visibleVoxelMaterials: readonly VoxelMaterialDef[]
  colorPickerValue: string
  voxelCount: number
  hazardCount: number
  hazardTool: BuildTool
  hazardKind: MapHazardKind
  activeHazardDef: MapHazardDefinition
  hazardPalette: MapHazardDefinition[]
  layerVisibility: LayerVisibility
  layerOptions: readonly LayerVisibilityKey[]
}>()

const emit = defineEmits<{
  (event: 'toggle-collapsed'): void
  (event: 'set-mode', mode: 'play' | 'build' | 'hazards'): void
  (event: 'set-build-tool', tool: BuildTool): void
  (event: 'select-material', material: VoxelMaterial): void
  (event: 'color-input', value: Event): void
  (event: 'clear-custom-color'): void
  (event: 'fill-ground'): void
  (event: 'clear-all-voxels'): void
  (event: 'set-layer-visibility', layer: LayerVisibilityKey, value: boolean): void
  (event: 'set-hazard-tool', tool: BuildTool): void
  (event: 'select-hazard-kind', kind: MapHazardKind): void
  (event: 'clear-all-hazards'): void
}>()

</script>

<template>
  <section class="panel-card terrain-panel">
    <div class="panel-heading panel-heading--collapsible">
      <button
        type="button"
        class="section-toggle-button"
        :aria-expanded="!collapsed"
        aria-controls="map-terrain-section"
        @click="emit('toggle-collapsed')"
      >
        <span class="section-toggle-button__chevron" aria-hidden="true">
          {{ collapsed ? '›' : '⌄' }}
        </span>
        <span class="section-toggle-button__title">Terrain</span>
      </button>
      <span class="badge">
        {{ voxelCount }} block{{ voxelCount === 1 ? '' : 's' }} · {{ hazardCount }} hazard{{ hazardCount === 1 ? '' : 's' }}
      </span>
    </div>

    <div id="map-terrain-section" v-show="!collapsed" class="collapsible-section-body">
      <div v-if="canEditMap" class="mode-row" role="group" aria-label="Editor mode">
        <button
          type="button"
          class="mode-button"
          :class="{ 'is-active': !buildMode && !hazardMode }"
          :aria-pressed="!buildMode && !hazardMode"
          @click="emit('set-mode', 'play')"
        >
          Play
        </button>
        <button
          type="button"
          class="mode-button"
          :class="{ 'is-active': buildMode }"
          :aria-pressed="buildMode"
          @click="emit('set-mode', 'build')"
        >
          Build
        </button>
        <button
          type="button"
          class="mode-button"
          :class="{ 'is-active': hazardMode }"
          :aria-pressed="hazardMode"
          @click="emit('set-mode', 'hazards')"
        >
          Hazards
        </button>
      </div>
      <p v-else class="permission-note">
        Terrain editing is GM-only.
      </p>

      <template v-if="buildMode && canEditMap">
        <div class="tool-row" role="group" aria-label="Build tool">
          <button
            type="button"
            class="tool-button"
            :class="{ 'is-active': buildTool === 'pencil' }"
            :aria-pressed="buildTool === 'pencil'"
            @click="emit('set-build-tool', 'pencil')"
          >
            Pencil
          </button>
          <button
            type="button"
            class="tool-button"
            :class="{ 'is-active': buildTool === 'eraser' }"
            :aria-pressed="buildTool === 'eraser'"
            @click="emit('set-build-tool', 'eraser')"
          >
            Eraser
          </button>
        </div>

        <div class="materials-grid" role="group" aria-label="Terrain material">
          <button
            v-for="material in visibleVoxelMaterials"
            :key="material.material"
            type="button"
            class="material-swatch"
            :class="{
              'is-active': buildMaterial === material.material && !buildColor,
            }"
            :aria-pressed="buildMaterial === material.material && !buildColor"
            @click="emit('select-material', material.material)"
          >
            <span
              class="swatch-color"
              :style="{ background: hexColorString(material.baseColor) }"
              aria-hidden="true"
            />
            <span class="swatch-label">{{ material.label }}</span>
          </button>
        </div>

        <div class="color-row">
          <label class="color-picker">
            <span>Custom color</span>
            <input
              type="color"
              :value="colorPickerValue"
              @input="emit('color-input', $event)"
            />
          </label>
          <button
            v-if="buildColor"
            type="button"
            class="ghost-button"
            @click="emit('clear-custom-color')"
          >
            Reset
          </button>
        </div>

        <p class="hint">
          Left click to {{ buildTool === 'pencil' ? 'place' : 'erase' }}, right click to
          erase. Click a voxel face to stack on top.
        </p>

        <div class="bulk-row">
          <button
            type="button"
            class="bulk-button"
            :disabled="buildTool === 'eraser'"
            @click="emit('fill-ground')"
          >
            Fill ground
          </button>
          <button
            type="button"
            class="bulk-button bulk-button--danger"
            :disabled="!voxelCount"
            @click="emit('clear-all-voxels')"
          >
            Clear all
          </button>
        </div>

        <LayerVisibilityControls
          :layer-visibility="layerVisibility"
          :layer-options="layerOptions"
          @set-layer-visibility="(layer, value) => emit('set-layer-visibility', layer, value)"
        />
      </template>

      <template v-if="hazardMode && canEditMap">
        <div class="tool-row" role="group" aria-label="Hazard tool">
          <button
            type="button"
            class="tool-button"
            :class="{ 'is-active': hazardTool === 'pencil' }"
            :aria-pressed="hazardTool === 'pencil'"
            @click="emit('set-hazard-tool', 'pencil')"
          >
            Place
          </button>
          <button
            type="button"
            class="tool-button"
            :class="{ 'is-active': hazardTool === 'eraser' }"
            :aria-pressed="hazardTool === 'eraser'"
            @click="emit('set-hazard-tool', 'eraser')"
          >
            Erase
          </button>
        </div>

        <div class="hazards-grid" role="group" aria-label="Hazard type">
          <button
            v-for="hazard in hazardPalette"
            :key="hazard.kind"
            type="button"
            class="hazard-swatch"
            :class="{ 'is-active': hazardKind === hazard.kind }"
            :aria-pressed="hazardKind === hazard.kind"
            :title="hazard.description"
            @click="emit('select-hazard-kind', hazard.kind)"
          >
            <span
              class="hazard-swatch__icon"
              :style="{ '--hazard-color': hazard.color }"
              aria-hidden="true"
            >{{ hazard.shortLabel }}</span>
            <span class="hazard-swatch__label">{{ hazard.label }}</span>
          </button>
        </div>

        <p class="hint">
          Left click to {{ hazardTool === 'pencil' ? `place ${activeHazardDef.label}` : 'erase hazards' }}.
          Right click erases all hazards on a square. Toxic Spikes stacks to 2 layers.
        </p>

        <div class="bulk-row">
          <button
            type="button"
            class="bulk-button bulk-button--danger"
            :disabled="!hazardCount"
            @click="emit('clear-all-hazards')"
          >
            Clear hazards
          </button>
        </div>
      </template>
    </div>
  </section>
</template>

<style scoped>
.panel-card {
  border: 1px solid var(--rule);
  border-radius: 14px;
  background: var(--paper-soft);
  box-shadow: var(--shadow-card);
  padding: 0.95rem;
}

.panel-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.85rem;
}

.panel-heading h2 {
  margin: 0;
  font-family: var(--font-book);
  font-size: 1.15rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--ink-bright);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.panel-heading--collapsible {
  margin-bottom: 0;
}

.section-toggle-button {
  flex: 1 1 auto;
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  border: 0;
  background: transparent;
  color: var(--ink-bright);
  padding: 0;
  cursor: pointer;
  font: inherit;
  text-align: left;
}

.section-toggle-button:hover,
.section-toggle-button:focus-visible {
  color: var(--accent);
}

.section-toggle-button:focus-visible {
  outline: 2px solid rgba(250, 189, 47, 0.35);
  outline-offset: 3px;
  border-radius: 8px;
}

.section-toggle-button__chevron {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.15rem;
  height: 1.15rem;
  border: 1px solid var(--rule-soft);
  border-radius: 999px;
  color: var(--accent);
  font-size: 0.9rem;
  font-weight: 800;
  line-height: 1;
}

.section-toggle-button__title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-book);
  font-size: 1.15rem;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.collapsible-section-body {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.badge {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 0.22rem 0.65rem;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 0.74rem;
  letter-spacing: 0.06em;
  white-space: nowrap;
}

input {
  width: 100%;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink);
  padding: 0.65rem 0.8rem;
  outline: none;
}

input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(250, 189, 47, 0.18);
}

input:disabled {
  cursor: not-allowed;
  opacity: 0.65;
}

.permission-note {
  margin: 0;
  color: var(--ink-muted);
  font-size: 0.86rem;
  line-height: 1.45;
}

.terrain-panel {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.mode-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.4rem;
}

.mode-button {
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink);
  padding: 0.55rem 0.8rem;
  cursor: pointer;
  font: inherit;
  letter-spacing: 0.04em;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.mode-button:hover {
  border-color: var(--rule-strong);
  background: var(--paper-hover);
}

.mode-button.is-active {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
}

.tool-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.4rem;
}

.tool-button {
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink);
  padding: 0.5rem 0.7rem;
  cursor: pointer;
  font: inherit;
  letter-spacing: 0.04em;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.tool-button:hover {
  border-color: var(--rule-strong);
  background: var(--paper-hover);
}

.tool-button.is-active {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
}

.materials-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.4rem;
}

.material-swatch {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0.3rem;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  padding: 0.4rem;
  cursor: pointer;
  font: inherit;
  text-align: center;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.material-swatch:hover {
  border-color: var(--rule-strong);
  background: var(--paper-hover);
}

.material-swatch.is-active {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.swatch-color {
  display: block;
  height: 28px;
  border-radius: 6px;
  border: 1px solid rgba(0, 0, 0, 0.25);
}

.swatch-label {
  font-size: 0.74rem;
  letter-spacing: 0.04em;
  color: var(--ink);
}

.material-swatch.is-active .swatch-label {
  color: var(--accent);
}

.hazards-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.4rem;
}

.hazard-swatch {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 0.45rem;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink);
  padding: 0.45rem;
  cursor: pointer;
  font: inherit;
  text-align: left;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.hazard-swatch:hover {
  border-color: var(--rule-strong);
  background: var(--paper-hover);
}

.hazard-swatch.is-active {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.hazard-swatch__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.45rem;
  min-height: 1.9rem;
  border: 1px solid color-mix(in srgb, var(--hazard-color) 65%, #1d2021);
  border-radius: 8px;
  background: color-mix(in srgb, var(--hazard-color) 24%, transparent);
  color: color-mix(in srgb, var(--hazard-color) 78%, #fbf1c7);
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: 0.08em;
}

.hazard-swatch__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.78rem;
  letter-spacing: 0.04em;
}

.hazard-swatch.is-active .hazard-swatch__label {
  color: var(--accent);
}

.color-row {
  display: flex;
  align-items: flex-end;
  gap: 0.5rem;
}

.color-picker {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.color-picker span {
  font-size: 0.78rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ink-muted);
}

.color-picker input[type='color'] {
  width: 100%;
  height: 38px;
  padding: 0;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  cursor: pointer;
}

.ghost-button {
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink-soft);
  padding: 0.5rem 0.7rem;
  cursor: pointer;
  font: inherit;
  font-size: 0.78rem;
  letter-spacing: 0.04em;
  white-space: nowrap;
}

.ghost-button:hover {
  border-color: var(--rule-strong);
  color: var(--ink-bright);
}

.hint {
  margin: 0;
  color: var(--ink-muted);
  font-size: 0.78rem;
  letter-spacing: 0.02em;
  line-height: 1.4;
}

.bulk-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.4rem;
}

.bulk-button {
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink);
  padding: 0.5rem 0.7rem;
  cursor: pointer;
  font: inherit;
  letter-spacing: 0.04em;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.bulk-button:hover:not(:disabled) {
  border-color: var(--rule-strong);
  background: var(--paper-hover);
}

.bulk-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.bulk-button--danger {
  color: #fb4934;
}

.bulk-button--danger:hover:not(:disabled) {
  border-color: #fb4934;
  background: rgba(251, 73, 52, 0.08);
}
</style>

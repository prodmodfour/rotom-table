<script setup lang="ts">
import { computed } from 'vue'
import { PhX } from '@phosphor-icons/vue'
import { DEFAULT_TRAINER_ACCENT_COLOR, normalizeTrainerAccentColor } from '~/utils/trainerAccent'
import type { TrainerSheet } from '~/types/trainerSheet'

const props = defineProps<{
  sheet: TrainerSheet
  currentHp: number
  maxHp: number
  fullMaxHp: number
  maxAp: number
  canManagePlayerAccess: boolean
}>()

const emit = defineEmits<{
  'open-healing': []
  'open-training': []
  'open-portrait-picker': []
  'clear-portrait': []
  'set-current-hp': [value: unknown]
  'set-accent-color': [value: unknown]
}>()

const accentColorValue = computed(() => normalizeTrainerAccentColor(props.sheet.accentColor) ?? DEFAULT_TRAINER_ACCENT_COLOR)
const actionPointsLeft = computed<number | undefined>({
  get: () => props.sheet.ap?.left ?? props.maxAp,
  set: (value) => {
    if (!props.sheet.ap) props.sheet.ap = {}
    props.sheet.ap.left = value
  },
})

const setAccentColorFromEvent = (event: Event) => {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  emit('set-accent-color', target.value)
}
</script>

<template>
  <header class="identity-strip">
    <div
      class="portrait-tile"
      :class="{ 'portrait-tile--empty': !sheet.portraitUrl }"
      role="button"
      tabindex="0"
      :aria-label="sheet.portraitUrl ? 'Change trainer sprite' : 'Pick a trainer sprite'"
      @click="emit('open-portrait-picker')"
      @keydown.enter.prevent="emit('open-portrait-picker')"
      @keydown.space.prevent="emit('open-portrait-picker')"
    >
      <img
        v-if="sheet.portraitUrl"
        :src="sheet.portraitUrl"
        :alt="`${sheet.name} portrait`"
        class="portrait-tile__img"
      />
      <span v-else class="portrait-tile__placeholder">
        Pick<br />sprite
      </span>
      <button
        v-if="sheet.portraitUrl"
        type="button"
        class="portrait-tile__clear"
        title="Remove sprite"
        @click.stop="emit('clear-portrait')"
      >
        <PhX :size="12" weight="bold" />
      </button>
    </div>
    <div class="identity-info">
      <h1><EditableCell v-model="sheet.name" placeholder="Trainer name" /></h1>
      <p class="identity-meta">
        Lv <EditableCell v-model="sheet.level" type="number" :min="1" /> ·
        <EditableCell v-model="sheet.sex" placeholder="Sex" /> · Age
        <EditableCell v-model="sheet.age" placeholder="—" /> ·
        <EditableCell v-model="sheet.height" placeholder="1.65m" /> ·
        <EditableCell v-model="sheet.weight" placeholder="115 lb" />
      </p>
      <p class="identity-played-by">
        Played by
        <strong><EditableCell v-model="sheet.playedBy" placeholder="—" /></strong>
      </p>
      <div class="identity-controls">
        <label class="accent-picker" title="Trainer accent colour">
          <span>Accent colour</span>
          <input
            type="color"
            :value="accentColorValue"
            aria-label="Trainer accent colour"
            @input="setAccentColorFromEvent"
          />
        </label>
        <button type="button" class="healing-button" @click="emit('open-healing')">
          Healing
        </button>
        <button type="button" class="training-button" @click="emit('open-training')">
          Training
        </button>
        <label v-if="canManagePlayerAccess" class="player-toggle" :class="{ active: sheet.player }" title="Player">
          <input v-model="sheet.player" type="checkbox" /> Player
        </label>
        <span v-else-if="sheet.player" class="player-toggle active">Player</span>
      </div>
    </div>
    <div class="identity-vitals">
      <div class="vital">
        <span class="vital-label">Current HP</span>
        <span class="vital-value">
          <EditableCell
            :model-value="currentHp"
            type="number"
            :max="maxHp"
            @update:model-value="(value) => emit('set-current-hp', value)"
          />
        </span>
      </div>
      <div
        class="vital"
        title="Formula Max HP = Level × 2 + (HP × 3) + 10. Injuries reduce the effective Max HP by 1/10 each."
      >
        <span class="vital-label">Max HP</span>
        <span class="vital-value">
          {{ maxHp }}
          <span v-if="maxHp !== fullMaxHp" class="vital-sub">full {{ fullMaxHp }}</span>
        </span>
      </div>
      <div class="vital">
        <span class="vital-label">AP</span>
        <span class="vital-value">
          <EditableCell v-model="actionPointsLeft" type="number" :min="0" accessible-label="Action Points left" />
          <span class="vital-divider">/</span> {{ maxAp }}
        </span>
      </div>
      <div class="vital">
        <span class="vital-label">Injuries</span>
        <span class="vital-value">
          <EditableCell v-model="sheet.currentInjuries" type="number" :min="0" :max="10" />
        </span>
      </div>
      <div class="vital">
        <span class="vital-label">Money</span>
        <span class="vital-value">
          $<EditableCell v-model="sheet.money" type="number" :min="0" />
        </span>
      </div>
    </div>
  </header>
</template>

<style scoped>
.identity-strip {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  padding-bottom: 0.85rem;
  border-bottom: 1px solid var(--rule-soft);
}

/* Portrait tile in identity strip */
.portrait-tile {
  position: relative;
  flex: 0 0 auto;
  width: 96px;
  height: 96px;
  border: 1px solid var(--rule-soft);
  border-radius: 12px;
  background: var(--paper-inset);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  overflow: hidden;
  transition: border-color 0.12s, background 0.12s, box-shadow 0.12s;
}

.portrait-tile:hover,
.portrait-tile:focus-visible {
  border-color: var(--accent);
  background: var(--paper-hover);
  outline: none;
  box-shadow: 0 0 0 2px rgba(var(--accent-rgb), 0.2);
}

.portrait-tile--empty {
  border-style: dashed;
}

.portrait-tile__img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  image-rendering: pixelated;
}

.portrait-tile__placeholder {
  font-size: 0.7rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ink-muted);
  text-align: center;
  line-height: 1.3;
}

.portrait-tile__clear {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid var(--rule-soft);
  border-radius: 999px;
  background: var(--paper);
  color: var(--ink-soft);
  cursor: pointer;
}

.portrait-tile__clear:hover {
  color: #d36464;
  border-color: rgba(220, 80, 80, 0.45);
  background: rgba(220, 80, 80, 0.08);
}

.identity-info { flex: 1 1 auto; min-width: 200px; }

.identity-info h1 {
  margin: 0 0 0.25rem;
  font-family: var(--font-book);
  font-size: 1.7rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--ink-bright);
}

.identity-meta {
  margin: 0;
  color: var(--ink-soft);
  font-style: italic;
}

.identity-played-by {
  margin: 0.25rem 0 0;
  color: var(--ink-muted);
  font-size: 0.85rem;
}

.identity-controls {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.45rem;
  margin-top: 0.45rem;
}

.accent-picker {
  display: inline-flex;
  align-items: center;
  gap: 0.42rem;
  border: 1px solid var(--rule-soft);
  border-radius: 999px;
  padding: 0.2rem 0.55rem;
  background: rgba(221, 210, 176, 0.16);
  color: var(--ink-bright);
  font-size: 0.74rem;
  letter-spacing: 0.06em;
  user-select: none;
}

.accent-picker input {
  width: 1.35rem;
  height: 1.1rem;
  padding: 0;
  border: 1px solid var(--rule-soft);
  background: transparent;
  cursor: pointer;
}

.player-toggle,
.healing-button,
.training-button {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  border: 1px solid var(--rule-soft);
  border-radius: 999px;
  padding: 0.22rem 0.65rem;
  background: rgba(221, 210, 176, 0.16);
  color: var(--ink-bright);
  font: inherit;
  font-size: 0.74rem;
  letter-spacing: 0.06em;
  cursor: pointer;
  user-select: none;
}

.healing-button,
.training-button {
  border-color: color-mix(in srgb, var(--accent) 60%, var(--rule-soft));
  background: rgba(var(--accent-rgb), 0.16);
  font-weight: 800;
}

.healing-button:hover,
.healing-button:focus-visible,
.training-button:hover,
.training-button:focus-visible {
  border-color: var(--accent);
  background: rgba(var(--accent-rgb), 0.26);
  outline: none;
}

.player-toggle.active {
  background: rgba(221, 210, 176, 0.28);
}

.player-toggle input {
  width: 0.85em;
  height: 0.85em;
  margin: 0;
}

.identity-vitals {
  display: grid;
  grid-template-columns: repeat(5, minmax(88px, 1fr));
  gap: 0.45rem;
  flex: 1 1 560px;
  min-width: min(100%, 560px);
  overflow-x: auto;
}

.vital {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 0;
  padding: 0.45rem 0.6rem;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper-inset);
}

.vital-label {
  font-size: 0.68rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ink-muted);
}

.vital-value {
  font-size: 1.15rem;
  font-weight: 700;
  color: var(--ink-bright);
  font-variant-numeric: tabular-nums;
}

.vital-divider {
  color: var(--ink-faint);
  font-weight: 400;
  margin: 0 0.18rem;
}

.vital-sub {
  margin-left: 0.35rem;
  color: var(--ink-muted);
  font-size: 0.76rem;
  font-weight: 400;
  letter-spacing: 0.04em;
}
</style>

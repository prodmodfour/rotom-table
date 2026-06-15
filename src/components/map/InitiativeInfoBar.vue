<script setup lang="ts">
import { computed } from 'vue'
import InitiativeProfileImage from '~/components/map/InitiativeProfileImage.vue'
import type { InitiativeRow } from '~/composables/map-editor/useInitiativeTracker'
import { splitInitiativeTimeline } from '~/utils/initiativeTimeline'
import { trainerAccentCssVariables } from '~/utils/trainerAccent'

const props = defineProps<{
  rows: InitiativeRow[]
  activeId: string | null | undefined
  round: number
  canManage: boolean
}>()

const emit = defineEmits<{
  (event: 'focus', id: string): void
  (event: 'previous'): void
  (event: 'next'): void
}>()

const timeline = computed(() => splitInitiativeTimeline(props.rows, props.activeId, props.round))
const controlsEnabled = computed(() => props.canManage)

const emitPrevious = () => {
  if (controlsEnabled.value) emit('previous')
}

const emitNext = () => {
  if (controlsEnabled.value) emit('next')
}

const tileTitle = (entry: InitiativeRow): string =>
  `${entry.name} · Initiative ${entry.initiativeScore}`

const tileAccentStyle = (entry: InitiativeRow): Record<string, string> | undefined =>
  entry.accentColor ? trainerAccentCssVariables(entry.accentColor) : undefined
</script>

<template>
  <aside
    v-if="rows.length"
    class="initiative-info-bar"
    :class="{ 'initiative-info-bar--inactive': !timeline.current }"
    aria-label="Initiative turn order"
  >
    <template v-if="timeline.current">
      <ol class="initiative-info-bar__side initiative-info-bar__side--past" aria-label="Turns already taken">
        <li v-for="entry in timeline.past" :key="entry.id">
          <button
            type="button"
            class="initiative-info-bar__tile is-past"
            :class="{ 'is-fainted': entry.currentHp <= 0 }"
            :style="tileAccentStyle(entry)"
            :title="tileTitle(entry)"
            :aria-label="`Center map on ${entry.name}`"
            @click="emit('focus', entry.id)"
          >
            <InitiativeProfileImage :entry="entry" />
          </button>
        </li>
      </ol>

      <div class="initiative-info-bar__current">
        <div class="initiative-info-bar__current-row">
          <button
            type="button"
            class="initiative-info-bar__arrow"
            :disabled="!controlsEnabled"
            aria-label="Previous turn"
            title="Previous turn"
            @click="emitPrevious"
          >
            &lt;
          </button>
          <button
            type="button"
            class="initiative-info-bar__tile initiative-info-bar__tile--current"
            :class="{ 'is-fainted': timeline.current.currentHp <= 0 }"
            :style="tileAccentStyle(timeline.current)"
            :title="tileTitle(timeline.current)"
            :aria-label="`Center map on ${timeline.current.name}`"
            aria-current="step"
            @click="emit('focus', timeline.current.id)"
          >
            <InitiativeProfileImage :entry="timeline.current" />
          </button>
          <button
            type="button"
            class="initiative-info-bar__arrow"
            :disabled="!controlsEnabled"
            aria-label="Next turn"
            title="Next turn"
            @click="emitNext"
          >
            &gt;
          </button>
        </div>
        <span class="initiative-info-bar__round-label">Round {{ round }}</span>
      </div>

      <ol class="initiative-info-bar__side initiative-info-bar__side--upcoming" aria-label="Upcoming turns">
        <li v-for="entry in timeline.upcoming" :key="entry.id">
          <button
            type="button"
            class="initiative-info-bar__tile"
            :class="{ 'is-fainted': entry.currentHp <= 0 }"
            :style="tileAccentStyle(entry)"
            :title="tileTitle(entry)"
            :aria-label="`Center map on ${entry.name}`"
            @click="emit('focus', entry.id)"
          >
            <InitiativeProfileImage :entry="entry" />
          </button>
        </li>
      </ol>
    </template>

    <ol v-else class="initiative-info-bar__order" aria-label="Initiative order">
      <li v-for="entry in timeline.upcoming" :key="entry.id">
        <button
          type="button"
          class="initiative-info-bar__tile"
          :class="{ 'is-fainted': entry.currentHp <= 0 }"
          :style="tileAccentStyle(entry)"
          :title="tileTitle(entry)"
          :aria-label="`Center map on ${entry.name}`"
          @click="emit('focus', entry.id)"
        >
          <InitiativeProfileImage :entry="entry" />
        </button>
      </li>
    </ol>
  </aside>
</template>

<style scoped>
.initiative-info-bar {
  --profile-width: var(--map-initiative-profile-width, clamp(88px, 8.5vw, 124px));
  --profile-height: var(--map-initiative-profile-height, clamp(33px, 3.2vw, 46px));

  position: absolute;
  z-index: 4;
  top: var(--map-overlay-gutter, 0.75rem);
  right: var(--map-overlay-gutter, 0.75rem);
  left: var(--map-overlay-gutter, 0.75rem);
  display: grid;
  min-width: 0;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: start;
  gap: 0.35rem;
  pointer-events: none;
}

.initiative-info-bar--inactive {
  display: flex;
  justify-content: center;
}

.initiative-info-bar__order {
  display: flex;
  max-width: 100%;
  gap: 0.35rem;
  overflow: hidden;
  margin: 0;
  padding: 0;
  list-style: none;
}

.initiative-info-bar__side {
  display: flex;
  min-width: 0;
  gap: 0.35rem;
  margin: 0;
  padding: 0;
  overflow: hidden;
  list-style: none;
}

.initiative-info-bar__side--past {
  justify-content: flex-end;
  mask-image: linear-gradient(90deg, transparent, black 14%, black);
}

.initiative-info-bar__side--upcoming {
  justify-content: flex-start;
  mask-image: linear-gradient(90deg, black, black 86%, transparent);
}

.initiative-info-bar__side li,
.initiative-info-bar__order li {
  flex: 0 0 auto;
}

.initiative-info-bar__current {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-self: center;
  gap: 0.18rem;
}

.initiative-info-bar__current-row {
  display: flex;
  align-items: center;
  gap: 0.18rem;
}

.initiative-info-bar__arrow {
  box-sizing: border-box;
  display: grid;
  place-items: center;
  width: clamp(16px, 1.45vw, 22px);
  height: calc(var(--profile-height) * 0.88);
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--accent);
  cursor: pointer;
  font: inherit;
  font-size: clamp(0.78rem, 1.2vw, 1rem);
  font-weight: 900;
  line-height: 1;
  padding: 0;
  pointer-events: auto;
  filter: drop-shadow(0 1px 2px color-mix(in srgb, var(--pokemon-black) 35%, transparent));
  transition: color 0.15s ease, opacity 0.15s ease, transform 0.15s ease;
}

.initiative-info-bar__arrow:hover:not(:disabled),
.initiative-info-bar__arrow:focus-visible:not(:disabled) {
  color: #ff5c67;
  outline: none;
  transform: translateY(-1px);
}

.initiative-info-bar__arrow:disabled {
  cursor: not-allowed;
  opacity: 0.35;
}

.initiative-info-bar__round-label {
  color: var(--ink-bright);
  font-size: 0.72rem;
  font-weight: 800;
  line-height: 1;
  filter: drop-shadow(0 1px 2px color-mix(in srgb, var(--pokemon-black) 28%, transparent));
  white-space: nowrap;
}

.initiative-info-bar__tile {
  box-sizing: border-box;
  display: grid;
  place-items: center;
  width: var(--profile-width);
  height: var(--profile-height);
  overflow: hidden;
  border: 1px solid var(--rule-soft);
  border-radius: 0;
  background: var(--map-glass-surface, color-mix(in srgb, var(--paper) 72%, transparent));
  box-shadow:
    0 8px 22px color-mix(in srgb, var(--pokemon-black) 18%, transparent),
    inset 0 1px 0 color-mix(in srgb, var(--ink-bright) 10%, transparent);
  backdrop-filter: blur(12px) saturate(135%);
  -webkit-backdrop-filter: blur(12px) saturate(135%);
  color: inherit;
  cursor: pointer;
  pointer-events: auto;
  font: inherit;
  padding: 0;
  transition: border-color 0.15s ease, opacity 0.15s ease, transform 0.15s ease;
}

.initiative-info-bar__tile:hover,
.initiative-info-bar__tile:focus-visible {
  border-color: var(--accent);
  outline: none;
  transform: translateY(-1px);
}

.initiative-info-bar__tile.is-past {
  opacity: 0.58;
}

.initiative-info-bar__tile.is-fainted {
  opacity: 0.38;
  filter: grayscale(0.85);
}

.initiative-info-bar__tile--current {
  border: 2px solid var(--accent);
  box-shadow:
    0 0 0 2px rgba(var(--accent-rgb), 0.22),
    0 10px 26px color-mix(in srgb, var(--pokemon-black) 22%, transparent),
    inset 0 1px 0 color-mix(in srgb, var(--ink-bright) 12%, transparent);
  opacity: 1;
}
</style>

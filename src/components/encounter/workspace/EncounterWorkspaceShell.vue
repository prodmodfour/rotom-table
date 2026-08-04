<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import type { EncounterWorkspacePreferences } from '#shared/encounterWorkspace/preferences'

const props = withDefaults(defineProps<{
  preferences: EncounterWorkspacePreferences
  primaryDecisionActive?: boolean
}>(), {
  primaryDecisionActive: false,
})
const emit = defineEmits<{
  'update-preferences': [patch: Partial<Omit<EncounterWorkspacePreferences, 'schemaVersion'>>]
}>()

type ResizeRegion = 'roster' | 'events' | 'dock'
type MobilePanel = 'stage' | 'roster' | 'events'
interface ResizeSession { region: ResizeRegion, start: number, size: number }
let resizeSession: ResizeSession | null = null
const mobilePanel = ref<MobilePanel>('stage')

watch(() => props.primaryDecisionActive, (active) => {
  if (active) mobilePanel.value = 'stage'
})

const bounds: Readonly<Record<ResizeRegion, readonly [number, number]>> = {
  roster: [220, 480],
  events: [260, 560],
  dock: [180, 520],
}
const sizeFor = (region: ResizeRegion): number => {
  if (region === 'roster') return props.preferences.rosterWidthPx
  if (region === 'events') return props.preferences.eventRailWidthPx
  return props.preferences.actionDockHeightPx
}
const setSize = (region: ResizeRegion, value: number): void => {
  const [minimum, maximum] = bounds[region]
  const bounded = Math.round(Math.min(maximum, Math.max(minimum, value)))
  if (region === 'roster') emit('update-preferences', { rosterWidthPx: bounded })
  else if (region === 'events') emit('update-preferences', { eventRailWidthPx: bounded })
  else emit('update-preferences', { actionDockHeightPx: bounded })
}
const pointerCoordinate = (event: PointerEvent, region: ResizeRegion): number => (
  region === 'dock' ? event.clientY : event.clientX
)
const finishResize = (): void => {
  resizeSession = null
  window.removeEventListener('pointermove', handlePointerMove)
  window.removeEventListener('pointerup', finishResize)
  window.removeEventListener('pointercancel', finishResize)
}
const handlePointerMove = (event: PointerEvent): void => {
  if (!resizeSession) return
  const coordinate = pointerCoordinate(event, resizeSession.region)
  const direction = resizeSession.region === 'events' || resizeSession.region === 'dock' ? -1 : 1
  setSize(resizeSession.region, resizeSession.size + (coordinate - resizeSession.start) * direction)
}
const startResize = (region: ResizeRegion, event: PointerEvent): void => {
  if (event.button !== 0) return
  resizeSession = { region, start: pointerCoordinate(event, region), size: sizeFor(region) }
  window.addEventListener('pointermove', handlePointerMove)
  window.addEventListener('pointerup', finishResize)
  window.addEventListener('pointercancel', finishResize)
  event.preventDefault()
}
const resizeWithKeyboard = (region: ResizeRegion, event: KeyboardEvent): void => {
  const decrementKey = region === 'dock' ? 'ArrowDown' : region === 'events' ? 'ArrowRight' : 'ArrowLeft'
  const incrementKey = region === 'dock' ? 'ArrowUp' : region === 'events' ? 'ArrowLeft' : 'ArrowRight'
  if (event.key !== decrementKey && event.key !== incrementKey && event.key !== 'Home' && event.key !== 'End') return
  event.preventDefault()
  if (event.key === 'Home') setSize(region, bounds[region][0])
  else if (event.key === 'End') setSize(region, bounds[region][1])
  else setSize(region, sizeFor(region) + (event.key === incrementKey ? 16 : -16))
}
const toggle = (region: ResizeRegion): void => {
  if (region === 'roster') emit('update-preferences', { roster: props.preferences.roster === 'expanded' ? 'collapsed' : 'expanded' })
  else if (region === 'events') emit('update-preferences', { eventRail: props.preferences.eventRail === 'expanded' ? 'collapsed' : 'expanded' })
  else emit('update-preferences', { actionDock: props.preferences.actionDock === 'expanded' ? 'compact' : 'expanded' })
}

onBeforeUnmount(finishResize)
</script>

<template>
  <div
    class="encounter-workspace-shell"
    :class="{
      'encounter-workspace-shell--roster-collapsed': preferences.roster === 'collapsed',
      'encounter-workspace-shell--events-collapsed': preferences.eventRail === 'collapsed',
      'encounter-workspace-shell--dock-compact': preferences.actionDock === 'compact',
      'encounter-workspace-shell--table-display': preferences.layout === 'table-display',
    }"
    :style="{
      '--encounter-roster-width': `${preferences.rosterWidthPx}px`,
      '--encounter-event-width': `${preferences.eventRailWidthPx}px`,
      '--encounter-dock-height': `${preferences.actionDockHeightPx}px`,
    }"
  >
    <header class="encounter-workspace-shell__header">
      <slot name="navigation" />
      <slot name="status" />
      <slot name="timeline" />
    </header>

    <nav class="encounter-workspace-shell__mobile-tabs" aria-label="Encounter regions">
      <button type="button" :aria-current="mobilePanel === 'stage' ? 'page' : undefined" @click="mobilePanel = 'stage'">Battle</button>
      <button type="button" :aria-current="mobilePanel === 'roster' ? 'page' : undefined" @click="mobilePanel = 'roster'">Participants</button>
      <button type="button" :aria-current="mobilePanel === 'events' ? 'page' : undefined" @click="mobilePanel = 'events'">Decisions &amp; history</button>
    </nav>

    <div class="encounter-workspace-shell__body" :data-mobile-panel="mobilePanel">
      <aside id="encounter-participant-roster" class="encounter-workspace-shell__roster" aria-label="Participants and sides" tabindex="-1">
        <button
          type="button"
          class="encounter-workspace-shell__collapse"
          :aria-expanded="preferences.roster === 'expanded'"
          aria-label="Toggle participant roster"
          @click="toggle('roster')"
        >
          <span aria-hidden="true">{{ preferences.roster === 'expanded' ? '‹' : '›' }}</span>
          <span class="encounter-workspace-shell__collapse-label">Roster</span>
        </button>
        <div v-show="preferences.roster === 'expanded'" class="encounter-workspace-shell__region-content">
          <slot name="roster" />
        </div>
      </aside>
      <div
        v-if="preferences.roster === 'expanded'"
        class="encounter-workspace-shell__separator encounter-workspace-shell__separator--roster"
        role="separator"
        aria-label="Resize participant roster"
        aria-orientation="vertical"
        :aria-valuenow="preferences.rosterWidthPx"
        :aria-valuemin="220"
        :aria-valuemax="480"
        tabindex="0"
        @pointerdown="startResize('roster', $event)"
        @keydown="resizeWithKeyboard('roster', $event)"
      />

      <main id="encounter-battle-stage" class="encounter-workspace-shell__stage" aria-label="Battle stage" tabindex="-1">
        <slot name="stage" />
      </main>

      <div
        v-if="preferences.eventRail === 'expanded'"
        class="encounter-workspace-shell__separator encounter-workspace-shell__separator--events"
        role="separator"
        aria-label="Resize encounter history"
        aria-orientation="vertical"
        :aria-valuenow="preferences.eventRailWidthPx"
        :aria-valuemin="260"
        :aria-valuemax="560"
        tabindex="0"
        @pointerdown="startResize('events', $event)"
        @keydown="resizeWithKeyboard('events', $event)"
      />
      <aside id="encounter-decision-history" class="encounter-workspace-shell__events" aria-label="Decisions and encounter history" tabindex="-1">
        <button
          type="button"
          class="encounter-workspace-shell__collapse"
          :aria-expanded="preferences.eventRail === 'expanded'"
          aria-label="Toggle decision and history rail"
          @click="toggle('events')"
        >
          <span aria-hidden="true">{{ preferences.eventRail === 'expanded' ? '›' : '‹' }}</span>
          <span class="encounter-workspace-shell__collapse-label">Events</span>
        </button>
        <div v-show="preferences.eventRail === 'expanded'" class="encounter-workspace-shell__region-content">
          <slot name="events" />
        </div>
      </aside>
    </div>

    <div
      v-if="preferences.actionDock === 'expanded'"
      class="encounter-workspace-shell__separator encounter-workspace-shell__separator--dock"
      role="separator"
      aria-label="Resize action dock"
      aria-orientation="horizontal"
      :aria-valuenow="preferences.actionDockHeightPx"
      :aria-valuemin="180"
      :aria-valuemax="520"
      tabindex="0"
      @pointerdown="startResize('dock', $event)"
      @keydown="resizeWithKeyboard('dock', $event)"
    />
    <footer class="encounter-workspace-shell__dock" role="region" aria-label="Available actions">
      <button
        type="button"
        class="encounter-workspace-shell__collapse encounter-workspace-shell__collapse--dock"
        :aria-expanded="preferences.actionDock === 'expanded'"
        aria-label="Toggle action dock"
        @click="toggle('dock')"
      >
        <span aria-hidden="true">{{ preferences.actionDock === 'expanded' ? '⌄' : '⌃' }}</span>
        <span class="encounter-workspace-shell__collapse-label">Actions</span>
      </button>
      <div v-show="preferences.actionDock === 'expanded'" class="encounter-workspace-shell__dock-content">
        <slot name="dock" />
      </div>
    </footer>
  </div>
</template>

<style scoped>
.encounter-workspace-shell {
  min-height: 100dvh;
  display: grid;
  grid-template-rows: auto minmax(18rem, 1fr) 5px var(--encounter-dock-height);
  overflow: clip;
  background: var(--rt-bg-world);
  color: var(--rt-text);
}
.encounter-workspace-shell--dock-compact { grid-template-rows: auto minmax(18rem, 1fr) 0 3.4rem; }
.encounter-workspace-shell--table-display { grid-template-rows: auto minmax(24rem, 1fr) 5px min(24dvh, var(--encounter-dock-height)); }
.encounter-workspace-shell__mobile-tabs { display: none; }
.encounter-workspace-shell__header { z-index: 2; min-width: 0; background: var(--rt-surface-1); }
.encounter-workspace-shell__body {
  min-height: 0;
  display: grid;
  grid-template-columns: var(--encounter-roster-width) 5px minmax(18rem, 1fr) 5px var(--encounter-event-width);
}
.encounter-workspace-shell--roster-collapsed .encounter-workspace-shell__body { grid-template-columns: 3.4rem minmax(18rem, 1fr) 5px var(--encounter-event-width); }
.encounter-workspace-shell--events-collapsed .encounter-workspace-shell__body { grid-template-columns: var(--encounter-roster-width) 5px minmax(18rem, 1fr) 3.4rem; }
.encounter-workspace-shell--roster-collapsed.encounter-workspace-shell--events-collapsed .encounter-workspace-shell__body { grid-template-columns: 3.4rem minmax(18rem, 1fr) 3.4rem; }
.encounter-workspace-shell__roster,
.encounter-workspace-shell__events,
.encounter-workspace-shell__dock { min-width: 0; min-height: 0; overflow: hidden; background: var(--rt-surface-1); }
.encounter-workspace-shell__roster { border-right: 1px solid var(--rt-rule); }
.encounter-workspace-shell__events { border-left: 1px solid var(--rt-rule); }
.encounter-workspace-shell__region-content,
.encounter-workspace-shell__dock-content { height: calc(100% - 2.9rem); overflow: auto; overscroll-behavior: contain; }
.encounter-workspace-shell__stage { min-width: 0; min-height: 0; overflow: auto; background: var(--rt-bg-world); }
.encounter-workspace-shell__dock { position: relative; border-top: 1px solid var(--rt-rule); }
.encounter-workspace-shell__dock-content { height: 100%; padding-left: 3.5rem; }
.encounter-workspace-shell__collapse {
  width: 100%; min-height: 2.9rem; display: flex; align-items: center; gap: 0.4rem;
  padding: 0.4rem 0.7rem; border: 0; border-bottom: 1px solid var(--rt-rule);
  background: var(--rt-surface-2); color: var(--rt-text-strong); font: inherit; font-weight: 700; cursor: pointer;
}
.encounter-workspace-shell__collapse--dock { position: absolute; z-index: 2; inset: 0 auto 0 0; width: 3.4rem; height: 100%; border-right: 1px solid var(--rt-rule); border-bottom: 0; flex-direction: column; justify-content: center; padding: 0.25rem; }
.encounter-workspace-shell--roster-collapsed .encounter-workspace-shell__collapse,
.encounter-workspace-shell--events-collapsed .encounter-workspace-shell__collapse { height: 100%; align-items: center; flex-direction: column; justify-content: flex-start; }
.encounter-workspace-shell--roster-collapsed .encounter-workspace-shell__collapse-label,
.encounter-workspace-shell--events-collapsed .encounter-workspace-shell__collapse-label { writing-mode: vertical-rl; }
.encounter-workspace-shell__collapse--dock .encounter-workspace-shell__collapse-label { font-size: var(--rt-type-meta-xs-size); writing-mode: vertical-rl; }
.encounter-workspace-shell__separator { position: relative; z-index: 3; background: var(--rt-bg-world); touch-action: none; }
.encounter-workspace-shell__separator::after { content: ''; position: absolute; inset: 35% 1px; border-radius: 999px; background: var(--rt-rule); }
.encounter-workspace-shell__separator:hover::after,
.encounter-workspace-shell__separator:focus-visible::after { background: var(--rt-focus); }
.encounter-workspace-shell__separator--roster,
.encounter-workspace-shell__separator--events { cursor: col-resize; }
.encounter-workspace-shell__separator--dock { cursor: row-resize; }
.encounter-workspace-shell__separator--dock::after { inset: 1px 42%; }
.encounter-workspace-shell__separator:focus-visible { outline: 2px solid var(--rt-focus); outline-offset: -2px; }

@media (min-width: 62.001rem) and (max-width: 90rem) {
  .encounter-workspace-shell__body {
    grid-template-columns: min(var(--encounter-roster-width), 23vw) 5px minmax(18rem, 1fr) 5px min(var(--encounter-event-width), 27vw);
  }
  .encounter-workspace-shell--roster-collapsed .encounter-workspace-shell__body { grid-template-columns: 3.4rem minmax(18rem, 1fr) 5px min(var(--encounter-event-width), 27vw); }
  .encounter-workspace-shell--events-collapsed .encounter-workspace-shell__body { grid-template-columns: min(var(--encounter-roster-width), 23vw) 5px minmax(18rem, 1fr) 3.4rem; }
}

@media (max-width: 62rem) {
  .encounter-workspace-shell { height: auto; min-height: 100dvh; overflow: visible; grid-template-rows: auto auto 0 auto; }
  .encounter-workspace-shell__body,
  .encounter-workspace-shell--roster-collapsed .encounter-workspace-shell__body,
  .encounter-workspace-shell--events-collapsed .encounter-workspace-shell__body,
  .encounter-workspace-shell--roster-collapsed.encounter-workspace-shell--events-collapsed .encounter-workspace-shell__body {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    grid-template-rows: minmax(26rem, auto) auto;
  }
  .encounter-workspace-shell__stage { grid-column: 1 / -1; grid-row: 1; min-height: 26rem; }
  .encounter-workspace-shell__roster { grid-column: 1; grid-row: 2; border: 0; border-top: 1px solid var(--rt-rule); border-right: 1px solid var(--rt-rule); }
  .encounter-workspace-shell__events { grid-column: 2; grid-row: 2; border: 0; border-top: 1px solid var(--rt-rule); }
  .encounter-workspace-shell__region-content { height: auto; max-height: 24rem; }
  .encounter-workspace-shell__separator { display: none; }
  .encounter-workspace-shell__dock { min-height: 3.4rem; max-height: none; }
  .encounter-workspace-shell__dock-content { height: auto; min-height: 11rem; max-height: var(--encounter-dock-height); }
}

@media (max-width: 48rem) {
  .encounter-workspace-shell { grid-template-rows: auto auto minmax(24rem, auto) 0 auto; }
  .encounter-workspace-shell__mobile-tabs {
    display: grid;
    position: sticky;
    z-index: 4;
    top: 0;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    border-bottom: 1px solid var(--rt-rule);
    background: var(--rt-surface-1);
  }
  .encounter-workspace-shell__mobile-tabs button {
    min-width: 0;
    min-height: var(--rt-touch-minimum);
    padding: .45rem .3rem;
    border: 0;
    border-right: 1px solid var(--rt-rule);
    background: var(--rt-surface-2);
    color: var(--rt-text);
    font: inherit;
    font-size: var(--rt-type-label-sm-size);
    font-weight: 700;
  }
  .encounter-workspace-shell__mobile-tabs button[aria-current='page'] { box-shadow: inset 0 -3px var(--rt-focus); color: var(--rt-text-strong); }
  .encounter-workspace-shell__body,
  .encounter-workspace-shell--roster-collapsed .encounter-workspace-shell__body,
  .encounter-workspace-shell--events-collapsed .encounter-workspace-shell__body,
  .encounter-workspace-shell--roster-collapsed.encounter-workspace-shell--events-collapsed .encounter-workspace-shell__body {
    display: block;
    min-height: 24rem;
  }
  .encounter-workspace-shell__body > .encounter-workspace-shell__stage,
  .encounter-workspace-shell__body > .encounter-workspace-shell__roster,
  .encounter-workspace-shell__body > .encounter-workspace-shell__events { display: none; min-height: 24rem; border: 0; }
  .encounter-workspace-shell__body[data-mobile-panel='stage'] > .encounter-workspace-shell__stage,
  .encounter-workspace-shell__body[data-mobile-panel='roster'] > .encounter-workspace-shell__roster,
  .encounter-workspace-shell__body[data-mobile-panel='events'] > .encounter-workspace-shell__events { display: block; }
  .encounter-workspace-shell__region-content { max-height: none; }
  .encounter-workspace-shell__dock { position: sticky; z-index: 5; bottom: 0; box-shadow: 0 -10px 30px rgb(0 0 0 / 35%); }
  .encounter-workspace-shell__dock-content { max-height: min(58dvh, var(--encounter-dock-height)); overflow: auto; }
}

@media (min-width: 90rem) {
  .encounter-workspace-shell--table-display .encounter-workspace-shell__body { grid-template-columns: min(24rem, var(--encounter-roster-width)) 5px minmax(36rem, 1fr) 5px min(28rem, var(--encounter-event-width)); }
}
</style>

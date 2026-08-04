<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import type { EncounterWorkspacePreferences } from '#shared/encounterWorkspace/preferences'

const props = defineProps<{
  open: boolean
  preferences: EncounterWorkspacePreferences
}>()
const emit = defineEmits<{
  close: []
  reset: []
  update: [patch: Partial<Omit<EncounterWorkspacePreferences, 'schemaVersion'>>]
}>()

const panel = ref<HTMLElement | null>(null)
const heading = ref<HTMLElement | null>(null)
const focusableSelector = 'button:not(:disabled), select:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'

const updateValue = <TKey extends keyof Omit<EncounterWorkspacePreferences, 'schemaVersion'>>(
  key: TKey,
  event: Event,
): void => {
  const target = event.target as HTMLInputElement | HTMLSelectElement
  const value = target.type === 'checkbox' ? target.checked : target.value
  emit('update', { [key]: value } as Partial<Omit<EncounterWorkspacePreferences, 'schemaVersion'>>)
}

const handleKeydown = (event: KeyboardEvent): void => {
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('close')
    return
  }
  if (event.key !== 'Tab' || !panel.value) return
  const focusable = [...panel.value.querySelectorAll<HTMLElement>(focusableSelector)]
    .filter(element => !element.hidden && element.getAttribute('aria-hidden') !== 'true')
  if (focusable.length === 0) return
  const first = focusable[0]!
  const last = focusable.at(-1)!
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  }
  else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

watch(() => props.open, async (open) => {
  if (!open) return
  await nextTick()
  heading.value?.focus({ preventScroll: true })
})
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="encounter-display-settings__backdrop" @pointerdown.self="emit('close')">
      <section
        ref="panel"
        class="encounter-display-settings rt-design-system rt-surface"
        role="dialog"
        aria-modal="true"
        aria-labelledby="encounter-display-settings-heading"
        data-rt-design-system="1"
        data-rt-context="live-encounter"
        @keydown="handleKeydown"
      >
        <header>
          <div>
            <p>Local presentation</p>
            <h2 id="encounter-display-settings-heading" ref="heading" tabindex="-1">Encounter display</h2>
          </div>
          <button type="button" aria-label="Close encounter display settings" @click="emit('close')">×</button>
        </header>
        <p class="encounter-display-settings__privacy">
          These settings stay in this browser. They never store maps, sheets, choices, commands, or authority data.
        </p>
        <div class="encounter-display-settings__grid">
          <label>
            <span>Layout</span>
            <select :value="preferences.layout" @change="updateValue('layout', $event)">
              <option value="auto">Automatic for this screen</option>
              <option value="table-display">Table display</option>
            </select>
          </label>
          <label>
            <span>Density</span>
            <select :value="preferences.density" @change="updateValue('density', $event)">
              <option value="comfortable">Comfortable</option>
              <option value="standard">Standard</option>
              <option value="compact">Compact</option>
            </select>
          </label>
          <label>
            <span>Text size</span>
            <select :value="preferences.textSize" @change="updateValue('textSize', $event)">
              <option value="standard">Standard</option>
              <option value="large">Large</option>
              <option value="table-distance">Table distance</option>
            </select>
          </label>
          <label>
            <span>Colour-vision palette</span>
            <select :value="preferences.colorVision" @change="updateValue('colorVision', $event)">
              <option value="default">Default</option>
              <option value="deuteranopia">Deuteranopia</option>
              <option value="protanopia">Protanopia</option>
              <option value="tritanopia">Tritanopia</option>
            </select>
          </label>
          <label>
            <span>Contrast</span>
            <select :value="preferences.contrast" @change="updateValue('contrast', $event)">
              <option value="standard">Standard</option>
              <option value="high">High contrast</option>
            </select>
          </label>
          <label>
            <span>Motion</span>
            <select :value="preferences.motion" @change="updateValue('motion', $event)">
              <option value="system">Follow device</option>
              <option value="reduced">Reduced</option>
              <option value="full">Full finite motion</option>
            </select>
          </label>
          <label class="encounter-display-settings__check">
            <input
              type="checkbox"
              :checked="preferences.autoOpenExactTacticalChoices"
              @change="updateValue('autoOpenExactTacticalChoices', $event)"
            >
            <span>Open exact tactical choices automatically</span>
          </label>
        </div>
        <footer>
          <button type="button" @click="emit('reset')">Restore display defaults</button>
          <button type="button" class="encounter-display-settings__done" @click="emit('close')">Done</button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.encounter-display-settings__backdrop {
  position: fixed;
  z-index: var(--rt-layer-modal);
  inset: 0;
  display: grid;
  place-items: center;
  padding: 1rem;
  background: rgb(0 0 0 / 72%);
}
.encounter-display-settings {
  width: min(44rem, 100%);
  max-height: min(90dvh, 52rem);
  overflow: auto;
  padding: 1rem;
  background: var(--rt-surface-1);
}
.encounter-display-settings > header { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; }
.encounter-display-settings > header p { margin: 0; color: var(--rt-info); font-size: var(--rt-type-label-sm-size); font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
.encounter-display-settings h2 { margin: .15rem 0 0; color: var(--rt-text-strong); font-size: var(--rt-type-heading-md-size); }
.encounter-display-settings button,
.encounter-display-settings select,
.encounter-display-settings input { font: inherit; }
.encounter-display-settings > header button { width: var(--rt-touch-minimum); height: var(--rt-touch-minimum); border: 1px solid var(--rt-rule); border-radius: var(--rt-radius-small); background: var(--rt-surface-2); color: var(--rt-text-strong); font-size: 1.25rem; }
.encounter-display-settings__privacy { color: var(--rt-text-muted); }
.encounter-display-settings__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .75rem; }
.encounter-display-settings__grid label { display: grid; gap: .25rem; color: var(--rt-text-muted); font-size: var(--rt-type-label-sm-size); }
.encounter-display-settings__grid select { width: 100%; min-height: var(--rt-touch-minimum); padding: .5rem; border: 1px solid var(--rt-rule); border-radius: var(--rt-radius-small); background: var(--rt-bg-canvas); color: var(--rt-text); }
.encounter-display-settings__check { grid-column: 1 / -1; grid-template-columns: auto minmax(0, 1fr); align-items: center; min-height: var(--rt-touch-minimum); }
.encounter-display-settings__check input { width: 1.35rem; height: 1.35rem; }
.encounter-display-settings > footer { display: flex; justify-content: flex-end; gap: .5rem; margin-top: 1rem; padding-top: 1rem; border-top: 1px solid var(--rt-rule); }
.encounter-display-settings > footer button { min-height: var(--rt-touch-minimum); padding: .5rem .75rem; border: 1px solid var(--rt-rule); border-radius: var(--rt-radius-small); background: var(--rt-surface-2); color: var(--rt-text-strong); font-weight: 700; }
.encounter-display-settings > footer .encounter-display-settings__done { border-color: var(--rt-focus); }
@media (max-width: 36rem) {
  .encounter-display-settings__backdrop { align-items: end; padding: 0; }
  .encounter-display-settings { width: 100%; max-height: 92dvh; border-radius: var(--rt-radius-medium) var(--rt-radius-medium) 0 0 !important; }
  .encounter-display-settings__grid { grid-template-columns: 1fr; }
  .encounter-display-settings__check { grid-column: 1; }
}
</style>

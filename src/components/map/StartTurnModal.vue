<script setup lang="ts">
import { PhX } from '@phosphor-icons/vue'
import { computed, onMounted, ref } from 'vue'
import ConditionTag from '~/components/ConditionTag.vue'
import { conditionDisplayName, conditionTitle } from '~/utils/statusConditions'
import type { StartTurnModalConditionViewModel } from '~/composables/map-editor/useStartTurnModal'

const props = withDefaults(defineProps<{
  characterName: string
  characterMeta?: string | null
  profileUrl?: string | null
  accentColor?: string | null
  round: number
  canManage: boolean
  busy?: boolean
  conditions?: readonly StartTurnModalConditionViewModel[]
}>(), {
  characterMeta: null,
  profileUrl: null,
  accentColor: null,
  busy: false,
  conditions: () => [],
})

const emit = defineEmits<{
  (event: 'close'): void
  (event: 'roll-condition', conditionId: string): void
  (event: 'skip-condition', conditionId: string): void
  (event: 'remove-condition', conditionId: string): void
}>()

const dialogRef = ref<HTMLElement | null>(null)

const accentStyle = computed(() => (
  props.accentColor ? { '--start-turn-accent': props.accentColor } : {}
))

const hasPendingConditions = computed(() => props.conditions.some((condition) => condition.result === null))

const close = () => {
  if (!props.canManage || props.busy) return
  emit('close')
}

const emitConditionAction = (
  event: 'roll-condition' | 'skip-condition' | 'remove-condition',
  conditionId: string,
) => {
  if (!props.canManage || props.busy) return
  if (event === 'roll-condition') emit('roll-condition', conditionId)
  else if (event === 'skip-condition') emit('skip-condition', conditionId)
  else emit('remove-condition', conditionId)
}

const resultText = (condition: StartTurnModalConditionViewModel): string => {
  const result = condition.result
  if (!result) return props.canManage ? 'No result yet.' : 'Waiting for GM result.'
  if (result.resolution === 'skip') return 'Skipped.'
  if (result.resolution === 'remove') return 'Removed from the character.'

  const rollText = `Rolled ${result.roll ?? '—'}`
  if (result.dc === null) return `${rollText}.`
  return `${rollText} vs DC ${result.dc} · ${result.success ? 'Success' : 'Failure'}.`
}

onMounted(() => {
  dialogRef.value?.focus()
})
</script>

<template>
  <div
    class="start-turn-modal-backdrop"
    role="presentation"
    @pointerdown.self="close"
  >
    <section
      ref="dialogRef"
      class="start-turn-modal"
      :style="accentStyle"
      role="dialog"
      aria-modal="true"
      aria-labelledby="start-turn-modal-title"
      aria-describedby="start-turn-modal-description"
      tabindex="-1"
      @pointerdown.stop
    >
      <header class="start-turn-modal__header">
        <div class="start-turn-modal__identity">
          <span v-if="profileUrl" class="start-turn-modal__portrait" aria-hidden="true">
            <img :src="profileUrl" alt="" draggable="false">
          </span>
          <span v-else class="start-turn-modal__portrait start-turn-modal__portrait--fallback" aria-hidden="true">
            {{ characterName.slice(0, 1).toUpperCase() }}
          </span>

          <span class="start-turn-modal__title-group">
            <span class="start-turn-modal__eyebrow">Start of turn · Round {{ round }}</span>
            <h2 id="start-turn-modal-title" class="start-turn-modal__title">
              {{ characterName }}'s turn
            </h2>
            <span v-if="characterMeta" class="start-turn-modal__meta">{{ characterMeta }}</span>
          </span>
        </div>

        <button
          v-if="canManage"
          type="button"
          class="start-turn-modal__close"
          aria-label="Close start-of-turn modal"
          :disabled="busy"
          @click="close"
        >
          <PhX :size="18" weight="bold" aria-hidden="true" />
        </button>
      </header>

      <div id="start-turn-modal-description" class="start-turn-modal__body">
        <div v-if="conditions.length" class="start-turn-modal__condition-list" aria-label="Start-of-turn conditions">
          <article
            v-for="condition in conditions"
            :key="condition.id"
            class="start-turn-modal__condition"
            :data-resolution="condition.result?.resolution ?? 'pending'"
          >
            <div class="start-turn-modal__condition-main">
              <ConditionTag :name="condition.condition" size="sm" />
              <span class="start-turn-modal__condition-copy">
                <span class="start-turn-modal__condition-name" :title="conditionTitle(condition.condition)">
                  {{ conditionDisplayName(condition.condition) }}
                </span>
                <span class="start-turn-modal__condition-result">{{ resultText(condition) }}</span>
              </span>
            </div>

            <div v-if="canManage && condition.present" class="start-turn-modal__condition-actions" aria-label="Condition actions">
              <button
                type="button"
                class="start-turn-modal__condition-button"
                :disabled="busy"
                @click="emitConditionAction('roll-condition', condition.id)"
              >Roll</button>
              <button
                type="button"
                class="start-turn-modal__condition-button"
                :disabled="busy"
                @click="emitConditionAction('skip-condition', condition.id)"
              >Skip</button>
              <button
                type="button"
                class="start-turn-modal__condition-button start-turn-modal__condition-button--danger"
                :disabled="busy"
                @click="emitConditionAction('remove-condition', condition.id)"
              >Remove</button>
            </div>
          </article>
        </div>
        <p v-else class="start-turn-modal__empty">No conditions to resolve at the start of this turn.</p>
        <p v-if="!canManage && conditions.length" class="start-turn-modal__sync-note">
          {{ hasPendingConditions ? 'Waiting for the GM to resolve this start-of-turn step.' : 'GM results will stay visible here.' }}
        </p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.start-turn-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 52;
  display: grid;
  place-items: center;
  padding: clamp(0.75rem, 2vw, 1.5rem);
  background:
    radial-gradient(circle at top, color-mix(in srgb, var(--start-turn-accent, var(--accent)) 22%, transparent), transparent 42%),
    rgba(5, 6, 8, 0.62);
  backdrop-filter: blur(4px) saturate(125%);
  -webkit-backdrop-filter: blur(4px) saturate(125%);
}

.start-turn-modal {
  --start-turn-accent: var(--accent);

  width: min(620px, 100%);
  display: grid;
  gap: 1rem;
  border: 1px solid color-mix(in srgb, var(--start-turn-accent) 62%, var(--rule-soft));
  border-radius: 22px;
  background:
    linear-gradient(
      135deg,
      color-mix(in srgb, var(--start-turn-accent) 13%, transparent) 0 24%,
      transparent 24% 100%
    ),
    color-mix(in srgb, var(--paper-soft) 90%, transparent);
  box-shadow:
    var(--shadow-card),
    inset 0 1px 0 color-mix(in srgb, var(--ink-bright) 10%, transparent);
  color: var(--ink);
  padding: clamp(1rem, 2vw, 1.2rem);
  backdrop-filter: blur(14px) saturate(140%);
  -webkit-backdrop-filter: blur(14px) saturate(140%);
}

.start-turn-modal:focus {
  outline: none;
}

.start-turn-modal__header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.85rem;
  align-items: start;
}

.start-turn-modal__identity {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 0.8rem;
}

.start-turn-modal__portrait {
  display: inline-grid;
  width: 3.4rem;
  height: 3.4rem;
  flex: 0 0 auto;
  place-items: center;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--start-turn-accent) 65%, var(--rule-soft));
  border-radius: 18px;
  background: color-mix(in srgb, var(--start-turn-accent) 16%, var(--paper-inset));
  color: var(--start-turn-accent);
  font-family: var(--font-book);
  font-size: 1.55rem;
  font-weight: 800;
}

.start-turn-modal__portrait img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.start-turn-modal__title-group {
  display: grid;
  min-width: 0;
  gap: 0.18rem;
}

.start-turn-modal__eyebrow,
.start-turn-modal__meta,
.start-turn-modal__sync-note,
.start-turn-modal__condition-result {
  color: var(--ink-muted);
  font-size: 0.82rem;
}

.start-turn-modal__eyebrow {
  color: var(--start-turn-accent);
  font-weight: 900;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.start-turn-modal__title {
  margin: 0;
  color: var(--ink-bright);
  font-family: var(--font-book);
  font-size: clamp(1.35rem, 2.6vw, 1.85rem);
  letter-spacing: 0.04em;
}

.start-turn-modal__close {
  display: inline-grid;
  width: 2rem;
  height: 2rem;
  place-items: center;
  border: 1px solid var(--rule-soft);
  border-radius: 999px;
  background: var(--paper);
  color: var(--ink-bright);
  cursor: pointer;
  font: inherit;
  line-height: 1;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.start-turn-modal__close:hover,
.start-turn-modal__close:focus-visible {
  border-color: color-mix(in srgb, var(--start-turn-accent) 72%, var(--rule-strong));
  background: var(--paper-hover);
  color: var(--start-turn-accent);
}

.start-turn-modal__close:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--start-turn-accent) 36%, transparent);
  outline-offset: 3px;
}

.start-turn-modal__close:disabled {
  cursor: wait;
  opacity: 0.58;
}

.start-turn-modal__body {
  display: grid;
  gap: 0.65rem;
  min-height: 7rem;
  border: 1px dashed color-mix(in srgb, var(--start-turn-accent) 35%, var(--rule-soft));
  border-radius: 16px;
  background: color-mix(in srgb, var(--paper-inset) 74%, transparent);
  padding: 1rem;
}

.start-turn-modal__condition-list {
  display: grid;
  gap: 0.7rem;
}

.start-turn-modal__condition {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.8rem;
  align-items: center;
  border: 1px solid color-mix(in srgb, var(--start-turn-accent) 28%, var(--rule-soft));
  border-radius: 14px;
  background: color-mix(in srgb, var(--paper) 76%, transparent);
  padding: 0.72rem;
}

.start-turn-modal__condition[data-resolution='roll'] {
  border-color: color-mix(in srgb, var(--start-turn-accent) 55%, var(--rule-soft));
}

.start-turn-modal__condition[data-resolution='remove'] {
  opacity: 0.82;
}

.start-turn-modal__condition-main {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 0.65rem;
}

.start-turn-modal__condition-copy {
  display: grid;
  min-width: 0;
  gap: 0.16rem;
}

.start-turn-modal__condition-name {
  overflow: hidden;
  color: var(--ink-bright);
  font-weight: 900;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.start-turn-modal__condition-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.4rem;
}

.start-turn-modal__condition-button {
  border: 1px solid color-mix(in srgb, var(--start-turn-accent) 38%, var(--rule-soft));
  border-radius: 999px;
  background: color-mix(in srgb, var(--paper) 86%, transparent);
  color: var(--ink-bright);
  cursor: pointer;
  font: inherit;
  font-size: 0.78rem;
  font-weight: 900;
  padding: 0.38rem 0.66rem;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease, opacity 0.15s ease;
}

.start-turn-modal__condition-button:hover,
.start-turn-modal__condition-button:focus-visible {
  border-color: color-mix(in srgb, var(--start-turn-accent) 76%, var(--rule-strong));
  background: var(--paper-hover);
  color: var(--start-turn-accent);
}

.start-turn-modal__condition-button:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--start-turn-accent) 32%, transparent);
  outline-offset: 2px;
}

.start-turn-modal__condition-button--danger:hover,
.start-turn-modal__condition-button--danger:focus-visible {
  border-color: color-mix(in srgb, #ff6b6b 74%, var(--rule-strong));
  color: #ff9c9c;
}

.start-turn-modal__condition-button:disabled {
  cursor: wait;
  opacity: 0.58;
}

.start-turn-modal__empty,
.start-turn-modal__sync-note {
  margin: 0;
}

.start-turn-modal__empty {
  color: var(--ink);
  font-weight: 700;
}

@media (max-width: 560px) {
  .start-turn-modal__condition {
    grid-template-columns: 1fr;
  }

  .start-turn-modal__condition-actions {
    justify-content: flex-start;
  }
}
</style>

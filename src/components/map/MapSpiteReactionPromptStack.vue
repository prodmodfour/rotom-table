<script setup lang="ts">
import type { MoveAutomationSpitePrompt } from '~/types/moveAutomation'

const props = defineProps<{
  prompts: MoveAutomationSpitePrompt[]
}>()

const emit = defineEmits<{
  (event: 'apply', id: string): void
  (event: 'dismiss', id: string): void
}>()
</script>

<template>
  <div v-if="props.prompts.length" class="spite-prompt-stack" aria-live="polite">
    <article
      v-for="prompt in props.prompts"
      :key="prompt.id"
      class="spite-prompt"
    >
      <div class="spite-prompt__copy">
        <span class="spite-prompt__eyebrow">Spite?</span>
        <strong>{{ prompt.defenderName }}</strong>
        <span>was hit by {{ prompt.moveName }}. Disable it for {{ prompt.attackerName }}?</span>
      </div>
      <div class="spite-prompt__actions">
        <button type="button" class="spite-prompt__apply" @click="emit('apply', prompt.id)">
          Disable {{ prompt.moveName }}
        </button>
        <button type="button" class="spite-prompt__dismiss" @click="emit('dismiss', prompt.id)">
          Ignore
        </button>
      </div>
    </article>
  </div>
</template>

<style scoped>
.spite-prompt-stack {
  position: absolute;
  z-index: 12;
  top: 1rem;
  right: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  width: min(22rem, calc(100vw - 2rem));
  pointer-events: none;
}

.spite-prompt {
  display: grid;
  gap: 0.65rem;
  padding: 0.78rem;
  border: 1px solid color-mix(in srgb, var(--accent) 58%, var(--rule-strong));
  border-radius: 14px;
  background: color-mix(in srgb, var(--paper) 94%, transparent);
  box-shadow: 0 18px 46px rgba(0, 0, 0, 0.35);
  color: var(--ink);
  pointer-events: auto;
}

.spite-prompt__copy {
  display: grid;
  gap: 0.12rem;
  min-width: 0;
  font-size: 0.82rem;
  line-height: 1.25;
}

.spite-prompt__copy strong,
.spite-prompt__eyebrow {
  color: var(--accent);
}

.spite-prompt__eyebrow {
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.spite-prompt__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}

.spite-prompt__apply,
.spite-prompt__dismiss {
  border: 1px solid var(--rule-strong);
  border-radius: 999px;
  background: var(--paper-accent);
  color: var(--ink);
  font: inherit;
  font-size: 0.78rem;
  font-weight: 800;
  padding: 0.4rem 0.68rem;
  cursor: pointer;
}

.spite-prompt__apply {
  border-color: color-mix(in srgb, var(--accent) 70%, var(--rule-strong));
  color: var(--accent);
}

.spite-prompt__apply:hover,
.spite-prompt__apply:focus-visible,
.spite-prompt__dismiss:hover,
.spite-prompt__dismiss:focus-visible {
  border-color: var(--accent);
  color: var(--accent);
}
</style>

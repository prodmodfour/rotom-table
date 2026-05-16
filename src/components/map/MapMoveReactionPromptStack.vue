<script setup lang="ts">
import type {
  MoveAutomationMoxiePrompt,
  MoveAutomationSpitePrompt,
} from '~/types/moveAutomation'

const props = defineProps<{
  spitePrompts: MoveAutomationSpitePrompt[]
  moxiePrompts?: MoveAutomationMoxiePrompt[]
}>()

const emit = defineEmits<{
  (event: 'apply', id: string): void
  (event: 'dismiss', id: string): void
  (event: 'apply-moxie', id: string): void
  (event: 'dismiss-moxie', id: string): void
}>()

const targetList = (prompt: MoveAutomationMoxiePrompt): string => {
  const names = prompt.faintedTargetNames
  if (names.length <= 2) return names.join(' and ')
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`
}
</script>

<template>
  <div v-if="props.spitePrompts.length || props.moxiePrompts?.length" class="reaction-prompt-stack" aria-live="polite">
    <article
      v-for="prompt in props.moxiePrompts ?? []"
      :key="prompt.id"
      class="reaction-prompt"
    >
      <div class="reaction-prompt__copy">
        <span class="reaction-prompt__eyebrow">Moxie?</span>
        <strong>{{ prompt.attackerName }}</strong>
        <span>{{ prompt.moveName }} fainted {{ targetList(prompt) }}. Raise Attack?</span>
      </div>
      <div class="reaction-prompt__actions">
        <button type="button" class="reaction-prompt__apply" @click="emit('apply-moxie', prompt.id)">
          Raise Attack
        </button>
        <button type="button" class="reaction-prompt__dismiss" @click="emit('dismiss-moxie', prompt.id)">
          Ignore
        </button>
      </div>
    </article>

    <article
      v-for="prompt in props.spitePrompts"
      :key="prompt.id"
      class="reaction-prompt"
    >
      <div class="reaction-prompt__copy">
        <span class="reaction-prompt__eyebrow">Spite?</span>
        <strong>{{ prompt.defenderName }}</strong>
        <span>was hit by {{ prompt.moveName }}. Disable it for {{ prompt.attackerName }}?</span>
      </div>
      <div class="reaction-prompt__actions">
        <button type="button" class="reaction-prompt__apply" @click="emit('apply', prompt.id)">
          Disable {{ prompt.moveName }}
        </button>
        <button type="button" class="reaction-prompt__dismiss" @click="emit('dismiss', prompt.id)">
          Ignore
        </button>
      </div>
    </article>
  </div>
</template>

<style scoped>
.reaction-prompt-stack {
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

.reaction-prompt {
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

.reaction-prompt__copy {
  display: grid;
  gap: 0.12rem;
  min-width: 0;
  font-size: 0.82rem;
  line-height: 1.25;
}

.reaction-prompt__copy strong,
.reaction-prompt__eyebrow {
  color: var(--accent);
}

.reaction-prompt__eyebrow {
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.reaction-prompt__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}

.reaction-prompt__apply,
.reaction-prompt__dismiss {
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

.reaction-prompt__apply {
  border-color: color-mix(in srgb, var(--accent) 70%, var(--rule-strong));
  color: var(--accent);
}

.reaction-prompt__apply:hover,
.reaction-prompt__apply:focus-visible,
.reaction-prompt__dismiss:hover,
.reaction-prompt__dismiss:focus-visible {
  border-color: var(--accent);
  color: var(--accent);
}
</style>

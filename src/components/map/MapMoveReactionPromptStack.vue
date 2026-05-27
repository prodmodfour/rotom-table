<script setup lang="ts">
import type {
  MoveAutomationCelebratePrompt,
  MoveAutomationCuteCharmPrompt,
  MoveAutomationMoxiePrompt,
  MoveAutomationPoisonPointPrompt,
  MoveAutomationSpitePrompt,
} from '~/types/moveAutomation'

const props = defineProps<{
  spitePrompts: MoveAutomationSpitePrompt[]
  cuteCharmPrompts?: MoveAutomationCuteCharmPrompt[]
  poisonPointPrompts?: MoveAutomationPoisonPointPrompt[]
  moxiePrompts?: MoveAutomationMoxiePrompt[]
  celebratePrompts?: MoveAutomationCelebratePrompt[]
}>()

const emit = defineEmits<{
  (event: 'apply', id: string): void
  (event: 'dismiss', id: string): void
  (event: 'apply-cute-charm', id: string): void
  (event: 'dismiss-cute-charm', id: string): void
  (event: 'apply-poison-point', id: string): void
  (event: 'dismiss-poison-point', id: string): void
  (event: 'apply-moxie', id: string): void
  (event: 'dismiss-moxie', id: string): void
  (event: 'apply-celebrate', id: string): void
  (event: 'dismiss-celebrate', id: string): void
}>()

const nameList = (names: readonly string[]): string => {
  if (names.length <= 2) return names.join(' and ')
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`
}

const moxieTargetList = (prompt: MoveAutomationMoxiePrompt): string => nameList(prompt.faintedTargetNames)
const celebrateTargetList = (prompt: MoveAutomationCelebratePrompt): string => nameList(prompt.hitTargetNames)
</script>

<template>
  <div v-if="props.spitePrompts.length || props.cuteCharmPrompts?.length || props.poisonPointPrompts?.length || props.moxiePrompts?.length || props.celebratePrompts?.length" class="reaction-prompt-stack" aria-live="polite">
    <article
      v-for="prompt in props.moxiePrompts ?? []"
      :key="prompt.id"
      class="reaction-prompt"
    >
      <div class="reaction-prompt__copy">
        <span class="reaction-prompt__eyebrow">Moxie?</span>
        <strong>{{ prompt.attackerName }}</strong>
        <span>{{ prompt.moveName }} fainted {{ moxieTargetList(prompt) }}. Raise Attack?</span>
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
      v-for="prompt in props.celebratePrompts ?? []"
      :key="prompt.id"
      class="reaction-prompt"
    >
      <div class="reaction-prompt__copy">
        <span class="reaction-prompt__eyebrow">Celebrate?</span>
        <strong>{{ prompt.attackerName }}</strong>
        <span>{{ prompt.moveName }} hit {{ celebrateTargetList(prompt) }}. Disengage 1 meter as a Free Action?</span>
      </div>
      <div class="reaction-prompt__actions">
        <button type="button" class="reaction-prompt__apply" @click="emit('apply-celebrate', prompt.id)">
          Use Celebrate
        </button>
        <button type="button" class="reaction-prompt__dismiss" @click="emit('dismiss-celebrate', prompt.id)">
          Ignore
        </button>
      </div>
    </article>

    <article
      v-for="prompt in props.cuteCharmPrompts ?? []"
      :key="prompt.id"
      class="reaction-prompt"
    >
      <div class="reaction-prompt__copy">
        <span class="reaction-prompt__eyebrow">Cute Charm?</span>
        <strong>{{ prompt.defenderName }}</strong>
        <span>was attacked by {{ prompt.attackerName }}'s {{ prompt.moveName }}. Infatuate {{ prompt.attackerName }}?</span>
      </div>
      <div class="reaction-prompt__actions">
        <button type="button" class="reaction-prompt__apply" @click="emit('apply-cute-charm', prompt.id)">
          Infatuate {{ prompt.attackerName }}
        </button>
        <button type="button" class="reaction-prompt__dismiss" @click="emit('dismiss-cute-charm', prompt.id)">
          Ignore
        </button>
      </div>
    </article>

    <article
      v-for="prompt in props.poisonPointPrompts ?? []"
      :key="prompt.id"
      class="reaction-prompt"
    >
      <div class="reaction-prompt__copy">
        <span class="reaction-prompt__eyebrow">Poison Point?</span>
        <strong>{{ prompt.defenderName }}</strong>
        <span>was hit by {{ prompt.attackerName }}'s {{ prompt.moveName }}. Poison {{ prompt.attackerName }}?</span>
      </div>
      <div class="reaction-prompt__actions">
        <button type="button" class="reaction-prompt__apply" @click="emit('apply-poison-point', prompt.id)">
          Poison {{ prompt.attackerName }}
        </button>
        <button type="button" class="reaction-prompt__dismiss" @click="emit('dismiss-poison-point', prompt.id)">
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
  top: var(--map-top-info-top, calc(var(--map-overlay-gutter, 0.75rem) + var(--map-initiative-info-bar-height, 4rem) + 0.6rem));
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

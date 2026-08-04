<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'
import type { EncounterDecisionSummary } from '#shared/encounterWorkspace/primitives'

const props = withDefaults(defineProps<{
  decision: EncounterDecisionSummary
  active?: boolean
  focusOnActivate?: boolean
}>(), {
  active: true,
  focusOnActivate: true,
})

const emit = defineEmits<{
  choose: [decisionId: string, optionId: string]
  pass: [decisionId: string]
  cancel: [decisionId: string]
}>()

const heading = ref<HTMLElement | null>(null)

const focusDecision = async (): Promise<void> => {
  if (!props.active || !props.focusOnActivate) return
  await nextTick()
  heading.value?.focus({ preventScroll: true })
}

onMounted(focusDecision)
watch(() => [props.decision.id, props.active] as const, focusDecision)
</script>

<template>
  <section
    class="encounter-decision rt-surface rt-surface--notched rt-signal-spine"
    :data-rt-state="decision.state ?? 'pending'"
    :aria-labelledby="`decision-heading-${decision.id}`"
    :aria-describedby="`decision-prompt-${decision.id}`"
    :aria-busy="active ? 'false' : undefined"
    data-rt-layer="decision"
    data-rt-elevation="3"
    style="--rt-signal: var(--rt-pending)"
  >
    <header class="encounter-decision__header">
      <span class="encounter-decision__owner rt-type-label-sm">{{ decision.ownerLabel }}</span>
      <h2
        :id="`decision-heading-${decision.id}`"
        ref="heading"
        class="rt-type-heading-md"
        tabindex="-1"
      >
        {{ decision.headline }}
      </h2>
      <p :id="`decision-prompt-${decision.id}`" class="rt-type-body-md">{{ decision.prompt }}</p>
      <span v-if="decision.timingLabel" class="encounter-decision__timing rt-state-label">
        {{ decision.timingLabel }}
      </span>
    </header>

    <p v-if="decision.publicSummary" class="encounter-decision__public rt-type-body-sm">
      <strong>Others see:</strong> {{ decision.publicSummary }}
    </p>

    <div class="encounter-decision__options" role="group" :aria-label="`${decision.headline} options`">
      <button
        v-for="option in decision.options"
        :key="option.id"
        type="button"
        class="encounter-decision__option rt-control"
        :class="{ 'encounter-decision__option--selected': option.selected }"
        :disabled="option.disabled"
        :aria-pressed="option.selected || false"
        @click="emit('choose', decision.id, option.id)"
      >
        <span class="encounter-decision__option-copy">
          <strong>{{ option.label }}</strong>
          <span v-if="option.description" class="rt-type-body-sm">{{ option.description }}</span>
          <span v-if="option.disabled" class="encounter-decision__disabled-reason">
            {{ option.disabledReason || 'This option is not available.' }}
          </span>
        </span>
      </button>
    </div>

    <footer v-if="decision.canPass || decision.canCancel" class="encounter-decision__footer">
      <button v-if="decision.canPass" type="button" class="rt-control" @click="emit('pass', decision.id)">
        Pass
      </button>
      <button v-if="decision.canCancel" type="button" class="rt-control" @click="emit('cancel', decision.id)">
        Cancel
      </button>
    </footer>
  </section>
</template>

<style scoped>
.encounter-decision {
  display: grid;
  gap: var(--rt-space-4);
  padding: var(--rt-card-padding) var(--rt-card-padding) var(--rt-card-padding) calc(var(--rt-card-padding) + var(--rt-space-1));
}

.encounter-decision__header,
.encounter-decision__option-copy {
  display: grid;
  gap: var(--rt-space-1);
}

.encounter-decision__header h2:focus {
  outline: none;
}

.encounter-decision__owner,
.encounter-decision__timing {
  color: var(--rt-pending);
}

.encounter-decision__header p,
.encounter-decision__public {
  margin: 0;
}

.encounter-decision__public {
  padding: var(--rt-space-2) var(--rt-space-3);
  border-left: var(--rt-border-strong) solid var(--rt-pending);
  background: var(--rt-surface-2);
}

.encounter-decision__options {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 13rem), 1fr));
  gap: var(--rt-space-2);
}

.encounter-decision__option {
  height: auto;
  min-height: var(--rt-touch-minimum);
  justify-content: flex-start;
  text-align: left;
}

.encounter-decision__option--selected {
  border-color: var(--rt-focus);
  background: color-mix(in srgb, var(--rt-surface-2) 86%, var(--rt-focus));
  box-shadow: inset 0 0 0 1px var(--rt-focus);
}

.encounter-decision__disabled-reason {
  color: var(--rt-text-muted);
  font-size: var(--rt-type-meta-xs-size);
  font-weight: 400;
  line-height: var(--rt-type-meta-xs-line);
}

.encounter-decision__footer {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--rt-space-2);
  padding-top: var(--rt-space-3);
  border-top: var(--rt-border-hairline) solid var(--rt-rule);
}
</style>

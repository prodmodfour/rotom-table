<script setup lang="ts">
import { computed } from 'vue'
import type { EncounterPendingInteractionView, EncounterPendingRecoveryAction } from '#shared/encounterPresentation/contracts'

const props = withDefaults(defineProps<{
  pending: readonly EncounterPendingInteractionView[]
  primaryInteractionId: string | null
  activeInteractionId: string | null
  busyInteractionId?: string | null
  guidedItemHref?: string | null
}>(), {
  busyInteractionId: null,
  guidedItemHref: null,
})
const emit = defineEmits<{
  open: [interactionId: string]
  pass: [interactionId: string]
  cancel: [interactionId: string]
  recover: [interactionId: string, action: EncounterPendingRecoveryAction['action']]
}>()
const ordered = computed(() => [...props.pending].sort((left, right) => (
  (left.status === 'pending' ? 0 : left.status === 'resuming' ? 1 : 2)
  - (right.status === 'pending' ? 0 : right.status === 'resuming' ? 1 : 2)
  || (left.expiresAt ?? Number.MAX_SAFE_INTEGER) - (right.expiresAt ?? Number.MAX_SAFE_INTEGER)
  || left.interactionId.localeCompare(right.interactionId)
)))
</script>

<template>
  <section class="encounter-resolution-stack" aria-labelledby="encounter-resolution-heading">
    <header id="encounter-resolution-heading" data-encounter-focus="decision-heading" tabindex="-1">
      <p>Resolution stack</p>
      <h2>{{ pending.length ? `${pending.length} ${pending.length === 1 ? 'decision' : 'decisions'}` : 'No pending decisions' }}</h2>
    </header>
    <ol v-if="ordered.length">
      <li
        v-for="(interaction, index) in ordered"
        :id="`decision-${interaction.interactionId}`"
        :key="interaction.interactionId"
        :data-primary="primaryInteractionId === interaction.interactionId"
        :data-active="activeInteractionId === interaction.interactionId"
      >
        <div v-if="interaction.projection === 'public'" class="encounter-resolution-stack__open encounter-resolution-stack__open--status">
          <span class="encounter-resolution-stack__order rt-numeric">{{ index + 1 }}</span>
          <span>
            <strong>{{ interaction.prompt }}</strong>
            <small>{{ interaction.status }} · {{ interaction.outstandingChoiceCount }} outstanding</small>
          </span>
          <span v-if="primaryInteractionId === interaction.interactionId" class="encounter-resolution-stack__primary">Waiting</span>
        </div>
        <button v-else type="button" class="encounter-resolution-stack__open" @click="emit('open', interaction.interactionId)">
          <span class="encounter-resolution-stack__order rt-numeric">{{ index + 1 }}</span>
          <span>
            <strong>{{ interaction.prompt }}</strong>
            <small>{{ interaction.status }} · {{ interaction.choices.length }} choice groups</small>
          </span>
          <span v-if="primaryInteractionId === interaction.interactionId" class="encounter-resolution-stack__primary">Now</span>
        </button>
        <div v-if="interaction.projection !== 'public'" class="encounter-resolution-stack__actions">
          <button v-if="interaction.allowPass" type="button" :disabled="busyInteractionId === interaction.interactionId" @click="emit('pass', interaction.interactionId)">Pass</button>
          <button v-if="interaction.allowCancel" type="button" :disabled="busyInteractionId === interaction.interactionId" @click="emit('cancel', interaction.interactionId)">Cancel</button>
          <button
            v-for="recovery in interaction.recoveryActions"
            :key="recovery.actionId"
            type="button"
            :disabled="!recovery.enabled || busyInteractionId === interaction.interactionId"
            :title="recovery.unavailableReason?.label"
            @click="emit('recover', interaction.interactionId, recovery.action)"
          >{{ recovery.label }}</button>
        </div>
        <p v-else>
          Waiting for an authorized responder. Private options are not present in this view.
          <NuxtLink v-if="guidedItemHref && interaction.source?.sourceKind === 'item'" :to="guidedItemHref">Open guided adjudication</NuxtLink>
        </p>
      </li>
    </ol>
    <p v-else class="encounter-resolution-stack__empty">Interrupts, Reactions, choices, and adjudications will appear here in authoritative order.</p>
  </section>
</template>

<style scoped>
.encounter-resolution-stack > header p { margin: 0; color: var(--rt-pending); font-size: var(--rt-type-label-sm-size); font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; }
.encounter-resolution-stack h2 { margin: 0; color: var(--rt-text-strong); font-size: var(--rt-type-heading-md-size); }
.encounter-resolution-stack ol { display: grid; gap: 0.55rem; margin: 0.75rem 0; padding: 0; list-style: none; }
.encounter-resolution-stack li { overflow: hidden; border: 1px solid var(--rt-rule); border-radius: var(--rt-radius-medium); background: var(--rt-surface-1); }
.encounter-resolution-stack li[data-primary='true'] { border-color: var(--rt-pending); }
.encounter-resolution-stack li[data-active='true'] { box-shadow: inset 3px 0 var(--rt-focus); }
.encounter-resolution-stack__open { width: 100%; min-height: var(--rt-touch-minimum); display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 0.55rem; padding: 0.6rem; border: 0; background: var(--rt-surface-2); color: var(--rt-text); font: inherit; text-align: left; }
.encounter-resolution-stack__open--status { cursor: default; }
.encounter-resolution-stack__open strong,
.encounter-resolution-stack__open small { display: block; }
.encounter-resolution-stack__open small,
.encounter-resolution-stack li > p { color: var(--rt-text-muted); font-size: var(--rt-type-body-sm-size); }
.encounter-resolution-stack__order { display: grid; place-items: center; width: 1.75rem; height: 1.75rem; border-radius: 50%; background: var(--rt-surface-3); }
.encounter-resolution-stack__primary { color: var(--rt-pending); font-size: var(--rt-type-meta-xs-size); font-weight: 800; text-transform: uppercase; }
.encounter-resolution-stack__actions { display: flex; flex-wrap: wrap; gap: 0.35rem; padding: 0.45rem; }
.encounter-resolution-stack__actions button { min-height: var(--rt-touch-minimum); border: 1px solid var(--rt-rule); border-radius: var(--rt-radius-small); background: var(--rt-surface-2); color: var(--rt-text-strong); font: inherit; font-weight: 700; }
.encounter-resolution-stack li > p,
.encounter-resolution-stack__empty { margin: 0; padding: 0.65rem; color: var(--rt-text-muted); }
.encounter-resolution-stack li > p a { min-height: var(--rt-touch-minimum); display: inline-flex; align-items: center; margin-left: .35rem; color: var(--rt-info); font-weight: 750; }
.encounter-resolution-stack button:focus-visible,
.encounter-resolution-stack a:focus-visible { outline: 3px solid var(--rt-focus); outline-offset: 2px; }
</style>

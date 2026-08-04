<script setup lang="ts">
import { computed } from 'vue'
import type { EncounterParticipantSummary } from '#shared/encounterWorkspace/primitives'
import type { EncounterVisualState } from '#shared/encounterWorkspace/designTokens'

const props = withDefaults(defineProps<{
  participant: EncounterParticipantSummary
  state?: EncounterVisualState
  selected?: boolean
  variant?: 'public' | 'owner' | 'gm'
  compact?: boolean
}>(), {
  state: 'idle',
  selected: false,
  variant: 'public',
  compact: false,
})

const emit = defineEmits<{
  select: [participantId: string]
  inspect: [participantId: string]
}>()

const initials = computed(() => props.participant.name
  .split(/\s+/)
  .filter(Boolean)
  .slice(0, 2)
  .map(part => part[0]?.toLocaleUpperCase())
  .join('') || '?')

const hpPercent = computed(() => {
  const hp = props.participant.hp
  if (!hp || hp.maximum <= 0) return 0
  return Math.max(0, Math.min(100, (hp.current / hp.maximum) * 100))
})

const visualState = computed<EncounterVisualState>(() => props.selected ? 'selected' : props.state)
const sideColor = computed(() => /^#[0-9a-f]{6}$/i.test(props.participant.side.color ?? '')
  ? props.participant.side.color
  : 'var(--rt-info)')
const accessibleSummary = computed(() => {
  const participant = props.participant
  const parts = [participant.name, participant.role, participant.side.label]
  if (participant.relationship) parts.push(participant.relationship)
  if (participant.hp) {
    parts.push(`${participant.hp.current} of ${participant.hp.maximum} Hit Points`)
    if (participant.hp.temporary) parts.push(`${participant.hp.temporary} temporary Hit Points`)
  }
  if (participant.currentTurn) parts.push('current turn')
  if (participant.fainted) parts.push('fainted')
  if (participant.conditions?.length) parts.push(participant.conditions.join(', '))
  if (props.variant !== 'public' && participant.injuries !== undefined) parts.push(`${participant.injuries} injuries`)
  if (props.variant !== 'public' && participant.resources?.length) {
    parts.push(participant.resources.map(resource => `${resource.label} ${resource.current}${resource.maximum == null ? '' : ` of ${resource.maximum}`}`).join(', '))
  }
  return parts.join(', ')
})
</script>

<template>
  <article
    class="encounter-participant rt-surface rt-signal-spine"
    :class="{ 'encounter-participant--compact': compact }"
    :data-rt-state="visualState"
    :data-rt-variant="variant"
    data-rt-layer="persistent"
    data-rt-elevation="1"
    :style="{ '--rt-signal': sideColor }"
    :aria-label="accessibleSummary"
    tabindex="-1"
  >
    <button
      type="button"
      class="encounter-participant__select rt-focusable"
      :aria-pressed="selected"
      @click="emit('select', participant.id)"
    >
      <span class="encounter-participant__portrait" aria-hidden="true">
        <img v-if="participant.portraitUrl" :src="participant.portraitUrl" alt="">
        <span v-else>{{ initials }}</span>
      </span>

      <span class="encounter-participant__body">
        <span class="encounter-participant__heading">
          <strong class="rt-type-action-md">{{ participant.name }}</strong>
          <span class="encounter-participant__badges">
            <span v-if="participant.controlled" class="encounter-participant__control">Controlled</span>
            <span v-if="participant.currentTurn" class="encounter-participant__turn">Current</span>
          </span>
        </span>
        <span class="encounter-participant__meta rt-type-meta-xs">
          <span aria-hidden="true">{{ participant.side.symbol }}</span>
          {{ participant.side.label }} · {{ participant.role }}
          <template v-if="participant.relationship"> · {{ participant.relationship }}</template>
        </span>

        <span v-if="participant.hp" class="encounter-participant__hp">
          <span class="encounter-participant__hp-label rt-numeric">
            HP {{ participant.hp.current }}/{{ participant.hp.maximum }}
            <template v-if="participant.hp.temporary"> +{{ participant.hp.temporary }}</template>
          </span>
          <span class="encounter-participant__hp-track" aria-hidden="true">
            <span :style="{ width: `${hpPercent}%` }" />
          </span>
        </span>

        <span v-if="participant.conditions?.length" class="encounter-participant__conditions">
          <span v-for="condition in participant.conditions.slice(0, compact ? 1 : 3)" :key="condition" class="rt-status-chip">
            {{ condition }}
          </span>
        </span>

        <span v-if="variant !== 'public' && (participant.injuries !== undefined || participant.resources?.length)" class="encounter-participant__private-facts">
          <span v-if="participant.injuries !== undefined" class="rt-numeric">Injuries {{ participant.injuries }}</span>
          <span v-for="resource in participant.resources ?? []" :key="resource.id" class="rt-numeric">
            {{ resource.label }} {{ resource.current }}<template v-if="resource.maximum != null">/{{ resource.maximum }}</template>
          </span>
        </span>
      </span>
    </button>

    <button
      type="button"
      class="encounter-participant__inspect rt-control"
      :aria-label="`Inspect ${participant.name}`"
      @click="emit('inspect', participant.id)"
    >
      Inspect
    </button>
  </article>
</template>

<style scoped>
.encounter-participant {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: stretch;
  overflow: hidden;
  padding-left: var(--rt-space-1);
}

.encounter-participant__select {
  display: grid;
  min-width: 0;
  min-height: var(--rt-touch-minimum);
  grid-template-columns: 56px minmax(0, 1fr);
  gap: var(--rt-space-3);
  align-items: center;
  padding: var(--rt-card-padding);
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.encounter-participant__portrait {
  display: grid;
  width: 56px;
  height: 56px;
  place-items: center;
  overflow: hidden;
  border: var(--rt-border-hairline) solid var(--rt-rule);
  border-radius: var(--rt-radius-medium) !important;
  background: var(--rt-surface-3);
  color: var(--rt-text-strong);
  font-size: var(--rt-type-heading-md-size);
  font-weight: 700;
}

.encounter-participant__portrait img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.encounter-participant__body,
.encounter-participant__heading,
.encounter-participant__badges,
.encounter-participant__hp,
.encounter-participant__conditions,
.encounter-participant__private-facts {
  display: flex;
  min-width: 0;
}

.encounter-participant__body,
.encounter-participant__hp {
  flex-direction: column;
}

.encounter-participant__body {
  gap: var(--rt-space-2);
}

.encounter-participant__heading {
  align-items: center;
  justify-content: space-between;
  gap: var(--rt-space-2);
}

.encounter-participant__heading strong,
.encounter-participant__meta {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.encounter-participant__badges { align-items: center; gap: var(--rt-space-1); }
.encounter-participant__turn,
.encounter-participant__control {
  color: var(--rt-focus);
  font-size: var(--rt-type-label-sm-size);
  font-weight: 700;
}
.encounter-participant__control { color: var(--rt-success); }

.encounter-participant__hp {
  gap: var(--rt-space-1);
}

.encounter-participant__hp-label {
  color: var(--rt-text-strong);
  font-size: var(--rt-type-meta-xs-size);
}

.encounter-participant__hp-track {
  height: 6px;
  overflow: hidden;
  border-radius: var(--rt-radius-round) !important;
  background: var(--rt-surface-3);
}

.encounter-participant__hp-track > span {
  display: block;
  height: 100%;
  border-radius: inherit !important;
  background: var(--rt-success);
}

.encounter-participant__conditions,
.encounter-participant__private-facts {
  flex-wrap: wrap;
  gap: var(--rt-space-1);
}
.encounter-participant__private-facts { color: var(--rt-text-muted); font-size: var(--rt-type-meta-xs-size); }
.encounter-participant__private-facts > span { padding-right: var(--rt-space-2); border-right: 1px solid var(--rt-rule); }

.encounter-participant__inspect {
  align-self: center;
  margin-right: var(--rt-space-3);
}

.encounter-participant--compact .encounter-participant__select {
  grid-template-columns: 44px minmax(0, 1fr);
}

.encounter-participant--compact .encounter-participant__portrait {
  width: 44px;
  height: 44px;
}

@media (max-width: 639px) {
  .encounter-participant {
    grid-template-columns: 1fr;
  }

  .encounter-participant__inspect {
    margin: 0 var(--rt-card-padding) var(--rt-card-padding);
  }
}
</style>

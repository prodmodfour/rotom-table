<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { EncounterWorkspaceViewModel } from '#shared/encounterWorkspace/model'

const props = defineProps<{
  workspace: EncounterWorkspaceViewModel
  error?: string | null
}>()

const polite = ref('')
const assertive = ref('')
const participantLabel = computed(() => new Map(
  props.workspace.participants.map(participant => [participant.participantId, participant.displayName]),
))

watch(() => props.workspace.turn.currentParticipantId, (participantId, previous) => {
  if (!participantId || participantId === previous) return
  const label = participantLabel.value.get(participantId)
  if (label) polite.value = `${label} is the current actor. Round ${props.workspace.turn.round}.`
}, { immediate: true })

watch(() => props.workspace.pending[0]?.interactionId ?? null, (interactionId, previous) => {
  if (!interactionId || interactionId === previous) return
  const interaction = props.workspace.pending.find(value => value.interactionId === interactionId)
  if (interaction) assertive.value = `Response required. ${interaction.prompt}`
}, { immediate: true })

watch(() => props.workspace.accepted[0]?.presentationId ?? null, (presentationId, previous) => {
  if (!presentationId || presentationId === previous) return
  const presentation = props.workspace.accepted.find(value => value.presentationId === presentationId)
  if (!presentation) return
  const announcement = presentation.announcements.find(value => value.priority === 'assertive')
    ?? presentation.announcements.find(value => value.priority === 'polite')
  const message = announcement?.message ?? presentation.headline.label
  if (presentation.correction || announcement?.priority === 'assertive') assertive.value = message
  else polite.value = message
})

watch(() => props.error, (error, previous) => {
  if (error && error !== previous) assertive.value = error
})
</script>

<template>
  <div class="encounter-workspace-announcements">
    <p role="status" aria-live="polite" aria-atomic="true">{{ polite }}</p>
    <p role="alert" aria-live="assertive" aria-atomic="true">{{ assertive }}</p>
  </div>
</template>

<style scoped>
.encounter-workspace-announcements,
.encounter-workspace-announcements p {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  white-space: nowrap;
}
</style>

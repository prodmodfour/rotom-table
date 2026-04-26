<script setup lang="ts">
/**
 * Tiny "saving / saved" pill, anchored to the corner of an editable
 * sheet so the user has constant feedback that on-disk state matches
 * what they see.
 */
import type { SaveStatus } from '~/composables/useEditableSheet'

interface Props {
  status: SaveStatus
  error?: string | null
}

const props = withDefaults(defineProps<Props>(), {
  error: null,
})

const labelText = (status: SaveStatus): string => {
  switch (status) {
    case 'saving': return 'Saving…'
    case 'saved':  return 'Saved'
    case 'error':  return 'Save failed'
    default:       return 'Edit any cell to save'
  }
}
</script>

<template>
  <span class="save-pill" :data-status="props.status" :title="props.error ?? ''">
    <span class="save-pill__dot" aria-hidden="true"></span>
    <span class="save-pill__text">{{ labelText(props.status) }}</span>
  </span>
</template>

<style scoped>
.save-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.2rem 0.55rem;
  border-radius: 999px;
  border: 1px solid var(--rule-soft);
  background: var(--paper-inset);
  font-size: 0.74rem;
  letter-spacing: 0.04em;
  color: var(--ink-muted);
  white-space: nowrap;
}

.save-pill__dot {
  width: 0.55em;
  height: 0.55em;
  border-radius: 50%;
  background: var(--ink-faint);
  flex: 0 0 auto;
}

.save-pill[data-status='saving'] .save-pill__dot {
  background: var(--accent, #fabd2f);
  animation: pulse 0.9s ease-in-out infinite;
}

.save-pill[data-status='saved'] .save-pill__dot {
  background: #6cab5b;
}

.save-pill[data-status='error'] {
  border-color: rgba(220, 80, 80, 0.45);
  color: #d36464;
}

.save-pill[data-status='error'] .save-pill__dot {
  background: #d36464;
}

@keyframes pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%      { opacity: 0.4; transform: scale(0.7); }
}
</style>

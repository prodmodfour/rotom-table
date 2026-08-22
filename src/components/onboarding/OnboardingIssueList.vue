<script setup lang="ts">
import type { OnboardingValidationIssue } from '#shared/onboarding/validation'

defineProps<{
  issues: readonly OnboardingValidationIssue[]
  /** Emit navigation instead of plain display (used by the review card). */
  navigable?: boolean
}>()

defineEmits<{ (event: 'focus-decision', decisionId: string): void }>()
</script>

<template>
  <ul v-if="issues.length > 0" class="issue-list" aria-label="Validation issues">
    <li
      v-for="(issue, index) in issues"
      :key="`${issue.code}-${index}`"
      class="issue-list__row"
      :data-severity="issue.severity"
    >
      <component
        :is="navigable ? 'button' : 'p'"
        class="issue-list__body"
        v-bind="navigable ? { type: 'button' } : {}"
        @click="navigable && $emit('focus-decision', issue.decisionId)"
      >
        <span class="issue-list__message">{{ issue.message }}</span>
        <span v-if="navigable" class="issue-list__go">Fix →</span>
      </component>
    </li>
  </ul>
</template>

<style scoped>
.issue-list { list-style: none; margin: 0; padding: 0; display: grid; gap: .35rem; }
.issue-list__row {
  border-left: 4px solid var(--rt-info, #8aa8ff);
  background: var(--rt-surface-2, var(--paper-inset));
}
.issue-list__row[data-severity="blocking"] { border-left-color: var(--rt-danger, #ff6672); }
.issue-list__row[data-severity="deviation"],
.issue-list__row[data-severity="warning"] { border-left-color: var(--rt-pending, #ffbf52); }
.issue-list__body {
  margin: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: .6rem;
  width: 100%;
  min-height: 44px;
  padding: .45rem .7rem;
  border: none;
  background: transparent;
  color: var(--rt-text, var(--ink));
  font: inherit;
  text-align: left;
}
button.issue-list__body { cursor: pointer; }
.issue-list__go { color: var(--rt-focus, #2a7fa8); font-weight: 750; white-space: nowrap; }
</style>

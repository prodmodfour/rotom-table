<script setup lang="ts">
import { computed } from 'vue'
import type { OnboardingDecisionNode } from '#shared/onboarding/decisions'

const props = defineProps<{
  nodes: readonly OnboardingDecisionNode[]
  currentDecisionId: string | null
}>()

defineEmits<{ (event: 'focus-decision', decisionId: string): void }>()

interface RailGroup { label: string, nodes: OnboardingDecisionNode[] }

const groups = computed<RailGroup[]>(() => {
  const out: RailGroup[] = []
  const groupLabel = (node: OnboardingDecisionNode): string => {
    if (node.area === 'trainer') return 'Trainer'
    if (node.area === 'package') return 'Review'
    const match = /^pokemon\.(\d+)\./.exec(node.decisionId)
    return match ? `Starter ${match[1]}` : 'Team'
  }
  for (const node of props.nodes) {
    const label = groupLabel(node)
    const last = out[out.length - 1]
    if (last && last.label === label) last.nodes.push(node)
    else out.push({ label, nodes: [node] })
  }
  return out
})
</script>

<template>
  <nav class="decision-rail" aria-label="Creation decisions">
    <div v-for="group in groups" :key="group.label" class="decision-rail__group">
      <p class="decision-rail__label">{{ group.label }}</p>
      <ul>
        <li v-for="node in group.nodes" :key="node.decisionId">
          <button
            type="button"
            class="decision-rail__row"
            :data-current="node.decisionId === currentDecisionId ? '1' : undefined"
            :data-status="node.status"
            :aria-current="node.decisionId === currentDecisionId ? 'step' : undefined"
            @click="$emit('focus-decision', node.decisionId)"
          >
            <span class="decision-rail__status" aria-hidden="true">
              <template v-if="node.status === 'complete'">✓</template>
              <template v-else-if="node.status === 'attention'">!</template>
              <template v-else>○</template>
            </span>
            <span class="decision-rail__text">
              <span class="decision-rail__title">{{ node.title }}</span>
              <span class="decision-rail__summary">{{ node.summary }}</span>
            </span>
            <span v-if="node.blockingCount > 0" class="decision-rail__badge">{{ node.blockingCount }}</span>
            <span class="sr-only">
              {{ node.status === 'complete' ? 'Complete' : node.status === 'attention' ? `${node.blockingCount} blocking issue(s)` : 'Incomplete' }}
            </span>
          </button>
        </li>
      </ul>
    </div>
  </nav>
</template>

<style scoped>
.decision-rail {
  display: grid;
  gap: .8rem;
  border: 1px solid var(--rt-rule, var(--rule-soft));
  background: var(--rt-surface-1, var(--paper-soft));
  padding: .7rem;
  align-content: start;
}
.decision-rail__group { display: grid; gap: .3rem; }
.decision-rail__label {
  margin: 0;
  padding: .2rem .35rem 0;
  color: var(--rt-text-muted, var(--ink-muted));
  font-size: .7rem;
  font-weight: 800;
  letter-spacing: .1em;
  text-transform: uppercase;
}
.decision-rail ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
.decision-rail__row {
  display: flex;
  align-items: center;
  gap: .55rem;
  width: 100%;
  min-height: 44px;
  padding: .4rem .5rem;
  border: none;
  border-left: 3px solid transparent;
  background: transparent;
  color: var(--rt-text, var(--ink));
  text-align: left;
  cursor: pointer;
}
.decision-rail__row[data-current="1"] {
  border-left-color: var(--rt-focus, #59d8ff);
  background: var(--rt-surface-2, var(--paper-inset));
}
.decision-rail__status {
  flex: none;
  inline-size: 1.25rem;
  text-align: center;
  font-weight: 800;
  color: var(--rt-text-muted, var(--ink-muted));
}
.decision-rail__row[data-status="complete"] .decision-rail__status { color: var(--rt-success, #2e8b57); }
.decision-rail__row[data-status="attention"] .decision-rail__status { color: var(--rt-pending, #b8860b); }
.decision-rail__text { display: grid; min-width: 0; }
.decision-rail__title { font-weight: 750; font-size: .88rem; }
.decision-rail__summary {
  color: var(--rt-text-muted, var(--ink-muted));
  font-size: .75rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.decision-rail__badge {
  margin-left: auto;
  flex: none;
  min-width: 1.35rem;
  height: 1.35rem;
  display: grid;
  place-items: center;
  border-radius: 999px;
  background: var(--rt-pending, #ffbf52);
  color: #201503;
  font-size: .72rem;
  font-weight: 800;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}
</style>

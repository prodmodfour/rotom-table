<script setup lang="ts">
defineProps<{
  activeStep: number
}>()
</script>

<template>
  <div class="move-automation__steps" aria-label="Move wizard steps">
    <span :class="['move-automation__step', { 'is-active': activeStep === 0 }]">1. Pick</span>
    <span :class="['move-automation__step', { 'is-active': activeStep === 1 }]">2. Resolve</span>
    <span :class="['move-automation__step', { 'is-active': activeStep === 2 }]">3. Review</span>
  </div>
</template>

<style scoped>
.move-automation__steps {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 0.65rem;
  padding: 0.85rem 1rem;
  border-bottom: 1px solid var(--rule-soft);
}

.move-automation__step {
  padding: 0.35rem 0.6rem;
  border: 1px solid var(--rule-soft);
  border-radius: 999px;
  color: var(--ink-muted);
  font-size: 0.78rem;
  font-weight: 800;
}

.move-automation__step.is-active {
  border-color: var(--accent);
  color: var(--ink-bright);
}
</style>

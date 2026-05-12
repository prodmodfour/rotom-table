<script setup lang="ts">
import type { PtuCapability } from '~/types/ptuReference'

defineProps<{
  capability: PtuCapability
}>()
</script>

<template>
  <article class="panel-card capability-detail-card">
    <CapabilityArt :name="capability.name" size="hero" class="capability-detail-card__art" />

    <div class="capability-detail-card__copy">
      <ReferenceDetailHeading :title="capability.name" />

      <ReferenceFieldBlock v-if="capability.effect" title="Effect">
        <p>{{ capability.effect }}</p>
      </ReferenceFieldBlock>
    </div>
  </article>
</template>

<style scoped>
.capability-detail-card {
  display: grid;
  grid-template-columns: minmax(168px, 230px) minmax(0, 1fr);
  gap: 1.15rem;
  align-items: start;
}

.capability-detail-card__art {
  justify-self: center;
}

.capability-detail-card__copy {
  min-width: 0;
}

@media (max-width: 720px) {
  .capability-detail-card {
    grid-template-columns: 1fr;
  }
}
</style>

<script setup lang="ts">
import GmAdminModalShell from '~/components/admin/GmAdminModalShell.vue'
import GmAdminPanelHeader from '~/components/admin/GmAdminPanelHeader.vue'

defineProps<{
  pageLabel: string
}>()

const emit = defineEmits<{
  (event: 'close'): void
}>()

const titleId = 'global-gm-admin-title'
</script>

<template>
  <GmAdminModalShell :title-id="titleId" @close="emit('close')">
    <GmAdminPanelHeader
      :title-id="titleId"
      title="Page admin"
      :subtitle="pageLabel"
      @close="emit('close')"
    />

    <p class="gm-admin-empty-panel__message">
      No GM admin actions for this page yet.
    </p>
  </GmAdminModalShell>
</template>

<style scoped>
.gm-admin-empty-panel__message {
  margin: 0;
  border: 1px solid var(--rule-soft);
  border-radius: 14px;
  background: var(--paper-inset);
  color: var(--ink-soft);
  padding: 0.85rem;
  font-size: 0.86rem;
  line-height: 1.45;
}
</style>

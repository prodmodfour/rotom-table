<script setup lang="ts">
import LibraryContextMenuError from '~/components/library/LibraryContextMenuError.vue'
import LibraryContextMenuFormActions from '~/components/library/LibraryContextMenuFormActions.vue'
import LibraryContextMenuFormPanel from '~/components/library/LibraryContextMenuFormPanel.vue'

defineProps<{
  targetKind: string
  targetLabel: string
  isFolderTarget: boolean
  busy: boolean
  error: string | null
  deleteFolderSuffix: string
  deleteItemSuffix: string
}>()

const emit = defineEmits<{
  close: []
  submit: []
}>()
</script>

<template>
  <LibraryContextMenuFormPanel>
    <p class="ctx-confirm">
      <template v-if="isFolderTarget">
        Delete folder <strong>{{ targetLabel }}</strong> {{ deleteFolderSuffix }}
      </template>
      <template v-else>
        Delete {{ targetKind.toLowerCase() }} <strong>{{ targetLabel }}</strong>{{ deleteItemSuffix }}
      </template>
    </p>
    <LibraryContextMenuError :message="error" />
    <LibraryContextMenuFormActions
      :busy="busy"
      submit-label="Delete"
      submit-variant="danger"
      @close="emit('close')"
      @submit="emit('submit')"
    />
  </LibraryContextMenuFormPanel>
</template>

<style scoped>
.ctx-confirm {
  margin: 0;
  color: var(--ink-soft);
  line-height: 1.4;
  font-size: 0.9rem;
}
</style>

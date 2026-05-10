<script setup lang="ts">
import LibraryContextMenuFormActions from '~/components/library/LibraryContextMenuFormActions.vue'

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
  <div class="ctx-form">
    <p class="ctx-confirm">
      <template v-if="isFolderTarget">
        Delete folder <strong>{{ targetLabel }}</strong> {{ deleteFolderSuffix }}
      </template>
      <template v-else>
        Delete {{ targetKind.toLowerCase() }} <strong>{{ targetLabel }}</strong>{{ deleteItemSuffix }}
      </template>
    </p>
    <p v-if="error" class="ctx-error" role="alert">{{ error }}</p>
    <LibraryContextMenuFormActions
      :busy="busy"
      submit-label="Delete"
      submit-variant="danger"
      @close="emit('close')"
      @submit="emit('submit')"
    />
  </div>
</template>

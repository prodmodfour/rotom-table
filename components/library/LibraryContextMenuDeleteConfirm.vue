<script setup lang="ts">
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
    <div class="ctx-actions">
      <button type="button" class="ctx-btn" :disabled="busy" @click="emit('close')">Cancel</button>
      <button type="button" class="ctx-btn ctx-btn--danger" :disabled="busy" @click="emit('submit')">
        Delete
      </button>
    </div>
  </div>
</template>

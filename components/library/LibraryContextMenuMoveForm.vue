<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import { textValueFromEvent } from '~/utils/domEvents'
import type { FolderMoveDestination } from '~/utils/folderBrowser'

withDefaults(defineProps<{
  input: string
  busy: boolean
  error?: string | null
  destinations: FolderMoveDestination[]
}>(), {
  error: null,
})

const emit = defineEmits<{
  'update:input': [value: string]
  close: []
  submit: []
}>()

const inputRef = ref<HTMLSelectElement | null>(null)

onMounted(async () => {
  await nextTick()
  inputRef.value?.focus()
})
</script>

<template>
  <form class="ctx-form" @submit.prevent="emit('submit')">
    <label class="ctx-label">
      Move to
      <select
        ref="inputRef"
        :value="input"
        class="ctx-input"
        :disabled="busy || destinations.length === 0"
        @change="emit('update:input', textValueFromEvent($event))"
        @keydown.escape.prevent="emit('close')"
      >
        <option v-if="destinations.length === 0" value="" disabled>
          No other destinations
        </option>
        <option v-for="destination in destinations" :key="`d-${destination.value}`" :value="destination.value">
          {{ destination.label }}
        </option>
      </select>
    </label>
    <p v-if="error" class="ctx-error" role="alert">{{ error }}</p>
    <div class="ctx-actions">
      <button type="button" class="ctx-btn" :disabled="busy" @click="emit('close')">Cancel</button>
      <button
        type="submit"
        class="ctx-btn ctx-btn--primary"
        :disabled="busy || destinations.length === 0"
      >
        Move
      </button>
    </div>
  </form>
</template>

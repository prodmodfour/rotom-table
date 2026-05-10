<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import { textValueFromEvent } from '~/utils/domEvents'

withDefaults(defineProps<{
  input: string
  busy: boolean
  error?: string | null
}>(), {
  error: null,
})

const emit = defineEmits<{
  'update:input': [value: string]
  close: []
  submit: []
}>()

const inputRef = ref<HTMLInputElement | null>(null)

onMounted(async () => {
  await nextTick()
  inputRef.value?.focus()
  inputRef.value?.select()
})
</script>

<template>
  <form class="ctx-form" @submit.prevent="emit('submit')">
    <label class="ctx-label">
      New name
      <input
        ref="inputRef"
        :value="input"
        type="text"
        class="ctx-input"
        :disabled="busy"
        @input="emit('update:input', textValueFromEvent($event))"
        @keydown.escape.prevent="emit('close')"
      />
    </label>
    <p v-if="error" class="ctx-error" role="alert">{{ error }}</p>
    <div class="ctx-actions">
      <button type="button" class="ctx-btn" :disabled="busy" @click="emit('close')">Cancel</button>
      <button type="submit" class="ctx-btn ctx-btn--primary" :disabled="busy">Rename</button>
    </div>
  </form>
</template>

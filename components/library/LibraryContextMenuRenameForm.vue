<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import LibraryContextMenuFormActions from '~/components/library/LibraryContextMenuFormActions.vue'
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
    <LibraryContextMenuFormActions
      :busy="busy"
      submit-label="Rename"
      @close="emit('close')"
      @submit="emit('submit')"
    />
  </form>
</template>

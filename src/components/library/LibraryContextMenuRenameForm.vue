<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import LibraryContextMenuError from '~/components/library/LibraryContextMenuError.vue'
import LibraryContextMenuField from '~/components/library/LibraryContextMenuField.vue'
import LibraryContextMenuFormActions from '~/components/library/LibraryContextMenuFormActions.vue'
import LibraryContextMenuFormPanel from '~/components/library/LibraryContextMenuFormPanel.vue'
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
  <LibraryContextMenuFormPanel as="form" @submit="emit('submit')">
    <LibraryContextMenuField label="New name">
      <input
        ref="inputRef"
        :value="input"
        type="text"
        class="ctx-input"
        :disabled="busy"
        @input="emit('update:input', textValueFromEvent($event))"
        @keydown.escape.prevent="emit('close')"
      />
    </LibraryContextMenuField>
    <LibraryContextMenuError :message="error" />
    <LibraryContextMenuFormActions
      :busy="busy"
      submit-label="Rename"
      @close="emit('close')"
      @submit="emit('submit')"
    />
  </LibraryContextMenuFormPanel>
</template>

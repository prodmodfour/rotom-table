<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import LibraryContextMenuError from '~/components/library/LibraryContextMenuError.vue'
import LibraryContextMenuField from '~/components/library/LibraryContextMenuField.vue'
import LibraryContextMenuFormActions from '~/components/library/LibraryContextMenuFormActions.vue'
import LibraryContextMenuFormPanel from '~/components/library/LibraryContextMenuFormPanel.vue'
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
  <LibraryContextMenuFormPanel as="form" @submit="emit('submit')">
    <LibraryContextMenuField label="Move to">
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
    </LibraryContextMenuField>
    <LibraryContextMenuError :message="error" />
    <LibraryContextMenuFormActions
      :busy="busy"
      :submit-disabled="destinations.length === 0"
      submit-label="Move"
      @close="emit('close')"
      @submit="emit('submit')"
    />
  </LibraryContextMenuFormPanel>
</template>

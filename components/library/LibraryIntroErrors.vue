<script setup lang="ts">
import { computed } from 'vue'

interface LibraryIntroErrorItem {
  key: string
  message?: string | null
  prefix?: string
}

type VisibleLibraryIntroErrorItem = LibraryIntroErrorItem & { message: string }

const props = defineProps<{
  errors: LibraryIntroErrorItem[]
}>()

const visibleErrors = computed<VisibleLibraryIntroErrorItem[]>(() =>
  props.errors.filter((error): error is VisibleLibraryIntroErrorItem => typeof error.message === 'string' && error.message.length > 0),
)
</script>

<template>
  <p
    v-for="error in visibleErrors"
    :key="error.key"
    class="library-intro-error"
    role="alert"
  >
    {{ error.prefix ?? '' }}{{ error.message }}
  </p>
</template>

<style scoped>
.library-intro-error {
  margin: 0.6rem 0 0;
  padding: 0.45rem 0.65rem;
  border-radius: 8px;
  background: rgba(220, 80, 80, 0.12);
  border: 1px solid rgba(220, 80, 80, 0.4);
  color: #c44;
  font-size: 0.85rem;
}
</style>

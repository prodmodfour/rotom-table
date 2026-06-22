<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import GmAdminEmptyPanel from '~/components/admin/GmAdminEmptyPanel.vue'
import { useWindowKeydown } from '~/composables/useWindowKeydown'
import { routeHasPageSpecificGmAdminPanel } from '~/utils/gmAdminPanels'
import { isCtrlShiftLetter, isEditableKeyboardEventTarget, isEscapeKey } from '~/utils/keyboardShortcuts'

const route = useRoute()
const { isGm } = useAuth()
const isOpen = ref(false)

const usesPageSpecificAdminPanel = computed(() => routeHasPageSpecificGmAdminPanel(route))
const canOpen = computed(() => isGm.value && !usesPageSpecificAdminPanel.value)
const pageLabel = computed(() => route.meta.title?.toString() || route.path)

const close = () => {
  isOpen.value = false
}

const toggle = () => {
  if (!canOpen.value) return
  isOpen.value = !isOpen.value
}

watch(canOpen, (nextCanOpen) => {
  if (nextCanOpen) return
  close()
})

watch(() => route.fullPath, () => {
  close()
})

useWindowKeydown((event) => {
  if (isCtrlShiftLetter(event, 'a')) {
    if (!canOpen.value || isEditableKeyboardEventTarget(event.target)) return

    event.preventDefault()
    if (!event.repeat) toggle()
    return
  }

  if (isEscapeKey(event) && isOpen.value) {
    event.preventDefault()
    close()
  }
})
</script>

<template>
  <GmAdminEmptyPanel
    v-if="isOpen"
    :page-label="pageLabel"
    @close="close"
  />
</template>

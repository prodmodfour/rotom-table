import { ref, watch } from 'vue'

interface BooleanRef {
  readonly value: boolean
}

export interface UsePokedexAdminPanelOptions {
  readonly isGm: BooleanRef
}

export const usePokedexAdminPanel = ({ isGm }: UsePokedexAdminPanelOptions) => {
  const isOpen = ref(false)

  const close = (): void => {
    isOpen.value = false
  }

  const open = (): void => {
    if (!isGm.value) return
    isOpen.value = true
  }

  watch(() => isGm.value, (nextIsGm) => {
    if (!nextIsGm) close()
  }, { flush: 'sync' })

  return { close, isOpen, open }
}

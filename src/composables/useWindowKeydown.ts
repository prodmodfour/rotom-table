import { onBeforeUnmount, onMounted } from 'vue'

export const useWindowKeydown = (handler: (event: KeyboardEvent) => void): void => {
  onMounted(() => {
    window.addEventListener('keydown', handler)
  })

  onBeforeUnmount(() => {
    window.removeEventListener('keydown', handler)
  })
}

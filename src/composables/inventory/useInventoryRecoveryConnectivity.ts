import { computed, onMounted, onUnmounted, ref } from 'vue'

export const useInventoryRecoveryConnectivity = () => {
  const online = ref(true)
  const update = (): void => {
    online.value = typeof navigator === 'undefined' ? true : navigator.onLine !== false
  }

  onMounted(() => {
    update()
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
  })
  onUnmounted(() => {
    window.removeEventListener('online', update)
    window.removeEventListener('offline', update)
  })

  return {
    online,
    label: computed(() => online.value ? 'Online — ready for explicit recovery' : 'Offline — waiting to reconnect'),
  }
}

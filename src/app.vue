<script setup lang="ts">
import { onMounted, watch } from 'vue'
import GmAdminPanelHost from '~/components/admin/GmAdminPanelHost.vue'
import { setRealtimeClientAuthRole } from '~/utils/realtimeClientPrincipalContext'

useAppTheme()
useSoundEffectSettings()

const { role } = useAuth()
const playerProfiles = usePlayerProfiles()

if (import.meta.client) {
  let mounted = false
  watch(
    role,
    (nextRole) => {
      setRealtimeClientAuthRole(nextRole)
      if (mounted && nextRole === 'player') playerProfiles.loadRememberedProfile()
    },
    { immediate: true },
  )
  onMounted(() => {
    mounted = true
    if (role.value === 'player') playerProfiles.loadRememberedProfile()
  })
}
</script>

<template>
  <NuxtPage />
  <GmAdminPanelHost />
</template>

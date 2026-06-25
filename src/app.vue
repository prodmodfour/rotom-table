<script setup lang="ts">
import { watch } from 'vue'
import GmAdminPanelHost from '~/components/admin/GmAdminPanelHost.vue'
import { setRealtimeClientAuthRole } from '~/utils/realtimeClientPrincipalContext'

useAppTheme()
useSoundEffectSettings()

const { role } = useAuth()
const playerProfiles = usePlayerProfiles()

if (import.meta.client) {
  watch(
    role,
    (nextRole) => {
      setRealtimeClientAuthRole(nextRole)
      if (nextRole === 'player') playerProfiles.loadRememberedProfile()
    },
    { immediate: true },
  )
}
</script>

<template>
  <NuxtPage />
  <GmAdminPanelHost />
</template>

<script setup lang="ts">
import { encounterWorkspacePath } from '#shared/encounterWorkspace/routes'
import { routeParamAsString } from '~/utils/routeParams'

definePageMeta({ path: '/play/:encounterId/tactical' })

const route = useRoute()
const encounterId = routeParamAsString(route.params.encounterId).trim()
if (!encounterId || encounterId.length > 200) {
  throw createError({ statusCode: 404, statusMessage: 'Encounter not found.' })
}
await navigateTo({
  path: encounterWorkspacePath(encounterId),
  query: {
    ...route.query,
    tactical: '1',
    lens: 'full-screen',
  },
}, { replace: true, redirectCode: 302 })
</script>

<template>
  <p role="status">Opening the full tactical lens…</p>
</template>

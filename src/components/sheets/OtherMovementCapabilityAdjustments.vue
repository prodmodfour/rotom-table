<script setup lang="ts">
import { computed } from 'vue'
import MovementCapabilityAdjustment from '~/components/sheets/MovementCapabilityAdjustment.vue'
import { parseCsvList } from '~/utils/sheets/csvFields'
import { isSlowedMovementCapability } from '~/utils/sheetConditionEffects'

const props = defineProps<{
  capabilitiesText?: string | null
  conditions?: readonly string[] | null
}>()

const VALUED_CAPABILITY_RE = /^(.+?)\s+(\d+)\s*$/

const valuedMovementCapabilities = computed(() => parseCsvList(props.capabilitiesText ?? '')
  .flatMap((capability) => {
    const match = VALUED_CAPABILITY_RE.exec(capability)
    if (!match) return []

    const label = (match[1] ?? '').trim().replace(/\s+/g, ' ')
    const value = Number.parseInt(match[2] ?? '', 10)
    if (!Number.isFinite(value) || !isSlowedMovementCapability(label)) return []

    return [{ label, value }]
  }))
</script>

<template>
  <MovementCapabilityAdjustment
    v-for="capability in valuedMovementCapabilities"
    :key="capability.label"
    :name="capability.label"
    :value="capability.value"
    :conditions="props.conditions"
    show-name
  />
</template>

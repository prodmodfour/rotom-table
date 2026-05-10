<script setup lang="ts">
import MoveAutomationDialog from '~/components/MoveAutomationDialog.vue'
import type { CharacterSheetMove } from '~/types/characterSheet'
import type { MapFieldEffects } from '~/types/map'
import type { MoveAutomationTransaction } from '~/types/moveAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { TrainerMove } from '~/types/trainerSheet'

defineProps<{
  user: SpawnedPokemon | null
  moves: Array<CharacterSheetMove | TrainerMove>
  allTokens: SpawnedPokemon[]
  fieldEffects?: MapFieldEffects
  canApplyMapEffects: boolean
}>()

const emit = defineEmits<{
  (event: 'close'): void
  (event: 'apply', transaction: MoveAutomationTransaction): void
}>()
</script>

<template>
  <MoveAutomationDialog
    v-if="user"
    :user="user"
    :moves="moves"
    :all-tokens="allTokens"
    :field-effects="fieldEffects"
    :can-apply-map-effects="canApplyMapEffects"
    @close="emit('close')"
    @apply="emit('apply', $event)"
  />
</template>

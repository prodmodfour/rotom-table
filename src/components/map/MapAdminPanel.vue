<script setup lang="ts">
import MapAdminCombatLogControl from '~/components/map/MapAdminCombatLogControl.vue'
import MapAdminGroundLevelControl from '~/components/map/MapAdminGroundLevelControl.vue'
import MapAdminHeader from '~/components/map/MapAdminHeader.vue'
import MapAdminModeControl from '~/components/map/MapAdminModeControl.vue'
import MapAdminModalShell from '~/components/map/MapAdminModalShell.vue'
import MapAdminShopInterfacesControl from '~/components/map/MapAdminShopInterfacesControl.vue'
import MapAdminYSummary from '~/components/map/MapAdminYSummary.vue'
import MapVisibilityToggle from '~/components/map/MapVisibilityToggle.vue'
import type { MapInteractionMode } from '#shared/mapInteractionMode'
import type { MapShopInterface } from '~/types/map'
import type { ShopTableDocument } from '~/types/shop'
import type {
  MapShopInterfacePatch,
  MapShopInterfaceShopListStatus,
} from '~/composables/map-editor/useMapShopInterfaces'

defineProps<{
  groundLevelYMax: number
  mapGroundLevelY: number
  mapSpecificYMin: number
  mapSpecificYMax: number
  playerVisible?: boolean
  combatLogEntryCount: number
  interactionMode: MapInteractionMode
  interactionModeBusy?: boolean
  interactionModeError?: string | null
  setupEditActive?: boolean
  shopInterfaces: readonly MapShopInterface[]
  shops: readonly ShopTableDocument[]
  shopListStatus?: MapShopInterfaceShopListStatus
  shopListError?: string | null
}>()

const emit = defineEmits<{
  (event: 'close'): void
  (event: 'set-ground-level-y', value: string): void
  (event: 'update-player-visible', value: boolean): void
  (event: 'clear-combat-log'): void
  (event: 'set-interaction-mode', value: MapInteractionMode): void
  (event: 'reload-shops'): void
  (event: 'add-shop-interface', shopSlug: string): void
  (event: 'remove-shop-interface', id: string): void
  (event: 'update-shop-interface', id: string, patch: MapShopInterfacePatch): void
}>()

</script>

<template>
  <MapAdminModalShell title-id="admin-panel-title" @close="emit('close')">
    <MapAdminHeader title-id="admin-panel-title" @close="emit('close')" />

    <MapAdminModeControl
      :interaction-mode="interactionMode"
      :busy="interactionModeBusy"
      :error="interactionModeError"
      @set-interaction-mode="emit('set-interaction-mode', $event)"
    />

    <MapVisibilityToggle
      label="Make player visible"
      :player-visible="playerVisible"
      :disabled="!setupEditActive"
      @update-player-visible="emit('update-player-visible', $event)"
    />

    <MapAdminCombatLogControl
      :entry-count="combatLogEntryCount"
      :disabled="!setupEditActive"
      @clear-combat-log="emit('clear-combat-log')"
    />

    <MapAdminShopInterfacesControl
      :interfaces="shopInterfaces"
      :shops="shops"
      :shop-list-status="shopListStatus"
      :shop-list-error="shopListError"
      :disabled="!setupEditActive"
      @reload-shops="emit('reload-shops')"
      @add-shop-interface="emit('add-shop-interface', $event)"
      @remove-shop-interface="emit('remove-shop-interface', $event)"
      @update-shop-interface="(id, patch) => emit('update-shop-interface', id, patch)"
    />

    <MapAdminGroundLevelControl
      :ground-level-y-max="groundLevelYMax"
      :map-ground-level-y="mapGroundLevelY"
      :disabled="!setupEditActive"
      @set-ground-level-y="emit('set-ground-level-y', $event)"
    />

    <MapAdminYSummary
      :map-ground-level-y="mapGroundLevelY"
      :map-specific-y-min="mapSpecificYMin"
      :map-specific-y-max="mapSpecificYMax"
    />
  </MapAdminModalShell>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { MapShopInterface } from '~/types/map'
import type { ShopTableDocument } from '~/types/shop'
import type {
  MapShopInterfacePatch,
  MapShopInterfaceShopListStatus,
} from '~/composables/map-editor/useMapShopInterfaces'
import { checkedValueFromEvent, textValueFromEvent } from '~/utils/domEvents'

const props = withDefaults(defineProps<{
  interfaces: readonly MapShopInterface[]
  shops: readonly ShopTableDocument[]
  shopListStatus?: MapShopInterfaceShopListStatus
  shopListError?: string | null
  disabled?: boolean
}>(), {
  shopListStatus: 'idle',
  shopListError: null,
  disabled: false,
})

const emit = defineEmits<{
  (event: 'reload-shops'): void
  (event: 'add-shop-interface', shopSlug: string): void
  (event: 'remove-shop-interface', id: string): void
  (event: 'update-shop-interface', id: string, patch: MapShopInterfacePatch): void
}>()

const selectedShopSlug = ref('')

const sortedShops = computed(() => (
  [...props.shops].sort((left, right) => left.name.localeCompare(right.name) || left.slug.localeCompare(right.slug))
))

const shopOptionLabel = (shop: ShopTableDocument): string => {
  const state = shop.open ? 'open' : 'closed'
  const visibility = shop.playerVisible ? 'visible' : 'hidden'
  return `${shop.name || shop.slug} (${shop.slug}; ${state}, ${visibility})`
}

const shopNameBySlug = computed(() => new Map(sortedShops.value.map((shop) => [shop.slug, shop.name || shop.slug])))

const addDisabled = computed(() => props.disabled || sortedShops.value.length === 0 || !selectedShopSlug.value)
const shopListBusy = computed(() => props.shopListStatus === 'loading')
const shopListEmpty = computed(() => props.shopListStatus === 'empty' || sortedShops.value.length === 0)

watch(
  sortedShops,
  (shops) => {
    if (shops.some((shop) => shop.slug === selectedShopSlug.value)) return
    selectedShopSlug.value = shops[0]?.slug ?? ''
  },
  { immediate: true },
)

const emitSelectedShopAdd = (): void => {
  if (addDisabled.value) return
  emit('add-shop-interface', selectedShopSlug.value)
}

const emitShopSlugUpdate = (shopInterface: MapShopInterface, value: string): void => {
  if (props.disabled || !value) return
  const currentName = shopNameBySlug.value.get(shopInterface.shopSlug) ?? shopInterface.shopSlug
  const nextName = shopNameBySlug.value.get(value) ?? value
  const labelFollowsShopName = shopInterface.label === shopInterface.shopSlug || shopInterface.label === currentName
  emit('update-shop-interface', shopInterface.id, {
    shopSlug: value,
    ...(labelFollowsShopName ? { label: nextName } : {}),
  })
}

const emitLabelUpdate = (shopInterface: MapShopInterface, value: string): void => {
  if (props.disabled) return
  emit('update-shop-interface', shopInterface.id, { label: value })
}

const emitVisibilityUpdate = (shopInterface: MapShopInterface, value: boolean): void => {
  if (props.disabled) return
  emit('update-shop-interface', shopInterface.id, { playerVisible: value })
}

const emitPositionUpdate = (shopInterface: MapShopInterface, axis: 'x' | 'y' | 'z', value: string): void => {
  if (props.disabled) return
  const trimmed = value.trim()
  if (!trimmed) {
    emit('update-shop-interface', shopInterface.id, { position: null })
    return
  }

  const numericValue = Number(trimmed)
  if (!Number.isFinite(numericValue)) return
  emit('update-shop-interface', shopInterface.id, {
    position: {
      x: shopInterface.position?.x ?? 0,
      y: shopInterface.position?.y ?? 0,
      z: shopInterface.position?.z ?? 0,
      [axis]: numericValue,
    },
  })
}

const emitRangeUpdate = (shopInterface: MapShopInterface, value: string): void => {
  if (props.disabled) return
  const trimmed = value.trim()
  if (!trimmed) {
    emit('update-shop-interface', shopInterface.id, { interactionRangeMeters: null })
    return
  }

  const numericValue = Number(trimmed)
  if (!Number.isFinite(numericValue)) return
  emit('update-shop-interface', shopInterface.id, { interactionRangeMeters: numericValue })
}
</script>

<template>
  <section class="shop-interfaces-control" aria-labelledby="admin-shop-interfaces-heading">
    <div class="shop-interfaces-control__heading">
      <div>
        <h3 id="admin-shop-interfaces-heading">Shop interfaces</h3>
        <p>Map access points reference campaign shop tables; catalog, prices, and stock stay in Shops.</p>
      </div>
      <button
        type="button"
        class="shop-interfaces-control__reload"
        :disabled="shopListBusy"
        @click="emit('reload-shops')"
      >
        {{ shopListBusy ? 'Loading…' : 'Reload shops' }}
      </button>
    </div>

    <p v-if="disabled" class="shop-interfaces-control__notice">
      Switch to Prepare Map mode to edit mapped shop interfaces.
    </p>
    <p v-else-if="shopListError" class="shop-interfaces-control__notice shop-interfaces-control__notice--error">
      {{ shopListError }}
    </p>

    <div class="shop-interfaces-control__add-row">
      <label for="admin-shop-interface-add-select">
        <span>Shop table</span>
        <select
          id="admin-shop-interface-add-select"
          v-model="selectedShopSlug"
          data-testid="map-shop-interface-add-select"
          :disabled="disabled || shopListBusy || sortedShops.length === 0"
        >
          <option value="" disabled>{{ shopListBusy ? 'Loading shops…' : 'Choose a shop' }}</option>
          <option v-for="shop in sortedShops" :key="shop.slug" :value="shop.slug">
            {{ shopOptionLabel(shop) }}
          </option>
        </select>
      </label>
      <button
        type="button"
        data-testid="map-shop-interface-add"
        :disabled="addDisabled"
        @click="emitSelectedShopAdd"
      >
        Add interface
      </button>
    </div>

    <p v-if="shopListEmpty && !shopListBusy" class="shop-interfaces-control__empty">
      Create a shop table from Shops before placing a map shop interface.
    </p>

    <ol v-if="interfaces.length" class="shop-interfaces-control__list">
      <li v-for="shopInterface in interfaces" :key="shopInterface.id" class="shop-interfaces-control__item">
        <div class="shop-interfaces-control__item-heading">
          <strong>{{ shopInterface.label }}</strong>
          <code>{{ shopInterface.id }}</code>
        </div>

        <label>
          <span>Referenced shop</span>
          <select
            data-testid="map-shop-interface-shop"
            :value="shopInterface.shopSlug"
            :disabled="disabled || sortedShops.length === 0"
            @change="emitShopSlugUpdate(shopInterface, textValueFromEvent($event))"
          >
            <option v-if="!shopNameBySlug.has(shopInterface.shopSlug)" :value="shopInterface.shopSlug">
              {{ shopInterface.shopSlug }} (missing from shop list)
            </option>
            <option v-for="shop in sortedShops" :key="shop.slug" :value="shop.slug">
              {{ shopOptionLabel(shop) }}
            </option>
          </select>
        </label>

        <label>
          <span>Map label</span>
          <input
            type="text"
            data-testid="map-shop-interface-label"
            :value="shopInterface.label"
            :disabled="disabled"
            @input="emitLabelUpdate(shopInterface, textValueFromEvent($event))"
          />
        </label>

        <label class="shop-interfaces-control__visibility">
          <input
            type="checkbox"
            data-testid="map-shop-interface-visible"
            :checked="shopInterface.playerVisible === true"
            :disabled="disabled"
            @change="emitVisibilityUpdate(shopInterface, checkedValueFromEvent($event))"
          />
          Player visible on map
        </label>

        <fieldset class="shop-interfaces-control__position" :disabled="disabled">
          <legend>Position</legend>
          <label>
            <span>X</span>
            <input
              type="number"
              step="0.1"
              data-testid="map-shop-interface-position-x"
              :value="shopInterface.position?.x ?? ''"
              @input="emitPositionUpdate(shopInterface, 'x', textValueFromEvent($event))"
            />
          </label>
          <label>
            <span>Y</span>
            <input
              type="number"
              step="0.1"
              data-testid="map-shop-interface-position-y"
              :value="shopInterface.position?.y ?? ''"
              @input="emitPositionUpdate(shopInterface, 'y', textValueFromEvent($event))"
            />
          </label>
          <label>
            <span>Z</span>
            <input
              type="number"
              step="0.1"
              data-testid="map-shop-interface-position-z"
              :value="shopInterface.position?.z ?? ''"
              @input="emitPositionUpdate(shopInterface, 'z', textValueFromEvent($event))"
            />
          </label>
        </fieldset>

        <label>
          <span>Interaction range (meters)</span>
          <input
            type="number"
            min="0"
            step="0.1"
            data-testid="map-shop-interface-range"
            :value="shopInterface.interactionRangeMeters ?? ''"
            :disabled="disabled"
            @input="emitRangeUpdate(shopInterface, textValueFromEvent($event))"
          />
        </label>

        <button
          type="button"
          class="shop-interfaces-control__remove"
          data-testid="map-shop-interface-remove"
          :disabled="disabled"
          @click="emit('remove-shop-interface', shopInterface.id)"
        >
          Remove interface
        </button>
      </li>
    </ol>
    <p v-else class="shop-interfaces-control__empty">
      No shop interfaces are mapped yet.
    </p>
  </section>
</template>

<style scoped>
.shop-interfaces-control {
  display: grid;
  gap: 0.8rem;
  margin: 0 0 1rem;
  border: 1px solid var(--rule-soft);
  border-radius: 14px;
  background: var(--paper-soft);
  padding: 0.8rem;
}

.shop-interfaces-control__heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
}

.shop-interfaces-control h3,
.shop-interfaces-control p {
  margin: 0;
}

.shop-interfaces-control h3,
.shop-interfaces-control label span,
.shop-interfaces-control legend {
  color: var(--ink-muted);
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.shop-interfaces-control__heading p,
.shop-interfaces-control__empty,
.shop-interfaces-control__notice {
  margin-top: 0.28rem;
  color: var(--ink-soft);
  font-size: 0.86rem;
  line-height: 1.35;
}

.shop-interfaces-control__notice {
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  padding: 0.55rem 0.65rem;
}

.shop-interfaces-control__notice--error {
  border-color: rgba(255, 31, 45, 0.45);
  color: var(--bad);
}

.shop-interfaces-control__add-row,
.shop-interfaces-control__item {
  display: grid;
  gap: 0.65rem;
}

.shop-interfaces-control__add-row {
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: end;
}

.shop-interfaces-control__list {
  display: grid;
  gap: 0.75rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.shop-interfaces-control__item {
  border: 1px solid var(--rule-soft);
  border-radius: 12px;
  background: var(--paper-inset);
  padding: 0.75rem;
}

.shop-interfaces-control__item-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  color: var(--ink);
}

.shop-interfaces-control__item-heading code {
  color: var(--ink-soft);
  font-size: 0.72rem;
}

.shop-interfaces-control label {
  display: grid;
  gap: 0.35rem;
}

.shop-interfaces-control__visibility {
  display: flex !important;
  align-items: center;
  gap: 0.45rem;
  color: var(--ink-soft);
  font-size: 0.85rem;
  font-weight: 700;
}

.shop-interfaces-control__position {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.5rem;
  margin: 0;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  padding: 0.65rem;
}

.shop-interfaces-control__position legend {
  padding: 0 0.25rem;
}

.shop-interfaces-control select,
.shop-interfaces-control input {
  width: 100%;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink);
  padding: 0.55rem 0.65rem;
  outline: none;
}

.shop-interfaces-control input[type='checkbox'] {
  width: auto;
}

.shop-interfaces-control select:focus,
.shop-interfaces-control input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(255, 31, 45, 0.18);
}

.shop-interfaces-control button {
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink);
  padding: 0.55rem 0.75rem;
  cursor: pointer;
  font: inherit;
  font-weight: 800;
  letter-spacing: 0.04em;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.shop-interfaces-control button:hover:not(:disabled),
.shop-interfaces-control button:focus-visible:not(:disabled) {
  border-color: var(--accent);
  background: rgba(255, 31, 45, 0.08);
  outline: none;
}

.shop-interfaces-control__remove {
  color: var(--bad) !important;
}

.shop-interfaces-control button:disabled,
.shop-interfaces-control select:disabled,
.shop-interfaces-control input:disabled,
.shop-interfaces-control fieldset:disabled {
  cursor: not-allowed;
  opacity: 0.58;
}

@media (max-width: 640px) {
  .shop-interfaces-control__heading,
  .shop-interfaces-control__add-row,
  .shop-interfaces-control__item-heading {
    grid-template-columns: 1fr;
    flex-direction: column;
    align-items: stretch;
  }
}
</style>

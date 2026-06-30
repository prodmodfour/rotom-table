<script setup lang="ts">
import { PhPlus, PhX } from '@phosphor-icons/vue'
import TrainerInventoryItemNameCell from '~/components/sheets/TrainerInventoryItemNameCell.vue'
import { textValueFromEvent } from '~/utils/domEvents'
import { trainerInventoryItemOptions } from '~/utils/sheets/trainerInventoryItems'
import { TRAINER_INVENTORY_SECTIONS } from '~/utils/sheets/trainerInventorySections'
import {
  SHOP_DEFAULT_ENTRY_SECTION,
  SHOP_MAX_SAFE_INTEGER,
  createShopEntryRowId,
  normalizeShopEntrySection,
  type ShopEntry,
  type ShopEntrySectionKey,
  type ShopStockValue,
} from '~/types/shop'

const props = withDefaults(defineProps<{
  entries?: readonly ShopEntry[]
}>(), {
  entries: () => [],
})

const emit = defineEmits<{
  'update:entries': [entries: ShopEntry[]]
}>()

const sectionByKey = new Map(
  TRAINER_INVENTORY_SECTIONS.map((section) => [section.key, section] as const),
)

const coerceNonNegativeInteger = (value: unknown, fallback = 0): number => {
  const numericValue = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() !== ''
      ? Number(value)
      : Number.NaN

  if (!Number.isFinite(numericValue)) return fallback
  if (numericValue <= 0) return 0
  return Math.min(Math.floor(numericValue), SHOP_MAX_SAFE_INTEGER)
}

const optionalText = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

const positiveIntegerOrUndefined = (value: unknown): number | undefined => {
  if (value == null) return undefined
  const normalized = coerceNonNegativeInteger(value)
  return normalized > 0 ? normalized : undefined
}

const normalizeTags = (value: unknown): string[] | undefined => {
  const rawTags = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : []
  const tags: string[] = []

  for (const rawTag of rawTags) {
    const tag = optionalText(rawTag)
    if (tag && !tags.includes(tag)) tags.push(tag)
  }

  return tags.length > 0 ? tags : undefined
}

const normalizeStock = (value: unknown): ShopStockValue => (
  value == null ? null : coerceNonNegativeInteger(value)
)

const cloneEntry = (entry: ShopEntry): ShopEntry => {
  const next: ShopEntry = {
    id: optionalText(entry.id) ?? '',
    itemName: typeof entry.itemName === 'string' ? entry.itemName : '',
    section: normalizeShopEntrySection(entry.section),
    price: coerceNonNegativeInteger(entry.price),
    stock: normalizeStock(entry.stock),
  }

  const maxPerPurchase = positiveIntegerOrUndefined(entry.maxPerPurchase)
  if (maxPerPurchase !== undefined) next.maxPerPurchase = maxPerPurchase

  const playerDescription = optionalText(entry.playerDescription)
  if (playerDescription !== undefined) next.playerDescription = playerDescription

  const gmNotes = optionalText(entry.gmNotes)
  if (gmNotes !== undefined) next.gmNotes = gmNotes

  const tags = normalizeTags(entry.tags)
  if (tags !== undefined) next.tags = tags

  return next
}

const emitEntries = (entries: readonly ShopEntry[]) => {
  emit('update:entries', entries.map(cloneEntry))
}

const patchEntry = (index: number, patch: Partial<ShopEntry>) => {
  emitEntries(props.entries.map((entry, entryIndex) => (
    entryIndex === index ? { ...cloneEntry(entry), ...patch } : entry
  )))
}

const allocateRowId = (entries: readonly ShopEntry[]): string => {
  const usedIds = new Set(entries.map((entry) => entry.id).filter(Boolean))

  for (let index = entries.length; index < entries.length + 10_000; index += 1) {
    const candidate = createShopEntryRowId({
      index,
      itemName: '',
      section: SHOP_DEFAULT_ENTRY_SECTION,
    })
    if (!usedIds.has(candidate)) return candidate
  }

  throw new Error('Unable to allocate a unique shop entry row id.')
}

const addEntry = () => {
  emitEntries([
    ...props.entries,
    {
      id: allocateRowId(props.entries),
      itemName: '',
      section: SHOP_DEFAULT_ENTRY_SECTION,
      price: 0,
      stock: null,
    },
  ])
}

const removeEntry = (index: number) => {
  emitEntries(props.entries.filter((_, entryIndex) => entryIndex !== index))
}

const setItemName = (index: number, value: string) => {
  patchEntry(index, { itemName: value.trim() })
}

const setSection = (index: number, value: string) => {
  patchEntry(index, { section: normalizeShopEntrySection(value) })
}

const setPrice = (index: number, value: string) => {
  patchEntry(index, { price: coerceNonNegativeInteger(value) })
}

const setStockMode = (index: number, entry: ShopEntry, value: string) => {
  patchEntry(index, { stock: value === 'finite' ? normalizeStock(entry.stock ?? 0) : null })
}

const setFiniteStock = (index: number, value: string) => {
  patchEntry(index, { stock: coerceNonNegativeInteger(value) })
}

const setMaxPerPurchase = (index: number, value: string) => {
  patchEntry(index, { maxPerPurchase: positiveIntegerOrUndefined(value) })
}

const setOptionalTextField = (
  index: number,
  field: 'playerDescription' | 'gmNotes',
  value: string,
) => {
  patchEntry(index, { [field]: optionalText(value) })
}

const setTags = (index: number, value: string) => {
  patchEntry(index, { tags: normalizeTags(value) })
}

const stockMode = (entry: ShopEntry): 'unlimited' | 'finite' => (
  entry.stock === null ? 'unlimited' : 'finite'
)

const tagsText = (entry: ShopEntry): string => entry.tags?.join(', ') ?? ''

const sectionPlaceholder = (section: ShopEntrySectionKey): string => (
  sectionByKey.get(section)?.namePlaceholder ?? 'Item'
)
</script>

<template>
  <section class="shop-entry-table block" data-testid="shop-entry-table" aria-labelledby="shop-entry-table-title">
    <h2 id="shop-entry-table-title" class="block-title">
      Shop entries
      <button type="button" class="row-add" data-testid="shop-entry-add" @click="addEntry">
        <PhPlus :size="14" weight="bold" /> Add row
      </button>
    </h2>

    <div class="shop-entry-table__scroll">
      <table class="data-table shop-entry-table__grid">
        <thead>
          <tr>
            <th>Item</th>
            <th>Section</th>
            <th>Price</th>
            <th>Stock</th>
            <th>Max / buy</th>
            <th>Player description</th>
            <th>GM notes</th>
            <th>Tags</th>
            <th aria-label="Row actions"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(entry, index) in entries" :key="entry.id || index" data-testid="shop-entry-row">
            <th scope="row" class="shop-entry-table__name-col">
              <TrainerInventoryItemNameCell
                :model-value="entry.itemName"
                :options="trainerInventoryItemOptions(entry.section)"
                :placeholder="sectionPlaceholder(entry.section)"
                @commit="(value) => setItemName(index, value)"
              />
            </th>
            <td>
              <select
                class="shop-entry-table__control shop-entry-table__select"
                data-testid="shop-entry-section"
                :value="entry.section"
                aria-label="Inventory section"
                @change="setSection(index, textValueFromEvent($event))"
              >
                <option
                  v-for="section in TRAINER_INVENTORY_SECTIONS"
                  :key="section.key"
                  :value="section.key"
                >
                  {{ section.title }}
                </option>
              </select>
            </td>
            <td>
              <input
                class="shop-entry-table__control shop-entry-table__number"
                data-testid="shop-entry-price"
                type="number"
                min="0"
                step="1"
                :value="entry.price"
                aria-label="Price"
                @input="setPrice(index, textValueFromEvent($event))"
              />
            </td>
            <td>
              <div class="shop-entry-table__stock-controls">
                <select
                  class="shop-entry-table__control shop-entry-table__select"
                  data-testid="shop-entry-stock-mode"
                  :value="stockMode(entry)"
                  aria-label="Stock mode"
                  @change="setStockMode(index, entry, textValueFromEvent($event))"
                >
                  <option value="unlimited">Unlimited</option>
                  <option value="finite">Finite</option>
                </select>
                <input
                  v-if="entry.stock !== null"
                  class="shop-entry-table__control shop-entry-table__number"
                  data-testid="shop-entry-stock-count"
                  type="number"
                  min="0"
                  step="1"
                  :value="entry.stock"
                  aria-label="Finite stock count"
                  @input="setFiniteStock(index, textValueFromEvent($event))"
                />
                <span v-else class="muted">Unlimited</span>
              </div>
            </td>
            <td>
              <input
                class="shop-entry-table__control shop-entry-table__number"
                data-testid="shop-entry-max-per-purchase"
                type="number"
                min="1"
                step="1"
                :value="entry.maxPerPurchase ?? ''"
                placeholder="—"
                aria-label="Max per purchase"
                @input="setMaxPerPurchase(index, textValueFromEvent($event))"
              />
            </td>
            <td>
              <textarea
                class="shop-entry-table__control shop-entry-table__textarea"
                data-testid="shop-entry-player-description"
                rows="2"
                :value="entry.playerDescription ?? ''"
                placeholder="Shown to players"
                aria-label="Player description"
                @input="setOptionalTextField(index, 'playerDescription', textValueFromEvent($event))"
              />
            </td>
            <td>
              <textarea
                class="shop-entry-table__control shop-entry-table__textarea"
                data-testid="shop-entry-gm-notes"
                rows="2"
                :value="entry.gmNotes ?? ''"
                placeholder="Private GM notes"
                aria-label="GM notes"
                @input="setOptionalTextField(index, 'gmNotes', textValueFromEvent($event))"
              />
            </td>
            <td>
              <input
                class="shop-entry-table__control"
                data-testid="shop-entry-tags"
                type="text"
                :value="tagsText(entry)"
                placeholder="healing, rare"
                aria-label="Tags"
                @input="setTags(index, textValueFromEvent($event))"
              />
            </td>
            <td class="row-actions">
              <button
                type="button"
                class="row-remove"
                data-testid="shop-entry-remove"
                title="Remove shop entry"
                @click="removeEntry(index)"
              >
                <PhX :size="14" weight="bold" />
              </button>
            </td>
          </tr>
          <tr v-if="!entries.length">
            <td colspan="9" class="muted">No shop entries yet.</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped src="../sheets/trainerInventoryPanel.css"></style>

<style scoped>
.shop-entry-table__scroll {
  overflow-x: auto;
}

.shop-entry-table__grid {
  min-width: 72rem;
}

.shop-entry-table__name-col {
  min-width: 13rem;
  max-width: 22rem;
}

.shop-entry-table__control {
  width: 100%;
  min-width: 6rem;
  border: 1px solid var(--rule-soft);
  background: var(--paper);
  color: var(--ink);
  padding: 0.25rem 0.35rem;
}

.shop-entry-table__control:focus {
  border-color: var(--rule-active);
  outline: none;
  box-shadow: 0 0 0 2px rgba(var(--accent-rgb), 0.16);
}

.shop-entry-table__select {
  appearance: auto;
}

.shop-entry-table__number {
  min-width: 5.5rem;
}

.shop-entry-table__textarea {
  min-width: 12rem;
  resize: vertical;
}

.shop-entry-table__stock-controls {
  display: grid;
  gap: 0.35rem;
  min-width: 7rem;
}
</style>

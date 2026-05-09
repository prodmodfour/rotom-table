<script setup lang="ts">
import { PhPlus, PhX } from '@phosphor-icons/vue'
import type { TrainerSheet } from '~/types/trainerSheet'

type InventoryKey = keyof NonNullable<TrainerSheet['inventory']>

defineProps<{
  sheet: TrainerSheet
}>()

const emit = defineEmits<{
  addItem: [key: InventoryKey]
  removeItem: [key: InventoryKey, index: number]
}>()
</script>

<template>
  <div class="trainer-inventory-panel">
    <div class="block">
      <h2 class="block-title">Equipped</h2>
      <ul class="kv-list">
        <li><span>Main Hand</span>
          <strong class="equipped-item"><ItemSprite :item="sheet.equipmentSlots!.mainHand" size="sm" /><EditableCell v-model="sheet.equipmentSlots!.mainHand" placeholder="—" /></strong>
        </li>
        <li><span>Off Hand</span>
          <strong class="equipped-item"><ItemSprite :item="sheet.equipmentSlots!.offHand" size="sm" /><EditableCell v-model="sheet.equipmentSlots!.offHand"  placeholder="—" /></strong>
        </li>
        <li><span>Head</span>
          <strong class="equipped-item"><ItemSprite :item="sheet.equipmentSlots!.head" size="sm" /><EditableCell v-model="sheet.equipmentSlots!.head"     placeholder="—" /></strong>
        </li>
        <li><span>Body</span>
          <strong class="equipped-item"><ItemSprite :item="sheet.equipmentSlots!.body" size="sm" /><EditableCell v-model="sheet.equipmentSlots!.body"     placeholder="—" /></strong>
        </li>
        <li><span>Feet</span>
          <strong class="equipped-item"><ItemSprite :item="sheet.equipmentSlots!.feet" size="sm" /><EditableCell v-model="sheet.equipmentSlots!.feet"     placeholder="—" /></strong>
        </li>
        <li><span>Accessory</span>
          <strong class="equipped-item"><ItemSprite :item="sheet.equipmentSlots!.accessory" size="sm" /><EditableCell v-model="sheet.equipmentSlots!.accessory" placeholder="—" /></strong>
        </li>
      </ul>
    </div>

    <div class="grid-two">
      <div class="block inv-block">
        <h2 class="block-title">
          Key Items
          <button type="button" class="row-add" @click="emit('addItem', 'keyItems')">
            <PhPlus :size="14" weight="bold" /> Add row
          </button>
        </h2>
        <table class="data-table inv-table">
          <thead><tr><th>Name</th><th>Qty</th><th>Cost</th><th>Description</th><th></th></tr></thead>
          <tbody>
            <tr v-for="(it, i) in sheet.inventory!.keyItems" :key="i">
              <th><span class="inventory-item-name"><ItemSprite :item="it.name" size="sm" /><EditableCell v-model="it.name" placeholder="Item" /></span></th>
              <td><EditableCell v-model="it.qty"  type="number" :min="0" /></td>
              <td><EditableCell v-model="it.cost" type="number" :min="0" /></td>
              <td class="effect-col"><EditableCell v-model="it.description" type="textarea" placeholder="—" multiline /></td>
              <td class="row-actions">
                <button type="button" class="row-remove" title="Remove" @click="emit('removeItem', 'keyItems', i)">
                  <PhX :size="14" weight="bold" />
                </button>
              </td>
            </tr>
            <tr v-if="!sheet.inventory!.keyItems?.length"><td colspan="5" class="muted">—</td></tr>
          </tbody>
        </table>
      </div>

      <div class="block inv-block">
        <h2 class="block-title">
          Pokémon Items
          <button type="button" class="row-add" @click="emit('addItem', 'pokemonItems')">
            <PhPlus :size="14" weight="bold" /> Add row
          </button>
        </h2>
        <table class="data-table inv-table">
          <thead><tr><th>Name</th><th>Qty</th><th>Cost</th><th>Description</th><th></th></tr></thead>
          <tbody>
            <tr v-for="(it, i) in sheet.inventory!.pokemonItems" :key="i">
              <th><span class="inventory-item-name"><ItemSprite :item="it.name" size="sm" /><EditableCell v-model="it.name" placeholder="Item" /></span></th>
              <td><EditableCell v-model="it.qty"  type="number" :min="0" /></td>
              <td><EditableCell v-model="it.cost" type="number" :min="0" /></td>
              <td class="effect-col"><EditableCell v-model="it.description" type="textarea" placeholder="—" multiline /></td>
              <td class="row-actions">
                <button type="button" class="row-remove" title="Remove" @click="emit('removeItem', 'pokemonItems', i)">
                  <PhX :size="14" weight="bold" />
                </button>
              </td>
            </tr>
            <tr v-if="!sheet.inventory!.pokemonItems?.length"><td colspan="5" class="muted">—</td></tr>
          </tbody>
        </table>
      </div>

      <div class="block inv-block">
        <h2 class="block-title">
          Medical Kit
          <button type="button" class="row-add" @click="emit('addItem', 'medicalKit')">
            <PhPlus :size="14" weight="bold" /> Add row
          </button>
        </h2>
        <table class="data-table inv-table">
          <thead><tr><th>Name</th><th>Qty</th><th>Cost</th><th>Description</th><th></th></tr></thead>
          <tbody>
            <tr v-for="(it, i) in sheet.inventory!.medicalKit" :key="i">
              <th><span class="inventory-item-name"><ItemSprite :item="it.name" size="sm" /><EditableCell v-model="it.name" placeholder="Item" /></span></th>
              <td><EditableCell v-model="it.qty"  type="number" :min="0" /></td>
              <td><EditableCell v-model="it.cost" type="number" :min="0" /></td>
              <td class="effect-col"><EditableCell v-model="it.description" type="textarea" placeholder="—" multiline /></td>
              <td class="row-actions">
                <button type="button" class="row-remove" title="Remove" @click="emit('removeItem', 'medicalKit', i)">
                  <PhX :size="14" weight="bold" />
                </button>
              </td>
            </tr>
            <tr v-if="!sheet.inventory!.medicalKit?.length"><td colspan="5" class="muted">—</td></tr>
          </tbody>
        </table>
      </div>

      <div class="block inv-block">
        <h2 class="block-title">
          Poké Balls &amp; Accessories
          <button type="button" class="row-add" @click="emit('addItem', 'pokeBalls')">
            <PhPlus :size="14" weight="bold" /> Add row
          </button>
        </h2>
        <table class="data-table inv-table">
          <thead><tr><th>Name</th><th>Qty</th><th>Cost</th><th>Mod</th><th>Description</th><th></th></tr></thead>
          <tbody>
            <tr v-for="(it, i) in sheet.inventory!.pokeBalls" :key="i">
              <th><span class="inventory-item-name"><ItemSprite :item="it.name" size="sm" /><EditableCell v-model="it.name" placeholder="Poké Ball" /></span></th>
              <td><EditableCell v-model="it.qty"  type="number" :min="0" /></td>
              <td><EditableCell v-model="it.cost" type="number" :min="0" /></td>
              <td><EditableCell v-model="it.mod"  placeholder="x1" /></td>
              <td class="effect-col"><EditableCell v-model="it.description" type="textarea" placeholder="—" multiline /></td>
              <td class="row-actions">
                <button type="button" class="row-remove" title="Remove" @click="emit('removeItem', 'pokeBalls', i)">
                  <PhX :size="14" weight="bold" />
                </button>
              </td>
            </tr>
            <tr v-if="!sheet.inventory!.pokeBalls?.length"><td colspan="6" class="muted">—</td></tr>
          </tbody>
        </table>
      </div>

      <div class="block inv-block">
        <h2 class="block-title">
          Food Stuff
          <button type="button" class="row-add" @click="emit('addItem', 'foodStuff')">
            <PhPlus :size="14" weight="bold" /> Add row
          </button>
        </h2>
        <table class="data-table inv-table">
          <thead><tr><th>Name</th><th>Qty</th><th>Cost</th><th>Description</th><th></th></tr></thead>
          <tbody>
            <tr v-for="(it, i) in sheet.inventory!.foodStuff" :key="i">
              <th><span class="inventory-item-name"><ItemSprite :item="it.name" size="sm" /><EditableCell v-model="it.name" placeholder="Food" /></span></th>
              <td><EditableCell v-model="it.qty"  type="number" :min="0" /></td>
              <td><EditableCell v-model="it.cost" type="number" :min="0" /></td>
              <td class="effect-col"><EditableCell v-model="it.description" type="textarea" placeholder="—" multiline /></td>
              <td class="row-actions">
                <button type="button" class="row-remove" title="Remove" @click="emit('removeItem', 'foodStuff', i)">
                  <PhX :size="14" weight="bold" />
                </button>
              </td>
            </tr>
            <tr v-if="!sheet.inventory!.foodStuff?.length"><td colspan="5" class="muted">—</td></tr>
          </tbody>
        </table>
      </div>

      <div class="block inv-block">
        <h2 class="block-title">
          Equipment
          <button type="button" class="row-add" @click="emit('addItem', 'equipment')">
            <PhPlus :size="14" weight="bold" /> Add row
          </button>
        </h2>
        <table class="data-table inv-table">
          <thead><tr><th>Name</th><th>Slot</th><th>Cost</th><th>Description</th><th></th></tr></thead>
          <tbody>
            <tr v-for="(it, i) in sheet.inventory!.equipment" :key="i">
              <th><span class="inventory-item-name"><ItemSprite :item="it.name" size="sm" /><EditableCell v-model="it.name" placeholder="Equipment" /></span></th>
              <td><EditableCell v-model="it.slot" placeholder="Body" /></td>
              <td><EditableCell v-model="it.cost" type="number" :min="0" /></td>
              <td class="effect-col"><EditableCell v-model="it.description" type="textarea" placeholder="—" multiline /></td>
              <td class="row-actions">
                <button type="button" class="row-remove" title="Remove" @click="emit('removeItem', 'equipment', i)">
                  <PhX :size="14" weight="bold" />
                </button>
              </td>
            </tr>
            <tr v-if="!sheet.inventory!.equipment?.length"><td colspan="5" class="muted">—</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<style scoped>
.trainer-inventory-panel {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.grid-two {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 0.85rem;
}

.block {
  border: 1px solid var(--rule-soft);
  border-radius: 12px;
  background: var(--paper-inset);
  padding: 0.7rem 0.85rem;
}

.block-title {
  margin: 0 0 0.5rem;
  font-family: var(--font-book);
  font-size: 1rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ink-bright);
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
}

.muted { color: var(--ink-muted); font-size: 0.85rem; }

.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.88rem;
}

.data-table th,
.data-table td {
  padding: 0.35rem 0.5rem;
  text-align: left;
  border-bottom: 1px solid var(--rule);
  vertical-align: top;
}

.data-table th {
  font-weight: 600;
  color: var(--ink-bright);
}

.data-table thead th {
  font-size: 0.7rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ink-muted);
  background: transparent;
  font-weight: 600;
}

.row-add {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  border: 1px solid var(--rule-soft);
  border-radius: 6px;
  background: var(--paper);
  color: var(--ink-soft);
  padding: 0.2rem 0.45rem;
  font: inherit;
  font-size: 0.74rem;
  letter-spacing: 0.04em;
  cursor: pointer;
  text-transform: none;
}

.row-add:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.row-remove {
  display: inline-flex;
  align-items: center;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--ink-soft);
  padding: 0.2rem;
  font: inherit;
  cursor: pointer;
  margin-left: 0.4rem;
}

.row-remove:hover {
  color: #d36464;
  border-color: rgba(220, 80, 80, 0.45);
  background: rgba(220, 80, 80, 0.08);
}

.row-actions { width: 1.5rem; text-align: right; }

.equipped-item,
.inventory-item-name {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  min-width: 0;
}

.inventory-item-name {
  max-width: 100%;
}

.kv-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.kv-list li {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.28rem 0;
  border-bottom: 1px dashed var(--rule);
  font-size: 0.88rem;
}

.kv-list li:last-child { border-bottom: 0; }

.effect-col { color: var(--ink-soft); white-space: pre-wrap; max-width: 22rem; }
</style>

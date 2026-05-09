<script setup lang="ts">
import { PhPlus, PhX } from '@phosphor-icons/vue'
import { setLookupAbilityName } from '~/utils/sheetAbilityLookup'
import type { AbilityLookupRow } from '~/utils/sheetAbilityLookup'
import { formatLookupValue, setLookupMoveName } from '~/utils/sheetMoveLookup'
import type { MoveLookupRow } from '~/utils/sheetMoveLookup'
import type {
  TrainerAbilityEntry,
  TrainerMove,
  TrainerOrder,
  TrainerSheet,
} from '~/types/trainerSheet'

const CATEGORY_OPTIONS = ['Physical', 'Special', 'Status']

defineProps<{
  sheet: TrainerSheet
  moveRows: readonly MoveLookupRow<TrainerMove>[]
  abilityRows: readonly AbilityLookupRow<TrainerAbilityEntry>[]
  orderTagsCsv: (order: TrainerOrder) => string
}>()

const emit = defineEmits<{
  addMove: []
  removeMove: [index: number]
  addAbility: []
  removeAbility: [index: number]
  addManeuver: []
  removeManeuver: [index: number]
  addOrder: []
  removeOrder: [index: number]
  setOrderTags: [order: TrainerOrder, raw: string]
}>()
</script>

<template>
  <div class="trainer-combat-actions">
    <div class="block">
      <h2 class="block-title">
        Movelist
        <span class="move-lookup-note">name editable · details from moves.json</span>
        <button type="button" class="row-add" @click="emit('addMove')">
          <PhPlus :size="14" weight="bold" /> Add row
        </button>
      </h2>
      <table class="data-table movelist-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Cat.</th>
            <th>DB</th>
            <th>Damage Roll</th>
            <th>Frequency</th>
            <th>AC</th>
            <th>Range</th>
            <th>Effect</th>
            <th aria-label="Row actions"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, i) in moveRows" :key="i">
            <th>
              <EditableCell
                :model-value="row.move.name"
                placeholder="Move"
                @update:model-value="(v) => setLookupMoveName(row.move, v)"
              />
            </th>
            <td>
              <TypeBadge v-if="row.reference?.type" :type="row.reference.type" size="xs" />
              <span v-else class="badge-empty">—</span>
            </td>
            <td>
              <DamageClassBadge v-if="row.reference?.damage_class" :category="row.reference.damage_class" size="xs" />
              <span v-else class="badge-empty">—</span>
            </td>
            <td>{{ formatLookupValue(row.damageBase) }}</td>
            <td>{{ formatLookupValue(row.damageFormula) }}</td>
            <td>{{ formatLookupValue(row.reference?.frequency) }}</td>
            <td>{{ formatLookupValue(row.reference?.ac) }}</td>
            <td>{{ formatLookupValue(row.reference?.range) }}</td>
            <td class="effect-col">
              <span v-if="row.reference?.effect">{{ row.reference.effect }}</span>
              <span v-else class="badge-empty">{{ row.move.name.trim() ? 'No matching move in moves.json' : '—' }}</span>
            </td>
            <td class="row-actions">
              <button type="button" class="row-remove" title="Remove move" @click="emit('removeMove', i)">
                <PhX :size="14" weight="bold" />
              </button>
            </td>
          </tr>
          <tr v-if="!moveRows.length">
            <td colspan="10" class="muted">No moves yet — click "Add row" to start.</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="block">
      <h2 class="block-title">
        Abilities
        <span class="move-lookup-note">name editable · details from abilities.json</span>
        <button type="button" class="row-add" @click="emit('addAbility')">
          <PhPlus :size="14" weight="bold" /> Add row
        </button>
      </h2>
      <table class="data-table ability-table">
        <thead>
          <tr><th>Name</th><th>Frequency</th><th>Trigger</th><th>Effect</th><th aria-label="Row actions"></th></tr>
        </thead>
        <tbody>
          <tr v-for="(row, i) in abilityRows" :key="i">
            <th>
              <EditableCell
                :model-value="row.ability.name"
                placeholder="Ability"
                @update:model-value="(v) => setLookupAbilityName(row.ability, v)"
              />
            </th>
            <td>{{ formatLookupValue(row.reference?.frequency) }}</td>
            <td class="effect-col">{{ formatLookupValue(row.reference?.trigger) }}</td>
            <td class="effect-col">
              <span v-if="row.reference?.effect">{{ row.reference.effect }}</span>
              <span v-else class="badge-empty">{{ row.reference ? '—' : row.ability.name.trim() ? 'No matching ability in abilities.json' : '—' }}</span>
            </td>
            <td>
              <button type="button" class="row-remove" title="Remove ability" @click="emit('removeAbility', i)">
                <PhX :size="14" weight="bold" />
              </button>
            </td>
          </tr>
          <tr v-if="!abilityRows.length">
            <td colspan="5" class="muted">No abilities yet.</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="block">
      <h2 class="block-title">
        Maneuvers
        <button type="button" class="row-add" @click="emit('addManeuver')">
          <PhPlus :size="14" weight="bold" /> Add row
        </button>
      </h2>
      <table class="data-table">
        <thead><tr><th>Name</th><th>Action</th><th>Cat.</th><th>AC</th><th>Range</th><th>Effect</th><th aria-label="Row actions"></th></tr></thead>
        <tbody>
          <tr v-for="(m, i) in sheet.maneuvers" :key="i">
            <th><EditableCell v-model="m.name" placeholder="Maneuver" /></th>
            <td><EditableCell v-model="m.action" placeholder="Standard" /></td>
            <td>
              <EditableCell
                v-model="m.category"
                type="select"
                :options="CATEGORY_OPTIONS"
                placeholder="—"
              >
                <template #display="slotProps">
                  <DamageClassBadge v-if="!slotProps.empty" :category="String(slotProps.value)" size="xs" />
                  <span v-else class="badge-empty">{{ slotProps.emptyLabel }}</span>
                </template>
              </EditableCell>
            </td>
            <td><EditableCell v-model="m.ac" type="number" /></td>
            <td><EditableCell v-model="m.range" placeholder="Melee" /></td>
            <td class="effect-col">
              <EditableCell v-model="m.effect" type="textarea" placeholder="—" multiline />
            </td>
            <td class="row-actions">
              <button type="button" class="row-remove" title="Remove maneuver" @click="emit('removeManeuver', i)">
                <PhX :size="14" weight="bold" />
              </button>
            </td>
          </tr>
          <tr v-if="!sheet.maneuvers?.length">
            <td colspan="7" class="muted">No maneuvers yet.</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="block">
      <h2 class="block-title">
        Pokémon Training &amp; Orders
        <button type="button" class="row-add" @click="emit('addOrder')">
          <PhPlus :size="14" weight="bold" /> Add row
        </button>
      </h2>
      <ul class="kv-list">
        <li v-for="(o, i) in sheet.orders" :key="i">
          <span>
            <strong><EditableCell v-model="o.name" placeholder="Order" /></strong>
            <span class="muted"> · </span>
            <EditableCell
              :model-value="orderTagsCsv(o)"
              placeholder="Orders"
              @update:model-value="(v) => emit('setOrderTags', o, (v as string) ?? '')"
            />
          </span>
          <span class="effect-col">
            <EditableCell v-model="o.effect" type="textarea" placeholder="—" multiline />
          </span>
          <button type="button" class="row-remove" title="Remove order" @click="emit('removeOrder', i)">
            <PhX :size="14" weight="bold" />
          </button>
        </li>
        <li v-if="!sheet.orders?.length" class="muted">No orders yet.</li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.trainer-combat-actions {
  display: flex;
  flex-direction: column;
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
.move-lookup-note {
  color: var(--ink-muted);
  font-family: var(--font-ui);
  font-size: 0.72rem;
  font-weight: 400;
  letter-spacing: 0.02em;
  text-transform: none;
}

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

.movelist-table th,
.movelist-table td { vertical-align: top; }
.effect-col { color: var(--ink-soft); white-space: pre-wrap; max-width: 22rem; }
</style>

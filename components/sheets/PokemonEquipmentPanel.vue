<script setup lang="ts">
import type { CharacterSheet } from '~/types/characterSheet'
import type { PtuItem } from '~/types/ptuReference'

defineProps<{
  sheet: CharacterSheet
  heldItemName: string
  heldItemReference: PtuItem | null
}>()

const emit = defineEmits<{
  setHeldItemName: [value: unknown]
}>()
</script>

<template>
  <div class="row two-col">
    <section class="panel-card">
      <h2 class="panel-title">
        Held Item
        <span class="panel-subtle">name editable · details from items.json</span>
      </h2>
      <dl class="kv-list">
        <div>
          <dt>Held Item</dt>
          <dd>
            <span class="held-item-value">
              <ItemSprite :item="heldItemName" size="md" />
              <EditableCell
                :model-value="sheet.items!.held"
                placeholder="None"
                @update:model-value="emit('setHeldItemName', $event)"
              />
            </span>
          </dd>
        </div>
        <div>
          <dt>Effect</dt>
          <dd class="lookup-text">
            <template v-if="heldItemReference?.effects.length">
              <p v-for="effect in heldItemReference.effects" :key="effect">{{ effect }}</p>
            </template>
            <span v-else class="badge-empty">
              {{ heldItemName ? 'No matching item in items.json' : '—' }}
            </span>
          </dd>
        </div>
        <div v-if="heldItemReference?.notes.length">
          <dt>Notes</dt>
          <dd class="lookup-text">
            <p v-for="note in heldItemReference.notes" :key="note">{{ note }}</p>
          </dd>
        </div>
      </dl>
    </section>

    <section class="panel-card">
      <h2 class="panel-title">Weapon</h2>
      <dl class="kv-list">
        <div>
          <dt>Name</dt>
          <dd><EditableCell v-model="sheet.weapon!.name" placeholder="—" /></dd>
        </div>
        <div>
          <dt>DB Mod</dt>
          <dd><EditableCell v-model="sheet.weapon!.dbMod" type="number" /></dd>
        </div>
        <div>
          <dt>AC Mod</dt>
          <dd><EditableCell v-model="sheet.weapon!.acMod" type="number" /></dd>
        </div>
        <div>
          <dt>Description</dt>
          <dd>
            <EditableCell
              v-model="sheet.weapon!.description"
              type="textarea"
              placeholder="—"
              multiline
            />
          </dd>
        </div>
      </dl>
    </section>
  </div>
</template>

<style scoped>
.row {
  display: grid;
  gap: 0.85rem;
}

.row.two-col { grid-template-columns: repeat(2, minmax(0, 1fr)); }

@media (max-width: 980px) {
  .row.two-col { grid-template-columns: 1fr; }
}

.panel-title {
  margin: 0 0 0.6rem;
  font-family: var(--font-book);
  font-size: 1.1rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--ink-bright);
  text-transform: uppercase;
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
}

.panel-subtle {
  font-size: 0.74rem;
  color: var(--ink-muted);
  font-weight: 400;
  letter-spacing: 0.02em;
  text-transform: none;
  font-family: var(--font-ui);
}

.kv-list {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin: 0;
}

.kv-list > div {
  display: grid;
  grid-template-columns: minmax(120px, max-content) 1fr;
  gap: 0.6rem;
  align-items: baseline;
}

.kv-list dt {
  font-size: 0.74rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--ink-muted);
}

.kv-list dd {
  margin: 0;
  color: var(--ink-bright);
}

.held-item-value {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
}

.lookup-text {
  color: var(--ink-soft);
  font-size: 0.88rem;
  white-space: pre-wrap;
}

.lookup-text p { margin: 0; }
.lookup-text p + p { margin-top: 0.35rem; }
</style>

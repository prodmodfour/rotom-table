<script setup lang="ts">
import { computed } from 'vue'
import { equipmentActionPresentationsForItem } from '#shared/itemAutomation/equipmentActionPresentation'
import { encounterLibraryPath } from '#shared/encounterWorkspace/routes'

export interface EquipmentEncounterActionSourceView {
  readonly canonicalItemId: string
  readonly activityStatus: 'active' | 'inactive' | 'suppressed' | 'broken'
  readonly unavailableReason?: string | null
}

const props = defineProps<{
  sources: readonly EquipmentEncounterActionSourceView[]
}>()

const rows = computed(() => {
  const byAction = new Map<string, {
    action: ReturnType<typeof equipmentActionPresentationsForItem>[number]
    source: EquipmentEncounterActionSourceView
  }>()
  for (const source of props.sources) {
    for (const action of equipmentActionPresentationsForItem(source.canonicalItemId)) {
      const current = byAction.get(action.actionId)
      if (!current || (source.activityStatus === 'active' && current.source.activityStatus !== 'active')) {
        byAction.set(action.actionId, { action, source })
      }
    }
  }
  return [...byAction.values()]
})

const unavailableReason = (value: string | null | undefined): string | null => (
  value?.trim().replace(/[.]+$/u, '') || null
)
</script>

<template>
  <section v-if="rows.length" class="equipment-encounter-actions" aria-labelledby="equipment-encounter-actions-title">
    <header>
      <div>
        <p>Reviewed mechanics</p>
        <h3 id="equipment-encounter-actions-title">Live encounter actions</h3>
      </div>
      <NuxtLink :to="encounterLibraryPath()">Open encounters</NuxtLink>
    </header>
    <ul>
      <li v-for="row in rows" :key="row.action.actionId" :data-available="row.source.activityStatus === 'active'">
        <div>
          <strong>{{ row.action.label }}</strong>
          <span>{{ row.action.timingLabel }} · {{ row.action.targetLabel }}</span>
        </div>
        <p>{{ row.action.summary }}</p>
        <small v-if="row.source.activityStatus === 'active'">
          Offered from the Action Dock only when current target, terrain, timing, and resource authority allow it.
        </small>
        <small v-else>
          Unavailable while this item is {{ row.source.activityStatus }}<template v-if="unavailableReason(row.source.unavailableReason)"> · {{ unavailableReason(row.source.unavailableReason) }}</template>.
        </small>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.equipment-encounter-actions {
  display: grid;
  gap: .65rem;
  margin-top: .8rem;
  border-top: 1px solid var(--rt-border, var(--rule-soft));
  padding-top: .75rem;
}
.equipment-encounter-actions > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: .75rem;
}
.equipment-encounter-actions header p {
  margin: 0 0 .12rem;
  color: var(--rt-info, var(--accent));
  font-size: .68rem;
  font-weight: 850;
  letter-spacing: .09em;
  text-transform: uppercase;
}
.equipment-encounter-actions h3 {
  margin: 0;
  color: var(--rt-text-strong, var(--ink-bright));
  font-size: .92rem;
}
.equipment-encounter-actions header a {
  min-height: 2.75rem;
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
  border: 1px solid var(--rt-border-strong, var(--rule));
  border-radius: var(--rt-radius-small, 6px);
  color: var(--rt-text-strong, var(--ink-bright));
  padding: .4rem .65rem;
  font-size: .74rem;
  font-weight: 750;
  text-decoration: none;
}
.equipment-encounter-actions ul {
  display: grid;
  gap: .45rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.equipment-encounter-actions li {
  display: grid;
  gap: .28rem;
  border-left: 3px solid var(--rt-border-strong, var(--rule));
  background: var(--rt-surface-2, var(--paper-inset));
  padding: .6rem .7rem;
}
.equipment-encounter-actions li[data-available='true'] { border-left-color: var(--rt-success, var(--accent)); }
.equipment-encounter-actions li > div {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: .6rem;
}
.equipment-encounter-actions strong { color: var(--rt-text-strong, var(--ink-bright)); }
.equipment-encounter-actions span,
.equipment-encounter-actions small { color: var(--rt-text-muted, var(--ink-muted)); font-size: .72rem; }
.equipment-encounter-actions p { margin: 0; color: var(--rt-text, var(--ink-soft)); font-size: .8rem; line-height: 1.4; }
.equipment-encounter-actions header a:focus-visible { outline: 3px solid var(--rt-focus, var(--accent)); outline-offset: 2px; }
@media (max-width: 38rem) {
  .equipment-encounter-actions > header,
  .equipment-encounter-actions li > div { align-items: stretch; flex-direction: column; }
  .equipment-encounter-actions header a { width: 100%; justify-content: center; }
}
</style>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { formatCombatStage } from '~/utils/combatStageStats'
import type { TokenContextMenuState } from '~/utils/isometric/contextMenu'
import type { TokenMoveMenuOption } from '~/utils/mapTokenMoves'

const props = defineProps<{
  menu: TokenContextMenuState
  canDeleteTokens?: boolean
  moves?: TokenMoveMenuOption[]
}>()

const emit = defineEmits<{
  (event: 'view-sheet'): void
  (event: 'view-pokedex'): void
  (event: 'turn'): void
  (event: 'modify-hp'): void
  (event: 'modify-combat-stages'): void
  (event: 'apply-remove-conditions'): void
  (event: 'use-move', moveName?: string | null): void
  (event: 'deal-damage'): void
  (event: 'delete'): void
}>()

const movePanelOpen = ref(false)
const hoveredMoveName = ref<string | null>(null)

const moves = computed(() => props.moves ?? [])
const hoveredMove = computed(() =>
  moves.value.find((move) => move.name === hoveredMoveName.value) ?? moves.value[0] ?? null,
)

const openMovePanel = () => {
  movePanelOpen.value = true
  hoveredMoveName.value = moves.value[0]?.name ?? null
}

const closeMovePanel = () => {
  movePanelOpen.value = false
  hoveredMoveName.value = null
}

watch(() => props.menu.id, () => closeMovePanel())

const handleSubmenuFocusOut = (event: FocusEvent) => {
  const current = event.currentTarget
  const next = event.relatedTarget
  if (current instanceof HTMLElement && next instanceof Node && current.contains(next)) return
  closeMovePanel()
}

const stageLabel = (move: TokenMoveMenuOption): string | null => {
  if (move.attackStage == null || move.baseAttackStat == null || move.attackStat == null) return null
  if (move.attackStage === 0) return `${move.attackStat}`
  return `${move.baseAttackStat} @ ${formatCombatStage(move.attackStage)} CS → ${move.attackStat}`
}
</script>

<template>
  <div
    class="context-menu"
    :style="{ left: `${props.menu.x}px`, top: `${props.menu.y}px` }"
    @contextmenu.prevent
    @pointerdown.stop
  >
    <div
      class="context-menu__submenu-wrap"
      @pointerenter="openMovePanel"
      @pointerleave="closeMovePanel"
      @focusin="openMovePanel"
      @focusout="handleSubmenuFocusOut"
    >
      <button
        type="button"
        class="context-menu__button context-menu__button--submenu"
        :aria-expanded="movePanelOpen"
        aria-haspopup="menu"
        @click.stop="openMovePanel"
      >
        <span>Use Move</span>
        <span class="context-menu__chevron">›</span>
      </button>

      <div v-if="movePanelOpen" class="move-submenu" role="menu">
        <div class="move-submenu__list" aria-label="Moves">
          <button
            v-for="move in moves"
            :key="move.name"
            type="button"
            class="move-submenu__item"
            :class="{ 'is-active': hoveredMove?.name === move.name }"
            role="menuitem"
            @pointerenter="hoveredMoveName = move.name"
            @focus="hoveredMoveName = move.name"
            @click.stop="emit('use-move', move.name)"
          >
            <span class="move-submenu__name">{{ move.name }}</span>
            <span class="move-submenu__badges">
              <TypeBadge v-if="move.type" :type="move.type" size="xs" />
              <DamageClassBadge v-if="move.damageClass" :category="move.damageClass" size="xs" />
              <span v-if="move.damageBase != null" class="move-submenu__badge">DB {{ move.damageBase }}</span>
              <span v-if="move.hasStab" class="move-submenu__badge move-submenu__badge--stab">STAB</span>
              <span v-if="move.automatic" class="move-submenu__badge">Auto</span>
            </span>
          </button>

          <div v-if="!moves.length" class="move-submenu__empty">
            This sheet has no moves.
          </div>
        </div>

        <aside v-if="hoveredMove" class="move-tooltip" aria-live="polite">
          <header class="move-tooltip__header">
            <strong>{{ hoveredMove.name }}</strong>
            <span class="move-tooltip__pills">
              <TypeBadge v-if="hoveredMove.type" :type="hoveredMove.type" size="xs" />
              <DamageClassBadge v-if="hoveredMove.damageClass" :category="hoveredMove.damageClass" size="xs" />
            </span>
          </header>

          <dl class="move-tooltip__stats">
            <div v-if="hoveredMove.damageBase != null">
              <dt>DB</dt>
              <dd>
                {{ hoveredMove.damageBase }}
                <span v-if="hoveredMove.hasStab" class="move-tooltip__note">STAB included</span>
              </dd>
            </div>
            <div v-if="hoveredMove.damageFormula">
              <dt>Damage</dt>
              <dd>{{ hoveredMove.damageFormula }}</dd>
            </div>
            <div v-if="stageLabel(hoveredMove)">
              <dt>Stat</dt>
              <dd>{{ stageLabel(hoveredMove) }}</dd>
            </div>
            <div v-if="hoveredMove.frequency">
              <dt>Freq</dt>
              <dd>{{ hoveredMove.frequency }}</dd>
            </div>
            <div v-if="hoveredMove.ac != null">
              <dt>AC</dt>
              <dd>{{ hoveredMove.ac }}</dd>
            </div>
            <div v-if="hoveredMove.range">
              <dt>Range</dt>
              <dd>{{ hoveredMove.range }}</dd>
            </div>
          </dl>

          <p v-if="hoveredMove.effect" class="move-tooltip__effect">{{ hoveredMove.effect }}</p>
          <p v-else class="move-tooltip__effect is-muted">No effect text in moves.json.</p>
        </aside>
      </div>
    </div>

    <button
      type="button"
      class="context-menu__button"
      @click.stop="emit('view-sheet')"
    >
      View Sheet
    </button>
    <button
      v-if="props.menu.canViewPokedex"
      type="button"
      class="context-menu__button"
      @click.stop="emit('view-pokedex')"
    >
      View in Pokédex
    </button>
    <button
      v-if="props.menu.canTurn"
      type="button"
      class="context-menu__button"
      @click.stop="emit('turn')"
    >
      Turn sprite
    </button>
    <button
      type="button"
      class="context-menu__button"
      @click.stop="emit('modify-hp')"
    >
      Modify HP
    </button>
    <button
      type="button"
      class="context-menu__button"
      @click.stop="emit('modify-combat-stages')"
    >
      Change combat stages
    </button>
    <button
      type="button"
      class="context-menu__button"
      @click.stop="emit('apply-remove-conditions')"
    >
      Apply/Remove Conditions
    </button>

    <button
      type="button"
      class="context-menu__button"
      @click.stop="emit('deal-damage')"
    >
      Deal damage
    </button>
    <button
      v-if="props.canDeleteTokens"
      type="button"
      class="context-menu__button"
      @click.stop="emit('delete')"
    >
      Delete
    </button>
  </div>
</template>

<style scoped>
.context-menu {
  position: absolute;
  z-index: 8;
  min-width: 160px;
  padding: 0.4rem;
  border: 1px solid var(--rule-soft);
  border-radius: 12px;
  background: var(--paper-soft);
  box-shadow: var(--shadow-card);
  backdrop-filter: blur(8px);
}

.context-menu__button {
  width: 100%;
  border: 1px solid var(--rule-soft);
  border-radius: 8px;
  background: var(--paper);
  color: var(--ink);
  padding: 0.6rem 0.8rem;
  text-align: left;
  cursor: pointer;
  letter-spacing: 0.02em;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.context-menu__button + .context-menu__button,
.context-menu__submenu-wrap + .context-menu__button,
.context-menu__button + .context-menu__submenu-wrap {
  margin-top: 0.3rem;
}

.context-menu__button:hover,
.context-menu__button:focus-visible,
.context-menu__submenu-wrap:hover > .context-menu__button {
  border-color: var(--rule-strong);
  background: var(--paper-hover);
  color: var(--ink-bright);
}

.context-menu__button--submenu {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.8rem;
}

.context-menu__chevron {
  color: var(--ink-muted);
  font-size: 1.1rem;
  line-height: 1;
}

.context-menu__submenu-wrap {
  position: relative;
}

.move-submenu {
  position: absolute;
  left: calc(100% + 0.45rem);
  top: 0;
  display: grid;
  grid-template-columns: minmax(220px, 280px) minmax(260px, 340px);
  gap: 0.45rem;
  max-width: min(680px, calc(100vw - 2rem));
  z-index: 9;
}

.move-submenu__list,
.move-tooltip {
  border: 1px solid var(--rule-soft);
  border-radius: 12px;
  background: var(--paper-soft);
  box-shadow: var(--shadow-card);
  backdrop-filter: blur(8px);
}

.move-submenu__list {
  max-height: min(70vh, 30rem);
  overflow: auto;
  padding: 0.35rem;
}

.move-submenu__item {
  display: grid;
  gap: 0.3rem;
  width: 100%;
  border: 1px solid transparent;
  border-radius: 9px;
  background: transparent;
  color: var(--ink);
  padding: 0.5rem 0.55rem;
  text-align: left;
  cursor: pointer;
}

.move-submenu__item:hover,
.move-submenu__item:focus-visible,
.move-submenu__item.is-active {
  border-color: var(--rule-soft);
  background: var(--paper-hover);
  color: var(--ink-bright);
}

.move-submenu__name {
  font-weight: 900;
}

.move-submenu__badges,
.move-tooltip__pills {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  align-items: center;
}

.move-submenu__badge {
  display: inline-flex;
  align-items: center;
  min-height: 1.35rem;
  padding: 0.12rem 0.45rem;
  border: 1px solid var(--rule-soft);
  border-radius: 999px;
  background: var(--paper);
  color: var(--ink-muted);
  font-size: 0.7rem;
  font-weight: 800;
  text-transform: uppercase;
}

.move-submenu__badge--stab,
.move-tooltip__note {
  color: var(--accent);
}

.move-submenu__empty {
  padding: 0.7rem;
  color: var(--ink-muted);
  font-size: 0.84rem;
}

.move-tooltip {
  max-height: min(70vh, 30rem);
  overflow: auto;
  padding: 0.75rem;
}

.move-tooltip__header {
  display: flex;
  justify-content: space-between;
  gap: 0.6rem;
  align-items: flex-start;
}

.move-tooltip__stats {
  display: grid;
  gap: 0.35rem;
  margin: 0.7rem 0;
}

.move-tooltip__stats div {
  display: grid;
  grid-template-columns: 4.5rem minmax(0, 1fr);
  gap: 0.45rem;
}

.move-tooltip__stats dt {
  color: var(--ink-muted);
  font-size: 0.72rem;
  font-weight: 900;
  text-transform: uppercase;
}

.move-tooltip__stats dd {
  margin: 0;
  color: var(--ink-bright);
  font-variant-numeric: tabular-nums;
}

.move-tooltip__note {
  margin-left: 0.25rem;
  font-size: 0.72rem;
  font-weight: 800;
  text-transform: uppercase;
}

.move-tooltip__effect {
  margin: 0;
  color: var(--ink-muted);
  font-size: 0.84rem;
  line-height: 1.45;
}

.move-tooltip__effect.is-muted {
  font-style: italic;
}

@media (max-width: 860px) {
  .move-submenu {
    grid-template-columns: minmax(220px, 1fr);
  }
}
</style>

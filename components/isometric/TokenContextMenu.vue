<script setup lang="ts">
import type { TokenContextMenuState } from '~/utils/isometric/contextMenu'

const props = defineProps<{
  menu: TokenContextMenuState
  canDeleteTokens?: boolean
}>()

const emit = defineEmits<{
  (event: 'view-sheet'): void
  (event: 'view-pokedex'): void
  (event: 'turn'): void
  (event: 'modify-hp'): void
  (event: 'modify-combat-stages'): void
  (event: 'apply-remove-conditions'): void
  (event: 'use-move'): void
  (event: 'deal-damage'): void
  (event: 'delete'): void
}>()
</script>

<template>
  <div
    class="context-menu"
    :style="{ left: `${props.menu.x}px`, top: `${props.menu.y}px` }"
    @contextmenu.prevent
    @pointerdown.stop
  >
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
      @click.stop="emit('use-move')"
    >
      Use Move
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

.context-menu__button + .context-menu__button {
  margin-top: 0.3rem;
}

.context-menu__button:hover {
  border-color: var(--rule-strong);
  background: var(--paper-hover);
  color: var(--ink-bright);
}
</style>

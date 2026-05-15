<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import ReferenceTooltip from '~/components/reference/ReferenceTooltip.vue'
import { useAnchoredTooltip } from '~/composables/reference/useAnchoredTooltip'
import type { TokenContextMenuState } from '~/utils/isometric/contextMenu'
import type { TokenMoveMenuOption } from '~/utils/mapTokenMoves'
import { buildTokenMoveTooltipDetail } from '~/utils/mapTokenMoveTooltips'
import type { TokenSendOutOption } from '~/utils/mapTokenSendOut'

const props = defineProps<{
  menu: TokenContextMenuState
  canDeleteTokens?: boolean
  moves?: TokenMoveMenuOption[]
  sendOutOptions?: TokenSendOutOption[]
}>()

const emit = defineEmits<{
  (event: 'view-sheet'): void
  (event: 'view-pokedex'): void
  (event: 'turn'): void
  (event: 'modify-hp'): void
  (event: 'modify-combat-stages'): void
  (event: 'apply-remove-conditions'): void
  (event: 'use-move', moveName?: string | null): void
  (event: 'send-out-pokemon', pokemonSlug: string): void
  (event: 'deal-damage'): void
  (event: 'delete'): void
}>()

type ActiveContextPanel = 'main' | 'moves' | 'sendOut'

const activePanel = ref<ActiveContextPanel>('main')
const hoveredMoveName = ref<string | null>(null)
const moveTooltipId = useId()

const moves = computed(() => props.moves ?? [])
const sendOutOptions = computed(() => props.sendOutOptions ?? [])
const hoveredMove = computed(() =>
  moves.value.find((move) => move.name === hoveredMoveName.value) ?? null,
)
const hoveredMoveTooltipDetail = computed(() =>
  hoveredMove.value ? buildTokenMoveTooltipDetail(hoveredMove.value) : null,
)

const {
  anchorEl: moveTooltipAnchorEl,
  tooltipComponent: moveTooltipComponent,
  isTooltipVisible: isMoveTooltipVisible,
  tooltipReady: isMoveTooltipReady,
  tooltipPlacement: moveTooltipPlacement,
  tooltipStyle: anchoredMoveTooltipStyle,
  showTooltip: showAnchoredMoveTooltip,
  hideTooltipNow: hideAnchoredMoveTooltip,
} = useAnchoredTooltip(() => activePanel.value === 'moves' && Boolean(hoveredMoveTooltipDetail.value))

const moveTooltipStyle = computed(() => ({
  ...anchoredMoveTooltipStyle.value,
  zIndex: 12050,
}))

const setMoveTooltipAnchor = (event: Event): boolean => {
  if (!(event.currentTarget instanceof HTMLElement)) return false
  moveTooltipAnchorEl.value = event.currentTarget
  return true
}

const hideMoveTooltip = () => {
  hoveredMoveName.value = null
  moveTooltipAnchorEl.value = null
  hideAnchoredMoveTooltip()
}

const showMoveTooltip = async (moveName: string, event: Event) => {
  hoveredMoveName.value = moveName
  if (!setMoveTooltipAnchor(event)) {
    hideMoveTooltip()
    return
  }
  await showAnchoredMoveTooltip()
}

const resetContextPanel = () => {
  hideMoveTooltip()
  activePanel.value = 'main'
}

const openMovePanel = () => {
  hideMoveTooltip()
  activePanel.value = 'moves'
}

const openSendOutPanel = () => {
  hideMoveTooltip()
  activePanel.value = 'sendOut'
}

watch(() => props.menu.id, () => resetContextPanel())

watch(moves, (nextMoves) => {
  if (activePanel.value !== 'moves' || !hoveredMoveName.value) return
  if (nextMoves.some((move) => move.name === hoveredMoveName.value)) return
  hideMoveTooltip()
})

</script>

<template>
  <Teleport to="body">
    <div
      class="context-menu"
      :style="{ left: `${props.menu.x}px`, top: `${props.menu.y}px` }"
      @contextmenu.prevent
      @pointerdown.stop
    >
      <template v-if="activePanel === 'main'">
        <button
          type="button"
          class="context-menu__button context-menu__button--submenu"
          aria-haspopup="menu"
          @click.stop="openMovePanel"
        >
          <span>Use Move</span>
          <span class="context-menu__chevron">›</span>
        </button>

        <button
          v-if="props.menu.canSendOut"
          type="button"
          class="context-menu__button context-menu__button--submenu"
          aria-haspopup="menu"
          @click.stop="openSendOutPanel"
        >
          <span>Send Out Pokémon</span>
          <span class="context-menu__chevron">›</span>
        </button>

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
      </template>

      <template v-else-if="activePanel === 'moves'">
        <button
          type="button"
          class="context-menu__button context-menu__button--back"
          @click.stop="resetContextPanel"
        >
          <span class="context-menu__back-icon" aria-hidden="true">‹</span>
          <span>Back</span>
        </button>

        <p class="context-menu__submenu-title">Use Move</p>

        <div class="move-submenu">
          <div class="move-submenu__list" role="menu" aria-label="Moves">
            <button
              v-for="move in moves"
              :key="move.name"
              type="button"
              class="move-submenu__item"
              :class="{ 'is-active': hoveredMoveName === move.name }"
              role="menuitem"
              :aria-describedby="hoveredMoveName === move.name && hoveredMoveTooltipDetail && isMoveTooltipVisible ? moveTooltipId : undefined"
              @pointerenter="showMoveTooltip(move.name, $event)"
              @pointerleave="hideMoveTooltip"
              @focus="showMoveTooltip(move.name, $event)"
              @blur="hideMoveTooltip"
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

            <div v-if="!moves.length" class="context-menu__empty">
              This sheet has no moves.
            </div>
          </div>

          <Teleport to="body">
            <ReferenceTooltip
              v-if="hoveredMoveTooltipDetail && isMoveTooltipVisible"
              :id="moveTooltipId"
              ref="moveTooltipComponent"
              :detail="hoveredMoveTooltipDetail"
              :placement="moveTooltipPlacement"
              :ready="isMoveTooltipReady"
              :style="moveTooltipStyle"
            />
          </Teleport>
        </div>
      </template>

      <template v-else-if="activePanel === 'sendOut'">
        <button
          type="button"
          class="context-menu__button context-menu__button--back"
          @click.stop="resetContextPanel"
        >
          <span class="context-menu__back-icon" aria-hidden="true">‹</span>
          <span>Back</span>
        </button>

        <p class="context-menu__submenu-title">Send Out Pokémon</p>

        <div class="sendout-submenu" role="menu" aria-label="Send out Pokémon">
          <button
            v-for="option in sendOutOptions"
            :key="option.pokemonSlug"
            type="button"
            class="sendout-submenu__item"
            role="menuitem"
            @click.stop="emit('send-out-pokemon', option.pokemonSlug)"
          >
            <img
              v-if="option.spriteUrl"
              class="sendout-submenu__sprite"
              :src="option.spriteUrl"
              alt=""
              loading="lazy"
            >
            <span class="sendout-submenu__text">
              <strong>{{ option.label }}</strong>
              <small>Lv {{ option.level }} · {{ option.species }}</small>
            </span>
          </button>

          <div v-if="!sendOutOptions.length" class="context-menu__empty">
            This trainer has no linked team Pokémon.
          </div>
        </div>
      </template>
    </div>
  </Teleport>
</template>

<style scoped>
.context-menu {
  position: fixed;
  z-index: 11000;
  width: min(230px, calc(100vw - 1.5rem));
  max-height: calc(100vh - 1.5rem);
  overflow: visible;
  padding: 0.4rem;
  border: 1px solid var(--rule-soft);
  border-radius: 12px;
  background: var(--paper-soft);
  box-shadow: var(--shadow-card);
  backdrop-filter: blur(8px);
  box-sizing: border-box;
}

.context-menu,
.context-menu * {
  box-sizing: border-box;
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
.context-menu__button + .context-menu__submenu-title,
.context-menu__submenu-title + .move-submenu,
.context-menu__submenu-title + .sendout-submenu {
  margin-top: 0.3rem;
}

.context-menu__button:hover,
.context-menu__button:focus-visible {
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

.context-menu__button--back {
  display: inline-flex;
  align-items: center;
  justify-content: flex-start;
  gap: 0.45rem;
}

.context-menu__chevron,
.context-menu__back-icon {
  color: var(--ink-muted);
  font-size: 1.1rem;
  line-height: 1;
}

.context-menu__submenu-title {
  margin: 0;
  color: var(--ink-muted);
  font-size: 0.72rem;
  font-weight: 900;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.move-submenu {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 0.45rem;
}

.sendout-submenu {
  max-height: min(70vh, 24rem);
  overflow: auto;
  padding: 0.35rem;
  border: 1px solid var(--rule-soft);
  border-radius: 12px;
  background: var(--paper-soft);
  box-shadow: var(--shadow-card);
  backdrop-filter: blur(8px);
}

.move-submenu__list {
  max-height: min(42vh, 18rem);
  overflow: auto;
  padding: 0.35rem;
  border: 1px solid var(--rule-soft);
  border-radius: 12px;
  background: var(--paper-soft);
  box-shadow: var(--shadow-card);
  backdrop-filter: blur(8px);
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
.move-submenu__item.is-active,
.sendout-submenu__item:hover,
.sendout-submenu__item:focus-visible {
  border-color: var(--rule-soft);
  background: var(--paper-hover);
  color: var(--ink-bright);
}

.sendout-submenu__item {
  display: grid;
  grid-template-columns: 2.4rem minmax(0, 1fr);
  gap: 0.55rem;
  align-items: center;
  width: 100%;
  border: 1px solid transparent;
  border-radius: 9px;
  background: transparent;
  color: var(--ink);
  padding: 0.45rem 0.55rem;
  text-align: left;
  cursor: pointer;
}

.sendout-submenu__sprite {
  width: 2.2rem;
  height: 2.2rem;
  object-fit: contain;
  image-rendering: pixelated;
}

.sendout-submenu__text {
  display: grid;
  gap: 0.12rem;
  min-width: 0;
}

.sendout-submenu__text strong,
.sendout-submenu__text small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sendout-submenu__text small {
  color: var(--ink-muted);
  font-size: 0.74rem;
  font-weight: 800;
}

.move-submenu__name {
  font-weight: 900;
}

.move-submenu__badges {
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

.move-submenu__badge--stab {
  color: var(--accent);
}

.context-menu__empty {
  padding: 0.7rem;
  color: var(--ink-muted);
  font-size: 0.84rem;
}

</style>

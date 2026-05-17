<script setup lang="ts">
import { computed, ref, useId, watch, type ComputedRef } from 'vue'
import ReferenceTooltip from '~/components/reference/ReferenceTooltip.vue'
import { useAnchoredTooltip } from '~/composables/reference/useAnchoredTooltip'
import type { TokenContextMenuState } from '~/utils/isometric/contextMenu'
import type { TokenAbilityMenuOption } from '~/utils/mapTokenAbilities'
import { buildTokenAbilityTooltipDetail } from '~/utils/mapTokenAbilityTooltips'
import type { TokenMoveMenuOption } from '~/utils/mapTokenMoves'
import { buildTokenMoveTooltipDetail } from '~/utils/mapTokenMoveTooltips'
import type { RefTooltipDetail } from '~/utils/refLinks'
import type { TokenSendOutOption } from '~/utils/mapTokenSendOut'

const props = defineProps<{
  menu: TokenContextMenuState
  canDeleteTokens?: boolean
  moves?: TokenMoveMenuOption[]
  abilities?: TokenAbilityMenuOption[]
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
  (event: 'use-ability', abilityName?: string | null): void
  (event: 'send-out-pokemon', pokemonSlug: string): void
  (event: 'deal-damage'): void
  (event: 'delete'): void
}>()

type ActiveContextPanel = 'main' | 'moves' | 'abilities' | 'sendOut'

interface NamedMenuItem {
  name: string
}

const activePanel = ref<ActiveContextPanel>('main')

const moves = computed(() => props.moves ?? [])
const abilities = computed(() => props.abilities ?? [])
const sendOutOptions = computed(() => props.sendOutOptions ?? [])

const abilityCanBeUsed = (ability: TokenAbilityMenuOption): boolean =>
  ability.automation != null && ability.automation.category !== 'passive'

const moveCanBeUsed = (move: TokenMoveMenuOption): boolean =>
  move.hasAutomationScript && !move.disabledByCondition

const moveDisabledTitle = (move: TokenMoveMenuOption): string | undefined => {
  if (move.disabledByCondition) return `${move.name} is Disabled and cannot be used.`
  if (!move.hasAutomationScript) return `${move.name} does not have an automation script yet.`
  return undefined
}

const createSubmenuTooltipController = <TItem extends NamedMenuItem>(options: {
  panel: ActiveContextPanel
  items: ComputedRef<TItem[]>
  buildDetail: (item: TItem) => RefTooltipDetail
}) => {
  const hoveredName = ref<string | null>(null)
  const tooltipId = useId()
  const hoveredItem = computed(() =>
    options.items.value.find((item) => item.name === hoveredName.value) ?? null,
  )
  const tooltipDetail = computed(() =>
    hoveredItem.value ? options.buildDetail(hoveredItem.value) : null,
  )

  const {
    anchorEl,
    tooltipComponent,
    isTooltipVisible,
    tooltipReady,
    tooltipPlacement,
    tooltipStyle: anchoredTooltipStyle,
    showTooltip: showAnchoredTooltip,
    hideTooltipNow: hideAnchoredTooltip,
  } = useAnchoredTooltip(() => activePanel.value === options.panel && Boolean(tooltipDetail.value))

  const tooltipStyle = computed(() => ({
    ...anchoredTooltipStyle.value,
    zIndex: 12050,
  }))

  const setTooltipAnchor = (event: Event): boolean => {
    if (!(event.currentTarget instanceof HTMLElement)) return false
    anchorEl.value = event.currentTarget
    return true
  }

  const hideTooltip = () => {
    hoveredName.value = null
    anchorEl.value = null
    hideAnchoredTooltip()
  }

  const showTooltip = async (name: string, event: Event) => {
    hoveredName.value = name
    if (!setTooltipAnchor(event)) {
      hideTooltip()
      return
    }
    await showAnchoredTooltip()
  }

  return {
    hoveredName,
    tooltipId,
    tooltipComponent,
    isTooltipVisible,
    tooltipReady,
    tooltipPlacement,
    tooltipStyle,
    tooltipDetail,
    showTooltip,
    hideTooltip,
  }
}

const {
  hoveredName: hoveredMoveName,
  tooltipId: moveTooltipId,
  tooltipComponent: moveTooltipComponent,
  isTooltipVisible: isMoveTooltipVisible,
  tooltipReady: isMoveTooltipReady,
  tooltipPlacement: moveTooltipPlacement,
  tooltipStyle: moveTooltipStyle,
  tooltipDetail: hoveredMoveTooltipDetail,
  showTooltip: showMoveTooltip,
  hideTooltip: hideMoveTooltip,
} = createSubmenuTooltipController<TokenMoveMenuOption>({
  panel: 'moves',
  items: moves,
  buildDetail: buildTokenMoveTooltipDetail,
})

const {
  hoveredName: hoveredAbilityName,
  tooltipId: abilityTooltipId,
  tooltipComponent: abilityTooltipComponent,
  isTooltipVisible: isAbilityTooltipVisible,
  tooltipReady: isAbilityTooltipReady,
  tooltipPlacement: abilityTooltipPlacement,
  tooltipStyle: abilityTooltipStyle,
  tooltipDetail: hoveredAbilityTooltipDetail,
  showTooltip: showAbilityTooltip,
  hideTooltip: hideAbilityTooltip,
} = createSubmenuTooltipController<TokenAbilityMenuOption>({
  panel: 'abilities',
  items: abilities,
  buildDetail: buildTokenAbilityTooltipDetail,
})

const hideSubmenuTooltips = () => {
  hideMoveTooltip()
  hideAbilityTooltip()
}

const resetContextPanel = () => {
  hideSubmenuTooltips()
  activePanel.value = 'main'
}

const openMovePanel = () => {
  hideSubmenuTooltips()
  activePanel.value = 'moves'
}

const openAbilityPanel = () => {
  hideSubmenuTooltips()
  activePanel.value = 'abilities'
}

const openSendOutPanel = () => {
  hideSubmenuTooltips()
  activePanel.value = 'sendOut'
}

watch(() => props.menu.id, () => resetContextPanel())

watch(moves, (nextMoves) => {
  if (activePanel.value !== 'moves' || !hoveredMoveName.value) return
  if (nextMoves.some((move) => move.name === hoveredMoveName.value)) return
  hideMoveTooltip()
})

watch(abilities, (nextAbilities) => {
  if (activePanel.value !== 'abilities' || !hoveredAbilityName.value) return
  if (nextAbilities.some((ability) => ability.name === hoveredAbilityName.value)) return
  hideAbilityTooltip()
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
          type="button"
          class="context-menu__button context-menu__button--submenu"
          aria-haspopup="menu"
          @click.stop="openAbilityPanel"
        >
          <span>Use Ability</span>
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

        <div class="action-submenu">
          <div class="action-submenu__list" role="menu" aria-label="Moves">
            <button
              v-for="move in moves"
              :key="move.name"
              type="button"
              class="action-submenu__item"
              :class="{ 'is-active': hoveredMoveName === move.name, 'is-disabled': !moveCanBeUsed(move) }"
              role="menuitem"
              :aria-disabled="!moveCanBeUsed(move) ? 'true' : undefined"
              :title="moveDisabledTitle(move)"
              :aria-describedby="hoveredMoveName === move.name && hoveredMoveTooltipDetail && isMoveTooltipVisible ? moveTooltipId : undefined"
              :disabled="!moveCanBeUsed(move)"
              @pointerenter="showMoveTooltip(move.name, $event)"
              @pointerleave="hideMoveTooltip"
              @focus="showMoveTooltip(move.name, $event)"
              @blur="hideMoveTooltip"
              @click.stop="emit('use-move', move.name)"
            >
              <span class="action-submenu__name">{{ move.name }}</span>
              <span class="action-submenu__badges">
                <TypeBadge v-if="move.type" :type="move.type" size="xs" />
                <DamageClassBadge v-if="move.damageClass" :category="move.damageClass" size="xs" />
                <span v-if="move.damageBase != null" class="action-submenu__badge">DB {{ move.damageBase }}</span>
                <span v-if="move.hasStab" class="action-submenu__badge action-submenu__badge--stab">STAB</span>
                <span v-if="move.automatic" class="action-submenu__badge">Auto</span>
                <span v-if="!move.hasAutomationScript" class="action-submenu__badge action-submenu__badge--disabled">Unscripted</span>
                <span v-if="move.disabledByCondition" class="action-submenu__badge action-submenu__badge--disabled">Disabled</span>
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

      <template v-else-if="activePanel === 'abilities'">
        <button
          type="button"
          class="context-menu__button context-menu__button--back"
          @click.stop="resetContextPanel"
        >
          <span class="context-menu__back-icon" aria-hidden="true">‹</span>
          <span>Back</span>
        </button>

        <p class="context-menu__submenu-title">Use Ability</p>

        <div class="action-submenu">
          <div class="action-submenu__list" role="menu" aria-label="Abilities">
            <button
              v-for="ability in abilities"
              :key="ability.name"
              type="button"
              class="action-submenu__item"
              :class="{
                'is-active': hoveredAbilityName === ability.name,
                'is-disabled': !abilityCanBeUsed(ability),
              }"
              role="menuitem"
              :aria-disabled="!abilityCanBeUsed(ability)"
              :aria-describedby="hoveredAbilityName === ability.name && hoveredAbilityTooltipDetail && isAbilityTooltipVisible ? abilityTooltipId : undefined"
              @pointerenter="showAbilityTooltip(ability.name, $event)"
              @pointerleave="hideAbilityTooltip"
              @focus="showAbilityTooltip(ability.name, $event)"
              @blur="hideAbilityTooltip"
              @click.stop="abilityCanBeUsed(ability) && emit('use-ability', ability.name)"
            >
              <span class="action-submenu__name">{{ ability.name }}</span>
              <span class="action-submenu__badges">
                <span
                  v-if="ability.automation"
                  class="action-submenu__badge"
                  :class="`action-submenu__badge--${ability.automation.category}`"
                >
                  {{ ability.automation.label }}
                </span>
                <span v-else class="action-submenu__badge">Manual</span>
                <span v-if="ability.activated" class="action-submenu__badge action-submenu__badge--active">Active</span>
              </span>
            </button>

            <div v-if="!abilities.length" class="context-menu__empty">
              This sheet has no abilities.
            </div>
          </div>

          <Teleport to="body">
            <ReferenceTooltip
              v-if="hoveredAbilityTooltipDetail && isAbilityTooltipVisible"
              :id="abilityTooltipId"
              ref="abilityTooltipComponent"
              :detail="hoveredAbilityTooltipDetail"
              :placement="abilityTooltipPlacement"
              :ready="isAbilityTooltipReady"
              :style="abilityTooltipStyle"
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
  --paper: rgba(5, 6, 8, 0.48);
  --paper-soft: rgba(12, 14, 18, 0.68);
  --paper-hover: rgba(255, 255, 255, 0.11);
  --paper-active: rgba(255, 31, 45, 0.20);
  --paper-inset: rgba(5, 6, 8, 0.38);
  --rule-soft: rgba(255, 255, 255, 0.26);
  --rule-strong: rgba(255, 31, 45, 0.58);
  --shadow-card:
    0 18px 52px rgba(0, 0, 0, 0.38),
    inset 0 1px 0 rgba(255, 255, 255, 0.12);

  position: fixed;
  z-index: 11000;
  width: min(230px, calc(100vw - 1.5rem));
  max-height: calc(100vh - 1.5rem);
  overflow: visible;
  padding: 0.4rem;
  border: 1px solid rgba(255, 255, 255, 0.26);
  border-radius: 12px;
  background:
    linear-gradient(
      135deg,
      rgba(255, 255, 255, 0.13) 0 24%,
      transparent 24% 100%
    ),
    rgba(12, 14, 18, 0.66);
  box-shadow: var(--shadow-card);
  backdrop-filter: blur(16px) saturate(145%) contrast(108%);
  -webkit-backdrop-filter: blur(16px) saturate(145%) contrast(108%);
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
.context-menu__submenu-title + .action-submenu,
.context-menu__submenu-title + .sendout-submenu {
  margin-top: 0.3rem;
}

.context-menu__button:hover,
.context-menu__button:focus-visible {
  border-color: var(--accent);
  background:
    linear-gradient(90deg, rgba(255, 31, 45, 0.22), rgba(255, 255, 255, 0.08)),
    var(--paper-hover);
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

.action-submenu {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 0.45rem;
}

.action-submenu__list,
.sendout-submenu {
  max-height: min(42vh, 18rem);
  overflow: auto;
  padding: 0.35rem;
  border: 1px solid var(--rule-soft);
  border-radius: 12px;
  background: var(--paper-soft);
  box-shadow: var(--shadow-card);
  backdrop-filter: blur(8px);
}

.sendout-submenu {
  max-height: min(70vh, 24rem);
}

.action-submenu__item {
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

.action-submenu__item:hover:not(:disabled),
.action-submenu__item:focus-visible:not(:disabled),
.action-submenu__item.is-active:not(:disabled),
.sendout-submenu__item:hover,
.sendout-submenu__item:focus-visible {
  border-color: var(--accent);
  background:
    linear-gradient(90deg, rgba(255, 31, 45, 0.16), rgba(255, 255, 255, 0.06)),
    var(--paper-hover);
  color: var(--ink-bright);
}

.action-submenu__item.is-disabled {
  cursor: not-allowed;
  opacity: 0.72;
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

.action-submenu__name {
  font-weight: 900;
}

.action-submenu__badges {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  align-items: center;
}

.action-submenu__badge {
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

.action-submenu__badge--stab,
.action-submenu__badge--active,
.action-submenu__badge--sheet,
.action-submenu__badge--passive {
  color: var(--accent);
}

.action-submenu__badge--map {
  color: var(--ink-bright);
}

.action-submenu__badge--disabled {
  border-color: color-mix(in srgb, var(--bad) 55%, var(--rule-soft));
  color: var(--bad);
}

.context-menu__empty {
  padding: 0.7rem;
  color: var(--ink-muted);
  font-size: 0.84rem;
}

</style>

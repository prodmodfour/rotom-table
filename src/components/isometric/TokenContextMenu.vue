<script setup lang="ts">
import { computed, ref, useId, watch, type ComputedRef } from 'vue'
import ReferenceTooltip from '~/components/reference/ReferenceTooltip.vue'
import { useAnchoredTooltip } from '~/composables/reference/useAnchoredTooltip'
import type { TokenContextMenuState } from '~/utils/isometric/contextMenu'
import {
  tokenAbilityUseReference,
  type TokenAbilityMenuOption,
  type TokenAbilityUseReference,
} from '~/utils/mapTokenAbilities'
import {
  abilityCapabilityStatusLabel,
  buildTokenAbilityTooltipDetail,
} from '~/utils/mapTokenAbilityTooltips'
import type { TokenMoveMenuOption } from '~/utils/mapTokenMoves'
import { moveAutomationStatusDetailsText } from '~/utils/moveAutomationSemanticStatus'
import { useDamageDisplayMode } from '~/composables/useDamageDisplayMode'
import { buildTokenMoveTooltipDetail } from '~/utils/mapTokenMoveTooltips'
import { formatMoveDamageDisplay } from '~/utils/moveDamageDisplay'
import type { TokenManeuverMenuOption } from '~/utils/mapTokenManeuvers'
import { buildTokenManeuverTooltipDetail } from '~/utils/mapTokenManeuverTooltips'
import type { TokenOrderMenuOption } from '~/utils/mapTokenOrders'
import { buildTokenOrderTooltipDetail } from '~/utils/mapTokenOrderTooltips'
import type { RefTooltipDetail } from '~/utils/refLinks'
import type { TokenSendOutOption } from '~/utils/mapTokenSendOut'
import type { TokenPokeballOption } from '~/utils/pokeballCapture'
import { trainerAccentCssVariables } from '~/utils/trainerAccent'

const props = defineProps<{
  menu: TokenContextMenuState
  canDeleteTokens?: boolean
  moves?: TokenMoveMenuOption[]
  maneuvers?: TokenManeuverMenuOption[]
  abilities?: TokenAbilityMenuOption[]
  orders?: TokenOrderMenuOption[]
  sendOutOptions?: TokenSendOutOption[]
  pokeballs?: TokenPokeballOption[]
}>()

const emit = defineEmits<{
  (event: 'view-sheet'): void
  (event: 'view-pokedex'): void
  (event: 'turn'): void
  (event: 'modify-hp'): void
  (event: 'add-temp-hp'): void
  (event: 'modify-combat-stages'): void
  (event: 'apply-remove-conditions'): void
  (event: 'grant-experience'): void
  (event: 'use-move', moveName?: string | null): void
  (event: 'use-maneuver', maneuverName?: string | null): void
  (event: 'use-ability', ability: TokenAbilityUseReference): void
  (event: 'use-order', orderName?: string | null): void
  (event: 'send-out-pokemon', pokemonSlug: string): void
  (event: 'throw-pokeball', pokeballName: string): void
  (event: 'deal-damage'): void
  (event: 'delete'): void
}>()

type ActiveContextPanel = 'main' | 'moves' | 'maneuvers' | 'abilities' | 'orders' | 'sendOut' | 'pokeballs'

interface NamedMenuItem {
  name: string
}

const activePanel = ref<ActiveContextPanel>('main')

const moves = computed(() => props.moves ?? [])
const maneuvers = computed(() => props.maneuvers ?? [])
const abilities = computed(() => props.abilities ?? [])
const orders = computed(() => props.orders ?? [])
const sendOutOptions = computed(() => props.sendOutOptions ?? [])
const pokeballs = computed(() => props.pokeballs ?? [])
const contextMenuStyle = computed(() => ({
  left: `${props.menu.x}px`,
  top: `${props.menu.y}px`,
  ...(props.menu.accentColor ? trainerAccentCssVariables(props.menu.accentColor) : {}),
}))

const {
  damageDisplayMode,
  damageDisplayModeLabel,
  damageDisplayModeTitle,
  toggleDamageDisplayMode,
} = useDamageDisplayMode()

const moveDamageBadge = (move: TokenMoveMenuOption): string | null => {
  const damage = formatMoveDamageDisplay(move, damageDisplayMode.value)
  if (!damage) return null
  return damageDisplayMode.value === 'average' ? `Avg ${damage}` : `Roll ${damage}`
}

const abilityCanBeUsed = (ability: TokenAbilityMenuOption): boolean =>
  ability.capability?.status === 'ready'

const useAbility = (ability: TokenAbilityMenuOption): void => {
  const reference = tokenAbilityUseReference(ability)
  if (reference) emit('use-ability', reference)
}

const moveCanBeUsed = (move: TokenMoveMenuOption): boolean =>
  !move.disabledByAutomation
  && move.hasAutomationScript
  && !move.disabledByMoveList
  && !move.conditionUseBlock
  && !move.disabledByUsage

const moveAutomationBadgeLabel = (move: TokenMoveMenuOption): string =>
  move.automation.baseStatus === 'assisted'
    ? 'Assisted · partial automation'
    : `${move.automation.baseStatusLabel} automation`

const moveAvailabilityTitle = (move: TokenMoveMenuOption): string | undefined => {
  const semanticDetails = moveAutomationStatusDetailsText(move.automation)
  if (move.disabledByAutomation) {
    return `Blocked automation.${semanticDetails ? ` ${semanticDetails}` : ''}`
  }
  if (move.disabledByMoveList) {
    return move.moveList.blockReason === 'move-list-disabled'
      ? `${move.name} is disabled by an active encounter effect.`
      : `${move.name} is outside the active encounter move restriction.`
  }
  if (move.conditionUseBlock) return move.conditionUseBlock.reason
  if (move.disabledByUsage && move.usage) return move.usage.title
  if (!move.hasAutomationScript) return `${move.name} has no available reviewed automation runtime.`
  if (move.automation.baseStatus === 'assisted') {
    return `Assisted partial automation.${semanticDetails ? ` ${semanticDetails}` : ''}`
  }
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
  buildDetail: (move) => buildTokenMoveTooltipDetail(move, { damageDisplayMode: damageDisplayMode.value }),
})

const {
  hoveredName: hoveredManeuverName,
  tooltipId: maneuverTooltipId,
  tooltipComponent: maneuverTooltipComponent,
  isTooltipVisible: isManeuverTooltipVisible,
  tooltipReady: isManeuverTooltipReady,
  tooltipPlacement: maneuverTooltipPlacement,
  tooltipStyle: maneuverTooltipStyle,
  tooltipDetail: hoveredManeuverTooltipDetail,
  showTooltip: showManeuverTooltip,
  hideTooltip: hideManeuverTooltip,
} = createSubmenuTooltipController<TokenManeuverMenuOption>({
  panel: 'maneuvers',
  items: maneuvers,
  buildDetail: buildTokenManeuverTooltipDetail,
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

const {
  hoveredName: hoveredOrderName,
  tooltipId: orderTooltipId,
  tooltipComponent: orderTooltipComponent,
  isTooltipVisible: isOrderTooltipVisible,
  tooltipReady: isOrderTooltipReady,
  tooltipPlacement: orderTooltipPlacement,
  tooltipStyle: orderTooltipStyle,
  tooltipDetail: hoveredOrderTooltipDetail,
  showTooltip: showOrderTooltip,
  hideTooltip: hideOrderTooltip,
} = createSubmenuTooltipController<TokenOrderMenuOption>({
  panel: 'orders',
  items: orders,
  buildDetail: buildTokenOrderTooltipDetail,
})

const hideSubmenuTooltips = () => {
  hideMoveTooltip()
  hideManeuverTooltip()
  hideAbilityTooltip()
  hideOrderTooltip()
}

const resetContextPanel = () => {
  hideSubmenuTooltips()
  activePanel.value = 'main'
}

const openMovePanel = () => {
  hideSubmenuTooltips()
  activePanel.value = 'moves'
}

const openManeuverPanel = () => {
  hideSubmenuTooltips()
  activePanel.value = 'maneuvers'
}

const openAbilityPanel = () => {
  hideSubmenuTooltips()
  activePanel.value = 'abilities'
}

const openOrderPanel = () => {
  hideSubmenuTooltips()
  activePanel.value = 'orders'
}

const openSendOutPanel = () => {
  hideSubmenuTooltips()
  activePanel.value = 'sendOut'
}

const openPokeballPanel = () => {
  hideSubmenuTooltips()
  activePanel.value = 'pokeballs'
}

watch(() => props.menu.id, () => resetContextPanel())

watch(moves, (nextMoves) => {
  if (activePanel.value !== 'moves' || !hoveredMoveName.value) return
  if (nextMoves.some((move) => move.name === hoveredMoveName.value)) return
  hideMoveTooltip()
})

watch(maneuvers, (nextManeuvers) => {
  if (activePanel.value !== 'maneuvers' || !hoveredManeuverName.value) return
  if (nextManeuvers.some((maneuver) => maneuver.name === hoveredManeuverName.value)) return
  hideManeuverTooltip()
})

watch(abilities, (nextAbilities) => {
  if (activePanel.value !== 'abilities' || !hoveredAbilityName.value) return
  if (nextAbilities.some((ability) => ability.name === hoveredAbilityName.value)) return
  hideAbilityTooltip()
})

watch(orders, (nextOrders) => {
  if (activePanel.value !== 'orders' || !hoveredOrderName.value) return
  if (nextOrders.some((order) => order.name === hoveredOrderName.value)) return
  hideOrderTooltip()
})
</script>

<template>
  <Teleport to="body">
    <div
      class="context-menu"
      :class="{ 'context-menu--move-panel': activePanel === 'moves' || activePanel === 'maneuvers' }"
      :style="contextMenuStyle"
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
          @click.stop="openManeuverPanel"
        >
          <span>Use Maneuver</span>
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
          v-if="props.menu.canUseOrders"
          type="button"
          class="context-menu__button context-menu__button--submenu"
          aria-haspopup="menu"
          @click.stop="openOrderPanel"
        >
          <span>Use Order</span>
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
          v-if="props.menu.canThrowPokeball"
          type="button"
          class="context-menu__button context-menu__button--submenu"
          aria-haspopup="menu"
          @click.stop="openPokeballPanel"
        >
          <span>Throw Poké Ball</span>
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
          v-if="props.menu.canGrantExperience"
          type="button"
          class="context-menu__button"
          @click.stop="emit('grant-experience')"
        >
          Grant XP
        </button>
        <button
          v-if="props.menu.canTurn"
          type="button"
          class="context-menu__button"
          @click.stop="emit('turn')"
        >
          Rotate sprite
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
          @click.stop="emit('add-temp-hp')"
        >
          Add Temp HP
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

        <div class="context-menu__submenu-heading">
          <p class="context-menu__submenu-title">Use Move</p>
          <button
            type="button"
            class="context-menu__mode-toggle"
            :title="damageDisplayModeTitle"
            @click.stop="toggleDamageDisplayMode"
          >
            {{ damageDisplayModeLabel }}
          </button>
        </div>

        <div class="action-submenu">
          <div class="action-submenu__list action-submenu__list--moves" role="menu" aria-label="Moves">
            <button
              v-for="move in moves"
              :key="move.name"
              type="button"
              class="action-submenu__item"
              :class="{
                'is-active': hoveredMoveName === move.name,
                'is-disabled': !moveCanBeUsed(move),
                [`action-submenu__item--automation-${move.automation.baseStatus}`]: true,
              }"
              role="menuitem"
              :data-automation-status="move.automation.baseStatus"
              :aria-disabled="!moveCanBeUsed(move) ? 'true' : undefined"
              :title="moveAvailabilityTitle(move)"
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
                <span
                  class="action-submenu__badge action-submenu__badge--automation"
                  :class="`action-submenu__badge--automation-${move.automation.baseStatus}`"
                >
                  {{ moveAutomationBadgeLabel(move) }}
                </span>
                <span class="action-submenu__badge action-submenu__badge--interaction">
                  Interactions: {{ move.automation.interactionStatusLabel }}
                </span>
                <TypeBadge v-if="move.type" :type="move.type" size="xs" />
                <DamageClassBadge v-if="move.damageClass" :category="move.damageClass" size="xs" />
                <span v-if="move.damageBase != null" class="action-submenu__badge">DB {{ move.damageBase }}</span>
                <span v-if="moveDamageBadge(move)" class="action-submenu__badge action-submenu__badge--damage">{{ moveDamageBadge(move) }}</span>
                <span v-if="move.hasStab" class="action-submenu__badge action-submenu__badge--stab">STAB</span>
                <span
                  v-if="move.usage"
                  class="action-submenu__badge"
                  :class="[`action-submenu__badge--usage-${move.usage.tone}`, { 'action-submenu__badge--disabled': !move.usage.available }]"
                  :title="move.usage.title"
                >
                  {{ move.usage.label }}
                </span>
                <span v-if="move.automatic" class="action-submenu__badge" title="Added automatically from the token's capabilities">Auto-added</span>
                <span v-if="move.moveList.source === 'encounter-overlay'" class="action-submenu__badge" title="Temporarily projected by an authoritative encounter effect">Temporary</span>
                <span v-if="move.disabledByMoveList" class="action-submenu__badge action-submenu__badge--disabled">
                  {{ move.moveList.blockReason === 'move-list-disabled' ? 'Disabled' : 'Restricted' }}
                </span>
                <span v-if="move.conditionUseBlock" class="action-submenu__badge action-submenu__badge--disabled">{{ move.conditionUseBlock.label }}</span>
              </span>
              <span
                v-if="move.automation.baseStatus !== 'complete' && move.automation.details.length"
                class="action-submenu__automation-details"
                :class="`action-submenu__automation-details--${move.automation.baseStatus}`"
              >
                <span
                  v-for="detail in move.automation.details"
                  :key="`${move.name}-${detail.kind}-${detail.code}`"
                  class="action-submenu__automation-detail"
                >
                  <strong>{{ detail.label }} · {{ detail.code }}</strong>
                  <span>{{ detail.summary }}</span>
                </span>
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

      <template v-else-if="activePanel === 'maneuvers'">
        <button
          type="button"
          class="context-menu__button context-menu__button--back"
          @click.stop="resetContextPanel"
        >
          <span class="context-menu__back-icon" aria-hidden="true">‹</span>
          <span>Back</span>
        </button>

        <p class="context-menu__submenu-title">Use Maneuver</p>

        <div class="action-submenu">
          <div class="action-submenu__list action-submenu__list--maneuvers" role="menu" aria-label="Maneuvers">
            <button
              v-for="maneuver in maneuvers"
              :key="maneuver.name"
              type="button"
              class="action-submenu__item"
              :class="{ 'is-active': hoveredManeuverName === maneuver.name }"
              role="menuitem"
              :aria-describedby="hoveredManeuverName === maneuver.name && hoveredManeuverTooltipDetail && isManeuverTooltipVisible ? maneuverTooltipId : undefined"
              @pointerenter="showManeuverTooltip(maneuver.name, $event)"
              @pointerleave="hideManeuverTooltip"
              @focus="showManeuverTooltip(maneuver.name, $event)"
              @blur="hideManeuverTooltip"
              @click.stop="emit('use-maneuver', maneuver.name)"
            >
              <span class="action-submenu__name">{{ maneuver.name }}</span>
              <span class="action-submenu__badges">
                <span v-if="maneuver.action" class="action-submenu__badge">{{ maneuver.action }}</span>
                <DamageClassBadge v-if="maneuver.maneuverClass" :category="maneuver.maneuverClass" size="xs" />
                <span v-if="maneuver.ac != null" class="action-submenu__badge">AC {{ maneuver.ac }}</span>
                <span v-if="maneuver.range" class="action-submenu__badge">{{ maneuver.range }}</span>
                <span v-if="maneuver.trigger" class="action-submenu__badge">Trigger</span>
                <span v-if="maneuver.source === 'sheet'" class="action-submenu__badge action-submenu__badge--sheet">Sheet</span>
              </span>
            </button>

            <div v-if="!maneuvers.length" class="context-menu__empty">
              No maneuvers are available.
            </div>
          </div>

          <Teleport to="body">
            <ReferenceTooltip
              v-if="hoveredManeuverTooltipDetail && isManeuverTooltipVisible"
              :id="maneuverTooltipId"
              ref="maneuverTooltipComponent"
              :detail="hoveredManeuverTooltipDetail"
              :placement="maneuverTooltipPlacement"
              :ready="isManeuverTooltipReady"
              :style="maneuverTooltipStyle"
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
              :key="ability.instanceId ?? ability.name"
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
              @click.stop="useAbility(ability)"
            >
              <span class="action-submenu__name">{{ ability.name }}</span>
              <span class="action-submenu__badges">
                <span
                  class="action-submenu__badge"
                  :class="ability.capability?.status === 'ready' ? 'action-submenu__badge--active' : 'action-submenu__badge--disabled'"
                >
                  {{ abilityCapabilityStatusLabel(ability.capability?.status) }}
                </span>
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

      <template v-else-if="activePanel === 'orders'">
        <button
          type="button"
          class="context-menu__button context-menu__button--back"
          @click.stop="resetContextPanel"
        >
          <span class="context-menu__back-icon" aria-hidden="true">‹</span>
          <span>Back</span>
        </button>

        <p class="context-menu__submenu-title">Use Order</p>

        <div class="action-submenu">
          <div class="action-submenu__list" role="menu" aria-label="Orders">
            <button
              v-for="order in orders"
              :key="order.name"
              type="button"
              class="action-submenu__item"
              :class="{ 'is-active': hoveredOrderName === order.name }"
              role="menuitem"
              :aria-describedby="hoveredOrderName === order.name && hoveredOrderTooltipDetail && isOrderTooltipVisible ? orderTooltipId : undefined"
              @pointerenter="showOrderTooltip(order.name, $event)"
              @pointerleave="hideOrderTooltip"
              @focus="showOrderTooltip(order.name, $event)"
              @blur="hideOrderTooltip"
              @click.stop="emit('use-order', order.name)"
            >
              <span class="action-submenu__name">{{ order.name }}</span>
              <span class="action-submenu__badges">
                <span v-if="order.frequency" class="action-submenu__badge">{{ order.frequency }}</span>
                <span
                  v-for="tag in order.tags"
                  :key="`${order.name}-${tag}`"
                  class="action-submenu__badge"
                  :class="{ 'action-submenu__badge--active': /^(training|stratagem)$/i.test(tag) }"
                >
                  {{ tag }}
                </span>
                <span v-if="order.source !== 'sheet-order'" class="action-submenu__badge action-submenu__badge--sheet">
                  {{ order.source === 'granted-feature' ? 'Granted' : 'Feature' }}
                </span>
              </span>
            </button>

            <div v-if="!orders.length" class="context-menu__empty">
              This trainer has no orders.
            </div>
          </div>

          <Teleport to="body">
            <ReferenceTooltip
              v-if="hoveredOrderTooltipDetail && isOrderTooltipVisible"
              :id="orderTooltipId"
              ref="orderTooltipComponent"
              :detail="hoveredOrderTooltipDetail"
              :placement="orderTooltipPlacement"
              :ready="isOrderTooltipReady"
              :style="orderTooltipStyle"
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

      <template v-else-if="activePanel === 'pokeballs'">
        <button
          type="button"
          class="context-menu__button context-menu__button--back"
          @click.stop="resetContextPanel"
        >
          <span class="context-menu__back-icon" aria-hidden="true">‹</span>
          <span>Back</span>
        </button>

        <p class="context-menu__submenu-title">Throw Poké Ball</p>

        <div class="pokeball-submenu" role="menu" aria-label="Poké Balls">
          <button
            v-for="ball in pokeballs"
            :key="ball.name"
            type="button"
            class="pokeball-submenu__item"
            role="menuitem"
            :title="ball.description"
            @click.stop="emit('throw-pokeball', ball.name)"
          >
            <ItemSprite :item="ball.name" size="sm" />
            <span class="pokeball-submenu__text">
              <strong>{{ ball.name }}</strong>
              <small>Qty {{ ball.quantity }} · Mod {{ ball.modifierLabel }}</small>
            </span>
          </button>

          <div v-if="!pokeballs.length" class="context-menu__empty">
            This trainer has no Poké Balls in inventory.
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
  background:
    linear-gradient(
      135deg,
      color-mix(in srgb, var(--ink-bright) 12%, transparent) 0 24%,
      transparent 24% 100%
    ),
    color-mix(in srgb, var(--paper-soft) 86%, transparent);
  box-shadow: var(--shadow-card);
  backdrop-filter: blur(16px) saturate(145%) contrast(108%);
  -webkit-backdrop-filter: blur(16px) saturate(145%) contrast(108%);
  box-sizing: border-box;
}

.context-menu,
.context-menu * {
  box-sizing: border-box;
}

.context-menu--move-panel {
  width: max-content;
  max-width: none;
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
.context-menu__button + .context-menu__submenu-heading,
.context-menu__submenu-title + .action-submenu,
.context-menu__submenu-title + .sendout-submenu,
.context-menu__submenu-title + .pokeball-submenu,
.context-menu__submenu-heading + .action-submenu {
  margin-top: 0.3rem;
}

.context-menu__button:hover,
.context-menu__button:focus-visible {
  border-color: var(--accent);
  background:
    linear-gradient(90deg, rgba(var(--accent-rgb), 0.22), rgba(255, 255, 255, 0.08)),
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

.context-menu__submenu-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.context-menu__submenu-title {
  margin: 0;
  color: var(--ink-muted);
  font-size: 0.72rem;
  font-weight: 900;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.context-menu__mode-toggle {
  border: 1px solid var(--rule-soft);
  border-radius: 999px;
  background: var(--paper);
  color: var(--ink-muted);
  padding: 0.16rem 0.45rem;
  font: inherit;
  font-size: 0.68rem;
  font-weight: 900;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  cursor: pointer;
}

.context-menu__mode-toggle:hover,
.context-menu__mode-toggle:focus-visible {
  border-color: var(--accent);
  color: var(--accent);
  outline: none;
}

.action-submenu {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 0.45rem;
}

.action-submenu__list,
.sendout-submenu,
.pokeball-submenu {
  max-height: min(42vh, 18rem);
  overflow: auto;
  padding: 0.35rem;
  border: 1px solid var(--rule-soft);
  border-radius: 12px;
  background: var(--paper-soft);
  box-shadow: var(--shadow-card);
  backdrop-filter: blur(8px);
}

.action-submenu__list--moves,
.action-submenu__list--maneuvers {
  display: grid;
  grid-template-rows: repeat(4, auto);
  grid-auto-flow: column;
  grid-auto-columns: 14rem;
  gap: 0.25rem;
  width: max-content;
  max-height: none;
  overflow: visible;
}

.action-submenu__list--maneuvers {
  grid-auto-columns: 16rem;
}

.sendout-submenu,
.pokeball-submenu {
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
.sendout-submenu__item:focus-visible,
.pokeball-submenu__item:hover,
.pokeball-submenu__item:focus-visible {
  border-color: var(--accent);
  background:
    linear-gradient(90deg, rgba(var(--accent-rgb), 0.16), rgba(255, 255, 255, 0.06)),
    var(--paper-hover);
  color: var(--ink-bright);
}

.action-submenu__item.is-disabled {
  cursor: not-allowed;
  opacity: 0.72;
}

.action-submenu__item--automation-assisted {
  border-color: color-mix(in srgb, var(--warn) 28%, transparent);
}

.action-submenu__item--automation-blocked {
  border-color: color-mix(in srgb, var(--bad) 28%, transparent);
}

.sendout-submenu__item,
.pokeball-submenu__item {
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

.sendout-submenu__text,
.pokeball-submenu__text {
  display: grid;
  gap: 0.12rem;
  min-width: 0;
}

.sendout-submenu__text strong,
.sendout-submenu__text small,
.pokeball-submenu__text strong,
.pokeball-submenu__text small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sendout-submenu__text small,
.pokeball-submenu__text small {
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
.action-submenu__badge--damage,
.action-submenu__badge--active,
.action-submenu__badge--sheet,
.action-submenu__badge--passive {
  color: var(--accent);
}

.action-submenu__badge--map,
.action-submenu__badge--usage-available {
  color: var(--ink-bright);
}

.action-submenu__badge--usage-limited {
  color: var(--accent);
}

.action-submenu__badge--automation-complete {
  border-color: color-mix(in srgb, var(--good) 55%, var(--rule-soft));
  color: var(--good);
}

.action-submenu__badge--automation-assisted {
  border-color: color-mix(in srgb, var(--warn) 55%, var(--rule-soft));
  color: var(--warn);
}

.action-submenu__badge--automation-blocked {
  border-color: color-mix(in srgb, var(--bad) 55%, var(--rule-soft));
  color: var(--bad);
}

.action-submenu__badge--interaction {
  color: var(--ink-muted);
}

.action-submenu__badge--usage-blocked {
  border-color: color-mix(in srgb, var(--bad) 55%, var(--rule-soft));
  color: var(--bad);
}

.action-submenu__badge--disabled {
  border-color: color-mix(in srgb, var(--bad) 55%, var(--rule-soft));
  color: var(--bad);
}

.action-submenu__automation-details {
  display: grid;
  gap: 0.28rem;
  padding: 0.42rem 0.48rem;
  border-left: 2px solid var(--warn);
  border-radius: 4px;
  background: color-mix(in srgb, var(--warn) 8%, transparent);
  color: var(--ink-muted);
  font-size: 0.68rem;
  line-height: 1.3;
}

.action-submenu__automation-details--blocked {
  border-left-color: var(--bad);
  background: color-mix(in srgb, var(--bad) 8%, transparent);
}

.action-submenu__automation-detail {
  display: grid;
  gap: 0.08rem;
}

.action-submenu__automation-detail strong {
  color: var(--ink);
  font-size: 0.64rem;
  letter-spacing: 0.035em;
  text-transform: uppercase;
}

.context-menu__empty {
  padding: 0.7rem;
  color: var(--ink-muted);
  font-size: 0.84rem;
}

</style>

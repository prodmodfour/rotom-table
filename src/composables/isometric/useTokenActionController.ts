import { computed, nextTick, ref, type Ref } from 'vue'
import type { CombatStageMap } from '~/types/combatStages'
import type { SpawnedPokemon } from '~/types/pokemon'
import { normalizeConditionNames } from '~/utils/statusConditions'
import {
  createTokenContextMenuState,
  getTokenContextMenuViewportBounds,
  type TokenContextMenuBounds,
  type TokenContextMenuState,
} from '~/utils/isometric/contextMenu'
import {
  createHpDialogState,
  getHpDialogDelta,
  getHpDialogPreview,
  updateHpDialogFromPokemon,
  type HpDialogState,
} from '~/utils/isometric/tokenHpDialog'
import {
  createCombatStagesDialogState,
  createConditionsDialogState,
  getNormalizedCombatDialogStages,
  isCombatStagesDialogChanged,
  isConditionsDialogChanged,
  updateConditionsDialogFromPokemon,
  type CombatStagesDialogState,
  type ConditionsDialogState,
} from '~/utils/isometric/tokenStatusDialogs'
import {
  createDamageDialogState,
  getDamageDialogAttackBonus,
  getDamageDialogAttacker,
  getDamageDialogAttackerOptions,
  getDamageDialogDbDefinition,
  getDamageDialogDefense,
  getDamageDialogHpLoss,
  getDamageDialogMultiplier,
  getDamageDialogMultiplierLabel,
  getDamageDialogMultiplierTone,
  getDamageDialogPreview,
  getDamageDialogRawAmount,
  updateDamageDialogFromPokemon,
  type DamageDialogState,
} from '~/utils/isometric/tokenDamageDialog'

export interface TokenActionDialogsExpose {
  focusHpAmount: () => void
  focusDamageAmount: () => void
}

type BoundsProvider = Pick<HTMLElement, 'getBoundingClientRect'>

export interface TokenActionControllerEmitters {
  turnPokemon: (id: string) => void
  deletePokemon: (id: string) => void
  modifyHp: (payload: { id: string; currentHp: number }) => void
  modifyCombatStages: (payload: { id: string; stages: CombatStageMap }) => void
  modifyConditions: (payload: { id: string; conditions: string[] }) => void
  useMove: (payload: { id: string; moveName?: string | null }) => void
  sendOutPokemon?: (payload: { trainerId: string; pokemonSlug: string }) => void
  viewSheet: (id: string) => void
  viewPokedex: (id: string) => void
}

export interface TokenActionControllerOptions<TContainer extends BoundsProvider = BoundsProvider> {
  container: Ref<TContainer | null>
  pokemons: () => readonly SpawnedPokemon[]
  canDeleteTokens: () => boolean | undefined
  canControlPokemon: (id: string | null | undefined) => boolean
  getSendOutOptionCount?: (id: string) => number
  emit: TokenActionControllerEmitters
}

export const useTokenActionController = <TContainer extends BoundsProvider>(
  options: TokenActionControllerOptions<TContainer>,
) => {
  const contextMenu = ref<TokenContextMenuState | null>(null)
  const combatStagesDialog = ref<CombatStagesDialogState | null>(null)
  const conditionsDialog = ref<ConditionsDialogState | null>(null)
  const hpDialog = ref<HpDialogState | null>(null)
  const damageDialog = ref<DamageDialogState | null>(null)
  const actionDialogs = ref<TokenActionDialogsExpose | null>(null)

  const combatStagesDialogChanged = computed(() => isCombatStagesDialogChanged(combatStagesDialog.value))
  const conditionsDialogChanged = computed(() => isConditionsDialogChanged(conditionsDialog.value))
  const hpDialogDelta = computed(() => getHpDialogDelta(hpDialog.value))
  const hpDialogPreview = computed(() => getHpDialogPreview(hpDialog.value))
  const damageDialogDbDef = computed(() => getDamageDialogDbDefinition(damageDialog.value))
  const damageDialogRawAmount = computed(() => getDamageDialogRawAmount(damageDialog.value))
  const damageDialogDefense = computed(() => getDamageDialogDefense(damageDialog.value))
  // Tokens on the grid the user can pick as the attacker, sorted by display name.
  const damageDialogAttackerOptions = computed(() => getDamageDialogAttackerOptions(options.pokemons()))
  const damageDialogAttacker = computed(() => getDamageDialogAttacker(damageDialog.value, options.pokemons()))
  // Atk / Sp.Atk added to DB rolls only; flat damage already includes offence.
  const damageDialogAttackBonus = computed(() => getDamageDialogAttackBonus(
    damageDialog.value,
    damageDialogAttacker.value,
  ))
  const damageDialogMultiplier = computed(() => getDamageDialogMultiplier(damageDialog.value))
  const damageDialogHpLoss = computed(() => getDamageDialogHpLoss(
    damageDialog.value,
    damageDialogAttacker.value,
  ))
  const damageDialogPreview = computed(() => getDamageDialogPreview(
    damageDialog.value,
    damageDialogAttacker.value,
  ))
  const damageDialogMultiplierTone = computed(() => getDamageDialogMultiplierTone(damageDialogMultiplier.value))
  const damageDialogMultiplierLabel = computed(() => getDamageDialogMultiplierLabel(damageDialogMultiplier.value))

  const findPokemonById = (id: string | null | undefined): SpawnedPokemon | null => {
    if (!id) return null
    return options.pokemons().find((pokemon) => pokemon.id === id) ?? null
  }

  const controllableContextId = (): string | null => {
    const id = contextMenu.value?.id
    return options.canControlPokemon(id) ? id ?? null : null
  }

  const closeContextMenu = () => {
    contextMenu.value = null
  }

  const getContextMenuBounds = (): TokenContextMenuBounds | null => {
    const containerBounds = options.container.value?.getBoundingClientRect()
    if (!containerBounds) return null

    return getTokenContextMenuViewportBounds() ?? containerBounds
  }

  const openContextMenu = (event: MouseEvent, id: string) => {
    if (!options.canControlPokemon(id)) {
      return
    }

    const target = findPokemonById(id)
    const bounds = getContextMenuBounds()
    if (!target || !bounds) return

    contextMenu.value = createTokenContextMenuState({
      pokemon: target,
      clientX: event.clientX,
      clientY: event.clientY,
      bounds,
      canDeleteTokens: options.canDeleteTokens(),
      canSendOut: (options.getSendOutOptionCount?.(id) ?? 0) > 0,
    })
  }

  const handleContextTurn = () => {
    const id = controllableContextId()
    if (!id) return

    options.emit.turnPokemon(id)
    closeContextMenu()
  }

  const closeHpDialog = () => {
    hpDialog.value = null
  }

  const handleContextModifyHp = () => {
    const id = controllableContextId()
    const target = findPokemonById(id)
    if (!id || !target) {
      closeContextMenu()
      return
    }

    hpDialog.value = createHpDialogState(target)
    closeContextMenu()
    void nextTick(() => {
      actionDialogs.value?.focusHpAmount()
    })
  }

  const handleHpDialogSubmit = () => {
    if (!hpDialog.value || !options.canControlPokemon(hpDialog.value.id)) return
    if (hpDialogDelta.value === 0) return
    if (hpDialogPreview.value === hpDialog.value.currentHp) {
      closeHpDialog()
      return
    }

    options.emit.modifyHp({ id: hpDialog.value.id, currentHp: hpDialogPreview.value })
    closeHpDialog()
  }

  const closeCombatStagesDialog = () => {
    combatStagesDialog.value = null
  }

  const handleContextModifyCombatStages = () => {
    const id = controllableContextId()
    const target = findPokemonById(id)
    if (!id || !target) {
      closeContextMenu()
      return
    }

    combatStagesDialog.value = createCombatStagesDialogState(target)
    closeContextMenu()
  }

  const handleCombatStagesDialogSubmit = () => {
    if (!combatStagesDialog.value || !options.canControlPokemon(combatStagesDialog.value.id)) return
    const stages = getNormalizedCombatDialogStages(combatStagesDialog.value)
    combatStagesDialog.value.stages = { ...stages }
    if (!combatStagesDialogChanged.value) {
      closeCombatStagesDialog()
      return
    }

    options.emit.modifyCombatStages({ id: combatStagesDialog.value.id, stages })
    closeCombatStagesDialog()
  }

  const closeConditionsDialog = () => {
    conditionsDialog.value = null
  }

  const handleContextApplyRemoveConditions = () => {
    const id = controllableContextId()
    const target = findPokemonById(id)
    if (!id || !target) {
      closeContextMenu()
      return
    }

    conditionsDialog.value = createConditionsDialogState(target)
    closeContextMenu()
  }

  const handleConditionsDialogSubmit = () => {
    if (!conditionsDialog.value || !options.canControlPokemon(conditionsDialog.value.id)) return
    const conditions = normalizeConditionNames(conditionsDialog.value.conditions)
    conditionsDialog.value.conditions = [...conditions]
    if (!conditionsDialogChanged.value) {
      closeConditionsDialog()
      return
    }

    options.emit.modifyConditions({ id: conditionsDialog.value.id, conditions })
    closeConditionsDialog()
  }

  const closeDamageDialog = () => {
    damageDialog.value = null
  }

  const handleContextDealDamage = () => {
    const id = controllableContextId()
    const target = findPokemonById(id)
    if (!id || !target) {
      closeContextMenu()
      return
    }

    damageDialog.value = createDamageDialogState(target)
    closeContextMenu()
    void nextTick(() => {
      actionDialogs.value?.focusDamageAmount()
    })
  }

  const handleDamageDialogSubmit = () => {
    if (!damageDialog.value || !options.canControlPokemon(damageDialog.value.id)) return
    if (damageDialogRawAmount.value === 0) return
    if (damageDialogPreview.value === damageDialog.value.currentHp) {
      closeDamageDialog()
      return
    }

    options.emit.modifyHp({ id: damageDialog.value.id, currentHp: damageDialogPreview.value })
    closeDamageDialog()
  }

  const handleContextUseMove = (moveName?: string | null) => {
    const id = controllableContextId()
    if (!id) return

    options.emit.useMove({ id, moveName })
    closeContextMenu()
  }

  const handleContextSendOutPokemon = (pokemonSlug: string) => {
    const id = controllableContextId()
    if (!id || !options.emit.sendOutPokemon) return
    if ((options.getSendOutOptionCount?.(id) ?? 0) <= 0) return

    options.emit.sendOutPokemon({ trainerId: id, pokemonSlug })
    closeContextMenu()
  }

  const handleContextViewSheet = () => {
    const id = controllableContextId()
    if (!id) return

    options.emit.viewSheet(id)
    closeContextMenu()
  }

  const handleContextViewPokedex = () => {
    const id = controllableContextId()
    if (!id) return

    options.emit.viewPokedex(id)
    closeContextMenu()
  }

  const handleContextDelete = () => {
    const id = controllableContextId()
    if (!options.canDeleteTokens() || !id) return

    options.emit.deletePokemon(id)
    closeContextMenu()
  }

  const syncDialogsFromPokemons = () => {
    if (hpDialog.value) {
      const live = findPokemonById(hpDialog.value.id)
      if (!live) {
        closeHpDialog()
      } else {
        hpDialog.value = updateHpDialogFromPokemon(hpDialog.value, live)
      }
    }

    if (damageDialog.value) {
      const live = findPokemonById(damageDialog.value.id)
      if (!live) {
        closeDamageDialog()
      } else {
        damageDialog.value = updateDamageDialogFromPokemon(
          damageDialog.value,
          live,
          options.pokemons(),
        )
      }
    }

    if (conditionsDialog.value) {
      const live = findPokemonById(conditionsDialog.value.id)
      if (!live) {
        closeConditionsDialog()
      } else {
        conditionsDialog.value = updateConditionsDialogFromPokemon(conditionsDialog.value, live)
      }
    }
  }

  const closeUnauthorizedActions = () => {
    if (contextMenu.value && !options.canControlPokemon(contextMenu.value.id)) closeContextMenu()
    if (hpDialog.value && !options.canControlPokemon(hpDialog.value.id)) closeHpDialog()
    if (combatStagesDialog.value && !options.canControlPokemon(combatStagesDialog.value.id)) closeCombatStagesDialog()
    if (conditionsDialog.value && !options.canControlPokemon(conditionsDialog.value.id)) closeConditionsDialog()
    if (damageDialog.value && !options.canControlPokemon(damageDialog.value.id)) closeDamageDialog()
  }

  const closeTopmostOverlay = (): boolean => {
    if (damageDialog.value) {
      closeDamageDialog()
      return true
    }

    if (hpDialog.value) {
      closeHpDialog()
      return true
    }

    if (conditionsDialog.value) {
      closeConditionsDialog()
      return true
    }

    if (combatStagesDialog.value) {
      closeCombatStagesDialog()
      return true
    }

    if (contextMenu.value) {
      closeContextMenu()
      return true
    }

    return false
  }

  return {
    actionDialogs,
    contextMenu,
    hpDialog,
    hpDialogDelta,
    hpDialogPreview,
    combatStagesDialog,
    combatStagesDialogChanged,
    conditionsDialog,
    conditionsDialogChanged,
    damageDialog,
    damageDialogDbDef,
    damageDialogRawAmount,
    damageDialogDefense,
    damageDialogAttackerOptions,
    damageDialogAttackBonus,
    damageDialogMultiplier,
    damageDialogHpLoss,
    damageDialogPreview,
    damageDialogMultiplierTone,
    damageDialogMultiplierLabel,
    openContextMenu,
    closeContextMenu,
    handleContextTurn,
    handleContextModifyHp,
    closeHpDialog,
    handleHpDialogSubmit,
    handleContextModifyCombatStages,
    closeCombatStagesDialog,
    handleCombatStagesDialogSubmit,
    handleContextApplyRemoveConditions,
    closeConditionsDialog,
    handleConditionsDialogSubmit,
    handleContextUseMove,
    handleContextSendOutPokemon,
    handleContextViewSheet,
    handleContextViewPokedex,
    handleContextDealDamage,
    closeDamageDialog,
    handleDamageDialogSubmit,
    handleContextDelete,
    syncDialogsFromPokemons,
    closeUnauthorizedActions,
    closeTopmostOverlay,
  }
}

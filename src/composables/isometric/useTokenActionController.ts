import { computed, nextTick, ref, type Ref } from 'vue'
import type { CombatStageMap } from '~/types/combatStages'
import type { MoveAutomationHpUpdate } from '~/types/moveAutomation'
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
  getHpDialogHpUpdate,
  getHpDialogInjuryResult,
  getHpDialogPreview,
  getHpDialogPreviewMaxHp,
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
  createExperienceDialogState,
  getExperienceDialogAmount,
  getExperienceDialogGrantUpdate,
  getExperienceDialogPreviewLevel,
  getExperienceDialogPreviewTotalExp,
  updateExperienceDialogFromPokemon,
  type ExperienceDialogState,
} from '~/utils/isometric/tokenExperienceDialog'
import {
  createDamageDialogState,
  getDamageDialogAttackBonus,
  getDamageDialogAttacker,
  getDamageDialogAttackerOptions,
  getDamageDialogDbDefinition,
  getDamageDialogDefense,
  getDamageDialogHpLoss,
  getDamageDialogHpUpdate,
  getDamageDialogInjuryResult,
  getDamageDialogMultiplier,
  getDamageDialogMultiplierLabel,
  getDamageDialogMultiplierTone,
  getDamageDialogPreview,
  getDamageDialogPreviewMaxHp,
  getDamageDialogRawAmount,
  updateDamageDialogFromPokemon,
  type DamageDialogState,
} from '~/utils/isometric/tokenDamageDialog'

export interface TokenActionDialogsExpose {
  focusHpAmount: () => void
  focusDamageAmount: () => void
  focusExperienceAmount: () => void
}

type BoundsProvider = Pick<HTMLElement, 'getBoundingClientRect'>

export interface TokenActionControllerEmitters {
  turnPokemon: (id: string) => void
  deletePokemon: (id: string) => void
  modifyHp: (payload: MoveAutomationHpUpdate) => void
  modifyCombatStages: (payload: { id: string; stages: CombatStageMap }) => void
  modifyConditions: (payload: { id: string; conditions: string[] }) => void
  grantExperience: (payload: { id: string; amount: number }) => void
  useMove: (payload: { id: string; moveName?: string | null }) => void
  useManeuver?: (payload: { id: string; maneuverName?: string | null }) => void
  useAbility: (payload: { id: string; abilityName?: string | null }) => void
  useOrder?: (payload: { id: string; orderName?: string | null }) => void
  sendOutPokemon?: (payload: { trainerId: string; pokemonSlug: string }) => void
  throwPokeball?: (payload: { id: string; pokeballName: string }) => void
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
  const experienceDialog = ref<ExperienceDialogState | null>(null)
  const damageDialog = ref<DamageDialogState | null>(null)
  const actionDialogs = ref<TokenActionDialogsExpose | null>(null)

  const combatStagesDialogChanged = computed(() => isCombatStagesDialogChanged(combatStagesDialog.value))
  const conditionsDialogChanged = computed(() => isConditionsDialogChanged(conditionsDialog.value))
  const hpDialogDelta = computed(() => getHpDialogDelta(hpDialog.value))
  const hpDialogPreview = computed(() => getHpDialogPreview(hpDialog.value))
  const hpDialogInjuryResult = computed(() => getHpDialogInjuryResult(hpDialog.value))
  const hpDialogPreviewMaxHp = computed(() => getHpDialogPreviewMaxHp(hpDialog.value))
  const experienceDialogAmount = computed(() => getExperienceDialogAmount(experienceDialog.value))
  const experienceDialogPreviewTotalExp = computed(() => getExperienceDialogPreviewTotalExp(experienceDialog.value))
  const experienceDialogPreviewLevel = computed(() => getExperienceDialogPreviewLevel(experienceDialog.value))
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
  const damageDialogInjuryResult = computed(() => getDamageDialogInjuryResult(
    damageDialog.value,
    damageDialogAttacker.value,
  ))
  const damageDialogPreviewMaxHp = computed(() => getDamageDialogPreviewMaxHp(
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

    const update = getHpDialogHpUpdate(hpDialog.value)
    if (update) options.emit.modifyHp(update)
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

  const closeExperienceDialog = () => {
    experienceDialog.value = null
  }

  const handleContextGrantExperience = () => {
    const id = controllableContextId()
    const target = findPokemonById(id)
    if (!id || !target || target.sheetKind !== 'pokemon') {
      closeContextMenu()
      return
    }

    experienceDialog.value = createExperienceDialogState(target)
    closeContextMenu()
    void nextTick(() => {
      actionDialogs.value?.focusExperienceAmount()
    })
  }

  const handleExperienceDialogSubmit = () => {
    if (!experienceDialog.value || !options.canControlPokemon(experienceDialog.value.id)) return
    const update = getExperienceDialogGrantUpdate(experienceDialog.value)
    if (!update) return

    options.emit.grantExperience(update)
    closeExperienceDialog()
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

    const update = getDamageDialogHpUpdate(damageDialog.value, damageDialogAttacker.value)
    if (update) options.emit.modifyHp(update)
    closeDamageDialog()
  }

  const handleContextUseMove = (moveName?: string | null) => {
    const id = controllableContextId()
    if (!id) return

    options.emit.useMove({ id, moveName })
    closeContextMenu()
  }

  const handleContextUseManeuver = (maneuverName?: string | null) => {
    const id = controllableContextId()
    if (!id || !options.emit.useManeuver) return

    options.emit.useManeuver({ id, maneuverName })
    closeContextMenu()
  }

  const handleContextUseAbility = (abilityName?: string | null) => {
    const id = controllableContextId()
    if (!id) return

    options.emit.useAbility({ id, abilityName })
    closeContextMenu()
  }

  const handleContextUseOrder = (orderName?: string | null) => {
    const id = controllableContextId()
    if (!id || !options.emit.useOrder) return

    options.emit.useOrder({ id, orderName })
    closeContextMenu()
  }

  const handleContextSendOutPokemon = (pokemonSlug: string) => {
    const id = controllableContextId()
    if (!id || !options.emit.sendOutPokemon) return
    if ((options.getSendOutOptionCount?.(id) ?? 0) <= 0) return

    options.emit.sendOutPokemon({ trainerId: id, pokemonSlug })
    closeContextMenu()
  }

  const handleContextThrowPokeball = (pokeballName: string) => {
    const id = controllableContextId()
    if (!id || !options.emit.throwPokeball) return

    options.emit.throwPokeball({ id, pokeballName })
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

    if (experienceDialog.value) {
      const live = findPokemonById(experienceDialog.value.id)
      if (!live || live.sheetKind !== 'pokemon') {
        closeExperienceDialog()
      } else {
        experienceDialog.value = updateExperienceDialogFromPokemon(experienceDialog.value, live)
      }
    }
  }

  const closeUnauthorizedActions = () => {
    if (contextMenu.value && !options.canControlPokemon(contextMenu.value.id)) closeContextMenu()
    if (hpDialog.value && !options.canControlPokemon(hpDialog.value.id)) closeHpDialog()
    if (combatStagesDialog.value && !options.canControlPokemon(combatStagesDialog.value.id)) closeCombatStagesDialog()
    if (conditionsDialog.value && !options.canControlPokemon(conditionsDialog.value.id)) closeConditionsDialog()
    if (experienceDialog.value && !options.canControlPokemon(experienceDialog.value.id)) closeExperienceDialog()
    if (damageDialog.value && !options.canControlPokemon(damageDialog.value.id)) closeDamageDialog()
  }

  const closeTopmostOverlay = (): boolean => {
    if (damageDialog.value) {
      closeDamageDialog()
      return true
    }

    if (experienceDialog.value) {
      closeExperienceDialog()
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
    hpDialogInjuryResult,
    hpDialogPreviewMaxHp,
    combatStagesDialog,
    combatStagesDialogChanged,
    conditionsDialog,
    conditionsDialogChanged,
    experienceDialog,
    experienceDialogAmount,
    experienceDialogPreviewTotalExp,
    experienceDialogPreviewLevel,
    damageDialog,
    damageDialogDbDef,
    damageDialogRawAmount,
    damageDialogDefense,
    damageDialogAttackerOptions,
    damageDialogAttackBonus,
    damageDialogMultiplier,
    damageDialogHpLoss,
    damageDialogPreview,
    damageDialogInjuryResult,
    damageDialogPreviewMaxHp,
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
    handleContextGrantExperience,
    closeExperienceDialog,
    handleExperienceDialogSubmit,
    handleContextUseMove,
    handleContextUseManeuver,
    handleContextUseAbility,
    handleContextUseOrder,
    handleContextSendOutPokemon,
    handleContextThrowPokeball,
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

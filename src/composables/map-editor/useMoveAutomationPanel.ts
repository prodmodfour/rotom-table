import { computed, onBeforeUnmount, ref, type ComputedRef, type Ref } from 'vue'
import {
  buildTokenMoveMenuOptions,
  moveEntriesForPlacement,
  type TokenSheetMoveEntry,
} from '~/utils/mapTokenMoves'
import {
  damageFormulaForMove,
  isSeamlessAreaConfirmationScript,
  isSeamlessSelfMoveScript,
  isSeamlessSingleTargetMoveScript,
} from '~/utils/moveAutomation'
import { directHpLossRollFormulaForScript } from '~/utils/moveAutomationDirectHpLoss'
import { moveAutomationCanResolveDamageAtRuntime } from '~/utils/moveAutomationDynamicDamage'
import {
  buildMoveAutomationAreaTemplateCells,
  buildMoveAutomationAreaTemplatePlacements,
  tokensInMoveAutomationArea,
  type MoveAutomationAreaTemplatePlacement,
} from '~/utils/moveAutomationAreaTemplates'
import { buildMoveAutomationMoveEntries } from '~/utils/moveAutomationMoves'
import {
  resolveInstantAreaMoveAutomation,
  resolveInstantMoveAutomation,
  resolveInstantSelfMoveAutomation,
  resolveInstantTargetMoveAutomation,
} from '~/utils/moveAutomationInstant'
import { isMoveDisabledByConditions } from '~/utils/statusConditions'
import {
  setTokenFacingOnPlacement,
  tokenFacingAreaDirection,
  tokenFacingForPlacement,
  tokenFacingFromAreaDirection,
  tokenFacingTowardPoint,
} from '~/utils/tokenFacing'
import {
  buildSpiteReactionConditionUpdate,
  buildSpiteReactionPrompts,
} from '~/utils/moveAutomationSpite'
import {
  buildCuteCharmReactionConditionUpdate,
  buildCuteCharmReactionPrompts,
} from '~/utils/moveAutomationCuteCharm'
import {
  buildMoxieTriggerPrompts,
  buildMoxieTriggerTransaction,
} from '~/utils/moveAutomationMoxie'
import {
  moveAutomationTargetsInRange,
  parseSingleTargetMoveRangeMeters,
} from '~/utils/moveAutomationRange'
import { buildAllVoxelOccupancy } from '~/utils/voxelOccupancy'
import type { CharacterSheet } from '~/types/characterSheet'
import type { GridAnchor, MapFieldEffects, MapHazardV2, TabletopMap } from '~/types/map'
import type {
  MoveAutomationAreaDirection,
  MoveAutomationAreaDirectionOption,
  MoveAutomationCombatStageUpdate,
  MoveAutomationConditionUpdate,
  MoveAutomationFieldEffectApply,
  MoveAutomationHpUpdate,
  MoveAutomationFeedbackState,
  MoveAutomationLogEntry,
  MoveAutomationCuteCharmPrompt,
  MoveAutomationMoxiePrompt,
  MoveAutomationScript,
  MoveAutomationSpitePrompt,
  MoveAutomationTargetingOverlayState,
  MoveAutomationTransaction,
} from '~/types/moveAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { TrainerSheet } from '~/types/trainerSheet'

interface BooleanRef {
  readonly value: boolean
}

type SheetMapRef<T> = Ref<Map<string, T> | undefined>
type MaybePromise<T> = T | Promise<T>

type SheetUpdateOptions = { allowAnyTarget?: boolean }

type SheetUpdateHandler<TUpdate> = (
  update: TUpdate,
  options?: SheetUpdateOptions,
) => MaybePromise<void>

export interface UseMoveAutomationPanelOptions {
  map: Ref<TabletopMap | null>
  spawnedPokemon: ComputedRef<SpawnedPokemon[]>
  pokemonBySlug: SheetMapRef<CharacterSheet>
  trainerBySlug: SheetMapRef<TrainerSheet>
  canEditMap: BooleanRef
  canControlPlacement: (id: string) => boolean
  modifyHp: SheetUpdateHandler<MoveAutomationHpUpdate>
  modifyCombatStages: SheetUpdateHandler<MoveAutomationCombatStageUpdate>
  modifyConditions: SheetUpdateHandler<MoveAutomationConditionUpdate>
  applyMoveFieldEffect: (effect: MoveAutomationFieldEffectApply) => MaybePromise<void>
  placeHazard: (hazard: MapHazardV2) => MaybePromise<void>
  now?: () => number
  maxLogEntries?: number
}

const DEFAULT_MAX_LOG_ENTRIES = 100
const D20_ROLL_ANIMATION_MS = 850
const ROLL_RESULT_VISIBLE_MS = 1600

interface ActiveSingleTargetingRequest {
  kind: 'single-target'
  userId: string
  moveName: string
  script: MoveAutomationScript
  damageFormula: string | null
  rangeMeters: number
}

interface ActiveAreaConfirmationRequest {
  kind: 'area-confirmation'
  userId: string
  moveName: string
  script: MoveAutomationScript
  damageFormula: string | null
  label: string
  cells: GridAnchor[]
  targetIds: string[]
  direction?: MoveAutomationAreaDirection
  directionOptions: MoveAutomationAreaDirectionOption[]
}

type ActiveMoveTargetingRequest = ActiveSingleTargetingRequest | ActiveAreaConfirmationRequest

export const appendMoveAutomationLogEntry = (
  metadata: Record<string, unknown> | undefined,
  transaction: MoveAutomationTransaction,
  options: { now?: () => number; maxLogEntries?: number } = {},
): Record<string, unknown> => {
  const next = { ...(metadata ?? {}) }
  const previous = Array.isArray(next.moveLog) ? next.moveLog : []
  const entry: MoveAutomationLogEntry = {
    at: options.now?.() ?? Date.now(),
    userId: transaction.userId,
    userName: transaction.userName,
    moveName: transaction.moveName,
    scriptKind: transaction.scriptKind,
    scriptVersion: transaction.scriptVersion,
    lines: transaction.logLines,
  }
  next.moveLog = [...previous, entry].slice(-(options.maxLogEntries ?? DEFAULT_MAX_LOG_ENTRIES))
  return next
}

export const useMoveAutomationPanel = ({
  map,
  spawnedPokemon,
  pokemonBySlug,
  trainerBySlug,
  canEditMap,
  canControlPlacement,
  modifyHp,
  modifyCombatStages,
  modifyConditions,
  applyMoveFieldEffect,
  placeHazard,
  now,
  maxLogEntries = DEFAULT_MAX_LOG_ENTRIES,
}: UseMoveAutomationPanelOptions) => {
  const activeMoveTargeting = ref<ActiveMoveTargetingRequest | null>(null)
  const moveAutomationFeedback = ref<MoveAutomationFeedbackState | null>(null)
  const spiteReactionPrompts = ref<MoveAutomationSpitePrompt[]>([])
  const cuteCharmReactionPrompts = ref<MoveAutomationCuteCharmPrompt[]>([])
  const moxieTriggerPrompts = ref<MoveAutomationMoxiePrompt[]>([])
  const feedbackTimers: Array<ReturnType<typeof setTimeout>> = []

  const sheetLookup = () => ({
    pokemon: pokemonBySlug.value,
    trainer: trainerBySlug.value,
  })

  const moveEntriesForId = (id: string | null | undefined): TokenSheetMoveEntry[] => {
    if (!map.value || !id) return []
    return moveEntriesForPlacement(
      map.value.placements.find((item) => item.id === id),
      sheetLookup(),
    )
  }

  const findSpawnedPokemon = (id: string | null | undefined): SpawnedPokemon | null =>
    id ? spawnedPokemon.value.find((pokemon) => pokemon.id === id) ?? null : null

  const placementById = (id: string) => map.value?.placements.find((placement) => placement.id === id) ?? null

  const tokenFacingPoint = (token: SpawnedPokemon) => ({
    x: token.position.x + token.base / 2,
    z: token.position.z + token.base / 2,
  })

  const faceTokenTowardPoint = (user: SpawnedPokemon, point: { x: number; z: number }) => {
    const placement = placementById(user.id)
    if (!placement) return
    const facing = tokenFacingTowardPoint(
      tokenFacingPoint(user),
      point,
      tokenFacingForPlacement(placement),
    )
    if (facing) setTokenFacingOnPlacement(placement, facing)
  }

  const faceTokenTowardToken = (user: SpawnedPokemon, target: SpawnedPokemon) => {
    faceTokenTowardPoint(user, tokenFacingPoint(target))
  }

  const faceTokenTowardAreaDirection = (
    user: SpawnedPokemon,
    direction: MoveAutomationAreaDirection | undefined,
  ) => {
    if (!direction) return
    const placement = placementById(user.id)
    if (!placement) return
    const facing = tokenFacingFromAreaDirection(direction, tokenFacingForPlacement(placement))
    if (facing) setTokenFacingOnPlacement(placement, facing)
  }

  const faceTokenTowardNearestTarget = (user: SpawnedPokemon, targets: readonly SpawnedPokemon[]) => {
    const origin = tokenFacingPoint(user)
    const target = [...targets]
      .sort((a, b) => {
        const aPoint = tokenFacingPoint(a)
        const bPoint = tokenFacingPoint(b)
        const aDistance = (aPoint.x - origin.x) ** 2 + (aPoint.z - origin.z) ** 2
        const bDistance = (bPoint.x - origin.x) ** 2 + (bPoint.z - origin.z) ** 2
        return aDistance - bDistance
      })[0]
    if (target) faceTokenTowardToken(user, target)
  }

  const moveDisabledForToken = (token: SpawnedPokemon, moveName: string): boolean =>
    isMoveDisabledByConditions(moveName, token.conditions)

  const moveAutomationEntryForUse = (id: string, moveName: string) => {
    const user = findSpawnedPokemon(id)
    if (!user || moveDisabledForToken(user, moveName)) return null
    const normalizedMoveName = moveName.trim().toLowerCase()
    const moves = moveEntriesForId(id).map((entry) => entry.move)
    return buildMoveAutomationMoveEntries(moves, {
      stabTypes: user.sheetKind === 'pokemon' ? user.defenderTypes : [],
      combatSkillRankValue: user.combatSkillRankValue,
    }).find((entry) =>
      entry.move.name.toLowerCase() === normalizedMoveName
        || entry.sheetMove.name.toLowerCase() === normalizedMoveName,
    ) ?? null
  }

  const moveAutomationTargeting = computed<MoveAutomationTargetingOverlayState | null>(() => {
    const request = activeMoveTargeting.value
    const user = findSpawnedPokemon(request?.userId)
    if (!request || !user || !canControlPlacement(request.userId)) return null

    if (request.kind === 'area-confirmation') {
      return {
        userId: request.userId,
        moveName: request.moveName,
        mode: 'area-confirmation',
        rangeLabel: request.label,
        rangeMeters: 0,
        candidateIds: request.targetIds,
        areaCells: request.cells,
        affectedIds: request.targetIds,
        areaDirection: request.direction,
        areaDirectionOptions: request.directionOptions,
      }
    }

    const candidates = moveAutomationTargetsInRange({
      user,
      tokens: spawnedPokemon.value,
      rangeMeters: request.rangeMeters,
    })
    if (/\bSelf\b/i.test(request.script.range)) candidates.unshift(user)
    return {
      userId: request.userId,
      moveName: request.moveName,
      mode: 'target',
      rangeLabel: `${request.rangeMeters}m`,
      rangeMeters: request.rangeMeters,
      candidateIds: candidates.map((candidate) => candidate.id),
    }
  })

  const tokenMoveOptionsById = computed(() => {
    const out: Record<string, ReturnType<typeof buildTokenMoveMenuOptions>> = {}
    if (!map.value) return out
    for (const token of spawnedPokemon.value) {
      out[token.id] = buildTokenMoveMenuOptions(token, moveEntriesForId(token.id))
    }
    return out
  })

  const clearFeedbackTimers = () => {
    while (feedbackTimers.length) {
      const timer = feedbackTimers.pop()
      if (timer) clearTimeout(timer)
    }
  }

  const clearMoveAutomationFeedback = () => {
    clearFeedbackTimers()
    moveAutomationFeedback.value = null
  }

  const tokenAreaDirection = (user: SpawnedPokemon): MoveAutomationAreaDirection =>
    tokenFacingAreaDirection(tokenFacingForPlacement(user))

  const areaTemplateCellConstraints = () => ({
    bounds: map.value?.dimensions,
    blockedCells: buildAllVoxelOccupancy(map.value?.voxels ?? []),
  })

  const directionOptionsForPlacements = (
    placements: readonly MoveAutomationAreaTemplatePlacement[],
  ): MoveAutomationAreaDirectionOption[] => placements
    .filter((placement): placement is MoveAutomationAreaTemplatePlacement & { direction: MoveAutomationAreaDirection } => Boolean(placement.direction))
    .map((placement) => ({
      direction: placement.direction,
      label: placement.label,
      areaCells: placement.cells,
      affectedIds: placement.targetIds,
    }))

  const areaPlacementForTokenFacing = (
    placements: readonly MoveAutomationAreaTemplatePlacement[],
    user: SpawnedPokemon,
  ): MoveAutomationAreaTemplatePlacement | null => placements.find((placement) =>
    placement.direction === tokenAreaDirection(user),
  ) ?? placements[0] ?? null

  const requestFromAreaPlacement = (
    user: SpawnedPokemon,
    script: MoveAutomationScript,
    damageFormula: string | null,
    placement: MoveAutomationAreaTemplatePlacement,
    placements: readonly MoveAutomationAreaTemplatePlacement[],
  ): ActiveAreaConfirmationRequest => ({
    kind: 'area-confirmation',
    userId: user.id,
    moveName: script.moveName,
    script,
    damageFormula,
    label: placement.label,
    cells: placement.cells,
    targetIds: placement.targetIds,
    direction: placement.direction,
    directionOptions: directionOptionsForPlacements(placements),
  })

  const makeFallbackAreaPlacement = (
    script: MoveAutomationScript,
    damageFormula: string | null,
    user: SpawnedPokemon,
  ): ActiveAreaConfirmationRequest | null => {
    const template = script.areaTemplates?.[0]
    if (!template) return null
    const direction = template.kind === 'cone' || template.kind === 'line' || template.kind === 'close-blast'
      ? tokenAreaDirection(user)
      : undefined
    const cells = buildMoveAutomationAreaTemplateCells({
      template,
      user,
      direction,
      ...areaTemplateCellConstraints(),
    })
    const targetIds = tokensInMoveAutomationArea({
      cells,
      tokens: spawnedPokemon.value,
      excludeIds: [user.id],
    }).map((token) => token.id)
    return {
      kind: 'area-confirmation',
      userId: user.id,
      moveName: script.moveName,
      script,
      damageFormula,
      label: template.label,
      cells,
      targetIds,
      direction,
      directionOptions: [],
    }
  }

  const rollFormulaForEntry = (entry: NonNullable<ReturnType<typeof moveAutomationEntryForUse>>): string | null =>
    directHpLossRollFormulaForScript(entry.script) ?? damageFormulaForMove(entry.move)

  const beginSeamlessAreaConfirmation = (id: string, entry: ReturnType<typeof moveAutomationEntryForUse>): boolean => {
    const user = findSpawnedPokemon(id)
    if (!user || !entry || !isSeamlessAreaConfirmationScript(entry.script)) return false
    const damageFormula = entry.script.damaging ? rollFormulaForEntry(entry) : null
    if (entry.script.damaging && !damageFormula && !moveAutomationCanResolveDamageAtRuntime(entry.script)) return false
    const placements = buildMoveAutomationAreaTemplatePlacements({
      script: entry.script,
      user,
      tokens: spawnedPokemon.value,
      includeEmpty: true,
      ...areaTemplateCellConstraints(),
    })
    const placement = areaPlacementForTokenFacing(placements, user)
    const request = placement
      ? requestFromAreaPlacement(user, entry.script, damageFormula, placement, placements)
      : makeFallbackAreaPlacement(entry.script, damageFormula, user)
    if (!request) return false

    clearMoveAutomationFeedback()
    activeMoveTargeting.value = request
    return true
  }

  const beginSeamlessMoveTargeting = (id: string, moveName: string | null | undefined): boolean => {
    const trimmedMoveName = moveName?.trim()
    if (!trimmedMoveName) return false
    const user = findSpawnedPokemon(id)
    const entry = moveAutomationEntryForUse(id, trimmedMoveName)
    if (!user || !entry) return false
    const script: MoveAutomationScript = entry.script

    if (isSeamlessSelfMoveScript(script)) {
      clearMoveAutomationFeedback()
      activeMoveTargeting.value = null
      void applyMoveAutomation(resolveInstantSelfMoveAutomation({
        script,
        user,
        fieldEffects: map.value?.fieldEffects,
      }))
      return true
    }

    if (isSeamlessSingleTargetMoveScript(script)) {
      const rangeMeters = parseSingleTargetMoveRangeMeters(script.range, {
        focusSkillRankValue: user.focusSkillRankValue,
      })
      const damageFormula = rollFormulaForEntry(entry)
      if (rangeMeters == null || (script.damaging && !damageFormula && !moveAutomationCanResolveDamageAtRuntime(script))) return false

      clearMoveAutomationFeedback()
      activeMoveTargeting.value = {
        kind: 'single-target',
        userId: id,
        moveName: script.moveName,
        script,
        damageFormula,
        rangeMeters,
      }
      return true
    }

    return beginSeamlessAreaConfirmation(id, entry)
  }

  const openMoveAutomation = (input: string | { id: string; moveName?: string | null }) => {
    const id = typeof input === 'string' ? input : input.id
    if (!canControlPlacement(id)) return
    const moveName = typeof input === 'string' ? null : input.moveName?.trim() || null
    if (beginSeamlessMoveTargeting(id, moveName)) return

    clearMoveAutomationFeedback()
    activeMoveTargeting.value = null
  }

  const cancelMoveAutomationTargeting = () => {
    activeMoveTargeting.value = null
  }

  const appendMoveAutomationLog = (transaction: MoveAutomationTransaction) => {
    if (!map.value) return
    map.value.metadata = appendMoveAutomationLogEntry(map.value.metadata, transaction, {
      now,
      maxLogEntries,
    })
  }

  const queueSpiteReactionPrompts = (transaction: MoveAutomationTransaction) => {
    const attacker = findSpawnedPokemon(transaction.userId)
    const hitTargets = (transaction.hitTargetIds ?? [])
      .map((id) => findSpawnedPokemon(id))
      .filter((token): token is SpawnedPokemon => Boolean(token))
    if (!attacker || !hitTargets.length) return

    const prompts = buildSpiteReactionPrompts({
      attacker,
      moveName: transaction.moveName,
      hitTargets,
      moveEntriesForTarget: (target) => moveEntriesForId(target.id),
      existingPrompts: spiteReactionPrompts.value,
    })
    if (prompts.length) spiteReactionPrompts.value = [...spiteReactionPrompts.value, ...prompts]
  }

  const queueCuteCharmReactionPrompts = (transaction: MoveAutomationTransaction) => {
    const attacker = findSpawnedPokemon(transaction.userId)
    const attackedTargets = (transaction.attackedTargetIds ?? transaction.hitTargetIds ?? [])
      .map((id) => findSpawnedPokemon(id))
      .filter((token): token is SpawnedPokemon => Boolean(token))
    if (!attacker || !attackedTargets.length) return

    const prompts = buildCuteCharmReactionPrompts({
      attacker,
      moveName: transaction.moveName,
      attackedTargets,
      existingPrompts: cuteCharmReactionPrompts.value,
    })
    if (prompts.length) cuteCharmReactionPrompts.value = [...cuteCharmReactionPrompts.value, ...prompts]
  }

  const moxieTriggerPromptsForTransaction = (
    transaction: MoveAutomationTransaction,
  ): MoveAutomationMoxiePrompt[] => {
    const attacker = findSpawnedPokemon(transaction.userId)
    if (!attacker) return []

    return buildMoxieTriggerPrompts({
      attacker,
      moveName: transaction.moveName,
      hpUpdates: transaction.hpUpdates,
      hitTargetIds: transaction.hitTargetIds,
      tokens: spawnedPokemon.value,
      existingPrompts: moxieTriggerPrompts.value,
    })
  }

  const queueMoxieTriggerPrompts = (prompts: readonly MoveAutomationMoxiePrompt[]) => {
    if (prompts.length) moxieTriggerPrompts.value = [...moxieTriggerPrompts.value, ...prompts]
  }

  const dismissSpiteReactionPrompt = (id: string) => {
    spiteReactionPrompts.value = spiteReactionPrompts.value.filter((prompt) => prompt.id !== id)
  }

  const applySpiteReactionPrompt = async (id: string) => {
    const prompt = spiteReactionPrompts.value.find((item) => item.id === id)
    if (!prompt) return

    const attacker = findSpawnedPokemon(prompt.attackerId)
    const update = attacker ? buildSpiteReactionConditionUpdate(attacker, prompt.moveName) : null
    if (update) await modifyConditions(update, { allowAnyTarget: true })
    dismissSpiteReactionPrompt(id)
  }

  const dismissCuteCharmReactionPrompt = (id: string) => {
    cuteCharmReactionPrompts.value = cuteCharmReactionPrompts.value.filter((prompt) => prompt.id !== id)
  }

  const applyCuteCharmReactionPrompt = async (id: string) => {
    const prompt = cuteCharmReactionPrompts.value.find((item) => item.id === id)
    if (!prompt) return

    const attacker = findSpawnedPokemon(prompt.attackerId)
    const defender = findSpawnedPokemon(prompt.defenderId)
    const update = attacker && defender ? buildCuteCharmReactionConditionUpdate(attacker, defender) : null
    if (update) await modifyConditions(update, { allowAnyTarget: true })
    dismissCuteCharmReactionPrompt(id)
  }

  const dismissMoxieTriggerPrompt = (id: string) => {
    moxieTriggerPrompts.value = moxieTriggerPrompts.value.filter((prompt) => prompt.id !== id)
  }

  const applyMoxieTriggerPrompt = async (id: string) => {
    const prompt = moxieTriggerPrompts.value.find((item) => item.id === id)
    if (!prompt) return

    const attacker = findSpawnedPokemon(prompt.attackerId)
    const firstFaintedTarget = prompt.faintedTargetIds
      .map((targetId) => findSpawnedPokemon(targetId))
      .find((target): target is SpawnedPokemon => Boolean(target)) ?? null
    const transaction = attacker ? buildMoxieTriggerTransaction(attacker, firstFaintedTarget) : null
    if (transaction) {
      for (const update of transaction.combatStageUpdates) {
        await modifyCombatStages(update, { allowAnyTarget: true })
      }
    }
    dismissMoxieTriggerPrompt(id)
  }

  const faceTokenForTransaction = (transaction: MoveAutomationTransaction) => {
    const user = findSpawnedPokemon(transaction.userId)
    if (!user) return
    const targetIds = transaction.attackedTargetIds
      ?? transaction.hitTargetIds
      ?? [
        ...transaction.hpUpdates.map((update) => update.id),
        ...transaction.combatStageUpdates.map((update) => update.id),
        ...transaction.conditionUpdates.map((update) => update.id),
      ]
    const targets = targetIds
      .filter((id) => id !== transaction.userId)
      .map((id) => findSpawnedPokemon(id))
      .filter((token): token is SpawnedPokemon => Boolean(token))
    faceTokenTowardNearestTarget(user, targets)
  }

  const applyMoveAutomation = async (
    transaction: MoveAutomationTransaction,
    options: { updateFacing?: boolean } = {},
  ) => {
    if (!map.value || !canControlPlacement(transaction.userId)) return
    if (options.updateFacing !== false) faceTokenForTransaction(transaction)
    const moxiePrompts = moxieTriggerPromptsForTransaction(transaction)
    for (const update of transaction.hpUpdates) await modifyHp(update, { allowAnyTarget: true })
    for (const update of transaction.combatStageUpdates) await modifyCombatStages(update, { allowAnyTarget: true })
    for (const update of transaction.conditionUpdates) await modifyConditions(update, { allowAnyTarget: true })
    if (canEditMap.value) {
      for (const effect of transaction.fieldEffectsToApply) await applyMoveFieldEffect(effect)
      for (const hazard of transaction.hazardsToAdd) await placeHazard(hazard)
    }
    appendMoveAutomationLog(transaction)
    queueMoxieTriggerPrompts(moxiePrompts)
    queueCuteCharmReactionPrompts(transaction)
    queueSpiteReactionPrompts(transaction)
  }

  const showMoveAutomationResolution = (
    feedback: MoveAutomationFeedbackState,
    transaction: MoveAutomationTransaction,
  ) => {
    clearFeedbackTimers()
    moveAutomationFeedback.value = feedback
    feedbackTimers.push(setTimeout(() => {
      if (moveAutomationFeedback.value?.id !== feedback.id) return
      moveAutomationFeedback.value = { ...feedback, phase: 'result' }
      void applyMoveAutomation(transaction)
    }, D20_ROLL_ANIMATION_MS))
    feedbackTimers.push(setTimeout(() => {
      if (moveAutomationFeedback.value?.id === feedback.id) moveAutomationFeedback.value = null
    }, D20_ROLL_ANIMATION_MS + ROLL_RESULT_VISIBLE_MS))
  }

  const selectMoveAutomationAreaDirection = (direction: MoveAutomationAreaDirection) => {
    const request = activeMoveTargeting.value
    if (request?.kind !== 'area-confirmation') return
    const option = request.directionOptions.find((item) => item.direction === direction)
    if (!option) return
    activeMoveTargeting.value = {
      ...request,
      label: option.label,
      cells: option.areaCells,
      targetIds: option.affectedIds,
      direction: option.direction,
    }
  }

  const confirmMoveAutomationArea = async (request: ActiveAreaConfirmationRequest) => {
    const user = findSpawnedPokemon(request.userId)
    if (!user) return
    const targetSet = new Set(request.targetIds)
    const targets = spawnedPokemon.value.filter((token) => targetSet.has(token.id))
    if (request.direction) faceTokenTowardAreaDirection(user, request.direction)
    else faceTokenTowardNearestTarget(user, targets)

    const transaction = resolveInstantAreaMoveAutomation({
      script: request.script,
      user,
      targets,
      damageFormula: request.damageFormula,
      fieldEffects: map.value?.fieldEffects,
      conditionImmunityContext: { sweetVeilProviders: spawnedPokemon.value },
    })
    activeMoveTargeting.value = null
    await applyMoveAutomation(transaction, { updateFacing: !request.direction })
  }

  const selectMoveAutomationTarget = async (targetId: string) => {
    const request = activeMoveTargeting.value
    const overlay = moveAutomationTargeting.value
    if (!request) return

    if (request.kind === 'area-confirmation') {
      await confirmMoveAutomationArea(request)
      return
    }

    if (!overlay?.candidateIds.includes(targetId)) return
    const user = findSpawnedPokemon(request.userId)
    const target = findSpawnedPokemon(targetId)
    if (!user || !target) return

    faceTokenTowardToken(user, target)

    if (!request.script.requiresAccuracy) {
      const transaction = resolveInstantTargetMoveAutomation({
        script: request.script,
        user,
        target,
        damageFormula: request.damageFormula,
        fieldEffects: map.value?.fieldEffects,
        conditionImmunityContext: { sweetVeilProviders: spawnedPokemon.value },
      })
      activeMoveTargeting.value = null
      await applyMoveAutomation(transaction)
      return
    }

    const result = resolveInstantMoveAutomation({
      script: request.script,
      user,
      target,
      damageFormula: request.damageFormula,
      fieldEffects: map.value?.fieldEffects,
      conditionImmunityContext: { sweetVeilProviders: spawnedPokemon.value },
    })
    activeMoveTargeting.value = null
    showMoveAutomationResolution(result.feedback, result.transaction)
  }

  onBeforeUnmount(clearFeedbackTimers)

  return {
    moveAutomationTargeting,
    moveAutomationFeedback,
    spiteReactionPrompts,
    cuteCharmReactionPrompts,
    moxieTriggerPrompts,
    tokenMoveOptionsById,
    openMoveAutomation,
    cancelMoveAutomationTargeting,
    selectMoveAutomationTarget,
    selectMoveAutomationAreaDirection,
    dismissSpiteReactionPrompt,
    applySpiteReactionPrompt,
    dismissCuteCharmReactionPrompt,
    applyCuteCharmReactionPrompt,
    dismissMoxieTriggerPrompt,
    applyMoxieTriggerPrompt,
    appendMoveAutomationLog,
    applyMoveAutomation,
  }
}

export type { SheetUpdateOptions }

import { computed, onBeforeUnmount, ref, type ComputedRef, type Ref } from 'vue'
import { findMove } from '~~/data/ptuReference'
import {
  buildTokenMoveMenuOptions,
  buildTokenMoveUsageState,
  moveEntriesForPlacement,
  type TokenSheetMoveEntry,
} from '~/utils/mapTokenMoves'
import {
  buildMoveAutomationScriptFromMoveData,
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
import { moveConditionUseBlock } from '~/utils/moveConditionRestrictions'
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
  buildPoisonPointReactionConditionUpdate,
  buildPoisonPointReactionPrompts,
} from '~/utils/moveAutomationPoisonPoint'
import {
  buildMoxieTriggerPrompts,
  buildMoxieTriggerTransaction,
} from '~/utils/moveAutomationMoxie'
import {
  buildCelebrateTriggerPrompts,
  buildCelebrateTriggerTransaction,
} from '~/utils/moveAutomationCelebrate'
import {
  moveAutomationTargetsInRange,
  parseSingleTargetMoveRangeMeters,
} from '~/utils/moveAutomationRange'
import { moveAutomationTargetHitChance } from '~/utils/moveAutomationAccuracy'
import { buildAllVoxelOccupancy } from '~/utils/voxelOccupancy'
import { getErrorMessage } from '~/utils/errorMessages'
import { moveFrequencyTracksOnMap, moveFrequencyTracksOnSheet, parseMoveFrequency } from '~/utils/moveUsage'
import { appendAbilityAutomationLogEntry } from '~/utils/abilityAutomationLog'
import type { AbilityAutomationTransaction } from '~/types/abilityAutomation'
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
  MoveAutomationCelebratePrompt,
  MoveAutomationCuteCharmPrompt,
  MoveAutomationMoxiePrompt,
  MoveAutomationPoisonPointPrompt,
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

type MoveUsageRecordRequest = { placementId: string; moveName: string }
type MoveUsageRecordHandler = (request: MoveUsageRecordRequest) => MaybePromise<void>

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
  recordMoveUsage?: MoveUsageRecordHandler
  now?: () => number
  maxLogEntries?: number
}

const DEFAULT_MAX_LOG_ENTRIES = 100
const D20_ROLL_ANIMATION_MS = 650
const HIT_ROLL_VISIBLE_MS = 850
const HIT_RESULT_VISIBLE_MS = 600
const EFFECTIVENESS_VISIBLE_MS = 700
const FINAL_RESULT_VISIBLE_MS = 1100

interface ActiveSingleTargetingRequest {
  kind: 'single-target'
  userId: string
  moveName: string
  script: MoveAutomationScript
  damageFormula: string | null
  frequency: string | null
  rangeMeters: number
}

interface ActiveAreaConfirmationRequest {
  kind: 'area-confirmation'
  userId: string
  moveName: string
  script: MoveAutomationScript
  damageFormula: string | null
  frequency: string | null
  label: string
  cells: GridAnchor[]
  /** All token ids in the current area template. */
  targetIds: string[]
  /** Candidate token ids manually excluded before confirming Friendly area moves. */
  excludedTargetIds: string[]
  direction?: MoveAutomationAreaDirection
  directionOptions: MoveAutomationAreaDirectionOption[]
  passDestination?: GridAnchor
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
  recordMoveUsage,
  now,
  maxLogEntries = DEFAULT_MAX_LOG_ENTRIES,
}: UseMoveAutomationPanelOptions) => {
  const activeMoveTargeting = ref<ActiveMoveTargetingRequest | null>(null)
  const moveAutomationFeedback = ref<MoveAutomationFeedbackState | null>(null)
  const moveUsageError = ref<string | null>(null)
  const spiteReactionPrompts = ref<MoveAutomationSpitePrompt[]>([])
  const cuteCharmReactionPrompts = ref<MoveAutomationCuteCharmPrompt[]>([])
  const poisonPointReactionPrompts = ref<MoveAutomationPoisonPointPrompt[]>([])
  const moxieTriggerPrompts = ref<MoveAutomationMoxiePrompt[]>([])
  const celebrateTriggerPrompts = ref<MoveAutomationCelebratePrompt[]>([])
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

  const sheetMoveUsageForPlacement = (id: string) => {
    const placement = placementById(id)
    if (!placement) return undefined
    return placement.sheetKind === 'pokemon'
      ? pokemonBySlug.value?.get(placement.sheetSlug)?.moveUsage
      : trainerBySlug.value?.get(placement.sheetSlug)?.moveUsage
  }

  const tokenMoveUsageContext = (id: string) => ({
    mapMoveUsage: map.value?.moveUsage,
    sheetMoveUsage: sheetMoveUsageForPlacement(id),
    currentRound: map.value?.initiative?.round ?? null,
  })

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

  const moveTokenToPassDestination = (id: string, destination: GridAnchor | undefined) => {
    if (!destination) return
    const placement = placementById(id)
    if (!placement) return
    placement.position = { ...destination }
  }

  const passDestinationLogLine = (user: SpawnedPokemon, destination: GridAnchor | undefined): string | null =>
    destination ? `${user.species} ends the Pass dash at (${destination.x}, ${destination.y}, ${destination.z}).` : null

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

  const moveAutomationEntryForUse = (id: string, moveName: string) => {
    const user = findSpawnedPokemon(id)
    if (!user) return null

    const normalizedMoveName = moveName.trim().toLowerCase()
    const moves = moveEntriesForId(id).map((entry) => entry.move)
    const entry = buildMoveAutomationMoveEntries(moves, {
      stabTypes: user.sheetKind === 'pokemon' ? user.defenderTypes : [],
      combatSkillRankValue: user.combatSkillRankValue,
    }).find((candidate) =>
      candidate.move.name.toLowerCase() === normalizedMoveName
        || candidate.sheetMove.name.toLowerCase() === normalizedMoveName,
    ) ?? null

    if (!entry) return null
    const blocked = moveConditionUseBlock({
      name: entry.move.name,
      aliases: [entry.sheetMove.name, entry.script.moveName],
      damageClass: entry.script.damageClass ?? entry.move.damage_class,
    }, user.conditions)
    if (blocked) return null

    const usage = buildTokenMoveUsageState(
      user.id,
      entry.move.name,
      entry.move.frequency ?? entry.sheetMove.frequency ?? null,
      tokenMoveUsageContext(user.id),
    )
    return usage?.available === false ? null : entry
  }

  const moveTargetHitChances = (
    script: MoveAutomationScript,
    user: SpawnedPokemon,
    targetIds: readonly string[],
  ): NonNullable<MoveAutomationTargetingOverlayState['hitChances']> => Object.fromEntries(
    targetIds.flatMap((targetId) => {
      const target = findSpawnedPokemon(targetId)
      return target ? [[targetId, moveAutomationTargetHitChance(script, user, target)]] : []
    }),
  )

  const canToggleAreaTargets = (script: MoveAutomationScript): boolean =>
    script.keywords.some((keyword) => /^Friendly$/i.test(keyword))

  const selectedAreaTargetIds = (request: ActiveAreaConfirmationRequest): string[] => {
    if (!canToggleAreaTargets(request.script) || !request.excludedTargetIds.length) return request.targetIds
    const excluded = new Set(request.excludedTargetIds)
    return request.targetIds.filter((id) => !excluded.has(id))
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
        hitChances: moveTargetHitChances(request.script, user, request.targetIds),
        areaCells: request.cells,
        affectedIds: selectedAreaTargetIds(request),
        canToggleTargets: canToggleAreaTargets(request.script),
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
    const candidateIds = candidates.map((candidate) => candidate.id)
    return {
      userId: request.userId,
      moveName: request.moveName,
      mode: 'target',
      rangeLabel: `${request.rangeMeters}m`,
      rangeMeters: request.rangeMeters,
      candidateIds,
      hitChances: moveTargetHitChances(request.script, user, candidateIds),
    }
  })

  const tokenMoveOptionsById = computed(() => {
    const out: Record<string, ReturnType<typeof buildTokenMoveMenuOptions>> = {}
    if (!map.value) return out
    for (const token of spawnedPokemon.value) {
      out[token.id] = buildTokenMoveMenuOptions(
        token,
        moveEntriesForId(token.id),
        tokenMoveUsageContext(token.id),
      )
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
      ...(placement.destination ? { destination: placement.destination } : {}),
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
    frequency: string | null,
    placement: MoveAutomationAreaTemplatePlacement,
    placements: readonly MoveAutomationAreaTemplatePlacement[],
  ): ActiveAreaConfirmationRequest => ({
    kind: 'area-confirmation',
    userId: user.id,
    moveName: script.moveName,
    script,
    damageFormula,
    frequency,
    label: placement.label,
    cells: placement.cells,
    targetIds: placement.targetIds,
    excludedTargetIds: [],
    direction: placement.direction,
    directionOptions: directionOptionsForPlacements(placements),
    ...(placement.destination ? { passDestination: placement.destination } : {}),
  })

  const makeFallbackAreaPlacement = (
    script: MoveAutomationScript,
    damageFormula: string | null,
    frequency: string | null,
    user: SpawnedPokemon,
  ): ActiveAreaConfirmationRequest | null => {
    const template = script.areaTemplates?.[0]
    if (!template || template.kind === 'pass') return null
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
      frequency,
      label: template.label,
      cells,
      targetIds,
      excludedTargetIds: [],
      direction,
      directionOptions: [],
    }
  }

  const rollFormulaForEntry = (entry: NonNullable<ReturnType<typeof moveAutomationEntryForUse>>): string | null =>
    directHpLossRollFormulaForScript(entry.script) ?? damageFormulaForMove(entry.move)

  const frequencyForEntry = (entry: NonNullable<ReturnType<typeof moveAutomationEntryForUse>>): string | null =>
    entry.move.frequency ?? entry.sheetMove.frequency ?? null

  const usageIsTracked = (frequency: string | null): boolean => {
    const parsed = parseMoveFrequency(frequency)
    return moveFrequencyTracksOnMap(parsed) || moveFrequencyTracksOnSheet(parsed)
  }

  const recordMoveUseIfTracked = async (request: MoveUsageRecordRequest, frequency: string | null): Promise<boolean> => {
    moveUsageError.value = null
    if (!usageIsTracked(frequency) || !recordMoveUsage) return true
    try {
      await recordMoveUsage(request)
      return true
    } catch (error) {
      const message = getErrorMessage(error, { fallback: 'Move usage could not be recorded.' })
      moveUsageError.value = message
      console.warn('[useMoveAutomationPanel] move usage failed', error)
      return false
    }
  }

  const beginSeamlessAreaConfirmation = (id: string, entry: ReturnType<typeof moveAutomationEntryForUse>): boolean => {
    const user = findSpawnedPokemon(id)
    if (!user || !entry || !isSeamlessAreaConfirmationScript(entry.script)) return false
    const damageFormula = entry.script.damaging ? rollFormulaForEntry(entry) : null
    const frequency = frequencyForEntry(entry)
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
      ? requestFromAreaPlacement(user, entry.script, damageFormula, frequency, placement, placements)
      : makeFallbackAreaPlacement(entry.script, damageFormula, frequency, user)
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
      const frequency = frequencyForEntry(entry)
      void (async () => {
        const recorded = await recordMoveUseIfTracked({ placementId: id, moveName: script.moveName }, frequency)
        if (!recorded) return
        await applyMoveAutomation(resolveInstantSelfMoveAutomation({
          script,
          user,
          fieldEffects: map.value?.fieldEffects,
        }), { script })
      })()
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
        frequency: frequencyForEntry(entry),
        rangeMeters,
      }
      return true
    }

    return beginSeamlessAreaConfirmation(id, entry)
  }

  const openMoveAutomation = (input: string | { id: string; moveName?: string | null }) => {
    moveUsageError.value = null
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

  const appendAbilityAutomationLog = (transaction: AbilityAutomationTransaction) => {
    if (!map.value) return
    map.value.metadata = appendAbilityAutomationLogEntry(map.value.metadata, transaction, {
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

  const scriptForPoisonPointReaction = (
    transaction: MoveAutomationTransaction,
    script?: MoveAutomationScript,
  ): MoveAutomationScript | null => {
    if (script) return script
    const move = findMove(transaction.moveName)
    return move ? buildMoveAutomationScriptFromMoveData(move) : null
  }

  const queuePoisonPointReactionPrompts = (
    transaction: MoveAutomationTransaction,
    script?: MoveAutomationScript,
  ) => {
    const attacker = findSpawnedPokemon(transaction.userId)
    const hitTargets = (transaction.hitTargetIds ?? [])
      .map((id) => findSpawnedPokemon(id))
      .filter((token): token is SpawnedPokemon => Boolean(token))
    if (!attacker || !hitTargets.length) return

    const prompts = buildPoisonPointReactionPrompts({
      attacker,
      moveName: transaction.moveName,
      hitTargets,
      script: scriptForPoisonPointReaction(transaction, script),
      existingPrompts: poisonPointReactionPrompts.value,
    })
    if (prompts.length) poisonPointReactionPrompts.value = [...poisonPointReactionPrompts.value, ...prompts]
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

  const celebrateTriggerPromptsForTransaction = (
    transaction: MoveAutomationTransaction,
    script?: MoveAutomationScript,
  ): MoveAutomationCelebratePrompt[] => {
    const attacker = findSpawnedPokemon(transaction.userId)
    if (!attacker || !script?.damaging) return []

    const hitTargets = (transaction.hitTargetIds ?? [])
      .map((id) => findSpawnedPokemon(id))
      .filter((token): token is SpawnedPokemon => Boolean(token))

    return buildCelebrateTriggerPrompts({
      attacker,
      moveName: transaction.moveName,
      damaging: script.damaging,
      hitTargets,
      existingPrompts: celebrateTriggerPrompts.value,
    })
  }

  const queueCelebrateTriggerPrompts = (prompts: readonly MoveAutomationCelebratePrompt[]) => {
    if (prompts.length) celebrateTriggerPrompts.value = [...celebrateTriggerPrompts.value, ...prompts]
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

  const dismissPoisonPointReactionPrompt = (id: string) => {
    poisonPointReactionPrompts.value = poisonPointReactionPrompts.value.filter((prompt) => prompt.id !== id)
  }

  const applyPoisonPointReactionPrompt = async (id: string) => {
    const prompt = poisonPointReactionPrompts.value.find((item) => item.id === id)
    if (!prompt) return

    const attacker = findSpawnedPokemon(prompt.attackerId)
    const defender = findSpawnedPokemon(prompt.defenderId)
    const update = attacker && defender ? buildPoisonPointReactionConditionUpdate(attacker, defender) : null
    if (update) await modifyConditions(update, { allowAnyTarget: true })
    dismissPoisonPointReactionPrompt(id)
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

  const dismissCelebrateTriggerPrompt = (id: string) => {
    celebrateTriggerPrompts.value = celebrateTriggerPrompts.value.filter((prompt) => prompt.id !== id)
  }

  const applyCelebrateTriggerPrompt = (id: string) => {
    const prompt = celebrateTriggerPrompts.value.find((item) => item.id === id)
    if (!prompt) return

    const attacker = findSpawnedPokemon(prompt.attackerId)
    const firstHitTarget = prompt.hitTargetIds
      .map((targetId) => findSpawnedPokemon(targetId))
      .find((target): target is SpawnedPokemon => Boolean(target)) ?? null
    const transaction = attacker ? buildCelebrateTriggerTransaction(attacker, firstHitTarget) : null
    if (transaction) appendAbilityAutomationLog(transaction)
    dismissCelebrateTriggerPrompt(id)
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
    options: { updateFacing?: boolean; script?: MoveAutomationScript } = {},
  ) => {
    if (!map.value || !canControlPlacement(transaction.userId)) return
    if (options.updateFacing !== false) faceTokenForTransaction(transaction)
    const moxiePrompts = moxieTriggerPromptsForTransaction(transaction)
    const celebratePrompts = celebrateTriggerPromptsForTransaction(transaction, options.script)
    for (const update of transaction.hpUpdates) await modifyHp(update, { allowAnyTarget: true })
    for (const update of transaction.combatStageUpdates) await modifyCombatStages(update, { allowAnyTarget: true })
    for (const update of transaction.conditionUpdates) await modifyConditions(update, { allowAnyTarget: true })
    if (canEditMap.value) {
      for (const effect of transaction.fieldEffectsToApply) await applyMoveFieldEffect(effect)
      for (const hazard of transaction.hazardsToAdd) await placeHazard(hazard)
    }
    appendMoveAutomationLog(transaction)
    queueMoxieTriggerPrompts(moxiePrompts)
    queueCelebrateTriggerPrompts(celebratePrompts)
    queueCuteCharmReactionPrompts(transaction)
    queuePoisonPointReactionPrompts(transaction, options.script)
    queueSpiteReactionPrompts(transaction)
  }

  const feedbackHasFinalResolutionPhase = (feedback: MoveAutomationFeedbackState): boolean =>
    feedback.damageResolved || feedback.conditions.length > 0

  const feedbackHasEffectivenessPhase = (feedback: MoveAutomationFeedbackState): boolean =>
    Boolean(feedback.effectiveness)

  const showMoveAutomationResolution = (
    feedback: MoveAutomationFeedbackState,
    transaction: MoveAutomationTransaction,
    options: { script?: MoveAutomationScript } = {},
  ) => {
    clearFeedbackTimers()

    const hasFinalPhase = feedbackHasFinalResolutionPhase(feedback)
    const hasEffectivenessPhase = hasFinalPhase && feedbackHasEffectivenessPhase(feedback)
    let transactionApplied = false
    const feedbackStillCurrent = () => moveAutomationFeedback.value?.id === feedback.id
    const applyTransactionOnce = () => {
      if (transactionApplied) return
      transactionApplied = true
      void applyMoveAutomation(transaction, { script: options.script })
    }
    const setFeedbackPhase = (phase: MoveAutomationFeedbackState['phase']): boolean => {
      if (!feedbackStillCurrent()) return false
      moveAutomationFeedback.value = { ...feedback, phase }
      return true
    }
    const scheduleFeedbackStep = (delay: number, step: () => void) => {
      feedbackTimers.push(setTimeout(step, delay))
    }

    moveAutomationFeedback.value = feedback
    scheduleFeedbackStep(D20_ROLL_ANIMATION_MS, () => {
      setFeedbackPhase('hit-roll')
    })

    const outcomeDelay = D20_ROLL_ANIMATION_MS + HIT_ROLL_VISIBLE_MS
    scheduleFeedbackStep(outcomeDelay, () => {
      if (!setFeedbackPhase('outcome')) return
      if (!hasFinalPhase) applyTransactionOnce()
    })

    if (hasFinalPhase) {
      const effectivenessDelay = outcomeDelay + HIT_RESULT_VISIBLE_MS
      if (hasEffectivenessPhase) {
        scheduleFeedbackStep(effectivenessDelay, () => {
          setFeedbackPhase('effectiveness')
        })
      }

      const finalDelay = effectivenessDelay + (hasEffectivenessPhase ? EFFECTIVENESS_VISIBLE_MS : 0)
      scheduleFeedbackStep(finalDelay, () => {
        if (!setFeedbackPhase('damage')) return
        applyTransactionOnce()
      })
      scheduleFeedbackStep(finalDelay + FINAL_RESULT_VISIBLE_MS, () => {
        if (feedbackStillCurrent()) moveAutomationFeedback.value = null
      })
      return
    }

    scheduleFeedbackStep(outcomeDelay + HIT_RESULT_VISIBLE_MS, () => {
      if (feedbackStillCurrent()) moveAutomationFeedback.value = null
    })
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
      passDestination: option.destination,
    }
  }

  const toggleMoveAutomationAreaTarget = (request: ActiveAreaConfirmationRequest, targetId: string) => {
    const excluded = new Set(request.excludedTargetIds)
    if (excluded.has(targetId)) excluded.delete(targetId)
    else excluded.add(targetId)
    activeMoveTargeting.value = {
      ...request,
      excludedTargetIds: Array.from(excluded),
    }
  }

  const confirmMoveAutomationArea = async (request: ActiveAreaConfirmationRequest) => {
    const user = findSpawnedPokemon(request.userId)
    if (!user) return
    const recorded = await recordMoveUseIfTracked(
      { placementId: request.userId, moveName: request.moveName },
      request.frequency,
    )
    if (!recorded) return
    const targetSet = new Set(selectedAreaTargetIds(request))
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
    const destinationLogLine = passDestinationLogLine(user, request.passDestination)
    if (destinationLogLine) transaction.logLines.push(destinationLogLine)
    activeMoveTargeting.value = null
    await applyMoveAutomation(transaction, { updateFacing: !request.direction, script: request.script })
    moveTokenToPassDestination(request.userId, request.passDestination)
  }

  const selectMoveAutomationTarget = async (targetId: string) => {
    const request = activeMoveTargeting.value
    const overlay = moveAutomationTargeting.value
    if (!request) return

    if (request.kind === 'area-confirmation') {
      if (canToggleAreaTargets(request.script) && request.targetIds.includes(targetId)) {
        toggleMoveAutomationAreaTarget(request, targetId)
        return
      }
      await confirmMoveAutomationArea(request)
      return
    }

    if (!overlay?.candidateIds.includes(targetId)) return
    const user = findSpawnedPokemon(request.userId)
    const target = findSpawnedPokemon(targetId)
    if (!user || !target) return

    const recorded = await recordMoveUseIfTracked(
      { placementId: request.userId, moveName: request.moveName },
      request.frequency,
    )
    if (!recorded) return

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
      await applyMoveAutomation(transaction, { script: request.script })
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
    showMoveAutomationResolution(result.feedback, result.transaction, { script: request.script })
  }

  onBeforeUnmount(clearFeedbackTimers)

  return {
    moveAutomationTargeting,
    moveAutomationFeedback,
    moveUsageError,
    spiteReactionPrompts,
    cuteCharmReactionPrompts,
    poisonPointReactionPrompts,
    moxieTriggerPrompts,
    celebrateTriggerPrompts,
    tokenMoveOptionsById,
    openMoveAutomation,
    cancelMoveAutomationTargeting,
    selectMoveAutomationTarget,
    selectMoveAutomationAreaDirection,
    dismissSpiteReactionPrompt,
    applySpiteReactionPrompt,
    dismissCuteCharmReactionPrompt,
    applyCuteCharmReactionPrompt,
    dismissPoisonPointReactionPrompt,
    applyPoisonPointReactionPrompt,
    dismissMoxieTriggerPrompt,
    applyMoxieTriggerPrompt,
    dismissCelebrateTriggerPrompt,
    applyCelebrateTriggerPrompt,
    appendMoveAutomationLog,
    applyMoveAutomation,
  }
}

export type { SheetUpdateOptions }

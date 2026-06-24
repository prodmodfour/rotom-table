import type { ResolveMoveIntent, ResolveMoveSelection } from '#shared/livePlayMoveResolution'
import { LIVE_PLAY_MOVE_RESOLUTION_MAX_TARGET_IDS } from '#shared/livePlayMoveResolution'
import { resolveCanonicalMoveEntryForPlacement } from '~/utils/authoritativeMoveEntries'
import {
  isSeamlessSelfMoveScript,
  isSeamlessSingleTargetMoveScript,
  isSeamlessTargetCountMoveScript,
  moveAutomationHasMultipleTargetBranches,
  moveAutomationScriptForTargetBranch,
  moveAutomationTargetBranches,
} from '~/utils/moveAutomation'
import { moveAutomationCanResolveDamageAtRuntime } from '~/utils/moveAutomationDynamicDamage'
import {
  resolveInstantMoveAutomation,
  resolveInstantMultiTargetMoveAutomation,
  resolveInstantSelfMoveAutomation,
  resolveInstantTargetMoveAutomation,
} from '~/utils/moveAutomationInstant'
import {
  moveAutomationTargetsInRange,
  parseExplicitMultiTargetMoveRangeMeters,
  parseSingleTargetMoveRangeMeters,
} from '~/utils/moveAutomationRange'
import { placementToSpawned, type SheetLookup } from '~/utils/placement'
import { tokenFacingForPlacement, tokenFacingTowardPoint } from '~/utils/tokenFacing'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetMoveUsageState } from '~/types/moveUsage'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type {
  MoveAutomationFeedbackState,
  MoveAutomationScript,
  MoveAutomationTransaction,
} from '~/types/moveAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { TokenFacingDirection } from '~/types/tokenFacing'
import type { TrainerSheet } from '~/types/trainerSheet'

export type AuthoritativeMoveResolutionFailureReason =
  | 'invalid'
  | 'not-found'
  | 'unauthorized-state'
  | 'conflict'
  | 'unsupported'

export type AuthoritativeMoveResolutionFailureCode =
  | 'actor-placement-missing'
  | 'actor-sheet-missing'
  | 'actor-token-unresolved'
  | 'duplicate-placement-id'
  | 'move-absent'
  | 'move-condition-blocked'
  | 'move-usage-unavailable'
  | 'target-branch-required'
  | 'target-branch-invalid'
  | 'target-branch-unexpected'
  | 'selection-kind-mismatch'
  | 'target-placement-missing'
  | 'target-sheet-missing'
  | 'target-token-unresolved'
  | 'target-out-of-range'
  | 'duplicate-target-id'
  | 'empty-target-selection'
  | 'too-many-targets'
  | 'unsupported-range'
  | 'unsupported-damage-resolution'
  | 'unsupported-move-script'

export class AuthoritativeMoveResolutionError extends Error {
  readonly reason: AuthoritativeMoveResolutionFailureReason
  readonly code: AuthoritativeMoveResolutionFailureCode

  constructor(
    reason: AuthoritativeMoveResolutionFailureReason,
    code: AuthoritativeMoveResolutionFailureCode,
    message: string,
  ) {
    super(message)
    this.name = 'AuthoritativeMoveResolutionError'
    this.reason = reason
    this.code = code
  }
}

export interface ResolveAuthoritativeMoveInput {
  readonly map: TabletopMap
  readonly pokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly trainerSheets: ReadonlyMap<string, TrainerSheet>
  readonly intent: ResolveMoveIntent
  readonly random?: () => number
  readonly now?: () => number
  readonly idFactory?: () => string
}

export interface AuthoritativeMoveResolution {
  readonly actorPlacementId: string
  readonly moveName: string
  readonly canonicalMoveName: string
  readonly frequency: string | null
  readonly damageFormula: string | null
  readonly targetBranchId?: string
  readonly selectedTargetIds: readonly string[]
  readonly script: MoveAutomationScript
  readonly transaction: MoveAutomationTransaction
  readonly feedback?: MoveAutomationFeedbackState
  readonly desiredFacing?: TokenFacingDirection
}

interface SpawnedTokenContext {
  readonly sheets: SheetLookup
  readonly placementById: ReadonlyMap<string, SheetPlacement>
  readonly tokens: readonly SpawnedPokemon[]
  readonly tokenById: ReadonlyMap<string, SpawnedPokemon>
}

const fail = (
  reason: AuthoritativeMoveResolutionFailureReason,
  code: AuthoritativeMoveResolutionFailureCode,
  message: string,
): never => {
  throw new AuthoritativeMoveResolutionError(reason, code, message)
}

const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const selectedTargetIdsForSelection = (selection: ResolveMoveSelection): readonly string[] => {
  if (selection.kind === 'self') return []
  if (selection.kind === 'single-target') return [selection.targetPlacementId]
  return selection.targetPlacementIds
}

const sheetForPlacement = (
  sheets: SheetLookup,
  placement: Pick<SheetPlacement, 'sheetKind' | 'sheetSlug'>,
): CharacterSheet | TrainerSheet | undefined => placement.sheetKind === 'pokemon'
  ? sheets.pokemon.get(placement.sheetSlug)
  : sheets.trainer.get(placement.sheetSlug)

const sheetMoveUsageForPlacement = (
  sheets: SheetLookup,
  placement: Pick<SheetPlacement, 'sheetKind' | 'sheetSlug'>,
): SheetMoveUsageState | undefined => sheetForPlacement(sheets, placement)?.moveUsage

const buildSpawnedTokenContext = (input: ResolveAuthoritativeMoveInput): SpawnedTokenContext => {
  const sheets: SheetLookup = {
    pokemon: new Map(input.pokemonSheets),
    trainer: new Map(input.trainerSheets),
  }
  const placementById = new Map<string, SheetPlacement>()
  for (const placement of input.map.placements) {
    if (placementById.has(placement.id)) {
      fail('conflict', 'duplicate-placement-id', `Duplicate placement id ${placement.id} exists on the authoritative map.`)
    }
    placementById.set(placement.id, placement)
  }

  const tokens: SpawnedPokemon[] = []
  const tokenById = new Map<string, SpawnedPokemon>()
  for (const placement of input.map.placements) {
    const token = placementToSpawned(placement, sheets, input.map)
    if (!token) continue
    tokens.push(token)
    tokenById.set(token.id, token)
  }

  return { sheets, placementById, tokens, tokenById }
}

const resolveActor = (
  context: SpawnedTokenContext,
  placementId: string,
): { placement: SheetPlacement; token: SpawnedPokemon } => {
  const placement = context.placementById.get(placementId)
    ?? fail('not-found', 'actor-placement-missing', `Actor placement ${placementId} was not found.`)

  const token = context.tokenById.get(placementId)
  if (token) return { placement, token }

  if (!sheetForPlacement(context.sheets, placement)) {
    fail(
      'not-found',
      'actor-sheet-missing',
      `Actor sheet ${placement.sheetKind}/${placement.sheetSlug} for placement ${placement.id} was not found.`,
    )
  }
  return fail('not-found', 'actor-token-unresolved', `Actor placement ${placement.id} could not resolve to a spawned token.`)
}

const resolveSelectedTarget = (
  context: SpawnedTokenContext,
  targetId: string,
): { placement: SheetPlacement; token: SpawnedPokemon } => {
  const placement = context.placementById.get(targetId)
    ?? fail('not-found', 'target-placement-missing', `Target placement ${targetId} was not found.`)

  const token = context.tokenById.get(targetId)
  if (token) return { placement, token }

  if (!sheetForPlacement(context.sheets, placement)) {
    fail(
      'not-found',
      'target-sheet-missing',
      `Target sheet ${placement.sheetKind}/${placement.sheetSlug} for placement ${placement.id} was not found.`,
    )
  }
  return fail('not-found', 'target-token-unresolved', `Target placement ${placement.id} could not resolve to a spawned token.`)
}

const assertNoDuplicateTargetIds = (targetIds: readonly string[]): void => {
  const seen = new Set<string>()
  for (const targetId of targetIds) {
    if (seen.has(targetId)) fail('conflict', 'duplicate-target-id', `Target placement ${targetId} was submitted more than once.`)
    seen.add(targetId)
  }
}

const resolveCanonicalScript = (options: {
  readonly baseScript: MoveAutomationScript
  readonly targetBranchId?: string
}): { script: MoveAutomationScript; targetBranchId?: string } => {
  if (moveAutomationHasMultipleTargetBranches(options.baseScript)) {
    if (!options.targetBranchId) {
      fail('invalid', 'target-branch-required', `${options.baseScript.moveName} requires a target branch.`)
    }
    const branch = moveAutomationTargetBranches(options.baseScript).find((item) => item.id === options.targetBranchId)
      ?? fail('invalid', 'target-branch-invalid', `Unknown target branch ${options.targetBranchId} for ${options.baseScript.moveName}.`)
    const script = moveAutomationScriptForTargetBranch(options.baseScript, branch)
      ?? fail('unsupported', 'target-branch-invalid', `Target branch ${branch.id} could not be applied.`)
    return { script: cloneJson(script), targetBranchId: branch.id }
  }

  if (options.targetBranchId) {
    fail('invalid', 'target-branch-unexpected', `${options.baseScript.moveName} does not accept a target branch.`)
  }

  return { script: cloneJson(options.baseScript) }
}

const assertResolvableDamage = (script: MoveAutomationScript, damageFormula: string | null): void => {
  if (script.damaging && !damageFormula && !moveAutomationCanResolveDamageAtRuntime(script)) {
    fail(
      'unsupported',
      'unsupported-damage-resolution',
      `${script.moveName} damage cannot be resolved automatically from authoritative data.`,
    )
  }
}

const tokenFacingPoint = (token: SpawnedPokemon): { x: number; z: number } => ({
  x: token.position.x + token.base / 2,
  z: token.position.z + token.base / 2,
})

const desiredFacingTowardToken = (
  userPlacement: SheetPlacement,
  user: SpawnedPokemon,
  target: SpawnedPokemon,
): TokenFacingDirection | undefined => tokenFacingTowardPoint(
  tokenFacingPoint(user),
  tokenFacingPoint(target),
  tokenFacingForPlacement(userPlacement),
) ?? undefined

const squaredFacingDistance = (from: SpawnedPokemon, to: SpawnedPokemon): number => {
  const fromPoint = tokenFacingPoint(from)
  const toPoint = tokenFacingPoint(to)
  return (toPoint.x - fromPoint.x) ** 2 + (toPoint.z - fromPoint.z) ** 2
}

const nearestSelectedTarget = (
  user: SpawnedPokemon,
  targets: readonly SpawnedPokemon[],
): SpawnedPokemon | null => [...targets]
  .sort((a, b) => {
    const distance = squaredFacingDistance(user, a) - squaredFacingDistance(user, b)
    return distance || a.id.localeCompare(b.id)
  })[0] ?? null

const desiredFacingTowardNearestTarget = (
  userPlacement: SheetPlacement,
  user: SpawnedPokemon,
  targets: readonly SpawnedPokemon[],
): TokenFacingDirection | undefined => {
  const target = nearestSelectedTarget(user, targets)
  return target ? desiredFacingTowardToken(userPlacement, user, target) : undefined
}

const createFeedbackIdFactory = (input: ResolveAuthoritativeMoveInput, random: () => number): (() => string) => {
  if (input.idFactory) return input.idFactory
  const now = input.now ?? Date.now
  let sequence = 0
  return () => {
    sequence += 1
    const randomPart = Math.floor(random() * 1_000_000_000).toString(36)
    return `move-resolution-${Math.floor(now())}-${sequence}-${randomPart}`
  }
}

const legalSingleTargetTokens = (options: {
  readonly script: MoveAutomationScript
  readonly user: SpawnedPokemon
  readonly tokens: readonly SpawnedPokemon[]
  readonly rangeMeters: number
}): SpawnedPokemon[] => {
  const targets = moveAutomationTargetsInRange({
    user: options.user,
    tokens: options.tokens,
    rangeMeters: options.rangeMeters,
  })
  return /\bSelf\b/i.test(options.script.range) ? [options.user, ...targets] : targets
}

const resolveSelfMove = (options: {
  readonly input: ResolveAuthoritativeMoveInput
  readonly actorPlacement: SheetPlacement
  readonly actor: SpawnedPokemon
  readonly script: MoveAutomationScript
  readonly frequency: string | null
  readonly damageFormula: string | null
  readonly canonicalMoveName: string
  readonly targetBranchId?: string
  readonly random: () => number
}): AuthoritativeMoveResolution => {
  if (!isSeamlessSelfMoveScript(options.script)) {
    fail('invalid', 'selection-kind-mismatch', `${options.script.moveName} is not a seamless self move.`)
  }
  const transaction = resolveInstantSelfMoveAutomation({
    script: options.script,
    user: options.actor,
    fieldEffects: options.input.map.fieldEffects,
    random: options.random,
  })
  return {
    actorPlacementId: options.actorPlacement.id,
    moveName: options.script.moveName,
    canonicalMoveName: options.canonicalMoveName,
    frequency: options.frequency,
    damageFormula: options.damageFormula,
    ...(options.targetBranchId ? { targetBranchId: options.targetBranchId } : {}),
    selectedTargetIds: [],
    script: options.script,
    transaction,
  }
}

const resolveSingleTargetMove = (options: {
  readonly input: ResolveAuthoritativeMoveInput
  readonly context: SpawnedTokenContext
  readonly actorPlacement: SheetPlacement
  readonly actor: SpawnedPokemon
  readonly script: MoveAutomationScript
  readonly selection: Extract<ResolveMoveSelection, { kind: 'single-target' }>
  readonly frequency: string | null
  readonly damageFormula: string | null
  readonly canonicalMoveName: string
  readonly targetBranchId?: string
  readonly random: () => number
  readonly idFactory: () => string
}): AuthoritativeMoveResolution => {
  const moveName = options.script.moveName
  if (!isSeamlessSingleTargetMoveScript(options.script)) {
    fail('invalid', 'selection-kind-mismatch', `${moveName} is not a seamless single-target move.`)
  }
  assertResolvableDamage(options.script, options.damageFormula)

  const rangeMeters = parseSingleTargetMoveRangeMeters(options.script.range, {
    focusSkillRankValue: options.actor.focusSkillRankValue,
  }) ?? fail('unsupported', 'unsupported-range', `${options.script.moveName} has an unsupported target range.`)

  const target = resolveSelectedTarget(options.context, options.selection.targetPlacementId).token
  const legalTargets = legalSingleTargetTokens({
    script: options.script,
    user: options.actor,
    tokens: options.context.tokens,
    rangeMeters,
  })
  if (!legalTargets.some((candidate) => candidate.id === target.id)) {
    fail('invalid', 'target-out-of-range', `Target ${target.id} is outside ${options.script.moveName}'s authoritative range.`)
  }

  const desiredFacing = desiredFacingTowardToken(options.actorPlacement, options.actor, target)
  const common = {
    script: options.script,
    user: options.actor,
    target,
    damageFormula: options.damageFormula,
    fieldEffects: options.input.map.fieldEffects,
    conditionImmunityContext: { sweetVeilProviders: options.context.tokens },
    random: options.random,
  }

  if (!options.script.requiresAccuracy) {
    const transaction = resolveInstantTargetMoveAutomation(common)
    return {
      actorPlacementId: options.actorPlacement.id,
      moveName: options.script.moveName,
      canonicalMoveName: options.canonicalMoveName,
      frequency: options.frequency,
      damageFormula: options.damageFormula,
      ...(options.targetBranchId ? { targetBranchId: options.targetBranchId } : {}),
      selectedTargetIds: [target.id],
      script: options.script,
      transaction,
      ...(desiredFacing ? { desiredFacing } : {}),
    }
  }

  const result = resolveInstantMoveAutomation({
    ...common,
    idFactory: options.idFactory,
  })
  return {
    actorPlacementId: options.actorPlacement.id,
    moveName: options.script.moveName,
    canonicalMoveName: options.canonicalMoveName,
    frequency: options.frequency,
    damageFormula: options.damageFormula,
    ...(options.targetBranchId ? { targetBranchId: options.targetBranchId } : {}),
    selectedTargetIds: [target.id],
    script: options.script,
    transaction: result.transaction,
    feedback: result.feedback,
    ...(desiredFacing ? { desiredFacing } : {}),
  }
}

const resolveTargetCountMove = (options: {
  readonly input: ResolveAuthoritativeMoveInput
  readonly context: SpawnedTokenContext
  readonly actorPlacement: SheetPlacement
  readonly actor: SpawnedPokemon
  readonly script: MoveAutomationScript
  readonly selection: Extract<ResolveMoveSelection, { kind: 'target-count' }>
  readonly frequency: string | null
  readonly damageFormula: string | null
  readonly canonicalMoveName: string
  readonly targetBranchId?: string
  readonly random: () => number
}): AuthoritativeMoveResolution => {
  const moveName = options.script.moveName
  if (!isSeamlessTargetCountMoveScript(options.script)) {
    fail('invalid', 'selection-kind-mismatch', `${moveName} is not a seamless target-count move.`)
  }
  assertResolvableDamage(options.script, options.damageFormula)

  const submittedTargetIds = options.selection.targetPlacementIds
  if (submittedTargetIds.length === 0) fail('invalid', 'empty-target-selection', 'At least one target is required.')
  if (submittedTargetIds.length > LIVE_PLAY_MOVE_RESOLUTION_MAX_TARGET_IDS) {
    fail('invalid', 'too-many-targets', `At most ${LIVE_PLAY_MOVE_RESOLUTION_MAX_TARGET_IDS} targets may be submitted.`)
  }
  assertNoDuplicateTargetIds(submittedTargetIds)

  const maxTargetCount = typeof options.script.targetCount === 'number' && Number.isFinite(options.script.targetCount)
    ? Math.floor(options.script.targetCount)
    : 0
  if (submittedTargetIds.length > maxTargetCount) {
    fail('invalid', 'too-many-targets', `${options.script.moveName} can target at most ${maxTargetCount} targets.`)
  }

  const rangeMeters = parseExplicitMultiTargetMoveRangeMeters(options.script.range)
    ?? fail('unsupported', 'unsupported-range', `${options.script.moveName} has an unsupported target-count range.`)

  for (const targetId of submittedTargetIds) resolveSelectedTarget(options.context, targetId)

  const legalTargets = moveAutomationTargetsInRange({
    user: options.actor,
    tokens: options.context.tokens,
    rangeMeters,
  })
  const legalTargetIds = new Set(legalTargets.map((target) => target.id))
  for (const targetId of submittedTargetIds) {
    if (!legalTargetIds.has(targetId)) {
      fail('invalid', 'target-out-of-range', `Target ${targetId} is outside ${options.script.moveName}'s authoritative range.`)
    }
  }

  const submittedTargetSet = new Set(submittedTargetIds)
  const selectedTargets = legalTargets.filter((target) => submittedTargetSet.has(target.id))
  const selectedTargetIds = selectedTargets.map((target) => target.id)
  const transaction = resolveInstantMultiTargetMoveAutomation({
    script: options.script,
    user: options.actor,
    selectedTargets,
    damageFormula: options.damageFormula,
    fieldEffects: options.input.map.fieldEffects,
    conditionImmunityContext: { sweetVeilProviders: options.context.tokens },
    random: options.random,
  })
  const desiredFacing = desiredFacingTowardNearestTarget(options.actorPlacement, options.actor, selectedTargets)

  return {
    actorPlacementId: options.actorPlacement.id,
    moveName: options.script.moveName,
    canonicalMoveName: options.canonicalMoveName,
    frequency: options.frequency,
    damageFormula: options.damageFormula,
    ...(options.targetBranchId ? { targetBranchId: options.targetBranchId } : {}),
    selectedTargetIds,
    script: options.script,
    transaction,
    ...(desiredFacing ? { desiredFacing } : {}),
  }
}

export const resolveAuthoritativeMove = (input: ResolveAuthoritativeMoveInput): AuthoritativeMoveResolution => {
  const context = buildSpawnedTokenContext(input)
  const { placement: actorPlacement, token: actor } = resolveActor(context, input.intent.placementId)
  const submittedTargetIds = selectedTargetIdsForSelection(input.intent.selection)
  assertNoDuplicateTargetIds(submittedTargetIds)

  const moveEntryResult = resolveCanonicalMoveEntryForPlacement({
    placement: actorPlacement,
    token: actor,
    sheets: context.sheets,
    moveName: input.intent.moveName,
    usageContext: {
      mapMoveUsage: input.map.moveUsage,
      sheetMoveUsage: sheetMoveUsageForPlacement(context.sheets, actorPlacement),
      activeScene: input.map.activeScene ?? null,
      currentRound: input.map.initiative?.round ?? null,
    },
  })
  if (!moveEntryResult.ok) {
    if (moveEntryResult.reason === 'condition-blocked') {
      fail('unauthorized-state', 'move-condition-blocked', moveEntryResult.message)
    }
    if (moveEntryResult.reason === 'usage-blocked') {
      fail('conflict', 'move-usage-unavailable', moveEntryResult.message)
    }
    if (moveEntryResult.reason === 'move-absent') {
      fail('not-found', 'move-absent', moveEntryResult.message)
    }
    fail('not-found', 'actor-token-unresolved', moveEntryResult.message)
  }

  const entry = moveEntryResult.ok
    ? moveEntryResult.entry
    : fail('not-found', 'move-absent', 'Move entry resolution failed.')
  const { script, targetBranchId } = resolveCanonicalScript({
    baseScript: entry.script,
    targetBranchId: input.intent.targetBranchId,
  })
  const random = input.random ?? Math.random
  const idFactory = createFeedbackIdFactory(input, random)

  if (input.intent.selection.kind === 'self') {
    return resolveSelfMove({
      input,
      actorPlacement,
      actor,
      script,
      frequency: entry.frequency,
      damageFormula: entry.damageFormula,
      canonicalMoveName: entry.canonicalMoveName,
      targetBranchId,
      random,
    })
  }

  if (input.intent.selection.kind === 'single-target') {
    return resolveSingleTargetMove({
      input,
      context,
      actorPlacement,
      actor,
      script,
      selection: input.intent.selection,
      frequency: entry.frequency,
      damageFormula: entry.damageFormula,
      canonicalMoveName: entry.canonicalMoveName,
      targetBranchId,
      random,
      idFactory,
    })
  }

  if (input.intent.selection.kind === 'target-count') {
    return resolveTargetCountMove({
      input,
      context,
      actorPlacement,
      actor,
      script,
      selection: input.intent.selection,
      frequency: entry.frequency,
      damageFormula: entry.damageFormula,
      canonicalMoveName: entry.canonicalMoveName,
      targetBranchId,
      random,
    })
  }

  return fail('unsupported', 'unsupported-move-script', 'Unsupported move selection.')
}

export const isAuthoritativeMoveResolutionError = (value: unknown): value is AuthoritativeMoveResolutionError =>
  value instanceof AuthoritativeMoveResolutionError

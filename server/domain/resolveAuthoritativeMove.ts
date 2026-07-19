import type {
  MoveAutomationRollLedgerEntry,
  MoveAutomationRollModifier,
} from '#shared/moveAutomation/random'
import type { EncounterConditionEffect } from '#shared/moveAutomation/encounterEffects'
import type { MoveSpecCostDeclaration } from '#shared/moveAutomation/spec'
import type {
  MoveResolutionAuditTrace,
  MoveResolutionTraceAncestryEntry,
} from '#shared/moveAutomation/trace'
import { MOVE_AUTOMATION_AREA_DIRECTIONS } from '~/types/moveAutomation'
import type { ResolveMoveIntent, ResolveMoveSelection } from '#shared/livePlayMoveResolution'
import { LIVE_PLAY_MOVE_RESOLUTION_MAX_TARGET_IDS } from '#shared/livePlayMoveResolution'
import { moveUsageKey } from '~/utils/moveUsage'
import type { ResolvedCanonicalMoveEntry } from '~/utils/authoritativeMoveEntries'
import {
  isSeamlessAreaConfirmationScript,
  isSeamlessFieldMoveScript,
  isSeamlessSelfMoveScript,
  isSeamlessSingleTargetMoveScript,
  isSeamlessTargetCountMoveScript,
  moveAutomationHasMultipleTargetBranches,
  moveAutomationScriptForTargetBranch,
  moveAutomationTargetBranches,
} from '~/utils/moveAutomation'
import { moveAutomationCanResolveDamageAtRuntime } from '~/utils/moveAutomationDynamicDamage'
import { moveDashConditionUseBlock } from '~/utils/moveConditionRestrictions'
import { moveAutomationTargetDamageMultiplier } from '~/utils/moveAutomationTargetResolution'
import { moveAutomationDamageAppliesOnAccuracyOutcome } from '~/utils/moveAutomationSmite'
import { moveAutomationStatusDetailsText } from '~/utils/moveAutomationSemanticStatus'
import { moveAutomationScriptForConfirmedAreaTemplate } from '~/utils/moveAutomationConfirmedAreaTemplate'
import {
  buildMoveAutomationAreaTemplateCells,
  buildMoveAutomationAreaTemplatePlacementAtCenter,
  buildMoveAutomationCloseBlastPlacementAtAimCell,
  moveAutomationAreaTemplateId,
  tokensInMoveAutomationArea,
} from '~/utils/moveAutomationAreaTemplates'
import {
  resolveInstantAreaMoveAutomation,
  resolveInstantMoveAutomation,
  resolveInstantMultiTargetMoveAutomation,
  resolveInstantNoRollTargetMoveAutomation,
  resolveInstantSelfMoveAutomation,
} from '~/utils/moveAutomationInstant'
import {
  moveAutomationTargetsInRange,
  parseExplicitMultiTargetMoveRangeMeters,
  parseSingleTargetMoveRangeMeters,
} from '~/utils/moveAutomationRange'
import { passDestinationLogLine } from '~/utils/moveAutomationPass'
import { ptuGridVectorDistance } from '~/utils/ptuGridDistance'
import { tokenFacingForPlacement, tokenFacingFromAreaDirection, tokenFacingTowardPoint } from '~/utils/tokenFacing'
import { buildAllVoxelOccupancy } from '~/utils/voxelOccupancy'
import type { CharacterSheet } from '~/types/characterSheet'
import type { GridAnchor, SheetPlacement, TabletopMap } from '~/types/map'
import type {
  MoveAutomationAreaDirection,
  MoveAutomationAreaTemplate,
  MoveAutomationFeedbackState,
  MoveAutomationScript,
  MoveAutomationTargetConditionOutcome,
  MoveAutomationTransaction,
} from '~/types/moveAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { TokenFacingDirection } from '~/types/tokenFacing'
import type { TrainerSheet } from '~/types/trainerSheet'
import {
  isStatusAfflictionCondition,
  normalizeConditionName,
  normalizeConditionNames,
} from '~/utils/statusConditions'
import type { MoveAutomationConditionImmunityContext } from '~/utils/moveAutomationConditionImmunity'
import {
  AuthoritativeMoveRulesContextError,
  buildAuthoritativeMoveRulesContext,
  deduplicateAuthoritativeMoveSheetReads as deduplicateContextSheetReads,
  type AuthoritativeMoveRulesContext,
  type AuthoritativeMoveSheetRead,
} from './moveAutomation/context'
import type { MoveAutomationRuntimeRegistry, MoveSpecV2Runtime } from './moveAutomation/registry'
import { resolveMoveSpecTargetingRule } from './moveAutomation/targetingBranches'
import type { AuthoritativeMoveItemResources } from './moveAutomation/itemResources'
import {
  resolveMoveSpecOutcome,
  type NativeMoveSpecResolutionProjection,
  type PendingMoveSpecResolution,
} from './moveAutomation/resolveImmediateSpec'
import { hashLegacyMoveAutomationDefinition } from './moveAutomation/legacyV1Definition'
import { buildLegacyV1MoveResolutionTrace } from './moveAutomation/legacyV1Trace'
import {
  DEFAULT_MOVE_AUTOMATION_AREA_TARGET_PREDICATE,
  MoveAutomationAreaTargetError,
  resolveMoveAutomationAreaTargets,
  type MoveAutomationAreaTargetEvaluation,
  type MoveAutomationAreaTargetResult,
  type ResolveMoveAutomationAreaTargetsInput,
} from './moveAutomation/areaTargets'
import type { AuthoritativeMoveRandomSource } from './moveAutomation/random'
import {
  resolveAuthoritativeMovement,
  type AuthoritativeMovementSheets,
} from './movement/resolveMovement'
import {
  createMistyTerrainConditionProtectionEffects,
} from './moveAutomation/terrainConditionProtection'
import {
  resolveAuthoritativeMoveActionTiming,
} from './moveAutomation/actionTiming'
import {
  resolveAuthoritativeMoveSightAccuracy,
} from './moveAutomation/accuracy'
import {
  attachHelpingHandBonusResolution,
  type HelpingHandBonusResolution,
} from './moveAutomation/helpingHand'
import {
  attachSideDamageResistanceResolution,
  type SideDamageResistanceResolution,
} from './moveAutomation/sideDamageResistance'

export type { AuthoritativeMoveSheetRead } from './moveAutomation/context'

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
  | 'move-automation-blocked'
  | 'move-condition-blocked'
  | 'move-semi-invulnerable'
  | 'move-terrain-blocked'
  | 'move-usage-unavailable'
  | 'move-list-overlay-blocked'
  | 'move-list-overlay-stale'
  | 'move-creature-rule-blocked'
  | 'move-usage-key-invalid'
  | 'target-branch-required'
  | 'target-branch-invalid'
  | 'target-branch-unexpected'
  | 'selection-kind-mismatch'
  | 'target-placement-missing'
  | 'target-sheet-missing'
  | 'target-token-unresolved'
  | 'target-out-of-range'
  | 'target-semi-invulnerable'
  | 'target-line-of-sight-blocked'
  | 'duplicate-target-id'
  | 'empty-target-selection'
  | 'too-many-targets'
  | 'area-template-invalid'
  | 'area-placement-missing'
  | 'area-placement-unexpected'
  | 'area-direction-illegal'
  | 'area-aim-cell-illegal'
  | 'area-geometry-empty'
  | 'area-friendly-exclusion-invalid'
  | 'pass-direction-required'
  | 'pass-aim-cell-unexpected'
  | 'pass-destination-unavailable'
  | 'pass-geometry-empty'
  | 'unsupported-range'
  | 'unsupported-damage-resolution'
  | 'unsupported-move-script'
  | 'move-response-required'
  | 'sheet-read-revision-conflict'

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
  readonly random?: AuthoritativeMoveRandomSource
  readonly now?: () => number
  /** Stable server-owned identity used by nested child ancestry and durable replay. */
  readonly resolutionId?: string
  readonly ancestry?: readonly MoveResolutionTraceAncestryEntry[]
  readonly tokenPositionOverrides?: ReadonlyMap<string, GridAnchor>
  readonly idFactory?: () => string
  /** Test/migration seam; production uses the manifest-selected global registry. */
  readonly runtimeRegistry?: MoveAutomationRuntimeRegistry
  /** Test/migration seam for retained v1 definitions. */
  readonly legacyScripts?: ReadonlyMap<string, MoveAutomationScript>
  /** Server-reviewed child/reaction cost policy; never supplied by move intent. */
  readonly resourceCostDeclarations?: readonly MoveSpecCostDeclaration[]
  /** Private item resources loaded from exact authoritative repository scopes. */
  readonly itemResources?: AuthoritativeMoveItemResources
}

export interface AuthoritativeMoveArea {
  readonly areaTemplateId: string
  readonly template: MoveAutomationAreaTemplate
  readonly cells: readonly GridAnchor[]
  readonly candidateTargetIds: readonly string[]
  /** Client-requested Friendly exclusions retained for intent/result validation. */
  readonly excludedTargetIds: readonly string[]
  /** Complete server-only predicate evidence; accepted projections redact exclusions. */
  readonly targetEvaluations: readonly MoveAutomationAreaTargetEvaluation[]
  readonly direction?: MoveAutomationAreaDirection
  readonly aimCell?: GridAnchor
}

export interface AuthoritativeMovePassMovement {
  readonly kind: 'pass'
  readonly from: GridAnchor
  readonly destination: GridAnchor
  readonly direction: MoveAutomationAreaDirection
  readonly pathCells: readonly GridAnchor[]
}

export interface AuthoritativeMoveShiftMovement {
  readonly kind: 'shift'
  readonly from: GridAnchor
  readonly destination: GridAnchor
  readonly pathCells: readonly GridAnchor[]
  /** Present when the durable choice selected a reviewed direction. */
  readonly direction?: MoveAutomationAreaDirection
}

export type AuthoritativeMoveMovement =
  | AuthoritativeMovePassMovement
  | AuthoritativeMoveShiftMovement

export interface AuthoritativeMoveResourceMovement {
  /** Exact cost and capability ceiling emitted by the authoritative oracle. */
  readonly distance: number
  readonly budget: number
}

interface AuthoritativeMoveSwitchTransitionBase {
  readonly operationId: string
  readonly recalledPlacementId: string
}

/** Server-only, roster-validated recall/send-out transition selected durably. */
export interface AuthoritativeMoveRecallAndSendOutTransition
  extends AuthoritativeMoveSwitchTransitionBase {
  readonly kind: 'recall-and-send-out'
  readonly sentOutPlacement: SheetPlacement
  readonly trainerPlacementId: string
  readonly trainerSheetSlug: string
  readonly positionPolicy: 'recalled-position'
  readonly initiativePolicy: 'inherit-slot'
  readonly stateTransferPolicy: 'none' | 'baton-pass'
}

/** Server-only mandatory recall when the authorized replacement choice passes. */
export interface AuthoritativeMoveRecallOnlyTransition
  extends AuthoritativeMoveSwitchTransitionBase {
  readonly kind: 'recall-only'
  readonly stateTransferPolicy: 'none'
}

export type AuthoritativeMoveSwitchTransition =
  | AuthoritativeMoveRecallAndSendOutTransition
  | AuthoritativeMoveRecallOnlyTransition

export interface AuthoritativeMoveResolution {
  readonly actorPlacementId: string
  readonly moveName: string
  readonly canonicalMoveName: string
  readonly moveKey: string
  readonly frequency: string | null
  readonly damageFormula: string | null
  readonly targetBranchId?: string
  readonly selectedTargetIds: readonly string[]
  readonly sheetReads: readonly AuthoritativeMoveSheetRead[]
  readonly rollLedger: readonly MoveAutomationRollLedgerEntry[]
  /** Complete server-only trace; accepted results receive its bounded sanitized projection. */
  readonly auditTrace: MoveResolutionAuditTrace
  readonly script: MoveAutomationScript
  readonly transaction: MoveAutomationTransaction
  readonly feedback?: MoveAutomationFeedbackState
  readonly desiredFacing?: TokenFacingDirection
  readonly area?: AuthoritativeMoveArea
  readonly movement?: AuthoritativeMoveMovement
  /** Server-only MA-120 facts; omitted from accepted wire results. */
  readonly resourceMovement?: AuthoritativeMoveResourceMovement
  /** Server-only roster/send-out transition; the map patch carries its durable result. */
  readonly switchTransition?: AuthoritativeMoveSwitchTransition
  /** Server-only Misty suppression effects planned with legacy sheet conditions. */
  readonly terrainConditionProtectionEffects?: readonly EncounterConditionEffect[]
  /** Server-only source effect and roll evidence for atomic Helping Hand consumption. */
  readonly helpingHandBonus?: HelpingHandBonusResolution
  /** Server-only side resistance decisions and exact effect charges reserved for commit. */
  readonly sideDamageResistance?: SideDamageResistanceResolution
  /** Server-only native planning projection; omitted from accepted wire results. */
  readonly nativeV2?: NativeMoveSpecResolutionProjection
}

/** Pure native-v2 execution suspended before any state planner mutation. */
export interface AuthoritativePendingMoveResolution {
  readonly kind: 'pending'
  readonly actorPlacementId: string
  readonly moveName: string
  readonly canonicalMoveName: string
  readonly moveKey: string
  readonly frequency: string | null
  readonly damageFormula: string | null
  /** Retained server-only v1 compatibility range for phased cost planning. */
  readonly resourceRange: string
  readonly resourceMovement?: AuthoritativeMoveResourceMovement
  readonly selectedTargetIds: readonly string[]
  readonly sheetReads: readonly AuthoritativeMoveSheetRead[]
  readonly runtime: MoveSpecV2Runtime
  readonly execution: PendingMoveSpecResolution['execution']
  readonly preWindowPlan: PendingMoveSpecResolution['preWindowPlan']
}

export type AuthoritativeMoveExecution =
  | AuthoritativeMoveResolution
  | AuthoritativePendingMoveResolution

export const isAuthoritativePendingMoveResolution = (
  value: AuthoritativeMoveExecution,
): value is AuthoritativePendingMoveResolution => (
  'kind' in value && value.kind === 'pending'
)

type UnfinalizedAuthoritativeMoveResolution = Omit<
  AuthoritativeMoveResolution,
  'sheetReads' | 'rollLedger' | 'auditTrace'
> & {
  /** Private structured evidence consumed while building the legacy audit trace. */
  readonly conditionOutcomes?: readonly MoveAutomationTargetConditionOutcome[]
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
  if (selection.kind === 'self' || selection.kind === 'area') return []
  if (selection.kind === 'single-target') return [selection.targetPlacementId]
  return selection.targetPlacementIds
}

export const deduplicateAuthoritativeMoveSheetReads = (
  reads: readonly AuthoritativeMoveSheetRead[],
): AuthoritativeMoveSheetRead[] => {
  try {
    return deduplicateContextSheetReads(reads)
  }
  catch (error) {
    return fail(
      'conflict',
      'sheet-read-revision-conflict',
      error instanceof Error ? error.message : 'A sheet was observed at conflicting revisions.',
    )
  }
}

const recordSheetReadForPlacement = (
  context: AuthoritativeMoveRulesContext,
  placement: Pick<SheetPlacement, 'sheetKind' | 'sheetSlug'>,
): void => context.reads.recordPlacement(placement)

const recordSheetReadsForTokens = (
  context: AuthoritativeMoveRulesContext,
  tokens: readonly SpawnedPokemon[],
): void => {
  for (const token of tokens) context.reads.recordToken(token)
}

const scriptConsultsSweetVeilProviders = (script: MoveAutomationScript): boolean =>
  script.conditionSuggestions.some((suggestion) => (
    suggestion.recipient === 'target'
    && (suggestion.action ?? 'add') === 'add'
    && normalizeConditionName(suggestion.condition) === 'Sleep'
  ))

const authoritativeConditionImmunityContext = (
  context: AuthoritativeMoveRulesContext,
  script: MoveAutomationScript,
): MoveAutomationConditionImmunityContext => {
  const additionalImmunitySource = (condition: string, target: SpawnedPokemon): string | null => (
    context.queries.terrain.condition({
      placementId: target.id,
      conditionId: condition,
    }).blockedBy
  )
  if (!scriptConsultsSweetVeilProviders(script)) return { additionalImmunitySource }

  return {
    additionalImmunitySource,
    sweetVeilProviderCandidates: context.queries.tokens.all(),
    isAlly: (provider, target) => {
      const providerPlacement = context.queries.placements.get(provider.id)
      const targetPlacement = context.queries.placements.get(target.id)
      if (!providerPlacement || !targetPlacement) return false
      const relationship = context.queries.relationships.match(
        providerPlacement.id,
        targetPlacement.id,
        'ally',
      )
      if (!relationship.matches) return false
      recordSheetReadForPlacement(context, providerPlacement)
      return true
    },
  }
}

const authoritativeFieldEffectsForActor = (
  context: AuthoritativeMoveRulesContext,
  targetPlacementId?: string,
) => context.queries.rooms.projectFieldEffects(
  context.queries.terrain.projectFieldEffects(
    context.actor.placement.id,
    context.queries.weather.projectFieldEffects(),
    targetPlacementId,
  ),
)

const addedConditions = (
  previousValue: readonly string[],
  currentValue: readonly string[],
): readonly string[] => {
  const remaining = [...normalizeConditionNames(previousValue)]
  return normalizeConditionNames(currentValue).filter((condition) => {
    const previousIndex = remaining.indexOf(condition)
    if (previousIndex < 0) return true
    remaining.splice(previousIndex, 1)
    return false
  })
}

const legacyTerrainConditionProtectionEffects = (
  context: AuthoritativeMoveRulesContext,
  resolution: UnfinalizedAuthoritativeMoveResolution,
): readonly EncounterConditionEffect[] => {
  const effects = new Map<string, EncounterConditionEffect>()
  for (const [updateIndex, update] of resolution.transaction.conditionUpdates.entries()) {
    const token = context.queries.tokens.get(update.id)
    if (!token) continue
    for (const condition of addedConditions(token.sheetConditions ?? [], update.conditions)) {
      if (!isStatusAfflictionCondition(condition)) continue
      const terrain = context.queries.terrain.condition({
        placementId: update.id,
        conditionId: condition,
      })
      if (!terrain.firstTurnProtection || terrain.blockedBy) continue
      for (const effect of createMistyTerrainConditionProtectionEffects({
        protection: terrain.firstTurnProtection,
        conditionId: condition,
        operationId: `legacy-v1.condition.${updateIndex + 1}`,
        moveId: `move.${resolution.moveKey}`,
        sourcePlacementId: resolution.actorPlacementId,
        recipientPlacementId: update.id,
        createdRound: Math.max(1, context.map.initiative?.round ?? 1),
        createdTurn: Math.max(0, context.map.encounterState?.history.currentTurn?.turn ?? 0),
      })) {
        effects.set(effect.id, effect)
      }
    }
  }
  return Object.freeze([...effects.values()])
}

const attachResolutionDamageEffects = <Resolution extends AuthoritativeMoveResolution>(
  context: AuthoritativeMoveRulesContext,
  resolution: Resolution,
): Resolution => attachSideDamageResistanceResolution(
  context.queries.sideDamageResistance,
  attachHelpingHandBonusResolution(context.map, resolution),
) as Resolution

const finalizeResolution = (
  context: AuthoritativeMoveRulesContext,
  resolution: UnfinalizedAuthoritativeMoveResolution,
): AuthoritativeMoveResolution => {
  const terrainConditionProtectionEffects = legacyTerrainConditionProtectionEffects(
    context,
    resolution,
  )
  const rollLedger = context.random.complete()
  const registeredRuntime = context.queries.rules.runtimeFor(resolution.canonicalMoveName)
  const program = registeredRuntime
    ? {
        canonicalId: registeredRuntime.canonicalId,
        runtimeKind: registeredRuntime.kind,
        runtimeVersion: registeredRuntime.version,
        definitionHash: registeredRuntime.definitionHash,
      }
    : {
        canonicalId: resolution.canonicalMoveName,
        runtimeKind: 'legacy-v1' as const,
        runtimeVersion: resolution.script.version,
        definitionHash: hashLegacyMoveAutomationDefinition(resolution.script),
      }
  const auditTrace = buildLegacyV1MoveResolutionTrace({
    program,
    ruleset: {
      rulesetId: context.ruleset.rulesetId,
      sourceDataSha256: context.ruleset.sourceData.sha256,
    },
    ancestry: context.ancestry,
    actorPlacementId: resolution.actorPlacementId,
    selectionKind: context.intent.selection.kind,
    selectedTargetIds: resolution.selectedTargetIds,
    script: resolution.script,
    transaction: resolution.transaction,
    rollLedger,
    terrainConditionProtectionEffects,
    feedback: resolution.feedback,
    conditionOutcomes: resolution.conditionOutcomes,
    area: resolution.area,
    movement: resolution.movement?.kind === 'pass' ? resolution.movement : undefined,
  })
  const { conditionOutcomes: privateConditionOutcomes, ...durableResolution } = resolution
  void privateConditionOutcomes
  return attachResolutionDamageEffects(context, {
    ...durableResolution,
    sheetReads: context.reads.snapshot(),
    rollLedger,
    auditTrace,
    ...(terrainConditionProtectionEffects.length > 0
      ? { terrainConditionProtectionEffects }
      : {}),
  })
}

const authoritativeLegacyDamageInputsForTarget = (
  context: AuthoritativeMoveRulesContext,
) => ({
  script,
  target,
  resolution,
}: {
  readonly script: MoveAutomationScript
  readonly target: SpawnedPokemon
  readonly resolution: import('~/utils/moveAutomationTargetResolution').MoveAutomationTargetResolutionState | undefined
}) => {
  if (
    !script.damaging
    || script.directHpLoss !== undefined
    || !moveAutomationDamageAppliesOnAccuracyOutcome(script, resolution?.hit)
    || !resolution?.applyDamage
    || (script.damageClass !== 'Physical' && script.damageClass !== 'Special')
  ) return {}
  const previousMultiplier = moveAutomationTargetDamageMultiplier(script, target)
  const resistance = context.queries.sideDamageResistance.resolve({
    damageOperationId: 'legacy-v1.damage',
    targetPlacementId: target.id,
    damageClass: script.damageClass.toLowerCase() as 'physical' | 'special',
    effectivenessMultiplier: previousMultiplier,
  })
  return {
    typeEffectiveness: {
      moveType: script.type ?? 'Normal',
      multiplier: resistance.adjustedMultiplier,
    },
  }
}

const resolveSelectedTarget = (
  context: AuthoritativeMoveRulesContext,
  targetId: string,
): { placement: SheetPlacement; token: SpawnedPokemon } => {
  const placement = context.queries.placements.get(targetId)
    ?? fail('not-found', 'target-placement-missing', `Target placement ${targetId} was not found.`)

  const token = context.queries.tokens.get(targetId)
  if (token) return { placement, token }

  if (!context.queries.sheets.forPlacement(placement)) {
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

const AREA_DIRECTION_SET = new Set<string>(MOVE_AUTOMATION_AREA_DIRECTIONS)

const isMoveAutomationAreaDirection = (value: unknown): value is MoveAutomationAreaDirection =>
  typeof value === 'string' && AREA_DIRECTION_SET.has(value)

const cloneGridAnchor = (anchor: GridAnchor): GridAnchor => ({ x: anchor.x, y: anchor.y, z: anchor.z })

const cloneGridAnchors = (anchors: readonly GridAnchor[]): GridAnchor[] => anchors.map(cloneGridAnchor)

const cloneAreaTemplate = (template: MoveAutomationAreaTemplate): MoveAutomationAreaTemplate => ({ ...template })

const moveAutomationTransactionWithAppendedLogLines = (
  transaction: MoveAutomationTransaction,
  lines: readonly string[],
): MoveAutomationTransaction => ({
  ...transaction,
  attackedTargetIds: [...transaction.attackedTargetIds],
  hitTargetIds: [...transaction.hitTargetIds],
  logLines: [...transaction.logLines, ...lines],
})

const areaTargetPolicyLogLines = (
  script: MoveAutomationScript,
): string[] => script.areaTargetRelationship === 'ally'
  ? [
      `${script.moveName}: ally-only area recipients are derived from explicit encounter sides; enemy and unaffiliated placements are ineligible.`,
    ]
  : []

const isSafeGridAnchor = (value: unknown): value is GridAnchor => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const candidate = value as Partial<Record<keyof GridAnchor, unknown>>
  return Number.isSafeInteger(candidate.x)
    && Number.isSafeInteger(candidate.y)
    && Number.isSafeInteger(candidate.z)
}

const areaCellConstraints = (map: TabletopMap) => ({
  bounds: map.dimensions,
  blockedCells: buildAllVoxelOccupancy(map.voxels),
})

const moveAutomationScriptHasFriendlyKeyword = (script: MoveAutomationScript): boolean =>
  script.keywords.some((keyword) => /^Friendly$/i.test(keyword.trim()))

const selectedAreaTemplate = (
  script: MoveAutomationScript,
  areaTemplateId: string,
): MoveAutomationAreaTemplate => {
  const moveName = script.moveName
  if (!isSeamlessAreaConfirmationScript(script as MoveAutomationScript | null)) {
    fail('invalid', 'selection-kind-mismatch', `${moveName} is not a seamless area-confirmation move.`)
  }

  return script.areaTemplates?.find((item) => moveAutomationAreaTemplateId(item) === areaTemplateId)
    ?? fail('invalid', 'area-template-invalid', `Unknown area template ${areaTemplateId} for ${moveName}.`)
}

const assertNoAreaDirection = (
  selection: Extract<ResolveMoveSelection, { kind: 'area' }>,
  template: MoveAutomationAreaTemplate,
): void => {
  if (selection.direction !== undefined) {
    fail('invalid', 'area-placement-unexpected', `${template.label} does not accept a direction.`)
  }
}

const assertNoAreaAimCell = (
  selection: Extract<ResolveMoveSelection, { kind: 'area' }>,
  template: MoveAutomationAreaTemplate,
): void => {
  if (selection.aimCell !== undefined) {
    fail('invalid', 'area-placement-unexpected', `${template.label} does not accept an aim cell.`)
  }
}

const requireAreaDirection = (
  selection: Extract<ResolveMoveSelection, { kind: 'area' }>,
  template: MoveAutomationAreaTemplate,
): MoveAutomationAreaDirection => {
  const direction = selection.direction
  if (direction === undefined) {
    return fail('invalid', 'area-placement-missing', `${template.label} requires an area direction.`)
  }
  if (!isMoveAutomationAreaDirection(direction)) {
    return fail('invalid', 'area-direction-illegal', `${String(direction)} is not a legal area direction.`)
  }
  return direction
}

const requireAreaAimCell = (
  selection: Extract<ResolveMoveSelection, { kind: 'area' }>,
  template: MoveAutomationAreaTemplate,
): GridAnchor => {
  const aimCell = selection.aimCell
  if (aimCell === undefined) {
    return fail('invalid', 'area-placement-missing', `${template.label} requires an aim cell.`)
  }
  if (!isSafeGridAnchor(aimCell)) {
    return fail('invalid', 'area-aim-cell-illegal', `${template.label} aim cell must contain safe integer x, y, and z.`)
  }
  return cloneGridAnchor(aimCell)
}

const assertNoPassAimCell = (
  selection: Extract<ResolveMoveSelection, { kind: 'area' }>,
  template: MoveAutomationAreaTemplate,
): void => {
  if (selection.aimCell !== undefined) {
    fail('invalid', 'pass-aim-cell-unexpected', `${template.label} does not accept an aim cell.`)
  }
}

const requirePassDirection = (
  selection: Extract<ResolveMoveSelection, { kind: 'area' }>,
  template: MoveAutomationAreaTemplate,
): MoveAutomationAreaDirection => {
  const direction = selection.direction
  if (direction === undefined) {
    return fail('invalid', 'pass-direction-required', `${template.label} requires a Pass direction.`)
  }
  if (!isMoveAutomationAreaDirection(direction)) {
    return fail('invalid', 'area-direction-illegal', `${String(direction)} is not a legal area direction.`)
  }
  return direction
}

const assertSupportedPassTemplate = (template: MoveAutomationAreaTemplate): void => {
  if (template.kind !== 'pass' || !Number.isSafeInteger(template.size) || template.size <= 0) {
    fail('unsupported', 'pass-geometry-empty', `${template.label} is not a supported Pass template.`)
  }
}

const assertAreaCellsPresent = (template: MoveAutomationAreaTemplate, cells: readonly GridAnchor[]): void => {
  if (!cells.length) {
    fail('invalid', 'area-geometry-empty', `${template.label} does not produce any legal authoritative area cells.`)
  }
}

const authoritativeAreaCandidates = (options: {
  readonly actor: SpawnedPokemon
  readonly tokens: readonly SpawnedPokemon[]
  readonly cells: readonly GridAnchor[]
}): SpawnedPokemon[] => tokensInMoveAutomationArea({
  cells: options.cells,
  tokens: options.tokens,
  excludeIds: [options.actor.id],
})

const authoritativeMovementSheets = (
  context: AuthoritativeMoveRulesContext,
): AuthoritativeMovementSheets => {
  const pokemon = new Map<string, CharacterSheet>()
  const trainer = new Map<string, TrainerSheet>()
  for (const resolved of context.resolvedSheets) {
    if (resolved.kind === 'pokemon') pokemon.set(resolved.slug, resolved.sheet as CharacterSheet)
    else trainer.set(resolved.slug, resolved.sheet as TrainerSheet)
  }
  return { pokemon, trainer }
}

const uniqueGridAnchors = (anchors: readonly GridAnchor[]): GridAnchor[] => {
  const byCell = new Map<string, GridAnchor>()
  for (const anchor of anchors) {
    const key = `${anchor.x},${anchor.y},${anchor.z}`
    if (!byCell.has(key)) byCell.set(key, cloneGridAnchor(anchor))
  }
  return [...byCell.values()]
}

interface ResolvedAuthoritativeAreaPlacement {
  readonly cells: readonly GridAnchor[]
  readonly candidateTargets: readonly SpawnedPokemon[]
  readonly direction?: MoveAutomationAreaDirection
  readonly aimCell?: GridAnchor
  readonly movement?: AuthoritativeMovePassMovement
  readonly resourceMovement?: AuthoritativeMoveResourceMovement
}

const resolvedAreaPlacement = (options: {
  readonly context: AuthoritativeMoveRulesContext
  readonly actor: SpawnedPokemon
  readonly template: MoveAutomationAreaTemplate
  readonly selection: Extract<ResolveMoveSelection, { kind: 'area' }>
}): ResolvedAuthoritativeAreaPlacement => {
  const tokens = options.context.queries.tokens.all()
  const constraints = areaCellConstraints(options.context.map)
  const common = {
    user: options.actor,
    tokens,
    includeEmpty: true,
    ...constraints,
  }

  if (options.template.kind === 'burst' || options.template.kind === 'cardinally-adjacent') {
    assertNoAreaDirection(options.selection, options.template)
    assertNoAreaAimCell(options.selection, options.template)
    const cells = buildMoveAutomationAreaTemplateCells({
      template: options.template,
      user: options.actor,
      ...constraints,
    })
    assertAreaCellsPresent(options.template, cells)
    return {
      cells,
      candidateTargets: authoritativeAreaCandidates({ actor: options.actor, tokens, cells }),
    }
  }

  if (options.template.kind === 'cone' || options.template.kind === 'line') {
    assertNoAreaAimCell(options.selection, options.template)
    const direction = requireAreaDirection(options.selection, options.template)
    const cells = buildMoveAutomationAreaTemplateCells({
      template: options.template,
      user: options.actor,
      direction,
      ...constraints,
    })
    assertAreaCellsPresent(options.template, cells)
    return {
      cells,
      candidateTargets: authoritativeAreaCandidates({ actor: options.actor, tokens, cells }),
      direction,
    }
  }

  if (options.template.kind === 'close-blast') {
    assertNoAreaDirection(options.selection, options.template)
    const aimCell = requireAreaAimCell(options.selection, options.template)
    const placement = buildMoveAutomationCloseBlastPlacementAtAimCell({
      template: options.template,
      aimCell,
      ...common,
    }) ?? fail(
      'invalid',
      'area-aim-cell-illegal',
      `${options.template.label} cannot be placed at (${aimCell.x}, ${aimCell.y}, ${aimCell.z}).`,
    )
    assertAreaCellsPresent(options.template, placement.cells)
    return {
      cells: placement.cells,
      candidateTargets: authoritativeAreaCandidates({ actor: options.actor, tokens, cells: placement.cells }),
      aimCell,
    }
  }

  if (options.template.kind === 'ranged-blast') {
    assertNoAreaDirection(options.selection, options.template)
    const aimCell = requireAreaAimCell(options.selection, options.template)
    const placement = buildMoveAutomationAreaTemplatePlacementAtCenter({
      template: options.template,
      center: aimCell,
      ...common,
    }) ?? fail(
      'invalid',
      'area-aim-cell-illegal',
      `${options.template.label} cannot be centered at (${aimCell.x}, ${aimCell.y}, ${aimCell.z}).`,
    )
    assertAreaCellsPresent(options.template, placement.cells)
    return {
      cells: placement.cells,
      candidateTargets: authoritativeAreaCandidates({ actor: options.actor, tokens, cells: placement.cells }),
      aimCell,
    }
  }

  if (options.template.kind === 'pass') {
    assertSupportedPassTemplate(options.template)
    assertNoPassAimCell(options.selection, options.template)
    const direction = requirePassDirection(options.selection, options.template)
    const movement = resolveAuthoritativeMovement({
      map: options.context.map,
      sheets: authoritativeMovementSheets(options.context),
      placementId: options.actor.id,
      mode: 'pass',
      direction,
      maximumDistance: options.template.size,
    })
    for (const read of movement.sheetReads) options.context.reads.recordSheet(read)
    if (!movement.ok) {
      return fail(
        'conflict',
        'pass-destination-unavailable',
        `${options.template.label} cannot reach a legal empty Pass destination in the current map state (${movement.reasonCode}).`,
      )
    }

    const passDistance = ptuGridVectorDistance({
      x: movement.destination.x - movement.origin.x,
      y: movement.destination.y - movement.origin.y,
      z: movement.destination.z - movement.origin.z,
    })
    const cells = uniqueGridAnchors(buildMoveAutomationAreaTemplateCells({
      template: { ...options.template, size: passDistance },
      user: options.actor,
      direction,
      bounds: constraints.bounds,
    }))
    if (!cells.length || movement.triggeringSteps.length === 0) {
      fail('unsupported', 'pass-geometry-empty', `${options.template.label} did not produce authoritative Pass path cells.`)
    }
    return {
      cells,
      candidateTargets: authoritativeAreaCandidates({ actor: options.actor, tokens, cells }),
      direction,
      movement: {
        kind: 'pass',
        from: cloneGridAnchor(movement.origin),
        destination: cloneGridAnchor(movement.destination),
        direction,
        pathCells: cloneGridAnchors(cells),
      },
      resourceMovement: {
        distance: movement.cost,
        budget: movement.capabilityLimit,
      },
    }
  }

  return fail('unsupported', 'unsupported-move-script', `${options.template.label} resolution is not implemented.`)
}

const requestedAreaTargetExclusionIds = (
  script: MoveAutomationScript,
  selection: Extract<ResolveMoveSelection, { kind: 'area' }>,
): string[] => {
  const excludedIds = [...(selection.excludedTargetPlacementIds ?? [])]
  if (excludedIds.length > 0 && !moveAutomationScriptHasFriendlyKeyword(script)) {
    fail('invalid', 'area-friendly-exclusion-invalid', `${script.moveName} does not allow Friendly target exclusions.`)
  }
  return excludedIds
}

const resolveAuthoritativeAreaTargets = (
  input: ResolveMoveAutomationAreaTargetsInput,
): MoveAutomationAreaTargetResult => {
  try {
    return resolveMoveAutomationAreaTargets(input)
  }
  catch (error) {
    if (!(error instanceof MoveAutomationAreaTargetError)) throw error
    if (
      error.code === 'invalid-requested-exclusions'
      || error.code === 'duplicate-requested-exclusion'
      || error.code === 'requested-exclusion-outside-geometry'
      || error.code === 'too-many-requested-exclusions'
    ) {
      return fail('invalid', 'area-friendly-exclusion-invalid', error.message)
    }
    return fail('unsupported', 'too-many-targets', error.message)
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
  readonly context: AuthoritativeMoveRulesContext
  readonly script: MoveAutomationScript
  readonly frequency: string | null
  readonly damageFormula: string | null
  readonly canonicalMoveName: string
  readonly moveKey: string
  readonly targetBranchId?: string
}): UnfinalizedAuthoritativeMoveResolution => {
  const { placement: actorPlacement, token: actor } = options.context.actor
  if (!isSeamlessSelfMoveScript(options.script)) {
    fail('invalid', 'selection-kind-mismatch', `${options.script.moveName} is not a seamless self move.`)
  }
  const transaction = resolveInstantSelfMoveAutomation({
    script: options.script,
    user: actor,
    fieldEffects: authoritativeFieldEffectsForActor(options.context),
    conditionImmunityContext: authoritativeConditionImmunityContext(options.context, options.script),
    randomRoller: options.context.random,
  })
  return {
    actorPlacementId: actorPlacement.id,
    moveName: options.script.moveName,
    canonicalMoveName: options.canonicalMoveName,
    moveKey: options.moveKey,
    frequency: options.frequency,
    damageFormula: options.damageFormula,
    ...(options.targetBranchId ? { targetBranchId: options.targetBranchId } : {}),
    selectedTargetIds: [],
    script: options.script,
    transaction,
  }
}

const resolveNativeSelfMove = (options: {
  readonly context: AuthoritativeMoveRulesContext
  readonly runtime: MoveSpecV2Runtime
  readonly entry: ResolvedCanonicalMoveEntry
  readonly moveKey: string
}): AuthoritativeMoveExecution => {
  const targeting = resolveMoveSpecTargetingRule(
    options.runtime.definition.spec,
    options.context.intent.targetBranchId,
  )
  if (targeting?.kind !== 'self') {
    return fail(
      'invalid',
      'selection-kind-mismatch',
      `${options.runtime.canonicalId} does not accept a self selection.`,
    )
  }
  const hazardPlacementMove = options.entry.script.targetMode === 'hazard'
    && options.entry.script.hazardSuggestions.length > 0
  if (
    !isSeamlessSelfMoveScript(options.entry.script)
    && !isSeamlessFieldMoveScript(options.entry.script)
    && !hazardPlacementMove
  ) {
    fail(
      'invalid',
      'selection-kind-mismatch',
      `${options.runtime.canonicalId} is not a seamless self, field, or hazard-placement move.`,
    )
  }

  const outcome = resolveMoveSpecOutcome({
    context: options.context,
    runtime: options.runtime,
    entry: options.entry,
    targetBranchId: options.context.intent.targetBranchId,
    authoritativeTargetIds: [],
    ancestry: options.context.ancestry,
  })
  if (outcome.kind === 'pending') {
    return {
      kind: 'pending',
      actorPlacementId: options.context.actor.placement.id,
      moveName: options.runtime.definition.spec.presentation.displayName,
      canonicalMoveName: options.entry.canonicalMoveName,
      moveKey: options.moveKey,
      frequency: options.entry.frequency,
      damageFormula: options.entry.damageFormula,
      resourceRange: options.entry.script.range,
      selectedTargetIds: [],
      sheetReads: outcome.sheetReads,
      runtime: options.runtime,
      execution: outcome.execution,
      preWindowPlan: outcome.preWindowPlan,
    }
  }
  const immediate = outcome.resolution

  return {
    actorPlacementId: options.context.actor.placement.id,
    moveName: options.runtime.definition.spec.presentation.displayName,
    canonicalMoveName: options.entry.canonicalMoveName,
    moveKey: options.moveKey,
    frequency: options.entry.frequency,
    damageFormula: options.entry.damageFormula,
    ...(options.context.intent.targetBranchId
      ? { targetBranchId: options.context.intent.targetBranchId }
      : {}),
    selectedTargetIds: [],
    sheetReads: immediate.sheetReads,
    rollLedger: immediate.rollLedger,
    auditTrace: immediate.trace,
    script: immediate.script,
    transaction: immediate.transaction,
    nativeV2: immediate.native,
  }
}

const assertAuthoritativeTargetLineOfSight = (
  context: AuthoritativeMoveRulesContext,
  targetPlacementId: string,
  moveName: string,
): void => {
  const sight = context.queries.lineOfSight.resolve(
    context.actor.placement.id,
    targetPlacementId,
  )
  if (sight.targetable) return
  fail(
    'invalid',
    'target-line-of-sight-blocked',
    `Target ${targetPlacementId} is blocked from ${moveName} by authoritative line of sight (${sight.reasonCode}).`,
  )
}

const authoritativeTargetAccuracyModifiers = (
  context: AuthoritativeMoveRulesContext,
  target: SpawnedPokemon,
  baseValue: number,
): readonly MoveAutomationRollModifier[] => resolveAuthoritativeMoveSightAccuracy(
  context,
  target.id,
  baseValue,
).modifiers

const resolveLegalSingleTarget = (options: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: MoveAutomationScript
  readonly targetPlacementId: string
}): {
  readonly actorPlacement: SheetPlacement
  readonly actor: SpawnedPokemon
  readonly target: SpawnedPokemon
  readonly desiredFacing: ReturnType<typeof desiredFacingTowardToken>
} => {
  const { placement: actorPlacement, token: actor } = options.context.actor
  const rangeMeters = parseSingleTargetMoveRangeMeters(options.script.range, {
    focusSkillRankValue: actor.focusSkillRankValue,
  }) ?? fail(
    'unsupported',
    'unsupported-range',
    `${options.script.moveName} has an unsupported target range.`,
  )
  const resolvedTarget = resolveSelectedTarget(options.context, options.targetPlacementId)
  recordSheetReadForPlacement(options.context, resolvedTarget.placement)
  const targetability = options.context.queries.targetability.resolve({
    actorPlacementId: actorPlacement.id,
    targetPlacementId: resolvedTarget.token.id,
    attackingMoveId: options.script.moveName,
  })
  if (!targetability.targetable) {
    fail(
      'unauthorized-state',
      'target-semi-invulnerable',
      `Target ${resolvedTarget.token.id} cannot be targeted by ${options.script.moveName} while ${targetability.state}.`,
    )
  }
  assertAuthoritativeTargetLineOfSight(
    options.context,
    resolvedTarget.token.id,
    options.script.moveName,
  )
  const legalTargets = legalSingleTargetTokens({
    script: options.script,
    user: actor,
    tokens: options.context.queries.tokens.all(),
    rangeMeters,
  })
  if (
    !legalTargets.some(candidate => candidate.id === resolvedTarget.token.id)
    && targetability.exception?.ignoresRange !== true
  ) {
    fail(
      'invalid',
      'target-out-of-range',
      `Target ${resolvedTarget.token.id} is outside ${options.script.moveName}'s authoritative range.`,
    )
  }
  return {
    actorPlacement,
    actor,
    target: resolvedTarget.token,
    desiredFacing: desiredFacingTowardToken(actorPlacement, actor, resolvedTarget.token),
  }
}

const resolveSingleTargetMove = (options: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: MoveAutomationScript
  readonly selection: Extract<ResolveMoveSelection, { kind: 'single-target' }>
  readonly frequency: string | null
  readonly damageFormula: string | null
  readonly canonicalMoveName: string
  readonly moveKey: string
  readonly targetBranchId?: string
}): UnfinalizedAuthoritativeMoveResolution => {
  const moveName = options.script.moveName
  if (!isSeamlessSingleTargetMoveScript(options.script)) {
    fail('invalid', 'selection-kind-mismatch', `${moveName} is not a seamless single-target move.`)
  }
  assertResolvableDamage(options.script, options.damageFormula)
  const { actorPlacement, actor, target, desiredFacing } = resolveLegalSingleTarget({
    context: options.context,
    script: options.script,
    targetPlacementId: options.selection.targetPlacementId,
  })
  const common = {
    script: options.script,
    user: actor,
    target,
    damageFormula: options.damageFormula,
    fieldEffects: authoritativeFieldEffectsForActor(options.context, target.id),
    damageInputsForTarget: authoritativeLegacyDamageInputsForTarget(options.context),
    conditionImmunityContext: authoritativeConditionImmunityContext(options.context, options.script),
    accuracyRule: options.context.queries.weather.accuracy({
      canonicalMoveId: options.canonicalMoveName,
    }).rule,
    accuracyModifiersForTarget: (resolvedTarget: SpawnedPokemon, baseValue: number) => (
      authoritativeTargetAccuracyModifiers(options.context, resolvedTarget, baseValue)
    ),
    randomRoller: options.context.random,
  }

  if (!options.script.requiresAccuracy) {
    const result = resolveInstantNoRollTargetMoveAutomation(common)
    return {
      actorPlacementId: actorPlacement.id,
      moveName: options.script.moveName,
      canonicalMoveName: options.canonicalMoveName,
      moveKey: options.moveKey,
      frequency: options.frequency,
      damageFormula: options.damageFormula,
      ...(options.targetBranchId ? { targetBranchId: options.targetBranchId } : {}),
      selectedTargetIds: [target.id],
      script: options.script,
      transaction: result.transaction,
      conditionOutcomes: result.conditionOutcomes,
      ...(desiredFacing ? { desiredFacing } : {}),
    }
  }

  const result = resolveInstantMoveAutomation({
    ...common,
    idFactory: options.context.idFactory,
  })
  return {
    actorPlacementId: actorPlacement.id,
    moveName: options.script.moveName,
    canonicalMoveName: options.canonicalMoveName,
    moveKey: options.moveKey,
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

const resolveNativeSingleTargetMove = (options: {
  readonly context: AuthoritativeMoveRulesContext
  readonly runtime: MoveSpecV2Runtime
  readonly entry: ResolvedCanonicalMoveEntry
  readonly selection: Extract<ResolveMoveSelection, { kind: 'single-target' }>
  readonly moveKey: string
}): AuthoritativeMoveExecution => {
  const targeting = resolveMoveSpecTargetingRule(
    options.runtime.definition.spec,
    options.context.intent.targetBranchId,
  )
  if (targeting?.kind !== 'single-target') {
    return fail(
      'invalid',
      'selection-kind-mismatch',
      `${options.runtime.canonicalId} does not accept a single-target selection.`,
    )
  }
  if (
    options.entry.script.targetMode !== 'one-target'
    || options.entry.script.targetCount !== 1
  ) {
    fail(
      'invalid',
      'selection-kind-mismatch',
      `${options.runtime.canonicalId} canonical data is not single-target.`,
    )
  }

  const { actorPlacement, target, desiredFacing } = resolveLegalSingleTarget({
    context: options.context,
    script: options.entry.script,
    targetPlacementId: options.selection.targetPlacementId,
  })
  const outcome = resolveMoveSpecOutcome({
    context: options.context,
    runtime: options.runtime,
    entry: options.entry,
    targetBranchId: options.context.intent.targetBranchId,
    authoritativeTargetIds: [target.id],
    ancestry: options.context.ancestry,
  })
  if (outcome.kind === 'pending') {
    return {
      kind: 'pending',
      actorPlacementId: actorPlacement.id,
      moveName: options.runtime.definition.spec.presentation.displayName,
      canonicalMoveName: options.entry.canonicalMoveName,
      moveKey: options.moveKey,
      frequency: options.entry.frequency,
      damageFormula: options.entry.damageFormula,
      resourceRange: options.entry.script.range,
      selectedTargetIds: [target.id],
      sheetReads: outcome.sheetReads,
      runtime: options.runtime,
      execution: outcome.execution,
      preWindowPlan: outcome.preWindowPlan,
    }
  }
  const immediate = outcome.resolution

  return {
    actorPlacementId: actorPlacement.id,
    moveName: options.runtime.definition.spec.presentation.displayName,
    canonicalMoveName: options.entry.canonicalMoveName,
    moveKey: options.moveKey,
    frequency: options.entry.frequency,
    damageFormula: options.entry.damageFormula,
    ...(options.context.intent.targetBranchId
      ? { targetBranchId: options.context.intent.targetBranchId }
      : {}),
    selectedTargetIds: [target.id],
    sheetReads: immediate.sheetReads,
    rollLedger: immediate.rollLedger,
    auditTrace: immediate.trace,
    script: immediate.script,
    transaction: immediate.transaction,
    ...(desiredFacing ? { desiredFacing } : {}),
    nativeV2: immediate.native,
  }
}

interface LegalTargetCountMove {
  readonly actorPlacement: SheetPlacement
  readonly actor: SpawnedPokemon
  readonly selectedTargets: readonly SpawnedPokemon[]
  readonly selectedTargetIds: readonly string[]
  readonly desiredFacing: TokenFacingDirection | undefined
}

/** Validate direct multi-target intent once for both retained and native runtimes. */
const resolveLegalTargetCountMove = (options: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: MoveAutomationScript
  readonly selection: Extract<ResolveMoveSelection, { kind: 'target-count' }>
  readonly canonicalMoveName: string
}): LegalTargetCountMove => {
  const { placement: actorPlacement, token: actor } = options.context.actor
  const moveName = options.script.moveName
  if (!isSeamlessTargetCountMoveScript(options.script)) {
    fail(
      'invalid',
      'selection-kind-mismatch',
      `${moveName} is not a seamless target-count move.`,
    )
  }

  const submittedTargetIds = options.selection.targetPlacementIds
  if (submittedTargetIds.length === 0) {
    fail('invalid', 'empty-target-selection', 'At least one target is required.')
  }
  if (submittedTargetIds.length > LIVE_PLAY_MOVE_RESOLUTION_MAX_TARGET_IDS) {
    fail(
      'invalid',
      'too-many-targets',
      `At most ${LIVE_PLAY_MOVE_RESOLUTION_MAX_TARGET_IDS} targets may be submitted.`,
    )
  }
  assertNoDuplicateTargetIds(submittedTargetIds)

  const maxTargetCount = typeof options.script.targetCount === 'number'
    && Number.isFinite(options.script.targetCount)
    ? Math.floor(options.script.targetCount)
    : 0
  if (submittedTargetIds.length > maxTargetCount) {
    fail(
      'invalid',
      'too-many-targets',
      `${options.script.moveName} can target at most ${maxTargetCount} targets.`,
    )
  }

  const rangeMeters = parseExplicitMultiTargetMoveRangeMeters(options.script.range)
    ?? fail(
      'unsupported',
      'unsupported-range',
      `${options.script.moveName} has an unsupported target-count range.`,
    )
  const targetabilityById = new Map<string, ReturnType<
    AuthoritativeMoveRulesContext['queries']['targetability']['resolve']
  >>()
  for (const targetId of submittedTargetIds) {
    const target = resolveSelectedTarget(options.context, targetId)
    recordSheetReadForPlacement(options.context, target.placement)
    const targetability = options.context.queries.targetability.resolve({
      actorPlacementId: actorPlacement.id,
      targetPlacementId: targetId,
      attackingMoveId: options.canonicalMoveName,
    })
    if (!targetability.targetable) {
      fail(
        'unauthorized-state',
        'target-semi-invulnerable',
        `Target ${targetId} cannot be targeted by ${options.canonicalMoveName} while ${targetability.state}.`,
      )
    }
    assertAuthoritativeTargetLineOfSight(
      options.context,
      targetId,
      options.canonicalMoveName,
    )
    targetabilityById.set(targetId, targetability)
  }

  const legalTargets = moveAutomationTargetsInRange({
    user: actor,
    tokens: options.context.queries.tokens.all(),
    rangeMeters,
  })
  const legalTargetIds = new Set(legalTargets.map(target => target.id))
  for (const targetId of submittedTargetIds) {
    if (
      !legalTargetIds.has(targetId)
      && targetabilityById.get(targetId)?.exception?.ignoresRange !== true
    ) {
      fail(
        'invalid',
        'target-out-of-range',
        `Target ${targetId} is outside ${options.script.moveName}'s authoritative range.`,
      )
    }
  }

  const submittedTargetSet = new Set(submittedTargetIds)
  const selectedTargets = legalTargets.filter(target => submittedTargetSet.has(target.id))
  return {
    actorPlacement,
    actor,
    selectedTargets,
    selectedTargetIds: selectedTargets.map(target => target.id),
    desiredFacing: desiredFacingTowardNearestTarget(actorPlacement, actor, selectedTargets),
  }
}

const resolveTargetCountMove = (options: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: MoveAutomationScript
  readonly selection: Extract<ResolveMoveSelection, { kind: 'target-count' }>
  readonly frequency: string | null
  readonly damageFormula: string | null
  readonly canonicalMoveName: string
  readonly moveKey: string
  readonly targetBranchId?: string
}): UnfinalizedAuthoritativeMoveResolution => {
  assertResolvableDamage(options.script, options.damageFormula)
  const legal = resolveLegalTargetCountMove(options)
  const transaction = resolveInstantMultiTargetMoveAutomation({
    script: options.script,
    user: legal.actor,
    selectedTargets: legal.selectedTargets,
    damageFormula: options.damageFormula,
    fieldEffects: authoritativeFieldEffectsForActor(options.context),
    fieldEffectsForTarget: target => authoritativeFieldEffectsForActor(options.context, target.id),
    damageInputsForTarget: authoritativeLegacyDamageInputsForTarget(options.context),
    conditionImmunityContext: authoritativeConditionImmunityContext(options.context, options.script),
    accuracyRule: options.context.queries.weather.accuracy({
      canonicalMoveId: options.canonicalMoveName,
    }).rule,
    accuracyModifiersForTarget: (target: SpawnedPokemon, baseValue: number) => (
      authoritativeTargetAccuracyModifiers(options.context, target, baseValue)
    ),
    randomRoller: options.context.random,
  })

  return {
    actorPlacementId: legal.actorPlacement.id,
    moveName: options.script.moveName,
    canonicalMoveName: options.canonicalMoveName,
    moveKey: options.moveKey,
    frequency: options.frequency,
    damageFormula: options.damageFormula,
    ...(options.targetBranchId ? { targetBranchId: options.targetBranchId } : {}),
    selectedTargetIds: legal.selectedTargetIds,
    script: options.script,
    transaction,
    ...(legal.desiredFacing ? { desiredFacing: legal.desiredFacing } : {}),
  }
}

const resolveNativeTargetCountMove = (options: {
  readonly context: AuthoritativeMoveRulesContext
  readonly runtime: MoveSpecV2Runtime
  readonly entry: ResolvedCanonicalMoveEntry
  readonly selection: Extract<ResolveMoveSelection, { kind: 'target-count' }>
  readonly moveKey: string
}): AuthoritativeMoveExecution => {
  const targeting = resolveMoveSpecTargetingRule(
    options.runtime.definition.spec,
    options.context.intent.targetBranchId,
  )
  if (
    targeting?.kind !== 'multi-target'
    || targeting.selector?.kind !== 'selected-targets'
    || targeting.minTargets < 1
    || targeting.minTargets > targeting.maxTargets
    || targeting.maxTargets !== options.entry.script.targetCount
  ) {
    return fail(
      'invalid',
      'selection-kind-mismatch',
      `${options.runtime.canonicalId} has no matching reviewed direct multi-target declaration.`,
    )
  }

  const legal = resolveLegalTargetCountMove({
    context: options.context,
    script: options.entry.script,
    selection: options.selection,
    canonicalMoveName: options.entry.canonicalMoveName,
  })
  const outcome = resolveMoveSpecOutcome({
    context: options.context,
    runtime: options.runtime,
    entry: options.entry,
    targetBranchId: options.context.intent.targetBranchId,
    authoritativeTargetIds: legal.selectedTargetIds,
    ancestry: options.context.ancestry,
  })
  if (outcome.kind === 'pending') {
    return {
      kind: 'pending',
      actorPlacementId: legal.actorPlacement.id,
      moveName: options.runtime.definition.spec.presentation.displayName,
      canonicalMoveName: options.entry.canonicalMoveName,
      moveKey: options.moveKey,
      frequency: options.entry.frequency,
      damageFormula: options.entry.damageFormula,
      resourceRange: options.entry.script.range,
      selectedTargetIds: legal.selectedTargetIds,
      sheetReads: outcome.sheetReads,
      runtime: options.runtime,
      execution: outcome.execution,
      preWindowPlan: outcome.preWindowPlan,
    }
  }
  const immediate = outcome.resolution
  return {
    actorPlacementId: legal.actorPlacement.id,
    moveName: options.runtime.definition.spec.presentation.displayName,
    canonicalMoveName: options.entry.canonicalMoveName,
    moveKey: options.moveKey,
    frequency: options.entry.frequency,
    damageFormula: options.entry.damageFormula,
    selectedTargetIds: legal.selectedTargetIds,
    sheetReads: immediate.sheetReads,
    rollLedger: immediate.rollLedger,
    auditTrace: immediate.trace,
    script: immediate.script,
    transaction: immediate.transaction,
    ...(legal.desiredFacing ? { desiredFacing: legal.desiredFacing } : {}),
    nativeV2: immediate.native,
  }
}

const resolveAreaMove = (options: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: MoveAutomationScript
  readonly selection: Extract<ResolveMoveSelection, { kind: 'area' }>
  readonly frequency: string | null
  readonly damageFormula: string | null
  readonly canonicalMoveName: string
  readonly moveKey: string
  readonly targetBranchId?: string
}): UnfinalizedAuthoritativeMoveResolution => {
  const { placement: actorPlacement, token: actor } = options.context.actor
  const template = selectedAreaTemplate(options.script, options.selection.areaTemplateId)
  assertResolvableDamage(options.script, options.damageFormula)

  const placement = resolvedAreaPlacement({
    context: options.context,
    actor,
    template,
    selection: options.selection,
  })
  const candidateTargetIds = placement.candidateTargets.map((target) => target.id)
  recordSheetReadsForTokens(options.context, placement.candidateTargets)
  const excludedTargetIds = requestedAreaTargetExclusionIds(options.script, options.selection)
  const areaTargets = resolveAuthoritativeAreaTargets({
    actorPlacementId: actorPlacement.id,
    geometricallyAffectedPlacementIds: candidateTargetIds,
    predicate: options.script.areaTargetRelationship === 'ally'
      ? {
          relationship: 'ally',
          willingness: 'any',
          excludeActor: true,
        }
      : DEFAULT_MOVE_AUTOMATION_AREA_TARGET_PREDICATE,
    relationships: options.context.queries.relationships,
    states: options.context.queries.targetStates,
    targetability: options.context.queries.targetability,
    lineOfSight: options.context.queries.lineOfSight,
    attackingMoveId: options.canonicalMoveName,
    requestedExcludedPlacementIds: excludedTargetIds,
  })
  const eligibleTargetIds = new Set(areaTargets.eligibleTargetPlacementIds)
  const selectedTargets = placement.candidateTargets.filter(target => eligibleTargetIds.has(target.id))
  const selectedTargetIds = selectedTargets.map(target => target.id)
  const confirmedScript = moveAutomationScriptForConfirmedAreaTemplate(options.script, template)
  const baseTransaction = resolveInstantAreaMoveAutomation({
    script: confirmedScript,
    user: actor,
    targets: selectedTargets,
    damageFormula: options.damageFormula,
    fieldEffects: authoritativeFieldEffectsForActor(options.context),
    fieldEffectsForTarget: target => authoritativeFieldEffectsForActor(options.context, target.id),
    damageInputsForTarget: authoritativeLegacyDamageInputsForTarget(options.context),
    conditionImmunityContext: authoritativeConditionImmunityContext(options.context, confirmedScript),
    accuracyRule: options.context.queries.weather.accuracy({
      canonicalMoveId: options.canonicalMoveName,
    }).rule,
    accuracyModifiersForTarget: (target: SpawnedPokemon, baseValue: number) => (
      authoritativeTargetAccuracyModifiers(options.context, target, baseValue)
    ),
    randomRoller: options.context.random,
  })
  const targetPolicyLogLines = areaTargetPolicyLogLines(confirmedScript)
  const targetFilteredTransaction = targetPolicyLogLines.length
    ? moveAutomationTransactionWithAppendedLogLines(baseTransaction, targetPolicyLogLines)
    : baseTransaction
  const transaction = placement.movement?.kind === 'pass'
    ? moveAutomationTransactionWithAppendedLogLines(
        targetFilteredTransaction,
        [passDestinationLogLine(actor, placement.movement.destination)],
      )
    : targetFilteredTransaction
  const currentFacing = tokenFacingForPlacement(actorPlacement)
  const desiredFacing = placement.direction
    ? tokenFacingFromAreaDirection(placement.direction, currentFacing) ?? (placement.movement?.kind === 'pass' ? currentFacing : undefined)
    : desiredFacingTowardNearestTarget(actorPlacement, actor, selectedTargets)
  const movement = placement.movement
    ? {
        kind: 'pass' as const,
        from: cloneGridAnchor(placement.movement.from),
        destination: cloneGridAnchor(placement.movement.destination),
        direction: placement.movement.direction,
        pathCells: cloneGridAnchors(placement.movement.pathCells),
      }
    : undefined

  return {
    actorPlacementId: actorPlacement.id,
    moveName: confirmedScript.moveName,
    canonicalMoveName: options.canonicalMoveName,
    moveKey: options.moveKey,
    frequency: options.frequency,
    damageFormula: options.damageFormula,
    ...(options.targetBranchId ? { targetBranchId: options.targetBranchId } : {}),
    selectedTargetIds,
    script: confirmedScript,
    transaction,
    ...(desiredFacing ? { desiredFacing } : {}),
    ...(movement ? { movement } : {}),
    ...(placement.resourceMovement
      ? { resourceMovement: { ...placement.resourceMovement } }
      : {}),
    area: {
      areaTemplateId: options.selection.areaTemplateId,
      template: cloneAreaTemplate(template),
      cells: cloneGridAnchors(placement.cells),
      candidateTargetIds: [...candidateTargetIds],
      excludedTargetIds: [...excludedTargetIds],
      targetEvaluations: areaTargets.evaluations.map(evaluation => ({ ...evaluation })),
      ...(placement.direction ? { direction: placement.direction } : {}),
      ...(placement.aimCell ? { aimCell: cloneGridAnchor(placement.aimCell) } : {}),
    },
  }
}

const resolveNativeAreaMove = (options: {
  readonly context: AuthoritativeMoveRulesContext
  readonly runtime: MoveSpecV2Runtime
  readonly entry: ResolvedCanonicalMoveEntry
  readonly selection: Extract<ResolveMoveSelection, { kind: 'area' }>
  readonly moveKey: string
}): AuthoritativeMoveExecution => {
  const targeting = resolveMoveSpecTargetingRule(
    options.runtime.definition.spec,
    options.context.intent.targetBranchId,
  )
  if (targeting?.kind !== 'area') {
    return fail(
      'invalid',
      'selection-kind-mismatch',
      `${options.runtime.canonicalId} does not accept an area selection.`,
    )
  }

  const { placement: actorPlacement, token: actor } = options.context.actor
  const template = selectedAreaTemplate(options.entry.script, options.selection.areaTemplateId)
  const selector = targeting.selector
  if (
    selector !== null
    && selector.kind !== 'area-targets'
    && selector.kind !== 'candidate-targets'
  ) {
    return fail(
      'unsupported',
      'unsupported-move-script',
      `${options.runtime.canonicalId} has no reviewed geometric area-target selector.`,
    )
  }
  const movementOperation = options.runtime.definition.spec.phases
    .flatMap(block => block.operations)
    .find(operation => operation.kind === 'movement-request')
  if (
    template.kind === 'pass'
    && (
      !movementOperation
      || movementOperation.payload.mode !== 'voluntary'
      || movementOperation.payload.distance !== template.size
    )
  ) {
    return fail(
      'unsupported',
      'unsupported-move-script',
      `${options.runtime.canonicalId} has no reviewed immediate Pass movement operation.`,
    )
  }

  const placement = resolvedAreaPlacement({
    context: options.context,
    actor,
    template,
    selection: options.selection,
  })
  const candidateTargetIds = placement.candidateTargets.map(target => target.id)
  recordSheetReadsForTokens(options.context, placement.candidateTargets)
  const excludedTargetIds = requestedAreaTargetExclusionIds(
    options.entry.script,
    options.selection,
  )
  const areaTargets = resolveAuthoritativeAreaTargets({
    actorPlacementId: actorPlacement.id,
    geometricallyAffectedPlacementIds: candidateTargetIds,
    predicate: targeting.predicate ?? DEFAULT_MOVE_AUTOMATION_AREA_TARGET_PREDICATE,
    relationships: options.context.queries.relationships,
    states: options.context.queries.targetStates,
    targetability: options.context.queries.targetability,
    lineOfSight: options.context.queries.lineOfSight,
    attackingMoveId: options.runtime.canonicalId,
    requestedExcludedPlacementIds: excludedTargetIds,
    ...(placement.aimCell
      ? {
          centralCellAffectedPlacementIds: tokensInMoveAutomationArea({
            cells: [placement.aimCell],
            tokens: placement.candidateTargets,
          }).map(({ id }) => id),
        }
      : {}),
  })
  const eligibleTargetIds = new Set(areaTargets.eligibleTargetPlacementIds)
  const selectedTargets = placement.candidateTargets.filter(target => eligibleTargetIds.has(target.id))
  const selectedTargetIds = selectedTargets.map(target => target.id)
  const outcome = resolveMoveSpecOutcome({
    context: options.context,
    runtime: options.runtime,
    entry: options.entry,
    targetBranchId: options.context.intent.targetBranchId,
    authoritativeTargetIds: selectedTargetIds,
    authoritativeTargetEvaluations: areaTargets.evaluations,
    authoritativeAreaCells: placement.cells,
    ancestry: options.context.ancestry,
  })
  if (outcome.kind === 'pending') {
    return {
      kind: 'pending',
      actorPlacementId: actorPlacement.id,
      moveName: options.runtime.definition.spec.presentation.displayName,
      canonicalMoveName: options.entry.canonicalMoveName,
      moveKey: options.moveKey,
      frequency: options.entry.frequency,
      damageFormula: options.entry.damageFormula,
      resourceRange: options.entry.script.range,
      ...(placement.resourceMovement
        ? { resourceMovement: { ...placement.resourceMovement } }
        : {}),
      selectedTargetIds,
      sheetReads: outcome.sheetReads,
      runtime: options.runtime,
      execution: outcome.execution,
      preWindowPlan: outcome.preWindowPlan,
    }
  }
  const immediate = outcome.resolution
  const currentFacing = tokenFacingForPlacement(actorPlacement)
  const desiredFacing = placement.direction
    ? tokenFacingFromAreaDirection(placement.direction, currentFacing)
      ?? (placement.movement?.kind === 'pass' ? currentFacing : undefined)
    : desiredFacingTowardNearestTarget(actorPlacement, actor, selectedTargets)
  const movement = placement.movement
    ? {
        kind: 'pass' as const,
        from: cloneGridAnchor(placement.movement.from),
        destination: cloneGridAnchor(placement.movement.destination),
        direction: placement.movement.direction,
        pathCells: cloneGridAnchors(placement.movement.pathCells),
      }
    : undefined
  const transaction = movement
    ? moveAutomationTransactionWithAppendedLogLines(
        immediate.transaction,
        [passDestinationLogLine(actor, movement.destination)],
      )
    : immediate.transaction

  return {
    actorPlacementId: actorPlacement.id,
    moveName: options.runtime.definition.spec.presentation.displayName,
    canonicalMoveName: options.entry.canonicalMoveName,
    moveKey: options.moveKey,
    frequency: options.entry.frequency,
    damageFormula: options.entry.damageFormula,
    ...(options.context.intent.targetBranchId
      ? { targetBranchId: options.context.intent.targetBranchId }
      : {}),
    selectedTargetIds,
    sheetReads: immediate.sheetReads,
    rollLedger: immediate.rollLedger,
    auditTrace: immediate.trace,
    script: immediate.script,
    transaction,
    ...(desiredFacing ? { desiredFacing } : {}),
    ...(movement ? { movement } : {}),
    ...(placement.resourceMovement
      ? { resourceMovement: { ...placement.resourceMovement } }
      : {}),
    area: {
      areaTemplateId: options.selection.areaTemplateId,
      template: cloneAreaTemplate(template),
      cells: cloneGridAnchors(placement.cells),
      candidateTargetIds: [...candidateTargetIds],
      excludedTargetIds: [...excludedTargetIds],
      targetEvaluations: areaTargets.evaluations.map(evaluation => ({ ...evaluation })),
      ...(placement.direction ? { direction: placement.direction } : {}),
      ...(placement.aimCell ? { aimCell: cloneGridAnchor(placement.aimCell) } : {}),
    },
    nativeV2: immediate.native,
  }
}

const failFromContextError = (error: AuthoritativeMoveRulesContextError): never => {
  if (error.code === 'duplicate-placement-id') {
    return fail('conflict', 'duplicate-placement-id', error.message)
  }
  if (error.code === 'actor-placement-missing') {
    return fail('not-found', 'actor-placement-missing', error.message)
  }
  if (error.code === 'actor-sheet-missing') {
    return fail('not-found', 'actor-sheet-missing', error.message)
  }
  if (error.code === 'actor-token-unresolved') {
    return fail('not-found', 'actor-token-unresolved', error.message)
  }
  if (error.code === 'duplicate-selected-id') {
    return fail('conflict', 'duplicate-target-id', error.message)
  }
  if (error.code === 'sheet-read-revision-conflict') {
    return fail('conflict', 'sheet-read-revision-conflict', error.message)
  }
  return fail('conflict', 'duplicate-placement-id', error.message)
}

/** Resolve mechanics exclusively from one detached authoritative snapshot. */
export const resolveAuthoritativeMoveExecutionFromContext = (
  context: AuthoritativeMoveRulesContext,
  options: {
    readonly resourceCostDeclarations?: readonly MoveSpecCostDeclaration[]
  } = {},
): AuthoritativeMoveExecution => {
  const { placement: actorPlacement } = context.actor
  const { intent } = context
  recordSheetReadForPlacement(context, actorPlacement)
  const submittedTargetIds = selectedTargetIdsForSelection(intent.selection)
  assertNoDuplicateTargetIds(submittedTargetIds)

  const moveEntryResult = context.queries.resolveActorMoveEntry(intent.moveName)
  if (!moveEntryResult.ok) {
    if (moveEntryResult.reason === 'condition-blocked') {
      fail('unauthorized-state', 'move-condition-blocked', moveEntryResult.message)
    }
    if (moveEntryResult.reason === 'usage-blocked') {
      fail('conflict', 'move-usage-unavailable', moveEntryResult.message)
    }
    if (moveEntryResult.reason === 'move-list-blocked') {
      fail('unauthorized-state', 'move-list-overlay-blocked', moveEntryResult.message)
    }
    if (moveEntryResult.reason === 'copied-spec-mismatch') {
      fail('conflict', 'move-list-overlay-stale', moveEntryResult.message)
    }
    if (moveEntryResult.reason === 'creature-rule-blocked') {
      fail('unauthorized-state', 'move-creature-rule-blocked', moveEntryResult.message)
    }
    if (moveEntryResult.reason === 'move-absent') {
      fail('not-found', 'move-absent', moveEntryResult.message)
    }
    fail('not-found', 'actor-token-unresolved', moveEntryResult.message)
  }

  const entry = moveEntryResult.ok
    ? moveEntryResult.entry
    : fail('not-found', 'move-absent', 'Move entry resolution failed.')
  const actionAvailability = context.queries.targetability.resolveAction({
    actorPlacementId: actorPlacement.id,
    moveCanonicalId: entry.canonicalMoveName,
  })
  if (!actionAvailability.available) {
    fail(
      'unauthorized-state',
      'move-semi-invulnerable',
      `${actorPlacement.id} cannot declare ${entry.canonicalMoveName} while ${actionAvailability.state} (${actionAvailability.reasonCode}).`,
    )
  }
  const semanticStatus = context.queries.rules.semanticStatusFor(entry.canonicalMoveName)
  if (semanticStatus?.baseStatus === 'blocked') {
    const details = moveAutomationStatusDetailsText(semanticStatus)
    fail(
      'unsupported',
      'move-automation-blocked',
      `${entry.canonicalMoveName} automation is blocked.${details ? ` ${details}` : ''}`,
    )
  }
  const resolvedMoveKey = moveUsageKey(entry.canonicalMoveName)
  if (!resolvedMoveKey) {
    fail('invalid', 'move-usage-key-invalid', `${entry.canonicalMoveName} did not produce a valid move usage key.`)
  }
  const selectedRuntime = context.queries.rules.runtimeFor(entry.canonicalMoveName)
  const legacySelection = selectedRuntime?.kind === 'movespec-v2'
    ? null
    : resolveCanonicalScript({
        baseScript: entry.script,
        targetBranchId: intent.targetBranchId,
      })
  const reviewedCosts = options.resourceCostDeclarations
    ?? (selectedRuntime?.kind === 'movespec-v2'
      ? selectedRuntime.definition.spec.costs
      : undefined)
  const actionTiming = resolveAuthoritativeMoveActionTiming({
    range: legacySelection?.script.range ?? entry.script.range,
    ...(reviewedCosts && reviewedCosts.length > 0 ? { reviewedCosts } : {}),
  })
  const terrainAction = context.queries.terrain.action({
    placementId: actorPlacement.id,
    timing: actionTiming,
  })
  if (!terrainAction.allowed) {
    fail(
      'unauthorized-state',
      'move-terrain-blocked',
      `${actorPlacement.id} cannot declare ${entry.canonicalMoveName} as ${actionTiming} outside its own Initiative (${terrainAction.blockedBy}).`,
    )
  }
  if (selectedRuntime?.kind === 'movespec-v2') {
    const nativeSelectionKind = intent.selection.kind
    const finalizeNativeExecution = (
      execution: AuthoritativeMoveExecution,
    ): AuthoritativeMoveExecution => isAuthoritativePendingMoveResolution(execution)
      ? execution
      : attachResolutionDamageEffects(context, execution)

    if (intent.selection.kind === 'self') {
      return finalizeNativeExecution(resolveNativeSelfMove({
        context,
        runtime: selectedRuntime,
        entry,
        moveKey: resolvedMoveKey,
      }))
    }
    if (intent.selection.kind === 'area') {
      return finalizeNativeExecution(resolveNativeAreaMove({
        context,
        runtime: selectedRuntime,
        entry,
        selection: intent.selection,
        moveKey: resolvedMoveKey,
      }))
    }
    if (intent.selection.kind === 'single-target') {
      return finalizeNativeExecution(resolveNativeSingleTargetMove({
        context,
        runtime: selectedRuntime,
        entry,
        selection: intent.selection,
        moveKey: resolvedMoveKey,
      }))
    }
    if (intent.selection.kind === 'target-count') {
      return finalizeNativeExecution(resolveNativeTargetCountMove({
        context,
        runtime: selectedRuntime,
        entry,
        selection: intent.selection,
        moveKey: resolvedMoveKey,
      }))
    }
    return fail(
      'invalid',
      'selection-kind-mismatch',
      `${entry.canonicalMoveName} does not accept a ${nativeSelectionKind} selection.`,
    )
  }

  const { script, targetBranchId } = legacySelection
    ?? fail(
      'unsupported',
      'unsupported-move-script',
      `${entry.canonicalMoveName} did not resolve a retained script.`,
    )
  const dashBlock = moveDashConditionUseBlock(script.range, context.actor.token.conditions)
  if (dashBlock) {
    fail(
      'unauthorized-state',
      'move-condition-blocked',
      `${entry.canonicalMoveName} is blocked by ${dashBlock.label}: ${dashBlock.reason}`,
    )
  }
  const common = {
    context,
    script,
    frequency: entry.frequency,
    damageFormula: entry.damageFormula,
    canonicalMoveName: entry.canonicalMoveName,
    moveKey: resolvedMoveKey,
    targetBranchId,
  }

  if (intent.selection.kind === 'self') {
    return finalizeResolution(context, resolveSelfMove(common))
  }
  if (intent.selection.kind === 'single-target') {
    return finalizeResolution(context, resolveSingleTargetMove({
      ...common,
      selection: intent.selection,
    }))
  }
  if (intent.selection.kind === 'target-count') {
    return finalizeResolution(context, resolveTargetCountMove({
      ...common,
      selection: intent.selection,
    }))
  }
  if (intent.selection.kind === 'area') {
    return finalizeResolution(context, resolveAreaMove({
      ...common,
      selection: intent.selection,
    }))
  }
  return fail('unsupported', 'unsupported-move-script', 'Unsupported move selection.')
}

export const resolveAuthoritativeMoveExecution = (
  input: ResolveAuthoritativeMoveInput,
): AuthoritativeMoveExecution => {
  const selectedPlacementIds = selectedTargetIdsForSelection(input.intent.selection)
  assertNoDuplicateTargetIds(selectedPlacementIds)
  const random = input.random ?? Math.random
  const time = (input.now ?? Date.now)()

  try {
    const context = buildAuthoritativeMoveRulesContext({
      map: input.map,
      pokemonSheets: input.pokemonSheets,
      trainerSheets: input.trainerSheets,
      intent: input.intent,
      selectedPlacementIds,
      random,
      time,
      resolutionId: input.resolutionId,
      ancestry: input.ancestry,
      tokenPositionOverrides: input.tokenPositionOverrides,
      idFactory: input.idFactory,
      runtimeRegistry: input.runtimeRegistry,
      legacyScripts: input.legacyScripts,
      itemResources: input.itemResources,
    })
    return resolveAuthoritativeMoveExecutionFromContext(context, {
      ...(input.resourceCostDeclarations === undefined
        ? {}
        : { resourceCostDeclarations: input.resourceCostDeclarations }),
    })
  }
  catch (error) {
    if (error instanceof AuthoritativeMoveRulesContextError) return failFromContextError(error)
    throw error
  }
}

const requireImmediateMoveExecution = (
  execution: AuthoritativeMoveExecution,
): AuthoritativeMoveResolution => {
  if (!isAuthoritativePendingMoveResolution(execution)) return execution
  return fail(
    'unsupported',
    'move-response-required',
    `${execution.canonicalMoveName} requires durable response orchestration.`,
  )
}

/** Compatibility boundary for callers that explicitly require an immediate move. */
export const resolveAuthoritativeMoveFromContext = (
  context: AuthoritativeMoveRulesContext,
): AuthoritativeMoveResolution => requireImmediateMoveExecution(
  resolveAuthoritativeMoveExecutionFromContext(context),
)

/** Compatibility boundary for immediate resolver and planner tests. */
export const resolveAuthoritativeMove = (
  input: ResolveAuthoritativeMoveInput,
): AuthoritativeMoveResolution => requireImmediateMoveExecution(
  resolveAuthoritativeMoveExecution(input),
)

export const isAuthoritativeMoveResolutionError = (value: unknown): value is AuthoritativeMoveResolutionError =>
  value instanceof AuthoritativeMoveResolutionError

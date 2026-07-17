import { nextRevision, normalizeRevision } from '#shared/sessionRevisions'
import type { ResolveMoveIntent } from '#shared/livePlayMoveResolution'
import type { MoveResolutionTraceAncestryEntry } from '#shared/moveAutomation/trace'
import type { MoveSpecCostDeclaration } from '#shared/moveAutomation/spec'
import type { EncounterTurnResourceDirectory } from '#shared/moveAutomation/encounterResources'
import {
  createEmptyEncounterState,
  parseEncounterState,
  type EncounterState,
} from '#shared/moveAutomation/encounterState'
import type { CharacterSheet } from '~/types/characterSheet'
import type { CombatStageMap } from '~/types/combatStages'
import type {
  GridAnchor,
  SheetKind,
  SheetPlacement,
  TabletopMap,
} from '~/types/map'
import type {
  MoveAutomationCombatStageUpdate,
  MoveAutomationConditionUpdate,
  MoveAutomationHpUpdate,
  MoveAutomationScript,
  MoveAutomationTransaction,
} from '~/types/moveAutomation'
import type { TrainerSheet } from '~/types/trainerSheet'
import { applyMoveFieldEffectToFieldEffects } from '~/utils/mapFieldEffects'
import { applyMapHazardPlacement } from '~/utils/mapHazards'
import { mapWithTemporaryHpForPlacement } from '~/utils/mapTemporaryHitPoints'
import { appendMoveAutomationLogEntry } from '~/utils/moveAutomationLog'
import { deepCloneJson, sameJsonValue, stableJsonStringify } from '~/utils/serialization'
import {
  applyCombatStagesToSheet,
  applyConditionsToSheet,
  applyHpToSheet,
  type AnyLiveSheet,
} from '~/utils/sheetMutations'
import {
  AuthoritativeMoveResolutionError,
  deduplicateAuthoritativeMoveSheetReads,
  isAuthoritativePendingMoveResolution,
  resolveAuthoritativeMoveExecution,
  type AuthoritativePendingMoveResolution,
  type AuthoritativeMoveResolution,
  type AuthoritativeMoveSheetRead,
} from './resolveAuthoritativeMove'
import {
  adaptV1Transaction,
  type AdaptV1MapChanges,
  type AdaptV1SheetWrite,
} from './moveAutomation/adaptV1Transaction'
import {
  abilityFollowUpPersistenceIdentity,
  materializeAbilityFollowUps,
} from './moveAutomation/abilityFollowUps'
import { buildAuthoritativeMoveMapChanges } from './moveAutomation/mapChanges'
import {
  materializeMoveSpecSuspension,
  type MaterializedMoveSpecSuspension,
} from './moveAutomation/materializeSuspension'
import { applyMapGlobalField } from './moveAutomation/fieldMapState'
import { applyEncounterEffectLifecycleEvent } from './moveAutomation/effectLifecycle'
import {
  applyNativeCoreMapChanges,
  nativeSheetWritesFromStateChanges,
  planNativeV2MoveState,
} from './moveAutomation/planNativeV2MoveState'
import { applyAuthoritativeMovePlacementTransition } from './moveAutomation/placementTransition'
import {
  RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  createMoveStateChangePlan,
  type MoveSheetStateField,
  type MoveStateChangeInput,
  type MoveStateChangePlan,
} from './moveAutomation/plan'
import {
  planEncounterMoveResourceCosts,
  planMoveResourceObservation,
} from './moveAutomation/planMoveResources'
import { EncounterResourceReductionError } from './moveAutomation/reduceEncounterResources'
import type { AuthoritativeMoveRandomSource } from './moveAutomation/random'
import {
  MOVE_AUTOMATION_RUNTIME_REGISTRY,
  type MoveAutomationRuntimeRegistry,
} from './moveAutomation/registry'
import {
  deduplicateAuthoritativeMoveGroupInventoryReads,
  type AuthoritativeMoveGroupInventoryRead,
  type AuthoritativeMoveItemResources,
} from './moveAutomation/itemResources'
import {
  isMoveUsageTransitionError,
  planMoveUsageTransition,
  type PlannedMoveUsageTransition,
  type UseMoveUsageSummary,
} from './planMoveUsageTransition'

export type AuthoritativeMoveStatePlanFailureReason = 'invalid' | 'not-found' | 'conflict' | 'unsupported'

export class AuthoritativeMoveStatePlanError extends Error {
  readonly reason: AuthoritativeMoveStatePlanFailureReason
  readonly code: string

  constructor(
    reason: AuthoritativeMoveStatePlanFailureReason,
    code: string,
    message: string,
    options: { readonly cause?: unknown } = {},
  ) {
    super(message)
    this.name = 'AuthoritativeMoveStatePlanError'
    this.reason = reason
    this.code = code
    if (options.cause !== undefined) this.cause = options.cause
  }
}

export interface PlanAuthoritativeMoveStateInput {
  readonly map: TabletopMap
  readonly pokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly trainerSheets: ReadonlyMap<string, TrainerSheet>
  readonly intent: ResolveMoveIntent
  readonly random?: AuthoritativeMoveRandomSource
  readonly now?: () => number
  readonly ancestry?: readonly MoveResolutionTraceAncestryEntry[]
  readonly tokenPositionOverrides?: ReadonlyMap<string, GridAnchor>
  readonly idFactory?: () => string
  readonly operationId?: string
  /** Deterministic server identity derived from the exact declaration command. */
  readonly pendingResolutionId?: string
  readonly maxMoveLogEntries?: number
  /** Test/migration seam; production uses the manifest-selected global registry. */
  readonly runtimeRegistry?: MoveAutomationRuntimeRegistry
  /** Test/migration seam for retained v1 definitions. */
  readonly legacyScripts?: ReadonlyMap<string, MoveAutomationScript>
  /** Server-reviewed child/reaction policy; never populated from move intent. */
  readonly resourceCostDeclarations?: readonly MoveSpecCostDeclaration[]
  /** Exact private item resources loaded by the authoritative use case. */
  readonly itemResources?: AuthoritativeMoveItemResources
}

export type AuthoritativeMoveSheetChangedField = MoveSheetStateField

export interface AuthoritativeMoveSheetWritePlan extends AdaptV1SheetWrite {
  readonly revision: number
  readonly changedFields: readonly AuthoritativeMoveSheetChangedField[]
}

export type AuthoritativeMoveMapChanges = AdaptV1MapChanges

export interface AuthoritativeMoveStatePlan {
  readonly previousMap: TabletopMap
  readonly nextMap: TabletopMap
  readonly previousRevision: number
  readonly revision: number
  readonly resolution: AuthoritativeMoveResolution
  readonly usage: UseMoveUsageSummary
  readonly previousUsage: UseMoveUsageSummary
  readonly sheetReads: readonly AuthoritativeMoveSheetRead[]
  readonly groupInventoryReads: readonly AuthoritativeMoveGroupInventoryRead[]
  readonly sheetWrites: readonly AuthoritativeMoveSheetWritePlan[]
  readonly mapChanges: AuthoritativeMoveMapChanges
  /** Ordered, resource-grouped persistence intent for the typed planning path. */
  readonly stateChanges: MoveStateChangePlan
  /** Post-commit assisted follow-ups opened atomically with the accepted move. */
  readonly followUpResolution?: import('#shared/moveAutomation/pendingResolution').PendingMoveResolution
}

export interface AuthoritativePendingMoveStatePlan {
  readonly kind: 'pending'
  readonly previousMap: TabletopMap
  readonly nextMap: TabletopMap
  readonly previousRevision: number
  readonly revision: number
  readonly execution: AuthoritativePendingMoveResolution
  readonly suspension: MaterializedMoveSpecSuspension
  readonly sheetReads: readonly AuthoritativeMoveSheetRead[]
  readonly groupInventoryReads: readonly AuthoritativeMoveGroupInventoryRead[]
  readonly sheetWrites: readonly AuthoritativeMoveSheetWritePlan[]
  readonly mapChanges: AuthoritativeMoveMapChanges
  readonly stateChanges: MoveStateChangePlan<EncounterState>
}

export type AuthoritativeMoveStatePlanningResult =
  | AuthoritativeMoveStatePlan
  | AuthoritativePendingMoveStatePlan

export const isAuthoritativePendingMoveStatePlan = (
  value: AuthoritativeMoveStatePlanningResult,
): value is AuthoritativePendingMoveStatePlan => (
  'kind' in value && value.kind === 'pending'
)

type SheetDocument = CharacterSheet | TrainerSheet

type SheetMutation = {
  readonly field: AuthoritativeMoveSheetChangedField
  readonly apply: (sheet: SheetDocument) => SheetDocument
}

interface SheetAccumulator {
  readonly kind: SheetKind
  readonly slug: string
  readonly previous: SheetDocument
  current: SheetDocument
  readonly placementIds: Set<string>
  readonly changedFields: Set<AuthoritativeMoveSheetChangedField>
  readonly contributions: Map<string, SheetMutation[]>
}

const fail = (
  reason: AuthoritativeMoveStatePlanFailureReason,
  code: string,
  message: string,
  cause?: unknown,
): never => {
  throw new AuthoritativeMoveStatePlanError(reason, code, message, { cause })
}

const cloneJson = <T>(value: T): T => deepCloneJson(value)

const sheetIdentity = (placement: Pick<SheetPlacement, 'sheetKind' | 'sheetSlug'>): string =>
  `${placement.sheetKind}:${placement.sheetSlug}`

const getSheetForPlacement = (
  placement: Pick<SheetPlacement, 'sheetKind' | 'sheetSlug'>,
  pokemonSheets: ReadonlyMap<string, CharacterSheet>,
  trainerSheets: ReadonlyMap<string, TrainerSheet>,
): SheetDocument | null => placement.sheetKind === 'pokemon'
  ? pokemonSheets.get(placement.sheetSlug) ?? null
  : trainerSheets.get(placement.sheetSlug) ?? null

const placementById = (map: TabletopMap): Map<string, SheetPlacement> => {
  const byId = new Map<string, SheetPlacement>()
  for (const placement of map.placements) byId.set(placement.id, placement)
  return byId
}

const reobserveAuthoritativeMoveSheetReads = (
  reads: readonly AuthoritativeMoveSheetRead[],
  pokemonSheets: ReadonlyMap<string, CharacterSheet>,
  trainerSheets: ReadonlyMap<string, TrainerSheet>,
): AuthoritativeMoveSheetRead[] => {
  const currentReads = reads.map((read): AuthoritativeMoveSheetRead => {
    const sheet = read.kind === 'pokemon'
      ? pokemonSheets.get(read.slug)
      : trainerSheets.get(read.slug)
    if (!sheet) {
      return fail(
        'not-found',
        'sheet-read-missing',
        `Consulted sheet ${read.kind}/${read.slug} was not found while finalizing the move plan.`,
      )
    }
    return {
      kind: read.kind,
      slug: read.slug,
      revision: normalizeRevision(sheet.revision),
    }
  })
  return deduplicateAuthoritativeMoveSheetReads([...reads, ...currentReads])
}

const assertFiniteNumber = (value: unknown, code: string, label: string): number => {
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue)) fail('invalid', code, `${label} must be a finite number.`)
  return numberValue
}

const assertNonNegativeNumber = (value: unknown, code: string, label: string): number => {
  const numberValue = assertFiniteNumber(value, code, label)
  if (numberValue < 0) fail('invalid', code, `${label} must be non-negative.`)
  return numberValue
}

const cloneMoveAutomationTransaction = (transaction: MoveAutomationTransaction): MoveAutomationTransaction => ({
  userId: transaction.userId,
  userName: transaction.userName,
  moveName: transaction.moveName,
  scriptKind: transaction.scriptKind,
  scriptVersion: transaction.scriptVersion,
  attackedTargetIds: [...transaction.attackedTargetIds],
  hitTargetIds: [...transaction.hitTargetIds],
  hpUpdates: cloneJson(transaction.hpUpdates),
  conditionUpdates: cloneJson(transaction.conditionUpdates),
  combatStageUpdates: cloneJson(transaction.combatStageUpdates),
  hazardsToAdd: cloneJson(transaction.hazardsToAdd),
  fieldEffectsToApply: cloneJson(transaction.fieldEffectsToApply),
  logLines: [...transaction.logLines],
})

const cloneResolution = (resolution: AuthoritativeMoveResolution): AuthoritativeMoveResolution => ({
  actorPlacementId: resolution.actorPlacementId,
  moveName: resolution.moveName,
  canonicalMoveName: resolution.canonicalMoveName,
  moveKey: resolution.moveKey,
  frequency: resolution.frequency,
  damageFormula: resolution.damageFormula,
  ...(resolution.targetBranchId === undefined ? {} : { targetBranchId: resolution.targetBranchId }),
  selectedTargetIds: [...resolution.selectedTargetIds],
  sheetReads: cloneJson(resolution.sheetReads),
  rollLedger: cloneJson(resolution.rollLedger),
  auditTrace: cloneJson(resolution.auditTrace),
  script: cloneJson(resolution.script),
  transaction: cloneMoveAutomationTransaction(resolution.transaction),
  ...(resolution.feedback === undefined ? {} : { feedback: cloneJson(resolution.feedback) }),
  ...(resolution.desiredFacing === undefined ? {} : { desiredFacing: resolution.desiredFacing }),
  ...(resolution.area === undefined ? {} : { area: cloneJson(resolution.area) }),
  ...(resolution.movement === undefined ? {} : { movement: cloneJson(resolution.movement) }),
  ...(resolution.resourceMovement === undefined
    ? {}
    : { resourceMovement: cloneJson(resolution.resourceMovement) }),
  ...(resolution.switchTransition === undefined
    ? {}
    : { switchTransition: cloneJson(resolution.switchTransition) }),
  ...(resolution.terrainConditionProtectionEffects === undefined
    ? {}
    : { terrainConditionProtectionEffects: cloneJson(
        resolution.terrainConditionProtectionEffects,
      ) }),
})

const cloneUsageSummary = (usage: UseMoveUsageSummary): UseMoveUsageSummary => cloneJson(usage)

const ensureSheetAccumulator = (
  accumulators: Map<string, SheetAccumulator>,
  placement: SheetPlacement,
  pokemonSheets: ReadonlyMap<string, CharacterSheet>,
  trainerSheets: ReadonlyMap<string, TrainerSheet>,
): SheetAccumulator => {
  const key = sheetIdentity(placement)
  const existing = accumulators.get(key)
  if (existing) return existing

  const sheet = getSheetForPlacement(placement, pokemonSheets, trainerSheets)
    ?? fail(
      'not-found',
      'transaction-sheet-missing',
      `Placement ${placement.id} references missing sheet ${placement.sheetKind}/${placement.sheetSlug}.`,
    )

  const previous = cloneJson(sheet)
  const accumulator: SheetAccumulator = {
    kind: placement.sheetKind,
    slug: placement.sheetSlug,
    previous,
    current: cloneJson(sheet),
    placementIds: new Set<string>(),
    changedFields: new Set<AuthoritativeMoveSheetChangedField>(),
    contributions: new Map<string, SheetMutation[]>(),
  }
  accumulators.set(key, accumulator)
  return accumulator
}

const withAuthoritativeSlug = <TSheet extends SheetDocument>(sheet: TSheet, slug: string): TSheet => ({
  ...sheet,
  slug,
})

const recordSheetMutation = (
  accumulators: Map<string, SheetAccumulator>,
  placement: SheetPlacement,
  pokemonSheets: ReadonlyMap<string, CharacterSheet>,
  trainerSheets: ReadonlyMap<string, TrainerSheet>,
  mutation: SheetMutation,
): void => {
  const accumulator = ensureSheetAccumulator(accumulators, placement, pokemonSheets, trainerSheets)
  accumulator.placementIds.add(placement.id)
  const contributions = accumulator.contributions.get(placement.id) ?? []
  accumulator.contributions.set(placement.id, [...contributions, mutation])

  const before = accumulator.current
  const after = withAuthoritativeSlug(mutation.apply(accumulator.current), accumulator.slug)
  accumulator.current = after
  if (!sameJsonValue(before, after)) accumulator.changedFields.add(mutation.field)
}

const assertSharedSheetContributionsAreCompatible = (accumulators: Iterable<SheetAccumulator>): void => {
  for (const accumulator of accumulators) {
    if (accumulator.contributions.size <= 1) continue

    let expectedSignature: string | null = null
    let expectedPlacementId = ''
    for (const [placementId, mutations] of accumulator.contributions.entries()) {
      let projected: SheetDocument = cloneJson(accumulator.previous)
      for (const mutation of mutations) projected = withAuthoritativeSlug(mutation.apply(projected), accumulator.slug)
      const signature = stableJsonStringify(projected)
      if (expectedSignature === null) {
        expectedSignature = signature
        expectedPlacementId = placementId
        continue
      }
      if (signature !== expectedSignature) {
        fail(
          'conflict',
          'conflicting-shared-sheet-updates',
          `Move effects for placements ${expectedPlacementId} and ${placementId} both target ${accumulator.kind}/${accumulator.slug} but produce conflicting sheet states.`,
        )
      }
    }
  }
}

const sheetWritePlans = (
  accumulators: Iterable<SheetAccumulator>,
  plannedAt: number,
): AuthoritativeMoveSheetWritePlan[] => {
  const accumulatorList = [...accumulators]
  assertSharedSheetContributionsAreCompatible(accumulatorList)
  const plans: AuthoritativeMoveSheetWritePlan[] = []
  for (const accumulator of accumulatorList) {
    const previous = withAuthoritativeSlug(cloneJson(accumulator.previous), accumulator.slug)
    const currentBeforeRevision = withAuthoritativeSlug(cloneJson(accumulator.current), accumulator.slug)
    if (sameJsonValue(previous, currentBeforeRevision)) continue

    const expectedRevision = normalizeRevision(previous.revision)
    const revision = nextRevision(expectedRevision)
    const nextSheet = {
      ...currentBeforeRevision,
      revision,
      updatedAt: plannedAt,
    } as unknown as SheetDocument
    plans.push({
      kind: accumulator.kind,
      slug: accumulator.slug,
      expectedRevision,
      revision,
      previousSheet: previous,
      nextSheet: cloneJson(nextSheet),
      placementIds: [...accumulator.placementIds],
      changedFields: [...accumulator.changedFields],
    })
  }
  return plans
}

const validateTransactionUser = (
  resolution: AuthoritativeMoveResolution,
): void => {
  if (resolution.transaction.userId !== resolution.actorPlacementId) {
    fail(
      'conflict',
      'transaction-actor-mismatch',
      `Resolved transaction user ${resolution.transaction.userId} does not match actor placement ${resolution.actorPlacementId}.`,
    )
  }
}

const assertPlacementAllowedForTransaction = (
  placementId: string,
  allowedPlacementIds: ReadonlySet<string>,
  category: string,
): void => {
  if (!allowedPlacementIds.has(placementId)) {
    fail(
      'conflict',
      'transaction-unrelated-placement',
      `Resolved ${category} update references unrelated placement ${placementId}.`,
    )
  }
}

const transactionPlacement = (
  id: string,
  category: string,
  placementsById: ReadonlyMap<string, SheetPlacement>,
  allowedPlacementIds: ReadonlySet<string>,
  pokemonSheets: ReadonlyMap<string, CharacterSheet>,
  trainerSheets: ReadonlyMap<string, TrainerSheet>,
): SheetPlacement => {
  assertPlacementAllowedForTransaction(id, allowedPlacementIds, category)
  const placement = placementsById.get(id)
    ?? fail('not-found', 'transaction-placement-missing', `Resolved ${category} update references missing placement ${id}.`)
  if (!getSheetForPlacement(placement, pokemonSheets, trainerSheets)) {
    fail(
      'not-found',
      'transaction-sheet-missing',
      `Resolved ${category} update references placement ${id} with missing sheet ${placement.sheetKind}/${placement.sheetSlug}.`,
    )
  }
  return placement
}

const applyDailyUsageToActorSheet = (
  transition: PlannedMoveUsageTransition,
  actorPlacement: SheetPlacement,
  accumulators: Map<string, SheetAccumulator>,
  pokemonSheets: ReadonlyMap<string, CharacterSheet>,
  trainerSheets: ReadonlyMap<string, TrainerSheet>,
): void => {
  if (transition.nextSheetMoveUsage === undefined) return
  const nextSheetMoveUsage = cloneJson(transition.nextSheetMoveUsage)
  recordSheetMutation(accumulators, actorPlacement, pokemonSheets, trainerSheets, {
    field: 'moveUsage',
    apply: (sheet) => ({ ...cloneJson(sheet), moveUsage: cloneJson(nextSheetMoveUsage) }),
  })
}

const applyHpUpdate = (
  update: MoveAutomationHpUpdate,
  placement: SheetPlacement,
  accumulators: Map<string, SheetAccumulator>,
  pokemonSheets: ReadonlyMap<string, CharacterSheet>,
  trainerSheets: ReadonlyMap<string, TrainerSheet>,
): void => {
  const currentHp = assertFiniteNumber(update.currentHp, 'invalid-hp-update', `HP update for ${update.id}.currentHp`)
  const injuries = update.injuries === undefined
    ? undefined
    : assertNonNegativeNumber(update.injuries, 'invalid-hp-update', `HP update for ${update.id}.injuries`)
  if (update.temporaryHp !== undefined) {
    assertNonNegativeNumber(update.temporaryHp, 'invalid-hp-update', `HP update for ${update.id}.temporaryHp`)
  }

  recordSheetMutation(accumulators, placement, pokemonSheets, trainerSheets, {
    field: 'hp',
    apply: (sheet) => applyHpToSheet(placement.sheetKind, sheet as AnyLiveSheet, currentHp, injuries) as SheetDocument,
  })
}

const applyCombatStageUpdate = (
  update: MoveAutomationCombatStageUpdate,
  placement: SheetPlacement,
  accumulators: Map<string, SheetAccumulator>,
  pokemonSheets: ReadonlyMap<string, CharacterSheet>,
  trainerSheets: ReadonlyMap<string, TrainerSheet>,
): void => {
  recordSheetMutation(accumulators, placement, pokemonSheets, trainerSheets, {
    field: 'combatStages',
    apply: (sheet) => applyCombatStagesToSheet(placement.sheetKind, sheet as AnyLiveSheet, cloneJson(update.stages) as CombatStageMap) as SheetDocument,
  })
}

const applyConditionUpdate = (
  update: MoveAutomationConditionUpdate,
  placement: SheetPlacement,
  accumulators: Map<string, SheetAccumulator>,
  pokemonSheets: ReadonlyMap<string, CharacterSheet>,
  trainerSheets: ReadonlyMap<string, TrainerSheet>,
): void => {
  if (!Array.isArray(update.conditions) || update.conditions.some((condition) => typeof condition !== 'string')) {
    fail('invalid', 'invalid-condition-update', `Condition update for ${update.id} must contain condition strings.`)
  }
  recordSheetMutation(accumulators, placement, pokemonSheets, trainerSheets, {
    field: 'conditions',
    apply: (sheet) => applyConditionsToSheet(placement.sheetKind, sheet as AnyLiveSheet, [...update.conditions]) as SheetDocument,
  })
}

const applyTemporaryHpUpdateToMap = (map: TabletopMap, update: MoveAutomationHpUpdate): TabletopMap => {
  if (update.temporaryHp === undefined) return map
  return mapWithTemporaryHpForPlacement(map, update.id, update.temporaryHp)
}

const applyHazardsToMap = (map: TabletopMap, transaction: MoveAutomationTransaction): TabletopMap => {
  let next = map
  for (const hazard of transaction.hazardsToAdd) {
    const result = applyMapHazardPlacement({
      hazards: next.hazards ?? [],
      hazard,
      dimensions: next.dimensions,
    })
    if (!result.ok) fail('invalid', 'invalid-generated-hazard', result.message)
    else next = { ...next, hazards: [...result.hazards] }
  }
  return next
}

const applyFieldEffectsToMap = (
  map: TabletopMap,
  transaction: MoveAutomationTransaction,
  actorPlacement: SheetPlacement,
): TabletopMap => {
  let next = map
  for (const [index, effect] of transaction.fieldEffectsToApply.entries()) {
    const legacy = applyMoveFieldEffectToFieldEffects(next.fieldEffects, effect)
    if (legacy.ok === false) {
      return fail('invalid', 'invalid-generated-field-effect', legacy.message)
    }
    const projectedFieldEffects = legacy.fieldEffects
    let rounds: number | null | undefined
    let startsNextRound: boolean | undefined
    if (effect.kind === 'weather') {
      rounds = projectedFieldEffects.weather?.find(item => item.kind === effect.value)?.rounds
    }
    else if (effect.kind === 'terrain') {
      rounds = projectedFieldEffects.terrains?.find(item => item.kind === effect.value)?.rounds
    }
    else {
      const projected = projectedFieldEffects.rooms?.find(item => item.kind === effect.value)
      rounds = projected?.rounds
      startsNextRound = projected?.startsNextRound
    }
    if (rounds === undefined) {
      return fail(
        'invalid',
        'invalid-generated-field-effect',
        `Generated ${effect.kind} field ${effect.value} could not be projected.`,
      )
    }
    const applied = applyMapGlobalField({
      map: next,
      kind: effect.kind,
      fieldId: effect.value,
      source: {
        kind: 'operation',
        operationId: `legacy-v1.field.${index + 1}`,
        moveId: null,
        placementId: actorPlacement.id,
      },
      sideId: actorPlacement.sideId ?? null,
      duration: rounds === null
        ? { kind: 'permanent', remaining: null }
        : { kind: 'rounds', boundary: 'end', remaining: rounds },
      replacementGroup: effect.kind === 'weather'
        ? 'field.weather'
        : `field.${effect.kind}.${effect.value}`,
      replacementScope: effect.kind === 'weather' ? 'category' : 'kind',
      startsNextRound: effect.kind === 'room' ? startsNextRound : undefined,
      sourceLabel: effect.source,
    })
    next = applied.map
  }
  return next
}

const applyTerrainConditionProtectionEffectsToMap = (
  map: TabletopMap,
  effects: AuthoritativeMoveResolution['terrainConditionProtectionEffects'],
): TabletopMap => {
  if (!effects || effects.length === 0) return map
  let encounterState = parseEncounterState(
    map.encounterState ?? createEmptyEncounterState(),
  )
  for (const effect of effects) {
    const result = applyEncounterEffectLifecycleEvent(
      { effects: encounterState.effects },
      { kind: 'effect-applied', effect },
    )
    encounterState = parseEncounterState({
      ...encounterState,
      effects: result.effects,
    })
  }
  return { ...map, encounterState }
}

const planUsage = (
  input: PlanAuthoritativeMoveStateInput,
  actorPlacement: SheetPlacement,
  actorSheet: SheetDocument,
  resolution: AuthoritativeMoveResolution,
  plannedAt: number,
): PlannedMoveUsageTransition => {
  try {
    return planMoveUsageTransition({
      map: input.map,
      sheetMoveUsage: actorSheet.moveUsage,
      placementId: actorPlacement.id,
      move: {
        moveName: resolution.canonicalMoveName,
        moveKey: resolution.moveKey,
        frequency: resolution.frequency,
      },
      usedAt: plannedAt,
    })
  } catch (error) {
    if (isMoveUsageTransitionError(error)) {
      fail('conflict', 'usage-state-inconsistency', error.message, error)
    }
    throw error
  }
}

const withoutPlanIdentity = (
  change: MoveStateChangePlan['changes'][number],
): MoveStateChangeInput => {
  const { id: _id, order: _order, ...input } = change
  return input as MoveStateChangeInput
}

const reviewedMoveResourceCosts = (
  input: Pick<
    PlanAuthoritativeMoveStateInput,
    'runtimeRegistry' | 'resourceCostDeclarations'
  >,
  canonicalMoveId: string,
) => {
  if (input.resourceCostDeclarations !== undefined) {
    return input.resourceCostDeclarations
  }
  const runtime = (input.runtimeRegistry ?? MOVE_AUTOMATION_RUNTIME_REGISTRY)
    .resolve(canonicalMoveId)
  return runtime?.kind === 'movespec-v2' ? runtime.definition.spec.costs : undefined
}

const resourcePlanningFailure = (
  moveName: string,
  phase: 'immediate' | 'pending' | 'resumed',
  error: EncounterResourceReductionError,
): never => fail(
  'conflict',
  'move-resource-unavailable',
  `${moveName} cannot pay its ${phase} authoritative resources (${error.code}): ${error.message}`,
  error,
)

export const observeMovePlanResources = (input: {
  readonly planningInput: PlanAuthoritativeMoveStateInput
  readonly resolution: AuthoritativeMoveResolution
  readonly nextMap: TabletopMap
  readonly previousRevision: number
  readonly stateChanges: MoveStateChangePlan
  readonly resolutionId?: string
  readonly minimumCostPhaseExclusive?: import('#shared/moveAutomation/spec').MoveSpecPhase | null
  readonly maximumCostPhaseInclusive?: import('#shared/moveAutomation/spec').MoveSpecPhase | null
  readonly allowLegacyCostFallback?: boolean
  readonly prerequisiteResources?: EncounterTurnResourceDirectory
}): {
  readonly nextMap: TabletopMap
  readonly mapChanges: AuthoritativeMoveMapChanges
  readonly stateChanges: MoveStateChangePlan
} => {
  if (!input.planningInput.map.placements.some(
    placement => placement.id === input.resolution.actorPlacementId,
  )) {
    fail(
      'not-found',
      'actor-placement-missing',
      `Actor placement ${input.resolution.actorPlacementId} was not found while planning resources.`,
    )
  }
  const sourceOperationId = input.planningInput.operationId
    ?? `move.${input.resolution.moveKey}.resource-spend`
  let observation: ReturnType<typeof planMoveResourceObservation>
  try {
    observation = planMoveResourceObservation({
      map: input.nextMap,
      resolution: input.resolution,
      sourceOperationId,
      resolutionId: input.resolutionId,
      reviewedCosts: reviewedMoveResourceCosts(
        input.planningInput,
        input.resolution.canonicalMoveName,
      ),
      minimumPhaseExclusive: input.minimumCostPhaseExclusive,
      maximumPhaseInclusive: input.maximumCostPhaseInclusive,
      allowLegacyFallback: input.allowLegacyCostFallback,
      prerequisiteResources: input.prerequisiteResources,
    })
  }
  catch (error) {
    if (error instanceof EncounterResourceReductionError) {
      return resourcePlanningFailure(
        input.resolution.canonicalMoveName,
        input.minimumCostPhaseExclusive === undefined
          || input.minimumCostPhaseExclusive === null
          ? 'immediate'
          : 'resumed',
        error,
      )
    }
    throw error
  }
  if (!observation.changed) {
    return {
      nextMap: cloneJson(input.nextMap),
      mapChanges: buildAuthoritativeMoveMapChanges(
        input.planningInput.map,
        input.nextMap,
      ),
      stateChanges: input.stateChanges,
    }
  }

  const previousEncounterState = parseEncounterState(
    input.planningInput.map.encounterState ?? createEmptyEncounterState(),
  )
  const existingInputs = input.stateChanges.changes
    .filter(change => change.kind !== 'encounter-state')
    .map(withoutPlanIdentity)
  const existingEncounterChange = input.stateChanges.changes.find(
    change => change.kind === 'encounter-state',
  )
  const stateChanges = createMoveStateChangePlan([
    ...existingInputs,
    {
      kind: 'encounter-state',
      scope: { kind: 'encounter', mapSlug: input.planningInput.map.slug },
      expectedRevision: input.previousRevision,
      sourceOperationId: existingEncounterChange ? null : sourceOperationId,
      reasonCode: existingEncounterChange
        ? 'move-and-resource-state'
        : 'move-resource-spend',
      previous: existingEncounterChange
        ? cloneJson(existingEncounterChange.previous as EncounterState)
        : cloneJson(previousEncounterState),
      current: cloneJson(observation.currentEncounterState),
      compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
    } satisfies MoveStateChangeInput<EncounterState>,
  ])
  const nextMap = cloneJson(observation.nextMap)
  return {
    nextMap,
    mapChanges: buildAuthoritativeMoveMapChanges(input.planningInput.map, nextMap),
    stateChanges,
  }
}

export const planPendingMoveResourceCosts = (options: {
  readonly input: PlanAuthoritativeMoveStateInput
  readonly execution: AuthoritativePendingMoveResolution
  readonly existingPlan: MoveStateChangePlan
  readonly resolutionId: string
  readonly minimumPhaseExclusive?: import('#shared/moveAutomation/spec').MoveSpecPhase | null
  readonly prerequisiteResources?: EncounterTurnResourceDirectory
}): MoveStateChangePlan => {
  const reviewedCosts = options.execution.runtime.definition.spec.costs
  if (reviewedCosts.length === 0) return options.existingPlan

  const mapAfterExistingPlan = applyNativeCoreMapChanges(
    options.input.map,
    options.existingPlan,
  )
  let observation: ReturnType<typeof planEncounterMoveResourceCosts>
  try {
    observation = planEncounterMoveResourceCosts({
      map: mapAfterExistingPlan,
      placementId: options.execution.actorPlacementId,
      canonicalMoveId: options.execution.canonicalMoveName,
      moveKey: options.execution.moveKey,
      range: options.execution.resourceRange,
      resolutionId: options.resolutionId,
      sourceOperationId: options.input.operationId
        ?? options.execution.execution.request.operationId,
      movement: options.execution.resourceMovement ?? null,
      reviewedCosts,
      allowLegacyFallback: false,
      minimumPhaseExclusive: options.minimumPhaseExclusive,
      maximumPhaseInclusive: options.execution.execution.request.phase,
      prerequisiteResources: options.prerequisiteResources,
    })
  }
  catch (error) {
    if (error instanceof EncounterResourceReductionError) {
      return resourcePlanningFailure(
        options.execution.canonicalMoveName,
        'pending',
        error,
      )
    }
    throw error
  }
  if (!observation.changed) return options.existingPlan

  const existingEncounterChange = options.existingPlan.changes.find(
    change => change.kind === 'encounter-state',
  )
  const nonEncounterInputs = options.existingPlan.changes
    .filter(change => change.kind !== 'encounter-state')
    .map(change => withoutPlanIdentity(change) as MoveStateChangeInput<EncounterState>)
  return createMoveStateChangePlan<EncounterState>([
    ...nonEncounterInputs,
    {
      kind: 'encounter-state',
      scope: { kind: 'encounter', mapSlug: options.input.map.slug },
      expectedRevision: normalizeRevision(options.input.map.revision),
      sourceOperationId: existingEncounterChange
        ? null
        : observation.spends[0]?.costId
          ?? options.execution.execution.request.operationId,
      reasonCode: existingEncounterChange
        ? 'move-declaration-and-resource-costs'
        : 'move-declaration-resource-costs',
      previous: cloneJson(
        existingEncounterChange?.previous as EncounterState | undefined
          ?? parseEncounterState(
            options.input.map.encounterState ?? createEmptyEncounterState(),
          ),
      ),
      current: cloneJson(observation.currentEncounterState),
      compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
    },
  ])
}

const planPendingMoveState = (options: {
  readonly input: PlanAuthoritativeMoveStateInput
  readonly execution: AuthoritativePendingMoveResolution
  readonly plannedAt: number
  readonly previousMap: TabletopMap
  readonly previousRevision: number
}): AuthoritativePendingMoveStatePlan => {
  const operationId = options.input.operationId
    ?? fail(
      'invalid',
      'pending-origin-operation-missing',
      'A suspended move requires its originating live-play operation ID.',
    )
  const resolutionId = options.input.pendingResolutionId
    ?? fail(
      'invalid',
      'pending-resolution-id-missing',
      'A suspended move requires a deterministic pending resolution ID.',
    )
  const sheetReads = reobserveAuthoritativeMoveSheetReads(
    [
      ...options.execution.sheetReads,
      ...(options.input.itemResources?.sheetReads ?? []),
    ],
    options.input.pokemonSheets,
    options.input.trainerSheets,
  )
  const groupInventoryReads = deduplicateAuthoritativeMoveGroupInventoryReads(
    options.input.itemResources?.groupInventoryReads ?? [],
  )
  const request = options.execution.execution.request
  const revision = nextRevision(options.previousRevision)
  const preWindowPlan = planPendingMoveResourceCosts({
    input: options.input,
    execution: options.execution,
    existingPlan: options.execution.preWindowPlan,
    resolutionId,
  })
  const suspension = materializeMoveSpecSuspension({
    resolutionId,
    originOpId: operationId,
    definition: options.execution.runtime.definition,
    originMapSlug: options.input.map.slug,
    originMapRevision: options.previousRevision,
    authoritativeMap: options.input.map,
    actorPlacementId: options.execution.actorPlacementId,
    suspendedAt: options.plannedAt,
    authoritativeSheetReads: sheetReads,
    authoritativeGroupInventoryReads: groupInventoryReads,
    execution: options.execution.execution,
    continuationMapRevision: revision,
    preWindowPlan,
  })
  const pendingResolution = suspension.pendingResolution

  const previousEncounterState = parseEncounterState(
    options.input.map.encounterState ?? createEmptyEncounterState(),
  )
  const mapAfterPreWindowPlan = applyNativeCoreMapChanges(
    options.input.map,
    suspension.preWindowPlan,
  )
  const preWindowEncounterChange = suspension.preWindowPlan.changes.find(
    change => change.kind === 'encounter-state',
  )
  const encounterStateAfterPreWindowPlan = preWindowEncounterChange
    ? parseEncounterState(preWindowEncounterChange.current)
    : previousEncounterState
  if (encounterStateAfterPreWindowPlan.pendingResolutionSummaries.some(
    summary => summary.resolutionId === resolutionId,
  )) {
    fail(
      'conflict',
      'pending-resolution-summary-conflict',
      `Pending resolution ${resolutionId} is already visible on map ${options.input.map.slug}.`,
    )
  }
  const currentEncounterState = parseEncounterState({
    ...encounterStateAfterPreWindowPlan,
    pendingResolutionSummaries: [
      ...encounterStateAfterPreWindowPlan.pendingResolutionSummaries,
      pendingResolution.publicSummary,
    ],
  })
  const nextMap = cloneJson({
    ...mapAfterPreWindowPlan,
    encounterState: currentEncounterState,
    revision,
    updatedAt: options.plannedAt,
  })
  const preWindowInputs: MoveStateChangeInput<EncounterState>[] = suspension.preWindowPlan
    .changes
    .filter(change => change.kind !== 'encounter-state')
    .map(change => withoutPlanIdentity(change) as MoveStateChangeInput<EncounterState>)
  const stateChanges = createMoveStateChangePlan<EncounterState>([
    ...preWindowInputs,
    {
      kind: 'encounter-state',
      scope: { kind: 'encounter', mapSlug: options.input.map.slug },
      expectedRevision: options.previousRevision,
      sourceOperationId: request.operationId,
      reasonCode: 'move-resolution-suspended',
      previous: cloneJson(previousEncounterState),
      current: cloneJson(currentEncounterState),
      compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
    },
  ])
  const sheetWrites = nativeSheetWritesFromStateChanges(
    options.input.map,
    options.execution,
    stateChanges,
  )

  return {
    kind: 'pending',
    previousMap: options.previousMap,
    nextMap,
    previousRevision: options.previousRevision,
    revision,
    execution: options.execution,
    suspension,
    sheetReads: cloneJson(sheetReads),
    groupInventoryReads: cloneJson(groupInventoryReads),
    sheetWrites,
    mapChanges: buildAuthoritativeMoveMapChanges(options.previousMap, nextMap),
    stateChanges,
  }
}

export const attachAbilityFollowUpsToMovePlan = (input: {
  readonly plan: AuthoritativeMoveStatePlan
  readonly sourceMap: TabletopMap
  readonly pokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly trainerSheets: ReadonlyMap<string, TrainerSheet>
  readonly causalOpId: string | undefined
  readonly createdAt: number
}): AuthoritativeMoveStatePlan => {
  if (!input.causalOpId) return input.plan
  const identity = abilityFollowUpPersistenceIdentity({
    mapSlug: input.plan.nextMap.slug,
    causalOpId: input.causalOpId,
  })
  const pending = materializeAbilityFollowUps({
    resolutionId: identity.resolutionId,
    originOpId: identity.originOpId,
    originMapSlug: input.plan.nextMap.slug,
    continuationMapRevision: input.plan.revision,
    createdAt: input.createdAt,
    resolution: input.plan.resolution,
    map: input.sourceMap,
    pokemonSheets: input.pokemonSheets,
    trainerSheets: input.trainerSheets,
    sheetWrites: input.plan.sheetWrites,
  })
  if (!pending) return input.plan

  const previousEncounter = parseEncounterState(
    input.plan.previousMap.encounterState ?? createEmptyEncounterState(),
  )
  const currentEncounter = parseEncounterState(
    input.plan.nextMap.encounterState ?? createEmptyEncounterState(),
  )
  const nextEncounter = parseEncounterState({
    ...currentEncounter,
    pendingResolutionSummaries: [
      ...currentEncounter.pendingResolutionSummaries.filter(summary => (
        summary.resolutionId !== pending.resolutionId
      )),
      pending.publicSummary,
    ],
  })
  const nextMap = cloneJson({
    ...input.plan.nextMap,
    encounterState: nextEncounter,
  })
  const nonEncounterChanges = input.plan.stateChanges.changes
    .filter(change => change.kind !== 'encounter-state')
    .map(withoutPlanIdentity)
  const existingEncounter = input.plan.stateChanges.changes.find(
    change => change.kind === 'encounter-state',
  )
  const stateChanges = createMoveStateChangePlan([
    ...nonEncounterChanges,
    {
      kind: 'encounter-state',
      scope: { kind: 'encounter', mapSlug: input.plan.nextMap.slug },
      expectedRevision: input.plan.previousRevision,
      sourceOperationId: existingEncounter?.sourceOperationId ?? null,
      reasonCode: 'move-and-ability-follow-up-state',
      previous: cloneJson(existingEncounter?.previous ?? previousEncounter),
      current: cloneJson(nextEncounter),
      compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
    },
  ])
  return {
    ...input.plan,
    nextMap,
    mapChanges: buildAuthoritativeMoveMapChanges(input.plan.previousMap, nextMap),
    stateChanges,
    followUpResolution: pending,
  }
}

export const planAuthoritativeMoveStateExecution = (
  input: PlanAuthoritativeMoveStateInput,
): AuthoritativeMoveStatePlanningResult => {
  const plannedAt = (input.now ?? Date.now)()
  const previousMap = cloneJson(input.map)
  const previousRevision = normalizeRevision(input.map.revision)

  const execution = resolveAuthoritativeMoveExecution({
    map: input.map,
    pokemonSheets: input.pokemonSheets,
    trainerSheets: input.trainerSheets,
    intent: input.intent,
    random: input.random,
    now: () => plannedAt,
    ancestry: input.ancestry,
    tokenPositionOverrides: input.tokenPositionOverrides,
    idFactory: input.idFactory,
    runtimeRegistry: input.runtimeRegistry,
    legacyScripts: input.legacyScripts,
    resourceCostDeclarations: input.resourceCostDeclarations,
    itemResources: input.itemResources,
  })
  if (isAuthoritativePendingMoveResolution(execution)) {
    return planPendingMoveState({
      input,
      execution,
      plannedAt,
      previousMap,
      previousRevision,
    })
  }
  const resolution = execution
  validateTransactionUser(resolution)
  const sheetReads = reobserveAuthoritativeMoveSheetReads(
    [
      ...resolution.sheetReads,
      ...(input.itemResources?.sheetReads ?? []),
    ],
    input.pokemonSheets,
    input.trainerSheets,
  )
  const groupInventoryReads = deduplicateAuthoritativeMoveGroupInventoryReads(
    input.itemResources?.groupInventoryReads ?? [],
  )

  if (resolution.nativeV2) {
    const nativePlan = planNativeV2MoveState({
      map: input.map,
      pokemonSheets: input.pokemonSheets,
      trainerSheets: input.trainerSheets,
      resolution,
      plannedAt,
      operationId: input.operationId,
      maxMoveLogEntries: input.maxMoveLogEntries,
      runtimeRegistry: input.runtimeRegistry,
      legacyScripts: input.legacyScripts,
      existingSheetReads: sheetReads,
    })
    const finalSheetReads = reobserveAuthoritativeMoveSheetReads(
      nativePlan.sheetReads,
      input.pokemonSheets,
      input.trainerSheets,
    )
    const observedResources = observeMovePlanResources({
      planningInput: input,
      resolution,
      nextMap: nativePlan.nextMap,
      previousRevision,
      stateChanges: nativePlan.stateChanges,
    })
    const plan: AuthoritativeMoveStatePlan = {
      previousMap,
      nextMap: observedResources.nextMap,
      previousRevision,
      revision: nativePlan.revision,
      resolution: cloneResolution({
        ...resolution,
        sheetReads: finalSheetReads,
        auditTrace: nativePlan.auditTrace,
      }),
      previousUsage: cloneUsageSummary(nativePlan.previousUsage),
      usage: cloneUsageSummary(nativePlan.usage),
      sheetReads: cloneJson(finalSheetReads),
      groupInventoryReads: cloneJson(groupInventoryReads),
      sheetWrites: nativePlan.sheetWrites,
      mapChanges: observedResources.mapChanges,
      stateChanges: observedResources.stateChanges,
    }
    return attachAbilityFollowUpsToMovePlan({
      plan,
      sourceMap: input.map,
      pokemonSheets: input.pokemonSheets,
      trainerSheets: input.trainerSheets,
      causalOpId: input.operationId,
      createdAt: plannedAt,
    })
  }

  const originalPlacementsById = placementById(input.map)
  const actorPlacement = originalPlacementsById.get(resolution.actorPlacementId)
    ?? fail('not-found', 'actor-placement-missing', `Actor placement ${resolution.actorPlacementId} was not found.`)
  const actorSheet = getSheetForPlacement(actorPlacement, input.pokemonSheets, input.trainerSheets)
    ?? fail('not-found', 'actor-sheet-missing', `Actor sheet ${actorPlacement.sheetKind}/${actorPlacement.sheetSlug} was not found.`)

  const allowedPlacementIds = new Set<string>([resolution.actorPlacementId, ...resolution.selectedTargetIds])
  for (const selectedTargetId of resolution.selectedTargetIds) {
    const placement = originalPlacementsById.get(selectedTargetId)
      ?? fail('not-found', 'target-placement-missing', `Selected target placement ${selectedTargetId} was not found.`)
    if (!getSheetForPlacement(placement, input.pokemonSheets, input.trainerSheets)) {
      fail('not-found', 'target-sheet-missing', `Selected target ${selectedTargetId} has no backing sheet.`)
    }
  }

  const usageTransition = planUsage(input, actorPlacement, actorSheet, resolution, plannedAt)
  const sheetAccumulators = new Map<string, SheetAccumulator>()
  let workingMap = cloneJson(input.map)

  if (usageTransition.nextMapMoveUsage !== undefined) {
    workingMap.moveUsage = cloneJson(usageTransition.nextMapMoveUsage)
  }
  applyDailyUsageToActorSheet(usageTransition, actorPlacement, sheetAccumulators, input.pokemonSheets, input.trainerSheets)

  for (const update of resolution.transaction.hpUpdates) {
    const placement = transactionPlacement(update.id, 'HP', originalPlacementsById, allowedPlacementIds, input.pokemonSheets, input.trainerSheets)
    applyHpUpdate(update, placement, sheetAccumulators, input.pokemonSheets, input.trainerSheets)
    workingMap = applyTemporaryHpUpdateToMap(workingMap, update)
  }

  for (const update of resolution.transaction.combatStageUpdates) {
    const placement = transactionPlacement(update.id, 'combat-stage', originalPlacementsById, allowedPlacementIds, input.pokemonSheets, input.trainerSheets)
    applyCombatStageUpdate(update, placement, sheetAccumulators, input.pokemonSheets, input.trainerSheets)
  }

  for (const update of resolution.transaction.conditionUpdates) {
    const placement = transactionPlacement(update.id, 'condition', originalPlacementsById, allowedPlacementIds, input.pokemonSheets, input.trainerSheets)
    applyConditionUpdate(update, placement, sheetAccumulators, input.pokemonSheets, input.trainerSheets)
  }

  workingMap = applyAuthoritativeMovePlacementTransition({
    map: workingMap,
    actorPlacement,
    movement: resolution.movement,
    desiredFacing: resolution.desiredFacing,
    fail: (code, message) => fail(
      code === 'pass-source-position-mismatch' || code === 'shift-source-position-mismatch'
        ? 'conflict'
        : 'invalid',
      code,
      message,
    ),
  })
  workingMap = applyHazardsToMap(workingMap, resolution.transaction)
  workingMap = applyFieldEffectsToMap(
    workingMap,
    resolution.transaction,
    actorPlacement,
  )
  workingMap = applyTerrainConditionProtectionEffectsToMap(
    workingMap,
    resolution.terrainConditionProtectionEffects,
  )
  workingMap.metadata = appendMoveAutomationLogEntry(workingMap.metadata, resolution.transaction, {
    now: () => plannedAt,
    maxLogEntries: input.maxMoveLogEntries,
    operationId: input.operationId,
  })

  const revision = nextRevision(previousRevision)
  workingMap = {
    ...workingMap,
    revision,
    updatedAt: plannedAt,
  }

  const sheetWrites = sheetWritePlans(sheetAccumulators.values(), plannedAt)
  const nextMap = cloneJson(workingMap)
  const plannedMapChanges = buildAuthoritativeMoveMapChanges(previousMap, nextMap)
  const adaptedTransaction = adaptV1Transaction({
    transaction: resolution.transaction,
    trace: resolution.auditTrace,
    previousMap,
    expectedMapRevision: previousRevision,
    mapChanges: plannedMapChanges,
    sheetWrites,
  })
  const observedResources = observeMovePlanResources({
    planningInput: input,
    resolution,
    nextMap,
    previousRevision,
    stateChanges: adaptedTransaction.stateChanges,
  })

  const plan: AuthoritativeMoveStatePlan = {
    previousMap,
    nextMap: observedResources.nextMap,
    previousRevision,
    revision,
    resolution: cloneResolution({
      ...resolution,
      auditTrace: adaptedTransaction.trace,
    }),
    previousUsage: cloneUsageSummary(usageTransition.previousUsage),
    usage: cloneUsageSummary(usageTransition.usage),
    sheetReads: cloneJson(sheetReads),
    groupInventoryReads: cloneJson(groupInventoryReads),
    sheetWrites,
    mapChanges: observedResources.mapChanges,
    stateChanges: observedResources.stateChanges,
  }
  return attachAbilityFollowUpsToMovePlan({
    plan,
    sourceMap: input.map,
    pokemonSheets: input.pokemonSheets,
    trainerSheets: input.trainerSheets,
    causalOpId: input.operationId,
    createdAt: plannedAt,
  })
}

/** Compatibility boundary for callers that cannot yet return a durable saga. */
export const planAuthoritativeMoveState = (
  input: PlanAuthoritativeMoveStateInput,
): AuthoritativeMoveStatePlan => {
  const result = planAuthoritativeMoveStateExecution(input)
  if (!isAuthoritativePendingMoveStatePlan(result)) return result
  return fail(
    'unsupported',
    'pending-resolution-requires-orchestrator',
    `${result.execution.canonicalMoveName} requires durable pending-resolution orchestration.`,
  )
}

export const isAuthoritativeMoveStatePlanError = (value: unknown): value is AuthoritativeMoveStatePlanError =>
  value instanceof AuthoritativeMoveStatePlanError

export const isAuthoritativeMoveStatePlanningError = (
  value: unknown,
): value is AuthoritativeMoveStatePlanError | AuthoritativeMoveResolutionError =>
  value instanceof AuthoritativeMoveStatePlanError || value instanceof AuthoritativeMoveResolutionError

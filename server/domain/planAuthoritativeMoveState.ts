import { nextRevision, normalizeRevision } from '#shared/sessionRevisions'
import type { ResolveMoveIntent } from '#shared/livePlayMoveResolution'
import type { CharacterSheet } from '~/types/characterSheet'
import type { CombatStageMap } from '~/types/combatStages'
import type {
  GridAnchor,
  MapFieldEffects,
  MapHazardV2,
  SheetKind,
  SheetPlacement,
  TabletopMap,
} from '~/types/map'
import type {
  MoveAutomationCombatStageUpdate,
  MoveAutomationConditionUpdate,
  MoveAutomationHpUpdate,
  MoveAutomationTransaction,
} from '~/types/moveAutomation'
import type { TrainerSheet } from '~/types/trainerSheet'
import { applyMoveFieldEffectToFieldEffects, cloneMapFieldEffects } from '~/utils/mapFieldEffects'
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
  setTokenFacingOnPlacement,
  tokenFacingForPlacement,
  tokenFacingStoresLegacyTurned,
} from '~/utils/tokenFacing'
import {
  AuthoritativeMoveResolutionError,
  deduplicateAuthoritativeMoveSheetReads,
  resolveAuthoritativeMove,
  type AuthoritativeMoveResolution,
  type AuthoritativeMoveSheetRead,
} from './resolveAuthoritativeMove'
import type { AuthoritativeMoveRandomSource } from './moveAutomation/random'
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
  readonly idFactory?: () => string
  readonly maxMoveLogEntries?: number
}

export type AuthoritativeMoveSheetChangedField = 'moveUsage' | 'hp' | 'combatStages' | 'conditions'

export interface AuthoritativeMoveSheetWritePlan {
  readonly kind: SheetKind
  readonly slug: string
  readonly expectedRevision: number
  readonly revision: number
  readonly previousSheet: CharacterSheet | TrainerSheet
  readonly nextSheet: CharacterSheet | TrainerSheet
  readonly placementIds: readonly string[]
  readonly changedFields: readonly AuthoritativeMoveSheetChangedField[]
}

export interface AuthoritativeMoveMapChanges {
  readonly placements?: {
    readonly previous: readonly SheetPlacement[]
    readonly current: readonly SheetPlacement[]
  }
  readonly temporaryHitPoints?: {
    readonly previous: TabletopMap['temporaryHitPoints']
    readonly current: TabletopMap['temporaryHitPoints']
  }
  readonly moveUsage?: {
    readonly previous: TabletopMap['moveUsage']
    readonly current: TabletopMap['moveUsage']
  }
  readonly hazards?: {
    readonly previous: readonly MapHazardV2[]
    readonly current: readonly MapHazardV2[]
  }
  readonly fieldEffects?: {
    readonly previous: MapFieldEffects
    readonly current: MapFieldEffects
  }
  readonly metadata?: {
    readonly previous: Record<string, unknown> | undefined
    readonly current: Record<string, unknown> | undefined
  }
}

export interface AuthoritativeMoveStatePlan {
  readonly previousMap: TabletopMap
  readonly nextMap: TabletopMap
  readonly previousRevision: number
  readonly revision: number
  readonly resolution: AuthoritativeMoveResolution
  readonly usage: UseMoveUsageSummary
  readonly previousUsage: UseMoveUsageSummary
  readonly sheetReads: readonly AuthoritativeMoveSheetRead[]
  readonly sheetWrites: readonly AuthoritativeMoveSheetWritePlan[]
  readonly mapChanges: AuthoritativeMoveMapChanges
}

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

const isSafeGridAnchor = (value: unknown): value is GridAnchor => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Partial<Record<keyof GridAnchor, unknown>>
  return Number.isSafeInteger(record.x)
    && Number.isSafeInteger(record.y)
    && Number.isSafeInteger(record.z)
}

const gridAnchorsEqual = (left: GridAnchor, right: GridAnchor): boolean =>
  left.x === right.x && left.y === right.y && left.z === right.z

const gridAnchorInBounds = (anchor: GridAnchor, map: TabletopMap): boolean =>
  anchor.x >= 0
  && anchor.x < map.dimensions.x
  && anchor.y >= 0
  && anchor.y < map.dimensions.y
  && anchor.z >= 0
  && anchor.z < map.dimensions.z

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

const setActorPlacement = (
  map: TabletopMap,
  actorPlacementId: string,
  update: (placement: SheetPlacement) => SheetPlacement,
): TabletopMap => ({
  ...map,
  placements: map.placements.map((placement) => (
    placement.id === actorPlacementId ? update(cloneJson(placement)) : cloneJson(placement)
  )),
})

const applyFacingToActor = (map: TabletopMap, actorPlacementId: string, facing: AuthoritativeMoveResolution['desiredFacing']): TabletopMap => {
  if (!facing) return map
  return setActorPlacement(map, actorPlacementId, (placement) => {
    const legacyTurned = tokenFacingStoresLegacyTurned(facing)
    if (tokenFacingForPlacement(placement) === facing && placement.turned === legacyTurned) return placement
    setTokenFacingOnPlacement(placement, facing)
    return placement
  })
}

const applyMovementAndFacing = (
  map: TabletopMap,
  originalActorPlacement: SheetPlacement,
  resolution: AuthoritativeMoveResolution,
): TabletopMap => {
  const movement = resolution.movement
  if (movement?.kind === 'pass') {
    if (!gridAnchorsEqual(movement.from, originalActorPlacement.position)) {
      fail(
        'conflict',
        'pass-source-position-mismatch',
        `Pass source ${movement.from.x},${movement.from.y},${movement.from.z} does not match actor position ${originalActorPlacement.position.x},${originalActorPlacement.position.y},${originalActorPlacement.position.z}.`,
      )
    }
    if (!isSafeGridAnchor(movement.destination) || !gridAnchorInBounds(movement.destination, map)) {
      fail('invalid', 'invalid-pass-destination', 'Resolved Pass destination is not a valid map cell.')
    }
    const moved = setActorPlacement(map, resolution.actorPlacementId, (placement) => ({
      ...placement,
      position: cloneJson(movement.destination),
    }))
    return applyFacingToActor(moved, resolution.actorPlacementId, resolution.desiredFacing)
  }

  return applyFacingToActor(map, resolution.actorPlacementId, resolution.desiredFacing)
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

const applyFieldEffectsToMap = (map: TabletopMap, transaction: MoveAutomationTransaction): TabletopMap => {
  let next = map
  for (const effect of transaction.fieldEffectsToApply) {
    const result = applyMoveFieldEffectToFieldEffects(next.fieldEffects, effect)
    if (!result.ok) fail('invalid', 'invalid-generated-field-effect', result.message)
    else next = { ...next, fieldEffects: cloneJson(result.fieldEffects) }
  }
  return next
}

type MutableAuthoritativeMoveMapChanges = {
  -readonly [K in keyof AuthoritativeMoveMapChanges]?: AuthoritativeMoveMapChanges[K]
}

const mapChanges = (previousMap: TabletopMap, nextMap: TabletopMap): AuthoritativeMoveMapChanges => {
  const changes: MutableAuthoritativeMoveMapChanges = {}
  if (!sameJsonValue(previousMap.placements, nextMap.placements)) {
    changes.placements = {
      previous: cloneJson(previousMap.placements),
      current: cloneJson(nextMap.placements),
    }
  }
  if (!sameJsonValue(previousMap.temporaryHitPoints, nextMap.temporaryHitPoints)) {
    changes.temporaryHitPoints = {
      previous: cloneJson(previousMap.temporaryHitPoints),
      current: cloneJson(nextMap.temporaryHitPoints),
    }
  }
  if (!sameJsonValue(previousMap.moveUsage, nextMap.moveUsage)) {
    changes.moveUsage = {
      previous: cloneJson(previousMap.moveUsage),
      current: cloneJson(nextMap.moveUsage),
    }
  }
  if (!sameJsonValue(previousMap.hazards ?? [], nextMap.hazards ?? [])) {
    changes.hazards = {
      previous: cloneJson(previousMap.hazards ?? []),
      current: cloneJson(nextMap.hazards ?? []),
    }
  }
  if (!sameJsonValue(cloneMapFieldEffects(previousMap.fieldEffects), cloneMapFieldEffects(nextMap.fieldEffects))) {
    changes.fieldEffects = {
      previous: cloneMapFieldEffects(previousMap.fieldEffects),
      current: cloneMapFieldEffects(nextMap.fieldEffects),
    }
  }
  if (!sameJsonValue(previousMap.metadata, nextMap.metadata)) {
    changes.metadata = {
      previous: cloneJson(previousMap.metadata),
      current: cloneJson(nextMap.metadata),
    }
  }
  return changes
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

export const planAuthoritativeMoveState = (input: PlanAuthoritativeMoveStateInput): AuthoritativeMoveStatePlan => {
  const plannedAt = (input.now ?? Date.now)()
  const previousMap = cloneJson(input.map)
  const previousRevision = normalizeRevision(input.map.revision)

  const resolution = resolveAuthoritativeMove({
    map: input.map,
    pokemonSheets: input.pokemonSheets,
    trainerSheets: input.trainerSheets,
    intent: input.intent,
    random: input.random,
    now: () => plannedAt,
    idFactory: input.idFactory,
  })
  validateTransactionUser(resolution)
  const sheetReads = reobserveAuthoritativeMoveSheetReads(
    resolution.sheetReads,
    input.pokemonSheets,
    input.trainerSheets,
  )

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

  workingMap = applyMovementAndFacing(workingMap, actorPlacement, resolution)
  workingMap = applyHazardsToMap(workingMap, resolution.transaction)
  workingMap = applyFieldEffectsToMap(workingMap, resolution.transaction)
  workingMap.metadata = appendMoveAutomationLogEntry(workingMap.metadata, resolution.transaction, {
    now: () => plannedAt,
    maxLogEntries: input.maxMoveLogEntries,
  })

  const revision = nextRevision(previousRevision)
  workingMap = {
    ...workingMap,
    revision,
    updatedAt: plannedAt,
  }

  const sheetWrites = sheetWritePlans(sheetAccumulators.values(), plannedAt)
  const nextMap = cloneJson(workingMap)

  return {
    previousMap,
    nextMap,
    previousRevision,
    revision,
    resolution: cloneResolution(resolution),
    previousUsage: cloneUsageSummary(usageTransition.previousUsage),
    usage: cloneUsageSummary(usageTransition.usage),
    sheetReads: cloneJson(sheetReads),
    sheetWrites,
    mapChanges: mapChanges(previousMap, nextMap),
  }
}

export const isAuthoritativeMoveStatePlanError = (value: unknown): value is AuthoritativeMoveStatePlanError =>
  value instanceof AuthoritativeMoveStatePlanError

export const isAuthoritativeMoveStatePlanningError = (
  value: unknown,
): value is AuthoritativeMoveStatePlanError | AuthoritativeMoveResolutionError =>
  value instanceof AuthoritativeMoveStatePlanError || value instanceof AuthoritativeMoveResolutionError

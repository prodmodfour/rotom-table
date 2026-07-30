import {
  createEmptyEncounterState,
  parseEncounterState,
  type EncounterState,
} from '#shared/moveAutomation/encounterState'
import type {
  LivePlayMoveCorrectionResourceChange,
} from '#shared/moveAutomation/correctionCommands'
import type {
  LivePlayMoveSheetChangedField,
  LivePlayMoveSheetChangeRef,
  LivePlayMoveStatePatchChanges,
} from '#shared/livePlayMoveState'
import { nextRevision, normalizeRevision } from '#shared/sessionRevisions'
import type { CharacterSheet } from '~/types/characterSheet'
import type { CombatStageMap } from '~/types/combatStages'
import type { SheetKind, SheetPlacement, TabletopMap } from '~/types/map'
import type { SheetMoveUsageState } from '~/types/moveUsage'
import type { TrainerSheet } from '~/types/trainerSheet'
import { normalizeCombatStages } from '~/utils/combatStages'
import { deepCloneJson, sameJsonValue } from '~/utils/serialization'
import { sheetConditionNames } from '~/utils/sheetConditions'
import {
  applyCombatStagesToSheet,
  applyConditionsToSheet,
  applyHpToSheet,
  type AnyLiveSheet,
} from '~/utils/sheetMutations'
import { pokemonHpSnapshot, trainerHpSnapshot } from '~/utils/sheetSpawn'
import {
  CapabilityHpStateReconciliationError,
  capabilityHpSheetKey,
  reconcileCapabilityHpState,
} from '../capabilityAutomation/reconcileHpState'
import {
  ACCEPTED_MOVE_COMPENSATION_MAX_OPERATIONS,
  type AcceptedMoveAvailableCompensationOperation,
  type AcceptedMoveSheetHpValue,
  type AcceptedMoveTypedInverseOperation,
} from './acceptedMoveCompensation'

export type AcceptedMoveCorrectionPlanErrorCode =
  | 'invalid-operation'
  | 'duplicate-target'
  | 'missing-resource'
  | 'resource-revision-conflict'
  | 'current-value-conflict'
  | 'invalid-restored-value'
  | 'capability-invariant-conflict'

export class AcceptedMoveCorrectionPlanError extends Error {
  readonly code: AcceptedMoveCorrectionPlanErrorCode

  constructor(code: AcceptedMoveCorrectionPlanErrorCode, message: string) {
    super(message)
    this.name = 'AcceptedMoveCorrectionPlanError'
    this.code = code
  }
}

export interface AcceptedMoveCorrectionSheetSnapshot {
  readonly kind: SheetKind
  readonly slug: string
  readonly revision: number
  readonly sheet: Readonly<Record<string, unknown>>
}

export interface AcceptedMoveCorrectionSheetRead {
  readonly kind: SheetKind
  readonly slug: string
  readonly revision: number
}

export interface AcceptedMoveCorrectionSheetWrite {
  readonly kind: SheetKind
  readonly slug: string
  readonly expectedRevision: number
  readonly revision: number
  readonly nextSheet: Readonly<Record<string, unknown>>
  readonly placementIds: readonly string[]
  readonly changedFields: readonly LivePlayMoveSheetChangedField[]
}

export interface AcceptedMoveCorrectionPlan {
  readonly previousMap: TabletopMap
  readonly nextMap: TabletopMap
  readonly previousRevision: number
  readonly revision: number
  readonly operationIds: readonly string[]
  readonly mapChanges: LivePlayMoveStatePatchChanges
  /** Every sheet whose revision contributed to Capability HP reconciliation. */
  readonly sheetReads: readonly AcceptedMoveCorrectionSheetRead[]
  readonly sheetWrites: readonly AcceptedMoveCorrectionSheetWrite[]
  readonly sheetRefs: readonly LivePlayMoveSheetChangeRef[]
  readonly resourceChanges: readonly LivePlayMoveCorrectionResourceChange[]
}

export interface PlanAcceptedMoveCorrectionInput {
  readonly map: TabletopMap
  readonly sheets: ReadonlyMap<string, AcceptedMoveCorrectionSheetSnapshot>
  readonly operations: readonly AcceptedMoveAvailableCompensationOperation[]
  readonly updatedAt: number
}

type SheetWorkingState = {
  readonly source: AcceptedMoveCorrectionSheetSnapshot
  current: AnyLiveSheet
  readonly changedFields: Set<LivePlayMoveSheetChangedField>
}

const fail = (
  code: AcceptedMoveCorrectionPlanErrorCode,
  message: string,
): never => {
  throw new AcceptedMoveCorrectionPlanError(code, message)
}

const sheetKey = capabilityHpSheetKey

const encounterStateForMap = (map: TabletopMap): EncounterState => parseEncounterState(
  map.encounterState ?? createEmptyEncounterState(),
)

const sheetHpValue = (
  kind: SheetKind,
  sheet: AnyLiveSheet,
): AcceptedMoveSheetHpValue => {
  const snapshot = kind === 'pokemon'
    ? pokemonHpSnapshot(sheet as CharacterSheet)
    : trainerHpSnapshot(sheet as TrainerSheet)
  return { currentHp: snapshot.currentHp, injuries: snapshot.injuries }
}

const sheetCombatStages = (
  kind: SheetKind,
  sheet: AnyLiveSheet,
): CombatStageMap => {
  const snapshot = kind === 'pokemon'
    ? pokemonHpSnapshot(sheet as CharacterSheet)
    : trainerHpSnapshot(sheet as TrainerSheet)
  return normalizeCombatStages(snapshot.combatStages)
}

const sheetMoveUsage = (sheet: AnyLiveSheet): SheetMoveUsageState | null => (
  sheet.moveUsage === undefined ? null : deepCloneJson(sheet.moveUsage)
)

const placementFor = (map: TabletopMap, placementId: string): SheetPlacement | null => (
  map.placements.find(placement => placement.id === placementId) ?? null
)

const currentInverseValue = (input: {
  readonly inverse: AcceptedMoveTypedInverseOperation
  readonly map: TabletopMap
  readonly sheets: ReadonlyMap<string, AcceptedMoveCorrectionSheetSnapshot>
}): unknown => {
  const inverse = input.inverse
  if (inverse.kind === 'restore-map-temporary-hit-points') {
    return deepCloneJson(input.map.temporaryHitPoints ?? null)
  }
  if (inverse.kind === 'restore-map-move-usage') {
    return deepCloneJson(input.map.moveUsage ?? null)
  }
  if (inverse.kind === 'restore-map-hazards') return deepCloneJson(input.map.hazards ?? [])
  if (inverse.kind === 'restore-map-field-effects') return deepCloneJson(input.map.fieldEffects ?? {})
  if (inverse.kind === 'restore-placement-state') {
    return deepCloneJson(placementFor(input.map, inverse.scope.placementId))
  }
  if (inverse.kind.startsWith('restore-encounter-')) {
    const encounter = encounterStateForMap(input.map)
    if (inverse.kind === 'restore-encounter-sides') return deepCloneJson(encounter.sides)
    if (inverse.kind === 'restore-encounter-effects') return deepCloneJson(encounter.effects)
    if (inverse.kind === 'restore-encounter-counters') return deepCloneJson(encounter.counters)
    if (inverse.kind === 'restore-encounter-turn-resources') return deepCloneJson(encounter.turnResources)
    return deepCloneJson(encounter.zones)
  }

  if (inverse.scope.kind !== 'sheet') {
    return fail('invalid-operation', `Correction operation ${inverse.kind} must target a sheet.`)
  }
  const stored = input.sheets.get(sheetKey(inverse.scope.sheetKind, inverse.scope.sheetSlug))
  if (!stored) {
    return fail(
      'missing-resource',
      `Affected ${inverse.scope.sheetKind} sheet ${inverse.scope.sheetSlug} is unavailable.`,
    )
  }
  const sheet = stored.sheet as unknown as AnyLiveSheet
  if (inverse.kind === 'restore-sheet-hp') return sheetHpValue(stored.kind, sheet)
  if (inverse.kind === 'restore-sheet-combat-stages') return sheetCombatStages(stored.kind, sheet)
  if (inverse.kind === 'restore-sheet-conditions') {
    return sheetConditionNames(stored.kind, sheet as CharacterSheet | TrainerSheet)
  }
  return sheetMoveUsage(sheet)
}

const assertResourceRevision = (input: {
  readonly operation: AcceptedMoveAvailableCompensationOperation
  readonly map: TabletopMap
  readonly sheets: ReadonlyMap<string, AcceptedMoveCorrectionSheetSnapshot>
}): void => {
  const resource = input.operation.resource
  if (resource.kind === 'map') {
    if (resource.mapSlug !== input.map.slug) {
      fail('invalid-operation', `Correction operation ${input.operation.operationId} belongs to another map.`)
    }
    if (normalizeRevision(input.map.revision) !== resource.afterRevision) {
      fail(
        'resource-revision-conflict',
        `Map ${input.map.slug} changed after the accepted move; correction cannot overwrite it.`,
      )
    }
    return
  }
  if (resource.kind === 'sheet') {
    const stored = input.sheets.get(sheetKey(resource.sheetKind, resource.sheetSlug))
    if (!stored) {
      return fail('missing-resource', `Affected ${resource.sheetKind} sheet ${resource.sheetSlug} is unavailable.`)
    }
    if (stored.revision !== resource.afterRevision) {
      fail(
        'resource-revision-conflict',
        `${resource.sheetKind} sheet ${resource.sheetSlug} changed after the accepted move.`,
      )
    }
    return
  }
  fail(
    'invalid-operation',
    `Correction operation ${input.operation.operationId} targets an unsupported external resource.`,
  )
}

const inverseTargetKey = (inverse: AcceptedMoveTypedInverseOperation): string => {
  if (inverse.scope.kind === 'map' || inverse.scope.kind === 'encounter') {
    return `${inverse.scope.kind}:${inverse.scope.mapSlug}:${inverse.kind}`
  }
  if (inverse.scope.kind === 'placement') {
    return `placement:${inverse.scope.mapSlug}:${inverse.scope.placementId}`
  }
  if (inverse.scope.kind === 'sheet') {
    return `sheet:${inverse.scope.sheetKind}:${inverse.scope.sheetSlug}:${inverse.kind}`
  }
  return fail('invalid-operation', `Correction inverse ${inverse.kind} has an unsupported scope.`)
}

const assertOperationsAgainstSnapshot = (input: PlanAcceptedMoveCorrectionInput): void => {
  if (input.operations.length === 0) {
    fail('invalid-operation', 'A correction must select at least one typed inverse operation.')
  }
  if (input.operations.length > ACCEPTED_MOVE_COMPENSATION_MAX_OPERATIONS) {
    fail(
      'invalid-operation',
      `A correction may select at most ${ACCEPTED_MOVE_COMPENSATION_MAX_OPERATIONS} typed inverse operations.`,
    )
  }
  if (!Number.isSafeInteger(input.updatedAt) || input.updatedAt < 0) {
    fail('invalid-operation', 'Correction updatedAt must be a safe non-negative timestamp.')
  }
  const operationIds = new Set<string>()
  const targets = new Set<string>()
  for (const operation of input.operations) {
    if (operationIds.has(operation.operationId)) {
      fail('invalid-operation', `Correction operation ${operation.operationId} is duplicated.`)
    }
    operationIds.add(operation.operationId)
    const targetKey = inverseTargetKey(operation.inverse)
    if (targets.has(targetKey)) {
      fail('duplicate-target', `Multiple correction operations target ${targetKey}.`)
    }
    targets.add(targetKey)
    assertResourceRevision({ operation, map: input.map, sheets: input.sheets })
    const current = currentInverseValue({
      inverse: operation.inverse,
      map: input.map,
      sheets: input.sheets,
    })
    if (!sameJsonValue(current, operation.inverse.expectedCurrent)) {
      fail(
        'current-value-conflict',
        `The current value for correction operation ${operation.operationId} no longer matches the accepted move result.`,
      )
    }
  }
}

const replacePlacement = (
  map: TabletopMap,
  inverse: Extract<AcceptedMoveTypedInverseOperation, { readonly kind: 'restore-placement-state' }>,
): void => {
  const index = map.placements.findIndex(placement => placement.id === inverse.scope.placementId)
  if (inverse.restore === null) {
    if (index >= 0) map.placements.splice(index, 1)
    return
  }
  const restored = deepCloneJson(inverse.restore)
  if (index >= 0) map.placements.splice(index, 1, restored)
  else map.placements.push(restored)
}

const applyMapInverse = (
  map: TabletopMap,
  inverse: AcceptedMoveTypedInverseOperation,
): boolean => {
  if (inverse.kind === 'restore-map-temporary-hit-points') {
    if (inverse.restore === null) delete map.temporaryHitPoints
    else map.temporaryHitPoints = deepCloneJson(inverse.restore)
    return true
  }
  if (inverse.kind === 'restore-map-move-usage') {
    if (inverse.restore === null) delete map.moveUsage
    else map.moveUsage = deepCloneJson(inverse.restore)
    return true
  }
  if (inverse.kind === 'restore-map-hazards') {
    map.hazards = deepCloneJson([...inverse.restore])
    return true
  }
  if (inverse.kind === 'restore-map-field-effects') {
    map.fieldEffects = deepCloneJson(inverse.restore)
    return true
  }
  if (inverse.kind === 'restore-placement-state') {
    replacePlacement(map, inverse)
    return true
  }
  if (!inverse.kind.startsWith('restore-encounter-')) return false

  const encounter = encounterStateForMap(map)
  if (inverse.kind === 'restore-encounter-sides') {
    map.encounterState = parseEncounterState({ ...encounter, sides: deepCloneJson(inverse.restore) })
  }
  else if (inverse.kind === 'restore-encounter-effects') {
    map.encounterState = parseEncounterState({ ...encounter, effects: deepCloneJson(inverse.restore) })
  }
  else if (inverse.kind === 'restore-encounter-counters') {
    map.encounterState = parseEncounterState({ ...encounter, counters: deepCloneJson(inverse.restore) })
  }
  else if (inverse.kind === 'restore-encounter-turn-resources') {
    map.encounterState = parseEncounterState({ ...encounter, turnResources: deepCloneJson(inverse.restore) })
  }
  else {
    map.encounterState = parseEncounterState({ ...encounter, zones: deepCloneJson(inverse.restore) })
  }
  return true
}

const canonicalizeConditionStorage = (kind: SheetKind, sheet: AnyLiveSheet): AnyLiveSheet => {
  const clone = deepCloneJson(sheet) as AnyLiveSheet & {
    combat?: { statusAfflictions?: unknown }
    statusAfflictions?: unknown
  }
  if (kind === 'pokemon') {
    if (clone.combat) delete clone.combat.statusAfflictions
  }
  else {
    delete clone.statusAfflictions
  }
  return clone
}

const sheetFieldForInverse = (
  inverse: AcceptedMoveTypedInverseOperation,
): LivePlayMoveSheetChangedField | null => {
  if (inverse.kind === 'restore-sheet-hp') return 'hp'
  if (inverse.kind === 'restore-sheet-combat-stages') return 'combatStages'
  if (inverse.kind === 'restore-sheet-conditions') return 'conditions'
  if (inverse.kind === 'restore-sheet-move-usage') return 'moveUsage'
  return null
}

const applySheetInverse = (
  working: SheetWorkingState,
  inverse: AcceptedMoveTypedInverseOperation,
): void => {
  const field = sheetFieldForInverse(inverse)
  if (field === null || inverse.scope.kind !== 'sheet') {
    return fail('invalid-operation', `Correction inverse ${inverse.kind} is not a sheet operation.`)
  }
  if (inverse.kind === 'restore-sheet-hp') {
    // Encounter-effective Soulless authority is applied by the centralized
    // reconciliation pass after every selected inverse has been projected.
    working.current = applyHpToSheet(
      working.source.kind,
      working.current,
      inverse.restore.currentHp,
      inverse.restore.injuries,
      { effectiveSoulless: false },
    )
  }
  else if (inverse.kind === 'restore-sheet-combat-stages') {
    working.current = applyCombatStagesToSheet(
      working.source.kind,
      working.current,
      inverse.restore,
    )
  }
  else if (inverse.kind === 'restore-sheet-conditions') {
    working.current = canonicalizeConditionStorage(
      working.source.kind,
      applyConditionsToSheet(working.source.kind, working.current, [...inverse.restore]),
    )
  }
  else if (inverse.kind === 'restore-sheet-move-usage') {
    const next = deepCloneJson(working.current)
    if (inverse.restore === null) delete next.moveUsage
    else next.moveUsage = deepCloneJson(inverse.restore)
    working.current = next
  }
  working.changedFields.add(field)

  const restored = (() => {
    if (inverse.kind === 'restore-sheet-hp') return sheetHpValue(working.source.kind, working.current)
    if (inverse.kind === 'restore-sheet-combat-stages') return sheetCombatStages(working.source.kind, working.current)
    if (inverse.kind === 'restore-sheet-conditions') {
      return sheetConditionNames(
        working.source.kind,
        working.current as CharacterSheet | TrainerSheet,
      )
    }
    return sheetMoveUsage(working.current)
  })()
  if (!sameJsonValue(restored, inverse.restore)) {
    fail(
      'invalid-restored-value',
      `Correction inverse ${inverse.kind} could not reproduce its reviewed restore value.`,
    )
  }
}

const nullable = <Value>(value: Value | undefined): Value | null => (
  value === undefined ? null : deepCloneJson(value)
)

const mapChangesFor = (
  previous: TabletopMap,
  current: TabletopMap,
): LivePlayMoveStatePatchChanges => {
  const changes: LivePlayMoveStatePatchChanges = {}
  if (!sameJsonValue(previous.placements, current.placements)) {
    Object.assign(changes, {
      placements: {
        previous: deepCloneJson(previous.placements),
        current: deepCloneJson(current.placements),
      },
    })
  }
  if (!sameJsonValue(previous.temporaryHitPoints ?? null, current.temporaryHitPoints ?? null)) {
    Object.assign(changes, {
      temporaryHitPoints: {
        previous: nullable(previous.temporaryHitPoints),
        current: nullable(current.temporaryHitPoints),
      },
    })
  }
  if (!sameJsonValue(previous.moveUsage ?? null, current.moveUsage ?? null)) {
    Object.assign(changes, {
      moveUsage: {
        previous: nullable(previous.moveUsage),
        current: nullable(current.moveUsage),
      },
    })
  }
  if (!sameJsonValue(previous.hazards ?? [], current.hazards ?? [])) {
    Object.assign(changes, {
      hazards: {
        previous: deepCloneJson(previous.hazards ?? []),
        current: deepCloneJson(current.hazards ?? []),
      },
    })
  }
  if (!sameJsonValue(previous.fieldEffects ?? {}, current.fieldEffects ?? {})) {
    Object.assign(changes, {
      fieldEffects: {
        previous: deepCloneJson(previous.fieldEffects ?? {}),
        current: deepCloneJson(current.fieldEffects ?? {}),
      },
    })
  }
  if (!sameJsonValue(encounterStateForMap(previous), encounterStateForMap(current))) {
    Object.assign(changes, {
      encounterState: {
        previous: encounterStateForMap(previous),
        current: encounterStateForMap(current),
      },
    })
  }
  return changes
}

const placementIdsForSheet = (
  previousMap: TabletopMap,
  nextMap: TabletopMap,
  kind: SheetKind,
  slug: string,
): readonly string[] => {
  const ids: string[] = []
  const seen = new Set<string>()
  for (const placement of [...previousMap.placements, ...nextMap.placements]) {
    if (placement.sheetKind !== kind || placement.sheetSlug !== slug || seen.has(placement.id)) continue
    seen.add(placement.id)
    ids.push(placement.id)
  }
  return ids
}

const SHEET_FIELD_ORDER: readonly LivePlayMoveSheetChangedField[] = [
  'moveUsage',
  'hp',
  'combatStages',
  'conditions',
]

export const planAcceptedMoveCorrection = (
  input: PlanAcceptedMoveCorrectionInput,
): AcceptedMoveCorrectionPlan => {
  assertOperationsAgainstSnapshot(input)
  const previousMap = deepCloneJson(input.map)
  let nextMap = deepCloneJson(input.map)
  const workingSheets = new Map<string, SheetWorkingState>()

  for (const operation of input.operations) {
    if (applyMapInverse(nextMap, operation.inverse)) continue
    const scope = operation.inverse.scope
    if (scope.kind !== 'sheet') {
      return fail('invalid-operation', `Correction operation ${operation.operationId} has no typed reducer.`)
    }
    const key = sheetKey(scope.sheetKind, scope.sheetSlug)
    const source = input.sheets.get(key)
    if (!source) {
      return fail(
        'missing-resource',
        `Affected ${scope.sheetKind} sheet ${scope.sheetSlug} is unavailable.`,
      )
    }
    const working: SheetWorkingState = workingSheets.get(key) ?? {
      source,
      current: deepCloneJson(source.sheet) as unknown as AnyLiveSheet,
      changedFields: new Set<LivePlayMoveSheetChangedField>(),
    }
    applySheetInverse(working, operation.inverse)
    workingSheets.set(key, working)
  }

  const touchedPlacementIds = new Set<string>()
  for (const operation of input.operations) {
    const inverse = operation.inverse
    if (inverse.kind === 'restore-sheet-hp' && inverse.scope.kind === 'sheet') {
      for (const placementId of placementIdsForSheet(
        previousMap,
        nextMap,
        inverse.scope.sheetKind,
        inverse.scope.sheetSlug,
      )) touchedPlacementIds.add(placementId)
    }
    else if (inverse.kind === 'restore-map-temporary-hit-points') {
      for (const placementId of [
        ...Object.keys(previousMap.temporaryHitPoints?.byPlacementId ?? {}),
        ...Object.keys(nextMap.temporaryHitPoints?.byPlacementId ?? {}),
      ]) touchedPlacementIds.add(placementId)
    }
    else if (inverse.kind === 'restore-placement-state') {
      touchedPlacementIds.add(inverse.scope.placementId)
    }
    else if (inverse.kind.startsWith('restore-encounter-')) {
      for (const placement of [...previousMap.placements, ...nextMap.placements]) {
        touchedPlacementIds.add(placement.id)
      }
    }
  }

  const projectedSheets = new Map([...input.sheets].map(([key, source]) => [key, {
    kind: source.kind,
    slug: source.slug,
    revision: source.revision,
    sheet: deepCloneJson(source.sheet) as unknown as CharacterSheet | TrainerSheet,
  }]))
  for (const [key, working] of workingSheets) {
    projectedSheets.set(key, {
      kind: working.source.kind,
      slug: working.source.slug,
      revision: working.source.revision,
      sheet: deepCloneJson(working.current) as CharacterSheet | TrainerSheet,
    })
  }

  let reconciliation: ReturnType<typeof reconcileCapabilityHpState>
  try {
    reconciliation = reconcileCapabilityHpState({
      previousMap,
      nextMap,
      sheets: projectedSheets,
      previousSheets: new Map([...input.sheets].map(([key, source]) => [key, {
        kind: source.kind,
        slug: source.slug,
        revision: source.revision,
        sheet: deepCloneJson(source.sheet) as unknown as CharacterSheet | TrainerSheet,
      }])),
      touchedPlacementIds,
    })
  }
  catch (error) {
    if (!(error instanceof CapabilityHpStateReconciliationError)) throw error
    return fail('capability-invariant-conflict', error.message)
  }
  nextMap = deepCloneJson(reconciliation.nextMap)

  for (const [key, working] of workingSheets) {
    const reconciled = reconciliation.sheets.get(key)
    if (!reconciled) continue
    if (!sameJsonValue(working.current, reconciled.sheet)) working.changedFields.add('hp')
    working.current = deepCloneJson(reconciled.sheet) as AnyLiveSheet
  }
  for (const key of reconciliation.changedSheetKeys) {
    if (workingSheets.has(key)) continue
    const source = input.sheets.get(key)
    const reconciled = reconciliation.sheets.get(key)
    if (!source || !reconciled) {
      return fail('missing-resource', `Capability-derived correction sheet ${key} is unavailable.`)
    }
    workingSheets.set(key, {
      source,
      current: deepCloneJson(reconciled.sheet) as AnyLiveSheet,
      changedFields: new Set<LivePlayMoveSheetChangedField>(['hp']),
    })
  }

  const finalSheets = new Map([...reconciliation.sheets].map(([key, snapshot]) => [key, {
    kind: snapshot.kind,
    slug: snapshot.slug,
    revision: snapshot.revision,
    sheet: deepCloneJson(snapshot.sheet) as unknown as Readonly<Record<string, unknown>>,
  }]))
  for (const operation of input.operations) {
    const current = currentInverseValue({ inverse: operation.inverse, map: nextMap, sheets: finalSheets })
    if (!sameJsonValue(current, operation.inverse.restore)) {
      return fail(
        'invalid-restored-value',
        `Correction inverse ${operation.inverse.kind} conflicts with Capability HP invariants.`,
      )
    }
  }

  const previousRevision = normalizeRevision(previousMap.revision)
  const revision = nextRevision(previousRevision)
  nextMap.revision = revision
  nextMap.updatedAt = input.updatedAt

  const sheetReads: AcceptedMoveCorrectionSheetRead[] = [...reconciliation.consultedSheetKeys]
    .map((key) => {
      const source = input.sheets.get(key)
      if (!source) return fail('missing-resource', `Consulted correction sheet ${key} is unavailable.`)
      return { kind: source.kind, slug: source.slug, revision: source.revision }
    })
    .sort((left, right) => sheetKey(left.kind, left.slug).localeCompare(sheetKey(right.kind, right.slug)))

  const sheetWrites: AcceptedMoveCorrectionSheetWrite[] = []
  for (const working of workingSheets.values()) {
    const revision = nextRevision(working.source.revision)
    const nextSheet = {
      ...deepCloneJson(working.current),
      slug: working.source.slug,
      revision,
      updatedAt: input.updatedAt,
    }
    sheetWrites.push({
      kind: working.source.kind,
      slug: working.source.slug,
      expectedRevision: working.source.revision,
      revision,
      nextSheet,
      placementIds: placementIdsForSheet(
        previousMap,
        nextMap,
        working.source.kind,
        working.source.slug,
      ),
      changedFields: SHEET_FIELD_ORDER.filter(field => working.changedFields.has(field)),
    })
  }

  const sheetRefs: LivePlayMoveSheetChangeRef[] = sheetWrites.map(write => ({
    kind: write.kind,
    slug: write.slug,
    expectedRevision: write.expectedRevision,
    revision: write.revision,
    placementIds: [...write.placementIds],
    changedFields: [...write.changedFields],
  }))
  const resourceChanges: LivePlayMoveCorrectionResourceChange[] = [
    {
      kind: 'map',
      mapSlug: nextMap.slug,
      expectedRevision: previousRevision,
      revision,
    },
    ...sheetWrites.map(write => ({
      kind: 'sheet' as const,
      sheetKind: write.kind,
      sheetSlug: write.slug,
      expectedRevision: write.expectedRevision,
      revision: write.revision,
    })),
  ]

  return Object.freeze({
    previousMap,
    nextMap,
    previousRevision,
    revision,
    operationIds: Object.freeze(input.operations.map(operation => operation.operationId)),
    mapChanges: deepCloneJson(mapChangesFor(previousMap, nextMap)),
    sheetReads: Object.freeze(sheetReads.map(read => Object.freeze({ ...read }))),
    sheetWrites: Object.freeze(sheetWrites.map(write => Object.freeze({ ...write }))),
    sheetRefs: Object.freeze(sheetRefs.map(ref => Object.freeze({ ...ref }))),
    resourceChanges: Object.freeze(resourceChanges.map(resource => Object.freeze({ ...resource }))),
  })
}

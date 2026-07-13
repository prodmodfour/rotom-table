import { isRevision, nextRevision } from '#shared/sessionRevisions'
import type { CharacterSheet } from '~/types/characterSheet'
import type { GroupInventoryDocument } from '~/types/groupInventory'
import type {
  MapFieldEffects,
  MapHazardV2,
  SheetKind,
  SheetPlacement,
  TabletopMap,
} from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { sameJsonValue } from '~/utils/serialization'

/**
 * Server-only state plans are typed aggregate replacements, never JSON paths or
 * client-authored patches. Reducers decide the before/current values while the
 * planner owns ordering, resource grouping, and revision expectations.
 */
export const MOVE_STATE_CHANGE_PLAN_SCHEMA_VERSION = 1 as const

export const MOVE_STATE_CHANGE_KINDS = [
  'map-temporary-hit-points',
  'map-move-usage',
  'map-hazards',
  'map-field-effects',
  'map-metadata',
  'map-initiative',
  'encounter-state',
  'placement-state',
  'sheet-state',
  'group-inventory-state',
] as const

export const MOVE_SHEET_STATE_FIELDS = [
  'moveUsage',
  'hp',
  'combatStages',
  'conditions',
] as const

export type MoveStateChangeKind = (typeof MOVE_STATE_CHANGE_KINDS)[number]
export type MoveSheetStateField = (typeof MOVE_SHEET_STATE_FIELDS)[number]
export type MoveExternalResourceKind = 'group-inventory'

export interface VersionedMoveEncounterState {
  readonly schemaVersion: number
}

export interface MoveMapStateChangeScope {
  readonly kind: 'map'
  readonly mapSlug: string
}

export interface MoveEncounterStateChangeScope {
  readonly kind: 'encounter'
  readonly mapSlug: string
}

export interface MovePlacementStateChangeScope {
  readonly kind: 'placement'
  readonly mapSlug: string
  readonly placementId: string
}

export interface MoveSheetStateChangeScope {
  readonly kind: 'sheet'
  readonly sheetKind: SheetKind
  readonly sheetSlug: string
}

export interface MoveExternalResourceStateChangeScope {
  readonly kind: 'external-resource'
  readonly resourceKind: MoveExternalResourceKind
  readonly resourceId: string
}

export type MoveStateChangeScope =
  | MoveMapStateChangeScope
  | MoveEncounterStateChangeScope
  | MovePlacementStateChangeScope
  | MoveSheetStateChangeScope
  | MoveExternalResourceStateChangeScope

/**
 * `inverse` is only a compensation candidate. Applying it later still requires
 * current-value and revision validation; MA-115 persists that correction data.
 */
export const MOVE_STATE_COMPENSATION_SAFETY_KINDS = [
  'irreversible',
  'externally-observed',
] as const

export type MoveStateCompensationSafety = (
  typeof MOVE_STATE_COMPENSATION_SAFETY_KINDS
)[number]

export type MoveStateChangeCompensation =
  | {
      readonly kind: 'inverse'
      readonly strategy: 'restore-previous-value'
    }
  | {
      readonly kind: 'unavailable'
      /** Why no typed inverse may be offered for this accepted operation. */
      readonly safety: MoveStateCompensationSafety
      readonly reasonCode: string
    }

export const RESTORE_PREVIOUS_MOVE_STATE_VALUE = Object.freeze({
  kind: 'inverse' as const,
  strategy: 'restore-previous-value' as const,
})

export const unavailableMoveStateCompensation = (
  reasonCode: string,
  safety: MoveStateCompensationSafety,
): MoveStateChangeCompensation => Object.freeze({
  kind: 'unavailable',
  safety,
  reasonCode,
})

interface MoveStateValueChange<
  Kind extends MoveStateChangeKind,
  Scope extends MoveStateChangeScope,
  Value,
> {
  /** Deterministic planner identity assigned from global plan order. */
  readonly id: string
  /** Zero-based global application order across every resource group. */
  readonly order: number
  readonly kind: Kind
  readonly scope: Scope
  /** Revision of the physical resource that owns this state before commit. */
  readonly expectedRevision: number
  /** Null while a compatibility runtime has not yet been adapted per operation. */
  readonly sourceOperationId: string | null
  readonly reasonCode: string
  readonly previous: Value
  readonly current: Value
  readonly compensation: MoveStateChangeCompensation
}

export type MoveMapTemporaryHitPointsStateChange = MoveStateValueChange<
  'map-temporary-hit-points',
  MoveMapStateChangeScope,
  TabletopMap['temporaryHitPoints']
>

export type MoveMapMoveUsageStateChange = MoveStateValueChange<
  'map-move-usage',
  MoveMapStateChangeScope,
  TabletopMap['moveUsage']
>

export type MoveMapHazardsStateChange = MoveStateValueChange<
  'map-hazards',
  MoveMapStateChangeScope,
  readonly MapHazardV2[]
>

export type MoveMapFieldEffectsStateChange = MoveStateValueChange<
  'map-field-effects',
  MoveMapStateChangeScope,
  MapFieldEffects
>

export type MoveMapMetadataStateChange = MoveStateValueChange<
  'map-metadata',
  MoveMapStateChangeScope,
  TabletopMap['metadata']
>

export type MoveMapInitiativeStateChange = MoveStateValueChange<
  'map-initiative',
  MoveMapStateChangeScope,
  TabletopMap['initiative']
>

export type MoveMapStateChange =
  | MoveMapTemporaryHitPointsStateChange
  | MoveMapMoveUsageStateChange
  | MoveMapHazardsStateChange
  | MoveMapFieldEffectsStateChange
  | MoveMapMetadataStateChange
  | MoveMapInitiativeStateChange

export type MoveEncounterStateChange<
  EncounterState extends VersionedMoveEncounterState = VersionedMoveEncounterState,
> = MoveStateValueChange<
  'encounter-state',
  MoveEncounterStateChangeScope,
  EncounterState
>

export type MovePlacementStateChange = MoveStateValueChange<
  'placement-state',
  MovePlacementStateChangeScope,
  SheetPlacement | null
>

export type MoveSheetDocument = CharacterSheet | TrainerSheet

export type MoveSheetStateChange = MoveStateValueChange<
  'sheet-state',
  MoveSheetStateChangeScope,
  MoveSheetDocument
> & {
  readonly changedFields: readonly MoveSheetStateField[]
}

export type MoveGroupInventoryStateChange = MoveStateValueChange<
  'group-inventory-state',
  MoveExternalResourceStateChangeScope,
  GroupInventoryDocument
>

export type MoveExternalResourceStateChange = MoveGroupInventoryStateChange

export type MoveStateChange<
  EncounterState extends VersionedMoveEncounterState = VersionedMoveEncounterState,
> =
  | MoveMapStateChange
  | MoveEncounterStateChange<EncounterState>
  | MovePlacementStateChange
  | MoveSheetStateChange
  | MoveExternalResourceStateChange

type WithoutPlanIdentity<Change> = Change extends unknown
  ? Omit<Change, 'id' | 'order'>
  : never

export type MoveStateChangeInput<
  EncounterState extends VersionedMoveEncounterState = VersionedMoveEncounterState,
> = WithoutPlanIdentity<MoveStateChange<EncounterState>>

export interface MoveStateChangeGroup<
  Scope extends MoveStateChangeScope,
  Change,
> {
  readonly scope: Scope
  readonly expectedRevision: number
  readonly changes: readonly Change[]
}

export interface MoveStateChangeGroups<
  EncounterState extends VersionedMoveEncounterState = VersionedMoveEncounterState,
> {
  readonly map: readonly MoveStateChangeGroup<MoveMapStateChangeScope, MoveMapStateChange>[]
  readonly encounter: readonly MoveStateChangeGroup<
    MoveEncounterStateChangeScope,
    MoveEncounterStateChange<EncounterState>
  >[]
  readonly placements: readonly MoveStateChangeGroup<
    MovePlacementStateChangeScope,
    MovePlacementStateChange
  >[]
  readonly sheets: readonly MoveStateChangeGroup<MoveSheetStateChangeScope, MoveSheetStateChange>[]
  readonly externalResources: readonly MoveStateChangeGroup<
    MoveExternalResourceStateChangeScope,
    MoveExternalResourceStateChange
  >[]
}

export type MoveStateExpectedRevision =
  | {
      readonly kind: 'map'
      readonly mapSlug: string
      readonly expectedRevision: number
    }
  | {
      readonly kind: 'sheet'
      readonly sheetKind: SheetKind
      readonly sheetSlug: string
      readonly expectedRevision: number
    }
  | {
      readonly kind: 'external-resource'
      readonly resourceKind: MoveExternalResourceKind
      readonly resourceId: string
      readonly expectedRevision: number
    }

export interface MoveStateChangePlan<
  EncounterState extends VersionedMoveEncounterState = VersionedMoveEncounterState,
> {
  readonly schemaVersion: typeof MOVE_STATE_CHANGE_PLAN_SCHEMA_VERSION
  /** Canonical global application order. Group arrays reference these same objects. */
  readonly changes: readonly MoveStateChange<EncounterState>[]
  readonly groups: MoveStateChangeGroups<EncounterState>
  /** One CAS expectation per physical map, sheet, or external document. */
  readonly expectedRevisions: readonly MoveStateExpectedRevision[]
}

export type MoveStateChangePlanErrorCode =
  | 'invalid-change'
  | 'unsupported-change-kind'
  | 'invalid-revision'
  | 'revision-conflict'
  | 'duplicate-state-change'
  | 'no-op-change'

export class MoveStateChangePlanError extends Error {
  readonly code: MoveStateChangePlanErrorCode

  constructor(code: MoveStateChangePlanErrorCode, message: string) {
    super(message)
    this.name = 'MoveStateChangePlanError'
    this.code = code
  }
}

interface MutableMoveStateChangeGroup<Scope extends MoveStateChangeScope, Change> {
  readonly scope: Scope
  readonly expectedRevision: number
  readonly changes: Change[]
}

const CHANGE_KIND_SET = new Set<string>(MOVE_STATE_CHANGE_KINDS)
const SHEET_FIELD_SET = new Set<string>(MOVE_SHEET_STATE_FIELDS)
const COMPENSATION_SAFETY_SET = new Set<string>(MOVE_STATE_COMPENSATION_SAFETY_KINDS)

function fail(code: MoveStateChangePlanErrorCode, message: string): never {
  throw new MoveStateChangePlanError(code, message)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertIdentifier(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value || value.length > 200) {
    fail('invalid-change', `${label} must be a non-empty bounded string.`)
  }
}

function assertExpectedRevision(value: unknown, label: string): asserts value is number {
  if (!isRevision(value)) fail('invalid-revision', `${label} must be a safe non-negative revision.`)
}

const assertCompensation = (value: unknown): void => {
  if (!isRecord(value)) fail('invalid-change', 'State change compensation must be an object.')
  if (value.kind === 'inverse') {
    if (value.strategy !== 'restore-previous-value') {
      fail('invalid-change', 'Inverse compensation must restore the previous typed value.')
    }
    return
  }
  if (value.kind === 'unavailable') {
    // Stored declaration plans created before MA-115 omitted this discriminator.
    // They remain readable and are canonicalized by createMoveStateChangePlan.
    if (value.safety !== undefined && (
      typeof value.safety !== 'string'
      || !COMPENSATION_SAFETY_SET.has(value.safety)
    )) {
      fail('invalid-change', 'Unavailable compensation safety is unsupported.')
    }
    assertIdentifier(value.reasonCode, 'Compensation reasonCode')
    return
  }
  fail('invalid-change', 'State change compensation kind is unsupported.')
}

function assertScopeKind(
  scope: unknown,
  expectedKind: MoveStateChangeScope['kind'],
): asserts scope is MoveStateChangeScope {
  if (!isRecord(scope) || scope.kind !== expectedKind) {
    fail('invalid-change', `State change scope must be ${expectedKind}.`)
  }
  if (expectedKind === 'map' || expectedKind === 'encounter' || expectedKind === 'placement') {
    assertIdentifier(scope.mapSlug, 'State change mapSlug')
  }
  if (expectedKind === 'placement') assertIdentifier(scope.placementId, 'State change placementId')
  if (expectedKind === 'sheet') {
    if (scope.sheetKind !== 'pokemon' && scope.sheetKind !== 'trainer') {
      fail('invalid-change', 'Sheet state change scope has an unsupported sheet kind.')
    }
    assertIdentifier(scope.sheetSlug, 'State change sheetSlug')
  }
  if (expectedKind === 'external-resource') {
    if (scope.resourceKind !== 'group-inventory') {
      fail('invalid-change', 'External move state change has an unsupported resource kind.')
    }
    assertIdentifier(scope.resourceId, 'External move state change resourceId')
  }
}

const assertVersionedEncounterState = (value: unknown, label: string): void => {
  if (!isRecord(value) || !Number.isSafeInteger(value.schemaVersion) || Number(value.schemaVersion) < 1) {
    fail('invalid-change', `${label} must be a versioned encounter-state object.`)
  }
}

const assertPlacementValue = (
  value: unknown,
  placementId: string,
  label: string,
): void => {
  if (value === null) return
  if (!isRecord(value) || value.id !== placementId) {
    fail('invalid-change', `${label} must be null or placement ${placementId}.`)
  }
}

const sheetIdentity = (value: unknown): { readonly slug: string; readonly revision: number } => {
  if (!isRecord(value)) fail('invalid-change', 'Sheet state values must be sheet objects.')
  assertIdentifier(value.slug, 'Sheet state value slug')
  assertExpectedRevision(value.revision, 'Sheet state value revision')
  return { slug: value.slug, revision: value.revision }
}

const groupInventoryIdentity = (
  value: unknown,
): { readonly slug: string; readonly revision: number } => {
  if (!isRecord(value)) fail('invalid-change', 'Group inventory state values must be documents.')
  assertIdentifier(value.slug, 'Group inventory state value slug')
  assertExpectedRevision(value.revision, 'Group inventory state value revision')
  return { slug: value.slug, revision: value.revision }
}

const assertChangedFields = (value: unknown): void => {
  if (!Array.isArray(value) || value.length === 0) {
    fail('invalid-change', 'Sheet state changes must name at least one changed field.')
  }
  const seen = new Set<string>()
  for (const field of value) {
    if (typeof field !== 'string' || !SHEET_FIELD_SET.has(field)) {
      fail('invalid-change', `Sheet state field ${String(field)} is unsupported.`)
    }
    if (seen.has(field)) fail('invalid-change', `Sheet state field ${field} is duplicated.`)
    seen.add(field)
  }
}

function assertChangeShape(value: unknown): void {
  if (!isRecord(value)) fail('invalid-change', 'State changes must be objects.')
  if (typeof value.kind !== 'string' || !CHANGE_KIND_SET.has(value.kind)) {
    fail('unsupported-change-kind', `State change kind ${String(value.kind)} is unsupported.`)
  }
  assertExpectedRevision(value.expectedRevision, 'State change expectedRevision')
  if (value.sourceOperationId !== null) {
    assertIdentifier(value.sourceOperationId, 'State change sourceOperationId')
  }
  assertIdentifier(value.reasonCode, 'State change reasonCode')
  assertCompensation(value.compensation)
  if (!Object.prototype.hasOwnProperty.call(value, 'previous') || !Object.prototype.hasOwnProperty.call(value, 'current')) {
    fail('invalid-change', 'State changes must contain previous and current values.')
  }

  switch (value.kind) {
    case 'map-temporary-hit-points':
    case 'map-move-usage':
    case 'map-hazards':
    case 'map-field-effects':
    case 'map-metadata':
    case 'map-initiative':
      assertScopeKind(value.scope, 'map')
      break
    case 'encounter-state':
      assertScopeKind(value.scope, 'encounter')
      assertVersionedEncounterState(value.previous, 'Previous encounter state')
      assertVersionedEncounterState(value.current, 'Current encounter state')
      break
    case 'placement-state': {
      assertScopeKind(value.scope, 'placement')
      const placementId = (value.scope as MovePlacementStateChangeScope).placementId
      assertPlacementValue(value.previous, placementId, 'Previous placement state')
      assertPlacementValue(value.current, placementId, 'Current placement state')
      if (value.previous === null && value.current === null) {
        fail('no-op-change', `Placement ${placementId} cannot be absent before and after a change.`)
      }
      break
    }
    case 'sheet-state': {
      assertScopeKind(value.scope, 'sheet')
      const scope = value.scope as MoveSheetStateChangeScope
      const previous = sheetIdentity(value.previous)
      const current = sheetIdentity(value.current)
      if (previous.slug !== scope.sheetSlug || current.slug !== scope.sheetSlug) {
        fail('invalid-change', `Sheet state values must match ${scope.sheetKind}/${scope.sheetSlug}.`)
      }
      if (previous.revision !== value.expectedRevision) {
        fail('invalid-revision', `Sheet ${scope.sheetKind}/${scope.sheetSlug} previous revision does not match its expectation.`)
      }
      if (current.revision !== nextRevision(value.expectedRevision)) {
        fail('invalid-revision', `Sheet ${scope.sheetKind}/${scope.sheetSlug} current revision must advance exactly once.`)
      }
      assertChangedFields(value.changedFields)
      break
    }
    case 'group-inventory-state': {
      assertScopeKind(value.scope, 'external-resource')
      const scope = value.scope as MoveExternalResourceStateChangeScope
      const previous = groupInventoryIdentity(value.previous)
      const current = groupInventoryIdentity(value.current)
      if (previous.slug !== scope.resourceId || current.slug !== scope.resourceId) {
        fail('invalid-change', `Group inventory values must match external resource ${scope.resourceId}.`)
      }
      if (previous.revision !== value.expectedRevision) {
        fail('invalid-revision', `Group inventory ${scope.resourceId} previous revision does not match its expectation.`)
      }
      if (current.revision !== nextRevision(value.expectedRevision)) {
        fail('invalid-revision', `Group inventory ${scope.resourceId} current revision must advance exactly once.`)
      }
      break
    }
  }

  if (sameJsonValue(value.previous, value.current)) {
    fail('no-op-change', `State change ${value.kind} does not change its typed value.`)
  }
}

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

const scopeGroupKey = (scope: MoveStateChangeScope): string => {
  if (scope.kind === 'map') return `map:${scope.mapSlug}`
  if (scope.kind === 'encounter') return `encounter:${scope.mapSlug}`
  if (scope.kind === 'placement') return `placement:${scope.mapSlug}:${scope.placementId}`
  if (scope.kind === 'sheet') return `sheet:${scope.sheetKind}:${scope.sheetSlug}`
  return `external:${scope.resourceKind}:${scope.resourceId}`
}

const stateSlotKey = (change: MoveStateChange): string => {
  if (change.scope.kind === 'map') return `${scopeGroupKey(change.scope)}:${change.kind}`
  return scopeGroupKey(change.scope)
}

const revisionOwner = (change: MoveStateChange): {
  readonly key: string
  readonly expectation: MoveStateExpectedRevision
} => {
  if (change.scope.kind === 'map' || change.scope.kind === 'encounter' || change.scope.kind === 'placement') {
    return {
      key: `map:${change.scope.mapSlug}`,
      expectation: {
        kind: 'map',
        mapSlug: change.scope.mapSlug,
        expectedRevision: change.expectedRevision,
      },
    }
  }
  if (change.scope.kind === 'sheet') {
    return {
      key: `sheet:${change.scope.sheetKind}:${change.scope.sheetSlug}`,
      expectation: {
        kind: 'sheet',
        sheetKind: change.scope.sheetKind,
        sheetSlug: change.scope.sheetSlug,
        expectedRevision: change.expectedRevision,
      },
    }
  }
  return {
    key: `external:${change.scope.resourceKind}:${change.scope.resourceId}`,
    expectation: {
      kind: 'external-resource',
      resourceKind: change.scope.resourceKind,
      resourceId: change.scope.resourceId,
      expectedRevision: change.expectedRevision,
    },
  }
}

const addToGroup = <Scope extends MoveStateChangeScope, Change extends { readonly scope: Scope; readonly expectedRevision: number }>(
  groups: MutableMoveStateChangeGroup<Scope, Change>[],
  byKey: Map<string, MutableMoveStateChangeGroup<Scope, Change>>,
  change: Change,
): void => {
  const key = scopeGroupKey(change.scope)
  const existing = byKey.get(key)
  if (existing) {
    existing.changes.push(change)
    return
  }
  const group: MutableMoveStateChangeGroup<Scope, Change> = {
    scope: change.scope,
    expectedRevision: change.expectedRevision,
    changes: [change],
  }
  byKey.set(key, group)
  groups.push(group)
}

/**
 * Detach, validate, globally order, and resource-group trusted reducer output.
 * An empty input is the canonical no-op plan.
 */
export const createMoveStateChangePlan = <
  EncounterState extends VersionedMoveEncounterState = VersionedMoveEncounterState,
>(
  inputs: readonly MoveStateChangeInput<EncounterState>[],
): MoveStateChangePlan<EncounterState> => {
  if (!Array.isArray(inputs)) fail('invalid-change', 'State change plan input must be an array.')

  const changes: MoveStateChange<EncounterState>[] = []
  const slots = new Set<string>()
  const expectedByOwner = new Map<string, MoveStateExpectedRevision>()
  const expectedRevisions: MoveStateExpectedRevision[] = []

  for (const [order, source] of inputs.entries()) {
    assertChangeShape(source)
    let detached: MoveStateChangeInput<EncounterState>
    try {
      detached = structuredClone(source)
      const legacyCompensation = detached.compensation as
        | MoveStateChangeCompensation
        | {
            readonly kind: 'unavailable'
            readonly reasonCode: string
            readonly safety?: undefined
          }
      if (
        legacyCompensation.kind === 'unavailable'
        && legacyCompensation.safety === undefined
      ) {
        const safety: MoveStateCompensationSafety = /observ/i.test(
          legacyCompensation.reasonCode,
        )
          ? 'externally-observed'
          : 'irreversible'
        detached = {
          ...detached,
          compensation: {
            kind: 'unavailable',
            reasonCode: legacyCompensation.reasonCode,
            safety,
          },
        } as MoveStateChangeInput<EncounterState>
      }
    } catch (error) {
      return fail(
        'invalid-change',
        `State change ${source.kind} must contain detached cloneable state: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    const change = deepFreeze({
      ...detached,
      id: `state-change.${order + 1}`,
      order,
    }) as MoveStateChange<EncounterState>

    const slot = stateSlotKey(change)
    if (slots.has(slot)) {
      fail('duplicate-state-change', `State slot ${slot} is changed more than once in one plan.`)
    }
    slots.add(slot)

    const owner = revisionOwner(change)
    const expected = expectedByOwner.get(owner.key)
    if (expected && expected.expectedRevision !== change.expectedRevision) {
      fail(
        'revision-conflict',
        `Resource ${owner.key} has conflicting expected revisions ${expected.expectedRevision} and ${change.expectedRevision}.`,
      )
    }
    if (!expected) {
      expectedByOwner.set(owner.key, owner.expectation)
      expectedRevisions.push(owner.expectation)
    }
    changes.push(change)
  }

  const map: MutableMoveStateChangeGroup<MoveMapStateChangeScope, MoveMapStateChange>[] = []
  const encounter: MutableMoveStateChangeGroup<
    MoveEncounterStateChangeScope,
    MoveEncounterStateChange<EncounterState>
  >[] = []
  const placements: MutableMoveStateChangeGroup<
    MovePlacementStateChangeScope,
    MovePlacementStateChange
  >[] = []
  const sheets: MutableMoveStateChangeGroup<MoveSheetStateChangeScope, MoveSheetStateChange>[] = []
  const externalResources: MutableMoveStateChangeGroup<
    MoveExternalResourceStateChangeScope,
    MoveExternalResourceStateChange
  >[] = []

  const mapByKey = new Map<string, MutableMoveStateChangeGroup<MoveMapStateChangeScope, MoveMapStateChange>>()
  const encounterByKey = new Map<string, MutableMoveStateChangeGroup<
    MoveEncounterStateChangeScope,
    MoveEncounterStateChange<EncounterState>
  >>()
  const placementsByKey = new Map<string, MutableMoveStateChangeGroup<
    MovePlacementStateChangeScope,
    MovePlacementStateChange
  >>()
  const sheetsByKey = new Map<string, MutableMoveStateChangeGroup<MoveSheetStateChangeScope, MoveSheetStateChange>>()
  const externalByKey = new Map<string, MutableMoveStateChangeGroup<
    MoveExternalResourceStateChangeScope,
    MoveExternalResourceStateChange
  >>()

  for (const change of changes) {
    switch (change.scope.kind) {
      case 'map':
        addToGroup(map, mapByKey, change as MoveMapStateChange)
        break
      case 'encounter':
        addToGroup(
          encounter,
          encounterByKey,
          change as MoveEncounterStateChange<EncounterState>,
        )
        break
      case 'placement':
        addToGroup(placements, placementsByKey, change as MovePlacementStateChange)
        break
      case 'sheet':
        addToGroup(sheets, sheetsByKey, change as MoveSheetStateChange)
        break
      case 'external-resource':
        addToGroup(
          externalResources,
          externalByKey,
          change as MoveExternalResourceStateChange,
        )
        break
    }
  }

  return deepFreeze({
    schemaVersion: MOVE_STATE_CHANGE_PLAN_SCHEMA_VERSION,
    changes,
    groups: {
      map,
      encounter,
      placements,
      sheets,
      externalResources,
    },
    expectedRevisions,
  })
}

export const isMoveStateChangePlanNoOp = (plan: MoveStateChangePlan): boolean => (
  plan.changes.length === 0
)

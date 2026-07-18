import {
  createEmptyEncounterState,
  parseEncounterState,
  type EncounterState,
} from '#shared/moveAutomation/encounterState'
import { parseEncounterEffects } from '#shared/moveAutomation/encounterEffects'
import { nextRevision } from '#shared/sessionRevisions'
import type { CombatStageMap } from '~/types/combatStages'
import type { MapMoveUsageState, SheetMoveUsageState } from '~/types/moveUsage'
import type {
  MapFieldEffects,
  MapHazardV2,
  MapTemporaryHitPointsState,
  SheetPlacement,
} from '~/types/map'
import { normalizeCombatStages } from '~/utils/combatStages'
import { deepCloneJson, sameJsonValue } from '~/utils/serialization'
import {
  MOVE_STATE_CHANGE_KINDS,
  type MoveSheetStateChangeScope,
  type MoveStateChangeKind,
  type MoveStateChangeScope,
  type MoveStateCompensationSafety,
} from './plan'

/**
 * Private server result stored beside an accepted move operation. It is not a
 * live-play patch and must never be projected into player HTTP/SSE payloads.
 */
export const ACCEPTED_MOVE_COMPENSATION_SCHEMA_VERSION = 1 as const
export const ACCEPTED_MOVE_COMPENSATION_MAX_OPERATIONS = 256 as const

export interface AcceptedMoveMapResourceRevision {
  readonly kind: 'map'
  readonly mapSlug: string
  readonly beforeRevision: number
  readonly afterRevision: number
}

export interface AcceptedMoveSheetResourceRevision {
  readonly kind: 'sheet'
  readonly sheetKind: 'pokemon' | 'trainer'
  readonly sheetSlug: string
  readonly beforeRevision: number
  readonly afterRevision: number
}

export interface AcceptedMoveExternalResourceRevision {
  readonly kind: 'external-resource'
  readonly resourceKind: 'group-inventory'
  readonly resourceId: string
  readonly beforeRevision: number
  readonly afterRevision: number
}

export type AcceptedMoveCompensationResourceRevision =
  | AcceptedMoveMapResourceRevision
  | AcceptedMoveSheetResourceRevision
  | AcceptedMoveExternalResourceRevision

export interface AcceptedMoveSheetHpValue {
  readonly currentHp: number
  readonly injuries: number
}

export type AcceptedMoveTypedInverseOperation =
  | {
      readonly kind: 'restore-map-temporary-hit-points'
      readonly scope: Extract<MoveStateChangeScope, { readonly kind: 'map' }>
      readonly expectedCurrent: MapTemporaryHitPointsState | null
      readonly restore: MapTemporaryHitPointsState | null
    }
  | {
      readonly kind: 'restore-map-move-usage'
      readonly scope: Extract<MoveStateChangeScope, { readonly kind: 'map' }>
      readonly expectedCurrent: MapMoveUsageState | null
      readonly restore: MapMoveUsageState | null
    }
  | {
      readonly kind: 'restore-map-hazards'
      readonly scope: Extract<MoveStateChangeScope, { readonly kind: 'map' }>
      readonly expectedCurrent: readonly MapHazardV2[]
      readonly restore: readonly MapHazardV2[]
    }
  | {
      readonly kind: 'restore-map-field-effects'
      readonly scope: Extract<MoveStateChangeScope, { readonly kind: 'map' }>
      readonly expectedCurrent: MapFieldEffects
      readonly restore: MapFieldEffects
    }
  | {
      readonly kind: 'restore-encounter-sides'
      readonly scope: Extract<MoveStateChangeScope, { readonly kind: 'encounter' }>
      readonly expectedCurrent: EncounterState['sides']
      readonly restore: EncounterState['sides']
    }
  | {
      readonly kind: 'restore-encounter-effects'
      readonly scope: Extract<MoveStateChangeScope, { readonly kind: 'encounter' }>
      readonly expectedCurrent: EncounterState['effects']
      readonly restore: EncounterState['effects']
    }
  | {
      readonly kind: 'restore-encounter-counters'
      readonly scope: Extract<MoveStateChangeScope, { readonly kind: 'encounter' }>
      readonly expectedCurrent: EncounterState['counters']
      readonly restore: EncounterState['counters']
    }
  | {
      readonly kind: 'restore-encounter-turn-resources'
      readonly scope: Extract<MoveStateChangeScope, { readonly kind: 'encounter' }>
      readonly expectedCurrent: EncounterState['turnResources']
      readonly restore: EncounterState['turnResources']
    }
  | {
      readonly kind: 'restore-encounter-zones'
      readonly scope: Extract<MoveStateChangeScope, { readonly kind: 'encounter' }>
      readonly expectedCurrent: EncounterState['zones']
      readonly restore: EncounterState['zones']
    }
  | {
      readonly kind: 'restore-placement-state'
      readonly scope: Extract<MoveStateChangeScope, { readonly kind: 'placement' }>
      readonly expectedCurrent: SheetPlacement | null
      readonly restore: SheetPlacement | null
    }
  | {
      readonly kind: 'restore-sheet-hp'
      readonly scope: MoveSheetStateChangeScope
      readonly expectedCurrent: AcceptedMoveSheetHpValue
      readonly restore: AcceptedMoveSheetHpValue
    }
  | {
      readonly kind: 'restore-sheet-combat-stages'
      readonly scope: MoveSheetStateChangeScope
      readonly expectedCurrent: CombatStageMap
      readonly restore: CombatStageMap
    }
  | {
      readonly kind: 'restore-sheet-conditions'
      readonly scope: MoveSheetStateChangeScope
      readonly expectedCurrent: readonly string[]
      readonly restore: readonly string[]
    }
  | {
      readonly kind: 'restore-sheet-move-usage'
      readonly scope: MoveSheetStateChangeScope
      readonly expectedCurrent: SheetMoveUsageState | null
      readonly restore: SheetMoveUsageState | null
    }

interface AcceptedMoveCompensationOperationBase {
  /** Stable ID selected by a later GM correction command. */
  readonly operationId: string
  readonly stateChangeId: string
  readonly sourceOperationId: string | null
  readonly stateChangeKind: MoveStateChangeKind
  readonly scope: MoveStateChangeScope
  readonly resource: AcceptedMoveCompensationResourceRevision
  readonly reasonCode: string
}

export interface AcceptedMoveAvailableCompensationOperation
  extends AcceptedMoveCompensationOperationBase {
  readonly availability: 'available'
  readonly inverse: AcceptedMoveTypedInverseOperation
}

export interface AcceptedMoveUnavailableCompensationOperation
  extends AcceptedMoveCompensationOperationBase {
  readonly availability: 'unavailable'
  readonly safety: MoveStateCompensationSafety
  readonly unavailableReasonCode: string
}

export type AcceptedMoveCompensationOperation =
  | AcceptedMoveAvailableCompensationOperation
  | AcceptedMoveUnavailableCompensationOperation

export interface AcceptedMoveCompensationResult {
  readonly schemaVersion: typeof ACCEPTED_MOVE_COMPENSATION_SCHEMA_VERSION
  readonly mapSlug: string
  readonly originOperationId: string
  readonly operations: readonly AcceptedMoveCompensationOperation[]
}

export class AcceptedMoveCompensationValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AcceptedMoveCompensationValidationError'
  }
}

type UnknownRecord = Record<string, unknown>

const fail = (message: string): never => {
  throw new AcceptedMoveCompensationValidationError(message)
}

const isRecord = (value: unknown): value is UnknownRecord => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const assertExactKeys = (
  value: UnknownRecord,
  allowed: ReadonlySet<string>,
  label: string,
): void => {
  const unknown = Object.keys(value).find(key => !allowed.has(key))
  if (unknown) fail(`${label}.${unknown} is not supported.`)
}

const assertIdentifier: (
  value: unknown,
  label: string,
) => asserts value is string = (value, label) => {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > 200
    || value.trim() !== value
    || /[\u0000-\u001f\u007f]/.test(value)
  ) {
    fail(`${label} must be a non-empty bounded identifier.`)
  }
}

const assertRevision: (
  value: unknown,
  label: string,
) => asserts value is number = (value, label) => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    fail(`${label} must be a safe non-negative revision.`)
  }
}

const assertJsonContainer = (value: unknown, label: string): void => {
  if (value === null || (!Array.isArray(value) && !isRecord(value))) {
    fail(`${label} must be a JSON object or array.`)
  }
  try {
    JSON.stringify(value)
  }
  catch {
    fail(`${label} must be JSON serializable.`)
  }
}

const parseScope = (value: unknown, label: string): MoveStateChangeScope => {
  if (!isRecord(value)) return fail(`${label} must be an object.`)
  if (value.kind === 'map' || value.kind === 'encounter') {
    assertExactKeys(value, new Set(['kind', 'mapSlug']), label)
    assertIdentifier(value.mapSlug, `${label}.mapSlug`)
    return { kind: value.kind, mapSlug: value.mapSlug }
  }
  if (value.kind === 'placement') {
    assertExactKeys(value, new Set(['kind', 'mapSlug', 'placementId']), label)
    assertIdentifier(value.mapSlug, `${label}.mapSlug`)
    assertIdentifier(value.placementId, `${label}.placementId`)
    return { kind: 'placement', mapSlug: value.mapSlug, placementId: value.placementId }
  }
  if (value.kind === 'sheet') {
    assertExactKeys(value, new Set(['kind', 'sheetKind', 'sheetSlug']), label)
    if (value.sheetKind !== 'pokemon' && value.sheetKind !== 'trainer') {
      return fail(`${label}.sheetKind is unsupported.`)
    }
    assertIdentifier(value.sheetSlug, `${label}.sheetSlug`)
    return { kind: 'sheet', sheetKind: value.sheetKind, sheetSlug: value.sheetSlug }
  }
  if (value.kind === 'external-resource') {
    assertExactKeys(value, new Set(['kind', 'resourceKind', 'resourceId']), label)
    if (value.resourceKind !== 'group-inventory') {
      return fail(`${label}.resourceKind is unsupported.`)
    }
    assertIdentifier(value.resourceId, `${label}.resourceId`)
    return {
      kind: 'external-resource',
      resourceKind: 'group-inventory',
      resourceId: value.resourceId,
    }
  }
  return fail(`${label}.kind is unsupported.`)
}

const parseResource = (
  value: unknown,
  label: string,
): AcceptedMoveCompensationResourceRevision => {
  if (!isRecord(value)) return fail(`${label} must be an object.`)
  assertRevision(value.beforeRevision, `${label}.beforeRevision`)
  assertRevision(value.afterRevision, `${label}.afterRevision`)
  if (value.afterRevision !== nextRevision(value.beforeRevision)) {
    return fail(`${label} must advance exactly one revision.`)
  }
  if (value.kind === 'map') {
    assertExactKeys(
      value,
      new Set(['kind', 'mapSlug', 'beforeRevision', 'afterRevision']),
      label,
    )
    assertIdentifier(value.mapSlug, `${label}.mapSlug`)
    return {
      kind: 'map',
      mapSlug: value.mapSlug,
      beforeRevision: value.beforeRevision,
      afterRevision: value.afterRevision,
    }
  }
  if (value.kind === 'sheet') {
    assertExactKeys(
      value,
      new Set(['kind', 'sheetKind', 'sheetSlug', 'beforeRevision', 'afterRevision']),
      label,
    )
    if (value.sheetKind !== 'pokemon' && value.sheetKind !== 'trainer') {
      return fail(`${label}.sheetKind is unsupported.`)
    }
    assertIdentifier(value.sheetSlug, `${label}.sheetSlug`)
    return {
      kind: 'sheet',
      sheetKind: value.sheetKind,
      sheetSlug: value.sheetSlug,
      beforeRevision: value.beforeRevision,
      afterRevision: value.afterRevision,
    }
  }
  if (value.kind === 'external-resource') {
    assertExactKeys(
      value,
      new Set([
        'kind',
        'resourceKind',
        'resourceId',
        'beforeRevision',
        'afterRevision',
      ]),
      label,
    )
    if (value.resourceKind !== 'group-inventory') {
      return fail(`${label}.resourceKind is unsupported.`)
    }
    assertIdentifier(value.resourceId, `${label}.resourceId`)
    return {
      kind: 'external-resource',
      resourceKind: 'group-inventory',
      resourceId: value.resourceId,
      beforeRevision: value.beforeRevision,
      afterRevision: value.afterRevision,
    }
  }
  return fail(`${label}.kind is unsupported.`)
}

const assertScopeOwnsResource = (
  scope: MoveStateChangeScope,
  resource: AcceptedMoveCompensationResourceRevision,
  label: string,
): void => {
  if (scope.kind === 'map' || scope.kind === 'encounter' || scope.kind === 'placement') {
    if (resource.kind !== 'map' || resource.mapSlug !== scope.mapSlug) {
      fail(`${label} map scope and owning resource do not match.`)
    }
    return
  }
  if (scope.kind === 'sheet') {
    if (
      resource.kind !== 'sheet'
      || resource.sheetKind !== scope.sheetKind
      || resource.sheetSlug !== scope.sheetSlug
    ) {
      fail(`${label} sheet scope and owning resource do not match.`)
    }
    return
  }
  if (
    resource.kind !== 'external-resource'
    || resource.resourceKind !== scope.resourceKind
    || resource.resourceId !== scope.resourceId
  ) {
    fail(`${label} external scope and owning resource do not match.`)
  }
}

const parseHpValue = (value: unknown, label: string): AcceptedMoveSheetHpValue => {
  if (!isRecord(value)) return fail(`${label} must be an HP object.`)
  assertExactKeys(value, new Set(['currentHp', 'injuries']), label)
  if (!Number.isSafeInteger(value.currentHp)) {
    return fail(`${label}.currentHp must be a safe integer.`)
  }
  if (!Number.isSafeInteger(value.injuries) || Number(value.injuries) < 0) {
    return fail(`${label}.injuries must be a safe non-negative integer.`)
  }
  return { currentHp: Number(value.currentHp), injuries: Number(value.injuries) }
}

const parseConditions = (value: unknown, label: string): readonly string[] => {
  if (!Array.isArray(value) || value.length > 64) {
    return fail(`${label} must be a bounded condition array.`)
  }
  const conditions = value.map((condition, index) => {
    if (typeof condition !== 'string' || condition.length === 0 || condition.length > 120) {
      return fail(`${label}.${index} must be a bounded condition name.`)
    }
    return condition
  })
  return conditions
}

const parseCombatStages = (value: unknown, label: string): CombatStageMap => {
  if (!isRecord(value)) return fail(`${label} must be a combat-stage object.`)
  const keys = ['atk', 'def', 'satk', 'sdef', 'spd', 'acc'] as const
  assertExactKeys(value, new Set(keys), label)
  for (const key of keys) {
    if (!Number.isSafeInteger(value[key]) || Number(value[key]) < -6 || Number(value[key]) > 6) {
      fail(`${label}.${key} must be an integer from -6 through 6.`)
    }
  }
  return normalizeCombatStages(value)
}

const assertPlacement = (
  value: unknown,
  placementId: string,
  label: string,
): void => {
  if (value === null) return
  if (!isRecord(value) || value.id !== placementId) {
    fail(`${label} must be null or placement ${placementId}.`)
  }
}

const inverseStateChangeKind = (
  inverseKind: AcceptedMoveTypedInverseOperation['kind'],
): MoveStateChangeKind => {
  if (inverseKind === 'restore-map-temporary-hit-points') return 'map-temporary-hit-points'
  if (inverseKind === 'restore-map-move-usage') return 'map-move-usage'
  if (inverseKind === 'restore-map-hazards') return 'map-hazards'
  if (inverseKind === 'restore-map-field-effects') return 'map-field-effects'
  if (inverseKind.startsWith('restore-encounter-')) return 'encounter-state'
  if (inverseKind === 'restore-placement-state') return 'placement-state'
  return 'sheet-state'
}

const parseInverse = (
  value: unknown,
  scope: MoveStateChangeScope,
  stateChangeKind: MoveStateChangeKind,
  label: string,
): AcceptedMoveTypedInverseOperation => {
  if (!isRecord(value)) return fail(`${label} must be an object.`)
  assertExactKeys(value, new Set(['kind', 'scope', 'expectedCurrent', 'restore']), label)
  const inverseScope = parseScope(value.scope, `${label}.scope`)
  if (!sameJsonValue(inverseScope, scope)) fail(`${label}.scope must match its state change.`)
  const kind = value.kind
  const supported = new Set<unknown>([
    'restore-map-temporary-hit-points',
    'restore-map-move-usage',
    'restore-map-hazards',
    'restore-map-field-effects',
    'restore-encounter-sides',
    'restore-encounter-effects',
    'restore-encounter-counters',
    'restore-encounter-turn-resources',
    'restore-encounter-zones',
    'restore-placement-state',
    'restore-sheet-hp',
    'restore-sheet-combat-stages',
    'restore-sheet-conditions',
    'restore-sheet-move-usage',
  ])
  if (!supported.has(kind)) return fail(`${label}.kind is unsupported.`)
  if (inverseStateChangeKind(kind as AcceptedMoveTypedInverseOperation['kind']) !== stateChangeKind) {
    return fail(`${label}.kind does not match ${stateChangeKind}.`)
  }

  if (kind === 'restore-map-temporary-hit-points' || kind === 'restore-map-move-usage') {
    for (const [name, item] of [['expectedCurrent', value.expectedCurrent], ['restore', value.restore]] as const) {
      if (item !== null) assertJsonContainer(item, `${label}.${name}`)
    }
  }
  else if (kind === 'restore-map-hazards') {
    if (!Array.isArray(value.expectedCurrent) || !Array.isArray(value.restore)) {
      return fail(`${label} hazard values must be arrays.`)
    }
  }
  else if (kind === 'restore-map-field-effects') {
    if (!isRecord(value.expectedCurrent) || !isRecord(value.restore)) {
      return fail(`${label} field-effect values must be objects.`)
    }
  }
  else if (typeof kind === 'string' && kind.startsWith('restore-encounter-')) {
    if (scope.kind !== 'encounter') return fail(`${label}.scope must be encounter state.`)
    const field = (() => {
      if (kind === 'restore-encounter-sides') return 'sides' as const
      if (kind === 'restore-encounter-effects') return 'effects' as const
      if (kind === 'restore-encounter-counters') return 'counters' as const
      if (kind === 'restore-encounter-turn-resources') return 'turnResources' as const
      if (kind === 'restore-encounter-zones') return 'zones' as const
      return fail(`${label}.kind is unsupported.`)
    })()
    try {
      if (field === 'effects') {
        // Compensation entries are parsed independently, so the companion
        // encounter-side operation is not available here. Keep strict effect
        // shape validation; full side references were validated on the source
        // state change and are revalidated against the map when correcting.
        parseEncounterEffects(value.expectedCurrent, `${label}.expectedCurrent`)
        parseEncounterEffects(value.restore, `${label}.restore`)
      }
      else {
        parseEncounterState({
          ...createEmptyEncounterState(),
          [field]: value.expectedCurrent,
        })
        parseEncounterState({
          ...createEmptyEncounterState(),
          [field]: value.restore,
        })
      }
    }
    catch (error) {
      return fail(`${label} contains invalid encounter ${field}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  else if (kind === 'restore-placement-state') {
    if (scope.kind !== 'placement') return fail(`${label}.scope must be a placement.`)
    assertPlacement(value.expectedCurrent, scope.placementId, `${label}.expectedCurrent`)
    assertPlacement(value.restore, scope.placementId, `${label}.restore`)
  }
  else if (kind === 'restore-sheet-hp') {
    parseHpValue(value.expectedCurrent, `${label}.expectedCurrent`)
    parseHpValue(value.restore, `${label}.restore`)
  }
  else if (kind === 'restore-sheet-combat-stages') {
    parseCombatStages(value.expectedCurrent, `${label}.expectedCurrent`)
    parseCombatStages(value.restore, `${label}.restore`)
  }
  else if (kind === 'restore-sheet-conditions') {
    parseConditions(value.expectedCurrent, `${label}.expectedCurrent`)
    parseConditions(value.restore, `${label}.restore`)
  }
  else if (kind === 'restore-sheet-move-usage') {
    for (const [name, item] of [['expectedCurrent', value.expectedCurrent], ['restore', value.restore]] as const) {
      if (item !== null && !isRecord(item)) {
        return fail(`${label}.${name} must be null or a move-usage object.`)
      }
    }
  }

  if (sameJsonValue(value.expectedCurrent, value.restore)) {
    return fail(`${label} cannot restore an unchanged value.`)
  }
  return deepCloneJson(value) as AcceptedMoveTypedInverseOperation
}

const stateKindSet = new Set<string>(MOVE_STATE_CHANGE_KINDS)

/** Validate and detach private accepted-operation compensation JSON. */
export const parseAcceptedMoveCompensationResult = (
  value: unknown,
): AcceptedMoveCompensationResult => {
  if (!isRecord(value)) return fail('Accepted move compensation result must be an object.')
  assertExactKeys(
    value,
    new Set(['schemaVersion', 'mapSlug', 'originOperationId', 'operations']),
    'acceptedMoveCompensation',
  )
  if (value.schemaVersion !== ACCEPTED_MOVE_COMPENSATION_SCHEMA_VERSION) {
    return fail('Accepted move compensation schemaVersion is unsupported.')
  }
  assertIdentifier(value.mapSlug, 'acceptedMoveCompensation.mapSlug')
  assertIdentifier(value.originOperationId, 'acceptedMoveCompensation.originOperationId')
  if (
    !Array.isArray(value.operations)
    || value.operations.length > ACCEPTED_MOVE_COMPENSATION_MAX_OPERATIONS
  ) {
    return fail('Accepted move compensation operations must be a bounded array.')
  }

  const operations: AcceptedMoveCompensationOperation[] = []
  const operationIds = new Set<string>()
  for (const [index, item] of value.operations.entries()) {
    const label = `acceptedMoveCompensation.operations.${index}`
    if (!isRecord(item)) return fail(`${label} must be an object.`)
    const commonKeys = [
      'operationId',
      'stateChangeId',
      'sourceOperationId',
      'stateChangeKind',
      'scope',
      'resource',
      'reasonCode',
      'availability',
    ]
    const variantKeys = item.availability === 'available'
      ? ['inverse']
      : ['safety', 'unavailableReasonCode']
    assertExactKeys(item, new Set([...commonKeys, ...variantKeys]), label)
    assertIdentifier(item.operationId, `${label}.operationId`)
    if (operationIds.has(item.operationId)) {
      return fail(`${label}.operationId is duplicated.`)
    }
    operationIds.add(item.operationId)
    assertIdentifier(item.stateChangeId, `${label}.stateChangeId`)
    if (item.sourceOperationId !== null) {
      assertIdentifier(item.sourceOperationId, `${label}.sourceOperationId`)
    }
    if (typeof item.stateChangeKind !== 'string' || !stateKindSet.has(item.stateChangeKind)) {
      return fail(`${label}.stateChangeKind is unsupported.`)
    }
    assertIdentifier(item.reasonCode, `${label}.reasonCode`)
    const scope = parseScope(item.scope, `${label}.scope`)
    const resource = parseResource(item.resource, `${label}.resource`)
    assertScopeOwnsResource(scope, resource, label)
    if ((scope.kind === 'map' || scope.kind === 'encounter' || scope.kind === 'placement')
      && scope.mapSlug !== value.mapSlug) {
      return fail(`${label} belongs to a different map.`)
    }

    const base = {
      operationId: item.operationId,
      stateChangeId: item.stateChangeId,
      sourceOperationId: item.sourceOperationId,
      stateChangeKind: item.stateChangeKind as MoveStateChangeKind,
      scope,
      resource,
      reasonCode: item.reasonCode,
    }
    if (item.availability === 'available') {
      operations.push({
        ...base,
        availability: 'available',
        inverse: parseInverse(
          item.inverse,
          scope,
          item.stateChangeKind as MoveStateChangeKind,
          `${label}.inverse`,
        ),
      })
      continue
    }
    if (item.availability !== 'unavailable') {
      return fail(`${label}.availability is unsupported.`)
    }
    if (item.safety !== 'irreversible' && item.safety !== 'externally-observed') {
      return fail(`${label}.safety is unsupported.`)
    }
    assertIdentifier(item.unavailableReasonCode, `${label}.unavailableReasonCode`)
    operations.push({
      ...base,
      availability: 'unavailable',
      safety: item.safety,
      unavailableReasonCode: item.unavailableReasonCode,
    })
  }

  return deepFreeze({
    schemaVersion: ACCEPTED_MOVE_COMPENSATION_SCHEMA_VERSION,
    mapSlug: value.mapSlug,
    originOperationId: value.originOperationId,
    operations: deepCloneJson(operations),
  })
}

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

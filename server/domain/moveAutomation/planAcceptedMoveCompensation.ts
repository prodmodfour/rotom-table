import { parseEncounterState } from '#shared/moveAutomation/encounterState'
import { nextRevision } from '#shared/sessionRevisions'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetMoveUsageState } from '~/types/moveUsage'
import type { TrainerSheet } from '~/types/trainerSheet'
import { deepCloneJson, sameJsonValue } from '~/utils/serialization'
import { pokemonHpSnapshot, trainerHpSnapshot } from '~/utils/sheetSpawn'
import { sheetConditionNames } from '~/utils/sheetConditions'
import {
  ACCEPTED_MOVE_COMPENSATION_SCHEMA_VERSION,
  AcceptedMoveCompensationValidationError,
  parseAcceptedMoveCompensationResult,
  type AcceptedMoveAvailableCompensationOperation,
  type AcceptedMoveCompensationOperation,
  type AcceptedMoveCompensationResourceRevision,
  type AcceptedMoveCompensationResult,
  type AcceptedMoveTypedInverseOperation,
} from './acceptedMoveCompensation'
import type {
  MoveSheetDocument,
  MoveSheetStateChangeScope,
  MoveStateChange,
  MoveStateChangePlan,
} from './plan'

const fail = (message: string): never => {
  throw new AcceptedMoveCompensationValidationError(message)
}

const resourceForChange = (
  change: MoveStateChange,
): AcceptedMoveCompensationResourceRevision => {
  const revisions = {
    beforeRevision: change.expectedRevision,
    afterRevision: nextRevision(change.expectedRevision),
  }
  if (
    change.scope.kind === 'map'
    || change.scope.kind === 'encounter'
    || change.scope.kind === 'placement'
  ) {
    return { kind: 'map', mapSlug: change.scope.mapSlug, ...revisions }
  }
  if (change.scope.kind === 'sheet') {
    return {
      kind: 'sheet',
      sheetKind: change.scope.sheetKind,
      sheetSlug: change.scope.sheetSlug,
      ...revisions,
    }
  }
  return {
    kind: 'external-resource',
    resourceKind: change.scope.resourceKind,
    resourceId: change.scope.resourceId,
    ...revisions,
  }
}

const sheetRuleSnapshot = (
  scope: MoveSheetStateChangeScope,
  sheet: MoveSheetDocument,
): ReturnType<typeof pokemonHpSnapshot> | ReturnType<typeof trainerHpSnapshot> => (
  scope.sheetKind === 'pokemon'
    ? pokemonHpSnapshot(sheet as CharacterSheet)
    : trainerHpSnapshot(sheet as TrainerSheet)
)

const sheetMoveUsage = (sheet: MoveSheetDocument): SheetMoveUsageState | null => {
  const usage = (sheet as CharacterSheet | TrainerSheet).moveUsage
  return usage === undefined ? null : deepCloneJson(usage)
}

const sheetInverseOperations = (
  change: Extract<MoveStateChange, { readonly kind: 'sheet-state' }>,
): readonly AcceptedMoveAvailableCompensationOperation[] => {
  const previousRules = sheetRuleSnapshot(change.scope, change.previous)
  const currentRules = sheetRuleSnapshot(change.scope, change.current)
  const resource = resourceForChange(change)
  return change.changedFields.map((field) => {
    const operationId = `inverse.${change.id}.${field}`
    let inverse: AcceptedMoveTypedInverseOperation
    if (field === 'hp') {
      inverse = {
        kind: 'restore-sheet-hp',
        scope: deepCloneJson(change.scope),
        expectedCurrent: {
          currentHp: currentRules.currentHp,
          injuries: currentRules.injuries,
        },
        restore: {
          currentHp: previousRules.currentHp,
          injuries: previousRules.injuries,
        },
      }
    }
    else if (field === 'combatStages') {
      inverse = {
        kind: 'restore-sheet-combat-stages',
        scope: deepCloneJson(change.scope),
        expectedCurrent: deepCloneJson(currentRules.combatStages),
        restore: deepCloneJson(previousRules.combatStages),
      }
    }
    else if (field === 'conditions') {
      inverse = {
        kind: 'restore-sheet-conditions',
        scope: deepCloneJson(change.scope),
        expectedCurrent: sheetConditionNames(change.scope.sheetKind, change.current),
        restore: sheetConditionNames(change.scope.sheetKind, change.previous),
      }
    }
    else {
      inverse = {
        kind: 'restore-sheet-move-usage',
        scope: deepCloneJson(change.scope),
        expectedCurrent: sheetMoveUsage(change.current),
        restore: sheetMoveUsage(change.previous),
      }
    }
    if (sameJsonValue(inverse.expectedCurrent, inverse.restore)) {
      return fail(
        `Sheet state change ${change.id} field ${field} does not contain a reversible value change.`,
      )
    }
    return {
      operationId,
      stateChangeId: change.id,
      sourceOperationId: change.sourceOperationId,
      stateChangeKind: change.kind,
      scope: deepCloneJson(change.scope),
      resource,
      reasonCode: change.reasonCode,
      availability: 'available',
      inverse,
    }
  })
}

const encounterInverseOperations = (
  change: Extract<MoveStateChange, { readonly kind: 'encounter-state' }>,
): readonly AcceptedMoveCompensationOperation[] => {
  const previous = parseEncounterState(change.previous)
  const current = parseEncounterState(change.current)
  if (previous.schemaVersion !== current.schemaVersion) {
    return fail(`Encounter state change ${change.id} cannot change schema version.`)
  }
  const fields = [
    'sides',
    'effects',
    'counters',
    'history',
    'turnResources',
    'zones',
    'pendingResolutionSummaries',
  ] as const
  const resource = resourceForChange(change)
  return fields.flatMap((field): AcceptedMoveCompensationOperation[] => {
    if (sameJsonValue(previous[field], current[field])) return []
    const common = {
      stateChangeId: change.id,
      sourceOperationId: change.sourceOperationId,
      stateChangeKind: change.kind,
      scope: deepCloneJson(change.scope),
      resource,
      reasonCode: change.reasonCode,
    }
    if (field === 'history') {
      return [{
        ...common,
        operationId: `unavailable.${change.id}.${field}`,
        availability: 'unavailable',
        safety: 'externally-observed',
        unavailableReasonCode: 'accepted-history-may-be-observed',
      }]
    }
    if (field === 'pendingResolutionSummaries') {
      return [{
        ...common,
        operationId: `unavailable.${change.id}.${field}`,
        availability: 'unavailable',
        safety: 'irreversible',
        unavailableReasonCode: 'pending-resolution-transition-is-terminal',
      }]
    }

    let inverse: AcceptedMoveTypedInverseOperation
    if (field === 'sides') {
      inverse = {
        kind: 'restore-encounter-sides',
        scope: deepCloneJson(change.scope),
        expectedCurrent: deepCloneJson(current.sides),
        restore: deepCloneJson(previous.sides),
      }
    }
    else if (field === 'effects') {
      inverse = {
        kind: 'restore-encounter-effects',
        scope: deepCloneJson(change.scope),
        expectedCurrent: deepCloneJson(current.effects),
        restore: deepCloneJson(previous.effects),
      }
    }
    else if (field === 'counters') {
      inverse = {
        kind: 'restore-encounter-counters',
        scope: deepCloneJson(change.scope),
        expectedCurrent: deepCloneJson(current.counters),
        restore: deepCloneJson(previous.counters),
      }
    }
    else if (field === 'turnResources') {
      inverse = {
        kind: 'restore-encounter-turn-resources',
        scope: deepCloneJson(change.scope),
        expectedCurrent: deepCloneJson(current.turnResources),
        restore: deepCloneJson(previous.turnResources),
      }
    }
    else {
      inverse = {
        kind: 'restore-encounter-zones',
        scope: deepCloneJson(change.scope),
        expectedCurrent: deepCloneJson(current.zones),
        restore: deepCloneJson(previous.zones),
      }
    }
    return [{
      ...common,
      operationId: `inverse.${change.id}.${field}`,
      availability: 'available',
      inverse,
    }]
  })
}

const scalarInverse = (
  change: Exclude<MoveStateChange, {
    readonly kind:
      | 'sheet-state'
      | 'group-inventory-state'
      | 'map-metadata'
      | 'encounter-state'
  }>,
): AcceptedMoveTypedInverseOperation => {
  if (change.kind === 'map-temporary-hit-points') {
    return {
      kind: 'restore-map-temporary-hit-points',
      scope: deepCloneJson(change.scope),
      expectedCurrent: change.current ?? null,
      restore: change.previous ?? null,
    }
  }
  if (change.kind === 'map-move-usage') {
    return {
      kind: 'restore-map-move-usage',
      scope: deepCloneJson(change.scope),
      expectedCurrent: change.current ?? null,
      restore: change.previous ?? null,
    }
  }
  if (change.kind === 'map-hazards') {
    return {
      kind: 'restore-map-hazards',
      scope: deepCloneJson(change.scope),
      expectedCurrent: deepCloneJson(change.current),
      restore: deepCloneJson(change.previous),
    }
  }
  if (change.kind === 'map-field-effects') {
    return {
      kind: 'restore-map-field-effects',
      scope: deepCloneJson(change.scope),
      expectedCurrent: deepCloneJson(change.current),
      restore: deepCloneJson(change.previous),
    }
  }
  if (change.kind === 'map-initiative') {
    return fail('Initiative state changes require unavailable compensation metadata.')
  }
  return {
    kind: 'restore-placement-state',
    scope: deepCloneJson(change.scope),
    expectedCurrent: deepCloneJson(change.current),
    restore: deepCloneJson(change.previous),
  }
}

const operationsForChange = (
  change: MoveStateChange,
): readonly AcceptedMoveCompensationOperation[] => {
  const common = {
    stateChangeId: change.id,
    sourceOperationId: change.sourceOperationId,
    stateChangeKind: change.kind,
    scope: deepCloneJson(change.scope),
    resource: resourceForChange(change),
    reasonCode: change.reasonCode,
  }
  if (change.compensation.kind === 'unavailable') {
    return [{
      ...common,
      operationId: `unavailable.${change.id}`,
      availability: 'unavailable',
      safety: change.compensation.safety,
      unavailableReasonCode: change.compensation.reasonCode,
    }]
  }
  if (change.kind === 'sheet-state') return sheetInverseOperations(change)
  if (change.kind === 'encounter-state') return encounterInverseOperations(change)
  if (change.kind === 'group-inventory-state' || change.kind === 'map-metadata') {
    return fail(
      `State change ${change.id} (${change.kind}) cannot use a whole-document inverse.`,
    )
  }
  return [{
    ...common,
    operationId: `inverse.${change.id}`,
    availability: 'available',
    inverse: scalarInverse(change),
  }]
}

/**
 * Materialize exact correction candidates from the accepted typed plan. Sheet
 * and encounter documents are projected to owned typed values; generic whole
 * resource snapshots never enter the private durable result.
 */
export const createAcceptedMoveCompensationResult = (input: {
  readonly mapSlug: string
  readonly originOperationId: string
  readonly plan: MoveStateChangePlan
}): AcceptedMoveCompensationResult => parseAcceptedMoveCompensationResult({
  schemaVersion: ACCEPTED_MOVE_COMPENSATION_SCHEMA_VERSION,
  mapSlug: input.mapSlug,
  originOperationId: input.originOperationId,
  operations: input.plan.changes.flatMap(operationsForChange),
})

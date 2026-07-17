import { nextRevision, normalizeRevision } from '#shared/sessionRevisions'
import {
  createEmptyEncounterState,
  parseEncounterState,
} from '#shared/moveAutomation/encounterState'
import type { CharacterSheet } from '~/types/characterSheet'
import type { GroupInventoryDocument } from '~/types/groupInventory'
import type { TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { deepCloneJson } from '~/utils/serialization'
import {
  createMoveStateChangePlan,
  unavailableMoveStateCompensation,
  type MoveStateChangeInput,
} from './plan'
import {
  reduceMoveItemMutations,
  type ReduceMoveItemMutationsInput,
} from './reducers/itemMutations'
import type {
  MoveItemGroupInventoryResourceReduction,
  MoveItemGroupInventoryWritePlan,
  MoveItemMapResourceReduction,
  MoveItemSheetResourceReduction,
  MoveItemSheetWritePlan,
  PlannedMoveItemMutations,
} from './itemMutationTypes'

export interface PlanMoveItemMutationsInput extends ReduceMoveItemMutationsInput {
  readonly plannedAt: number
}

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

const provenance = (resource: {
  readonly operationIds: readonly string[]
  readonly reasonCodes: readonly string[]
}): { readonly sourceOperationId: string | null; readonly reasonCode: string } => (
  resource.operationIds.length === 1 && resource.reasonCodes.length === 1
    ? {
        sourceOperationId: resource.operationIds[0]!,
        reasonCode: resource.reasonCodes[0]!,
      }
    : {
        sourceOperationId: null,
        reasonCode: 'move-item-mutations',
      }
)

const itemCompensation = () => unavailableMoveStateCompensation(
  'accepted-item-mutation-may-be-observed',
  'externally-observed',
)

const normalizedPreviousSheet = (
  reduction: MoveItemSheetResourceReduction,
): CharacterSheet | TrainerSheet => ({
  ...deepCloneJson(reduction.previous),
  slug: reduction.slug,
  revision: reduction.expectedRevision,
}) as CharacterSheet | TrainerSheet

const sheetWrite = (
  reduction: MoveItemSheetResourceReduction,
  plannedAt: number,
): {
  readonly input: MoveStateChangeInput
  readonly write: MoveItemSheetWritePlan
} => {
  const previous = normalizedPreviousSheet(reduction)
  const revision = nextRevision(reduction.expectedRevision)
  const next = {
    ...deepCloneJson(reduction.current),
    slug: reduction.slug,
    revision,
    updatedAt: plannedAt,
  } as unknown as CharacterSheet | TrainerSheet
  const source = provenance(reduction)
  return {
    input: {
      kind: 'sheet-state',
      scope: {
        kind: 'sheet',
        sheetKind: reduction.sheetKind,
        sheetSlug: reduction.slug,
      },
      expectedRevision: reduction.expectedRevision,
      sourceOperationId: source.sourceOperationId,
      reasonCode: source.reasonCode,
      previous,
      current: next,
      changedFields: [...reduction.changedFields],
      compensation: itemCompensation(),
    },
    write: {
      kind: reduction.sheetKind,
      slug: reduction.slug,
      expectedRevision: reduction.expectedRevision,
      revision,
      previousSheet: deepCloneJson(previous),
      nextSheet: deepCloneJson(next),
      changedFields: [...reduction.changedFields],
    },
  }
}

const normalizedPreviousGroupInventory = (
  reduction: MoveItemGroupInventoryResourceReduction,
): GroupInventoryDocument => ({
  ...deepCloneJson(reduction.previous),
  slug: reduction.slug,
  revision: reduction.expectedRevision,
})

const groupInventoryWrite = (
  reduction: MoveItemGroupInventoryResourceReduction,
  plannedAt: number,
): {
  readonly input: MoveStateChangeInput
  readonly write: MoveItemGroupInventoryWritePlan
} => {
  const previous = normalizedPreviousGroupInventory(reduction)
  const revision = nextRevision(reduction.expectedRevision)
  const next: GroupInventoryDocument = {
    ...deepCloneJson(reduction.current),
    slug: reduction.slug,
    revision,
    updatedAt: plannedAt,
  }
  const source = provenance(reduction)
  return {
    input: {
      kind: 'group-inventory-state',
      scope: {
        kind: 'external-resource',
        resourceKind: 'group-inventory',
        resourceId: reduction.slug,
      },
      expectedRevision: reduction.expectedRevision,
      sourceOperationId: source.sourceOperationId,
      reasonCode: source.reasonCode,
      previous,
      current: next,
      compensation: itemCompensation(),
    },
    write: {
      slug: reduction.slug,
      expectedRevision: reduction.expectedRevision,
      revision,
      previousDocument: deepCloneJson(previous),
      nextDocument: deepCloneJson(next),
    },
  }
}

const mapStateChange = (
  reduction: MoveItemMapResourceReduction,
): MoveStateChangeInput => {
  const source = provenance(reduction)
  return {
    kind: 'encounter-state',
    scope: { kind: 'encounter', mapSlug: reduction.slug },
    expectedRevision: reduction.expectedRevision,
    sourceOperationId: source.sourceOperationId,
    reasonCode: source.reasonCode,
    previous: parseEncounterState(
      reduction.previous.encounterState ?? createEmptyEncounterState(),
    ),
    current: parseEncounterState(
      reduction.current.encounterState ?? createEmptyEncounterState(),
    ),
    compensation: itemCompensation(),
  }
}

/**
 * Convert pure item reductions into one CAS write per physical resource.
 * Revisions advance once regardless of how many operations touched a shared
 * sheet, group inventory, or map during the plan.
 */
export const planMoveItemMutations = (
  input: PlanMoveItemMutationsInput,
): PlannedMoveItemMutations => {
  if (!Number.isSafeInteger(input.plannedAt) || input.plannedAt < 0) {
    throw new Error('Move item mutation plannedAt must be a safe non-negative integer.')
  }
  const reduced = reduceMoveItemMutations(input)
  const stateChangeInputs: MoveStateChangeInput[] = []
  const sheetWrites: MoveItemSheetWritePlan[] = []
  const groupInventoryWrites: MoveItemGroupInventoryWritePlan[] = []
  let nextMap = deepCloneJson(input.map)

  for (const resource of reduced.resources) {
    if (resource.kind === 'sheet') {
      const planned = sheetWrite(resource, input.plannedAt)
      stateChangeInputs.push(planned.input)
      sheetWrites.push(planned.write)
      continue
    }
    if (resource.kind === 'group-inventory') {
      const planned = groupInventoryWrite(resource, input.plannedAt)
      stateChangeInputs.push(planned.input)
      groupInventoryWrites.push(planned.write)
      continue
    }
    stateChangeInputs.push(mapStateChange(resource))
    nextMap = {
      ...deepCloneJson(resource.current),
      slug: resource.slug,
      revision: nextRevision(resource.expectedRevision),
      updatedAt: input.plannedAt,
    }
  }

  if (!reduced.resources.some(resource => resource.kind === 'map')) {
    nextMap = {
      ...nextMap,
      revision: normalizeRevision(input.map.revision),
    }
  }

  return deepFreeze({
    previousMap: deepCloneJson(input.map),
    nextMap: deepCloneJson(nextMap),
    stateChanges: createMoveStateChangePlan(stateChangeInputs),
    sheetWrites,
    groupInventoryWrites,
    operationResults: reduced.operationResults,
    consumedItems: reduced.consumedItems,
    availableConsumedItems: reduced.availableConsumedItems,
  })
}

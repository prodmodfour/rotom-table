import { nextRevision } from '#shared/sessionRevisions'
import type { ItemAggregateRef, ItemOperationPlanV1 } from '#shared/itemAutomation/operations'
import type { CharacterSheet } from '~/types/characterSheet'
import type { GroupInventoryDocument } from '~/types/groupInventory'
import type { TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import type { AnyLiveSheet } from '~/utils/sheetMutations'
import { sameJsonValue } from '~/utils/serialization'
import type {
  ItemOperationCompensationV1,
  ItemOperationCompensationSheetV1,
} from '../../storage/itemOperationRepository'

export type ItemCorrectionPlanErrorCode =
  | 'invalid-operation'
  | 'missing-resource'
  | 'resource-revision-conflict'
  | 'current-value-conflict'
  | 'unsupported-compensation'
  | 'invalid-restored-value'

export class ItemCorrectionPlanError extends Error {
  readonly code: ItemCorrectionPlanErrorCode

  constructor(code: ItemCorrectionPlanErrorCode, message: string) {
    super(message)
    this.name = 'ItemCorrectionPlanError'
    this.code = code
  }
}

export interface ItemCorrectionSheetSnapshot {
  readonly kind: 'pokemon' | 'trainer'
  readonly slug: string
  readonly revision: number
  readonly sheet: AnyLiveSheet
}

export interface ItemCorrectionSnapshot {
  readonly map: TabletopMap | null
  readonly sheets: ReadonlyMap<string, ItemCorrectionSheetSnapshot>
  readonly groupInventory: GroupInventoryDocument | null
}

export interface ItemCorrectionPlan {
  readonly operationIds: readonly string[]
  readonly restoredInventory: boolean
  readonly map: TabletopMap | null
  readonly sheets: ReadonlyMap<string, AnyLiveSheet>
  readonly groupInventory: GroupInventoryDocument | null
  readonly changedSheetKeys: readonly string[]
  readonly mapChanged: boolean
  readonly groupInventoryChanged: boolean
}

const fail = (code: ItemCorrectionPlanErrorCode, message: string): never => {
  throw new ItemCorrectionPlanError(code, message)
}

const sheetKey = (kind: 'pokemon' | 'trainer', slug: string): string => `${kind}:${slug}`
const normalizedAggregateKey = (ref: ItemAggregateRef): string => ref.kind === 'sheet'
  ? `sheet:${ref.sheetKind}:${ref.id}`
  : ref.kind === 'encounter' ? `map:${ref.id}` : `${ref.kind}:${ref.id}`

const touchedRevisions = (plan: ItemOperationPlanV1): ReadonlyMap<string, number> => {
  const values = new Map<string, number>()
  for (const operation of plan.operations) {
    const ref = plan.readSet.find(candidate => {
      if (candidate.kind === 'sheet' && operation.aggregate.kind === 'sheet') {
        return candidate.sheetKind === operation.aggregate.sheetKind && candidate.id === operation.aggregate.id
      }
      return candidate.kind === operation.aggregate.kind && candidate.id === operation.aggregate.id
    })
    if (!ref || ref.revision !== operation.aggregate.revision) {
      fail('invalid-operation', `Correction aggregate ${normalizedAggregateKey(operation.aggregate)} is absent from the accepted read set.`)
    }
    const key = normalizedAggregateKey(operation.aggregate)
    const prior = values.get(key)
    if (prior !== undefined && prior !== operation.aggregate.revision) {
      fail('invalid-operation', `Correction aggregate ${key} has conflicting accepted revisions.`)
    }
    values.set(key, operation.aggregate.revision)
  }
  return values
}

const assertEvidenceShape = (
  plan: ItemOperationPlanV1,
  compensation: ItemOperationCompensationV1,
): ReadonlyMap<string, number> => {
  if (compensation.schemaVersion !== 1) fail('invalid-operation', 'Item compensation has an unsupported schema version.')
  const expected = touchedRevisions(plan)
  const actual = new Set<string>()
  if (compensation.map) actual.add(`map:${compensation.map.slug}`)
  if (compensation.groupInventory) actual.add(`group-inventory:${compensation.groupInventory.slug}`)
  for (const sheet of compensation.sheets) {
    const key = `sheet:${sheet.kind}:${sheet.slug}`
    if (actual.has(key)) fail('invalid-operation', `Item compensation duplicates ${key}.`)
    actual.add(key)
  }
  if (actual.size !== expected.size || [...actual].some(key => !expected.has(key))) {
    fail('invalid-operation', 'Item compensation write set does not match its accepted deterministic plan.')
  }
  const assertRevisionPair = (key: string, before: number, after: number): void => {
    const expectedBefore = expected.get(key)
    if (expectedBefore === undefined || before !== expectedBefore || after !== nextRevision(before)) {
      fail('invalid-operation', `Item compensation revisions for ${key} do not match the accepted write.`)
    }
  }
  if (compensation.map) {
    assertRevisionPair(`map:${compensation.map.slug}`, compensation.map.beforeRevision, compensation.map.afterRevision)
    if (sameJsonValue(compensation.map.beforeMap, compensation.map.afterMap)) {
      fail('invalid-operation', 'Item map compensation does not record a state change.')
    }
  }
  if (compensation.groupInventory) {
    const group = compensation.groupInventory
    assertRevisionPair(`group-inventory:${group.slug}`, group.beforeRevision, group.afterRevision)
    if (sameJsonValue(group.beforeDocument, group.afterDocument)) {
      fail('invalid-operation', 'Item group-inventory compensation does not record a state change.')
    }
  }
  for (const sheet of compensation.sheets) {
    assertRevisionPair(`sheet:${sheet.kind}:${sheet.slug}`, sheet.beforeRevision, sheet.afterRevision)
    if (sameJsonValue(sheet.beforeSheet, sheet.afterSheet)) {
      fail('invalid-operation', `Item sheet compensation for ${sheet.kind}/${sheet.slug} does not record a state change.`)
    }
  }
  return expected
}

const findSheet = (
  values: ReadonlyMap<string, ItemCorrectionSheetSnapshot>,
  evidence: ItemOperationCompensationSheetV1,
): ItemCorrectionSheetSnapshot => values.get(sheetKey(evidence.kind, evidence.slug))
  ?? fail('missing-resource', `Corrected ${evidence.kind} sheet ${evidence.slug} is unavailable.`)

/**
 * Restore only from immutable before/after documents captured in the same accepted transaction.
 * Exact after-document equality prevents correction from overwriting any later state at the same authority.
 */
export const planItemOperationCorrection = (input: {
  readonly plan: ItemOperationPlanV1
  readonly compensation: ItemOperationCompensationV1
  readonly snapshot: ItemCorrectionSnapshot
  readonly updatedAt: number
}): ItemCorrectionPlan => {
  if (input.plan.operations.length === 0) fail('invalid-operation', 'Accepted item operation has no compensable operations.')
  assertEvidenceShape(input.plan, input.compensation)
  const restoredInventory = input.plan.operations.some(operation => operation.kind === 'inventory'
    && operation.payload.action === 'consume' && operation.payload.reservationOnly !== true)
  const correctsReusableTool = input.plan.operations.some(operation => operation.kind === 'resource'
    && operation.aggregate.kind === 'sheet' && operation.payload.action === 'drain-ap')
  if (!restoredInventory && !correctsReusableTool) {
    fail('unsupported-compensation', 'The accepted operation has no consumed inventory or reviewed reusable-tool state to restore.')
  }

  let map = input.snapshot.map ? structuredClone(input.snapshot.map) : null
  const sheets = new Map([...input.snapshot.sheets].map(([key, value]) => [key, structuredClone(value.sheet)]))
  let groupInventory = input.snapshot.groupInventory ? structuredClone(input.snapshot.groupInventory) : null
  const changedSheetKeys: string[] = []
  if (!Number.isSafeInteger(input.updatedAt) || input.updatedAt < 0) {
    fail('invalid-operation', 'Item correction updatedAt must be a safe non-negative timestamp.')
  }
  const compensationUpdatedAt = input.updatedAt

  const mapEvidence = input.compensation.map
  if (mapEvidence) {
    const currentMap = input.snapshot.map
      ?? fail('missing-resource', `Corrected map ${mapEvidence.slug} is unavailable.`)
    if (currentMap.slug !== mapEvidence.slug) {
      fail('missing-resource', `Corrected map ${mapEvidence.slug} is unavailable.`)
    }
    if (currentMap.revision !== mapEvidence.afterRevision) {
      fail('resource-revision-conflict', `Map ${mapEvidence.slug} changed after the accepted item operation.`)
    }
    const expectedAfter = { ...mapEvidence.afterMap, revision: mapEvidence.afterRevision }
    if (!sameJsonValue(currentMap, expectedAfter)) {
      fail('current-value-conflict', `Map ${mapEvidence.slug} no longer matches the accepted item result.`)
    }
    map = structuredClone({
      ...mapEvidence.beforeMap,
      revision: mapEvidence.afterRevision,
      updatedAt: compensationUpdatedAt,
    }) as unknown as TabletopMap
  }

  for (const evidence of input.compensation.sheets) {
    const current = findSheet(input.snapshot.sheets, evidence)
    if (current.revision !== evidence.afterRevision) {
      fail('resource-revision-conflict', `${evidence.kind} sheet ${evidence.slug} changed after the accepted item operation.`)
    }
    const expectedAfter = { ...evidence.afterSheet, revision: evidence.afterRevision }
    if (!sameJsonValue(current.sheet, expectedAfter)) {
      fail('current-value-conflict', `${evidence.kind} sheet ${evidence.slug} no longer matches the accepted item result.`)
    }
    const key = sheetKey(evidence.kind, evidence.slug)
    sheets.set(key, structuredClone({
      ...evidence.beforeSheet,
      revision: evidence.afterRevision,
      updatedAt: compensationUpdatedAt,
    }) as unknown as CharacterSheet | TrainerSheet)
    changedSheetKeys.push(key)
  }

  const groupEvidence = input.compensation.groupInventory
  if (groupEvidence) {
    const currentGroupInventory = input.snapshot.groupInventory
      ?? fail('missing-resource', `Corrected group inventory ${groupEvidence.slug} is unavailable.`)
    if (currentGroupInventory.slug !== groupEvidence.slug) {
      fail('missing-resource', `Corrected group inventory ${groupEvidence.slug} is unavailable.`)
    }
    if (currentGroupInventory.revision !== groupEvidence.afterRevision) {
      fail('resource-revision-conflict', `Group inventory ${groupEvidence.slug} changed after the accepted item operation.`)
    }
    const expectedAfter = { ...groupEvidence.afterDocument, revision: groupEvidence.afterRevision }
    if (!sameJsonValue(currentGroupInventory, expectedAfter)) {
      fail('current-value-conflict', `Group inventory ${groupEvidence.slug} no longer matches the accepted item result.`)
    }
    groupInventory = structuredClone({
      ...groupEvidence.beforeDocument,
      revision: groupEvidence.afterRevision,
      updatedAt: compensationUpdatedAt,
    }) as unknown as GroupInventoryDocument
  }

  return Object.freeze({
    operationIds: Object.freeze(input.plan.operations.map(operation => operation.operationId)),
    restoredInventory,
    map,
    sheets,
    groupInventory,
    changedSheetKeys: Object.freeze(changedSheetKeys.sort()),
    mapChanged: mapEvidence !== null,
    groupInventoryChanged: groupEvidence !== null,
  })
}

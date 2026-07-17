import { deepCloneJson, sameJsonValue } from '~/utils/serialization'
import {
  MOVE_SHEET_STATE_FIELDS,
  RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  type MoveStateChangeCompensation,
  type MoveStateChangeInput,
} from './plan'

type MoveSheetStateChangeInput = Extract<MoveStateChangeInput, { readonly kind: 'sheet-state' }>
type JsonObject = Readonly<Record<string, unknown>>

export type MoveSheetStateChangeMergeErrorCode =
  | 'incompatible-snapshot'
  | 'conflicting-field-owner'
  | 'conflicting-write'

export class MoveSheetStateChangeMergeError extends Error {
  readonly code: MoveSheetStateChangeMergeErrorCode

  constructor(code: MoveSheetStateChangeMergeErrorCode, message: string) {
    super(message)
    this.name = 'MoveSheetStateChangeMergeError'
    this.code = code
  }
}

const fail = (
  code: MoveSheetStateChangeMergeErrorCode,
  message: string,
): never => {
  throw new MoveSheetStateChangeMergeError(code, message)
}

const isJsonObject = (value: unknown): value is JsonObject => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

/** Three-way merge detached JSON documents, rejecting overlapping divergent writes. */
const mergeDisjointJsonChanges = (
  previous: unknown,
  left: unknown,
  right: unknown,
  path: string,
): unknown => {
  if (sameJsonValue(left, right)) return deepCloneJson(left)
  if (sameJsonValue(left, previous)) return deepCloneJson(right)
  if (sameJsonValue(right, previous)) return deepCloneJson(left)
  if (!isJsonObject(previous) || !isJsonObject(left) || !isJsonObject(right)) {
    return fail(
      'conflicting-write',
      `Native sheet operations contain conflicting writes at ${path}.`,
    )
  }

  const merged: Record<string, unknown> = {}
  const keys = new Set([
    ...Object.keys(previous),
    ...Object.keys(left),
    ...Object.keys(right),
  ])
  for (const key of keys) {
    const value = mergeDisjointJsonChanges(
      previous[key],
      left[key],
      right[key],
      `${path}.${key}`,
    )
    if (value !== undefined) merged[key] = value
  }
  return merged
}

const mergedCompensation = (
  left: MoveStateChangeCompensation,
  right: MoveStateChangeCompensation,
): MoveStateChangeCompensation => {
  if (left.kind === 'unavailable') return deepCloneJson(left)
  if (right.kind === 'unavailable') return deepCloneJson(right)
  return RESTORE_PREVIOUS_MOVE_STATE_VALUE
}

/**
 * Merge independently reduced operations for one physical sheet into one CAS
 * write. Only disjoint typed fields from an identical before-revision may be
 * combined; overlap fails closed rather than relying on reducer order.
 */
export const mergeDisjointMoveSheetStateChanges = (
  inputs: readonly MoveStateChangeInput[],
): readonly MoveStateChangeInput[] => {
  const merged: MoveStateChangeInput[] = []
  const indexBySheet = new Map<string, number>()

  for (const input of inputs) {
    if (input.kind !== 'sheet-state') {
      merged.push(input)
      continue
    }
    const key = `${input.scope.sheetKind}:${input.scope.sheetSlug}`
    const existingIndex = indexBySheet.get(key)
    if (existingIndex === undefined) {
      indexBySheet.set(key, merged.length)
      merged.push(input)
      continue
    }

    const existing = merged[existingIndex] as MoveSheetStateChangeInput
    if (
      existing.expectedRevision !== input.expectedRevision
      || !sameJsonValue(existing.previous, input.previous)
    ) {
      return fail(
        'incompatible-snapshot',
        `Native sheet operations observed incompatible snapshots for ${key}.`,
      )
    }
    const existingFields = new Set(existing.changedFields)
    const overlap = input.changedFields.find(field => existingFields.has(field))
    if (overlap) {
      return fail(
        'conflicting-field-owner',
        `Native sheet operations both own ${key} field ${overlap}.`,
      )
    }
    const changedFieldSet = new Set([...existing.changedFields, ...input.changedFields])
    merged[existingIndex] = {
      ...existing,
      sourceOperationId: existing.sourceOperationId === input.sourceOperationId
        ? existing.sourceOperationId
        : null,
      reasonCode: 'combined-sheet-operations',
      current: mergeDisjointJsonChanges(
        existing.previous,
        existing.current,
        input.current,
        key,
      ) as MoveSheetStateChangeInput['current'],
      changedFields: MOVE_SHEET_STATE_FIELDS.filter(field => changedFieldSet.has(field)),
      compensation: mergedCompensation(existing.compensation, input.compensation),
    }
  }

  return merged
}

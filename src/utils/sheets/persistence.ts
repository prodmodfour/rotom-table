import { stableJsonStringify } from '../serialization'

type DerivedSheetRuntimeField = 'folder' | 'sessionPlayerAccessible' | 'playerProfileAccessible'

const DERIVED_SHEET_RUNTIME_FIELDS = [
  'folder',
  'sessionPlayerAccessible',
  'playerProfileAccessible',
] as const satisfies readonly DerivedSheetRuntimeField[]

/**
 * Sheet `folder` values and temporary player-access markers are derived from
 * runtime API context and should not be persisted inside the JSON document
 * itself. Keep this helper shallow and JSON-record oriented so it is safe for
 * both client autosave payloads and server-side filesystem writes.
 */
export const stripDerivedSheetRuntimeFields = <T extends object>(sheet: T): Omit<T, DerivedSheetRuntimeField> => {
  const payload = { ...sheet }
  for (const field of DERIVED_SHEET_RUNTIME_FIELDS) delete (payload as Record<string, unknown>)[field]
  return payload as Omit<T, DerivedSheetRuntimeField>
}

export const stripDerivedSheetFolder = stripDerivedSheetRuntimeFields

export const toPersistableSheetPayload = <T extends object>(sheet: T): Record<string, unknown> =>
  stripDerivedSheetRuntimeFields(sheet) as Record<string, unknown>

export const stablePersistableSheetJson = <T extends object>(sheet: T): string =>
  stableJsonStringify(toPersistableSheetPayload(sheet))

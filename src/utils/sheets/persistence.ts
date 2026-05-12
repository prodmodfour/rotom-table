import { stableJsonStringify } from '../serialization'

/**
 * Sheet `folder` values are derived from the sheet file path and should not be
 * persisted inside the JSON document itself. Keep this helper shallow and
 * JSON-record oriented so it is safe for both client autosave payloads and
 * server-side filesystem writes.
 */
export const stripDerivedSheetFolder = <T extends object>(sheet: T): Omit<T, 'folder'> => {
  const payload = { ...sheet }
  delete (payload as Record<string, unknown>).folder
  return payload as Omit<T, 'folder'>
}

export const toPersistableSheetPayload = <T extends object>(sheet: T): Record<string, unknown> =>
  stripDerivedSheetFolder(sheet) as Record<string, unknown>

export const stablePersistableSheetJson = <T extends object>(sheet: T): string =>
  stableJsonStringify(toPersistableSheetPayload(sheet))

import type { TabletopMap } from '~/types/map'
import { stableJsonStringify } from '../serialization'

/**
 * Map `folder` values are derived from the map file path and should not be
 * persisted inside the JSON document itself. Keep this helper shallow and
 * JSON-record oriented so it is safe for both client autosave payloads and
 * server-side filesystem writes.
 */
export const stripDerivedMapFolder = <T extends object>(map: T): Omit<T, 'folder'> => {
  const payload = { ...map }
  delete (payload as Record<string, unknown>).folder
  return payload as Omit<T, 'folder'>
}

export const toPersistableMapPayload = <T extends object>(map: T): Record<string, unknown> =>
  stripDerivedMapFolder(map) as Record<string, unknown>

export const stablePersistableMapJson = <T extends object>(map: T): string =>
  stableJsonStringify(toPersistableMapPayload(map))

export const clonePersistableMapPayload = (map: TabletopMap): TabletopMap =>
  JSON.parse(JSON.stringify(toPersistableMapPayload(map))) as TabletopMap

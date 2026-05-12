import type { AutosaveSnapshotTracker } from './autosaveTypes'

/**
 * Tracks the last server-acknowledged serialized value for an autosaved
 * resource. Keeping the comparison boundary here makes map/sheet autosave
 * flows explicit about which JSON shape is considered persisted while
 * avoiding duplicated `lastServerJson` mutation and comparison code.
 */
export const createAutosaveSnapshotTracker = <T>(
  serialize: (value: T) => string,
  initialValue?: T,
): AutosaveSnapshotTracker<T> => {
  let lastCleanJson = initialValue === undefined ? '' : serialize(initialValue)

  const markCleanJson = (json: string): string => {
    lastCleanJson = json
    return lastCleanJson
  }

  const markClean = (value: T): string => markCleanJson(serialize(value))

  return {
    currentJson: () => lastCleanJson,
    serialize,
    markClean,
    markCleanJson,
    isClean: (value: T) => serialize(value) === lastCleanJson,
    isCleanJson: (json: string) => json === lastCleanJson,
    isDirty: (value: T) => serialize(value) !== lastCleanJson,
  }
}

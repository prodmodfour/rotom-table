import directoryJson from '../../data/feature-automation/class-directory.json'
import { CANONICAL_FEATURE_IDS } from './catalog'
import { FEATURE_AUTOMATION_RULESET_ID } from './ruleset'

export interface FeatureClassDirectoryEntry {
  readonly className: string
  readonly anchorCanonicalId: string | null
  readonly canonicalIds: readonly string[]
}
export interface FeatureClassDirectory {
  readonly schemaVersion: 1
  readonly rulesetId: typeof FEATURE_AUTOMATION_RULESET_ID
  readonly classCount: number
  readonly classAnchorCount: number
  readonly classes: readonly FeatureClassDirectoryEntry[]
  readonly unownedCanonicalIds: readonly string[]
}
const directory = directoryJson as unknown as FeatureClassDirectory
const ids = new Set(CANONICAL_FEATURE_IDS)
if (directory.schemaVersion !== 1 || directory.rulesetId !== FEATURE_AUTOMATION_RULESET_ID || directory.classCount !== directory.classes.length || directory.classes.some(entry => !entry.className || entry.canonicalIds.some(id => !ids.has(id))) || directory.unownedCanonicalIds.some(id => !ids.has(id))) throw new Error('Feature class directory is malformed.')
export const FEATURE_CLASS_DIRECTORY = Object.freeze(directory)
export const FEATURE_CLASS_BY_NAME: ReadonlyMap<string, FeatureClassDirectoryEntry> = new Map(directory.classes.map(entry => [entry.className, Object.freeze(entry)]))
export const FEATURE_CLASS_BY_CANONICAL_ID: ReadonlyMap<string, FeatureClassDirectoryEntry> = new Map(directory.classes.flatMap(entry => entry.canonicalIds.map(id => [id, Object.freeze(entry)] as const)))

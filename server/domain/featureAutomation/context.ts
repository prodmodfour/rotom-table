import type { FeatureResourceScope } from './resources'
import type { TrainerSheet } from '~/types/trainerSheet'

export interface FeatureReadSetEntry {
  readonly resourceId: string
  readonly revision: number
  readonly visibility: 'public' | 'owner' | 'gm'
}
export interface FeatureAuthoritativeContext {
  readonly schemaVersion: 1
  readonly trainerSheet: TrainerSheet
  readonly actorId: string
  readonly authorizedTargetIds: ReadonlySet<string>
  readonly acceptedTriggerEventIds: ReadonlySet<string>
  readonly authorizedActionTypes: ReadonlySet<string>
  readonly authorizedChoiceValues: ReadonlyMap<string, ReadonlySet<string>>
  readonly scope: FeatureResourceScope
  readonly readSet: readonly FeatureReadSetEntry[]
  readonly causalDepth: number
  readonly causalSourceIds: readonly string[]
}

const stableId = (value: string): boolean => /^[A-Za-z0-9]+(?:[._:/-][A-Za-z0-9]+)*$/.test(value)

/** Build a bounded immutable context from server-owned snapshots. */
export const createFeatureAuthoritativeContext = (input: Omit<FeatureAuthoritativeContext, 'schemaVersion'>): FeatureAuthoritativeContext => {
  if (!stableId(input.actorId)) throw new Error('Feature context actor ID is invalid.')
  if (!Number.isSafeInteger(input.causalDepth) || input.causalDepth < 0 || input.causalDepth > 24) throw new Error('Feature causal budget is exhausted.')
  if (input.authorizedTargetIds.size > 256 || input.acceptedTriggerEventIds.size > 1024 || input.authorizedChoiceValues.size > 16 || [...input.authorizedChoiceValues.values()].some(values => values.size > 128) || input.readSet.length > 512 || input.causalSourceIds.length > 64) throw new Error('Feature context exceeds its authority budget.')
  const readSetIds = new Set<string>()
  const readSet = input.readSet.map(entry => {
    if (!stableId(entry.resourceId) || !Number.isSafeInteger(entry.revision) || entry.revision < 0 || readSetIds.has(entry.resourceId)) throw new Error('Feature context read set is invalid.')
    readSetIds.add(entry.resourceId)
    return Object.freeze({ ...entry })
  })
  if (!readSetIds.has(`sheet:trainer:${input.trainerSheet.slug}`)) throw new Error('Feature context must include the Trainer sheet revision.')
  return Object.freeze({
    schemaVersion: 1,
    trainerSheet: structuredClone(input.trainerSheet),
    actorId: input.actorId,
    authorizedTargetIds: new Set(input.authorizedTargetIds),
    acceptedTriggerEventIds: new Set(input.acceptedTriggerEventIds),
    authorizedActionTypes: new Set(input.authorizedActionTypes),
    authorizedChoiceValues: new Map([...input.authorizedChoiceValues].map(([key, values]) => [key, new Set(values)])),
    scope: Object.freeze({ ...input.scope }),
    readSet: Object.freeze(readSet),
    causalDepth: input.causalDepth,
    causalSourceIds: Object.freeze([...input.causalSourceIds]),
  })
}

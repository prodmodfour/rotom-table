import {
  LIVE_PLAY_PATCH_TYPES,
  isLivePlayPatchType,
  type LivePlayPatchType,
  type LivePlayScope,
} from '#shared/livePlayCommands'
import type { LivePlayLocalPrediction } from '~/utils/livePlayPredictions'
import {
  findLivePlayScopeConflict,
  livePlayScopeConflictDescriptors,
  type LivePlayScopeConflict,
  type LivePlayScopeConflictDescriptor,
  type LivePlayScopeConflictSubject,
} from '~/utils/livePlayScopeConflicts'

export type LivePlayPredictionConflictPrediction = Pick<
  LivePlayLocalPrediction,
  'opId' | 'placementId' | 'commandType' | 'scopes'
> & {
  readonly command?: unknown
}

export type LivePlayPredictionConflictPredictionInput =
  | readonly LivePlayPredictionConflictPrediction[]
  | Readonly<Record<string, LivePlayPredictionConflictPrediction>>

export interface LivePlayPatchConflictSubject extends LivePlayScopeConflictSubject {
  readonly patchType: string
}

export interface FindLivePlayPredictionConflictsInput {
  readonly pendingPredictions: LivePlayPredictionConflictPredictionInput
  readonly patches: readonly unknown[]
}

export interface LivePlayPredictionPatchConflict {
  readonly opId: string
  readonly placementId: string
  readonly commandType: string
  readonly patchType: string
  readonly patchIndex: number
  readonly conflict: LivePlayScopeConflict
}

export interface LivePlayPredictionConflictSummary {
  readonly hasConflicts: boolean
  readonly conflicts: readonly LivePlayPredictionPatchConflict[]
}

type JsonRecord = Record<string, unknown>

const CONSERVATIVE_UNKNOWN_SCOPES = [
  { kind: 'unknown-live-play-patch' },
] as unknown as readonly LivePlayScope[]

const BROAD_PATCH_TYPES = new Set<LivePlayPatchType>([
  LIVE_PLAY_PATCH_TYPES.MAP_INITIATIVE,
  LIVE_PLAY_PATCH_TYPES.MAP_HAZARDS,
  LIVE_PLAY_PATCH_TYPES.MAP_FIELD_EFFECTS,
  LIVE_PLAY_PATCH_TYPES.MAP_PLACEMENTS,
  LIVE_PLAY_PATCH_TYPES.MAP_SCENE,
  LIVE_PLAY_PATCH_TYPES.MAP_METADATA,
  LIVE_PLAY_PATCH_TYPES.MOVE_STATE,
  LIVE_PLAY_PATCH_TYPES.RECONCILIATION_REQUIRED,
])

const isRecord = (value: unknown): value is JsonRecord => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const patchTypeLabel = (patch: unknown): string => (
  isRecord(patch) && typeof patch.type === 'string' ? patch.type : 'unknown'
)

const conservativePatchSubject = (patch: unknown): LivePlayPatchConflictSubject => ({
  patchType: patchTypeLabel(patch),
  type: patchTypeLabel(patch),
  payload: isRecord(patch) ? patch.payload : undefined,
  command: patch,
  scopes: CONSERVATIVE_UNKNOWN_SCOPES,
})

const mapLaneDescriptorCount = (descriptors: readonly LivePlayScopeConflictDescriptor[]): number => (
  descriptors.filter((descriptor) => descriptor.kind === 'map-lane').length
)

const hasBroadMapLaneDescriptor = (subject: LivePlayScopeConflictSubject): boolean => (
  mapLaneDescriptorCount(livePlayScopeConflictDescriptors(subject)) > 0
)

/**
 * Convert an accepted server patch into the same scope-conflict input shape used
 * by local live-play command blocking. Unknown and whole-lane patches become an
 * unknown descriptor so prediction adoption can stay conservative.
 */
export const livePlayPatchConflictSubject = (patch: unknown): LivePlayPatchConflictSubject => {
  if (!isRecord(patch)) return conservativePatchSubject(patch)

  const patchType = patchTypeLabel(patch)
  if (!isLivePlayPatchType(patch.type)) return conservativePatchSubject(patch)
  if (!Array.isArray(patch.scopes)) return conservativePatchSubject(patch)
  if (BROAD_PATCH_TYPES.has(patch.type)) return conservativePatchSubject(patch)

  const subject: LivePlayPatchConflictSubject = {
    patchType,
    type: patchType,
    payload: patch.payload,
    command: patch,
    scopes: patch.scopes as readonly LivePlayScope[],
  }

  return hasBroadMapLaneDescriptor(subject) ? conservativePatchSubject(patch) : subject
}

export const livePlayPatchConflictDescriptors = (
  patch: unknown,
): readonly LivePlayScopeConflictDescriptor[] => livePlayScopeConflictDescriptors(livePlayPatchConflictSubject(patch))

const pendingPredictionList = (
  predictions: LivePlayPredictionConflictPredictionInput,
): readonly LivePlayPredictionConflictPrediction[] => (
  Array.isArray(predictions) ? predictions : Object.values(predictions)
)

const predictionConflictSubject = (
  prediction: LivePlayPredictionConflictPrediction,
): LivePlayScopeConflictSubject => ({
  scopes: prediction.scopes,
  command: prediction.command ?? prediction,
})

const predictionPatchConflict = (
  prediction: LivePlayPredictionConflictPrediction,
  patchSubject: LivePlayPatchConflictSubject,
  patchIndex: number,
): LivePlayPredictionPatchConflict | null => {
  const conflict = findLivePlayScopeConflict(predictionConflictSubject(prediction), patchSubject)
  if (!conflict) return null

  return {
    opId: prediction.opId,
    placementId: prediction.placementId,
    commandType: prediction.commandType,
    patchType: patchSubject.patchType,
    patchIndex,
    conflict,
  }
}

export const findLivePlayPredictionConflicts = ({
  pendingPredictions,
  patches,
}: FindLivePlayPredictionConflictsInput): LivePlayPredictionConflictSummary => {
  const predictions = pendingPredictionList(pendingPredictions)
  const conflicts: LivePlayPredictionPatchConflict[] = []

  patches.forEach((patch, patchIndex) => {
    const patchSubject = livePlayPatchConflictSubject(patch)
    for (const prediction of predictions) {
      const conflict = predictionPatchConflict(prediction, patchSubject, patchIndex)
      if (conflict) conflicts.push(conflict)
    }
  })

  return {
    hasConflicts: conflicts.length > 0,
    conflicts,
  }
}

export const livePlayPredictionsConflictWithPatches = (
  input: FindLivePlayPredictionConflictsInput,
): boolean => findLivePlayPredictionConflicts(input).hasConflicts

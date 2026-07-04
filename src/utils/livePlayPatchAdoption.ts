import type { LivePlayPatch } from '#shared/livePlayCommands'
import type { LivePlayLocalPrediction } from '~/utils/livePlayPredictions'

export type LivePlayPendingPredictionSnapshot = Readonly<Record<string, LivePlayLocalPrediction>>

export interface LivePlayPatchAdoptionContext {
  readonly mapSlug: string
  readonly opId?: string
  readonly previousRevision: number
  readonly nextRevision: number
  readonly patches: readonly LivePlayPatch[]
  readonly pendingPredictions: LivePlayPendingPredictionSnapshot
}

export type LivePlayPatchAdoptionHook = (context: LivePlayPatchAdoptionContext) => void

export interface LivePlayPatchAdoptionHooks {
  readonly beforeLivePlayPatchesApply?: LivePlayPatchAdoptionHook
  readonly afterLivePlayPatchesApply?: LivePlayPatchAdoptionHook
}

export interface CreateLivePlayPatchAdoptionContextInput {
  readonly mapSlug: string
  readonly opId?: string
  readonly previousRevision: number
  readonly nextRevision: number
  readonly patches: readonly LivePlayPatch[]
  readonly pendingPredictions?: LivePlayPendingPredictionSnapshot | null | undefined
}

export const createLivePlayPatchAdoptionContext = ({
  mapSlug,
  opId,
  previousRevision,
  nextRevision,
  patches,
  pendingPredictions,
}: CreateLivePlayPatchAdoptionContextInput): LivePlayPatchAdoptionContext => ({
  mapSlug,
  ...(opId === undefined ? {} : { opId }),
  previousRevision,
  nextRevision,
  patches: Object.freeze([...patches]),
  pendingPredictions: Object.freeze({ ...(pendingPredictions ?? {}) }),
})

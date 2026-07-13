import type { TabletopMap } from '~/types/map'
import type { RotomDatabase } from '../storage/database'
import type { MapRepository } from '../storage/mapRepository'

export interface CommitLivePlayMapUpdateInput {
  readonly database: Pick<RotomDatabase, 'withTransaction'>
  readonly mapRepository: Pick<MapRepository, 'applyLivePlayUpdate' | 'getBySlug'>
  readonly mapSlug: string
  readonly expectedRevision: number
  readonly nextMap: TabletopMap
  /** Runs inside the write transaction immediately before the map CAS. */
  readonly validateBeforeWrite?: () => void
  readonly staleError: () => Error
  readonly missingMapError: () => Error
  readonly saveOpResult: () => unknown
  readonly verify?: (authoritativeMap: TabletopMap) => void
}

export const commitLivePlayMapUpdate = (input: CommitLivePlayMapUpdateInput): TabletopMap => input.database.withTransaction(() => {
  input.validateBeforeWrite?.()
  const updateResult = input.mapRepository.applyLivePlayUpdate({
    slug: input.mapSlug,
    expectedRevision: input.expectedRevision,
    nextMap: input.nextMap,
  })
  if (updateResult === 'stale') throw input.staleError()

  input.saveOpResult()

  const authoritativeMap = input.mapRepository.getBySlug(input.mapSlug)
  if (!authoritativeMap) throw input.missingMapError()
  input.verify?.(authoritativeMap)
  return authoritativeMap
})

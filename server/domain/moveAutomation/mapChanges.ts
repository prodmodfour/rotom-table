import type { TabletopMap } from '~/types/map'
import { cloneMapFieldEffects } from '~/utils/mapFieldEffects'
import { deepCloneJson, sameJsonValue } from '~/utils/serialization'
import type { AdaptV1MapChanges } from './adaptV1Transaction'

type MutableAuthoritativeMoveMapChanges = {
  -readonly [Key in keyof AdaptV1MapChanges]?: AdaptV1MapChanges[Key]
}

/** Build the bounded aggregate map diff shared by legacy and native planners. */
export const buildAuthoritativeMoveMapChanges = (
  previousMap: TabletopMap,
  nextMap: TabletopMap,
): AdaptV1MapChanges => {
  const changes: MutableAuthoritativeMoveMapChanges = {}
  if (!sameJsonValue(previousMap.placements, nextMap.placements)) {
    changes.placements = {
      previous: deepCloneJson(previousMap.placements),
      current: deepCloneJson(nextMap.placements),
    }
  }
  if (!sameJsonValue(previousMap.temporaryHitPoints, nextMap.temporaryHitPoints)) {
    changes.temporaryHitPoints = {
      previous: deepCloneJson(previousMap.temporaryHitPoints),
      current: deepCloneJson(nextMap.temporaryHitPoints),
    }
  }
  if (!sameJsonValue(previousMap.moveUsage, nextMap.moveUsage)) {
    changes.moveUsage = {
      previous: deepCloneJson(previousMap.moveUsage),
      current: deepCloneJson(nextMap.moveUsage),
    }
  }
  if (!sameJsonValue(previousMap.hazards ?? [], nextMap.hazards ?? [])) {
    changes.hazards = {
      previous: deepCloneJson(previousMap.hazards ?? []),
      current: deepCloneJson(nextMap.hazards ?? []),
    }
  }
  if (!sameJsonValue(
    cloneMapFieldEffects(previousMap.fieldEffects),
    cloneMapFieldEffects(nextMap.fieldEffects),
  )) {
    changes.fieldEffects = {
      previous: cloneMapFieldEffects(previousMap.fieldEffects),
      current: cloneMapFieldEffects(nextMap.fieldEffects),
    }
  }
  if (!sameJsonValue(previousMap.metadata, nextMap.metadata)) {
    changes.metadata = {
      previous: deepCloneJson(previousMap.metadata),
      current: deepCloneJson(nextMap.metadata),
    }
  }
  return changes
}

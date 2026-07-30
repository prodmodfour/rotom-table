import {
  LIVE_PLAY_PATCH_TYPES,
  type LivePlayPatch,
} from '#shared/livePlayCommands'

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const stringIds = (value: unknown): readonly string[] => Array.isArray(value)
  ? value.filter((item): item is string => typeof item === 'string')
  : []

/**
 * Remove area identities that are not legal effect recipients from a shared
 * observer projection. The initiating HTTP response may retain reviewed
 * Friendly exclusions; map-wide player realtime must not.
 */
const redactResolvedMoveAreaForObserver = (
  value: unknown,
): unknown => {
  if (!isRecord(value) || !isRecord(value.area)) return value

  const selectedTargetIds = new Set(stringIds(value.selectedTargetIds))
  const {
    targetEvaluations: _targetEvaluations,
    relationshipExclusions: _relationshipExclusions,
    ...area
  } = value.area
  const candidateTargetIds = stringIds(area.candidateTargetIds)
    .filter(placementId => selectedTargetIds.has(placementId))

  const {
    auditTrace: _auditTrace,
    nativeV2: _nativeV2,
    sheetReads: _sheetReads,
    ...move
  } = value
  return {
    ...move,
    area: {
      ...area,
      candidateTargetIds,
      excludedTargetIds: [],
    },
  }
}

/**
 * Redact resolveMove patches for a map observer who did not submit the intent.
 * Other patch kinds are detached only by the surrounding realtime serializer.
 */
export const redactResolveMovePatchesForObserver = (
  patches: readonly LivePlayPatch[],
): readonly LivePlayPatch[] => patches.map((patch) => {
  if (patch.type !== LIVE_PLAY_PATCH_TYPES.MOVE_STATE || !isRecord(patch.payload)) {
    return patch
  }
  if (patch.payload.command !== 'resolveMove') return patch

  const sheets = Array.isArray(patch.payload.sheets)
    ? patch.payload.sheets.map((sheet) => {
        if (!isRecord(sheet) || !Array.isArray(sheet.changedFields)) return sheet
        return {
          ...sheet,
          changedFields: sheet.changedFields.filter(field => field !== 'loyalty'),
        }
      })
    : patch.payload.sheets
  return {
    ...patch,
    payload: {
      ...patch.payload,
      sheets,
      move: redactResolvedMoveAreaForObserver(patch.payload.move),
    },
  }
})

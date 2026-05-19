import type * as THREE from 'three'
import { normalizeConditionNames } from '~/utils/statusConditions'

export const ELEVATION_BADGE_PIXELS_PER_METRE = 48
export const TOKEN_STATUS_CSS_WIDTH_PX = 80
export const TOKEN_STATUS_WORLD_WIDTH = 1.05

const TOKEN_STATUS_BASE_CSS_HEIGHT_PX = 18
const TOKEN_STATUS_LABEL_LINE_CSS_HEIGHT_PX = 11
const TOKEN_STATUS_TURN_CHEVRON_CSS_HEIGHT_PX = 16
const TOKEN_STATUS_CONDITION_ROW_CSS_HEIGHT_PX = 15

export const TOKEN_STATUS_HEAD_GAP_EXTRA = 0.3

export const mapSpecificY = (absoluteY: number, groundLevelY: number) =>
  Math.round(absoluteY) - groundLevelY

export const formatElevationDelta = (localY: number): string =>
  localY > 0 ? `+${localY} ↑` : `${localY} ↓`

export const getElevationBadgeOffset = (
  center: THREE.Vector3,
  base: number,
  camera: THREE.Camera | null,
) => {
  const inset = Math.min(0.18, base / 4)
  const edgeOffset = Math.max(base / 2 - inset, 0)

  if (!camera) {
    return {
      x: edgeOffset,
      z: edgeOffset,
    }
  }

  return {
    x: (camera.position.x >= center.x ? 1 : -1) * edgeOffset,
    z: (camera.position.z >= center.z ? 1 : -1) * edgeOffset,
  }
}

export const formatTokenLevel = (level: number): string => {
  if (!Number.isFinite(level)) return '?'
  return String(Math.max(1, Math.floor(level)))
}

export const tokenStatusNameWords = (displayName: string): string[] => {
  const words = displayName.trim().split(/\s+/).filter(Boolean)
  return words.length ? words : ['Unknown']
}

export const tokenStatusLabelLineCount = (displayName: string): number => {
  const nameLines = tokenStatusNameWords(displayName).length
  return nameLines > 1 ? nameLines + 1 : 1
}

export const tokenStatusCssHeight = (
  displayName: string,
  conditions: readonly string[],
  activeTurn: boolean,
): number => {
  const conditionCount = normalizeConditionNames(conditions).length
  const turnHeight = activeTurn ? TOKEN_STATUS_TURN_CHEVRON_CSS_HEIGHT_PX : 0
  const conditionRows = conditionCount === 0 ? 0 : Math.ceil(conditionCount / 2)
  const labelExtraHeight = (tokenStatusLabelLineCount(displayName) - 1) * TOKEN_STATUS_LABEL_LINE_CSS_HEIGHT_PX
  return TOKEN_STATUS_BASE_CSS_HEIGHT_PX
    + labelExtraHeight
    + turnHeight
    + (conditionRows ? 1 + conditionRows * TOKEN_STATUS_CONDITION_ROW_CSS_HEIGHT_PX : 0)
}

export const hpTierForRatio = (ratio: number): 'critical' | 'wounded' | 'healthy' => {
  if (ratio <= 0.25) return 'critical'
  if (ratio <= 0.5) return 'wounded'
  return 'healthy'
}

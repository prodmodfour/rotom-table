import type { AuthRole } from '#shared/auth'
import type { GridAnchor, GridDimensions, TabletopMap } from '~/types/map'

/**
 * Visibility gate for map-scoped commands and compatibility routes.
 * This does not grant permission for player whole-map saves; `/api/maps/save`
 * is restricted to explicit GM setup/edit writes.
 */
export const canAccessMapForRole = (role: AuthRole, existing: TabletopMap): boolean =>
  role === 'gm' || existing.playerVisible === true

export const clampAnchorToDimensions = (
  value: unknown,
  fallback: GridAnchor,
  dimensions: GridDimensions,
): GridAnchor => {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<Record<keyof GridAnchor, unknown>>
    : {}

  const clampAxis = (axis: keyof GridAnchor, max: number): number => {
    const n = Number(record[axis])
    if (!Number.isFinite(n)) return fallback[axis]
    return Math.min(Math.max(0, Math.floor(max) - 1), Math.max(0, Math.round(n)))
  }

  return {
    x: clampAxis('x', dimensions.x ?? 1),
    y: clampAxis('y', dimensions.y ?? 1),
    z: clampAxis('z', dimensions.z ?? 1),
  }
}

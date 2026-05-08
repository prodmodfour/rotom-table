import type { AuthRole } from '~/shared/auth'
import type { GridAnchor, GridDimensions, SheetKind, SheetPlacement, TabletopMap } from '~/types/map'

export type SheetAccessPredicate = (kind: SheetKind, slug: string) => boolean

export const canSaveMap = (role: AuthRole, existing: TabletopMap): boolean =>
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

export const mergePlayerPlacementEdits = (
  existing: TabletopMap,
  incoming: TabletopMap,
  canControlSheet: SheetAccessPredicate,
): SheetPlacement[] => {
  const incomingById = new Map(
    (Array.isArray(incoming.placements) ? incoming.placements : []).map((placement) => [placement.id, placement]),
  )

  return (existing.placements ?? []).map((placement) => {
    if (!canControlSheet(placement.sheetKind, placement.sheetSlug)) return placement

    const next = incomingById.get(placement.id)
    if (!next || next.sheetKind !== placement.sheetKind || next.sheetSlug !== placement.sheetSlug) return placement

    return {
      ...placement,
      position: clampAnchorToDimensions(next.position, placement.position, existing.dimensions),
      turned: typeof next.turned === 'boolean' ? next.turned : placement.turned,
    }
  })
}

export const applyPlayerMapSavePolicy = (
  existing: TabletopMap,
  incoming: TabletopMap,
  canControlSheet: SheetAccessPredicate,
): TabletopMap => ({
  ...existing,
  placements: mergePlayerPlacementEdits(existing, incoming, canControlSheet),
})

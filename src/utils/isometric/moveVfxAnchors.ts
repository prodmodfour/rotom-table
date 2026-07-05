import * as THREE from 'three'
import type { GridAnchor } from '~/types/pokemon'
import { getAnchorCenter } from '~/utils/gridGeometry'
import type { PokemonRenderObject } from '~/utils/isometric/types'

/**
 * Token anchor names shared by VFX planners/primitives.
 *
 * Coordinate assumptions for all helpers in this module:
 * - map X/Z are the horizontal grid plane;
 * - Y is elevation above that plane;
 * - `PokemonRenderObject.currentCenter` is the token footprint centre at its
 *   current elevation / foot position;
 * - `base` is footprint width/depth in grid cells;
 * - `height` is visual sprite height, while `clearance` is the occupied
 *   height used by collision and tactical volume rendering.
 */
export const MOVE_VFX_TOKEN_ANCHOR = {
  foot: 'foot',
  center: 'center',
  chest: 'chest',
  head: 'head',
  aboveHead: 'above-head',
} as const

export type MoveVfxTokenAnchor = (typeof MOVE_VFX_TOKEN_ANCHOR)[keyof typeof MOVE_VFX_TOKEN_ANCHOR]

export interface MoveVfxAnchorPair {
  start: THREE.Vector3
  end: THREE.Vector3
}

export interface MoveVfxAnchorPairOptions {
  renderObjects: ReadonlyMap<string, PokemonRenderObject>
  userId: string
  targetId?: string | null
  originCell?: GridAnchor | null
  targetCell?: GridAnchor | null
  userAnchor?: MoveVfxTokenAnchor
  targetAnchor?: MoveVfxTokenAnchor
}

const ABOVE_HEAD_PADDING = 0.35
const CHEST_HEIGHT_RATIO = 0.58
const HEAD_HEIGHT_RATIO = 0.92
const MIN_CHEST_HEIGHT = 0.45
const MIN_HEAD_HEIGHT = 0.85

const safePositive = (value: number, fallback = 0): number => (
  Number.isFinite(value) ? Math.max(0, value) : fallback
)

const tokenBodyHeight = (renderObject: Pick<PokemonRenderObject, 'height' | 'clearance'>): number => Math.max(
  safePositive(renderObject.height),
  safePositive(renderObject.clearance),
)

const tokenVisualHeight = (renderObject: Pick<PokemonRenderObject, 'height' | 'clearance'>): number => {
  const height = safePositive(renderObject.height)
  return height > 0 ? height : safePositive(renderObject.clearance, 1)
}

const tokenAnchorY = (renderObject: PokemonRenderObject, anchor: MoveVfxTokenAnchor): number => {
  const footY = renderObject.currentCenter.y
  const visualHeight = tokenVisualHeight(renderObject)

  switch (anchor) {
    case MOVE_VFX_TOKEN_ANCHOR.foot:
      return footY
    case MOVE_VFX_TOKEN_ANCHOR.center:
      return footY + tokenBodyHeight(renderObject) / 2
    case MOVE_VFX_TOKEN_ANCHOR.chest:
      return footY + Math.max(visualHeight * CHEST_HEIGHT_RATIO, MIN_CHEST_HEIGHT)
    case MOVE_VFX_TOKEN_ANCHOR.head:
      return footY + Math.max(visualHeight * HEAD_HEIGHT_RATIO, MIN_HEAD_HEIGHT)
    case MOVE_VFX_TOKEN_ANCHOR.aboveHead:
      return footY + tokenBodyHeight(renderObject) + ABOVE_HEAD_PADDING
  }
}

/** Token footprint centre at current elevation, suitable for ground rings. */
export const moveVfxTokenFootAnchor = (renderObject: PokemonRenderObject): THREE.Vector3 => moveVfxTokenAnchor(
  renderObject,
  MOVE_VFX_TOKEN_ANCHOR.foot,
)

/** Midpoint of the visible/occupied token body, suitable for neutral flashes. */
export const moveVfxTokenCenterAnchor = (renderObject: PokemonRenderObject): THREE.Vector3 => moveVfxTokenAnchor(
  renderObject,
  MOVE_VFX_TOKEN_ANCHOR.center,
)

/** Upper-body origin/target point, suitable for most projectiles and beams. */
export const moveVfxTokenChestAnchor = (renderObject: PokemonRenderObject): THREE.Vector3 => moveVfxTokenAnchor(
  renderObject,
  MOVE_VFX_TOKEN_ANCHOR.chest,
)

/** Near-top token anchor, suitable for high beams, crits, and tall effects. */
export const moveVfxTokenHeadAnchor = (renderObject: PokemonRenderObject): THREE.Vector3 => moveVfxTokenAnchor(
  renderObject,
  MOVE_VFX_TOKEN_ANCHOR.head,
)

/** Anchor above the token body, suitable for labels, bursts, or rising effects. */
export const moveVfxTokenAboveHeadAnchor = (renderObject: PokemonRenderObject): THREE.Vector3 => moveVfxTokenAnchor(
  renderObject,
  MOVE_VFX_TOKEN_ANCHOR.aboveHead,
)

export const moveVfxTokenAnchor = (
  renderObject: PokemonRenderObject,
  anchor: MoveVfxTokenAnchor = MOVE_VFX_TOKEN_ANCHOR.center,
): THREE.Vector3 => new THREE.Vector3(
  renderObject.currentCenter.x,
  tokenAnchorY(renderObject, anchor),
  renderObject.currentCenter.z,
)

/**
 * Centre of a unit grid cell on the X/Z plane at the cell's elevation.
 * This intentionally keeps Y at `cell.y` rather than `cell.y + 0.5` because
 * map effects sit on the same elevation plane as token feet and area overlays.
 */
export const moveVfxGridCellCenterAnchor = (cell: GridAnchor): THREE.Vector3 => {
  const center = getAnchorCenter(cell, 1)
  return new THREE.Vector3(center.x, center.y, center.z)
}

/**
 * Average of grid-cell centres. Returns `null` for an empty area unless a
 * fallback cell is provided, allowing callers to no-op instead of throwing.
 */
export const moveVfxAreaCentroidAnchor = (
  cells: readonly GridAnchor[] | null | undefined,
  fallbackCell?: GridAnchor | null,
): THREE.Vector3 | null => {
  if (!cells?.length) {
    return fallbackCell ? moveVfxGridCellCenterAnchor(fallbackCell) : null
  }

  const sum = new THREE.Vector3()
  for (const cell of cells) {
    sum.add(moveVfxGridCellCenterAnchor(cell))
  }
  return sum.multiplyScalar(1 / cells.length)
}

/**
 * Resolve a token anchor by id, falling back to a grid cell when the token is
 * missing or has been removed. Missing tokens without a fallback return null so
 * move resolution can skip VFX safely instead of throwing.
 */
export const resolveMoveVfxTokenAnchor = (options: {
  renderObjects: ReadonlyMap<string, PokemonRenderObject>
  tokenId?: string | null
  anchor?: MoveVfxTokenAnchor
  fallbackCell?: GridAnchor | null
}): THREE.Vector3 | null => {
  const renderObject = options.tokenId ? options.renderObjects.get(options.tokenId) : null
  if (renderObject) {
    return moveVfxTokenAnchor(renderObject, options.anchor)
  }

  return options.fallbackCell ? moveVfxGridCellCenterAnchor(options.fallbackCell) : null
}

/**
 * Shared start/end resolver for projectile-like and beam-like primitives.
 * Returns `null` when either side cannot be resolved, giving renderers a simple
 * no-op path for deleted targets or incomplete event metadata.
 */
export const resolveMoveVfxAnchorPair = (options: MoveVfxAnchorPairOptions): MoveVfxAnchorPair | null => {
  const start = resolveMoveVfxTokenAnchor({
    renderObjects: options.renderObjects,
    tokenId: options.userId,
    anchor: options.userAnchor ?? MOVE_VFX_TOKEN_ANCHOR.chest,
    fallbackCell: options.originCell,
  })
  const end = resolveMoveVfxTokenAnchor({
    renderObjects: options.renderObjects,
    tokenId: options.targetId,
    anchor: options.targetAnchor ?? MOVE_VFX_TOKEN_ANCHOR.chest,
    fallbackCell: options.targetCell,
  })

  return start && end ? { start, end } : null
}

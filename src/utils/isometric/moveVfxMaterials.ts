import * as THREE from 'three'

export interface MoveVfxMaterialOptions {
  color: THREE.ColorRepresentation
  opacity?: number
  transparent?: boolean
  depthTest?: boolean
  depthWrite?: boolean
  blending?: THREE.Blending
  side?: THREE.Side
  toneMapped?: boolean
  polygonOffset?: boolean
  polygonOffsetFactor?: number
  polygonOffsetUnits?: number
}

const MOVE_VFX_DEFAULT_TRANSPARENT = true
const MOVE_VFX_DEFAULT_DEPTH_TEST = true
const MOVE_VFX_DEFAULT_DEPTH_WRITE = false
const MOVE_VFX_DEFAULT_BLENDING = THREE.AdditiveBlending
const MOVE_VFX_DEFAULT_TONE_MAPPED = false
const MOVE_VFX_RING_POLYGON_OFFSET = true
const MOVE_VFX_RING_POLYGON_OFFSET_FACTOR = -1
const MOVE_VFX_RING_POLYGON_OFFSET_UNITS = -2

const isMoveVfxMaterialOptions = (
  input: THREE.ColorRepresentation | MoveVfxMaterialOptions,
): input is MoveVfxMaterialOptions => (
  typeof input === 'object'
  && input !== null
  && 'color' in input
)

export const normalizeMoveVfxOpacity = (opacity = 1): number => (
  Number.isFinite(opacity)
    ? Math.min(1, Math.max(0, opacity))
    : 1
)

const resolveMoveVfxMaterialOptions = (
  input: THREE.ColorRepresentation | MoveVfxMaterialOptions,
  opacity?: number,
): MoveVfxMaterialOptions => (
  isMoveVfxMaterialOptions(input)
    ? input
    : { color: input, opacity }
)

const createSharedMoveVfxMaterialParameters = (
  input: THREE.ColorRepresentation | MoveVfxMaterialOptions,
  opacity: number | undefined,
  side?: THREE.Side,
  defaults: Partial<Pick<MoveVfxMaterialOptions, 'polygonOffset' | 'polygonOffsetFactor' | 'polygonOffsetUnits'>> = {},
): THREE.MeshBasicMaterialParameters => {
  const options = resolveMoveVfxMaterialOptions(input, opacity)
  const parameters: THREE.MeshBasicMaterialParameters = {
    color: options.color,
    opacity: normalizeMoveVfxOpacity(options.opacity),
    transparent: options.transparent ?? MOVE_VFX_DEFAULT_TRANSPARENT,
    depthTest: options.depthTest ?? MOVE_VFX_DEFAULT_DEPTH_TEST,
    depthWrite: options.depthWrite ?? MOVE_VFX_DEFAULT_DEPTH_WRITE,
    blending: options.blending ?? MOVE_VFX_DEFAULT_BLENDING,
    side: options.side ?? side,
    toneMapped: options.toneMapped ?? MOVE_VFX_DEFAULT_TONE_MAPPED,
  }
  const polygonOffset = options.polygonOffset ?? defaults.polygonOffset
  const polygonOffsetFactor = options.polygonOffsetFactor ?? defaults.polygonOffsetFactor
  const polygonOffsetUnits = options.polygonOffsetUnits ?? defaults.polygonOffsetUnits
  if (polygonOffset !== undefined) parameters.polygonOffset = polygonOffset
  if (polygonOffsetFactor !== undefined) parameters.polygonOffsetFactor = polygonOffsetFactor
  if (polygonOffsetUnits !== undefined) parameters.polygonOffsetUnits = polygonOffsetUnits
  return parameters
}

const createSharedMoveVfxLineParameters = (
  input: THREE.ColorRepresentation | MoveVfxMaterialOptions,
  opacity?: number,
): THREE.LineBasicMaterialParameters => {
  const options = resolveMoveVfxMaterialOptions(input, opacity)
  const parameters: THREE.LineBasicMaterialParameters = {
    color: options.color,
    opacity: normalizeMoveVfxOpacity(options.opacity),
    transparent: options.transparent ?? MOVE_VFX_DEFAULT_TRANSPARENT,
    depthTest: options.depthTest ?? MOVE_VFX_DEFAULT_DEPTH_TEST,
    depthWrite: options.depthWrite ?? MOVE_VFX_DEFAULT_DEPTH_WRITE,
    blending: options.blending ?? MOVE_VFX_DEFAULT_BLENDING,
    toneMapped: options.toneMapped ?? MOVE_VFX_DEFAULT_TONE_MAPPED,
  }
  if (options.polygonOffset !== undefined) parameters.polygonOffset = options.polygonOffset
  if (options.polygonOffsetFactor !== undefined) parameters.polygonOffsetFactor = options.polygonOffsetFactor
  if (options.polygonOffsetUnits !== undefined) parameters.polygonOffsetUnits = options.polygonOffsetUnits
  return parameters
}

const createSharedMoveVfxSpriteParameters = (
  input: THREE.ColorRepresentation | MoveVfxMaterialOptions,
  opacity?: number,
): THREE.SpriteMaterialParameters => {
  const options = resolveMoveVfxMaterialOptions(input, opacity)
  const parameters: THREE.SpriteMaterialParameters = {
    color: options.color,
    opacity: normalizeMoveVfxOpacity(options.opacity),
    transparent: options.transparent ?? MOVE_VFX_DEFAULT_TRANSPARENT,
    depthTest: options.depthTest ?? MOVE_VFX_DEFAULT_DEPTH_TEST,
    depthWrite: options.depthWrite ?? MOVE_VFX_DEFAULT_DEPTH_WRITE,
    blending: options.blending ?? MOVE_VFX_DEFAULT_BLENDING,
    toneMapped: options.toneMapped ?? MOVE_VFX_DEFAULT_TONE_MAPPED,
  }
  if (options.polygonOffset !== undefined) parameters.polygonOffset = options.polygonOffset
  if (options.polygonOffsetFactor !== undefined) parameters.polygonOffsetFactor = options.polygonOffsetFactor
  if (options.polygonOffsetUnits !== undefined) parameters.polygonOffsetUnits = options.polygonOffsetUnits
  return parameters
}

/**
 * Creates a fresh, instance-owned mesh material for compact VFX cores such as
 * projectile bodies. Defaults intentionally keep move VFX luminous and
 * transient: transparent additive blending, depth testing on, depth writes off,
 * and tone mapping disabled. The material is not cached or shared, so the
 * owning effect group can dispose it exactly once through disposeObject3D().
 */
export function createMoveVfxSolidMaterial(
  color: THREE.ColorRepresentation,
  opacity?: number,
): THREE.MeshBasicMaterial
export function createMoveVfxSolidMaterial(options: MoveVfxMaterialOptions): THREE.MeshBasicMaterial
export function createMoveVfxSolidMaterial(
  input: THREE.ColorRepresentation | MoveVfxMaterialOptions,
  opacity?: number,
): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial(createSharedMoveVfxMaterialParameters(input, opacity, THREE.FrontSide))
}

/**
 * Creates a fresh material for glows, shells, motes, translucent cylinders, and
 * other world-space overlay meshes. The double-sided default matches existing
 * move VFX primitives that must remain readable from the isometric camera while
 * still depth-testing against the scene and avoiding transparent depth writes.
 */
export function createMoveVfxTranslucentMaterial(
  color: THREE.ColorRepresentation,
  opacity?: number,
): THREE.MeshBasicMaterial
export function createMoveVfxTranslucentMaterial(options: MoveVfxMaterialOptions): THREE.MeshBasicMaterial
export function createMoveVfxTranslucentMaterial(
  input: THREE.ColorRepresentation | MoveVfxMaterialOptions,
  opacity?: number,
): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial(createSharedMoveVfxMaterialParameters(input, opacity, THREE.DoubleSide))
}

/**
 * Creates a fresh material for ground rings, area cell planes, and other flat
 * line-like VFX surfaces. Defaults are the same transparent additive,
 * depth-tested, depth-write-disabled settings as other move VFX materials, with
 * double-sided rendering so horizontal rings remain visible from above. Ring
 * surfaces also use a small negative polygon offset by default to keep flat VFX
 * readable above terrain, field surfaces, and hazard decals without disabling
 * depth testing against raised map geometry.
 */
export function createMoveVfxRingMaterial(
  color: THREE.ColorRepresentation,
  opacity?: number,
): THREE.MeshBasicMaterial
export function createMoveVfxRingMaterial(options: MoveVfxMaterialOptions): THREE.MeshBasicMaterial
export function createMoveVfxRingMaterial(
  input: THREE.ColorRepresentation | MoveVfxMaterialOptions,
  opacity?: number,
): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial(createSharedMoveVfxMaterialParameters(
    input,
    opacity,
    THREE.DoubleSide,
    {
      polygonOffset: MOVE_VFX_RING_POLYGON_OFFSET,
      polygonOffsetFactor: MOVE_VFX_RING_POLYGON_OFFSET_FACTOR,
      polygonOffsetUnits: MOVE_VFX_RING_POLYGON_OFFSET_UNITS,
    },
  ))
}

/**
 * Creates a fresh material for future THREE.Line-based move VFX. It shares the
 * same transparent additive, depth-tested, depth-write-disabled defaults as the
 * mesh factories without introducing a material cache or renderer-global owner.
 */
export function createMoveVfxLineMaterial(
  color: THREE.ColorRepresentation,
  opacity?: number,
): THREE.LineBasicMaterial
export function createMoveVfxLineMaterial(options: MoveVfxMaterialOptions): THREE.LineBasicMaterial
export function createMoveVfxLineMaterial(
  input: THREE.ColorRepresentation | MoveVfxMaterialOptions,
  opacity?: number,
): THREE.LineBasicMaterial {
  return new THREE.LineBasicMaterial(createSharedMoveVfxLineParameters(input, opacity))
}

/**
 * Creates a fresh material for future sprite-like move VFX. No sprite primitive
 * is introduced in VFX-049; this helper only centralizes the default material
 * policy before a later badge/sprite ticket needs it.
 */
export function createMoveVfxSpriteMaterial(
  color: THREE.ColorRepresentation,
  opacity?: number,
): THREE.SpriteMaterial
export function createMoveVfxSpriteMaterial(options: MoveVfxMaterialOptions): THREE.SpriteMaterial
export function createMoveVfxSpriteMaterial(
  input: THREE.ColorRepresentation | MoveVfxMaterialOptions,
  opacity?: number,
): THREE.SpriteMaterial {
  return new THREE.SpriteMaterial(createSharedMoveVfxSpriteParameters(input, opacity))
}

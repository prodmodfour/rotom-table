import * as THREE from 'three'
import type { LayerVisibility } from '~/types/map'
import type { SpawnedPokemon, SpriteAnimation, SpriteCrop, SpriteVisualBounds } from '~/types/pokemon'
import {
  accentVolumeFacePalette,
  buildVolumeMaterials,
  paintVolumeFacePalette,
  paintVolumeMaterials,
  resolveVolumeAccentColor,
} from '~/utils/isometric/materials'
import { disposeObject3D } from '~/utils/isometric/resourceDisposal'
import {
  buildTokenCombatStageGlass,
  disposeTokenCombatStageGlass,
  updateTokenCombatStageGlass,
} from '~/utils/isometric/tokenCombatStageGlass'
import { buildElevationBadge, buildHpBar, updateElevationBadge, updateHpBar } from '~/utils/isometric/tokenHud'
import {
  nextSelectionLiftFactor,
  pokemonPickDimensions,
  pokemonRenderSpawnState,
  selectionLiftTarget,
  tokenSelectionLiftStyle,
} from '~/utils/isometric/tokenRenderState'
import type {
  PokemonRenderMotionState,
  PokemonRenderObject,
  PokemonTacticalCageTargetingState,
} from '~/utils/isometric/types'
import type {
  TokenGeometryLease,
  TokenRenderGeometryCache,
  TokenRenderGeometryLeases,
} from '~/utils/isometric/tokenGeometryCache'
import { tokenFacingStoresLegacyTurned, tokenFacingVector } from '~/utils/tokenFacing'
import type { WorldSpriteFacingAsset } from '~/utils/isometric/worldSpriteFacing'
import { getSpriteVisualBoundsWorldYOffset } from '~/utils/spriteVisualBounds'
import {
  TOKEN_MOTION_POLISH_IDLE_SAMPLE,
  sampleTokenMotionPolish,
  type TokenMotionPolishSample,
} from '~/utils/isometric/tokenMotionTracks'
import {
  applyAnimationFrame,
  buildContactShadow,
  buildWorldSprite,
  contactShadowRadiusForPokemon,
  disposeWorldSprite,
  setWorldSpriteSize,
  updateSpriteFacing,
  updateWorldSpriteLighting,
  worldSpriteHaloColorForAccent,
} from '~/utils/isometric/worldSprites'

export type ShadowSurfaceResolver = (
  centerX: number,
  centerZ: number,
  base: number,
  footY: number,
) => number

export interface PokemonRenderObjectContainers {
  scene: THREE.Scene
  worldGroup: THREE.Group
  onTextureLoadComplete?: () => void
  geometryCache?: TokenRenderGeometryCache
}

export interface PokemonRenderObjectUpdateOptions {
  geometryCache?: TokenRenderGeometryCache
}

export interface PokemonRenderObjectRemoteAttention {
  readonly selectedCount: number
  readonly hoveredCount: number
  readonly totalCount: number
  readonly primaryColor: string
}

type TokenRenderDimensions = Pick<
  ReturnType<typeof pokemonRenderSpawnState>,
  'width' | 'height' | 'base' | 'clearance'
>

type TokenGeometryLeaseSlot = keyof TokenRenderGeometryLeases

export const createPokemonRenderMotionState = (
  center: Pick<THREE.Vector3, 'x' | 'y' | 'z'>,
): PokemonRenderMotionState => ({
  sampledCenter: new THREE.Vector3(center.x, center.y, center.z),
})

export const clearPokemonRenderObjectMotionTrack = (renderObject: PokemonRenderObject) => {
  if (!renderObject.motion) return
  delete renderObject.motion.track
  delete renderObject.motion.facing
}

type TokenRenderableWithGeometry = THREE.Object3D & {
  geometry?: THREE.BufferGeometry
  material?: THREE.Material | THREE.Material[]
}

interface TokenGeometryReplacement<TGeometry extends THREE.BufferGeometry> {
  geometry: TGeometry
  lease?: TokenGeometryLease<TGeometry>
}

interface TokenVolumeGeometrySet {
  volumeBox: TokenGeometryReplacement<THREE.BoxGeometry>
  volumeEdges: TokenGeometryReplacement<THREE.EdgesGeometry>
}

const tokenDimensionsChanged = (
  renderObject: PokemonRenderObject,
  spawnState: TokenRenderDimensions,
): boolean => (
  renderObject.width !== spawnState.width ||
  renderObject.height !== spawnState.height ||
  renderObject.base !== spawnState.base ||
  renderObject.clearance !== spawnState.clearance
)

const tokenTargetCenterChanged = (
  renderObject: PokemonRenderObject,
  center: Pick<THREE.Vector3, 'x' | 'y' | 'z'>,
): boolean => (
  renderObject.targetCenter.x !== center.x ||
  renderObject.targetCenter.y !== center.y ||
  renderObject.targetCenter.z !== center.z
)

const acquireTokenVolumeGeometries = (
  base: number,
  clearance: number,
  geometryCache: TokenRenderGeometryCache | undefined,
): TokenVolumeGeometrySet => {
  if (geometryCache) {
    const volumeBox = geometryCache.acquireVolumeBoxGeometry(base, clearance)
    const volumeEdges = geometryCache.acquireVolumeEdgesGeometry(base, clearance)
    return {
      volumeBox: { geometry: volumeBox.geometry, lease: volumeBox },
      volumeEdges: { geometry: volumeEdges.geometry, lease: volumeEdges },
    }
  }

  const volumeGeometry = new THREE.BoxGeometry(base, clearance, base)
  return {
    volumeBox: { geometry: volumeGeometry },
    volumeEdges: { geometry: new THREE.EdgesGeometry(volumeGeometry) },
  }
}

const acquireTokenProxyGeometry = (
  pokemon: SpawnedPokemon,
  geometryCache: TokenRenderGeometryCache | undefined,
): TokenGeometryReplacement<THREE.BoxGeometry> => {
  const pickSize = pokemonPickDimensions(pokemon)
  if (geometryCache) {
    const proxyBox = geometryCache.acquireProxyBoxGeometry(pickSize.width, pickSize.height)
    return { geometry: proxyBox.geometry, lease: proxyBox }
  }

  return { geometry: new THREE.BoxGeometry(pickSize.width, pickSize.height, pickSize.width) }
}

const createTokenGeometryLeases = (
  leases: TokenRenderGeometryLeases,
): TokenRenderGeometryLeases | undefined => (
  leases.volumeBox || leases.volumeEdges || leases.proxyBox ? leases : undefined
)

const tokenGeometryLease = (
  renderObject: PokemonRenderObject,
  slot: TokenGeometryLeaseSlot,
): TokenGeometryLease<THREE.BufferGeometry> | undefined => {
  const lease = renderObject.geometryLeases?.[slot]
  return lease as TokenGeometryLease<THREE.BufferGeometry> | undefined
}

const setTokenGeometryLease = (
  renderObject: PokemonRenderObject,
  slot: TokenGeometryLeaseSlot,
  lease: TokenGeometryLease<THREE.BufferGeometry> | undefined,
) => {
  if (lease) {
    const leases = renderObject.geometryLeases ?? {}
    ;(leases as Record<TokenGeometryLeaseSlot, TokenGeometryLease<THREE.BufferGeometry> | undefined>)[slot] = lease
    renderObject.geometryLeases = leases
    return
  }

  if (!renderObject.geometryLeases) return

  delete renderObject.geometryLeases[slot]
  if (
    !renderObject.geometryLeases.volumeBox &&
    !renderObject.geometryLeases.volumeEdges &&
    !renderObject.geometryLeases.proxyBox
  ) {
    delete renderObject.geometryLeases
  }
}

const releaseTokenGeometryLease = (
  renderObject: PokemonRenderObject,
  slot: TokenGeometryLeaseSlot,
  currentGeometry: THREE.BufferGeometry | undefined,
) => {
  const lease = tokenGeometryLease(renderObject, slot)
  if (lease) {
    lease.release()
    if (currentGeometry && currentGeometry !== lease.geometry) currentGeometry.dispose()
  } else {
    currentGeometry?.dispose()
  }

  setTokenGeometryLease(renderObject, slot, undefined)
}

const replaceTokenGeometry = <TGeometry extends THREE.BufferGeometry>(
  renderObject: PokemonRenderObject,
  slot: TokenGeometryLeaseSlot,
  target: { geometry: TGeometry },
  replacement: TokenGeometryReplacement<TGeometry>,
) => {
  const previousGeometry = target.geometry
  target.geometry = replacement.geometry
  releaseTokenGeometryLease(renderObject, slot, previousGeometry)
  setTokenGeometryLease(
    renderObject,
    slot,
    replacement.lease as TokenGeometryLease<THREE.BufferGeometry> | undefined,
  )
}

const disposeTokenMaterial = (material: THREE.Material | THREE.Material[] | undefined) => {
  if (Array.isArray(material)) {
    for (const item of material) item.dispose()
    return
  }

  material?.dispose()
}

const disposeTokenRenderableWithGeometryLease = (
  renderObject: PokemonRenderObject,
  slot: TokenGeometryLeaseSlot,
  object: TokenRenderableWithGeometry,
) => {
  const rootLease = tokenGeometryLease(renderObject, slot)

  object.parent?.remove(object)
  object.traverse((child) => {
    const renderable = child as TokenRenderableWithGeometry
    const geometry = renderable.geometry
    const material = renderable.material

    if (child === object && rootLease) {
      rootLease.release()
      if (geometry && geometry !== rootLease.geometry) geometry.dispose()
    } else {
      geometry?.dispose()
    }

    disposeTokenMaterial(material)

    if (typeof HTMLElement !== 'undefined' && 'element' in child && child.element instanceof HTMLElement) {
      child.element.remove()
    }
  })
  setTokenGeometryLease(renderObject, slot, undefined)
  object.clear()
}

const replaceVolumeGeometry = (
  renderObject: PokemonRenderObject,
  base: number,
  clearance: number,
  geometryCache: TokenRenderGeometryCache | undefined,
) => {
  const geometries = acquireTokenVolumeGeometries(base, clearance, geometryCache)

  replaceTokenGeometry(renderObject, 'volumeBox', renderObject.volume, geometries.volumeBox)
  replaceTokenGeometry(renderObject, 'volumeEdges', renderObject.edges, geometries.volumeEdges)
}

const replaceProxyGeometry = (
  renderObject: PokemonRenderObject,
  pokemon: SpawnedPokemon,
  geometryCache: TokenRenderGeometryCache | undefined,
) => {
  replaceTokenGeometry(renderObject, 'proxyBox', renderObject.proxy, acquireTokenProxyGeometry(pokemon, geometryCache))
}

const replaceShadowGeometry = (renderObject: PokemonRenderObject, pokemon: SpawnedPokemon) => {
  renderObject.shadow.geometry.dispose()
  renderObject.shadow.geometry = new THREE.CircleGeometry(contactShadowRadiusForPokemon(pokemon), 32)
}

const applyPokemonRenderObjectDimensions = (
  renderObject: PokemonRenderObject,
  pokemon: SpawnedPokemon,
  spawnState: TokenRenderDimensions,
  options: PokemonRenderObjectUpdateOptions = {},
) => {
  renderObject.width = spawnState.width
  renderObject.height = spawnState.height
  renderObject.base = spawnState.base
  renderObject.clearance = spawnState.clearance

  setWorldSpriteSize(renderObject.spriteState, spawnState)
  replaceVolumeGeometry(renderObject, spawnState.base, spawnState.clearance, options.geometryCache)
  replaceProxyGeometry(renderObject, pokemon, options.geometryCache)
  replaceShadowGeometry(renderObject, pokemon)
}

interface SpriteAssetCanvasDimensions {
  readonly width: number
  readonly height: number
}

type SpriteVisualBoundsState = Pick<
  PokemonRenderObject,
  | 'spriteUrl'
  | 'backSpriteUrl'
  | 'spriteAnimation'
  | 'backSpriteAnimation'
  | 'spriteCrop'
  | 'spriteVisualBounds'
  | 'backSpriteVisualBounds'
>

const spriteVisualBoundsCanvasDimensions = (
  bounds: SpriteVisualBounds | null | undefined,
): SpriteAssetCanvasDimensions | null => {
  if (!bounds) return null
  if (!Number.isFinite(bounds.canvasWidth) || bounds.canvasWidth <= 0) return null
  if (!Number.isFinite(bounds.canvasHeight) || bounds.canvasHeight <= 0) return null
  return { width: bounds.canvasWidth, height: bounds.canvasHeight }
}

const spriteAnimationCanvasDimensions = (
  animation: SpriteAnimation | null | undefined,
): SpriteAssetCanvasDimensions | null => {
  if (!animation) return null
  if (!Number.isFinite(animation.frameWidth) || animation.frameWidth <= 0) return null
  if (!Number.isFinite(animation.frameHeight) || animation.frameHeight <= 0) return null
  return { width: animation.frameWidth, height: animation.frameHeight }
}

const spriteCropCanvasDimensions = (
  crop: SpriteCrop | null | undefined,
): SpriteAssetCanvasDimensions | null => {
  if (!crop) return null
  if (!Number.isFinite(crop.canvasWidth) || crop.canvasWidth <= 0) return null
  if (!Number.isFinite(crop.canvasHeight) || crop.canvasHeight <= 0) return null
  return { width: crop.canvasWidth, height: crop.canvasHeight }
}

const spriteAssetCanvasDimensionsEqual = (
  left: SpriteAssetCanvasDimensions | null,
  right: SpriteAssetCanvasDimensions | null,
): boolean => Boolean(left && right && left.width === right.width && left.height === right.height)

const frontSpriteAssetCanvasDimensions = (
  renderObject: SpriteVisualBoundsState,
): SpriteAssetCanvasDimensions | null => (
  spriteVisualBoundsCanvasDimensions(renderObject.spriteVisualBounds) ??
  spriteAnimationCanvasDimensions(renderObject.spriteAnimation) ??
  spriteCropCanvasDimensions(renderObject.spriteCrop)
)

const backSpriteAssetCanvasDimensions = (
  renderObject: SpriteVisualBoundsState,
): SpriteAssetCanvasDimensions | null => (
  spriteVisualBoundsCanvasDimensions(renderObject.backSpriteVisualBounds) ??
  spriteAnimationCanvasDimensions(renderObject.backSpriteAnimation) ??
  (renderObject.backSpriteUrl === renderObject.spriteUrl ? frontSpriteAssetCanvasDimensions(renderObject) : null)
)

const canUseFrontVisualBoundsForBackSprite = (
  renderObject: SpriteVisualBoundsState,
): boolean => spriteAssetCanvasDimensionsEqual(
  spriteVisualBoundsCanvasDimensions(renderObject.spriteVisualBounds),
  backSpriteAssetCanvasDimensions(renderObject),
)

export const resolvePokemonRenderObjectActiveSpriteVisualBounds = (
  renderObject: SpriteVisualBoundsState,
  asset: WorldSpriteFacingAsset,
): SpriteVisualBounds | undefined => {
  if (asset === 'front') return renderObject.spriteVisualBounds
  if (renderObject.backSpriteVisualBounds) return renderObject.backSpriteVisualBounds
  return canUseFrontVisualBoundsForBackSprite(renderObject) ? renderObject.spriteVisualBounds : undefined
}

const normalizePokemonRenderObjectActiveSpriteAsset = (
  renderObject: Pick<PokemonRenderObject, 'backSpriteUrl'>,
  asset: WorldSpriteFacingAsset,
): WorldSpriteFacingAsset => (asset === 'back' && renderObject.backSpriteUrl ? 'back' : 'front')

const setPokemonRenderObjectActiveSpriteAsset = (
  renderObject: PokemonRenderObject,
  asset: WorldSpriteFacingAsset,
) => {
  const activeSpriteAsset = normalizePokemonRenderObjectActiveSpriteAsset(renderObject, asset)
  renderObject.activeSpriteAsset = activeSpriteAsset
  renderObject.activeSpriteVisualBounds = resolvePokemonRenderObjectActiveSpriteVisualBounds(renderObject, activeSpriteAsset)
}

export const createPokemonRenderObject = (
  pokemon: SpawnedPokemon,
  containers: PokemonRenderObjectContainers,
): PokemonRenderObject => {
  const spriteState = buildWorldSprite(pokemon, {
    onTextureLoadComplete: containers.onTextureLoadComplete,
  })
  const sprite = spriteState.sprite
  const elevationBadge = buildElevationBadge()
  const hpBar = buildHpBar(pokemon)
  const combatStageGlass = buildTokenCombatStageGlass()
  const shadow = buildContactShadow(pokemon)
  const volumeGeometries = acquireTokenVolumeGeometries(
    pokemon.base,
    pokemon.clearance,
    containers.geometryCache,
  )
  // Per-face white/graphite shading sits in the foreground brightness band
  // so requested tactical cages read above the terrain instead of merging with it.
  const volume = new THREE.Mesh(
    volumeGeometries.volumeBox.geometry,
    buildVolumeMaterials('idle', 0.28),
  )

  const edges = new THREE.LineSegments(
    volumeGeometries.volumeEdges.geometry,
    new THREE.LineBasicMaterial({
      color: 0xaeb5bd,
      transparent: true,
      opacity: 0.55,
      depthTest: true,
      depthWrite: false,
    }),
  )
  volume.visible = false
  edges.visible = false

  const proxyGeometry = acquireTokenProxyGeometry(pokemon, containers.geometryCache)
  const proxy = new THREE.Mesh(
    proxyGeometry.geometry,
    new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
      colorWrite: false,
    }),
  )
  proxy.userData.pokemonId = pokemon.id

  const geometryLeases = createTokenGeometryLeases({
    volumeBox: volumeGeometries.volumeBox.lease,
    volumeEdges: volumeGeometries.volumeEdges.lease,
    proxyBox: proxyGeometry.lease,
  })

  const spawnState = pokemonRenderSpawnState(pokemon)
  const currentCenter = new THREE.Vector3(spawnState.center.x, spawnState.center.y, spawnState.center.z)
  const targetCenter = currentCenter.clone()
  const motion = createPokemonRenderMotionState(currentCenter)

  containers.worldGroup.add(shadow)
  containers.worldGroup.add(volume)
  containers.worldGroup.add(edges)
  containers.worldGroup.add(combatStageGlass.mesh)
  containers.worldGroup.add(spriteState.halo)
  containers.worldGroup.add(sprite)
  containers.worldGroup.add(proxy)
  containers.scene.add(elevationBadge)
  containers.scene.add(hpBar)

  return {
    id: pokemon.id,
    sprite,
    spriteState,
    elevationBadge,
    hpBar,
    combatStageGlass,
    volume,
    edges,
    cageVisible: false,
    proxy,
    shadow,
    ...(geometryLeases ? { geometryLeases } : {}),
    currentCenter,
    targetCenter,
    motion,
    width: spawnState.width,
    height: spawnState.height,
    base: spawnState.base,
    clearance: spawnState.clearance,
    elevation: spawnState.elevation,
    spriteUrl: spawnState.spriteUrl,
    backSpriteUrl: spawnState.backSpriteUrl,
    spriteAnimation: spawnState.spriteAnimation,
    backSpriteAnimation: spawnState.backSpriteAnimation,
    spriteCrop: spawnState.spriteCrop,
    spriteVisualBounds: spawnState.spriteVisualBounds,
    backSpriteVisualBounds: spawnState.backSpriteVisualBounds,
    activeSpriteVisualBounds: spawnState.activeSpriteVisualBounds,
    activeSpriteAsset: spawnState.activeSpriteAsset,
    facing: spawnState.facing,
    turned: spawnState.turned,
    displayName: spawnState.displayName,
    level: spawnState.level,
    currentHp: spawnState.currentHp,
    temporaryHp: spawnState.temporaryHp,
    maxHp: spawnState.maxHp,
    fullMaxHp: spawnState.fullMaxHp,
    injuries: spawnState.injuries,
    combatStages: spawnState.combatStages,
    conditions: spawnState.conditions,
    tokenItems: spawnState.tokenItems,
    accentColor: spawnState.accentColor,
    liftFactor: 0,
    liftTarget: 0,
  }
}

export const updatePokemonRenderObjectFromSpawn = (
  renderObject: PokemonRenderObject,
  pokemon: SpawnedPokemon,
  options: PokemonRenderObjectUpdateOptions = {},
) => {
  const spawnState = pokemonRenderSpawnState(pokemon)
  const placementChanged = tokenTargetCenterChanged(renderObject, spawnState.center)
  const facingChanged = renderObject.facing !== spawnState.facing || renderObject.turned !== spawnState.turned

  if (!renderObject.motion.track || (!placementChanged && facingChanged)) {
    delete renderObject.motion.facing
  }

  if (tokenDimensionsChanged(renderObject, spawnState)) {
    applyPokemonRenderObjectDimensions(renderObject, pokemon, spawnState, options)
  }
  renderObject.targetCenter.set(spawnState.center.x, spawnState.center.y, spawnState.center.z)
  if (!renderObject.motion.track) {
    renderObject.motion.sampledCenter.copy(renderObject.currentCenter)
  }
  renderObject.elevation = spawnState.elevation
  renderObject.spriteUrl = spawnState.spriteUrl
  renderObject.backSpriteUrl = spawnState.backSpriteUrl
  renderObject.spriteAnimation = spawnState.spriteAnimation
  renderObject.backSpriteAnimation = spawnState.backSpriteAnimation
  renderObject.spriteCrop = spawnState.spriteCrop
  renderObject.spriteVisualBounds = spawnState.spriteVisualBounds
  renderObject.backSpriteVisualBounds = spawnState.backSpriteVisualBounds
  setPokemonRenderObjectActiveSpriteAsset(renderObject, renderObject.activeSpriteAsset ?? spawnState.activeSpriteAsset)
  renderObject.facing = spawnState.facing
  renderObject.turned = spawnState.turned
  renderObject.displayName = spawnState.displayName
  renderObject.level = spawnState.level
  renderObject.currentHp = spawnState.currentHp
  renderObject.temporaryHp = spawnState.temporaryHp
  renderObject.maxHp = spawnState.maxHp
  renderObject.fullMaxHp = spawnState.fullMaxHp
  renderObject.injuries = spawnState.injuries
  renderObject.combatStages = spawnState.combatStages
  renderObject.conditions = spawnState.conditions
  renderObject.tokenItems = spawnState.tokenItems
  renderObject.accentColor = spawnState.accentColor
  renderObject.spriteState.haloColor = worldSpriteHaloColorForAccent(spawnState.accentColor)
}

const pokemonRenderObjectVisualYOffset = (
  renderObject: Pick<PokemonRenderObject, 'activeSpriteVisualBounds' | 'height' | 'clearance'>,
): number => getSpriteVisualBoundsWorldYOffset(renderObject.activeSpriteVisualBounds, {
  height: renderObject.height,
  clearance: renderObject.clearance,
})

export const applyPokemonRenderObjectPosition = (
  renderObject: PokemonRenderObject,
  options: {
    camera: THREE.Camera | null
    activeTurnId?: string | null
    groundLevelY: number
    hoveredPokemonId: string | null
    layers: LayerVisibility
    getShadowSurfaceY: ShadowSurfaceResolver
  },
): boolean => {
  let cssHudChanged = false
  const center = renderObject.motion.sampledCenter.copy(renderObject.currentCenter)
  const visualYOffset = pokemonRenderObjectVisualYOffset(renderObject)
  // Floating visual-bounds offsets are cosmetic: only the artwork and its halo
  // move so tactical cage, proxy, contact shadow, and occupied volume stay anchored.
  renderObject.sprite.position.set(
    center.x,
    center.y + visualYOffset,
    center.z,
  )
  renderObject.spriteState.halo.position.copy(renderObject.sprite.position)
  renderObject.volume.position.set(
    center.x,
    center.y + renderObject.clearance / 2,
    center.z,
  )
  renderObject.edges.position.copy(renderObject.volume.position)
  renderObject.proxy.position.set(
    center.x,
    center.y + Math.max(renderObject.height, renderObject.clearance) / 2,
    center.z,
  )
  // Voxel-aware projection: shadow drops to whatever surface is
  // beneath the sprite (floor or highest voxel top in the footprint),
  // not glued to the sprite's foot. Tiny y-offset dodges z-fighting
  // with the floor plane / voxel top.
  const surfaceY = options.getShadowSurfaceY(
    center.x,
    center.z,
    renderObject.base,
    center.y,
  )
  renderObject.shadow.position.set(
    center.x,
    surfaceY + 0.005,
    center.z,
  )
  cssHudChanged = updateElevationBadge({
    badge: renderObject.elevationBadge,
    center,
    base: renderObject.base,
    elevation: renderObject.elevation,
    groundLevelY: options.groundLevelY,
    camera: options.camera,
    accentColor: renderObject.accentColor,
    show: options.hoveredPokemonId === renderObject.id && options.layers.tokens,
  }) || cssHudChanged
  updateTokenCombatStageGlass({
    glass: renderObject.combatStageGlass,
    center,
    base: renderObject.base,
    clearance: renderObject.clearance,
    stages: renderObject.combatStages,
    camera: options.camera,
    show: options.layers.tokens,
  })
  cssHudChanged = updateHpBar({
    bar: renderObject.hpBar,
    center,
    spriteHeight: renderObject.height,
    spriteVisualYOffset: visualYOffset,
    displayName: renderObject.displayName,
    level: renderObject.level,
    currentHp: renderObject.currentHp,
    temporaryHp: renderObject.temporaryHp,
    maxHp: renderObject.maxHp,
    fullMaxHp: renderObject.fullMaxHp,
    injuries: renderObject.injuries,
    conditions: renderObject.conditions,
    tokenItems: renderObject.tokenItems,
    activeTurn: options.activeTurnId === renderObject.id,
    accentColor: renderObject.accentColor,
    show: options.layers.tokens,
  }) || cssHudChanged

  return cssHudChanged
}

const hasRemoteAttention = (attention: PokemonRenderObjectRemoteAttention | undefined): attention is PokemonRenderObjectRemoteAttention => (
  attention !== undefined && attention.totalCount > 0
)

const TACTICAL_CAGE_OPACITY = {
  face: {
    hovered: 0.18,
    hoveredSelected: 0.26,
    selected: 0.24,
    pending: 0.24,
    pendingSelected: 0.28,
    corrected: 0.3,
    correctedSelected: 0.34,
    targetingCandidate: 0.16,
    targetingSelected: 0.22,
    idleReset: 0.28,
  },
  edge: {
    hovered: 0.68,
    hoveredSelected: 0.92,
    selected: 0.9,
    pending: 0.82,
    pendingSelected: 0.9,
    corrected: 0.95,
    correctedSelected: 1,
    targetingCandidate: 0.62,
    targetingSelected: 0.84,
    idleReset: 0.35,
  },
  remoteAttention: {
    hoveredFace: 0.16,
    selectedFace: 0.19,
    faceCountBoostStep: 0.015,
    maxFaceCountBoost: 0.045,
    hoveredEdge: 0.58,
    selectedEdge: 0.72,
    edgeCountBoostStep: 0.03,
    maxEdgeCountBoost: 0.09,
  },
} as const

const remoteAttentionVolumeOpacity = (attention: PokemonRenderObjectRemoteAttention): number => {
  const countBoost = Math.min(
    TACTICAL_CAGE_OPACITY.remoteAttention.maxFaceCountBoost,
    Math.max(0, attention.totalCount - 1) * TACTICAL_CAGE_OPACITY.remoteAttention.faceCountBoostStep,
  )
  return (
    attention.selectedCount > 0
      ? TACTICAL_CAGE_OPACITY.remoteAttention.selectedFace
      : TACTICAL_CAGE_OPACITY.remoteAttention.hoveredFace
  ) + countBoost
}

const remoteAttentionEdgeOpacity = (attention: PokemonRenderObjectRemoteAttention): number => {
  const countBoost = Math.min(
    TACTICAL_CAGE_OPACITY.remoteAttention.maxEdgeCountBoost,
    Math.max(0, attention.totalCount - 1) * TACTICAL_CAGE_OPACITY.remoteAttention.edgeCountBoostStep,
  )
  return (
    attention.selectedCount > 0
      ? TACTICAL_CAGE_OPACITY.remoteAttention.selectedEdge
      : TACTICAL_CAGE_OPACITY.remoteAttention.hoveredEdge
  ) + countBoost
}

type PokemonTacticalCageState = {
  selected: boolean
  hovered: boolean
  pending: boolean
  corrected: boolean
  targeting: PokemonTacticalCageTargetingState | null
}

export interface PokemonTacticalCageVisibilityState {
  readonly selected: boolean
  readonly hovered: boolean
  readonly pending: boolean
  readonly corrected: boolean
  readonly targeting?: PokemonTacticalCageTargetingState | null
  readonly remoteAttention?: PokemonRenderObjectRemoteAttention
}

const localTacticalCageFaceOpacity = (state: PokemonTacticalCageState): number => {
  if (state.corrected) {
    return state.selected ? TACTICAL_CAGE_OPACITY.face.correctedSelected : TACTICAL_CAGE_OPACITY.face.corrected
  }

  if (state.pending) {
    return state.selected ? TACTICAL_CAGE_OPACITY.face.pendingSelected : TACTICAL_CAGE_OPACITY.face.pending
  }

  if (state.hovered) {
    return state.selected ? TACTICAL_CAGE_OPACITY.face.hoveredSelected : TACTICAL_CAGE_OPACITY.face.hovered
  }

  if (state.selected) return TACTICAL_CAGE_OPACITY.face.selected

  if (state.targeting) {
    return state.targeting.role === 'selected'
      ? TACTICAL_CAGE_OPACITY.face.targetingSelected
      : TACTICAL_CAGE_OPACITY.face.targetingCandidate
  }

  return TACTICAL_CAGE_OPACITY.face.idleReset
}

const localTacticalCageEdgeOpacity = (state: PokemonTacticalCageState): number => {
  if (state.corrected) {
    return state.selected ? TACTICAL_CAGE_OPACITY.edge.correctedSelected : TACTICAL_CAGE_OPACITY.edge.corrected
  }

  if (state.pending) {
    return state.selected ? TACTICAL_CAGE_OPACITY.edge.pendingSelected : TACTICAL_CAGE_OPACITY.edge.pending
  }

  if (state.hovered) {
    return state.selected ? TACTICAL_CAGE_OPACITY.edge.hoveredSelected : TACTICAL_CAGE_OPACITY.edge.hovered
  }

  if (state.selected) return TACTICAL_CAGE_OPACITY.edge.selected

  if (state.targeting) {
    return state.targeting.role === 'selected'
      ? TACTICAL_CAGE_OPACITY.edge.targetingSelected
      : TACTICAL_CAGE_OPACITY.edge.targetingCandidate
  }

  return TACTICAL_CAGE_OPACITY.edge.idleReset
}

export const resolvePokemonTacticalCageVisibility = (state: PokemonTacticalCageVisibilityState): boolean => (
  state.selected ||
  state.hovered ||
  state.pending ||
  state.corrected ||
  state.targeting != null ||
  hasRemoteAttention(state.remoteAttention)
)

export const paintPokemonRenderObjectStyle = (
  renderObject: PokemonRenderObject,
  selected: boolean,
  options: {
    hovered?: boolean
    pending?: boolean
    corrected?: boolean
    targeting?: PokemonTacticalCageTargetingState | null
    remoteAttention?: PokemonRenderObjectRemoteAttention
  } = {},
) => {
  const hovered = options.hovered === true
  const pending = options.pending === true
  const corrected = options.corrected === true
  const targeting = options.targeting ?? null
  const remoteAttention = hasRemoteAttention(options.remoteAttention) ? options.remoteAttention : undefined
  const remoteAttentionColor = remoteAttention ? resolveVolumeAccentColor(remoteAttention.primaryColor) : null
  const tacticalCageState: PokemonTacticalCageState = {
    selected,
    hovered,
    pending,
    corrected,
    targeting,
  }
  renderObject.cageVisible = resolvePokemonTacticalCageVisibility({
    ...tacticalCageState,
    remoteAttention,
  })

  // Re-tint the per-face material array with the appropriate tactical
  // theme ramp instead of a single solid color. Hover uses the token's
  // trainer/app accent so the tactical cage identifies ownership without changing
  // the persistent selected-token lift state. Pending local predictions keep
  // that same token-scoped accent visible even when the pointer has moved on;
  // corrections temporarily reserve the red invalid ramp for rollback feedback.
  // Remote presence uses a lower-priority accent cage: it aggregates other
  // participants on the token without overriding local selected, pending, or
  // correction affordances.
  if (corrected) {
    paintVolumeMaterials(
      renderObject.volume.material,
      'unreachable',
      localTacticalCageFaceOpacity(tacticalCageState),
    )
  } else if (hovered || pending) {
    paintVolumeFacePalette(
      renderObject.volume.material,
      accentVolumeFacePalette(renderObject.accentColor),
      localTacticalCageFaceOpacity(tacticalCageState),
    )
  } else if (selected) {
    paintVolumeMaterials(
      renderObject.volume.material,
      'selected',
      localTacticalCageFaceOpacity(tacticalCageState),
    )
  } else if (targeting) {
    // Targeting cages use the acting user's accent as supporting footprint
    // scaffolding; CSS reticles, hit labels, and area overlays remain primary.
    paintVolumeFacePalette(
      renderObject.volume.material,
      accentVolumeFacePalette(targeting.accentColor ?? renderObject.accentColor),
      localTacticalCageFaceOpacity(tacticalCageState),
    )
  } else if (remoteAttention) {
    paintVolumeFacePalette(
      renderObject.volume.material,
      accentVolumeFacePalette(remoteAttention.primaryColor),
      remoteAttentionVolumeOpacity(remoteAttention),
    )
  } else {
    paintVolumeMaterials(
      renderObject.volume.material,
      'idle',
      TACTICAL_CAGE_OPACITY.face.idleReset,
    )
  }

  const edgeMaterial = renderObject.edges.material as THREE.LineBasicMaterial
  const edgeColor = corrected
    ? 0xff4a55
    : (hovered || pending)
        ? resolveVolumeAccentColor(renderObject.accentColor)
        : selected
          ? 0xf7f7f2
          : targeting
            ? resolveVolumeAccentColor(targeting.accentColor ?? renderObject.accentColor)
            : remoteAttentionColor ?? 0xaeb5bd
  const edgeOpacity = remoteAttention && !selected && !hovered && !pending && !corrected && !targeting
    ? remoteAttentionEdgeOpacity(remoteAttention)
    : localTacticalCageEdgeOpacity(tacticalCageState)

  edgeMaterial.color.set(edgeColor)
  // Idle edge styling remains available for material reset, but only
  // tactical cage states render a hard outline on the board.
  edgeMaterial.opacity = edgeOpacity
  edgeMaterial.transparent = edgeOpacity < 1
  edgeMaterial.depthTest = true
  edgeMaterial.depthWrite = false
  renderObject.liftTarget = selectionLiftTarget(selected)
}

const applyObjectVisibility = (object: THREE.Object3D, nextVisible: boolean) => {
  if (object.visible !== nextVisible) object.visible = nextVisible
}

const applyElementDisplay = (element: HTMLElement, nextDisplay: string) => {
  if (element.style.display !== nextDisplay) element.style.display = nextDisplay
}

export const setPokemonRenderObjectLayerVisibility = (
  renderObject: PokemonRenderObject,
  layers: LayerVisibility,
) => {
  const tokens = layers.tokens
  applyObjectVisibility(renderObject.sprite, tokens)
  applyObjectVisibility(renderObject.spriteState.halo, tokens)
  const cageVisible = tokens && renderObject.cageVisible
  applyObjectVisibility(renderObject.volume, cageVisible)
  applyObjectVisibility(renderObject.edges, cageVisible)
  applyObjectVisibility(renderObject.proxy, tokens)
  applyObjectVisibility(renderObject.combatStageGlass.mesh, tokens && renderObject.combatStageGlass.active)
  applyObjectVisibility(renderObject.elevationBadge, tokens && renderObject.elevationBadge.visible)
  applyObjectVisibility(renderObject.hpBar, tokens && renderObject.hpBar.visible)
  applyElementDisplay(renderObject.elevationBadge.element, tokens ? '' : 'none')
  applyElementDisplay(renderObject.hpBar.element, tokens ? '' : 'none')
  // Contact shadow is the persistent sprite-grounding cue, not part of the cage.
  applyObjectVisibility(renderObject.shadow, tokens && layers.shadows)
}

export const resolvePokemonRenderObjectVisualFacing = (
  renderObject: PokemonRenderObject,
): Pick<PokemonRenderObject, 'facing' | 'turned'> => {
  const activeTrack = renderObject.motion.track
  const facingPlan = renderObject.motion.facing
  const facing = activeTrack && facingPlan?.track === activeTrack
    ? facingPlan.travelFacing ?? renderObject.facing
    : renderObject.facing

  return {
    facing,
    turned: tokenFacingStoresLegacyTurned(facing),
  }
}

type TokenSelectionLiftResolvedStyle = ReturnType<typeof tokenSelectionLiftStyle>

const clampTokenVisualOpacity = (opacity: number): number => Math.max(0, Math.min(1, opacity))

export const applyPokemonRenderObjectMotionPolish = (
  renderObject: PokemonRenderObject,
  options: {
    frameNowMs: number
    liftStyle: TokenSelectionLiftResolvedStyle
  },
): TokenMotionPolishSample => {
  const polish = renderObject.motion.track
    ? sampleTokenMotionPolish(renderObject.motion.track, options.frameNowMs)
    : TOKEN_MOTION_POLISH_IDLE_SAMPLE

  // Rebuild base sprite/halo dimensions every frame so the pulse never
  // accumulates, then apply only a tiny cosmetic scale on top.
  setWorldSpriteSize(renderObject.spriteState, renderObject)
  renderObject.sprite.scale.x *= polish.spriteScale
  renderObject.sprite.scale.y *= polish.spriteScale
  renderObject.spriteState.halo.scale.x *= polish.haloScale
  renderObject.spriteState.halo.scale.y *= polish.haloScale

  if (polish.haloOpacityBonus > 0) {
    renderObject.spriteState.haloMaterial.opacity = clampTokenVisualOpacity(
      renderObject.spriteState.haloMaterial.opacity + polish.haloOpacityBonus,
    )
  }

  renderObject.shadow.scale.set(
    options.liftStyle.shadowScaleX * polish.shadowScale,
    options.liftStyle.shadowScaleY * polish.shadowScale,
    1,
  )
  renderObject.shadow.material.opacity = clampTokenVisualOpacity(
    options.liftStyle.shadowOpacity * polish.shadowOpacityMultiplier,
  )

  return polish
}

export const animatePokemonRenderObject = (
  renderObject: PokemonRenderObject,
  options: {
    camera: THREE.Camera
    damping: number
    frameNowMs: number
    spriteBrightness: number
    haloAlpha: number
  },
) => {
  const visualFacing = resolvePokemonRenderObjectVisualFacing(renderObject)

  const previousVisualYOffset = pokemonRenderObjectVisualYOffset(renderObject)
  const facingUpdate = updateSpriteFacing(renderObject.spriteState, {
    camera: options.camera,
    center: renderObject.currentCenter,
    facingDirection: tokenFacingVector(visualFacing.facing),
    frontSpriteUrl: renderObject.spriteUrl,
    frontSpriteAnimation: renderObject.spriteAnimation,
    backSpriteUrl: renderObject.backSpriteUrl,
    backSpriteAnimation: renderObject.backSpriteAnimation,
    spriteCrop: renderObject.spriteCrop,
    turned: visualFacing.turned,
  })
  setPokemonRenderObjectActiveSpriteAsset(renderObject, facingUpdate.asset)
  const visualYOffsetDelta = pokemonRenderObjectVisualYOffset(renderObject) - previousVisualYOffset
  if (visualYOffsetDelta !== 0) {
    renderObject.sprite.position.y += visualYOffsetDelta
    renderObject.spriteState.halo.position.y += visualYOffsetDelta
  }
  if (renderObject.spriteState.animationMeta) {
    applyAnimationFrame(renderObject.spriteState, options.frameNowMs)
  }
  updateWorldSpriteLighting(renderObject.spriteState, options.spriteBrightness, options.haloAlpha)

  // Selection lift: sprite + HP bar pop up while the tactical footprint
  // stays anchored. The contact shadow scales up and fades so it reads as
  // a more diffuse blob — the visible detachment is the "off the ground" cue.
  renderObject.liftFactor = nextSelectionLiftFactor(
    renderObject.liftFactor,
    renderObject.liftTarget,
    options.damping,
  )

  const liftStyle = tokenSelectionLiftStyle(renderObject.liftFactor)
  if (liftStyle.spriteLift > 0) {
    renderObject.sprite.position.y += liftStyle.spriteLift
    renderObject.spriteState.halo.position.y += liftStyle.spriteLift
    if (renderObject.hpBar.visible) {
      renderObject.hpBar.position.y += liftStyle.spriteLift
    }
  }

  // Non-uniform: lift grows the disc, X-stretch elongates it along
  // the isometric shadow axis so it reads as an ellipse falling away
  // from the implied light, not a perfect circle. Motion polish composes
  // a very small start/end pulse while leaving the contact shadow visible.
  applyPokemonRenderObjectMotionPolish(renderObject, {
    frameNowMs: options.frameNowMs,
    liftStyle,
  })
}

export const disposePokemonRenderObject = (renderObject: PokemonRenderObject) => {
  clearPokemonRenderObjectMotionTrack(renderObject)
  disposeWorldSprite(renderObject.spriteState)
  disposeObject3D(renderObject.elevationBadge)
  disposeObject3D(renderObject.hpBar)
  disposeTokenCombatStageGlass(renderObject.combatStageGlass)
  disposeTokenRenderableWithGeometryLease(renderObject, 'volumeBox', renderObject.volume)
  disposeTokenRenderableWithGeometryLease(renderObject, 'volumeEdges', renderObject.edges)
  disposeTokenRenderableWithGeometryLease(renderObject, 'proxyBox', renderObject.proxy)
  disposeObject3D(renderObject.shadow)
}

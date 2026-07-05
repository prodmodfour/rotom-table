import * as THREE from 'three'
import type { LayerVisibility } from '~/types/map'
import type { SpawnedPokemon } from '~/types/pokemon'
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
import type { PokemonRenderObject } from '~/utils/isometric/types'
import type {
  TokenGeometryLease,
  TokenRenderGeometryCache,
  TokenRenderGeometryLeases,
} from '~/utils/isometric/tokenGeometryCache'
import { tokenFacingVector } from '~/utils/tokenFacing'
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
  // so the cage reads above the terrain instead of merging with it.
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
    cageVisible: true,
    proxy,
    shadow,
    ...(geometryLeases ? { geometryLeases } : {}),
    currentCenter,
    targetCenter,
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
  if (tokenDimensionsChanged(renderObject, spawnState)) {
    applyPokemonRenderObjectDimensions(renderObject, pokemon, spawnState, options)
  }
  renderObject.targetCenter.set(spawnState.center.x, spawnState.center.y, spawnState.center.z)
  renderObject.elevation = spawnState.elevation
  renderObject.spriteUrl = spawnState.spriteUrl
  renderObject.backSpriteUrl = spawnState.backSpriteUrl
  renderObject.spriteAnimation = spawnState.spriteAnimation
  renderObject.backSpriteAnimation = spawnState.backSpriteAnimation
  renderObject.spriteCrop = spawnState.spriteCrop
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
  renderObject.sprite.position.set(
    renderObject.currentCenter.x,
    renderObject.currentCenter.y,
    renderObject.currentCenter.z,
  )
  renderObject.spriteState.halo.position.copy(renderObject.sprite.position)
  renderObject.volume.position.set(
    renderObject.currentCenter.x,
    renderObject.currentCenter.y + renderObject.clearance / 2,
    renderObject.currentCenter.z,
  )
  renderObject.edges.position.copy(renderObject.volume.position)
  renderObject.proxy.position.set(
    renderObject.currentCenter.x,
    renderObject.currentCenter.y + Math.max(renderObject.height, renderObject.clearance) / 2,
    renderObject.currentCenter.z,
  )
  // Voxel-aware projection: shadow drops to whatever surface is
  // beneath the sprite (floor or highest voxel top in the footprint),
  // not glued to the sprite's foot. Tiny y-offset dodges z-fighting
  // with the floor plane / voxel top.
  const surfaceY = options.getShadowSurfaceY(
    renderObject.currentCenter.x,
    renderObject.currentCenter.z,
    renderObject.base,
    renderObject.currentCenter.y,
  )
  renderObject.shadow.position.set(
    renderObject.currentCenter.x,
    surfaceY + 0.005,
    renderObject.currentCenter.z,
  )
  cssHudChanged = updateElevationBadge({
    badge: renderObject.elevationBadge,
    center: renderObject.currentCenter,
    base: renderObject.base,
    elevation: renderObject.elevation,
    groundLevelY: options.groundLevelY,
    camera: options.camera,
    accentColor: renderObject.accentColor,
    show: options.hoveredPokemonId === renderObject.id && options.layers.tokens,
  }) || cssHudChanged
  updateTokenCombatStageGlass({
    glass: renderObject.combatStageGlass,
    center: renderObject.currentCenter,
    base: renderObject.base,
    clearance: renderObject.clearance,
    stages: renderObject.combatStages,
    camera: options.camera,
    show: options.layers.tokens,
  })
  cssHudChanged = updateHpBar({
    bar: renderObject.hpBar,
    center: renderObject.currentCenter,
    spriteHeight: renderObject.height,
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

const remoteAttentionVolumeOpacity = (attention: PokemonRenderObjectRemoteAttention): number => {
  const countBoost = Math.min(0.1, Math.max(0, attention.totalCount - 1) * 0.035)
  return (attention.selectedCount > 0 ? 0.29 : 0.22) + countBoost
}

const remoteAttentionEdgeOpacity = (attention: PokemonRenderObjectRemoteAttention): number => {
  const countBoost = Math.min(0.14, Math.max(0, attention.totalCount - 1) * 0.045)
  return (attention.selectedCount > 0 ? 0.74 : 0.54) + countBoost
}

export const paintPokemonRenderObjectStyle = (
  renderObject: PokemonRenderObject,
  selected: boolean,
  options: {
    hovered?: boolean
    pending?: boolean
    corrected?: boolean
    remoteAttention?: PokemonRenderObjectRemoteAttention
  } = {},
) => {
  const hovered = options.hovered === true
  const pending = options.pending === true
  const corrected = options.corrected === true
  const remoteAttention = hasRemoteAttention(options.remoteAttention) ? options.remoteAttention : undefined
  const remoteAttentionColor = remoteAttention ? resolveVolumeAccentColor(remoteAttention.primaryColor) : null

  // Re-tint the per-face material array with the appropriate tactical
  // theme ramp instead of a single solid color. Hover uses the token's
  // trainer/app accent so the cage identifies ownership without changing
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
      selected ? 0.38 : 0.34,
    )
  } else if (hovered || pending) {
    paintVolumeFacePalette(
      renderObject.volume.material,
      accentVolumeFacePalette(renderObject.accentColor),
      selected ? 0.38 : pending ? 0.32 : 0.34,
    )
  } else if (selected) {
    paintVolumeMaterials(
      renderObject.volume.material,
      'selected',
      0.32,
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
      0.28,
    )
  }

  const edgeMaterial = renderObject.edges.material as THREE.LineBasicMaterial
  const edgeColor = corrected
    ? 0xff4a55
    : (hovered || pending)
        ? resolveVolumeAccentColor(renderObject.accentColor)
        : selected ? 0xf7f7f2 : remoteAttentionColor ?? 0xaeb5bd
  const edgeOpacity = corrected
    ? 1
    : (hovered || pending)
        ? selected ? 1 : pending ? 0.82 : 0.9
        : selected ? 0.95 : remoteAttention ? remoteAttentionEdgeOpacity(remoteAttention) : 0.35

  edgeMaterial.color.set(edgeColor)
  // Idle edges fade so the cage reads via faces; selection/hover sharpens
  // them back up so the active pointer target has a clear hard outline.
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
  applyObjectVisibility(renderObject.shadow, layers.shadows && tokens)
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
  updateSpriteFacing(renderObject.spriteState, {
    camera: options.camera,
    center: renderObject.currentCenter,
    facingDirection: tokenFacingVector(renderObject.facing),
    frontSpriteUrl: renderObject.spriteUrl,
    frontSpriteAnimation: renderObject.spriteAnimation,
    backSpriteUrl: renderObject.backSpriteUrl,
    backSpriteAnimation: renderObject.backSpriteAnimation,
    spriteCrop: renderObject.spriteCrop,
  })
  if (renderObject.spriteState.animationMeta) {
    applyAnimationFrame(renderObject.spriteState, options.frameNowMs)
  }
  updateWorldSpriteLighting(renderObject.spriteState, options.spriteBrightness, options.haloAlpha)

  // Selection lift: sprite + HP bar pop up, cage stays anchored,
  // shadow scales up and fades so it reads as a more diffuse blob
  // — the visible detachment is the "off the ground" cue.
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
  // the cage's shadow axis so it reads as an ellipse falling away
  // from the implied light, not a perfect circle.
  renderObject.shadow.scale.set(liftStyle.shadowScaleX, liftStyle.shadowScaleY, 1)
  renderObject.shadow.material.opacity = liftStyle.shadowOpacity
}

export const disposePokemonRenderObject = (renderObject: PokemonRenderObject) => {
  disposeWorldSprite(renderObject.spriteState)
  disposeObject3D(renderObject.elevationBadge)
  disposeObject3D(renderObject.hpBar)
  disposeTokenCombatStageGlass(renderObject.combatStageGlass)
  disposeTokenRenderableWithGeometryLease(renderObject, 'volumeBox', renderObject.volume)
  disposeTokenRenderableWithGeometryLease(renderObject, 'volumeEdges', renderObject.edges)
  disposeTokenRenderableWithGeometryLease(renderObject, 'proxyBox', renderObject.proxy)
  disposeObject3D(renderObject.shadow)
}

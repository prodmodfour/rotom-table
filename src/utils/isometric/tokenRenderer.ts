import * as THREE from 'three'
import type { LayerVisibility } from '~/types/map'
import type { SpawnedPokemon } from '~/types/pokemon'
import { buildVolumeMaterials, paintVolumeMaterials } from '~/utils/isometric/materials'
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
}

type TokenRenderDimensions = Pick<
  ReturnType<typeof pokemonRenderSpawnState>,
  'width' | 'height' | 'base' | 'clearance'
>

const tokenDimensionsChanged = (
  renderObject: PokemonRenderObject,
  spawnState: TokenRenderDimensions,
): boolean => (
  renderObject.width !== spawnState.width ||
  renderObject.height !== spawnState.height ||
  renderObject.base !== spawnState.base ||
  renderObject.clearance !== spawnState.clearance
)

const replaceVolumeGeometry = (renderObject: PokemonRenderObject, base: number, clearance: number) => {
  const volumeGeometry = new THREE.BoxGeometry(base, clearance, base)
  const edgesGeometry = new THREE.EdgesGeometry(volumeGeometry)

  renderObject.volume.geometry.dispose()
  renderObject.volume.geometry = volumeGeometry
  renderObject.edges.geometry.dispose()
  renderObject.edges.geometry = edgesGeometry
}

const replaceProxyGeometry = (renderObject: PokemonRenderObject, pokemon: SpawnedPokemon) => {
  const pickSize = pokemonPickDimensions(pokemon)
  renderObject.proxy.geometry.dispose()
  renderObject.proxy.geometry = new THREE.BoxGeometry(pickSize.width, pickSize.height, pickSize.width)
}

const replaceShadowGeometry = (renderObject: PokemonRenderObject, pokemon: SpawnedPokemon) => {
  renderObject.shadow.geometry.dispose()
  renderObject.shadow.geometry = new THREE.CircleGeometry(contactShadowRadiusForPokemon(pokemon), 32)
}

const applyPokemonRenderObjectDimensions = (
  renderObject: PokemonRenderObject,
  pokemon: SpawnedPokemon,
  spawnState: TokenRenderDimensions,
) => {
  renderObject.width = spawnState.width
  renderObject.height = spawnState.height
  renderObject.base = spawnState.base
  renderObject.clearance = spawnState.clearance

  setWorldSpriteSize(renderObject.spriteState, spawnState)
  replaceVolumeGeometry(renderObject, spawnState.base, spawnState.clearance)
  replaceProxyGeometry(renderObject, pokemon)
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
  const volumeGeometry = new THREE.BoxGeometry(pokemon.base, pokemon.clearance, pokemon.base)
  // Per-face white/graphite shading sits in the foreground brightness band
  // so the cage reads above the terrain instead of merging with it.
  const volume = new THREE.Mesh(
    volumeGeometry,
    buildVolumeMaterials('idle', 0.28),
  )

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(volumeGeometry),
    new THREE.LineBasicMaterial({
      color: 0xaeb5bd,
      transparent: true,
      opacity: 0.55,
      depthTest: true,
      depthWrite: false,
    }),
  )

  const pickSize = pokemonPickDimensions(pokemon)
  const proxy = new THREE.Mesh(
    new THREE.BoxGeometry(pickSize.width, pickSize.height, pickSize.width),
    new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
      colorWrite: false,
    }),
  )
  proxy.userData.pokemonId = pokemon.id

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
    proxy,
    shadow,
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
    maxHp: spawnState.maxHp,
    fullMaxHp: spawnState.fullMaxHp,
    injuries: spawnState.injuries,
    combatStages: spawnState.combatStages,
    conditions: spawnState.conditions,
    tokenItems: spawnState.tokenItems,
    liftFactor: 0,
    liftTarget: 0,
  }
}

export const updatePokemonRenderObjectFromSpawn = (
  renderObject: PokemonRenderObject,
  pokemon: SpawnedPokemon,
) => {
  const spawnState = pokemonRenderSpawnState(pokemon)
  if (tokenDimensionsChanged(renderObject, spawnState)) {
    applyPokemonRenderObjectDimensions(renderObject, pokemon, spawnState)
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
  renderObject.maxHp = spawnState.maxHp
  renderObject.fullMaxHp = spawnState.fullMaxHp
  renderObject.injuries = spawnState.injuries
  renderObject.combatStages = spawnState.combatStages
  renderObject.conditions = spawnState.conditions
  renderObject.tokenItems = spawnState.tokenItems
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
) => {
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
  updateElevationBadge({
    badge: renderObject.elevationBadge,
    center: renderObject.currentCenter,
    base: renderObject.base,
    elevation: renderObject.elevation,
    groundLevelY: options.groundLevelY,
    camera: options.camera,
    show: options.hoveredPokemonId === renderObject.id && options.layers.tokens,
  })
  updateTokenCombatStageGlass({
    glass: renderObject.combatStageGlass,
    center: renderObject.currentCenter,
    base: renderObject.base,
    clearance: renderObject.clearance,
    stages: renderObject.combatStages,
    camera: options.camera,
    show: options.layers.tokens,
  })
  updateHpBar({
    bar: renderObject.hpBar,
    center: renderObject.currentCenter,
    spriteHeight: renderObject.height,
    displayName: renderObject.displayName,
    level: renderObject.level,
    currentHp: renderObject.currentHp,
    maxHp: renderObject.maxHp,
    fullMaxHp: renderObject.fullMaxHp,
    injuries: renderObject.injuries,
    conditions: renderObject.conditions,
    tokenItems: renderObject.tokenItems,
    activeTurn: options.activeTurnId === renderObject.id,
    show: options.layers.tokens,
  })
}

export const paintPokemonRenderObjectStyle = (
  renderObject: PokemonRenderObject,
  selected: boolean,
) => {
  // Re-tint the per-face material array with the appropriate tactical
  // theme ramp instead of a single solid color.
  paintVolumeMaterials(
    renderObject.volume.material,
    selected ? 'selected' : 'idle',
    selected ? 0.32 : 0.28,
  )
  ;(renderObject.edges.material as THREE.LineBasicMaterial).color.set(selected ? 0xf7f7f2 : 0xaeb5bd)
  // Idle edges fade so the cage reads via faces; selection sharpens
  // them back up so the active token has a clear hard outline.
  ;(renderObject.edges.material as THREE.LineBasicMaterial).opacity = selected ? 0.95 : 0.35
  renderObject.liftTarget = selectionLiftTarget(selected)
}

export const setPokemonRenderObjectLayerVisibility = (
  renderObject: PokemonRenderObject,
  layers: LayerVisibility,
) => {
  const tokens = layers.tokens
  renderObject.sprite.visible = tokens
  renderObject.spriteState.halo.visible = tokens
  renderObject.volume.visible = tokens
  renderObject.edges.visible = tokens
  renderObject.proxy.visible = tokens
  renderObject.combatStageGlass.mesh.visible = tokens && renderObject.combatStageGlass.active
  renderObject.elevationBadge.visible = tokens && renderObject.elevationBadge.visible
  renderObject.hpBar.visible = tokens && renderObject.hpBar.visible
  renderObject.elevationBadge.element.style.display = tokens ? '' : 'none'
  renderObject.hpBar.element.style.display = tokens ? '' : 'none'
  renderObject.shadow.visible = layers.shadows && tokens
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
  disposeObject3D(renderObject.volume)
  disposeObject3D(renderObject.edges)
  disposeObject3D(renderObject.proxy)
  disposeObject3D(renderObject.shadow)
}

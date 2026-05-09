import * as THREE from 'three'
import type { LayerVisibility } from '~/types/map'
import type { SpawnedPokemon } from '~/types/pokemon'
import { normalizeCombatStages } from '~/utils/combatStages'
import { getPokemonCenter } from '~/utils/grid'
import { normalizeConditionNames } from '~/utils/statusConditions'
import { buildVolumeMaterials, paintVolumeMaterials } from '~/utils/isometric/materials'
import { disposeObject3D } from '~/utils/isometric/resourceDisposal'
import { buildElevationBadge, buildHpBar, updateElevationBadge, updateHpBar } from '~/utils/isometric/tokenHud'
import type { PokemonRenderObject } from '~/utils/isometric/types'
import {
  applyAnimationFrame,
  buildContactShadow,
  buildWorldSprite,
  disposeWorldSprite,
  updateSpriteFacing,
  updateWorldSpriteLighting,
} from '~/utils/isometric/worldSprites'

// Selection lift: selected pokemon pops up while the shadow stays
// anchored and grows more diffuse. Visible separation between sprite
// and shadow is the strongest "this thing is in 3D" cue available.
const SPRITE_LIFT_AMOUNT = 0.08
const SHADOW_LIFT_SCALE = 1.3
const SHADOW_LIFT_OPACITY = 0.55

// Slight ellipse along the cage's shadow axis (±X). Mimics how shadows
// fall away from a light source instead of reading as a perfect circle.
const SHADOW_X_STRETCH = 1.15

export type ShadowSurfaceResolver = (
  centerX: number,
  centerZ: number,
  base: number,
  footY: number,
) => number

export const createPokemonRenderObject = (
  pokemon: SpawnedPokemon,
  containers: {
    scene: THREE.Scene
    worldGroup: THREE.Group
  },
): PokemonRenderObject => {
  const spriteState = buildWorldSprite(pokemon)
  const sprite = spriteState.sprite
  const elevationBadge = buildElevationBadge()
  const hpBar = buildHpBar(pokemon)
  const shadow = buildContactShadow(pokemon)
  const volumeGeometry = new THREE.BoxGeometry(pokemon.base, pokemon.clearance, pokemon.base)
  // Per-face gruvbox shading: top=fg3, Z-sides=fg4, X-sides=gray.
  // Sits in the foreground brightness band so the cage reads above
  // the bg-band terrain instead of merging with it.
  const volume = new THREE.Mesh(
    volumeGeometry,
    buildVolumeMaterials('idle', 0.28),
  )

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(volumeGeometry),
    new THREE.LineBasicMaterial({
      color: 0xa89984, // fg4
      transparent: true,
      opacity: 0.55,
      depthTest: true,
      depthWrite: false,
    }),
  )

  const pickWidth = Math.max(pokemon.base, pokemon.width, 1)
  const pickHeight = Math.max(pokemon.clearance, pokemon.height, 1)
  const proxy = new THREE.Mesh(
    new THREE.BoxGeometry(pickWidth, pickHeight, pickWidth),
    new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
      colorWrite: false,
    }),
  )
  proxy.userData.pokemonId = pokemon.id

  const center = getPokemonCenter(pokemon)
  const currentCenter = new THREE.Vector3(center.x, center.y, center.z)
  const targetCenter = currentCenter.clone()

  containers.worldGroup.add(shadow)
  containers.worldGroup.add(volume)
  containers.worldGroup.add(edges)
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
    volume,
    edges,
    proxy,
    shadow,
    currentCenter,
    targetCenter,
    width: pokemon.width,
    height: pokemon.height,
    base: pokemon.base,
    clearance: pokemon.clearance,
    elevation: pokemon.position.y,
    spriteUrl: pokemon.spriteUrl,
    backSpriteUrl: pokemon.backSpriteUrl,
    spriteAnimation: pokemon.spriteAnimation,
    backSpriteAnimation: pokemon.backSpriteAnimation,
    spriteCrop: pokemon.spriteCrop,
    turned: Boolean(pokemon.turned),
    displayName: pokemon.species,
    level: pokemon.level,
    currentHp: pokemon.currentHp,
    maxHp: pokemon.maxHp,
    combatStages: normalizeCombatStages(pokemon.combatStages),
    conditions: normalizeConditionNames(pokemon.conditions),
    tokenItems: [...pokemon.tokenItems],
    liftFactor: 0,
    liftTarget: 0,
  }
}

export const updatePokemonRenderObjectFromSpawn = (
  renderObject: PokemonRenderObject,
  pokemon: SpawnedPokemon,
) => {
  const center = getPokemonCenter(pokemon)
  renderObject.targetCenter.set(center.x, center.y, center.z)
  renderObject.elevation = pokemon.position.y
  renderObject.spriteUrl = pokemon.spriteUrl
  renderObject.backSpriteUrl = pokemon.backSpriteUrl
  renderObject.spriteAnimation = pokemon.spriteAnimation
  renderObject.backSpriteAnimation = pokemon.backSpriteAnimation
  renderObject.spriteCrop = pokemon.spriteCrop
  renderObject.turned = Boolean(pokemon.turned)
  renderObject.displayName = pokemon.species
  renderObject.level = pokemon.level
  renderObject.currentHp = pokemon.currentHp
  renderObject.maxHp = pokemon.maxHp
  renderObject.combatStages = normalizeCombatStages(pokemon.combatStages)
  renderObject.conditions = normalizeConditionNames(pokemon.conditions)
  renderObject.tokenItems = [...pokemon.tokenItems]
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
  updateHpBar({
    bar: renderObject.hpBar,
    center: renderObject.currentCenter,
    spriteHeight: renderObject.height,
    displayName: renderObject.displayName,
    level: renderObject.level,
    currentHp: renderObject.currentHp,
    maxHp: renderObject.maxHp,
    combatStages: renderObject.combatStages,
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
  // Re-tint the per-face material array with the appropriate
  // gruvbox terrain ramp instead of a single solid color.
  paintVolumeMaterials(
    renderObject.volume.material,
    selected ? 'selected' : 'idle',
    selected ? 0.32 : 0.28,
  )
  ;(renderObject.edges.material as THREE.LineBasicMaterial).color.set(selected ? 0xfbf1c7 : 0xa89984)
  // Idle edges fade so the cage reads via faces; selection sharpens
  // them back up so the active token has a clear hard outline.
  ;(renderObject.edges.material as THREE.LineBasicMaterial).opacity = selected ? 0.95 : 0.35
  renderObject.liftTarget = selected ? 1 : 0
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
    facingDirection: THREE.Vector2
    damping: number
    frameNowMs: number
    spriteBrightness: number
    haloAlpha: number
  },
) => {
  updateSpriteFacing(renderObject.spriteState, {
    camera: options.camera,
    center: renderObject.currentCenter,
    facingDirection: options.facingDirection,
    frontSpriteUrl: renderObject.spriteUrl,
    frontSpriteAnimation: renderObject.spriteAnimation,
    backSpriteUrl: renderObject.backSpriteUrl,
    backSpriteAnimation: renderObject.backSpriteAnimation,
    spriteCrop: renderObject.spriteCrop,
    turned: renderObject.turned,
  })
  if (renderObject.spriteState.animationMeta) {
    applyAnimationFrame(renderObject.spriteState, options.frameNowMs)
  }
  updateWorldSpriteLighting(renderObject.spriteState, options.spriteBrightness, options.haloAlpha)

  // Selection lift: sprite + HP bar pop up, cage stays anchored,
  // shadow scales up and fades so it reads as a more diffuse blob
  // — the visible detachment is the "off the ground" cue.
  if (Math.abs(renderObject.liftFactor - renderObject.liftTarget) < 0.001) {
    renderObject.liftFactor = renderObject.liftTarget
  } else {
    renderObject.liftFactor = THREE.MathUtils.lerp(
      renderObject.liftFactor,
      renderObject.liftTarget,
      options.damping,
    )
  }

  if (renderObject.liftFactor > 0) {
    const lift = renderObject.liftFactor * SPRITE_LIFT_AMOUNT
    renderObject.sprite.position.y += lift
    renderObject.spriteState.halo.position.y += lift
    if (renderObject.hpBar.visible) {
      renderObject.hpBar.position.y += lift
    }
  }

  // Non-uniform: lift grows the disc, X-stretch elongates it along
  // the cage's shadow axis so it reads as an ellipse falling away
  // from the implied light, not a perfect circle.
  const shadowScale = THREE.MathUtils.lerp(1, SHADOW_LIFT_SCALE, renderObject.liftFactor)
  renderObject.shadow.scale.set(shadowScale * SHADOW_X_STRETCH, shadowScale, 1)
  renderObject.shadow.material.opacity = THREE.MathUtils.lerp(
    1,
    SHADOW_LIFT_OPACITY,
    renderObject.liftFactor,
  )
}

export const disposePokemonRenderObject = (renderObject: PokemonRenderObject) => {
  disposeWorldSprite(renderObject.spriteState)
  disposeObject3D(renderObject.elevationBadge)
  disposeObject3D(renderObject.hpBar)
  disposeObject3D(renderObject.volume)
  disposeObject3D(renderObject.edges)
  disposeObject3D(renderObject.proxy)
  disposeObject3D(renderObject.shadow)
}

import * as THREE from 'three'
import type { SpawnedPokemon, SpriteAnimation, SpriteCrop } from '~/types/pokemon'
import type { WorldSpriteState } from '~/utils/isometric/types'
import {
  acquireAnimatedSpriteTexture,
  acquireStaticSpriteTexture,
  getContactShadowTexture,
  getSpriteHaloTexture,
  getTransparentSpriteTexture,
  type SpriteVisualAsset,
} from '~/utils/isometric/spriteTextures'
import {
  applyWorldSpriteAnimationFrame,
  spriteVisualAssetKey,
} from '~/utils/isometric/worldSpriteAssets'
import { shouldUseFrontWorldSprite } from '~/utils/isometric/worldSpriteFacing'
import {
  getWorldSpriteLightingStyle,
  WORLD_SPRITE_GHOST_HALO_COLOR,
  WORLD_SPRITE_HALO_COLOR,
  WORLD_SPRITE_HALO_MIN_ALPHA,
} from '~/utils/isometric/worldSpriteLighting'

export {
  WORLD_SPRITE_HALO_MAX_ALPHA,
  WORLD_SPRITE_HALO_MIN_ALPHA,
} from '~/utils/isometric/worldSpriteLighting'

export const nowMs = () => (typeof performance === 'undefined' ? Date.now() : performance.now())

export const applyAnimationFrame = applyWorldSpriteAnimationFrame

const setWorldSpriteAsset = (state: WorldSpriteState, asset: SpriteVisualAsset) => {
  const key = spriteVisualAssetKey(asset)
  if (state.assetKey === key) return

  const token = state.loadToken + 1
  state.loadToken = token
  state.assetKey = key

  const handle = asset.animation
    ? acquireAnimatedSpriteTexture(asset.animation.url)
    : acquireStaticSpriteTexture(asset.url, asset.crop)

  handle.promise
    .then((texture) => {
      if (state.loadToken !== token || state.assetKey !== key) {
        handle.release()
        return
      }

      const previousRelease = state.releaseTexture
      state.texture = texture
      state.releaseTexture = handle.release
      state.animationMeta = asset.animation ?? null
      state.currentFrame = -1
      if (state.animationMeta) {
        applyAnimationFrame(state, nowMs())
      }
      state.material.map = texture
      state.material.needsUpdate = true
      previousRelease?.()
    })
    .catch((error) => {
      handle.release()
      if (state.loadToken === token && state.assetKey === key) {
        state.assetKey = null
        console.warn('Failed to load sprite texture', asset.animation?.url ?? asset.url, error)
      }
    })
}

export const setWorldSpriteVisible = (state: WorldSpriteState | null, visible: boolean) => {
  if (!state) return
  state.sprite.visible = visible
  state.halo.visible = visible
}

export const setWorldSpriteInvalid = (state: WorldSpriteState | null, invalid: boolean) => {
  if (!state) return
  state.invalid = invalid
}

export const updateWorldSpriteLighting = (
  state: WorldSpriteState,
  brightness: number,
  haloAlpha: number,
) => {
  const style = getWorldSpriteLightingStyle({
    ghost: state.ghost,
    invalid: state.invalid,
    brightness,
    haloAlpha,
  })

  if (style.materialOpacity !== null) state.material.opacity = style.materialOpacity
  if (style.materialColor.kind === 'rgb') {
    state.material.color.setRGB(
      style.materialColor.r,
      style.materialColor.g,
      style.materialColor.b,
    )
  } else {
    state.material.color.setScalar(style.materialColor.value)
  }
  state.haloMaterial.color.setHex(style.haloColor)
  state.haloMaterial.opacity = style.haloOpacity
}

export const buildWorldSprite = (pokemon: SpawnedPokemon, ghost = false): WorldSpriteState => {
  const material = new THREE.SpriteMaterial({
    map: getTransparentSpriteTexture(),
    alphaTest: 0.5,
    transparent: ghost,
    opacity: ghost ? 0.4 : 1,
    depthTest: true,
    depthWrite: !ghost,
    toneMapped: false,
  })
  const sprite = new THREE.Sprite(material)
  // Bottom-center anchoring keeps the feet planted at the token's
  // ground/elevation Y while preserving the old visual footprint/height.
  sprite.center.set(0.5, 0)
  sprite.scale.set(Math.max(0.1, pokemon.width), Math.max(0.1, pokemon.height), 1)
  sprite.visible = true

  const haloMaterial = new THREE.SpriteMaterial({
    map: getSpriteHaloTexture(),
    color: ghost ? WORLD_SPRITE_GHOST_HALO_COLOR : WORLD_SPRITE_HALO_COLOR,
    transparent: true,
    opacity: ghost ? 0.18 : WORLD_SPRITE_HALO_MIN_ALPHA,
    alphaTest: 0.02,
    // Halo is transparent eye-candy: depth-test it against terrain and
    // sprites, but never write depth or it would occlude real pixels.
    depthTest: true,
    depthWrite: false,
    depthFunc: THREE.LessDepth,
    toneMapped: false,
  })
  const halo = new THREE.Sprite(haloMaterial)
  halo.center.set(0.5, 0)
  halo.scale.set(Math.max(0.1, pokemon.width) * 1.25, Math.max(0.1, pokemon.height) * 1.15, 1)
  halo.visible = true

  const state: WorldSpriteState = {
    sprite,
    material,
    halo,
    haloMaterial,
    texture: null,
    releaseTexture: null,
    assetKey: null,
    loadToken: 0,
    animationMeta: null,
    animationStartedAtMs: nowMs(),
    currentFrame: -1,
    ghost,
    invalid: false,
  }

  setWorldSpriteAsset(state, {
    url: pokemon.spriteUrl,
    animation: pokemon.spriteAnimation,
    crop: pokemon.spriteCrop,
  })

  return state
}

export const disposeWorldSprite = (state: WorldSpriteState | null) => {
  if (!state) return
  state.loadToken += 1
  state.releaseTexture?.()
  state.releaseTexture = null
  state.texture = null
  state.material.map = null
  state.sprite.parent?.remove(state.sprite)
  state.material.dispose()
  state.halo.parent?.remove(state.halo)
  state.haloMaterial.dispose()
}

/**
 * Flat circular contact shadow under a pokemon sprite. Slightly larger
 * than the cage footprint so the soft alpha rim spills past the cage
 * edges, anchoring the billboarded sprite to the ground.
 */
export const buildContactShadow = (
  pokemon: SpawnedPokemon,
): THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial> => {
  // Scale by clearance so a Wailord doesn't share Cutiefly's shadow.
  // Base term keeps small/wide mons grounded; clearance term grows the
  // disc as the cage gets taller without making it absurdly wide.
  const radius = Math.max(pokemon.base, 0.5) * 0.55 + pokemon.clearance * 0.06
  const geometry = new THREE.CircleGeometry(radius, 32)
  const material = new THREE.MeshBasicMaterial({
    map: getContactShadowTexture(),
    transparent: true,
    depthTest: true,
    depthWrite: false,
  })
  const mesh = new THREE.Mesh(geometry, material)
  // Lay flat on the XZ plane so the disc reads as ground shadow.
  mesh.rotation.x = -Math.PI / 2
  return mesh
}

export const updateSpriteFacing = (
  state: WorldSpriteState,
  options: {
    camera: THREE.Camera | null
    center: THREE.Vector3
    facingDirection: THREE.Vector2
    frontSpriteUrl: string
    frontSpriteAnimation?: SpriteAnimation
    backSpriteUrl?: string
    backSpriteAnimation?: SpriteAnimation
    spriteCrop?: SpriteCrop
    turned?: boolean
  },
) => {
  const useBack = Boolean(options.backSpriteUrl && !shouldUseFrontWorldSprite({
    cameraPosition: options.camera?.position ?? null,
    center: options.center,
    facingDirection: options.facingDirection,
    turned: options.turned,
  }))
  setWorldSpriteAsset(state, useBack
    ? {
        url: options.backSpriteUrl!,
        animation: options.backSpriteAnimation,
      }
    : {
        url: options.frontSpriteUrl,
        animation: options.frontSpriteAnimation,
        crop: options.spriteCrop,
      })
}

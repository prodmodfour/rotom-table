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
  applyWorldSpriteTextureTransform,
  setWorldSpriteTextureWindow,
  spriteVisualAssetKey,
} from '~/utils/isometric/worldSpriteAssets'
import {
  resolveWorldSpriteFacing,
  worldSpriteMirrorXForAvailableAsset,
  type WorldSpriteFacingDirection,
  type WorldSpriteFacingVector2,
} from '~/utils/isometric/worldSpriteFacing'
import {
  applyWorldSpriteIsoLightingShader,
  WORLD_SPRITE_ISO_LIGHTING_SHADER_CACHE_KEY,
} from '~/utils/isometric/worldSpriteIsoLighting'
import {
  getWorldSpriteLightingStyle,
  WORLD_SPRITE_GHOST_HALO_COLOR,
  WORLD_SPRITE_HALO_COLOR,
  WORLD_SPRITE_HALO_MIN_ALPHA,
} from '~/utils/isometric/worldSpriteLighting'
import { normalizeTrainerAccentColor } from '~/utils/trainerAccent'

export {
  WORLD_SPRITE_HALO_MAX_ALPHA,
  WORLD_SPRITE_HALO_MIN_ALPHA,
} from '~/utils/isometric/worldSpriteLighting'

export const nowMs = () => (typeof performance === 'undefined' ? Date.now() : performance.now())

export const applyAnimationFrame = applyWorldSpriteAnimationFrame

export const worldSpriteHaloColorForAccent = (accentColor: unknown): number => {
  const normalized = normalizeTrainerAccentColor(accentColor)
  return normalized ? Number.parseInt(normalized.slice(1), 16) : WORLD_SPRITE_HALO_COLOR
}

export type WorldSpriteTextureLoadCompleteCallback = () => void

export interface BuildWorldSpriteOptions {
  ghost?: boolean
  onTextureLoadComplete?: WorldSpriteTextureLoadCompleteCallback | null
}

const normalizeBuildWorldSpriteOptions = (
  options: boolean | BuildWorldSpriteOptions,
): Required<BuildWorldSpriteOptions> => (
  typeof options === 'boolean'
    ? { ghost: options, onTextureLoadComplete: null }
    : {
        ghost: options.ghost ?? false,
        onTextureLoadComplete: options.onTextureLoadComplete ?? null,
      }
)

const notifyWorldSpriteTextureLoadComplete = (state: WorldSpriteState) => {
  state.onTextureLoadComplete?.()
}

const setWorldSpriteAsset = (state: WorldSpriteState, asset: SpriteVisualAsset) => {
  const key = spriteVisualAssetKey(asset)
  if (state.assetKey === key) return

  const token = state.loadToken + 1
  state.loadToken = token
  state.assetKey = key
  state.textureLoading = true

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
      state.textureLoading = false
      state.animationMeta = asset.animation ?? null
      state.currentFrame = -1
      if (state.animationMeta) {
        applyAnimationFrame(state, nowMs())
      } else {
        setWorldSpriteTextureWindow(
          state,
          texture.repeat.x,
          texture.repeat.y,
          texture.offset.x,
          texture.offset.y,
        )
      }
      state.material.map = texture
      state.material.needsUpdate = true
      previousRelease?.()
      notifyWorldSpriteTextureLoadComplete(state)
    })
    .catch((error) => {
      handle.release()
      if (state.loadToken === token && state.assetKey === key) {
        state.textureLoading = false
        state.assetKey = null
        console.warn('Failed to load sprite texture', asset.animation?.url ?? asset.url, error)
        notifyWorldSpriteTextureLoadComplete(state)
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
  state.haloMaterial.color.setHex(!state.ghost && !state.invalid ? state.haloColor : style.haloColor)
  state.haloMaterial.opacity = style.haloOpacity
}

export const setWorldSpriteSize = (
  state: Pick<WorldSpriteState, 'sprite' | 'halo'>,
  dimensions: Pick<SpawnedPokemon, 'width' | 'height'>,
) => {
  const width = Math.max(0.1, dimensions.width)
  const height = Math.max(0.1, dimensions.height)
  state.sprite.scale.set(width, height, 1)
  state.halo.scale.set(width * 1.25, height * 1.15, 1)
}

export const buildWorldSprite = (
  pokemon: SpawnedPokemon,
  options: boolean | BuildWorldSpriteOptions = false,
): WorldSpriteState => {
  const { ghost, onTextureLoadComplete } = normalizeBuildWorldSpriteOptions(options)
  const material = new THREE.SpriteMaterial({
    map: getTransparentSpriteTexture(),
    alphaTest: 0.5,
    transparent: ghost,
    opacity: ghost ? 0.4 : 1,
    depthTest: true,
    depthWrite: !ghost,
    // Side facings mirror the billboard with a negative X scale. Render
    // both windings so mirrored sprites cannot be back-face culled.
    side: THREE.DoubleSide,
    toneMapped: false,
  })
  if (!ghost) {
    // Persistent sprite-local fake lighting replaces the old always-visible cage
    // as the idle dimensional cue while keeping alpha clipping in the material path.
    material.onBeforeCompile = (shader) => applyWorldSpriteIsoLightingShader(shader)
    material.customProgramCacheKey = () => WORLD_SPRITE_ISO_LIGHTING_SHADER_CACHE_KEY
  }
  const sprite = new THREE.Sprite(material)
  // Bottom-center anchoring keeps the feet planted at the token's
  // ground/elevation Y while preserving the old visual footprint/height.
  sprite.center.set(0.5, 0)
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
  halo.visible = true

  const state: WorldSpriteState = {
    sprite,
    material,
    halo,
    haloMaterial,
    haloColor: worldSpriteHaloColorForAccent(pokemon.accentColor),
    texture: null,
    releaseTexture: null,
    assetKey: null,
    loadToken: 0,
    textureLoading: false,
    animationMeta: null,
    animationStartedAtMs: nowMs(),
    currentFrame: -1,
    textureRepeat: new THREE.Vector2(1, 1),
    textureOffset: new THREE.Vector2(0, 0),
    mirroredX: false,
    onTextureLoadComplete,
    ghost,
    invalid: false,
  }

  setWorldSpriteSize(state, pokemon)
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
  state.textureLoading = false
  state.releaseTexture?.()
  state.releaseTexture = null
  state.texture = null
  state.onTextureLoadComplete = null
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
export const contactShadowRadiusForPokemon = (
  pokemon: Pick<SpawnedPokemon, 'base' | 'clearance'>,
): number => {
  // Scale by clearance so a Wailord doesn't share Cutiefly's shadow.
  // Base term keeps small/wide mons grounded; clearance term grows the
  // disc as the cage gets taller without making it absurdly wide.
  return Math.max(pokemon.base, 0.5) * 0.55 + pokemon.clearance * 0.06
}

export const buildContactShadow = (
  pokemon: SpawnedPokemon,
): THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial> => {
  const geometry = new THREE.CircleGeometry(contactShadowRadiusForPokemon(pokemon), 32)
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

const applyWorldSpriteMirrorX = (state: WorldSpriteState, mirrorX: boolean) => {
  if (state.mirroredX === mirrorX) return
  state.mirroredX = mirrorX
  applyWorldSpriteTextureTransform(state)
}

const cameraWorldDirection = new THREE.Vector3()
const spriteToCameraDirection: WorldSpriteFacingVector2 = { x: 0, z: 0 }

const getOrthographicSpriteToCameraDirection = (camera: THREE.Camera | null): WorldSpriteFacingVector2 | null => {
  if (!camera || (camera as THREE.OrthographicCamera).isOrthographicCamera !== true) return null
  camera.getWorldDirection(cameraWorldDirection)
  spriteToCameraDirection.x = -cameraWorldDirection.x
  spriteToCameraDirection.z = -cameraWorldDirection.z
  return spriteToCameraDirection
}

export const updateSpriteFacing = (
  state: WorldSpriteState,
  options: {
    camera: THREE.Camera | null
    center: THREE.Vector3
    facingDirection: WorldSpriteFacingDirection
    frontSpriteUrl: string
    frontSpriteAnimation?: SpriteAnimation
    backSpriteUrl?: string
    backSpriteAnimation?: SpriteAnimation
    spriteCrop?: SpriteCrop
    turned?: boolean
  },
) => {
  const facing = resolveWorldSpriteFacing({
    cameraPosition: options.camera?.position ?? null,
    toCameraDirection: getOrthographicSpriteToCameraDirection(options.camera),
    center: options.center,
    facingDirection: options.facingDirection,
    turned: options.turned,
  })
  const hasBackSprite = Boolean(options.backSpriteUrl)
  const useBack = hasBackSprite && facing.asset === 'back'
  applyWorldSpriteMirrorX(state, worldSpriteMirrorXForAvailableAsset(facing, hasBackSprite))
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

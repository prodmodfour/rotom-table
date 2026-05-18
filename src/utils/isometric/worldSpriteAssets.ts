import type { SpriteAnimation } from '~/types/pokemon'
import type { SpriteVisualAsset } from '~/utils/isometric/spriteTextures'
import type { WorldSpriteState } from '~/utils/isometric/types'

export const spriteAnimationFrameAt = (animation: SpriteAnimation, elapsedMs: number): number => {
  const fallbackDuration = animation.durationsMs.at(-1) ?? 100
  const totalDuration = animation.totalDurationMs > 0
    ? animation.totalDurationMs
    : animation.durationsMs.reduce((sum, duration) => sum + duration, 0)

  if (animation.frames <= 1 || totalDuration <= 0) return 0

  let remaining = ((elapsedMs % totalDuration) + totalDuration) % totalDuration
  for (let i = 0; i < animation.frames; i += 1) {
    const duration = animation.durationsMs[i] ?? fallbackDuration
    if (remaining < duration) return i
    remaining -= duration
  }
  return animation.frames - 1
}

export const spriteVisualAssetKey = (asset: SpriteVisualAsset): string => {
  const crop = asset.crop
    ? `${asset.crop.canvasWidth},${asset.crop.canvasHeight},${asset.crop.left},${asset.crop.top},${asset.crop.width},${asset.crop.height}`
    : 'full'
  return `${asset.animation?.url ?? asset.url}|${asset.animation ? 'animated' : 'static'}|${crop}`
}

export const applyWorldSpriteTextureTransform = (state: WorldSpriteState): void => {
  const texture = state.texture
  if (!texture) return

  const repeatX = state.mirroredX ? -state.textureRepeat.x : state.textureRepeat.x
  const offsetX = state.mirroredX
    ? state.textureOffset.x + state.textureRepeat.x
    : state.textureOffset.x

  texture.repeat.set(repeatX, state.textureRepeat.y)
  texture.offset.set(offsetX, state.textureOffset.y)
  texture.needsUpdate = true
}

export const setWorldSpriteTextureWindow = (
  state: WorldSpriteState,
  repeatX: number,
  repeatY: number,
  offsetX: number,
  offsetY: number,
): void => {
  state.textureRepeat.set(repeatX, repeatY)
  state.textureOffset.set(offsetX, offsetY)
  applyWorldSpriteTextureTransform(state)
}

export const applyWorldSpriteAnimationFrame = (
  state: WorldSpriteState,
  timestampMs: number,
): void => {
  const animation = state.animationMeta
  const texture = state.texture
  if (!animation || !texture) return

  const frame = spriteAnimationFrameAt(animation, timestampMs - state.animationStartedAtMs)
  if (frame === state.currentFrame) return

  const columns = Math.max(1, animation.columns)
  const rows = Math.max(1, animation.rows)
  const column = frame % columns
  const row = Math.floor(frame / columns)

  setWorldSpriteTextureWindow(
    state,
    1 / columns,
    1 / rows,
    column / columns,
    1 - (row + 1) / rows,
  )
  state.currentFrame = frame
}

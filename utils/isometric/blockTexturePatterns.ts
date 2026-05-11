import { blockHexCss, type BlockTextureRole } from './blockTextureColors'
import { BLOCK_TEXTURE_SIZE } from './blockTextureConstants'
import { paintResolvedBlockTexturePattern } from './blockTexturePainters'

export { BLOCK_TEXTURE_SIZE }

export type BlockTexturePatternKind =
  | 'custom'
  | 'grass-top'
  | 'grass-side'
  | 'grass-bottom'
  | 'dirt'
  | 'stone'
  | 'water'
  | 'snow'
  | 'sand'
  | 'wood'
  | 'lava'
  | 'hazard-stripe'
  | 'tech-panel'

export interface BlockTexturePatternInput {
  role: BlockTextureRole
  materialId: string
  tags: ReadonlySet<string>
  isCustom: boolean
}

export interface BlockTexturePaintInput extends BlockTexturePatternInput {
  seed: number
  baseColor: number
  transparent?: boolean
}

export interface BlockTextureOverlayInput {
  tags: ReadonlySet<string>
  isCustom: boolean
  transparent?: boolean
}

const hasAnyTag = (tags: ReadonlySet<string>, candidates: readonly string[]): boolean =>
  candidates.some((tag) => tags.has(tag))

export const resolveBlockTexturePattern = ({
  role,
  materialId,
  tags,
  isCustom,
}: BlockTexturePatternInput): BlockTexturePatternKind => {
  if (isCustom) return 'custom'
  if (tags.has('grass') || materialId === 'meadow_grass') {
    if (role === 'top') return 'grass-top'
    if (role === 'bottom') return 'grass-bottom'
    return 'grass-side'
  }
  if (hasAnyTag(tags, ['dirt', 'mud', 'wetland'])) return 'dirt'
  if (hasAnyTag(tags, ['stone', 'cave'])) return 'stone'
  if (tags.has('water')) return 'water'
  if (hasAnyTag(tags, ['snow', 'ice'])) return 'snow'
  if (tags.has('sand')) return 'sand'
  if (tags.has('wood')) return 'wood'
  if (hasAnyTag(tags, ['thermal', 'emissive'])) return 'lava'
  if (tags.has('hazard') || materialId === 'hazard_stripe_floor') return 'hazard-stripe'
  if (hasAnyTag(tags, ['metal', 'tile', 'medical', 'electric', 'poison'])) return 'tech-panel'
  return 'custom'
}

export const blockTextureSideDepthOverlayScale = ({
  tags,
  isCustom,
  transparent,
}: BlockTextureOverlayInput): number => {
  if (isCustom) return 0.78
  if (tags.has('water') || tags.has('glass') || transparent) return 0.5
  if (tags.has('thermal') || tags.has('emissive')) return 0.52
  if (tags.has('snow') || tags.has('ice')) return 0.66
  if (tags.has('sand')) return 0.9
  if (tags.has('metal')) return 1.08
  return 1
}

const SIDE_DEPTH_MAX_ALPHA: Record<BlockTextureRole, number> = {
  top: 0,
  side: 0.16,
  shadow: 0.24,
  bottom: 0.28,
}

const drawSideDepthOverlay = (
  ctx: CanvasRenderingContext2D,
  role: BlockTextureRole,
  intensity = 1,
) => {
  if (role === 'top') return

  const maxAlpha = SIDE_DEPTH_MAX_ALPHA[role] * intensity
  if (maxAlpha <= 0) return

  ctx.save()
  ctx.fillStyle = '#000000'
  for (let y = 0; y < BLOCK_TEXTURE_SIZE; y += 1) {
    const t = y / (BLOCK_TEXTURE_SIZE - 1)
    ctx.globalAlpha = Math.pow(t, 1.35) * maxAlpha
    ctx.fillRect(0, y, BLOCK_TEXTURE_SIZE, 1)
  }
  ctx.restore()

  // A one-pixel contact seam at the bottom of vertical faces makes
  // stacked blocks read as separate physical layers without adding UI.
  ctx.save()
  ctx.globalAlpha = (role === 'shadow' ? 0.34 : role === 'bottom' ? 0.3 : 0.26) * intensity
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, BLOCK_TEXTURE_SIZE - 1, BLOCK_TEXTURE_SIZE, 1)
  ctx.restore()

  // Subtle cap lip: a restrained highlight just under the top face.
  ctx.save()
  ctx.globalAlpha = 0.06
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(1, 0, BLOCK_TEXTURE_SIZE - 2, 1)
  ctx.restore()
}

const drawBlockBorder = (ctx: CanvasRenderingContext2D, role: BlockTextureRole) => {
  ctx.save()

  if (role === 'top') {
    // Directional pixel rim instead of a uniform black box. This keeps
    // flat fields calm while still giving lit/back edges and lower/front
    // edges a subtle material cue.
    ctx.globalAlpha = 0.1
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, BLOCK_TEXTURE_SIZE, 1)
    ctx.fillRect(0, 0, 1, BLOCK_TEXTURE_SIZE)

    ctx.globalAlpha = 0.12
    ctx.fillStyle = '#000000'
    ctx.fillRect(0, BLOCK_TEXTURE_SIZE - 1, BLOCK_TEXTURE_SIZE, 1)
    ctx.fillRect(BLOCK_TEXTURE_SIZE - 1, 0, 1, BLOCK_TEXTURE_SIZE)
    ctx.restore()
    return
  }

  ctx.globalAlpha = role === 'side' ? 0.09 : role === 'shadow' ? 0.12 : 0.14
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, 1, BLOCK_TEXTURE_SIZE)
  ctx.fillRect(BLOCK_TEXTURE_SIZE - 1, 0, 1, BLOCK_TEXTURE_SIZE)

  ctx.globalAlpha = role === 'side' ? 0.16 : role === 'shadow' ? 0.2 : 0.22
  ctx.fillRect(0, BLOCK_TEXTURE_SIZE - 1, BLOCK_TEXTURE_SIZE, 1)
  ctx.restore()
}

export const paintBlockTexture = (
  ctx: CanvasRenderingContext2D,
  input: BlockTexturePaintInput,
) => {
  paintResolvedBlockTexturePattern(ctx, input, resolveBlockTexturePattern(input))
  drawSideDepthOverlay(ctx, input.role, blockTextureSideDepthOverlayScale(input))
  drawBlockBorder(ctx, input.role)
}

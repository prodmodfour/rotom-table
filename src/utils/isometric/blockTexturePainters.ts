import type {
  BlockTexturePaintInput,
  BlockTexturePatternKind,
} from './blockTexturePatterns'
import {
  drawHazardStripeOverlay,
  drawTechPanelOverlay,
  paintCustomTexture,
  paintDirtTexture,
  paintGrassSideTexture,
  paintGrassTopTexture,
  paintLavaTexture,
  paintPathTexture,
  paintSandTexture,
  paintSnowTexture,
  paintStoneTexture,
  paintWaterTexture,
  paintWoodTexture,
} from './blockTexturePrimitivePainters'

export const paintResolvedBlockTexturePattern = (
  ctx: CanvasRenderingContext2D,
  input: BlockTexturePaintInput,
  pattern: BlockTexturePatternKind,
) => {
  const { role, seed, baseColor, tags } = input
  switch (pattern) {
    case 'grass-top':
      paintGrassTopTexture(ctx, seed)
      break
    case 'grass-side':
      paintGrassSideTexture(ctx, role, seed)
      break
    case 'grass-bottom':
      paintDirtTexture(ctx, role, seed)
      break
    case 'dirt':
      paintDirtTexture(ctx, role, seed, baseColor)
      break
    case 'stone':
      paintStoneTexture(ctx, role, seed)
      break
    case 'water':
      paintWaterTexture(ctx, role, seed, baseColor)
      break
    case 'snow':
      paintSnowTexture(ctx, role, seed)
      break
    case 'sand':
      paintSandTexture(ctx, role, seed)
      break
    case 'wood':
      paintWoodTexture(ctx, role, seed)
      break
    case 'lava':
      paintLavaTexture(ctx, role, seed)
      break
    case 'hazard-stripe':
      paintPathTexture(ctx, role, seed)
      if (role === 'top') drawHazardStripeOverlay(ctx)
      break
    case 'tech-panel':
      paintCustomTexture(ctx, role, seed, baseColor)
      if (role === 'top') drawTechPanelOverlay(ctx, tags)
      break
    case 'custom':
      paintCustomTexture(ctx, role, seed, baseColor)
      break
  }
}

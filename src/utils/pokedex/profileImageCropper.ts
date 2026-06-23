export const POKEDEX_PROFILE_IMAGE_WIDTH = 192
export const POKEDEX_PROFILE_IMAGE_HEIGHT = 72
export const POKEDEX_PROFILE_IMAGE_PADDING = 4
export const POKEDEX_PROFILE_IMAGE_VISIBLE_HEIGHT_RATIO = 0.38
export const POKEDEX_PROFILE_IMAGE_VERTICAL_FOCUS = 0.18

export interface PokedexProfileImageCropControls {
  zoom: number
  offsetX: number
  offsetY: number
}

export interface PokedexProfileImageBoundingBox {
  left: number
  top: number
  width: number
  height: number
}

export interface PokedexProfileImageSourceMetrics {
  width: number
  height: number
  alphaBox: PokedexProfileImageBoundingBox
}

export const defaultPokedexProfileImageCropControls = (): PokedexProfileImageCropControls => ({
  zoom: 1,
  offsetX: 0,
  offsetY: 0,
})

const fullImageBox = (width: number, height: number): PokedexProfileImageBoundingBox => ({
  left: 0,
  top: 0,
  width,
  height,
})

const alphaBoxFromPixels = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
): PokedexProfileImageBoundingBox => {
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = data[((y * width + x) * 4) + 3]
      if (alpha === 0) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }

  if (maxX < minX || maxY < minY) return fullImageBox(width, height)

  return {
    left: minX,
    top: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  }
}

export const getPokedexProfileImageSourceMetrics = (
  image: CanvasImageSource & { naturalWidth?: number; naturalHeight?: number; width?: number; height?: number },
  scratchCanvas: HTMLCanvasElement,
): PokedexProfileImageSourceMetrics => {
  const width = image.naturalWidth || image.width || 1
  const height = image.naturalHeight || image.height || 1
  scratchCanvas.width = width
  scratchCanvas.height = height

  const context = scratchCanvas.getContext('2d', { willReadFrequently: true })
  if (!context) return { width, height, alphaBox: fullImageBox(width, height) }

  context.clearRect(0, 0, width, height)
  context.drawImage(image, 0, 0, width, height)

  try {
    const pixels = context.getImageData(0, 0, width, height).data
    return { width, height, alphaBox: alphaBoxFromPixels(pixels, width, height) }
  } catch {
    return { width, height, alphaBox: fullImageBox(width, height) }
  }
}

const boundedZoom = (zoom: number): number => Math.min(4, Math.max(0.25, zoom))

export const drawPokedexProfileImageCrop = (
  context: CanvasRenderingContext2D,
  image: CanvasImageSource,
  metrics: PokedexProfileImageSourceMetrics,
  controls: PokedexProfileImageCropControls,
): void => {
  const { alphaBox } = metrics
  const availableWidth = POKEDEX_PROFILE_IMAGE_WIDTH - (POKEDEX_PROFILE_IMAGE_PADDING * 2)
  const availableHeight = POKEDEX_PROFILE_IMAGE_HEIGHT - (POKEDEX_PROFILE_IMAGE_PADDING * 2)
  const defaultScale = Math.min(
    availableWidth / Math.max(alphaBox.width, 1),
    availableHeight / Math.max(alphaBox.height * POKEDEX_PROFILE_IMAGE_VISIBLE_HEIGHT_RATIO, 1),
  )
  const scale = defaultScale * boundedZoom(controls.zoom)
  const profileWidth = alphaBox.width * scale
  const profileHeight = alphaBox.height * scale
  const profileLeft = ((POKEDEX_PROFILE_IMAGE_WIDTH - profileWidth) / 2) + controls.offsetX
  const profileTop = ((POKEDEX_PROFILE_IMAGE_HEIGHT - profileHeight) * POKEDEX_PROFILE_IMAGE_VERTICAL_FOCUS) + controls.offsetY

  context.clearRect(0, 0, POKEDEX_PROFILE_IMAGE_WIDTH, POKEDEX_PROFILE_IMAGE_HEIGHT)
  context.imageSmoothingEnabled = false
  context.drawImage(
    image,
    profileLeft - (alphaBox.left * scale),
    profileTop - (alphaBox.top * scale),
    metrics.width * scale,
    metrics.height * scale,
  )
}

export type BlockTextureRole = 'top' | 'side' | 'shadow' | 'bottom'

export const BLOCK_ROLE_SHADING: Record<BlockTextureRole, number> = {
  top: 1,
  side: 0.82,
  shadow: 0.62,
  bottom: 0.5,
}

export const blockHexCss = (hex: number): string => `#${hex.toString(16).padStart(6, '0')}`

export const clampColorByte = (value: number): number =>
  Math.min(255, Math.max(0, Math.round(value)))

export const scaleBlockColor = (hex: number, factor: number): number =>
  (clampColorByte(((hex >> 16) & 0xff) * factor) << 16) |
  (clampColorByte(((hex >> 8) & 0xff) * factor) << 8) |
  clampColorByte((hex & 0xff) * factor)

export const shiftBlockColor = (hex: number, amount: number): number =>
  (clampColorByte(((hex >> 16) & 0xff) + amount) << 16) |
  (clampColorByte(((hex >> 8) & 0xff) + amount) << 8) |
  clampColorByte((hex & 0xff) + amount)

export const mixBlockColor = (from: number, to: number, t: number): number => {
  const inv = 1 - t
  return (
    clampColorByte(((from >> 16) & 0xff) * inv + ((to >> 16) & 0xff) * t) << 16
  ) | (
    clampColorByte(((from >> 8) & 0xff) * inv + ((to >> 8) & 0xff) * t) << 8
  ) | clampColorByte((from & 0xff) * inv + (to & 0xff) * t)
}

export const shadeBlockColor = (hex: number, role: BlockTextureRole): number =>
  scaleBlockColor(hex, BLOCK_ROLE_SHADING[role])

export const hashString = (input: string): number => {
  let hash = 2166136261
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

export const pixelNoise = (seed: number, x: number, y: number): number => {
  let n = seed ^ Math.imul(x + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(y + 0xc2b2ae35, 0x27d4eb2f)
  n ^= n >>> 15
  n = Math.imul(n, 0x2c1b3c6d)
  n ^= n >>> 12
  n = Math.imul(n, 0x297a2d39)
  n ^= n >>> 15
  return (n >>> 0) / 0xffffffff
}

export const jitterBlockColor = (
  hex: number,
  seed: number,
  x: number,
  y: number,
  spread: number,
): number => shiftBlockColor(hex, Math.round((pixelNoise(seed, x, y) - 0.5) * spread * 2))

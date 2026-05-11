import { describe, expect, it } from 'vitest'
import {
  blockHexCss,
  clampColorByte,
  hashString,
  jitterBlockColor,
  mixBlockColor,
  pixelNoise,
  scaleBlockColor,
  shadeBlockColor,
  shiftBlockColor,
} from '~/utils/isometric/blockTextureColors'

describe('isometric block texture color helpers', () => {
  it('formats and clamps color channels consistently', () => {
    expect(blockHexCss(0x0a)).toBe('#00000a')
    expect(blockHexCss(0xabcdef)).toBe('#abcdef')

    expect(clampColorByte(-12)).toBe(0)
    expect(clampColorByte(12.4)).toBe(12)
    expect(clampColorByte(255.6)).toBe(255)
    expect(clampColorByte(300)).toBe(255)
  })

  it('scales, shifts, mixes, and shades RGB colors by channel', () => {
    expect(scaleBlockColor(0x204060, 0.5)).toBe(0x102030)
    expect(scaleBlockColor(0x80c0ff, 2)).toBe(0xffffff)

    expect(shiftBlockColor(0x102030, 16)).toBe(0x203040)
    expect(shiftBlockColor(0x102030, -64)).toBe(0x000000)

    expect(mixBlockColor(0x000000, 0xffffff, 0.5)).toBe(0x808080)
    expect(mixBlockColor(0xff0000, 0x0000ff, 0.25)).toBe(0xbf0040)

    expect(shadeBlockColor(0x204060, 'top')).toBe(0x204060)
    expect(shadeBlockColor(0x204060, 'side')).toBe(0x1a344f)
    expect(shadeBlockColor(0x204060, 'bottom')).toBe(0x102030)
  })

  it('keeps hash/noise and jitter deterministic for generated textures', () => {
    const seed = hashString('stone:top')
    expect(seed).toBe(hashString('stone:top'))
    expect(seed).not.toBe(hashString('stone:side'))

    const noise = pixelNoise(seed, 4, 7)
    expect(noise).toBe(pixelNoise(seed, 4, 7))
    expect(noise).toBeGreaterThanOrEqual(0)
    expect(noise).toBeLessThanOrEqual(1)

    expect(jitterBlockColor(0x445566, seed, 1, 2, 0)).toBe(0x445566)
    expect(jitterBlockColor(0x445566, seed, 1, 2, 12)).toBe(
      jitterBlockColor(0x445566, seed, 1, 2, 12),
    )
  })
})

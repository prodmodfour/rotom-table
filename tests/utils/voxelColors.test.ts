import { describe, expect, it } from 'vitest'
import type { MapVoxelV2 } from '~/types/map'
import {
  buildFacePalette,
  defaultBuilderVoxelColor,
  hexColorString,
  parseHexColor,
  voxelBaseColor,
  voxelFacePalette,
  voxelGroupKey,
  withDefaultBuilderVoxelColor,
} from '~/utils/voxelColors'

describe('voxel color helpers', () => {
  it('parses and formats six-digit hex colors', () => {
    expect(parseHexColor('#AaBbCc')).toBe(0xaabbcc)
    expect(parseHexColor('00ff11')).toBe(0x00ff11)
    expect(parseHexColor(' #123456 ')).toBe(0x123456)
    expect(parseHexColor('#12345')).toBeNull()
    expect(parseHexColor('not-a-color')).toBeNull()
    expect(hexColorString(0xabc)).toBe('#000abc')
  })

  it('builds deterministic face palettes from a base color', () => {
    expect(buildFacePalette(0x808080)).toEqual({
      top: 0x808080,
      side: 0x666666,
      shadow: 0x4f4f4f,
      bottom: 0x363636,
    })
  })

  it('prefers valid voxel custom colors and falls back to material colors', () => {
    const custom: MapVoxelV2 = { x: 0, y: 0, z: 0, materialId: 'airship_floor_metal', color: '#abcdef' }
    const fallback: MapVoxelV2 = { x: 0, y: 0, z: 0, materialId: 'airship_floor_metal', color: 'invalid' }

    expect(voxelBaseColor(custom)).toBe(0xabcdef)
    expect(voxelBaseColor(fallback)).toBe(0x66717f)
    expect(voxelFacePalette(custom).top).toBe(0xabcdef)
  })

  it('applies deterministic builder water colors without mutating valid custom colors', () => {
    expect(defaultBuilderVoxelColor({ x: 0, y: 0, z: 0, materialId: 'shallow_water' })).toBe('#86d7ee')
    expect(defaultBuilderVoxelColor({ x: 0, y: 0, z: 0, materialId: 'deep_water' })).toBe('#2376a8')
    expect(defaultBuilderVoxelColor({ x: 0, y: 0, z: 0, materialId: 'airship_floor_metal' })).toBeNull()

    const custom: MapVoxelV2 = { x: 0, y: 0, z: 0, materialId: 'shallow_water', color: '#112233' }
    expect(withDefaultBuilderVoxelColor(custom)).toBe(custom)

    const styled = withDefaultBuilderVoxelColor({ x: 0, y: 0, z: 0, materialId: 'shallow_water', color: 'invalid' })
    expect(styled).toEqual({ x: 0, y: 0, z: 0, materialId: 'shallow_water', color: '#86d7ee' })
  })

  it('groups voxels by valid custom color or normalized material id', () => {
    expect(voxelGroupKey({ x: 0, y: 0, z: 0, materialId: 'airship_floor_metal', color: '#000abc' })).toBe('c:000abc')
    expect(voxelGroupKey({ x: 0, y: 0, z: 0, materialId: 'airship_floor_metal', color: 'invalid' })).toBe('m:airship_floor_metal')
  })
})

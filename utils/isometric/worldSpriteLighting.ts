export const WORLD_SPRITE_HALO_MIN_ALPHA = 0.1
export const WORLD_SPRITE_HALO_MAX_ALPHA = 0.28

export const WORLD_SPRITE_HALO_COLOR = 0xfabd2f
export const WORLD_SPRITE_GHOST_HALO_COLOR = 0xd5c4a1
export const WORLD_SPRITE_INVALID_HALO_COLOR = 0xfb4934

export type WorldSpriteMaterialColorStyle =
  | { kind: 'scalar'; value: number }
  | { kind: 'rgb'; r: number; g: number; b: number }

export interface WorldSpriteLightingStyle {
  materialOpacity: number | null
  materialColor: WorldSpriteMaterialColorStyle
  haloColor: number
  haloOpacity: number
}

export interface WorldSpriteLightingStyleOptions {
  ghost: boolean
  invalid: boolean
  brightness: number
  haloAlpha: number
}

const clampMax = (value: number, max: number): number => Math.min(max, value)

export const getWorldSpriteLightingStyle = ({
  ghost,
  invalid,
  brightness,
  haloAlpha,
}: WorldSpriteLightingStyleOptions): WorldSpriteLightingStyle => {
  if (!ghost) {
    return {
      materialOpacity: null,
      materialColor: { kind: 'scalar', value: brightness },
      haloColor: WORLD_SPRITE_HALO_COLOR,
      haloOpacity: haloAlpha,
    }
  }

  if (invalid) {
    return {
      materialOpacity: 0.28,
      materialColor: {
        kind: 'rgb',
        r: clampMax(brightness * 1.05, 1.4),
        g: clampMax(brightness * 0.68, 1),
        b: clampMax(brightness * 0.62, 1),
      },
      haloColor: WORLD_SPRITE_INVALID_HALO_COLOR,
      haloOpacity: 0.16,
    }
  }

  return {
    materialOpacity: 0.4,
    materialColor: { kind: 'scalar', value: clampMax(brightness * 1.2, 1.35) },
    haloColor: WORLD_SPRITE_GHOST_HALO_COLOR,
    haloOpacity: 0.18,
  }
}

import { describe, expect, it } from 'vitest'
import { POKEMON_TYPES } from '~/utils/typeChart'
import {
  DEFAULT_MOVE_VFX_COLOR,
  MOVE_VFX_DARK_MAP_REVIEW_BACKGROUNDS,
  MOVE_VFX_TONE,
  MOVE_VFX_TONE_COLORS,
  MOVE_VFX_TYPE_COLORS,
  moveVfxColorForTone,
  moveVfxColorForType,
  normalizeMoveVfxTone,
  normalizeMoveVfxType,
  type MoveVfxHexColor,
} from '~/utils/moveAnimationPalette'

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i
const MIN_REVIEW_PRIMARY_CONTRAST = 2.1
const MIN_REVIEW_ACCENT_CONTRAST = 3
const MIN_REVIEW_GLOW_CONTRAST = 1.25

const hexChannelToLinear = (hex: MoveVfxHexColor, start: number): number => {
  const channel = Number.parseInt(hex.slice(start, start + 2), 16) / 255
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
}

const relativeLuminance = (hex: MoveVfxHexColor): number => {
  const red = hexChannelToLinear(hex, 1)
  const green = hexChannelToLinear(hex, 3)
  const blue = hexChannelToLinear(hex, 5)

  return (0.2126 * red) + (0.7152 * green) + (0.0722 * blue)
}

const contrastRatio = (foreground: MoveVfxHexColor, background: MoveVfxHexColor): number => {
  const foregroundLuminance = relativeLuminance(foreground)
  const backgroundLuminance = relativeLuminance(background)
  const lighter = Math.max(foregroundLuminance, backgroundLuminance)
  const darker = Math.min(foregroundLuminance, backgroundLuminance)

  return (lighter + 0.05) / (darker + 0.05)
}

const paletteSignature = ({ primary, accent, glow }: {
  primary: MoveVfxHexColor
  accent: MoveVfxHexColor
  glow: MoveVfxHexColor
}): string => `${primary}:${accent}:${glow}`

describe('move animation palette', () => {
  it('provides deterministic readable colour data for every canonical Pokémon type', () => {
    expect(Object.keys(MOVE_VFX_TYPE_COLORS)).toEqual([...POKEMON_TYPES])

    for (const type of POKEMON_TYPES) {
      const color = moveVfxColorForType(type)

      expect(color).toBe(MOVE_VFX_TYPE_COLORS[type])
      expect(color.key).toBe(type)
      expect(color.label).toBe(type)
      expect(color.primary).toMatch(HEX_COLOR_RE)
      expect(color.accent).toMatch(HEX_COLOR_RE)
      expect(color.glow).toMatch(HEX_COLOR_RE)
    }
  })

  it('normalizes known move types without requiring exact input casing', () => {
    expect(normalizeMoveVfxType(' fire ')).toBe('Fire')
    expect(moveVfxColorForType('FIRE')).toBe(MOVE_VFX_TYPE_COLORS.Fire)
    expect(moveVfxColorForType('water')).toBe(MOVE_VFX_TYPE_COLORS.Water)
  })

  it('falls back gracefully for unknown, custom, or missing move types', () => {
    expect(normalizeMoveVfxType('Typeless')).toBeNull()
    expect(moveVfxColorForType('Typeless')).toBe(DEFAULT_MOVE_VFX_COLOR)
    expect(moveVfxColorForType('')).toBe(DEFAULT_MOVE_VFX_COLOR)
    expect(moveVfxColorForType(undefined)).toBe(DEFAULT_MOVE_VFX_COLOR)
    expect(moveVfxColorForType(null)).toBe(DEFAULT_MOVE_VFX_COLOR)
  })

  it('provides semantic tone colours for non-damaging and outcome-specific VFX', () => {
    expect(moveVfxColorForTone(MOVE_VFX_TONE.neutral)).toBe(MOVE_VFX_TONE_COLORS.neutral)
    expect(moveVfxColorForTone(MOVE_VFX_TONE.healing)).toBe(MOVE_VFX_TONE_COLORS.healing)
    expect(moveVfxColorForTone(MOVE_VFX_TONE.status)).toBe(MOVE_VFX_TONE_COLORS.status)
    expect(moveVfxColorForTone(MOVE_VFX_TONE.buff)).toBe(MOVE_VFX_TONE_COLORS.buff)
    expect(moveVfxColorForTone(MOVE_VFX_TONE.debuff)).toBe(MOVE_VFX_TONE_COLORS.debuff)
    expect(moveVfxColorForTone(MOVE_VFX_TONE.miss)).toBe(MOVE_VFX_TONE_COLORS.miss)
    expect(moveVfxColorForTone(MOVE_VFX_TONE.crit)).toBe(MOVE_VFX_TONE_COLORS.crit)

    for (const color of Object.values(MOVE_VFX_TONE_COLORS)) {
      expect(color.primary).toMatch(HEX_COLOR_RE)
      expect(color.accent).toMatch(HEX_COLOR_RE)
      expect(color.glow).toMatch(HEX_COLOR_RE)
    }
  })

  it('normalizes tone aliases and uses neutral for unknown tones', () => {
    expect(normalizeMoveVfxTone(' heal ')).toBe(MOVE_VFX_TONE.healing)
    expect(normalizeMoveVfxTone('critical')).toBe(MOVE_VFX_TONE.crit)
    expect(normalizeMoveVfxTone('unexpected')).toBe(MOVE_VFX_TONE.neutral)
    expect(moveVfxColorForTone('unexpected')).toBe(DEFAULT_MOVE_VFX_COLOR)
    expect(moveVfxColorForTone(undefined)).toBe(DEFAULT_MOVE_VFX_COLOR)
  })

  it('keeps type and semantic VFX colours readable on reviewed dark map backgrounds', () => {
    expect(MOVE_VFX_DARK_MAP_REVIEW_BACKGROUNDS).toHaveLength(8)

    const failures: string[] = []
    const palettes = [...Object.values(MOVE_VFX_TYPE_COLORS), ...Object.values(MOVE_VFX_TONE_COLORS)]

    for (const palette of palettes) {
      for (const background of MOVE_VFX_DARK_MAP_REVIEW_BACKGROUNDS) {
        const primaryContrast = contrastRatio(palette.primary, background.color)
        const accentContrast = contrastRatio(palette.accent, background.color)
        const glowContrast = contrastRatio(palette.glow, background.color)

        if (primaryContrast < MIN_REVIEW_PRIMARY_CONTRAST) {
          failures.push(`${palette.label} primary on ${background.label}: ${primaryContrast.toFixed(2)}`)
        }
        if (accentContrast < MIN_REVIEW_ACCENT_CONTRAST) {
          failures.push(`${palette.label} accent on ${background.label}: ${accentContrast.toFixed(2)}`)
        }
        if (glowContrast < MIN_REVIEW_GLOW_CONTRAST) {
          failures.push(`${palette.label} glow on ${background.label}: ${glowContrast.toFixed(2)}`)
        }
      }
    }

    expect(failures).toEqual([])
  })

  it('keeps neutral and semantic tones distinct from damaging type palettes', () => {
    const typeSignatures = new Set(Object.values(MOVE_VFX_TYPE_COLORS).map(paletteSignature))
    expect(typeSignatures.size).toBe(POKEMON_TYPES.length)

    const semanticTones = [
      MOVE_VFX_TONE.neutral,
      MOVE_VFX_TONE.healing,
      MOVE_VFX_TONE.status,
      MOVE_VFX_TONE.buff,
      MOVE_VFX_TONE.debuff,
    ] as const

    for (const tone of semanticTones) {
      expect(typeSignatures.has(paletteSignature(MOVE_VFX_TONE_COLORS[tone]))).toBe(false)
    }
  })

  it('keeps representative type colours stable for future primitive tests', () => {
    expect(moveVfxColorForType('Fire')).toMatchObject({
      primary: '#ffa566',
      accent: '#ffe08a',
      glow: '#ff6645',
    })
    expect(moveVfxColorForType('Electric')).toMatchObject({
      primary: '#ffdf5c',
      accent: '#fff8b8',
      glow: '#f0af16',
    })
    expect(moveVfxColorForType('Dark')).toMatchObject({
      primary: '#b8c4d6',
      accent: '#f1f5ff',
      glow: '#7e8da4',
    })
  })
})

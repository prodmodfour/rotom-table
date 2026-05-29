import { describe, expect, it } from 'vitest'
import { POKEMON_TYPES } from '~/utils/typeChart'
import {
  DEFAULT_MOVE_VFX_COLOR,
  MOVE_VFX_TONE,
  MOVE_VFX_TONE_COLORS,
  MOVE_VFX_TYPE_COLORS,
  moveVfxColorForTone,
  moveVfxColorForType,
  normalizeMoveVfxTone,
  normalizeMoveVfxType,
} from '~/utils/moveAnimationPalette'

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i

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

  it('keeps representative type colours stable for future primitive tests', () => {
    expect(moveVfxColorForType('Fire')).toMatchObject({
      primary: '#ff6b35',
      accent: '#ffd166',
      glow: '#bf2f1f',
    })
    expect(moveVfxColorForType('Electric')).toMatchObject({
      primary: '#ffd84d',
      accent: '#fff6a8',
      glow: '#d99100',
    })
    expect(moveVfxColorForType('Dark')).toMatchObject({
      primary: '#9aa3b2',
      accent: '#d7deea',
      glow: '#4a5266',
    })
  })
})

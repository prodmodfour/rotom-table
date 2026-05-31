import { describe, expect, it } from 'vitest'
import { MOVE_VFX_TONE, MOVE_VFX_TONE_COLORS, MOVE_VFX_TYPE_COLORS } from '~/utils/moveAnimationPalette'
import {
  moveVfxStatusPaletteForCondition,
  moveVfxStatusPaletteForConditions,
} from '~/utils/moveAnimationStatusPalette'

describe('move animation status palette hints', () => {
  it('maps common condition names and aliases to readable status-cloud palettes', () => {
    expect(moveVfxStatusPaletteForCondition('Burn')).toBe(MOVE_VFX_TYPE_COLORS.Fire)
    expect(moveVfxStatusPaletteForCondition('Badly Poisoned')).toBe(MOVE_VFX_TYPE_COLORS.Poison)
    expect(moveVfxStatusPaletteForCondition('Paralyzed')).toBe(MOVE_VFX_TYPE_COLORS.Electric)
    expect(moveVfxStatusPaletteForCondition('Freeze')).toBe(MOVE_VFX_TYPE_COLORS.Ice)
    expect(moveVfxStatusPaletteForCondition('Confusion')).toBe(MOVE_VFX_TYPE_COLORS.Psychic)
  })

  it('falls back to generic status styling for unknown/custom conditions', () => {
    expect(moveVfxStatusPaletteForCondition('Mystery Fog')).toBeNull()
    expect(moveVfxStatusPaletteForConditions(['Mystery Fog'])).toBe(MOVE_VFX_TONE_COLORS.status)
  })

  it('chooses one deterministic palette for combined status events', () => {
    expect(moveVfxStatusPaletteForConditions(['Confused', 'Burned'])).toBe(MOVE_VFX_TYPE_COLORS.Fire)
    expect(moveVfxStatusPaletteForConditions(['Sleep', 'Paralysis'])).toBe(MOVE_VFX_TYPE_COLORS.Electric)
  })

  it('lets explicit non-status palettes override condition hints', () => {
    expect(moveVfxStatusPaletteForConditions(['Burned'], MOVE_VFX_TYPE_COLORS.Water)).toBe(MOVE_VFX_TYPE_COLORS.Water)
    expect(moveVfxStatusPaletteForConditions(['Burned'], MOVE_VFX_TONE_COLORS[MOVE_VFX_TONE.status])).toBe(MOVE_VFX_TYPE_COLORS.Fire)
  })
})

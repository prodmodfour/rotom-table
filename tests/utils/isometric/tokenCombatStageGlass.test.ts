import { describe, expect, it } from 'vitest'
import { normalizeCombatStages } from '~/utils/combatStages'
import {
  TOKEN_COMBAT_STAGE_GLASS_SLOTS,
  formatCombatStageGlassValue,
  tokenCombatStageGlassHasActiveValues,
  tokenCombatStageGlassSlotValues,
  tokenCombatStageGlassTextureKey,
} from '~/utils/isometric/tokenCombatStageGlass'

describe('token combat stage glass', () => {
  it('keeps combat stage slots in a fixed two-column, three-row layout', () => {
    expect(TOKEN_COMBAT_STAGE_GLASS_SLOTS).toEqual([
      { key: 'acc', label: 'ACC', row: 0, column: 0 },
      { key: 'atk', label: 'ATK', row: 0, column: 1 },
      { key: 'def', label: 'DEF', row: 1, column: 0 },
      { key: 'satk', label: 'SATK', row: 1, column: 1 },
      { key: 'sdef', label: 'SDEF', row: 2, column: 0 },
      { key: 'spd', label: 'SPD', row: 2, column: 1 },
    ])
  })

  it('marks only non-zero stages visible without compacting their positions', () => {
    const values = tokenCombatStageGlassSlotValues(normalizeCombatStages({ acc: -1, atk: 2 }))

    expect(values.map(({ key, row, column }) => ({ key, row, column }))).toEqual(
      TOKEN_COMBAT_STAGE_GLASS_SLOTS.map(({ key, row, column }) => ({ key, row, column })),
    )
    expect(values.filter((slot) => slot.visible).map((slot) => [slot.key, slot.value])).toEqual([
      ['acc', -1],
      ['atk', 2],
    ])
  })

  it('formats and keys clamped stage values for texture reuse', () => {
    const stages = normalizeCombatStages({ acc: -8, def: 9 })

    expect(formatCombatStageGlassValue(3)).toBe('+3')
    expect(formatCombatStageGlassValue(-2)).toBe('-2')
    expect(tokenCombatStageGlassHasActiveValues(normalizeCombatStages())).toBe(false)
    expect(tokenCombatStageGlassHasActiveValues(stages)).toBe(true)
    expect(tokenCombatStageGlassTextureKey(stages)).toBe('acc:-6|atk:0|def:6|satk:0|sdef:0|spd:0')
  })
})

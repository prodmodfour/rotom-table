import { describe, expect, it } from 'vitest'
import { buildTokenMoveTooltipDetail } from '~/utils/mapTokenMoveTooltips'
import { moveAutomationSemanticStatusForMenu } from '~/utils/moveAutomationSemanticStatus'
import type { TokenMoveMenuOption } from '~/utils/mapTokenMoves'

const moveOption = (overrides: Partial<TokenMoveMenuOption> = {}): TokenMoveMenuOption => ({
  name: 'Tackle',
  type: 'Normal',
  damageClass: 'Physical',
  frequency: 'At-Will',
  ac: 3,
  range: 'Melee, 1 Target',
  effect: null,
  special: null,
  damageBase: 6,
  hasStab: true,
  damageAverage: 29,
  damageFormula: '2d6+8+14',
  attackStat: 14,
  baseAttackStat: 10,
  attackStage: 2,
  attackStatKey: 'atk',
  attackStatLabel: 'Attack',
  attackStatAbility: null,
  additionalAttackStat: null,
  additionalBaseAttackStat: null,
  additionalAttackStage: null,
  additionalAttackStatKey: null,
  additionalAttackStatLabel: null,
  automatic: false,
  hasAutomationScript: true,
  automation: moveAutomationSemanticStatusForMenu('Tackle'),
  disabledByAutomation: false,
  conditionUseBlock: null,
  disabledByCondition: false,
  usage: null,
  disabledByUsage: false,
  ...overrides,
})

const sheetBody = (move: TokenMoveMenuOption, mode?: 'average' | 'roll'): string =>
  buildTokenMoveTooltipDetail(move, mode ? { damageDisplayMode: mode } : {})
    .sections.find((section) => section.heading === 'Sheet')?.body ?? ''

describe('map token move tooltips', () => {
  it('shows semantic base status, interaction status, and structured debt before use', () => {
    const automationBody = buildTokenMoveTooltipDetail(moveOption())
      .sections.find((section) => section.heading === 'Automation')?.body ?? ''

    expect(automationBody).toContain('Base automation: Assisted')
    expect(automationBody).toContain('Interaction coverage: Unassessed')
    expect(automationBody).toContain('Capability blocker [movement.authoritative]')
    expect(automationBody).toContain('Limitation [tackle.push]')
    expect(automationBody).toContain('Manual step [tackle.push]')
  })

  it('shows average damage by default and can show damage roll formulas', () => {
    const move = moveOption()

    expect(sheetBody(move)).toContain('Avg Damage: 29')
    expect(sheetBody(move, 'roll')).toContain('Damage Roll: 2d6+8+14')
  })
})

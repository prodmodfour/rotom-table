import { describe, expect, it } from 'vitest'
import {
  appendMoveAutomationHazardCellText,
  canContinueMoveAutomationWizard,
  createMoveAutomationStageDeltaRecord,
  formatMoveAutomationHazardCellLine,
  nextMoveAutomationWizardStep,
  previousMoveAutomationWizardStep,
} from '~/utils/moveAutomationWizardState'

describe('moveAutomationWizardState', () => {
  it('creates independent combat-stage delta records', () => {
    const first = createMoveAutomationStageDeltaRecord()
    const second = createMoveAutomationStageDeltaRecord()

    first.atk = 2

    expect(first).toEqual({ atk: 2, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 })
    expect(second).toEqual({ atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 })
  })

  it('gates wizard continuation by step, selected move, and target requirements', () => {
    expect(canContinueMoveAutomationWizard({
      step: 0,
      hasSelectedMove: false,
      requiresTargets: false,
      selectedTargetCount: 0,
    })).toBe(false)
    expect(canContinueMoveAutomationWizard({
      step: 0,
      hasSelectedMove: true,
      requiresTargets: true,
      selectedTargetCount: 0,
    })).toBe(true)
    expect(canContinueMoveAutomationWizard({
      step: 1,
      hasSelectedMove: true,
      requiresTargets: true,
      selectedTargetCount: 0,
    })).toBe(false)
    expect(canContinueMoveAutomationWizard({
      step: 1,
      hasSelectedMove: true,
      requiresTargets: true,
      selectedTargetCount: 1,
    })).toBe(true)
    expect(canContinueMoveAutomationWizard({
      step: 2,
      hasSelectedMove: false,
      requiresTargets: true,
      selectedTargetCount: 0,
    })).toBe(true)
  })

  it('clamps previous and next wizard steps', () => {
    expect(nextMoveAutomationWizardStep(0, false)).toBe(0)
    expect(nextMoveAutomationWizardStep(0, true)).toBe(1)
    expect(nextMoveAutomationWizardStep(2, true)).toBe(2)
    expect(nextMoveAutomationWizardStep(4, true, 5)).toBe(5)

    expect(previousMoveAutomationWizardStep(0)).toBe(0)
    expect(previousMoveAutomationWizardStep(2)).toBe(1)
    expect(previousMoveAutomationWizardStep(-2)).toBe(0)
  })

  it('formats and appends user hazard cells without preserving surrounding whitespace', () => {
    const position = { x: 3, y: 1, z: 5 }

    expect(formatMoveAutomationHazardCellLine(position)).toBe('3, 1, 5')
    expect(appendMoveAutomationHazardCellText('', position)).toBe('3, 1, 5')
    expect(appendMoveAutomationHazardCellText(' 0, 0, 0 \n', position)).toBe('0, 0, 0\n3, 1, 5')
  })
})

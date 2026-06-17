import { describe, expect, it } from 'vitest'
import {
  IMPLICIT_MOVE_AUTOMATION_TARGET_BRANCH_ID,
  implicitMoveAutomationTargetBranch,
  moveAutomationHasMultipleTargetBranches,
  moveAutomationScriptForTargetBranch,
  moveAutomationTargetBranches,
} from '~/utils/moveAutomationTargetBranches'
import type { MoveAutomationScript, MoveAutomationTargetBranch } from '~/types/moveAutomation'

const script = (overrides: Partial<MoveAutomationScript> = {}): MoveAutomationScript => ({
  kind: 'explicit',
  moveName: 'Test Move',
  version: 1,
  targetMode: 'one-target',
  targetCount: 1,
  damaging: true,
  requiresAccuracy: true,
  damageBase: 6,
  damageClass: 'Physical',
  type: 'Normal',
  ac: 2,
  range: 'Melee, 1 Target',
  effect: 'None.',
  keywords: ['Melee'],
  criticalRange: null,
  areaTemplates: [],
  conditionSuggestions: [],
  stageSuggestions: [],
  hpSuggestions: [],
  fieldSuggestions: [],
  hazardSuggestions: [],
  automationNotes: [],
  ...overrides,
})

describe('move automation target branches', () => {
  it('exposes the existing target metadata as a single implicit branch', () => {
    const base = script()

    expect(implicitMoveAutomationTargetBranch(base)).toEqual({
      id: IMPLICIT_MOVE_AUTOMATION_TARGET_BRANCH_ID,
      label: 'Melee, 1 Target',
      targetMode: 'one-target',
      targetCount: 1,
      range: 'Melee, 1 Target',
      areaTemplates: [],
    })
    expect(moveAutomationTargetBranches(base)).toEqual([implicitMoveAutomationTargetBranch(base)])
    expect(moveAutomationHasMultipleTargetBranches(base)).toBe(false)

    const effective = moveAutomationScriptForTargetBranch(base, IMPLICIT_MOVE_AUTOMATION_TARGET_BRANCH_ID)
    expect(effective).toEqual(base)
    expect(effective).not.toBe(base)
    expect(effective?.areaTemplates).not.toBe(base.areaTemplates)
  })

  it('does not synthesize target branches for non-targeted scripts', () => {
    const base = script({
      targetMode: 'self',
      targetCount: 1,
      range: 'Self',
      keywords: ['Self'],
    })

    expect(implicitMoveAutomationTargetBranch(base)).toBeNull()
    expect(moveAutomationTargetBranches(base)).toEqual([])
    expect(moveAutomationHasMultipleTargetBranches(base)).toBe(false)
  })

  it('detects explicit branch lists without mutating the source script', () => {
    const targetBranches: MoveAutomationTargetBranch[] = [
      {
        id: 'single',
        label: 'Single target',
        targetMode: 'one-target',
        targetCount: 1,
        range: 'Melee, 1 Target',
      },
      {
        id: 'line',
        label: 'Line',
        targetMode: 'multi-target',
        targetCount: null,
        range: 'Line 4, Sonic',
      },
    ]
    const base = script({ targetBranches })

    const branches = moveAutomationTargetBranches(base)

    expect(branches).toEqual(targetBranches)
    expect(branches).not.toBe(targetBranches)
    expect(branches[0]).not.toBe(targetBranches[0])
    expect(moveAutomationHasMultipleTargetBranches(base)).toBe(true)
  })

  it('returns an effective script patched with the selected branch targeting fields', () => {
    const base = script({
      targetBranches: [
        {
          id: 'single',
          label: 'Single target',
          targetMode: 'one-target',
          targetCount: 1,
          range: 'Melee, 1 Target',
        },
        {
          id: 'line',
          label: 'Line',
          targetMode: 'multi-target',
          targetCount: null,
          range: 'Line 4, Sonic',
        },
      ],
    })

    const effective = moveAutomationScriptForTargetBranch(base, 'line')

    expect(effective).not.toBeNull()
    expect(effective).not.toBe(base)
    expect(effective).toMatchObject({
      targetMode: 'multi-target',
      targetCount: null,
      range: 'Line 4, Sonic',
      keywords: ['Line 4', 'Sonic'],
      areaTemplates: [{ kind: 'line', size: 4, label: 'Line 4' }],
    })
    expect(base).toMatchObject({
      targetMode: 'one-target',
      targetCount: 1,
      range: 'Melee, 1 Target',
      keywords: ['Melee'],
      areaTemplates: [],
    })
  })

  it('uses branch area templates when supplied instead of reparsing range text', () => {
    const base = script()
    const branch: MoveAutomationTargetBranch = {
      id: 'custom-area',
      label: 'Custom area',
      targetMode: 'multi-target',
      targetCount: null,
      range: 'Cone 2',
      areaTemplates: [{ kind: 'burst', size: 1, label: 'Burst 1' }],
    }

    const effective = moveAutomationScriptForTargetBranch(base, branch)

    expect(effective?.areaTemplates).toEqual([{ kind: 'burst', size: 1, label: 'Burst 1' }])
    expect(effective?.areaTemplates).not.toBe(branch.areaTemplates)
  })
})

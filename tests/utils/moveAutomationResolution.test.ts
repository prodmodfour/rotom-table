import { describe, expect, it, vi } from 'vitest'
import {
  applyMoveAutomationAccuracyRoll,
  clearMutableRecord,
  ensureMoveAutomationTargetResolution,
  populateDefaultMoveAutomationSuggestions,
  randomD20,
  resetMoveAutomationResolutionState,
  resolveMoveAutomationAccuracyRoll,
  rollAllMoveAutomationTargets,
  syncMoveAutomationTargetResolutions,
  type MoveAutomationResolutionRecord,
} from '~/utils/moveAutomationResolution'
import { moveAutomationSuggestionKey } from '~/utils/moveAutomationTargetResolution'
import type { CombatStageMap } from '~/types/combatStages'
import type { MoveAutomationScript } from '~/types/moveAutomation'

const stages = (): CombatStageMap => ({ atk: 1, def: -1, satk: 2, sdef: -2, spd: 3, acc: -3 })

const script = (overrides: Partial<MoveAutomationScript> = {}): MoveAutomationScript => ({
  kind: 'explicit',
  moveName: 'Test Move',
  version: 1,
  targetMode: 'one-target',
  targetCount: 1,
  damaging: true,
  requiresAccuracy: true,
  damageBase: 4,
  damageClass: 'Physical',
  type: 'Normal',
  ac: 6,
  range: '',
  effect: '',
  keywords: [],
  criticalRange: 19,
  conditionSuggestions: [],
  stageSuggestions: [],
  hpSuggestions: [],
  fieldSuggestions: [],
  hazardSuggestions: [],
  automationNotes: [],
  ...overrides,
})

describe('move automation resolution helpers', () => {
  it('clears mutable records', () => {
    const record: Record<string, unknown> = { a: 1, b: false }
    clearMutableRecord(record)
    expect(record).toEqual({})
  })

  it('resolves random d20 and accuracy results', () => {
    expect(randomD20(() => 0)).toBe(1)
    expect(randomD20(() => 0.999)).toBe(20)
    expect(resolveMoveAutomationAccuracyRoll(script(), 5)).toEqual({ accuracyRoll: '5', hit: false, crit: false })
    expect(resolveMoveAutomationAccuracyRoll(script(), 19)).toEqual({ accuracyRoll: '19', hit: true, crit: true })
    expect(resolveMoveAutomationAccuracyRoll(script(), 1, { userAccuracy: 10 })).toMatchObject({ accuracyRoll: '1 + 10', hit: false })
    expect(resolveMoveAutomationAccuracyRoll(script({ ac: null, criticalRange: null }), 2)).toEqual({ accuracyRoll: '2', hit: true, crit: false })
    expect(resolveMoveAutomationAccuracyRoll(script({ criticalRange: null, directHpLoss: {
      kind: 'user-level-roll-table',
      rollFormula: '1d4',
      rollTable: [{ roll: 4, multiplier: 2, label: 'Double user level' }],
      applyTypeImmunity: true,
      ignoreWeaknessResistance: true,
      ignoreStats: true,
      label: 'Direct HP loss',
    } }), 20)).toEqual({ accuracyRoll: '20', hit: true, crit: false })
  })

  it('ensures and syncs target resolution records', () => {
    const s = script()
    const resolutions: MoveAutomationResolutionRecord = {
      stale: { accuracyRoll: '1', hit: false, crit: false, damageRoll: null, manualHpLoss: '', applyDamage: true },
    }

    const created = ensureMoveAutomationTargetResolution(resolutions, 'a', s)
    expect(created).toMatchObject({ accuracyRoll: '', hit: false, crit: false, applyDamage: true })
    expect(ensureMoveAutomationTargetResolution(resolutions, 'a', s)).toBe(created)

    syncMoveAutomationTargetResolutions(resolutions, ['a', 'b'], s)
    expect(Object.keys(resolutions).sort()).toEqual(['a', 'b'])
    expect(resolutions.b).toMatchObject({ hit: false, applyDamage: true })
  })

  it('populates default enabled suggestions by optional flag', () => {
    const s = script({
      conditionSuggestions: [
        { recipient: 'target', condition: 'Burned', label: 'Burn' },
        { recipient: 'target', condition: 'Sleep', label: 'Sleep', optional: true },
      ],
      stageSuggestions: [{ recipient: 'user', key: 'atk', delta: 1, label: 'Boost' }],
      hpSuggestions: [{ recipient: 'target', mode: 'fixed-loss', amount: 5, label: 'Chip', optional: true }],
      fieldSuggestions: [{ kind: 'weather', value: 'rainy', label: 'Rain' }],
      hazardSuggestions: [{ kind: 'spikes', squares: 1, label: 'Spikes' }],
    })
    const enabled: Record<string, boolean | undefined> = {}

    populateDefaultMoveAutomationSuggestions(s, enabled)

    expect(enabled[moveAutomationSuggestionKey(s, 'condition', 0)]).toBe(true)
    expect(enabled[moveAutomationSuggestionKey(s, 'condition', 1)]).toBe(false)
    expect(enabled[moveAutomationSuggestionKey(s, 'stage', 0)]).toBe(true)
    expect(enabled[moveAutomationSuggestionKey(s, 'hp', 0)]).toBe(false)
    expect(enabled[moveAutomationSuggestionKey(s, 'field', 0)]).toBe(true)
    expect(enabled[moveAutomationSuggestionKey(s, 'hazard', 0)]).toBe(true)
  })

  it('resets resolution state and returns self targets', () => {
    const s = script({ targetMode: 'self' })
    const targetResolutions = {
      old: { accuracyRoll: '1', hit: false, crit: false, damageRoll: null, manualHpLoss: '', applyDamage: true },
    }
    const enabledSuggestions = { old: true }
    const hpSuggestionAmounts = { old: '5' }
    const userStages = stages()
    const targetStages = stages()

    const targetIds = resetMoveAutomationResolutionState({
      script: s,
      userId: 'user-1',
      targetResolutions,
      enabledSuggestions,
      hpSuggestionAmounts,
      manualUserStageDeltas: userStages,
      manualTargetStageDeltas: targetStages,
    })

    expect(targetIds).toEqual(['user-1'])
    expect(targetResolutions).toEqual({})
    expect(enabledSuggestions).toEqual({})
    expect(hpSuggestionAmounts).toEqual({})
    expect(userStages).toEqual({ atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 })
    expect(targetStages).toEqual({ atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 })
  })

  it('applies accuracy and roll-all resolution flows', () => {
    const s = script({ requiresAccuracy: true, damaging: true })
    const resolutions: Record<string, any> = {}
    applyMoveAutomationAccuracyRoll(resolutions, 'a', s, 20)
    expect(resolutions.a).toMatchObject({ accuracyRoll: '20', hit: true, crit: true })

    const random = vi.spyOn(Math, 'random')
    random.mockReturnValue(0)
    try {
      rollAllMoveAutomationTargets(['a', 'b'], s, resolutions, '1d6+1')
    } finally {
      random.mockRestore()
    }

    expect(resolutions.a?.damageRoll).toMatchObject({ formula: '1d6+1', rolls: [1], total: 2 })
    expect(resolutions.b).toMatchObject({ accuracyRoll: '1', hit: false, crit: false, damageRoll: { total: 2 } })
  })
})

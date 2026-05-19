import { describe, expect, it } from 'vitest'
import {
  buildMoveAutomationStartLogLines,
  formatMoveAutomationAutomationNoteLogLines,
  formatMoveAutomationConditionSuggestionLogLine,
  formatMoveAutomationDamageBreakdownLogLine,
  formatMoveAutomationDamageLogLine,
  formatMoveAutomationHpSuggestionLogLine,
  formatMoveAutomationManualNoteLogLine,
  formatMoveAutomationStageSuggestionLogLine,
} from '~/utils/moveAutomationLogLines'
import type {
  MoveAutomationConditionSuggestion,
  MoveAutomationHpSuggestion,
  MoveAutomationScript,
  MoveAutomationStageSuggestion,
} from '~/types/moveAutomation'

const script = (overrides: Partial<MoveAutomationScript> = {}): MoveAutomationScript => ({
  kind: 'explicit',
  moveName: 'Test Move',
  version: 3,
  targetMode: 'one-target',
  targetCount: 1,
  damaging: true,
  requiresAccuracy: true,
  damageBase: 4,
  damageClass: 'Physical',
  type: 'Fire',
  ac: 2,
  range: 'Melee, 1 Target',
  effect: '',
  keywords: [],
  criticalRange: 20,
  conditionSuggestions: [],
  stageSuggestions: [],
  hpSuggestions: [],
  fieldSuggestions: [],
  hazardSuggestions: [],
  automationNotes: [],
  ...overrides,
})

describe('move automation log line helpers', () => {
  it('builds start lines for explicit scripts', () => {
    expect(buildMoveAutomationStartLogLines(script(), 'Caster')).toEqual([
      'Caster used Test Move.',
      'Explicit move script v3 used.',
    ])
  })

  it('formats damage and HP suggestion lines', () => {
    const hpSuggestion: MoveAutomationHpSuggestion = {
      recipient: 'user',
      mode: 'heal-percent-max',
      percent: 25,
      label: 'Recover',
    }

    expect(formatMoveAutomationDamageLogLine('Target', 12)).toBe('Target: 12 damage.')
    expect(formatMoveAutomationDamageLogLine('Target', 12, true)).toBe('Target: 12 damage (critical flagged).')
    expect(formatMoveAutomationDamageBreakdownLogLine('Target', {
      kind: 'standard',
      hpLoss: 22,
      terms: [
        { operator: 'add', amount: 20, label: 'roll' },
        { operator: 'add', amount: 5, label: 'Atk' },
        { operator: 'subtract', amount: 10, label: 'Def' },
      ],
      multiplier: 1.5,
      multiplierLabel: '1.5',
      scaledDamage: 22,
      minimumDamageApplied: false,
      critical: false,
    })).toBe('Target damage breakdown: (20 roll + 5 Atk − 10 Def) × 1.5 = 22.')
    expect(formatMoveAutomationDamageBreakdownLogLine('Target', {
      kind: 'manual',
      hpLoss: 7,
      manualHpLoss: 7,
    })).toBe('Target damage breakdown: manual override = 7.')
    expect(formatMoveAutomationHpSuggestionLogLine('Caster', hpSuggestion, 10)).toBe('Caster: Recover (10 HP).')
    expect(formatMoveAutomationHpSuggestionLogLine('Caster', hpSuggestion, 0)).toBe('Caster: Recover.')
  })

  it('formats condition and combat-stage recipient lines', () => {
    const recipients = [{ species: 'Aipom' }, { species: 'Buizel' }]
    const conditionSuggestion: MoveAutomationConditionSuggestion = {
      recipient: 'target',
      condition: 'Burned',
      action: 'remove',
      label: 'Clear burns',
    }
    const stageSuggestion: MoveAutomationStageSuggestion = {
      recipient: 'target',
      key: 'def',
      delta: -1,
      label: 'Lower Defense',
    }

    expect(formatMoveAutomationConditionSuggestionLogLine(conditionSuggestion, recipients))
      .toBe('Clear burns removed from Aipom, Buizel.')
    expect(formatMoveAutomationConditionSuggestionLogLine({ ...conditionSuggestion, action: 'add' }, recipients))
      .toBe('Clear burns applied to Aipom, Buizel.')
    expect(formatMoveAutomationStageSuggestionLogLine(stageSuggestion, recipients))
      .toBe('Lower Defense on Aipom, Buizel.')
    expect(formatMoveAutomationConditionSuggestionLogLine(conditionSuggestion, [])).toBeNull()
    expect(formatMoveAutomationStageSuggestionLogLine(stageSuggestion, [])).toBeNull()
  })

  it('formats manual and automation notes', () => {
    expect(formatMoveAutomationManualNoteLogLine('  Check weather.  ')).toBe('Note: Check weather.')
    expect(formatMoveAutomationManualNoteLogLine('   ')).toBeNull()
    expect(formatMoveAutomationAutomationNoteLogLines(['Verify text.', 'Track duration.']))
      .toEqual(['Note: Verify text.', 'Note: Track duration.'])
  })
})

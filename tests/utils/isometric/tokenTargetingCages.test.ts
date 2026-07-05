import { describe, expect, it } from 'vitest'
import type {
  MoveAutomationFeedbackState,
  MoveAutomationTargetingOverlayState,
} from '~/types/moveAutomation'
import {
  createMoveFeedbackTokenCageStateResolver,
  createMoveTargetingTokenCageStateResolver,
} from '~/utils/isometric/tokenTargetingCages'

const targetingOverlay = (
  overrides: Partial<MoveAutomationTargetingOverlayState> = {},
): MoveAutomationTargetingOverlayState => ({
  userId: 'actor-token',
  moveName: 'Tackle',
  mode: 'target',
  rangeLabel: '6m',
  rangeMeters: 6,
  candidateIds: ['target-a', 'target-b'],
  ...overrides,
})

const feedbackOverlay = (
  overrides: Partial<MoveAutomationFeedbackState> = {},
): MoveAutomationFeedbackState => ({
  id: 'feedback-1',
  userId: 'actor-token',
  targetId: 'target-a',
  moveName: 'Tackle',
  phase: 'rolling',
  naturalRoll: 12,
  modifiedRoll: 12,
  accuracyCheck: 6,
  userAccuracy: 0,
  targetEvasion: 0,
  targetEvasionLabel: 'Physical Evasion',
  hit: true,
  crit: false,
  effectiveness: null,
  damageResolved: false,
  damageLoss: 0,
  conditions: [],
  ...overrides,
})

describe('token targeting cage state resolvers', () => {
  it('marks single-target candidates without treating non-candidates as tactical cages', () => {
    const resolve = createMoveTargetingTokenCageStateResolver(targetingOverlay(), '#38bdf8')

    expect(resolve('target-a')).toEqual({ role: 'candidate', accentColor: '#38bdf8' })
    expect(resolve('target-b')).toEqual({ role: 'candidate', accentColor: '#38bdf8' })
    expect(resolve('not-a-target')).toBeNull()
  })

  it('promotes explicit target-count selections above other candidates', () => {
    const resolve = createMoveTargetingTokenCageStateResolver(targetingOverlay({
      mode: 'target-count',
      selectedTargetIds: ['target-b'],
      targetCount: 1,
      maxTargetCount: 2,
    }))

    expect(resolve('target-a')).toEqual({ role: 'candidate' })
    expect(resolve('target-b')).toEqual({ role: 'selected' })
  })

  it('uses affected area targets as selected and excluded area targets as candidates', () => {
    const resolve = createMoveTargetingTokenCageStateResolver(targetingOverlay({
      mode: 'area-confirmation',
      candidateIds: ['target-a', 'target-b', 'target-c'],
      affectedIds: ['target-a', 'target-c'],
      canToggleTargets: true,
    }), '#f97316')

    expect(resolve('target-a')).toEqual({ role: 'selected', accentColor: '#f97316' })
    expect(resolve('target-b')).toEqual({ role: 'candidate', accentColor: '#f97316' })
    expect(resolve('target-c')).toEqual({ role: 'selected', accentColor: '#f97316' })
  })

  it('keeps the feedback target highlighted as the selected tactical cage target', () => {
    const resolve = createMoveFeedbackTokenCageStateResolver(feedbackOverlay(), '#a78bfa')

    expect(resolve('target-a')).toEqual({ role: 'selected', accentColor: '#a78bfa' })
    expect(resolve('target-b')).toBeNull()
  })
})

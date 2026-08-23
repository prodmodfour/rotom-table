import { describe, expect, it } from 'vitest'
import certification from '../../data/deferred-closure/skill-check-accessibility-certification.v1.json'
import { acceptedSuccessorHead, repositoryFileSha256 } from '../helpers/deferredClosureSuccessors'

const requiredScenarios = new Set([
  'gm-keyboard-request-and-server-resolution',
  'gm-cancel-focus-entry-and-escape-return',
  'gm-20-card-batch-and-100ms-expansion',
  'gm-250ms-bounded-fixture-presentation',
  'gm-touch-label-private-and-blocked-semantics',
  'subject-dialog-name-description-and-heading-focus',
  'subject-safe-history-batch-and-100ms-expansion',
  'subject-terminal-escape-and-action-dock-focus-return',
  'subject-role-safe-status-and-blocked-controls',
  'spectator-20-card-80-history-initial-bound',
  'spectator-250ms-bounded-fixture-presentation',
  'spectator-100ms-explicit-expansion',
  'spectator-focus-stable-refresh-status-and-alert',
  'fishing-described-selector-and-status',
  'fishing-controls-disabled-before-check-link',
  'fishing-private-identity-absent',
  'production-gm-request-keyboard-journey',
  'production-subject-response-keyboard-journey',
  'production-gm-resolution-and-history-journey',
  'production-spectator-aggregate-history-and-no-leak-journey',
  'chromium-desktop-wcag-aa-touch-performance-and-reflow',
  'chromium-mobile-wcag-aa-touch-performance-and-reflow',
  'reduced-motion-table-distance-320px-no-overflow',
  'reviewed-gm-target-state',
  'reviewed-subject-target-state',
  'reviewed-spectator-target-state',
  'reviewed-fishing-consumer-target-state',
])

describe('P11-051 Skill Check accessibility and liveplay certification', () => {
  it('binds the predecessor, frozen budgets, surfaces, component evidence, browser journey, and mockups', () => {
    expect(certification).toMatchObject({
      schemaVersion: 1,
      certificationId: 'deferred-closure-skill-check-accessibility-liveplay-v1',
      ticket: 'P11-051',
      status: 'certified',
      runtimeProseParsing: false,
    })
    expect(acceptedSuccessorHead(certification.predecessor.path, certification.predecessor.sha256))
      .toBe(repositoryFileSha256(certification.predecessor.path))
    for (const authority of certification.authorities) {
      expect(acceptedSuccessorHead(authority.path, authority.sha256), authority.id)
        .toBe(repositoryFileSha256(authority.path))
      expect(authority.guarantees.length).toBeGreaterThan(0)
    }
    for (const evidence of certification.evidence) {
      expect(acceptedSuccessorHead(evidence.path, evidence.sha256), evidence.path)
        .toBe(repositoryFileSha256(evidence.path))
      expect(evidence.scenarioIds.length).toBeGreaterThan(0)
    }
    expect(new Set(certification.evidence.flatMap(value => value.scenarioIds))).toEqual(requiredScenarios)
  })

  it('certifies desktop/mobile WCAG, keyboard, touch, reflow, reduced-motion, liveplay, and privacy acceptance', () => {
    expect(certification.browserAcceptance).toEqual({
      productionBuild: true,
      loopbackLiveplayServer: true,
      projects: ['chromium', 'mobile-chromium'],
      requestResponseResolutionAndHistory: true,
      keyboardOnlyCriticalPath: true,
      seriousOrCriticalWcagViolations: 0,
      primaryTouchTargetMinimumPx: 44,
      reflowWidthCssPx: 320,
      horizontalPageOverflow: false,
      tableDistanceMode: true,
      reducedMotion: true,
      privateFieldLeak: false,
    })
    expect(certification.acceptance).toEqual({
      keyboard: true,
      touch: true,
      screenReader: true,
      zoomAndReflow: true,
      reducedMotion: true,
      desktopLiveplay: true,
      mobileLiveplay: true,
      requestSurface: true,
      responseSurface: true,
      historySurface: true,
      performanceBudgets: true,
      remainingRecoveryAndCampaignHistoryTicket: 'P11-052',
    })
    expect(Object.values(certification.privacy).every(value => value === false || value === true)).toBe(true)
    expect(certification.privacy).toMatchObject({
      gmPrivateNotesOutsideGm: false,
      subjectIdentityInSpectatorSurface: false,
      resultOnlyAggregateInSpectatorSurface: true,
    })
  })

  it('meets the existing decision-surface performance and bounded-rendering budgets', () => {
    expect(certification.performanceAcceptance).toEqual({
      localInteractionBudgetMs: 100,
      acceptedPresentationBudgetMs: 250,
      productionRoundTripFixtureCeilingMs: 2000,
      initialGmOpenRequestCards: 20,
      initialSpectatorCheckCards: 20,
      initialSpectatorHistoryEntriesMaximum: 80,
      initialSubjectHistoryEntries: 20,
      productionSpectatorSurfaceNodeCeiling: 500,
      explicitExpansionRequiredBeyondInitialBatches: true,
    })
  })
})

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import certification from '../../data/deferred-closure/final-accessibility-certification.v1.json'
import inventory from '../../data/deferred-closure/closure-inventory.v1.json'
import { acceptedSuccessorHead, repositoryFileSha256 } from '../helpers/deferredClosureSuccessors'

const sha256 = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')
const verify = (row: { path: string, sha256: string }): void => {
  expect(acceptedSuccessorHead(row.path, row.sha256), row.path).toBe(repositoryFileSha256(row.path))
}
const source = (path: string): string => readFileSync(path, 'utf8')

const mechanicRows = inventory.rows
  .map(row => row.id)
  .filter(id => id.startsWith('weapon-profile.')
    || id.startsWith('weapon-move.')
    || id.startsWith('item-action.')
    || id === 'runtime.generic-skill-check'
    || id.startsWith('contest-variant.'))
  .sort()

describe('P11-084 final accessibility certification', () => {
  it('partitions every user-facing Plan 11 mechanic into one audited cohort', () => {
    expect(certification).toMatchObject({
      schemaVersion: 1,
      certificationId: 'deferred-closure-final-accessibility-v1',
      ticket: 'P11-084',
      status: 'certified',
      runtimeProseParsing: false,
    })
    expect(certification.predecessor.sha256).toBe(sha256(certification.predecessor.path))
    expect(certification.cohorts.map(row => row.cohortId)).toEqual([
      'ranged-and-weapon-actions',
      'item-actions',
      'generic-skill-checks',
      'trainer-participant-contests',
      'battle-contests',
    ])
    const audited = certification.cohorts.flatMap(row => row.mechanicRowIds)
    expect(new Set(audited).size).toBe(audited.length)
    expect([...audited].sort()).toEqual(mechanicRows)
    expect(audited).toHaveLength(27)
    expect(certification.nonInteractiveInventoryRows.sort()).toEqual([
      'documentation.live-play-authority-trigger-registrations',
      'registry.equipment-grants-deferred-ticket-pointers',
    ])
  })

  it('records every required modality as passed with no final hard failure', () => {
    for (const cohort of certification.cohorts) {
      expect(cohort.modalities).toEqual({
        axe: 'passed',
        keyboard: 'passed',
        screenReader: 'passed',
        zoom: 'passed',
        reflow: 'passed',
        reducedMotion: 'passed',
      })
      expect(cohort.hardFailures, cohort.cohortId).toBe(0)
      expect(cohort.surfacePaths.length, cohort.cohortId).toBeGreaterThan(0)
      expect(cohort.executableEvidence.length, cohort.cohortId).toBeGreaterThan(0)
    }
    expect(certification.browserAcceptance).toEqual({
      mode: 'production-liveplay',
      projects: ['chromium', 'mobile-chromium'],
      currentSourceDesktopJourneys: 6,
      currentSourceMobileJourneys: 4,
      axeTags: ['wcag2a', 'wcag2aa', 'wcag21aa'],
      seriousOrCriticalAxeViolations: 0,
      keyboardOnlyCriticalPaths: true,
      semanticAssistiveTechnologyTrees: true,
      minimumPrimaryControlPx: 44,
      zoomPercent: 200,
      narrowViewportWidthsCssPx: [320, 390],
      horizontalPageOverflows: 0,
      reducedMotion: true,
      privateAuthorityLeaks: 0,
      hardFailures: 0,
    })
    expect(certification.remediation).toEqual({
      findingsOpened: 1,
      findingsResolved: 1,
      finalOpenFindings: 0,
      issue: 'ordinary-encounter-optional-battle-context-alert',
      falseAlertsBefore: 1,
      falseAlertsAfter: 0,
      failClosedLinkedAuthorityErrorsPreserved: true,
    })
    expect(certification.visualEvidence).toHaveLength(6)
    expect(certification.visualEvidence.map(row => row.role).sort()).toEqual([
      'acting-owner-accepted-390',
      'acting-owner-pending-desktop',
      'gm-accepted-desktop',
      'gm-pending-desktop',
      'public-pending-320',
      'public-pending-desktop',
    ])
    for (const row of certification.visualEvidence) verify(row)
    expect(certification.acceptance).toEqual({
      auditedMechanicRows: 27,
      auditedCohorts: 5,
      seriousOrCriticalAxeViolations: 0,
      hardFailures: 0,
      nextTicket: 'P11-085',
    })
  })

  it('retains semantic, focus, touch, reflow, and motion contracts in the changed primitives', () => {
    const actionDock = source('src/components/encounter/workspace/EncounterActionDock.vue')
    expect(actionDock).toContain('aria-live="polite"')
    expect(actionDock).toContain('aria-keyshortcuts="/"')
    expect(actionDock).toContain('role="search"')
    expect(actionDock).toContain('min-height: var(--rt-touch-minimum)')
    expect(actionDock).toContain(':focus-visible')

    const decision = source('src/components/encounter/workspace/EncounterDecisionLayer.vue')
    expect(decision).toContain('role="dialog"')
    expect(decision).toContain(':aria-labelledby')
    expect(decision).toContain('role="alert"')
    expect(decision).toContain('@media (max-width: 42rem)')

    const guided = source('src/components/campaign/CampaignGuidedItemAdjudication.vue')
    expect(guided).toContain('aria-label="Pending guided item requests"')
    expect(guided).toContain(':aria-live=')
    expect(guided).toContain('min-height: 44px')
    expect(guided).toContain('@media (max-width: 560px)')

    const contest = source('src/pages/contests/[contestId].vue')
    expect(contest).toContain(':aria-pressed="appeal.performerId === performer.performerId"')
    expect(contest).toContain('min-height:44px')
    expect(contest).toContain('@media(max-width:760px)')
    expect(contest).toContain('@media(prefers-reduced-motion:reduce)')

    const optionalBattle = source('src/composables/useBattleContestLiveplay.ts')
    expect(optionalBattle).toContain('if (statusFor(reason) === 404)')
    expect(optionalBattle).toContain('attachRealtime(null)')
    expect(optionalBattle).toContain('else error.value = messageFor(reason)')
  })

  it('hash-binds current authorities, executable checks, and production browser journeys', () => {
    for (const row of certification.authorities) verify(row)
    for (const row of certification.evidence) verify(row)
    const paths = new Set([...certification.authorities, ...certification.evidence, ...certification.visualEvidence].map(row => row.path))
    for (const path of [
      'src/components/encounter/workspace/EncounterActionDock.vue',
      'src/components/campaign/CampaignGuidedItemAdjudication.vue',
      'src/components/encounter/workspace/EncounterGmSkillChecks.vue',
      'src/pages/contests/[contestId].vue',
      'src/components/encounter/workspace/EncounterBattleContestDecision.vue',
      'src/composables/useBattleContestLiveplay.ts',
      'tests/e2e/encounter-workspace-shell.spec.ts',
      'tests/e2e/guided-item-adjudication.spec.ts',
      'tests/e2e/skill-check-liveplay.spec.ts',
      'tests/e2e/contests-acceptance.spec.ts',
      'tests/e2e/contest-battle-encounter-link.spec.ts',
      'tests/composables/useBattleContestLiveplay.test.ts',
      'tests/data/deferredClosureAccessibilityCertification.test.ts',
      'package.json',
    ]) expect(paths.has(path), path).toBe(true)
  })
})

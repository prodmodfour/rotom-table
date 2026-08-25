import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const page = readFileSync('src/pages/play/[encounterId].vue', 'utf8')
const decision = readFileSync('src/components/encounter/workspace/EncounterBattleContestDecision.vue', 'utf8')
const panel = readFileSync('src/components/encounter/workspace/EncounterBattleContestPanel.vue', 'utf8')
const composable = readFileSync('src/composables/useBattleContestLiveplay.ts', 'utf8')

describe('Battle Contest joined liveplay cockpit', () => {
  it('keeps Encounter as the primary shell while joining one persistent role-safe Contest rail', () => {
    expect(page).toContain('<EncounterWorkspaceShell')
    expect(page).toContain('<EncounterBattleStage')
    expect(page).toContain('<EncounterBattleContestPanel')
    expect(page).toContain(':projection="battleContestLiveplay.battleContest.value"')
    expect(panel).toContain('Joined encounter')
    expect(panel).toContain('Battle Contest')
    expect(panel).toContain('Round {{ projection.round }}/{{ projection.roundBudget }}')
    expect(panel).toContain('v-for="performer in score.performers"')
    expect(panel).toContain('Voltage {{ performer.voltage }}')
    expect(page).toContain('class="battle-contest-mobile-score"')
    expect(page).toContain('aria-label="Battle Contest score and Voltage"')
    expect(page).toContain('V {{ performer.voltage }}')
    expect(panel).toContain("projection.stage === 'settling'")
    expect(panel).toContain('Open Contest settlement')
  })

  it('presents one blocking 0–3 allocation with keyboard-sized, non-colour state cues', () => {
    expect(page).toContain("battleContestLiveplay.battleContest.value?.pendingAppeal")
    expect(page).toContain('<EncounterBattleContestDecision')
    expect(decision).toContain('role="dialog"')
    expect(decision).toContain('aria-labelledby="battle-contest-decision-title"')
    expect(decision).toContain('v-for="statId in CONTEST_STAT_IDS"')
    expect(decision).toContain('total.value < props.decision.maximumSpend')
    expect(decision).toContain('Score {{ decision.moveName }}’s Contest Appeal')
    expect(decision).toContain('Use no team dice')
    expect(decision).toContain('Score Appeal')
    expect(decision).toContain('min-height: 2.75rem')
    expect(decision).toContain('outline: 3px solid var(--rt-focus)')
    expect(decision).toContain('@media (max-width: 42rem)')
  })

  it('shows a public wait state instead of controls and never optimistically changes a score', () => {
    expect(decision).toContain('v-if="!decision.canResolve"')
    expect(decision).toContain('{{ decision.waitingForDisplayName }} is choosing Contest Dice')
    expect(decision).toContain('will appear when Contest authority settles it')
    expect(composable).not.toMatch(/battleContest\.value\s*=\s*\{[^}]*appeal/u)
    expect(composable).toContain("notice.value = response.battleContest?.exactRetry")
    expect(composable).toContain('uncertainDecision.value')
    expect(decision).toContain('Retry exact allocation')
  })

  it('blocks every ordinary Encounter command path while reconciliation or a decision is pending', () => {
    expect(page).toContain("loader.commandsBlocked.value || battleContestLiveplay.battleContest.value?.actionsBlocked === true")
    expect(page).toContain('livePlayCommandBlocked: commandsBlocked')
    expect(page).toContain(':commands-blocked="commandsBlocked"')
    expect(page).toContain(":commands-blocked=\"commandsBlocked || (machine.phase !== 'observe' && machine.phase !== 'choose')\"")
    for (const guard of [
      'if (decisionBusy.value || commandsBlocked.value) return',
      'if (!workspace.value || !isGm.value || commandsBlocked.value || initiativeBusy.value) return',
    ]) expect(page).toContain(guard)
  })

  it('keeps raw cross-engine authority out of all joined-cockpit components', () => {
    const visibleSources = `${decision}\n${panel}`
    for (const forbidden of [
      'sheetSlug', 'providerId', 'operationId', 'sourceOperation', 'sourceResult', 'resolutionId',
      'handoffId', 'handoffSha256', 'linkId', 'placementId', 'contestRosterSha256', 'diagnostic',
    ]) expect(visibleSources).not.toContain(forbidden)
    expect(panel).toContain('projection.visibleTeamPools')
    expect(decision).toContain('props.pool?.remaining[statId]')
  })
})

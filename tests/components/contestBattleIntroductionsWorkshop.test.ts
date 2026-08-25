import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const detail = readFileSync('src/pages/contests/[contestId].vue', 'utf8')
const template = detail.slice(detail.indexOf('<template>'), detail.indexOf('<style scoped>'))

 describe('Battle Contest Trainer-team Introduction Workshop', () => {
  it('makes team-pool custody and the absence of Contest initiative primary', () => {
    for (const copy of ['Trainer-team Introduction', 'Successes become shared Contest Stat Dice', 'This roll does not set initiative.', 'No Contest initiative', 'Pool custody:', 'one shared pool', 'Roll team Introduction']) expect(detail).toContain(copy)
    expect(detail).toContain('isBattleIntroduction')
    expect(detail).toContain('battle-intro-progress')
    expect(detail).toContain('Authority rolls {{ introductionPreviewDice }}d6')
  })

  it('shows one bounded five-stat pool per authorised Trainer team without Pokémon copies', () => {
    expect(detail).toContain('class="battle-intro-team-grid"')
    expect(detail).toContain('class="battle-pool-strip"')
    expect(detail).toContain('v-for="stat in CONTEST_STAT_IDS"')
    expect(detail).toContain('team.teamDicePools[stat].remaining')
    expect(detail).toContain('team.teamDicePools[stat].total')
    expect(detail).toContain('battleTeamPoolRemaining(team)')
    expect(detail).toContain('battleTeamPoolTotal(team)')
    expect(detail).not.toMatch(/performer\.dicePools\[stat\].*battle-intro/u)
  })

  it('keeps ordinary Performance unavailable and hands ready teams only to the server-derived Encounter command', () => {
    expect(detail).toContain('Create & link Battle encounter')
    expect(detail).toContain("commandKind: 'create-battle-encounter'")
    expect(detail).toContain('Map, Encounter, Scene, opening deployment, initiative, and Contest link commit together or not at all.')
    expect(detail).toContain('v-if="!isBattleIntroduction" type="button" class="primary-action"')
    expect(detail).not.toContain("stageCommand('start-performance')\">Create &amp; link")
    for (const forged of ['mapSlug:', 'initiativeOrderIds:', 'activePokemonPerformerIds:', 'encounterId:']) expect(detail).not.toContain(forged)
  })

  it('preserves role privacy, non-colour state, focus, and narrow reflow', () => {
    expect(detail).toContain('Team pools and roll evidence remain visible only to their controller and the GM.')
    expect(detail).toContain('aria-label="Introduction accepted"')
    expect(detail).toContain('outline:3px solid var(--rt-focus')
    expect(detail).toMatch(/@media\(max-width:760px\)[\s\S]*?\.battle-team-grid,\.battle-intro-team-grid\{grid-template-columns:1fr\}/u)
    expect(detail).toMatch(/@media\(max-width:480px\)[\s\S]*?\.battle-intro-progress\{grid-template-columns:1fr\}/u)
    for (const forbidden of ['operationId', 'trainerSheetSlug', 'pokemonSheetSlug', 'providerIds', 'battleTeamDiceSpendJournal']) expect(template).not.toContain(forbidden)
  })
})

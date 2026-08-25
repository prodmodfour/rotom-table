import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const detail = readFileSync('src/pages/contests/[contestId].vue', 'utf8')
const template = detail.slice(detail.indexOf('<template>'), detail.indexOf('<style scoped>'))

describe('Battle Contest Encounter link Workshop', () => {
  it('offers one GM-only all-or-none handoff only after both Introductions', () => {
    expect(detail).toContain('if (!isGm.value || !allIntroduced.value || !isBattleIntroduction.value) return')
    expect(detail).toContain("commandKind: 'create-battle-encounter'")
    expect(template).toContain('v-if="isGm && allIntroduced" class="battle-encounter-handoff battle-encounter-handoff--ready"')
    expect(template).toContain('Create & link Battle encounter')
    expect(template).toContain('Map, Encounter, Scene, opening deployment, initiative, and Contest link commit together or not at all.')
    for (const clientAuthored of ['mapSlug', 'placementIds', 'initiativeOrderIds', 'activePokemonPerformerIds']) expect(detail).not.toMatch(new RegExp(`commandKind: 'create-battle-encounter'[^\\n]*${clientAuthored}`, 'u'))
  })

  it('turns accepted link facts into one clear cockpit destination without a parallel battle surface', () => {
    for (const copy of ['Encounter link accepted', 'Battle encounter linked', 'Placement, initiative, turns, and battle results remain Encounter authority.', 'Open live encounter', 'Contest scoring is waiting for accepted encounter results.']) expect(template).toContain(copy)
    expect(detail).toContain('encounterWorkspacePath(battleEncounter.value.encounterId)')
    expect(template).toContain('battleEncounter?.deployedCount')
    expect(template).toContain('battleEncounter?.readyReserveCount')
    expect(template).toContain('battleEncounter?.openingRound')
    expect(template).not.toContain('Roll battle initiative')
    expect(template).not.toContain('Place opening Pokémon')
  })

  it('preserves Trainer-team pool continuity only for authorised full projections', () => {
    expect(template).toContain('Trainer-team pools remain secured')
    expect(template).toContain('team.teamDicePools[stat].remaining')
    expect(template).toContain('The two accepted team pools remain private to their controllers.')
    expect(template).toContain('v-if="allContestants.length" class="battle-intro-team-grid"')
    expect(detail).toContain("gmProjection.value?.contestants ?? (ownerProjection.value ? [ownerProjection.value.ownContestant] : [])")
  })

  it('has keyboard-sized destinations, non-colour status, privacy-safe markup, and narrow reflow', () => {
    expect(template).toContain('data-contest-primary>Battle encounter linked')
    expect(template).toContain('aria-label="Accepted opening Encounter facts"')
    expect(template).toContain('aria-label="Team authority linked"')
    expect(detail).toContain('.battle-open-encounter{width:100%;min-height:52px')
    expect(detail).toMatch(/@media\(max-width:760px\)[\s\S]*?\.battle-encounter-handoff--ready dl,\.battle-linked-facts\{grid-template-columns:1fr\}/u)
    expect(detail).toMatch(/@media\(max-width:480px\)[\s\S]*?\.battle-linked-heading\{grid-template-columns:1fr\}/u)
    for (const forbidden of ['contestRosterSha256', 'openingInitiativeOrderIds', 'openingSheetRevision', 'trainerSheetSlug', 'pokemonSheetSlug', 'providerIds', 'operationId']) expect(template).not.toContain(forbidden)
  })
})

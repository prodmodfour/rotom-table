import { describe, expect, it } from 'vitest'
import { canConsumeContestPoffin, contestPoffinAllowance, derivePokemonContestPreparation, emptyPokemonContestStatsState, parsePokemonContestStatsState } from '../../shared/contests/preparation'
import { parseContestPreparationCommand } from '../../shared/contests/preparationOperations'
import { normalizeCharacterSheet } from '../../src/utils/sheetNormalize'
import type { CharacterSheet } from '../../src/types/characterSheet'

const sheet = (overrides: Partial<CharacterSheet> = {}): CharacterSheet => ({
  slug: 'contest-partner', nickname: 'Partner', species: '', level: 10,
  stats: { atk: { base: 29, added: 0, stage: 6 }, def: { base: 10, added: 0, stage: -6 }, satk: { base: 39, added: 0, stage: -6 }, sdef: { base: 20, added: 0, stage: 4 }, spd: { base: 9, added: 0, stage: 6 } },
  ...overrides,
})
const poffin = (index: number, statId: 'beauty'|'cool'|'cute'|'smart'|'tough', consumedAt = index) => ({ entryId: `poffin:${index}`, statId, sourceItemId: 'Poffin' as const, sourceInventoryInstanceId: `inventory:${index}`, sourceOperationId: `contest-op:v1:poffin${String(index).padStart(8, '0')}`, consumedAt })

describe('Pokémon Contest preparation authority', () => {
  it('derives combat contributions from un-staged stats and applies the canonical cap', () => {
    const projection = derivePokemonContestPreparation(sheet())
    expect(projection.rows.cool.combatDice).toBe(2)
    expect(projection.rows.beauty.combatDice).toBe(3)
    expect(projection.rows.tough.combatDice).toBe(1)
    expect(projection.rows.smart.combatDice).toBe(2)
    expect(projection.rows.cute.combatDice).toBe(0)
    expect(projection.rows.beauty.contributions[0]!.explanation).toContain('maximum 3d6')
  })

  it('enforces level and Grace allowances without deleting suppressed provenance', () => {
    const contestStats = { ...emptyPokemonContestStatsState(), poffins: [poffin(1, 'cute'), poffin(2, 'cool'), poffin(3, 'beauty'), poffin(4, 'smart'), poffin(5, 'tough')] }
    const ordinary = derivePokemonContestPreparation(sheet({ level: 5, contestStats }))
    const grace = derivePokemonContestPreparation(sheet({ level: 5, contestStats }), { hasGrace: true })
    expect(contestPoffinAllowance(5, false)).toBe(2)
    expect(ordinary.poffinsActive).toBe(2)
    expect(ordinary.poffinsSuppressed).toBe(3)
    expect(grace.poffinAllowance).toBe(4)
    expect(grace.poffinsActive).toBe(4)
    expect(parsePokemonContestStatsState(contestStats).poffins).toHaveLength(5)
  })

  it('applies only current-day Flexible Preparations and Style Expert contributors', () => {
    const contestStats = {
      ...emptyPokemonContestStatsState(),
      poffins: [poffin(1, 'cute'), poffin(2, 'cute'), poffin(3, 'cute')],
      reallocations: [{ reallocationId: 'reallocation:1', fromStatId: 'cute' as const, toStatId: 'beauty' as const, dice: 2 as const, campaignDay: 7, sourceTrainerSlug: 'trainer', sourceFeatureId: 'Flexible Preparations' as const, sourceOperationId: 'contest-op:v1:reallocate1' }],
    }
    const today = derivePokemonContestPreparation(sheet({ level: 20, contestStats }), { campaignDay: 7, styleExpertStatIds: ['beauty'] })
    const tomorrow = derivePokemonContestPreparation(sheet({ level: 20, contestStats }), { campaignDay: 8, styleExpertStatIds: ['beauty'] })
    expect(today.rows.cute.poffinDiceActive).toBe(1)
    expect(today.rows.beauty.poffinDiceActive).toBe(2)
    expect(today.rows.beauty.featureDice).toBe(2)
    expect(tomorrow.rows.cute.poffinDiceActive).toBe(3)
    expect(tomorrow.rows.beauty.poffinDiceActive).toBe(0)
  })

  it('rejects over-allowance consumption before inventory could be spent', () => {
    const full = sheet({ level: 1, contestStats: { ...emptyPokemonContestStatsState(), poffins: [poffin(1, 'cute')] } })
    expect(canConsumeContestPoffin({ sheet: full, hasGrace: false })).toMatchObject({ ok: false, code: 'contest.poffin-allowance-exhausted' })
  })

  it('rejects preparation contract drift before any resource lookup', () => {
    const command = { schemaVersion: 1, commandKind: 'consume-poffin', operationId: 'contest-op:v1:strictprep1', trainerSheetSlug: 'trainer', trainerRevision: 0, pokemonSheetSlug: 'pokemon', pokemonRevision: 0, sourceSection: 'foodStuff', sourceRowId: 'poffin', statId: 'cute', forged: true }
    expect(() => parseContestPreparationCommand(command)).toThrow(/fields are invalid/)
  })

  it('migrates legacy free-form Contest text as non-mechanical description', () => {
    const normalized = normalizeCharacterSheet({ ...sheet(), contestStats: 'Cute 99 — old spreadsheet note' } as unknown as CharacterSheet)
    expect(normalized.contestStats).toEqual({ schemaVersion: 1, legacyDescription: 'Cute 99 — old spreadsheet note', poffins: [], grooming: null, reallocations: [] })
    expect(derivePokemonContestPreparation(normalized).rows.cute.totalDice).toBe(0)
  })
})

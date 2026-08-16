import { describe, expect, it } from 'vitest'
import {
  CAMPAIGN_ADVANCEMENT_ATTENTION_SHEET_LIMIT,
  detectCampaignSheetAdvancementAttention,
  detectSheetAdvancementAttention,
  projectCampaignAdvancementAttention,
} from '../../server/domain/campaignAttention/advancementDetector'
import type { StoredSheetDocument } from '../../server/storage/sheetRepository'
import type { StoredEncounterSettlementAttentionSource } from '../../server/storage/encounterSettlementRepository'
import { pokemonExperienceNeededForLevel } from '../../src/utils/sheets/pokemonExperience'

const pokemonStats = (values: readonly number[]) => ({
  hp: { added: values[0] }, atk: { added: values[1] }, def: { added: values[2] },
  satk: { added: values[3] }, sdef: { added: values[4] }, spd: { added: values[5] },
})
const trainerStats = (values: readonly number[]) => ({
  hp: { levelUp: values[0] }, atk: { levelUp: values[1] }, def: { levelUp: values[2] },
  satk: { levelUp: values[3] }, sdef: { levelUp: values[4] }, spd: { levelUp: values[5] },
})
const pokemon = (
  document: Record<string, unknown> = {},
  revision = 3,
): StoredSheetDocument => ({
  kind: 'pokemon', slug: 'sprig', revision, updatedAt: 500,
  document: {
    slug: 'sprig', species: 'Bulbasaur', level: 10,
    totalExp: pokemonExperienceNeededForLevel(10),
    stats: pokemonStats([3, 3, 3, 4, 4, 3]),
    ...document,
  },
})
const trainer = (
  document: Record<string, unknown> = {},
  revision = 4,
): StoredSheetDocument => ({
  kind: 'trainer', slug: 'ash', revision, updatedAt: 500,
  document: {
    slug: 'ash', name: 'Ash', level: 10,
    stats: trainerStats([4, 3, 3, 3, 3, 3]),
    ...document,
  },
})
const detect = (stored: StoredSheetDocument) => detectSheetAdvancementAttention({
  stored,
  campaignMinute: 500,
})
const levelSource = (): StoredEncounterSettlementAttentionSource => ({
  sourceId: 'settlement-attention-level-0001',
  settlementId: 'settlement-duel',
  operationId: 'finish-operation-0001',
  reason: 'level-threshold',
  audience: 'owner',
  entityKind: 'pokemon-sheet',
  entityId: 'sprig',
  sourceFactId: 'settlement-fact-level-0001',
  authority: { kind: 'sheet', id: 'sprig', revision: 3 },
  status: 'open',
  revision: 0,
  createdAtCampaignMinute: 500,
  resolvedAtCampaignMinute: null,
  resolutionOperationId: null,
})

describe('campaign advancement attention detector', () => {
  it('detects a reached canonical Pokémon level without changing Level or choosing an allocation', () => {
    const stored = pokemon({
      level: 9,
      totalExp: pokemonExperienceNeededForLevel(10),
      stats: pokemonStats([3, 3, 3, 4, 4, 2]),
    })
    const before = JSON.stringify(stored.document)
    const item = detect(stored)
    expect(item).toMatchObject({
      reason: 'level-threshold',
      audience: 'owner',
      urgency: 'blocking',
      entity: { kind: 'pokemon-sheet', id: 'sprig' },
      sourceEvent: { kind: 'sheet-authority', campaignMinute: 500 },
      authority: { kind: 'sheet', id: 'sprig', revision: 3 },
      requiredDecision: { kind: 'repair-advancement' },
      legalActions: [{
        intent: 'review-advancement',
        href: '/sheets/pokemon/sprig',
        authority: { kind: 'sheet', id: 'sprig', revision: 3 },
      }],
      resolution: { state: 'open', revision: 0 },
    })
    expect(JSON.stringify(stored.document)).toBe(before)
    expect(JSON.stringify(item)).not.toMatch(/totalExp|species|stats|added/i)
  })

  it('projects an immutable settlement level event as newly legal generic advancement work without guessing a build choice', () => {
    const items = projectCampaignAdvancementAttention({
      sheets: [pokemon()],
      settlementSources: [levelSource()],
      campaignMinute: 500,
    })
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      reason: 'level-threshold',
      sourceEvent: { kind: 'encounter-settlement', eventId: 'settlement-fact-level-0001' },
      requiredDecision: { kind: 'allocate-advancement' },
      legalActions: [{ intent: 'review-advancement' }],
    })
    expect(JSON.stringify(items)).not.toMatch(/move|ability|evolution|feature|edge|class|skill/i)
  })

  it('detects unspent Pokémon Stat Points and clears when the exact canonical budget is allocated', () => {
    expect(detect(pokemon({ stats: pokemonStats([3, 3, 3, 4, 4, 2]) }))).toMatchObject({
      reason: 'unspent-advancement', urgency: 'normal',
      requiredDecision: { kind: 'allocate-advancement' },
    })
    expect(detect(pokemon())).toBeNull()
  })

  it('fails closed to invalid advancement for overspend, invalid values, Base Relation violations, stale XP, or unknown species', () => {
    const invalid = [
      pokemon({ stats: pokemonStats([4, 3, 3, 4, 4, 3]) }),
      pokemon({ stats: { ...pokemonStats([3, 3, 3, 4, 4, 3]), hp: { added: -1 } } }),
      pokemon({ stats: pokemonStats([0, 0, 0, 0, 0, 20]) }),
      pokemon({ totalExp: pokemonExperienceNeededForLevel(9) }),
      pokemon({ species: 'Not A Canonical Species' }),
      pokemon({ stats: [] }),
    ]
    for (const stored of invalid) {
      expect(detect(stored)).toMatchObject({
        reason: 'invalid-advancement', urgency: 'blocking',
        requiredDecision: { kind: 'repair-advancement' },
      })
    }
  })

  it('does not invent missing Experience authority when otherwise valid Pokémon advancement is complete', () => {
    expect(detect(pokemon({ totalExp: undefined }))).toBeNull()
  })

  it('detects Trainer unspent and overspent Stat Points without making Feature, Edge, class, or skill choices', () => {
    const unspent = detect(trainer({ stats: trainerStats([3, 3, 3, 3, 3, 3]) }))
    expect(unspent).toMatchObject({
      reason: 'unspent-advancement', urgency: 'normal',
      entity: { kind: 'trainer-sheet', id: 'ash' },
      legalActions: [{ href: '/sheets/trainers/ash' }],
    })
    expect(JSON.stringify(unspent)).not.toMatch(/feature|edge|class|skill/i)
    expect(detect(trainer())).toBeNull()
    expect(detect(trainer({ stats: trainerStats([5, 3, 3, 3, 3, 3]) }))).toMatchObject({
      reason: 'invalid-advancement', urgency: 'blocking',
    })
  })

  it('treats a minimal Level-1 Trainer as having ten unspent creation points', () => {
    expect(detect(trainer({ level: undefined, stats: undefined }))).toMatchObject({
      reason: 'unspent-advancement',
      requiredDecision: { kind: 'allocate-advancement' },
    })
  })

  it('keeps item identity stable while binding source event, decisions, actions, and authority to the current revision', () => {
    const current = detect(pokemon({ stats: pokemonStats([3, 3, 3, 4, 4, 2]) }, 3))!
    const next = detect(pokemon({ stats: pokemonStats([3, 3, 3, 4, 4, 2]) }, 4))!
    expect(next.itemId).toBe(current.itemId)
    expect(next.sourceEvent.eventId).not.toBe(current.sourceEvent.eventId)
    expect(next.authority.revision).toBe(4)
    expect(next.requiredDecision?.authority.revision).toBe(4)
    expect(next.legalActions[0]?.authority.revision).toBe(4)
  })

  it('produces deterministic blocking-first campaign order from unique complete sheet authority', () => {
    const other = pokemon({ slug: 'other', stats: pokemonStats([3, 3, 3, 4, 4, 2]) }, 5)
    const items = detectCampaignSheetAdvancementAttention({
      sheets: [
        trainer({ stats: trainerStats([3, 3, 3, 3, 3, 3]) }),
        pokemon({ species: 'Unknown' }),
        { ...other, slug: 'other' },
      ],
      campaignMinute: 500,
    })
    expect(items.map(item => item.reason)).toEqual([
      'invalid-advancement', 'unspent-advancement', 'unspent-advancement',
    ])
    expect(Object.isFrozen(items)).toBe(true)
  })

  it('rejects duplicate, truncated, stale, or malformed authority inputs instead of selecting one', () => {
    const stored = pokemon()
    expect(() => detectCampaignSheetAdvancementAttention({ sheets: [stored, stored], campaignMinute: 500 }))
      .toThrow('unique current sheet authorities')
    expect(() => detectCampaignSheetAdvancementAttention({
      sheets: Array.from({ length: CAMPAIGN_ADVANCEMENT_ATTENTION_SHEET_LIMIT + 1 }, () => stored),
      campaignMinute: 500,
    })).toThrow('limited to 10000 sheets')
    expect(() => detectSheetAdvancementAttention({ stored: { ...stored, revision: -1 }, campaignMinute: 500 }))
      .toThrow('exact non-negative sheet revision')
    expect(() => detectSheetAdvancementAttention({ stored, campaignMinute: -1 }))
      .toThrow('non-negative safe campaign minute')
  })
})

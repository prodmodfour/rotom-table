import { describe, expect, it } from 'vitest'
import type { CharacterSheet, CharacterSheetMove, StatKey } from '../../src/types/characterSheet'
import type { StoredSheetDocument } from '../../server/storage/sheetRepository'
import type {
  StoredEncounterSettlementAttentionSource,
  StoredEncounterSettlementHistoryFact,
} from '../../server/storage/encounterSettlementRepository'
import type { StoredItemOperationRecord } from '../../server/storage/itemOperationRepository'
import {
  CAMPAIGN_POKEMON_CHOICE_ATTENTION_LIMIT,
  projectCampaignPokemonChoiceAttention,
} from '../../server/domain/campaignAttention/pokemonChoiceDetector'
import {
  ITEM_EVOLUTION_CONFIRMATION_CHOICE_ID,
  ITEM_EVOLUTION_DESTINATION_CHOICE_ID,
  previewItemEvolution,
  resolveItemEvolution,
} from '../../server/domain/itemAutomation/evolution'
import {
  previewMachineMoveLearning,
  resolveMachineMoveLearning,
} from '../../server/domain/itemAutomation/moveLearning'
import { ITEM_AUTOMATION_RUNTIME_REGISTRY } from '../../server/domain/itemAutomation/registry'

const statKeys: readonly StatKey[] = ['hp', 'atk', 'def', 'satk', 'sdef', 'spd']
const stats = (level: number): CharacterSheet['stats'] => Object.fromEntries(
  statKeys.map((key, index) => [key, { added: index < (level + 10) % statKeys.length
    ? Math.ceil((level + 10) / statKeys.length)
    : Math.floor((level + 10) / statKeys.length) }]),
) as CharacterSheet['stats']

const sheet = (overrides: Partial<CharacterSheet> = {}, revision = 5): StoredSheetDocument => ({
  kind: 'pokemon', slug: 'sprig', revision, updatedAt: 1_000,
  document: {
    slug: 'sprig', species: 'Bulbasaur', nickname: 'Sprig', level: 15,
    revision, stats: stats(15), abilities: [{ name: 'Overgrow' }],
    movelist: [], appliedMoves: [],
    ...overrides,
  } satisfies CharacterSheet,
})

const event = (input: {
  readonly slug?: string
  readonly levelBefore: number
  readonly levelAfter: number
  readonly status?: 'open' | 'resolved'
  readonly authorityRevision?: number
  readonly ordinal?: string
}): {
  source: StoredEncounterSettlementAttentionSource
  fact: StoredEncounterSettlementHistoryFact
} => {
  const slug = input.slug ?? 'sprig'
  const ordinal = input.ordinal ?? `${input.levelBefore}-${input.levelAfter}`
  const operationId = `finish-operation-${ordinal}`
  const settlementId = `settlement-${ordinal}`
  const factId = `settlement-fact-${ordinal}`
  const resolved = input.status === 'resolved'
  return {
    source: {
      sourceId: `settlement-attention-${ordinal}`,
      settlementId,
      operationId,
      sourceFactId: factId,
      reason: 'level-threshold',
      audience: 'owner',
      entityKind: 'pokemon-sheet',
      entityId: slug,
      authority: { kind: 'sheet', id: slug, revision: input.authorityRevision ?? 5 },
      status: resolved ? 'resolved' : 'open',
      revision: resolved ? 1 : 0,
      createdAtCampaignMinute: 500,
      resolvedAtCampaignMinute: resolved ? 510 : null,
      resolutionOperationId: resolved ? `resolution-operation-${ordinal}` : null,
    },
    fact: {
      factId,
      settlementId,
      operationId,
      kind: 'experience-award',
      audience: 'destination-owner',
      subjectKind: 'sheet',
      subjectId: slug,
      resultCode: 'experience-committed',
      payload: { amount: 10, levelBefore: input.levelBefore, levelAfter: input.levelAfter },
      createdAtCampaignMinute: 500,
    },
  }
}

const project = (input: {
  readonly sheets?: readonly StoredSheetDocument[]
  readonly events?: readonly ReturnType<typeof event>[]
  readonly itemOperations?: readonly StoredItemOperationRecord[]
} = {}) => {
  const events = input.events ?? []
  return projectCampaignPokemonChoiceAttention({
    sheets: input.sheets ?? [sheet()],
    settlementSources: events.map(row => row.source),
    historyFacts: events.map(row => row.fact),
    itemOperations: input.itemOperations ?? [],
    campaignMinute: 600,
    completeness: {
      sheets: true, settlementSources: true, historyFacts: true, itemOperations: true,
    },
  })
}

const sixBulbasaurMoves = [
  'Tackle', 'Growl', 'Leech Seed', 'Vine Whip', 'Poison Powder', 'Sleep Powder',
].map(name => ({ name }))

const evolvePikachu = (): { stored: StoredSheetDocument, operation: StoredItemOperationRecord } => {
  const source: CharacterSheet = {
    slug: 'volt', species: 'Pikachu', nickname: 'Volt', level: 25,
    gender: 'Male', nature: 'Hardy', revision: 4,
    stats: Object.fromEntries(statKeys.map(key => [key, { added: key === 'spd' ? 35 : 0 }])),
    abilities: [{ name: 'Static' }, { name: 'Cute Charm' }],
    movelist: [{ name: 'Quick Attack' }, { name: 'Thunder Wave' }], appliedMoves: [],
  }
  const definition = ITEM_AUTOMATION_RUNTIME_REGISTRY.require('Thunder Stone')
  const sourceInstanceId = 'item-instance:trainer:ash:pokemonItems:thunder-stone-row'
  const preview = previewItemEvolution({
    definition, sheetKind: 'pokemon', sheet: source, actorKind: 'trainer', sourceInstanceId,
  })
  const destination = preview.choices.find(choice => choice.choiceId === ITEM_EVOLUTION_DESTINATION_CHOICE_ID)!.options[0]!
  const result = resolveItemEvolution({
    definition, sheetKind: 'pokemon', sheet: source, actorKind: 'trainer', sourceInstanceId,
    selectedChoices: new Map([
      [ITEM_EVOLUTION_DESTINATION_CHOICE_ID, [destination.optionId]],
      [ITEM_EVOLUTION_CONFIRMATION_CHOICE_ID, ['confirmed']],
    ]),
    operationId: 'evolution-operation-0001', appliedAt: 20_000,
  })
  const evolved = { ...result.sheet, revision: 5 }
  const application = evolved.serverPrivate!.itemEvolution!.applications.at(-1)!
  return {
    stored: { kind: 'pokemon', slug: 'volt', revision: 5, updatedAt: 20_000, document: evolved },
    operation: {
      operationId: application.sourceOperationId,
      status: 'accepted',
      canonicalItemId: application.canonicalItemId,
      canonicalDefinitionSha256: application.canonicalDefinitionSha256,
      plan: {
        operationId: application.sourceOperationId,
        canonicalItemId: application.canonicalItemId,
        canonicalDefinitionSha256: application.canonicalDefinitionSha256,
        operations: [{
          aggregate: { kind: 'sheet', sheetKind: 'pokemon', id: 'volt', revision: 4 },
          subjectId: 'sheet-target:v1:pokemon:volt',
          payload: { action: 'evolve-pokemon', sourceOperationId: application.sourceOperationId, application },
        }],
        nonEncounterContext: {
          campaignTime: { campaignMinute: 550 },
          targetAuthorities: [{
            targetId: 'sheet-target:v1:pokemon:volt',
            sheetKind: 'pokemon',
            sheetSlug: 'volt',
            sheetRevision: 4,
          }],
        },
      },
      result: {
        operationId: application.sourceOperationId,
        status: 'accepted',
        canonicalItemId: application.canonicalItemId,
      },
    } as unknown as StoredItemOperationRecord,
  }
}

describe('campaign Pokémon choice attention detector', () => {
  it('surfaces event-bound natural Move replacement and optional Evolution without copying options or making choices', () => {
    const reached = event({ levelBefore: 14, levelAfter: 15 })
    const stored = sheet({ movelist: sixBulbasaurMoves })
    const before = JSON.stringify(stored.document)
    const items = project({ sheets: [stored], events: [reached] })
    expect(items.map(item => item.reason)).toEqual(['move-learning', 'evolution-choice'])
    expect(items[0]).toMatchObject({
      reason: 'move-learning', urgency: 'urgent',
      requiredDecision: { kind: 'choose-move' },
      legalActions: [{ intent: 'review-moves', href: '/sheets/pokemon/sprig?attention=moves' }],
    })
    expect(items[1]).toMatchObject({
      reason: 'evolution-choice', urgency: 'normal',
      requiredDecision: { kind: 'choose-evolution' },
      legalActions: [{ intent: 'review-evolution', href: '/sheets/pokemon/sprig?attention=evolution' }],
    })
    expect(JSON.stringify(stored.document)).toBe(before)
    expect(JSON.stringify(items)).not.toMatch(/Take Down|Ivysaur|replacementIndex|optionIds/)
  })

  it('suppresses a natural Move already present in exact current sheet authority', () => {
    const reached = event({ levelBefore: 14, levelAfter: 15 })
    const items = project({ sheets: [sheet({ movelist: [{ name: 'Take Down' }] })], events: [reached] })
    expect(items.map(item => item.reason)).toEqual(['evolution-choice'])
  })

  it('suppresses Move decisions already represented by exact accepted item authority', () => {
    const source: CharacterSheet = {
      slug: 'spark', species: 'Pikachu', nickname: 'Spark', level: 10, revision: 4,
      stats: stats(10), abilities: [{ name: 'Static' }],
      movelist: [{ name: 'Quick Attack' }, { name: 'Tail Whip' }], appliedMoves: [],
      tutorPoints: { spent: 0 },
    }
    const definition = ITEM_AUTOMATION_RUNTIME_REGISTRY.require('TM 24 - Thunderbolt')
    const sourceInstanceId = 'item-instance:trainer:ash:pokemonItems:tm-row'
    const preview = previewMachineMoveLearning({
      definition, sheetKind: 'pokemon', sheet: source, actorKind: 'trainer',
      actorSheet: { slug: 'ash', name: 'Ash', level: 10, revision: 7, currentTeam: ['spark'] },
      sourceInstanceId, campaignMinute: 400,
    })
    const keep = preview.choices[0]!.options.find(option => option.label === 'Keep current Moves')!
    const resolved = resolveMachineMoveLearning({
      definition, sheetKind: 'pokemon', sheet: source, actorKind: 'trainer',
      actorSheet: { slug: 'ash', name: 'Ash', level: 10, revision: 7, currentTeam: ['spark'] },
      sourceInstanceId, campaignMinute: 400,
      selectedChoices: new Map([
        ['machine-replacement', [keep.optionId]], ['machine-confirmation', ['confirmed']],
      ]),
      operationId: 'machine-learning-operation-0001', appliedAt: 20_000,
    })
    const current = { ...resolved.sheet, level: 42, revision: 5 }
    expect(project({
      sheets: [{ kind: 'pokemon', slug: 'spark', revision: 5, updatedAt: 20_001, document: current }],
      events: [event({ slug: 'spark', levelBefore: 41, levelAfter: 42 })],
    })).toEqual([])
  })

  it('suppresses Move decisions already represented by a server-preserved breeding row', () => {
    const reached = event({ levelBefore: 12, levelAfter: 13 })
    const breedingMoves = ['Poison Powder', 'Sleep Powder'].map((name, index) => ({
      name,
      permanentMoveSource: {
        schemaVersion: 1,
        kind: 'breeding-inheritance',
        originId: `breeding-origin:v1:source-${index}`,
        eggId: `pokemon-egg:v1:source-${index}`,
        learningRecordId: `breeding-learning:v1:source-${index}`,
        checkpointLevel: 20,
        moveId: name,
        operationId: `breeding-operation:v1:source-${index}`,
        candidateDefinitionSha256: 'a'.repeat(64),
      },
    })) as unknown as CharacterSheetMove[]
    expect(project({
      sheets: [sheet({ level: 13, movelist: breedingMoves })], events: [reached],
    })).toEqual([])
  })

  it('surfaces the Level-20 Ability decision and suppresses it once the exact current ordinal is resolved', () => {
    const reached = event({ levelBefore: 19, levelAfter: 20 })
    expect(project({ sheets: [sheet({ level: 20 })], events: [reached] })).toEqual([
      expect.objectContaining({
        reason: 'ability-choice',
        requiredDecision: expect.objectContaining({ kind: 'choose-ability' }),
        legalActions: [expect.objectContaining({
          intent: 'review-abilities', href: '/sheets/pokemon/sprig?attention=abilities',
        })],
      }),
    ])
    expect(project({
      sheets: [sheet({ level: 20, abilities: [{ name: 'Overgrow' }, { name: 'Confidence' }] })],
      events: [reached],
    })).toEqual([])
  })

  it('surfaces a complete canonical multi-branch Evolution as an explicit form choice', () => {
    const reached = event({ levelBefore: 49, levelAfter: 50 })
    const stored = sheet({
      species: 'Cosmoem', level: 50, abilities: [{ name: 'Unaware' }], stats: stats(50),
    })
    const items = project({ sheets: [stored], events: [reached] })
    expect(items).toEqual([expect.objectContaining({
      reason: 'form-choice',
      requiredDecision: expect.objectContaining({ kind: 'choose-form' }),
      legalActions: [expect.objectContaining({
        intent: 'review-form', href: '/sheets/pokemon/sprig?attention=form',
      })],
    })])
    expect(JSON.stringify(items)).not.toMatch(/Solgaleo|Lunala/)
  })

  it('fails closed rather than partially offering a conditional Evolution branch', () => {
    const reached = event({ levelBefore: 34, levelAfter: 35 })
    const stored = sheet({
      species: 'Slowpoke', level: 35, abilities: [{ name: 'Oblivious' }], stats: stats(35),
    })
    expect(project({ sheets: [stored], events: [reached] }).map(item => item.reason))
      .not.toContain('evolution-choice')
  })

  it('suppresses all event decisions after authoritative settlement-attention resolution', () => {
    const resolved = event({ levelBefore: 19, levelAfter: 20, status: 'resolved' })
    expect(project({ sheets: [sheet({ level: 20 })], events: [resolved] })).toEqual([])
  })

  it('surfaces post-evolution cleanup only from exact accepted item-operation and private evolution authority', () => {
    const evolved = evolvePikachu()
    const items = project({
      sheets: [evolved.stored],
      events: [event({ slug: 'volt', levelBefore: 19, levelAfter: 20 })],
      itemOperations: [evolved.operation],
    })
    expect(items).toEqual([expect.objectContaining({
      reason: 'post-evolution-review',
      sourceEvent: expect.objectContaining({ kind: 'item-operation', campaignMinute: 550 }),
      requiredDecision: expect.objectContaining({ kind: 'review-post-evolution' }),
      legalActions: [expect.objectContaining({
        intent: 'review-post-evolution', href: '/sheets/pokemon/volt?attention=post-evolution',
      })],
    })])
    expect(JSON.stringify(items)).not.toMatch(/Pikachu|Raichu|Thunder Stone|Static|Motor Drive/)
    expect(() => project({ sheets: [evolved.stored] }))
      .toThrow('lost its exact accepted item-operation authority')
  })

  it('fails closed on missing facts, stale sheet authority, duplicate reads, and bounded-read overflow', () => {
    const reached = event({ levelBefore: 14, levelAfter: 15 })
    expect(() => projectCampaignPokemonChoiceAttention({
      sheets: [sheet()], settlementSources: [reached.source], historyFacts: [], itemOperations: [],
      campaignMinute: 600,
      completeness: { sheets: true, settlementSources: true, historyFacts: true, itemOperations: true },
    })).toThrow('lost its immutable history fact')
    expect(() => project({
      sheets: [sheet({}, 4)],
      events: [event({ levelBefore: 14, levelAfter: 15, authorityRevision: 5 })],
    })).toThrow('exact immutable Experience event authority')
    expect(() => projectCampaignPokemonChoiceAttention({
      sheets: [sheet(), sheet()], settlementSources: [], historyFacts: [], itemOperations: [],
      campaignMinute: 600,
      completeness: { sheets: true, settlementSources: true, historyFacts: true, itemOperations: true },
    })).toThrow('duplicate authority identity')
    expect(() => project({
      sheets: [sheet({ movelist: [{ name: 'Take Down', itemMoveLearningLocked: true }] })],
      events: [reached],
    })).toThrow('immutable accepted Move-learning provenance')
    expect(() => projectCampaignPokemonChoiceAttention({
      sheets: Array.from({ length: CAMPAIGN_POKEMON_CHOICE_ATTENTION_LIMIT + 1 }, () => sheet()),
      settlementSources: [], historyFacts: [], itemOperations: [], campaignMinute: 600,
      completeness: { sheets: true, settlementSources: true, historyFacts: true, itemOperations: true },
    })).toThrow('complete and bounded to 10000 records')
  })
})

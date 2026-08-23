import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import contract from '../../data/complete-play-loop/campaign-pokemon-choice-attention.v1.json'
import { acceptedSuccessorHead, repositoryFileSha256 } from '../helpers/deferredClosureSuccessors'
import remediation from '../../data/complete-play-loop/canonical-data-remediation.v1.json'
import rules from '../../data/reference/rules.json'
import {
  CAMPAIGN_ATTENTION_ACTION_INTENTS,
  CAMPAIGN_ATTENTION_DECISION_KINDS,
  CAMPAIGN_ATTENTION_REASONS,
} from '../../shared/campaignAttention/model'
import {
  CAMPAIGN_POKEMON_CHOICE_ATTENTION_LIMIT,
  POKEMON_ADVANCEMENT_CHOICE_RULE_SHA256,
} from '../../server/domain/campaignAttention/pokemonChoiceDetector'
import { stableJsonStringify } from '../../shared/automation/stableJson'

const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex')

describe('P8-085 campaign Pokémon choice attention evidence', () => {
  it('pins the reviewed structured rule and exact chained migration', () => {
    expect(contract).toMatchObject({ schemaVersion: 1, ticket: 'P8-085', status: 'implemented' })
    expect(contract.reviewedMigration).toEqual({
      migrationId: 'rule-data-pokemon-advancement-choices-v1',
      ruleId: 'Pokémon Advancement Choices',
      predecessorSha256: 'ff0e220165887fec69ce11f70c0db84210ae289a51145196fe885fe0937ce0a8',
      successorSha256: 'd9b0815c7a9cec1974239b6cb942ec5509ba7021078423fd16ed37bbf72cca2a',
      runtimeUsesDocumentaryText: false,
      ambiguousOrConditionalEvolutionFailsClosed: true,
      irreversibleChoiceIsAutomatic: false,
    })
    expect(sha256(stableJsonStringify(rules['Pokémon Advancement Choices'])))
      .toBe(POKEMON_ADVANCEMENT_CHOICE_RULE_SHA256)
    const migration = remediation.reviewedMigrations.find(row => (
      row.migrationId === contract.reviewedMigration.migrationId
    ))
    expect(migration).toMatchObject({
      canonicalId: contract.reviewedMigration.ruleId,
      canonicalPath: 'data/reference/rules.json',
      beforeFileSha256: contract.reviewedMigration.predecessorSha256,
      afterFileSha256: contract.reviewedMigration.successorSha256,
      reviewStatus: 'accepted',
    })
  })

  it('requires complete bounded event, history, sheet, and item-operation authority', () => {
    expect(contract.limits).toEqual({
      sheets: CAMPAIGN_POKEMON_CHOICE_ATTENTION_LIMIT,
      settlementSources: CAMPAIGN_POKEMON_CHOICE_ATTENTION_LIMIT,
      historyFacts: CAMPAIGN_POKEMON_CHOICE_ATTENTION_LIMIT,
      itemOperations: CAMPAIGN_POKEMON_CHOICE_ATTENTION_LIMIT,
      projectedItems: CAMPAIGN_POKEMON_CHOICE_ATTENTION_LIMIT,
    })
    expect(contract.eventAuthority).toEqual({
      sourceReason: 'level-threshold',
      sourceFactKind: 'experience-award',
      requiresSameSettlementAndOperation: true,
      requiresExactSheetAndRevision: true,
      requiresPositiveIncreasingLevelRange: true,
      resolvedSourceSuppressesEvent: true,
      aggregateIdentityIsOpaque: true,
    })
  })

  it('binds Move, Ability, Evolution, form, and post-evolution decisions to registered model semantics', () => {
    const decisions = contract.decisions
    expect(decisions.moveLearning).toMatchObject({
      reason: 'move-learning', decision: 'choose-move', action: 'review-moves',
      activeMaximum: 6, clusterMindAdditionalSlots: 2,
      replacementAtMaximum: 'urgent-explicit-choice', copiesMoveOptions: false,
    })
    expect(decisions.ability.milestones).toEqual([
      { level: 20, ordinal: 2, tiers: ['basic', 'advanced'] },
      { level: 40, ordinal: 3, tiers: ['basic', 'advanced', 'high'] },
    ])
    expect(decisions.evolution).toMatchObject({
      reason: 'evolution-choice', decision: 'choose-evolution', action: 'review-evolution',
      optional: true, nextExactStageOnly: true,
      reviewedItemTransitionPairsExcluded: true, copiesDestinationOptions: false,
    })
    expect(decisions.form).toMatchObject({
      reason: 'form-choice', decision: 'choose-form', action: 'review-form',
      requiresMultipleCompleteCanonicalCandidates: true,
      infersFromSpeciesName: false, copiesFormOptions: false,
    })
    expect(decisions.postEvolution).toMatchObject({
      reason: 'post-evolution-review', decision: 'review-post-evolution',
      action: 'review-post-evolution', requiresAcceptedItemOperation: true,
      requiresCurrentPrivateEvolutionAuthority: true,
      abilityMappingsAlreadyResolved: true,
    })
    for (const decision of Object.values(decisions)) {
      expect(CAMPAIGN_ATTENTION_REASONS).toContain(decision.reason)
      expect(CAMPAIGN_ATTENTION_DECISION_KINDS).toContain(decision.decision)
      expect(CAMPAIGN_ATTENTION_ACTION_INTENTS).toContain(decision.action)
    }
  })

  it('records operation-aware suppression, fail-closed ambiguity, and no private option copies', () => {
    expect(contract.suppression).toEqual(expect.arrayContaining([
      'server-preserved-item-move-row',
      'server-preserved-breeding-permanent-move-row',
      'current-item-evolution-ability-mapping',
      'resolved-settlement-attention-source',
      'accepted-item-form-operation',
      'completed-current-post-evolution-state',
    ]))
    expect(contract.failClosed).toEqual(expect.arrayContaining([
      'partial-read', 'read-overflow', 'duplicate-authority', 'missing-history-fact',
      'future-source-event', 'stale-sheet-revision', 'move-limit-overflow',
      'incomplete-ability-options', 'conditional-or-malformed-evolution-branch',
      'missing-accepted-item-operation', 'stale-item-evolution-provenance',
    ]))
    expect(contract.doesNotCopy).toEqual(expect.arrayContaining([
      'species', 'move-identity', 'ability-identity', 'form-identity',
      'evolution-destination', 'replacement-options', 'stat-budget',
      'equipment-identity', 'operation-id', 'profile-evidence', 'private-plan',
    ]))
  })

  it('pins runtime, canonical, migration, test, and documentary-provenance bytes', () => {
    for (const source of Object.values(contract.sources)) {
      expect(source.sha256, source.path).toMatch(/^[a-f0-9]{64}$/)
      expect(acceptedSuccessorHead(source.path, source.sha256), source.path)
        .toBe(repositoryFileSha256(source.path))
    }
    expect(contract.sources.documentaryProvenance.runtimeAuthority).toBe(false)
  })
})

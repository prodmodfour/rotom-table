import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import contract from '../../data/complete-play-loop/campaign-trainer-choice-attention.v1.json'
import { acceptedSuccessorHead, repositoryFileSha256 } from '../helpers/deferredClosureSuccessors'
import remediation from '../../data/complete-play-loop/canonical-data-remediation.v1.json'
import rules from '../../data/reference/rules.json'
import { stableJsonStringify } from '../../shared/automation/stableJson'
import {
  CAMPAIGN_ATTENTION_ACTION_INTENTS,
  CAMPAIGN_ATTENTION_DECISION_KINDS,
  CAMPAIGN_ATTENTION_REASONS,
} from '../../shared/campaignAttention/model'
import {
  CAMPAIGN_TRAINER_CHOICE_ATTENTION_LIMIT,
  TRAINER_ADVANCEMENT_CHOICE_RULE_SHA256,
  TRAINER_CHOICE_PENDING_KINDS,
} from '../../server/domain/campaignAttention/trainerChoiceDetector'

const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex')

describe('P8-086 campaign Trainer choice attention evidence', () => {
  it('pins the reviewed structured rule and exact canonical successor', () => {
    expect(contract).toMatchObject({ schemaVersion: 1, ticket: 'P8-086', status: 'implemented' })
    expect(contract.reviewedMigration).toEqual({
      migrationId: 'rule-data-trainer-advancement-choices-v1',
      ruleId: 'Trainer Advancement Choices',
      predecessorSha256: 'd9b0815c7a9cec1974239b6cb942ec5509ba7021078423fd16ed37bbf72cca2a',
      successorSha256: '94e0ec0f9a7416d807db892f501215666487357d20ab945b294a21742da6e142',
      recordSha256: TRAINER_ADVANCEMENT_CHOICE_RULE_SHA256,
      runtimeUsesDocumentaryText: false,
      irreversibleChoiceIsAutomatic: false,
      unsupportedPrerequisitePlanningIsGuided: true,
      notesAreResolutionAuthority: false,
    })
    expect(sha256(stableJsonStringify(rules['Trainer Advancement Choices'])))
      .toBe(TRAINER_ADVANCEMENT_CHOICE_RULE_SHA256)
    const migration = remediation.reviewedMigrations.find(row => (
      row.migrationId === contract.reviewedMigration.migrationId
    ))
    expect(migration).toMatchObject({
      canonicalId: contract.reviewedMigration.ruleId,
      canonicalPath: 'data/reference/rules.json',
      beforeFileSha256: contract.reviewedMigration.predecessorSha256,
      afterFileSha256: contract.reviewedMigration.successorSha256,
      afterRecordSha256: contract.reviewedMigration.recordSha256,
      reviewStatus: 'accepted',
    })
  })

  it('certifies exact Feature, Class, Edge, and Skill Edge entitlements', () => {
    expect(contract.limit).toBe(CAMPAIGN_TRAINER_CHOICE_ATTENTION_LIMIT)
    expect(contract.entitlements).toEqual({
      paidFeaturesAtLevelOne: 4,
      freeTrainingFeaturesAtLevelOne: 1,
      paidFeatureCadence: 'every-odd-level-from-3',
      edgesAtLevelOne: 4,
      edgeCadence: 'every-even-level-from-2',
      bonusSkillEdgeLevels: [2, 6, 12],
      maximumClassFeatures: 4,
      featureCollections: ['features', 'classes', 'orders'],
      grantsDoNotConsumeEntitlement: true,
    })
    expect(contract.pendingKinds).toEqual([...TRAINER_CHOICE_PENDING_KINDS])
  })

  it('keeps every milestone explicit and binds only structured resolution evidence', () => {
    expect(contract.milestones).toEqual([
      { level: 5, options: ['attack-special-attack', 'general-feature'] },
      { level: 10, options: ['attack-special-attack', 'two-edges'] },
      { level: 20, options: ['attack-special-attack', 'two-edges'] },
      { level: 30, options: ['attack-special-attack', 'two-edges', 'general-feature'] },
      { level: 40, options: ['attack-special-attack', 'two-edges', 'general-feature'] },
    ])
    expect(contract.structuredResolution).toEqual({
      statFields: ['stats', 'attack', 'spAttack'],
      requiresAllStatFields: true,
      requiresCurrentEarnedTotal: true,
      requiresAttackSpecialAttackSum: true,
      zeroImmediateRouteRequiresExplicitZeroFields: true,
      featureRouteRequiresCurrentCanonicalInstance: true,
      edgeRouteRequiresCurrentCanonicalInstances: true,
      contradictoryRouteEvidenceFailsClosed: true,
      freeformNotesIgnored: true,
    })
  })

  it('projects one registered owner decision without copying private build choices', () => {
    expect(contract.projection).toEqual({
      reason: 'trainer-advancement',
      audience: 'owner',
      pendingUrgency: 'normal',
      invalidUrgency: 'blocking',
      decision: 'review-trainer-build',
      action: 'review-trainer',
      routeQuery: 'attention=trainer-build',
      requiresCurrentSheetAuthority: true,
      mutatesSheet: false,
    })
    expect(CAMPAIGN_ATTENTION_REASONS).toContain(contract.projection.reason)
    expect(CAMPAIGN_ATTENTION_DECISION_KINDS).toContain(contract.projection.decision)
    expect(CAMPAIGN_ATTENTION_ACTION_INTENTS).toContain(contract.projection.action)
    expect(contract.doesNotCopy).toEqual(expect.arrayContaining([
      'trainer-name', 'class-identity', 'feature-identity', 'edge-identity',
      'skill-identity', 'milestone-option', 'stat-amount', 'prerequisite-text',
      'private-note', 'profile-evidence', 'operation-id', 'automation-provenance',
    ]))
  })

  it('records bounded fail-closed behavior and pins every evidence source', () => {
    expect(contract.failClosed).toEqual(expect.arrayContaining([
      'partial-read', 'read-overflow', 'duplicate-sheet-authority',
      'unknown-training-feature', 'unresolved-feature-identity',
      'missing-feature-choice', 'unsupported-feature-rank',
      'more-than-four-class-features', 'unresolved-edge-identity',
      'missing-edge-choice', 'invalid-bonus-skill-edge-count',
      'malformed-milestone-row', 'stale-earned-stat-total',
      'contradictory-milestone-routes',
    ]))
    for (const source of Object.values(contract.sources)) {
      expect(source.sha256, source.path).toMatch(/^[a-f0-9]{64}$/)
      expect(acceptedSuccessorHead(source.path, source.sha256), source.path)
        .toBe(repositoryFileSha256(source.path))
    }
    expect(contract.sources.trainerProgressionProvenance.runtimeAuthority).toBe(false)
    expect(contract.sources.featureEdgeProvenance.runtimeAuthority).toBe(false)
  })
})

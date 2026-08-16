import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import contract from '../../data/complete-play-loop/campaign-recovery-attention.v1.json'
import {
  CAMPAIGN_ATTENTION_ACTION_INTENTS,
  CAMPAIGN_ATTENTION_DECISION_KINDS,
  CAMPAIGN_ATTENTION_REASONS,
} from '../../shared/campaignAttention/model'
import {
  CAMPAIGN_RECOVERY_ATTENTION_OPERATION_LIMIT,
  CAMPAIGN_RECOVERY_ATTENTION_SHEET_LIMIT,
  CAMPAIGN_RECOVERY_EXPLANATION_CODES,
  CAMPAIGN_RECOVERY_NEED_KINDS,
  CAMPAIGN_RECOVERY_TREATMENT_DURATION_MINUTES,
} from '../../server/domain/campaignAttention/recoveryDetector'
import { MAX_INJURIES_HEALED_PER_DAY } from '../../src/utils/sheets/healing'

const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex')

describe('P8-087 campaign recovery attention evidence', () => {
  it('pins complete current sheet, campaign-clock, and treatment-operation authority', () => {
    expect(contract).toMatchObject({ schemaVersion: 1, ticket: 'P8-087', status: 'implemented' })
    expect(contract.limits).toMatchObject({
      sheets: CAMPAIGN_RECOVERY_ATTENTION_SHEET_LIMIT,
      itemOperations: CAMPAIGN_RECOVERY_ATTENTION_OPERATION_LIMIT,
    })
    expect(contract.authority).toEqual({
      completeCurrentSheets: true,
      singleStrictCampaignClock: true,
      completeItemOperations: true,
      exactSheetRevision: true,
      usesExistingHealingAuthority: true,
      usesExistingCampaignDayAuthority: true,
      mutatesSheet: false,
      mutatesClock: false,
      parsesDocumentaryText: false,
      presentationCachesAreAuthority: false,
    })
  })

  it('certifies exact treatment, Injury, and natural-recovery boundaries', () => {
    expect(contract.medicalPolicy).toEqual({
      activeTreatmentRequiresAcceptedOperation: true,
      activeTreatmentRequiresCurrentDefinitionHash: true,
      activeTreatmentRequiresExactCompletionSnapshot: true,
      activeTreatmentRequiresExactTargetRevision: true,
      activeTreatmentRequiresExactMechanicsPayload: true,
      overdueUnmaterializedTreatmentFailsClosed: true,
      duplicateTreatmentStartIsProjected: false,
      treatmentDurationMinutes: CAMPAIGN_RECOVERY_TREATMENT_DURATION_MINUTES,
      dailyInjuryHealingLimit: MAX_INJURIES_HEALED_PER_DAY,
      naturalInjuriesHealedPerDay: 1,
      naturalHpHealingBlockedAtInjuries: 5,
      blockingInjuryCount: 10,
    })
    expect(contract.needKinds).toEqual([...CAMPAIGN_RECOVERY_NEED_KINDS])
    expect(contract.explanationCodes).toEqual([...CAMPAIGN_RECOVERY_EXPLANATION_CODES])
  })

  it('binds medical and recovery routes to registered privacy-minimal attention vocabulary', () => {
    expect(CAMPAIGN_ATTENTION_REASONS).toEqual(expect.arrayContaining([
      contract.projection.medicalReason,
      contract.projection.recoveryReason,
    ]))
    expect(CAMPAIGN_ATTENTION_DECISION_KINDS).toEqual(expect.arrayContaining([
      contract.projection.untreatedInjuryDecision,
      contract.projection.activeTreatmentDecision,
      contract.projection.ordinaryRecoveryDecision,
    ]))
    expect(CAMPAIGN_ATTENTION_ACTION_INTENTS).toEqual(expect.arrayContaining([
      contract.projection.untreatedInjuryAction,
      contract.projection.activeTreatmentAction,
      contract.projection.ordinaryRecoveryAction,
    ]))
    expect(contract.projection).toMatchObject({
      audience: 'owner', ordinaryUrgency: 'normal', criticalUrgency: 'urgent',
      invalidUrgency: 'blocking', requiresCurrentSheetAuthority: true,
    })
    expect(contract.doesNotCopy).toEqual(expect.arrayContaining([
      'hp-value', 'injury-count', 'condition-identity', 'status-note',
      'treatment-id', 'operation-id', 'item-source', 'profile-evidence',
      'private-provenance',
    ]))
  })

  it('keeps each resource owner explicit instead of inventing a second recovery engine', () => {
    expect(contract.resourcePolicy).toEqual({
      dailyMoveUsage: 'extended-rest-or-next-day',
      dailyAbilityUsage: 'next-day',
      dailyCapabilityUsage: 'next-day',
      weeklyCapabilityUsage: 'remaining-day-advances',
      trainerAp: 'extended-rest',
      featureApAndUsage: 'extended-rest',
      edgeUsage: 'strictly-validated-period-owned',
      freeformStatusText: 'follow-up-only-never-mechanics',
    })
    expect(contract.failClosed).toEqual(expect.arrayContaining([
      'partial-read', 'read-overflow', 'duplicate-sheet-authority',
      'duplicate-item-operation-authority', 'malformed-campaign-clock',
      'invalid-hp-or-injury-state', 'contradictory-derived-healing-state',
      'malformed-resource-ledger', 'forged-active-treatment',
      'missing-treatment-operation', 'stale-treatment-definition',
      'mismatched-treatment-payload', 'overdue-treatment-lifecycle',
    ]))
  })

  it('pins every executable, contract, test, and documentation source', () => {
    for (const source of Object.values(contract.sources)) {
      expect(source.sha256, source.path).toMatch(/^[a-f0-9]{64}$/)
      expect(sha256(readFileSync(source.path)), source.path).toBe(source.sha256)
    }
  })
})

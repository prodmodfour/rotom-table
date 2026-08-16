import { describe, expect, it } from 'vitest'
import type { CampaignClockV1 } from '../../shared/campaignClock'
import type { FeatureApState, FeatureUsageLedger } from '../../shared/featureAutomation/state'
import type { CapabilityUsageLedger } from '../../shared/capabilityAutomation/state'
import type { AbilityDailyUsageLedger } from '../../shared/abilityAutomation/resources'
import type { CharacterSheet } from '../../src/types/characterSheet'
import type { TrainerSheet } from '../../src/types/trainerSheet'
import type { StoredSheetDocument } from '../../server/storage/sheetRepository'
import type { StoredItemOperationRecord } from '../../server/storage/itemOperationRepository'
import {
  CAMPAIGN_RECOVERY_ATTENTION_SHEET_LIMIT,
  CAMPAIGN_RECOVERY_EXPLANATION_CODES,
  CAMPAIGN_RECOVERY_NEED_KINDS,
  detectSheetRecoveryAttention,
  detectSheetRecoveryState,
  projectCampaignRecoveryAttention,
} from '../../server/domain/campaignAttention/recoveryDetector'
import {
  applyBandageTreatment,
  itemMedicalTreatmentId,
} from '../../server/domain/itemAutomation/medicalTreatments'
import { ITEM_AUTOMATION_RUNTIME_REGISTRY } from '../../server/domain/itemAutomation/registry'
import { computePokemonHealingVitals } from '../../src/utils/sheets/healing'

const operationId = 'item-operation:v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const clock = (campaignMinute = 100, revision = 0): CampaignClockV1 => ({
  schemaVersion: 1,
  revision,
  campaignMinute,
  lastOperationId: revision === 0 ? null : `breeding-operation:v1:${'b'.repeat(32)}`,
})
const pokemon = (overrides: Partial<CharacterSheet> = {}): CharacterSheet => ({
  slug: 'sprig', nickname: 'Sprig', species: 'Bulbasaur', level: 5,
  ...overrides,
})
const trainer = (overrides: Partial<TrainerSheet> = {}): TrainerSheet => ({
  slug: 'ash', name: 'Ash', level: 5,
  ...overrides,
})
const storedPokemon = (document = pokemon(), revision = 4): StoredSheetDocument => ({
  kind: 'pokemon', slug: document.slug, revision, updatedAt: 1_000, document,
})
const storedTrainer = (document = trainer(), revision = 4): StoredSheetDocument => ({
  kind: 'trainer', slug: document.slug, revision, updatedAt: 1_000, document,
})

const acceptedTreatmentOperation = (
  treatmentSheet: CharacterSheet,
  targetRevision = 3,
): StoredItemOperationRecord => {
  const definition = ITEM_AUTOMATION_RUNTIME_REGISTRY.require('Bandages')
  const effect = definition.spec.effects.find(candidate => candidate.operation === 'apply-medical-treatment')
  if (!effect || effect.operation !== 'apply-medical-treatment') throw new Error('test definition unavailable')
  const treatmentId = itemMedicalTreatmentId({
    operationId,
    targetKind: 'pokemon',
    targetSlug: treatmentSheet.slug,
  })
  const targetId = 'target-sprig'
  const aggregate = { kind: 'sheet' as const, sheetKind: 'pokemon' as const, id: treatmentSheet.slug, revision: targetRevision }
  const plan = {
    schemaVersion: 1 as const,
    operationId,
    canonicalItemId: 'Bandages',
    canonicalDefinitionSha256: definition.definitionSha256,
    readSet: [aggregate],
    operations: [{
      operationId: `${operationId}:0`,
      ordinal: 0,
      kind: 'campaign-fact' as const,
      aggregate,
      subjectId: targetId,
      payload: {
        action: 'apply-medical-treatment',
        treatmentId,
        treatmentKind: 'bandages',
        canonicalItemId: 'Bandages',
        canonicalDefinitionSha256: definition.definitionSha256,
        sourceOperationId: operationId,
        targetKind: 'pokemon',
        targetSlug: treatmentSheet.slug,
        appliedAtCampaignMinute: 100,
        durationMinutes: effect.durationMinutes,
        tickMinutes: effect.tickMinutes,
        healingNumerator: effect.healingNumerator,
        healingDenominator: effect.healingDenominator,
        injuryAtCompletion: effect.injuryAtCompletion,
        stopOnHpLoss: effect.stopOnHpLoss,
        obeyDailyInjuryLimit: effect.obeyDailyInjuryLimit,
      },
      label: 'Apply treatment',
    }],
    receiptFacts: [],
    nonEncounterContext: {
      schemaVersion: 1 as const,
      context: 'extended-action' as const,
      campaignTime: { clockRevision: 0, campaignMinute: 100 },
      actor: { sheetKind: 'trainer' as const, sheetSlug: 'ash', sheetRevision: 2 },
      targetAuthorities: [{
        targetId,
        sheetKind: 'pokemon' as const,
        sheetSlug: treatmentSheet.slug,
        sheetRevision: targetRevision,
        ownerTrainerSlug: 'ash',
        authority: 'actor-roster' as const,
      }],
      extendedAction: {
        mode: 'extended' as const,
        phase: 'completion' as const,
        activityId: 'item-activity:v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        activityRevision: 1,
        startedAtCampaignMinute: 100,
      },
      gmConfirmation: { required: false, status: 'not-required' as const, evidenceId: null },
    },
  }
  return {
    schemaVersion: 1,
    operationId,
    commandSha256: 'c'.repeat(64),
    command: { operationId } as StoredItemOperationRecord['command'],
    resumeCommandSha256: null,
    resumeCommand: null,
    status: 'accepted',
    canonicalItemId: 'Bandages',
    canonicalDefinitionSha256: definition.definitionSha256,
    plan,
    pendingDecision: null,
    result: {
      schemaVersion: 1,
      operationId,
      status: 'accepted',
      canonicalItemId: 'Bandages',
      aggregateRefs: [aggregate],
      receiptId: 'receipt-treatment',
      exactReplay: false,
    },
    correctionOfOperationId: null,
    recoveryCommandSha256: null,
    recoveryCommand: null,
    compensation: null,
    scopes: [aggregate],
    createdAt: 100,
    updatedAt: 100,
  }
}

const activeTreatment = (): { readonly sheet: CharacterSheet, readonly operation: StoredItemOperationRecord } => {
  const base = pokemon({ combat: { currentHp: 1, injuries: 2 } })
  const sheet = applyBandageTreatment({
    sheetKind: 'pokemon',
    sheet: base,
    targetSlug: base.slug,
    operationId,
    canonicalDefinitionSha256: ITEM_AUTOMATION_RUNTIME_REGISTRY.require('Bandages').definitionSha256,
    campaignMinute: 100,
  }) as CharacterSheet
  return { sheet, operation: acceptedTreatmentOperation(sheet) }
}

describe('campaign injury, treatment, and recovery attention detector', () => {
  it('suppresses a healthy sheet and reports low HP, conditions, and daily resources with exact explanations', () => {
    expect(detectSheetRecoveryState({
      stored: storedPokemon(), campaignClock: clock(), itemOperations: [],
    })).toMatchObject({ status: 'none', needKinds: [], nextStep: null })

    const maxHp = computePokemonHealingVitals(pokemon()).maxHp
    const document = pokemon({
      combat: { currentHp: maxHp - 5, injuries: 0, conditions: ['Burned'] },
      moveUsage: { daily: { tackle: { moveName: 'Tackle', uses: 1, updatedAt: 50 } } },
      abilityUsage: {
        schemaVersion: 1,
        dayKey: 'campaign-day:1',
        entries: [{
          ownerId: 'sprig', abilityInstanceId: 'ability:overgrow', canonicalId: 'Overgrow',
          clauseId: 'daily-use', limit: 1, spent: 1, operationIds: ['ability-use:one'],
        }],
      } satisfies AbilityDailyUsageLedger,
    })
    const detection = detectSheetRecoveryState({
      stored: storedPokemon(document), campaignClock: clock(), itemOperations: [],
    })
    expect(detection).toMatchObject({
      status: 'needs-attention',
      needKinds: ['hp-recovery', 'condition-follow-up', 'daily-move-recovery', 'daily-ability-recovery'],
      explanationCodes: [
        'hp-below-current-healing-cap',
        'condition-or-status-follow-up-remains',
        'daily-move-uses-require-rest-or-day-advance',
        'daily-ability-uses-require-day-advance',
      ],
      minimumResourceDayAdvances: 1,
      nextStep: 'advance-campaign-day',
    })
    expect(CAMPAIGN_RECOVERY_NEED_KINDS).toEqual(expect.arrayContaining(detection.needKinds))
    expect(CAMPAIGN_RECOVERY_EXPLANATION_CODES).toEqual(expect.arrayContaining(detection.explanationCodes))
  })

  it('surfaces ordinary Injuries as treatment work and explains natural days and the daily healing cap', () => {
    const maxHp = computePokemonHealingVitals(pokemon({ combat: { injuries: 2 } })).maxHp
    const document = pokemon({
      combat: { currentHp: maxHp, injuries: 2, injuriesHealedToday: 3 },
    })
    const detection = detectSheetRecoveryState({
      stored: storedPokemon(document), campaignClock: clock(), itemOperations: [],
    })
    expect(detection).toMatchObject({
      status: 'needs-attention',
      needKinds: ['injuries', 'daily-injury-limit'],
      injuries: 2,
      injuryHealsRemainingToday: 0,
      naturalRecoveryDays: 2,
      nextStep: 'start-treatment',
    })
    expect(detection.explanationCodes).toContain('daily-injury-healing-limit-reached')
    expect(detectSheetRecoveryAttention({
      stored: storedPokemon(document), campaignClock: clock(), itemOperations: [],
    })).toMatchObject({
      reason: 'medical-review', audience: 'owner', urgency: 'normal',
      requiredDecision: { kind: 'choose-treatment' },
      legalActions: [{
        intent: 'start-treatment', href: '/sheets/pokemon/sprig?attention=medical',
        requiresConfirmation: false,
      }],
    })
  })

  it('makes fainted or five-plus-Injury recovery urgent and ten Injuries blocking', () => {
    const urgent = detectSheetRecoveryAttention({
      stored: storedPokemon(pokemon({ combat: { currentHp: 0, injuries: 5 } })),
      campaignClock: clock(), itemOperations: [],
    })
    expect(urgent).toMatchObject({ urgency: 'urgent', reason: 'medical-review' })
    const detection = detectSheetRecoveryState({
      stored: storedPokemon(pokemon({ combat: { currentHp: 0, injuries: 5 } })),
      campaignClock: clock(), itemOperations: [],
    })
    expect(detection.needKinds).toEqual(expect.arrayContaining(['fainted', 'critical-injuries']))
    expect(detection.explanationCodes).toContain('five-or-more-injuries-block-natural-hp-recovery')

    expect(detectSheetRecoveryAttention({
      stored: storedPokemon(pokemon({ combat: { currentHp: 0, injuries: 10 } })),
      campaignClock: clock(), itemOperations: [],
    })).toMatchObject({ urgency: 'blocking' })
  })

  it('recognizes only an exact accepted active treatment and routes it to read-only recovery review', () => {
    const active = activeTreatment()
    const before = JSON.stringify(active.sheet)
    const detection = detectSheetRecoveryState({
      stored: storedPokemon(active.sheet), campaignClock: clock(110),
      itemOperations: [active.operation],
    })
    expect(detection).toMatchObject({
      status: 'needs-attention', activeTreatment: true,
      activeTreatmentRemainingMinutes: 350,
      nextStep: 'wait-for-active-treatment',
    })
    expect(detection.needKinds).toContain('active-treatment')
    const item = detectSheetRecoveryAttention({
      stored: storedPokemon(active.sheet), campaignClock: clock(110),
      itemOperations: [active.operation],
    })
    expect(item).toMatchObject({
      reason: 'medical-review', requiredDecision: { kind: 'review-recovery' },
      legalActions: [{ intent: 'review-recovery', href: '/sheets/pokemon/sprig?attention=medical' }],
    })
    const serialized = JSON.stringify(item)
    expect(serialized).not.toContain(operationId)
    expect(serialized).not.toContain(itemMedicalTreatmentId({
      operationId, targetKind: 'pokemon', targetSlug: 'sprig',
    }))
    expect(JSON.stringify(active.sheet)).toBe(before)
  })

  it('fails closed for forged, stale, or overdue treatment authority', () => {
    const active = activeTreatment()
    expect(detectSheetRecoveryState({
      stored: storedPokemon(active.sheet), campaignClock: clock(110), itemOperations: [],
    })).toMatchObject({ status: 'invalid', nextStep: 'repair-current-authority' })
    expect(detectSheetRecoveryAttention({
      stored: storedPokemon(active.sheet), campaignClock: clock(110), itemOperations: [],
    })).toMatchObject({ reason: 'recovery-review', urgency: 'blocking' })

    const staleOperation = {
      ...active.operation,
      canonicalDefinitionSha256: 'd'.repeat(64),
    }
    expect(detectSheetRecoveryState({
      stored: storedPokemon(active.sheet), campaignClock: clock(110),
      itemOperations: [staleOperation],
    })).toMatchObject({ status: 'invalid' })
    expect(detectSheetRecoveryState({
      stored: storedPokemon(active.sheet), campaignClock: clock(130),
      itemOperations: [active.operation],
    })).toMatchObject({ status: 'invalid' })
  })

  it('detects Trainer AP, Feature rest, and multi-day Capability recovery without treating campaign usage as rest work', () => {
    const featureApState: FeatureApState = {
      schemaVersion: 1, max: 6, spent: 1,
      bindings: [], drains: [], temporary: [],
    }
    const featureUsage: FeatureUsageLedger = {
      schemaVersion: 1,
      entries: [{
        sourceInstanceId: 'feature:one', canonicalId: 'Accentuated Taste',
        scope: 'day', scopeId: 'day:one', uses: 1, updatedAt: 1,
      }],
    }
    const capabilityUsage: CapabilityUsageLedger = {
      schemaVersion: 1,
      entries: [{
        id: 'usage:weekly', canonicalId: 'Pickup', actionId: 'pickup',
        capabilityInstanceId: 'capability:pickup', period: 'weekly', usedAt: 1,
        availableAt: null, remainingDayAdvances: 3, sourceOperationId: 'operation:pickup',
      }],
    }
    const document = trainer({
      ap: { max: 6, left: 4, spent: 1 },
      featureApState,
      featureUsage,
      capabilityUsage,
    })
    const detection = detectSheetRecoveryState({
      stored: storedTrainer(document), campaignClock: clock(), itemOperations: [],
    })
    expect(detection).toMatchObject({
      status: 'needs-attention',
      needKinds: ['multi-day-capability-recovery', 'trainer-ap-recovery', 'feature-rest-recovery'],
      minimumResourceDayAdvances: 3,
      nextStep: 'advance-campaign-day',
    })
    expect(detectSheetRecoveryAttention({
      stored: storedTrainer(document), campaignClock: clock(), itemOperations: [],
    })).toMatchObject({
      reason: 'recovery-review', audience: 'owner',
      legalActions: [{ href: '/sheets/trainers/ash?attention=recovery' }],
    })
  })

  it('uses blocking repair semantics for malformed health and resource authority', () => {
    expect(detectSheetRecoveryState({
      stored: storedPokemon(pokemon({ combat: { injuries: 11 } })),
      campaignClock: clock(), itemOperations: [],
    })).toMatchObject({
      status: 'invalid', explanationCodes: ['malformed-current-authority'],
    })
    expect(detectSheetRecoveryState({
      stored: storedTrainer(trainer({
        abilityUsage: { schemaVersion: 1, dayKey: null, entries: [{ bad: true }] } as never,
      })),
      campaignClock: clock(), itemOperations: [],
    })).toMatchObject({ status: 'invalid' })
    expect(detectSheetRecoveryAttention({
      stored: storedTrainer(trainer({ currentInjuries: 99 })),
      campaignClock: clock(), itemOperations: [],
    })).toMatchObject({
      reason: 'recovery-review', urgency: 'blocking',
      requiredDecision: { kind: 'review-recovery' },
    })
  })

  it('requires complete, bounded, unique sheet, clock, and item-operation reads', () => {
    expect(projectCampaignRecoveryAttention({
      sheets: [storedPokemon()], campaignClock: clock(), itemOperations: [],
      completeness: { sheets: true, campaignClock: true, itemOperations: true },
    })).toEqual([])
    expect(() => projectCampaignRecoveryAttention({
      sheets: [storedPokemon(), storedPokemon()], campaignClock: clock(), itemOperations: [],
      completeness: { sheets: true, campaignClock: true, itemOperations: true },
    })).toThrow('unique current authority identities')
    expect(() => projectCampaignRecoveryAttention({
      sheets: Array.from({ length: CAMPAIGN_RECOVERY_ATTENTION_SHEET_LIMIT + 1 }, (_, index) => ({
        ...storedPokemon(), slug: `sprig-${index}`,
      })),
      campaignClock: clock(), itemOperations: [],
      completeness: { sheets: true, campaignClock: true, itemOperations: true },
    })).toThrow('bounded to 10000 sheets')
    expect(() => projectCampaignRecoveryAttention({
      sheets: [], campaignClock: clock(), itemOperations: [],
      completeness: { sheets: true, campaignClock: false, itemOperations: true } as never,
    })).toThrow('complete current authority read')
    expect(() => projectCampaignRecoveryAttention({
      sheets: [],
      campaignClock: { ...clock(), revision: 1, lastOperationId: null },
      itemOperations: [],
      completeness: { sheets: true, campaignClock: true, itemOperations: true },
    })).toThrow('revision 0 alone')
  })
})

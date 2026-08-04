import { describe, expect, it } from 'vitest'
import { CANONICAL_FEATURE_IDS } from '#shared/featureAutomation/catalog'
import { FEATURE_AUTOMATION_MANIFEST } from '#shared/featureAutomation/manifest'
import { FEATURE_PREREQUISITE_BY_ID } from '#shared/featureAutomation/prerequisites'
import { featureTrainerStatBonus } from '#shared/featureAutomation/providers'
import { parseFeatureInstanceData, type FeatureChoiceSelection, type FeatureInstanceData } from '#shared/featureAutomation/instances'
import { resolvedSheetFeatureInstances } from '#shared/featureAutomation/sheetFeatures'
import { applyFeatureAcquisition } from '../../server/domain/featureAutomation/acquisition'
import { planFeatureCampaignOperation } from '../../server/domain/featureAutomation/campaignOperations'
import { resolveEffectiveFeatures } from '../../server/domain/featureAutomation/effectiveFeatures'
import { featureSubscriptionsForEvent } from '../../server/domain/featureAutomation/eventSubscriptions'
import { planFeatureExecution } from '../../server/domain/featureAutomation/executeFeature'
import { FEATURE_AUTOMATION_RUNTIME_REGISTRY } from '../../server/domain/featureAutomation/registry'
import { createFeatureAuthoritativeContext } from '../../server/domain/featureAutomation/context'
import { compileFeatureStatePlan, validateFeatureStatePlanCommit } from '../../server/domain/featureAutomation/statePlanning'
import { rollFeatureDice } from '../../server/domain/featureAutomation/random'
import { createFeaturePendingWorkflow, resolveFeaturePendingWorkflow } from '../../server/domain/featureAutomation/workflows'
import { reconcileFeatureSourceLoss, recoverFeaturesAtExtendedRest } from '../../server/domain/featureAutomation/recovery'
import { settleFeatureDeclarationResources } from '../../server/domain/featureAutomation/resources'
import { planFeatureTeamOperation } from '../../server/domain/featureAutomation/teamOperations'
import { featureTargetPokemonGrants, reconcileFeatureTargetPokemonGrants } from '../../server/domain/featureAutomation/targetPokemonGrants'
import { deriveTrainerAutomaticAbilities, deriveTrainerAutomaticMoves } from '~/utils/sheets/trainerCombatDerivations'
import type { TrainerFeatureEntry, TrainerSheet } from '~/types/trainerSheet'

const instance = (canonicalId: string, choices: readonly FeatureChoiceSelection[] = [], instanceId = `feature.test.${canonicalId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`): FeatureInstanceData => parseFeatureInstanceData({
  schemaVersion: 1,
  instanceId,
  canonicalId,
  definitionVersion: 1,
  rank: 1,
  choices,
  acquisition: { kind: 'sheet', sourceId: 'sheet:test' },
  prerequisiteOverride: null,
})
const entry = (canonicalId: string, choices: readonly FeatureChoiceSelection[] = []): TrainerFeatureEntry => ({ name: canonicalId, automation: instance(canonicalId, choices) })
const trainer = (features: TrainerFeatureEntry[] = []): TrainerSheet => ({
  slug: 'feature-trainer', name: 'Feature Trainer', level: 20, features, classes: [], orders: [], edges: [],
  skills: {}, stats: {}, ap: { max: 10 },
})

describe('Feature automation catalog and strict instances', () => {
  it('registers every frozen row with unique native source-bound semantics', () => {
    expect(CANONICAL_FEATURE_IDS).toHaveLength(444)
    expect(FEATURE_AUTOMATION_MANIFEST.entries).toHaveLength(444)
    expect(FEATURE_AUTOMATION_RUNTIME_REGISTRY.definitions).toHaveLength(444)
    expect(new Set(FEATURE_AUTOMATION_RUNTIME_REGISTRY.definitions.map(row => row.definitionHash)).size).toBe(444)
    expect(FEATURE_AUTOMATION_MANIFEST.entries.every(row => row.status === 'complete' && !row.legacyExecutionAllowed)).toBe(true)
  })

  it('fails closed for unknown, malformed, and missing-choice legacy rows', () => {
    const sheet = trainer([
      { name: 'Internet Feature' },
      { name: 'Stat Ace' },
      { name: 'Captured Momentum', automation: { schemaVersion: 99 } as never },
    ])
    const rows = resolvedSheetFeatureInstances(sheet)
    expect(rows.map(row => row.status)).toEqual(['unresolved-identity', 'missing-required-data', 'malformed'])
    const effective = resolveEffectiveFeatures({ ownerId: sheet.slug, sheet })
    expect(effective.instances).toMatchObject([{ canonicalId: 'Stat Ace', parameterStatus: 'missing-required-data', effective: true }])
    expect(effective.unresolved.map(row => row.reason)).toEqual(['unresolved-identity', 'malformed-instance'])
  })

  it('projects direct/class ownership once and closes provenance-bound Feature grants', () => {
    const witch = entry('Witch Hunter')
    const sheet = trainer([witch])
    sheet.classes = [{ name: 'Witch Hunter', automation: witch.automation }]
    const effective = resolveEffectiveFeatures({ ownerId: sheet.slug, sheet })
    expect(effective.instances.filter(row => row.canonicalId === 'Witch Hunter')).toHaveLength(1)
    expect(effective.instances.some(row => row.canonicalId === 'Psionic Sight' && row.sources.some(source => source.kind === 'feature-grant'))).toBe(true)
  })
})

describe('Feature build, providers, grants, resources, and campaign operations', () => {
  it('validates acquisition prerequisites and requires authorized hash-bound overrides', () => {
    const base = trainer()
    const denied = applyFeatureAcquisition(base, { operation: 'add', canonicalId: 'Brutal Training' })
    expect(denied).toMatchObject({ accepted: false, failures: [{ code: 'feature.prerequisite.unmet' }] })

    const eligible = trainer()
    eligible.skillBackground = { novice: 'intimidate' }
    const accepted = applyFeatureAcquisition(eligible, { operation: 'add', canonicalId: 'Brutal Training' })
    expect(accepted.accepted).toBe(true)
    expect(accepted.sheet.features?.[0]?.automation?.canonicalId).toBe('Brutal Training')

    const hash = FEATURE_PREREQUISITE_BY_ID.get('Brutal Training')!.expressionSha256
    const override = { overrideId: 'override.1', reason: 'Reviewed campaign build exception', authorizedBy: 'gm.1', createdAt: 10, prerequisiteHash: hash }
    expect(applyFeatureAcquisition(base, { operation: 'add', canonicalId: 'Brutal Training', override }).accepted).toBe(false)
    expect(applyFeatureAcquisition(base, { operation: 'add', canonicalId: 'Brutal Training', gmAuthorized: true, override }).accepted).toBe(true)
  })

  it('derives source-tag stats and permanent self grants without runtime prose parsing', () => {
    const sheet = trainer([entry('Captured Momentum')])
    sheet.classes = [{ name: 'Ninja', automation: instance('Ninja') }, { name: 'Climatology', automation: instance('Climatology') }]
    expect(featureTrainerStatBonus(sheet, 'spd')).toBe(2)
    expect(deriveTrainerAutomaticMoves(sheet).map(row => row.entry.name)).toEqual(['Double Team', 'Poison Powder'])
    expect(deriveTrainerAutomaticAbilities(sheet).map(row => row.entry.name)).toEqual(['Overcoat'])
  })

  it('accepts only server-offered action-time choices', () => {
    const sheet = trainer([entry('Go, Fight, Win!')])
    const sourceInstanceId = resolveEffectiveFeatures({ ownerId: sheet.slug, sheet }).instances[0]!.instanceId
    const request = { requestId: 'choice-action.1', sourceInstanceId, actionId: 'execute' as const, actorId: 'trainer-token', targetIds: [], choiceValues: { resolution: ['Show Your Best'] } }
    const base = { sheet, request, scope: { campaignId: 'campaign', sceneId: 'scene', now: 10, roundNumber: 1 }, authorizedActorId: 'trainer-token', authorizedTargetIds: new Set<string>() }
    expect(planFeatureExecution(base).reasonCode).toBe('feature.choices.unauthorized')
    expect(planFeatureExecution({ ...base, authorizedChoiceValues: new Map([['resolution', new Set(['Show Your Best'])]]) }).accepted).toBe(true)
    expect(planFeatureExecution({ ...base, request: { ...request, choiceValues: { resolution: ['Invented Cheer'] } }, authorizedChoiceValues: new Map([['resolution', new Set(['Show Your Best'])]]) }).reasonCode).toBe('feature.choices.unauthorized')
  })

  it('settles variable AP and frequency only after actor, target, and trigger authority', () => {
    const sheet = trainer([entry('Cheers')])
    sheet.classes = [{ name: 'Cheerleader', automation: instance('Cheerleader') }]
    const sourceId = resolveEffectiveFeatures({ ownerId: sheet.slug, sheet }).instances.find(row => row.canonicalId === 'Cheers')!.instanceId
    const request = { requestId: 'feature-request.1', sourceInstanceId: sourceId, actionId: 'execute' as const, actorId: 'trainer-token', targetIds: ['ally-token'], choiceValues: {}, triggerEventId: 'event.orders.1', variableApAmount: 1 }
    const rejected = planFeatureExecution({ sheet, request, scope: { campaignId: 'campaign', sceneId: 'scene', now: 100, roundNumber: 2 }, authorizedActorId: 'trainer-token', authorizedTargetIds: new Set(['ally-token']), acceptedTriggerEventIds: new Set() })
    expect(rejected.reasonCode).toBe('feature.trigger.invalid')
    const accepted = planFeatureExecution({ sheet, request, scope: { campaignId: 'campaign', sceneId: 'scene', now: 100, roundNumber: 2 }, authorizedActorId: 'trainer-token', authorizedTargetIds: new Set(['ally-token']), acceptedTriggerEventIds: new Set(['event.orders.1']) })
    expect(accepted.accepted).toBe(true)
    expect(accepted.sheet.featureApState?.spent).toBe(1)
    expect(accepted.effects.length).toBeGreaterThan(0)
    const retry = planFeatureExecution({ sheet: accepted.sheet, request, scope: { campaignId: 'campaign', sceneId: 'scene', now: 101, roundNumber: 2 }, authorizedActorId: 'trainer-token', authorizedTargetIds: new Set(['ally-token']), acceptedTriggerEventIds: new Set(['event.orders.1']) })
    expect(retry).toMatchObject({ accepted: true, duplicate: true, effects: [] })
    const conflicting = planFeatureExecution({ sheet: accepted.sheet, request: { ...request, targetIds: [] }, scope: { campaignId: 'campaign', sceneId: 'scene', now: 101, roundNumber: 2 }, authorizedActorId: 'trainer-token', authorizedTargetIds: new Set(['ally-token']), acceptedTriggerEventIds: new Set(['event.orders.1']) })
    expect(conflicting.reasonCode).toBe('feature.retry.conflict')
  })

  it('projects and reconciles only reviewed target-Pokémon grants', () => {
    const sheet = trainer([entry('Pusher'), entry('Accentuated Taste')])
    const grants = featureTargetPokemonGrants(sheet)
    expect(grants.filter(grant => grant.sourceCanonicalId === 'Pusher')).toHaveLength(9)
    expect(grants.some(grant => grant.sourceCanonicalId === 'Accentuated Taste')).toBe(false)
    const next = featureTargetPokemonGrants(trainer())
    expect(reconcileFeatureTargetPokemonGrants({ previous: grants, next })).toMatchObject({ added: [], retained: [] })
    expect(reconcileFeatureTargetPokemonGrants({ previous: grants, next }).removed).toHaveLength(9)
  })

  it('plans canonical crafting deltas and rejects client-invented outputs', () => {
    const sheet = trainer([entry('Restorative Science')])
    const sourceId = resolveEffectiveFeatures({ ownerId: sheet.slug, sheet }).instances[0]!.instanceId
    const resources = { money: 500, inventory: {}, controlledTargetIds: new Set<string>(), availableMinutes: 60, locationIds: new Set<string>(), toolIds: new Set<string>() }
    expect(planFeatureCampaignOperation({ sheet, request: { requestId: 'craft.bad', sourceInstanceId: sourceId, outputId: 'Master Ball', targetIds: [] }, resources }).reasonCode).toBe('feature.campaign.output-invalid')
    expect(planFeatureCampaignOperation({ sheet, request: { requestId: 'craft.good', sourceInstanceId: sourceId, outputId: 'Potion', targetIds: [] }, resources })).toMatchObject({ accepted: true, canonicalId: 'Restorative Science', moneyDelta: -100, itemDeltas: { Potion: 1 } })
  })

  it('enforces EOT scope and releases source-bound AP state at lifecycle boundaries', () => {
    const sheet = trainer()
    const frequency = { source: 'EOT', mode: 'eot' as const, uses: null, action: 'free' as const, modifiers: [], payment: { mode: 'bind' as const, amount: 1, variable: false, phase: 'declaration' as const } }
    const first = settleFeatureDeclarationResources({ sheet, canonicalId: 'test', sourceInstanceId: 'feature.source', frequency, scope: { campaignId: 'campaign', roundNumber: 3, now: 30 }, operationId: 'op.1' })
    expect(first.accepted).toBe(true)
    const usedSheet = { ...sheet, featureApState: first.apState, featureUsage: first.usage }
    expect(settleFeatureDeclarationResources({ sheet: usedSheet, canonicalId: 'test', sourceInstanceId: 'feature.source', frequency, scope: { campaignId: 'campaign', roundNumber: 4, now: 40 }, operationId: 'op.2' }).code).toBe('feature.frequency.eot')
    const reconciled = reconcileFeatureSourceLoss(usedSheet, 50)
    expect(reconciled.featureApState?.bindings).toEqual([])
    expect(recoverFeaturesAtExtendedRest({ ...usedSheet, featureApState: { ...first.apState, drains: [{ drainId: 'drain.1', sourceInstanceId: 'feature.source', canonicalId: 'test', amount: 1, recovery: 'extended-rest', createdAt: 30 }] } }, { now: 60 }).featureApState?.drains).toEqual([])
  })

  it('builds immutable read-set plans, rejects stale commits, and bounds server rolls', () => {
    const sheet = trainer([entry('Cheers')]); sheet.classes = [{ name: 'Cheerleader', automation: instance('Cheerleader') }]
    const sourceInstanceId = resolveEffectiveFeatures({ ownerId: sheet.slug, sheet }).instances.find(row => row.canonicalId === 'Cheers')!.instanceId
    const context = createFeatureAuthoritativeContext({ trainerSheet: sheet, actorId: 'trainer-token', authorizedTargetIds: new Set(['ally-token']), acceptedTriggerEventIds: new Set(['event.orders.2']), authorizedActionTypes: new Set(['swift']), authorizedChoiceValues: new Map(), scope: { campaignId: 'campaign', sceneId: 'scene', roundNumber: 1, now: 10 }, readSet: [{ resourceId: `sheet:trainer:${sheet.slug}`, revision: 3, visibility: 'owner' }], causalDepth: 0, causalSourceIds: [] })
    const planned = compileFeatureStatePlan({ context, request: { requestId: 'request.plan.1', sourceInstanceId, actionId: 'execute', actorId: 'trainer-token', targetIds: ['ally-token'], choiceValues: {}, triggerEventId: 'event.orders.2', variableApAmount: 1 } })
    expect(planned.accepted).toBe(true)
    expect(validateFeatureStatePlanCommit({ plan: planned.plan!, currentRevisions: new Map([[`sheet:trainer:${sheet.slug}`, 4]]), committedPlanIds: new Set() }).status).toBe('stale')
    expect(validateFeatureStatePlanCommit({ plan: planned.plan!, currentRevisions: new Map([[`sheet:trainer:${sheet.slug}`, 3]]), committedPlanIds: new Set() }).status).toBe('committed')
    expect(rollFeatureDice({ rollId: 'roll.1', expression: '2d6+1', reasonCode: 'feature.test', roller: () => 4 })).toMatchObject({ rolls: [4, 4], total: 9 })
    expect(() => rollFeatureDice({ rollId: 'roll.2', expression: '33d6', reasonCode: 'feature.test', roller: () => 1 })).toThrow(/budget/)
  })

  it('persists bounded pending workflows and validates team authority', () => {
    let state = createFeaturePendingWorkflow({ state: undefined, workflowId: 'workflow.1', requestId: 'request.1', sourceInstanceId: 'feature.source', canonicalId: 'Feature Name', kind: 'adjudication', allowedResponderIds: ['gm.1'], boundedOptionIds: ['Potion', 'Super Potion'], createdAt: 1, expiresAt: 100 })
    expect(resolveFeaturePendingWorkflow({ state, workflowId: 'workflow.1', responderId: 'player.1', resolution: 'resolve', optionId: 'Potion', now: 2 }).reasonCode).toBe('feature.workflow.unauthorized')
    state = resolveFeaturePendingWorkflow({ state, workflowId: 'workflow.1', responderId: 'gm.1', resolution: 'resolve', optionId: 'Potion', now: 2 }).state
    expect(state.pending[0]?.status).toBe('resolved')

    const sheet = trainer([entry('Agility Training')])
    const sourceInstanceId = resolveEffectiveFeatures({ ownerId: sheet.slug, sheet }).instances[0]!.instanceId
    const relationship = { pokemonId: 'pokemon.1', ownerTrainerId: 'trainer.1', controllerIds: new Set<string>(), roster: 'party' as const, sideId: 'side.1', onMap: true, willing: true, distance: 3, revision: 8 }
    const request = { requestId: 'team.1', sourceInstanceId, trainerId: 'trainer.1', targetPokemonIds: ['pokemon.1'], mode: 'training' as const, commandRange: 6, requireMapPlacement: true, requireSameSide: true }
    expect(planFeatureTeamOperation({ sheet, request, relationships: new Map([['pokemon.1', relationship]]), authorizedTrainerIds: new Set(), trainerSideId: 'side.1' }).reasonCode).toBe('feature.team.trainer-unauthorized')
    expect(planFeatureTeamOperation({ sheet, request, relationships: new Map([['pokemon.1', relationship]]), authorizedTrainerIds: new Set(['trainer.1']), trainerSideId: 'side.1' }).accepted).toBe(true)
  })

  it('routes typed accepted events deterministically and rejects uncontrolled actors', () => {
    const sheet = trainer([entry('Keep Fighting!')])
    const event = { eventId: 'event.hit.1', kind: 'combat-hit' as const, actorId: 'trainer-token', targetIds: ['ally'], occurredAt: 20, causalDepth: 1, sourceIds: [] }
    expect(featureSubscriptionsForEvent({ sheet, event, controlledActorIds: new Set() })).toEqual([])
    const routed = featureSubscriptionsForEvent({ sheet, event, controlledActorIds: new Set(['trainer-token']) })
    expect(routed.map(row => row.canonicalId)).toContain('Keep Fighting!')
  })
})

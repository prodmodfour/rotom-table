import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import rulesetJson from '../../data/breeding-automation/ruleset.json'
import { stableJsonStringify } from '../../shared/automation/stableJson'
import { parseBreedingFeatureProviderHandoffV1 } from '../../shared/breeding/featureProviderHandoff'
import { parseBreedingOperationCommandV1 } from '../../shared/breeding/operations'
import type { PlayerProfile } from '../../shared/playerProfiles'
import { createBreedingActorAuthorityV1, createBreedingTrainerControlEvidenceV1 } from '../../server/domain/breeding/authorization'
import {
  BreedingFeatureProviderHandoffAuthorityError,
  createBreedingFeatureProviderHandoffV1,
  createBreedingProviderContributionSnapshotsFromFeatureHandoffV1,
} from '../../server/domain/breeding/featureProviderHandoff'
import { resolveEffectiveEdges } from '../../server/domain/edgeAutomation/effectiveEdges'
import { resolveEffectiveFeatures } from '../../server/domain/featureAutomation/effectiveFeatures'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteSheetRepository, type StoredSheetDocument } from '../../server/storage/sheetRepository'
import {
  resolveCurrentBreedingFeatureProviderHandoff,
  resolveCurrentFeatureGrantedBreederHandoff,
  ResolveCurrentBreedingFeatureProviderHandoffError,
} from '../../server/useCases/resolveBreedingFeatureProviderHandoff'
import type { TrainerSheet } from '../../src/types/trainerSheet'

const ruleset = rulesetJson as { readonly rulesetId: string, readonly definitionSha256: string }
const databases: RotomDatabase[] = []
const sha256 = (value: unknown): string => createHash('sha256').update(stableJsonStringify(value)).digest('hex')
const operationId = (value: number): string => `breeding-operation:v1:${value.toString(16).padStart(32, '0')}`
const command = (value = 1, profileId = 'profile_feature_0001', selectedTrainerSlug: string | null = 'trainer-feature') => parseBreedingOperationCommandV1({
  schemaVersion: 1,
  operationId: operationId(value),
  commandKind: 'preview-breeding',
  actor: { profileId, selectedTrainerSlug },
  ruleset: { rulesetId: ruleset.rulesetId, definitionSha256: ruleset.definitionSha256 },
  scopes: [],
  payload: {
    ownerTrainerSlug: 'trainer-feature', breederTrainerSlug: 'trainer-feature',
    parentRefs: [{ pokemonSheetSlug: 'pokemon-parent-a', expectedSheetRevision: 1 }, { pokemonSheetSlug: 'pokemon-parent-b', expectedSheetRevision: 1 }],
    optionSnapshotDefinitionSha256: '1'.repeat(64),
  },
})
const profile: PlayerProfile = {
  schemaVersion: 1,
  id: 'profile_feature_0001',
  displayName: 'Feature Provider',
  linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: 'trainer-feature' }],
}
const allFeatureRows: TrainerSheet['features'] = [
  { name: 'Dilettante', choices: { edge: 'Breeder', feature: 'Tutoring', 'feature.move': 'Tackle' } },
  { name: 'Playing God', choices: { species: 'Castform' } },
  { name: 'This One’s Special, I Know It' },
  { name: 'Fossil Restoration' },
  { name: 'Prehistoric Bond' },
  { name: 'Ancient Heritage' },
  { name: 'Genetic Memory' },
  { name: 'Egg Tutor' },
  { name: 'Tutoring', choices: { move: 'Tackle' } },
]
const trainerDocument = (overrides: Partial<TrainerSheet> = {}): TrainerSheet => ({
  slug: 'trainer-feature', name: 'Feature Provider', level: 20,
  skillBackground: { novice: ['pokeEd', 'generalEd'] },
  skills: { techEd: { rankBonus: 3 } },
  features: allFeatureRows,
  edges: [], currentTeam: [], boxedPokemon: [],
  ...overrides,
})
const open = (): RotomDatabase => { const database = openRotomDatabase({ path: ':memory:' }); databases.push(database); return database }
afterEach(() => { while (databases.length > 0) databases.pop()?.close() })
const saveTrainer = (database: RotomDatabase, document: TrainerSheet = trainerDocument(), revision = 4): StoredSheetDocument<unknown> => createSqliteSheetRepository(database).save({ kind: 'trainer', slug: 'trainer-feature', document, revision, updatedAt: 2_000 + revision })
const playerAccess = (trainer: StoredSheetDocument<unknown>, minute = 0) => {
  const actor = createBreedingActorAuthorityV1({ role: 'player', command: command(), authenticatedPrincipalSha256: '2'.repeat(64), authenticationPolicyDefinitionSha256: '3'.repeat(64), profile, evaluatedAtCampaignMinute: minute })
  const control = createBreedingTrainerControlEvidenceV1({ profile, trainerSheetSlug: trainer.slug, trainerSheetRevision: trainer.revision, trainerSheetDefinitionSha256: sha256(trainer.document), evaluatedAtCampaignMinute: minute })
  return { actor, control }
}
const gmActor = () => createBreedingActorAuthorityV1({ role: 'gm', command: command(2, 'campaign-gm', null), authenticatedPrincipalSha256: '4'.repeat(64), authenticationPolicyDefinitionSha256: '3'.repeat(64), profile: null, evaluatedAtCampaignMinute: 0 })
const request = (trainer: StoredSheetDocument<unknown>, checkpoint: string) => {
  const access = playerAccess(trainer)
  return { input: { trainerSheetSlug: trainer.slug, expectedTrainerSheetRevision: trainer.revision, checkpoint, actorAuthority: access.actor, trainerControl: access.control, facilityClaims: [] }, ...access }
}
const domainInput = (trainer: StoredSheetDocument<unknown>, checkpoint: string, facilityClaims: unknown = []) => ({
  trainerSheet: { slug: trainer.slug, revision: trainer.revision, document: trainer.document },
  accessMode: 'gm-authority' as const,
  accessEvidenceDefinitionSha256: 'a'.repeat(64),
  checkpoint,
  capturedAtCampaignMinute: 0,
  facilityClaims,
})
const expectDomainCode = (callback: () => unknown, code: string): void => {
  try { callback(); throw new Error('Expected Feature provider handoff failure.') }
  catch (error) { expect(error).toBeInstanceOf(BreedingFeatureProviderHandoffAuthorityError); expect((error as BreedingFeatureProviderHandoffAuthorityError).code).toBe(code) }
}
const expectUseCaseCode = (callback: () => unknown, code: string): void => {
  try { callback(); throw new Error('Expected current Feature provider handoff failure.') }
  catch (error) { expect(error).toBeInstanceOf(ResolveCurrentBreedingFeatureProviderHandoffError); expect((error as ResolveCurrentBreedingFeatureProviderHandoffError).code).toBe(code) }
}

describe('BR-061 Feature provider handoff', () => {
  it('binds a current Dilettante Breeder grant to exact Feature and dependency evidence', () => {
    const database = open(); const trainer = saveTrainer(database); const { input, control } = request(trainer, 'project-creation')
    const handoff = resolveCurrentBreedingFeatureProviderHandoff(input, { database })
    expect(handoff).toMatchObject({
      trainerSheetSlug: trainer.slug,
      trainerSheetRevision: trainer.revision,
      trainerSheetDefinitionSha256: sha256(trainer.document),
      accessMode: 'profile-control',
      accessEvidenceDefinitionSha256: control.definitionSha256,
      checkpoint: 'project-creation',
      facilityRegistryState: 'empty-no-authority',
    })
    expect(handoff.contributions).toHaveLength(1)
    expect(handoff.contributions[0]).toMatchObject({
      inventoryEntryId: 'feature:Dilettante',
      providerCanonicalId: 'Dilettante',
      contributionIds: ['effective-breeder-edge-grant'],
      disposition: 'active-upstream-effective-provider',
    })
    expect(handoff.dependencyEvidence).toEqual([expect.objectContaining({ providerKind: 'feature', providerId: 'feature.dilettante', checkpoint: 'project-creation' })])
    expect(parseBreedingFeatureProviderHandoffV1(handoff)).toEqual(handoff)
  })

  it('lets the reviewed current Dilettante grant waive the Edge Skill prerequisite and substitute its mandated Skill', () => {
    const database = open(); const trainer = saveTrainer(database, trainerDocument({ skillBackground: { novice: ['generalEd'] } })); const access = playerAccess(trainer)
    const result = resolveCurrentFeatureGrantedBreederHandoff({
      breederTrainerSlug: trainer.slug,
      expectedTrainerSheetRevision: trainer.revision,
      checkpoint: 'project-creation',
      actorAuthority: access.actor,
      breederTrainerControl: access.control,
    }, { database, selectDilettanteMandatedSkill: () => 'generalEd' })
    expect(result.featureHandoff.contributions[0]?.providerCanonicalId).toBe('Dilettante')
    expect(result.breederHandoff.breederAuthority).toMatchObject({
      edgeCanonicalId: 'Breeder',
      pokemonEducationRank: 'Novice',
      pokemonEducationSkillTotal: 3,
    })
    expect(result.breederHandoff.breederAuthority).toMatchObject({ mandatedSkillId: 'general-education' })
    expect(result.breederHandoff.breederAuthority.edgeInstanceId).toContain('edge-grant')
    expect(result.breederHandoff.skillApplication).toMatchObject({ mandatedSkillId: 'general-education', sourceKind: 'dilettante-substitution', rank: 'Novice', skillTotal: 3 })
    const perception = resolveCurrentFeatureGrantedBreederHandoff({ breederTrainerSlug: trainer.slug, expectedTrainerSheetRevision: trainer.revision, checkpoint: 'project-creation', actorAuthority: access.actor, breederTrainerControl: access.control }, { database, selectDilettanteMandatedSkill: () => 'perception' })
    expect(perception.breederHandoff.skillApplication).toMatchObject({ mandatedSkillId: 'perception', rank: 'Untrained', skillTotal: 2 })
    expectUseCaseCode(() => resolveCurrentFeatureGrantedBreederHandoff({ breederTrainerSlug: trainer.slug, expectedTrainerSheetRevision: trainer.revision, checkpoint: 'project-creation', actorAuthority: access.actor, breederTrainerControl: access.control }, { database }), 'breeding.feature-provider-handoff-use-case.unavailable')
    expectUseCaseCode(() => resolveCurrentFeatureGrantedBreederHandoff({ breederTrainerSlug: trainer.slug, expectedTrainerSheetRevision: trainer.revision, checkpoint: 'project-creation', actorAuthority: access.actor, breederTrainerControl: access.control }, { database, selectDilettanteMandatedSkill: (() => Promise.resolve('generalEd')) as never }), 'breeding.feature-provider-handoff-use-case.unavailable')
  })

  it('resolves only the closed providers for each reviewed checkpoint and retains downstream gates', () => {
    const database = open(); const trainer = saveTrainer(database)
    const expected = new Map<string, Array<[string, string]>>([
      ['egg-acceptance', [['Playing God', 'active-provider-evidence']]],
      ['begin-hatch', [['This One’s Special, I Know It', 'reserved-br-062']]],
      ['hatch-transaction', [['Fossil Restoration', 'reserved-br-065'], ['Prehistoric Bond', 'reserved-br-065']]],
      ['post-hatch-operation', [['Ancient Heritage', 'reserved-br-068'], ['Egg Tutor', 'reserved-br-068'], ['Genetic Memory', 'reserved-br-068'], ['Tutoring', 'reserved-br-068']]],
    ])
    for (const [checkpoint, rows] of expected) {
      const handoff = createBreedingFeatureProviderHandoffV1(domainInput(trainer, checkpoint))
      expect(handoff.contributions.map(entry => [entry.providerCanonicalId, entry.disposition])).toEqual(rows)
      expect(handoff.dependencyEvidence).toHaveLength(rows.length)
      if (checkpoint === 'begin-hatch') expect(handoff.contributions[0]?.values).toEqual([{ contributionId: 'force-bounded-special-outcome', value: { kind: 'integer', value: 1 } }])
      if (checkpoint === 'hatch-transaction') expect(handoff.contributions[0]?.values[0]).toEqual({ contributionId: 'fossil-tutor-point-delta-minus-2', value: { kind: 'integer', value: -2 } })
    }
  })

  it('keeps the absent facility registry fail-closed and never aliases a free-text facility', () => {
    const database = open(); const trainer = saveTrainer(database)
    expect(createBreedingFeatureProviderHandoffV1(domainInput(trainer, 'egg-acceptance')).facilityRegistryState).toBe('empty-no-authority')
    expectDomainCode(() => createBreedingFeatureProviderHandoffV1(domainInput(trainer, 'egg-acceptance', ['daycare'])), 'breeding.feature-provider-handoff.facility-unavailable')
    expectDomainCode(() => createBreedingFeatureProviderHandoffV1(domainInput(trainer, 'egg-acceptance', { facilityId: 'daycare' })), 'breeding.feature-provider-handoff.invalid-request')
  })

  it('requires the Dilettante choice to grant Breeder and honors current Feature suppression in both domains', () => {
    const database = open(); const trainer = saveTrainer(database, trainerDocument({ features: [{ name: 'Dilettante', choices: { edge: 'Groomer', feature: 'Tutoring', 'feature.move': 'Tackle' } }] }))
    const noGrant = createBreedingFeatureProviderHandoffV1(domainInput(trainer, 'project-creation'))
    expect(noGrant.contributions).toEqual([])
    expect(resolveEffectiveEdges({ ownerId: trainer.slug, family: 'trainer', sheet: trainer.document as TrainerSheet }).instances.some(entry => entry.canonicalId === 'Breeder')).toBe(false)

    const granted = saveTrainer(database, trainerDocument({ features: [allFeatureRows[0]!] }), 5)
    const suppressions = [{ canonicalId: 'Dilettante', sourceId: 'test', reasonCode: 'suppressed' }]
    expect(createBreedingFeatureProviderHandoffV1(domainInput(granted, 'project-creation'), { featureSuppressions: suppressions }).contributions).toEqual([])
    expect(resolveEffectiveEdges({ ownerId: granted.slug, family: 'trainer', sheet: granted.document as TrainerSheet, featureSuppressions: suppressions }).instances.some(entry => entry.canonicalId === 'Breeder')).toBe(false)
  })

  it('deduplicates repeated ownership provenance and rejects malformed relevant identities', () => {
    const database = open(); const repeated = saveTrainer(database, trainerDocument({ features: [{ name: 'Tutoring', choices: { move: 'Tackle' } }, { name: 'Tutoring', choices: { move: 'Tackle' } }] }))
    const handoff = createBreedingFeatureProviderHandoffV1(domainInput(repeated, 'post-hatch-operation'))
    expect(handoff.contributions).toHaveLength(1)
    expect(handoff.dependencyEvidence).toHaveLength(1)

    const malformed = saveTrainer(database, trainerDocument({ features: [{ name: 'Egg Tutor', automation: { invalid: true } as never }] }), 5)
    expectDomainCode(() => createBreedingFeatureProviderHandoffV1(domainInput(malformed, 'post-hatch-operation')), 'breeding.feature-provider-handoff.provider-ambiguous')
  })

  it('keeps player and GM access separate and requires exact synchronous GM verification', () => {
    const database = open(); const trainer = saveTrainer(database)
    const gmInput = { trainerSheetSlug: trainer.slug, expectedTrainerSheetRevision: trainer.revision, checkpoint: 'egg-acceptance', actorAuthority: gmActor(), trainerControl: null, facilityClaims: [] }
    expect(resolveCurrentBreedingFeatureProviderHandoff(gmInput, { database, validateCurrentGmAuthority: () => true }).accessMode).toBe('gm-authority')
    expectUseCaseCode(() => resolveCurrentBreedingFeatureProviderHandoff(gmInput, { database, validateCurrentGmAuthority: () => false }), 'breeding.feature-provider-handoff-use-case.invalid-authority')
    expectUseCaseCode(() => resolveCurrentBreedingFeatureProviderHandoff(gmInput, { database, validateCurrentGmAuthority: (() => Promise.resolve(true)) as never }), 'breeding.feature-provider-handoff-use-case.invalid-authority')
    const playerInput = request(trainer, 'egg-acceptance').input
    expectUseCaseCode(() => resolveCurrentBreedingFeatureProviderHandoff(playerInput, { database, validateCurrentGmAuthority: () => true }), 'breeding.feature-provider-handoff-use-case.invalid-authority')
  })

  it('rejects stale control, enriched requests, and unknown checkpoints before provider authority', () => {
    const database = open(); const trainer = saveTrainer(database); const current = request(trainer, 'egg-acceptance')
    expectUseCaseCode(() => resolveCurrentBreedingFeatureProviderHandoff({ ...current.input, expectedTrainerSheetRevision: 3 }, { database }), 'breeding.feature-provider-handoff-use-case.stale-authority')
    const staleControl = createBreedingTrainerControlEvidenceV1({ profile, trainerSheetSlug: trainer.slug, trainerSheetRevision: trainer.revision, trainerSheetDefinitionSha256: 'f'.repeat(64), evaluatedAtCampaignMinute: 0 })
    expectUseCaseCode(() => resolveCurrentBreedingFeatureProviderHandoff({ ...current.input, trainerControl: staleControl }, { database }), 'breeding.feature-provider-handoff-use-case.stale-authority')
    expectUseCaseCode(() => resolveCurrentBreedingFeatureProviderHandoff({ ...current.input, clientContributions: [] } as never, { database }), 'breeding.feature-provider-handoff-use-case.invalid-request')
    let accessorInvoked = false
    const accessorRequest = { ...current.input }
    Object.defineProperty(accessorRequest, 'checkpoint', { enumerable: true, get: () => { accessorInvoked = true; return 'egg-acceptance' } })
    expectUseCaseCode(() => resolveCurrentBreedingFeatureProviderHandoff(accessorRequest, { database }), 'breeding.feature-provider-handoff-use-case.invalid-request')
    expect(accessorInvoked).toBe(false)
    const sparseFacilities: unknown[] = []; sparseFacilities.length = 1
    expectDomainCode(() => createBreedingFeatureProviderHandoffV1(domainInput(trainer, 'egg-acceptance', sparseFacilities)), 'breeding.feature-provider-handoff.invalid-request')
    expectDomainCode(() => createBreedingFeatureProviderHandoffV1(domainInput(trainer, 'client-checkpoint')), 'breeding.feature-provider-handoff.invalid-request')
  })

  it('fails provider exceptions and Promises synchronously without operations, sheets, or events', () => {
    const database = open(); const trainer = saveTrainer(database); const before = createSqliteSheetRepository(database).get('trainer', trainer.slug)
    expectDomainCode(() => createBreedingFeatureProviderHandoffV1(domainInput(trainer, 'egg-acceptance'), { resolveEffectiveFeatures: (() => { throw new Error('injected') }) as never }), 'breeding.feature-provider-handoff.provider-failure')
    expectDomainCode(() => createBreedingFeatureProviderHandoffV1(domainInput(trainer, 'egg-acceptance'), { resolveEffectiveFeatures: (() => Promise.resolve({})) as never }), 'breeding.feature-provider-handoff.provider-failure')
    let projectionAccessorInvoked = false
    const accessorProjection = { schemaVersion: 1, instances: [], unresolved: [] }
    Object.defineProperty(accessorProjection, 'ownerId', { enumerable: true, get: () => { projectionAccessorInvoked = true; return trainer.slug } })
    expectDomainCode(() => createBreedingFeatureProviderHandoffV1(domainInput(trainer, 'egg-acceptance'), { resolveEffectiveFeatures: (() => accessorProjection) as never }), 'breeding.feature-provider-handoff.provider-failure')
    expect(projectionAccessorInvoked).toBe(false)
    expect(createSqliteSheetRepository(database).get('trainer', trainer.slug)).toEqual(before)
    expect(database.connection.prepare('SELECT COUNT(*) AS count FROM breeding_operations').get()).toEqual({ count: 0 })
    expect(database.connection.prepare('SELECT COUNT(*) AS count FROM realtime_events').get()).toEqual({ count: 0 })
  })

  it('binds Playing God campaign-provider evidence but projects no provider payload or mutation result', () => {
    const database = open(); const trainer = saveTrainer(database)
    const handoff = createBreedingFeatureProviderHandoffV1(domainInput(trainer, 'egg-acceptance'))
    const playingGod = handoff.contributions[0]!
    expect(playingGod.providerCanonicalId).toBe('Playing God')
    expect(playingGod.contributionIds).toEqual(['artificial-egg-source','artificial-species-options','hatch-within-one-day','starting-level-5','nature-choice','basic-ability-choice','bounded-artificial-upgrades'])
    expect(playingGod.values).toEqual([
      { contributionId: 'artificial-egg-source', value: { kind: 'flag', enabled: true } },
      { contributionId: 'artificial-species-options', value: { kind: 'canonical-id-set', values: ['castform'] } },
      { contributionId: 'hatch-within-one-day', value: { kind: 'integer', value: 1_440 } },
      { contributionId: 'starting-level-5', value: { kind: 'integer', value: 5 } },
      { contributionId: 'nature-choice', value: { kind: 'flag', enabled: true } },
      { contributionId: 'basic-ability-choice', value: { kind: 'flag', enabled: true } },
      { contributionId: 'bounded-artificial-upgrades', value: { kind: 'integer', value: 5 } },
    ])
    const snapshots = createBreedingProviderContributionSnapshotsFromFeatureHandoffV1(handoff)
    expect(snapshots).toHaveLength(7)
    expect(snapshots[1]).toMatchObject({ inventoryEntryId: 'feature:Playing God', providerKind: 'feature', providerId: 'feature.playing-god', checkpoint: 'egg-acceptance', contributionId: 'artificial-species-options', value: { kind: 'canonical-id-set', values: ['castform'] } })
    const forgedValues = playingGod.values.map(entry => entry.contributionId === 'starting-level-5' ? { ...entry, value: { kind: 'integer', value: 6 } } : entry)
    expect(() => parseBreedingFeatureProviderHandoffV1({ ...handoff, contributions: [{ ...playingGod, values: forgedValues }] })).toThrow()
    expect(JSON.stringify(handoff)).not.toContain('$3500')
    expect(JSON.stringify(handoff)).not.toContain('speciesOptionId')
    expect(JSON.stringify(handoff)).not.toContain('moneyDelta')
    expect(() => parseBreedingFeatureProviderHandoffV1({ ...handoff, facilityRegistryState: 'daycare' })).toThrow()
    expect(resolveEffectiveFeatures({ ownerId: trainer.slug, sheet: trainer.document as TrainerSheet }).instances.some(entry => entry.canonicalId === 'Playing God' && entry.effective)).toBe(true)
  })
})

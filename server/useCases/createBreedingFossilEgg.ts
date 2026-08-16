import { createHash, randomInt } from 'node:crypto'
import securityPolicyJson from '../../data/breeding-automation/security-policy.json'
import { stableJsonStringify } from '#shared/automation/stableJson'
import type { BreedingActorAuthorityV1, BreedingAuthorizationReceiptV1 } from '#shared/breeding/authorization'
import type { PokemonEggDocumentV1 } from '#shared/breeding/egg'
import type { BreedingFossilEggCreationProjectionV1, BreedingFossilReanimationAuthorityV1, BreedingFossilSourceAuthorityV1 } from '#shared/breeding/fossilEgg'
import type { BreedingOptionOfferRecordV1 } from '#shared/breeding/ledgers'
import { parseBreedingRollRecordIdSyntax, type BreedingRollRecordId } from '#shared/breeding/ids'
import type { BreedingDependencyEvidenceV1, BreedingOperationReadSetV1, BreedingReadResourceV1 } from '#shared/breeding/readSets'
import { parseBreedingOperationCommandV1, type BreedingOperationCommandV1, type BreedingOperationResultV1 } from '#shared/breeding/operations'
import type { PersistedSheet } from '../storage/sheetRepository'
import {
  createBreedingAuthorizationReceiptV1,
  parseAuthoritativeBreedingActorAuthorityV1,
  parseAuthoritativeBreedingAuthorizationReceiptV1,
} from '../domain/breeding/authorization'
import { parseBreedingCampaignOptionSnapshotV1 } from '../domain/breeding/campaignOptions'
import { createBreedingFeatureProviderHandoffV1, parseAuthoritativeBreedingFeatureProviderHandoffV1, type BreedingFeatureProviderHandoffDependencies } from '../domain/breeding/featureProviderHandoff'
import {
  BREEDING_FOSSIL_EGG_POLICY_DEFINITION_SHA256,
  BreedingFossilEggAuthorityError,
  breedingFossilEggDependencyEvidenceV1,
  breedingFossilOfferId,
  breedingFossilRollSourceDefinitionHashes,
  consumeBreedingFossilSourceInventoryV1,
  createBreedingFossilEggOptionOffersV1,
  createBreedingFossilReanimationAuthorityV1,
  createBreedingFossilSourceAuthorityV1,
  parseAuthoritativeBreedingFossilReanimationAuthorityV1,
  parseAuthoritativeBreedingFossilSourceAuthorityV1,
  planBreedingFossilEggV1,
  projectBreedingFossilEggCreationV1,
  type BreedingFossilOfferSlot,
  type BreedingFossilReanimationDependencies,
} from '../domain/breeding/fossilEgg'
import { createBreedingRollRecordFromInjectedValues } from '../domain/breeding/ledgers'
import {
  createBreedingOperationAcceptedV1,
  createBreedingOperationCommandHash,
  createBreedingOperationRejectedV1,
} from '../domain/breeding/operations'
import {
  parseAuthoritativeBreedingReferenceVersionSnapshotV1,
  validateBreedingOperationReadSetCompleteness,
} from '../domain/breeding/readSets'
import { breedingRealtimeRefreshAppendInputs } from '../realtime/breedingRealtime'
import {
  normalizeAuthoritativeSheetDocumentUpdate,
  sheetDocumentUpdatedRealtimeAppendInput,
} from '../realtime/sheetDocumentRealtime'
import { createSqliteBreedingOperationEvidenceRepository } from '../storage/breedingOperationEvidenceRepository'
import { createSqliteBreedingOperationRepository, type BreedingOperationLedgerRecord } from '../storage/breedingOperationRepository'
import { createSqliteBreedingOptionOfferRepository } from '../storage/breedingOptionOfferRepository'
import { createSqliteBreedingRollRepository } from '../storage/breedingRollRepository'
import { createSqliteCampaignClockRepository } from '../storage/campaignClockRepository'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import { createSqlitePokemonEggRepository } from '../storage/pokemonEggRepository'
import { createSqliteSheetRepository } from '../storage/sheetRepository'
import {
  createBreedingTransactionCoordinator,
  type BreedingTransactionCoordinator,
  type BreedingTransactionExecutionDecision,
} from './executeBreedingTransaction'

const SECURITY_POLICY = securityPolicyJson as unknown as {
  readonly definitionSha256: string
  readonly definition: unknown
}
const FOSSIL_OFFER_SLOTS = Object.freeze([
  'species','nature','primary-ability','gender','inheritance-move','restoration-extra-ability','prehistoric-bond-stat','hatch-duration','baby-template',
] as const satisfies readonly BreedingFossilOfferSlot[])

export interface CreateBreedingFossilEggInputV1 {
  readonly command: unknown
  readonly readSet: unknown
  readonly authorizationReceipt: unknown
  readonly actorAuthority: unknown
  readonly sourceAuthority: unknown
  readonly reanimationAuthority: unknown
  readonly featureProviderHandoff: unknown
  readonly campaignOptionSnapshot: unknown
  readonly audience: unknown
}
export interface BreedingFossilOfferChoiceResolverInputV1 {
  readonly command: Extract<BreedingOperationCommandV1, { readonly commandKind: 'create-source-egg' }>
  readonly sourceAuthority: BreedingFossilSourceAuthorityV1
  readonly reanimationAuthority: BreedingFossilReanimationAuthorityV1
  readonly featureProviderHandoff: ReturnType<typeof createBreedingFeatureProviderHandoffV1>
  readonly campaignOptionSnapshot: ReturnType<typeof parseBreedingCampaignOptionSnapshotV1>
  readonly trainerSheet: { readonly slug: string, readonly revision: number, readonly document: unknown }
}
export interface CreateBreedingFossilEggOptions
  extends BreedingFeatureProviderHandoffDependencies,
    BreedingFossilReanimationDependencies {
  readonly database?: RotomDatabase
  readonly coordinator?: BreedingTransactionCoordinator
  readonly validateCurrentGmAuthority: (actor: BreedingActorAuthorityV1) => boolean
  readonly resolveCurrentCampaignOptionSnapshot: () => unknown
  readonly resolveCurrentReferenceVersions: () => unknown
  readonly resolveCurrentOfferChoices: (input: BreedingFossilOfferChoiceResolverInputV1) => unknown
  readonly offerLifetimeCampaignMinutes: number
  readonly campaignProjectionKey: Buffer | string
  readonly realtimeTimestamp: number
  readonly sheetUpdatedAt: number
  readonly drawHatchDurationPercentage?: () => number
  readonly resumePending?: boolean
  readonly beforeSettle?: (result: BreedingOperationResultV1) => void
}
export interface CreateBreedingFossilEggResultV1 {
  readonly execution: BreedingTransactionExecutionDecision
  readonly egg: PokemonEggDocumentV1 | null
  readonly sourceTrainerSheet: PersistedSheet | null
  readonly projection: BreedingFossilEggCreationProjectionV1 | null
}
export type CreateBreedingFossilEggErrorCode =
  | 'breeding.fossil-egg-use-case.invalid-request'
  | 'breeding.fossil-egg-use-case.invalid-authority'
  | 'breeding.fossil-egg-use-case.invalid-random-source'
  | 'breeding.fossil-egg-use-case.repository-mismatch'
  | 'breeding.fossil-egg-use-case.stale-authority'
  | 'breeding.fossil-egg-use-case.unavailable'
  | 'breeding.fossil-egg-use-case.wrong-command'
export class CreateBreedingFossilEggError extends Error {
  readonly code: CreateBreedingFossilEggErrorCode
  constructor(code: CreateBreedingFossilEggErrorCode, message: string) {
    super(message)
    this.name = 'CreateBreedingFossilEggError'
    this.code = code
  }
}
const fail = (code: CreateBreedingFossilEggErrorCode, message: string): never => { throw new CreateBreedingFossilEggError(code, message) }
const sha256 = (value: unknown): string => createHash('sha256').update(stableJsonStringify(value)).digest('hex')
const same = (left: unknown, right: unknown): boolean => stableJsonStringify(left) === stableJsonStringify(right)
const compare = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0
const promiseLike = (value: unknown): value is PromiseLike<unknown> => (typeof value === 'object' || typeof value === 'function') && value !== null && typeof (value as { readonly then?: unknown }).then === 'function'
const strict = (value: unknown, fields: readonly string[], label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    || Object.getOwnPropertySymbols(value).length > 0) return fail('breeding.fossil-egg-use-case.invalid-request', `${label} must be one plain exact object.`)
  const row = value as Record<string, unknown>; const allowed = new Set(fields)
  if (fields.some(field => !Object.hasOwn(row, field)) || Object.getOwnPropertyNames(row).some(field => !allowed.has(field))) return fail('breeding.fossil-egg-use-case.invalid-request', `${label} must contain exactly the declared fields.`)
  for (const field of fields) { const descriptor = Object.getOwnPropertyDescriptor(row, field); if (!descriptor?.enumerable || !('value' in descriptor)) return fail('breeding.fossil-egg-use-case.invalid-request', `${label}.${field} must be an enumerable data field.`) }
  return row
}
const integer = (value: unknown, label: string): number => Number.isSafeInteger(value) && Number(value) >= 0
  ? Number(value) : fail('breeding.fossil-egg-use-case.invalid-request', `${label} must be a nonnegative safe integer.`)
const invoke = <Value>(label: string, callback: () => Value, code: CreateBreedingFossilEggErrorCode = 'breeding.fossil-egg-use-case.stale-authority'): Value => {
  let value: Value
  try { value = callback() }
  catch (error) { if (error instanceof CreateBreedingFossilEggError || error instanceof BreedingFossilEggAuthorityError) throw error; return fail(code, `${label} failed closed.`) }
  if (promiseLike(value)) return fail(code, `${label} must be synchronous.`)
  return value
}
const resource = (readSet: BreedingOperationReadSetV1, kind: BreedingReadResourceV1['resourceKind'], id: string): BreedingReadResourceV1 | null => readSet.resources.find(entry => entry.resourceKind === kind && entry.resourceId === id) ?? null
const clockHash = (clock: { readonly revision: number, readonly campaignMinute: number, readonly lastOperationId: string | null }): string => sha256({ schemaVersion: 1, revision: clock.revision, campaignMinute: clock.campaignMinute, lastOperationId: clock.lastOperationId })
const exactExecution = (record: BreedingOperationLedgerRecord): BreedingTransactionExecutionDecision => Object.freeze({ kind: 'exact-retry', record, committedRealtimeEvents: Object.freeze([]), publicationFailureCount: 0 })
const assertStoredCommand = (record: BreedingOperationLedgerRecord, command: BreedingOperationCommandV1): void => {
  if (!same(record.command, command) || record.commandHash !== createBreedingOperationCommandHash(command)) return fail('breeding.fossil-egg-use-case.invalid-request', 'Operation identity is bound to another immutable command.')
}
const verifyGm = (actor: BreedingActorAuthorityV1, options: CreateBreedingFossilEggOptions): void => {
  if (actor.role !== 'gm' || typeof options.validateCurrentGmAuthority !== 'function') return fail('breeding.fossil-egg-use-case.invalid-authority', 'Fossil designation and bounded traits require current authenticated GM campaign authority.')
  const verified = invoke('Current GM authority verification', () => options.validateCurrentGmAuthority(actor), 'breeding.fossil-egg-use-case.invalid-authority')
  if (verified !== true) return fail('breeding.fossil-egg-use-case.invalid-authority', 'Current GM authority verifier must return exact true.')
}
const coordinatorFor = (options: CreateBreedingFossilEggOptions) => {
  const database = options.database ?? options.coordinator?.database ?? getRotomDatabase()
  if (options.coordinator && options.coordinator.database !== database) return fail('breeding.fossil-egg-use-case.repository-mismatch', 'Coordinator and fossil Egg use case must share one database connection.')
  return Object.freeze({ database, coordinator: options.coordinator ?? createBreedingTransactionCoordinator({ database }) })
}
const currentFeatureHandoff = (input: {
  readonly trainer: { readonly slug: string, readonly revision: number, readonly document: unknown }
  readonly actor: BreedingActorAuthorityV1
  readonly campaignMinute: number
  readonly options: CreateBreedingFossilEggOptions
}) => createBreedingFeatureProviderHandoffV1({
  trainerSheet: input.trainer,
  accessMode: 'gm-authority',
  accessEvidenceDefinitionSha256: input.actor.definitionSha256,
  checkpoint: 'hatch-transaction',
  capturedAtCampaignMinute: input.campaignMinute,
  facilityClaims: [],
}, {
  ...(input.options.resolveEffectiveFeatures ? { resolveEffectiveFeatures: input.options.resolveEffectiveFeatures } : {}),
  ...(input.options.featureSuppressions ? { featureSuppressions: input.options.featureSuppressions } : {}),
  ...(input.options.resolveTrainerSkills ? { resolveTrainerSkills: input.options.resolveTrainerSkills } : {}),
})
const currentSourceAuthorities = (input: {
  readonly command: Extract<BreedingOperationCommandV1, { readonly commandKind: 'create-source-egg' }>
  readonly trainer: { readonly slug: string, readonly revision: number, readonly document: unknown }
  readonly source: BreedingFossilSourceAuthorityV1
  readonly reanimation: BreedingFossilReanimationAuthorityV1
  readonly campaignMinute: number
  readonly options: CreateBreedingFossilEggOptions
}): { readonly source: BreedingFossilSourceAuthorityV1, readonly reanimation: BreedingFossilReanimationAuthorityV1 } => {
  if (input.command.payload.source.kind !== 'fossil') {
    return fail('breeding.fossil-egg-use-case.wrong-command', 'Fossil authority requires a fossil source command.')
  }
  const source = createBreedingFossilSourceAuthorityV1({
    eggId: input.command.payload.eggId,
    sourceId: input.command.payload.source.sourceId,
    ownerTrainerSheet: input.trainer,
    custody: { inventoryEntryId: input.source.sourceInventoryEntryId, unitOrdinal: input.source.sourceUnitOrdinal },
    capturedAtCampaignMinute: input.campaignMinute,
  })
  const reanimation = createBreedingFossilReanimationAuthorityV1({
    ownerTrainerSheet: input.trainer,
    sourceAuthority: source,
    reanimationMachineCustody: {
      inventoryEntryId: input.reanimation.reanimationMachineInventoryEntryId,
      unitOrdinal: input.reanimation.reanimationMachineUnitOrdinal,
    },
    capturedAtCampaignMinute: input.campaignMinute,
  }, {
    ...(input.options.resolveEffectiveEdges ? { resolveEffectiveEdges: input.options.resolveEffectiveEdges } : {}),
    ...(input.options.resolveTrainerSkills ? { resolveTrainerSkills: input.options.resolveTrainerSkills } : {}),
    ...(input.options.planTrainerEdgeCampaignOperation ? { planTrainerEdgeCampaignOperation: input.options.planTrainerEdgeCampaignOperation } : {}),
  })
  if (!same(source, input.source) || !same(reanimation, input.reanimation)) return fail('breeding.fossil-egg-use-case.stale-authority', 'Submitted fossil source, Paleontologist, Skill, and Reanimation Machine evidence must equal current server-rebuilt authority.')
  return Object.freeze({ source, reanimation })
}
const selectedSpeciesId = (command: Extract<BreedingOperationCommandV1, { readonly commandKind: 'create-source-egg' }>, offers: readonly BreedingOptionOfferRecordV1[]): string => {
  const values = offers.flatMap(offer => offer.options.filter(option => option.optionId === command.payload.speciesOptionId && option.kind === 'species').map(option => option.canonicalValueId))
  if (values.length !== 1) return fail('breeding.fossil-egg-use-case.invalid-authority', 'Fossil Species selection must resolve exactly one current server-issued Species option.')
  return values[0]!
}
const expectedDependencies = (input: {
  readonly readSet: BreedingOperationReadSetV1
  readonly source: BreedingFossilSourceAuthorityV1
  readonly reanimation: BreedingFossilReanimationAuthorityV1
  readonly feature: ReturnType<typeof createBreedingFeatureProviderHandoffV1>
  readonly options: ReturnType<typeof parseBreedingCampaignOptionSnapshotV1>
  readonly speciesId: string
}): readonly BreedingDependencyEvidenceV1[] => {
  const expected = breedingFossilEggDependencyEvidenceV1({
    sourceAuthority: input.source,
    reanimationAuthority: input.reanimation,
    featureProviderHandoff: input.feature,
    campaignOptionSnapshot: input.options,
    speciesId: input.speciesId,
  })
  const actual = input.readSet.dependencyEvidence.filter(entry => entry.providerId !== 'breeding-effective-dependency-set-v1')
  const attestations = input.readSet.dependencyEvidence.filter(entry => entry.providerId === 'breeding-effective-dependency-set-v1')
  if (!same(actual, expected) || attestations.length !== 1) return fail('breeding.fossil-egg-use-case.invalid-authority', 'Fossil read set must contain the exact current source, Edge, tool, Feature, option, and Species dependency set.')
  const attestation = attestations[0]!
  if (attestation.providerKind !== 'system' || attestation.subjectKind !== 'campaign' || attestation.subjectId !== 'campaign'
    || attestation.subjectRevision !== null || attestation.checkpoint !== 'authorization'
    || attestation.providerDefinitionSha256 !== SECURITY_POLICY.definitionSha256
    || attestation.effectiveEvidenceSha256 !== sha256(expected)) return fail('breeding.fossil-egg-use-case.invalid-authority', 'Fossil dependency-set attestation must hash the exact complete effective evidence set.')
  return expected
}
const currentReadSetMatches = (input: {
  readonly readSet: BreedingOperationReadSetV1
  readonly command: Extract<BreedingOperationCommandV1, { readonly commandKind: 'create-source-egg' }>
  readonly clock: { readonly revision: number, readonly campaignMinute: number, readonly lastOperationId: string | null }
  readonly trainer: { readonly slug: string, readonly revision: number, readonly document: unknown }
  readonly offers: readonly BreedingOptionOfferRecordV1[]
  readonly optionSnapshotDefinitionSha256: string
}): boolean => {
  const clock = resource(input.readSet, 'campaign-clock', 'campaign-clock')
  const trainer = resource(input.readSet, 'trainer-sheet', input.trainer.slug)
  const egg = resource(input.readSet, 'pokemon-egg', input.command.payload.eggId)
  const trainerScope = input.command.scopes.find(scope => scope.kind === 'trainer-sheet')
  return input.readSet.capturedAtCampaignMinute === input.clock.campaignMinute
    && clock?.existence === 'present' && clock.revision === input.clock.revision && clock.definitionSha256 === clockHash(input.clock)
    && clock.observedCampaignMinute === input.clock.campaignMinute && clock.purposes.includes('campaign-time')
    && trainer?.existence === 'present' && trainer.revision === input.trainer.revision && trainer.definitionSha256 === sha256(input.trainer.document)
    && trainer.purposes.includes('authorization') && trainer.purposes.includes('mechanics') && trainer.purposes.includes('conflict')
    && trainerScope?.kind === 'trainer-sheet' && trainerScope.sheetSlug === input.trainer.slug && trainerScope.expectedRevision === input.trainer.revision
    && trainerScope.fields.length === 1 && trainerScope.fields[0] === 'inventory'
    && egg?.existence === 'absent' && egg.revision === null && egg.definitionSha256 === null && egg.purposes.includes('conflict')
    && input.readSet.referenceVersions.campaignOptionSnapshotDefinitionSha256 === input.optionSnapshotDefinitionSha256
    && input.offers.every(offer => {
      const current = resource(input.readSet, 'breeding-offer', offer.offerId)
      return current?.existence === 'present' && current.revision === 0 && current.definitionSha256 === offer.definitionSha256
        && current.observedCampaignMinute === null && current.purposes.includes('mechanics')
    })
}
const expectedReceipt = (input: {
  readonly command: Extract<BreedingOperationCommandV1, { readonly commandKind: 'create-source-egg' }>
  readonly readSet: BreedingOperationReadSetV1
  readonly actor: BreedingActorAuthorityV1
  readonly source: BreedingFossilSourceAuthorityV1
  readonly reanimation: BreedingFossilReanimationAuthorityV1
  readonly feature: ReturnType<typeof createBreedingFeatureProviderHandoffV1>
  readonly optionSnapshotDefinitionSha256: string
  readonly offers: readonly BreedingOptionOfferRecordV1[]
}): BreedingAuthorizationReceiptV1 => createBreedingAuthorizationReceiptV1({
  operationId: input.command.operationId,
  commandSha256: createBreedingOperationCommandHash(input.command),
  commandKind: input.command.commandKind,
  actorAuthorityDefinitionSha256: input.actor.definitionSha256,
  readSetDefinitionSha256: input.readSet.definitionSha256,
  evidenceDefinitionHashes: [
    input.actor.definitionSha256,
    input.source.definitionSha256,
    input.reanimation.definitionSha256,
    input.feature.definitionSha256,
    input.optionSnapshotDefinitionSha256,
    BREEDING_FOSSIL_EGG_POLICY_DEFINITION_SHA256,
    ...input.offers.map(offer => offer.definitionSha256),
  ],
  gmOverrideIds: [],
  authorized: true,
  reasonId: 'breeding.authorization.authorized',
  evaluatedAtCampaignMinute: input.readSet.capturedAtCampaignMinute,
  securityPolicyDefinitionSha256: SECURITY_POLICY.definitionSha256,
})
const exactEvidence = (database: RotomDatabase, operationId: string, readSet: BreedingOperationReadSetV1, receipt: BreedingAuthorizationReceiptV1): boolean => {
  const evidence = createSqliteBreedingOperationEvidenceRepository(database).get(operationId)
  return !!evidence && same(evidence.readSet, readSet) && same(evidence.authorizationReceipt, receipt)
}
const drawPercentage = (options: CreateBreedingFossilEggOptions): number => {
  const value = invoke('Fossil hatch-duration random source', () => options.drawHatchDurationPercentage ? options.drawHatchDurationPercentage() : randomInt(50, 201), 'breeding.fossil-egg-use-case.invalid-random-source')
  if (!Number.isSafeInteger(value) || Number(value) < 50 || Number(value) > 200) return fail('breeding.fossil-egg-use-case.invalid-random-source', 'Fossil hatch-duration random source must return 50 through 200.')
  return Number(value)
}
const rollRecordId = (operationId: string): BreedingRollRecordId => parseBreedingRollRecordIdSyntax(`breeding-roll:v1:${createHash('sha256').update(`breeding-fossil-egg-roll-v1\u0000${operationId}\u0000${0}`).digest('hex').slice(0,32)}`)!
const prepareDurationRoll = (input: {
  readonly database: RotomDatabase
  readonly command: Extract<BreedingOperationCommandV1, { readonly commandKind: 'create-source-egg' }>
  readonly source: BreedingFossilSourceAuthorityV1
  readonly reanimation: BreedingFossilReanimationAuthorityV1
  readonly optionSnapshot: ReturnType<typeof parseBreedingCampaignOptionSnapshotV1>
  readonly offers: readonly BreedingOptionOfferRecordV1[]
  readonly speciesId: string
  readonly campaignMinute: number
  readonly options: CreateBreedingFossilEggOptions
}): void => {
  const requested = input.optionSnapshot.values['breeding.hatch-duration-variation'] === 'server-random-half-to-double'
  input.database.withTransaction(() => {
    const repository = createSqliteBreedingRollRepository(input.database)
    const current = repository.listByOperation(input.command.operationId)
    if (!requested) {
      if (current.length !== 0) return fail('breeding.fossil-egg-use-case.invalid-authority', 'Fixed or GM-bounded fossil duration rejects persisted random input.')
      return
    }
    if (current.length > 0) {
      if (current.length !== 1 || current[0]?.purpose !== 'hatch-duration-percentage') return fail('breeding.fossil-egg-use-case.invalid-authority', 'Random fossil duration requires exactly one persisted hatch-duration roll and no extraneous randomness.')
      return
    }
    const percentage = drawPercentage(input.options)
    const roll = createBreedingRollRecordFromInjectedValues({
      schemaVersion: 1,
      rollRecordId: rollRecordId(input.command.operationId),
      operationId: input.command.operationId,
      commandSha256: createBreedingOperationCommandHash(input.command),
      operationRollOrdinal: 0,
      purpose: 'hatch-duration-percentage',
      target: { kind: 'pokemon-egg', eggId: input.command.payload.eggId, revision: 0 },
      formula: 'percentage-50-to-200',
      dieCount: 1,
      dieSides: 151,
      ordered: false,
      modifier: 49,
      values: [percentage - 49],
      generatorId: 'server-rng-v1',
      sourceDefinitionHashes: breedingFossilRollSourceDefinitionHashes({
        command: input.command,
        sourceAuthority: input.source,
        reanimationAuthority: input.reanimation,
        campaignOptionSnapshot: input.optionSnapshot,
        offers: input.offers,
        speciesId: input.speciesId,
      }),
      generatedAtCampaignMinute: input.campaignMinute,
    })
    repository.insert({ command: input.command, roll })
  })
}
const offersFromRepository = (get: (offerId: string) => BreedingOptionOfferRecordV1 | null, operationId: string): readonly BreedingOptionOfferRecordV1[] => Object.freeze(FOSSIL_OFFER_SLOTS.map(slot => get(breedingFossilOfferId(operationId, slot))).filter((value): value is BreedingOptionOfferRecordV1 => value !== null).sort((left, right) => compare(`${left.choiceKind}\0${left.offerId}`, `${right.choiceKind}\0${right.offerId}`)))
const sheetEvents = (sheet: PersistedSheet, operationId: string, timestamp: number) => {
  const update = normalizeAuthoritativeSheetDocumentUpdate({ kind: 'trainer', slug: sheet.slug, sheet: sheet.sheet }, 'fossil source Trainer sheet')
  return (['specific','global'] as const).map(destination => ({
    ...sheetDocumentUpdatedRealtimeAppendInput({
      update,
      destination,
      dedupeKey: `breeding:fossil-source:${operationId}:trainer:${sheet.slug}:${sheet.revision}:${destination}`,
    }),
    timestamp,
  }))
}
const resultFromRecord = (input: {
  readonly database: RotomDatabase
  readonly execution: BreedingTransactionExecutionDecision
  readonly command: Extract<BreedingOperationCommandV1, { readonly commandKind: 'create-source-egg' }>
  readonly audience: 'gm' | 'owner'
}): CreateBreedingFossilEggResultV1 => {
  const accepted = input.execution.record.status === 'accepted' && input.execution.record.result?.ok === true
  if (!accepted) return Object.freeze({ execution: input.execution, egg: null, sourceTrainerSheet: null, projection: null })
  const egg = createSqlitePokemonEggRepository(input.database).get(input.command.payload.eggId)
  const trainer = createSqliteSheetRepository(input.database).getByRef('trainer', input.command.payload.ownerTrainerSlug)
  const eggRevision = input.execution.record.result!.aggregateRefs.find(entry => entry.kind === 'pokemon-egg' && entry.id === input.command.payload.eggId)?.revision
  const trainerRevision = input.execution.record.result!.aggregateRefs.find(entry => entry.kind === 'trainer-sheet' && entry.id === input.command.payload.ownerTrainerSlug)?.revision
  if (eggRevision !== 0 || trainerRevision === undefined) return fail('breeding.fossil-egg-use-case.unavailable', 'Accepted fossil operation lost its exact aggregate references.')
  if (!egg || egg.source.kind !== 'fossil' || egg.revision !== 0 || !trainer || trainer.revision !== trainerRevision) {
    if (input.execution.kind === 'exact-retry') return Object.freeze({ execution: input.execution, egg: null, sourceTrainerSheet: null, projection: null })
    return fail('breeding.fossil-egg-use-case.unavailable', 'Fresh fossil settlement lost its exact Egg or source-consumption Trainer state.')
  }
  return Object.freeze({ execution: input.execution, egg, sourceTrainerSheet: trainer, projection: projectBreedingFossilEggCreationV1({ egg, audience: input.audience }) })
}
const reasonFor = (error: BreedingFossilEggAuthorityError): 'breeding.operation.stale-revision' | 'breeding.operation.unavailable' | 'breeding.operation.unauthorized' => error.code.includes('stale')
  ? 'breeding.operation.stale-revision' : error.code.includes('unavailable') ? 'breeding.operation.unavailable' : 'breeding.operation.unauthorized'

export const createBreedingFossilEgg = (
  inputValue: CreateBreedingFossilEggInputV1,
  options: CreateBreedingFossilEggOptions,
): CreateBreedingFossilEggResultV1 => {
  if (sha256(SECURITY_POLICY.definition) !== SECURITY_POLICY.definitionSha256) return fail('breeding.fossil-egg-use-case.unavailable', 'Breeding security policy drifted from its reviewed definition hash.')
  const input = strict(inputValue, ['command','readSet','authorizationReceipt','actorAuthority','sourceAuthority','reanimationAuthority','featureProviderHandoff','campaignOptionSnapshot','audience'], 'createBreedingFossilEggInput')
  if (input.audience !== 'gm' && input.audience !== 'owner') return fail('breeding.fossil-egg-use-case.invalid-request', 'Fossil Egg projection audience must be GM or owner.')
  const audience = input.audience
  const commandValue = parseBreedingOperationCommandV1(input.command)
  if (commandValue.commandKind !== 'create-source-egg' || commandValue.payload.source.kind !== 'fossil') return fail('breeding.fossil-egg-use-case.wrong-command', 'Fossil Egg creation accepts fossil create-source-egg only.')
  const command = commandValue
  const readSet = validateBreedingOperationReadSetCompleteness(command, input.readSet)
  const receipt = parseAuthoritativeBreedingAuthorizationReceiptV1(input.authorizationReceipt)
  const actor = parseAuthoritativeBreedingActorAuthorityV1(input.actorAuthority)
  const submittedSource = parseAuthoritativeBreedingFossilSourceAuthorityV1(input.sourceAuthority)
  const submittedReanimation = parseAuthoritativeBreedingFossilReanimationAuthorityV1(input.reanimationAuthority)
  const submittedOptions = parseBreedingCampaignOptionSnapshotV1(input.campaignOptionSnapshot)
  const submittedFeature = parseAuthoritativeBreedingFeatureProviderHandoffV1(input.featureProviderHandoff)
  integer(options.offerLifetimeCampaignMinutes, 'offerLifetimeCampaignMinutes')
  integer(options.realtimeTimestamp, 'realtimeTimestamp')
  integer(options.sheetUpdatedAt, 'sheetUpdatedAt')
  if (options.offerLifetimeCampaignMinutes < 1 || options.offerLifetimeCampaignMinutes > 525_600) return fail('breeding.fossil-egg-use-case.invalid-request', 'Fossil offer lifetime must be 1 through 525600 campaign minutes.')
  if (actor.commandActorProfileId !== command.actor.profileId || actor.selectedTrainerSlug !== command.actor.selectedTrainerSlug
    || actor.evaluatedAtCampaignMinute !== readSet.capturedAtCampaignMinute) return fail('breeding.fossil-egg-use-case.invalid-authority', 'Fossil actor authority must bind the exact command actor and read-set campaign checkpoint.')
  verifyGm(actor, options)
  const { database, coordinator } = coordinatorFor(options)
  const operations = createSqliteBreedingOperationRepository(database)
  const existing = operations.get(command.operationId)
  if (existing && existing.status !== 'pending') {
    assertStoredCommand(existing, command)
    if (!exactEvidence(database, command.operationId, readSet, receipt)
      || receipt.actorAuthorityDefinitionSha256 !== actor.definitionSha256
      || !receipt.evidenceDefinitionHashes.includes(submittedSource.definitionSha256)
      || !receipt.evidenceDefinitionHashes.includes(submittedReanimation.definitionSha256)
      || !receipt.evidenceDefinitionHashes.includes(submittedFeature.definitionSha256)
      || !receipt.evidenceDefinitionHashes.includes(submittedOptions.definitionSha256)
      || !receipt.evidenceDefinitionHashes.includes(BREEDING_FOSSIL_EGG_POLICY_DEFINITION_SHA256)) return fail('breeding.fossil-egg-use-case.invalid-authority', 'Terminal fossil retry is missing or disagrees with immutable operation and fossil authority evidence.')
    return resultFromRecord({ database, execution: exactExecution(existing), command, audience })
  }
  const clock = createSqliteCampaignClockRepository(database).get()
  const storedTrainer = createSqliteSheetRepository(database).get('trainer', command.payload.ownerTrainerSlug)
  if (!storedTrainer || clock.campaignMinute !== readSet.capturedAtCampaignMinute || actor.evaluatedAtCampaignMinute !== clock.campaignMinute) return fail('breeding.fossil-egg-use-case.stale-authority', 'Fossil source Trainer and actor must exist at the exact current campaign checkpoint.')
  const trainer = Object.freeze({ slug: storedTrainer.slug, revision: storedTrainer.revision, document: storedTrainer.document })
  const currentAuthorities = currentSourceAuthorities({ command, trainer, source: submittedSource, reanimation: submittedReanimation, campaignMinute: clock.campaignMinute, options })
  const feature = currentFeatureHandoff({ trainer, actor, campaignMinute: clock.campaignMinute, options })
  if (!same(feature, submittedFeature)) return fail('breeding.fossil-egg-use-case.stale-authority', 'Submitted fossil Feature handoff must equal current unsuppressed server-rebuilt Feature authority.')
  const optionSnapshot = parseBreedingCampaignOptionSnapshotV1(invoke('Current Breeding campaign options', options.resolveCurrentCampaignOptionSnapshot))
  if (!same(optionSnapshot, submittedOptions)) return fail('breeding.fossil-egg-use-case.stale-authority', 'Submitted fossil campaign options must exactly equal current code-owned campaign authority.')
  const currentReferences = parseAuthoritativeBreedingReferenceVersionSnapshotV1(invoke('Current Breeding reference versions', options.resolveCurrentReferenceVersions))
  if (!same(currentReferences, readSet.referenceVersions) || currentReferences.campaignOptionSnapshotDefinitionSha256 !== optionSnapshot.definitionSha256) return fail('breeding.fossil-egg-use-case.stale-authority', 'Fossil read set must bind the exact current app-owned reference and campaign-option snapshots.')
  const choices = invoke('Current bounded fossil option resolution', () => options.resolveCurrentOfferChoices({ command, sourceAuthority: currentAuthorities.source, reanimationAuthority: currentAuthorities.reanimation, featureProviderHandoff: feature, campaignOptionSnapshot: optionSnapshot, trainerSheet: trainer }), 'breeding.fossil-egg-use-case.unavailable')
  const offers = createBreedingFossilEggOptionOffersV1({
    command,
    sourceAuthority: currentAuthorities.source,
    trainerSheetRevision: trainer.revision,
    campaignOptionSnapshot: optionSnapshot,
    choices,
    issuedAtCampaignMinute: clock.campaignMinute,
    expiresAtCampaignMinute: clock.campaignMinute + options.offerLifetimeCampaignMinutes,
  })
  const speciesId = selectedSpeciesId(command, offers)
  expectedDependencies({ readSet, source: currentAuthorities.source, reanimation: currentAuthorities.reanimation, feature, options: optionSnapshot, speciesId })
  if (!currentReadSetMatches({ readSet, command, clock, trainer, offers, optionSnapshotDefinitionSha256: optionSnapshot.definitionSha256 })) return fail('breeding.fossil-egg-use-case.stale-authority', 'Fossil read-set resources must exactly match the current clock, source Trainer, future Egg, and generated offer set.')
  const rebuiltReceipt = expectedReceipt({ command, readSet, actor, source: currentAuthorities.source, reanimation: currentAuthorities.reanimation, feature, optionSnapshotDefinitionSha256: optionSnapshot.definitionSha256, offers })
  if (!same(receipt, rebuiltReceipt)) return fail('breeding.fossil-egg-use-case.invalid-authority', 'Fossil authorization receipt must equal current server-rebuilt GM, source, provider, option, and offer authority.')
  const reservation = database.withTransaction(() => operations.reserve(command, readSet.capturedAtCampaignMinute))
  if (reservation.kind === 'exact-retry') {
    if (!exactEvidence(database, command.operationId, readSet, receipt)) return fail('breeding.fossil-egg-use-case.invalid-authority', 'Concurrent terminal fossil retry disagrees with immutable authority evidence.')
    return resultFromRecord({ database, execution: exactExecution(reservation.record), command, audience })
  }
  const shouldResume = reservation.kind === 'reserved' || options.resumePending === true
  if (reservation.kind === 'reserved' || options.resumePending === true) {
    database.withTransaction(() => {
      const offerRepository = createSqliteBreedingOptionOfferRepository(database)
      for (const offer of offers) offerRepository.insert(offer)
      createSqliteBreedingOperationEvidenceRepository(database).insert({ command, readSet, authorizationReceipt: receipt })
    })
    prepareDurationRoll({ database, command, source: currentAuthorities.source, reanimation: currentAuthorities.reanimation, optionSnapshot, offers, speciesId, campaignMinute: clock.campaignMinute, options })
  }
  const execution = coordinator.execute({
    command,
    createdAtCampaignMinute: readSet.capturedAtCampaignMinute,
    settledAtCampaignMinute: readSet.capturedAtCampaignMinute,
    ...(shouldResume ? { resumePending: true } : {}),
    execute: (canonicalValue, _operation, context) => {
      if (canonicalValue.commandKind !== 'create-source-egg' || canonicalValue.payload.source.kind !== 'fossil') throw new Error('Fossil coordinator received another command kind.')
      const canonical = canonicalValue
      const hash = createBreedingOperationCommandHash(canonical)
      const currentClock = context.repositories.campaignClock.get()
      const currentTrainer = context.repositories.sheets.get('trainer', canonical.payload.ownerTrainerSlug)
      const existingEgg = context.repositories.eggs.get(canonical.payload.eggId)
      const evidence = context.repositories.operationEvidence.get(canonical.operationId)
      const currentOffers = offersFromRepository(id => context.repositories.optionOffers.get(id), canonical.operationId)
      const rolls = context.repositories.rolls.listByOperation(canonical.operationId)
      const expectsDurationRoll = optionSnapshot.values['breeding.hatch-duration-variation'] === 'server-random-half-to-double'
      const exactDurationRoll = expectsDurationRoll && rolls.length === 1 && rolls[0]?.purpose === 'hatch-duration-percentage'
        ? rolls[0]
        : null
      const staleRefs = currentTrainer ? [{ kind: 'trainer-sheet' as const, id: currentTrainer.slug, revision: currentTrainer.revision }] : []
      if (!currentTrainer || existingEgg || currentClock.revision !== clock.revision || currentClock.campaignMinute !== clock.campaignMinute
        || clockHash(currentClock) !== clockHash(clock) || !same(currentOffers, offers)
        || (expectsDurationRoll ? exactDurationRoll === null : rolls.length !== 0)
        || !evidence || !same(evidence.readSet, readSet) || !same(evidence.authorizationReceipt, receipt)) {
        return createBreedingOperationRejectedV1({ operationId: canonical.operationId, commandHash: hash, commandKind: canonical.commandKind, reasonId: 'breeding.operation.stale-revision', currentAggregateRefs: staleRefs, conflictingScopes: canonical.scopes })
      }
      let rebuilt, rebuiltFeature, planned
      try {
        rebuilt = currentSourceAuthorities({ command: canonical, trainer: { slug: currentTrainer.slug, revision: currentTrainer.revision, document: currentTrainer.document }, source: currentAuthorities.source, reanimation: currentAuthorities.reanimation, campaignMinute: currentClock.campaignMinute, options })
        rebuiltFeature = currentFeatureHandoff({ trainer: { slug: currentTrainer.slug, revision: currentTrainer.revision, document: currentTrainer.document }, actor, campaignMinute: currentClock.campaignMinute, options })
        if (!same(rebuiltFeature, feature)) throw new BreedingFossilEggAuthorityError('breeding.fossil-egg.stale-authority', 'Feature authority changed before fossil settlement.')
        planned = planBreedingFossilEggV1({
          command: canonical,
          sourceAuthority: rebuilt.source,
          reanimationAuthority: rebuilt.reanimation,
          featureProviderHandoff: rebuiltFeature,
          campaignOptionSnapshot: optionSnapshot,
          offers: currentOffers,
          campaignClock: currentClock,
          hatchDurationRoll: exactDurationRoll,
        })
      }
      catch (error) {
        if (error instanceof BreedingFossilEggAuthorityError) return createBreedingOperationRejectedV1({ operationId: canonical.operationId, commandHash: hash, commandKind: canonical.commandKind, reasonId: reasonFor(error), currentAggregateRefs: staleRefs, conflictingScopes: canonical.scopes })
        throw error
      }
      for (const successor of planned.consumedOffers) {
        const replaced = context.repositories.optionOffers.replace({ expectedRevision: 0, record: successor })
        if (replaced.kind !== 'applied') throw new Error('Fossil option offer changed inside the creation transaction.')
      }
      const nextTrainer = consumeBreedingFossilSourceInventoryV1({
        trainerSheet: { slug: currentTrainer.slug, revision: currentTrainer.revision, document: currentTrainer.document },
        sourceAuthority: rebuilt.source,
        operationId: canonical.operationId,
        updatedAt: options.sheetUpdatedAt,
      })
      if (context.repositories.sheets.applyLivePlayUpdate({ kind: 'trainer', slug: currentTrainer.slug, expectedRevision: currentTrainer.revision, nextSheet: nextTrainer as Record<string, unknown> }) !== 'applied') throw new Error('Fossil source Trainer changed inside the creation transaction.')
      const settledTrainer = context.repositories.sheets.getByRef('trainer', currentTrainer.slug)
      if (!settledTrainer || settledTrainer.revision !== currentTrainer.revision + 1) throw new Error('Consumed fossil source Trainer revision was not readable.')
      context.repositories.eggs.insert(planned.egg)
      context.appendRealtime(sheetEvents(settledTrainer, canonical.operationId, options.realtimeTimestamp))
      context.appendRealtime(breedingRealtimeRefreshAppendInputs({
        aggregateKind: 'pokemon-egg', aggregateId: planned.egg.eggId, revision: planned.egg.revision,
        operationKind: canonical.commandKind,
        audienceTargets: [
          { audience: 'diagnostic', trainerSheetSlug: null },
          { audience: 'gm', trainerSheetSlug: null },
          { audience: 'owner', trainerSheetSlug: planned.egg.ownerTrainerSlug },
          { audience: 'public', trainerSheetSlug: null },
        ],
        campaignProjectionKey: options.campaignProjectionKey,
        timestamp: options.realtimeTimestamp,
      }))
      return createBreedingOperationAcceptedV1({
        operationId: canonical.operationId,
        commandHash: hash,
        commandKind: canonical.commandKind,
        outcomeKind: 'source-egg-created',
        aggregateRefs: [
          { kind: 'pokemon-egg', id: planned.egg.eggId, revision: planned.egg.revision },
          { kind: 'trainer-sheet', id: settledTrainer.slug, revision: settledTrainer.revision },
        ],
        changedScopes: canonical.scopes,
        committedAtCampaignMinute: currentClock.campaignMinute,
      })
    },
    ...(options.beforeSettle ? { beforeSettle: options.beforeSettle } : {}),
  })
  if (execution.kind !== 'pending' && !exactEvidence(database, command.operationId, readSet, receipt)) return fail('breeding.fossil-egg-use-case.invalid-authority', 'Terminal fossil operation lost immutable read-set and authorization evidence.')
  return resultFromRecord({ database, execution, command, audience })
}

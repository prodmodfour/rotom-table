import { createHash } from 'node:crypto'
import securityPolicyJson from '../../data/breeding-automation/security-policy.json'
import { stableJsonStringify } from '#shared/automation/stableJson'
import type { BreedingActorAuthorityV1, BreedingAuthorizationReceiptV1 } from '#shared/breeding/authorization'
import type { BreedingOptionOfferRecordV1 } from '#shared/breeding/ledgers'
import { parseBreedingOperationCommandV1, type BreedingOperationCommandV1, type BreedingOperationResultV1 } from '#shared/breeding/operations'
import type { BreedingOperationReadSetV1, BreedingReadResourceV1 } from '#shared/breeding/readSets'
import type { BreedingInheritanceLearningRecordV1, PokemonBreedingOriginV1 } from '#shared/breeding/lineage'
import type { CharacterSheet } from '~/types/characterSheet'
import {
  authorizeBreedingInheritanceLearningV1,
  parseAuthoritativeBreedingActorAuthorityV1,
  parseAuthoritativeBreedingAuthorizationReceiptV1,
  parseAuthoritativeBreedingTrainerControlEvidenceV1,
} from '../domain/breeding/authorization'
import {
  breedingInheritanceLearningOriginStateSha256,
  breedingInheritanceLearningSheetDefinitionSha256,
  hydratePokemonBreedingOriginLearningV1,
  planBreedingInheritanceLearningV1,
  type BreedingInheritanceLearningPlanV1,
} from '../domain/breeding/inheritanceLearning'
import {
  createBreedingOperationAcceptedV1,
  createBreedingOperationCommandHash,
  createBreedingOperationRejectedV1,
} from '../domain/breeding/operations'
import {
  parseAuthoritativeBreedingReferenceVersionSnapshotV1,
  validateBreedingOperationReadSetCompleteness,
} from '../domain/breeding/readSets'
import {
  normalizeAuthoritativeSheetDocumentUpdate,
  sheetDocumentUpdatedRealtimeAppendInput,
} from '../realtime/sheetDocumentRealtime'
import { createSqliteBreedingLineageRepository } from '../storage/breedingLineageRepository'
import { createSqliteBreedingOperationEvidenceRepository } from '../storage/breedingOperationEvidenceRepository'
import { createSqliteBreedingOperationRepository, type BreedingOperationLedgerRecord } from '../storage/breedingOperationRepository'
import { createSqliteBreedingOptionOfferRepository } from '../storage/breedingOptionOfferRepository'
import { createSqliteCampaignClockRepository } from '../storage/campaignClockRepository'
import { createSqlitePokemonEggRepository } from '../storage/pokemonEggRepository'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import { createSqliteSheetRepository, type PersistedSheet, type StoredSheetDocument } from '../storage/sheetRepository'
import { redactSheetRecordForPlayer } from '../utils/sheetPrivacy'
import {
  createBreedingTransactionCoordinator,
  type BreedingTransactionCoordinator,
  type BreedingTransactionExecutionDecision,
} from './executeBreedingTransaction'

export interface RecordPokemonInheritanceLearningResultV1 {
  readonly execution: BreedingTransactionExecutionDecision | null
  readonly childSheet: PersistedSheet | null
  readonly records: readonly BreedingInheritanceLearningRecordV1[]
  readonly plan: BreedingInheritanceLearningPlanV1 | null
}
export interface RecordPokemonInheritanceLearningOptions {
  readonly database?: RotomDatabase
  readonly coordinator?: BreedingTransactionCoordinator
  readonly realtimeTimestamp: number
  readonly sheetUpdatedAt: number
  readonly resolveCurrentReferenceVersions: () => unknown
  readonly validateCurrentGmAuthority?: (actor: BreedingActorAuthorityV1) => boolean
  readonly resumePending?: boolean
  readonly beforeSettle?: (result: BreedingOperationResultV1) => void
}
export type RecordPokemonInheritanceLearningErrorCode =
  | 'breeding.inheritance-learning-use-case.invalid-request'
  | 'breeding.inheritance-learning-use-case.invalid-authority'
  | 'breeding.inheritance-learning-use-case.repository-mismatch'
  | 'breeding.inheritance-learning-use-case.stale-authority'
  | 'breeding.inheritance-learning-use-case.unavailable'
  | 'breeding.inheritance-learning-use-case.wrong-command'
export class RecordPokemonInheritanceLearningError extends Error {
  readonly code: RecordPokemonInheritanceLearningErrorCode
  constructor(code: RecordPokemonInheritanceLearningErrorCode, message: string) {
    super(message)
    this.name = 'RecordPokemonInheritanceLearningError'
    this.code = code
  }
}
const fail = (code: RecordPokemonInheritanceLearningErrorCode, message: string): never => { throw new RecordPokemonInheritanceLearningError(code, message) }
const sha256 = (value: unknown): string => createHash('sha256').update(stableJsonStringify(value)).digest('hex')
const same = (left: unknown, right: unknown): boolean => stableJsonStringify(left) === stableJsonStringify(right)
const promiseLike = (value: unknown): value is PromiseLike<unknown> => (typeof value === 'object' || typeof value === 'function') && value !== null && typeof (value as { readonly then?: unknown }).then === 'function'
const exact = (value: unknown, fields: readonly string[], path: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    || Object.getOwnPropertySymbols(value).length > 0) return fail('breeding.inheritance-learning-use-case.invalid-request', `${path} must be one plain exact object.`)
  const row = value as Record<string, unknown>; const allowed = new Set(fields)
  if (fields.some(field => !Object.hasOwn(row, field)) || Object.getOwnPropertyNames(row).some(field => !allowed.has(field))) return fail('breeding.inheritance-learning-use-case.invalid-request', `${path} must contain exactly the declared fields.`)
  for (const field of fields) { const descriptor = Object.getOwnPropertyDescriptor(row, field); if (!descriptor?.enumerable || !('value' in descriptor)) return fail('breeding.inheritance-learning-use-case.invalid-request', `${path}.${field} must be an enumerable data field.`) }
  return row
}
const array = (value: unknown, path: string, maximum: number): readonly unknown[] => {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum
    || Object.getOwnPropertySymbols(value).length > 0 || Object.getOwnPropertyNames(value).length !== value.length + 1) return fail('breeding.inheritance-learning-use-case.invalid-request', `${path} must be one dense plain array of at most ${maximum} entries.`)
  return value
}
const integer = (value: unknown, path: string): number => Number.isSafeInteger(value) && Number(value) >= 0
  ? Number(value) : fail('breeding.inheritance-learning-use-case.invalid-request', `${path} must be a nonnegative safe integer.`)
const resource = (readSet: BreedingOperationReadSetV1, kind: BreedingReadResourceV1['resourceKind'], id: string) => readSet.resources.find(value => value.resourceKind === kind && value.resourceId === id) ?? null
const currentReferences = (value: unknown, options: RecordPokemonInheritanceLearningOptions) => {
  if (typeof options.resolveCurrentReferenceVersions !== 'function') return fail('breeding.inheritance-learning-use-case.invalid-request', 'A synchronous current-reference resolver is required.')
  let resolved: unknown
  try { resolved = options.resolveCurrentReferenceVersions() }
  catch { return fail('breeding.inheritance-learning-use-case.stale-authority', 'Current reference resolution failed closed.') }
  if (promiseLike(resolved)) return fail('breeding.inheritance-learning-use-case.stale-authority', 'Current reference resolution must be synchronous.')
  const supplied = parseAuthoritativeBreedingReferenceVersionSnapshotV1(value)
  const current = parseAuthoritativeBreedingReferenceVersionSnapshotV1(resolved)
  if (!same(supplied, current)) return fail('breeding.inheritance-learning-use-case.stale-authority', 'Supplied references must equal the current app-owned snapshot.')
  return supplied
}
const verifyGm = (actor: BreedingActorAuthorityV1, options: RecordPokemonInheritanceLearningOptions): void => {
  if (actor.role !== 'gm' || typeof options.validateCurrentGmAuthority !== 'function') return fail('breeding.inheritance-learning-use-case.invalid-authority', 'Current authenticated GM authority is required.')
  let result: unknown
  try { result = options.validateCurrentGmAuthority(actor) }
  catch { return fail('breeding.inheritance-learning-use-case.invalid-authority', 'Current GM authority verification failed closed.') }
  if (promiseLike(result) || result !== true) return fail('breeding.inheritance-learning-use-case.invalid-authority', 'GM authority verifier must synchronously return exact true.')
}
const coordinatorFor = (options: RecordPokemonInheritanceLearningOptions) => {
  const database = options.database ?? options.coordinator?.database ?? getRotomDatabase()
  if (options.coordinator && options.coordinator.database !== database) return fail('breeding.inheritance-learning-use-case.repository-mismatch', 'Coordinator and use case must share one database connection.')
  return Object.freeze({ database, coordinator: options.coordinator ?? createBreedingTransactionCoordinator({ database }) })
}
const exactEvidence = (database: RotomDatabase, operationId: string, readSet: BreedingOperationReadSetV1, receipt: BreedingAuthorizationReceiptV1): boolean => {
  const evidence = createSqliteBreedingOperationEvidenceRepository(database).get(operationId)
  return !!evidence && same(evidence.readSet, readSet) && same(evidence.authorizationReceipt, receipt)
}
const exactRetryExecution = (record: BreedingOperationLedgerRecord): BreedingTransactionExecutionDecision => Object.freeze({ kind: 'exact-retry', record, committedRealtimeEvents: Object.freeze([]), publicationFailureCount: 0 })
const assertStoredCommand = (record: BreedingOperationLedgerRecord, command: BreedingOperationCommandV1): void => {
  if (!same(record.command, command) || record.commandHash !== createBreedingOperationCommandHash(command)) return fail('breeding.inheritance-learning-use-case.invalid-request', 'Operation identity is bound to another immutable command.')
}
const hydrateOrigin = (database: RotomDatabase, originId: string): { readonly stored: PokemonBreedingOriginV1, readonly records: readonly BreedingInheritanceLearningRecordV1[], readonly hydrated: PokemonBreedingOriginV1 } => {
  const repository = createSqliteBreedingLineageRepository(database)
  const stored = repository.getOrigin(originId) ?? fail('breeding.inheritance-learning-use-case.unavailable', 'Child breeding origin is unavailable.')
  const records = repository.listLearningByOrigin(originId)
  const hydrated = hydratePokemonBreedingOriginLearningV1({ origin: stored, learningRecords: records })
  return Object.freeze({ stored, records, hydrated })
}
const ownerTrainer = (sheets: readonly StoredSheetDocument<Record<string, unknown>>[], childSlug: string): StoredSheetDocument<Record<string, unknown>> => {
  const owners = sheets.filter(sheet => {
    const currentTeam = Array.isArray(sheet.document.currentTeam) ? sheet.document.currentTeam : []
    const boxedPokemon = Array.isArray(sheet.document.boxedPokemon) ? sheet.document.boxedPokemon : []
    return [...currentTeam, ...boxedPokemon].filter(value => value === childSlug).length === 1
  })
  if (owners.length !== 1) return fail('breeding.inheritance-learning-use-case.unavailable', 'The child must belong exactly once to one current Trainer roster.')
  return owners[0]!
}
const ownerFact = (trainer: StoredSheetDocument<Record<string, unknown>>) => ({
  slug: trainer.slug,
  revision: trainer.revision,
  definitionSha256: sha256(trainer.document),
  currentTeam: Array.isArray(trainer.document.currentTeam) ? trainer.document.currentTeam : [],
  boxedPokemon: Array.isArray(trainer.document.boxedPokemon) ? trainer.document.boxedPokemon : [],
})
const currentSelectedOffers = (database: RotomDatabase, childSheetSlug: string, optionIds: readonly string[]): readonly BreedingOptionOfferRecordV1[] => {
  const offers = createSqliteBreedingOptionOfferRepository(database).findByTargetOptionIds({
    targetKind: 'pokemon-sheet', targetId: childSheetSlug, optionIds,
  })
  if (optionIds.some(optionId => offers.filter(offer => offer.options.some(option => option.optionId === optionId)).length !== 1)
    || new Set(offers.map(value => value.offerId)).size !== offers.length) {
    return fail('breeding.inheritance-learning-use-case.stale-authority', 'Every selected inheritance option must resolve exactly one persisted child offer.')
  }
  return Object.freeze([...offers].sort((left, right) => left.offerId < right.offerId ? -1 : left.offerId > right.offerId ? 1 : 0))
}
const exactReceipt = (submitted: unknown, expected: BreedingAuthorizationReceiptV1): BreedingAuthorizationReceiptV1 => {
  const parsed = parseAuthoritativeBreedingAuthorizationReceiptV1(submitted)
  if (!same(parsed, expected) || !parsed.authorized || parsed.reasonId !== 'breeding.authorization.authorized') return fail('breeding.inheritance-learning-use-case.invalid-authority', 'Authorization receipt must equal current server-rebuilt learning authority.')
  return parsed
}
const sheetEvents = (sheet: PersistedSheet, operationId: string, timestamp: number) => {
  const update = normalizeAuthoritativeSheetDocumentUpdate({ kind: sheet.kind, slug: sheet.slug, sheet: sheet.sheet }, 'inheritance learning sheet')
  return (['specific', 'global'] as const).map(destination => ({
    ...sheetDocumentUpdatedRealtimeAppendInput({ update, destination, dedupeKey: `breeding:inheritance:${operationId}:${sheet.slug}:${sheet.revision}:${destination}` }),
    timestamp,
  }))
}
const resultFromRecord = (input: {
  readonly database: RotomDatabase
  readonly execution: BreedingTransactionExecutionDecision
  readonly command: Extract<BreedingOperationCommandV1, { readonly commandKind: 'record-inheritance-learning' }>
  readonly plan: BreedingInheritanceLearningPlanV1 | null
  readonly audience: 'owner' | 'gm'
}): RecordPokemonInheritanceLearningResultV1 => {
  const projectedExecution = input.audience === 'gm' ? input.execution : null
  if (input.execution.record.status !== 'accepted' || !input.execution.record.result?.ok) return Object.freeze({ execution: projectedExecution, childSheet: null, records: Object.freeze([]), plan: input.audience === 'gm' ? input.plan : null })
  const child = createSqliteSheetRepository(input.database).getByRef('pokemon', input.command.payload.childSheetSlug)
  const records = createSqliteBreedingLineageRepository(input.database).listLearningByOrigin(input.command.payload.originId)
    .filter(record => record.operationId === input.command.operationId)
  const aggregate = input.execution.record.result.aggregateRefs.find(value => value.kind === 'pokemon-sheet' && value.id === input.command.payload.childSheetSlug)
  if (!child || aggregate === undefined || child.revision < aggregate.revision
    || records.length !== input.command.payload.checkpointLevels.length) return fail('breeding.inheritance-learning-use-case.unavailable', 'Accepted learning settlement lost its child revision floor, checkpoint records, or operation link.')
  const projectedChild = input.audience === 'gm' ? child : Object.freeze({
    ...child,
    sheet: redactSheetRecordForPlayer('pokemon', child.sheet),
  })
  return Object.freeze({
    execution: projectedExecution,
    childSheet: projectedChild,
    records: input.audience === 'gm' ? Object.freeze(records) : Object.freeze([]),
    plan: input.audience === 'gm' ? input.plan : null,
  })
}

export const recordPokemonInheritanceLearning = (inputValue: unknown, options: RecordPokemonInheritanceLearningOptions): RecordPokemonInheritanceLearningResultV1 => {
  const input = exact(inputValue, ['command', 'readSet', 'authorizationReceipt', 'actorAuthority', 'trainerControl', 'gmOverrides', 'referenceVersions', 'audience'], 'recordInheritanceLearningInput')
  const commandValue = parseBreedingOperationCommandV1(input.command)
  if (commandValue.commandKind !== 'record-inheritance-learning') return fail('breeding.inheritance-learning-use-case.wrong-command', 'This use case accepts record-inheritance-learning only.')
  const command = commandValue
  const actor = parseAuthoritativeBreedingActorAuthorityV1(input.actorAuthority)
  const audience = input.audience === 'owner' || input.audience === 'gm'
    ? input.audience
    : fail('breeding.inheritance-learning-use-case.invalid-request', 'audience must be owner or gm.')
  if ((actor.role === 'player' && audience !== 'owner') || (actor.role === 'gm' && audience !== 'gm')) return fail('breeding.inheritance-learning-use-case.invalid-authority', 'Inheritance response audience must match current actor authority.')
  const trainerControl = input.trainerControl === null ? null : parseAuthoritativeBreedingTrainerControlEvidenceV1(input.trainerControl)
  const gmOverrides = array(input.gmOverrides, 'recordInheritanceLearningInput.gmOverrides', 8)
  const references = currentReferences(input.referenceVersions, options)
  const readSet = validateBreedingOperationReadSetCompleteness(command, input.readSet)
  if (!same(readSet.referenceVersions, references)) return fail('breeding.inheritance-learning-use-case.stale-authority', 'Read set must bind the current reference snapshot.')
  integer(options.realtimeTimestamp, 'realtimeTimestamp'); integer(options.sheetUpdatedAt, 'sheetUpdatedAt')
  const submittedReceipt = parseAuthoritativeBreedingAuthorizationReceiptV1(input.authorizationReceipt)
  const { database, coordinator } = coordinatorFor(options)
  const operations = createSqliteBreedingOperationRepository(database)
  const existing = operations.get(command.operationId)
  if (existing && existing.status !== 'pending') {
    assertStoredCommand(existing, command)
    if (!exactEvidence(database, command.operationId, readSet, submittedReceipt)) return fail('breeding.inheritance-learning-use-case.invalid-authority', 'Terminal learning operation lost immutable authority evidence.')
    if (actor.role === 'gm') verifyGm(actor, options)
    else {
      if (options.validateCurrentGmAuthority !== undefined || !trainerControl || actor.authenticatedProfileId !== trainerControl.profileId) return fail('breeding.inheritance-learning-use-case.invalid-authority', 'Player exact retry requires its original authenticated owner evidence.')
      const retryChild = createSqliteSheetRepository<Record<string, unknown>>(database).get('pokemon', command.payload.childSheetSlug)
        ?? fail('breeding.inheritance-learning-use-case.unavailable', 'Accepted learning child is unavailable.')
      const retryTrainer = ownerTrainer(createSqliteSheetRepository<Record<string, unknown>>(database).list('trainer'), retryChild.slug)
      if (retryTrainer.slug !== trainerControl.trainerSheetSlug
        || retryTrainer.revision < trainerControl.trainerSheetRevision
        || actor.selectedTrainerSlug !== retryTrainer.slug) return fail('breeding.inheritance-learning-use-case.invalid-authority', 'Player exact retry requires current ownership by its authenticated Trainer.')
    }
    return resultFromRecord({ database, execution: exactRetryExecution(existing), command, plan: null, audience })
  }
  const clock = createSqliteCampaignClockRepository(database).get()
  const child = createSqliteSheetRepository<Record<string, unknown>>(database).get('pokemon', command.payload.childSheetSlug)
    ?? fail('breeding.inheritance-learning-use-case.unavailable', 'Child Pokémon sheet is unavailable.')
  const egg = createSqlitePokemonEggRepository(database).get(command.payload.eggId)
    ?? fail('breeding.inheritance-learning-use-case.unavailable', 'Source Pokémon Egg is unavailable.')
  const lineage = hydrateOrigin(database, command.payload.originId)
  const trainer = ownerTrainer(createSqliteSheetRepository<Record<string, unknown>>(database).list('trainer'), child.slug)
  const currentOffers = command.payload.selectedOptionIds.length === 0
    ? Object.freeze([])
    : currentSelectedOffers(database, child.slug, command.payload.selectedOptionIds)
  const childHash = breedingInheritanceLearningSheetDefinitionSha256(child.document as CharacterSheet)
  const trainerFact = ownerFact(trainer)
  const clockRead = resource(readSet, 'campaign-clock', 'campaign-clock')
  const eggRead = resource(readSet, 'pokemon-egg', egg.eggId)
  const offerReadsMatch = currentOffers.every(offer => {
    const read = resource(readSet, 'breeding-offer', offer.offerId)
    return read?.existence === 'present' && read.revision === offer.revision && read.definitionSha256 === offer.definitionSha256 && read.purposes.includes('mechanics')
  })
  if (clock.campaignMinute !== readSet.capturedAtCampaignMinute || clockRead?.existence !== 'present' || clockRead.revision !== clock.revision
    || clockRead.definitionSha256 !== sha256(clock) || !clockRead.purposes.includes('campaign-time')
    || egg.status !== 'hatched' || egg.childSheetSlug !== child.slug || lineage.hydrated.eggId !== egg.eggId
    || eggRead?.existence !== 'present' || eggRead.revision !== egg.revision
    || eggRead.definitionSha256 !== sha256(egg) || !eggRead.purposes.includes('snapshot')
    || !offerReadsMatch) return fail('breeding.inheritance-learning-use-case.stale-authority', 'Campaign clock, terminal Egg, or selected-offer read authority is stale or incomplete.')
  if (actor.role === 'gm') { if (trainerControl !== null) return fail('breeding.inheritance-learning-use-case.invalid-authority', 'GM learning rejects Trainer-control evidence.'); verifyGm(actor, options) }
  else if (options.validateCurrentGmAuthority !== undefined || !trainerControl) return fail('breeding.inheritance-learning-use-case.invalid-authority', 'Player learning requires current Trainer control and rejects GM callbacks.')
  const expectedReceipt = authorizeBreedingInheritanceLearningV1({
    command, readSet, actorAuthority: actor, trainerControl, ownerTrainer: trainerFact,
    childSheet: { slug: child.slug, revision: child.revision, definitionSha256: childHash },
    origin: lineage.hydrated, gmOverrides, securityPolicyDefinitionSha256: securityPolicyJson.definitionSha256,
  })
  const receipt = exactReceipt(input.authorizationReceipt, expectedReceipt)
  const reservation = database.withTransaction(() => {
    const decision = operations.reserve(command, clock.campaignMinute)
    if (decision.kind === 'reserved' || options.resumePending === true) createSqliteBreedingOperationEvidenceRepository(database).insert({ command, readSet, authorizationReceipt: receipt })
    return decision
  })
  if (reservation.kind === 'exact-retry') return resultFromRecord({ database, execution: exactRetryExecution(reservation.record), command, plan: null, audience })
  let settledPlan: BreedingInheritanceLearningPlanV1 | null = null
  const execution = coordinator.execute({
    command,
    createdAtCampaignMinute: readSet.capturedAtCampaignMinute,
    settledAtCampaignMinute: readSet.capturedAtCampaignMinute,
    ...((reservation.kind === 'reserved' || options.resumePending === true) ? { resumePending: true } : {}),
    execute: (canonicalValue, _operation, context) => {
      if (canonicalValue.commandKind !== 'record-inheritance-learning') throw new Error('Inheritance coordinator received another command.')
      const canonical = canonicalValue
      const commandHash = createBreedingOperationCommandHash(canonical)
      const currentClock = context.repositories.campaignClock.get()
      const currentChild = context.repositories.sheets.get('pokemon', canonical.payload.childSheetSlug)
      const currentEgg = context.repositories.eggs.get(canonical.payload.eggId)
      const currentStoredOrigin = context.repositories.lineage.getOrigin(canonical.payload.originId)
      const currentRecords = context.repositories.lineage.listLearningByOrigin(canonical.payload.originId)
      const currentTrainers = context.repositories.sheets.list('trainer') as readonly StoredSheetDocument<Record<string, unknown>>[]
      const currentTrainer = currentChild ? (() => { try { return ownerTrainer(currentTrainers, currentChild.slug) } catch { return null } })() : null
      const currentSelected = context.repositories.optionOffers.findByTargetOptionIds({
        targetKind: 'pokemon-sheet', targetId: canonical.payload.childSheetSlug,
        optionIds: canonical.payload.selectedOptionIds,
      })
      const evidence = context.repositories.operationEvidence.get(canonical.operationId)
      const stale = !currentChild || !currentEgg || !currentStoredOrigin || !currentTrainer
        || canonical.payload.selectedOptionIds.some(optionId => currentSelected.filter(offer => offer.options.some(option => option.optionId === optionId)).length !== 1)
        || currentClock.revision !== clock.revision || currentClock.campaignMinute !== clock.campaignMinute || sha256(currentClock) !== sha256(clock)
        || currentEgg.revision !== egg.revision || sha256(currentEgg) !== sha256(egg)
        || currentEgg.status !== 'hatched' || currentEgg.childSheetSlug !== canonical.payload.childSheetSlug
        || currentChild.revision !== child.revision || sha256(currentChild.document) !== childHash
        || currentTrainer.revision !== trainer.revision || sha256(currentTrainer.document) !== trainerFact.definitionSha256
        || !same(currentRecords, lineage.records) || breedingInheritanceLearningOriginStateSha256(hydratePokemonBreedingOriginLearningV1({ origin: currentStoredOrigin, learningRecords: currentRecords })) !== breedingInheritanceLearningOriginStateSha256(lineage.hydrated)
        || !same(currentSelected, currentOffers) || !evidence || !same(evidence.readSet, readSet) || !same(evidence.authorizationReceipt, receipt)
      if (stale) return createBreedingOperationRejectedV1({
        operationId: canonical.operationId, commandHash, commandKind: canonical.commandKind,
        reasonId: 'breeding.operation.stale-revision',
        currentAggregateRefs: currentChild ? [{ kind: 'pokemon-sheet', id: currentChild.slug, revision: currentChild.revision }] : [],
        conflictingScopes: canonical.scopes,
      })
      const plan = planBreedingInheritanceLearningV1({
        command: canonical,
        origin: currentStoredOrigin,
        learningRecords: currentRecords,
        childSheet: { slug: currentChild.slug, revision: currentChild.revision, document: currentChild.document },
        offers: currentOffers,
        recordedAtCampaignMinute: currentClock.campaignMinute,
      })
      for (const nextOffer of plan.consumedOffers) {
        const replacement = context.repositories.optionOffers.replace({ expectedRevision: 0, record: nextOffer })
        if (replacement.kind !== 'applied') throw new Error('Inheritance offer changed during atomic settlement.')
      }
      const update = context.repositories.sheets.applyLivePlayUpdate({
        kind: 'pokemon', slug: currentChild.slug, expectedRevision: currentChild.revision,
        nextSheet: { ...plan.nextSheetDocument, slug: currentChild.slug, updatedAt: options.sheetUpdatedAt },
        sourceOperationId: canonical.operationId,
      })
      if (update !== 'applied') throw new Error('Inheritance child revision changed during atomic settlement.')
      for (const record of plan.records) context.repositories.lineage.insertLearning(record)
      const settledChild = context.repositories.sheets.getByRef('pokemon', currentChild.slug)
      if (!settledChild || settledChild.revision !== currentChild.revision + 1) throw new Error('Settled inheritance child sheet was not readable.')
      context.appendRealtime(sheetEvents(settledChild, canonical.operationId, options.realtimeTimestamp))
      settledPlan = plan
      return createBreedingOperationAcceptedV1({
        operationId: canonical.operationId, commandHash, commandKind: canonical.commandKind,
        outcomeKind: 'inheritance-recorded',
        aggregateRefs: [{ kind: 'pokemon-sheet', id: settledChild.slug, revision: settledChild.revision }],
        changedScopes: canonical.scopes,
        committedAtCampaignMinute: currentClock.campaignMinute,
      })
    },
    ...(options.beforeSettle ? { beforeSettle: options.beforeSettle } : {}),
  })
  if (execution.kind !== 'pending' && !exactEvidence(database, command.operationId, readSet, receipt)) return fail('breeding.inheritance-learning-use-case.invalid-authority', 'Terminal learning operation lost immutable evidence.')
  return resultFromRecord({ database, execution, command, plan: execution.kind === 'executed' ? settledPlan : null, audience })
}

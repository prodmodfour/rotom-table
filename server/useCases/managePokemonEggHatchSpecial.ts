import { createHash, randomInt } from 'node:crypto'
import securityPolicyJson from '../../data/breeding-automation/security-policy.json'
import { stableJsonStringify } from '#shared/automation/stableJson'
import type { BreedingActorAuthorityV1, BreedingAuthorizationReceiptV1 } from '#shared/breeding/authorization'
import { parseCampaignOperationOfferDeclarationV1 } from '#shared/campaignOperationOffers'
import type { PokemonEggDocumentV1 } from '#shared/breeding/egg'
import type { PokemonEggHatchOfferAuthorityV1 } from '#shared/breeding/hatchOffers'
import type { PokemonEggHatchSpecialProjectionV1 } from '#shared/breeding/hatchSpecial'
import type { BreedingGmAdjudicationRecordV1, BreedingOptionOfferRecordV1, BreedingRollRecordV1 } from '#shared/breeding/ledgers'
import { parseBreedingOperationCommandV1, type BreedingOperationCommandV1, type BreedingOperationResultV1 } from '#shared/breeding/operations'
import type { BreedingOperationReadSetV1, BreedingReadResourceV1 } from '#shared/breeding/readSets'
import {
  parseAuthoritativeBreedingActorAuthorityV1,
  parseAuthoritativeBreedingAuthorizationReceiptV1,
  parseAuthoritativeBreedingTrainerControlEvidenceV1,
} from '../domain/breeding/authorization'
import { parseBreedingCampaignOptionSnapshotV1, type BreedingCampaignOptionSnapshotV1 } from '../domain/breeding/campaignOptions'
import {
  authorizeBreedingBeginHatchV1,
  authorizeBreedingResolveHatchSpecialV1,
} from '../domain/breeding/hatchSpecialAuthorization'
import {
  breedingHatchSpecialRollSourceDefinitionHashesV1,
  deriveBreedingHatchSpecialAdjudicationIdV1,
  deriveBreedingHatchSpecialOfferIdV1,
  deriveBreedingHatchSpecialRollRecordIdV1,
  planPokemonEggHatchSpecialBeginV1,
  planPokemonEggHatchSpecialResolutionV1,
  projectPokemonEggHatchSpecialV1,
  PokemonEggHatchSpecialAuthorityError,
} from '../domain/breeding/hatchSpecial'
import {
  assertPokemonEggHatchOfferAuthorityExactReplayV1,
  createPokemonEggHatchOwnerTrainerFactV1,
  parseAuthoritativePokemonEggHatchOfferAuthorityV1,
} from '../domain/breeding/hatchOffers'
import { createBreedingRollRecordFromInjectedValues } from '../domain/breeding/ledgers'
import { pokemonEggLifecycleDocumentDefinitionSha256 } from '../domain/breeding/eggLifecyclePolicy'
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
import { createSqliteBreedingGmAdjudicationRepository } from '../storage/breedingGmAdjudicationRepository'
import { createSqliteBreedingOperationEvidenceRepository } from '../storage/breedingOperationEvidenceRepository'
import { createSqliteBreedingOperationRepository, type BreedingOperationLedgerRecord } from '../storage/breedingOperationRepository'
import { createSqliteBreedingOptionOfferRepository } from '../storage/breedingOptionOfferRepository'
import { createSqliteBreedingRollRepository } from '../storage/breedingRollRepository'
import { createSqliteCampaignClockRepository } from '../storage/campaignClockRepository'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import { createSqlitePokemonEggRepository } from '../storage/pokemonEggRepository'
import { createSqliteSheetRepository } from '../storage/sheetRepository'
import {
  consumeCurrentPokemonEggHatchOffer,
  type ProjectCurrentPokemonEggHatchOfferOptions,
} from './projectPokemonEggHatchOffer'
import {
  createBreedingTransactionCoordinator,
  type BreedingTransactionCoordinator,
  type BreedingTransactionExecutionDecision,
} from './executeBreedingTransaction'

export interface BeginPokemonEggHatchSpecialResultV1 {
  readonly execution: BreedingTransactionExecutionDecision
  readonly egg: PokemonEggDocumentV1 | null
  readonly roll: BreedingRollRecordV1 | null
  readonly adjudication: BreedingGmAdjudicationRecordV1 | null
  readonly offer: BreedingOptionOfferRecordV1 | null
  readonly projection: PokemonEggHatchSpecialProjectionV1 | null
}
export interface ResolvePokemonEggHatchSpecialResultV1 {
  readonly execution: BreedingTransactionExecutionDecision
  readonly egg: PokemonEggDocumentV1 | null
  readonly adjudication: BreedingGmAdjudicationRecordV1 | null
  readonly offer: BreedingOptionOfferRecordV1 | null
  readonly projection: PokemonEggHatchSpecialProjectionV1 | null
}
export interface ManagePokemonEggHatchSpecialOptions {
  readonly database?: RotomDatabase
  readonly coordinator?: BreedingTransactionCoordinator
  readonly campaignProjectionKey: Buffer | string
  readonly realtimeTimestamp: number
  readonly resolveCurrentReferenceVersions: () => unknown
  readonly validateCurrentGmAuthority?: (actor: BreedingActorAuthorityV1) => boolean
  readonly drawHatchSpecialD100?: () => number
  readonly resumePending?: boolean
  readonly beforeSettle?: (result: BreedingOperationResultV1) => void
}
export type ManagePokemonEggHatchSpecialErrorCode =
  | 'breeding.hatch-special-use-case.invalid-request'
  | 'breeding.hatch-special-use-case.invalid-authority'
  | 'breeding.hatch-special-use-case.invalid-random-source'
  | 'breeding.hatch-special-use-case.repository-mismatch'
  | 'breeding.hatch-special-use-case.stale-authority'
  | 'breeding.hatch-special-use-case.unavailable'
  | 'breeding.hatch-special-use-case.wrong-command'
export class ManagePokemonEggHatchSpecialError extends Error {
  readonly code: ManagePokemonEggHatchSpecialErrorCode
  constructor(code: ManagePokemonEggHatchSpecialErrorCode, message: string) {
    super(message)
    this.name = 'ManagePokemonEggHatchSpecialError'
    this.code = code
  }
}
const fail = (code: ManagePokemonEggHatchSpecialErrorCode, message: string): never => {
  throw new ManagePokemonEggHatchSpecialError(code, message)
}
const same = (left: unknown, right: unknown): boolean => stableJsonStringify(left) === stableJsonStringify(right)
const sha256 = (value: unknown): string => createHash('sha256').update(stableJsonStringify(value)).digest('hex')
const promiseLike = (value: unknown): value is PromiseLike<unknown> => (
  (typeof value === 'object' || typeof value === 'function') && value !== null
  && typeof (value as { readonly then?: unknown }).then === 'function'
)
const strictObject = (value: unknown, fields: readonly string[], label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    || Object.getOwnPropertySymbols(value).length > 0) {
    return fail('breeding.hatch-special-use-case.invalid-request', `${label} must be a plain exact object.`)
  }
  const row = value as Record<string, unknown>
  const allowed = new Set(fields)
  if (fields.some(field => !Object.hasOwn(row, field))
    || Object.getOwnPropertyNames(row).some(field => !allowed.has(field))) {
    return fail('breeding.hatch-special-use-case.invalid-request', `${label} must contain exactly the declared fields.`)
  }
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(row, field)
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      return fail('breeding.hatch-special-use-case.invalid-request', `${label}.${field} must be an enumerable data field.`)
    }
  }
  return row
}
const coordinatorFor = (options: ManagePokemonEggHatchSpecialOptions) => {
  const database = options.database ?? options.coordinator?.database ?? getRotomDatabase()
  if (options.coordinator && options.coordinator.database !== database) {
    return fail('breeding.hatch-special-use-case.repository-mismatch', 'Coordinator and hatch-special use case must share one database connection.')
  }
  return Object.freeze({ database, coordinator: options.coordinator ?? createBreedingTransactionCoordinator({ database }) })
}
const currentReferences = (suppliedValue: unknown, options: ManagePokemonEggHatchSpecialOptions) => {
  if (typeof options.resolveCurrentReferenceVersions !== 'function') {
    return fail('breeding.hatch-special-use-case.invalid-request', 'A synchronous server-owned reference resolver is required.')
  }
  let currentValue: unknown
  try { currentValue = options.resolveCurrentReferenceVersions() }
  catch { return fail('breeding.hatch-special-use-case.stale-authority', 'Current reference resolution failed closed.') }
  if (promiseLike(currentValue)) {
    return fail('breeding.hatch-special-use-case.stale-authority', 'Current reference resolution must be synchronous.')
  }
  const supplied = parseAuthoritativeBreedingReferenceVersionSnapshotV1(suppliedValue)
  const current = parseAuthoritativeBreedingReferenceVersionSnapshotV1(currentValue)
  if (!same(supplied, current)) {
    return fail('breeding.hatch-special-use-case.stale-authority', 'Supplied references must exactly match the current app-owned snapshot.')
  }
  return supplied
}
const verifyCurrentGm = (actor: BreedingActorAuthorityV1, options: ManagePokemonEggHatchSpecialOptions): void => {
  if (actor.role !== 'gm' || !options.validateCurrentGmAuthority) {
    return fail('breeding.hatch-special-use-case.invalid-authority', 'Current authenticated GM campaign authority is required.')
  }
  let verified: unknown
  try { verified = options.validateCurrentGmAuthority(actor) }
  catch { return fail('breeding.hatch-special-use-case.invalid-authority', 'Current GM authority verifier failed closed.') }
  if (promiseLike(verified) || verified !== true) {
    return fail('breeding.hatch-special-use-case.invalid-authority', 'GM authority verifier must synchronously return exact true.')
  }
}
const exactReceipt = (submittedValue: unknown, expected: BreedingAuthorizationReceiptV1): BreedingAuthorizationReceiptV1 => {
  const submitted = parseAuthoritativeBreedingAuthorizationReceiptV1(submittedValue)
  if (!same(submitted, expected) || !submitted.authorized || submitted.reasonId !== 'breeding.authorization.authorized') {
    return fail('breeding.hatch-special-use-case.invalid-authority', 'Authorization receipt must exactly equal current server-rebuilt hatch authority.')
  }
  return submitted
}
const readResource = (readSet: BreedingOperationReadSetV1, kind: BreedingReadResourceV1['resourceKind'], id: string) => (
  readSet.resources.find(value => value.resourceKind === kind && value.resourceId === id) ?? null
)
const exactEvidence = (input: { readonly database: RotomDatabase, readonly operationId: string, readonly readSet: BreedingOperationReadSetV1, readonly receipt: BreedingAuthorizationReceiptV1 }): boolean => {
  const evidence = createSqliteBreedingOperationEvidenceRepository(input.database).get(input.operationId)
  return Boolean(evidence && same(evidence.readSet, input.readSet) && same(evidence.authorizationReceipt, input.receipt))
}
const drawD100 = (draw: () => number): number => {
  let value: unknown
  try { value = draw() }
  catch { return fail('breeding.hatch-special-use-case.invalid-random-source', 'Server d100 source threw before a roll could be persisted.') }
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 100) {
    return fail('breeding.hatch-special-use-case.invalid-random-source', 'Server d100 source must return exactly one integer from 1 through 100.')
  }
  return Number(value)
}
const audienceTargets = (egg: PokemonEggDocumentV1) => Object.freeze([
  { audience: 'diagnostic' as const, trainerSheetSlug: null },
  { audience: 'gm' as const, trainerSheetSlug: null },
  { audience: 'owner' as const, trainerSheetSlug: egg.ownerTrainerSlug },
  { audience: 'public' as const, trainerSheetSlug: null },
])
const exactRetryExecution = (record: BreedingOperationLedgerRecord): BreedingTransactionExecutionDecision => Object.freeze({
  kind: 'exact-retry', record, committedRealtimeEvents: Object.freeze([]), publicationFailureCount: 0,
})
const assertStoredCommand = (record: BreedingOperationLedgerRecord, command: BreedingOperationCommandV1): void => {
  if (!same(record.command, command) || record.commandHash !== createBreedingOperationCommandHash(command)) {
    fail('breeding.hatch-special-use-case.invalid-authority', 'Operation identity is already bound to a different command.')
  }
}
const loadSpecialRecords = (database: RotomDatabase, egg: PokemonEggDocumentV1 | null): {
  readonly adjudication: BreedingGmAdjudicationRecordV1 | null
  readonly offer: BreedingOptionOfferRecordV1 | null
} => {
  if (!egg?.hatchOperationId || (egg.special.state !== 'pending-adjudication' && egg.special.state !== 'resolved')) {
    return Object.freeze({ adjudication: null, offer: null })
  }
  const adjudication = createSqliteBreedingGmAdjudicationRepository(database).get(
    deriveBreedingHatchSpecialAdjudicationIdV1(egg.hatchOperationId, egg.eggId),
  )
  const offer = createSqliteBreedingOptionOfferRepository(database).get(
    deriveBreedingHatchSpecialOfferIdV1(egg.hatchOperationId, egg.eggId),
  )
  return Object.freeze({ adjudication, offer })
}
const beginResult = (input: {
  readonly database: RotomDatabase
  readonly execution: BreedingTransactionExecutionDecision
  readonly eggId: string
  readonly audience: 'gm' | 'owner'
}): BeginPokemonEggHatchSpecialResultV1 => {
  const egg = createSqlitePokemonEggRepository(input.database).get(input.eggId)
  const roll = createSqliteBreedingRollRepository(input.database).findHatchSpecialByEgg(input.eggId)
  const records = loadSpecialRecords(input.database, egg)
  const minute = createSqliteCampaignClockRepository(input.database).get().campaignMinute
  const projection = egg && egg.special.state !== 'not-rolled'
    ? projectPokemonEggHatchSpecialV1({ egg, audience: input.audience, ...records, generatedAtCampaignMinute: minute })
    : null
  return Object.freeze({ execution: input.execution, egg, roll, ...records, projection })
}
const resolveResult = (input: {
  readonly database: RotomDatabase
  readonly execution: BreedingTransactionExecutionDecision
  readonly eggId: string
}): ResolvePokemonEggHatchSpecialResultV1 => {
  const egg = createSqlitePokemonEggRepository(input.database).get(input.eggId)
  const records = loadSpecialRecords(input.database, egg)
  const minute = createSqliteCampaignClockRepository(input.database).get().campaignMinute
  const projection = egg && egg.special.state !== 'not-rolled'
    ? projectPokemonEggHatchSpecialV1({ egg, audience: 'gm', ...records, generatedAtCampaignMinute: minute })
    : null
  return Object.freeze({ execution: input.execution, egg, ...records, projection })
}
const validateTerminalEvidence = (input: {
  readonly database: RotomDatabase
  readonly command: BreedingOperationCommandV1
  readonly readSet: BreedingOperationReadSetV1
  readonly receipt: BreedingAuthorizationReceiptV1
}): BreedingOperationLedgerRecord | null => {
  const record = createSqliteBreedingOperationRepository(input.database).get(input.command.operationId)
  if (!record || record.status === 'pending') return null
  assertStoredCommand(record, input.command)
  if (!exactEvidence({ database: input.database, operationId: input.command.operationId, readSet: input.readSet, receipt: input.receipt })) {
    return fail('breeding.hatch-special-use-case.invalid-authority', 'Terminal hatch operation is missing or disagrees with immutable authority evidence.')
  }
  return record
}

const prepareBeginRoll = (input: {
  readonly database: RotomDatabase
  readonly command: Extract<BreedingOperationCommandV1, { readonly commandKind: 'begin-hatch' }>
  readonly readSet: BreedingOperationReadSetV1
  readonly receipt: BreedingAuthorizationReceiptV1
  readonly optionsSnapshot: BreedingCampaignOptionSnapshotV1
  readonly hatchOfferAuthority: PokemonEggHatchOfferAuthorityV1
  readonly draw: () => number
}): BreedingRollRecordV1 | null => input.database.withTransaction(() => {
  createSqliteBreedingOperationEvidenceRepository(input.database).insert({
    command: input.command,
    readSet: input.readSet,
    authorizationReceipt: input.receipt,
  })
  const rolls = createSqliteBreedingRollRepository(input.database)
  const operationRolls = rolls.listByOperation(input.command.operationId)
  if (operationRolls.length > 0) return operationRolls.length === 1 ? operationRolls[0]! : null
  const existingForEgg = rolls.findHatchSpecialByEgg(input.command.payload.eggId)
  if (existingForEgg) return null
  const egg = createSqlitePokemonEggRepository(input.database).get(input.command.payload.eggId)
  const clock = createSqliteCampaignClockRepository(input.database).get()
  const trainer = egg ? createSqliteSheetRepository(input.database).get('trainer', egg.ownerTrainerSlug) : null
  const eggResource = egg ? readResource(input.readSet, 'pokemon-egg', egg.eggId) : null
  const trainerResource = trainer ? readResource(input.readSet, 'trainer-sheet', trainer.slug) : null
  const clockResource = readResource(input.readSet, 'campaign-clock', 'campaign-clock')
  if (!egg || !trainer || egg.status !== 'ready' || egg.special.state !== 'not-rolled'
    || input.command.scopes[0]?.kind !== 'pokemon-egg'
    || input.command.scopes[0].expectedRevision !== egg.revision
    || clock.campaignMinute !== input.readSet.capturedAtCampaignMinute
    || clockResource?.revision !== clock.revision || clockResource.definitionSha256 !== sha256(clock)
    || eggResource?.revision !== egg.revision
    || eggResource.definitionSha256 !== pokemonEggLifecycleDocumentDefinitionSha256(egg)
    || trainerResource?.revision !== trainer.revision
    || trainerResource.definitionSha256 !== sha256(trainer.document)
    || input.optionsSnapshot.definitionSha256 !== input.readSet.referenceVersions.campaignOptionSnapshotDefinitionSha256
    || !egg.definitionHashes.includes(input.optionsSnapshot.definitionSha256)
    || input.hatchOfferAuthority.eggDefinitionSha256 !== pokemonEggLifecycleDocumentDefinitionSha256(egg)
    || input.hatchOfferAuthority.offer.issuedAtCampaignMinute !== clock.campaignMinute
    || input.hatchOfferAuthority.offer.expiresAtCampaignMinute === null
    || clock.campaignMinute >= input.hatchOfferAuthority.offer.expiresAtCampaignMinute) return null
  const roll = createBreedingRollRecordFromInjectedValues({
    schemaVersion: 1,
    rollRecordId: deriveBreedingHatchSpecialRollRecordIdV1(input.command.operationId, egg.eggId),
    operationId: input.command.operationId,
    commandSha256: createBreedingOperationCommandHash(input.command),
    operationRollOrdinal: 0,
    purpose: 'hatch-special-d100',
    target: { kind: 'pokemon-egg', eggId: egg.eggId, revision: egg.revision },
    formula: '1d100',
    dieCount: 1,
    dieSides: 100,
    ordered: false,
    modifier: 0,
    values: [drawD100(input.draw)],
    generatorId: 'server-rng-v1',
    sourceDefinitionHashes: breedingHatchSpecialRollSourceDefinitionHashesV1({
      egg,
      campaignOptionSnapshot: input.optionsSnapshot,
      hatchOfferAuthorityDefinitionSha256: input.hatchOfferAuthority.authorityDefinitionSha256,
    }),
    generatedAtCampaignMinute: clock.campaignMinute,
  })
  return rolls.insert({ command: input.command, roll })
})

export const beginPokemonEggHatchSpecial = (
  inputValue: unknown,
  options: ManagePokemonEggHatchSpecialOptions,
): BeginPokemonEggHatchSpecialResultV1 => {
  const input = strictObject(inputValue, [
    'command', 'readSet', 'authorizationReceipt', 'actorAuthority', 'ownerTrainerControl',
    'referenceVersions', 'campaignOptionSnapshot', 'declaration', 'hatchOfferAuthority', 'audience',
  ], 'beginPokemonEggHatchSpecialInput')
  if (input.audience !== 'gm' && input.audience !== 'owner') {
    return fail('breeding.hatch-special-use-case.invalid-request', 'Begin-hatch audience must be owner or GM.')
  }
  const command = parseBreedingOperationCommandV1(input.command)
  if (command.commandKind !== 'begin-hatch') {
    return fail('breeding.hatch-special-use-case.wrong-command', 'Begin hatch-special accepts begin-hatch only.')
  }
  const actor = parseAuthoritativeBreedingActorAuthorityV1(input.actorAuthority)
  if ((input.audience === 'gm') !== (actor.role === 'gm')) {
    return fail('breeding.hatch-special-use-case.invalid-authority', 'Projection audience must match the authenticated hatch actor role.')
  }
  const references = currentReferences(input.referenceVersions, options)
  const readSet = validateBreedingOperationReadSetCompleteness(command, input.readSet)
  if (!same(readSet.referenceVersions, references)) {
    return fail('breeding.hatch-special-use-case.stale-authority', 'Read set must use the exact current reference snapshot.')
  }
  const optionSnapshot = parseBreedingCampaignOptionSnapshotV1(input.campaignOptionSnapshot)
  if (optionSnapshot.definitionSha256 !== references.campaignOptionSnapshotDefinitionSha256) {
    return fail('breeding.hatch-special-use-case.stale-authority', 'Campaign options must equal the exact current reference commitment.')
  }
  const submittedAuthority = parseAuthoritativePokemonEggHatchOfferAuthorityV1(input.hatchOfferAuthority)
  const { database, coordinator } = coordinatorFor(options)
  const submittedReceipt = parseAuthoritativeBreedingAuthorizationReceiptV1(input.authorizationReceipt)
  const terminal = validateTerminalEvidence({ database, command, readSet, receipt: submittedReceipt })
  if (terminal) {
    const declaration = parseCampaignOperationOfferDeclarationV1(input.declaration)
    const control = input.ownerTrainerControl === null ? null
      : parseAuthoritativeBreedingTrainerControlEvidenceV1(input.ownerTrainerControl)
    const replayAuthorityMatches = submittedReceipt.actorAuthorityDefinitionSha256 === actor.definitionSha256
      && submittedReceipt.evidenceDefinitionHashes.includes(submittedAuthority.authorityDefinitionSha256)
      && submittedAuthority.actorAuthorityDefinitionSha256 === actor.definitionSha256
      && submittedAuthority.commandOperationId === command.operationId
      && submittedAuthority.commandSha256 === createBreedingOperationCommandHash(command)
      && submittedAuthority.offer.offerId === declaration.offerId
      && submittedAuthority.offer.offerDefinitionSha256 === declaration.offerDefinitionSha256
      && declaration.operationId === command.operationId
      && ((actor.role === 'gm' && control === null && submittedAuthority.ownerTrainerControlDefinitionSha256 === null)
        || (actor.role === 'player' && control !== null
          && actor.authenticatedProfileId === control.profileId
          && actor.profileDefinitionSha256 === control.profileDefinitionSha256
          && submittedAuthority.ownerTrainerControlDefinitionSha256 === control.definitionSha256
          && submittedReceipt.evidenceDefinitionHashes.includes(control.definitionSha256)))
    const retryClock = createSqliteCampaignClockRepository(database).get()
    if (!replayAuthorityMatches || actor.evaluatedAtCampaignMinute !== retryClock.campaignMinute) {
      return fail('breeding.hatch-special-use-case.invalid-authority', 'Exact retry must retain its original actor, declaration, control, hatch-offer commitment, and current campaign authority.')
    }
    if (actor.role === 'gm') verifyCurrentGm(actor, options)
    else {
      if (options.validateCurrentGmAuthority !== undefined) {
        return fail('breeding.hatch-special-use-case.invalid-authority', 'Owner exact retry rejects extraneous GM authority callbacks.')
      }
      const currentEgg = createSqlitePokemonEggRepository(database).get(command.payload.eggId)
      const currentTrainer = currentEgg ? createSqliteSheetRepository(database).get('trainer', currentEgg.ownerTrainerSlug) : null
      const currentFact = currentTrainer ? createPokemonEggHatchOwnerTrainerFactV1({
        trainerSheetSlug: currentTrainer.slug,
        trainerSheetRevision: currentTrainer.revision,
        trainerSheetDocument: currentTrainer.document,
      }) : null
      if (!control || !currentEgg || !currentFact
        || control.evaluatedAtCampaignMinute !== retryClock.campaignMinute
        || actor.authenticatedProfileId !== control.profileId
        || actor.profileDefinitionSha256 !== control.profileDefinitionSha256
        || actor.selectedTrainerSlug !== currentEgg.ownerTrainerSlug
        || control.trainerSheetSlug !== currentEgg.ownerTrainerSlug
        || control.trainerSheetRevision !== currentFact.trainerSheetRevision
        || control.trainerSheetDefinitionSha256 !== currentFact.trainerSheetDefinitionSha256) {
        return fail('breeding.hatch-special-use-case.invalid-authority', 'Owner exact retry requires current control of the unchanged Egg owner Trainer.')
      }
    }
    return beginResult({ database, execution: exactRetryExecution(terminal), eggId: command.payload.eggId, audience: input.audience })
  }
  if (actor.role === 'player' && options.validateCurrentGmAuthority !== undefined) {
    return fail('breeding.hatch-special-use-case.invalid-authority', 'Owner begin-hatch rejects extraneous GM authority callbacks.')
  }
  const consumeOptions: ProjectCurrentPokemonEggHatchOfferOptions = {
    database,
    resolveCurrentReferenceVersions: options.resolveCurrentReferenceVersions,
    ...(actor.role === 'gm' ? { validateCurrentGmAuthority: options.validateCurrentGmAuthority } : {}),
  }
  const consumed = consumeCurrentPokemonEggHatchOffer({
    command,
    actorAuthority: actor,
    ownerTrainerControl: input.ownerTrainerControl,
    referenceVersions: references,
    declaration: input.declaration,
  }, consumeOptions)
  assertPokemonEggHatchOfferAuthorityExactReplayV1(submittedAuthority, consumed.authority)
  const egg = createSqlitePokemonEggRepository(database).get(command.payload.eggId)
    ?? fail('breeding.hatch-special-use-case.unavailable', 'Ready Egg is unavailable.')
  const trainer = createSqliteSheetRepository(database).get('trainer', egg.ownerTrainerSlug)
    ?? fail('breeding.hatch-special-use-case.unavailable', 'Owner Trainer destination is unavailable.')
  const fact = createPokemonEggHatchOwnerTrainerFactV1({
    trainerSheetSlug: trainer.slug,
    trainerSheetRevision: trainer.revision,
    trainerSheetDocument: trainer.document,
  })
  const clock = createSqliteCampaignClockRepository(database).get()
  const expectedReceipt = authorizeBreedingBeginHatchV1({
    command,
    readSet,
    actorAuthority: actor,
    ownerTrainerControl: input.ownerTrainerControl,
    egg,
    ownerTrainerFact: fact,
    hatchOfferAuthority: consumed.authority,
    campaignOptionSnapshot: optionSnapshot,
    currentClock: clock,
    securityPolicyDefinitionSha256: securityPolicyJson.definitionSha256,
  })
  const receipt = exactReceipt(input.authorizationReceipt, expectedReceipt)
  const operations = createSqliteBreedingOperationRepository(database)
  const reservation = database.withTransaction(() => operations.reserve(command, readSet.capturedAtCampaignMinute))
  if (reservation.kind === 'exact-retry') {
    if (!exactEvidence({ database, operationId: command.operationId, readSet, receipt })) {
      return fail('breeding.hatch-special-use-case.invalid-authority', 'Terminal hatch operation lost immutable authority evidence.')
    }
    return beginResult({ database, execution: exactRetryExecution(reservation.record), eggId: command.payload.eggId, audience: input.audience })
  }
  if (reservation.kind === 'reserved' || options.resumePending === true) {
    prepareBeginRoll({
      database,
      command,
      readSet,
      receipt,
      optionsSnapshot: optionSnapshot,
      hatchOfferAuthority: consumed.authority,
      draw: options.drawHatchSpecialD100 ?? (() => randomInt(1, 101)),
    })
  }
  const execution = coordinator.execute({
    command,
    createdAtCampaignMinute: readSet.capturedAtCampaignMinute,
    settledAtCampaignMinute: readSet.capturedAtCampaignMinute,
    ...((reservation.kind === 'reserved' || options.resumePending === true) ? { resumePending: true } : {}),
    execute: (canonical, _operation, context) => {
      const commandHash = createBreedingOperationCommandHash(canonical)
      const currentEgg = context.repositories.eggs.get(canonical.payload.eggId)
      if (!currentEgg) return createBreedingOperationRejectedV1({
        operationId: canonical.operationId, commandHash, commandKind: canonical.commandKind,
        reasonId: 'breeding.operation.not-found', currentAggregateRefs: [], conflictingScopes: canonical.scopes,
      })
      const currentClock = context.repositories.campaignClock.get()
      const eggResource = readResource(readSet, 'pokemon-egg', currentEgg.eggId)
      if (currentClock.campaignMinute !== readSet.capturedAtCampaignMinute
        || readResource(readSet, 'campaign-clock', 'campaign-clock')?.definitionSha256 !== sha256(currentClock)
        || eggResource?.revision !== currentEgg.revision
        || eggResource.definitionSha256 !== pokemonEggLifecycleDocumentDefinitionSha256(currentEgg)) {
        return createBreedingOperationRejectedV1({
          operationId: canonical.operationId, commandHash, commandKind: canonical.commandKind,
          reasonId: 'breeding.operation.stale-revision',
          currentAggregateRefs: [{ kind: 'pokemon-egg', id: currentEgg.eggId, revision: currentEgg.revision }],
          conflictingScopes: canonical.scopes,
        })
      }
      const evidence = context.repositories.operationEvidence.get(canonical.operationId)
      const persistedRoll = context.repositories.rolls.findHatchSpecialByEgg(currentEgg.eggId)
      if (!evidence || !persistedRoll || persistedRoll.operationId !== canonical.operationId
        || !same(evidence.readSet, readSet) || !same(evidence.authorizationReceipt, receipt)) {
        return createBreedingOperationRejectedV1({
          operationId: canonical.operationId, commandHash, commandKind: canonical.commandKind,
          reasonId: 'breeding.operation.unauthorized',
          currentAggregateRefs: [{ kind: 'pokemon-egg', id: currentEgg.eggId, revision: currentEgg.revision }],
          conflictingScopes: canonical.scopes,
        })
      }
      let planned
      try {
        planned = planPokemonEggHatchSpecialBeginV1({
          egg: currentEgg,
          command: canonical,
          persistedRoll,
          campaignOptionSnapshot: optionSnapshot,
          hatchOfferAuthority: consumed.authority,
          campaignMinute: currentClock.campaignMinute,
        })
      }
      catch (error) {
        if (error instanceof PokemonEggHatchSpecialAuthorityError) {
          if (error.code === 'breeding.hatch-special.unavailable') throw error
          return createBreedingOperationRejectedV1({
            operationId: canonical.operationId, commandHash, commandKind: canonical.commandKind,
            reasonId: error.code === 'breeding.hatch-special.stale-authority'
              ? 'breeding.operation.stale-revision' : 'breeding.operation.unavailable',
            currentAggregateRefs: [{ kind: 'pokemon-egg', id: currentEgg.eggId, revision: currentEgg.revision }],
            conflictingScopes: canonical.scopes,
          })
        }
        throw error
      }
      const replacement = context.repositories.eggs.replace({ expectedRevision: currentEgg.revision, document: planned.egg })
      if (replacement.kind !== 'applied') throw new Error('Atomic hatch-special Egg replacement unexpectedly conflicted.')
      if (planned.offer && planned.adjudication) {
        context.repositories.optionOffers.insert(planned.offer)
        context.repositories.gmAdjudications.insert(planned.adjudication)
      }
      context.appendRealtime(breedingRealtimeRefreshAppendInputs({
        aggregateKind: 'pokemon-egg', aggregateId: planned.egg.eggId, revision: planned.egg.revision,
        operationKind: canonical.commandKind, audienceTargets: audienceTargets(planned.egg),
        campaignProjectionKey: options.campaignProjectionKey, timestamp: options.realtimeTimestamp,
      }))
      return createBreedingOperationAcceptedV1({
        operationId: canonical.operationId,
        commandHash,
        commandKind: canonical.commandKind,
        outcomeKind: 'hatch-started',
        aggregateRefs: [{ kind: 'pokemon-egg', id: planned.egg.eggId, revision: planned.egg.revision }],
        changedScopes: canonical.scopes,
        committedAtCampaignMinute: currentClock.campaignMinute,
      })
    },
    ...(options.beforeSettle ? { beforeSettle: options.beforeSettle } : {}),
  })
  if (execution.kind !== 'pending' && !exactEvidence({ database, operationId: command.operationId, readSet, receipt })) {
    return fail('breeding.hatch-special-use-case.invalid-authority', 'Terminal begin-hatch operation lost immutable authority evidence.')
  }
  return beginResult({ database, execution, eggId: command.payload.eggId, audience: input.audience })
}

export const resolvePokemonEggHatchSpecial = (
  inputValue: unknown,
  options: ManagePokemonEggHatchSpecialOptions,
): ResolvePokemonEggHatchSpecialResultV1 => {
  const input = strictObject(inputValue, [
    'command', 'readSet', 'authorizationReceipt', 'actorAuthority', 'referenceVersions', 'audience',
  ], 'resolvePokemonEggHatchSpecialInput')
  if (input.audience !== 'gm') {
    return fail('breeding.hatch-special-use-case.invalid-authority', 'Hatch-special adjudication is GM-only.')
  }
  const command = parseBreedingOperationCommandV1(input.command)
  if (command.commandKind !== 'resolve-hatch-special') {
    return fail('breeding.hatch-special-use-case.wrong-command', 'Resolution accepts resolve-hatch-special only.')
  }
  const actor = parseAuthoritativeBreedingActorAuthorityV1(input.actorAuthority)
  verifyCurrentGm(actor, options)
  const references = currentReferences(input.referenceVersions, options)
  const readSet = validateBreedingOperationReadSetCompleteness(command, input.readSet)
  if (!same(readSet.referenceVersions, references)) {
    return fail('breeding.hatch-special-use-case.stale-authority', 'Resolution read set must use current app-owned references.')
  }
  const { database, coordinator } = coordinatorFor(options)
  const submittedReceipt = parseAuthoritativeBreedingAuthorizationReceiptV1(input.authorizationReceipt)
  const terminal = validateTerminalEvidence({ database, command, readSet, receipt: submittedReceipt })
  if (terminal) {
    const retryClock = createSqliteCampaignClockRepository(database).get()
    if (submittedReceipt.actorAuthorityDefinitionSha256 !== actor.definitionSha256
      || !submittedReceipt.evidenceDefinitionHashes.includes(actor.definitionSha256)
      || actor.evaluatedAtCampaignMinute !== retryClock.campaignMinute) {
      return fail('breeding.hatch-special-use-case.invalid-authority', 'Exact adjudication retry must retain its original current GM actor authority.')
    }
    return resolveResult({ database, execution: exactRetryExecution(terminal), eggId: command.payload.eggId })
  }
  const egg = createSqlitePokemonEggRepository(database).get(command.payload.eggId)
    ?? fail('breeding.hatch-special-use-case.unavailable', 'Pending special Egg is unavailable.')
  if (!egg.hatchOperationId) return fail('breeding.hatch-special-use-case.unavailable', 'Egg has no hatch-special workflow.')
  const adjudication = createSqliteBreedingGmAdjudicationRepository(database).get(
    deriveBreedingHatchSpecialAdjudicationIdV1(egg.hatchOperationId, egg.eggId),
  ) ?? fail('breeding.hatch-special-use-case.unavailable', 'Pending special adjudication is unavailable.')
  const offer = createSqliteBreedingOptionOfferRepository(database).get(
    deriveBreedingHatchSpecialOfferIdV1(egg.hatchOperationId, egg.eggId),
  ) ?? fail('breeding.hatch-special-use-case.unavailable', 'Pending special offer is unavailable.')
  const clock = createSqliteCampaignClockRepository(database).get()
  const expectedReceipt = authorizeBreedingResolveHatchSpecialV1({
    command, readSet, actorAuthority: actor, egg, adjudication, offer, currentClock: clock,
    securityPolicyDefinitionSha256: securityPolicyJson.definitionSha256,
  })
  const receipt = exactReceipt(input.authorizationReceipt, expectedReceipt)
  const operations = createSqliteBreedingOperationRepository(database)
  const reservation = database.withTransaction(() => {
    const decision = operations.reserve(command, readSet.capturedAtCampaignMinute)
    if (decision.kind === 'reserved') createSqliteBreedingOperationEvidenceRepository(database).insert({ command, readSet, authorizationReceipt: receipt })
    else if (options.resumePending === true) createSqliteBreedingOperationEvidenceRepository(database).insert({ command, readSet, authorizationReceipt: receipt })
    return decision
  })
  const execution = coordinator.execute({
    command,
    createdAtCampaignMinute: readSet.capturedAtCampaignMinute,
    settledAtCampaignMinute: readSet.capturedAtCampaignMinute,
    ...((reservation.kind === 'reserved' || options.resumePending === true) ? { resumePending: true } : {}),
    execute: (canonical, _operation, context) => {
      const commandHash = createBreedingOperationCommandHash(canonical)
      const currentEgg = context.repositories.eggs.get(canonical.payload.eggId)
      const currentClock = context.repositories.campaignClock.get()
      if (!currentEgg) return createBreedingOperationRejectedV1({ operationId: canonical.operationId, commandHash, commandKind: canonical.commandKind, reasonId: 'breeding.operation.not-found', currentAggregateRefs: [], conflictingScopes: canonical.scopes })
      const currentAdjudication = currentEgg.hatchOperationId ? context.repositories.gmAdjudications.get(
        deriveBreedingHatchSpecialAdjudicationIdV1(currentEgg.hatchOperationId, currentEgg.eggId),
      ) : null
      const currentOffer = currentEgg.hatchOperationId ? context.repositories.optionOffers.get(
        deriveBreedingHatchSpecialOfferIdV1(currentEgg.hatchOperationId, currentEgg.eggId),
      ) : null
      const evidence = context.repositories.operationEvidence.get(canonical.operationId)
      if (!currentAdjudication || !currentOffer || !evidence
        || currentClock.campaignMinute !== readSet.capturedAtCampaignMinute
        || readResource(readSet, 'campaign-clock', 'campaign-clock')?.definitionSha256 !== sha256(currentClock)
        || readResource(readSet, 'pokemon-egg', currentEgg.eggId)?.definitionSha256 !== pokemonEggLifecycleDocumentDefinitionSha256(currentEgg)
        || readResource(readSet, 'breeding-adjudication', currentAdjudication.adjudicationId)?.definitionSha256 !== currentAdjudication.definitionSha256
        || readResource(readSet, 'breeding-offer', currentOffer.offerId)?.definitionSha256 !== currentOffer.definitionSha256
        || !same(evidence.readSet, readSet) || !same(evidence.authorizationReceipt, receipt)) {
        return createBreedingOperationRejectedV1({
          operationId: canonical.operationId, commandHash, commandKind: canonical.commandKind,
          reasonId: 'breeding.operation.stale-revision',
          currentAggregateRefs: [{ kind: 'pokemon-egg', id: currentEgg.eggId, revision: currentEgg.revision }],
          conflictingScopes: canonical.scopes,
        })
      }
      let planned
      try { planned = planPokemonEggHatchSpecialResolutionV1({ egg: currentEgg, command: canonical, adjudication: currentAdjudication, offer: currentOffer, campaignMinute: currentClock.campaignMinute }) }
      catch (error) {
        if (error instanceof PokemonEggHatchSpecialAuthorityError) return createBreedingOperationRejectedV1({
          operationId: canonical.operationId, commandHash, commandKind: canonical.commandKind,
          reasonId: error.code === 'breeding.hatch-special.stale-authority' ? 'breeding.operation.stale-revision' : 'breeding.operation.unavailable',
          currentAggregateRefs: [{ kind: 'pokemon-egg', id: currentEgg.eggId, revision: currentEgg.revision }],
          conflictingScopes: canonical.scopes,
        })
        throw error
      }
      const eggReplacement = context.repositories.eggs.replace({ expectedRevision: currentEgg.revision, document: planned.egg })
      if (eggReplacement.kind !== 'applied') throw new Error('Atomic special-resolution Egg replacement unexpectedly conflicted.')
      const offerReplacement = context.repositories.optionOffers.replace({ expectedRevision: currentOffer.revision, record: planned.offer })
      if (offerReplacement.kind !== 'applied') throw new Error('Atomic special-resolution offer replacement unexpectedly conflicted.')
      const adjudicationReplacement = context.repositories.gmAdjudications.replace({ expectedRevision: currentAdjudication.revision, record: planned.adjudication })
      if (adjudicationReplacement.kind !== 'applied') throw new Error('Atomic special-resolution adjudication replacement unexpectedly conflicted.')
      context.appendRealtime(breedingRealtimeRefreshAppendInputs({
        aggregateKind: 'pokemon-egg', aggregateId: planned.egg.eggId, revision: planned.egg.revision,
        operationKind: canonical.commandKind, audienceTargets: audienceTargets(planned.egg),
        campaignProjectionKey: options.campaignProjectionKey, timestamp: options.realtimeTimestamp,
      }))
      return createBreedingOperationAcceptedV1({
        operationId: canonical.operationId, commandHash, commandKind: canonical.commandKind,
        outcomeKind: 'hatch-special-resolved',
        aggregateRefs: [{ kind: 'pokemon-egg', id: planned.egg.eggId, revision: planned.egg.revision }],
        changedScopes: canonical.scopes,
        committedAtCampaignMinute: currentClock.campaignMinute,
      })
    },
    ...(options.beforeSettle ? { beforeSettle: options.beforeSettle } : {}),
  })
  if (execution.kind !== 'pending' && !exactEvidence({ database, operationId: command.operationId, readSet, receipt })) {
    return fail('breeding.hatch-special-use-case.invalid-authority', 'Terminal special resolution lost immutable authority evidence.')
  }
  return resolveResult({ database, execution, eggId: command.payload.eggId })
}

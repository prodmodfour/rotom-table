import { createHash, randomInt } from 'node:crypto'
import securityPolicyJson from '../../data/breeding-automation/security-policy.json'
import { stableJsonStringify } from '#shared/automation/stableJson'
import type { BreedingActorAuthorityV1, BreedingAuthorizationReceiptV1, BreedingTrainerControlEvidenceV1 } from '#shared/breeding/authorization'
import type { EffectiveCapabilitySet } from '#shared/capabilityAutomation/effective'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import type { PokemonEggDocumentV1 } from '#shared/breeding/egg'
import type { BreedingRollRecordV1 } from '#shared/breeding/ledgers'
import { parseBreedingOperationCommandV1, type BreedingOperationResultV1 } from '#shared/breeding/operations'
import type { BreedingOperationReadSetV1, BreedingReadResourceV1 } from '#shared/breeding/readSets'
import {
  authorizeBreedingEggIncubationV1,
  parseAuthoritativeBreedingActorAuthorityV1,
  parseAuthoritativeBreedingAuthorizationReceiptV1,
  parseAuthoritativeBreedingTrainerControlEvidenceV1,
} from '../domain/breeding/authorization'
import {
  BREEDING_EGG_WARMER_CAPABILITY_POLICY_DEFINITION_SHA256,
  breedingEggWarmerCapabilityRollSourceDefinitionHashesV1,
  deriveBreedingEggWarmerCapabilityRollRecordIdV1,
  planBreedingEggWarmerCapabilityV1,
} from '../domain/breeding/eggWarmerCapability'
import { createBreedingRollRecordFromInjectedValues } from '../domain/breeding/ledgers'
import {
  createBreedingEggWarmerCapabilityHandoffV1,
  type BreedingModifierProviderHandoffAuthorityError,
} from '../domain/breeding/modifierProviderHandoff'
import {
  createBreedingOperationAcceptedV1,
  createBreedingOperationCommandHash,
  createBreedingOperationRejectedV1,
} from '../domain/breeding/operations'
import { validateBreedingOperationReadSetCompleteness } from '../domain/breeding/readSets'
import { breedingRealtimeRefreshAppendInputs } from '../realtime/breedingRealtime'
import { createSqliteBreedingOperationEvidenceRepository } from '../storage/breedingOperationEvidenceRepository'
import { createSqliteBreedingOperationRepository } from '../storage/breedingOperationRepository'
import { createSqliteBreedingRollRepository } from '../storage/breedingRollRepository'
import { createSqliteCampaignClockRepository } from '../storage/campaignClockRepository'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import { createSqlitePokemonEggRepository } from '../storage/pokemonEggRepository'
import { createSqliteSheetRepository, type StoredSheetDocument } from '../storage/sheetRepository'
import {
  createBreedingTransactionCoordinator,
  type BreedingTransactionCoordinator,
  type BreedingTransactionExecutionDecision,
} from './executeBreedingTransaction'

export interface ApplyPokemonEggWarmerCapabilityResultV1 {
  readonly execution: BreedingTransactionExecutionDecision
  readonly egg: PokemonEggDocumentV1 | null
  readonly roll: BreedingRollRecordV1 | null
  readonly requestedReductionCampaignMinutes: number | null
}
export interface ApplyPokemonEggWarmerCapabilityOptions {
  readonly database?: RotomDatabase
  readonly coordinator?: BreedingTransactionCoordinator
  readonly campaignProjectionKey: Buffer | string
  readonly realtimeTimestamp: number
  readonly resolveEffectiveCapabilities: (input: { readonly sourcePokemonSheetSlug: string, readonly sourcePokemonSheet: CharacterSheet }) => EffectiveCapabilitySet
  readonly drawReductionD10?: () => number
  readonly resumePending?: boolean
  readonly beforeSettle?: (result: BreedingOperationResultV1) => void
}
export type ApplyPokemonEggWarmerCapabilityErrorCode =
  | 'breeding.egg-warmer-use-case.invalid-authority'
  | 'breeding.egg-warmer-use-case.invalid-random-source'
  | 'breeding.egg-warmer-use-case.invalid-request'
  | 'breeding.egg-warmer-use-case.repository-mismatch'
  | 'breeding.egg-warmer-use-case.unavailable'
  | 'breeding.egg-warmer-use-case.wrong-command'
export class ApplyPokemonEggWarmerCapabilityError extends Error {
  readonly code: ApplyPokemonEggWarmerCapabilityErrorCode
  constructor(code: ApplyPokemonEggWarmerCapabilityErrorCode, message: string) {
    super(message)
    this.name = 'ApplyPokemonEggWarmerCapabilityError'
    this.code = code
  }
}
const fail = (code: ApplyPokemonEggWarmerCapabilityErrorCode, message: string): never => { throw new ApplyPokemonEggWarmerCapabilityError(code, message) }
const sha256 = (value: unknown): string => createHash('sha256').update(stableJsonStringify(value)).digest('hex')
const same = (left: unknown, right: unknown): boolean => stableJsonStringify(left) === stableJsonStringify(right)
const exact = (value: unknown, fields: readonly string[], label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) || Object.getOwnPropertySymbols(value).length > 0) return fail('breeding.egg-warmer-use-case.invalid-request', `${label} must be one plain data object.`)
  const row = value as Record<string, unknown>; const allowed = new Set(fields)
  if (fields.some(field => !Object.hasOwn(row, field)) || Object.getOwnPropertyNames(row).some(field => !allowed.has(field))) return fail('breeding.egg-warmer-use-case.invalid-request', `${label} must contain exactly the declared fields.`)
  for (const field of fields) { const descriptor = Object.getOwnPropertyDescriptor(row, field); if (!descriptor?.enumerable || !('value' in descriptor)) fail('breeding.egg-warmer-use-case.invalid-request', `${label}.${field} must be enumerable plain data.`) }
  return row
}
const strictArray = (value: unknown, maximum: number, label: string): readonly unknown[] => {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum || Object.getOwnPropertySymbols(value).length > 0 || Object.getOwnPropertyNames(value).length !== value.length + 1) return fail('breeding.egg-warmer-use-case.invalid-request', `${label} must be one strict array of at most ${maximum} entries.`)
  for (let i = 0; i < value.length; i += 1) { const descriptor = Object.getOwnPropertyDescriptor(value, String(i)); if (!descriptor?.enumerable || !('value' in descriptor)) fail('breeding.egg-warmer-use-case.invalid-request', `${label} must not be sparse or accessor-backed.`) }
  return value
}
const coordinatorFor = (options: ApplyPokemonEggWarmerCapabilityOptions) => {
  const database = options.database ?? options.coordinator?.database ?? getRotomDatabase()
  if (options.coordinator && options.coordinator.database !== database) return fail('breeding.egg-warmer-use-case.repository-mismatch', 'Coordinator and Egg Warmer use case must share one database connection.')
  return Object.freeze({ database, coordinator: options.coordinator ?? createBreedingTransactionCoordinator({ database }) })
}
const drawD10 = (draw: () => number): number => {
  let value: unknown
  try { value = draw() } catch { return fail('breeding.egg-warmer-use-case.invalid-random-source', 'Server d10 source threw before persistence.') }
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 10) return fail('breeding.egg-warmer-use-case.invalid-random-source', 'Server d10 source must return exactly one integer from 1 through 10.')
  return Number(value)
}
const readResource = (readSet: BreedingOperationReadSetV1, kind: BreedingReadResourceV1['resourceKind'], id: string): BreedingReadResourceV1 | null => readSet.resources.find(value => value.resourceKind === kind && value.resourceId === id) ?? null
const resourceMatches = (resource: BreedingReadResourceV1 | null, revision: number, definitionSha256: string): boolean => resource?.existence === 'present' && resource.revision === revision && resource.definitionSha256 === definitionSha256
const clockMatches = (readSet: BreedingOperationReadSetV1, clock: { readonly revision: number, readonly campaignMinute: number, readonly lastOperationId: string | null }): boolean => {
  const resource = readResource(readSet, 'campaign-clock', 'campaign-clock')
  return resource?.existence === 'present' && resource.revision === clock.revision && resource.observedCampaignMinute === clock.campaignMinute && resource.definitionSha256 === sha256(clock) && readSet.capturedAtCampaignMinute === clock.campaignMinute
}
const exactDependencies = (readSet: BreedingOperationReadSetV1, dependencies: readonly unknown[]): boolean => {
  const nonAttestation = readSet.dependencyEvidence.filter(entry => !(entry.providerKind === 'system' && entry.providerId === 'breeding-effective-dependency-set-v1' && entry.subjectKind === 'campaign' && entry.subjectId === 'campaign'))
  return same(nonAttestation, dependencies)
}
const resourceEvidence = (sourceSlug: string, previous: BreedingRollRecordV1 | null): string => sha256({
  schemaVersion: 1,
  policyDefinitionSha256: BREEDING_EGG_WARMER_CAPABILITY_POLICY_DEFINITION_SHA256,
  sourcePokemonSheetSlug: sourceSlug,
  latestReservedOrAcceptedUse: previous === null ? null : {
    operationId: previous.operationId,
    rollRecordId: previous.rollRecordId,
    generatedAtCampaignMinute: previous.generatedAtCampaignMinute,
    definitionSha256: previous.definitionSha256,
  },
})
const currentHandoff = (input: {
  readonly egg: PokemonEggDocumentV1
  readonly source: StoredSheetDocument
  readonly clock: { readonly campaignMinute: number }
  readonly previous: BreedingRollRecordV1 | null
  readonly options: ApplyPokemonEggWarmerCapabilityOptions
}) => {
  if (typeof input.options.resolveEffectiveCapabilities !== 'function') return fail('breeding.egg-warmer-use-case.invalid-request', 'A synchronous server-owned effective Capability resolver is required.')
  try {
    return createBreedingEggWarmerCapabilityHandoffV1({
      egg: input.egg,
      sourcePokemonSheet: { slug: input.source.slug, revision: input.source.revision, document: input.source.document },
      capturedAtCampaignMinute: input.clock.campaignMinute,
      resourceEvidenceDefinitionSha256: resourceEvidence(input.source.slug, input.previous),
    }, { resolveEffectiveCapabilities: input.options.resolveEffectiveCapabilities })
  }
  catch (error) {
    if ((error as BreedingModifierProviderHandoffAuthorityError)?.name === 'BreedingModifierProviderHandoffAuthorityError') return fail('breeding.egg-warmer-use-case.unavailable', 'Current effective Egg Warmer Capability authority is unavailable.')
    throw error
  }
}
const ownerControlsSource = (actor: BreedingActorAuthorityV1, control: BreedingTrainerControlEvidenceV1 | null, trainer: StoredSheetDocument | null, sourceSlug: string): boolean => {
  if (actor.role === 'gm') return control === null
  if (!control || !trainer || trainer.slug !== control.trainerSheetSlug || trainer.revision !== control.trainerSheetRevision || sha256(trainer.document) !== control.trainerSheetDefinitionSha256) return false
  const sheet = trainer.document as unknown as TrainerSheet
  return [...(sheet.currentTeam ?? []), ...(sheet.boxedPokemon ?? [])].filter((value, index, all) => all.indexOf(value) === index).includes(sourceSlug)
}
const expectedAuthorization = (input: { readonly command: unknown, readonly readSet: unknown, readonly actor: unknown, readonly control: unknown, readonly egg: PokemonEggDocumentV1, readonly gmOverrides: readonly unknown[] }): BreedingAuthorizationReceiptV1 => authorizeBreedingEggIncubationV1({ command: input.command, readSet: input.readSet, actorAuthority: input.actor, trainerControl: input.control, egg: input.egg, gmOverrides: input.gmOverrides, securityPolicyDefinitionSha256: securityPolicyJson.definitionSha256 })
const audienceTargets = (egg: PokemonEggDocumentV1) => Object.freeze([
  { audience: 'diagnostic' as const, trainerSheetSlug: null }, { audience: 'gm' as const, trainerSheetSlug: null },
  { audience: 'owner' as const, trainerSheetSlug: egg.ownerTrainerSlug }, { audience: 'public' as const, trainerSheetSlug: null },
])
const result = (database: RotomDatabase, execution: BreedingTransactionExecutionDecision, eggId: string, operationId: string): ApplyPokemonEggWarmerCapabilityResultV1 => {
  const egg = createSqlitePokemonEggRepository(database).get(eggId)
  const roll = createSqliteBreedingRollRepository(database).listByOperation(operationId)[0] ?? null
  const requestedReductionCampaignMinutes = roll ? (roll.total === 1 ? 0 : roll.total * 60) : null
  return Object.freeze({ execution, egg, roll, requestedReductionCampaignMinutes })
}

export const applyPokemonEggWarmerCapability = (inputValue: unknown, options: ApplyPokemonEggWarmerCapabilityOptions): ApplyPokemonEggWarmerCapabilityResultV1 => {
  const input = exact(inputValue, ['command','readSet','authorizationReceipt','actorAuthority','trainerControl','gmOverrides'], 'eggWarmerCapabilityInput')
  strictArray(input.gmOverrides, 1, 'eggWarmerCapabilityInput.gmOverrides')
  const command = parseBreedingOperationCommandV1(input.command)
  if (command.commandKind !== 'apply-egg-warmer-capability') return fail('breeding.egg-warmer-use-case.wrong-command', 'Egg Warmer use case accepts apply-egg-warmer-capability only.')
  const readSet = validateBreedingOperationReadSetCompleteness(command, input.readSet)
  const actor = parseAuthoritativeBreedingActorAuthorityV1(input.actorAuthority)
  const control = input.trainerControl === null ? null : parseAuthoritativeBreedingTrainerControlEvidenceV1(input.trainerControl)
  const submittedReceipt = parseAuthoritativeBreedingAuthorizationReceiptV1(input.authorizationReceipt)
  const { database, coordinator } = coordinatorFor(options)
  const operations = createSqliteBreedingOperationRepository(database)
  const evidenceRepository = createSqliteBreedingOperationEvidenceRepository(database)
  const existing = operations.get(command.operationId)
  const existingEvidence = evidenceRepository.get(command.operationId)
  if (existing && (!same(existing.command, command) || !existingEvidence || !same(existingEvidence.readSet, readSet) || !same(existingEvidence.authorizationReceipt, submittedReceipt))) return fail('breeding.egg-warmer-use-case.invalid-authority', 'Operation identity is bound to different immutable authority evidence.')
  if (existing && existing.status !== 'pending') {
    const execution = coordinator.execute({ command, createdAtCampaignMinute: readSet.capturedAtCampaignMinute, settledAtCampaignMinute: readSet.capturedAtCampaignMinute, execute: () => fail('breeding.egg-warmer-use-case.invalid-request', 'Exact retry cannot re-enter mechanics.') })
    return result(database, execution, command.payload.eggId, command.operationId)
  }
  const eggs = createSqlitePokemonEggRepository(database); const sheets = createSqliteSheetRepository(database); const rolls = createSqliteBreedingRollRepository(database)
  const egg = eggs.get(command.payload.eggId) ?? fail('breeding.egg-warmer-use-case.invalid-authority', 'Current target Egg is required.')
  const source = sheets.get('pokemon', command.payload.sourcePokemonSheetSlug) ?? fail('breeding.egg-warmer-use-case.invalid-authority', 'Current source Pokémon sheet is required.')
  const trainer = sheets.get('trainer', egg.ownerTrainerSlug)
  const clock = createSqliteCampaignClockRepository(database).get()
  const previous = rolls.findLatestEggWarmerCapabilityBySource({ sourcePokemonSheetSlug: source.slug, excludeOperationId: command.operationId })
  const handoff = currentHandoff({ egg, source, clock, previous, options })
  const expected = expectedAuthorization({ command, readSet, actor, control, egg, gmOverrides: input.gmOverrides as readonly unknown[] })
  const initialAuthorityChecks = {
    receipt: same(expected, submittedReceipt) && expected.authorized && expected.reasonId === 'breeding.authorization.authorized',
    sourceRevision: source.revision === command.payload.expectedSourcePokemonSheetRevision,
    eggResource: resourceMatches(readResource(readSet, 'pokemon-egg', egg.eggId), egg.revision, sha256(egg)),
    sourceResource: resourceMatches(readResource(readSet, 'pokemon-sheet', source.slug), source.revision, sha256(source.document)),
    clock: clockMatches(readSet, clock),
    dependencies: exactDependencies(readSet, handoff.dependencyEvidence),
    sourceControl: ownerControlsSource(actor, control, trainer, source.slug),
    cooldown: previous === null || clock.campaignMinute >= previous.generatedAtCampaignMinute + 1_440,
  }
  const failedInitialChecks = Object.entries(initialAuthorityChecks).filter(([, valid]) => !valid).map(([name]) => name)
  if (failedInitialChecks.length > 0) {
    return fail('breeding.egg-warmer-use-case.invalid-authority', `Egg Warmer current authority failed closed (${failedInitialChecks.join(', ')}).`)
  }
  let preparedRoll: BreedingRollRecordV1 | null = null
  database.withTransaction(() => {
    operations.reserve(command, clock.campaignMinute)
    evidenceRepository.insert({
      command,
      readSet,
      authorizationReceipt: submittedReceipt,
      gmOverrides: input.gmOverrides as readonly unknown[],
    })
    const existingRolls = rolls.listByOperation(command.operationId)
    if (existingRolls.length > 0) { preparedRoll = existingRolls.length === 1 ? existingRolls[0]! : null; return }
    const latest = rolls.findLatestEggWarmerCapabilityBySource({ sourcePokemonSheetSlug: source.slug, excludeOperationId: command.operationId })
    if (latest && clock.campaignMinute < latest.generatedAtCampaignMinute + 1_440) return fail('breeding.egg-warmer-use-case.unavailable', 'Egg Warmer Capability is already reserved or used within the current 24 campaign hours.')
    const currentProvider = currentHandoff({ egg, source, clock, previous: latest, options })
    if (!same(currentProvider, handoff)) return fail('breeding.egg-warmer-use-case.invalid-authority', 'Effective Capability authority changed before roll persistence.')
    preparedRoll = createBreedingRollRecordFromInjectedValues({
      schemaVersion: 1,
      rollRecordId: deriveBreedingEggWarmerCapabilityRollRecordIdV1(command.operationId, egg.eggId),
      operationId: command.operationId,
      commandSha256: createBreedingOperationCommandHash(command),
      operationRollOrdinal: 0,
      purpose: 'provider-bounded',
      target: { kind: 'pokemon-egg', eggId: egg.eggId, revision: egg.revision },
      formula: 'provider-bounded',
      dieCount: 1,
      dieSides: 10,
      ordered: false,
      modifier: 0,
      values: [drawD10(options.drawReductionD10 ?? (() => randomInt(1, 11)))],
      generatorId: 'server-rng-v1',
      sourceDefinitionHashes: breedingEggWarmerCapabilityRollSourceDefinitionHashesV1({ egg, handoff }),
      generatedAtCampaignMinute: clock.campaignMinute,
    })
    preparedRoll = rolls.insert({ command, roll: preparedRoll })
  })
  if (!preparedRoll) return fail('breeding.egg-warmer-use-case.invalid-authority', 'One persisted Egg Warmer d10 is required before settlement.')
  const execution = coordinator.execute({
    command,
    createdAtCampaignMinute: clock.campaignMinute,
    settledAtCampaignMinute: clock.campaignMinute,
    ...(existing === null || options.resumePending === true ? { resumePending: true } : {}),
    execute: (canonical, _operation, context) => {
      if (canonical.commandKind !== 'apply-egg-warmer-capability') return fail('breeding.egg-warmer-use-case.wrong-command', 'Reserved operation changed command kind.')
      const currentEgg = context.repositories.eggs.get(canonical.payload.eggId)
      const currentSource = context.repositories.sheets.get('pokemon', canonical.payload.sourcePokemonSheetSlug)
      const currentTrainer = currentEgg ? context.repositories.sheets.get('trainer', currentEgg.ownerTrainerSlug) : null
      const currentClock = context.repositories.campaignClock.get()
      const operationEvidence = context.repositories.operationEvidence.get(canonical.operationId)
      const roll = context.repositories.rolls.listByOperation(canonical.operationId)[0] ?? null
      const previousUse = context.repositories.rolls.findLatestEggWarmerCapabilityBySource({ sourcePokemonSheetSlug: canonical.payload.sourcePokemonSheetSlug, excludeOperationId: canonical.operationId })
      if (!currentEgg || !currentSource || !roll || !operationEvidence) return createBreedingOperationRejectedV1({ operationId: canonical.operationId, commandHash: createBreedingOperationCommandHash(canonical), commandKind: canonical.commandKind, reasonId: 'breeding.operation.not-found', currentAggregateRefs: [], conflictingScopes: canonical.scopes })
      const currentProvider = currentHandoff({ egg: currentEgg, source: currentSource, clock: currentClock, previous: previousUse, options })
      const rebuilt = expectedAuthorization({ command: canonical, readSet, actor, control, egg: currentEgg, gmOverrides: input.gmOverrides as readonly unknown[] })
      const stale = !same(operationEvidence.readSet, readSet) || !same(operationEvidence.authorizationReceipt, submittedReceipt)
        || !same(rebuilt, submittedReceipt) || !clockMatches(readSet, currentClock)
        || !resourceMatches(readResource(readSet, 'pokemon-egg', currentEgg.eggId), currentEgg.revision, sha256(currentEgg))
        || !resourceMatches(readResource(readSet, 'pokemon-sheet', currentSource.slug), currentSource.revision, sha256(currentSource.document))
        || !exactDependencies(readSet, currentProvider.dependencyEvidence) || !same(currentProvider, handoff)
        || !ownerControlsSource(actor, control, currentTrainer, currentSource.slug)
        || (previousUse !== null && currentClock.campaignMinute < previousUse.generatedAtCampaignMinute + 1_440)
      if (stale) return createBreedingOperationRejectedV1({ operationId: canonical.operationId, commandHash: createBreedingOperationCommandHash(canonical), commandKind: canonical.commandKind, reasonId: 'breeding.operation.stale-revision', currentAggregateRefs: [{ kind: 'pokemon-egg', id: currentEgg.eggId, revision: currentEgg.revision }], conflictingScopes: canonical.scopes })
      const planned = planBreedingEggWarmerCapabilityV1({ egg: currentEgg, command: canonical, campaignClock: currentClock, handoff: currentProvider, roll })
      const replacement = context.repositories.eggs.replace({ expectedRevision: currentEgg.revision, document: planned.egg })
      if (replacement.kind !== 'applied') return createBreedingOperationRejectedV1({ operationId: canonical.operationId, commandHash: createBreedingOperationCommandHash(canonical), commandKind: canonical.commandKind, reasonId: 'breeding.operation.stale-revision', currentAggregateRefs: replacement.kind === 'stale' ? [{ kind: 'pokemon-egg', id: currentEgg.eggId, revision: replacement.currentRevision }] : [], conflictingScopes: canonical.scopes })
      context.appendRealtime(breedingRealtimeRefreshAppendInputs({ aggregateKind: 'pokemon-egg', aggregateId: replacement.document.eggId, revision: replacement.document.revision, operationKind: canonical.commandKind, audienceTargets: audienceTargets(replacement.document), campaignProjectionKey: options.campaignProjectionKey, timestamp: options.realtimeTimestamp }))
      return createBreedingOperationAcceptedV1({ operationId: canonical.operationId, commandHash: createBreedingOperationCommandHash(canonical), commandKind: canonical.commandKind, outcomeKind: 'egg-warmer-applied', aggregateRefs: [{ kind: 'pokemon-egg', id: replacement.document.eggId, revision: replacement.document.revision }], changedScopes: canonical.scopes, committedAtCampaignMinute: currentClock.campaignMinute })
    },
    ...(options.beforeSettle ? { beforeSettle: options.beforeSettle } : {}),
  })
  return result(database, execution, command.payload.eggId, command.operationId)
}

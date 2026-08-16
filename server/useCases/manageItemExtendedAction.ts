import type { AuthRole } from '#shared/auth'
import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  parseItemExtendedActionCommand,
  type CompleteItemExtendedActionCommandV1,
  type InterruptItemExtendedActionCommandV1,
  type ItemExtendedActionCommandV1,
  type ItemExtendedActionProjectionV1,
  type ItemExtendedActionResultV1,
  type StartItemExtendedActionCommandV1,
} from '#shared/itemAutomation/extendedActions'
import type { ItemOperationResultV1, UseItemCommandV1 } from '#shared/itemAutomation/operations'
import type { PlayerProfile } from '#shared/playerProfiles'
import { playerProfileCanControlTokenSheet } from '#shared/playerProfileTokenControl'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import { buildAuthoritativeItemExecutionContext, AuthoritativeItemExecutionContextError } from '../domain/itemAutomation/executionContext'
import { deriveAuthoritativeItemExtendedActionDeclarationEligibility } from '../domain/itemAutomation/eligibility'
import { buildItemExtendedActionProjection } from '../domain/itemAutomation/extendedActionProjection'
import { ITEM_AUTOMATION_RUNTIME_REGISTRY } from '../domain/itemAutomation/registry'
import { attachSheetItemCommandTemplate } from '../domain/itemAutomation/sheetActionCommandTemplate'
import { itemExtendedActionUpdatedRealtimeAppendInput } from '../realtime/itemExtendedActionRealtime'
import {
  defaultPersistedRealtimeEventPublisher,
  defaultPersistedRealtimePublicationFailureReporter,
  publishPersistedRealtimeEventsAfterCommit,
  type PersistedRealtimeEventPublisher,
  type PersistedRealtimePublicationFailureReporter,
} from '../realtime/persistedBatchPublication'
import { createSqliteCampaignClockRepository, type CampaignClockRepository } from '../storage/campaignClockRepository'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import {
  createSqliteItemExtendedActionRepository,
  itemExtendedActionCommandSha256,
  type ItemExtendedActionRepository,
  type StoredItemExtendedActionRecord,
} from '../storage/itemExtendedActionRepository'
import { createSqliteItemOperationRepository, type ItemOperationRepository } from '../storage/itemOperationRepository'
import { createSqliteRealtimeEventRepository, type RealtimeEventRepository } from '../storage/realtimeEventRepository'
import { createSqliteSheetRepository, type PersistedSheet, type SheetRepository } from '../storage/sheetRepository'
import type { PersistedRealtimeEvent } from '#shared/realtimeEventLog'
import { UseCaseHttpError } from '../utils/useCaseErrors'
import {
  loadTrainerSheetItemActionAuthority,
  type TrainerSheetItemActionAuthority,
} from './loadSheetItemActions'
import {
  executeItemOperationUseCase,
  type ExecuteItemOperationDependencies,
} from './executeItemOperation'

export class ItemExtendedActionUseCaseError extends UseCaseHttpError<400 | 403 | 404 | 409> {}

export interface ManageItemExtendedActionInput {
  readonly role: AuthRole
  readonly playerProfile?: PlayerProfile | null
  readonly command: unknown
  readonly clientId?: string
}

export interface ManageItemExtendedActionResponse {
  readonly result: ItemExtendedActionResultV1
  readonly activity: ItemExtendedActionProjectionV1
  readonly sheets: readonly PersistedSheet[]
}

export interface LoadItemExtendedActionsInput {
  readonly role: AuthRole
  readonly playerProfile?: PlayerProfile | null
  readonly trainerSlug: string
}

export interface ManageItemExtendedActionDependencies {
  readonly database?: RotomDatabase
  readonly sheetRepository?: Pick<
    SheetRepository<Record<string, unknown>>,
    'getByRef' | 'list' | 'applyLivePlayUpdate'
  > & { readonly database?: RotomDatabase }
  readonly campaignClockRepository?: Pick<CampaignClockRepository, 'get'> & { readonly database?: RotomDatabase }
  readonly activityRepository?: Pick<
    ItemExtendedActionRepository,
    'get' | 'getByOperation' | 'listForTrainer' | 'findInProgressForTrainer' | 'findInProgressForSource' | 'create' | 'settle'
  > & { readonly database?: RotomDatabase }
  readonly itemOperationRepository?: ItemOperationRepository
  readonly realtimeEventRepository?: Pick<RealtimeEventRepository, 'appendMany'> & { readonly database?: RotomDatabase }
  readonly publishPersistedRealtimeEvent?: PersistedRealtimeEventPublisher
  readonly reportAfterCommitPublicationFailure?: PersistedRealtimePublicationFailureReporter
  readonly now?: () => number
  readonly randomInt?: ExecuteItemOperationDependencies['randomInt']
  readonly failAfterWrite?: ExecuteItemOperationDependencies['failAfterWrite']
}

interface RuntimeDependencies {
  readonly database: RotomDatabase
  readonly sheetRepository: NonNullable<ManageItemExtendedActionDependencies['sheetRepository']>
  readonly campaignClockRepository: NonNullable<ManageItemExtendedActionDependencies['campaignClockRepository']>
  readonly activityRepository: NonNullable<ManageItemExtendedActionDependencies['activityRepository']>
  readonly itemOperationRepository: ItemOperationRepository
  readonly realtimeEventRepository: NonNullable<ManageItemExtendedActionDependencies['realtimeEventRepository']>
  readonly now: () => number
}

const fail = (statusCode: 400 | 403 | 404 | 409, message: string): never => {
  throw new ItemExtendedActionUseCaseError(statusCode, message)
}

const runtimeDependencies = (
  input: ManageItemExtendedActionDependencies,
): RuntimeDependencies => {
  const candidates = [
    input.database,
    input.sheetRepository?.database,
    input.campaignClockRepository?.database,
    input.activityRepository?.database,
    input.realtimeEventRepository?.database,
  ].filter(Boolean) as RotomDatabase[]
  const database = candidates[0] ?? getRotomDatabase()
  if (candidates.some(candidate => candidate !== database)) {
    throw new Error('Item Extended Action repositories must share one RotomDatabase transaction.')
  }
  return {
    database,
    sheetRepository: input.sheetRepository ?? createSqliteSheetRepository<Record<string, unknown>>(database),
    campaignClockRepository: input.campaignClockRepository ?? createSqliteCampaignClockRepository(database),
    activityRepository: input.activityRepository ?? createSqliteItemExtendedActionRepository(database),
    itemOperationRepository: input.itemOperationRepository ?? createSqliteItemOperationRepository({ database }),
    realtimeEventRepository: input.realtimeEventRepository ?? createSqliteRealtimeEventRepository({ database }),
    now: input.now ?? Date.now,
  }
}

const parseCommand = (value: unknown): ItemExtendedActionCommandV1 => {
  try { return parseItemExtendedActionCommand(value) }
  catch { return fail(400, 'Invalid item Extended Action command.') }
}

const authorizeTrainer = (input: {
  readonly role: AuthRole
  readonly playerProfile?: PlayerProfile | null
  readonly trainerSlug: string
}): void => {
  if (input.role === 'gm') return
  if (!playerProfileCanControlTokenSheet(input.playerProfile, 'trainer', input.trainerSlug)) {
    fail(403, 'The selected player profile does not control this item Extended Action.')
  }
}

const authorizeRecord = (input: {
  readonly role: AuthRole
  readonly playerProfile?: PlayerProfile | null
  readonly record: StoredItemExtendedActionRecord
}): void => authorizeTrainer({
  role: input.role,
  playerProfile: input.playerProfile,
  trainerSlug: input.record.initialItemCommand.actorSheet.slug,
})

const persistedAuthoritySheets = (
  authority: TrainerSheetItemActionAuthority,
  repository: RuntimeDependencies['sheetRepository'],
): readonly PersistedSheet[] => {
  const refs = [
    { kind: 'trainer' as const, slug: authority.trainerSheet.slug },
    ...authority.pokemonSheets.map(sheet => ({ kind: 'pokemon' as const, slug: sheet.slug })),
  ]
  return Object.freeze(refs.map(ref => repository.getByRef(ref.kind, ref.slug)
    ?? fail(404, `Item Extended Action sheet ${ref.kind}/${ref.slug} was not found.`)))
}

const selectedCommand = (input: {
  readonly template: UseItemCommandV1
  readonly operationId: string
  readonly offerId: string
  readonly targetIds: readonly string[]
  readonly choiceSelections: readonly { readonly choiceId: string, readonly optionIds: readonly string[] }[]
  readonly targeting: {
    readonly requirementId: string
    readonly minimum: number
    readonly maximum: number
    readonly options: readonly {
      readonly targetId: string
      readonly enabled: boolean
      readonly choices: readonly {
        readonly choiceId: string
        readonly minimum: number
        readonly maximum: number
        readonly options: readonly { readonly optionId: string }[]
      }[]
    }[]
  } | null
}): UseItemCommandV1 => {
  const targeting = input.targeting
    ?? fail(409, 'This Extended Action no longer has an authorized target requirement.')
  const options = new Map(targeting.options.map(option => [option.targetId, option]))
  if (input.targetIds.length < targeting.minimum
    || input.targetIds.length > targeting.maximum
    || input.targetIds.some(targetId => options.get(targetId)?.enabled !== true)
    || new Set(input.targetIds).size !== input.targetIds.length) {
    fail(409, 'One or more Extended Action targets are no longer authorized or eligible.')
  }
  const targetChoices = input.targetIds.length === 1
    ? options.get(input.targetIds[0]!)?.choices ?? []
    : []
  if (new Set(input.choiceSelections.map(choice => choice.choiceId)).size !== input.choiceSelections.length
    || input.choiceSelections.some(choice => !targetChoices.some(value => value.choiceId === choice.choiceId))) {
    fail(409, 'The Extended Action contains an unknown or duplicate item choice.')
  }
  for (const choice of targetChoices) {
    const selected = input.choiceSelections.find(value => value.choiceId === choice.choiceId)?.optionIds ?? []
    if (selected.length < choice.minimum || selected.length > choice.maximum
      || new Set(selected).size !== selected.length
      || selected.some(optionId => !choice.options.some(option => option.optionId === optionId))) {
      fail(409, 'One or more Extended Action choices are no longer authorized or eligible.')
    }
  }
  return Object.freeze({
    ...input.template,
    operationId: input.operationId,
    context: 'extended-action' as const,
    offerId: input.offerId,
    targetIds: Object.freeze([...input.targetIds]),
    choices: Object.freeze([
      {
        choiceId: targeting.requirementId,
        optionIds: Object.freeze([...input.targetIds]),
      },
      ...input.choiceSelections.map(choice => Object.freeze({
        choiceId: choice.choiceId,
        optionIds: Object.freeze([...choice.optionIds]),
      })),
    ]),
  })
}

const currentActivitySettlement = (input: {
  readonly role: AuthRole
  readonly playerProfile?: PlayerProfile | null
  readonly record: StoredItemExtendedActionRecord
  readonly settlementOperationId: string
  readonly runtime: RuntimeDependencies
}): {
  readonly command: UseItemCommandV1
  readonly authority: TrainerSheetItemActionAuthority
  readonly sheets: readonly PersistedSheet[]
} => {
  const trainerSlug = input.record.initialItemCommand.actorSheet.slug
  const authority = loadTrainerSheetItemActionAuthority({
    role: input.role,
    playerProfile: input.playerProfile,
    trainerSlug,
  }, {
    database: input.runtime.database,
    sheetRepository: input.runtime.sheetRepository,
    now: input.runtime.now,
  })
  const campaignClock = input.runtime.campaignClockRepository.get()
  const source = input.record.initialItemCommand.source
  if (source.kind !== 'trainer' || source.slug !== trainerSlug) {
    fail(409, 'The durable Extended Action source no longer has Trainer inventory authority.')
  }
  const sourceRows = authority.trainerSheet.inventory?.[source.section] ?? []
  const matchingIndices = sourceRows.flatMap((row, index) => row.id === source.rowId ? [index] : [])
  if (matchingIndices.length !== 1) {
    fail(409, 'The exact item source is no longer available in this Trainer inventory.')
  }
  const currentOffer = authority.projection.offers.find(offer => (
    offer.source.section === source.section && offer.source.rowIndex === matchingIndices[0]
  )) ?? fail(409, 'The exact item source no longer has a current workflow offer.')
  const offer = attachSheetItemCommandTemplate({
    offer: currentOffer,
    trainerSheet: authority.trainerSheet,
    pokemonSheets: authority.pokemonSheets,
    trainerSheets: authority.trainerSheets,
    campaignClock,
  })
  if (!offer.availability.enabled || !offer.actions.find(action => action.kind === 'use')?.enabled
    || !offer.itemCommand) {
    fail(409, offer.availability.unavailableReason?.label
      ?? offer.actions.find(action => action.kind === 'use')?.unavailableReason?.label
      ?? 'The item source is not currently eligible to complete this Extended Action.')
  }
  const definition = ITEM_AUTOMATION_RUNTIME_REGISTRY.resolve(offer.source.canonicalId ?? '')
  if (!definition || definition.canonicalId !== input.record.canonicalItemId
    || definition.definitionSha256 !== input.record.canonicalDefinitionSha256
    || definition.spec.timing !== 'extended'
    || !definition.spec.contexts.includes('extended-action')) {
    fail(409, 'The reviewed Extended Action item definition changed before completion.')
  }
  const dowsing = definition!.spec.effects.find(effect => effect.operation === 'search-for-shards')
  if (dowsing && campaignClock.campaignMinute < input.record.startedAtCampaignMinute + dowsing.searchMinutes) {
    fail(409, `Dowsing completes at campaign minute ${input.record.startedAtCampaignMinute + dowsing.searchMinutes}.`)
  }
  const template = offer.itemCommand
    ?? fail(409, 'The item source no longer has complete command authority.')
  const command = selectedCommand({
    template,
    operationId: input.settlementOperationId,
    offerId: offer.offerId,
    targetIds: input.record.initialItemCommand.targetIds,
    choiceSelections: input.record.initialItemCommand.choices.filter(choice => (
      choice.choiceId !== offer.targeting?.requirementId
    )),
    targeting: offer.targeting,
  })
  return {
    command,
    authority,
    sheets: persistedAuthoritySheets(authority, input.runtime.sheetRepository),
  }
}

const actorLabel = (sheet: TrainerSheet): string => sheet.name?.trim() || sheet.slug
const targetLabel = (sheet: CharacterSheet | TrainerSheet, kind: 'pokemon' | 'trainer'): string => kind === 'trainer'
  ? (sheet as TrainerSheet).name?.trim() || sheet.slug
  : (sheet as CharacterSheet).nickname?.trim() || (sheet as CharacterSheet).species?.trim() || sheet.slug

const projectionSheets = (
  record: StoredItemExtendedActionRecord,
  repository: RuntimeDependencies['sheetRepository'],
): readonly PersistedSheet[] => Object.freeze([
  repository.getByRef('trainer', record.initialItemCommand.actorSheet.slug),
  ...record.targetSnapshots.map(target => repository.getByRef(target.sheetKind, target.sheetSlug)),
].filter((sheet): sheet is PersistedSheet => Boolean(sheet)))

const project = (input: {
  readonly role: AuthRole
  readonly playerProfile?: PlayerProfile | null
  readonly record: StoredItemExtendedActionRecord
  readonly runtime: RuntimeDependencies
  readonly unavailableReason?: string | null
}): ItemExtendedActionProjectionV1 => {
  const sheets = projectionSheets(input.record, input.runtime.sheetRepository)
  let unavailableReason = input.unavailableReason
  if (unavailableReason === undefined && input.record.status === 'in-progress') {
    const definition = ITEM_AUTOMATION_RUNTIME_REGISTRY.resolve(input.record.canonicalItemId)
    const dowsing = definition?.definitionSha256 === input.record.canonicalDefinitionSha256
      ? definition.spec.effects.find(effect => effect.operation === 'search-for-shards')
      : null
    if (dowsing) {
      const completesAt = input.record.startedAtCampaignMinute + dowsing.searchMinutes
      if (input.runtime.campaignClockRepository.get().campaignMinute < completesAt) {
        unavailableReason = `Dowsing completes at campaign minute ${completesAt}.`
      }
    }
  }
  if (input.role === 'gm') return buildItemExtendedActionProjection({
    role: input.role,
    playerProfile: input.playerProfile,
    record: input.record,
    sheets,
    unavailableReason,
  })
  const actor = sheets.find(sheet => sheet.kind === 'trainer'
    && sheet.slug === input.record.initialItemCommand.actorSheet.slug)
  const trainer = actor?.sheet as unknown as TrainerSheet | undefined
  const roster = new Set([...(trainer?.currentTeam ?? []), ...(trainer?.boxedPokemon ?? [])]
    .filter((slug): slug is string => typeof slug === 'string'))
  const safeSheets = sheets.filter((sheet) => {
    if (sheet.kind === 'trainer' && sheet.slug === input.record.initialItemCommand.actorSheet.slug) return true
    if (playerProfileCanControlTokenSheet(input.playerProfile, sheet.kind, sheet.slug)) return true
    return sheet.kind === 'pokemon' && roster.has(sheet.slug)
  })
  return buildItemExtendedActionProjection({
    role: input.role,
    playerProfile: input.playerProfile,
    record: input.record,
    sheets: safeSheets,
    unavailableReason,
  })
}

const exactStartReplayResult = (record: StoredItemExtendedActionRecord): ItemExtendedActionResultV1 => ({
  schemaVersion: 1,
  operationId: record.startCommand.operationId,
  activityId: record.activityId,
  status: 'in-progress',
  revision: 0,
  exactReplay: true,
  itemResult: null,
})

const exactReplayResult = (record: StoredItemExtendedActionRecord): ItemExtendedActionResultV1 => {
  if (!record.result) return exactStartReplayResult(record)
  return record.result.status === 'completed'
    ? Object.freeze({
        ...record.result,
        exactReplay: true,
        itemResult: Object.freeze({ ...record.result.itemResult, exactReplay: true }),
      })
    : Object.freeze({ ...record.result, exactReplay: true })
}

const assertExactOperationReplay = (
  record: StoredItemExtendedActionRecord,
  command: ItemExtendedActionCommandV1,
): void => {
  const stored = command.kind === 'start' ? record.startCommand : record.terminalCommand
  if (!stored || itemExtendedActionCommandSha256(stored) !== itemExtendedActionCommandSha256(command)
    || stableJsonStringify(stored) !== stableJsonStringify(command)) {
    fail(409, 'This item Extended Action operation ID was already used for a different command.')
  }
}

const publish = (input: {
  readonly events: readonly PersistedRealtimeEvent[]
  readonly operation: string
  readonly dependencies: ManageItemExtendedActionDependencies
}): void => publishPersistedRealtimeEventsAfterCommit({
  events: input.events,
  operation: input.operation,
  publish: input.dependencies.publishPersistedRealtimeEvent ?? defaultPersistedRealtimeEventPublisher,
  reportFailure: input.dependencies.reportAfterCommitPublicationFailure
    ?? defaultPersistedRealtimePublicationFailureReporter,
})

const startActivity = (input: ManageItemExtendedActionInput & {
  readonly command: StartItemExtendedActionCommandV1
}, dependencies: ManageItemExtendedActionDependencies, runtime: RuntimeDependencies): ManageItemExtendedActionResponse => {
  authorizeTrainer({ role: input.role, playerProfile: input.playerProfile, trainerSlug: input.command.trainerSlug })
  const existingOperation = runtime.activityRepository.getByOperation(input.command.operationId)
  if (existingOperation) {
    assertExactOperationReplay(existingOperation, input.command)
    return {
      result: exactStartReplayResult(existingOperation),
      activity: project({ ...input, record: existingOperation, runtime }),
      sheets: [],
    }
  }
  if (runtime.activityRepository.get(input.command.activityId)) {
    fail(409, 'This item Extended Action activity identity is already in use.')
  }
  const persistedEvents: PersistedRealtimeEvent[] = []
  let concurrentReplay = false
  const record = runtime.database.withTransaction(() => {
    const concurrent = runtime.activityRepository.getByOperation(input.command.operationId)
    if (concurrent) {
      assertExactOperationReplay(concurrent, input.command)
      concurrentReplay = true
      return concurrent
    }
    if (runtime.activityRepository.findInProgressForTrainer(input.command.trainerSlug)) {
      fail(409, 'This Trainer already has an item Extended Action in progress.')
    }
    if (runtime.itemOperationRepository.get(input.command.settlementOperationId)) {
      fail(409, 'The settlement operation identity is already in use.')
    }
    const authority = loadTrainerSheetItemActionAuthority({
      role: input.role,
      playerProfile: input.playerProfile,
      trainerSlug: input.command.trainerSlug,
    }, {
      database: runtime.database,
      sheetRepository: runtime.sheetRepository,
      now: runtime.now,
    })
    if (authority.projection.trainerRevision !== input.command.trainerRevision) {
      fail(409, 'The Trainer inventory changed. Refresh before starting the Extended Action.')
    }
    const offer = authority.projection.offers.find(candidate => candidate.offerId === input.command.offerId)
      ?? fail(404, 'The declared item action is no longer available.')
    if (!offer.availability.enabled || !offer.actions.find(action => action.kind === 'use')?.enabled) {
      fail(409, offer.availability.unavailableReason?.label ?? 'The declared item action is unavailable.')
    }
    const campaignClock = runtime.campaignClockRepository.get()
    const authorized = attachSheetItemCommandTemplate({
      offer,
      trainerSheet: authority.trainerSheet,
      pokemonSheets: authority.pokemonSheets,
      trainerSheets: authority.trainerSheets,
      campaignClock,
    })
    const template = authorized.itemCommand
      ?? fail(409, 'The item source no longer has complete command authority.')
    const initialItemCommand = selectedCommand({
      template,
      operationId: input.command.settlementOperationId,
      offerId: offer.offerId,
      targetIds: input.command.targetIds,
      choiceSelections: input.command.choices ?? [],
      targeting: offer.targeting,
    })
    const sheets = persistedAuthoritySheets(authority, runtime.sheetRepository)
    let context
    try {
      context = buildAuthoritativeItemExecutionContext({
        role: input.role,
        playerProfile: input.playerProfile,
        command: initialItemCommand,
        map: null,
        mapRevision: null,
        authorityTimestamp: runtime.now(),
        persistedSheets: sheets,
        campaignClock,
        reservedSourceQuantity: runtime.itemOperationRepository.reservedQuantity(
          initialItemCommand.sourceInstanceId,
          initialItemCommand.operationId,
        ),
      })
    }
    catch (error) {
      if (error instanceof AuthoritativeItemExecutionContextError) {
        return fail(error.code === 'not-authorized' ? 403 : error.code === 'missing' ? 404 : 409, error.message)
      }
      throw error
    }
    const definition = context.sourceDefinition
    if (definition.spec.timing !== 'extended' || !definition.spec.contexts.includes('extended-action')) {
      fail(409, 'Only a reviewed Extended Action item can start durable activity work.')
    }
    const eligibility = deriveAuthoritativeItemExtendedActionDeclarationEligibility(context)
    if (!eligibility.available) fail(409, eligibility.reasons[0]?.label ?? 'This Extended Action cannot start.')
    if (runtime.activityRepository.findInProgressForSource(context.source.instanceId)) {
      fail(409, 'This item source already belongs to an Extended Action in progress.')
    }
    const targetSnapshots = context.targets.map(target => ({
      sheetKind: target.sheet.kind,
      sheetSlug: target.sheet.slug,
      displayLabel: targetLabel(target.sheet.sheet, target.sheet.kind),
    }))
    const created = runtime.activityRepository.create({
      startCommand: input.command,
      initialItemCommand,
      canonicalItemId: definition.canonicalId,
      canonicalDefinitionSha256: definition.definitionSha256,
      sourceDisplayLabel: context.source.displayLabel,
      actorDisplayLabel: actorLabel(context.actorSheet.sheet as TrainerSheet),
      targetSnapshots,
      startedContext: context.nonEncounter
        ?? fail(409, 'Extended Action declaration lost non-encounter authority.'),
      createdAt: runtime.now(),
    })
    persistedEvents.push(...runtime.realtimeEventRepository.appendMany([
      itemExtendedActionUpdatedRealtimeAppendInput({
        operationId: input.command.operationId,
        record: created,
        clientId: input.clientId,
      }),
    ]))
    return created
  })
  publish({ events: persistedEvents, operation: `item-extended-action-start:${record.activityId}`, dependencies })
  return {
    result: concurrentReplay ? exactStartReplayResult(record) : {
      schemaVersion: 1,
      operationId: input.command.operationId,
      activityId: record.activityId,
      status: 'in-progress',
      revision: record.revision,
      exactReplay: false,
      itemResult: null,
    },
    activity: project({ ...input, record, runtime }),
    sheets: [],
  }
}

const interruptActivity = (input: ManageItemExtendedActionInput & {
  readonly command: InterruptItemExtendedActionCommandV1
}, dependencies: ManageItemExtendedActionDependencies, runtime: RuntimeDependencies): ManageItemExtendedActionResponse => {
  const record = runtime.activityRepository.get(input.command.activityId)
    ?? fail(404, 'The item Extended Action was not found.')
  authorizeRecord({ ...input, record })
  const operationRecord = runtime.activityRepository.getByOperation(input.command.operationId)
  if (operationRecord) {
    assertExactOperationReplay(operationRecord, input.command)
    return {
      result: exactReplayResult(operationRecord),
      activity: project({ ...input, record: operationRecord, runtime }),
      sheets: [],
    }
  }
  if (record.status !== 'in-progress' || record.revision !== input.command.expectedRevision) {
    fail(409, 'The item Extended Action changed. Refresh before interrupting it.')
  }
  const persistedEvents: PersistedRealtimeEvent[] = []
  const settled = runtime.database.withTransaction(() => {
    const clock = runtime.campaignClockRepository.get()
    const result: ItemExtendedActionResultV1 = {
      schemaVersion: 1,
      operationId: input.command.operationId,
      activityId: record.activityId,
      status: 'interrupted',
      revision: record.revision + 1,
      exactReplay: false,
      itemResult: null,
    }
    const outcome = runtime.activityRepository.settle({
      activityId: record.activityId,
      expectedRevision: input.command.expectedRevision,
      command: input.command,
      result,
      status: 'interrupted',
      updatedAtCampaignMinute: clock.campaignMinute,
      updatedAt: runtime.now(),
    })
    if (outcome.kind !== 'applied') fail(409, 'The item Extended Action changed during interruption.')
    persistedEvents.push(...runtime.realtimeEventRepository.appendMany([
      itemExtendedActionUpdatedRealtimeAppendInput({
        operationId: input.command.operationId,
        record: outcome.record,
        clientId: input.clientId,
      }),
    ]))
    return outcome.record
  })
  publish({ events: persistedEvents, operation: `item-extended-action-interrupt:${settled.activityId}`, dependencies })
  return {
    result: settled.result ?? fail(409, 'Interrupted item Extended Action lost its receipt.'),
    activity: project({ ...input, record: settled, runtime }),
    sheets: [],
  }
}

const completeActivity = (input: ManageItemExtendedActionInput & {
  readonly command: CompleteItemExtendedActionCommandV1
}, dependencies: ManageItemExtendedActionDependencies, runtime: RuntimeDependencies): ManageItemExtendedActionResponse => {
  const record = runtime.activityRepository.get(input.command.activityId)
    ?? fail(404, 'The item Extended Action was not found.')
  authorizeRecord({ ...input, record })
  const operationRecord = runtime.activityRepository.getByOperation(input.command.operationId)
  if (operationRecord) {
    assertExactOperationReplay(operationRecord, input.command)
    return {
      result: exactReplayResult(operationRecord),
      activity: project({ ...input, record: operationRecord, runtime }),
      sheets: [],
    }
  }
  if (record.status !== 'in-progress' || record.revision !== input.command.expectedRevision) {
    fail(409, 'The item Extended Action changed. Refresh before completing it.')
  }
  if (runtime.itemOperationRepository.get(record.startCommand.settlementOperationId)) {
    fail(409, 'The activity settlement exists without matching terminal activity evidence.')
  }
  const current = currentActivitySettlement({
    role: input.role,
    playerProfile: input.playerProfile,
    record,
    settlementOperationId: record.startCommand.settlementOperationId,
    runtime,
  })
  const settleCompletedWithinTransaction = (settlement: {
    readonly result: ItemOperationResultV1
    readonly committedAt: number
  }): readonly PersistedRealtimeEvent[] => {
    const clock = runtime.campaignClockRepository.get()
    const activityResult: ItemExtendedActionResultV1 = {
      schemaVersion: 1,
      operationId: input.command.operationId,
      activityId: record.activityId,
      status: 'completed',
      revision: record.revision + 1,
      exactReplay: false,
      itemResult: settlement.result,
    }
    const settled = runtime.activityRepository.settle({
      activityId: record.activityId,
      expectedRevision: record.revision,
      command: input.command,
      result: activityResult,
      status: 'completed',
      updatedAtCampaignMinute: clock.campaignMinute,
      updatedAt: settlement.committedAt,
    })
    if (settled.kind !== 'applied') fail(409, 'The item Extended Action changed during completion.')
    return runtime.realtimeEventRepository.appendMany([
      itemExtendedActionUpdatedRealtimeAppendInput({
        operationId: input.command.operationId,
        record: settled.record,
        clientId: input.clientId,
      }),
    ])
  }
  const response = executeItemOperationUseCase({
    role: input.role,
    playerProfile: input.playerProfile,
    command: current.command,
    clientId: input.clientId,
  }, {
    database: runtime.database,
    sheetRepository: runtime.sheetRepository,
    campaignClockRepository: runtime.campaignClockRepository,
    operationRepository: runtime.itemOperationRepository,
    realtimeEventRepository: runtime.realtimeEventRepository,
    now: runtime.now,
    randomInt: dependencies.randomInt,
    failAfterWrite: dependencies.failAfterWrite,
    publishPersistedRealtimeEvent: dependencies.publishPersistedRealtimeEvent,
    reportAfterCommitPublicationFailure: dependencies.reportAfterCommitPublicationFailure,
    extendedActionAuthority: {
      activityId: record.activityId,
      activityRevision: record.revision,
      startedAtCampaignMinute: record.startedAtCampaignMinute,
      onAcceptedWithinTransaction: settleCompletedWithinTransaction,
      onPendingWithinTransaction: settleCompletedWithinTransaction,
    },
  })
  const settled = runtime.activityRepository.get(record.activityId)
    ?? fail(409, 'Completed item Extended Action was not readable after commit.')
  if (settled.status !== 'completed' || !settled.result) {
    fail(409, 'Item mechanics committed without matching Extended Action evidence.')
  }
  const result = settled.result
    ?? fail(409, 'Completed item Extended Action lost its terminal receipt.')
  return {
    result,
    activity: project({ ...input, record: settled, runtime }),
    sheets: response.sheets,
  }
}

export const manageItemExtendedActionUseCase = (
  input: ManageItemExtendedActionInput,
  dependencies: ManageItemExtendedActionDependencies = {},
): ManageItemExtendedActionResponse => {
  const command = parseCommand(input.command)
  const runtime = runtimeDependencies(dependencies)
  if (command.kind === 'start') return startActivity({ ...input, command }, dependencies, runtime)
  if (command.kind === 'interrupt') return interruptActivity({ ...input, command }, dependencies, runtime)
  return completeActivity({ ...input, command }, dependencies, runtime)
}

export const loadItemExtendedActionsUseCase = (
  input: LoadItemExtendedActionsInput,
  dependencies: ManageItemExtendedActionDependencies = {},
): readonly ItemExtendedActionProjectionV1[] => {
  authorizeTrainer(input)
  const runtime = runtimeDependencies(dependencies)
  const records = runtime.activityRepository.listForTrainer(input.trainerSlug)
  return Object.freeze(records.map((record) => {
    let unavailableReason: string | null = null
    if (record.status === 'in-progress') {
      try {
        currentActivitySettlement({
          role: input.role,
          playerProfile: input.playerProfile,
          record,
          settlementOperationId: record.startCommand.settlementOperationId,
          runtime,
        })
      }
      catch (error) {
        unavailableReason = error instanceof Error ? error.message : 'The Extended Action cannot currently complete.'
      }
    }
    return project({ ...input, record, runtime, unavailableReason })
  }))
}

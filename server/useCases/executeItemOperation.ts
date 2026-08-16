import { randomBytes, randomInt as secureRandomInt } from 'node:crypto'
import type { AuthRole } from '#shared/auth'
import { stableJsonStringify } from '#shared/automation/stableJson'
import type { PlayerProfile } from '#shared/playerProfiles'
import { parseUseItemCommand, type ItemAggregateRef, type ItemOperationResultV1, type UseItemCommandV1 } from '#shared/itemAutomation/operations'
import { parseSheetItemTargetId, type SheetItemActionOfferV1 } from '#shared/itemAutomation/sheetActions'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import type { GroupInventoryDocument } from '~/types/groupInventory'
import { toPersistableSheetPayload } from '~/utils/sheetMutations'
import { normalizeRevision, nextRevision } from '#shared/sessionRevisions'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import { createSqliteMapRepository, type MapRepository, type StoredMapDocument } from '../storage/mapRepository'
import { createSqliteSheetRepository, type PersistedSheet, type SheetRepository } from '../storage/sheetRepository'
import { createSqliteGroupInventoryRepository, type GroupInventoryRepository } from '../storage/groupInventoryRepository'
import { createSqliteCampaignClockRepository, type CampaignClockRepository } from '../storage/campaignClockRepository'
import {
  createSqliteItemOperationRepository,
  itemOperationCommandSha256,
  type ItemOperationCompensationV1,
  type ItemOperationRepository,
  type StoredItemOperationRecord,
} from '../storage/itemOperationRepository'
import { createSqliteRealtimeEventRepository, type RealtimeEventRepository } from '../storage/realtimeEventRepository'
import { createSqliteItemGuidedRequestRepository } from '../storage/itemGuidedRequestRepository'
import { buildEncounterPresentationProjection } from '../domain/encounterPresentation/buildProjection'
import { ITEM_AUTOMATION_RUNTIME_REGISTRY } from '../domain/itemAutomation/registry'
import {
  attachGroupInventoryItemCommandTemplate,
  attachSheetItemCommandTemplate,
} from '../domain/itemAutomation/sheetActionCommandTemplate'
import { AuthoritativeItemExecutionContextError, buildAuthoritativeItemExecutionContext } from '../domain/itemAutomation/executionContext'
import { deriveAuthoritativeItemEligibility, deriveAuthoritativeItemPendingEligibility } from '../domain/itemAutomation/eligibility'
import { buildItemPendingDecision, itemPendingDecisionNeedsInput } from '../domain/itemAutomation/pending'
import { planDeterministicItemOperation, planPendingItemReservation, type ItemPlanTarget } from '../domain/itemAutomation/planner'
import { reduceItemOperationPlan } from '../domain/itemAutomation/reducer'
import { assertItemRuntimePlanConformance } from '../domain/itemAutomation/conformance'
import { assertPlannedItemApDrainsCurrent } from '../domain/itemAutomation/ap'
import { playerProfileCanControlTokenSheet } from '#shared/playerProfileTokenControl'
import {
  itemOperationMapUpdatedRealtimeAppendInputs,
  itemOperationPresentationInvalidatedRealtimeAppendInput,
  itemOperationSheetUpdatedRealtimeAppendInputs,
} from '../realtime/itemOperationRealtime'
import { groupInventoryUpdatedRealtimeAppendInputs } from '../realtime/groupInventoryRealtime'
import {
  defaultPersistedRealtimeEventPublisher,
  defaultPersistedRealtimePublicationFailureReporter,
  publishPersistedRealtimeEventsAfterCommit,
  type PersistedRealtimeEventPublisher,
  type PersistedRealtimePublicationFailureReporter,
} from '../realtime/persistedBatchPublication'
import type { PersistedRealtimeEvent } from '#shared/realtimeEventLog'
import { toPersistedMap } from './saveMap'
import { UseCaseHttpError } from '../utils/useCaseErrors'
import { loadTrainerSheetItemActionAuthority } from './loadSheetItemActions'
import { loadGroupInventoryItemActionAuthority } from './loadGroupInventoryItemActions'
import { createEncounterEquipmentGrantQueries } from '../domain/moveAutomation/equipmentGrantQueries'
import { wonderLauncherDeliveryBindingId } from '../domain/itemAutomation/equipmentDelivery'
import { buildGuidedItemOperationAuthority } from '../domain/itemAutomation/guidedAdjudication'
import { itemGuidedRequestRealtimeAppendInputs } from '../realtime/itemGuidedRequestRealtime'

export class ExecuteItemOperationUseCaseError extends UseCaseHttpError<400 | 403 | 404 | 409> {}

export interface ExecuteItemOperationInput {
  readonly role: AuthRole
  readonly playerProfile?: PlayerProfile | null
  readonly command: unknown
  readonly clientId?: string
}

export interface ExecuteItemOperationResponse {
  readonly result: ItemOperationResultV1
  readonly map?: TabletopMap
  readonly sheets: readonly PersistedSheet[]
  readonly groupInventory?: GroupInventoryDocument
}

export interface ExecuteItemOperationDependencies {
  readonly database?: RotomDatabase
  readonly mapRepository?: Pick<MapRepository<TabletopMap>, 'get' | 'applyLivePlayUpdate'> & { readonly database?: RotomDatabase }
  readonly sheetRepository?: Pick<SheetRepository<Record<string, unknown>>, 'getByRef' | 'list' | 'applyLivePlayUpdate'> & { readonly database?: RotomDatabase }
  readonly groupInventoryRepository?: Pick<GroupInventoryRepository, 'get' | 'applyLivePlayUpdate'> & { readonly database?: RotomDatabase }
  readonly campaignClockRepository?: Pick<CampaignClockRepository, 'get'> & { readonly database?: RotomDatabase }
  readonly operationRepository?: Pick<ItemOperationRepository, 'get' | 'reservedQuantity' | 'createPending' | 'complete'>
  readonly realtimeEventRepository?: Pick<RealtimeEventRepository, 'appendMany'> & { readonly database?: RotomDatabase }
  readonly publishPersistedRealtimeEvent?: PersistedRealtimeEventPublisher
  readonly reportAfterCommitPublicationFailure?: PersistedRealtimePublicationFailureReporter
  readonly now?: () => number
  /** Test seam for server-owned rolled healing; maximum is exclusive. */
  readonly randomInt?: (minimum: number, maximumExclusive: number) => number
  /** Test seam for opaque guided-request identity. */
  readonly guidedRequestId?: () => string
  /** Server-only activity authority. Public commands can never establish this boundary. */
  readonly extendedActionAuthority?: {
    readonly activityId: string
    readonly activityRevision: number
    readonly startedAtCampaignMinute: number
    readonly onAcceptedWithinTransaction: (input: {
      readonly result: ItemOperationResultV1
      readonly committedAt: number
    }) => readonly PersistedRealtimeEvent[] | void
    readonly onPendingWithinTransaction?: (input: {
      readonly result: Extract<ItemOperationResultV1, { readonly status: 'pending' }>
      readonly committedAt: number
    }) => readonly PersistedRealtimeEvent[] | void
  }
  readonly failAfterWrite?: (boundary: 'map' | 'sheet' | 'group-inventory' | 'operation' | 'realtime') => void
}

type LoadedSheet = PersistedSheet & { readonly sheet: Record<string, unknown> }

const fail = (statusCode: 400 | 403 | 404 | 409, message: string): never => {
  throw new ExecuteItemOperationUseCaseError(statusCode, message)
}

const databaseFor = (dependencies: ExecuteItemOperationDependencies): RotomDatabase => {
  const candidates = [dependencies.database, dependencies.mapRepository?.database, dependencies.sheetRepository?.database,
    dependencies.groupInventoryRepository?.database, dependencies.campaignClockRepository?.database,
    dependencies.realtimeEventRepository?.database].filter(Boolean) as RotomDatabase[]
  const database = candidates[0] ?? getRotomDatabase()
  if (candidates.some(candidate => candidate !== database)) throw new Error('Item operation repositories must share one RotomDatabase transaction.')
  return database
}

const aggregateKey = (ref: ItemAggregateRef): string => ref.kind === 'sheet'
  ? `${ref.kind}:${ref.sheetKind}:${ref.id}` : `${ref.kind}:${ref.id}`

const currentSheet = (repository: ExecuteItemOperationDependencies['sheetRepository'], kind: 'pokemon' | 'trainer', slug: string): LoadedSheet => {
  const sheet = repository!.getByRef(kind, slug)
  return sheet as LoadedSheet | null ?? fail(404, `Item operation sheet ${kind}/${slug} was not found.`)
}

const loadTargetSheets = (input: {
  readonly command: UseItemCommandV1
  readonly map: TabletopMap | null
  readonly sheetRepository: NonNullable<ExecuteItemOperationDependencies['sheetRepository']>
}): { readonly targets: readonly ItemPlanTarget[], readonly sheets: ReadonlyMap<string, LoadedSheet> } => {
  const sheets = new Map<string, LoadedSheet>()
  const add = (kind: 'pokemon' | 'trainer', slug: string): LoadedSheet => {
    const key = `sheet:${kind}:${slug}`
    const existing = sheets.get(key)
    if (existing) return existing
    const value = currentSheet(input.sheetRepository, kind, slug)
    sheets.set(key, value)
    return value
  }
  add(input.command.actorSheet.kind, input.command.actorSheet.slug)
  for (const ref of input.command.readSet) {
    if (ref.kind === 'sheet') add(ref.sheetKind, ref.id)
  }
  const targets: ItemPlanTarget[] = []
  for (const participantId of input.command.targetIds) {
    const targetRef = input.command.context === 'encounter' ? null : parseSheetItemTargetId(participantId)
    const placement = input.command.context === 'encounter'
      ? input.map?.placements.find(candidate => candidate.id === participantId) ?? null
      : targetRef ? {
          id: participantId,
          sheetKind: targetRef.kind,
          sheetSlug: targetRef.slug,
          position: { x: 0, y: 0, z: 0 },
        } : null
    const resolvedPlacement = placement ?? fail(409, input.command.context === 'encounter'
      ? `Item target ${participantId} is no longer on the map.`
      : 'A non-encounter item target no longer has valid sheet authority.')
    const sheet = add(resolvedPlacement.sheetKind, resolvedPlacement.sheetSlug)
    targets.push({
      participantId, sheetKind: resolvedPlacement.sheetKind, sheetSlug: resolvedPlacement.sheetSlug,
      revision: sheet.revision, sheet: sheet.sheet as unknown as CharacterSheet | TrainerSheet,
    })
  }
  return { targets, sheets }
}

const assertReadSet = (input: {
  readonly command: UseItemCommandV1
  readonly mapStored: StoredMapDocument<TabletopMap> | null
  readonly sheets: ReadonlyMap<string, LoadedSheet>
  readonly groupInventory: GroupInventoryDocument | null
  readonly campaignClock: { readonly revision: number } | null
}): void => {
  const seen = new Set<string>()
  for (const ref of input.command.readSet) {
    const key = aggregateKey(ref)
    if (seen.has(key)) fail(400, 'Item command read set contains a duplicate aggregate.')
    seen.add(key)
    if (ref.kind === 'map' || ref.kind === 'encounter') {
      if (!input.mapStored || input.mapStored.slug !== ref.id || input.mapStored.revision !== ref.revision) fail(409, 'The encounter map changed. Refresh before retrying.')
    }
    else if (ref.kind === 'sheet') {
      const sheet = input.sheets.get(`sheet:${ref.sheetKind}:${ref.id}`)
      if (!sheet || sheet.revision !== ref.revision) fail(409, `Item operation sheet ${ref.sheetKind}/${ref.id} changed.`)
    }
    else if (ref.kind === 'group-inventory') {
      if (!input.groupInventory || input.groupInventory.slug !== ref.id || input.groupInventory.revision !== ref.revision) fail(409, 'The group inventory changed. Refresh before retrying.')
    }
    else if (ref.kind === 'campaign-clock') {
      if (!input.campaignClock || input.campaignClock.revision !== ref.revision) fail(409, 'The campaign clock changed. Refresh before retrying.')
    }
    else fail(409, `Item operation aggregate ${ref.kind} is not available in this runtime.`)
  }
}

const assertCurrentReadSetAtCommit = (input: {
  readonly command: UseItemCommandV1
  readonly mapRepository: NonNullable<ExecuteItemOperationDependencies['mapRepository']>
  readonly sheetRepository: NonNullable<ExecuteItemOperationDependencies['sheetRepository']>
  readonly groupInventoryRepository: NonNullable<ExecuteItemOperationDependencies['groupInventoryRepository']>
  readonly campaignClockRepository: NonNullable<ExecuteItemOperationDependencies['campaignClockRepository']>
}): void => {
  for (const ref of input.command.readSet) {
    if (ref.kind === 'map' || ref.kind === 'encounter') {
      if (input.mapRepository.get(ref.id)?.revision !== ref.revision) fail(409, 'The encounter map changed before item operation commit.')
    }
    else if (ref.kind === 'sheet') {
      if (input.sheetRepository.getByRef(ref.sheetKind, ref.id)?.revision !== ref.revision) {
        fail(409, `Item operation sheet ${ref.sheetKind}/${ref.id} changed before commit.`)
      }
    }
    else if (ref.kind === 'group-inventory') {
      if (input.groupInventoryRepository.get(ref.id)?.revision !== ref.revision) fail(409, 'The group inventory changed before item operation commit.')
    }
    else if (ref.kind === 'campaign-clock') {
      if (input.campaignClockRepository.get().revision !== ref.revision) fail(409, 'The campaign clock changed before item operation commit.')
    }
    else fail(409, `Item operation aggregate ${ref.kind} cannot be revision-checked at commit.`)
  }
}

const authorizeActor = (input: ExecuteItemOperationInput, command: UseItemCommandV1): void => {
  if (input.role === 'gm') return
  if (!playerProfileCanControlTokenSheet(input.playerProfile, command.actorSheet.kind, command.actorSheet.slug)) {
    fail(403, 'The selected player profile does not control the item actor.')
  }
}

const assertCurrentSheetActionTargets = (
  offer: SheetItemActionOfferV1,
  command: UseItemCommandV1,
): void => {
  const targeting = offer.targeting
  const options = new Map((targeting?.options ?? []).map(option => [option.targetId, option]))
  if (targeting) {
    if (command.targetIds.length < targeting.minimum || command.targetIds.length > targeting.maximum
      || command.targetIds.some(targetId => options.get(targetId)?.enabled !== true)) {
      fail(409, 'One or more sheet item targets are no longer authorized.')
    }
    const targetDeclaration = command.choices.find(choice => choice.choiceId === targeting.requirementId)
    if (!targetDeclaration
      || stableJsonStringify(targetDeclaration.optionIds) !== stableJsonStringify(command.targetIds)) {
      fail(409, 'The sheet item target declaration does not match its authorized options.')
    }
    const projectedChoices = command.targetIds.length === 1
      ? options.get(command.targetIds[0]!)?.choices ?? []
      : []
    const selections = command.choices.filter(choice => choice.choiceId !== targeting.requirementId)
    if (selections.some(selection => !projectedChoices.some(choice => choice.choiceId === selection.choiceId))) {
      fail(409, 'The sheet item command contains an unknown target-specific choice.')
    }
    for (const choice of projectedChoices) {
      const selected = selections.find(value => value.choiceId === choice.choiceId)?.optionIds ?? []
      if (selected.length < choice.minimum || selected.length > choice.maximum
        || new Set(selected).size !== selected.length
        || selected.some(optionId => !choice.options.some(option => option.optionId === optionId))) {
        fail(409, `The sheet item choice ${choice.label} is no longer authorized.`)
      }
    }
  }
  else if (command.targetIds.length > 0 || command.choices.length > 0) {
    fail(409, 'This sheet item action does not accept target choices.')
  }
}

/** Returns true only when current shared-custody delegation was reauthorized. */
const assertCurrentSheetActionOffer = (input: {
  readonly role: AuthRole
  readonly playerProfile?: PlayerProfile | null
  readonly command: UseItemCommandV1
  readonly database: RotomDatabase
  readonly sheetRepository: NonNullable<ExecuteItemOperationDependencies['sheetRepository']>
  readonly operationRepository: NonNullable<ExecuteItemOperationDependencies['operationRepository']>
  readonly campaignClock: { readonly revision: number }
  readonly now: () => number
}): boolean => {
  if ((input.command.context !== 'sheet' && input.command.context !== 'extended-action')
    || input.command.actorSheet.kind !== 'trainer'
    || input.command.actorParticipantId !== null) {
    fail(409, 'Sheet item use requires current Trainer actor authority.')
  }
  let offer: SheetItemActionOfferV1
  let template: UseItemCommandV1 | undefined
  if (input.command.source.kind === 'trainer') {
    const authority = loadTrainerSheetItemActionAuthority({
      role: input.role,
      playerProfile: input.playerProfile,
      trainerSlug: input.command.actorSheet.slug,
    }, {
      database: input.database,
      sheetRepository: input.sheetRepository,
      now: input.now,
    })
    offer = authority.projection.offers.find(candidate => candidate.offerId === input.command.offerId)
      ?? fail(409, 'The projected sheet item action is stale or no longer authorized.')
    template = attachSheetItemCommandTemplate({
      offer,
      trainerSheet: authority.trainerSheet,
      pokemonSheets: authority.pokemonSheets,
      trainerSheets: authority.trainerSheets,
      campaignClock: input.campaignClock,
    }).itemCommand
  }
  else {
    if (input.command.context !== 'sheet') {
      fail(409, 'Shared inventory Extended Actions require Trainer custody before they start.')
    }
    const authority = loadGroupInventoryItemActionAuthority({
      role: input.role,
      playerProfile: input.playerProfile,
      groupSlug: input.command.source.slug,
      actorSlug: input.command.actorSheet.slug,
    }, {
      database: input.database,
      sheetRepository: input.sheetRepository,
      itemOperationRepository: input.operationRepository,
      now: input.now,
    })
    const trainerSheet = authority.trainerSheet
      ?? fail(409, 'The shared item actor is no longer authorized.')
    offer = authority.projection.offers.find(candidate => candidate.offerId === input.command.offerId)
      ?? fail(409, 'The projected shared item action is stale or no longer authorized.')
    template = attachGroupInventoryItemCommandTemplate({
      offer,
      groupInventory: authority.groupInventory,
      trainerSheet,
      pokemonSheets: authority.pokemonSheets,
      trainerSheets: authority.trainerSheets,
      campaignClock: input.campaignClock,
    }).itemCommand
  }
  const useAction = offer.actions.find(action => action.kind === 'use')
  if (!offer.availability.enabled || !useAction?.enabled) {
    fail(409, useAction?.unavailableReason?.label
      ?? offer.availability.unavailableReason?.label
      ?? 'The projected sheet item action is stale or no longer authorized.')
  }
  if (!template
    || stableJsonStringify(template.actorSheet) !== stableJsonStringify(input.command.actorSheet)
    || stableJsonStringify(template.source) !== stableJsonStringify(input.command.source)
    || stableJsonStringify(template.readSet) !== stableJsonStringify(input.command.readSet)) {
    fail(409, 'The sheet item command authority changed. Refresh before retrying.')
  }
  assertCurrentSheetActionTargets(offer, input.command)
  return input.command.source.kind === 'group'
}

const exactReplayResult = (result: ItemOperationResultV1): ItemOperationResultV1 => Object.freeze({ ...result, exactReplay: true })

const replayStoredOperation = (
  stored: StoredItemOperationRecord,
  command: UseItemCommandV1,
): ItemOperationResultV1 => {
  if (stored.commandSha256 !== itemOperationCommandSha256(command)
    || stableJsonStringify(stored.command) !== stableJsonStringify(command)) {
    fail(409, 'This item operation ID was already used for a different command.')
  }
  if (stored.result) return exactReplayResult(stored.result)
  if (stored.pendingDecision) return {
    schemaVersion: 1,
    operationId: stored.operationId,
    status: 'pending',
    canonicalItemId: stored.canonicalItemId ?? fail(409, 'Pending item operation lost canonical identity.'),
    decisionId: stored.pendingDecision.decisionId,
    reservationId: stored.pendingDecision.reservation?.reservationId ?? null,
    exactReplay: true,
  }
  return fail(409, 'This item operation is pending recovery and cannot be replayed as a new command.')
}

export const executeItemOperationUseCase = (
  input: ExecuteItemOperationInput,
  dependencies: ExecuteItemOperationDependencies = {},
): ExecuteItemOperationResponse => {
  let command: UseItemCommandV1
  try { command = parseUseItemCommand(input.command) }
  catch { return fail(400, 'Invalid item operation command.') }
  authorizeActor(input, command)
  const database = databaseFor(dependencies)
  const mapRepository = dependencies.mapRepository ?? createSqliteMapRepository<TabletopMap>(database)
  const sheetRepository = dependencies.sheetRepository ?? createSqliteSheetRepository<Record<string, unknown>>(database)
  const groupInventoryRepository = dependencies.groupInventoryRepository ?? createSqliteGroupInventoryRepository(database)
  const campaignClockRepository = dependencies.campaignClockRepository ?? createSqliteCampaignClockRepository(database)
  const operationRepository = dependencies.operationRepository ?? createSqliteItemOperationRepository({ database })
  const realtimeRepository = dependencies.realtimeEventRepository ?? createSqliteRealtimeEventRepository({ database })
  const now = dependencies.now ?? Date.now
  const persistedEvents: PersistedRealtimeEvent[] = []

  const existing = operationRepository.get(command.operationId)
  if (existing) return { result: replayStoredOperation(existing, command), sheets: [] }

  const mapRef = command.readSet.find(ref => ref.kind === 'map')
  const mapStored = mapRef ? mapRepository.get(mapRef.id) : null
  const map = mapStored?.document ?? null
  if (command.context === 'encounter') {
    if (!mapRef || !mapStored || !command.offerId) fail(409, 'Encounter item use requires a current authoritative item offer.')
    const pokemonSheets = sheetRepository.list('pokemon').map(value => value.document as unknown as CharacterSheet)
    const trainerSheets = sheetRepository.list('trainer').map(value => value.document as unknown as TrainerSheet)
    const currentProjection = buildEncounterPresentationProjection({
      role: input.role,
      playerProfile: input.playerProfile,
      map: map!,
      mapRevision: mapStored!.revision,
      pokemonSheets,
      trainerSheets,
      generatedAt: now(),
    })
    const expectedActionId = command.delivery?.kind === 'wonder-launcher'
      ? `item.use.wonder-launcher:${command.sourceInstanceId}`
      : `item.use:${command.sourceInstanceId}`
    const offer = currentProjection.offers.find(candidate => candidate.offerId === command.offerId)
    if (!offer || offer.actor.participantId !== command.actorParticipantId
      || offer.source.sourceKind !== 'item'
      || offer.source.instanceId !== command.sourceInstanceId
      || offer.intent.actionId !== expectedActionId
      || offer.availability.status !== 'available') {
      fail(409, 'The projected item offer is stale or no longer authorized.')
    }
    const projectedTargets = new Map((offer!.selectionOptions ?? [])
      .filter(option => option.kind === 'participant')
      .map(option => [option.value, option]))
    if (command.targetIds.some(targetId => {
      const option = projectedTargets.get(targetId)
      return !option || option.disabled
    })) {
      fail(409, 'One or more projected item targets are stale or no longer authorized.')
    }
    if (command.delivery) {
      const launcherSources = createEncounterEquipmentGrantQueries({
        map: map!,
        sheets: [
          ...pokemonSheets.map(sheet => ({ kind: 'pokemon' as const, slug: sheet.slug, sheet })),
          ...trainerSheets.map(sheet => ({ kind: 'trainer' as const, slug: sheet.slug, sheet })),
        ],
      }).resolve(command.actorParticipantId!)?.active.filter(entry => entry.grant.kind === 'action'
        && entry.grant.actionId === 'equipment.wonder-launcher.apply'
        && entry.grant.executionStatus === 'native') ?? []
      const launcher = launcherSources.length === 1 ? launcherSources[0]! : null
      const currentBinding = launcher ? wonderLauncherDeliveryBindingId({
        instanceId: launcher.instanceId,
        instanceRevision: launcher.instanceRevision,
        actorKind: 'trainer',
        actorSlug: command.actorSheet.slug,
        actorRevision: command.actorSheet.expectedRevision,
        mapSlug: map!.slug,
        mapRevision: mapStored!.revision,
      }) : null
      if (currentBinding !== command.delivery.equipmentBindingId) {
        fail(409, 'Wonder Launcher authority changed. Refresh before retrying.')
      }
    }
  }
  if (command.context === 'encounter' && (!map || !command.actorParticipantId
    || !map.placements.some(placement => placement.id === command.actorParticipantId
      && placement.sheetKind === command.actorSheet.kind && placement.sheetSlug === command.actorSheet.slug))) {
    fail(409, 'The item actor no longer matches the authoritative encounter placement.')
  }
  if (dependencies.extendedActionAuthority && command.context !== 'extended-action') {
    fail(409, 'Durable Extended Action authority cannot be attached to another item context.')
  }
  if (command.context !== 'encounter' && command.context !== 'sheet'
    && !(command.context === 'extended-action' && dependencies.extendedActionAuthority)) {
    fail(409, 'This non-encounter item context requires a current server-declared workflow offer.')
  }
  if (command.context === 'extended-action' && !dependencies.extendedActionAuthority) {
    fail(409, 'Extended Action item completion requires durable server activity authority.')
  }
  let groupInventoryUseAuthorized = false
  if (command.context === 'sheet' || command.context === 'extended-action') {
    groupInventoryUseAuthorized = assertCurrentSheetActionOffer({
      role: input.role,
      playerProfile: input.playerProfile,
      command,
      database,
      sheetRepository,
      operationRepository,
      campaignClock: campaignClockRepository.get(),
      now,
    })
  }
  const loaded = loadTargetSheets({ command, map, sheetRepository })
  const sourceTrainer = command.source.kind === 'trainer'
    ? loaded.sheets.get(`sheet:trainer:${command.source.slug}`) ?? currentSheet(sheetRepository, 'trainer', command.source.slug)
    : null
  const allSheets = new Map(loaded.sheets)
  if (sourceTrainer) allSheets.set(`sheet:trainer:${sourceTrainer.slug}`, sourceTrainer)
  const groupStored = command.source.kind === 'group' ? groupInventoryRepository.get(command.source.slug) : null
  const groupInventory = groupStored?.document ?? null
  const campaignClock = command.readSet.some(ref => ref.kind === 'campaign-clock')
    ? campaignClockRepository.get()
    : null
  assertReadSet({ command, mapStored, sheets: allSheets, groupInventory, campaignClock })

  let context
  try {
    context = buildAuthoritativeItemExecutionContext({
      role: input.role,
      playerProfile: input.playerProfile,
      command,
      map,
      mapRevision: mapStored?.revision ?? null,
      authorityTimestamp: now(),
      persistedSheets: [...allSheets.values()],
      groupInventory,
      campaignClock,
      groupInventoryUseAuthorized,
      reservedSourceQuantity: operationRepository.reservedQuantity(command.sourceInstanceId, command.operationId),
      extendedAction: dependencies.extendedActionAuthority ? {
        phase: 'completion',
        activityId: dependencies.extendedActionAuthority.activityId,
        activityRevision: dependencies.extendedActionAuthority.activityRevision,
        startedAtCampaignMinute: dependencies.extendedActionAuthority.startedAtCampaignMinute,
      } : null,
    })
  }
  catch (error) {
    if (error instanceof AuthoritativeItemExecutionContextError) {
      const status = error.code === 'not-authorized' ? 403 : error.code === 'missing' ? 404 : 409
      return fail(status, error.message)
    }
    throw error
  }
  const pendingEligibility = deriveAuthoritativeItemPendingEligibility(context)
  if (!pendingEligibility.available) fail(409, pendingEligibility.reasons[0]?.label ?? 'The item is no longer eligible for this use.')
  const definition = context.sourceDefinition
  const pendingDecision = definition.spec.targets.length > 0 || definition.spec.choices.length > 0
    ? buildItemPendingDecision({ command, definition, source: context.source, legalTargets: pendingEligibility.legalTargets })
    : null
  if (pendingDecision && itemPendingDecisionNeedsInput(command, pendingDecision)) {
    const reservationPlan = planPendingItemReservation({
      command,
      definition,
      source: context.source,
      targets: [],
      campaignMinute: context.campaignClock?.campaignMinute,
      nonEncounterContext: context.nonEncounter,
    })
    database.withTransaction(() => {
      const committedAt = now()
      operationRepository.createPending({
        command,
        canonicalItemId: definition.canonicalId,
        canonicalDefinitionSha256: definition.definitionSha256,
        plan: reservationPlan,
        pendingDecision,
        createdAt: committedAt,
      })
      const pendingResult: Extract<ItemOperationResultV1, { readonly status: 'pending' }> = {
        schemaVersion: 1,
        operationId: command.operationId,
        status: 'pending',
        canonicalItemId: definition.canonicalId,
        decisionId: pendingDecision.decisionId,
        reservationId: pendingDecision.reservation?.reservationId ?? null,
        exactReplay: false,
      }
      if (definition.spec.implementationState === 'guided') {
        const target = context.targets.length === 1 ? context.targets[0] : undefined
        const guidedTarget = target ?? fail(409, 'Guided item declaration lost its exact target authority.')
        const guidedTargetChoice = pendingDecision.choices.find(choice => choice.kind === 'participant')
          ?? fail(409, 'Guided item declaration lost its exact target choice authority.')
        if (!pendingDecision.choices.some(choice => choice.kind === 'gm-adjudication')) {
          fail(409, 'Guided item declaration lost its GM decision authority.')
        }
        const actorSheet = context.actorSheet.sheet
        const actorLabel = context.actorSheet.kind === 'trainer'
          ? (actorSheet as TrainerSheet).name?.trim() || context.actorSheet.slug
          : (actorSheet as CharacterSheet).nickname?.trim()
            || (actorSheet as CharacterSheet).species?.trim() || context.actorSheet.slug
        const targetLabel = guidedTarget.sheet.kind === 'trainer'
          ? (guidedTarget.sheet.sheet as TrainerSheet).name?.trim() || guidedTarget.sheet.slug
          : (guidedTarget.sheet.sheet as CharacterSheet).nickname?.trim()
            || (guidedTarget.sheet.sheet as CharacterSheet).species?.trim() || guidedTarget.sheet.slug
        const guidedRequests = createSqliteItemGuidedRequestRepository({ database, now })
        const requestId = dependencies.guidedRequestId?.()
          ?? `item-guided:v1:${randomBytes(16).toString('hex')}`
        const guidedAuthority = buildGuidedItemOperationAuthority({
          definition,
          itemOperationId: command.operationId,
          decisionId: pendingDecision.decisionId,
          targetChoiceId: guidedTargetChoice.choiceId,
          actorLabel,
          targetLabel,
          targetKind: guidedTarget.sheet.kind,
          sourceDisplayLabel: context.source.displayLabel,
        })
        const guidedRecord = guidedRequests.create({
          requestId,
          requestKind: guidedAuthority.sourceKind === 'item-operation'
            && 'campaignToolChoiceId' in guidedAuthority
            ? 'campaign-tool-adjudication'
            : 'loyalty-consequence',
          canonicalItemId: definition.canonicalId,
          canonicalDefinitionSha256: definition.definitionSha256,
          declarationPrincipalKey: input.role === 'gm' ? 'gm' : input.playerProfile?.id ?? fail(403, 'Guided item declaration requires an authenticated player profile.'),
          actorKind: context.actorSheet.kind,
          actorSlug: context.actorSheet.slug,
          targetKind: guidedTarget.sheet.kind,
          targetSlug: guidedTarget.sheet.slug,
          itemOperationId: command.operationId,
          declarationOperationId: command.operationId,
          declarationCommand: {
            schemaVersion: 1,
            kind: 'item-operation',
            itemOperationId: command.operationId,
          },
          authority: guidedAuthority,
          createdAt: committedAt,
        })
        persistedEvents.push(...realtimeRepository.appendMany(itemGuidedRequestRealtimeAppendInputs({
          operationId: command.operationId,
          record: guidedRecord,
          clientId: input.clientId,
        })))
      }
      const activityEvents = dependencies.extendedActionAuthority?.onPendingWithinTransaction?.({
        result: pendingResult,
        committedAt,
      })
      if (activityEvents) persistedEvents.push(...activityEvents)
      if (map) persistedEvents.push(...realtimeRepository.appendMany([
        itemOperationPresentationInvalidatedRealtimeAppendInput({
          operationId: command.operationId,
          mapSlug: map.slug,
          mapRevision: mapStored?.revision ?? normalizeRevision(map.revision),
          clientId: input.clientId,
        }),
      ]))
    })
    publishPersistedRealtimeEventsAfterCommit({
      events: persistedEvents,
      operation: `item-operation-pending:${command.operationId}`,
      publish: dependencies.publishPersistedRealtimeEvent ?? defaultPersistedRealtimeEventPublisher,
      reportFailure: dependencies.reportAfterCommitPublicationFailure ?? defaultPersistedRealtimePublicationFailureReporter,
    })
    return {
      result: {
        schemaVersion: 1,
        operationId: command.operationId,
        status: 'pending',
        canonicalItemId: definition.canonicalId,
        decisionId: pendingDecision.decisionId,
        reservationId: pendingDecision.reservation?.reservationId ?? null,
        exactReplay: false,
      },
      sheets: [],
    }
  }
  const eligibility = deriveAuthoritativeItemEligibility(context)
  if (!eligibility.available) fail(409, eligibility.reasons[0]?.label ?? 'The item is no longer eligible for this use.')
  if (!ITEM_AUTOMATION_RUNTIME_REGISTRY.resolve(definition.canonicalId)
    || ITEM_AUTOMATION_RUNTIME_REGISTRY.require(definition.canonicalId).definitionSha256 !== definition.definitionSha256) {
    fail(409, 'The canonical item definition changed. Refresh before retrying.')
  }
  const plannedAt = now()
  const plan = planDeterministicItemOperation({
    command,
    definition,
    source: context.source,
    targets: eligibility.selectedTargets.map(target => ({
      participantId: target.participantId,
      sheetKind: target.sheet.kind,
      sheetSlug: target.sheet.slug,
      revision: target.sheet.revision,
      sheet: target.sheet.sheet,
    })),
    actorSheet: context.actorSheet.sheet,
    map: context.map,
    campaignMinute: context.campaignClock?.campaignMinute,
    operationTimestamp: plannedAt,
    nonEncounterContext: context.nonEncounter,
    rollHealingDie: sides => (dependencies.randomInt ?? secureRandomInt)(1, sides + 1),
  })
  const reduced = reduceItemOperationPlan({
    plan,
    map,
    sheets: new Map([...allSheets].map(([key, value]) => [key.replace(/^sheet:/, ''), value.sheet as unknown as CharacterSheet | TrainerSheet])),
    groupInventory,
  })

  let acceptedMap: TabletopMap | undefined
  const acceptedSheets: PersistedSheet[] = []
  let acceptedGroupInventory: GroupInventoryDocument | undefined
  const touched = new Set(plan.operations.map(operation => {
    const key = aggregateKey(operation.aggregate)
    return key.startsWith('encounter:') ? `map:${key.slice('encounter:'.length)}` : key
  }))
  const expectedWrites = new Set([
    ...(reduced.mapChanged ? [`map:${mapStored?.slug ?? ''}`] : []),
    ...reduced.changedSheetKeys.map(key => `sheet:${key}`),
    ...(reduced.groupInventoryChanged && groupInventory ? [`group-inventory:${groupInventory.slug}`] : []),
  ])
  if (expectedWrites.size !== touched.size || [...expectedWrites].some(key => !touched.has(key))) {
    fail(409, 'Item operation write set does not match its deterministic plan.')
  }
  const result = database.withTransaction((): ItemOperationResultV1 => {
    const concurrentReplay = operationRepository.get(command.operationId)
    if (concurrentReplay) return replayStoredOperation(concurrentReplay, command)
    assertCurrentReadSetAtCommit({
      command, mapRepository, sheetRepository, groupInventoryRepository, campaignClockRepository,
    })
    const committedAt = now()
    try {
      assertPlannedItemApDrainsCurrent({
        plan,
        sheets: new Map([...allSheets].map(([key, value]) => [
          key.replace(/^sheet:/, ''), value.sheet as unknown as CharacterSheet | TrainerSheet,
        ])),
        now: committedAt,
      })
    }
    catch { fail(409, 'The item actor AP changed before item operation commit.') }
    const compensation: ItemOperationCompensationV1 = {
      schemaVersion: 1,
      map: reduced.mapChanged && reduced.map && mapStored ? {
        slug: mapStored.slug,
        beforeRevision: mapStored.revision,
        afterRevision: nextRevision(mapStored.revision),
        beforeMap: structuredClone(mapStored.document) as unknown as Record<string, unknown>,
        afterMap: structuredClone({
          ...toPersistedMap(
            reduced.map,
            reduced.map.folder ?? '',
            committedAt,
            { revision: nextRevision(mapStored.revision) },
          ),
          shopInterfaces: reduced.map.shopInterfaces ?? [],
        }) as unknown as Record<string, unknown>,
      } : null,
      sheets: reduced.changedSheetKeys.map(key => {
        const [kind, slug] = key.split(':') as ['pokemon' | 'trainer', string]
        const before = allSheets.get(`sheet:${key}`) ?? fail(404, `Item operation sheet ${key} disappeared.`)
        const after = reduced.sheets.get(key) ?? fail(409, `Item operation reduction omitted sheet ${key}.`)
        return {
          kind, slug, beforeRevision: before.revision, afterRevision: nextRevision(before.revision),
          beforeSheet: structuredClone(before.sheet),
          afterSheet: structuredClone({
            ...toPersistableSheetPayload({
              ...after,
              revision: nextRevision(before.revision),
              updatedAt: committedAt,
            }),
            folder: before.sheet.folder ?? '',
          }),
        }
      }),
      groupInventory: reduced.groupInventoryChanged && reduced.groupInventory && groupInventory ? {
        slug: groupInventory.slug,
        beforeRevision: groupInventory.revision,
        afterRevision: nextRevision(groupInventory.revision),
        beforeDocument: structuredClone(groupInventory) as unknown as Record<string, unknown>,
        afterDocument: structuredClone({
          ...reduced.groupInventory,
          revision: nextRevision(groupInventory.revision),
          updatedAt: committedAt,
        }) as unknown as Record<string, unknown>,
      } : null,
    }
    assertItemRuntimePlanConformance({ definition, plan, compensation, command })
    const pending = operationRepository.createPending({
      command,
      canonicalItemId: definition.canonicalId,
      canonicalDefinitionSha256: definition.definitionSha256,
      plan,
      compensation,
      createdAt: committedAt,
    })
    if (reduced.mapChanged && reduced.map && mapStored) {
      const nextMap = toPersistedMap(reduced.map, reduced.map.folder ?? '', committedAt, { revision: nextRevision(mapStored.revision) })
      if (mapRepository.applyLivePlayUpdate({ slug: mapStored.slug, expectedRevision: mapStored.revision, nextMap }) === 'stale') fail(409, 'The map changed during item operation commit.')
      acceptedMap = mapRepository.get(mapStored.slug)?.document
      if (!acceptedMap) fail(404, 'The map was unavailable after item operation commit.')
      dependencies.failAfterWrite?.('map')
    }
    for (const key of reduced.changedSheetKeys) {
      const [kind, slug] = key.split(':') as ['pokemon' | 'trainer', string]
      const before = allSheets.get(`sheet:${key}`) ?? fail(404, `Item operation sheet ${key} disappeared.`)
      const after = reduced.sheets.get(key) ?? fail(409, `Item operation reduction omitted sheet ${key}.`)
      const nextSheet = toPersistableSheetPayload({ ...after, updatedAt: committedAt })
      if (sheetRepository.applyLivePlayUpdate({ kind, slug, expectedRevision: before.revision, nextSheet, sourceOperationId: command.operationId }) === 'stale') fail(409, `Item operation sheet ${key} changed during commit.`)
      acceptedSheets.push(currentSheet(sheetRepository, kind, slug))
      dependencies.failAfterWrite?.('sheet')
    }
    if (reduced.groupInventoryChanged && reduced.groupInventory && groupInventory) {
      const update = groupInventoryRepository.applyLivePlayUpdate({
        slug: groupInventory.slug,
        expectedRevision: groupInventory.revision,
        nextDocument: { ...reduced.groupInventory, updatedAt: committedAt },
        now: committedAt,
      })
      if (update.status === 'applied') acceptedGroupInventory = update.document
      else fail(409, 'The group inventory changed during item operation commit.')
      dependencies.failAfterWrite?.('group-inventory')
    }
    const aggregateRefs = plan.readSet.map(ref => {
      if ((ref.kind === 'map' || ref.kind === 'encounter') && acceptedMap) return { ...ref, revision: normalizeRevision(acceptedMap.revision) }
      if (ref.kind === 'sheet') {
        const sheet = acceptedSheets.find(value => value.kind === ref.sheetKind && value.slug === ref.id)
        return sheet ? { ...ref, revision: sheet.revision } : ref
      }
      if (ref.kind === 'group-inventory' && acceptedGroupInventory) return { ...ref, revision: acceptedGroupInventory.revision }
      return ref
    })
    const acceptedResult: ItemOperationResultV1 = {
      schemaVersion: 1,
      operationId: command.operationId,
      status: 'accepted',
      canonicalItemId: definition.canonicalId,
      aggregateRefs,
      receiptId: `item-receipt:${command.operationId}`,
      exactReplay: false,
    }
    operationRepository.complete({ operationId: command.operationId, commandSha256: pending.commandSha256, status: 'accepted', result: acceptedResult, updatedAt: committedAt })
    const activityEvents = dependencies.extendedActionAuthority?.onAcceptedWithinTransaction({
      result: acceptedResult,
      committedAt,
    })
    if (activityEvents) persistedEvents.push(...activityEvents)
    dependencies.failAfterWrite?.('operation')
    const appendInputs = [
      ...(acceptedMap ? itemOperationMapUpdatedRealtimeAppendInputs({ operationId: command.operationId, map: acceptedMap, clientId: input.clientId }) : []),
      ...acceptedSheets.flatMap(sheet => itemOperationSheetUpdatedRealtimeAppendInputs({ operationId: command.operationId, sheet, clientId: input.clientId })),
      ...(acceptedGroupInventory ? groupInventoryUpdatedRealtimeAppendInputs(acceptedGroupInventory, input.clientId, 'item-operation') : []),
      ...(!acceptedMap && map ? [itemOperationPresentationInvalidatedRealtimeAppendInput({
        operationId: command.operationId,
        mapSlug: map.slug,
        mapRevision: mapStored?.revision ?? normalizeRevision(map.revision),
        clientId: input.clientId,
      })] : []),
    ]
    persistedEvents.push(...realtimeRepository.appendMany(appendInputs))
    dependencies.failAfterWrite?.('realtime')
    return acceptedResult
  })

  publishPersistedRealtimeEventsAfterCommit({
    events: persistedEvents,
    operation: `item-operation:${command.operationId}`,
    publish: dependencies.publishPersistedRealtimeEvent ?? defaultPersistedRealtimeEventPublisher,
    reportFailure: dependencies.reportAfterCommitPublicationFailure ?? defaultPersistedRealtimePublicationFailureReporter,
  })
  return { result, ...(acceptedMap ? { map: acceptedMap } : {}), sheets: acceptedSheets, ...(acceptedGroupInventory ? { groupInventory: acceptedGroupInventory } : {}) }
}

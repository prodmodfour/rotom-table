import { createHash, randomBytes } from 'node:crypto'
import guidedContractJson from '../../data/complete-play-loop/guided-item-adjudications.v1.json'
import type { AuthRole } from '#shared/auth'
import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  ITEM_GUIDED_CAMPAIGN_TOOL_ACCEPT_OPTION_ID,
  ITEM_GUIDED_CAMPAIGN_TOOL_CHOICE_ID,
  ITEM_GUIDED_LOYALTY_CHOICE_ID,
  ITEM_GUIDED_LOYALTY_DECREASE_OPTION_ID,
  ITEM_GUIDED_RE_BREATHER_ACTIVATE_OPTION_ID,
  ITEM_GUIDED_RE_BREATHER_REFILL_OPTION_ID,
  initialItemReBreatherState,
  parseItemReBreatherState,
  parseItemGuidedAdjudicationCommand,
  type DeclareItemGuidedReBreatherCommandV1,
  type ResolveItemGuidedRequestCommandV1,
  type ResolveItemGuidedFishingCommandV1,
  type ResolveItemGuidedSnagCommandV1,
  type CancelItemGuidedRequestCommandV1,
  type ItemGuidedAdjudicationCommandV1,
  type ItemGuidedReBreatherOfferV1,
  type ItemGuidedRequestProjectionV1,
  type ItemGuidedAdjudicationResultV1,
} from '#shared/itemAutomation/guidedAdjudication'
import type { PlayerProfile } from '#shared/playerProfiles'
import { playerProfileCanControlTokenSheet } from '#shared/playerProfileTokenControl'
import type { SheetKind } from '#shared/sheets'
import type { PersistedRealtimeEvent } from '#shared/realtimeEventLog'
import { parseSheetEquipmentStateForOwner } from '#shared/itemAutomation/equipment'
import type { StrictJsonObject } from '#shared/automation/strictJson'
import {
  addSnagBallConversion,
  parseSnagMachineState,
  snagLargeMachineUsesOnCampaignDay,
} from '#shared/itemAutomation/snagMachine'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import type { PokedexRecord } from '~/types/pokemon'
import type { TabletopMap } from '~/types/map'
import pokedexJson from '~~/data/reference/pokedex.json'
import { placementToSpawned } from '~/utils/placement'
import { gridFootprintCells } from '~/utils/gridGeometry'
import { mapMovementTerrainTagsForVoxel } from '~/utils/mapMovementTerrain'
import { ptuGridVectorDistance } from '~/utils/ptuGridDistance'
import { toPersistableSheetPayload } from '~/utils/sheetMutations'
import {
  buildItemGuidedReBreatherOffers,
  projectItemGuidedRequest,
  reBreatherGuidedCommonAuthority,
} from '../domain/itemAutomation/guidedAdjudication'
import {
  equipmentGrantDefinitionFor,
  equipmentGrantDefinitionSha256,
} from '../domain/itemAutomation/equipmentGrantRegistry'
import {
  currentReviewedReBreatherState,
  replaceEquippedReBreatherState,
} from '../domain/itemAutomation/reBreatherLifecycle'
import { ITEM_AUTOMATION_RUNTIME_REGISTRY } from '../domain/itemAutomation/registry'
import {
  defaultPersistedRealtimeEventPublisher,
  defaultPersistedRealtimePublicationFailureReporter,
  publishPersistedRealtimeEventsAfterCommit,
  type PersistedRealtimeEventPublisher,
} from '../realtime/persistedBatchPublication'
import { itemGuidedRequestRealtimeAppendInputs } from '../realtime/itemGuidedRequestRealtime'
import { setupSheetSaveRealtimeAppendInputs } from '../realtime/setupDocumentRealtime'
import { createSqliteCampaignClockRepository, type CampaignClockRepository } from '../storage/campaignClockRepository'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import {
  createSqliteItemGuidedRequestRepository,
  itemGuidedCommandSha256,
  itemGuidedDeclarationCommandSha256,
  type ItemGuidedRequestRepository,
  type StoredItemGuidedRequestRecord,
  type StoredItemGuidedItemOperationAuthorityV1,
  type StoredItemGuidedReBreatherAuthorityV1,
  type StoredItemGuidedFishingAuthorityV1,
  type StoredItemGuidedSnagAuthorityV1,
} from '../storage/itemGuidedRequestRepository'
import { createSqliteItemOperationRepository, type ItemOperationRepository } from '../storage/itemOperationRepository'
import { createSqliteRealtimeEventRepository } from '../storage/realtimeEventRepository'
import { createSqliteSheetRepository, type PersistedSheet, type SheetRepository } from '../storage/sheetRepository'
import { createSqliteSkillCheckRepository, type SkillCheckRepository } from '../storage/skillCheckRepository'
import { createSqliteMapRepository, type MapRepository } from '../storage/mapRepository'
import {
  resolveLargeSnagMachineInventorySource,
  resolveSnagBallInventoryChoice,
} from '../domain/itemAutomation/snagMachine'
import { recoverItemOperationUseCase } from './recoverItemOperation'
import { resumeItemOperationUseCase } from './resumeItemOperation'
import { UseCaseHttpError } from '../utils/useCaseErrors'

interface GuidedContract {
  readonly reBreather: {
    readonly canonicalId: 'Re-Breather'
    readonly canonicalRecordSha256: string
    readonly equipmentDefinitionSha256: string
    readonly equipmentGrantDefinitionSha256: string
    readonly activeMinutes: 60
    readonly openAirRefillMinutes: 5
  }
}
const guidedContract = guidedContractJson as GuidedContract
const canonicalPokedexBySpecies = new Map(
  (pokedexJson as PokedexRecord[]).map(record => [record.species, record] as const),
)
if (canonicalPokedexBySpecies.size !== (pokedexJson as PokedexRecord[]).length) {
  throw new Error('Canonical Pokédex contains duplicate fishing hook identities.')
}

export class ItemGuidedAdjudicationUseCaseError extends UseCaseHttpError<400 | 403 | 404 | 409> {}

export interface LoadItemGuidedAdjudicationInput {
  readonly role: AuthRole
  readonly playerProfile?: PlayerProfile | null
  readonly ownerKind?: SheetKind | null
  readonly ownerSlug?: string | null
}

export interface LoadItemGuidedAdjudicationResponse {
  readonly schemaVersion: 1
  readonly requests: readonly ItemGuidedRequestProjectionV1[]
  readonly reBreatherOffers: readonly ItemGuidedReBreatherOfferV1[]
}

export interface ManageItemGuidedAdjudicationInput {
  readonly role: AuthRole
  readonly playerProfile?: PlayerProfile | null
  readonly command: unknown
  readonly clientId?: string
}

export interface ManageItemGuidedAdjudicationResponse {
  readonly result: ItemGuidedAdjudicationResultV1
  readonly sheets: readonly PersistedSheet[]
}

export interface ItemGuidedAdjudicationDependencies {
  readonly database?: RotomDatabase
  readonly requestRepository?: ItemGuidedRequestRepository
  readonly itemOperationRepository?: ItemOperationRepository
  readonly sheetRepository?: SheetRepository<Record<string, unknown>>
  readonly mapRepository?: Pick<MapRepository<TabletopMap>, 'getBySlug'> & { readonly database?: RotomDatabase }
  readonly campaignClockRepository?: CampaignClockRepository
  readonly skillCheckRepository?: SkillCheckRepository
  readonly now?: () => number
  readonly requestId?: () => string
  readonly publishPersistedRealtimeEvent?: PersistedRealtimeEventPublisher
  readonly failAfterWrite?: (boundary: 'item-operation' | 'equipment-sheet' | 'guided-request' | 'realtime') => void
}

interface Runtime {
  readonly database: RotomDatabase
  readonly requests: ItemGuidedRequestRepository
  readonly itemOperations: ItemOperationRepository
  readonly sheets: SheetRepository<Record<string, unknown>>
  readonly maps: Pick<MapRepository<TabletopMap>, 'getBySlug'>
  readonly clock: CampaignClockRepository
  readonly skillChecks: SkillCheckRepository
  readonly now: () => number
}

const fail = (statusCode: 400 | 403 | 404 | 409, message: string): never => {
  throw new ItemGuidedAdjudicationUseCaseError(statusCode, message)
}

const runtimeFor = (dependencies: ItemGuidedAdjudicationDependencies): Runtime => {
  const database = dependencies.database
    ?? dependencies.requestRepository?.database
    ?? dependencies.sheetRepository?.database
    ?? dependencies.mapRepository?.database
    ?? dependencies.campaignClockRepository?.database
    ?? dependencies.skillCheckRepository?.database
    ?? getRotomDatabase()
  if (dependencies.requestRepository?.database !== undefined && dependencies.requestRepository.database !== database
    || dependencies.sheetRepository?.database !== undefined && dependencies.sheetRepository.database !== database
    || dependencies.mapRepository?.database !== undefined && dependencies.mapRepository.database !== database
    || dependencies.campaignClockRepository?.database !== undefined && dependencies.campaignClockRepository.database !== database
    || dependencies.skillCheckRepository?.database !== undefined && dependencies.skillCheckRepository.database !== database) {
    throw new Error('Guided item repositories must share one coordinator database.')
  }
  return {
    database,
    requests: dependencies.requestRepository ?? createSqliteItemGuidedRequestRepository({ database, now: dependencies.now }),
    itemOperations: dependencies.itemOperationRepository ?? createSqliteItemOperationRepository({ database }),
    sheets: dependencies.sheetRepository ?? createSqliteSheetRepository<Record<string, unknown>>(database),
    maps: dependencies.mapRepository ?? createSqliteMapRepository<TabletopMap>(database),
    clock: dependencies.campaignClockRepository ?? createSqliteCampaignClockRepository(database),
    skillChecks: dependencies.skillCheckRepository ?? createSqliteSkillCheckRepository(database),
    now: dependencies.now ?? Date.now,
  }
}

const principalKey = (input: Pick<ManageItemGuidedAdjudicationInput, 'role' | 'playerProfile'>): string => input.role === 'gm'
  ? 'gm'
  : String(input.playerProfile?.id ?? fail(403, 'A selected player profile is required.'))

const canControl = (input: {
  readonly role: AuthRole
  readonly playerProfile?: PlayerProfile | null
  readonly kind: SheetKind
  readonly slug: string
}): boolean => input.role === 'gm' || playerProfileCanControlTokenSheet(input.playerProfile, input.kind, input.slug)

const authorizeOwner = (input: {
  readonly role: AuthRole
  readonly playerProfile?: PlayerProfile | null
  readonly kind: SheetKind
  readonly slug: string
}): void => {
  if (!canControl(input)) fail(403, 'The selected profile does not control this guided item owner.')
}

const sheetSnapshot = (runtime: Runtime, kind: SheetKind, slug: string): PersistedSheet => runtime.sheets.getByRef(kind, slug)
  ?? fail(404, `The ${kind} sheet was not found.`)

const currentReBreatherOffers = (input: {
  readonly runtime: Runtime
  readonly ownerKind: SheetKind
  readonly ownerSlug: string
}): ReturnType<typeof buildItemGuidedReBreatherOffers> => {
  const stored = sheetSnapshot(input.runtime, input.ownerKind, input.ownerSlug)
  const clock = input.runtime.clock.get()
  return buildItemGuidedReBreatherOffers({
    ownerKind: input.ownerKind,
    ownerSlug: input.ownerSlug,
    sheet: stored.sheet as unknown as CharacterSheet | TrainerSheet,
    sheetRevision: stored.revision,
    campaignClockRevision: clock.revision,
    campaignMinute: clock.campaignMinute,
    pendingRecords: input.runtime.requests.listPending(),
  })
}

export const loadItemGuidedAdjudicationUseCase = (
  input: LoadItemGuidedAdjudicationInput,
  dependencies: ItemGuidedAdjudicationDependencies = {},
): LoadItemGuidedAdjudicationResponse => {
  const runtime = runtimeFor(dependencies)
  let records: readonly StoredItemGuidedRequestRecord[]
  if (input.role === 'gm') records = runtime.requests.listPending()
  else if (input.ownerKind && input.ownerSlug) {
    authorizeOwner({ ...input, kind: input.ownerKind, slug: input.ownerSlug })
    records = runtime.requests.listPending().filter(record => record.actorKind === input.ownerKind && record.actorSlug === input.ownerSlug)
  }
  else records = []
  const reBreatherOffers = input.ownerKind && input.ownerSlug
    ? (() => {
        authorizeOwner({ ...input, kind: input.ownerKind!, slug: input.ownerSlug! })
        return currentReBreatherOffers({ runtime, ownerKind: input.ownerKind!, ownerSlug: input.ownerSlug! }).map(value => value.offer)
      })()
    : []
  return Object.freeze({
    schemaVersion: 1,
    requests: Object.freeze(records.map(record => projectItemGuidedRequest({ record, role: input.role }))),
    reBreatherOffers: Object.freeze(reBreatherOffers),
  })
}

const declarationReplay = (input: {
  readonly runtime: Runtime
  readonly command: DeclareItemGuidedReBreatherCommandV1
  readonly principal: string
  readonly role: AuthRole
}): ItemGuidedRequestProjectionV1 | null => {
  const existing = input.runtime.requests.getByDeclarationOperation(input.command.operationId)
  if (!existing) return null
  const command = input.command as unknown as StrictJsonObject
  if (existing.declarationPrincipalKey !== input.principal
    || existing.declarationCommandSha256 !== itemGuidedDeclarationCommandSha256(command)
    || stableJsonStringify(existing.declarationCommand) !== stableJsonStringify(command)) {
    fail(409, 'This guided declaration operation is already bound to different authority.')
  }
  return projectItemGuidedRequest({ record: existing, role: input.role })
}

const declareReBreather = (input: ManageItemGuidedAdjudicationInput & {
  readonly command: DeclareItemGuidedReBreatherCommandV1
}, dependencies: ItemGuidedAdjudicationDependencies, runtime: Runtime): ManageItemGuidedAdjudicationResponse => {
  authorizeOwner({ ...input, kind: input.command.ownerKind, slug: input.command.ownerSlug })
  const principal = principalKey(input)
  const replay = declarationReplay({ runtime, command: input.command, principal, role: input.role })
  if (replay) return {
    result: { schemaVersion: 1, operationId: input.command.operationId, request: replay, exactReplay: true },
    sheets: [],
  }
  const offer = currentReBreatherOffers({
    runtime,
    ownerKind: input.command.ownerKind,
    ownerSlug: input.command.ownerSlug,
  }).find(candidate => candidate.offer.offerId === input.command.offerId)
    ?? fail(409, 'The Re-Breather offer changed. Refresh before retrying.')
  if (offer.sheetRevision !== input.command.ownerRevision) {
    fail(409, 'The owner sheet changed. Refresh before declaring the Re-Breather action.')
  }
  if (!offer.offer.enabled) fail(409, offer.offer.unavailableReason ?? 'The Re-Breather action is unavailable.')
  const definition = equipmentGrantDefinitionFor('Re-Breather')
    ?? fail(409, 'The reviewed Re-Breather grant definition is unavailable.')
  const definitionSha256 = equipmentGrantDefinitionSha256('Re-Breather')
  if (definition.canonicalRecordSha256 !== guidedContract.reBreather.canonicalRecordSha256
    || definition.equipmentDefinitionSha256 !== guidedContract.reBreather.equipmentDefinitionSha256
    || definitionSha256 !== guidedContract.reBreather.equipmentGrantDefinitionSha256) {
    fail(409, 'The reviewed Re-Breather authority changed.')
  }
  const clock = runtime.clock.get()
  const requestId = dependencies.requestId?.() ?? `item-guided:v1:${randomBytes(16).toString('hex')}`
  const common = reBreatherGuidedCommonAuthority({
    actionKind: offer.actionKind,
    ownerLabel: offer.offer.ownerLabel,
  })
  const events: PersistedRealtimeEvent[] = []
  const record = runtime.database.withTransaction(() => {
    const created = runtime.requests.create({
      requestId,
      requestKind: offer.actionKind === 'activate' ? 're-breather-activation' : 're-breather-refill',
      canonicalItemId: 'Re-Breather',
      canonicalDefinitionSha256: definitionSha256 ?? fail(409, 'The reviewed Re-Breather definition hash is unavailable.'),
      declarationPrincipalKey: principal,
      actorKind: input.command.ownerKind,
      actorSlug: input.command.ownerSlug,
      targetKind: input.command.ownerKind,
      targetSlug: input.command.ownerSlug,
      itemOperationId: null,
      declarationOperationId: input.command.operationId,
      declarationCommand: input.command as unknown as StrictJsonObject,
      authority: {
        schemaVersion: 1,
        sourceKind: 'equipped-re-breather',
        ...common,
        trainerSlug: input.command.ownerSlug,
        ownerKind: input.command.ownerKind,
        ownerSlug: input.command.ownerSlug,
        sheetRevision: offer.sheetRevision,
        equipmentRevision: offer.equipmentRevision,
        instanceId: offer.instanceId,
        instanceRevision: offer.instanceRevision,
        campaignClockRevision: clock.revision,
        campaignMinute: clock.campaignMinute,
        offerId: input.command.offerId,
        actionKind: offer.actionKind,
      },
      createdAt: runtime.now(),
    })
    dependencies.failAfterWrite?.('guided-request')
    events.push(...createSqliteRealtimeEventRepository({ database: runtime.database }).appendMany(
      itemGuidedRequestRealtimeAppendInputs({ operationId: input.command.operationId, record: created, clientId: input.clientId }),
    ))
    dependencies.failAfterWrite?.('realtime')
    return created
  })
  publishPersistedRealtimeEventsAfterCommit({
    events,
    operation: `declare-guided-re-breather:${input.command.operationId}`,
    publish: dependencies.publishPersistedRealtimeEvent ?? defaultPersistedRealtimeEventPublisher,
    reportFailure: defaultPersistedRealtimePublicationFailureReporter,
  })
  return {
    result: {
      schemaVersion: 1,
      operationId: input.command.operationId,
      request: projectItemGuidedRequest({ record, role: input.role }),
      exactReplay: false,
    },
    sheets: [],
  }
}

type ItemGuidedTerminalCommandV1 = ResolveItemGuidedRequestCommandV1
  | ResolveItemGuidedFishingCommandV1
  | ResolveItemGuidedSnagCommandV1
  | CancelItemGuidedRequestCommandV1

const exactTerminalReplay = (input: {
  readonly runtime: Runtime
  readonly command: ItemGuidedTerminalCommandV1
  readonly principal: string
  readonly role: AuthRole
}): ItemGuidedRequestProjectionV1 | null => {
  const operation = input.runtime.requests.getByTerminalOperation(input.command.operationId)
  if (operation) {
    if (operation.terminalPrincipalKey !== input.principal
      || operation.terminalCommandSha256 !== itemGuidedCommandSha256(input.command)
      || stableJsonStringify(operation.terminalCommand) !== stableJsonStringify(input.command)) {
      fail(409, 'This guided operation identity is already bound to another command.')
    }
    return projectItemGuidedRequest({ record: operation, role: input.role })
  }
  const request = input.runtime.requests.get(input.command.requestId) ?? fail(404, 'The guided item request was not found.')
  if (request.status !== 'pending') {
    if (request.terminalPrincipalKey === input.principal
      && request.terminalCommandSha256 === itemGuidedCommandSha256(input.command)
      && stableJsonStringify(request.terminalCommand) === stableJsonStringify(input.command)) {
      return projectItemGuidedRequest({ record: request, role: input.role })
    }
    fail(409, 'The guided item request is already terminal with different evidence.')
  }
  return null
}

const acceptInventoryRequest = (input: {
  readonly request: StoredItemGuidedRequestRecord
  readonly command: ResolveItemGuidedRequestCommandV1
  readonly runtime: Runtime
  readonly dependencies: ItemGuidedAdjudicationDependencies
  readonly clientId?: string
  readonly events: PersistedRealtimeEvent[]
}): { readonly summary: string, readonly sheets: readonly PersistedSheet[] } => {
  const rawAuthority = input.request.authority
  if (rawAuthority.sourceKind !== 'item-operation') fail(409, 'The guided item request lost its exact item authority.')
  const authority = rawAuthority as StoredItemGuidedItemOperationAuthorityV1
  const campaignTool = 'campaignToolChoiceId' in authority
  if ((input.request.requestKind === 'campaign-tool-adjudication') !== campaignTool
    || (campaignTool && (authority.campaignToolChoiceId !== ITEM_GUIDED_CAMPAIGN_TOOL_CHOICE_ID
      || input.command.optionId !== ITEM_GUIDED_CAMPAIGN_TOOL_ACCEPT_OPTION_ID))
    || (!campaignTool && ('loyaltyChoiceId' in authority
      ? authority.loyaltyChoiceId !== ITEM_GUIDED_LOYALTY_CHOICE_ID
      : true))) {
    fail(409, 'The guided request kind or bounded choice authority drifted.')
  }
  const itemOperationId = input.request.itemOperationId
    ?? fail(409, 'The guided item request lost its exact item operation.')
  const definition = ITEM_AUTOMATION_RUNTIME_REGISTRY.require(input.request.canonicalItemId)
  if (definition.definitionSha256 !== input.request.canonicalDefinitionSha256 || definition.spec.implementationState !== 'guided') {
    fail(409, 'The guided ItemSpec changed after declaration.')
  }
  const operation = input.runtime.itemOperations.get(itemOperationId)
    ?? fail(409, 'The reserved item operation disappeared.')
  if (operation.status !== 'pending') fail(409, 'The reserved item operation is no longer pending this exact decision.')
  const pendingDecision = operation.pendingDecision
    ?? fail(409, 'The reserved item operation lost its pending decision.')
  const decisionChoiceId = campaignTool
    ? ITEM_GUIDED_CAMPAIGN_TOOL_CHOICE_ID
    : ITEM_GUIDED_LOYALTY_CHOICE_ID
  if (pendingDecision.decisionId !== authority.decisionId
    || pendingDecision.choices.filter(choice => choice.choiceId === authority.targetChoiceId
      && choice.kind === 'participant').length !== 1
    || pendingDecision.choices.filter(choice => choice.choiceId === decisionChoiceId
      && choice.kind === 'gm-adjudication').length !== 1) {
    fail(409, 'The reserved item operation is no longer pending this exact decision and target authority.')
  }
  const choices = pendingDecision.choices.map(choice => ({
    choiceId: choice.choiceId,
    optionIds: choice.kind === 'participant'
      ? [...operation.command.targetIds]
      : choice.choiceId === decisionChoiceId
        ? [input.command.optionId]
        : [],
  }))
  const collected: PersistedRealtimeEvent[] = []
  const resumed = resumeItemOperationUseCase({
    role: 'gm',
    command: {
      schemaVersion: 1,
      operationId: operation.operationId,
      decisionId: pendingDecision.decisionId,
      choices,
    },
    clientId: input.clientId,
  }, {
    database: input.runtime.database,
    now: input.runtime.now,
    publishPersistedRealtimeEvent: event => { collected.push(event) },
    failAfterWrite: boundary => input.dependencies.failAfterWrite?.(boundary === 'operation' ? 'item-operation' : 'item-operation'),
  })
  if (resumed.result.status !== 'accepted') fail(409, 'The deterministic guided item settlement was not accepted.')
  input.events.push(...collected)
  const outcomeLabel = campaignTool
    ? 'Reviewed use and exact source disposition recorded.'
    : input.command.optionId === ITEM_GUIDED_LOYALTY_DECREASE_OPTION_ID
      ? 'Loyalty lowered by 1.' : 'No Loyalty Rank change recorded.'
  return {
    summary: `${input.request.canonicalItemId} accepted. ${outcomeLabel}`,
    sheets: resumed.sheets,
  }
}

const acceptReBreatherRequest = (input: {
  readonly request: StoredItemGuidedRequestRecord
  readonly command: ResolveItemGuidedRequestCommandV1
  readonly runtime: Runtime
  readonly dependencies: ItemGuidedAdjudicationDependencies
  readonly clientId?: string
  readonly events: PersistedRealtimeEvent[]
}): { readonly summary: string, readonly sheets: readonly PersistedSheet[] } => {
  const rawAuthority = input.request.authority
  if (rawAuthority.sourceKind !== 'equipped-re-breather') {
    fail(409, 'The guided request is not backed by equipped Re-Breather authority.')
  }
  const authority = rawAuthority as StoredItemGuidedReBreatherAuthorityV1
  const expectedOption = authority.actionKind === 'activate'
    ? ITEM_GUIDED_RE_BREATHER_ACTIVATE_OPTION_ID
    : ITEM_GUIDED_RE_BREATHER_REFILL_OPTION_ID
  if (input.command.optionId !== expectedOption) fail(409, 'The selected Re-Breather outcome is not authorized.')
  const definition = equipmentGrantDefinitionFor('Re-Breather')
    ?? fail(409, 'The reviewed Re-Breather definition is unavailable.')
  const definitionSha256 = equipmentGrantDefinitionSha256('Re-Breather')
  if (definitionSha256 !== input.request.canonicalDefinitionSha256
    || definition.canonicalRecordSha256 !== guidedContract.reBreather.canonicalRecordSha256
    || definition.equipmentDefinitionSha256 !== guidedContract.reBreather.equipmentDefinitionSha256
    || definitionSha256 !== guidedContract.reBreather.equipmentGrantDefinitionSha256) {
    fail(409, 'The reviewed Re-Breather definition changed after declaration.')
  }
  const stored = sheetSnapshot(input.runtime, authority.ownerKind, authority.ownerSlug)
  const clock = input.runtime.clock.get()
  if (stored.revision !== authority.sheetRevision || clock.revision !== authority.campaignClockRevision) {
    fail(409, 'The Re-Breather sheet or campaign clock changed after declaration. Cancel and declare again.')
  }
  const sheet = stored.sheet as unknown as CharacterSheet | TrainerSheet
  if (!sheet.equipmentState) fail(409, 'The exact equipped Re-Breather is no longer present.')
  const equipment = parseSheetEquipmentStateForOwner(sheet.equipmentState, {
    kind: authority.ownerKind,
    slug: authority.ownerSlug,
  })
  if (equipment.revision !== authority.equipmentRevision) fail(409, 'The equipped Re-Breather custody changed after declaration.')
  const instance = equipment.instances.find(candidate => candidate.instanceId === authority.instanceId)
    ?? fail(409, 'The exact equipped Re-Breather is no longer present.')
  if (instance.revision !== authority.instanceRevision) fail(409, 'The exact equipped Re-Breather state changed after declaration.')
  const current = currentReviewedReBreatherState({
    serializedState: instance.serializedState,
    campaignMinute: clock.campaignMinute,
  })
  let next
  if (authority.actionKind === 'activate') {
    if (current.mode !== 'ready') fail(409, 'The exact Re-Breather is not ready to activate.')
    if (clock.campaignMinute > Number.MAX_SAFE_INTEGER - guidedContract.reBreather.activeMinutes) {
      fail(409, 'The campaign clock cannot represent another Re-Breather activation interval.')
    }
    next = parseItemReBreatherState({
      ...initialItemReBreatherState(),
      mode: 'active',
      activeFromCampaignMinute: clock.campaignMinute,
      activeUntilCampaignMinute: clock.campaignMinute + guidedContract.reBreather.activeMinutes,
      lastTransition: {
        requestId: input.request.requestId,
        transition: 'activated',
        campaignMinute: clock.campaignMinute,
      },
    })
  }
  else {
    if (current.mode !== 'depleted') fail(409, 'The exact Re-Breather is not depleted and eligible for open-air refill.')
    if (clock.campaignMinute > Number.MAX_SAFE_INTEGER - guidedContract.reBreather.openAirRefillMinutes) {
      fail(409, 'The campaign clock cannot represent another Re-Breather refill interval.')
    }
    next = parseItemReBreatherState({
      ...initialItemReBreatherState(),
      mode: 'refilling',
      refillStartedAtCampaignMinute: clock.campaignMinute,
      refillCompletesAtCampaignMinute: clock.campaignMinute + guidedContract.reBreather.openAirRefillMinutes,
      lastTransition: {
        requestId: input.request.requestId,
        transition: 'refill-started',
        campaignMinute: clock.campaignMinute,
      },
    })
  }
  const equipmentState = replaceEquippedReBreatherState({
    equipmentState: equipment,
    instanceId: authority.instanceId,
    expectedInstanceRevision: authority.instanceRevision,
    nextState: next,
  })
  const timestamp = input.runtime.now()
  const update = input.runtime.sheets.applyLivePlayUpdate({
    kind: authority.ownerKind,
    slug: authority.ownerSlug,
    expectedRevision: stored.revision,
    nextSheet: toPersistableSheetPayload({ ...sheet, equipmentState, updatedAt: timestamp }),
    sourceOperationId: input.command.operationId,
  })
  if (update === 'stale') fail(409, 'The Re-Breather sheet changed during acceptance.')
  input.dependencies.failAfterWrite?.('equipment-sheet')
  const accepted = sheetSnapshot(input.runtime, authority.ownerKind, authority.ownerSlug)
  input.events.push(...createSqliteRealtimeEventRepository({ database: input.runtime.database }).appendMany(
    setupSheetSaveRealtimeAppendInputs({
      kind: accepted.kind,
      slug: accepted.slug,
      sheet: accepted.sheet,
      clientId: input.clientId,
    }),
  ))
  return {
    summary: authority.actionKind === 'activate'
      ? 'Re-Breather activated for 60 campaign minutes.'
      : 'Open-air refill started; ready after 5 campaign minutes.',
    sheets: [accepted],
  }
}

const acceptFishingRequest = (input: {
  readonly request: StoredItemGuidedRequestRecord
  readonly command: ResolveItemGuidedFishingCommandV1
  readonly runtime: Runtime
}): { readonly summary: string, readonly sheets: readonly PersistedSheet[] } => {
  const rawAuthority = input.request.authority
  if (input.request.requestKind !== 'fishing-adjudication'
    || rawAuthority.sourceKind !== 'equipped-fishing-rod') {
    fail(409, 'The guided request is not backed by fishing authority.')
  }
  const authority = rawAuthority as StoredItemGuidedFishingAuthorityV1
  const clock = input.runtime.clock.get()
  if (clock.campaignMinute < authority.readyAtCampaignMinute) {
    fail(409, `Fishing resolves at campaign minute ${authority.readyAtCampaignMinute}.`)
  }
  if (input.command.skillCheckIntegrationId !== authority.skillCheckIntegrationId) {
    fail(409, 'The fishing Skill Check integration reference is stale or unrelated.')
  }
  const skillCheckId = input.command.skillCheckId
    ?? fail(409, 'Fishing settlement requires one accepted generic Skill Check.')
  const linkedCheck = input.runtime.skillChecks.get(skillCheckId)
    ?? fail(409, 'The selected fishing Skill Check is unavailable.')
  const linkedDocument = linkedCheck.document
  const linkedSubject = linkedDocument.subjects[0]
  if (linkedDocument.state !== 'accepted'
    || linkedDocument.mode !== 'single'
    || linkedDocument.comparison.kind !== 'dc'
    || linkedDocument.subjects.length !== 1
    || linkedSubject?.kind !== authority.ownerKind
    || linkedSubject.sheetSlug !== authority.ownerSlug
    || linkedSubject.skillId !== input.command.skillId
    || !linkedDocument.acceptedResults.some(result => result.subjectId === linkedSubject.subjectId)
    || linkedCheck.createdAt < input.request.createdAt) {
    fail(409, 'The selected fishing Skill Check is not an accepted single-subject check for this actor, Skill, and declaration.')
  }
  const reusedCheck = input.runtime.requests.listForActor(authority.ownerKind, authority.ownerSlug)
    .some(candidate => candidate.requestId !== input.request.requestId
      && candidate.status === 'accepted'
      && candidate.terminalCommand?.action === 'resolve-fishing'
      && candidate.terminalCommand.skillCheckId === skillCheckId)
  if (reusedCheck) fail(409, 'The selected fishing Skill Check already settles another fishing declaration.')
  const definition = equipmentGrantDefinitionFor(input.request.canonicalItemId)
    ?? fail(409, 'The reviewed fishing rod definition is unavailable.')
  const definitionSha256 = equipmentGrantDefinitionSha256(input.request.canonicalItemId)
  if (definitionSha256 !== input.request.canonicalDefinitionSha256) {
    fail(409, 'The reviewed fishing rod definition changed after declaration.')
  }
  const expectedAction = input.request.canonicalItemId === 'Old Rod' ? 'equipment.fishing.old-rod'
    : input.request.canonicalItemId === 'Good Rod' ? 'equipment.fishing.good-rod'
      : input.request.canonicalItemId === 'Super Rod' ? 'equipment.fishing.super-rod' : null
  const currentDefinition = definition
  if (!expectedAction || authority.actionId !== expectedAction
    || !currentDefinition.grants.some(grant => grant.kind === 'action'
      && grant.actionId === expectedAction && grant.executionStatus === 'native')) {
    fail(409, 'The reviewed fishing action identity changed after declaration.')
  }
  const storedSheet = sheetSnapshot(input.runtime, authority.ownerKind, authority.ownerSlug)
  const sheet = storedSheet.sheet as unknown as CharacterSheet | TrainerSheet
  if (!sheet.equipmentState) fail(409, 'The exact fishing rod is no longer equipped.')
  const equipment = parseSheetEquipmentStateForOwner(sheet.equipmentState, {
    kind: authority.ownerKind,
    slug: authority.ownerSlug,
  })
  const instance = equipment.instances.find(candidate => candidate.instanceId === authority.instanceId)
  const handSlots = new Set(equipment.slots
    .filter(slot => slot.instanceId === authority.instanceId)
    .map(slot => slot.slotId))
  if (!instance || instance.revision !== authority.instanceRevision
    || instance.canonicalItemId !== input.request.canonicalItemId
    || instance.activity.status !== 'active'
    || !handSlots.has('mainHand') || !handSlots.has('offHand')) {
    fail(409, 'The exact active two-handed fishing rod is no longer in current custody.')
  }
  const map = input.runtime.maps.getBySlug(authority.mapSlug)
    ?? fail(409, 'The fishing declaration map is no longer available.')
  const placement = map.placements.find(candidate => candidate.id === authority.actorPlacementId)
    ?? fail(409, 'The fishing actor is no longer present on the declaration map.')
  if (placement.sheetKind !== authority.ownerKind || placement.sheetSlug !== authority.ownerSlug) {
    fail(409, 'The fishing actor no longer matches declaration authority.')
  }
  const water = map.voxels.filter(voxel => (
    voxel.x === authority.waterCell.x
    && voxel.y === authority.waterCell.y
    && voxel.z === authority.waterCell.z
    && mapMovementTerrainTagsForVoxel(voxel).has('water')
  ))
  if (water.length !== 1) fail(409, 'The declared fishing water cell is no longer authoritative water.')
  const token = placementToSpawned(placement, {
    pokemon: placement.sheetKind === 'pokemon'
      ? new Map([[placement.sheetSlug, sheet as CharacterSheet]]) : new Map(),
    trainer: placement.sheetKind === 'trainer'
      ? new Map([[placement.sheetSlug, sheet as TrainerSheet]]) : new Map(),
  }, map)
  const adjacent = token && gridFootprintCells(placement.position, token).some(origin => (
    ptuGridVectorDistance({
      x: authority.waterCell.x - origin.x,
      y: authority.waterCell.y - origin.y,
      z: authority.waterCell.z - origin.z,
    }) === 1
  ))
  if (!adjacent) fail(409, 'The fishing actor is no longer adjacent to the declared water cell.')

  if (input.command.hookSpeciesId !== null) {
    const species = canonicalPokedexBySpecies.get(input.command.hookSpeciesId)
      ?? fail(409, 'The selected hook species is not a canonical Pokédex identity.')
    if (input.command.hookLevel === null) fail(409, 'A hooked Pokémon requires a bounded Level.')
    const hookLevel = input.command.hookLevel as number
    if (input.request.canonicalItemId === 'Old Rod'
      && (hookLevel > 10
        || species.evolution_stage !== 1
        || species.size?.toLocaleLowerCase('en-US') !== 'small')) {
      fail(409, 'Old Rod hooks must be Small, unevolved Pokémon at Level 10 or lower.')
    }
    if (input.request.canonicalItemId === 'Good Rod' && species.evolution_stage !== 1) {
      fail(409, 'Good Rod hooks must be unevolved Pokémon.')
    }
  }
  return {
    summary: input.command.hookSpeciesId === null
      ? `${input.request.canonicalItemId} fishing attempt resolved with no hook.`
      : `${input.request.canonicalItemId} fishing attempt resolved with one bounded hook outcome.`,
    sheets: [],
  }
}

const acceptSnagConversionRequest = (input: {
  readonly request: StoredItemGuidedRequestRecord
  readonly command: ResolveItemGuidedSnagCommandV1
  readonly runtime: Runtime
  readonly dependencies: ItemGuidedAdjudicationDependencies
  readonly clientId?: string
  readonly events: PersistedRealtimeEvent[]
}): { readonly summary: string, readonly sheets: readonly PersistedSheet[] } => {
  const rawAuthority = input.request.authority
  if (input.request.requestKind !== 'snag-conversion-adjudication'
    || rawAuthority.sourceKind !== 'snag-machine-conversion') {
    fail(409, 'The guided request is not backed by Snag Machine conversion authority.')
  }
  const authority = rawAuthority as StoredItemGuidedSnagAuthorityV1
  if (input.command.decision === 'deny') {
    return { summary: 'Snag Ball conversion denied; the reserved Poké Ball remains unchanged.', sheets: [] }
  }
  const definition = equipmentGrantDefinitionFor('Snag Machine')
    ?? fail(409, 'The reviewed Snag Machine definition is unavailable.')
  if (equipmentGrantDefinitionSha256('Snag Machine') !== input.request.canonicalDefinitionSha256
    || !definition.grants.some(grant => grant.kind === 'action'
      && grant.actionId === 'equipment.snag-machine.convert' && grant.executionStatus === 'native')) {
    fail(409, 'The reviewed Snag Machine conversion definition changed after declaration.')
  }
  const stored = sheetSnapshot(input.runtime, 'trainer', authority.trainerSlug)
  if (stored.revision !== authority.sheetRevision) {
    fail(409, 'The Snag Machine Trainer sheet changed after declaration. Cancel and declare again.')
  }
  const trainer = stored.sheet as unknown as TrainerSheet
  const map = input.runtime.maps.getBySlug(authority.mapSlug)
    ?? fail(409, 'The Snag Machine declaration map is unavailable.')
  const placement = map.placements.find(candidate => candidate.id === authority.actorPlacementId)
  if (!placement || placement.sheetKind !== 'trainer' || placement.sheetSlug !== authority.trainerSlug) {
    fail(409, 'The Snag Machine actor is no longer present with exact declaration authority.')
  }
  const clock = input.runtime.clock.get()
  if (Math.floor(clock.campaignMinute / 1_440) !== authority.campaignDayIndex) {
    fail(409, 'The Snag Machine declaration crossed a campaign-day boundary. Cancel and declare again.')
  }
  const ball = resolveSnagBallInventoryChoice({
    sheet: trainer,
    sourceInstanceId: authority.ballSourceInstanceId,
  })
  if (!ball || ball.option.name !== authority.ballCanonicalItemId
    || ball.option.quantity !== authority.ballQuantityAtDeclaration) {
    fail(409, 'The exact reserved Poké Ball row changed after declaration.')
  }
  const state = parseSnagMachineState(trainer.serverPrivate?.snagMachine)
  if (authority.variant === 'portable') {
    if (map.initiative?.round !== authority.declarationRound) {
      fail(409, 'The Portable Snag Machine decision did not settle in its declaration round.')
    }
    if (!trainer.equipmentState || authority.equipmentRevision === null) {
      fail(409, 'Portable Snag Machine equipment authority is missing.')
    }
    const equipment = parseSheetEquipmentStateForOwner(trainer.equipmentState, {
      kind: 'trainer', slug: trainer.slug,
    })
    const instance = equipment.instances.find(candidate => candidate.instanceId === authority.machineSourceInstanceId)
    const accessory = equipment.slots.find(slot => slot.slotId === 'accessory')
    if (equipment.revision !== authority.equipmentRevision
      || !instance || instance.revision !== authority.machineSourceRevision
      || instance.canonicalItemId !== 'Snag Machine' || instance.activity.status !== 'active'
      || accessory?.instanceId !== authority.machineSourceInstanceId
      || state.conversions.some(conversion => conversion.variant === 'portable'
        && conversion.machineSourceInstanceId === authority.machineSourceInstanceId)) {
      fail(409, 'The exact active Portable Snag Machine custody changed after declaration.')
    }
  }
  else {
    if (!resolveLargeSnagMachineInventorySource({
      sheet: trainer,
      sourceInstanceId: authority.machineSourceInstanceId,
    }) || authority.machineSourceRevision !== authority.sheetRevision) {
      fail(409, 'The exact Large Snag Machine inventory custody changed after declaration.')
    }
    if (snagLargeMachineUsesOnCampaignDay({
      state,
      machineSourceInstanceId: authority.machineSourceInstanceId,
      campaignDayIndex: authority.campaignDayIndex,
    }) >= 5) fail(409, 'This exact Large Snag Machine already converted five balls this campaign day.')
  }
  const id = (label: string): string => createHash('sha256')
    .update(`${label}\u0000${input.request.requestId}\u0000${input.command.operationId}`)
    .digest('hex').slice(0, 32)
  const conversionId = `snag-conversion:v1:${id('conversion')}`
  const nextState = addSnagBallConversion({
    state,
    conversion: {
      conversionId,
      variant: authority.variant,
      machineSourceInstanceId: authority.machineSourceInstanceId,
      ballSourceInstanceId: authority.ballSourceInstanceId,
      ballCanonicalItemId: authority.ballCanonicalItemId,
      campaignDayIndex: authority.campaignDayIndex,
      declarationRound: authority.declarationRound,
      readyRound: authority.variant === 'portable' ? authority.declarationRound! + 1 : null,
      expiresAfterRound: authority.variant === 'portable' ? authority.declarationRound! + 1 : null,
      approvedOperationId: input.command.operationId,
      gmLegalityNote: input.command.gmNote,
    },
    historyId: `snag-history:v1:${id('converted')}`,
  })
  const timestamp = input.runtime.now()
  const nextSheet = toPersistableSheetPayload({
    ...trainer,
    serverPrivate: {
      ...(trainer.serverPrivate ?? {}),
      snagMachine: nextState,
    },
    updatedAt: timestamp,
  })
  if (input.runtime.sheets.applyLivePlayUpdate({
    kind: 'trainer',
    slug: authority.trainerSlug,
    expectedRevision: stored.revision,
    nextSheet,
    sourceOperationId: input.command.operationId,
  }) === 'stale') fail(409, 'The Trainer sheet changed during Snag Machine acceptance.')
  input.dependencies.failAfterWrite?.('equipment-sheet')
  const accepted = sheetSnapshot(input.runtime, 'trainer', authority.trainerSlug)
  input.events.push(...createSqliteRealtimeEventRepository({ database: input.runtime.database }).appendMany(
    setupSheetSaveRealtimeAppendInputs({
      kind: 'trainer', slug: accepted.slug, sheet: accepted.sheet, clientId: input.clientId,
    }),
  ))
  return {
    summary: authority.variant === 'portable'
      ? 'Portable Snag Ball conversion approved; active for exactly the next encounter round.'
      : 'Large Snag Machine conversion approved permanently for one Poké Ball.',
    sheets: [accepted],
  }
}

const cancelRequest = (input: {
  readonly request: StoredItemGuidedRequestRecord
  readonly command: CancelItemGuidedRequestCommandV1
  readonly runtime: Runtime
  readonly dependencies: ItemGuidedAdjudicationDependencies
  readonly role: AuthRole
  readonly playerProfile?: PlayerProfile | null
  readonly clientId?: string
  readonly events: PersistedRealtimeEvent[]
}): void => {
  if (!canControl({ role: input.role, playerProfile: input.playerProfile, kind: input.request.actorKind, slug: input.request.actorSlug })) {
    fail(403, 'Only the GM or the declaring actor owner may cancel this guided request.')
  }
  if (!input.request.itemOperationId) return
  const collected: PersistedRealtimeEvent[] = []
  const result = recoverItemOperationUseCase({
    role: input.role,
    playerProfile: input.playerProfile,
    command: {
      schemaVersion: 1,
      operationId: input.request.itemOperationId,
      action: 'abandon',
      reason: 'Guided item request cancelled before GM acceptance.',
    },
    clientId: input.clientId,
  }, {
    database: input.runtime.database,
    now: input.runtime.now,
    publishPersistedRealtimeEvent: event => { collected.push(event) },
  })
  if (result.result.status !== 'abandoned') fail(409, 'The reserved item operation could not be cancelled safely.')
  input.events.push(...collected)
  input.dependencies.failAfterWrite?.('item-operation')
}

const settleRequest = (input: ManageItemGuidedAdjudicationInput & {
  readonly command: ItemGuidedTerminalCommandV1
}, dependencies: ItemGuidedAdjudicationDependencies, runtime: Runtime): ManageItemGuidedAdjudicationResponse => {
  const principal = principalKey(input)
  const replay = exactTerminalReplay({ runtime, command: input.command, principal, role: input.role })
  if (replay) return {
    result: { schemaVersion: 1, operationId: input.command.operationId, request: replay, exactReplay: true },
    sheets: [],
  }
  const request = runtime.requests.get(input.command.requestId) ?? fail(404, 'The guided item request was not found.')
  if (request.revision !== input.command.expectedRevision || request.status !== 'pending') {
    fail(409, 'The guided item request changed. Refresh before retrying.')
  }
  const accepting = input.command.action === 'resolve'
    || input.command.action === 'resolve-fishing'
    || input.command.action === 'resolve-snag-conversion'
  if (accepting && input.role !== 'gm') fail(403, 'GM authorization is required to accept a guided item request.')
  const availableOptions = projectItemGuidedRequest({ record: request, role: 'gm' }).choices.map(choice => choice.optionId)
  if (input.command.action === 'resolve' && !availableOptions.includes(input.command.optionId)) {
    fail(409, 'The selected guided outcome is not currently authorized.')
  }
  if (input.command.action === 'resolve-fishing' && request.requestKind !== 'fishing-adjudication') {
    fail(409, 'Fishing resolution can settle only an exact fishing request.')
  }
  if (input.command.action !== 'resolve-fishing' && request.requestKind === 'fishing-adjudication'
    && input.command.action !== 'cancel') {
    fail(409, 'Fishing requests require the bounded fishing resolution command.')
  }
  if (input.command.action === 'resolve-snag-conversion'
    && request.requestKind !== 'snag-conversion-adjudication') {
    fail(409, 'Snag Machine resolution can settle only an exact conversion request.')
  }
  if (input.command.action !== 'resolve-snag-conversion'
    && request.requestKind === 'snag-conversion-adjudication'
    && input.command.action !== 'cancel') {
    fail(409, 'Snag Machine requests require the bounded conversion resolution command.')
  }
  const events: PersistedRealtimeEvent[] = []
  let sheets: readonly PersistedSheet[] = []
  const terminal = runtime.database.withTransaction(() => {
    let summary: string | null = null
    if (input.command.action === 'cancel') cancelRequest({
      request, command: input.command, runtime, dependencies,
      role: input.role, playerProfile: input.playerProfile, clientId: input.clientId, events,
    })
    else {
      const accepted = input.command.action === 'resolve-fishing'
        ? acceptFishingRequest({ request, command: input.command, runtime })
        : input.command.action === 'resolve-snag-conversion'
          ? acceptSnagConversionRequest({
              request, command: input.command, runtime, dependencies,
              clientId: input.clientId, events,
            })
          : request.requestKind === 'loyalty-consequence'
          || request.requestKind === 'campaign-tool-adjudication'
          ? acceptInventoryRequest({ request, command: input.command, runtime, dependencies, clientId: input.clientId, events })
          : acceptReBreatherRequest({ request, command: input.command, runtime, dependencies, clientId: input.clientId, events })
      summary = accepted.summary
      sheets = accepted.sheets
    }
    const settlement = runtime.requests.settle({
      requestId: request.requestId,
      expectedRevision: request.revision,
      status: accepting ? 'accepted' : 'cancelled',
      terminalPrincipalKey: principal,
      command: input.command,
      outcomeOptionId: input.command.action === 'resolve'
        ? input.command.optionId
        : input.command.action === 'resolve-fishing'
          ? input.command.hookSpeciesId === null ? 'fishing-no-hook' : 'fishing-hook-recorded'
          : input.command.action === 'resolve-snag-conversion'
            ? `snag-conversion-${input.command.decision}`
            : null,
      result: {
        schemaVersion: 1,
        status: accepting ? 'accepted' : 'cancelled',
        acceptedSummary: summary,
      },
      updatedAt: runtime.now(),
    })
    if (settlement.kind !== 'applied') fail(409, 'The guided item request changed during settlement.')
    dependencies.failAfterWrite?.('guided-request')
    events.push(...createSqliteRealtimeEventRepository({ database: runtime.database }).appendMany(
      itemGuidedRequestRealtimeAppendInputs({ operationId: input.command.operationId, record: settlement.record, clientId: input.clientId }),
    ))
    dependencies.failAfterWrite?.('realtime')
    return settlement.record
  })
  publishPersistedRealtimeEventsAfterCommit({
    events,
    operation: `settle-guided-item:${input.command.operationId}`,
    publish: dependencies.publishPersistedRealtimeEvent ?? defaultPersistedRealtimeEventPublisher,
    reportFailure: defaultPersistedRealtimePublicationFailureReporter,
  })
  return {
    result: {
      schemaVersion: 1,
      operationId: input.command.operationId,
      request: projectItemGuidedRequest({ record: terminal, role: input.role }),
      exactReplay: false,
    },
    sheets,
  }
}

export const manageItemGuidedAdjudicationUseCase = (
  input: ManageItemGuidedAdjudicationInput,
  dependencies: ItemGuidedAdjudicationDependencies = {},
): ManageItemGuidedAdjudicationResponse => {
  const runtime = runtimeFor(dependencies)
  const command: ItemGuidedAdjudicationCommandV1 = (() => {
    try { return parseItemGuidedAdjudicationCommand(input.command) }
    catch { return fail(400, 'Invalid guided item command.') }
  })()
  if (command.action === 'declare-re-breather') {
    return declareReBreather({ ...input, command }, dependencies, runtime)
  }
  if (command.action === 'resolve-fishing-intent') {
    const request = runtime.requests.get(command.requestId)
      ?? fail(404, 'The guided fishing request was not found.')
    if (input.role !== 'gm') fail(403, 'GM authorization is required to resolve a fishing request.')
    if (request.requestKind !== 'fishing-adjudication') {
      fail(409, 'Fishing resolution can bind only an exact fishing request.')
    }
    const authority = request.authority.sourceKind === 'equipped-fishing-rod'
      ? request.authority
      : fail(409, 'Fishing resolution can bind only an exact fishing request.')
    const bound = parseItemGuidedAdjudicationCommand({
      ...command,
      action: 'resolve-fishing',
      skillCheckIntegrationId: authority.skillCheckIntegrationId,
    }) as ResolveItemGuidedFishingCommandV1
    return settleRequest({ ...input, command: bound }, dependencies, runtime)
  }
  return settleRequest({ ...input, command }, dependencies, runtime)
}

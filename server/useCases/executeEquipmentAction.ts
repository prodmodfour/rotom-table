import { createHash, randomInt as secureRandomInt } from 'node:crypto'
import { createError } from 'h3'
import type { AuthRole } from '#shared/auth'
import type { PlayerProfile } from '#shared/playerProfiles'
import { stableJsonStringify } from '#shared/automation/stableJson'
import type { StrictJsonObject } from '#shared/automation/strictJson'
import {
  EquipmentActionValidationError,
  parseEquipmentActionPublicResult,
  parseExecuteEquipmentActionCommand,
  type EquipmentActionId,
  type EquipmentActionPublicResultV1,
  type EquipmentActionRollV1,
  type ExecuteEquipmentActionCommandV1,
} from '#shared/itemAutomation/equipmentActions'
import { nextRevision, normalizeRevision } from '#shared/sessionRevisions'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { deepCloneJson } from '~/utils/serialization'
import { buildEncounterPresentationProjection } from '../domain/encounterPresentation/buildProjection'
import {
  DeferredEquipmentActionError,
  executeDeferredEquipmentActionMechanic,
} from '../domain/itemAutomation/deferredEquipmentActions'
import { createEncounterEquipmentGrantQueries } from '../domain/moveAutomation/equipmentGrantQueries'
import { shockCollarImplicitRemoteAuthority } from '../domain/itemAutomation/shockCollar'
import {
  equipmentGrantDefinitionFor,
  equipmentGrantDefinitionSha256,
} from '../domain/itemAutomation/equipmentGrantRegistry'
import { resolveLargeSnagMachineInventorySource } from '../domain/itemAutomation/snagMachine'
import type { ResolvedEquipmentGrant } from '../domain/itemAutomation/equipmentGrants'
import { parseSheetEquipmentStateForOwner } from '#shared/itemAutomation/equipment'
import { canAccessMapForRole } from '../policies/mapPolicy'
import {
  actorCanControlMapPlacement,
  playerProfileLinkedTrainerSheetsForTokenControl,
} from '../policies/playerProfileTokenControlPolicy'
import { setupMapSaveRealtimeAppendInputs, setupSheetSaveRealtimeAppendInputs } from '../realtime/setupDocumentRealtime'
import { itemGuidedRequestRealtimeAppendInputs } from '../realtime/itemGuidedRequestRealtime'
import {
  defaultPersistedRealtimeEventPublisher,
  defaultPersistedRealtimePublicationFailureReporter,
  publishPersistedRealtimeEventsAfterCommit,
  type PersistedRealtimeEventPublisher,
  type PersistedRealtimePublicationFailureReporter,
} from '../realtime/persistedBatchPublication'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import {
  createSqliteEquipmentActionOperationRepository,
  type EquipmentActionOperationRepository,
} from '../storage/equipmentActionOperationRepository'
import { createSqliteMapRepository, type MapRepository } from '../storage/mapRepository'
import { createSqliteRealtimeEventRepository, type RealtimeEventRepository } from '../storage/realtimeEventRepository'
import { createSqliteSheetRepository, type SheetRepository } from '../storage/sheetRepository'
import { createSqliteCampaignClockRepository, type CampaignClockRepository } from '../storage/campaignClockRepository'
import {
  createSqliteItemGuidedRequestRepository,
  type ItemGuidedRequestRepository,
} from '../storage/itemGuidedRequestRepository'
import { listRepositorySheets, type ListSheetsRepository } from './listSheets'

export interface ExecuteEquipmentActionInput {
  readonly role: AuthRole
  readonly playerProfile?: PlayerProfile | null
  readonly command: unknown
  readonly clientId?: string
}

export interface ExecuteEquipmentActionDependencies {
  readonly database?: RotomDatabase
  readonly mapRepository?: Pick<MapRepository<TabletopMap>, 'getBySlug' | 'applyLivePlayUpdate'> & { readonly database?: RotomDatabase }
  readonly sheetRepository?: Pick<
    SheetRepository<Record<string, unknown>>,
    'getByRef' | 'list' | 'assertRevisions' | 'applyLivePlayUpdate'
  > & ListSheetsRepository & { readonly database?: RotomDatabase }
  readonly operationRepository?: EquipmentActionOperationRepository
  readonly guidedRequestRepository?: Pick<ItemGuidedRequestRepository, 'listPending' | 'create'> & { readonly database?: RotomDatabase }
  readonly campaignClockRepository?: Pick<CampaignClockRepository, 'get'> & { readonly database?: RotomDatabase }
  readonly realtimeEventRepository?: Pick<RealtimeEventRepository, 'appendMany'> & { readonly database?: RotomDatabase }
  readonly now?: () => number
  readonly randomInt?: (minimum: number, maximumExclusive: number) => number
  readonly publishPersistedRealtimeEvent?: PersistedRealtimeEventPublisher
  readonly reportAfterCommitPublicationFailure?: PersistedRealtimePublicationFailureReporter
  readonly failAfterWrite?: (boundary: 'map' | 'sheet' | 'guided-request' | 'operation' | 'realtime') => void
}

const fail = (statusCode: number, statusMessage: string): never => { throw createError({ statusCode, statusMessage }) }
const hash = (value: unknown): string => createHash('sha256').update(stableJsonStringify(value)).digest('hex')
const FISHING_ACTION_IDS = new Set<EquipmentActionId>([
  'equipment.fishing.old-rod', 'equipment.fishing.good-rod', 'equipment.fishing.super-rod',
])
type FishingActionId = Extract<EquipmentActionId,
  'equipment.fishing.old-rod' | 'equipment.fishing.good-rod' | 'equipment.fishing.super-rod'>
const isFishingActionId = (value: EquipmentActionId): value is FishingActionId => FISHING_ACTION_IDS.has(value)
const principalKey = (input: ExecuteEquipmentActionInput): string => input.role === 'player'
  ? `player:${input.playerProfile?.id ?? 'missing-profile'}`
  : input.role
const parseCommand = (value: unknown): ExecuteEquipmentActionCommandV1 => {
  try { return parseExecuteEquipmentActionCommand(value) }
  catch (error) {
    if (error instanceof EquipmentActionValidationError) fail(400, 'Invalid equipment action command.')
    throw error
  }
}
const databaseFrom = (dependencies: ExecuteEquipmentActionDependencies): RotomDatabase => {
  const candidates = [
    dependencies.mapRepository?.database,
    dependencies.sheetRepository?.database,
    dependencies.operationRepository?.database,
    dependencies.guidedRequestRepository?.database,
    dependencies.campaignClockRepository?.database,
    dependencies.realtimeEventRepository?.database,
  ].filter((entry): entry is RotomDatabase => Boolean(entry))
  const database = dependencies.database ?? candidates[0] ?? getRotomDatabase()
  if (candidates.some(candidate => candidate !== database)) throw new Error('Equipment action repositories must share one RotomDatabase.')
  return database
}

export const executeEquipmentActionUseCase = (
  input: ExecuteEquipmentActionInput,
  dependencies: ExecuteEquipmentActionDependencies = {},
): EquipmentActionPublicResultV1 => {
  const command = parseCommand(input.command)
  const commandSha256 = hash(command)
  const replayPrincipal = principalKey(input)
  const database = databaseFrom(dependencies)
  const mapRepository = dependencies.mapRepository ?? createSqliteMapRepository<TabletopMap>(database)
  const sheetRepository = dependencies.sheetRepository ?? createSqliteSheetRepository<Record<string, unknown>>(database)
  const operationRepository = dependencies.operationRepository ?? createSqliteEquipmentActionOperationRepository(database)
  const guidedRequestRepository = dependencies.guidedRequestRepository
    ?? createSqliteItemGuidedRequestRepository({ database, now: dependencies.now })
  const campaignClockRepository = dependencies.campaignClockRepository
    ?? createSqliteCampaignClockRepository(database)
  const realtimeEventRepository = dependencies.realtimeEventRepository ?? createSqliteRealtimeEventRepository({ database })
  const existing = operationRepository.find(command.operationId)
  if (existing) {
    if (existing.commandSha256 !== commandSha256) fail(409, 'Equipment action operation ID was reused with changed input.')
    if (existing.principalKey !== replayPrincipal) fail(403, 'Equipment action replay belongs to a different principal.')
    return parseEquipmentActionPublicResult({ ...existing.result, exactReplay: true })
  }

  const storedMap = mapRepository.getBySlug(command.mapSlug) ?? fail(404, 'Equipment action map is missing.')
  if (!canAccessMapForRole(input.role, storedMap)) fail(403, 'Equipment action map is not player visible.')
  const mapRevision = normalizeRevision(storedMap.revision)
  if (mapRevision !== command.baseRevision) fail(409, 'Equipment action projection is stale.')
  const pokemonSheets = listRepositorySheets<CharacterSheet>(sheetRepository, 'pokemon')
  const trainerSheets = listRepositorySheets<TrainerSheet>(sheetRepository, 'trainer')
  const pokemonBySlug = new Map(pokemonSheets.map(sheet => [sheet.slug, sheet]))
  const trainerBySlug = new Map(trainerSheets.map(sheet => [sheet.slug, sheet]))
  const actorPlacement = storedMap.placements.find(placement => placement.id === command.actorPlacementId)
    ?? fail(409, 'Equipment action actor is unavailable.')
  const actorSheet = (actorPlacement.sheetKind === 'pokemon'
    ? pokemonBySlug.get(actorPlacement.sheetSlug)
    : trainerBySlug.get(actorPlacement.sheetSlug))
    ?? fail(409, 'Equipment action actor sheet is unavailable.')
  const linkedTrainerSheets = playerProfileLinkedTrainerSheetsForTokenControl(
    input.playerProfile,
    slug => trainerBySlug.get(slug),
  )
  if (!actorCanControlMapPlacement({
    role: input.role,
    profile: input.playerProfile,
    placement: actorPlacement,
    linkedTrainerSheets,
  })) fail(403, 'Equipment action actor is not controlled by this principal.')
  for (const targetId of command.targetPlacementIds) {
    const target = storedMap.placements.find(placement => placement.id === targetId)
      ?? fail(409, 'Equipment action target is unavailable.')
    if (input.role === 'player' && !actorCanControlMapPlacement({
      role: input.role,
      profile: input.playerProfile,
      placement: target,
      linkedTrainerSheets,
    })) fail(403, 'Equipment action target is not controlled by this principal.')
  }
  if (storedMap.initiative?.activeId && storedMap.initiative.activeId !== actorPlacement.id) {
    fail(409, 'Equipment actions may only be taken on the acting participant’s turn.')
  }

  const projection = buildEncounterPresentationProjection({
    role: input.role,
    playerProfile: input.playerProfile,
    map: storedMap,
    mapRevision,
    pokemonSheets,
    trainerSheets,
    generatedAt: dependencies.now?.() ?? Date.now(),
  })
  const offer = projection.offers.find(candidate => candidate.offerId === command.offerId)
    ?? fail(409, 'Equipment action offer is unavailable or stale.')
  if (offer.actor.participantId !== actorPlacement.id
    || offer.intent.actionId !== command.actionId
    || offer.source.sourceKind !== 'item'
    || offer.availability.status !== 'available') fail(409, 'Equipment action offer no longer matches current authority.')

  const equipmentGrantQueries = createEncounterEquipmentGrantQueries({
    map: storedMap,
    sheets: [
      ...pokemonSheets.map(sheet => ({ kind: 'pokemon' as const, slug: sheet.slug, sheet })),
      ...trainerSheets.map(sheet => ({ kind: 'trainer' as const, slug: sheet.slug, sheet })),
    ],
  })
  const resolved = equipmentGrantQueries.resolve(actorPlacement.id)
  const actorSource = resolved?.active.find(entry => (
    entry.instanceId === command.equipmentInstanceId
    && entry.instanceRevision === command.equipmentInstanceRevision
    && entry.canonicalItemId === offer.source.canonicalId
    && entry.grant.kind === 'action'
    && entry.grant.actionId === command.actionId
    && entry.grant.executionStatus === 'native'
  ))
  const largeSnagSource: ResolvedEquipmentGrant | null = (() => {
    if (actorSource || command.actionId !== 'equipment.snag-machine.convert'
      || actorPlacement.sheetKind !== 'trainer'
      || command.equipmentInstanceRevision !== normalizeRevision(actorSheet.revision)) return null
    const machine = resolveLargeSnagMachineInventorySource({
      sheet: actorSheet as TrainerSheet,
      sourceInstanceId: command.equipmentInstanceId,
    })
    const grant = equipmentGrantDefinitionFor('Snag Machine')?.grants.find(candidate => (
      candidate.kind === 'action'
      && candidate.actionId === 'equipment.snag-machine.convert'
      && candidate.executionStatus === 'native'
    ))
    return machine && grant && offer.source.canonicalId === 'Snag Machine'
      ? Object.freeze({
          grant,
          instanceId: machine.sourceInstanceId,
          instanceRevision: normalizeRevision(actorSheet.revision),
          canonicalItemId: 'Snag Machine',
        })
      : null
  })()
  const source = actorSource ?? largeSnagSource ?? (() => {
    if (command.actionId !== 'equipment.shock-collar.activate'
      || command.targetPlacementIds.length !== 1
      || !command.targetEquipmentInstanceId
      || command.targetEquipmentInstanceRevision === null) return null
    const targetPlacement = storedMap.placements.find(placement => placement.id === command.targetPlacementIds[0])
    const targetSheet = targetPlacement?.sheetKind === 'pokemon'
      ? pokemonBySlug.get(targetPlacement.sheetSlug)
      : targetPlacement ? trainerBySlug.get(targetPlacement.sheetSlug) : null
    const collar = targetPlacement ? equipmentGrantQueries.resolve(targetPlacement.id)?.active.find(entry => (
      entry.instanceId === command.targetEquipmentInstanceId
      && entry.instanceRevision === command.targetEquipmentInstanceRevision
      && entry.canonicalItemId === 'Shock Collar'
      && entry.grant.kind === 'action'
      && entry.grant.actionId === command.actionId
      && entry.grant.executionStatus === 'native'
    )) : null
    const authority = targetPlacement && targetSheet && collar
      ? shockCollarImplicitRemoteAuthority({ placement: targetPlacement, sheet: targetSheet, collarSource: collar })
      : null
    return authority
      && actorPlacement.sheetKind === 'trainer'
      && actorPlacement.sheetSlug === authority.holderTrainerSlug
      && command.equipmentInstanceId === authority.remoteInstanceId
      && command.equipmentInstanceRevision === authority.remoteInstanceRevision
      ? collar : null
  })() ?? fail(409, 'Equipment action source is stale or unavailable.')
  const campaignClockAction = command.actionId === 'equipment.fishing.old-rod'
    || command.actionId === 'equipment.fishing.good-rod'
    || command.actionId === 'equipment.fishing.super-rod'
    || command.actionId === 'equipment.snag-machine.convert'
  const campaignClock = campaignClockAction ? campaignClockRepository.get() : null
  const randomInt = dependencies.randomInt ?? secureRandomInt
  const rollD20 = (rollId: string): EquipmentActionRollV1 => {
    const naturalResult = randomInt(1, 21)
    if (!Number.isSafeInteger(naturalResult) || naturalResult < 1 || naturalResult > 20) {
      throw new Error('Equipment action server RNG produced an invalid d20 result.')
    }
    return Object.freeze({
      rollId: `equipment-action-roll:${command.operationId}:${rollId}`,
      expression: '1d20',
      naturalResult,
      modifier: 0,
      total: naturalResult,
    })
  }
  let mechanic: ReturnType<typeof executeDeferredEquipmentActionMechanic>
  try {
    mechanic = executeDeferredEquipmentActionMechanic({
      command,
      source,
      map: storedMap,
      actorPlacement,
      actorSheet,
      pokemonSheets: pokemonBySlug,
      trainerSheets: trainerBySlug,
      rollD20,
      equipmentGrantsForPlacement: placementId => equipmentGrantQueries.resolve(placementId),
      campaignClock,
    })
  }
  catch (error) {
    if (error instanceof DeferredEquipmentActionError) fail(409, error.message)
    throw error
  }

  const now = dependencies.now?.() ?? Date.now()
  const nextMap: TabletopMap = {
    ...deepCloneJson(mechanic.map),
    revision: nextRevision(mapRevision),
    updatedAt: now,
  }
  const plannedSheets = mechanic.sheetMutations.map((mutation) => {
    const currentRevision = normalizeRevision(mutation.previous.revision)
    return {
      ...mutation,
      expectedRevision: currentRevision,
      current: {
        ...deepCloneJson(mutation.current) as unknown as Record<string, unknown>,
        slug: mutation.slug,
        revision: nextRevision(currentRevision),
        updatedAt: now,
      },
    }
  })
  const result = parseEquipmentActionPublicResult({
    schemaVersion: 1,
    operationId: command.operationId,
    mapSlug: command.mapSlug,
    mapRevision: normalizeRevision(nextMap.revision),
    actorPlacementId: command.actorPlacementId,
    actionId: command.actionId,
    status: mechanic.status,
    exactReplay: false,
    targetPlacementIds: command.targetPlacementIds,
    rolls: mechanic.rolls,
    receipts: mechanic.receipts,
  })
  const fishingRequest = mechanic.fishingDeclaration ? (() => {
    const fishingActionId = isFishingActionId(command.actionId)
      ? command.actionId
      : fail(409, 'Fishing declaration returned for a non-fishing action.')
    const equipment = parseSheetEquipmentStateForOwner(actorSheet.equipmentState, {
      kind: actorPlacement.sheetKind,
      slug: actorPlacement.sheetSlug,
    })
    const definitionSha256 = equipmentGrantDefinitionSha256(source.canonicalItemId)
      ?? fail(409, 'The reviewed fishing rod definition hash is unavailable.')
    const actorLabel = actorPlacement.sheetKind === 'trainer'
      ? (actorSheet as TrainerSheet).name?.trim() || actorSheet.slug
      : (actorSheet as CharacterSheet).nickname?.trim()
        || (actorSheet as CharacterSheet).species?.trim() || actorSheet.slug
    const hookFact = source.canonicalItemId === 'Old Rod'
      ? 'Hook outcomes are limited to Small, unevolved Pokémon at Level 10 or lower.'
      : source.canonicalItemId === 'Good Rod'
        ? 'Hook outcomes are limited to unevolved Pokémon at a GM-selected level.'
        : 'Hook outcomes may use any Pokémon size and evolutionary stage at GM discretion.'
    return {
      declaration: mechanic.fishingDeclaration,
      definitionSha256,
      equipmentRevision: equipment.revision,
      actionId: fishingActionId,
      actorLabel,
      hookFact,
    }
  })() : null
  const snagRequest = mechanic.snagDeclaration ? (() => {
    if (actorPlacement.sheetKind !== 'trainer') fail(409, 'Snag Machine conversion requires a Trainer actor.')
    const definitionSha256 = equipmentGrantDefinitionSha256('Snag Machine')
      ?? fail(409, 'The reviewed Snag Machine definition hash is unavailable.')
    const trainer = actorSheet as TrainerSheet
    return {
      declaration: mechanic.snagDeclaration,
      definitionSha256,
      actorLabel: trainer.name?.trim() || trainer.slug,
    }
  })() : null
  const consultedSheetRevisions = [
    { kind: actorPlacement.sheetKind, slug: actorPlacement.sheetSlug, revision: normalizeRevision(actorSheet.revision) },
    ...mechanic.sheetMutations.map(mutation => ({
      kind: mutation.kind,
      slug: mutation.slug,
      revision: normalizeRevision(mutation.previous.revision),
    })),
  ].filter((entry, index, rows) => rows.findIndex(candidate => (
    candidate.kind === entry.kind && candidate.slug === entry.slug
  )) === index)

  let racedResult: EquipmentActionPublicResultV1 | null = null
  const events = database.withTransaction(() => {
    const raced = operationRepository.find(command.operationId)
    if (raced) {
      if (raced.commandSha256 !== commandSha256) fail(409, 'Equipment action operation ID was reused with changed input.')
      if (raced.principalKey !== replayPrincipal) fail(403, 'Equipment action replay belongs to a different principal.')
      racedResult = parseEquipmentActionPublicResult({ ...raced.result, exactReplay: true })
      return []
    }
    sheetRepository.assertRevisions(consultedSheetRevisions)
    if (fishingRequest) {
      const currentClock = campaignClockRepository.get()
      if (currentClock.revision !== fishingRequest.declaration.campaignClockRevision
        || currentClock.campaignMinute !== fishingRequest.declaration.startedAtCampaignMinute) {
        fail(409, 'The campaign clock changed before the fishing declaration committed.')
      }
      const conflict = guidedRequestRepository.listPending().find(record => (
        record.requestKind === 'fishing-adjudication'
        && record.authority.sourceKind === 'equipped-fishing-rod'
        && (record.authority.instanceId === source.instanceId
          || (record.actorKind === actorPlacement.sheetKind && record.actorSlug === actorPlacement.sheetSlug))
      ))
      if (conflict) fail(409, 'This actor or exact fishing rod already has a fishing attempt in progress.')
    }
    if (snagRequest) {
      const currentClock = campaignClockRepository.get()
      if (currentClock.revision !== snagRequest.declaration.campaignClockRevision
        || currentClock.campaignMinute !== snagRequest.declaration.campaignMinute) {
        fail(409, 'The campaign clock changed before the Snag Machine declaration committed.')
      }
      const conflict = guidedRequestRepository.listPending().find(record => (
        record.requestKind === 'snag-conversion-adjudication'
        && record.authority.sourceKind === 'snag-machine-conversion'
        && (record.authority.machineSourceInstanceId === snagRequest.declaration.machineSourceInstanceId
          || record.authority.ballSourceInstanceId === snagRequest.declaration.ballSourceInstanceId)
      ))
      if (conflict) fail(409, 'This exact Snag Machine or Poké Ball already has a conversion decision pending.')
    }
    if (mapRepository.applyLivePlayUpdate({
      slug: command.mapSlug,
      expectedRevision: mapRevision,
      nextMap,
    }) === 'stale') fail(409, 'Equipment action map changed before commit.')
    dependencies.failAfterWrite?.('map')
    for (const mutation of plannedSheets) {
      if (sheetRepository.applyLivePlayUpdate({
        kind: mutation.kind,
        slug: mutation.slug,
        expectedRevision: mutation.expectedRevision,
        nextSheet: mutation.current,
        sourceOperationId: command.operationId,
      }) === 'stale') fail(409, `Equipment action ${mutation.kind} sheet ${mutation.slug} changed before commit.`)
      dependencies.failAfterWrite?.('sheet')
    }
    const fishingRecord = fishingRequest ? guidedRequestRepository.create({
      requestId: fishingRequest.declaration.requestId,
      requestKind: 'fishing-adjudication',
      canonicalItemId: source.canonicalItemId,
      canonicalDefinitionSha256: fishingRequest.definitionSha256,
      declarationPrincipalKey: replayPrincipal,
      actorKind: actorPlacement.sheetKind,
      actorSlug: actorPlacement.sheetSlug,
      targetKind: actorPlacement.sheetKind,
      targetSlug: actorPlacement.sheetSlug,
      itemOperationId: null,
      declarationOperationId: command.operationId,
      declarationCommand: command as unknown as StrictJsonObject,
      authority: {
        schemaVersion: 1,
        sourceKind: 'equipped-fishing-rod',
        actorLabel: fishingRequest.actorLabel,
        targetLabel: `Water cell ${fishingRequest.declaration.waterCell.x}, ${fishingRequest.declaration.waterCell.y}, ${fishingRequest.declaration.waterCell.z}`,
        timingLabel: '15-minute Extended Action',
        prompt: `Choose one canonical skill for the fishing check, then adjudicate what ${source.canonicalItemId} hooks.`,
        canonicalFacts: [
          'Fishing requires this exact two-handed rod and one adjacent authoritative water cell.',
          'One attempt occupies exactly 15 campaign minutes.',
          fishingRequest.hookFact,
        ],
        settlementFacts: [
          'Bind one accepted generic Skill Check selected by the GM.',
          'Record one bounded hook outcome or no hook.',
          'Retain the reusable exact fishing rod.',
        ],
        reservationLabel: `Exact equipped ${source.canonicalItemId} reserved`,
        boundaryLabel: `No check or hook outcome settles before campaign minute ${fishingRequest.declaration.readyAtCampaignMinute}; cancellation applies no outcome.`,
        mapSlug: command.mapSlug,
        declarationMapRevision: normalizeRevision(nextMap.revision),
        actorPlacementId: actorPlacement.id,
        ownerKind: actorPlacement.sheetKind,
        ownerSlug: actorPlacement.sheetSlug,
        sheetRevision: normalizeRevision(actorSheet.revision),
        equipmentRevision: fishingRequest.equipmentRevision,
        instanceId: source.instanceId,
        instanceRevision: source.instanceRevision,
        actionId: fishingRequest.actionId,
        waterCell: fishingRequest.declaration.waterCell,
        campaignClockRevision: fishingRequest.declaration.campaignClockRevision,
        startedAtCampaignMinute: fishingRequest.declaration.startedAtCampaignMinute,
        readyAtCampaignMinute: fishingRequest.declaration.readyAtCampaignMinute,
        skillCheckIntegrationId: fishingRequest.declaration.skillCheckIntegrationId,
      },
      createdAt: now,
    }) : null
    const snagRecord = snagRequest ? guidedRequestRepository.create({
      requestId: snagRequest.declaration.requestId,
      requestKind: 'snag-conversion-adjudication',
      canonicalItemId: 'Snag Machine',
      canonicalDefinitionSha256: snagRequest.definitionSha256,
      declarationPrincipalKey: replayPrincipal,
      actorKind: 'trainer',
      actorSlug: actorPlacement.sheetSlug,
      targetKind: 'trainer',
      targetSlug: actorPlacement.sheetSlug,
      itemOperationId: null,
      declarationOperationId: command.operationId,
      declarationCommand: command as unknown as StrictJsonObject,
      authority: {
        schemaVersion: 1,
        sourceKind: 'snag-machine-conversion',
        actorLabel: snagRequest.actorLabel,
        targetLabel: snagRequest.declaration.ballCanonicalItemId,
        timingLabel: snagRequest.declaration.variant === 'portable'
          ? 'Swift Action · ready after one round' : 'Large-machine permanent conversion',
        prompt: 'Approve or deny this bounded Snag Ball conversion and retain a private legality note.',
        canonicalFacts: [
          'The converted ball keeps every property of its original reviewed Poké Ball type.',
          'Every Snag Ball applies a −2 penalty to its Poké Ball attack roll and may target an owned Pokémon only with this GM approval.',
          snagRequest.declaration.variant === 'portable'
            ? 'Portable conversion becomes active after one round and lasts only for that round.'
            : 'Large conversion is permanent; each exact Large machine converts at most five balls per campaign day.',
        ],
        settlementFacts: [
          'Bind exactly one unreserved Poké Ball unit from the declared inventory row.',
          'Record approval or denial and the private GM legality note.',
          'Retain the exact Snag Machine and all underlying Poké Ball properties.',
        ],
        reservationLabel: `One ${snagRequest.declaration.ballCanonicalItemId} reserved`,
        boundaryLabel: 'No Snag Ball conversion exists until the GM accepts; denial or cancellation leaves the Poké Ball unchanged.',
        variant: snagRequest.declaration.variant,
        mapSlug: command.mapSlug,
        declarationMapRevision: normalizeRevision(nextMap.revision),
        actorPlacementId: actorPlacement.id,
        trainerSlug: actorPlacement.sheetSlug,
        sheetRevision: normalizeRevision(actorSheet.revision),
        equipmentRevision: snagRequest.declaration.equipmentRevision,
        machineSourceInstanceId: snagRequest.declaration.machineSourceInstanceId,
        machineSourceRevision: snagRequest.declaration.machineSourceRevision,
        ballSourceInstanceId: snagRequest.declaration.ballSourceInstanceId,
        ballCanonicalItemId: snagRequest.declaration.ballCanonicalItemId,
        ballQuantityAtDeclaration: snagRequest.declaration.ballQuantityAtDeclaration,
        declarationRound: snagRequest.declaration.declarationRound,
        campaignClockRevision: snagRequest.declaration.campaignClockRevision,
        campaignMinute: snagRequest.declaration.campaignMinute,
        campaignDayIndex: snagRequest.declaration.campaignDayIndex,
      },
      createdAt: now,
    }) : null
    if (fishingRecord || snagRecord) dependencies.failAfterWrite?.('guided-request')
    const sourceDefinitionHash = equipmentGrantDefinitionSha256(source.canonicalItemId)
    operationRepository.insert({
      commandSha256,
      principalKey: replayPrincipal,
      command,
      result,
      evidence: {
        kind: 'equipment-action',
        actorSheetRevision: normalizeRevision(actorSheet.revision),
        sourceCanonicalItemId: source.canonicalItemId,
        sourceGrantId: source.grant.grantId,
        ...(sourceDefinitionHash ? { sourceDefinitionHash } : {}),
        targetPlacementIds: [...command.targetPlacementIds],
        rollIds: mechanic.rolls.map(roll => roll.rollId),
        receipts: mechanic.receipts.map(receiptValue => ({
          receiptId: receiptValue.receiptId,
          kind: receiptValue.kind,
          reasonCode: receiptValue.reasonCode,
          safeDetail: receiptValue.safeDetail,
        })),
      },
      createdAt: now,
    })
    dependencies.failAfterWrite?.('operation')
    const appendedEvents = realtimeEventRepository.appendMany([
      ...setupMapSaveRealtimeAppendInputs(nextMap, input.clientId),
      ...(fishingRecord ? itemGuidedRequestRealtimeAppendInputs({
        operationId: command.operationId,
        record: fishingRecord,
        clientId: input.clientId,
      }) : []),
      ...(snagRecord ? itemGuidedRequestRealtimeAppendInputs({
        operationId: command.operationId,
        record: snagRecord,
        clientId: input.clientId,
      }) : []),
      ...plannedSheets.flatMap((mutation) => {
        const committed = sheetRepository.getByRef(mutation.kind, mutation.slug)
          ?? fail(409, `Equipment action ${mutation.kind} sheet ${mutation.slug} disappeared after commit.`)
        return setupSheetSaveRealtimeAppendInputs({
          kind: mutation.kind,
          slug: mutation.slug,
          sheet: committed.sheet,
          clientId: input.clientId,
        })
      }),
    ].map(event => ({ ...event, timestamp: now })))
    dependencies.failAfterWrite?.('realtime')
    return appendedEvents
  })
  if (racedResult) return racedResult
  publishPersistedRealtimeEventsAfterCommit({
    events,
    operation: 'equipment-action',
    publish: dependencies.publishPersistedRealtimeEvent ?? defaultPersistedRealtimeEventPublisher,
    reportFailure: dependencies.reportAfterCommitPublicationFailure
      ?? defaultPersistedRealtimePublicationFailureReporter,
  })
  return result
}

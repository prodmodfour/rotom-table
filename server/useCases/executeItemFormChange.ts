import { createHash } from 'node:crypto'
import { createError } from 'h3'
import type { AuthRole } from '#shared/auth'
import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  createEmptyEncounterState,
  parseEncounterState,
} from '#shared/moveAutomation/encounterState'
import {
  ItemFormChangeValidationError,
  parseExecuteItemFormChangeCommand,
  parseItemFormChangePublicResult,
  type ExecuteItemFormChangeCommandV1,
  type ItemFormChangePublicResultV1,
  type ItemFormChangeReadRefV1,
} from '#shared/itemAutomation/formChanges'
import { nextRevision, normalizeRevision } from '#shared/sessionRevisions'
import type { PlayerProfile } from '#shared/playerProfiles'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { deepCloneJson } from '~/utils/serialization'
import { canAccessMapForRole } from '../policies/mapPolicy'
import {
  actorCanControlMapPlacement,
  playerProfileLinkedTrainerSheetsForTokenControl,
} from '../policies/playerProfileTokenControlPolicy'
import {
  applyItemFormChangeCandidate,
  itemFormChangeAuthorityFingerprint,
  resolveItemFormChangeCandidate,
  type ItemFormChangeCandidate,
} from '../domain/itemAutomation/formChanges'
import { buildEncounterPresentationProjection } from '../domain/encounterPresentation/buildProjection'
import {
  EncounterResourceReductionError,
  spendEncounterMoveResourceCosts,
} from '../domain/moveAutomation/reduceEncounterResources'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import { createSqliteMapRepository, type MapRepository } from '../storage/mapRepository'
import {
  createSqliteSheetRepository,
  type SheetRepository,
} from '../storage/sheetRepository'
import { listRepositorySheets, type ListSheetsRepository } from './listSheets'
import {
  createSqliteItemFormChangeOperationRepository,
  type ItemFormChangeOperationRepository,
} from '../storage/itemFormChangeOperationRepository'
import {
  createSqliteRealtimeEventRepository,
  type RealtimeEventRepository,
} from '../storage/realtimeEventRepository'
import { setupMapSaveRealtimeAppendInputs } from '../realtime/setupDocumentRealtime'
import {
  defaultPersistedRealtimeEventPublisher,
  defaultPersistedRealtimePublicationFailureReporter,
  publishPersistedRealtimeEventsAfterCommit,
  type PersistedRealtimeEventPublisher,
  type PersistedRealtimePublicationFailureReporter,
} from '../realtime/persistedBatchPublication'

export interface ExecuteItemFormChangeInput {
  readonly role: AuthRole
  readonly playerProfile?: PlayerProfile | null
  readonly command: unknown
}

export interface ExecuteItemFormChangeDependencies {
  readonly database?: RotomDatabase
  readonly mapRepository?: Pick<MapRepository<TabletopMap>, 'getBySlug' | 'applyLivePlayUpdate'> & { readonly database?: RotomDatabase }
  readonly sheetRepository?: Pick<
    SheetRepository<Record<string, unknown>>,
    'list' | 'assertRevisions'
  > & ListSheetsRepository & { readonly database?: RotomDatabase }
  readonly operationRepository?: ItemFormChangeOperationRepository
  readonly realtimeEventRepository?: Pick<RealtimeEventRepository, 'appendMany'> & { readonly database?: RotomDatabase }
  readonly now?: () => number
  readonly publishPersistedRealtimeEvent?: PersistedRealtimeEventPublisher
  readonly reportAfterCommitPublicationFailure?: PersistedRealtimePublicationFailureReporter
}

const fail = (statusCode: number, statusMessage: string): never => { throw createError({ statusCode, statusMessage }) }
const hash = (value: unknown): string => createHash('sha256').update(stableJsonStringify(value)).digest('hex')
const principalKey = (input: ExecuteItemFormChangeInput): string => input.role === 'player'
  ? `player:${input.playerProfile?.id ?? 'missing-profile'}`
  : input.role
const databaseFrom = (dependencies: ExecuteItemFormChangeDependencies): RotomDatabase => {
  const candidates = [
    dependencies.mapRepository?.database,
    dependencies.sheetRepository?.database,
    dependencies.operationRepository?.database,
    dependencies.realtimeEventRepository?.database,
  ].filter((entry): entry is RotomDatabase => Boolean(entry))
  const database = dependencies.database ?? candidates[0] ?? getRotomDatabase()
  if (candidates.some(candidate => candidate !== database)) {
    throw new Error('Item form-change repositories must share one RotomDatabase.')
  }
  return database
}
const parseCommand = (value: unknown): ExecuteItemFormChangeCommandV1 => {
  try { return parseExecuteItemFormChangeCommand(value) }
  catch (error) {
    if (error instanceof ItemFormChangeValidationError) fail(400, 'Invalid item form-change command.')
    throw error
  }
}
const currentReadSet = (input: {
  readonly map: TabletopMap
  readonly mapRevision: number
  readonly pokemonSheets: readonly CharacterSheet[]
  readonly trainerSheets: readonly TrainerSheet[]
}): readonly ItemFormChangeReadRefV1[] => [
  { kind: 'map', sheetKind: null, id: input.map.slug, revision: input.mapRevision },
  ...[
    ...input.pokemonSheets.map(sheet => ({ kind: 'sheet' as const, sheetKind: 'pokemon' as const, id: sheet.slug, revision: normalizeRevision(sheet.revision) })),
    ...input.trainerSheets.map(sheet => ({ kind: 'sheet' as const, sheetKind: 'trainer' as const, id: sheet.slug, revision: normalizeRevision(sheet.revision) })),
  ].sort((left, right) => `${left.sheetKind}:${left.id}`.localeCompare(`${right.sheetKind}:${right.id}`)),
]

export const executeItemFormChangeUseCase = (
  input: ExecuteItemFormChangeInput,
  dependencies: ExecuteItemFormChangeDependencies = {},
): ItemFormChangePublicResultV1 => {
  const command = parseCommand(input.command)
  const commandSha256 = hash(command)
  const replayPrincipal = principalKey(input)
  const database = databaseFrom(dependencies)
  const mapRepository = dependencies.mapRepository ?? createSqliteMapRepository<TabletopMap>(database)
  const sheetRepository = dependencies.sheetRepository ?? createSqliteSheetRepository<Record<string, unknown>>(database)
  const operationRepository = dependencies.operationRepository ?? createSqliteItemFormChangeOperationRepository(database)
  const realtimeEventRepository = dependencies.realtimeEventRepository ?? createSqliteRealtimeEventRepository({ database })
  const existing = operationRepository.find(command.operationId)
  if (existing) {
    if (existing.commandSha256 !== commandSha256) fail(409, 'Item form-change operation ID was reused with changed input.')
    if (existing.principalKey !== replayPrincipal) fail(403, 'Item form-change operation replay belongs to a different principal.')
    return parseItemFormChangePublicResult({ ...existing.result, exactReplay: true })
  }

  const storedMap = mapRepository.getBySlug(command.mapSlug) ?? fail(404, 'Item form-change map is missing.')
  if (!canAccessMapForRole(input.role, storedMap)) fail(403, 'Item form-change map is not player visible.')
  const currentRevision = normalizeRevision(storedMap.revision)
  if (currentRevision !== command.baseRevision) fail(409, 'Item form-change projection is stale.')
  const pokemonSheets = listRepositorySheets<CharacterSheet>(sheetRepository, 'pokemon')
  const trainerSheets = listRepositorySheets<TrainerSheet>(sheetRepository, 'trainer')
  const sheets = {
    pokemon: new Map(pokemonSheets.map(sheet => [sheet.slug, sheet])),
    trainer: new Map(trainerSheets.map(sheet => [sheet.slug, sheet])),
  }
  const actorPlacement = storedMap.placements.find(placement => placement.id === command.actorPlacementId)
    ?? fail(409, 'Item form-change actor is unavailable.')
  const linkedTrainerSheets = playerProfileLinkedTrainerSheetsForTokenControl(
    input.playerProfile,
    slug => sheets.trainer.get(slug),
  )
  if (!actorCanControlMapPlacement({
    role: input.role,
    profile: input.playerProfile,
    placement: actorPlacement,
    linkedTrainerSheets,
  })) fail(403, 'Item form-change actor is not controlled by this principal.')
  if (storedMap.initiative?.activeId !== actorPlacement.id) {
    fail(409, 'Mega Evolution must be triggered on the acting Trainer or Pokémon’s turn.')
  }

  const projection = buildEncounterPresentationProjection({
    role: input.role,
    playerProfile: input.playerProfile,
    map: storedMap,
    mapRevision: currentRevision,
    pokemonSheets,
    trainerSheets,
    generatedAt: dependencies.now?.() ?? Date.now(),
  })
  const offer = projection.offers.find(candidate => candidate.offerId === command.offerId)
    ?? fail(409, 'Item form-change offer is unavailable or stale.')
  if (offer.actor.participantId !== command.actorPlacementId
    || offer.intent.actionId !== 'item.form-change.mega-evolve'
    || offer.source.sourceKind !== 'item'
    || offer.availability.status !== 'available') {
    fail(409, 'Item form-change offer no longer matches current authority.')
  }

  const candidate: ItemFormChangeCandidate = (() => {
    try {
      return resolveItemFormChangeCandidate({
        map: storedMap,
        actorPlacementId: command.actorPlacementId,
        targetPlacementId: command.targetPlacementId,
        sheets,
        abilityOptionId: command.abilityOptionId,
      })
    }
    catch (error) {
      return fail(409, error instanceof Error ? error.message : 'Mega Evolution authority is unavailable.')
    }
  })()
  const selectedAbilityId = candidate.selectedAbilityId
    ?? fail(409, 'Mega Evolution Ability choice is incomplete.')
  const expectedReadSet = currentReadSet({
    map: storedMap,
    mapRevision: currentRevision,
    pokemonSheets: [candidate.pokemonSheet],
    trainerSheets: [candidate.trainerSheet],
  })
  if (stableJsonStringify(command.readSet) !== stableJsonStringify(expectedReadSet)) {
    fail(409, 'Item form-change authority changed after declaration. Refresh before retrying.')
  }

  const now = dependencies.now?.() ?? Date.now()
  const encounter = parseEncounterState(storedMap.encounterState ?? createEmptyEncounterState())
  let mapAfterCost: TabletopMap
  try {
    const spent = spendEncounterMoveResourceCosts(encounter.turnResources, {
      placementId: actorPlacement.id,
      canonicalMoveId: 'Item:Mega Evolution',
      resolutionId: `item-form-change:${command.operationId}`,
      sourceOperationId: command.operationId,
      costs: [{
        id: 'item-form-change.swift-action',
        phase: 'pay',
        cost: { kind: 'action-resource', resource: 'swift', amount: 1 },
      }],
      movementBudget: null,
      movementDistance: 0,
      round: encounter.history.currentRound ?? storedMap.initiative?.round ?? null,
      turn: encounter.history.currentTurn?.turn ?? null,
      actedThisRound: encounter.history.actedThisRoundPlacementIds.includes(actorPlacement.id),
    })
    mapAfterCost = {
      ...storedMap,
      encounterState: parseEncounterState({ ...encounter, turnResources: spent.resources }),
    }
  }
  catch (error) {
    if (error instanceof EncounterResourceReductionError) fail(409, error.message)
    throw error
  }
  const changedMap = applyItemFormChangeCandidate({
    map: mapAfterCost,
    candidate,
    operationId: command.operationId,
    acceptedAt: now,
  })
  const nextMap: TabletopMap = {
    ...deepCloneJson(changedMap),
    revision: nextRevision(currentRevision),
    updatedAt: now,
  }
  const acceptedEntry = nextMap.encounterState?.itemFormChanges?.entries
    .find(entry => entry.sourceOperationId === command.operationId)
    ?? fail(409, 'Accepted Mega Evolution provenance was not retained in encounter state.')
  const result = parseItemFormChangePublicResult({
    schemaVersion: 1,
    operationId: command.operationId,
    mapSlug: command.mapSlug,
    mapRevision: normalizeRevision(nextMap.revision),
    actorPlacementId: actorPlacement.id,
    targetPlacementId: candidate.targetPlacement.id,
    formName: candidate.form.displayName,
    abilityName: selectedAbilityId,
    durationLabel: 'Scene',
    status: 'accepted',
    exactReplay: false,
    message: `${candidate.pokemonSheet.nickname || candidate.pokemonSheet.species} became ${candidate.form.displayName} for this Scene.`,
  })
  const sheetRevisions = expectedReadSet.flatMap(read => read.kind === 'sheet' && read.sheetKind
    ? [{ kind: read.sheetKind, slug: read.id, revision: read.revision }]
    : [])
  let racedResult: ItemFormChangePublicResultV1 | null = null
  const events = database.withTransaction(() => {
    const raced = operationRepository.find(command.operationId)
    if (raced) {
      if (raced.commandSha256 !== commandSha256) fail(409, 'Item form-change operation ID was reused with changed input.')
      if (raced.principalKey !== replayPrincipal) fail(403, 'Item form-change operation replay belongs to a different principal.')
      racedResult = parseItemFormChangePublicResult({ ...raced.result, exactReplay: true })
      return []
    }
    sheetRepository.assertRevisions(sheetRevisions)
    if (mapRepository.applyLivePlayUpdate({
      slug: command.mapSlug,
      expectedRevision: currentRevision,
      nextMap,
    }) === 'stale') fail(409, 'Item form-change map changed before commit.')
    operationRepository.insert({
      commandSha256,
      principalKey: replayPrincipal,
      command,
      result,
      evidence: {
        kind: 'item-form-change-accepted',
        ruleRecordSha256: itemFormChangeAuthorityFingerprint(),
        formId: candidate.form.formId,
        formRecordSha256: candidate.form.recordSha256,
        baseSpeciesRecordSha256: acceptedEntry.baseSpeciesRecordSha256,
        abilityRecordSha256: acceptedEntry.abilityRecordSha256,
        actorSheetRevision: normalizeRevision((actorPlacement.sheetKind === 'pokemon'
          ? sheets.pokemon.get(actorPlacement.sheetSlug)
          : sheets.trainer.get(actorPlacement.sheetSlug))?.revision),
        targetSheetRevision: normalizeRevision(candidate.pokemonSheet.revision),
        trainerSheetRevision: normalizeRevision(candidate.trainerSheet.revision),
        ringInstanceId: candidate.ringSource.instanceId,
        ringInstanceRevision: candidate.ringSource.instanceRevision,
        ringCanonicalRecordSha256: acceptedEntry.ringCanonicalRecordSha256,
        ringEquipmentDefinitionSha256: acceptedEntry.ringEquipmentDefinitionSha256,
        stoneInstanceId: candidate.stoneSource?.instanceId ?? null,
        stoneInstanceRevision: candidate.stoneSource?.instanceRevision ?? null,
        stoneCanonicalRecordSha256: acceptedEntry.stoneCanonicalRecordSha256,
        stoneEquipmentDefinitionSha256: acceptedEntry.stoneEquipmentDefinitionSha256,
        sceneStartedAt: storedMap.activeScene?.startedAt ?? null,
        abilityId: selectedAbilityId,
      },
      createdAt: now,
    })
    return realtimeEventRepository.appendMany(
      setupMapSaveRealtimeAppendInputs(nextMap).map(event => ({ ...event, timestamp: now })),
    )
  })
  if (racedResult) return racedResult
  publishPersistedRealtimeEventsAfterCommit({
    events,
    operation: 'item-form-change',
    publish: dependencies.publishPersistedRealtimeEvent ?? defaultPersistedRealtimeEventPublisher,
    reportFailure: dependencies.reportAfterCommitPublicationFailure ?? defaultPersistedRealtimePublicationFailureReporter,
  })
  return result
}

import { createHash } from 'node:crypto'
import { createError } from 'h3'
import type { AuthRole } from '#shared/auth'
import type { PlayerProfile } from '#shared/playerProfiles'
import { stableJsonStringify } from '#shared/automation/stableJson'
import type { StrictJsonObject } from '#shared/automation/strictJson'
import { nextRevision, normalizeRevision } from '#shared/sessionRevisions'
import {
  ITEM_REPEL_NEXT_TURN_SHIFT_FLAG_ID,
  ItemExplorationValidationError,
  parseItemExplorationOperationCommand,
  parseItemExplorationOperationResult,
  parseItemExplorationState,
  parseItemExplorationEncounterState,
  projectItemExplorationState,
  type ItemExplorationOperationCommandV1,
  type ItemExplorationOperationResultV1,
  type ItemRouteLureActivityV1,
} from '#shared/itemAutomation/exploration'
import { parseItemInventoryInstanceId } from '#shared/itemAutomation/inventory'
import { createEmptyEncounterState, parseEncounterState } from '#shared/moveAutomation/encounterState'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { deepCloneJson } from '~/utils/serialization'
import { resolveTrainerSkills } from '~/utils/sheets/trainerDerived'
import { ptuGridVectorDistance } from '~/utils/ptuGridDistance'
import { linkedPokemonSlugSet } from '~/utils/pokeballCapture'
import { playerProfileCanControlTokenSheet } from '#shared/playerProfileTokenControl'
import {
  resolveItemRouteLureCheck,
  settleItemRouteLure,
} from '../domain/itemAutomation/exploration'
import { ITEM_AUTOMATION_RUNTIME_REGISTRY } from '../domain/itemAutomation/registry'
import { consumeAuthoritativeItemSourceRow } from '../domain/itemAutomation/sourceInventory'
import { resolveAuthoritativeMovement } from '../domain/movement/resolveMovement'
import { scheduleExplorationNextTurnForfeit } from '../domain/moveAutomation/reduceEncounterResources'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import {
  createSqliteItemExplorationOperationRepository,
  type ItemExplorationOperationRepository,
} from '../storage/itemExplorationOperationRepository'
import { createSqliteCampaignClockRepository, type CampaignClockRepository } from '../storage/campaignClockRepository'
import { createSqliteSheetRepository, type SheetRepository } from '../storage/sheetRepository'
import { createSqliteMapRepository, type MapRepository } from '../storage/mapRepository'
import { createSqliteRealtimeEventRepository, type RealtimeEventRepository } from '../storage/realtimeEventRepository'
import { setupMapSaveRealtimeAppendInputs, setupSheetSaveRealtimeAppendInputs } from '../realtime/setupDocumentRealtime'
import {
  defaultPersistedRealtimeEventPublisher,
  defaultPersistedRealtimePublicationFailureReporter,
  publishPersistedRealtimeEventsAfterCommit,
  type PersistedRealtimeEventPublisher,
  type PersistedRealtimePublicationFailureReporter,
} from '../realtime/persistedBatchPublication'

export interface ExecuteItemExplorationOperationInput {
  readonly role: AuthRole
  readonly playerProfile?: PlayerProfile | null
  readonly command: unknown
  readonly clientId?: string
}

export interface ExecuteItemExplorationOperationDependencies {
  readonly database?: RotomDatabase
  readonly sheetRepository?: Pick<SheetRepository<Record<string, unknown>>, 'getByRef' | 'list' | 'applyLivePlayUpdate'> & { readonly database?: RotomDatabase }
  readonly mapRepository?: Pick<MapRepository<TabletopMap>, 'getBySlug' | 'applyLivePlayUpdate'> & { readonly database?: RotomDatabase }
  readonly operationRepository?: ItemExplorationOperationRepository
  readonly campaignClockRepository?: CampaignClockRepository
  readonly realtimeEventRepository?: Pick<RealtimeEventRepository, 'appendMany'> & { readonly database?: RotomDatabase }
  readonly now?: () => number
  readonly rollDie?: (sides: number) => number
  readonly publishPersistedRealtimeEvent?: PersistedRealtimeEventPublisher
  readonly reportAfterCommitPublicationFailure?: PersistedRealtimePublicationFailureReporter
}

const fail = (statusCode: number, statusMessage: string): never => { throw createError({ statusCode, statusMessage }) }
const hash = (value: unknown): string => createHash('sha256').update(stableJsonStringify(value)).digest('hex')
const principalKey = (input: ExecuteItemExplorationOperationInput): string => input.role === 'player'
  ? `player:${input.playerProfile?.id ?? 'missing-profile'}`
  : input.role

const databaseFrom = (dependencies: ExecuteItemExplorationOperationDependencies): RotomDatabase => {
  const candidates = [
    dependencies.sheetRepository?.database,
    dependencies.mapRepository?.database,
    dependencies.operationRepository?.database,
    dependencies.campaignClockRepository?.database,
    dependencies.realtimeEventRepository?.database,
  ].filter((entry): entry is RotomDatabase => Boolean(entry))
  const database = dependencies.database ?? candidates[0] ?? getRotomDatabase()
  if (candidates.some(candidate => candidate !== database)) {
    throw new Error('Item exploration repositories must share one RotomDatabase.')
  }
  return database
}

const parseCommand = (value: unknown): ItemExplorationOperationCommandV1 => {
  try { return parseItemExplorationOperationCommand(value) }
  catch (error) {
    if (error instanceof ItemExplorationValidationError) fail(400, 'Invalid item exploration command.')
    throw error
  }
}

const serverRoll = (roller: ((sides: number) => number) | undefined, sides: number): number => {
  const value = roller ? roller(sides) : Math.floor(Math.random() * sides) + 1
  if (!Number.isSafeInteger(value) || value < 1 || value > sides) {
    throw new Error(`Item exploration entropy must return an integer from 1 through ${sides}.`)
  }
  return value
}

const storedTrainerSheet = (stored: ReturnType<NonNullable<ExecuteItemExplorationOperationDependencies['sheetRepository']>['getByRef']>): TrainerSheet => {
  if (!stored) return fail(404, 'The exploration Trainer sheet is missing.')
  return {
    ...(structuredClone(stored.sheet) as unknown as TrainerSheet),
    slug: stored.slug,
    revision: stored.revision,
    updatedAt: stored.updatedAt,
  }
}

const authorizeTrainer = (input: ExecuteItemExplorationOperationInput, trainer: TrainerSheet): void => {
  if (input.role === 'gm') return
  if (!playerProfileCanControlTokenSheet(input.playerProfile, 'trainer', trainer.slug, {
    linkedTrainerSheets: [trainer],
  })) fail(403, 'This principal does not control the exploration Trainer.')
}

const assertActivityAuthority = (trainer: TrainerSheet, activityId: string): ItemRouteLureActivityV1 => {
  const state = parseItemExplorationState(trainer.serverPrivate?.itemExploration)
  const matches = state.routeLures.filter(activity => activity.activityId === activityId)
  if (matches.length !== 1) return fail(409, 'The exact route lure activity is unavailable.')
  const activity = matches[0]!
  const definition = ITEM_AUTOMATION_RUNTIME_REGISTRY.resolve(activity.canonicalItemId)
  if (!definition || definition.definitionSha256 !== activity.canonicalDefinitionSha256) {
    return fail(409, 'The reviewed route lure definition changed. Refresh before retrying.')
  }
  if (activity.reusable) {
    const source = parseItemInventoryInstanceId(activity.sourceInstanceId)
    const rows = source?.containerKind === 'trainer' && source.containerSlug === trainer.slug
      ? trainer.inventory?.[source.section] ?? []
      : []
    const exactRows = source ? rows.filter(row => row.id === source.rowId) : []
    if (!source || exactRows.length !== 1 || definition.canonicalId !== 'Fishing Lure'
      || ITEM_AUTOMATION_RUNTIME_REGISTRY.resolve(exactRows[0]!.name)?.canonicalId !== 'Fishing Lure') {
      return fail(409, 'The exact reusable Fishing Lure source is no longer in authoritative custody.')
    }
  }
  return activity
}

const activityProjection = (trainer: TrainerSheet, campaignMinute: number, activityId: string) => {
  const rank = resolveTrainerSkills(trainer).find(skill => skill.key === 'occultEd')?.rankValue ?? 0
  return projectItemExplorationState({
    state: trainer.serverPrivate?.itemExploration,
    campaignMinute,
    occultEducationRank: rank,
  }).routeLures.find(activity => activity.activityId === activityId)
    ?? fail(409, 'The accepted route lure projection is unavailable.')
}

const resultForRoute = (input: {
  readonly command: Exclude<ItemExplorationOperationCommandV1, { readonly kind: 'settle-direct-repel' }>
  readonly trainer: TrainerSheet
  readonly campaignMinute: number
  readonly message: string
}): ItemExplorationOperationResultV1 => parseItemExplorationOperationResult({
  schemaVersion: 1,
  operationId: input.command.operationId,
  kind: input.command.kind,
  status: 'accepted',
  exactReplay: false,
  message: input.message,
  trainerSlug: input.trainer.slug,
  trainerRevision: normalizeRevision(input.trainer.revision),
  mapSlug: null,
  mapRevision: null,
  activity: activityProjection(input.trainer, input.campaignMinute, input.command.activityId),
})

const allMovementSheets = (
  repository: NonNullable<ExecuteItemExplorationOperationDependencies['sheetRepository']>,
): { readonly pokemon: ReadonlyMap<string, CharacterSheet>, readonly trainer: ReadonlyMap<string, TrainerSheet> } => {
  const pokemon = new Map<string, CharacterSheet>()
  const trainer = new Map<string, TrainerSheet>()
  for (const stored of repository.list('pokemon')) {
    pokemon.set(stored.slug, {
      ...(structuredClone(stored.document) as unknown as CharacterSheet),
      slug: stored.slug,
      revision: stored.revision,
      updatedAt: stored.updatedAt,
    })
  }
  for (const stored of repository.list('trainer')) {
    trainer.set(stored.slug, {
      ...(structuredClone(stored.document) as unknown as TrainerSheet),
      slug: stored.slug,
      revision: stored.revision,
      updatedAt: stored.updatedAt,
    })
  }
  return { pokemon, trainer }
}

export const executeItemExplorationOperationUseCase = (
  input: ExecuteItemExplorationOperationInput,
  dependencies: ExecuteItemExplorationOperationDependencies = {},
): ItemExplorationOperationResultV1 => {
  const command = parseCommand(input.command)
  const commandSha256 = hash(command)
  const replayPrincipal = principalKey(input)
  const database = databaseFrom(dependencies)
  const sheetRepository = dependencies.sheetRepository ?? createSqliteSheetRepository<Record<string, unknown>>(database)
  const mapRepository = dependencies.mapRepository ?? createSqliteMapRepository<TabletopMap>(database)
  const operationRepository = dependencies.operationRepository ?? createSqliteItemExplorationOperationRepository(database)
  const clockRepository = dependencies.campaignClockRepository ?? createSqliteCampaignClockRepository(database)
  const realtimeEventRepository = dependencies.realtimeEventRepository ?? createSqliteRealtimeEventRepository({ database })
  const existing = operationRepository.find(command.operationId)
  if (existing) {
    if (existing.commandSha256 !== commandSha256) fail(409, 'Item exploration operation ID was reused with changed input.')
    if (existing.principalKey !== replayPrincipal) fail(403, 'Item exploration replay belongs to a different principal.')
    return parseItemExplorationOperationResult({ ...existing.result, exactReplay: true })
  }
  const now = dependencies.now?.() ?? Date.now()

  if (command.kind !== 'settle-direct-repel') {
    const stored = sheetRepository.getByRef('trainer', command.trainerSlug)
      ?? fail(404, 'The exploration Trainer sheet is missing.')
    const trainer = storedTrainerSheet(stored)
    authorizeTrainer(input, trainer)
    if (normalizeRevision(trainer.revision) !== command.trainerRevision) {
      fail(409, 'The exploration Trainer sheet changed. Refresh before retrying.')
    }
    const clock = clockRepository.get()
    if (clock.revision !== command.campaignClockRevision) {
      fail(409, 'The campaign clock changed. Refresh before retrying.')
    }
    const activity = assertActivityAuthority(trainer, command.activityId)
    let settled: ReturnType<typeof resolveItemRouteLureCheck> | ReturnType<typeof settleItemRouteLure>
    let nextTrainer = structuredClone(trainer)
    let evidence: StrictJsonObject
    let message: string

    if (command.kind === 'resolve-route-lure-check') {
      const roll = serverRoll(dependencies.rollDie, 20)
      try {
        settled = resolveItemRouteLureCheck({
          current: trainer.serverPrivate?.itemExploration,
          activityId: activity.activityId,
          campaignMinute: clock.campaignMinute,
          roll,
        })
      }
      catch (error) {
        return fail(409, error instanceof Error ? error.message : 'The route lure check is unavailable.')
      }
      nextTrainer.serverPrivate = { ...(nextTrainer.serverPrivate ?? {}), itemExploration: settled.state }
      evidence = {
        kind: 'route-lure-check',
        activityId: activity.activityId,
        sourceOperationId: activity.sourceOperationId,
        canonicalDefinitionSha256: activity.canonicalDefinitionSha256,
        campaignClockRevision: clock.revision,
        campaignMinute: clock.campaignMinute,
        attempt: settled.activity.attempts.at(-1)?.attempt ?? null,
        roll,
        success: settled.activity.status === 'awaiting-encounter',
      } as unknown as StrictJsonObject
      message = settled.activity.status === 'awaiting-encounter'
        ? 'The route lure check succeeded. A GM must now accept one comparable-party-level encounter.'
        : settled.activity.status === 'completed'
          ? 'The third route lure check did not introduce an encounter.'
          : `The route lure check did not succeed. Attempt ${settled.activity.attempts.length + 1} is due at campaign minute ${settled.activity.nextCheckAtCampaignMinute}.`
    }
    else {
      if (command.outcome !== 'cancelled' && input.role !== 'gm') {
        fail(403, 'Only a GM may accept a route encounter or adjudicate Fishing Lure loss.')
      }
      try {
        settled = settleItemRouteLure({
          current: trainer.serverPrivate?.itemExploration,
          activityId: activity.activityId,
          outcome: command.outcome,
          gm: input.role === 'gm',
        })
      }
      catch (error) {
        return fail(409, error instanceof Error ? error.message : 'The route lure cannot be settled.')
      }
      nextTrainer.serverPrivate = { ...(nextTrainer.serverPrivate ?? {}), itemExploration: settled.state }
      if (command.outcome === 'lure-lost') {
        const source = parseItemInventoryInstanceId(activity.sourceInstanceId)
          ?? fail(409, 'Fishing Lure loss cannot identify its exact reusable source.')
        if (source.containerKind !== 'trainer' || source.containerSlug !== trainer.slug) {
          fail(409, 'Fishing Lure loss cannot identify its exact reusable source.')
        }
        nextTrainer = consumeAuthoritativeItemSourceRow({
          source: {
            kind: 'trainer', slug: trainer.slug, section: source.section,
            rowId: source.rowId, expectedRevision: command.trainerRevision,
          },
          quantity: 1,
          trainerSheet: nextTrainer,
        }).trainerSheet!
      }
      evidence = {
        kind: 'route-lure-settlement',
        activityId: activity.activityId,
        sourceOperationId: activity.sourceOperationId,
        canonicalDefinitionSha256: activity.canonicalDefinitionSha256,
        campaignClockRevision: clock.revision,
        campaignMinute: clock.campaignMinute,
        outcome: command.outcome,
        encounterSelection: command.encounterSelection,
        reusableSourceLost: command.outcome === 'lure-lost',
      } as unknown as StrictJsonObject
      message = command.outcome === 'encounter-introduced'
        ? 'The GM accepted one comparable-party-level route encounter.'
        : command.outcome === 'lure-lost'
          ? 'The GM adjudicated the reusable Fishing Lure as lost and removed exactly one source unit.'
          : 'The route lure was cancelled without another mechanical effect.'
    }
    nextTrainer.updatedAt = now
    let raced: ItemExplorationOperationResultV1 | null = null
    let accepted: ItemExplorationOperationResultV1 | null = null
    const events = database.withTransaction(() => {
      const duplicate = operationRepository.find(command.operationId)
      if (duplicate) {
        if (duplicate.commandSha256 !== commandSha256) fail(409, 'Item exploration operation ID was reused with changed input.')
        if (duplicate.principalKey !== replayPrincipal) fail(403, 'Item exploration replay belongs to a different principal.')
        raced = parseItemExplorationOperationResult({ ...duplicate.result, exactReplay: true })
        return []
      }
      const currentClock = clockRepository.get()
      if (currentClock.revision !== clock.revision || currentClock.campaignMinute !== clock.campaignMinute) {
        fail(409, 'The campaign clock changed before exploration commit.')
      }
      if (sheetRepository.applyLivePlayUpdate({
        kind: 'trainer', slug: trainer.slug, expectedRevision: command.trainerRevision,
        nextSheet: nextTrainer as unknown as Record<string, unknown>,
      }) === 'stale') fail(409, 'The exploration Trainer sheet changed before commit.')
      const storedAfter = sheetRepository.getByRef('trainer', trainer.slug)
        ?? fail(409, 'The exploration Trainer sheet was unavailable after commit.')
      const trainerAfter = storedTrainerSheet(storedAfter)
      accepted = resultForRoute({ command, trainer: trainerAfter, campaignMinute: clock.campaignMinute, message })
      operationRepository.insert({
        commandSha256,
        principalKey: replayPrincipal,
        command,
        result: accepted,
        evidence,
        createdAt: now,
      })
      return realtimeEventRepository.appendMany(setupSheetSaveRealtimeAppendInputs({
        kind: 'trainer', slug: trainerAfter.slug,
        sheet: trainerAfter as unknown as Record<string, unknown>,
        clientId: input.clientId,
      }).map(event => ({ ...event, timestamp: now })))
    })
    if (raced) return raced
    publishPersistedRealtimeEventsAfterCommit({
      events,
      operation: 'item-exploration',
      publish: dependencies.publishPersistedRealtimeEvent ?? defaultPersistedRealtimeEventPublisher,
      reportFailure: dependencies.reportAfterCommitPublicationFailure ?? defaultPersistedRealtimePublicationFailureReporter,
    })
    return accepted ?? fail(409, 'The exploration operation did not retain an accepted result.')
  }

  if (input.role !== 'gm') fail(403, 'Only a GM may settle direct Repel positioning.')
  const storedMap = mapRepository.getBySlug(command.mapSlug) ?? fail(404, 'The direct Repel map is missing.')
  const mapRevision = normalizeRevision(storedMap.revision)
  if (mapRevision !== command.mapRevision) fail(409, 'The direct Repel map changed. Refresh before retrying.')
  const encounter = parseEncounterState(storedMap.encounterState ?? createEmptyEncounterState())
  const decisions = parseItemExplorationEncounterState(encounter.itemExploration).repelPositioning
    .filter(decision => decision.decisionId === command.decisionId)
  if (decisions.length !== 1) fail(409, 'The exact direct Repel positioning decision is unavailable.')
  const decision = decisions[0]!
  const definition = ITEM_AUTOMATION_RUNTIME_REGISTRY.resolve(decision.canonicalItemId)
  if (!definition || definition.definitionSha256 !== decision.canonicalDefinitionSha256
    || definition.spec.effects.find(effect => effect.operation === 'use-repel')?.maximumAffectedWildLevel
      !== decision.maximumAffectedWildLevel) {
    fail(409, 'The reviewed direct Repel definition changed. Refresh before retrying.')
  }
  const sourcePlacement = storedMap.placements.find(placement => placement.id === decision.sourcePlacementId)
    ?? fail(409, 'Direct Repel positioning participants are unavailable.')
  const targetPlacement = storedMap.placements.find(placement => placement.id === decision.targetPlacementId)
    ?? fail(409, 'Direct Repel positioning participants are unavailable.')
  if (targetPlacement.sheetKind !== 'pokemon') {
    fail(409, 'Direct Repel positioning participants are unavailable.')
  }
  const sheets = allMovementSheets(sheetRepository)
  const targetSheet = sheets.pokemon.get(targetPlacement.sheetSlug)
    ?? fail(409, 'The direct Repel target is no longer eligible.')
  if (Number(targetSheet.level ?? 0) > decision.maximumAffectedWildLevel) {
    fail(409, 'The direct Repel target is no longer eligible.')
  }
  if (linkedPokemonSlugSet(sheets.trainer.values()).has(targetPlacement.sheetSlug)) {
    fail(409, 'The direct Repel target is no longer an unowned wild Pokémon.')
  }
  const initialDistance = ptuGridVectorDistance({
    x: targetPlacement.position.x - sourcePlacement.position.x,
    y: targetPlacement.position.y - sourcePlacement.position.y,
    z: targetPlacement.position.z - sourcePlacement.position.z,
  })
  const finalDistance = ptuGridVectorDistance({
    x: command.destination.x - sourcePlacement.position.x,
    y: command.destination.y - sourcePlacement.position.y,
    z: command.destination.z - sourcePlacement.position.z,
  })
  if (finalDistance <= initialDistance) fail(409, 'Repel positioning must move the wild Pokémon farther away from the source.')
  const movement = resolveAuthoritativeMovement({
    map: storedMap,
    sheets,
    placementId: targetPlacement.id,
    mode: 'shift',
    destination: command.destination,
    policy: { kind: 'standard' },
  })
  if (!movement.ok) fail(409, `Repel positioning is unavailable (${movement.reasonCode}): ${movement.message}`)
  const authoritySheetReads = Object.freeze([
    ...[...sheets.trainer.values()].map(sheet => Object.freeze({
      kind: 'trainer' as const,
      slug: sheet.slug,
      revision: normalizeRevision(sheet.revision),
    })),
    Object.freeze({
      kind: 'pokemon' as const,
      slug: targetSheet.slug,
      revision: normalizeRevision(targetSheet.revision),
    }),
  ])
  const resources = scheduleExplorationNextTurnForfeit({
    resources: encounter.turnResources,
    placementId: targetPlacement.id,
    flagId: ITEM_REPEL_NEXT_TURN_SHIFT_FLAG_ID,
    sourceOperationId: command.operationId,
    round: encounter.history.currentRound ?? storedMap.initiative?.round ?? null,
    turn: encounter.history.currentTurn?.turn ?? null,
  })
  const nextEncounter = parseEncounterState({
    ...encounter,
    turnResources: resources,
    itemExploration: parseItemExplorationEncounterState({
      schemaVersion: 1,
      repelPositioning: parseItemExplorationEncounterState(encounter.itemExploration).repelPositioning
        .filter(candidate => candidate.decisionId !== decision.decisionId),
    }),
  })
  const nextMap: TabletopMap = {
    ...structuredClone(storedMap),
    placements: storedMap.placements.map(placement => placement.id === targetPlacement.id
      ? { ...placement, position: { ...command.destination } }
      : placement),
    encounterState: nextEncounter,
    revision: nextRevision(mapRevision),
    updatedAt: now,
  }
  const result = parseItemExplorationOperationResult({
    schemaVersion: 1,
    operationId: command.operationId,
    kind: command.kind,
    status: 'accepted',
    exactReplay: false,
    message: 'The GM positioned the wild Pokémon farther away; it will forfeit its next Shift Action.',
    trainerSlug: null,
    trainerRevision: null,
    mapSlug: command.mapSlug,
    mapRevision: nextMap.revision,
    activity: null,
  })
  let raced: ItemExplorationOperationResultV1 | null = null
  const events = database.withTransaction(() => {
    const duplicate = operationRepository.find(command.operationId)
    if (duplicate) {
      if (duplicate.commandSha256 !== commandSha256) fail(409, 'Item exploration operation ID was reused with changed input.')
      if (duplicate.principalKey !== replayPrincipal) fail(403, 'Item exploration replay belongs to a different principal.')
      raced = parseItemExplorationOperationResult({ ...duplicate.result, exactReplay: true })
      return []
    }
    for (const read of authoritySheetReads) {
      const current = sheetRepository.getByRef(read.kind, read.slug)
      if (!current || normalizeRevision(current.revision) !== read.revision) {
        fail(409, 'Direct Repel participant authority changed before commit.')
      }
    }
    if (mapRepository.applyLivePlayUpdate({
      slug: command.mapSlug,
      expectedRevision: mapRevision,
      nextMap,
    }) === 'stale') fail(409, 'The direct Repel map changed before commit.')
    operationRepository.insert({
      commandSha256,
      principalKey: replayPrincipal,
      command,
      result,
      evidence: {
        kind: 'direct-repel-positioning',
        decision,
        movement: {
          origin: movement.origin,
          destination: movement.destination,
          path: movement.path,
          cost: movement.cost,
          consultedPlacementIds: movement.consultedPlacementIds,
          sheetReads: movement.sheetReads,
        },
        initialDistance,
        finalDistance,
        authoritySheetReads,
      } as unknown as StrictJsonObject,
      createdAt: now,
    })
    return realtimeEventRepository.appendMany(
      setupMapSaveRealtimeAppendInputs(deepCloneJson(nextMap), input.clientId).map(event => ({ ...event, timestamp: now })),
    )
  })
  if (raced) return raced
  publishPersistedRealtimeEventsAfterCommit({
    events,
    operation: 'item-exploration',
    publish: dependencies.publishPersistedRealtimeEvent ?? defaultPersistedRealtimeEventPublisher,
    reportFailure: dependencies.reportAfterCommitPublicationFailure ?? defaultPersistedRealtimePublicationFailureReporter,
  })
  return result
}

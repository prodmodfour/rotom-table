import { createHash, randomInt as secureRandomInt } from 'node:crypto'
import { createError } from 'h3'
import type { AuthRole } from '#shared/auth'
import {
  CapabilityActionCommandValidationError,
  parseCapabilityActionPublicResult,
  parseExecuteCapabilityActionCommand,
  type CapabilityActionPublicResult,
  type CapabilityServerRoll,
  type ExecuteCapabilityActionCommand,
} from '#shared/capabilityAutomation/clientCommands'
import {
  createEmptyCapabilityUsageLedger,
  parseCapabilityUsageLedger,
  type CapabilityUsageEntry,
} from '#shared/capabilityAutomation/state'
import { stableJsonStringify } from '#shared/automation/stableJson'
import { nextRevision, normalizeRevision } from '#shared/sessionRevisions'
import { createEmptyEncounterState, parseEncounterState } from '#shared/moveAutomation/encounterState'
import type { PlayerProfile } from '#shared/playerProfiles'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { deepCloneJson, sameJsonValue } from '~/utils/serialization'
import {
  actorCanControlMapPlacement,
  playerProfileLinkedTrainerSheetsForTokenControl,
} from '../policies/playerProfileTokenControlPolicy'
import { canAccessMapForRole } from '../policies/mapPolicy'
import { buildCapabilityClientCapabilityBundle } from '../domain/capabilityAutomation/clientCapabilities'
import { resolveEffectiveCapabilities } from '../domain/capabilityAutomation/effectiveCapabilities'
import { reconcileCapabilityRuntimeSourceLoss } from '../domain/capabilityAutomation/sourceLoss'
import { executeCapabilityMechanic, type CapabilityMechanicSheetMutation } from '../domain/capabilityAutomation/executeMechanic'
import type { CapabilityRuntimeRegistry } from '#shared/capabilityAutomation/spec'
import { CAPABILITY_AUTOMATION_RUNTIME_REGISTRY } from '../domain/capabilityAutomation/registry'
import {
  CapabilitySelectionValidationError,
  validateCapabilityActionSelections,
} from '../domain/capabilityAutomation/validateSelections'
import { spendEncounterMoveResourceCosts, EncounterResourceReductionError } from '../domain/moveAutomation/reduceEncounterResources'
import {
  createSqliteCapabilityAdjudicationRepository,
  type CapabilityAdjudicationRepository,
} from '../storage/capabilityAdjudicationRepository'
import {
  createSqliteCapabilityResolutionOperationRepository,
  type CapabilityResolutionOperationRepository,
} from '../storage/capabilityResolutionOperationRepository'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import { createSqliteMapRepository, type MapRepository } from '../storage/mapRepository'
import {
  createSqliteRealtimeEventRepository,
  type RealtimeEventRepository,
} from '../storage/realtimeEventRepository'
import { createSqliteSheetRepository, type SheetRepository } from '../storage/sheetRepository'
import { setupMapSaveRealtimeAppendInputs, setupSheetSaveRealtimeAppendInputs } from '../realtime/setupDocumentRealtime'
import {
  defaultPersistedRealtimeEventPublisher,
  defaultPersistedRealtimePublicationFailureReporter,
  publishPersistedRealtimeEventsAfterCommit,
  type PersistedRealtimeEventPublisher,
  type PersistedRealtimePublicationFailureReporter,
} from '../realtime/persistedBatchPublication'
import { listRepositorySheets, type ListSheetsRepository } from './listSheets'

export interface ExecuteCapabilityActionInput {
  readonly role: AuthRole
  readonly playerProfile?: PlayerProfile | null
  readonly command: unknown
  /** Server-only resume identity; never accepted by the public execute route. */
  readonly approvedAdjudication?: {
    readonly requestId: string
    readonly definitionHash: string
    readonly resolutionCommandSha256: string
  }
}

export interface ExecuteCapabilityActionDependencies {
  readonly database?: RotomDatabase
  readonly mapRepository?: Pick<MapRepository<TabletopMap>, 'getBySlug' | 'applyLivePlayUpdate'>
  readonly sheetRepository?: Pick<
    SheetRepository<Record<string, unknown>>,
    'getByRef' | 'list' | 'assertRevisions' | 'applyLivePlayUpdate'
  > & Partial<Pick<SheetRepository<Record<string, unknown>>, 'save'>>
    & ListSheetsRepository
  readonly operationRepository?: CapabilityResolutionOperationRepository
  readonly adjudicationRepository?: CapabilityAdjudicationRepository
  readonly realtimeEventRepository?: Pick<RealtimeEventRepository, 'appendMany'>
  readonly registry?: CapabilityRuntimeRegistry
  readonly now?: () => number
  /** Server-owned CSPRNG seam. Client command identities must never select dice. */
  readonly randomInt?: (minimum: number, maximumExclusive: number) => number
  readonly publishPersistedRealtimeEvent?: PersistedRealtimeEventPublisher
  readonly reportAfterCommitPublicationFailure?: PersistedRealtimePublicationFailureReporter
}

const fail = (statusCode: number, statusMessage: string): never => { throw createError({ statusCode, statusMessage }) }
const parseCommand = (value: unknown): ExecuteCapabilityActionCommand => {
  try { return parseExecuteCapabilityActionCommand(value) }
  catch (error) {
    if (error instanceof CapabilityActionCommandValidationError) fail(400, 'Invalid Capability action command.')
    throw error
  }
}
const hash = (value: unknown): string => createHash('sha256').update(stableJsonStringify(value)).digest('hex')
const principalKeyFor = (input: Pick<ExecuteCapabilityActionInput, 'role' | 'playerProfile'>): string => (
  input.role === 'player' ? `player:${input.playerProfile?.id ?? 'missing-profile'}` : input.role
)
const auditPrincipalKey = (audit: unknown): string | null => {
  if (!audit || typeof audit !== 'object' || Array.isArray(audit)) return null
  const value = (audit as Record<string, unknown>).principalKey
  return typeof value === 'string' ? value : null
}

const serverRoller = (
  randomInt: (minimum: number, maximumExclusive: number) => number,
): ((rollId: string, sides: number, count?: number) => CapabilityServerRoll) => (
  (rollId, sides, count = 1) => {
    if (!Number.isSafeInteger(sides) || sides < 2 || sides > 1_000_000
      || !Number.isSafeInteger(count) || count < 1 || count > 100) throw new Error('Capability roll exceeds reviewed bounds.')
    const dice = Array.from({ length: count }, () => {
      const value = randomInt(1, sides + 1)
      if (!Number.isSafeInteger(value) || value < 1 || value > sides) {
        throw new Error(`Capability server RNG produced an invalid d${sides} result.`)
      }
      return value
    })
    return Object.freeze({
      rollId: `capability-roll:${rollId}`,
      expression: `${count}d${sides}`,
      dice: Object.freeze(dice),
      modifier: 0,
      total: dice.reduce((total, die) => total + die, 0),
    })
  }
)

const spendActionEconomy = (input: {
  readonly map: TabletopMap
  readonly actorPlacementId: string
  readonly canonicalId: string
  readonly operationId: string
  readonly economy: string
}): TabletopMap => {
  if (!input.map.initiative?.activeId || input.economy === 'extended') return input.map
  if (!['standard', 'shift', 'swift', 'free'].includes(input.economy)) return input.map
  const encounter = parseEncounterState(input.map.encounterState ?? createEmptyEncounterState())
  try {
    const spent = spendEncounterMoveResourceCosts(encounter.turnResources, {
      placementId: input.actorPlacementId,
      canonicalMoveId: `Capability:${input.canonicalId}`,
      resolutionId: `capability:${input.operationId}`,
      sourceOperationId: input.operationId,
      costs: [{
        id: 'capability.action-cost',
        phase: 'pay',
        cost: { kind: 'action-resource', resource: input.economy as 'standard' | 'shift' | 'swift' | 'free', amount: 1 },
      }],
      movementBudget: null,
      movementDistance: 0,
      round: encounter.history.currentRound ?? input.map.initiative?.round ?? null,
      turn: encounter.history.currentTurn?.turn ?? null,
      actedThisRound: encounter.history.actedThisRoundPlacementIds.includes(input.actorPlacementId),
    })
    return { ...input.map, encounterState: parseEncounterState({ ...encounter, turnResources: spent.resources }) }
  }
  catch (error) {
    if (error instanceof EncounterResourceReductionError) fail(409, error.message)
    throw error
  }
}

const usageEntryFor = (input: {
  readonly command: ExecuteCapabilityActionCommand
  readonly frequency: string
  readonly now: number
  readonly invisibleActivatedAt: number | null
}): CapabilityUsageEntry | null => {
  let frequency = input.frequency
  let actionId = input.command.actionId === 'lure-with-alluring' || input.command.actionId === 'distract-with-alluring'
    ? 'act-as-bait' : input.command.actionId
  let availableAt: number | null = null
  let remainingDayAdvances: number | null = null
  if (actionId === 'become-invisible') return null
  if (actionId === 'become-visible' && input.invisibleActivatedAt !== null) {
    frequency = 'cooldown'
    actionId = 'become-invisible'
    const invisibleDurationMs = Math.max(0, input.now - input.invisibleActivatedAt)
    availableAt = input.now + 2 * 60_000 + invisibleDurationMs
  }
  else if (frequency === 'hourly') availableAt = input.now + 60 * 60_000
  else if (frequency === 'cooldown') availableAt = input.now + (actionId === 'warm-egg' ? 24 * 60 * 60_000 : 2 * 60_000)
  else if (frequency === 'weekly') remainingDayAdvances = 7
  if (!['daily', 'weekly', 'hourly', 'cooldown'].includes(frequency)) return null
  return Object.freeze({
    id: `capability-usage:${input.command.capabilityInstanceId}:${actionId}`,
    canonicalId: input.command.canonicalId,
    actionId,
    capabilityInstanceId: input.command.capabilityInstanceId,
    period: frequency as CapabilityUsageEntry['period'],
    usedAt: input.now,
    availableAt,
    remainingDayAdvances,
    sourceOperationId: input.command.operationId,
  })
}

const withUsage = (
  sheet: CharacterSheet | TrainerSheet,
  entry: CapabilityUsageEntry | null,
): CharacterSheet | TrainerSheet => {
  if (!entry) return sheet
  const ledger = parseCapabilityUsageLedger(sheet.capabilityUsage ?? createEmptyCapabilityUsageLedger())
  return {
    ...sheet,
    capabilityUsage: parseCapabilityUsageLedger({
      ...ledger,
      entries: [...ledger.entries.filter(candidate => candidate.id !== entry.id), entry],
    }),
  }
}

const mergeSheetMutations = (input: {
  readonly mechanicMutations: readonly CapabilityMechanicSheetMutation[]
  readonly actorKind: 'pokemon' | 'trainer'
  readonly actorSlug: string
  readonly actorSheet: CharacterSheet | TrainerSheet
  readonly usage: CapabilityUsageEntry | null
}): readonly CapabilityMechanicSheetMutation[] => {
  const byKey = new Map<string, CapabilityMechanicSheetMutation>()
  for (const mutation of input.mechanicMutations) byKey.set(`${mutation.kind}:${mutation.slug}`, mutation)
  if (input.usage) {
    const key = `${input.actorKind}:${input.actorSlug}`
    const existing = byKey.get(key)
    const base = existing?.current ?? input.actorSheet
    byKey.set(key, {
      kind: input.actorKind,
      slug: input.actorSlug,
      previous: existing?.previous ?? input.actorSheet,
      current: withUsage(base, input.usage),
    })
  }
  return [...byKey.values()]
}

const adjudicationResult = (
  command: ExecuteCapabilityActionCommand,
  revision: number,
  changedMap: boolean,
): CapabilityActionPublicResult => parseCapabilityActionPublicResult({
  schemaVersion: 1,
  operationId: command.operationId,
  mapSlug: command.mapSlug,
  mapRevision: revision,
  actorPlacementId: command.actorPlacementId,
  canonicalId: command.canonicalId,
  actionId: command.actionId,
  outcome: 'adjudication-required',
  reasonCode: 'capability.gm-confirmation-required',
  rolls: [],
  produced: [],
  changedMap,
  changedSheetSlugs: [],
  adjudicationNote: 'This source rule requires bounded GM confirmation in the current campaign context.',
})

/**
 * Re-authorize and atomically commit one source-owned Capability action.  The
 * client supplies identities and choices only; rules, rolls, costs, and writes
 * are reconstructed from the reviewed registry and current SQLite state.
 */
export const executeCapabilityActionUseCase = (
  input: ExecuteCapabilityActionInput,
  dependencies: ExecuteCapabilityActionDependencies = {},
): CapabilityActionPublicResult => {
  const command = parseCommand(input.command)
  const commandSha256 = hash(command)
  const principalKey = principalKeyFor(input)
  const database = dependencies.database ?? getRotomDatabase()
  const mapRepository = dependencies.mapRepository ?? createSqliteMapRepository<TabletopMap>(database)
  const sheetRepository = dependencies.sheetRepository ?? createSqliteSheetRepository<Record<string, unknown>>(database)
  const operationRepository = dependencies.operationRepository ?? createSqliteCapabilityResolutionOperationRepository(database)
  const adjudicationRepository = dependencies.adjudicationRepository ?? createSqliteCapabilityAdjudicationRepository(database)
  const realtimeEventRepository = dependencies.realtimeEventRepository ?? createSqliteRealtimeEventRepository({ database })
  const registry = dependencies.registry ?? CAPABILITY_AUTOMATION_RUNTIME_REGISTRY
  const storedMap = mapRepository.getBySlug(command.mapSlug) ?? fail(404, 'Capability map is missing.')
  if (!canAccessMapForRole(input.role, storedMap)) fail(403, 'Capability map is not player visible.')
  const existing = operationRepository.find(command.operationId)
  if (existing) {
    if (existing.commandSha256 !== commandSha256) fail(409, 'Capability operation ID was reused with changed input.')
    if (auditPrincipalKey(existing.audit) !== principalKey) {
      fail(403, 'Capability operation replay belongs to a different principal.')
    }
    return existing.result
  }

  const currentRevision = normalizeRevision(storedMap.revision)
  if (currentRevision !== command.baseRevision) fail(409, 'Capability action projection is stale.')
  const pokemonSheets = listRepositorySheets<CharacterSheet>(sheetRepository, 'pokemon')
  const trainerSheets = listRepositorySheets<TrainerSheet>(sheetRepository, 'trainer')
  const consultedSheetRevisions = [
    ...pokemonSheets.map(sheet => ({ kind: 'pokemon' as const, slug: sheet.slug, revision: normalizeRevision(sheet.revision) })),
    ...trainerSheets.map(sheet => ({ kind: 'trainer' as const, slug: sheet.slug, revision: normalizeRevision(sheet.revision) })),
  ]
  const pokemonBySlug = new Map(pokemonSheets.map(sheet => [sheet.slug, sheet]))
  const trainerBySlug = new Map(trainerSheets.map(sheet => [sheet.slug, sheet]))
  const map = reconcileCapabilityRuntimeSourceLoss({
    map: storedMap,
    sheets: { pokemon: pokemonBySlug, trainer: trainerBySlug },
  })
  const actingPlacement = map.placements.find(placement => placement.id === command.actorPlacementId)
    ?? fail(404, 'Capability actor placement is missing.')
  const controlLinkedTrainerSheets = playerProfileLinkedTrainerSheetsForTokenControl(
    input.playerProfile,
    slug => trainerBySlug.get(slug),
  )
  if (!actorCanControlMapPlacement({
    role: input.role,
    profile: input.playerProfile,
    placement: actingPlacement,
    linkedTrainerSheets: controlLinkedTrainerSheets,
  })) fail(403, 'Capability actor is not controlled by this principal.')
  if (input.role !== 'gm' && command.selections.gmConfirmed) fail(403, 'Only the GM may confirm a bounded Capability adjudication.')
  if (input.approvedAdjudication && input.role !== 'gm') fail(403, 'Only the GM may resume a Capability adjudication.')
  const actingSheet = (actingPlacement.sheetKind === 'pokemon'
    ? pokemonBySlug.get(actingPlacement.sheetSlug)
    : trainerBySlug.get(actingPlacement.sheetSlug))
    ?? fail(409, 'Capability acting sheet is unavailable.')
  const now = dependencies.now?.() ?? Date.now()
  const bundle = buildCapabilityClientCapabilityBundle({
    role: input.role,
    playerProfile: input.playerProfile,
    map,
    mapRevision: currentRevision,
    pokemonSheets,
    trainerSheets,
    now,
  })
  const offer = bundle.placements.find(candidate => candidate.placementId === actingPlacement.id)?.offers
    .find(candidate => candidate.offerId === command.offerId)
    ?? fail(409, 'Capability action offer is unavailable or stale.')
  if (offer.canonicalId !== command.canonicalId || offer.actionId !== command.actionId
    || offer.capabilityInstanceId !== command.capabilityInstanceId) fail(409, 'Capability action offer is unavailable or stale.')
  if (!offer.available) fail(409, offer.unavailableReasonCodes[0] ?? 'Capability action is unavailable.')

  const actorPlacement = map.placements.find(placement => placement.id === offer.sourcePlacementId)
    ?? fail(409, 'Capability source placement is unavailable.')
  const actorSheet = (actorPlacement.sheetKind === 'pokemon'
    ? pokemonBySlug.get(actorPlacement.sheetSlug)
    : trainerBySlug.get(actorPlacement.sheetSlug))
    ?? fail(409, 'Capability source sheet is unavailable.')
  const delegated = actorPlacement.id !== actingPlacement.id
  if (delegated && (command.canonicalId !== 'Living Weapon'
    || (command.actionId !== 'engage-wielder' && command.actionId !== 'disengage-wielder'))) {
    fail(409, 'This Capability action cannot be delegated to another placement.')
  }
  if (delegated && command.selections.targetPlacementIds.length > 0) {
    fail(400, 'Delegated Living Weapon actions derive their participant from the acting placement.')
  }
  const mechanicCommand = delegated && command.actionId === 'engage-wielder'
    ? {
        ...command,
        selections: {
          ...command.selections,
          targetPlacementIds: [actingPlacement.id],
        },
      }
    : command

  const effective = resolveEffectiveCapabilities({
    map,
    placement: actorPlacement,
    sheet: actorSheet,
    sheets: { pokemon: pokemonBySlug, trainer: trainerBySlug },
  })
  const instance = effective.instances.find(candidate => candidate.instanceId === command.capabilityInstanceId)
  if (!instance || !instance.effective || instance.canonicalId !== command.canonicalId) fail(409, 'Capability instance is not currently effective.')
  const runtime = registry.resolve(command.canonicalId) ?? fail(409, 'Capability has no reviewed native runtime.')
  const action = runtime.spec.actions.find(candidate => candidate.actionId === command.actionId)
    ?? fail(409, 'Capability action is not registered.')

  for (const targetId of mechanicCommand.selections.targetPlacementIds) {
    if (!map.placements.some(placement => placement.id === targetId)) fail(400, `Capability target ${targetId} does not exist.`)
  }
  if (input.role === 'player' && command.actionId === 'shelter-baby') {
    const babyPlacement = map.placements.find(placement => placement.id === mechanicCommand.selections.targetPlacementIds[0])
      ?? fail(409, 'Marsupial baby placement is unavailable.')
    if (!actorCanControlMapPlacement({
      role: input.role,
      profile: input.playerProfile,
      placement: babyPlacement,
      linkedTrainerSheets: controlLinkedTrainerSheets,
    })) fail(403, 'A player must control both Pokémon before establishing a Marsupial relationship.')
  }

  try {
    validateCapabilityActionSelections({
      map,
      actor: actorPlacement,
      actorSheet,
      actingPlacement,
      actingSheet,
      pokemonSheets: pokemonBySlug,
      trainerSheets: trainerBySlug,
      command: mechanicCommand,
      action,
      now,
    })
  }
  catch (error) {
    if (error instanceof CapabilitySelectionValidationError) fail(409, error.message)
    throw error
  }

  const linkedTrainerSlugs = new Set<string>(actorPlacement.sheetKind === 'trainer'
    ? [actorPlacement.sheetSlug]
    : trainerSheets.filter(trainer => (
        (trainer.currentTeam ?? []).includes(actorPlacement.sheetSlug)
        || (trainer.boxedPokemon ?? []).includes(actorPlacement.sheetSlug)
      )).map(trainer => trainer.slug))

  const fortuneLoyaltyAdjudication = command.canonicalId === 'Fortune'
    && command.actionId === 'roam-for-fortune'
    && actorPlacement.sheetKind === 'pokemon'
    && ((actorSheet as CharacterSheet).loyalty ?? 3) <= 1
  const wiredRotomAdjudication = command.canonicalId === 'Wired'
    && command.actionId === 'enter-machine'
    && actorPlacement.sheetKind === 'pokemon'
    && (actorSheet as CharacterSheet).species.trim().toLocaleLowerCase('en-US').includes('rotom')
  const auraExchangeAdjudication = command.canonicalId === 'Aura Pulse'
    && command.actionId === 'communicate'
    && command.selections.optionId === 'exchange-surface-thoughts'
  const requiresGmConfirmation = action.requiresGmConfirmation || fortuneLoyaltyAdjudication
    || wiredRotomAdjudication || auraExchangeAdjudication
  if (requiresGmConfirmation && !command.selections.gmConfirmed) {
    const encounter = parseEncounterState(map.encounterState ?? createEmptyEncounterState())
    const expiresAt = now + 24 * 60 * 60_000
    const capabilityRuntime = {
      ...encounter.capabilityRuntime!,
      pendingAdjudications: [
        ...encounter.capabilityRuntime!.pendingAdjudications.filter(entry => entry.requestId !== command.operationId),
        {
          requestId: command.operationId,
          actorPlacementId: actorPlacement.id,
          capabilityInstanceId: command.capabilityInstanceId,
          canonicalId: command.canonicalId,
          actionId: command.actionId,
          requestedAt: now,
          expiresAt,
          sourceOperationId: command.operationId,
        },
      ],
    }
    const nextMap: TabletopMap = {
      ...deepCloneJson(map),
      encounterState: parseEncounterState({ ...encounter, capabilityRuntime }),
      revision: nextRevision(currentRevision),
      updatedAt: now,
    }
    const result = adjudicationResult(command, normalizeRevision(nextMap.revision), true)
    let racedResult: CapabilityActionPublicResult | null = null
    const persistedEvents = database.withTransaction(() => {
      const raced = operationRepository.find(command.operationId)
      if (raced) {
        if (raced.commandSha256 !== commandSha256) fail(409, 'Capability operation ID was reused with changed input.')
        if (auditPrincipalKey(raced.audit) !== principalKey) fail(403, 'Capability operation replay belongs to a different principal.')
        racedResult = raced.result
        return []
      }
      sheetRepository.assertRevisions(consultedSheetRevisions)
      if (mapRepository.applyLivePlayUpdate({
        slug: command.mapSlug,
        expectedRevision: currentRevision,
        nextMap,
      }) === 'stale') fail(409, 'Capability map changed before the adjudication request was committed.')
      adjudicationRepository.insert({
        requestId: command.operationId,
        commandSha256,
        command,
        definitionHash: runtime.definitionHash,
        status: 'pending',
        requestedAt: now,
        expiresAt,
        resolvedAt: null,
        resolutionOperationId: null,
        resolutionCommandSha256: null,
        resolutionMapRevision: null,
      })
      operationRepository.insert({
        commandSha256,
        command,
        result,
        audit: {
          kind: 'capability-adjudication-request', principalKey,
          definitionHash: runtime.definitionHash, expiresAt,
        },
        createdAt: now,
      })
      return realtimeEventRepository.appendMany(
        setupMapSaveRealtimeAppendInputs(nextMap).map(event => ({ ...event, timestamp: now })),
      )
    })
    if (racedResult) return racedResult
    publishPersistedRealtimeEventsAfterCommit({
      events: persistedEvents,
      operation: 'capability-adjudication-request',
      publish: dependencies.publishPersistedRealtimeEvent ?? defaultPersistedRealtimeEventPublisher,
      reportFailure: dependencies.reportAfterCommitPublicationFailure ?? defaultPersistedRealtimePublicationFailureReporter,
    })
    return result
  }

  if (input.approvedAdjudication) {
    if (!requiresGmConfirmation || input.approvedAdjudication.definitionHash !== runtime.definitionHash
      || !map.encounterState?.capabilityRuntime?.pendingAdjudications.some(entry => (
        entry.requestId === input.approvedAdjudication!.requestId
        && entry.actorPlacementId === actorPlacement.id
        && entry.capabilityInstanceId === command.capabilityInstanceId
        && entry.canonicalId === command.canonicalId
        && entry.actionId === command.actionId
        && entry.expiresAt > now
      ))) fail(409, 'Capability adjudication resume evidence is unavailable or stale.')
  }

  const invisibleActivatedAt = map.encounterState?.capabilityRuntime?.modes.find(mode => (
    mode.actorPlacementId === actorPlacement.id
    && mode.mode === 'invisible'
    && mode.capabilityInstanceId === command.capabilityInstanceId
    && mode.canonicalId === command.canonicalId
    && mode.activatedAt <= now
    && (mode.expiresAt === null || mode.expiresAt > now)
  ))?.activatedAt ?? null
  const executionMap = input.approvedAdjudication
    ? {
        ...map,
        encounterState: parseEncounterState({
          ...map.encounterState!,
          capabilityRuntime: {
            ...map.encounterState!.capabilityRuntime!,
            pendingAdjudications: map.encounterState!.capabilityRuntime!.pendingAdjudications
              .filter(entry => entry.requestId !== input.approvedAdjudication!.requestId),
          },
        }),
      }
    : map
  const sourceLossReconciledMap = reconcileCapabilityRuntimeSourceLoss({
    map: executionMap,
    sheets: { pokemon: pokemonBySlug, trainer: trainerBySlug },
  })
  const mapAfterCost = spendActionEconomy({
    map: sourceLossReconciledMap,
    actorPlacementId: actingPlacement.id,
    canonicalId: command.canonicalId,
    operationId: command.operationId,
    economy: action.economy,
  })
  const mechanic = executeCapabilityMechanic({
    map: mapAfterCost,
    actorPlacement,
    actorSheet,
    pokemonSheets: pokemonBySlug,
    trainerSheets: trainerBySlug,
    linkedTrainerSlugs,
    command: mechanicCommand,
    action,
    now,
    rollDie: serverRoller(dependencies.randomInt ?? secureRandomInt),
  })
  const usage = usageEntryFor({ command, frequency: action.frequency, now, invisibleActivatedAt })
  const sheetMutations = mergeSheetMutations({
    mechanicMutations: mechanic.sheetMutations,
    actorKind: actorPlacement.sheetKind,
    actorSlug: actorPlacement.sheetSlug,
    actorSheet,
    usage,
  })

  const mapChanged = !sameJsonValue(storedMap, mechanic.map)
  const nextMap: TabletopMap = mapChanged ? {
    ...deepCloneJson(mechanic.map),
    revision: nextRevision(currentRevision),
    updatedAt: now,
  } : map
  const plannedSheets = sheetMutations.map((mutation) => {
    const stored = sheetRepository.getByRef(mutation.kind, mutation.slug)
    if (mutation.previous === null) {
      if (stored) fail(409, `Capability generated sheet ${mutation.kind}/${mutation.slug} already exists.`)
      return {
        ...mutation,
        creating: true as const,
        expectedRevision: 0,
        current: {
          ...deepCloneJson(mutation.current) as unknown as Record<string, unknown>,
          slug: mutation.slug,
          revision: 1,
          updatedAt: now,
        },
      }
    }
    const currentStored = stored ?? fail(409, `Capability ${mutation.kind} sheet ${mutation.slug} disappeared.`)
    const plannedPreviousRevision = normalizeRevision(mutation.previous.revision)
    if (normalizeRevision(currentStored.revision) !== plannedPreviousRevision) {
      fail(409, `Capability ${mutation.kind} sheet ${mutation.slug} changed after the action was planned.`)
    }
    return {
      ...mutation,
      creating: false as const,
      expectedRevision: plannedPreviousRevision,
      current: {
        ...deepCloneJson(mutation.current) as unknown as Record<string, unknown>,
        slug: mutation.slug,
        revision: nextRevision(plannedPreviousRevision),
        updatedAt: now,
      },
    }
  })
  const result = parseCapabilityActionPublicResult({
    schemaVersion: 1,
    operationId: command.operationId,
    mapSlug: command.mapSlug,
    mapRevision: normalizeRevision(nextMap.revision),
    actorPlacementId: command.actorPlacementId,
    canonicalId: command.canonicalId,
    actionId: command.actionId,
    outcome: mechanic.outcome,
    reasonCode: mechanic.reasonCode,
    rolls: mechanic.rolls,
    produced: mechanic.produced,
    changedMap: mapChanged,
    changedSheetSlugs: plannedSheets.map(sheet => sheet.slug),
    adjudicationNote: mechanic.adjudicationNote,
  })

  let racedResult: CapabilityActionPublicResult | null = null
  const persistedEvents = database.withTransaction(() => {
    const raced = operationRepository.find(command.operationId)
    if (raced) {
      if (raced.commandSha256 !== commandSha256) fail(409, 'Capability operation ID was reused with changed input.')
      if (auditPrincipalKey(raced.audit) !== principalKey) fail(403, 'Capability operation replay belongs to a different principal.')
      racedResult = raced.result
      return []
    }
    sheetRepository.assertRevisions(consultedSheetRevisions)
    if (mapChanged && mapRepository.applyLivePlayUpdate({
      slug: command.mapSlug,
      expectedRevision: currentRevision,
      nextMap,
    }) === 'stale') fail(409, 'Capability map changed before commit.')
    if (!mapChanged) {
      const currentMap = mapRepository.getBySlug(command.mapSlug)
      if (!currentMap || normalizeRevision(currentMap.revision) !== currentRevision) {
        fail(409, 'Capability map changed before the sheet-only action was committed.')
      }
    }
    for (const mutation of plannedSheets) {
      if (mutation.creating) {
        if (sheetRepository.getByRef(mutation.kind, mutation.slug)) {
          fail(409, `Capability generated sheet ${mutation.kind}/${mutation.slug} changed before commit.`)
        }
        const saveSheet = sheetRepository.save ?? fail(409, 'Capability sheet creation is unavailable.')
        saveSheet({
          kind: mutation.kind,
          slug: mutation.slug,
          document: mutation.current,
          revision: 1,
          updatedAt: now,
        })
      }
      else if (sheetRepository.applyLivePlayUpdate({
        kind: mutation.kind,
        slug: mutation.slug,
        expectedRevision: mutation.expectedRevision,
        nextSheet: mutation.current,
        sourceOperationId: command.operationId,
      }) === 'stale') fail(409, `Capability ${mutation.kind} sheet ${mutation.slug} changed before commit.`)
    }
    if (input.approvedAdjudication && adjudicationRepository.resolve({
      requestId: input.approvedAdjudication.requestId,
      expectedStatus: 'pending',
      status: 'accepted',
      resolvedAt: now,
      resolutionOperationId: command.operationId,
      resolutionCommandSha256: input.approvedAdjudication.resolutionCommandSha256,
      resolutionMapRevision: result.mapRevision,
    }) === 'stale') fail(409, 'Capability adjudication was resolved concurrently.')
    operationRepository.insert({
      commandSha256,
      command,
      result,
      audit: {
        kind: 'capability-resolution',
        principalKey,
        definitionHash: runtime.definitionHash,
        sourceEffectSha256: runtime.spec.sourceEffectSha256,
        actorSheetRevision: normalizeRevision(actorSheet.revision),
        targetPlacementIds: [...command.selections.targetPlacementIds],
        rollIds: mechanic.rolls.map(roll => roll.rollId),
      },
      createdAt: now,
    })
    const appendInputs = [
      ...(mapChanged ? setupMapSaveRealtimeAppendInputs(nextMap) : []),
      ...plannedSheets.flatMap((mutation) => {
        const committed = sheetRepository.getByRef(mutation.kind, mutation.slug)
          ?? fail(409, `Capability ${mutation.kind} sheet ${mutation.slug} disappeared after commit.`)
        return setupSheetSaveRealtimeAppendInputs({
          kind: mutation.kind,
          slug: mutation.slug,
          sheet: committed.sheet,
        })
      }),
    ].map(event => ({ ...event, timestamp: now }))
    return realtimeEventRepository.appendMany(appendInputs)
  })

  if (racedResult) return racedResult
  publishPersistedRealtimeEventsAfterCommit({
    events: persistedEvents,
    operation: 'capability-action',
    publish: dependencies.publishPersistedRealtimeEvent ?? defaultPersistedRealtimeEventPublisher,
    reportFailure: dependencies.reportAfterCommitPublicationFailure ?? defaultPersistedRealtimePublicationFailureReporter,
  })
  return result
}

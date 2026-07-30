import type { CampaignNextDayResult } from '#shared/campaign'
import { MAP_INTERACTION_MODES } from '#shared/mapInteractionMode'
import { advanceCapabilityUsageDay } from '#shared/capabilityAutomation/state'
import {
  capabilityCampaignStateHasContent,
  juicerHeldItemIsLegacyShellMirror,
  materializeJuicerCampaignStateAtTime,
  reconcileJuicerHeldItemCustody,
} from '#shared/capabilityAutomation/campaignState'
import { nextRevision } from '#shared/sessionRevisions'
import type { SheetKind } from '#shared/sheets'
import type { PersistedRealtimeEvent } from '#shared/realtimeEventLog'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { deepCloneJson, sameJsonValue } from '~/utils/serialization'
import { stablePersistableSheetJson } from '~/utils/sheets/persistence'
import { pokemonHasResolvedCapability } from '~/utils/sheets/pokemonDerived'
import { pokemonHpSnapshot, trainerHpSnapshot } from '~/utils/sheetSpawn'
import {
  addHealingMutationSummary,
  applyPokemonNextDay,
  applyTrainerNextDay,
  emptyHealingMutationSummary,
  type SheetHealingMutationSummary,
} from '~/utils/sheets/healing'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import {
  createSqliteSheetRepository,
  type SheetRepository,
  type StoredSheetDocument,
} from '../storage/sheetRepository'
import {
  createSqliteMapRepository,
  type MapRepository,
  type StoredMapDocument,
} from '../storage/mapRepository'
import {
  createSqliteMapInteractionModeRepository,
  type MapInteractionModeRepository,
  type StoredMapInteractionMode,
} from '../storage/mapInteractionModeRepository'
import {
  createSqliteRealtimeEventRepository,
  type AppendRealtimeEventInput,
  type RealtimeEventRepository,
} from '../storage/realtimeEventRepository'
import {
  setupMapSaveRealtimeAppendInputs,
  setupSheetSaveRealtimeAppendInputs,
} from '../realtime/setupDocumentRealtime'
import {
  defaultPersistedRealtimeEventPublisher,
  defaultPersistedRealtimePublicationFailureReporter,
  publishPersistedRealtimeEventsAfterCommit,
  type PersistedRealtimeEventPublisher,
  type PersistedRealtimePublicationFailureReporter,
} from '../realtime/persistedBatchPublication'
import { logicalSheetResourcePath } from '../utils/runtimeResourcePaths'
import { resolveEffectiveCapabilities } from '../domain/capabilityAutomation/effectiveCapabilities'
import {
  capabilityHpSheetKey,
  reconcileCapabilityHpState,
  type CapabilityHpStateSheet,
} from '../domain/capabilityAutomation/reconcileHpState'

export interface AdvanceCampaignDayInput {
  clientId?: string
}

type AdvanceCampaignDaySheetRepository = Pick<
  SheetRepository<Record<string, unknown>>,
  'list' | 'applyLivePlayUpdate' | 'getByRef'
> & Partial<Pick<SheetRepository<Record<string, unknown>>, 'assertRevisions'>> & {
  readonly database?: RotomDatabase
}

type AdvanceCampaignDayMapRepository = Pick<
  MapRepository<TabletopMap>,
  'list' | 'getBySlug' | 'applyLivePlayUpdate'
> & { readonly database?: RotomDatabase }

type AdvanceCampaignDayModeRepository = Pick<MapInteractionModeRepository, 'get'> & {
  readonly database?: RotomDatabase
}

type AdvanceCampaignDayRealtimeEventRepository = Pick<RealtimeEventRepository, 'appendMany'> & {
  readonly database?: RotomDatabase
}

export interface AdvanceCampaignDayDependencies {
  database?: RotomDatabase
  sheetRepository?: AdvanceCampaignDaySheetRepository
  mapRepository?: AdvanceCampaignDayMapRepository
  modeRepository?: AdvanceCampaignDayModeRepository
  realtimeEventRepository?: AdvanceCampaignDayRealtimeEventRepository
  publishPersistedRealtimeEvent?: PersistedRealtimeEventPublisher
  reportAfterCommitPublicationFailure?: PersistedRealtimePublicationFailureReporter
  now?: () => number
  /** @deprecated Runtime campaign-day updates use authoritative SQLite sheets. */
  listPokemonSheets?: () => StoredSheetDocument<Record<string, unknown>>[]
  /** @deprecated Runtime campaign-day updates use authoritative SQLite sheets. */
  listTrainerSheets?: () => StoredSheetDocument<Record<string, unknown>>[]
  /** @deprecated Runtime campaign-day updates use SQLite sheets. */
  listPokemonSheetPaths?: () => string[]
  /** @deprecated Runtime campaign-day updates use SQLite sheets. */
  listTrainerSheetPaths?: () => string[]
  /** @deprecated Runtime campaign-day updates use SQLite sheets. */
  readPokemonSheet?: (path: string) => CharacterSheet
  /** @deprecated Runtime campaign-day updates use SQLite sheets. */
  readTrainerSheet?: (path: string) => TrainerSheet
  /** @deprecated Runtime campaign-day updates use SQLite sheets. */
  writeSheet?: (path: string, sheet: Record<string, unknown>) => void
  /** @deprecated Runtime campaign-day updates use logical SQLite resource paths. */
  relativePath?: (path: string) => string
}

export interface AdvanceCampaignDayResult extends CampaignNextDayResult {
  realtimeEvents: readonly PersistedRealtimeEvent[]
  paths: string[]
}

interface CampaignDaySheetPlan {
  readonly kind: SheetKind
  readonly slug: string
  readonly path: string
  readonly originalSheet: Record<string, unknown>
  readonly changed: boolean
  readonly expectedRevision: number
  readonly nextRevision: number
  readonly nextSheet: Record<string, unknown>
  readonly summary: SheetHealingMutationSummary
  readonly hpChanged: boolean
}

interface CampaignDayMapPlan {
  readonly slug: string
  readonly expectedRevision: number
  readonly nextRevision: number
  readonly nextMap: TabletopMap
}

const databaseFromDependencies = (dependencies: AdvanceCampaignDayDependencies): RotomDatabase => {
  const sheetDatabase = dependencies.sheetRepository?.database
  const mapDatabase = dependencies.mapRepository?.database
  const modeDatabase = dependencies.modeRepository?.database
  const realtimeDatabase = dependencies.realtimeEventRepository?.database
  const database = dependencies.database
    ?? sheetDatabase
    ?? mapDatabase
    ?? modeDatabase
    ?? realtimeDatabase
    ?? getRotomDatabase()

  if (sheetDatabase && sheetDatabase !== database) {
    throw new Error('Campaign-day sheet repository must use the same RotomDatabase as the transaction')
  }
  if (mapDatabase && mapDatabase !== database) {
    throw new Error('Campaign-day map repository must use the same RotomDatabase as the transaction')
  }
  if (modeDatabase && modeDatabase !== database) {
    throw new Error('Campaign-day mode repository must use the same RotomDatabase as the transaction')
  }
  if (realtimeDatabase && realtimeDatabase !== database) {
    throw new Error('Campaign-day realtime event repository must use the same RotomDatabase as the transaction')
  }
  return database
}

const sheetWithAuthorityFields = (
  stored: StoredSheetDocument<Record<string, unknown>>,
): Record<string, unknown> => ({
  ...(deepCloneJson(stored.document) as Record<string, unknown>),
  slug: stored.slug,
  revision: stored.revision,
  updatedAt: stored.updatedAt,
})

const sheetHpState = (
  kind: SheetKind,
  sheet: Record<string, unknown>,
): { readonly currentHp: number, readonly injuries: number } => {
  const snapshot = kind === 'pokemon'
    ? pokemonHpSnapshot(sheet as unknown as CharacterSheet)
    : trainerHpSnapshot(sheet as unknown as TrainerSheet)
  return { currentHp: snapshot.currentHp, injuries: snapshot.injuries }
}

const planSheet = <TSheet extends { slug: string }>(
  kind: SheetKind,
  stored: StoredSheetDocument<Record<string, unknown>>,
  applyNextDay: (sheet: TSheet) => SheetHealingMutationSummary,
  timestamp: number,
): CampaignDaySheetPlan => {
  const originalSheet = sheetWithAuthorityFields(stored)
  const candidate = deepCloneJson(originalSheet) as TSheet & Record<string, unknown>
  const beforeJson = stablePersistableSheetJson(originalSheet)
  const beforeHp = sheetHpState(kind, originalSheet)
  const summary = applyNextDay(candidate as TSheet)
  if (Object.hasOwn(candidate, 'abilityUsage')) {
    ;(candidate as Record<string, unknown>).abilityUsage = {
      schemaVersion: 1,
      dayKey: `campaign-day:${timestamp}`,
      entries: [],
    }
  }
  if (Object.hasOwn(candidate, 'capabilityUsage')) {
    const transitioned = advanceCapabilityUsageDay(
      (candidate as Record<string, unknown>).capabilityUsage as Parameters<typeof advanceCapabilityUsageDay>[0],
      timestamp,
    )
    if (transitioned) (candidate as Record<string, unknown>).capabilityUsage = transitioned
    else delete (candidate as Record<string, unknown>).capabilityUsage
  }
  if (kind === 'pokemon') {
    const pokemon = candidate as unknown as CharacterSheet
    const heldName = pokemon.items?.held?.trim() ?? ''
    // Enrollment starts only from this server-owned custody observation (or an
    // earlier mutation hook). Unrelated sheet updatedAt values never prove how
    // long a same-named Berry has been continuously held.
    const reconciled = reconcileJuicerHeldItemCustody({
      value: pokemon.capabilityCampaignState,
      sheetSlug: pokemon.slug,
      heldItemName: heldName,
      hasJuicer: pokemon.species.trim().toLocaleLowerCase('en-US') === 'shuckle'
        && pokemonHasResolvedCapability(pokemon, 'Juicer'),
      now: timestamp,
      sourceOperationId: `campaign-day:${timestamp}`,
    })
    const materialized = materializeJuicerCampaignStateAtTime({
      value: reconciled,
      heldItemName: heldName,
      now: timestamp,
    })
    if (capabilityCampaignStateHasContent(materialized.state)) {
      pokemon.capabilityCampaignState = materialized.state
      if (materialized.heldItemName !== heldName
        || juicerHeldItemIsLegacyShellMirror(materialized.state, heldName)) {
        // A converted shell item is independent from the ordinary held slot.
        pokemon.items = { ...(pokemon.items ?? {}), held: '' }
      }
    }
    else delete pokemon.capabilityCampaignState
  }
  if (kind === 'pokemon' && Object.hasOwn(candidate, 'berryStorage')) {
    delete (candidate as Record<string, unknown>).berryStorage
  }
  const afterJson = stablePersistableSheetJson(candidate)
  const changed = beforeJson !== afterJson
  const hpChanged = !sameJsonValue(beforeHp, sheetHpState(kind, candidate))
  const plannedNextRevision = nextRevision(stored.revision)
  const nextSheet = changed
    ? {
        ...candidate,
        slug: stored.slug,
        revision: plannedNextRevision,
        updatedAt: timestamp,
      }
    : {
        ...candidate,
        slug: stored.slug,
        revision: stored.revision,
        updatedAt: stored.updatedAt,
      }

  return {
    kind,
    slug: stored.slug,
    path: logicalSheetResourcePath(kind, originalSheet),
    originalSheet,
    changed,
    expectedRevision: stored.revision,
    nextRevision: plannedNextRevision,
    nextSheet,
    summary,
    hpChanged,
  }
}

const buildCampaignDayPlan = (
  pokemonSheets: readonly StoredSheetDocument<Record<string, unknown>>[],
  trainerSheets: readonly StoredSheetDocument<Record<string, unknown>>[],
  timestamp: number,
  effectiveSoullessBySheet: ReadonlyMap<string, boolean>,
): readonly CampaignDaySheetPlan[] => [
  ...pokemonSheets.map((stored) => planSheet(
    'pokemon',
    stored,
    (sheet: CharacterSheet) => applyPokemonNextDay(sheet, {
      effectiveSoulless: effectiveSoullessBySheet.get(capabilityHpSheetKey('pokemon', stored.slug)),
    }),
    timestamp,
  )),
  ...trainerSheets.map((stored) => planSheet(
    'trainer',
    stored,
    applyTrainerNextDay as (sheet: TrainerSheet) => SheetHealingMutationSummary,
    timestamp,
  )),
]

const sheetSnapshotsForPlans = (
  plans: readonly CampaignDaySheetPlan[],
  source: 'original' | 'projected',
): ReadonlyMap<string, CapabilityHpStateSheet> => new Map(plans.map((plan) => [
  capabilityHpSheetKey(plan.kind, plan.slug),
  {
    kind: plan.kind,
    slug: plan.slug,
    revision: plan.expectedRevision,
    sheet: deepCloneJson(source === 'original' ? plan.originalSheet : plan.nextSheet) as unknown as CharacterSheet | TrainerSheet,
  },
]))

const resolveCampaignDaySoullessAuthority = (input: {
  readonly pokemonSheets: readonly StoredSheetDocument<Record<string, unknown>>[]
  readonly liveMaps: readonly StoredMapDocument<TabletopMap>[]
}): ReadonlyMap<string, boolean> => {
  const sheetBySlug = new Map(input.pokemonSheets.map(stored => [stored.slug, sheetWithAuthorityFields(stored)]))
  const statuses = new Map<string, Set<boolean>>()
  for (const storedMap of input.liveMaps) {
    for (const placement of storedMap.document.placements) {
      if (placement.sheetKind !== 'pokemon') continue
      const sheet = sheetBySlug.get(placement.sheetSlug)
      if (!sheet) throw new Error(`pokemon sheet ${placement.sheetSlug} required by live map ${storedMap.slug} is unavailable`)
      const effective = resolveEffectiveCapabilities({
        map: storedMap.document,
        placement,
        sheet: sheet as unknown as CharacterSheet,
      }).instances.some(instance => instance.effective && instance.canonicalId === 'Soulless')
      const key = capabilityHpSheetKey('pokemon', placement.sheetSlug)
      const values = statuses.get(key) ?? new Set<boolean>()
      values.add(effective)
      statuses.set(key, values)
    }
  }

  const resolved = new Map<string, boolean>()
  for (const stored of input.pokemonSheets) {
    const key = capabilityHpSheetKey('pokemon', stored.slug)
    const values = statuses.get(key)
    if (values && values.size > 1) {
      throw new Error(
        `pokemon sheet ${stored.slug} has contradictory Soulless authority across live maps; campaign-day healing requires one authoritative encounter context`,
      )
    }
    resolved.set(
      key,
      values?.values().next().value
        ?? pokemonHasResolvedCapability(sheetWithAuthorityFields(stored) as unknown as CharacterSheet, 'Soulless'),
    )
  }
  return resolved
}

const withFinalSheetAuthority = (
  plan: CampaignDaySheetPlan,
  candidate: CharacterSheet | TrainerSheet,
  timestamp: number,
): CampaignDaySheetPlan => {
  const contentCandidate = {
    ...deepCloneJson(candidate),
    slug: plan.slug,
    revision: plan.expectedRevision,
    updatedAt: plan.originalSheet.updatedAt,
  } as Record<string, unknown>
  const changed = stablePersistableSheetJson(plan.originalSheet) !== stablePersistableSheetJson(contentCandidate)
  return {
    ...plan,
    changed,
    hpChanged: !sameJsonValue(
      sheetHpState(plan.kind, plan.originalSheet),
      sheetHpState(plan.kind, contentCandidate),
    ),
    nextSheet: changed
      ? {
          ...contentCandidate,
          revision: plan.nextRevision,
          updatedAt: timestamp,
        }
      : contentCandidate,
  }
}

const reconcileCampaignDayCapabilityHp = (input: {
  readonly sheetPlans: readonly CampaignDaySheetPlan[]
  readonly liveMaps: readonly StoredMapDocument<TabletopMap>[]
  readonly timestamp: number
}): {
  readonly sheetPlans: readonly CampaignDaySheetPlan[]
  readonly mapPlans: readonly CampaignDayMapPlan[]
} => {
  const originalSheets = sheetSnapshotsForPlans(input.sheetPlans, 'original')
  let projectedSheets = new Map(sheetSnapshotsForPlans(input.sheetPlans, 'projected'))
  const touchedSheetKeys = new Set(input.sheetPlans
    .filter(plan => plan.hpChanged)
    .map(plan => capabilityHpSheetKey(plan.kind, plan.slug)))
  const projectedMaps = new Map(input.liveMaps.map(stored => [stored.slug, deepCloneJson(stored.document)]))
  const maximumPasses = Math.max(1, input.liveMaps.length + input.sheetPlans.length + 1)
  let stabilized = false

  for (let pass = 0; pass < maximumPasses; pass += 1) {
    let changed = false
    for (const storedMap of input.liveMaps) {
      const nextMap = projectedMaps.get(storedMap.slug)!
      const touchedPlacementIds = new Set(nextMap.placements
        .filter(placement => touchedSheetKeys.has(capabilityHpSheetKey(placement.sheetKind, placement.sheetSlug)))
        .map(placement => placement.id))
      if (touchedPlacementIds.size === 0) continue
      const reconciled = reconcileCapabilityHpState({
        previousMap: storedMap.document,
        nextMap,
        previousSheets: originalSheets,
        sheets: projectedSheets,
        touchedPlacementIds,
      })
      if (!sameJsonValue(nextMap, reconciled.nextMap)) {
        projectedMaps.set(storedMap.slug, deepCloneJson(reconciled.nextMap))
        changed = true
      }
      for (const [key, snapshot] of reconciled.sheets) {
        const current = projectedSheets.get(key)
        if (!current || sameJsonValue(current.sheet, snapshot.sheet)) continue
        projectedSheets.set(key, snapshot)
        touchedSheetKeys.add(key)
        changed = true
      }
    }
    if (!changed) {
      stabilized = true
      break
    }
  }
  if (!stabilized) throw new Error('Campaign-day Capability HP reconciliation did not stabilize')

  const sheetPlans = input.sheetPlans.map((plan) => {
    const projected = projectedSheets.get(capabilityHpSheetKey(plan.kind, plan.slug))
    if (!projected) throw new Error(`${plan.kind} sheet ${plan.slug} disappeared during campaign-day planning`)
    return withFinalSheetAuthority(plan, projected.sheet, input.timestamp)
  })
  const mapPlans = input.liveMaps.flatMap((stored): CampaignDayMapPlan[] => {
    const projected = projectedMaps.get(stored.slug)!
    if (sameJsonValue(stored.document, projected)) return []
    const revision = nextRevision(stored.revision)
    return [{
      slug: stored.slug,
      expectedRevision: stored.revision,
      nextRevision: revision,
      nextMap: {
        ...deepCloneJson(projected),
        revision,
        updatedAt: input.timestamp,
      },
    }]
  })
  return { sheetPlans, mapPlans }
}

const timestampAppendInputs = (
  inputs: readonly AppendRealtimeEventInput[],
  timestamp: number,
): readonly AppendRealtimeEventInput[] => inputs.map((input) => ({ ...input, timestamp }))

const appendInputsForPersistedSheet = (
  plan: CampaignDaySheetPlan,
  sheet: Record<string, unknown>,
  clientId: string | undefined,
  timestamp: number,
): readonly AppendRealtimeEventInput[] => timestampAppendInputs(setupSheetSaveRealtimeAppendInputs({
  kind: plan.kind,
  slug: plan.slug,
  sheet,
  clientId,
}), timestamp)

export const advanceCampaignDayUseCase = (
  input: AdvanceCampaignDayInput = {},
  dependencies: AdvanceCampaignDayDependencies = {},
): AdvanceCampaignDayResult => {
  const database = databaseFromDependencies(dependencies)
  const sheetRepository = dependencies.sheetRepository
    ?? createSqliteSheetRepository<Record<string, unknown>>(database)
  const mapRepository = dependencies.mapRepository
    ?? createSqliteMapRepository<TabletopMap>(database)
  const modeRepository = dependencies.modeRepository
    ?? createSqliteMapInteractionModeRepository(database)
  const realtimeEventRepository = dependencies.realtimeEventRepository
    ?? createSqliteRealtimeEventRepository({ database })
  const now = dependencies.now ?? Date.now
  const timestamp = now()

  const pokemonSheets = [...sheetRepository.list('pokemon')] as StoredSheetDocument<Record<string, unknown>>[]
  const trainerSheets = [...sheetRepository.list('trainer')] as StoredSheetDocument<Record<string, unknown>>[]
  const maps = [...mapRepository.list()] as StoredMapDocument<TabletopMap>[]
  const modeReads = new Map<string, StoredMapInteractionMode>(maps.map(stored => [
    stored.slug,
    modeRepository.get(stored.slug),
  ]))
  const liveMaps = maps.filter(stored => (
    modeReads.get(stored.slug)?.interactionMode === MAP_INTERACTION_MODES.LIVE_PLAY
  ))
  const effectiveSoullessBySheet = resolveCampaignDaySoullessAuthority({ pokemonSheets, liveMaps })
  const initialSheetPlans = buildCampaignDayPlan(
    pokemonSheets,
    trainerSheets,
    timestamp,
    effectiveSoullessBySheet,
  )
  const reconciled = reconcileCampaignDayCapabilityHp({
    sheetPlans: initialSheetPlans,
    liveMaps,
    timestamp,
  })
  const sheetPlans = reconciled.sheetPlans
  const mapPlans = reconciled.mapPlans
  const changedPlans = sheetPlans.filter((plan) => plan.changed)
  const summary = emptyHealingMutationSummary()
  for (const plan of sheetPlans) addHealingMutationSummary(summary, plan.summary)
  summary.hitPointsRestored = 0
  summary.injuriesHealed = 0
  for (const plan of sheetPlans) {
    const previous = sheetHpState(plan.kind, plan.originalSheet)
    const current = sheetHpState(plan.kind, plan.nextSheet)
    summary.hitPointsRestored += Math.max(0, current.currentHp - previous.currentHp)
    summary.injuriesHealed += Math.max(0, previous.injuries - current.injuries)
  }

  const pokemonUpdated = changedPlans.filter((plan) => plan.kind === 'pokemon').length
  const trainerUpdated = changedPlans.filter((plan) => plan.kind === 'trainer').length

  const transactionResult = changedPlans.length === 0 && mapPlans.length === 0
    ? { paths: [] as string[], realtimeEvents: [] as readonly PersistedRealtimeEvent[] }
    : database.withTransaction(() => {
        const sheetExpectations = sheetPlans.map(plan => ({
          kind: plan.kind,
          slug: plan.slug,
          revision: plan.expectedRevision,
        }))
        if (sheetRepository.assertRevisions) sheetRepository.assertRevisions(sheetExpectations)
        else for (const plan of sheetPlans) {
          const current = sheetRepository.getByRef(plan.kind, plan.slug)
          if (!current || current.revision !== plan.expectedRevision) {
            throw new Error(`${plan.kind} sheet ${plan.slug} changed during campaign-day advancement`)
          }
        }
        for (const stored of maps) {
          const expectedMode = modeReads.get(stored.slug)!
          const currentMode = modeRepository.get(stored.slug)
          if (!sameJsonValue(currentMode, expectedMode)) {
            throw new Error(`map ${stored.slug} interaction mode changed during campaign-day advancement`)
          }
        }
        for (const stored of liveMaps) {
          const current = mapRepository.getBySlug(stored.slug)
          if (!current || current.revision !== stored.revision) {
            throw new Error(`map ${stored.slug} changed during campaign-day advancement`)
          }
        }

        for (const plan of changedPlans) {
          const current = sheetRepository.getByRef(plan.kind, plan.slug)
          if (!current) throw new Error(`${plan.kind} sheet ${plan.slug} changed during campaign-day advancement`)
          if (current.revision !== plan.expectedRevision) {
            throw new Error(
              `${plan.kind} sheet ${plan.slug} changed during campaign-day advancement; expected revision ${plan.expectedRevision}, current revision ${current.revision}`,
            )
          }
          const result = sheetRepository.applyLivePlayUpdate({
            kind: plan.kind,
            slug: plan.slug,
            expectedRevision: plan.expectedRevision,
            nextSheet: plan.nextSheet,
            sourceOperationId: `campaign-day:${timestamp}`,
          })
          if (result === 'stale') throw new Error(`${plan.kind} sheet ${plan.slug} changed during campaign-day advancement`)
        }
        for (const plan of mapPlans) {
          const result = mapRepository.applyLivePlayUpdate({
            slug: plan.slug,
            expectedRevision: plan.expectedRevision,
            nextMap: plan.nextMap,
          })
          if (result === 'stale') throw new Error(`map ${plan.slug} changed during campaign-day advancement`)
        }

        const appendInputs: AppendRealtimeEventInput[] = []
        const paths: string[] = []
        for (const plan of changedPlans) {
          const persisted = sheetRepository.getByRef(plan.kind, plan.slug)
          if (!persisted) throw new Error(`${plan.kind} sheet ${plan.slug} not found after campaign-day advancement`)
          if (persisted.revision !== plan.nextRevision || persisted.updatedAt !== timestamp) {
            throw new Error(
              `${plan.kind} sheet ${plan.slug} authoritative re-read did not match campaign-day revision ${plan.nextRevision} and timestamp ${timestamp}`,
            )
          }
          paths.push(logicalSheetResourcePath(plan.kind, persisted.sheet))
          appendInputs.push(...appendInputsForPersistedSheet(plan, persisted.sheet, input.clientId, timestamp))
        }
        for (const plan of mapPlans) {
          const persisted = mapRepository.getBySlug(plan.slug)
          if (!persisted || persisted.revision !== plan.nextRevision || persisted.updatedAt !== timestamp) {
            throw new Error(
              `map ${plan.slug} authoritative re-read did not match campaign-day revision ${plan.nextRevision} and timestamp ${timestamp}`,
            )
          }
          appendInputs.push(...timestampAppendInputs(
            setupMapSaveRealtimeAppendInputs(deepCloneJson(persisted), input.clientId),
            timestamp,
          ))
        }

        const realtimeEvents = realtimeEventRepository.appendMany(appendInputs)
        return { paths, realtimeEvents }
      })

  publishPersistedRealtimeEventsAfterCommit({
    events: transactionResult.realtimeEvents,
    operation: 'campaign-next-day',
    publish: dependencies.publishPersistedRealtimeEvent ?? defaultPersistedRealtimeEventPublisher,
    reportFailure: dependencies.reportAfterCommitPublicationFailure ?? defaultPersistedRealtimePublicationFailureReporter,
  })

  return {
    ok: true,
    totalSheets: pokemonSheets.length + trainerSheets.length,
    updatedSheets: pokemonUpdated + trainerUpdated,
    pokemonSheets: pokemonSheets.length,
    trainerSheets: trainerSheets.length,
    pokemonUpdated,
    trainerUpdated,
    hitPointsRestored: summary.hitPointsRestored,
    injuriesHealed: summary.injuriesHealed,
    dailyMoveUsesCleared: summary.dailyMoveUsesCleared,
    dailyMoveEntriesCleared: summary.dailyMoveEntriesCleared,
    conditionsCleared: summary.conditionsCleared,
    trainerApRestored: summary.trainerApRestored,
    realtimeEvents: transactionResult.realtimeEvents,
    paths: transactionResult.paths,
  }
}

import type { CampaignNextDayResult } from '#shared/campaign'
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
import type { TrainerSheet } from '~/types/trainerSheet'
import { deepCloneJson } from '~/utils/serialization'
import { stablePersistableSheetJson } from '~/utils/sheets/persistence'
import { pokemonHasResolvedCapability } from '~/utils/sheets/pokemonDerived'
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
  createSqliteRealtimeEventRepository,
  type AppendRealtimeEventInput,
  type RealtimeEventRepository,
} from '../storage/realtimeEventRepository'
import { setupSheetSaveRealtimeAppendInputs } from '../realtime/setupDocumentRealtime'
import {
  defaultPersistedRealtimeEventPublisher,
  defaultPersistedRealtimePublicationFailureReporter,
  publishPersistedRealtimeEventsAfterCommit,
  type PersistedRealtimeEventPublisher,
  type PersistedRealtimePublicationFailureReporter,
} from '../realtime/persistedBatchPublication'
import { logicalSheetResourcePath } from '../utils/runtimeResourcePaths'

export interface AdvanceCampaignDayInput {
  clientId?: string
}

type AdvanceCampaignDaySheetRepository = Pick<SheetRepository<Record<string, unknown>>, 'list' | 'applyLivePlayUpdate' | 'getByRef'> & {
  readonly database?: RotomDatabase
}

type AdvanceCampaignDayRealtimeEventRepository = Pick<RealtimeEventRepository, 'appendMany'> & {
  readonly database?: RotomDatabase
}

export interface AdvanceCampaignDayDependencies {
  database?: RotomDatabase
  sheetRepository?: AdvanceCampaignDaySheetRepository
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
}

const databaseFromDependencies = (dependencies: AdvanceCampaignDayDependencies): RotomDatabase => {
  const sheetDatabase = dependencies.sheetRepository?.database
  const realtimeDatabase = dependencies.realtimeEventRepository?.database
  const database = dependencies.database ?? sheetDatabase ?? realtimeDatabase ?? getRotomDatabase()

  if (sheetDatabase && sheetDatabase !== database) {
    throw new Error('Campaign-day sheet repository must use the same RotomDatabase as the transaction')
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

const planSheet = <TSheet extends { slug: string }>(
  kind: SheetKind,
  stored: StoredSheetDocument<Record<string, unknown>>,
  applyNextDay: (sheet: TSheet) => SheetHealingMutationSummary,
  timestamp: number,
): CampaignDaySheetPlan => {
  const originalSheet = sheetWithAuthorityFields(stored)
  const candidate = deepCloneJson(originalSheet) as TSheet & Record<string, unknown>
  const beforeJson = stablePersistableSheetJson(originalSheet)
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
  }
}

const buildCampaignDayPlan = (
  pokemonSheets: readonly StoredSheetDocument<Record<string, unknown>>[],
  trainerSheets: readonly StoredSheetDocument<Record<string, unknown>>[],
  timestamp: number,
): readonly CampaignDaySheetPlan[] => [
  ...pokemonSheets.map((stored) => planSheet(
    'pokemon',
    stored,
    applyPokemonNextDay as (sheet: CharacterSheet) => SheetHealingMutationSummary,
    timestamp,
  )),
  ...trainerSheets.map((stored) => planSheet(
    'trainer',
    stored,
    applyTrainerNextDay as (sheet: TrainerSheet) => SheetHealingMutationSummary,
    timestamp,
  )),
]

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
  const realtimeEventRepository = dependencies.realtimeEventRepository
    ?? createSqliteRealtimeEventRepository({ database })
  const now = dependencies.now ?? Date.now
  const timestamp = now()

  const pokemonSheets = [...sheetRepository.list('pokemon')] as StoredSheetDocument<Record<string, unknown>>[]
  const trainerSheets = [...sheetRepository.list('trainer')] as StoredSheetDocument<Record<string, unknown>>[]
  const sheetPlans = buildCampaignDayPlan(pokemonSheets, trainerSheets, timestamp)
  const changedPlans = sheetPlans.filter((plan) => plan.changed)
  const summary = emptyHealingMutationSummary()
  for (const plan of sheetPlans) addHealingMutationSummary(summary, plan.summary)

  const pokemonUpdated = changedPlans.filter((plan) => plan.kind === 'pokemon').length
  const trainerUpdated = changedPlans.filter((plan) => plan.kind === 'trainer').length

  const transactionResult = changedPlans.length === 0
    ? { paths: [] as string[], realtimeEvents: [] as readonly PersistedRealtimeEvent[] }
    : database.withTransaction(() => {
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

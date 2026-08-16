import { createHash } from 'node:crypto'
import { stableJsonStringify } from '#shared/automation/stableJson'
import rulesetJson from '../../data/breeding-automation/ruleset.json'
import securityPolicyJson from '../../data/breeding-automation/security-policy.json'
import {
  CampaignDayContractError,
  parseCampaignDayOperationAcceptedV1,
  parseCampaignDayOperationCommandV1,
  projectCampaignNextDayResult,
  type CampaignDayExpiredEffectV1,
  type CampaignDayOperationCommandV1,
  type CampaignNextDayResult,
} from '#shared/campaign'
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
import type { PokemonEggDocumentV1 } from '#shared/breeding/egg'
import { parseItemBreedingState } from '#shared/breeding/itemWorkflows'
import type { BreedingModifierProviderHandoffV1 } from '#shared/breeding/modifierProviderHandoff'
import type { BreedingIncubationSegmentResultV1 } from '#shared/breeding/incubation'
import type { BreedingOperationId } from '#shared/breeding/ids'
import type { BreedingDependencyEvidenceV1, BreedingReadResourceV1 } from '#shared/breeding/readSets'
import { UseCaseHttpError } from '../utils/useCaseErrors'
import { parseBreedingOperationCommandV1 } from '#shared/breeding/operations'
import { createBreedingActorAuthorityV1, createBreedingGmOverrideEvidenceV1, authorizeBreedingEggIncubationV1 } from '../domain/breeding/authorization'
import { createBreedingOperationReadSetV1 } from '../domain/breeding/readSets'
import { createCurrentBreedingReferenceVersionSnapshotV1 } from '../domain/breeding/currentReferences'
import { DEFAULT_BREEDING_CAMPAIGN_OPTION_SNAPSHOT } from '../domain/breeding/campaignOptions'
import {
  BREEDING_INCUBATION_BASE_RATE_EVIDENCE_DEFINITION_SHA256,
  BREEDING_INCUBATION_BASE_RATE_PROVIDER_ID,
  BREEDING_INCUBATION_POLICY_DEFINITION_SHA256,
  planBreedingIncubationAdvanceV1,
  pokemonEggIncubationDocumentDefinitionSha256,
} from '../domain/breeding/incubation'
import {
  BreedingModifierProviderHandoffAuthorityError,
  createBreedingEggWarmerItemHandoffV1,
} from '../domain/breeding/modifierProviderHandoff'
import {
  deriveBreedingCampaignClockBatchChildOperationIdV1,
  deriveBreedingCampaignClockBatchOverrideIdV1,
  deriveBreedingCampaignClockBatchReadSetIdV1,
} from '../domain/breeding/campaignClockBatch'
import { breedingRealtimeRefreshAppendInputs } from '../realtime/breedingRealtime'
import { itemExplorationClockRealtimeAppendInput } from '../realtime/itemExplorationRealtime'
import { createSqliteBreedingIncubationSegmentRepository } from '../storage/breedingIncubationSegmentRepository'
import { createSqliteBreedingOperationEvidenceRepository } from '../storage/breedingOperationEvidenceRepository'
import { createSqlitePokemonEggRepository } from '../storage/pokemonEggRepository'
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
  createBreedingOperationAcceptedV1,
  createBreedingOperationCommandHash,
} from '../domain/breeding/operations'
import { createCampaignTimeAdvancedLifecycleEvent } from '../domain/moveAutomation/durationLifecycle'
import { reduceEncounterLifecycle } from '../domain/moveAutomation/reduceLifecycle'
import { createEmptyEncounterState, parseEncounterState } from '#shared/moveAutomation/encounterState'
import { ITEM_CAMPAIGN_MINUTES_PER_DAY } from '../domain/itemAutomation/durations'
import { advanceBandageTreatmentsToCampaignMinute } from '../domain/itemAutomation/medicalTreatments'
import { reconcileSheetReBreathers } from '../domain/itemAutomation/reBreatherLifecycle'
import {
  createSqliteCampaignClockRepository,
  type CampaignClockRepository,
} from '../storage/campaignClockRepository'
import {
  createSqliteBreedingOperationRepository,
  type BreedingOperationRepository,
} from '../storage/breedingOperationRepository'
import {
  campaignDayOperationCommandSha256,
  createSqliteCampaignDayOperationRepository,
  type CampaignDayOperationRepository,
} from '../storage/campaignDayOperationRepository'
import {
  capabilityHpSheetKey,
  reconcileCapabilityHpState,
  type CapabilityHpStateSheet,
} from '../domain/capabilityAutomation/reconcileHpState'

export class AdvanceCampaignDayUseCaseError extends UseCaseHttpError<400 | 409> {}

export interface AdvanceCampaignDayInput {
  clientId?: string
  /** Required by HTTP callers. Omission remains a trusted direct-call compatibility seam. */
  command?: unknown
  /** Server-only preflight authority assertion; never accepted from an HTTP body. */
  assertPreflightCurrent?: () => void
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
  campaignClockRepository?: CampaignClockRepository
  breedingOperationRepository?: BreedingOperationRepository
  campaignDayOperationRepository?: CampaignDayOperationRepository
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

interface CampaignDayEggPlan {
  readonly egg: PokemonEggDocumentV1
  readonly command: ReturnType<typeof parseBreedingOperationCommandV1>
  readonly readSet: ReturnType<typeof createBreedingOperationReadSetV1>
  readonly actor: ReturnType<typeof createBreedingActorAuthorityV1>
  readonly override: ReturnType<typeof createBreedingGmOverrideEvidenceV1>
  readonly receipt: ReturnType<typeof authorizeBreedingEggIncubationV1>
  readonly nextEgg: PokemonEggDocumentV1
  readonly segment: BreedingIncubationSegmentResultV1
}

interface CampaignDayEggSummary {
  readonly reconciledEggs: number
  readonly creditedEggCampaignMinutes: number
  readonly skippedPausedEggCampaignMinutes: number
  readonly eggBatchComplete: true
}

const databaseFromDependencies = (dependencies: AdvanceCampaignDayDependencies): RotomDatabase => {
  const sheetDatabase = dependencies.sheetRepository?.database
  const mapDatabase = dependencies.mapRepository?.database
  const modeDatabase = dependencies.modeRepository?.database
  const realtimeDatabase = dependencies.realtimeEventRepository?.database
  const clockDatabase = dependencies.campaignClockRepository?.database
  const breedingOperationDatabase = dependencies.breedingOperationRepository?.database
  const campaignDayOperationDatabase = dependencies.campaignDayOperationRepository?.database
  const database = dependencies.database
    ?? sheetDatabase
    ?? mapDatabase
    ?? modeDatabase
    ?? realtimeDatabase
    ?? clockDatabase
    ?? breedingOperationDatabase
    ?? campaignDayOperationDatabase
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
  if (clockDatabase && clockDatabase !== database) {
    throw new Error('Campaign-day clock repository must use the same RotomDatabase as the transaction')
  }
  if (breedingOperationDatabase && breedingOperationDatabase !== database) {
    throw new Error('Campaign-day breeding operation repository must use the same RotomDatabase as the transaction')
  }
  if (campaignDayOperationDatabase && campaignDayOperationDatabase !== database) {
    throw new Error('Campaign-day operation repository must use the same RotomDatabase as the transaction')
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
  targetCampaignMinute: number,
): CampaignDaySheetPlan => {
  const originalSheet = sheetWithAuthorityFields(stored)
  let candidate = deepCloneJson(originalSheet) as TSheet & Record<string, unknown>
  const beforeJson = stablePersistableSheetJson(originalSheet)
  const beforeHp = sheetHpState(kind, originalSheet)
  const treatment = advanceBandageTreatmentsToCampaignMinute({
    sheetKind: kind,
    sheet: candidate as unknown as CharacterSheet | TrainerSheet,
    campaignMinute: targetCampaignMinute,
  })
  candidate = treatment.sheet as unknown as TSheet & Record<string, unknown>
  const reBreathers = reconcileSheetReBreathers({
    kind,
    slug: stored.slug,
    sheet: candidate as unknown as CharacterSheet | TrainerSheet,
    campaignMinute: targetCampaignMinute,
  })
  candidate = reBreathers.sheet as unknown as TSheet & Record<string, unknown>
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
  targetCampaignMinute: number,
  effectiveSoullessBySheet: ReadonlyMap<string, boolean>,
): readonly CampaignDaySheetPlan[] => [
  ...pokemonSheets.map((stored) => planSheet(
    'pokemon',
    stored,
    (sheet: CharacterSheet) => applyPokemonNextDay(sheet, {
      effectiveSoulless: effectiveSoullessBySheet.get(capabilityHpSheetKey('pokemon', stored.slug)),
    }),
    timestamp,
    targetCampaignMinute,
  )),
  ...trainerSheets.map((stored) => planSheet(
    'trainer',
    stored,
    applyTrainerNextDay as (sheet: TrainerSheet) => SheetHealingMutationSummary,
    timestamp,
    targetCampaignMinute,
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

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')

const trustedDirectCampaignDayCommand = (
  timestamp: number,
  clock: { readonly revision: number, readonly campaignMinute: number, readonly lastOperationId: string | null },
): CampaignDayOperationCommandV1 => parseCampaignDayOperationCommandV1({
  schemaVersion: 1,
  operationId: `campaign-day:v1:${sha256(stableJsonStringify({
    seam: 'trusted-direct-campaign-day-v1',
    timestamp,
    clockRevision: clock.revision,
    campaignMinute: clock.campaignMinute,
    lastOperationId: clock.lastOperationId,
  })).slice(0, 32)}`,
  kind: 'advance-one-day',
  days: 1,
})

const campaignDayClockOperationId = (operationId: string): BreedingOperationId => (
  `breeding-operation:v1:${sha256(`campaign-day-clock:${operationId}`).slice(0, 32)}` as BreedingOperationId
)

const campaignDayClockCommand = (input: {
  readonly operationId: string
  readonly expectedRevision: number
  readonly targetCampaignMinute: number
}) => parseBreedingOperationCommandV1({
  schemaVersion: 1,
  operationId: campaignDayClockOperationId(input.operationId),
  commandKind: 'advance-campaign-clock',
  actor: { profileId: 'campaign-day-system', selectedTrainerSlug: null },
  ruleset: {
    rulesetId: rulesetJson.rulesetId,
    definitionSha256: rulesetJson.definitionSha256,
  },
  scopes: [{ kind: 'campaign-clock', expectedRevision: input.expectedRevision }],
  payload: { targetCampaignMinute: input.targetCampaignMinute },
})

const campaignDayEggOperationId = (
  campaignDayOperationId: string,
  eggId: string,
): BreedingOperationId => deriveBreedingCampaignClockBatchChildOperationIdV1(
  campaignDayClockOperationId(campaignDayOperationId),
  eggId,
)

const breedingClockDefinitionSha256 = (clock: {
  readonly revision: number
  readonly campaignMinute: number
  readonly lastOperationId: string | null
}): string => sha256(stableJsonStringify({
  schemaVersion: 1,
  revision: clock.revision,
  campaignMinute: clock.campaignMinute,
  lastOperationId: clock.lastOperationId,
}))

const breedingResource = (input: {
  readonly resourceKind: BreedingReadResourceV1['resourceKind']
  readonly resourceId: string
  readonly revision: number
  readonly definitionSha256: string
  readonly observedCampaignMinute?: number | null
  readonly purposes: readonly BreedingReadResourceV1['purposes'][number][]
}): BreedingReadResourceV1 => Object.freeze({
  resourceKind: input.resourceKind,
  resourceId: input.resourceId,
  existence: 'present',
  revision: input.revision,
  definitionSha256: input.definitionSha256,
  observedCampaignMinute: input.observedCampaignMinute ?? null,
  purposes: Object.freeze([...input.purposes].sort()),
})

const breedingDependencyKey = (value: BreedingDependencyEvidenceV1): string => [
  value.checkpoint,
  value.providerKind,
  value.providerId,
  value.subjectKind,
  value.subjectId,
].join('\u0000')

const NO_CAMPAIGN_DAY_EGG_MODIFIERS = Object.freeze([]) as readonly []

interface CampaignDayEggModifierAuthority {
  readonly contributions: readonly [] | BreedingModifierProviderHandoffV1
  readonly trainer: null | {
    readonly slug: string
    readonly revision: number
    readonly document: Record<string, unknown>
  }
}

const campaignDayEggModifierAuthority = (input: {
  readonly database: RotomDatabase
  readonly egg: PokemonEggDocumentV1
  readonly capturedAtCampaignMinute: number
}): CampaignDayEggModifierAuthority => {
  const stored = createSqliteSheetRepository<Record<string, unknown>>(input.database)
    .getByRef('trainer', input.egg.ownerTrainerSlug)
  if (!stored) return Object.freeze({ contributions: NO_CAMPAIGN_DAY_EGG_MODIFIERS, trainer: null })
  const trainer = Object.freeze({ slug: stored.slug, revision: stored.revision, document: stored.sheet })
  const sheet = stored.sheet as unknown as TrainerSheet
  const state = parseItemBreedingState(sheet.serverPrivate?.itemBreeding)
  const matches = state.eggWarmerAssignments.filter(value => value.eggIds.includes(input.egg.eggId))
  if (matches.length === 0) return Object.freeze({ contributions: NO_CAMPAIGN_DAY_EGG_MODIFIERS, trainer: null })
  if (matches.length !== 1) throw new Error(`Pokémon Egg ${input.egg.eggId} has ambiguous Egg Warmer item assignment authority.`)
  const assignment = matches[0]!
  try {
    const contributions = createBreedingEggWarmerItemHandoffV1({
      egg: input.egg,
      ownerTrainerSheet: trainer,
      custody: {
        inventoryEntryId: assignment.inventoryEntryId,
        unitOrdinal: assignment.unitOrdinal,
        assignedEggIds: assignment.eggIds,
      },
      capturedAtCampaignMinute: input.capturedAtCampaignMinute,
    })
    return Object.freeze({ contributions, trainer })
  }
  catch (error) {
    if (error instanceof BreedingModifierProviderHandoffAuthorityError
      && (error.code === 'breeding.modifier-provider-handoff.provider-unavailable'
        || error.code === 'breeding.modifier-provider-handoff.stale-authority')) {
      return Object.freeze({ contributions: NO_CAMPAIGN_DAY_EGG_MODIFIERS, trainer: null })
    }
    throw error
  }
}

const campaignDayEggDependencies = (
  egg: PokemonEggDocumentV1,
  modifiers: CampaignDayEggModifierAuthority,
): readonly BreedingDependencyEvidenceV1[] => {
  const baseRate = Object.freeze({
    providerKind: 'system' as const,
    providerId: BREEDING_INCUBATION_BASE_RATE_PROVIDER_ID,
    subjectKind: 'pokemon-egg' as const,
    subjectId: egg.eggId,
    subjectRevision: egg.revision,
    checkpoint: 'incubation-operation' as const,
    providerDefinitionSha256: BREEDING_INCUBATION_POLICY_DEFINITION_SHA256,
    effectiveEvidenceSha256: BREEDING_INCUBATION_BASE_RATE_EVIDENCE_DEFINITION_SHA256,
  })
  const modifierDependencies = Array.isArray(modifiers.contributions)
    ? [] : (modifiers.contributions as BreedingModifierProviderHandoffV1).dependencyEvidence
  const effective = Object.freeze([baseRate, ...modifierDependencies].sort((left, right) => (
    breedingDependencyKey(left) < breedingDependencyKey(right) ? -1 : 1
  )))
  const attestation = Object.freeze({
    providerKind: 'system' as const,
    providerId: 'breeding-effective-dependency-set-v1' as const,
    subjectKind: 'campaign' as const,
    subjectId: 'campaign',
    subjectRevision: null,
    checkpoint: 'authorization' as const,
    providerDefinitionSha256: securityPolicyJson.definitionSha256,
    effectiveEvidenceSha256: sha256(stableJsonStringify(effective)),
  })
  return Object.freeze([attestation, ...effective].sort((left, right) => (
    breedingDependencyKey(left) < breedingDependencyKey(right) ? -1 : 1
  )))
}

const planCampaignDayEggs = (input: {
  readonly database: RotomDatabase
  readonly command: CampaignDayOperationCommandV1
  readonly previousClock: { readonly revision: number, readonly campaignMinute: number, readonly lastOperationId: string | null }
  readonly targetClockRevision: number
  readonly targetCampaignMinute: number
}): readonly CampaignDayEggPlan[] => {
  const eggs = createSqlitePokemonEggRepository(input.database).listAllIncubatingBehindClock({
    revision: input.targetClockRevision,
    campaignMinute: input.targetCampaignMinute,
  })
  const referenceVersions = createCurrentBreedingReferenceVersionSnapshotV1(
    DEFAULT_BREEDING_CAMPAIGN_OPTION_SNAPSHOT,
  )
  return Object.freeze(eggs.map((egg): CampaignDayEggPlan => {
    const operationId = campaignDayEggOperationId(input.command.operationId, egg.eggId)
    const command = parseBreedingOperationCommandV1({
      schemaVersion: 1,
      operationId,
      commandKind: 'advance-egg-incubation',
      actor: { profileId: 'campaign-day-system', selectedTrainerSlug: null },
      ruleset: egg.ruleset,
      scopes: [{ kind: 'pokemon-egg', eggId: egg.eggId, expectedRevision: egg.revision }],
      payload: {
        eggId: egg.eggId,
        throughClockRevision: input.targetClockRevision,
        throughCampaignMinute: input.targetCampaignMinute,
      },
    })
    const modifierAuthority = campaignDayEggModifierAuthority({
      database: input.database,
      egg,
      capturedAtCampaignMinute: input.targetCampaignMinute,
    })
    const actor = createBreedingActorAuthorityV1({
      role: 'gm',
      command,
      authenticatedPrincipalSha256: sha256(stableJsonStringify({
        principal: 'campaign-day-system',
        campaignDayOperationId: input.command.operationId,
        securityPolicyDefinitionSha256: securityPolicyJson.definitionSha256,
      })),
      authenticationPolicyDefinitionSha256: securityPolicyJson.definitionSha256,
      profile: null,
      evaluatedAtCampaignMinute: input.targetCampaignMinute,
    })
    const dependencies = campaignDayEggDependencies(egg, modifierAuthority)
    const readSet = createBreedingOperationReadSetV1({
      readSetId: deriveBreedingCampaignClockBatchReadSetIdV1(
        campaignDayClockOperationId(input.command.operationId),
        egg.eggId,
      ),
      operationId,
      commandSha256: createBreedingOperationCommandHash(command),
      commandKind: 'advance-egg-incubation',
      capturedAtCampaignMinute: input.targetCampaignMinute,
      resources: [
        breedingResource({
          resourceKind: 'campaign-clock',
          resourceId: 'campaign-clock',
          revision: input.targetClockRevision,
          definitionSha256: breedingClockDefinitionSha256({
            revision: input.targetClockRevision,
            campaignMinute: input.targetCampaignMinute,
            lastOperationId: campaignDayClockOperationId(input.command.operationId),
          }),
          observedCampaignMinute: input.targetCampaignMinute,
          purposes: ['campaign-time'],
        }),
        breedingResource({
          resourceKind: 'pokemon-egg',
          resourceId: egg.eggId,
          revision: egg.revision,
          definitionSha256: pokemonEggIncubationDocumentDefinitionSha256(egg),
          purposes: ['conflict', 'mechanics'],
        }),
        ...(modifierAuthority.trainer ? [breedingResource({
          resourceKind: 'trainer-sheet',
          resourceId: modifierAuthority.trainer.slug,
          revision: modifierAuthority.trainer.revision,
          definitionSha256: sha256(stableJsonStringify(modifierAuthority.trainer.document)),
          purposes: ['mechanics'],
        })] : []),
      ],
      referenceVersions,
      dependencyEvidence: dependencies,
      writeExpectations: command.scopes,
    })
    const override = createBreedingGmOverrideEvidenceV1({
      overrideId: deriveBreedingCampaignClockBatchOverrideIdV1(
        campaignDayClockOperationId(input.command.operationId),
        egg.eggId,
      ),
      command,
      actorAuthority: actor,
      overrideKind: 'owner-control',
      target: { kind: 'trainer-sheet', trainerSheetSlug: egg.ownerTrainerSlug },
      reasonId: 'breeding.override.owner-control',
      createdAtCampaignMinute: input.targetCampaignMinute,
      securityPolicyDefinitionSha256: securityPolicyJson.definitionSha256,
    })
    const receipt = authorizeBreedingEggIncubationV1({
      command,
      readSet,
      actorAuthority: actor,
      trainerControl: null,
      egg,
      gmOverrides: [override],
      securityPolicyDefinitionSha256: securityPolicyJson.definitionSha256,
    })
    if (!receipt.authorized) {
      throw new Error(`Campaign-day Egg ${egg.eggId} could not be authorized for its exact clock checkpoint.`)
    }
    const planned = planBreedingIncubationAdvanceV1({
      egg,
      command,
      campaignClock: {
        revision: input.targetClockRevision,
        campaignMinute: input.targetCampaignMinute,
        lastOperationId: campaignDayClockOperationId(input.command.operationId),
      },
      modifierContributions: modifierAuthority.contributions,
    })
    return Object.freeze({
      egg,
      command,
      readSet,
      actor,
      override,
      receipt,
      nextEgg: planned.egg,
      segment: planned.segment,
    })
  }))
}

const safeEggMinuteTotal = (
  plans: readonly CampaignDayEggPlan[],
  select: (plan: CampaignDayEggPlan) => number,
  label: string,
): number => {
  let total = 0
  for (const plan of plans) {
    const amount = select(plan)
    if (!Number.isSafeInteger(amount) || amount < 0 || total > Number.MAX_SAFE_INTEGER - amount) {
      throw new Error(`Campaign-day ${label} exceeds the safe integer range.`)
    }
    total += amount
  }
  return total
}

const summarizeCampaignDayEggPlans = (
  plans: readonly CampaignDayEggPlan[],
): CampaignDayEggSummary => {
  if (!Number.isSafeInteger(plans.length)) {
    throw new Error('Campaign-day reconciled Egg count exceeds the safe integer range.')
  }
  return Object.freeze({
    reconciledEggs: plans.length,
    creditedEggCampaignMinutes: safeEggMinuteTotal(
      plans, plan => plan.segment.creditedCampaignMinutes, 'credited Egg campaign minutes',
    ),
    skippedPausedEggCampaignMinutes: safeEggMinuteTotal(
      plans, plan => plan.segment.skippedCampaignMinutes, 'skipped paused Egg campaign minutes',
    ),
    eggBatchComplete: true,
  })
}

const applyCampaignTimeLifecycle = (input: {
  readonly liveMaps: readonly StoredMapDocument<TabletopMap>[]
  readonly existingPlans: readonly CampaignDayMapPlan[]
  readonly command: CampaignDayOperationCommandV1
  readonly previousCampaignMinute: number
  readonly campaignMinute: number
  readonly clockRevision: number
  readonly timestamp: number
}): {
  readonly mapPlans: readonly CampaignDayMapPlan[]
  readonly expiredEffects: readonly CampaignDayExpiredEffectV1[]
} => {
  const existingBySlug = new Map(input.existingPlans.map(plan => [plan.slug, plan]))
  const event = createCampaignTimeAdvancedLifecycleEvent({
    operationId: input.command.operationId,
    previousCampaignMinute: input.previousCampaignMinute,
    campaignMinute: input.campaignMinute,
    clockRevision: input.clockRevision,
  })
  const expiredEffects: CampaignDayExpiredEffectV1[] = []
  const mapPlans = input.liveMaps.flatMap((stored): CampaignDayMapPlan[] => {
    const existing = existingBySlug.get(stored.slug)
    const candidate = deepCloneJson(existing?.nextMap ?? stored.document)
    const previousState = parseEncounterState(candidate.encounterState ?? createEmptyEncounterState())
    const reduction = reduceEncounterLifecycle(previousState, [event], [])
    for (const applied of reduction.transitions) {
      const previous = applied.transition.previous
      if (applied.transition.reasonCode !== 'effect-campaign-time-expired'
        || previous?.duration.kind !== 'campaign-time') continue
      expiredEffects.push({
        mapSlug: stored.slug,
        effectId: applied.transition.effectId,
        durationKind: 'campaign-time',
        expiresAtCampaignMinute: previous.duration.expiresAtCampaignMinute,
      })
    }
    if (reduction.changed) candidate.encounterState = deepCloneJson(reduction.state)
    if (existing && !reduction.changed) return [existing]
    if (!existing && !reduction.changed) return []
    const revision = nextRevision(stored.revision)
    return [{
      slug: stored.slug,
      expectedRevision: stored.revision,
      nextRevision: revision,
      nextMap: {
        ...candidate,
        revision,
        updatedAt: input.timestamp,
      },
    }]
  })
  expiredEffects.sort((left, right) => {
    if (left.mapSlug !== right.mapSlug) return left.mapSlug < right.mapSlug ? -1 : 1
    if (left.effectId !== right.effectId) return left.effectId < right.effectId ? -1 : 1
    return 0
  })
  return { mapPlans, expiredEffects }
}

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
  const campaignClockRepository = dependencies.campaignClockRepository
    ?? createSqliteCampaignClockRepository(database)
  const breedingOperationRepository = dependencies.breedingOperationRepository
    ?? createSqliteBreedingOperationRepository(database)
  const campaignDayOperationRepository = dependencies.campaignDayOperationRepository
    ?? createSqliteCampaignDayOperationRepository(database)
  const now = dependencies.now ?? Date.now
  const timestamp = now()
  const clockSnapshot = campaignClockRepository.get()
  let command: CampaignDayOperationCommandV1
  try {
    command = input.command === undefined
      ? trustedDirectCampaignDayCommand(timestamp, clockSnapshot)
      : parseCampaignDayOperationCommandV1(input.command)
  }
  catch (error) {
    if (error instanceof CampaignDayContractError) {
      throw new AdvanceCampaignDayUseCaseError(400, error.message)
    }
    throw error
  }
  const existingOperation = campaignDayOperationRepository.get(command.operationId)
  if (existingOperation) {
    if (existingOperation.commandSha256 !== campaignDayOperationCommandSha256(command)) {
      throw new Error(`Campaign-day operation ${command.operationId} was retried with different command evidence.`)
    }
    return {
      ...projectCampaignNextDayResult(existingOperation.result, true),
      realtimeEvents: [],
      paths: [],
    }
  }
  if (clockSnapshot.campaignMinute > Number.MAX_SAFE_INTEGER - ITEM_CAMPAIGN_MINUTES_PER_DAY) {
    throw new Error('Campaign clock cannot advance another reviewed campaign day within the safe integer range.')
  }
  const targetCampaignMinute = clockSnapshot.campaignMinute + ITEM_CAMPAIGN_MINUTES_PER_DAY
  const targetClockRevision = nextRevision(clockSnapshot.revision)
  const eggPlans = planCampaignDayEggs({
    database,
    command,
    previousClock: clockSnapshot,
    targetClockRevision,
    targetCampaignMinute,
  })
  const eggSummary = summarizeCampaignDayEggPlans(eggPlans)
  const clockCommand = campaignDayClockCommand({
    operationId: command.operationId,
    expectedRevision: clockSnapshot.revision,
    targetCampaignMinute,
  })

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
    targetCampaignMinute,
    effectiveSoullessBySheet,
  )
  const reconciled = reconcileCampaignDayCapabilityHp({
    sheetPlans: initialSheetPlans,
    liveMaps,
    timestamp,
  })
  const sheetPlans = reconciled.sheetPlans
  const durationLifecycle = applyCampaignTimeLifecycle({
    liveMaps: maps,
    existingPlans: reconciled.mapPlans,
    command,
    previousCampaignMinute: clockSnapshot.campaignMinute,
    campaignMinute: targetCampaignMinute,
    clockRevision: targetClockRevision,
    timestamp,
  })
  const mapPlans = durationLifecycle.mapPlans
  const changedPlans = sheetPlans.filter(plan => plan.changed)
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
  const pokemonUpdated = changedPlans.filter(plan => plan.kind === 'pokemon').length
  const trainerUpdated = changedPlans.filter(plan => plan.kind === 'trainer').length
  const commandSha256 = campaignDayOperationCommandSha256(command)
  const acceptedOperation = parseCampaignDayOperationAcceptedV1({
    schemaVersion: 1,
    operationId: command.operationId,
    commandSha256,
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
    campaignClock: {
      previousRevision: clockSnapshot.revision,
      revision: targetClockRevision,
      previousCampaignMinute: clockSnapshot.campaignMinute,
      campaignMinute: targetCampaignMinute,
      minutesAdvanced: ITEM_CAMPAIGN_MINUTES_PER_DAY,
      clockOperationId: clockCommand.operationId,
      ...eggSummary,
    },
    expiredEffects: durationLifecycle.expiredEffects,
  })

  const transactionResult = database.withTransaction(() => {
    const currentClock = campaignClockRepository.get()
    if (currentClock.revision !== clockSnapshot.revision
      || currentClock.campaignMinute !== clockSnapshot.campaignMinute
      || currentClock.lastOperationId !== clockSnapshot.lastOperationId) {
      throw new Error('Campaign clock changed during campaign-day advancement.')
    }
    if (campaignDayOperationRepository.get(command.operationId)) {
      throw new Error(`Campaign-day operation ${command.operationId} settled concurrently; retry for its exact result.`)
    }
    input.assertPreflightCurrent?.()
    const clockReservation = breedingOperationRepository.reserve(clockCommand, clockSnapshot.campaignMinute)
    if (clockReservation.kind !== 'reserved') {
      throw new Error('Campaign-day clock compatibility operation was not newly reserved in the atomic commit.')
    }

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
    for (const stored of maps) {
      const current = mapRepository.getBySlug(stored.slug)
      if (!current || current.revision !== stored.revision) {
        throw new Error(`map ${stored.slug} changed during campaign-day advancement`)
      }
    }

    const advancedClock = campaignClockRepository.advance({
      expectedRevision: clockSnapshot.revision,
      targetCampaignMinute,
      operationId: clockCommand.operationId,
    })
    if (advancedClock.kind !== 'applied'
      || advancedClock.clock.revision !== targetClockRevision
      || advancedClock.clock.campaignMinute !== targetCampaignMinute) {
      throw new Error('Campaign-day clock advancement did not produce its exact planned successor.')
    }

    const eggRepository = createSqlitePokemonEggRepository(database)
    const eggEvidenceRepository = createSqliteBreedingOperationEvidenceRepository(database)
    const incubationSegmentRepository = createSqliteBreedingIncubationSegmentRepository(database)
    for (const plan of eggPlans) {
      const currentEgg = eggRepository.get(plan.egg.eggId)
      if (!currentEgg || !sameJsonValue(currentEgg, plan.egg)) {
        throw new Error(`Pokémon Egg ${plan.egg.eggId} changed during campaign-day advancement`)
      }
      const reservation = breedingOperationRepository.reserve(
        plan.command,
        targetCampaignMinute,
      )
      if (reservation.kind !== 'reserved') {
        throw new Error(`Campaign-day Egg operation ${plan.command.operationId} was not newly reserved.`)
      }
      eggEvidenceRepository.insert({
        command: plan.command,
        readSet: plan.readSet,
        authorizationReceipt: plan.receipt,
        gmOverrides: [plan.override],
      })
      const replacement = eggRepository.replace({
        expectedRevision: plan.egg.revision,
        document: plan.nextEgg,
      })
      if (replacement.kind !== 'applied') {
        throw new Error(`Pokémon Egg ${plan.egg.eggId} changed during campaign-day advancement`)
      }
      incubationSegmentRepository.insert({ command: plan.command, segment: plan.segment })
      const eggResult = createBreedingOperationAcceptedV1({
        operationId: plan.command.operationId,
        commandHash: createBreedingOperationCommandHash(plan.command),
        commandKind: 'advance-egg-incubation',
        outcomeKind: 'egg-progressed',
        aggregateRefs: [{
          kind: 'pokemon-egg',
          id: replacement.document.eggId,
          revision: replacement.document.revision,
        }],
        changedScopes: plan.command.scopes,
        committedAtCampaignMinute: targetCampaignMinute,
      })
      const eggSettlement = breedingOperationRepository.settle(
        plan.command,
        eggResult,
        targetCampaignMinute,
      )
      if (eggSettlement.kind !== 'settled' || eggSettlement.record.status !== 'accepted') {
        throw new Error(`Campaign-day Egg operation ${plan.command.operationId} did not settle exactly once.`)
      }
    }

    for (const plan of changedPlans) {
      const current = sheetRepository.getByRef(plan.kind, plan.slug)
      if (!current || current.revision !== plan.expectedRevision) {
        throw new Error(`${plan.kind} sheet ${plan.slug} changed during campaign-day advancement`)
      }
      const result = sheetRepository.applyLivePlayUpdate({
        kind: plan.kind,
        slug: plan.slug,
        expectedRevision: plan.expectedRevision,
        nextSheet: plan.nextSheet,
        sourceOperationId: command.operationId,
        allowMedicalTreatmentTransition: true,
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

    const clockResult = createBreedingOperationAcceptedV1({
      operationId: clockCommand.operationId,
      commandHash: createBreedingOperationCommandHash(clockCommand),
      commandKind: 'advance-campaign-clock',
      outcomeKind: 'clock-advanced',
      aggregateRefs: [{ kind: 'campaign-clock', id: 'campaign-clock', revision: targetClockRevision }],
      changedScopes: clockCommand.scopes,
      committedAtCampaignMinute: targetCampaignMinute,
    })
    const clockSettlement = breedingOperationRepository.settle(
      clockCommand,
      clockResult,
      targetCampaignMinute,
    )
    if (clockSettlement.kind !== 'settled' || clockSettlement.record.status !== 'accepted') {
      throw new Error('Campaign-day clock compatibility operation did not settle exactly once.')
    }
    campaignDayOperationRepository.insertAccepted({
      command,
      result: acceptedOperation,
      createdAt: timestamp,
    })

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
    for (const trainerSnapshot of trainerSheets) {
      const persisted = sheetRepository.getByRef('trainer', trainerSnapshot.slug)
      if (!persisted) throw new Error(`Trainer sheet ${trainerSnapshot.slug} not found after campaign-day advancement`)
      const clockRefresh = itemExplorationClockRealtimeAppendInput({
        trainerSlug: persisted.slug,
        state: (persisted.sheet as unknown as TrainerSheet).serverPrivate?.itemExploration,
        campaignClockRevision: targetClockRevision,
        campaignMinute: targetCampaignMinute,
        timestamp,
        ...(input.clientId ? { clientId: input.clientId } : {}),
      })
      if (clockRefresh) appendInputs.push(clockRefresh)
    }
    for (const plan of eggPlans) {
      const persisted = eggRepository.get(plan.egg.eggId)
      if (!persisted || persisted.revision !== plan.nextEgg.revision
        || persisted.incubation.lastAppliedClockRevision !== targetClockRevision
        || persisted.incubation.lastAppliedClockMinute !== targetCampaignMinute) {
        throw new Error(
          `Pokémon Egg ${plan.egg.eggId} authoritative re-read did not match the campaign-day clock checkpoint`,
        )
      }
      appendInputs.push(...breedingRealtimeRefreshAppendInputs({
        aggregateKind: 'pokemon-egg',
        aggregateId: persisted.eggId,
        revision: persisted.revision,
        operationKind: 'advance-egg-incubation',
        audienceTargets: [
          { audience: 'diagnostic', trainerSheetSlug: null },
          { audience: 'gm', trainerSheetSlug: null },
          { audience: 'owner', trainerSheetSlug: persisted.ownerTrainerSlug },
          { audience: 'public', trainerSheetSlug: null },
        ],
        campaignProjectionKey: securityPolicyJson.definitionSha256,
        timestamp,
      }))
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
    const realtimeEvents = appendInputs.length > 0
      ? realtimeEventRepository.appendMany(appendInputs)
      : [] as readonly PersistedRealtimeEvent[]
    return { paths, realtimeEvents }
  })

  publishPersistedRealtimeEventsAfterCommit({
    events: transactionResult.realtimeEvents,
    operation: 'campaign-next-day',
    publish: dependencies.publishPersistedRealtimeEvent ?? defaultPersistedRealtimeEventPublisher,
    reportFailure: dependencies.reportAfterCommitPublicationFailure ?? defaultPersistedRealtimePublicationFailureReporter,
  })

  return {
    ...projectCampaignNextDayResult(acceptedOperation, false),
    realtimeEvents: transactionResult.realtimeEvents,
    paths: transactionResult.paths,
  }
}

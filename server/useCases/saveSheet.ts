import { UseCaseHttpError } from '../utils/useCaseErrors'
import type { AuthRole } from '#shared/auth'
import type { PlayerProfile } from '#shared/playerProfiles'
import { MAP_INTERACTION_MODES, type MapInteractionMode } from '#shared/mapInteractionMode'
import { isRevision, nextRevision, normalizeRevision } from '#shared/sessionRevisions'
import {
  CapabilityCampaignStateValidationError,
  capabilityCampaignStateHasContent,
  createEmptyCapabilityCampaignState,
  juicerHeldItemIsLegacyShellMirror,
  materializeJuicerCampaignStateAtTime,
  parseCapabilityCampaignState,
  reconcileJuicerHeldItemCustody,
} from '#shared/capabilityAutomation/campaignState'
import type { PersistedRealtimeEvent } from '#shared/realtimeEventLog'
import type { SheetKind } from '#shared/sheets'
import type { TrainerSheet } from '~/types/trainerSheet'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import { pokemonHasResolvedCapability } from '~/utils/sheets/pokemonDerived'
import { deepCloneJson, sameJsonValue } from '~/utils/serialization'
import {
  playerProfileCanAccessSheet,
  type PlayerProfileLinkedTrainerSheet,
} from '../policies/playerProfilePolicy'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import {
  createSqliteSheetRepository,
  type PersistedSheet,
  type SheetRepository,
} from '../storage/sheetRepository'
import {
  createSqliteRealtimeEventRepository,
  type RealtimeEventRepository,
} from '../storage/realtimeEventRepository'
import { logicalSheetResourcePath } from '../utils/runtimeResourcePaths'
import { redactSheetRecordForPlayer } from '../utils/sheetPrivacy'
import { setupMapSaveRealtimeAppendInputs, setupSheetSaveRealtimeAppendInputs } from '../realtime/setupDocumentRealtime'
import { acquireServerRolledAbilityParameters } from '../domain/abilityAutomation/parameterAcquisition'
import {
  applyCapabilityEvolutionTransition,
  CapabilityEvolutionRuleError,
} from '../domain/capabilityAutomation/evolutionProviders'
import {
  preserveServerOwnedMarsupialPouchState,
  resolveMarsupialRelationship,
  withoutMarsupialPouchState,
  withoutMarsupialTransientMapState,
  type MarsupialRelationshipResolution,
  type ValidMarsupialRelationship,
} from '../domain/capabilityAutomation/marsupialRelationship'
import { createSqliteMapRepository, type MapRepository } from '../storage/mapRepository'
import {
  createSqliteMapInteractionModeRepository,
  type MapInteractionModeRepository,
} from '../storage/mapInteractionModeRepository'
import { listRepositorySheets } from './listSheets'
import { applyHpToSheet } from '~/utils/sheetMutations'
import { preservePlayerHiddenAutomationFieldsForSave } from '~/utils/sheets/pokemonGmFields'
import {
  defaultPersistedSetupSaveRealtimeEventPublisher,
  defaultSetupSaveRealtimePublicationFailureReporter,
  publishPersistedSetupSaveRealtimeEventsAfterCommit,
  type PersistedSetupSaveRealtimeEventPublisher,
  type SetupSaveRealtimePublicationFailureReporter,
} from '../realtime/persistedRealtimePublication'

export class SaveSheetUseCaseError extends UseCaseHttpError<400 | 403 | 404 | 409> {}

export interface SaveSheetInput {
  role: AuthRole
  kind: SheetKind
  slug: string
  sheet: Record<string, unknown>
  expectedRevision?: number
  clientId?: string
  playerProfile?: PlayerProfile | null
  interactionMode: MapInteractionMode
  allowSlugSync?: boolean
}

type SaveSheetRepository = Pick<SheetRepository<Record<string, unknown>>, 'getByRef' | 'list' | 'replaceSetupSheet' | 'applyLivePlayUpdate'> & {
  readonly database?: RotomDatabase
}

type SaveSheetRealtimeEventRepository = Pick<RealtimeEventRepository, 'appendMany'> & {
  readonly database?: RotomDatabase
}

export interface SaveSheetDependencies {
  database?: RotomDatabase
  sheetRepository?: SaveSheetRepository
  mapRepository?: Pick<MapRepository<TabletopMap>, 'list' | 'getBySlug' | 'applyLivePlayUpdate'> & { readonly database?: RotomDatabase }
  modeRepository?: Pick<MapInteractionModeRepository, 'get'> & { readonly database?: RotomDatabase }
  realtimeEventRepository?: SaveSheetRealtimeEventRepository
  publishPersistedRealtimeEvent?: PersistedSetupSaveRealtimeEventPublisher
  reportAfterCommitPublicationFailure?: SetupSaveRealtimePublicationFailureReporter
  isPlayerAccessible?: (kind: SheetKind, slug: string) => boolean
  listTrainerSheets?: () => Iterable<PlayerProfileLinkedTrainerSheet>
  now?: () => number
  randomInt?: (maximumExclusive: number) => number
}

export interface SaveSheetResult {
  ok: true
  slug: string
  path: string
  sheet: Record<string, unknown>
  realtimeEvents: readonly PersistedRealtimeEvent[]
}

const persistedToTrainerSheet = (sheet: PersistedSheet): TrainerSheet => sheet.sheet as unknown as TrainerSheet

const databaseFromDependencies = (dependencies: SaveSheetDependencies): RotomDatabase => {
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
    throw new Error('Sheet setup save sheet repository must use the same RotomDatabase as the save transaction')
  }
  if (mapDatabase && mapDatabase !== database) {
    throw new Error('Sheet setup save map repository must use the same RotomDatabase as the save transaction')
  }
  if (modeDatabase && modeDatabase !== database) {
    throw new Error('Sheet setup save mode repository must use the same RotomDatabase as the save transaction')
  }
  if (realtimeDatabase && realtimeDatabase !== database) {
    throw new Error('Sheet setup save realtime event repository must use the same RotomDatabase as the save transaction')
  }
  return database
}

const replaceSheetOrThrow = (
  sheetRepository: SaveSheetRepository,
  input: SaveSheetInput,
  timestamp: number,
) => {
  try {
    return sheetRepository.replaceSetupSheet({
      kind: input.kind,
      slug: input.slug,
      expectedRevision: input.expectedRevision as number,
      sheet: input.sheet,
      now: timestamp,
      preservePlayerFlag: input.role === 'player',
      preservePokemonGmFields: input.role === 'player' && input.kind === 'pokemon',
    })
  } catch (err) {
    const message = (err as Error).message
    if (message.includes('stale') || message.includes('expected revision')) {
      throw new SaveSheetUseCaseError(409, message)
    }
    throw new SaveSheetUseCaseError(400, message)
  }
}

const readAuthoritativeSheetOrThrow = (
  sheetRepository: SaveSheetRepository,
  kind: SheetKind,
  slug: string,
  expected: Pick<PersistedSheet, 'revision' | 'updatedAt'>,
): PersistedSheet => {
  const stored = sheetRepository.getByRef(kind, slug)
  if (!stored) throw new SaveSheetUseCaseError(404, `Sheet ${slug}.json not found`)
  if (stored.revision !== expected.revision || stored.updatedAt !== expected.updatedAt) {
    throw new Error(
      `${kind} sheet ${slug} authoritative re-read did not match saved revision ${expected.revision} and timestamp ${expected.updatedAt}`,
    )
  }
  return stored
}

interface PlannedMarsupialMapCleanup {
  readonly previous: TabletopMap
  readonly next: TabletopMap
}

interface PlannedMarsupialLifecycleExit {
  readonly relationship: ValidMarsupialRelationship
  readonly counterpart: PersistedSheet
  readonly nextCounterpart: CharacterSheet
  readonly mapCleanups: readonly PlannedMarsupialMapCleanup[]
}

const resolveCurrentMarsupialRelationship = (
  sheetRepository: SaveSheetRepository,
  subjectSlug: string,
): MarsupialRelationshipResolution => {
  const sheets = listRepositorySheets<CharacterSheet>(sheetRepository, 'pokemon')
  return resolveMarsupialRelationship({
    subjectSlug,
    pokemonBySlug: new Map(sheets.map(sheet => [sheet.slug, sheet])),
  })
}

const planMarsupialMapCleanups = (
  mapRepository: Pick<MapRepository<TabletopMap>, 'list' | 'getBySlug'>,
  relationship: ValidMarsupialRelationship,
  timestamp: number,
): readonly PlannedMarsupialMapCleanup[] => mapRepository.list().flatMap((stored) => {
  const previous = mapRepository.getBySlug(stored.slug)
  if (!previous) return []
  const reconciled = withoutMarsupialTransientMapState(previous, relationship)
  if (sameJsonValue(previous, reconciled)) return []
  return [{
    previous,
    next: {
      ...reconciled,
      revision: nextRevision(normalizeRevision(previous.revision)),
      updatedAt: timestamp,
    },
  }]
})

export const saveSheetUseCase = (
  input: SaveSheetInput,
  dependencies: SaveSheetDependencies = {},
): SaveSheetResult => {
  if (input.interactionMode !== MAP_INTERACTION_MODES.SETUP_EDIT) {
    throw new SaveSheetUseCaseError(403, 'Whole-sheet saves are setup/edit-only; live play must use sheet command routes')
  }

  if (!isRevision(input.expectedRevision)) {
    throw new SaveSheetUseCaseError(400, 'expectedRevision must be a safe non-negative integer')
  }

  const database = databaseFromDependencies(dependencies)
  const sheetRepository = dependencies.sheetRepository ?? createSqliteSheetRepository<Record<string, unknown>>(database)
  const mapRepository = dependencies.mapRepository ?? createSqliteMapRepository<TabletopMap>(database)
  const modeRepository = dependencies.modeRepository ?? createSqliteMapInteractionModeRepository(database)
  const realtimeEventRepository = dependencies.realtimeEventRepository
    ?? createSqliteRealtimeEventRepository({ database })
  const now = dependencies.now ?? Date.now

  const payloadSlug = String(input.sheet.slug ?? '')
  if (payloadSlug !== input.slug) {
    throw new SaveSheetUseCaseError(
      400,
      `sheet.slug "${payloadSlug}" must match request slug "${input.slug}"`,
    )
  }

  const current = sheetRepository.getByRef(input.kind, input.slug)
  if (!current) throw new SaveSheetUseCaseError(404, `Sheet ${input.slug}.json not found`)
  const isPlayerAccessible = dependencies.isPlayerAccessible
    ?? ((kind: SheetKind, slug: string) => sheetRepository.getByRef(kind, slug)?.sheet.player === true)
  const listTrainerSheets = dependencies.listTrainerSheets
    ?? (() => sheetRepository.list('trainer').map((stored) => persistedToTrainerSheet({
      kind: 'trainer',
      slug: stored.slug,
      sheet: {
        ...(stored.document as Record<string, unknown>),
        slug: stored.slug,
        revision: stored.revision,
      },
      revision: stored.revision,
      updatedAt: stored.updatedAt,
    })))

  const playerPublicAccess = input.role === 'player'
    ? isPlayerAccessible(input.kind, input.slug)
    : false
  const playerLinkedProfileAccess = input.role === 'player'
    ? playerProfileCanAccessSheet(input.playerProfile, input.kind, input.slug, {
        linkedTrainerSheets: input.kind === 'pokemon' ? listTrainerSheets : undefined,
      })
    : false

  if (input.role === 'player' && !playerPublicAccess && !playerLinkedProfileAccess) {
    throw new SaveSheetUseCaseError(
      403,
      'Sheet is not marked as player accessible or linked to the selected player profile',
    )
  }

  // Player sheet documents omit private automation ledgers. Restore those
  // authoritative inputs before any server-owned lifecycle calculation so a
  // forged value cannot influence it, while allowing that calculation to emit
  // a legitimate replacement state later in this transaction.
  const playerAuthorityPreservedSheet = input.role === 'player'
    ? preservePlayerHiddenAutomationFieldsForSave(input.sheet, current.sheet)
    : input.sheet

  let currentMarsupialRelationship: MarsupialRelationshipResolution | undefined
  let capabilityAdjustedSheet = playerAuthorityPreservedSheet
  if (input.kind === 'pokemon') {
    try {
      currentMarsupialRelationship = resolveCurrentMarsupialRelationship(sheetRepository, input.slug)
      if (currentMarsupialRelationship.status === 'corrupt') {
        throw new CapabilityEvolutionRuleError(
          currentMarsupialRelationship.reasonCode,
          currentMarsupialRelationship.message,
        )
      }
      const serverOwnedStatePreserved = preserveServerOwnedMarsupialPouchState(
        current.sheet as unknown as CharacterSheet,
        playerAuthorityPreservedSheet as unknown as CharacterSheet,
      )
      capabilityAdjustedSheet = applyCapabilityEvolutionTransition(
        current.sheet as unknown as CharacterSheet,
        serverOwnedStatePreserved,
        { marsupialRelationship: currentMarsupialRelationship },
      ).sheet as unknown as Record<string, unknown>
    }
    catch (error) {
      if (error instanceof CapabilityEvolutionRuleError) throw new SaveSheetUseCaseError(409, error.message)
      if (error instanceof CapabilityCampaignStateValidationError) throw new SaveSheetUseCaseError(400, error.message)
      throw error
    }
  }
  const timestamp = now()
  let authoritativeSheet = acquireServerRolledAbilityParameters({
    kind: input.kind, slug: input.slug, currentRevision: current.revision,
    currentSheet: current.sheet,
    requestedSheet: capabilityAdjustedSheet,
    ...(dependencies.randomInt ? { randomInt: dependencies.randomInt } : {}),
  })
  if (input.kind === 'pokemon') {
    try {
      const previous = current.sheet as unknown as CharacterSheet
      const candidate = authoritativeSheet as unknown as CharacterSheet
      const previousState = parseCapabilityCampaignState(previous.capabilityCampaignState)
      const requestedState = parseCapabilityCampaignState(
        Object.hasOwn(authoritativeSheet, 'capabilityCampaignState')
          ? candidate.capabilityCampaignState
          : previous.capabilityCampaignState,
      )
      const previousMaterialized = materializeJuicerCampaignStateAtTime({
        value: previousState,
        heldItemName: previous.items?.held,
        now: timestamp,
      })
      let heldItemName = candidate.items?.held ?? ''
      if (previousMaterialized.transitionedFromHeldBerry
        && heldItemName.trim().toLocaleLowerCase('en-US') === (previous.items?.held ?? '').trim().toLocaleLowerCase('en-US')) {
        heldItemName = previousMaterialized.heldItemName
      }
      const reconciled = reconcileJuicerHeldItemCustody({
        value: { ...requestedState, storedItems: previousMaterialized.state.storedItems },
        sheetSlug: input.slug,
        heldItemName,
        hasJuicer: candidate.species.trim().toLocaleLowerCase('en-US') === 'shuckle'
          && pokemonHasResolvedCapability(candidate, 'Juicer'),
        now: timestamp,
        sourceOperationId: `sheet-setup:${input.slug}:revision:${nextRevision(current.revision)}`,
      })
      const materialized = materializeJuicerCampaignStateAtTime({
        value: reconciled,
        heldItemName,
        now: timestamp,
      })
      authoritativeSheet = { ...authoritativeSheet }
      const legacyShellMirror = juicerHeldItemIsLegacyShellMirror(materialized.state, candidate.items?.held)
      if (materialized.heldItemName !== (candidate.items?.held ?? '') || legacyShellMirror) {
        authoritativeSheet.items = {
          ...(candidate.items ?? {}),
          held: legacyShellMirror ? '' : materialized.heldItemName,
        }
      }
      if (capabilityCampaignStateHasContent(materialized.state)) authoritativeSheet.capabilityCampaignState = materialized.state
      else delete authoritativeSheet.capabilityCampaignState
    }
    catch (error) {
      if (error instanceof CapabilityCampaignStateValidationError) {
        throw new SaveSheetUseCaseError(400, error.message)
      }
      throw error
    }
  }

  if (input.kind === 'pokemon') {
    const pokemon = authoritativeSheet as unknown as CharacterSheet
    if (pokemonHasResolvedCapability(pokemon, 'Soulless')) {
      authoritativeSheet = applyHpToSheet(
        'pokemon',
        pokemon,
        1,
        0,
        { effectiveSoulless: true },
      ) as unknown as Record<string, unknown>
    }
  }

  let marsupialLifecycleExit: PlannedMarsupialLifecycleExit | null = null
  if (input.kind === 'pokemon' && currentMarsupialRelationship) {
    const candidate = { ...authoritativeSheet, slug: input.slug } as unknown as CharacterSheet
    const relationshipExited = currentMarsupialRelationship.status === 'valid'
      && currentMarsupialRelationship.subjectRole === 'baby'
      && (current.sheet as unknown as CharacterSheet).babyTemplate === true
      && candidate.babyTemplate === false
    if (relationshipExited && currentMarsupialRelationship.status === 'valid') {
      const counterpartSlug = currentMarsupialRelationship.pouch.motherSheetSlug
      const counterpart = sheetRepository.getByRef('pokemon', counterpartSlug)
      if (!counterpart) throw new SaveSheetUseCaseError(409, 'The Marsupial mother disappeared before lifecycle cleanup')
      const clearedCandidate = withoutMarsupialPouchState(candidate)
      authoritativeSheet = clearedCandidate as unknown as Record<string, unknown>
      marsupialLifecycleExit = {
        relationship: currentMarsupialRelationship,
        counterpart,
        nextCounterpart: withoutMarsupialPouchState(counterpart.sheet as unknown as CharacterSheet),
        mapCleanups: planMarsupialMapCleanups(mapRepository, currentMarsupialRelationship, timestamp),
      }
    }
    else {
      const prospectiveSheets = listRepositorySheets<CharacterSheet>(sheetRepository, 'pokemon')
      const prospectiveBySlug = new Map(prospectiveSheets.map(sheet => [sheet.slug, sheet]))
      prospectiveBySlug.set(input.slug, candidate)
      const prospective = resolveMarsupialRelationship({ subjectSlug: input.slug, pokemonBySlug: prospectiveBySlug })
      if (prospective.status === 'corrupt') throw new SaveSheetUseCaseError(409, prospective.message)
      if (currentMarsupialRelationship.status === 'valid' && prospective.status !== 'valid') {
        throw new SaveSheetUseCaseError(409, 'A setup save cannot erase one side of an authoritative Marsupial relationship')
      }
      if (currentMarsupialRelationship.status === 'absent' && prospective.status !== 'absent') {
        throw new SaveSheetUseCaseError(409, 'A setup save cannot forge an authoritative Marsupial relationship')
      }
    }
  }
  const authoritativeInput: SaveSheetInput = { ...input, sheet: authoritativeSheet }

  const transactionResult = database.withTransaction(() => {
    for (const stored of mapRepository.list()) {
      const map = mapRepository.getBySlug(stored.slug)
      if (!map || !map.placements.some(placement => (
        placement.sheetKind === input.kind && placement.sheetSlug === input.slug
      ))) continue
      if (modeRepository.get(map.slug).interactionMode === MAP_INTERACTION_MODES.LIVE_PLAY) {
        throw new SaveSheetUseCaseError(
          409,
          'Whole-sheet save rejected because the sheet is present on a live map; use an authoritative map-scoped command',
        )
      }
    }

    const saved = replaceSheetOrThrow(sheetRepository, authoritativeInput, timestamp)
    if (!saved) throw new SaveSheetUseCaseError(404, `Sheet ${input.slug}.json not found`)

    const authoritativeSheet = readAuthoritativeSheetOrThrow(sheetRepository, input.kind, input.slug, saved.sheet)
    const additionalEventInputs: Array<ReturnType<typeof setupSheetSaveRealtimeAppendInputs>[number]> = []
    if (marsupialLifecycleExit) {
      const counterpartResult = sheetRepository.applyLivePlayUpdate({
        kind: 'pokemon',
        slug: marsupialLifecycleExit.counterpart.slug,
        expectedRevision: marsupialLifecycleExit.counterpart.revision,
        nextSheet: {
          ...marsupialLifecycleExit.nextCounterpart as unknown as Record<string, unknown>,
          ...(marsupialLifecycleExit.nextCounterpart.capabilityCampaignState === undefined
            ? { capabilityCampaignState: createEmptyCapabilityCampaignState() } : {}),
          updatedAt: timestamp,
        },
      })
      if (counterpartResult === 'stale') {
        throw new SaveSheetUseCaseError(409, 'The Marsupial counterpart changed before lifecycle cleanup could commit')
      }
      const storedCounterpart = sheetRepository.getByRef('pokemon', marsupialLifecycleExit.counterpart.slug)
      if (!storedCounterpart) throw new SaveSheetUseCaseError(409, 'The Marsupial counterpart disappeared during lifecycle cleanup')
      additionalEventInputs.push(...setupSheetSaveRealtimeAppendInputs({
        kind: 'pokemon',
        slug: storedCounterpart.slug,
        sheet: storedCounterpart.sheet,
        clientId: input.clientId,
      }))

      for (const cleanup of marsupialLifecycleExit.mapCleanups) {
        const result = mapRepository.applyLivePlayUpdate({
          slug: cleanup.previous.slug,
          expectedRevision: normalizeRevision(cleanup.previous.revision),
          nextMap: cleanup.next,
        })
        if (result === 'stale') {
          throw new SaveSheetUseCaseError(409, `Map ${cleanup.previous.slug} changed before Marsupial lifecycle cleanup could commit`)
        }
        const storedMap = mapRepository.getBySlug(cleanup.previous.slug)
        if (!storedMap) throw new SaveSheetUseCaseError(409, `Map ${cleanup.previous.slug} disappeared during Marsupial lifecycle cleanup`)
        additionalEventInputs.push(...setupMapSaveRealtimeAppendInputs(deepCloneJson(storedMap), input.clientId))
      }
    }
    const eventInputs = [
      ...(saved.changed ? setupSheetSaveRealtimeAppendInputs({
        kind: input.kind,
        slug: authoritativeSheet.slug,
        sheet: authoritativeSheet.sheet,
        clientId: input.clientId,
      }) : []),
      ...additionalEventInputs,
    ]
    const realtimeEvents = eventInputs.length ? realtimeEventRepository.appendMany(eventInputs) : []

    return {
      slug: authoritativeSheet.slug,
      path: saved.path || logicalSheetResourcePath(input.kind, authoritativeSheet.sheet),
      sheet: authoritativeSheet.sheet,
      realtimeEvents,
    }
  })

  publishPersistedSetupSaveRealtimeEventsAfterCommit({
    events: transactionResult.realtimeEvents,
    resource: { kind: 'sheet', sheetKind: input.kind, sheetSlug: transactionResult.slug },
    publish: dependencies.publishPersistedRealtimeEvent ?? defaultPersistedSetupSaveRealtimeEventPublisher,
    reportFailure: dependencies.reportAfterCommitPublicationFailure ?? defaultSetupSaveRealtimePublicationFailureReporter,
  })

  return {
    ok: true,
    slug: transactionResult.slug,
    path: transactionResult.path,
    sheet: input.role === 'player'
      ? redactSheetRecordForPlayer(input.kind, transactionResult.sheet)
      : transactionResult.sheet,
    realtimeEvents: transactionResult.realtimeEvents,
  }
}

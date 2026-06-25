import { UseCaseHttpError } from '../utils/useCaseErrors'
import type { AuthRole } from '#shared/auth'
import type { PlayerProfile } from '#shared/playerProfiles'
import { MAP_INTERACTION_MODES, type MapInteractionMode } from '#shared/mapInteractionMode'
import { isRevision } from '#shared/sessionRevisions'
import type { PersistedRealtimeEvent } from '#shared/realtimeEventLog'
import type { SheetKind } from '#shared/sheets'
import type { TrainerSheet } from '~/types/trainerSheet'
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
import { setupSheetSaveRealtimeAppendInputs } from '../realtime/setupDocumentRealtime'
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

type SaveSheetRepository = Pick<SheetRepository<Record<string, unknown>>, 'getByRef' | 'list' | 'replaceSetupSheet'> & {
  readonly database?: RotomDatabase
}

type SaveSheetRealtimeEventRepository = Pick<RealtimeEventRepository, 'appendMany'> & {
  readonly database?: RotomDatabase
}

export interface SaveSheetDependencies {
  database?: RotomDatabase
  sheetRepository?: SaveSheetRepository
  realtimeEventRepository?: SaveSheetRealtimeEventRepository
  publishPersistedRealtimeEvent?: PersistedSetupSaveRealtimeEventPublisher
  reportAfterCommitPublicationFailure?: SetupSaveRealtimePublicationFailureReporter
  isPlayerAccessible?: (kind: SheetKind, slug: string) => boolean
  listTrainerSheets?: () => Iterable<PlayerProfileLinkedTrainerSheet>
  now?: () => number
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
  const realtimeDatabase = dependencies.realtimeEventRepository?.database
  const database = dependencies.database ?? sheetDatabase ?? realtimeDatabase ?? getRotomDatabase()

  if (sheetDatabase && sheetDatabase !== database) {
    throw new Error('Sheet setup save sheet repository must use the same RotomDatabase as the save transaction')
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

  const transactionResult = database.withTransaction(() => {
    const saved = replaceSheetOrThrow(sheetRepository, input, now())
    if (!saved) throw new SaveSheetUseCaseError(404, `Sheet ${input.slug}.json not found`)

    const authoritativeSheet = readAuthoritativeSheetOrThrow(sheetRepository, input.kind, input.slug, saved.sheet)
    const realtimeEvents = saved.changed
      ? realtimeEventRepository.appendMany(setupSheetSaveRealtimeAppendInputs({
          kind: input.kind,
          slug: authoritativeSheet.slug,
          sheet: authoritativeSheet.sheet,
          clientId: input.clientId,
        }))
      : []

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
    sheet: transactionResult.sheet,
    realtimeEvents: transactionResult.realtimeEvents,
  }
}

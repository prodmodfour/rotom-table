import { UseCaseHttpError } from '../utils/useCaseErrors'
import type { AuthRole } from '#shared/auth'
import type { PlayerProfile } from '#shared/playerProfiles'
import { MAP_INTERACTION_MODES, type MapInteractionMode } from '#shared/mapInteractionMode'
import { sheetChannel, sheetsChannel, type RealtimeEvent } from '#shared/realtime'
import { isRevision } from '#shared/sessionRevisions'
import type { SheetKind } from '#shared/sheets'
import type { TrainerSheet } from '~/types/trainerSheet'
import {
  playerProfileCanAccessSheet,
  type PlayerProfileLinkedTrainerSheet,
} from '../policies/playerProfilePolicy'
import {
  sqliteSheetRepository,
  type PersistedSheet,
  type SheetRepository,
} from '../storage/sheetRepository'
import { logicalSheetResourcePath } from '../utils/runtimeResourcePaths'

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

export interface SaveSheetDependencies {
  sheetRepository?: Pick<SheetRepository<Record<string, unknown>>, 'getByRef' | 'list' | 'replaceSetupSheet'>
  isPlayerAccessible?: (kind: SheetKind, slug: string) => boolean
  listTrainerSheets?: () => Iterable<PlayerProfileLinkedTrainerSheet>
  now?: () => number
}

export interface SaveSheetResult {
  ok: true
  slug: string
  path: string
  sheet: Record<string, unknown>
  events: Array<Omit<RealtimeEvent, 'timestamp'>>
}

const persistedToTrainerSheet = (sheet: PersistedSheet): TrainerSheet => sheet.sheet as unknown as TrainerSheet

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

  const sheetRepository = dependencies.sheetRepository ?? sqliteSheetRepository
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

  let saved
  try {
    saved = sheetRepository.replaceSetupSheet({
      kind: input.kind,
      slug: input.slug,
      expectedRevision: input.expectedRevision,
      sheet: input.sheet,
      now: now(),
      preservePlayerFlag: input.role === 'player',
    })
  } catch (err) {
    const message = (err as Error).message
    if (message.includes('stale') || message.includes('expected revision')) {
      throw new SaveSheetUseCaseError(409, message)
    }
    throw new SaveSheetUseCaseError(400, message)
  }

  if (!saved) throw new SaveSheetUseCaseError(404, `Sheet ${input.slug}.json not found`)

  const sheet = saved.sheet.sheet
  const data = { kind: input.kind, slug: saved.sheet.slug, sheet }
  const events: Array<Omit<RealtimeEvent, 'timestamp'>> = saved.changed
    ? [
        { channel: sheetChannel(input.kind, saved.sheet.slug), type: 'updated', clientId: input.clientId, data },
        { channel: sheetsChannel, type: 'updated', clientId: input.clientId, data },
      ]
    : []

  return {
    ok: true,
    slug: saved.sheet.slug,
    path: saved.path || logicalSheetResourcePath(input.kind, sheet),
    sheet,
    events,
  }
}

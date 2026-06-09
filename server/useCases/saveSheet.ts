import { existsSync, renameSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { UseCaseHttpError } from '../utils/useCaseErrors'
import type { AuthRole } from '#shared/auth'
import type { PlayerProfile } from '#shared/playerProfiles'
import { sheetChannel, sheetsChannel, type RealtimeEvent } from '#shared/realtime'
import type { SheetKind } from '#shared/sheets'
import type { TrainerSheet } from '~/types/trainerSheet'
import {
  playerProfileCanAccessSheet,
  type PlayerProfileLinkedTrainerSheet,
} from '../policies/playerProfilePolicy'
import { campaignPathLabel } from '../utils/campaignPaths'
import {
  allocateSheetSlug,
  findPersistedSheetFile,
  listSheetFilesWithFolders,
  sheetIsPlayerAccessible,
  sheetNameFieldForKind,
  sheetNameSlug,
  stripDerivedSheetFields,
  writeSheetFile,
  type AllocateSheetSlugOptions,
} from '../utils/sheetStorage'
import {
  retargetMapSheetPlacements,
  type RetargetMapSheetPlacementsResult,
} from '../utils/mapStorage'
import { mapRetargetRealtimeEvents } from '../utils/mapRetargetRealtime'
import { tryReadJsonFile } from '../utils/jsonFiles'

export class SaveSheetUseCaseError extends UseCaseHttpError<400 | 403 | 404 | 409> {}

export interface SaveSheetInput {
  role: AuthRole
  kind: SheetKind
  slug: string
  sheet: Record<string, unknown>
  clientId?: string
  playerProfile?: PlayerProfile | null
  /**
   * When false, persist the supplied sheet under the current resource slug even
   * if its display name would normally derive a different slug. Map token
   * combat updates use this so HP/condition saves cannot orphan placements.
   */
  allowSlugSync?: boolean
}

export interface SaveSheetDependencies {
  findSheetPath?: (kind: SheetKind, slug: string) => string | null
  findSlugPath?: (kind: SheetKind, slug: string) => string | null
  isPlayerAccessible?: (kind: SheetKind, slug: string) => boolean
  stripDerivedFields?: (sheet: Record<string, unknown>) => Record<string, unknown>
  readExistingSheet?: (path: string) => Record<string, unknown>
  listTrainerSheets?: () => Iterable<PlayerProfileLinkedTrainerSheet>
  writeSheet?: (path: string, sheet: Record<string, unknown>) => void
  retargetMapSheetPlacements?: (
    kind: SheetKind,
    oldSlug: string,
    newSlug: string,
  ) => RetargetMapSheetPlacementsResult[]
  pathExists?: (path: string) => boolean
  renameSheetPath?: (from: string, to: string) => void
  allocateSlug?: (kind: SheetKind, base: string, options?: AllocateSheetSlugOptions) => string
  relativePath?: (path: string) => string
}

export interface SaveSheetResult {
  ok: true
  slug: string
  path: string
  sheet: Record<string, unknown>
  events: Array<Omit<RealtimeEvent, 'timestamp'>>
}

interface SheetSaveTarget {
  slug: string
  path: string
}

const CLIENT_ONLY_SHEET_ACCESS_FIELDS = ['sessionPlayerAccessible', 'playerProfileAccessible'] as const

const trimmedString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

const stripClientOnlySheetAccessFields = (sheet: Record<string, unknown>): Record<string, unknown> => {
  const payload = { ...sheet }
  for (const field of CLIENT_ONLY_SHEET_ACCESS_FIELDS) delete payload[field]
  return payload
}

const resolveSheetSaveTarget = (
  input: Pick<SaveSheetInput, 'kind' | 'slug' | 'sheet'>,
  currentPath: string,
  dependencies: Required<Pick<SaveSheetDependencies,
    'findSlugPath' | 'pathExists' | 'renameSheetPath' | 'allocateSlug'
  >>,
): SheetSaveTarget => {
  const nameField = sheetNameFieldForKind(input.kind)
  const nextName = trimmedString(input.sheet[nameField])
  if (!nextName) return { slug: input.slug, path: currentPath }

  const desiredSlug = sheetNameSlug(nextName)
  if (!desiredSlug || desiredSlug === input.slug) return { slug: input.slug, path: currentPath }

  const existing = dependencies.findSlugPath(input.kind, desiredSlug)
  const newSlug = existing && existing !== currentPath
    ? dependencies.allocateSlug(input.kind, nextName, { excludePath: currentPath })
    : desiredSlug
  const newPath = join(dirname(currentPath), `${newSlug}.json`)
  if (newPath === currentPath) return { slug: newSlug, path: currentPath }

  if (dependencies.pathExists(newPath)) {
    throw new SaveSheetUseCaseError(409, `Sheet ${newSlug}.json already exists`)
  }
  dependencies.renameSheetPath(currentPath, newPath)
  return { slug: newSlug, path: newPath }
}

export const saveSheetUseCase = (
  input: SaveSheetInput,
  dependencies: SaveSheetDependencies = {},
): SaveSheetResult => {
  const findSheetPath = dependencies.findSheetPath ?? findPersistedSheetFile
  const findSlugPath = dependencies.findSlugPath ?? findPersistedSheetFile
  const isPlayerAccessible = dependencies.isPlayerAccessible ?? sheetIsPlayerAccessible
  const stripDerivedFields = dependencies.stripDerivedFields ?? stripDerivedSheetFields
  const readExistingSheet = dependencies.readExistingSheet ?? ((path: string) => tryReadJsonFile<Record<string, unknown>>(path) ?? {})
  const listTrainerSheets = dependencies.listTrainerSheets
    ?? (() => listSheetFilesWithFolders<TrainerSheet>('trainer'))
  const writeSheet = dependencies.writeSheet ?? writeSheetFile
  const retargetMapPlacements = dependencies.retargetMapSheetPlacements ?? retargetMapSheetPlacements
  const pathExists = dependencies.pathExists ?? existsSync
  const renameSheetPath = dependencies.renameSheetPath ?? renameSync
  const allocateSlug = dependencies.allocateSlug ?? allocateSheetSlug
  const relativePath = dependencies.relativePath ?? campaignPathLabel

  const payloadSlug = String(input.sheet.slug ?? '')
  if (payloadSlug !== input.slug) {
    throw new SaveSheetUseCaseError(
      400,
      `sheet.slug "${payloadSlug}" must match request slug "${input.slug}"`,
    )
  }

  const path = findSheetPath(input.kind, input.slug)
  if (!path) throw new SaveSheetUseCaseError(404, `Sheet ${input.slug}.json not found`)

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

  const existingSheet = readExistingSheet(path)
  const canRenameSheetResource = (input.role === 'gm' || playerPublicAccess) && input.allowSlugSync !== false
  const target = canRenameSheetResource
    ? resolveSheetSaveTarget(input, path, {
        findSlugPath,
        pathExists,
        renameSheetPath,
        allocateSlug,
      })
    : { slug: input.slug, path }

  const sheet = stripClientOnlySheetAccessFields(stripDerivedFields(input.sheet))
  if (!Object.prototype.hasOwnProperty.call(input.sheet, 'moveUsage') && existingSheet.moveUsage !== undefined) {
    sheet.moveUsage = existingSheet.moveUsage
  }
  sheet.slug = target.slug
  if (input.role === 'player') sheet.player = playerPublicAccess || existingSheet.player === true
  writeSheet(target.path, sheet)
  const mapUpdates = target.slug !== input.slug
    ? retargetMapPlacements(input.kind, input.slug, target.slug)
    : []

  const data = { kind: input.kind, slug: target.slug, sheet }
  const renameData = { kind: input.kind, slug: target.slug, oldSlug: input.slug, newSlug: target.slug, sheet }
  const clientId = input.clientId
  const events: Array<Omit<RealtimeEvent, 'timestamp'>> = [
    ...(target.slug !== input.slug
      ? [
          { channel: sheetChannel(input.kind, input.slug), type: 'renamed', clientId, data: renameData },
          { channel: sheetChannel(input.kind, target.slug), type: 'updated', clientId, data },
          { channel: sheetsChannel, type: 'renamed', clientId, data: renameData },
        ]
      : [
          { channel: sheetChannel(input.kind, input.slug), type: 'updated', clientId, data },
          { channel: sheetsChannel, type: 'updated', clientId, data },
        ]),
    ...mapRetargetRealtimeEvents(mapUpdates, clientId),
  ]

  return {
    ok: true,
    slug: target.slug,
    path: relativePath(target.path),
    sheet,
    events,
  }
}

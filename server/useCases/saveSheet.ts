import { existsSync, renameSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { UseCaseHttpError } from '../utils/useCaseErrors'
import type { AuthRole } from '#shared/auth'
import { sheetChannel, sheetsChannel, type RealtimeEvent } from '#shared/realtime'
import type { SheetKind } from '#shared/sheets'
import { relativeToProjectRoot } from '../utils/fsPaths'
import {
  allocateSheetSlug,
  findPersistedSheetFile,
  sheetIsPlayerAccessible,
  sheetNameFieldForKind,
  sheetNameSlug,
  stripDerivedSheetFields,
  writeSheetFile,
  type AllocateSheetSlugOptions,
} from '../utils/sheetStorage'

export class SaveSheetUseCaseError extends UseCaseHttpError<400 | 403 | 404 | 409> {}

export interface SaveSheetInput {
  role: AuthRole
  kind: SheetKind
  slug: string
  sheet: Record<string, unknown>
  clientId?: string
}

export interface SaveSheetDependencies {
  findSheetPath?: (kind: SheetKind, slug: string) => string | null
  findSlugPath?: (kind: SheetKind, slug: string) => string | null
  isPlayerAccessible?: (kind: SheetKind, slug: string) => boolean
  stripDerivedFields?: (sheet: Record<string, unknown>) => Record<string, unknown>
  writeSheet?: (path: string, sheet: Record<string, unknown>) => void
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

const trimmedString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

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
  const writeSheet = dependencies.writeSheet ?? writeSheetFile
  const pathExists = dependencies.pathExists ?? existsSync
  const renameSheetPath = dependencies.renameSheetPath ?? renameSync
  const allocateSlug = dependencies.allocateSlug ?? allocateSheetSlug
  const relativePath = dependencies.relativePath ?? relativeToProjectRoot

  const payloadSlug = String(input.sheet.slug ?? '')
  if (payloadSlug !== input.slug) {
    throw new SaveSheetUseCaseError(
      400,
      `sheet.slug "${payloadSlug}" must match request slug "${input.slug}"`,
    )
  }

  const path = findSheetPath(input.kind, input.slug)
  if (!path) throw new SaveSheetUseCaseError(404, `Sheet ${input.slug}.json not found`)

  if (input.role === 'player' && !isPlayerAccessible(input.kind, input.slug)) {
    throw new SaveSheetUseCaseError(403, 'Sheet is not marked as player accessible')
  }

  const target = resolveSheetSaveTarget(input, path, {
    findSlugPath,
    pathExists,
    renameSheetPath,
    allocateSlug,
  })

  const sheet = stripDerivedFields(input.sheet)
  sheet.slug = target.slug
  if (input.role === 'player') sheet.player = true
  writeSheet(target.path, sheet)

  const data = { kind: input.kind, slug: target.slug, sheet }
  const renameData = { kind: input.kind, slug: target.slug, oldSlug: input.slug, newSlug: target.slug, sheet }
  const clientId = input.clientId
  const events: Array<Omit<RealtimeEvent, 'timestamp'>> = target.slug !== input.slug
    ? [
        { channel: sheetChannel(input.kind, input.slug), type: 'renamed', clientId, data: renameData },
        { channel: sheetChannel(input.kind, target.slug), type: 'updated', clientId, data },
        { channel: sheetsChannel, type: 'renamed', clientId, data: renameData },
      ]
    : [
        { channel: sheetChannel(input.kind, input.slug), type: 'updated', clientId, data },
        { channel: sheetsChannel, type: 'updated', clientId, data },
      ]

  return {
    ok: true,
    slug: target.slug,
    path: relativePath(target.path),
    sheet,
    events,
  }
}

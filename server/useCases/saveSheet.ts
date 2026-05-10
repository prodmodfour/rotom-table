import { UseCaseHttpError } from '../utils/useCaseErrors'
import type { AuthRole } from '~/shared/auth'
import { sheetChannel, sheetsChannel, type RealtimeEvent } from '~/shared/realtime'
import type { SheetKind } from '~/shared/sheets'
import { relativeToProjectRoot } from '../utils/fsPaths'
import {
  findPersistedSheetFile,
  sheetIsPlayerAccessible,
  stripDerivedSheetFields,
  writeSheetFile,
} from '../utils/sheetStorage'

export class SaveSheetUseCaseError extends UseCaseHttpError<400 | 403 | 404> {}

export interface SaveSheetInput {
  role: AuthRole
  kind: SheetKind
  slug: string
  sheet: Record<string, unknown>
  clientId?: string
}

export interface SaveSheetDependencies {
  findSheetPath?: (kind: SheetKind, slug: string) => string | null
  isPlayerAccessible?: (kind: SheetKind, slug: string) => boolean
  stripDerivedFields?: (sheet: Record<string, unknown>) => Record<string, unknown>
  writeSheet?: (path: string, sheet: Record<string, unknown>) => void
  relativePath?: (path: string) => string
}

export interface SaveSheetResult {
  ok: true
  path: string
  sheet: Record<string, unknown>
  events: Array<Omit<RealtimeEvent, 'timestamp'>>
}

export const saveSheetUseCase = (
  input: SaveSheetInput,
  dependencies: SaveSheetDependencies = {},
): SaveSheetResult => {
  const findSheetPath = dependencies.findSheetPath ?? findPersistedSheetFile
  const isPlayerAccessible = dependencies.isPlayerAccessible ?? sheetIsPlayerAccessible
  const stripDerivedFields = dependencies.stripDerivedFields ?? stripDerivedSheetFields
  const writeSheet = dependencies.writeSheet ?? writeSheetFile
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

  const sheet = stripDerivedFields(input.sheet)
  if (input.role === 'player') sheet.player = true
  writeSheet(path, sheet)

  const data = { kind: input.kind, slug: input.slug, sheet }
  const clientId = input.clientId

  return {
    ok: true,
    path: relativePath(path),
    sheet,
    events: [
      { channel: sheetChannel(input.kind, input.slug), type: 'updated', clientId, data },
      { channel: sheetsChannel, type: 'updated', clientId, data },
    ],
  }
}

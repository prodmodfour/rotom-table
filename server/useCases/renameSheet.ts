import { UseCaseHttpError } from '../utils/useCaseErrors'
import { sheetChannel, sheetsChannel, type RealtimeEvent } from '#shared/realtime'
import type { SheetKind } from '#shared/sheets'
import { renameSheetFile, type RenameSheetFileResult } from '../utils/sheetStorage'
import {
  retargetMapSheetPlacements,
  type RetargetMapSheetPlacementsResult,
} from '../utils/mapStorage'
import { mapRetargetRealtimeEvents } from '../utils/mapRetargetRealtime'

export class RenameSheetUseCaseError extends UseCaseHttpError<404 | 409 | 500> {}

export interface RenameSheetInput {
  kind: SheetKind
  slug: string
  name: string
  clientId?: string
}

export interface RenameSheetDependencies {
  renameSheet?: (kind: SheetKind, slug: string, name: string) => RenameSheetFileResult | null
  retargetMapSheetPlacements?: (
    kind: SheetKind,
    oldSlug: string,
    newSlug: string,
  ) => RetargetMapSheetPlacementsResult[]
}

export interface RenameSheetResult {
  ok: true
  slug: string
  name: string
  path: string
  sheet: Record<string, unknown>
  events: Array<Omit<RealtimeEvent, 'timestamp'>>
}

export const renameSheetUseCase = (
  input: RenameSheetInput,
  dependencies: RenameSheetDependencies = {},
): RenameSheetResult => {
  const renameSheet = dependencies.renameSheet ?? renameSheetFile
  const retargetMapPlacements = dependencies.retargetMapSheetPlacements ?? retargetMapSheetPlacements

  let renamed: RenameSheetFileResult | null
  try {
    renamed = renameSheet(input.kind, input.slug, input.name)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('already exists')) throw new RenameSheetUseCaseError(409, message)
    throw new RenameSheetUseCaseError(500, `Failed to parse or write sheet: ${err}`)
  }

  if (!renamed) throw new RenameSheetUseCaseError(404, `Sheet ${input.slug}.json not found`)

  const newSlug = renamed.slug || String(renamed.sheet.slug ?? input.slug)
  const mapUpdates = newSlug !== input.slug
    ? retargetMapPlacements(input.kind, input.slug, newSlug)
    : []
  const data = { kind: input.kind, slug: newSlug, sheet: renamed.sheet }
  const renameData = { kind: input.kind, slug: newSlug, oldSlug: input.slug, newSlug, sheet: renamed.sheet }
  const clientId = input.clientId
  const events: Array<Omit<RealtimeEvent, 'timestamp'>> = [
    ...(newSlug !== input.slug
      ? [
          { channel: sheetChannel(input.kind, input.slug), type: 'renamed', clientId, data: renameData },
          { channel: sheetChannel(input.kind, newSlug), type: 'updated', clientId, data },
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
    slug: newSlug,
    name: input.name,
    path: renamed.relativePath,
    sheet: renamed.sheet,
    events,
  }
}

import { UseCaseHttpError } from '../utils/useCaseErrors'
import { sheetChannel, sheetsChannel, type RealtimeEvent } from '#shared/realtime'
import type { SheetKind } from '#shared/sheets'
import {
  sqliteSheetRepository,
  type RenameSheetDocumentInput,
  type RenameSheetDocumentResult,
  type SheetRepository,
} from '../storage/sheetRepository'
import { mapRetargetRealtimeEvents } from '../utils/mapRetargetRealtime'

export class RenameSheetUseCaseError extends UseCaseHttpError<404 | 409 | 500> {}

export interface RenameSheetInput {
  kind: SheetKind
  slug: string
  name: string
  clientId?: string
}

export interface RenameSheetDependencies {
  sheetRepository?: Pick<SheetRepository, 'rename'>
  now?: () => number
  failAfterSheetUpdate?: () => void
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
  const sheetRepository = dependencies.sheetRepository ?? sqliteSheetRepository

  let renamed: RenameSheetDocumentResult | null
  try {
    renamed = sheetRepository.rename({
      kind: input.kind,
      slug: input.slug,
      name: input.name,
      now: dependencies.now?.(),
      failAfterSheetUpdate: dependencies.failAfterSheetUpdate,
    } as RenameSheetDocumentInput)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('already exists') || message.includes('UNIQUE')) throw new RenameSheetUseCaseError(409, message)
    throw new RenameSheetUseCaseError(500, `Failed to rename sheet: ${message}`)
  }

  if (!renamed) throw new RenameSheetUseCaseError(404, `Sheet ${input.slug}.json not found`)

  const data = { kind: input.kind, slug: renamed.newSlug, sheet: renamed.sheet.sheet }
  const renameData = {
    kind: input.kind,
    slug: renamed.newSlug,
    oldSlug: input.slug,
    newSlug: renamed.newSlug,
    sheet: renamed.sheet.sheet,
  }
  const clientId = input.clientId
  const events: Array<Omit<RealtimeEvent, 'timestamp'>> = [
    ...(!renamed.changed
      ? []
      : renamed.renamed
        ? [
            { channel: sheetChannel(input.kind, input.slug), type: 'renamed' as const, clientId, data: renameData },
            { channel: sheetChannel(input.kind, renamed.newSlug), type: 'updated' as const, clientId, data },
            { channel: sheetsChannel, type: 'renamed' as const, clientId, data: renameData },
          ]
        : [
            { channel: sheetChannel(input.kind, input.slug), type: 'updated' as const, clientId, data },
            { channel: sheetsChannel, type: 'updated' as const, clientId, data },
          ]),
    ...mapRetargetRealtimeEvents(renamed.mapUpdates, clientId),
  ]

  return {
    ok: true,
    slug: renamed.newSlug,
    name: input.name,
    path: renamed.path,
    sheet: renamed.sheet.sheet,
    events,
  }
}

import { UseCaseHttpError } from '../utils/useCaseErrors'
import { sheetChannel, sheetsChannel, type RealtimeEvent } from '#shared/realtime'
import type { SheetKind } from '#shared/sheets'
import { renameSheetFile, type RenameSheetFileResult } from '../utils/sheetStorage'

export class RenameSheetUseCaseError extends UseCaseHttpError<404 | 500> {}

export interface RenameSheetInput {
  kind: SheetKind
  slug: string
  name: string
  clientId?: string
}

export interface RenameSheetDependencies {
  renameSheet?: (kind: SheetKind, slug: string, name: string) => RenameSheetFileResult | null
}

export interface RenameSheetResult {
  ok: true
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

  let renamed: RenameSheetFileResult | null
  try {
    renamed = renameSheet(input.kind, input.slug, input.name)
  } catch (err) {
    throw new RenameSheetUseCaseError(500, `Failed to parse or write sheet: ${err}`)
  }

  if (!renamed) throw new RenameSheetUseCaseError(404, `Sheet ${input.slug}.json not found`)

  const data = { kind: input.kind, slug: input.slug, sheet: renamed.sheet }
  const clientId = input.clientId

  return {
    ok: true,
    name: input.name,
    path: renamed.relativePath,
    sheet: renamed.sheet,
    events: [
      { channel: sheetChannel(input.kind, input.slug), type: 'updated', clientId, data },
      { channel: sheetsChannel, type: 'updated', clientId, data },
    ],
  }
}

import { UseCaseHttpError } from '../utils/useCaseErrors'
import { sheetChannel, sheetsChannel, type RealtimeEvent } from '~/shared/realtime'
import type { SheetKind } from '~/shared/sheets'
import { deleteSheetFile, type SheetFileResult } from '../utils/sheetStorage'

export class DeleteSheetUseCaseError extends UseCaseHttpError<404> {}

export interface DeleteSheetInput {
  kind: SheetKind
  slug: string
  clientId?: string
}

export interface DeleteSheetDependencies {
  deleteSheet?: (kind: SheetKind, slug: string) => SheetFileResult | null
}

export interface DeleteSheetResult {
  ok: true
  path: string
  events: Array<Omit<RealtimeEvent, 'timestamp'>>
}

export const deleteSheetUseCase = (
  input: DeleteSheetInput,
  dependencies: DeleteSheetDependencies = {},
): DeleteSheetResult => {
  const deleteSheet = dependencies.deleteSheet ?? deleteSheetFile

  const deleted = deleteSheet(input.kind, input.slug)
  if (!deleted) throw new DeleteSheetUseCaseError(404, `Sheet ${input.slug}.json not found`)

  const data = { kind: input.kind, slug: input.slug }
  const clientId = input.clientId

  return {
    ok: true,
    path: deleted.relativePath,
    events: [
      { channel: sheetChannel(input.kind, input.slug), type: 'deleted', clientId, data },
      { channel: sheetsChannel, type: 'deleted', clientId, data },
    ],
  }
}

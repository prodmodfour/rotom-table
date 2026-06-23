import { UseCaseHttpError } from '../utils/useCaseErrors'
import { sheetChannel, sheetsChannel, type RealtimeEvent } from '#shared/realtime'
import type { SheetKind } from '#shared/sheets'
import { sqliteSheetRepository, type SheetRepository } from '../storage/sheetRepository'
import { mapRetargetRealtimeEvents } from '../utils/mapRetargetRealtime'

export class DeleteSheetUseCaseError extends UseCaseHttpError<404> {}

export interface DeleteSheetInput {
  kind: SheetKind
  slug: string
  clientId?: string
}

export interface DeleteSheetDependencies {
  sheetRepository?: Pick<SheetRepository, 'deleteDocument'>
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
  const sheetRepository = dependencies.sheetRepository ?? sqliteSheetRepository

  const deleted = sheetRepository.deleteDocument(input.kind, input.slug)
  if (!deleted) throw new DeleteSheetUseCaseError(404, `Sheet ${input.slug}.json not found`)

  const data = { kind: input.kind, slug: input.slug }
  const clientId = input.clientId

  return {
    ok: true,
    path: deleted.path,
    events: [
      { channel: sheetChannel(input.kind, input.slug), type: 'deleted', clientId, data },
      { channel: sheetsChannel, type: 'deleted', clientId, data },
      ...mapRetargetRealtimeEvents((deleted.mapUpdates ?? []) as Parameters<typeof mapRetargetRealtimeEvents>[0], clientId),
    ],
  }
}

import { sheetsChannel, type RealtimeEvent } from '#shared/realtime'
import type { SheetKind } from '#shared/sheets'
import { createSheetFile, type CreateSheetFileResult } from '../utils/sheetStorage'

export interface CreateSheetInput {
  kind: SheetKind
  folder: string
  clientId?: string
}

export interface CreateSheetDependencies {
  createSheet?: (kind: SheetKind, folder: string) => CreateSheetFileResult
}

export interface CreateSheetResult {
  ok: true
  kind: SheetKind
  slug: string
  path: string
  events: Array<Omit<RealtimeEvent, 'timestamp'>>
}

export const createSheetUseCase = (
  input: CreateSheetInput,
  dependencies: CreateSheetDependencies = {},
): CreateSheetResult => {
  const createSheet = dependencies.createSheet ?? createSheetFile
  const created = createSheet(input.kind, input.folder)

  return {
    ok: true,
    kind: input.kind,
    slug: created.slug,
    path: created.relativePath,
    events: [
      {
        channel: sheetsChannel,
        type: 'updated',
        clientId: input.clientId,
        data: {
          kind: input.kind,
          slug: created.slug,
          sheet: { ...created.sheet, folder: created.folder },
        },
      },
    ],
  }
}

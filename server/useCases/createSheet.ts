import { sheetsChannel, type RealtimeEvent } from '#shared/realtime'
import type { SheetKind } from '#shared/sheets'
import { sqliteSheetRepository, type SheetRepository } from '../storage/sheetRepository'

export interface CreateSheetInput {
  kind: SheetKind
  folder: string
  clientId?: string
}

export interface CreateSheetDependencies {
  sheetRepository?: Pick<SheetRepository, 'create'>
  now?: () => number
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
  const sheetRepository = dependencies.sheetRepository ?? sqliteSheetRepository
  const created = sheetRepository.create({
    kind: input.kind,
    folder: input.folder,
    now: dependencies.now?.(),
  })

  return {
    ok: true,
    kind: input.kind,
    slug: created.slug,
    path: created.path,
    events: [
      {
        channel: sheetsChannel,
        type: 'updated',
        revision: created.sheet.revision as number | undefined,
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

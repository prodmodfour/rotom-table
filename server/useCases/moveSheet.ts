import { UseCaseHttpError } from '../utils/useCaseErrors'
import { sheetsChannel, type RealtimeEvent } from '#shared/realtime'
import type { SheetKind } from '#shared/sheets'
import { sqliteSheetRepository, type SheetRepository } from '../storage/sheetRepository'

export class MoveSheetUseCaseError extends UseCaseHttpError<400 | 404 | 409> {}

export interface MoveSheetInput {
  kind: SheetKind
  slug: string
  folder: string
  clientId?: string
}

export interface MoveSheetDependencies {
  sheetRepository?: Pick<SheetRepository, 'moveToFolder'>
  now?: () => number
}

export interface MoveSheetResult {
  ok: true
  moved: boolean
  path: string
  events: Array<Omit<RealtimeEvent, 'timestamp'>>
}

export const moveSheetUseCase = (
  input: MoveSheetInput,
  dependencies: MoveSheetDependencies = {},
): MoveSheetResult => {
  const sheetRepository = dependencies.sheetRepository ?? sqliteSheetRepository

  let moved
  try {
    moved = sheetRepository.moveToFolder({
      kind: input.kind,
      slug: input.slug,
      folder: input.folder,
      now: dependencies.now?.(),
    })
  } catch (err) {
    const message = (err as Error).message
    if (message.includes('already exists')) throw new MoveSheetUseCaseError(409, message)
    throw new MoveSheetUseCaseError(400, message)
  }

  if (!moved) throw new MoveSheetUseCaseError(404, `Sheet ${input.slug}.json not found`)

  return {
    ok: true,
    moved: moved.moved,
    path: moved.path,
    events: moved.moved
      ? [
          {
            channel: sheetsChannel,
            type: 'moved',
            clientId: input.clientId,
            data: { kind: input.kind, slug: input.slug, folder: moved.folder },
          },
        ]
      : [],
  }
}

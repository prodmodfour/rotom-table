import { UseCaseHttpError } from '../utils/useCaseErrors'
import { sheetsChannel, type RealtimeEvent } from '~/shared/realtime'
import type { SheetKind } from '~/shared/sheets'
import { moveSheetFile, type MoveSheetFileResult } from '../utils/sheetStorage'

export class MoveSheetUseCaseError extends UseCaseHttpError<400 | 404 | 409> {}

export interface MoveSheetInput {
  kind: SheetKind
  slug: string
  folder: string
  clientId?: string
}

export interface MoveSheetDependencies {
  moveSheet?: (kind: SheetKind, slug: string, folder: string) => MoveSheetFileResult | null
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
  const moveSheet = dependencies.moveSheet ?? moveSheetFile

  let moved: MoveSheetFileResult | null
  try {
    moved = moveSheet(input.kind, input.slug, input.folder)
  } catch (err) {
    const message = (err as Error).message
    if (message.includes('already exists')) throw new MoveSheetUseCaseError(409, message)
    throw new MoveSheetUseCaseError(400, message)
  }

  if (!moved) throw new MoveSheetUseCaseError(404, `Sheet ${input.slug}.json not found`)

  return {
    ok: true,
    moved: moved.moved,
    path: moved.relativePath,
    events: [
      {
        channel: sheetsChannel,
        type: 'moved',
        clientId: input.clientId,
        data: { kind: input.kind, slug: input.slug, folder: moved.folder },
      },
    ],
  }
}

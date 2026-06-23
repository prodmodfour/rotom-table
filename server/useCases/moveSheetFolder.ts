import { UseCaseHttpError } from '../utils/useCaseErrors'
import { sanitizeFolderPath } from '#shared/paths'
import { sqliteSheetRepository, type SheetRepository } from '../storage/sheetRepository'

export class MoveSheetFolderUseCaseError extends UseCaseHttpError<400 | 404 | 409> {}

export interface MoveSheetFolderInput {
  from?: unknown
  to?: unknown
}

export interface MoveSheetFolderDependencies {
  sheetRepository?: Pick<SheetRepository, 'moveFolder'>
  moveFolder?: (from: string, to: string) => { moved: boolean; count: number; affectedSheets?: readonly unknown[] } | null
  now?: () => number
}

export interface MoveSheetFolderResult {
  ok: true
  moved: boolean
  count: number
}

export const normalizeMoveSheetFolderPath = (value: unknown, label: 'from' | 'to'): string => {
  try {
    return sanitizeFolderPath(String(value ?? ''), { label })
  } catch (err) {
    throw new MoveSheetFolderUseCaseError(400, (err as Error).message)
  }
}

export const moveSheetFolderUseCase = (
  input: MoveSheetFolderInput,
  dependencies: MoveSheetFolderDependencies = {},
): MoveSheetFolderResult => {
  const sheetRepository = dependencies.sheetRepository ?? sqliteSheetRepository
  const moveFolder = dependencies.moveFolder ?? ((from: string, to: string) => sheetRepository.moveFolder(from, to, undefined, dependencies.now?.()))
  const from = normalizeMoveSheetFolderPath(input.from, 'from')
  const to = normalizeMoveSheetFolderPath(input.to, 'to')

  let result
  try {
    result = moveFolder(from, to)
  } catch (err) {
    const message = (err as Error).message
    if (message.includes('Destination')) throw new MoveSheetFolderUseCaseError(409, message)
    throw new MoveSheetFolderUseCaseError(400, message)
  }

  if (!result) throw new MoveSheetFolderUseCaseError(404, `Folder "${from}" not found`)

  return { ok: true, moved: result.moved, count: result.count }
}

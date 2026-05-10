import { UseCaseHttpError } from '../utils/useCaseErrors'
import { sanitizeFolderPath } from '~/shared/paths'
import { moveSheetFolder, type MoveFolderResult } from '../utils/sheetStorage'

export class MoveSheetFolderUseCaseError extends UseCaseHttpError<400 | 404 | 409> {}

export interface MoveSheetFolderInput {
  from?: unknown
  to?: unknown
}

export interface MoveSheetFolderDependencies {
  moveFolder?: (from: string, to: string) => MoveFolderResult | null
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
  const moveFolder = dependencies.moveFolder ?? moveSheetFolder
  const from = normalizeMoveSheetFolderPath(input.from, 'from')
  const to = normalizeMoveSheetFolderPath(input.to, 'to')

  let result: MoveFolderResult | null
  try {
    result = moveFolder(from, to)
  } catch (err) {
    const message = (err as Error).message
    if (message.includes('Destination already exists')) throw new MoveSheetFolderUseCaseError(409, message)
    throw new MoveSheetFolderUseCaseError(400, message)
  }

  if (!result) throw new MoveSheetFolderUseCaseError(404, `Folder "${from}" not found`)

  return { ok: true, moved: result.moved, count: result.count }
}

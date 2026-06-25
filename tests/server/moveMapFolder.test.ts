import { describe, expect, it } from 'vitest'
import { MoveMapFolderUseCaseError, normalizeMoveMapFolderPath } from '../../server/useCases/moveMapFolder'

describe('move map folder use case input normalization', () => {
  it('turns folder sanitizer failures into bad-request use-case errors', () => {
    expect(() => normalizeMoveMapFolderPath('', () => {
      throw new Error('folder must not be empty')
    })).toThrow(MoveMapFolderUseCaseError)
    expect(() => normalizeMoveMapFolderPath('', () => {
      throw new Error('folder must not be empty')
    })).toThrow('folder must not be empty')
  })
})

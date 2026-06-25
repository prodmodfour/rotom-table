import { describe, expect, it } from 'vitest'
import { DeleteMapFolderUseCaseError, normalizeDeleteMapFolderPath } from '../../server/useCases/deleteMapFolder'

describe('delete map folder use case input normalization', () => {
  it('turns folder sanitizer failures into bad-request use-case errors', () => {
    expect(() => normalizeDeleteMapFolderPath('', () => {
      throw new Error('folder must not be empty')
    })).toThrow(DeleteMapFolderUseCaseError)
    expect(() => normalizeDeleteMapFolderPath('', () => {
      throw new Error('folder must not be empty')
    })).toThrow('folder must not be empty')
  })
})

import { describe, expect, it } from 'vitest'
import { CreateMapFolderUseCaseError, normalizeCreateMapFolder } from '../../server/useCases/createMapFolder'

describe('create map folder use case input normalization', () => {
  it('turns folder sanitizer failures into bad-request use-case errors', () => {
    expect(() => normalizeCreateMapFolder('', () => {
      throw new Error('folder must not be empty')
    })).toThrow(CreateMapFolderUseCaseError)
    expect(() => normalizeCreateMapFolder('', () => {
      throw new Error('folder must not be empty')
    })).toThrow('folder must not be empty')
  })
})

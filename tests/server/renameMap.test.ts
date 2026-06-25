import { describe, expect, it } from 'vitest'
import { RenameMapUseCaseError, normalizeRenameMapName, normalizeRenameMapSlug } from '../../server/useCases/renameMap'

describe('rename map use case input normalization', () => {
  it('rejects invalid slugs and names with compatible messages', () => {
    expect(() => normalizeRenameMapSlug('Bad Slug')).toThrow(RenameMapUseCaseError)
    expect(() => normalizeRenameMapSlug('Bad Slug')).toThrow('slug must match /^[a-z0-9-]+$/')
    expect(() => normalizeRenameMapName('  ')).toThrow('name is required')
    expect(() => normalizeRenameMapName('x'.repeat(81))).toThrow('name too long (max 80 chars)')
  })
})

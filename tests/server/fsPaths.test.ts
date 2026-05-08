import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ensureInsideRoot, joinSafeUnderRoot, relativeToProjectRoot } from '../../server/utils/fsPaths'

describe('server filesystem path helpers', () => {
  it('allows paths inside the configured root', () => {
    const root = mkdtempSync(join(tmpdir(), 'rotom-root-'))
    const target = join(root, 'nested', 'file.json')

    expect(() => ensureInsideRoot(root, target)).not.toThrow()
    expect(joinSafeUnderRoot(root, 'nested', 'file.json')).toBe(resolve(target))
  })

  it('rejects paths outside the configured root', () => {
    const root = mkdtempSync(join(tmpdir(), 'rotom-root-'))

    expect(() => ensureInsideRoot(root, join(root, '..', 'outside.json'))).toThrow('outside root')
    expect(() => joinSafeUnderRoot(root, '..', 'outside.json')).toThrow('outside root')
  })

  it('renders project-relative labels with forward slashes', () => {
    expect(relativeToProjectRoot(resolve('data/maps/example.json'))).toBe('data/maps/example.json')
  })
})

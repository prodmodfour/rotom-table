import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

describe('sprite visual-bounds Python helper', () => {
  it('extracts deterministic bounds for static and animated image fixtures', () => {
    expect(() => execFileSync('python3', ['tests/python/test_sprite_visual_bounds.py'], {
      cwd: process.cwd(),
      encoding: 'utf-8',
    })).not.toThrow()
  })
})

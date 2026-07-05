import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

describe('sprite visual-bounds Python helpers', () => {
  it.each([
    'tests/python/test_sprite_visual_bounds.py',
    'tests/python/test_download_pokemon_sprites_visual_bounds.py',
  ])('passes %s', (scriptPath) => {
    expect(() => execFileSync('python3', [scriptPath], {
      cwd: process.cwd(),
      encoding: 'utf-8',
    })).not.toThrow()
  })
})

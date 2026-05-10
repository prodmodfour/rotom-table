import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  MAPS_ROOT,
  SLUG_RE,
  folderFromPath,
  mapPathLabel,
  sanitizeMapFolderPath,
  slugify,
} from '../../server/utils/mapPaths'

const projectRootFromMapsRoot = () => MAPS_ROOT.replace(/[/\\]data[/\\]maps$/, '')

describe('map path helpers', () => {
  it('exposes the stable maps root and slug helpers', () => {
    expect(MAPS_ROOT).toMatch(/data[/\\]maps$/)
    expect(SLUG_RE.test('valid-map-1')).toBe(true)
    expect(SLUG_RE.test('Invalid Map')).toBe(false)
    expect(slugify('Untitled Map!')).toBe('untitled-map')
  })

  it('derives map folders from filesystem paths with posix separators', () => {
    expect(folderFromPath(join(MAPS_ROOT, 'city-square.json'))).toBe('')
    expect(folderFromPath(join(MAPS_ROOT, 'helix', 'maps', 'city-square.json'))).toBe('helix/maps')
  })

  it('formats project-relative map path labels', () => {
    expect(mapPathLabel(join(MAPS_ROOT, 'helix', 'maps', 'city-square.json'))).toBe('data/maps/helix/maps/city-square.json')
    expect(mapPathLabel(join(projectRootFromMapsRoot(), 'data', 'other.json'))).toBe('data/other.json')
    expect(mapPathLabel('/outside/data/maps/city-square.json')).toBe('/outside/data/maps/city-square.json')
  })

  it('uses shared safe folder validation for map folders', () => {
    expect(sanitizeMapFolderPath('helix/maps', true)).toBe('helix/maps')
    expect(sanitizeMapFolderPath('', true)).toBe('')
    expect(() => sanitizeMapFolderPath('', false)).toThrow('folder must not be empty')
    expect(() => sanitizeMapFolderPath('../maps', true)).toThrow('folder segment ".." must match')
  })
})

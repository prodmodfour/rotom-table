import { describe, expect, it } from 'vitest'
import {
  MAP_LIBRARY_PATH,
  mapEditorPath,
  mapLibraryPath,
} from '~/utils/mapRoutes'

describe('map route helpers', () => {
  it('exposes the map library path', () => {
    expect(MAP_LIBRARY_PATH).toBe('/maps')
    expect(mapLibraryPath()).toBe('/maps')
  })

  it('builds encoded map editor paths', () => {
    expect(mapEditorPath('airship')).toBe('/maps/airship')
    expect(mapEditorPath('space map')).toBe('/maps/space%20map')
    expect(mapEditorPath('folder/name')).toBe('/maps/folder%2Fname')
  })

  it('keeps map editor paths as normal saved-map routes', () => {
    expect(mapEditorPath('space map')).toBe('/maps/space%20map')
    expect(mapEditorPath('space map')).not.toContain('?session=1')
  })
})

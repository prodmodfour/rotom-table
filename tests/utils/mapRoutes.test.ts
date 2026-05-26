import { describe, expect, it } from 'vitest'
import {
  MAP_LIBRARY_PATH,
  MAP_SESSION_MODE_QUERY_VALUE,
  mapEditorPath,
  mapEditorSessionPath,
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

  it('builds explicit session-mode map paths without changing the local editor path', () => {
    expect(MAP_SESSION_MODE_QUERY_VALUE).toBe('1')
    expect(mapEditorSessionPath('airship')).toBe('/maps/airship?session=1')
    expect(mapEditorSessionPath('space map')).toBe('/maps/space%20map?session=1')
    expect(mapEditorPath('space map')).toBe('/maps/space%20map')
  })
})

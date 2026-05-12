import { describe, expect, it } from 'vitest'
import {
  API_EVENTS_PATH,
  ENCOUNTER_API_PATHS,
  MAP_API_PATHS,
  POKEDEX_API_PATHS,
  SHEET_API_PATHS,
} from '~/utils/apiRoutes'

describe('API route constants', () => {
  it('exposes the realtime events path', () => {
    expect(API_EVENTS_PATH).toBe('/api/events')
  })

  it('exposes map API paths', () => {
    expect(MAP_API_PATHS).toEqual({
      list: '/api/maps/list',
      folders: '/api/maps/folders',
      load: '/api/maps/load',
      save: '/api/maps/save',
      create: '/api/maps/create',
      createFolder: '/api/maps/create-folder',
      move: '/api/maps/move',
      moveFolder: '/api/maps/move-folder',
      rename: '/api/maps/rename',
      deleteMap: '/api/maps/delete',
      deleteFolder: '/api/maps/delete-folder',
    })
  })

  it('exposes sheet API paths', () => {
    expect(SHEET_API_PATHS).toEqual({
      folders: '/api/sheets/folders',
      save: '/api/sheets/save',
      create: '/api/sheets/create',
      createFolder: '/api/sheets/create-folder',
      move: '/api/sheets/move',
      moveFolder: '/api/sheets/move-folder',
      rename: '/api/sheets/rename',
      deleteSheet: '/api/sheets/delete',
      deleteFolder: '/api/sheets/delete-folder',
    })
  })

  it('exposes encounter API paths', () => {
    expect(ENCOUNTER_API_PATHS.generate).toBe('/api/encounters/generate')
  })

  it('exposes pokedex API paths', () => {
    expect(POKEDEX_API_PATHS).toEqual({
      index: '/api/pokedex',
      detail: '/api/pokedex/detail',
      searchIndex: '/api/pokedex/search-index',
    })
  })
})

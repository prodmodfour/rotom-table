export const API_EVENTS_PATH = '/api/events' as const

export const MAP_API_PATHS = {
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
} as const

export const SHEET_API_PATHS = {
  list: '/api/sheets/list',
  folders: '/api/sheets/folders',
  load: '/api/sheets/load',
  save: '/api/sheets/save',
  create: '/api/sheets/create',
  createFolder: '/api/sheets/create-folder',
  move: '/api/sheets/move',
  moveFolder: '/api/sheets/move-folder',
  rename: '/api/sheets/rename',
  deleteSheet: '/api/sheets/delete',
  deleteFolder: '/api/sheets/delete-folder',
} as const

export const ENCOUNTER_API_PATHS = {
  list: '/api/encounters/list',
  folders: '/api/encounters/folders',
  generate: '/api/encounters/generate',
  create: '/api/encounters/create',
  createFolder: '/api/encounters/create-folder',
  save: '/api/encounters/save',
  move: '/api/encounters/move',
  moveFolder: '/api/encounters/move-folder',
  rename: '/api/encounters/rename',
  deleteTable: '/api/encounters/delete',
  deleteFolder: '/api/encounters/delete-folder',
} as const

export const POKEDEX_API_PATHS = {
  index: '/api/pokedex',
  detail: '/api/pokedex/detail',
  searchIndex: '/api/pokedex/search-index',
} as const

export const API_EVENTS_PATH = '/api/events' as const

export const CAMPAIGN_API_PATHS = {
  nextDay: '/api/campaign/next-day',
} as const

export const SESSION_API_PATHS = {
  safety: '/api/sessions/safety',
  start: '/api/sessions/start',
  join: '/api/sessions/join',
  playerProfiles: '/api/sessions/player-profiles',
  manage: '/api/sessions/manage',
  playerState: '/api/sessions/player-state',
  assignments: '/api/sessions/assignments',
  socket: '/api/sessions/socket',
} as const

export const PLAYER_PROFILE_API_PATHS = {
  list: '/api/player-profiles/list',
  create: '/api/player-profiles/create',
  update: '/api/player-profiles/update',
} as const

export const MAP_API_PATHS = {
  list: '/api/maps/list',
  folders: '/api/maps/folders',
  load: '/api/maps/load',
  save: '/api/maps/save',
  useMove: '/api/maps/use-move',
  actionEvent: '/api/maps/action-event',
  spawnToken: '/api/maps/tokens/spawn',
  moveToken: '/api/maps/tokens/move',
  turnToken: '/api/maps/tokens/turn',
  modifyHp: '/api/maps/tokens/modify-hp',
  modifyCombatStages: '/api/maps/tokens/modify-combat-stages',
  modifyConditions: '/api/maps/tokens/modify-conditions',
  setInitiative: '/api/maps/initiative/set',
  nextInitiative: '/api/maps/initiative/next',
  previousInitiative: '/api/maps/initiative/previous',
  placeHazard: '/api/maps/hazards/place',
  removeHazard: '/api/maps/hazards/remove',
  buildTerrainVoxel: '/api/maps/terrain/build',
  removeTerrainVoxel: '/api/maps/terrain/remove',
  setFieldEffect: '/api/maps/field-effects/set',
  removeFieldEffect: '/api/maps/field-effects/remove',
  tickFieldEffectDurations: '/api/maps/field-effects/tick',
  useManeuver: '/api/maps/tokens/use-maneuver',
  useAbility: '/api/maps/tokens/use-ability',
  useOrder: '/api/maps/tokens/use-order',
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
  spawn: '/api/encounters/spawn',
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
  update: '/api/pokedex/update',
  restoreFromBooks: '/api/pokedex/restore-from-books',
} as const

export const API_EVENTS_PATH = '/api/events' as const

export const CAMPAIGN_API_PATHS = {
  attention: '/api/campaign/attention',
  continuation: '/api/campaign/continuation',
  nextDayPreflight: '/api/campaign/next-day/preflight',
  nextDay: '/api/campaign/next-day',
} as const

export const GROUP_INVENTORY_API_PATHS = {
  load: '/api/group-inventory/load',
  save: '/api/group-inventory/save',
  transferToTrainer: '/api/group-inventory/transfer-to-trainer',
  transferToGroup: '/api/group-inventory/transfer-to-group',
} as const

export const SHOP_API_PATHS = {
  list: '/api/shops/list',
  load: '/api/shops/load',
  create: '/api/shops/create',
  save: '/api/shops/save',
  deleteShop: '/api/shops/delete',
  checkout: '/api/shops/checkout',
  postCheckoutActions: '/api/shops/post-checkout-actions',
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

export const ENCOUNTER_SETTLEMENT_API_PATHS = {
  prepareFinish: '/api/encounter-settlements/finish/prepare',
  commitFinish: '/api/encounter-settlements/finish/commit',
  operationStatus: '/api/encounter-settlements/operations/status',
} as const

export const ENCOUNTER_WORKSPACE_API_PATHS = {
  list: '/api/encounter-workspace/list',
  load: '/api/encounter-workspace/load',
  metrics: '/api/encounter-workspace/metrics',
  initialize: '/api/encounter-documents/initialize',
  directorCommand: '/api/encounter-documents/director-command',
  launch: '/api/encounter-documents/launch',
  export: '/api/encounter-documents/export',
} as const

export const EQUIPMENT_API_PATHS = {
  operations: '/api/equipment/operations',
} as const

export const INVENTORY_ACTION_API_PATHS = {
  actions: '/api/inventory/actions',
  execute: '/api/inventory/actions/execute',
  history: '/api/inventory/history',
} as const

export const BREEDING_API_PATHS = {
  items: '/api/breeding/items',
} as const

export const SKILL_CHECK_API_PATHS = {
  gm: '/api/skill-checks/gm',
  subject: '/api/skill-checks/subject',
  projections: '/api/skill-checks/projections',
  campaignHistory: '/api/skill-checks/campaign-history',
  settleExpired: '/api/skill-checks/settle-expired',
} as const

export const ITEM_API_PATHS = {
  use: '/api/items/use',
  resume: '/api/items/resume',
  recover: '/api/items/recover',
  sheetActions: '/api/items/sheet-actions',
  declareSheetAction: '/api/items/sheet-actions/declare',
  groupActions: '/api/items/group-actions',
  declareGroupAction: '/api/items/group-actions/declare',
  extendedActions: '/api/items/extended-actions',
  formChanges: '/api/items/form-changes',
  equipmentActions: '/api/items/equipment-actions',
  exploration: '/api/items/exploration',
  guided: '/api/items/guided',
} as const

export const MAP_API_PATHS = {
  list: '/api/maps/list',
  folders: '/api/maps/folders',
  load: '/api/maps/load',
  liveState: '/api/maps/live-state',
  save: '/api/maps/save',
  interactionMode: '/api/maps/interaction-mode',
  useMove: '/api/maps/use-move',
  resolveMove: '/api/maps/tokens/resolve-move',
  beginAbilityDeclaration: '/api/maps/abilities/declarations',
  resolveAbilityDeclaration: '/api/maps/abilities/resolve',
  declareEncounterAction: '/api/maps/encounter-actions/declarations',
  executeCapabilityAction: '/api/maps/capabilities/execute',
  resolveCapabilityAdjudication: '/api/maps/capabilities/adjudications/resolve',
  moveCorrectionDetails: '/api/maps/move-corrections/details',
  applyMoveCorrection: '/api/maps/move-corrections/apply',
  pendingMoveResponses: '/api/maps/move-responses/pending',
  chooseMoveResponse: '/api/maps/move-responses/choose',
  reactMoveResponse: '/api/maps/move-responses/react',
  passMoveResponse: '/api/maps/move-responses/pass',
  cancelMoveResolution: '/api/maps/move-responses/cancel',
  forceResolveMoveResolution: '/api/maps/move-responses/force-resolve',
  actionEvent: '/api/maps/action-event',
  operationStatus: '/api/maps/operations/status',
  operationAbandon: '/api/maps/operations/abandon',
  spawnToken: '/api/maps/tokens/spawn',
  sendOutPokemon: '/api/maps/tokens/send-out',
  deleteToken: '/api/maps/tokens/delete',
  throwPokeball: '/api/maps/tokens/throw-pokeball',
  moveToken: '/api/maps/tokens/move',
  turnToken: '/api/maps/tokens/turn',
  modifyHp: '/api/maps/tokens/modify-hp',
  modifyCombatStages: '/api/maps/tokens/modify-combat-stages',
  modifyConditions: '/api/maps/tokens/modify-conditions',
  grantExperience: '/api/maps/tokens/grant-experience',
  setInitiative: '/api/maps/initiative/set',
  nextInitiative: '/api/maps/initiative/next',
  previousInitiative: '/api/maps/initiative/previous',
  placeHazard: '/api/maps/hazards/place',
  removeHazard: '/api/maps/hazards/remove',
  clearHazards: '/api/maps/hazards/clear',
  editHazards: '/api/maps/hazards/edit',
  buildTerrainVoxel: '/api/maps/terrain/build',
  removeTerrainVoxel: '/api/maps/terrain/remove',
  editTerrainVoxels: '/api/maps/terrain/edit',
  setFieldEffect: '/api/maps/field-effects/set',
  removeFieldEffect: '/api/maps/field-effects/remove',
  clearFieldEffects: '/api/maps/field-effects/clear',
  tickFieldEffectDurations: '/api/maps/field-effects/tick',
  setScene: '/api/maps/scene/set',
  endEncounter: '/api/maps/encounter/end',
  dismissEncounterEffect: '/api/maps/encounter/effects/dismiss',
  updateAttackOfOpportunity: '/api/maps/attack-of-opportunity/update',
  updateStartTurnModal: '/api/maps/start-turn-modal/update',
  useManeuver: '/api/maps/tokens/use-maneuver',
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

export const GM_TOOLKIT_API_PATHS = {
  npcArchetypes: '/api/gm-toolkit/npc-archetypes',
  npcGeneration: '/api/gm-toolkit/npc-generation',
  npcPackage: (packageId: string) => `/api/gm-toolkit/packages/npc/${encodeURIComponent(packageId)}`,
  wildPackage: (packageId: string) => `/api/gm-toolkit/packages/wild/${encodeURIComponent(packageId)}`,
  builderHandoff: '/api/gm-toolkit/builder-handoff',
  sessionPreparations: '/api/gm-toolkit/session-preparations/list',
  sessionPreparation: (preparationId: string) => `/api/gm-toolkit/session-preparations/${encodeURIComponent(preparationId)}`,
  mutateSessionPreparation: '/api/gm-toolkit/session-preparations/mutate',
} as const

export const ENCOUNTER_API_PATHS = {
  list: '/api/encounters/list',
  table: (tableId: string) => `/api/encounters/table/${encodeURIComponent(tableId)}`,
  generate: '/api/encounters/generate',
  create: '/api/encounters/create',
  save: '/api/encounters/save',
  archive: '/api/encounters/archive',
  restore: '/api/encounters/restore',
  copy: '/api/encounters/copy',
  import: '/api/encounters/import',
  export: (tableId: string) => `/api/encounters/export/${encodeURIComponent(tableId)}`,
  /** @deprecated Filesystem folder CRUD is not liveplay authority. */
  folders: '/api/encounters/folders',
  /** @deprecated Filesystem folder CRUD is not liveplay authority. */
  createFolder: '/api/encounters/create-folder',
  /** @deprecated Filesystem folder CRUD is not liveplay authority. */
  move: '/api/encounters/move',
  /** @deprecated Filesystem folder CRUD is not liveplay authority. */
  moveFolder: '/api/encounters/move-folder',
  /** @deprecated Destructive deletion was replaced by archive. */
  rename: '/api/encounters/rename',
  /** @deprecated Destructive deletion was replaced by archive. */
  deleteTable: '/api/encounters/delete',
  /** @deprecated Filesystem folder CRUD is not liveplay authority. */
  deleteFolder: '/api/encounters/delete-folder',
} as const

export const POKEDEX_API_PATHS = {
  index: '/api/pokedex',
  detail: '/api/pokedex/detail',
  searchIndex: '/api/pokedex/search-index',
  profilePriority: '/api/pokedex/profile-priority',
  update: '/api/pokedex/update',
  updateProfileImage: '/api/pokedex/profile-image',
} as const

import { describe, expect, it } from 'vitest'
import {
  API_EVENTS_PATH,
  BREEDING_API_PATHS,
  CAMPAIGN_API_PATHS,
  ENCOUNTER_API_PATHS,
  ENCOUNTER_SETTLEMENT_API_PATHS,
  EQUIPMENT_API_PATHS,
  GROUP_INVENTORY_API_PATHS,
  GM_TOOLKIT_API_PATHS,
  INVENTORY_ACTION_API_PATHS,
  ITEM_API_PATHS,
  MAP_API_PATHS,
  PLAYER_PROFILE_API_PATHS,
  POKEDEX_API_PATHS,
  SESSION_API_PATHS,
  SHEET_API_PATHS,
  SHOP_API_PATHS,
} from '~/utils/apiRoutes'

describe('API route constants', () => {
  it('exposes the realtime events path', () => {
    expect(API_EVENTS_PATH).toBe('/api/events')
  })

  it('exposes campaign API paths', () => {
    expect(CAMPAIGN_API_PATHS).toEqual({
      attention: '/api/campaign/attention',
      continuation: '/api/campaign/continuation',
      nextDayPreflight: '/api/campaign/next-day/preflight',
      nextDay: '/api/campaign/next-day',
    })
  })

  it('exposes Finish Encounter settlement paths', () => {
    expect(ENCOUNTER_SETTLEMENT_API_PATHS).toEqual({
      prepareFinish: '/api/encounter-settlements/finish/prepare',
      commitFinish: '/api/encounter-settlements/finish/commit',
      operationStatus: '/api/encounter-settlements/operations/status',
    })
  })

  it('exposes group inventory API paths', () => {
    expect(GROUP_INVENTORY_API_PATHS).toEqual({
      load: '/api/group-inventory/load',
      save: '/api/group-inventory/save',
      transferToTrainer: '/api/group-inventory/transfer-to-trainer',
      transferToGroup: '/api/group-inventory/transfer-to-group',
    })
  })

  it('exposes session API paths', () => {
    expect(SESSION_API_PATHS).toEqual({
      safety: '/api/sessions/safety',
      start: '/api/sessions/start',
      join: '/api/sessions/join',
      playerProfiles: '/api/sessions/player-profiles',
      manage: '/api/sessions/manage',
      playerState: '/api/sessions/player-state',
      assignments: '/api/sessions/assignments',
      socket: '/api/sessions/socket',
    })
  })

  it('exposes persistent player profile API paths', () => {
    expect(PLAYER_PROFILE_API_PATHS).toEqual({
      list: '/api/player-profiles/list',
      create: '/api/player-profiles/create',
      update: '/api/player-profiles/update',
    })
  })

  it('exposes shop API paths', () => {
    expect(SHOP_API_PATHS).toEqual({
      list: '/api/shops/list',
      load: '/api/shops/load',
      create: '/api/shops/create',
      save: '/api/shops/save',
      deleteShop: '/api/shops/delete',
      checkout: '/api/shops/checkout',
      postCheckoutActions: '/api/shops/post-checkout-actions',
    })
  })

  it('exposes equipment API paths', () => {
    expect(EQUIPMENT_API_PATHS).toEqual({
      operations: '/api/equipment/operations',
    })
  })

  it('exposes unified inventory action API paths', () => {
    expect(INVENTORY_ACTION_API_PATHS).toEqual({
      actions: '/api/inventory/actions',
      execute: '/api/inventory/actions/execute',
      history: '/api/inventory/history',
    })
  })

  it('exposes breeding API paths', () => {
    expect(BREEDING_API_PATHS).toEqual({
      items: '/api/breeding/items',
    })
  })

  it('exposes item API paths', () => {
    expect(ITEM_API_PATHS).toEqual({
      use: '/api/items/use',
      resume: '/api/items/resume',
      recover: '/api/items/recover',
      sheetActions: '/api/items/sheet-actions',
      declareSheetAction: '/api/items/sheet-actions/declare',
      groupActions: '/api/items/group-actions',
      declareGroupAction: '/api/items/group-actions/declare',
      extendedActions: '/api/items/extended-actions',
      formChanges: '/api/items/form-changes',
      exploration: '/api/items/exploration',
      guided: '/api/items/guided',
      equipmentActions: '/api/items/equipment-actions',
    })
  })

  it('exposes map API paths', () => {
    expect(MAP_API_PATHS).toEqual({
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
      executeCapabilityAction: '/api/maps/capabilities/execute',
      resolveCapabilityAdjudication: '/api/maps/capabilities/adjudications/resolve',
      declareEncounterAction: '/api/maps/encounter-actions/declarations',
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
    })
  })

  it('exposes sheet API paths', () => {
    expect(SHEET_API_PATHS).toEqual({
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
    })
  })

  it('exposes Campaign Toolkit NPC and package paths', () => {
    expect(GM_TOOLKIT_API_PATHS.npcArchetypes).toBe('/api/gm-toolkit/npc-archetypes')
    expect(GM_TOOLKIT_API_PATHS.npcGeneration).toBe('/api/gm-toolkit/npc-generation')
    expect(GM_TOOLKIT_API_PATHS.npcPackage('npc-package:v1:abc')).toBe('/api/gm-toolkit/packages/npc/npc-package%3Av1%3Aabc')
    expect(GM_TOOLKIT_API_PATHS.wildPackage('wild-package:v1:abc')).toBe('/api/gm-toolkit/packages/wild/wild-package%3Av1%3Aabc')
    expect(GM_TOOLKIT_API_PATHS.sessionPreparations).toBe('/api/gm-toolkit/session-preparations/list')
    expect(GM_TOOLKIT_API_PATHS.sessionPreparation('session-preparation:v1:abc')).toBe('/api/gm-toolkit/session-preparations/session-preparation%3Av1%3Aabc')
    expect(GM_TOOLKIT_API_PATHS.mutateSessionPreparation).toBe('/api/gm-toolkit/session-preparations/mutate')
  })

  it('exposes encounter API paths', () => {
    expect(ENCOUNTER_API_PATHS).toMatchObject({
      list: '/api/encounters/list',
      generate: '/api/encounters/generate',
      create: '/api/encounters/create',
      save: '/api/encounters/save',
      archive: '/api/encounters/archive',
      restore: '/api/encounters/restore',
      copy: '/api/encounters/copy',
      import: '/api/encounters/import',
    })
    expect(ENCOUNTER_API_PATHS).not.toHaveProperty('spawn')
  })

  it('exposes pokedex API paths', () => {
    expect(POKEDEX_API_PATHS).toEqual({
      index: '/api/pokedex',
      detail: '/api/pokedex/detail',
      searchIndex: '/api/pokedex/search-index',
      profilePriority: '/api/pokedex/profile-priority',
      update: '/api/pokedex/update',
      restoreFromBooks: '/api/pokedex/restore-from-books',
      updateProfileImage: '/api/pokedex/profile-image',
    })
  })
})

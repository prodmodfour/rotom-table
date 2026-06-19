import { describe, expect, it } from 'vitest'
import {
  API_EVENTS_PATH,
  CAMPAIGN_API_PATHS,
  ENCOUNTER_API_PATHS,
  MAP_API_PATHS,
  PLAYER_PROFILE_API_PATHS,
  POKEDEX_API_PATHS,
  SESSION_API_PATHS,
  SHEET_API_PATHS,
} from '~/utils/apiRoutes'

describe('API route constants', () => {
  it('exposes the realtime events path', () => {
    expect(API_EVENTS_PATH).toBe('/api/events')
  })

  it('exposes campaign API paths', () => {
    expect(CAMPAIGN_API_PATHS).toEqual({
      nextDay: '/api/campaign/next-day',
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

  it('exposes map API paths', () => {
    expect(MAP_API_PATHS).toEqual({
      list: '/api/maps/list',
      folders: '/api/maps/folders',
      load: '/api/maps/load',
      save: '/api/maps/save',
      interactionMode: '/api/maps/interaction-mode',
      useMove: '/api/maps/use-move',
      actionEvent: '/api/maps/action-event',
      spawnToken: '/api/maps/tokens/spawn',
      sendOutPokemon: '/api/maps/tokens/send-out',
      deleteToken: '/api/maps/tokens/delete',
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
      buildTerrainVoxel: '/api/maps/terrain/build',
      removeTerrainVoxel: '/api/maps/terrain/remove',
      setFieldEffect: '/api/maps/field-effects/set',
      removeFieldEffect: '/api/maps/field-effects/remove',
      tickFieldEffectDurations: '/api/maps/field-effects/tick',
      updateAttackOfOpportunity: '/api/maps/attack-of-opportunity/update',
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

  it('exposes encounter API paths', () => {
    expect(ENCOUNTER_API_PATHS).toEqual({
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
    })
  })

  it('exposes pokedex API paths', () => {
    expect(POKEDEX_API_PATHS).toEqual({
      index: '/api/pokedex',
      detail: '/api/pokedex/detail',
      searchIndex: '/api/pokedex/search-index',
      update: '/api/pokedex/update',
      restoreFromBooks: '/api/pokedex/restore-from-books',
    })
  })
})

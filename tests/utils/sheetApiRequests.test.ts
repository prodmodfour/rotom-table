import { describe, expect, it } from 'vitest'
import { parsePlayerProfileId } from '#shared/playerProfiles'
import {
  buildSheetListFetchOptions,
  buildSheetLoadQuery,
  buildSheetSaveBody,
  PLAYER_PROFILE_INVALID_FOR_SHEET_REQUEST_MESSAGE,
  PLAYER_PROFILE_REQUIRED_FOR_LINKED_SHEET_MESSAGE,
  requireSelectedPlayerProfileIdForSheetRequest,
  selectedPlayerProfileIdForSheetRequest,
  sheetApiProfileContext,
} from '~/utils/sheetApiRequests'

const profileId = parsePlayerProfileId('profile_ash00000')

describe('sheet API profile request helpers', () => {
  it('adds the selected profile id to player sheet load queries', () => {
    expect(buildSheetLoadQuery({
      kind: 'pokemon',
      slug: 'pikachu',
      profileContext: sheetApiProfileContext(true, profileId),
    })).toEqual({ kind: 'pokemon', slug: 'pikachu', profileId })
  })

  it('omits profile ids for GM sheet requests and players without a selection', () => {
    expect(buildSheetLoadQuery({
      kind: 'trainer',
      slug: 'brock',
      profileContext: sheetApiProfileContext(false, profileId),
    })).toEqual({ kind: 'trainer', slug: 'brock' })
    expect(buildSheetListFetchOptions(sheetApiProfileContext(true, null))).toBeUndefined()
  })

  it('builds profile-aware sheet list options for players', () => {
    expect(buildSheetListFetchOptions(sheetApiProfileContext(true, profileId))).toEqual({
      params: { profileId },
    })
  })

  it('adds the selected profile id to player sheet save bodies', () => {
    expect(buildSheetSaveBody({
      kind: 'pokemon',
      slug: 'pikachu',
      sheet: { slug: 'pikachu', nickname: 'Pikachu' },
      clientId: 'client-1',
      profileContext: sheetApiProfileContext(true, profileId),
    })).toEqual({
      kind: 'pokemon',
      slug: 'pikachu',
      sheet: { slug: 'pikachu', nickname: 'Pikachu' },
      clientId: 'client-1',
      profileId,
    })
  })

  it('can explicitly disable display-name slug sync on save bodies', () => {
    expect(buildSheetSaveBody({
      kind: 'pokemon',
      slug: 'examples-abra',
      sheet: { slug: 'examples-abra', nickname: 'Abra' },
      allowSlugSync: false,
    })).toEqual({
      kind: 'pokemon',
      slug: 'examples-abra',
      sheet: { slug: 'examples-abra', nickname: 'Abra' },
      allowSlugSync: false,
    })
  })

  it('validates selected profile ids instead of forwarding arbitrary strings', () => {
    expect(() => selectedPlayerProfileIdForSheetRequest(sheetApiProfileContext(true, 'not-a-profile')))
      .toThrow(PLAYER_PROFILE_INVALID_FOR_SHEET_REQUEST_MESSAGE)
  })

  it('reports a clear missing-profile error when a linked sheet requires a profile', () => {
    expect(() => requireSelectedPlayerProfileIdForSheetRequest(sheetApiProfileContext(true, null)))
      .toThrow(PLAYER_PROFILE_REQUIRED_FOR_LINKED_SHEET_MESSAGE)
    expect(() => buildSheetSaveBody({
      kind: 'trainer',
      slug: 'misty',
      sheet: { slug: 'misty', name: 'Misty' },
      profileContext: sheetApiProfileContext(true, undefined),
      requireSelectedPlayerProfile: true,
    })).toThrow(PLAYER_PROFILE_REQUIRED_FOR_LINKED_SHEET_MESSAGE)
  })
})

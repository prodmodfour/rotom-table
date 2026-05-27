import { describe, expect, it } from 'vitest'
import {
  PLAYER_PROFILE_GM_ONLY_PATH_PREFIXES,
  PLAYER_PROFILE_MANAGEMENT_PATH,
  isPlayerProfileManagementPath,
  playerProfileManagementPath,
} from '~/utils/playerProfileRoutes'

describe('player profile routes', () => {
  it('exposes the GM-only player profile management route', () => {
    expect(PLAYER_PROFILE_MANAGEMENT_PATH).toBe('/player-profiles')
    expect(playerProfileManagementPath()).toBe('/player-profiles')
    expect(PLAYER_PROFILE_GM_ONLY_PATH_PREFIXES).toEqual(['/player-profiles'])
  })

  it('recognizes the management route and nested management paths', () => {
    expect(isPlayerProfileManagementPath('/player-profiles')).toBe(true)
    expect(isPlayerProfileManagementPath('/player-profiles/profile_ash00000')).toBe(true)
    expect(isPlayerProfileManagementPath('/player-profiles-other')).toBe(false)
    expect(isPlayerProfileManagementPath('/maps')).toBe(false)
  })
})

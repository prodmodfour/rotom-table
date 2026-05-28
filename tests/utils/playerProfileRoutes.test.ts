import { describe, expect, it } from 'vitest'
import {
  PLAYER_PROFILE_GM_ONLY_PATH_PREFIXES,
  PLAYER_PROFILE_MANAGEMENT_PATH,
  isPlayerProfileManagementPath,
  playerProfileManagementPath,
} from '~/utils/playerProfileRoutes'

describe('player profile routes', () => {
  it('exposes the GM-only player management route', () => {
    expect(PLAYER_PROFILE_MANAGEMENT_PATH).toBe('/players')
    expect(playerProfileManagementPath()).toBe('/players')
    expect(PLAYER_PROFILE_GM_ONLY_PATH_PREFIXES).toEqual(['/players'])
  })

  it('recognizes the management route and nested management paths', () => {
    expect(isPlayerProfileManagementPath('/players')).toBe(true)
    expect(isPlayerProfileManagementPath('/players/profile_ash00000')).toBe(true)
    expect(isPlayerProfileManagementPath('/players-other')).toBe(false)
    expect(isPlayerProfileManagementPath('/maps')).toBe(false)
  })
})

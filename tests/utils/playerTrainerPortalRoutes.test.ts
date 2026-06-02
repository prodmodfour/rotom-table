import { describe, expect, it } from 'vitest'
import {
  isPlayerTrainerPortalPath,
  playerTrainerPortalPath,
  PLAYER_TRAINER_PORTAL_PATH,
} from '~/utils/playerTrainerPortalRoutes'

describe('player trainer portal routes', () => {
  it('exposes the player trainer portal path helpers', () => {
    expect(PLAYER_TRAINER_PORTAL_PATH).toBe('/trainers')
    expect(playerTrainerPortalPath()).toBe('/trainers')
    expect(isPlayerTrainerPortalPath('/trainers')).toBe(true)
    expect(isPlayerTrainerPortalPath('/trainers/party')).toBe(true)
    expect(isPlayerTrainerPortalPath('/sheets')).toBe(false)
  })
})

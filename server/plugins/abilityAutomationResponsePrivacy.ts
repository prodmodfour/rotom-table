import { getAuthRole } from '../utils/auth'
import { projectAbilityAutomationJsonForPlayer } from '../domain/abilityAutomation/realtimeProjection'

/**
 * Defense-in-depth for player HTTP responses. Individual read use cases still
 * project their typed results, while this hook catches complete authoritative
 * maps nested in accepted live-play command responses.
 */
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('beforeResponse', (event, response) => {
    if (getAuthRole(event) !== 'player') return
    response.body = projectAbilityAutomationJsonForPlayer(response.body)
  })
})

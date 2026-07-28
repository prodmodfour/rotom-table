import { createError, defineEventHandler } from 'h3'
import { requireAuthRole } from '../../../utils/auth'
import { requireWritableCampaignMode } from '../../../utils/http'

/**
 * Compatibility tombstone for clients that predate the native AbilitySpec
 * declaration and resolution routes. This endpoint must never parse or apply
 * the former client-authored ability transaction.
 */
export default defineEventHandler((event) => {
  requireAuthRole(event)
  requireWritableCampaignMode()
  throw createError({
    statusCode: 410,
    statusMessage: 'Legacy useAbility execution is retired; use the native Ability declaration and resolution routes.',
  })
})

/**
 * GET /api/events
 *
 * Server-Sent Events endpoint. The browser opens one EventSource per
 * tab; the server pipes every realtime event through it. Clients filter
 * locally by channel — keeps the wire format trivial and avoids needing
 * to renegotiate subscriptions when a page's interest set changes.
 *
 * The connection is held open with a keepalive comment every 15s so
 * proxies don't time it out.
 */
import { defineEventHandler } from 'h3'
import { requireAuthRole } from '../utils/auth'
import { subscribeRealtime } from '../utils/realtime'
import { openSseEventStream } from '../utils/sseStream'

export default defineEventHandler(async (event) => {
  requireAuthRole(event)

  await openSseEventStream({
    req: event.node.req,
    res: event.node.res,
    subscribe: subscribeRealtime,
  })
})

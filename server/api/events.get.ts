/**
 * GET /api/events
 *
 * Server-Sent Events endpoint. The browser opens one EventSource per
 * tab; the server pipes every realtime event through it. Clients filter
 * locally by channel — keeps the wire format trivial and avoids needing
 * to renegotiate subscriptions when a page's interest set changes.
 *
 * The connection is held open with a heartbeat comment every 15s so
 * proxies do not time it out. Server logs record each SSE connect and
 * disconnect; reconnecting browsers open a fresh stream and live-play
 * clients reconcile authoritative revisions before sending commands.
 */
import { defineEventHandler } from 'h3'
import { requireAuthRole } from '../utils/auth'
import { subscribeRealtime } from '../utils/realtime'
import { openSseEventStream } from '../utils/sseStream'

export default defineEventHandler(async (event) => {
  const role = requireAuthRole(event)

  await openSseEventStream({
    req: event.node.req,
    res: event.node.res,
    subscribe: subscribeRealtime,
    connectionLabel: `role:${role}`,
  })
})

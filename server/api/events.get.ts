/**
 * GET /api/events
 *
 * Authorised Server-Sent Events endpoint. Durable realtime rows are delivered
 * from the SQLite event log, optionally replaying after a client cursor, and
 * every durable or transient event is filtered against its explicit access
 * descriptor before anything is written to the socket.
 */
import { defineEventHandler } from 'h3'
import { resolveH3RealtimeConnectionContext } from '../realtime/realtimeDeliveryPrincipal'
import { openRealtimeSseStream } from '../realtime/realtimeSseDelivery'

export default defineEventHandler(async (event) => {
  const { request, principal } = resolveH3RealtimeConnectionContext(event)

  await openRealtimeSseStream({
    req: event.node.req,
    res: event.node.res,
    cursor: request.cursor,
    principal,
    connectionLabel: `role:${principal.role}`,
  })
})

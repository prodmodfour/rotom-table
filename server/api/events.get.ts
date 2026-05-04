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

export default defineEventHandler(async (event) => {
  requireAuthRole(event)
  const res = event.node.res
  const req = event.node.req

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  // Disable proxy buffering (nginx, vite dev server middlewares).
  res.setHeader('X-Accel-Buffering', 'no')
  if (typeof res.flushHeaders === 'function') res.flushHeaders()

  // Initial comment so the browser flushes the response head and fires
  // ``onopen`` immediately.
  res.write(': ok\n\n')

  const unsubscribe = subscribeRealtime((evt) => {
    try {
      res.write(`data: ${JSON.stringify(evt)}\n\n`)
    } catch (err) {
      console.error('[events] write failed', err)
    }
  })

  const keepalive = setInterval(() => {
    try {
      res.write(': ping\n\n')
    } catch {
      /* socket already gone — close handler will clean up */
    }
  }, 15000)

  await new Promise<void>((resolve) => {
    const cleanup = () => {
      clearInterval(keepalive)
      unsubscribe()
      resolve()
    }
    req.on('close', cleanup)
    req.on('error', cleanup)
  })
})

/**
 * WebSocket /api/sessions/socket
 *
 * Skeleton Track 2 session socket endpoint. The upgrade fails closed unless
 * ROTOM_ENABLE_SESSION_HOST=1 is set. The current slice only records raw
 * connect/disconnect lifecycle for later hello/auth, heartbeat, reconnect, and
 * command fanout tickets; it does not grant map-edit authority.
 */
import { defineWebSocketHandler } from 'h3'
import {
  handleSessionSocketClose,
  handleSessionSocketError,
  handleSessionSocketMessage,
  handleSessionSocketOpen,
  handleSessionSocketUpgrade,
} from '../../utils/sessionWebSocketServer'

export default defineWebSocketHandler({
  upgrade: handleSessionSocketUpgrade,
  open(peer) {
    handleSessionSocketOpen(peer)
  },
  message: handleSessionSocketMessage,
  close(peer, details) {
    handleSessionSocketClose(peer, details)
  },
  error: handleSessionSocketError,
})

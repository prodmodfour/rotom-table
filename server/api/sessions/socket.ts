/**
 * WebSocket /api/sessions/socket
 *
 * Track 2 session socket endpoint. The upgrade fails closed unless
 * ROTOM_ENABLE_SESSION_HOST=1 is set. The current slice validates the initial
 * GM/player hello identity before a socket is associated with a session. Later
 * tickets add heartbeat, reconnect snapshot fallback, command dispatch, and
 * session fanout; this route still does not grant map-edit authority by itself.
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

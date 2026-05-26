/**
 * Session socket /api/sessions/socket
 *
 * Live session socket endpoint. The upgrade fails closed unless
 * ROTOM_ENABLE_SESSION_HOST=1 is set. The route validates the initial
 * GM/player hello identity before a socket is associated with a live session,
 * keeps authenticated sockets alive with app-level heartbeat ping/pong frames,
 * sends reconnect snapshot fallback when replay is unavailable, dispatches
 * server-authoritative session commands for token, sheet, initiative, hazard,
 * field-effect, and terrain actions, and fans out presence plus accepted
 * patches only to authenticated peers in the same live session.
 * This route still does not grant map-edit authority by itself.
 */
import { defineWebSocketHandler } from 'h3'
import {
  handleSessionSocketClose,
  handleSessionSocketError,
  handleSessionSocketMessage,
  handleSessionSocketOpen,
  handleSessionSocketUpgrade,
  startSessionSocketHeartbeatTimer,
  stopSessionSocketHeartbeatTimer,
} from '../../utils/sessionWebSocketServer'
import { sessionSocketPeers } from '../../utils/sessionWebSocketFanout'

const sessionSocketRouteDependencies = {
  peers: sessionSocketPeers,
}

export default defineWebSocketHandler({
  upgrade: handleSessionSocketUpgrade,
  open(peer) {
    const connection = handleSessionSocketOpen(peer, sessionSocketRouteDependencies)
    if (connection !== undefined) startSessionSocketHeartbeatTimer(peer, sessionSocketRouteDependencies)
  },
  message(peer, message) {
    handleSessionSocketMessage(peer, message, sessionSocketRouteDependencies)
  },
  close(peer, details) {
    stopSessionSocketHeartbeatTimer(peer.id)
    handleSessionSocketClose(peer, details, sessionSocketRouteDependencies)
  },
  error: handleSessionSocketError,
})

/**
 * WebSocket /api/sessions/socket
 *
 * Track 2 session socket endpoint. The upgrade fails closed unless
 * ROTOM_ENABLE_SESSION_HOST=1 is set. The current slice validates the initial
 * GM/player hello identity before a socket is associated with a session and
 * keeps authenticated sockets alive with app-level heartbeat ping/pong frames,
 * sends reconnect snapshot fallback when replay is unavailable, dispatches
 * server-authoritative moveToken, turnToken, spawnToken, deleteToken, sendOutPokemon, modifyHp, modifyCombatStages, modifyConditions,
 * useMove, useManeuver, useAbility, useOrder, setInitiative, nextInitiative, and previousInitiative commands,
 * and fans out server presence plus accepted tokenMoved/tokenTurned/tokenSpawned/tokenDeleted/pokemonSentOut/hpModified/combatStagesModified/conditionsModified/moveUsed/maneuverUsed/abilityUsed/orderUsed/initiativeUpdated
 * patches only to authenticated peers in the same session.
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

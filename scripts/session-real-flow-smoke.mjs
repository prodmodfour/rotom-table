#!/usr/bin/env node
import { rmSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'

export const DEFAULT_BASE_URL = 'http://localhost:3000'
export const DEFAULT_TIMEOUT_MS = 8_000
export const DEFAULT_SMOKE_MAP_NAME = 'Live Session Smoke Map'
export const DEFAULT_TOKEN_ID = 'token-live-session-smoke-a'
export const DEFAULT_SECOND_TOKEN_ID = 'token-live-session-smoke-b'
export const DEFAULT_TARGET_POSITION = Object.freeze({ x: 2, y: 0, z: 2 })
export const SESSION_HOST_ENABLE_ENV = 'ROTOM_ENABLE_SESSION_HOST'
export const SESSION_HOST_ENABLE_VALUE = '1'
export const AUTH_ROLE_COOKIE = 'rotom-role'

export const SESSION_API_PATHS = Object.freeze({
  start: '/api/sessions/start',
  join: '/api/sessions/join',
  manage: '/api/sessions/manage',
  playerState: '/api/sessions/player-state',
  assignments: '/api/sessions/assignments',
  attachMap: '/api/sessions/maps/attach',
  socket: '/api/sessions/socket',
})

export const MAP_API_PATHS = Object.freeze({
  create: '/api/maps/create',
  load: '/api/maps/load',
  save: '/api/maps/save',
  deleteMap: '/api/maps/delete',
})

export const SESSION_MESSAGE_SCHEMA_VERSION = 1
export const SESSION_COMMAND_ENVELOPE_VERSION = 1
export const MOVE_TOKEN_COMMAND_TYPE = 'moveToken'
export const MOVE_TOKEN_COMMAND_SCOPE_FIELD = 'position'

const SLUG_RE = /^[a-z0-9-]+$/
const OP_ID_SAFE_RE = /[^A-Za-z0-9_-]/g
const SECRET_REPLACEMENTS = [
  { pattern: /gmkey_[A-Za-z0-9_-]{24,128}/g, replacement: '[redacted-gm-key]' },
  { pattern: /\b[A-HJ-NP-Z2-9]{6,12}\b/g, replacement: '[redacted-join-code]' },
]

const HELP_TEXT = `Live session real-flow smoke helper

Usage:
  npm run smoke:session:real-flow -- [options]

Start Rotom Table in another terminal first:
  npm run dev:session:lan

Options:
  --base-url <url>       Rotom Table origin. Default: ${DEFAULT_BASE_URL}
  --map <slug>           Use an existing saved map instead of creating a temporary smoke map.
  --token <id>           Token placement ID to assign and move. Default: first token on an existing map, or ${DEFAULT_TOKEN_ID} on the generated smoke map.
  --to <x,y,z>           Target token grid position. Default: ${DEFAULT_TARGET_POSITION.x},${DEFAULT_TARGET_POSITION.y},${DEFAULT_TARGET_POSITION.z}
  --player-a <name>      Display name for the assigned player. Default: Player A
  --player-b <name>      Display name for the visible-only reconnect player. Default: Player B
  --timeout-ms <ms>      HTTP/session socket wait timeout. Default: ${DEFAULT_TIMEOUT_MS}
  --keep-smoke-map       Do not delete the temporary map created by this helper.
  --keep-session-data    Do not remove data/sessions/<session-id> after the smoke.
  --dry-run              Print the no-secret plan without contacting Rotom Table.
  --help                 Show this help.

The helper starts a GM session, attaches a saved map, joins two players, assigns one token,
opens live session sockets, sends an accepted player move command, verifies patch fanout,
reconnects the second player for a snapshot fallback, and cleans up local smoke data when possible.
It never prints GM keys or join codes.
`

export class SessionFlowSmokeCliError extends Error {
  constructor(message) {
    super(message)
    this.name = 'SessionFlowSmokeCliError'
  }
}

export class SessionFlowSmokeRuntimeError extends Error {
  constructor(message, options = {}) {
    super(message)
    this.name = 'SessionFlowSmokeRuntimeError'
    this.status = options.status
    this.details = options.details
  }
}

const ensureStringValue = (args, index, flag) => {
  const value = args[index + 1]
  if (value === undefined || value.startsWith('--')) {
    throw new SessionFlowSmokeCliError(`${flag} requires a value`)
  }
  return value
}

const parsePositiveInteger = (value, flag) => {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new SessionFlowSmokeCliError(`${flag} must be a positive integer`)
  }
  return parsed
}

const parsePositionValue = (value, flag = '--to') => {
  const parts = String(value).split(',').map((part) => part.trim())
  if (parts.length !== 3) {
    throw new SessionFlowSmokeCliError(`${flag} must use x,y,z format`)
  }

  const [x, y, z] = parts.map((part) => Number(part))
  if (![x, y, z].every((part) => Number.isSafeInteger(part) && part >= 0)) {
    throw new SessionFlowSmokeCliError(`${flag} coordinates must be safe non-negative integers`)
  }
  return { x, y, z }
}

const normalizeDisplayName = (value, flag) => {
  const name = String(value ?? '').normalize('NFKC').replace(/[<>]/g, '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/[\s\u00A0]+/g, ' ').trim()
  if (name.length === 0) throw new SessionFlowSmokeCliError(`${flag} cannot be empty`)
  if (Array.from(name).length > 32) throw new SessionFlowSmokeCliError(`${flag} must be 32 characters or fewer`)
  return name
}

export const parseSessionFlowSmokeCliArgs = (args) => {
  const options = {
    baseUrl: DEFAULT_BASE_URL,
    mapSlug: null,
    tokenId: null,
    targetPosition: { ...DEFAULT_TARGET_POSITION },
    playerNames: ['Player A', 'Player B'],
    timeoutMs: DEFAULT_TIMEOUT_MS,
    keepSmokeMap: false,
    cleanupSessionData: true,
    dryRun: false,
    help: false,
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    switch (arg) {
      case '--base-url':
        options.baseUrl = ensureStringValue(args, index, arg)
        index += 1
        break
      case '--map':
      case '--map-slug':
        options.mapSlug = ensureStringValue(args, index, arg)
        index += 1
        break
      case '--token':
      case '--token-id':
        options.tokenId = ensureStringValue(args, index, arg)
        index += 1
        break
      case '--to':
        options.targetPosition = parsePositionValue(ensureStringValue(args, index, arg), arg)
        index += 1
        break
      case '--player-a':
        options.playerNames = [normalizeDisplayName(ensureStringValue(args, index, arg), arg), options.playerNames[1]]
        index += 1
        break
      case '--player-b':
        options.playerNames = [options.playerNames[0], normalizeDisplayName(ensureStringValue(args, index, arg), arg)]
        index += 1
        break
      case '--timeout-ms':
        options.timeoutMs = parsePositiveInteger(ensureStringValue(args, index, arg), arg)
        index += 1
        break
      case '--keep-smoke-map':
        options.keepSmokeMap = true
        break
      case '--keep-session-data':
        options.cleanupSessionData = false
        break
      case '--dry-run':
        options.dryRun = true
        break
      case '--help':
      case '-h':
        options.help = true
        break
      default:
        throw new SessionFlowSmokeCliError(`Unknown option: ${arg}`)
    }
  }

  return options
}

export const normalizeBaseUrl = (baseUrl = DEFAULT_BASE_URL) => {
  const trimmed = String(baseUrl).trim()
  if (trimmed.length === 0) throw new SessionFlowSmokeCliError('--base-url cannot be empty')

  let parsed
  try {
    parsed = new URL(trimmed)
  } catch (error) {
    throw new SessionFlowSmokeCliError(`--base-url must be an absolute http(s) URL: ${error.message}`)
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new SessionFlowSmokeCliError('--base-url must use http:// or https://')
  }

  parsed.pathname = parsed.pathname.replace(/\/+$/, '')
  parsed.search = ''
  parsed.hash = ''
  return parsed.toString().replace(/\/$/, '')
}

export const normalizeMapSlug = (mapSlug) => {
  if (mapSlug === null || mapSlug === undefined) return null
  const normalized = String(mapSlug).trim().replace(/^\/+|\/+$/g, '')
  if (!SLUG_RE.test(normalized)) {
    throw new SessionFlowSmokeCliError('--map must match /^[a-z0-9-]+$/')
  }
  return normalized
}

export const normalizeTokenId = (tokenId, fallback = null) => {
  if (tokenId === null || tokenId === undefined || tokenId === '') return fallback
  const normalized = String(tokenId).trim()
  if (normalized.length === 0) throw new SessionFlowSmokeCliError('--token cannot be empty')
  return normalized
}

export const resolveApiUrl = (baseUrl, pathAndQuery) => new URL(pathAndQuery, `${normalizeBaseUrl(baseUrl)}/`).toString()

export const resolveSessionSocketUrl = (baseUrl = DEFAULT_BASE_URL) => {
  const socketUrl = new URL(SESSION_API_PATHS.socket, `${normalizeBaseUrl(baseUrl)}/`)
  socketUrl.protocol = socketUrl.protocol === 'https:' ? 'wss:' : 'ws:'
  return socketUrl.toString()
}

export const buildSessionFlowSmokePlan = (input = {}) => {
  const baseUrl = normalizeBaseUrl(input.baseUrl ?? DEFAULT_BASE_URL)
  const mapSlug = normalizeMapSlug(input.mapSlug ?? null)
  const generatedMap = mapSlug === null
  const tokenId = normalizeTokenId(input.tokenId ?? null, generatedMap ? DEFAULT_TOKEN_ID : null)
  const timeoutMs = parsePositiveInteger(String(input.timeoutMs ?? DEFAULT_TIMEOUT_MS), 'timeoutMs')
  const targetPosition = input.targetPosition ?? DEFAULT_TARGET_POSITION
  const playerNames = input.playerNames ?? ['Player A', 'Player B']

  return {
    baseUrl,
    socketUrl: resolveSessionSocketUrl(baseUrl),
    mapSlug,
    generatedMap,
    tokenId,
    targetPosition: parsePositionValue(`${targetPosition.x},${targetPosition.y},${targetPosition.z}`, 'targetPosition'),
    playerNames: [
      normalizeDisplayName(playerNames[0] ?? 'Player A', 'playerNames[0]'),
      normalizeDisplayName(playerNames[1] ?? 'Player B', 'playerNames[1]'),
    ],
    timeoutMs,
    keepSmokeMap: input.keepSmokeMap === true,
    cleanupSessionData: input.cleanupSessionData !== false,
    api: {
      start: resolveApiUrl(baseUrl, SESSION_API_PATHS.start),
      join: resolveApiUrl(baseUrl, SESSION_API_PATHS.join),
      manage: resolveApiUrl(baseUrl, SESSION_API_PATHS.manage),
      playerState: resolveApiUrl(baseUrl, SESSION_API_PATHS.playerState),
      assignments: resolveApiUrl(baseUrl, SESSION_API_PATHS.assignments),
      attachMap: resolveApiUrl(baseUrl, SESSION_API_PATHS.attachMap),
      createMap: resolveApiUrl(baseUrl, MAP_API_PATHS.create),
      saveMap: resolveApiUrl(baseUrl, MAP_API_PATHS.save),
      deleteMap: resolveApiUrl(baseUrl, MAP_API_PATHS.deleteMap),
      loadMap: (slug) => resolveApiUrl(baseUrl, `${MAP_API_PATHS.load}?slug=${encodeURIComponent(slug)}`),
    },
  }
}

export const createSmokeMapDocument = (createdMap, options = {}) => {
  const tokenId = normalizeTokenId(options.tokenId, DEFAULT_TOKEN_ID)
  const secondTokenId = normalizeTokenId(options.secondTokenId, DEFAULT_SECOND_TOKEN_ID)
  const now = typeof options.now === 'number' ? options.now : Date.now()
  const dimensions = createdMap?.dimensions ?? { x: 8, y: 2, z: 8 }

  return {
    schemaVersion: 2,
    ...createdMap,
    slug: createdMap.slug,
    name: createdMap.name ?? DEFAULT_SMOKE_MAP_NAME,
    dimensions,
    groundLevelY: 0,
    playerVisible: true,
    voxels: Array.isArray(createdMap.voxels) ? createdMap.voxels : [],
    hazards: Array.isArray(createdMap.hazards) ? createdMap.hazards : [],
    fieldEffects: createdMap.fieldEffects ?? { weather: [], terrains: [], rooms: [] },
    placements: [
      {
        id: tokenId,
        sheetKind: 'pokemon',
        sheetSlug: 'pikachu',
        position: { x: 1, y: 0, z: 1 },
        facing: 'south-east',
        initiative: 20,
      },
      {
        id: secondTokenId,
        sheetKind: 'pokemon',
        sheetSlug: 'eevee',
        position: { x: 4, y: 0, z: 1 },
        facing: 'south-west',
        initiative: 12,
      },
    ],
    lights: Array.isArray(createdMap.lights) ? createdMap.lights : [],
    initiative: { activeId: tokenId, round: 1 },
    moveUsage: createdMap.moveUsage ?? { byPlacementId: {} },
    metadata: {
      ...(createdMap.metadata && typeof createdMap.metadata === 'object' ? createdMap.metadata : {}),
      smoke: 'live-session-real-flow',
    },
    createdAt: createdMap.createdAt ?? now,
    updatedAt: now,
  }
}

/**
 * @param {Record<string, any>} map
 * @param {string | null} [preferredTokenId]
 */
export const resolveSmokeTokenResource = (map, preferredTokenId = null) => {
  const placements = Array.isArray(map?.placements) ? map.placements : []
  const placement = preferredTokenId === null
    ? placements.find((candidate) => typeof candidate?.id === 'string' && candidate.id.length > 0)
    : placements.find((candidate) => candidate?.id === preferredTokenId)

  if (placement === undefined) {
    const suffix = preferredTokenId === null ? 'with a non-empty id' : `matching token ID ${preferredTokenId}`
    throw new SessionFlowSmokeRuntimeError(`The smoke map must contain a token placement ${suffix}.`)
  }

  const resource = {
    kind: 'token',
    tokenId: placement.id,
    mapSlug: map.slug,
  }
  if (placement.sheetKind === 'pokemon' || placement.sheetKind === 'trainer') resource.sheetKind = placement.sheetKind
  if (typeof placement.sheetSlug === 'string' && placement.sheetSlug.trim().length > 0) resource.sheetSlug = placement.sheetSlug
  return resource
}

export const createMoveTokenCommandMessage = ({ sessionId, actor, tokenResource, baseRevision, to, opId }) => ({
  schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
  type: 'command',
  direction: 'client',
  sessionId,
  command: {
    schemaVersion: SESSION_COMMAND_ENVELOPE_VERSION,
    sessionId,
    actor,
    type: MOVE_TOKEN_COMMAND_TYPE,
    opId,
    baseRevision,
    scopes: [
      {
        lane: 'token',
        resource: { ...tokenResource },
        field: MOVE_TOKEN_COMMAND_SCOPE_FIELD,
        ...(tokenResource.mapSlug === undefined ? {} : { mapSlug: tokenResource.mapSlug }),
      },
    ],
    payload: {
      tokenId: tokenResource.tokenId,
      to,
    },
    metadata: {
      traceId: 'trace-live-session-real-flow-smoke',
    },
  },
})

export const createSessionHelloMessage = ({ sessionId, identity, reconnect = false, lastSeenRevision }) => ({
  schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
  type: 'hello',
  direction: 'client',
  sessionId,
  identity,
  reconnect,
  ...(lastSeenRevision === undefined ? {} : { lastSeenRevision }),
})

export const createSmokeOpId = (prefix = 'op_live_session_smoke') => {
  const randomPart = `${Date.now()}_${Math.random().toString(36).slice(2)}`.replace(OP_ID_SAFE_RE, '')
  return `${prefix}_${randomPart}`.slice(0, 96)
}

export const redactSessionSecrets = (value) => {
  let text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  if (text === undefined) text = String(value)
  for (const { pattern, replacement } of SECRET_REPLACEMENTS) text = text.replace(pattern, replacement)
  return text
}

export const redactIdentifier = (value) => {
  const text = String(value ?? '')
  if (text.length <= 10) return text.length === 0 ? '<unknown>' : '<redacted>'
  return `${text.slice(0, text.indexOf('_') + 1 || 8)}…${text.slice(-4)}`
}

const assertFetchAvailable = (fetchImpl) => {
  if (typeof fetchImpl !== 'function') {
    throw new SessionFlowSmokeRuntimeError('global fetch is required to run the live session smoke helper.')
  }
}

const roleCookieHeader = (role) => `${AUTH_ROLE_COOKIE}=${encodeURIComponent(role)}`

const readJsonResponse = async (response) => {
  const text = await response.text()
  if (text.trim().length === 0) return null
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new SessionFlowSmokeRuntimeError(`Expected JSON response but received invalid JSON: ${error.message}`)
  }
}

export const createHttpClient = (plan, dependencies = {}) => {
  const fetchImpl = dependencies.fetchImpl ?? globalThis.fetch
  assertFetchAvailable(fetchImpl)

  const requestJson = async (method, url, body, options = {}) => {
    const headers = {
      accept: 'application/json',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(options.role === undefined ? {} : { cookie: roleCookieHeader(options.role) }),
    }
    const response = await fetchImpl(url, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const parsed = await readJsonResponse(response)
    if (!response.ok) {
      const message = parsed?.statusMessage ?? parsed?.message ?? response.statusText ?? `HTTP ${response.status}`
      throw new SessionFlowSmokeRuntimeError(
        redactSessionSecrets(`${method} ${new URL(url).pathname} failed (${response.status}): ${message}`),
        { status: response.status, details: parsed },
      )
    }
    return parsed
  }

  return {
    getJson: (url, options) => requestJson('GET', url, undefined, options),
    postJson: (url, body, options) => requestJson('POST', url, body, options),
    plan,
  }
}

const decodeWebSocketData = async (data) => {
  if (typeof data === 'string') return data
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8')
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('utf8')
  if (typeof Blob !== 'undefined' && data instanceof Blob) return data.text()
  return String(data)
}

const clearTimer = (timer) => {
  if (timer !== undefined) clearTimeout(timer)
}

export const openSessionSocketClient = async ({ label, socketUrl, hello, timeoutMs, WebSocketCtor = globalThis.WebSocket }) => {
  if (typeof WebSocketCtor !== 'function') {
    throw new SessionFlowSmokeRuntimeError('global WebSocket is required to run the live session smoke helper on Node 22 or newer.')
  }

  const socket = new WebSocketCtor(socketUrl)
  const messages = []
  const waiters = []
  let closed = false
  let closeReason = ''

  const rejectAll = (error) => {
    while (waiters.length > 0) {
      const waiter = waiters.shift()
      clearTimer(waiter.timer)
      waiter.reject(error)
    }
  }

  const deliverMessage = (message) => {
    messages.push(message)
    for (let index = 0; index < waiters.length; index += 1) {
      const waiter = waiters[index]
      if (!waiter.predicate(message)) continue
      waiters.splice(index, 1)
      clearTimer(waiter.timer)
      waiter.resolve(message)
      break
    }
  }

  socket.addEventListener('message', async (event) => {
    try {
      const text = await decodeWebSocketData(event.data)
      deliverMessage(JSON.parse(text))
    } catch (error) {
      rejectAll(new SessionFlowSmokeRuntimeError(`${label} session socket sent an unreadable message: ${error.message}`))
    }
  })
  socket.addEventListener('error', () => {
    rejectAll(new SessionFlowSmokeRuntimeError(`${label} session socket errored.`))
  })
  socket.addEventListener('close', (event) => {
    closed = true
    closeReason = event.reason ?? ''
    rejectAll(new SessionFlowSmokeRuntimeError(`${label} session socket closed before the expected message: ${closeReason || event.code}`))
  })

  await new Promise((resolveOpen, rejectOpen) => {
    const timer = setTimeout(() => rejectOpen(new SessionFlowSmokeRuntimeError(`${label} session socket did not open within ${timeoutMs}ms.`)), timeoutMs)
    socket.addEventListener('open', () => {
      clearTimer(timer)
      resolveOpen()
    }, { once: true })
    socket.addEventListener('error', () => {
      clearTimer(timer)
      rejectOpen(new SessionFlowSmokeRuntimeError(`${label} session socket failed to open.`))
    }, { once: true })
  })

  const client = {
    label,
    socket,
    messages,
    sendJson(message) {
      socket.send(JSON.stringify(message))
    },
    waitForMessage(predicate, waitTimeoutMs = timeoutMs) {
      const existing = messages.find(predicate)
      if (existing !== undefined) return Promise.resolve(existing)
      if (closed) {
        return Promise.reject(new SessionFlowSmokeRuntimeError(`${label} session socket is closed: ${closeReason || 'closed'}`))
      }
      return new Promise((resolve, reject) => {
        const waiter = {
          predicate,
          resolve,
          reject,
          timer: setTimeout(() => {
            const index = waiters.indexOf(waiter)
            if (index >= 0) waiters.splice(index, 1)
            reject(new SessionFlowSmokeRuntimeError(`${label} did not receive the expected session socket message within ${waitTimeoutMs}ms.`))
          }, waitTimeoutMs),
        }
        waiters.push(waiter)
      })
    },
    close() {
      if (socket.readyState === WebSocketCtor.OPEN || socket.readyState === WebSocketCtor.CONNECTING) {
        socket.close(1000, 'live session smoke complete')
      }
    },
  }

  client.sendJson(hello)
  const serverHello = await client.waitForMessage(
    (message) => message?.type === 'hello' && message.direction === 'server' && message.sessionId === hello.sessionId,
    timeoutMs,
  )

  return { client, serverHello }
}

const requireObject = (value, path) => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new SessionFlowSmokeRuntimeError(`${path} must be an object in the smoke response.`)
  }
  return value
}

const expectResponseField = (value, path) => {
  if (value === undefined || value === null || value === '') {
    throw new SessionFlowSmokeRuntimeError(`${path} was missing from the smoke response.`)
  }
  return value
}

const createMapForSmoke = async (http, plan) => {
  const created = requireObject(await http.postJson(plan.api.createMap, {
    name: `${DEFAULT_SMOKE_MAP_NAME} ${new Date().toISOString().replace(/[:.]/g, '-')}`,
    dimensions: { x: 8, y: 2, z: 8 },
  }, { role: 'gm' }), 'create map response')
  const map = requireObject(created.map, 'create map response.map')
  const document = createSmokeMapDocument(map, { tokenId: plan.tokenId })
  const saved = requireObject(await http.postJson(plan.api.saveMap, {
    slug: map.slug,
    map: document,
    clientId: 'client_live_session_smoke_map',
  }, { role: 'gm' }), 'save map response')
  return requireObject(saved.map, 'save map response.map')
}

const loadExistingMapForSmoke = async (http, plan) => {
  const loaded = requireObject(await http.getJson(plan.api.loadMap(plan.mapSlug), { role: 'gm' }), 'load map response')
  return requireObject(loaded.map, 'load map response.map')
}

const removeGeneratedSessionDirectory = (sessionId, cwd = process.cwd()) => {
  const directoryPath = resolve(cwd, 'data', 'sessions', sessionId)
  rmSync(directoryPath, { recursive: true, force: true })
  return directoryPath
}

const closeClients = (clients) => {
  for (const client of clients) {
    try {
      client.close()
    } catch {
      // Best effort cleanup; the smoke result reports command/reconnect checks separately.
    }
  }
}

export const runSessionFlowSmoke = async (input = {}, dependencies = {}) => {
  const plan = buildSessionFlowSmokePlan(input)
  const http = createHttpClient(plan, dependencies)
  const WebSocketCtor = dependencies.WebSocketCtor ?? globalThis.WebSocket
  const cwd = dependencies.cwd ?? process.cwd()
  const steps = []
  const sockets = []
  let createdMapSlug = null
  let sessionId = null
  let mapSlug = null
  let cleanupMap = { attempted: false, removed: false, skipped: false }
  let cleanupSession = { attempted: false, removed: false, skipped: false }
  let smokeResult = null

  try {
    const map = plan.generatedMap
      ? await createMapForSmoke(http, plan)
      : await loadExistingMapForSmoke(http, plan)
    mapSlug = map.slug
    if (plan.generatedMap) createdMapSlug = map.slug
    const tokenResource = resolveSmokeTokenResource(map, plan.tokenId)
    steps.push(`Prepared ${plan.generatedMap ? 'temporary' : 'existing'} map ${map.slug} with token ${tokenResource.tokenId}.`)

    const start = requireObject(await http.postJson(plan.api.start, {}, { role: 'gm' }), 'start session response')
    const session = requireObject(start.session, 'start session response.session')
    const gm = requireObject(start.gm, 'start session response.gm')
    const join = requireObject(start.join, 'start session response.join')
    sessionId = expectResponseField(session.sessionId, 'start session response.session.sessionId')
    const gmKey = expectResponseField(gm.gmKey, 'start session response.gm.gmKey')
    const gmClientId = expectResponseField(gm.clientId, 'start session response.gm.clientId')
    const joinCode = expectResponseField(join.joinCode, 'start session response.join.joinCode')
    steps.push(`Started live session ${redactIdentifier(sessionId)} with redacted GM credentials.`)

    const attach = requireObject(await http.postJson(plan.api.attachMap, {
      sessionId,
      gmKey,
      gmClientId,
      mapSlug,
      selectedMapBehavior: 'select-attached-map',
      visibilityBehavior: 'visible-to-all-players',
    }), 'attach map response')
    steps.push(`Attached ${mapSlug} as the selected session map at revision ${attach.session?.revision}.`)

    const playerA = requireObject(await http.postJson(plan.api.join, {
      joinCode,
      displayName: plan.playerNames[0],
    }), 'player A join response')
    const playerB = requireObject(await http.postJson(plan.api.join, {
      joinCode,
      displayName: plan.playerNames[1],
    }), 'player B join response')
    const playerAIdentity = requireObject(playerA.player, 'player A join response.player')
    const playerBIdentity = requireObject(playerB.player, 'player B join response.player')
    steps.push('Joined two players with redacted join-code handling.')

    const assignment = requireObject(await http.postJson(plan.api.assignments, {
      sessionId,
      gmKey,
      gmClientId,
      playerId: playerAIdentity.playerId,
      action: 'assign',
      resources: [tokenResource],
    }), 'assignment response')
    const assignedRevision = expectResponseField(assignment.session?.revision, 'assignment response.session.revision')
    steps.push(`Assigned token ${tokenResource.tokenId} to ${plan.playerNames[0]} at revision ${assignedRevision}.`)

    const playerState = requireObject(await http.postJson(plan.api.playerState, {
      sessionId,
      playerId: playerBIdentity.playerId,
      clientId: playerBIdentity.clientId,
      displayName: playerBIdentity.displayName,
    }), 'player state response')
    if (!Array.isArray(playerState.visibility?.visibleMapSlugs) || !playerState.visibility.visibleMapSlugs.includes(mapSlug)) {
      throw new SessionFlowSmokeRuntimeError(`${plan.playerNames[1]} cannot see the attached session map.`)
    }
    steps.push(`${plan.playerNames[1]} can see the attached session map before opening the socket.`)

    const gmSocket = await openSessionSocketClient({
      label: 'GM',
      socketUrl: plan.socketUrl,
      timeoutMs: plan.timeoutMs,
      WebSocketCtor,
      hello: createSessionHelloMessage({
        sessionId,
        identity: { role: 'gm', clientId: gmClientId, gmKey },
        reconnect: false,
      }),
    })
    sockets.push(gmSocket.client)
    const playerASocket = await openSessionSocketClient({
      label: plan.playerNames[0],
      socketUrl: plan.socketUrl,
      timeoutMs: plan.timeoutMs,
      WebSocketCtor,
      hello: createSessionHelloMessage({
        sessionId,
        identity: {
          role: 'player',
          clientId: playerAIdentity.clientId,
          playerId: playerAIdentity.playerId,
          displayName: playerAIdentity.displayName,
        },
        reconnect: false,
      }),
    })
    sockets.push(playerASocket.client)
    const playerBSocket = await openSessionSocketClient({
      label: plan.playerNames[1],
      socketUrl: plan.socketUrl,
      timeoutMs: plan.timeoutMs,
      WebSocketCtor,
      hello: createSessionHelloMessage({
        sessionId,
        identity: {
          role: 'player',
          clientId: playerBIdentity.clientId,
          playerId: playerBIdentity.playerId,
          displayName: playerBIdentity.displayName,
        },
        reconnect: false,
      }),
    })
    sockets.push(playerBSocket.client)
    steps.push('Opened GM and two player session sockets.')

    const opId = createSmokeOpId()
    const moveMessage = createMoveTokenCommandMessage({
      sessionId,
      actor: playerAIdentity.actor,
      tokenResource,
      baseRevision: assignedRevision,
      to: plan.targetPosition,
      opId,
    })
    playerASocket.client.sendJson(moveMessage)

    const acceptedAck = await playerASocket.client.waitForMessage(
      (message) => message?.type === 'commandAck' && message.result?.opId === opId && message.result?.accepted === true,
      plan.timeoutMs,
    )
    const moveRevision = acceptedAck.result.currentRevision
    await Promise.all([
      gmSocket.client.waitForMessage((message) => message?.type === 'patch' && message.event?.opId === opId && message.event?.eventType === 'tokenMoved', plan.timeoutMs),
      playerASocket.client.waitForMessage((message) => message?.type === 'patch' && message.event?.opId === opId && message.event?.eventType === 'tokenMoved', plan.timeoutMs),
      playerBSocket.client.waitForMessage((message) => message?.type === 'patch' && message.event?.opId === opId && message.event?.eventType === 'tokenMoved', plan.timeoutMs),
    ])
    steps.push(`Accepted player token move and received same-session patches at revision ${moveRevision}.`)

    playerBSocket.client.close()
    const reconnectSocket = await openSessionSocketClient({
      label: `${plan.playerNames[1]} reconnect`,
      socketUrl: plan.socketUrl,
      timeoutMs: plan.timeoutMs,
      WebSocketCtor,
      hello: createSessionHelloMessage({
        sessionId,
        identity: {
          role: 'player',
          clientId: playerBIdentity.clientId,
          playerId: playerBIdentity.playerId,
          displayName: playerBIdentity.displayName,
        },
        reconnect: true,
        lastSeenRevision: assignedRevision,
      }),
    })
    sockets.push(reconnectSocket.client)
    const snapshot = await reconnectSocket.client.waitForMessage(
      (message) => message?.type === 'snapshot' && message.reason === 'reconnect' && message.currentRevision === moveRevision,
      plan.timeoutMs,
    )
    const snapshotMap = snapshot.snapshot?.maps?.find((entry) => entry.mapSlug === mapSlug)
    const snapshotToken = snapshotMap?.document?.placements?.find((placement) => placement.id === tokenResource.tokenId)
    if (snapshotToken?.position?.x !== plan.targetPosition.x || snapshotToken?.position?.y !== plan.targetPosition.y || snapshotToken?.position?.z !== plan.targetPosition.z) {
      throw new SessionFlowSmokeRuntimeError('Reconnect snapshot did not include the accepted token position for the visible player.')
    }
    steps.push('Reconnected the visible-only player and verified the actor-scoped snapshot fallback.')

    smokeResult = {
      ok: true,
      session: {
        sessionId: redactIdentifier(sessionId),
        finalRevision: moveRevision,
      },
      map: {
        mapSlug,
        tokenId: tokenResource.tokenId,
        generated: plan.generatedMap,
      },
      players: [
        { label: plan.playerNames[0], playerId: redactIdentifier(playerAIdentity.playerId), assignedToken: true },
        { label: plan.playerNames[1], playerId: redactIdentifier(playerBIdentity.playerId), assignedToken: false, reconnectSnapshot: true },
      ],
      steps,
    }
  } finally {
    closeClients(sockets)

    if (createdMapSlug !== null && !plan.keepSmokeMap) {
      cleanupMap = { attempted: true, removed: false, skipped: false }
      try {
        await http.postJson(plan.api.deleteMap, {
          slug: createdMapSlug,
          clientId: 'client_live_session_smoke_map',
        }, { role: 'gm' })
        cleanupMap = { attempted: true, removed: true, skipped: false }
      } catch (error) {
        cleanupMap = { attempted: true, removed: false, skipped: false, error: redactSessionSecrets(error.message) }
      }
    } else if (createdMapSlug !== null) {
      cleanupMap = { attempted: false, removed: false, skipped: true, reason: '--keep-smoke-map' }
    } else {
      cleanupMap = { attempted: false, removed: false, skipped: true, reason: 'existing-map' }
    }

    if (sessionId !== null && plan.cleanupSessionData) {
      cleanupSession = { attempted: true, removed: false, skipped: false }
      try {
        const removedPath = removeGeneratedSessionDirectory(sessionId, cwd)
        cleanupSession = { attempted: true, removed: true, skipped: false, path: removedPath.replace(sessionId, redactIdentifier(sessionId)) }
      } catch (error) {
        cleanupSession = { attempted: true, removed: false, skipped: false, error: redactSessionSecrets(error.message) }
      }
    } else if (sessionId !== null) {
      cleanupSession = { attempted: false, removed: false, skipped: true, reason: '--keep-session-data' }
    } else {
      cleanupSession = { attempted: false, removed: false, skipped: true, reason: 'session-not-started' }
    }
  }

  if (smokeResult !== null) {
    return {
      ...smokeResult,
      cleanup: {
        map: cleanupMap,
        sessionData: cleanupSession,
      },
    }
  }

  throw new SessionFlowSmokeRuntimeError('Live session real-flow smoke did not complete.')
}

export const formatSessionFlowSmokePlan = (plan) => {
  const mapCleanup = plan.generatedMap
    ? (plan.keepSmokeMap ? 'keep temporary map' : 'delete temporary map')
    : 'leave existing map unchanged'

  return [
    'Live session real-flow smoke plan',
    `- Base URL: ${plan.baseUrl}`,
    `- Session socket: ${plan.socketUrl}`,
    `- Map: ${plan.generatedMap ? 'temporary generated smoke map' : plan.mapSlug}`,
    `- Token: ${plan.tokenId ?? 'first placement on the selected map'}`,
    `- Move target: ${plan.targetPosition.x},${plan.targetPosition.y},${plan.targetPosition.z}`,
    `- Players: ${plan.playerNames[0]} receives token control; ${plan.playerNames[1]} verifies visible-map reconnect.`,
    `- Cleanup: ${mapCleanup}, ${plan.cleanupSessionData ? 'remove generated session snapshot directory' : 'keep session snapshot directory'}.`,
    '- Secrets: GM key and join code are used only in memory and are not printed.',
  ]
}

export const formatSessionFlowSmokeResult = (result) => {
  const cleanupLines = [
    result.cleanup.map.removed
      ? '- Cleanup map: removed temporary smoke map.'
      : `- Cleanup map: ${result.cleanup.map.skipped ? `skipped (${result.cleanup.map.reason})` : 'not fully removed; inspect ignored data/maps/ if needed.'}`,
    result.cleanup.sessionData.removed
      ? `- Cleanup session data: removed ${result.cleanup.sessionData.path}.`
      : `- Cleanup session data: ${result.cleanup.sessionData.skipped ? `skipped (${result.cleanup.sessionData.reason})` : 'not fully removed; inspect ignored data/sessions/ if needed.'}`,
  ]

  return redactSessionSecrets([
    'Live session real-flow smoke passed',
    `- Session: ${result.session.sessionId} at revision ${result.session.finalRevision}`,
    `- Map/token: ${result.map.mapSlug} / ${result.map.tokenId}`,
    ...result.players.map((player) => `- Player: ${player.label} (${player.playerId})${player.assignedToken ? ' assigned token control' : ' visible-map reconnect verified'}`),
    ...result.steps.map((step) => `- ${step}`),
    ...cleanupLines,
  ].join('\n'))
}

export const runSessionFlowSmokeCli = async (argv = process.argv.slice(2), dependencies = {}) => {
  let options
  try {
    options = parseSessionFlowSmokeCliArgs(argv)
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${HELP_TEXT}`)
    return 2
  }

  if (options.help) {
    process.stdout.write(HELP_TEXT)
    return 0
  }

  let plan
  try {
    plan = buildSessionFlowSmokePlan(options)
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    return 2
  }

  process.stdout.write(`${formatSessionFlowSmokePlan(plan).join('\n')}\n`)
  if (process.env[SESSION_HOST_ENABLE_ENV] !== SESSION_HOST_ENABLE_VALUE) {
    process.stdout.write(
      `Warning: this shell does not have ${SESSION_HOST_ENABLE_ENV}=${SESSION_HOST_ENABLE_VALUE}. ` +
      'The running Rotom Table server must be started with that flag or live session routes fail closed.\n',
    )
  }

  if (options.dryRun) return 0

  try {
    const result = await runSessionFlowSmoke(plan, dependencies)
    process.stdout.write(`\n${formatSessionFlowSmokeResult(result)}\n`)
    return 0
  } catch (error) {
    process.stderr.write(`\nLive session real-flow smoke failed: ${redactSessionSecrets(error.message)}\n`)
    return 1
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runSessionFlowSmokeCli().then((status) => {
    process.exitCode = status
  }, (error) => {
    process.stderr.write(`Live session real-flow smoke failed: ${redactSessionSecrets(error.message)}\n`)
    process.exitCode = 1
  })
}

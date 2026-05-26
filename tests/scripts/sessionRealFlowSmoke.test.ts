import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_BASE_URL,
  DEFAULT_TARGET_POSITION,
  DEFAULT_TOKEN_ID,
  MAP_API_PATHS,
  MOVE_TOKEN_COMMAND_TYPE,
  SESSION_API_PATHS,
  SessionFlowSmokeCliError,
  buildSessionFlowSmokePlan,
  createMoveTokenCommandMessage,
  createSessionHelloMessage,
  createSmokeMapDocument,
  formatSessionFlowSmokePlan,
  formatSessionFlowSmokeResult,
  normalizeBaseUrl,
  parseSessionFlowSmokeCliArgs,
  redactSessionSecrets,
  resolveSessionSocketUrl,
  resolveSmokeTokenResource,
} from '../../scripts/session-real-flow-smoke.mjs'

const testDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(testDir, '../..')

const readText = (relativePath: string): string => readFileSync(resolve(repoRoot, relativePath), 'utf8')

describe('live session real-flow smoke helper', () => {
  it('parses operator options for an existing saved map without contacting the server', () => {
    expect(parseSessionFlowSmokeCliArgs([
      '--base-url',
      'http://127.0.0.1:3000/',
      '--map',
      'viridian-gym',
      '--token',
      'token-pikachu',
      '--to',
      '3,0,4',
      '--player-a',
      'Leaf',
      '--player-b',
      'Blue',
      '--timeout-ms',
      '2500',
      '--keep-session-data',
      '--dry-run',
    ])).toMatchObject({
      baseUrl: 'http://127.0.0.1:3000/',
      mapSlug: 'viridian-gym',
      tokenId: 'token-pikachu',
      targetPosition: { x: 3, y: 0, z: 4 },
      playerNames: ['Leaf', 'Blue'],
      timeoutMs: 2500,
      cleanupSessionData: false,
      dryRun: true,
    })

    expect(() => parseSessionFlowSmokeCliArgs(['--to', 'bad'])).toThrow(SessionFlowSmokeCliError)
    expect(() => parseSessionFlowSmokeCliArgs(['--map', 'Not A Slug'])).not.toThrow()
    expect(() => buildSessionFlowSmokePlan({ mapSlug: 'Not A Slug' })).toThrow(SessionFlowSmokeCliError)
    expect(() => normalizeBaseUrl('ftp://localhost:3000')).toThrow(SessionFlowSmokeCliError)
  })

  it('builds a no-secret default plan that creates a temporary map and opens the session socket route', () => {
    const plan = buildSessionFlowSmokePlan()

    expect(plan.baseUrl).toBe(DEFAULT_BASE_URL)
    expect(plan.socketUrl).toBe('ws://localhost:3000/api/sessions/socket')
    expect(resolveSessionSocketUrl('https://table.example.com')).toBe('wss://table.example.com/api/sessions/socket')
    expect(plan.generatedMap).toBe(true)
    expect(plan.tokenId).toBe(DEFAULT_TOKEN_ID)
    expect(plan.targetPosition).toEqual(DEFAULT_TARGET_POSITION)
    expect(plan.api.start).toBe(`${DEFAULT_BASE_URL}${SESSION_API_PATHS.start}`)
    expect(plan.api.attachMap).toBe(`${DEFAULT_BASE_URL}${SESSION_API_PATHS.attachMap}`)
    expect(plan.api.loadMap('arena-map')).toBe(`${DEFAULT_BASE_URL}${MAP_API_PATHS.load}?slug=arena-map`)

    const planText = formatSessionFlowSmokePlan(plan).join('\n')
    expect(planText).toContain('temporary generated smoke map')
    expect(planText).toContain('delete temporary map')
    expect(planText).toContain('GM key and join code are used only in memory')
    expect(planText).not.toContain('gmkey_')
  })

  it('creates a temporary map document with movable token placements and player visibility', () => {
    const document = createSmokeMapDocument({
      slug: 'live-session-smoke-map',
      name: 'Live Session Smoke Map',
      dimensions: { x: 8, y: 2, z: 8 },
      createdAt: 1,
      updatedAt: 1,
    }, { tokenId: 'token-bulbasaur', now: 2 })

    expect(document).toMatchObject({
      schemaVersion: 2,
      slug: 'live-session-smoke-map',
      playerVisible: true,
      initiative: { activeId: 'token-bulbasaur', round: 1 },
      moveUsage: { byPlacementId: {} },
      metadata: { smoke: 'live-session-real-flow' },
    })
    expect(document.placements).toHaveLength(2)
    expect(document.placements[0]).toMatchObject({
      id: 'token-bulbasaur',
      sheetKind: 'pokemon',
      sheetSlug: 'pikachu',
      position: { x: 1, y: 0, z: 1 },
    })
  })

  it('derives token resources, hello messages, and move commands used by the real-flow socket smoke', () => {
    const map = createSmokeMapDocument({ slug: 'arena-map', name: 'Arena', dimensions: { x: 8, y: 2, z: 8 } }, {
      tokenId: 'token-eevee',
      now: 2,
    })
    const tokenResource = resolveSmokeTokenResource(map, 'token-eevee')
    expect(tokenResource).toEqual({
      kind: 'token',
      tokenId: 'token-eevee',
      mapSlug: 'arena-map',
      sheetKind: 'pokemon',
      sheetSlug: 'pikachu',
    })

    const hello = createSessionHelloMessage({
      sessionId: 'session_realflowsmoke1',
      identity: {
        role: 'player',
        playerId: 'player_realflowa',
        clientId: 'client_realflowa',
        displayName: 'Leaf',
      },
      reconnect: true,
      lastSeenRevision: 4,
    })
    expect(hello).toMatchObject({
      schemaVersion: 1,
      type: 'hello',
      direction: 'client',
      reconnect: true,
      lastSeenRevision: 4,
    })

    const command = createMoveTokenCommandMessage({
      sessionId: 'session_realflowsmoke1',
      actor: hello.identity,
      tokenResource,
      baseRevision: 4,
      to: { x: 2, y: 0, z: 2 },
      opId: 'op_realflowsmoke1',
    })
    expect(command).toMatchObject({
      schemaVersion: 1,
      type: 'command',
      direction: 'client',
      sessionId: 'session_realflowsmoke1',
      command: {
        schemaVersion: 1,
        type: MOVE_TOKEN_COMMAND_TYPE,
        baseRevision: 4,
        payload: { tokenId: 'token-eevee', to: { x: 2, y: 0, z: 2 } },
        scopes: [{ lane: 'token', field: 'position', mapSlug: 'arena-map', resource: tokenResource }],
      },
    })
  })

  it('formats smoke results without exposing session secrets', () => {
    const redacted = redactSessionSecrets('gmkey_abcdefghijklmnopqrstuvwxyz ABC234 safe')
    expect(redacted).toContain('[redacted-gm-key]')
    expect(redacted).toContain('[redacted-join-code]')
    expect(redacted).not.toContain('gmkey_abcdefghijklmnopqrstuvwxyz')
    expect(redacted).not.toContain('ABC234')

    const resultText = formatSessionFlowSmokeResult({
      session: { sessionId: 'session_…1234', finalRevision: 5 },
      map: { mapSlug: 'live-session-smoke-map', tokenId: 'token-pikachu', generated: true },
      players: [
        { label: 'Player A', playerId: 'player_…aaaa', assignedToken: true },
        { label: 'Player B', playerId: 'player_…bbbb', assignedToken: false, reconnectSnapshot: true },
      ],
      steps: ['Started live session session_…1234 with redacted GM credentials.'],
      cleanup: {
        map: { attempted: true, removed: true, skipped: false },
        sessionData: { attempted: true, removed: true, skipped: false, path: '/repo/data/sessions/session_…1234' },
      },
    })

    expect(resultText).toContain('Live session real-flow smoke passed')
    expect(resultText).toContain('visible-map reconnect verified')
    expect(resultText).toContain('removed temporary smoke map')
    expect(resultText).not.toContain('gmkey_')
    expect(resultText).not.toContain('joinCode')
  })

  it('documents operator usage, verified flow steps, and no-secret cleanup boundaries', () => {
    const packageJson = JSON.parse(readText('package.json'))
    const guide = readText('docs/live-session-real-flow-smoke.md')

    expect(packageJson.scripts['smoke:session:real-flow']).toBe('node scripts/session-real-flow-smoke.mjs')
    expect(guide).toContain('npm run dev:session:lan')
    expect(guide).toContain('npm run smoke:session:real-flow')
    expect(guide).toContain('start → attach → join → assign → session socket → move → reconnect')
    expect(guide).toContain('WebSocket /api/sessions/socket')
    expect(guide).toContain('moveToken')
    expect(guide).toContain('reconnect snapshot')
    expect(guide).toContain('deletes the generated smoke map')
    expect(guide).toContain('never prints GM keys or join codes')
    expect(guide).toContain('data/sessions/')
    expect(readText('README.md')).toContain('docs/live-session-real-flow-smoke.md')
    expect(readText('docs/README.md')).toContain('live-session-real-flow-smoke.md')
    expect(readText('docs/local-development.md')).toContain('live-session-real-flow-smoke.md')
    expect(readText('docs/live-session-deployment-smoke-checklist.md')).toContain('live-session-real-flow-smoke.md')
  })
})

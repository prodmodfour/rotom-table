import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAP_INTERACTION_MODES } from '#shared/mapInteractionMode'
import { LIVE_PLAY_COMMAND_SCHEMA_VERSION, LIVE_PLAY_COMMAND_TYPES, LIVE_PLAY_PATCH_TYPES } from '#shared/livePlayCommands'
import { LIVE_PLAY_REALTIME_EVENT_TYPES, mapChannel, sheetsChannel } from '#shared/realtime'
import type { PlayerProfileId } from '#shared/playerProfiles'
import { MAP_API_PATHS } from '../../src/utils/apiRoutes'
import type { ApiGetOptions } from '../../src/utils/apiClient'
import {
  ClientTab,
  FullSystemChaosHarness,
  deferred,
  flushAsync,
  moveTokenPosition,
  type ClientTabApiHandler,
} from './livePlayChaosHarness'

let harnesses: FullSystemChaosHarness[] = []
let tabs: ClientTab[] = []

const createTab = async (
  harness: FullSystemChaosHarness,
  options: {
    readonly label: string
    readonly role?: 'gm' | 'player'
    readonly profileId?: PlayerProfileId | null
    readonly api?: (tab: () => ClientTab) => ClientTabApiHandler
    readonly server?: FullSystemChaosHarness['serverA']
    readonly databaseName?: string
  },
): Promise<ClientTab> => {
  let tab!: ClientTab
  const defaultApi: ClientTabApiHandler = {
    getJson: (path, apiOptions) => harness.apiGet(path, apiOptions, tab.role.value, tab.selectedProfileId.value),
    postJson: (path, body) => harness.apiPost(path, body, tab.role.value, tab.selectedProfileId.value),
  }
  vi.resetModules()
  tab = await ClientTab.create({
    label: options.label,
    harness,
    api: options.api ? options.api(() => tab) : defaultApi,
    role: options.role,
    profileId: options.profileId,
    server: options.server,
    databaseName: options.databaseName,
  })
  tabs.push(tab)
  await flushAsync()
  return tab
}

const createHarness = (options: ConstructorParameters<typeof FullSystemChaosHarness>[0] = {}) => {
  const harness = new FullSystemChaosHarness(options)
  harnesses.push(harness)
  return harness
}

const waitForCaughtUp = async (tab: ClientTab) => {
  await vi.waitFor(() => {
    expect(tab.connectionChanges).toContainEqual(expect.objectContaining({ state: 'connected', reason: 'replay-caught-up' }))
  })
}

const waitForReady = async (tab: ClientTab) => {
  await vi.waitFor(() => expect(tab.readiness.value).toBe(true))
}

type MoveInterceptionMode = 'hold-before-server' | 'hold-after-server' | 'fail-before-server'

interface MoveInterception {
  readonly mode: MoveInterceptionMode
  readonly gate: ReturnType<typeof deferred<void>>
  readonly bodies: Record<string, unknown>[]
}

const createMoveInterception = (mode: MoveInterceptionMode): MoveInterception => ({
  mode,
  gate: deferred<void>(),
  bodies: [],
})

const interceptedOpId = (interception: MoveInterception): string => {
  const opId = interception.bodies[0]?.opId
  if (typeof opId !== 'string') throw new Error('Expected intercepted live-play command body to include an opId')
  return opId
}

const createInterceptableMoveApi = (
  harness: FullSystemChaosHarness,
  getTab: () => ClientTab,
  nextInterception: { current: MoveInterception | null },
): ClientTabApiHandler => ({
  getJson: (path, options) => {
    const tab = getTab()
    return harness.apiGet(path, options, tab.role.value, tab.selectedProfileId.value)
  },
  postJson: async (path, body) => {
    const tab = getTab()
    const interception = path === MAP_API_PATHS.moveToken ? nextInterception.current : null
    if (interception) {
      nextInterception.current = null
      interception.bodies.push(body as Record<string, unknown>)
      if (interception.mode === 'hold-before-server' || interception.mode === 'fail-before-server') {
        await interception.gate.promise
        if (interception.mode === 'fail-before-server') {
          throw new Error('simulated network loss before command reached server')
        }
        return harness.apiPost(path, body, tab.role.value, tab.selectedProfileId.value)
      }

      const response = await harness.apiPost(path, body, tab.role.value, tab.selectedProfileId.value)
      await interception.gate.promise
      return response
    }

    return harness.apiPost(path, body, tab.role.value, tab.selectedProfileId.value)
  },
})

beforeEach(() => {
  vi.stubGlobal('window', {
    location: { href: 'http://rotom.test/maps/chaos-arena' },
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })
})

afterEach(() => {
  for (const tab of tabs.splice(0).reverse()) tab.dispose()
  for (const harness of harnesses.splice(0).reverse()) harness.dispose()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.resetModules()
})

describe('Final Wave C full-system live-play chaos hardening', () => {
  it('hydrates from an aggregate snapshot, opens cursorless SSE without replaying old retained events, and becomes ready only after caught-up plus recovery', async () => {
    const harness = createHarness()
    harness.appendEvent({
      event: { channel: mapChannel('chaos-arena'), type: 'updated', data: { stale: true } },
      access: { kind: 'map-access', mapSlug: 'chaos-arena' },
    })

    const tab = await createTab(harness, { label: 'initial-gm' })
    expect(tab.readiness.value).toBe(false)
    expect(tab.currentMap).toBeNull()
    expect(tab.latestSource?.url).toBe('/api/events')

    await waitForCaughtUp(tab)
    expect(tab.readiness.value).toBe(false)
    expect(tab.cursorStorage.readCursor('gm')).toBe(1)

    await tab.hydrate()
    await waitForReady(tab)

    expect(tab.currentMap?.revision).toBe(0)
    expect(moveTokenPosition(tab.currentMap)).toEqual({ x: 1, y: 0, z: 1 })
    expect(tab.pokemonSheets.get('alpha-mon')?.revision).toBe(0)
    expect(tab.mode.interactionMode.value).toBe(MAP_INTERACTION_MODES.LIVE_PLAY)
    expect(tab.commands.outboxEntries.value).toEqual([])
    expect(tab.connectionChanges.find((change) => change.reason === 'replay-caught-up')?.state).toBe('connected')
  })

  it('replays retained map, sheet, and mode events after disconnect without an unnecessary snapshot and unblocks only after caught-up', async () => {
    const harness = createHarness()
    let liveStateLoads = 0
    const tab = await createTab(harness, {
      label: 'replay-gm',
      api: (getTab) => ({
        getJson: async (path: string, options?: ApiGetOptions) => {
          if (path === MAP_API_PATHS.liveState) liveStateLoads += 1
          const tab = getTab()
          return harness.apiGet(path, options, tab.role.value, tab.selectedProfileId.value)
        },
        postJson: (path, body) => {
          const tab = getTab()
          return harness.apiPost(path, body, tab.role.value, tab.selectedProfileId.value)
        },
      }),
    })
    await waitForCaughtUp(tab)
    await tab.hydrate()
    await waitForReady(tab)
    expect(liveStateLoads).toBe(1)

    tab.latestSource?.emitTransportError()
    await flushAsync()
    expect(tab.readiness.value).toBe(false)

    await harness.executeCommandPath(
      MAP_API_PATHS.moveToken,
      harness.moveTokenCommand({ baseRevision: 0, position: { x: 4, y: 0, z: 4 }, clientId: 'server-a' }),
      'gm',
      null,
    )
    await harness.executeCommandPath(
      MAP_API_PATHS.modifyHp,
      harness.modifyHpCommand({ baseRevision: 1, currentHp: 17, clientId: 'server-a' }),
      'gm',
      null,
    )
    await harness.apiPost(MAP_API_PATHS.interactionMode, {
      slug: 'chaos-arena',
      interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
      clientId: 'server-a',
    }, 'gm', null)

    tab.timers.runAll()
    await flushAsync()
    await vi.waitFor(() => expect(tab.currentMap?.revision).toBe(2))

    expect(tab.latestSource?.url).toBe('/api/events?after=0')
    expect(moveTokenPosition(tab.currentMap)).toEqual({ x: 4, y: 0, z: 4 })
    expect(tab.pokemonSheets.get('alpha-mon')?.combat?.currentHp).toBe(17)
    expect(tab.mode.interactionMode.value).toBe(MAP_INTERACTION_MODES.SETUP_EDIT)
    expect(liveStateLoads).toBe(1)
    expect(tab.readiness.value).toBe(false)
  })

  it('recovers a retained-history gap with exactly one snapshot, keeps failure visible, and retrying reconciliation does not resend commands', async () => {
    const harness = createHarness()
    let liveStateLoads = 0
    let failSnapshot = false
    let commandPosts = 0
    const tab = await createTab(harness, {
      label: 'gap-gm',
      api: (getTab) => ({
        getJson: async (path: string, options?: ApiGetOptions) => {
          if (path === MAP_API_PATHS.liveState) {
            liveStateLoads += 1
            if (failSnapshot) throw new Error('snapshot failed once')
          }
          const tab = getTab()
          return harness.apiGet(path, options, tab.role.value, tab.selectedProfileId.value)
        },
        postJson: (path, body) => {
          if (path !== MAP_API_PATHS.operationStatus && path !== MAP_API_PATHS.operationAbandon) commandPosts += 1
          const tab = getTab()
          return harness.apiPost(path, body, tab.role.value, tab.selectedProfileId.value)
        },
      }),
    })
    await waitForCaughtUp(tab)
    await tab.hydrate()
    await waitForReady(tab)
    expect(liveStateLoads).toBe(1)

    await harness.executeCommandPath(
      MAP_API_PATHS.moveToken,
      harness.moveTokenCommand({ baseRevision: 0, position: { x: 5, y: 0, z: 5 }, clientId: 'server-a' }),
      'gm',
      null,
    )
    const latest = harness.realtime.cursorState().latestSequence
    harness.pruneRealtimeThrough(latest)
    tab.sessionStorage.setItem('rotom:realtime-cursor:v1:gm', JSON.stringify({
      schema: 'rotom.realtime.cursor',
      version: 1,
      sequence: 0,
    }))
    failSnapshot = true

    tab.latestSource?.emitTransportError()
    tab.timers.runAll()
    await flushAsync()
    await vi.waitFor(() => expect(tab.snapshot.status.value).toBe('error'))

    expect(tab.connectionChanges).toContainEqual(expect.objectContaining({ reason: 'reconcile-required' }))
    expect(liveStateLoads).toBe(2)
    expect(tab.snapshot.error.value).toContain('snapshot failed once')
    expect(tab.readiness.value).toBe(false)
    expect(commandPosts).toBe(0)

    failSnapshot = false
    await tab.map.reconcileAuthoritativeMap('Retrying failed reconciliation.')
    await waitForReady(tab)
    expect(liveStateLoads).toBe(3)
    expect(commandPosts).toBe(0)
    expect(tab.currentMap?.revision).toBe(1)
    expect(moveTokenPosition(tab.currentMap)).toEqual({ x: 5, y: 0, z: 5 })
  })

  it('recovers lost HTTP by accepted SSE, lost SSE by replay, and duplicate HTTP/SSE delivery applies once without duplicate presentation', async () => {
    const harness = createHarness()
    let rejectHttp!: (reason?: unknown) => void
    let capturedHttpBody: Record<string, unknown> | null = null
    let loseFirstHttp = true
    const tab = await createTab(harness, {
      label: 'race-gm',
      api: (getTab) => ({
        getJson: (path, options) => {
          const tab = getTab()
          return harness.apiGet(path, options, tab.role.value, tab.selectedProfileId.value)
        },
        postJson: async (path, body) => {
          if (path === MAP_API_PATHS.moveToken && loseFirstHttp) {
            loseFirstHttp = false
            capturedHttpBody = body as Record<string, unknown>
            await harness.apiPost(path, body, getTab().role.value, getTab().selectedProfileId.value)
            await new Promise<never>((_resolve, reject) => { rejectHttp = reject })
          }
          return harness.apiPost(path, body, getTab().role.value, getTab().selectedProfileId.value)
        },
      }),
    })
    await waitForCaughtUp(tab)
    await tab.hydrate()
    await waitForReady(tab)

    const lostHttp = tab.commands.moveToken({ placementId: 'token-alpha', position: { x: 3, y: 0, z: 3 } })
    await vi.waitFor(() => expect(capturedHttpBody).not.toBeNull())
    await vi.waitFor(() => expect(tab.currentMap?.revision).toBe(1))
    rejectHttp(new Error('response lost'))
    await expect(lostHttp).resolves.toMatchObject({ dispatched: true, recoveredByRealtime: true })
    await waitForReady(tab)
    expect(tab.commands.outboxEntries.value).toEqual([])
    expect(moveTokenPosition(tab.currentMap)).toEqual({ x: 3, y: 0, z: 3 })

    tab.latestSource?.emitTransportError()
    await harness.executeCommandPath(
      MAP_API_PATHS.moveToken,
      harness.moveTokenCommand({ baseRevision: 1, position: { x: 4, y: 0, z: 4 }, clientId: 'server-a' }),
      'gm',
      null,
    )
    tab.timers.runAll()
    await flushAsync()
    await vi.waitFor(() => expect(tab.currentMap?.revision).toBe(2))
    expect(moveTokenPosition(tab.currentMap)).toEqual({ x: 4, y: 0, z: 4 })

    harness.serverA.publishLocalWakeups = false
    const duplicate = await tab.commands.moveToken({ placementId: 'token-alpha', position: { x: 5, y: 0, z: 5 } })
    expect(duplicate).toMatchObject({ dispatched: true })
    expect(tab.currentMap?.revision).toBe(3)
    const presentationCount = tab.presentationEvents.length
    harness.serverA.publishLocalWakeups = true
    const lastEvent = harness.realtime.getBySequence(harness.realtime.cursorState().latestSequence)?.event
    if (lastEvent) harness.serverA.hub.publishSequencedRealtime(lastEvent)
    await flushAsync()
    expect(tab.currentMap?.revision).toBe(3)
    expect(moveTokenPosition(tab.currentMap)).toEqual({ x: 5, y: 0, z: 5 })
    expect(tab.presentationEvents).toHaveLength(presentationCount)
  })

  it('keeps predicted multi-client moves convergent through scoped concurrency and same-token conflicts', async () => {
    const harness = createHarness()
    const nextInterception: { current: MoveInterception | null } = { current: null }
    const tabA = await createTab(harness, {
      label: 'prediction-client-a',
      api: (getTab) => createInterceptableMoveApi(harness, getTab, nextInterception),
    })
    await waitForCaughtUp(tabA)
    await tabA.hydrate()
    await waitForReady(tabA)

    const tabB = await createTab(harness, { label: 'prediction-client-b' })
    await waitForCaughtUp(tabB)
    await tabB.hydrate()
    await waitForReady(tabB)

    const heldAlpha = createMoveInterception('hold-before-server')
    nextInterception.current = heldAlpha
    const alphaMove = tabA.commands.moveToken({ placementId: 'token-alpha', position: { x: 3, y: 0, z: 3 } })
    await vi.waitFor(() => expect(heldAlpha.bodies).toHaveLength(1))
    expect(tabA.pendingPredictionOpIds).toEqual([interceptedOpId(heldAlpha)])
    expect(moveTokenPosition(tabA.currentMap, 'token-alpha')).toEqual({ x: 3, y: 0, z: 3 })
    expect(harness.readMap().revision).toBe(0)

    await expect(tabB.commands.moveToken({ placementId: 'token-beta', position: { x: 5, y: 0, z: 1 } }))
      .resolves.toMatchObject({ dispatched: true })
    await vi.waitFor(() => expect(tabA.currentMap?.revision).toBe(1))
    expect(tabA.pendingPredictionOpIds).toEqual([interceptedOpId(heldAlpha)])
    expect(moveTokenPosition(tabA.currentMap, 'token-alpha')).toEqual({ x: 3, y: 0, z: 3 })
    expect(moveTokenPosition(tabA.currentMap, 'token-beta')).toEqual({ x: 5, y: 0, z: 1 })

    heldAlpha.gate.resolve()
    await expect(alphaMove).resolves.toMatchObject({ dispatched: true, opId: interceptedOpId(heldAlpha) })
    await vi.waitFor(() => expect(tabB.currentMap?.revision).toBe(2))
    expect(harness.readMap().revision).toBe(2)
    expect(moveTokenPosition(harness.readMap(), 'token-alpha')).toEqual({ x: 3, y: 0, z: 3 })
    expect(moveTokenPosition(harness.readMap(), 'token-beta')).toEqual({ x: 5, y: 0, z: 1 })
    await waitForReady(tabA)
    await waitForReady(tabB)

    const heldStaleAlpha = createMoveInterception('hold-before-server')
    nextInterception.current = heldStaleAlpha
    const staleAlphaMove = tabA.commands.moveToken({ placementId: 'token-alpha', position: { x: 7, y: 0, z: 7 } })
    await vi.waitFor(() => expect(heldStaleAlpha.bodies).toHaveLength(1))
    expect(tabA.pendingPredictionOpIds).toEqual([interceptedOpId(heldStaleAlpha)])
    expect(moveTokenPosition(tabA.currentMap, 'token-alpha')).toEqual({ x: 7, y: 0, z: 7 })

    await expect(tabB.commands.moveToken({ placementId: 'token-alpha', position: { x: 1, y: 0, z: 6 } }))
      .resolves.toMatchObject({ dispatched: true })
    await vi.waitFor(() => expect(tabA.pendingPredictionOpIds).toEqual([]))
    expect(moveTokenPosition(tabA.currentMap, 'token-alpha')).toEqual({ x: 1, y: 0, z: 6 })
    expect(moveTokenPosition(tabA.currentMap, 'token-beta')).toEqual({ x: 5, y: 0, z: 1 })

    heldStaleAlpha.gate.resolve()
    await expect(staleAlphaMove).resolves.toMatchObject({ dispatched: false, opId: interceptedOpId(heldStaleAlpha) })
    expect(harness.readMap().revision).toBe(3)
    expect(moveTokenPosition(harness.readMap(), 'token-alpha')).toEqual({ x: 1, y: 0, z: 6 })
    expect(moveTokenPosition(harness.readMap(), 'token-beta')).toEqual({ x: 5, y: 0, z: 1 })
  })

  it('keeps prediction state idempotent across SSE-first and HTTP-first terminal delivery', async () => {
    const harness = createHarness()
    const nextInterception: { current: MoveInterception | null } = { current: null }
    const tab = await createTab(harness, {
      label: 'prediction-ordering-tab',
      api: (getTab) => createInterceptableMoveApi(harness, getTab, nextInterception),
    })
    await waitForCaughtUp(tab)
    await tab.hydrate()
    await waitForReady(tab)

    const heldSseFirst = createMoveInterception('hold-after-server')
    nextInterception.current = heldSseFirst
    const sseFirst = tab.commands.moveToken({ placementId: 'token-alpha', position: { x: 4, y: 0, z: 4 } })
    await vi.waitFor(() => expect(heldSseFirst.bodies).toHaveLength(1))
    await vi.waitFor(() => expect(tab.currentMap?.revision).toBe(1))
    expect(tab.pendingPredictionOpIds).toEqual([])
    expect(tab.pendingOutboxOpIds).toEqual([])
    expect(moveTokenPosition(tab.currentMap, 'token-alpha')).toEqual({ x: 4, y: 0, z: 4 })

    heldSseFirst.gate.resolve()
    await expect(sseFirst).resolves.toMatchObject({ dispatched: true, opId: interceptedOpId(heldSseFirst) })
    expect(tab.currentMap?.revision).toBe(1)
    expect(moveTokenPosition(harness.readMap(), 'token-alpha')).toEqual({ x: 4, y: 0, z: 4 })

    harness.serverA.publishLocalWakeups = false
    const httpFirst = await tab.commands.moveToken({ placementId: 'token-beta', position: { x: 6, y: 0, z: 2 } })
    expect(httpFirst).toMatchObject({ dispatched: true })
    expect(tab.currentMap?.revision).toBe(2)
    expect(moveTokenPosition(tab.currentMap, 'token-beta')).toEqual({ x: 6, y: 0, z: 2 })
    const presentationCount = tab.presentationEvents.length
    const duplicateEvent = harness.realtime.getBySequence(harness.realtime.cursorState().latestSequence)?.event

    harness.serverA.publishLocalWakeups = true
    if (duplicateEvent) harness.serverA.hub.publishSequencedRealtime(duplicateEvent)
    await flushAsync()
    expect(tab.currentMap?.revision).toBe(2)
    expect(tab.presentationEvents).toHaveLength(presentationCount)
    expect(moveTokenPosition(harness.readMap(), 'token-alpha')).toEqual({ x: 4, y: 0, z: 4 })
    expect(moveTokenPosition(harness.readMap(), 'token-beta')).toEqual({ x: 6, y: 0, z: 2 })
  })

  it('clears predictions on replay-gap snapshot recovery while preserving uncertain outbox recovery', async () => {
    const harness = createHarness()
    const nextInterception: { current: MoveInterception | null } = { current: null }
    const tab = await createTab(harness, {
      label: 'prediction-gap-tab',
      api: (getTab) => createInterceptableMoveApi(harness, getTab, nextInterception),
    })
    await waitForCaughtUp(tab)
    await tab.hydrate()
    await waitForReady(tab)

    const heldUncertain = createMoveInterception('fail-before-server')
    nextInterception.current = heldUncertain
    const uncertainMove = tab.commands.moveToken({ placementId: 'token-alpha', position: { x: 7, y: 0, z: 7 } })
    await vi.waitFor(() => expect(heldUncertain.bodies).toHaveLength(1))
    const uncertainOpId = interceptedOpId(heldUncertain)
    expect(tab.pendingPredictionOpIds).toEqual([uncertainOpId])
    expect(moveTokenPosition(tab.currentMap, 'token-alpha')).toEqual({ x: 7, y: 0, z: 7 })

    tab.latestSource?.emitTransportError()
    await flushAsync()
    await harness.executeCommandPath(
      MAP_API_PATHS.moveToken,
      harness.moveTokenCommand({ baseRevision: 0, placementId: 'token-beta', position: { x: 2, y: 0, z: 6 }, clientId: 'remote-gap' }),
      'gm',
      null,
    )
    const latest = harness.realtime.cursorState().latestSequence
    harness.pruneRealtimeThrough(latest)
    tab.sessionStorage.setItem('rotom:realtime-cursor:v1:gm', JSON.stringify({
      schema: 'rotom.realtime.cursor',
      version: 1,
      sequence: 0,
    }))
    tab.timers.runAll()
    await flushAsync()
    await vi.waitFor(() => expect(tab.currentMap?.revision).toBe(1))
    expect(tab.pendingPredictionOpIds).toEqual([])
    expect(moveTokenPosition(tab.currentMap, 'token-alpha')).toEqual({ x: 1, y: 0, z: 1 })
    expect(moveTokenPosition(tab.currentMap, 'token-beta')).toEqual({ x: 2, y: 0, z: 6 })

    heldUncertain.gate.resolve()
    await expect(uncertainMove).resolves.toMatchObject({ dispatched: false, uncertain: true, opId: uncertainOpId })
    await tab.commands.refreshOutboxEntries()
    expect(tab.pendingOutboxOpIds).toEqual([uncertainOpId])
    expect(tab.pendingPredictionOpIds).toEqual([])
    await expect(tab.commands.checkOutboxCommandStatus(uncertainOpId)).resolves.toMatchObject({ status: 'unknown', opId: uncertainOpId })
    expect(tab.pendingPredictionOpIds).toEqual([])
    expect(moveTokenPosition(tab.currentMap, 'token-alpha')).toEqual({ x: 1, y: 0, z: 1 })
    expect(moveTokenPosition(harness.readMap(), 'token-beta')).toEqual({ x: 2, y: 0, z: 6 })
  })

  it('keeps profile scopes, stale profile events, and logout transport isolated', async () => {
    const harness = createHarness()
    const ash = 'profile_ash00000' as PlayerProfileId
    const misty = 'profile_misty000' as PlayerProfileId
    const tab = await createTab(harness, { label: 'player-tab', role: 'player', profileId: ash })
    await waitForCaughtUp(tab)
    await tab.hydrate()
    await waitForReady(tab)

    expect(tab.trainerSheets.has('ash')).toBe(true)
    expect(tab.pokemonSheets.has('alpha-mon')).toBe(true)
    const oldSource = tab.latestSource

    const switchPromise = tab.switchProfile(misty)
    expect(oldSource?.closed).toBe(true)
    expect(tab.pokemonSheets.has('alpha-mon')).toBe(false)
    oldSource?.deliverRawData(JSON.stringify({
      channel: sheetsChannel,
      type: 'updated',
      sequence: harness.realtime.cursorState().latestSequence + 1,
      timestamp: harness.nextTimestamp(),
      data: { kind: 'pokemon', slug: 'alpha-mon', sheet: { ...harness.readSheet('pokemon', 'alpha-mon').sheet, revision: 99 } },
    }))
    await switchPromise
    await waitForCaughtUp(tab)
    await tab.hydrate('Selected player profile changed.')
    await waitForReady(tab)

    expect(tab.trainerSheets.has('ash')).toBe(false)
    expect(tab.trainerSheets.has('misty')).toBe(true)
    expect(tab.pokemonSheets.has('staryu')).toBe(true)
    expect(tab.pokemonSheets.get('alpha-mon')?.revision).not.toBe(99)
    expect(tab.cursorStorage.readCursor(`player:${ash}`)).not.toBeNull()
    expect(tab.cursorStorage.readCursor(`player:${misty}`)).not.toBeNull()

    await tab.switchProfile(null)
    await waitForCaughtUp(tab)
    expect(tab.latestSource?.url).toBe('/api/events')
    expect(tab.cursorStorage.readCursor('player:none')).not.toBeNull()

    await tab.setRole(null)
    expect(tab.latestSource?.closed).toBe(true)
    expect(tab.readiness.value).toBe(false)
  })

  it('keeps manual outbox status, abandonment, and retry recovery idempotent without replaying local presentation', async () => {
    const harness = createHarness()
    let gameplayPosts = 0
    const tab = await createTab(harness, {
      label: 'outbox-matrix-tab',
      api: (getTab) => ({
        getJson: (path, options) => {
          const tab = getTab()
          return harness.apiGet(path, options, tab.role.value, tab.selectedProfileId.value)
        },
        postJson: (path, body) => {
          if (path !== MAP_API_PATHS.operationStatus && path !== MAP_API_PATHS.operationAbandon) gameplayPosts += 1
          const tab = getTab()
          return harness.apiPost(path, body, tab.role.value, tab.selectedProfileId.value)
        },
      }),
    })
    await waitForCaughtUp(tab)
    await tab.hydrate()
    await waitForReady(tab)

    const originalPosition = moveTokenPosition(tab.currentMap)
    const body = harness.moveTokenCommand({
      opId: 'op_manualrecover1',
      baseRevision: tab.currentMap?.revision ?? 0,
      position: { x: 7, y: 0, z: 1 },
    }) as unknown as Record<string, unknown>
    const queued = await tab.outbox.enqueue({
      requestPath: MAP_API_PATHS.moveToken,
      body,
      authContext: { role: 'gm', profileId: null },
    })
    await tab.commands.refreshOutboxEntries()
    await flushAsync()

    expect(queued.opId).toBe('op_manualrecover1')
    expect(tab.commands.outboxEntries.value).toHaveLength(1)
    expect(tab.readiness.value).toBe(false)
    expect(tab.presentationEvents).toEqual([])

    await expect(tab.commands.checkOutboxCommandStatus(queued.opId)).resolves.toMatchObject({ status: 'unknown' })
    expect(tab.commands.outboxEntries.value).toHaveLength(1)
    expect(gameplayPosts).toBe(0)
    expect(moveTokenPosition(tab.currentMap)).toEqual(originalPosition)

    await expect(tab.commands.abandonOutboxCommand(queued.opId)).resolves.toMatchObject({ status: 'abandoned' })
    expect(tab.commands.outboxEntries.value).toEqual([])
    expect(await tab.outbox.get(queued.opId)).toBeNull()
    expect(gameplayPosts).toBe(0)
    expect(tab.presentationEvents).toEqual([])
    expect(moveTokenPosition(tab.currentMap)).toEqual(originalPosition)
    await waitForReady(tab)

    await expect(tab.commands.retryOutboxCommand(queued.opId)).resolves.toMatchObject({ dispatched: false })
    expect(gameplayPosts).toBe(0)
    expect(tab.readiness.value).toBe(false)
    expect(tab.commands.outboxRecoveryError.value).toContain('no longer present')
  })

  it('lets two tabs share outbox storage but keep independent cursors, client runtimes, and convergent map revisions', async () => {
    const harness = createHarness()
    const tabOne = await createTab(harness, { label: 'tab-one', databaseName: 'shared-chaos-outbox' })
    await waitForCaughtUp(tabOne)
    await tabOne.hydrate()
    await waitForReady(tabOne)

    const tabTwo = await createTab(harness, { label: 'tab-two', databaseName: 'shared-chaos-outbox' })
    await waitForCaughtUp(tabTwo)
    await tabTwo.hydrate()
    await waitForReady(tabTwo)

    expect(tabOne.cursorStorage).not.toBe(tabTwo.cursorStorage)
    const direct = await harness.executeCommandPath(
      MAP_API_PATHS.moveToken,
      harness.moveTokenCommand({ baseRevision: 0, position: { x: 6, y: 0, z: 6 }, clientId: 'tab-one-client' }),
      'gm',
      null,
    )
    expect(direct).toMatchObject({ result: { ok: true } })
    await vi.waitFor(() => expect(tabTwo.currentMap?.revision).toBe(tabOne.currentMap?.revision))
    expect(moveTokenPosition(tabOne.currentMap)).toEqual({ x: 6, y: 0, z: 6 })
    expect(moveTokenPosition(tabTwo.currentMap)).toEqual({ x: 6, y: 0, z: 6 })
    expect(tabOne.cursorStorage.readCursor('gm')).toBeGreaterThan(0)
    expect(tabTwo.cursorStorage.readCursor('gm')).toBeGreaterThan(0)

    const queued = await tabOne.outbox.enqueue({
      requestPath: MAP_API_PATHS.moveToken,
      body: harness.moveTokenCommand({ baseRevision: tabOne.currentMap?.revision ?? 0, position: { x: 7, y: 0, z: 7 } }) as unknown as Record<string, unknown>,
      authContext: { role: 'gm', profileId: null },
    })
    await tabTwo.commands.refreshOutboxEntries()
    expect(tabTwo.commands.outboxEntries.value.map((entry) => entry.opId)).toContain(queued.opId)
    await expect(tabTwo.commands.retryOutboxCommand(queued.opId)).resolves.toMatchObject({ dispatched: true, opId: queued.opId })
    await tabOne.commands.refreshOutboxEntries()
    expect(tabOne.commands.outboxEntries.value).toEqual([])
    expect(tabTwo.commands.outboxEntries.value).toEqual([])
    expect(moveTokenPosition(tabOne.currentMap)).toEqual({ x: 7, y: 0, z: 7 })
  })

  it('delivers process-A commits to a process-B SSE stream through SQLite polling exactly once, even with an additional wake-up', async () => {
    vi.useFakeTimers()
    const harness = createHarness()
    harness.serverA.publishLocalWakeups = false
    const tab = await createTab(harness, { label: 'process-b-tab', server: harness.serverB })
    await waitForCaughtUp(tab)
    await tab.hydrate()
    await waitForReady(tab)

    await harness.executeCommandPath(
      MAP_API_PATHS.moveToken,
      harness.moveTokenCommand({ baseRevision: 0, position: { x: 3, y: 0, z: 2 }, clientId: 'process-a' }),
      'gm',
      null,
    )
    expect(tab.currentMap?.revision).toBe(0)
    await vi.advanceTimersByTimeAsync(100)
    await vi.waitFor(() => expect(tab.currentMap?.revision).toBe(1))
    expect(moveTokenPosition(tab.currentMap)).toEqual({ x: 3, y: 0, z: 2 })

    const lastEvent = harness.realtime.getBySequence(harness.realtime.cursorState().latestSequence)?.event
    if (lastEvent) harness.serverB.hub.publishSequencedRealtime(lastEvent)
    await vi.advanceTimersByTimeAsync(100)
    expect(tab.currentMap?.revision).toBe(1)
  })

  it('rejects malformed or partial realtime data conservatively and cleanup leaves no active test timers or sources', async () => {
    const harness = createHarness()
    let liveStateLoads = 0
    let failSnapshot = false
    const tab = await createTab(harness, {
      label: 'malformed-tab',
      api: (getTab) => ({
        getJson: async (path, options) => {
          if (path === MAP_API_PATHS.liveState) {
            liveStateLoads += 1
            if (failSnapshot) throw new Error('malformed recovery snapshot failed')
          }
          const tab = getTab()
          return harness.apiGet(path, options, tab.role.value, tab.selectedProfileId.value)
        },
        postJson: (path, body) => harness.apiPost(path, body, getTab().role.value, getTab().selectedProfileId.value),
      }),
    })
    await waitForCaughtUp(tab)
    await tab.hydrate()
    await waitForReady(tab)
    const cursorBefore = tab.cursorStorage.readCursor('gm')
    const revisionBefore = tab.currentMap?.revision

    failSnapshot = true
    tab.latestSource?.deliverRawData('{ not json')
    await flushAsync()
    expect(tab.cursorStorage.readCursor('gm')).toBe(cursorBefore)
    await vi.waitFor(() => expect(tab.snapshot.status.value).toBe('error'))
    expect(tab.readiness.value).toBe(false)
    failSnapshot = false
    tab.timers.runAll()
    await tab.map.reconcileAuthoritativeMap('Retrying malformed recovery.')
    await vi.waitFor(() => expect(liveStateLoads).toBeGreaterThanOrEqual(3))
    await waitForReady(tab)
    expect(tab.currentMap?.revision).toBe(revisionBefore)

    tab.latestSource?.deliverRawData(JSON.stringify({
      channel: mapChannel('chaos-arena'),
      type: LIVE_PLAY_REALTIME_EVENT_TYPES.COMMAND_ACCEPTED,
      sequence: (tab.cursorStorage.readCursor('gm') ?? 0) + 1,
      timestamp: harness.nextTimestamp(),
      mapSlug: 'chaos-arena',
      opId: 'op_badpatch0001',
      previousRevision: tab.currentMap?.revision ?? 0,
      revision: (tab.currentMap?.revision ?? 0) + 1,
      patches: [{
        schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
        type: LIVE_PLAY_PATCH_TYPES.RECONCILIATION_REQUIRED,
        mapSlug: 'chaos-arena',
        revision: (tab.currentMap?.revision ?? 0) + 1,
        scopes: [],
        payload: {},
      }],
    }))
    await vi.waitFor(() => expect(tab.map.realtimeReconciliationStatus.value).toBe('reconciled'))
    expect(tab.currentMap?.revision).toBe(revisionBefore)

    tab.dispose()
    expect(tab.timers.pendingCount()).toBe(0)
    expect(harness.sources.every((source) => source.closed)).toBe(true)
    tabs = tabs.filter((candidate) => candidate !== tab)
  })

  it('does not let a pending setup autosave overwrite live-play command state after switching to Run Live Play', async () => {
    const harness = createHarness({ mode: MAP_INTERACTION_MODES.SETUP_EDIT })
    const tab = await createTab(harness, { label: 'setup-live-tab' })
    await waitForCaughtUp(tab)
    await tab.hydrate()
    expect(tab.mode.interactionMode.value).toBe(MAP_INTERACTION_MODES.SETUP_EDIT)

    if (!tab.currentMap) throw new Error('map did not hydrate')
    tab.currentMap.name = 'Unsaved setup name'
    await flushAsync()
    expect(tab.map.status.value).toBe('saving')

    await tab.mode.setInteractionMode(MAP_INTERACTION_MODES.LIVE_PLAY)
    tab.timers.runAll()
    await flushAsync()
    await waitForReady(tab)

    const liveResult = await tab.commands.moveToken({ placementId: 'token-alpha', position: { x: 2, y: 0, z: 5 } })
    expect(liveResult).toMatchObject({ dispatched: true })
    expect(harness.readMap().name).toBe('Chaos Arena')
    expect(moveTokenPosition(harness.readMap())).toEqual({ x: 2, y: 0, z: 5 })
  })
})

import { afterEach, describe, expect, it } from 'vitest'
import { LivePlayIntegrationHarness, assertAccepted } from './livePlayIntegrationHarness'

const harnesses: LivePlayIntegrationHarness[] = []

const createHarness = (): LivePlayIntegrationHarness => {
  const harness = LivePlayIntegrationHarness.create()
  harnesses.push(harness)
  return harness
}

afterEach(() => {
  while (harnesses.length > 0) harnesses.pop()?.dispose()
})

describe('live-play concurrent player integration harness', () => {
  it('preserves concurrent player commands, idempotent retries, stale rejection, and reconnect reloads', async () => {
    const harness = createHarness()
    const playerAProfile = harness.createPlayerProfile({
      id: 'profile_playerA01',
      displayName: 'Player A',
      linkedCharacters: [{ sheetKind: 'pokemon', sheetSlug: 'alpha-mon' }],
    })
    const playerBProfile = harness.createPlayerProfile({
      id: 'profile_playerB01',
      displayName: 'Player B',
      linkedCharacters: [{ sheetKind: 'pokemon', sheetSlug: 'beta-mon' }],
    })
    const gm = { role: 'gm' as const, clientId: 'gm-client' }
    const playerA = { role: 'player' as const, clientId: 'player-a-client', playerProfile: playerAProfile }
    const playerB = { role: 'player' as const, clientId: 'player-b-client', playerProfile: playerBProfile }

    const gmClient = await harness.loadClient(gm.clientId)
    const playerAClient = await harness.loadClient(playerA.clientId)
    const playerBClient = await harness.loadClient(playerB.clientId)

    expect(gmClient.map?.revision).toBe(0)
    expect(playerAClient.map?.revision).toBe(0)
    expect(playerBClient.map?.revision).toBe(0)

    const moveACommand = harness.moveTokenCommand({
      opId: 'op_integration_move_a',
      baseRevision: playerAClient.map?.revision ?? 0,
      placementId: 'token-a',
      position: { x: 4, y: 0, z: 1 },
    })
    const moveBCommand = harness.moveTokenCommand({
      opId: 'op_integration_move_b',
      baseRevision: playerBClient.map?.revision ?? 0,
      placementId: 'token-b',
      position: { x: 5, y: 0, z: 2 },
    })

    const [moveA, moveB] = await Promise.all([
      harness.moveToken({ actor: playerA, command: moveACommand }),
      harness.moveToken({ actor: playerB, command: moveBCommand }),
    ])
    expect(assertAccepted(moveA.result).revision).toBeGreaterThan(0)
    expect(assertAccepted(moveB.result).revision).toBeGreaterThan(0)

    const afterMoves = await harness.readMap()
    expect(afterMoves?.revision).toBe(2)
    expect(afterMoves?.placements.find((placement) => placement.id === 'token-a')?.position).toEqual({ x: 4, y: 0, z: 1 })
    expect(afterMoves?.placements.find((placement) => placement.id === 'token-b')?.position).toEqual({ x: 5, y: 0, z: 2 })
    expect(gmClient.map?.revision).toBe(2)
    expect(playerAClient.map?.revision).toBe(2)
    expect(playerBClient.map?.revision).toBe(2)

    playerBClient.disconnect()

    const initiativeCommand = harness.nextInitiativeCommand({
      opId: 'op_integration_next_init',
      baseRevision: gmClient.map?.revision ?? 2,
    })
    const initiative = await harness.nextInitiative({ actor: gm, command: initiativeCommand })
    expect(assertAccepted(initiative.result)).toMatchObject({ previousRevision: 2, revision: 3 })
    expect(gmClient.map?.initiative).toEqual({ activeId: 'token-b', round: 1 })
    expect(playerBClient.map?.revision).toBe(2)
    expect(playerBClient.missedEvents).toBe(1)

    const hpCommand = harness.modifyHpCommand({
      opId: 'op_integration_hp_a',
      baseRevision: playerAClient.map?.revision ?? 3,
      placementId: 'token-a',
      sheetKind: 'pokemon',
      sheetSlug: 'alpha-mon',
      currentHp: 17,
      injuries: 1,
    })
    const hp = await harness.modifyHp({ actor: playerA, command: hpCommand })
    expect(assertAccepted(hp.result)).toMatchObject({ previousRevision: 3, revision: 4 })
    expect(playerAClient.map?.revision).toBe(4)
    expect(playerBClient.map?.revision).toBe(2)
    expect(playerBClient.missedEvents).toBe(2)

    const recordsBeforeDuplicateRetry = harness.operationRecordCount()
    const duplicateHp = await harness.modifyHp({ actor: playerA, command: hpCommand })
    expect(duplicateHp.result).toEqual(hp.result)
    expect(harness.operationRecordCount()).toBe(recordsBeforeDuplicateRetry)

    const useMoveCommand = harness.useMoveCommand({
      opId: 'op_integration_use_move_b',
      baseRevision: playerBClient.map?.revision ?? 2,
      placementId: 'token-b',
      sheetKind: 'pokemon',
      sheetSlug: 'beta-mon',
      moveName: 'Daily Spark',
      daily: true,
    })
    const useMove = await harness.useMove({ actor: playerB, command: useMoveCommand })
    expect(assertAccepted(useMove.result)).toMatchObject({ previousRevision: 4, revision: 5 })
    expect(playerBClient.map?.revision).toBe(2)
    expect(playerBClient.missedEvents).toBe(3)

    const staleSameResourceCommand = harness.moveTokenCommand({
      opId: 'op_integration_stale_a',
      baseRevision: harness.staleBaseRevision(),
      placementId: 'token-a',
      position: { x: 1, y: 0, z: 6 },
    })
    const staleMove = await harness.moveToken({ actor: playerA, command: staleSameResourceCommand })
    expect(staleMove.result).toMatchObject({
      ok: false,
      reason: 'conflict',
      currentRevision: 5,
    })

    const finalMap = await harness.readMap()
    const finalAlphaSheet = await harness.readSheet('pokemon', 'alpha-mon')
    const finalBetaSheet = await harness.readSheet('pokemon', 'beta-mon')

    expect(finalMap?.revision).toBe(5)
    expect(finalMap?.placements.find((placement) => placement.id === 'token-a')?.position).toEqual({ x: 4, y: 0, z: 1 })
    expect(finalMap?.placements.find((placement) => placement.id === 'token-b')?.position).toEqual({ x: 5, y: 0, z: 2 })
    expect(finalMap?.initiative).toEqual({ activeId: 'token-b', round: 1 })
    expect(finalAlphaSheet?.revision).toBe(1)
    expect(finalAlphaSheet?.sheet.combat).toMatchObject({ currentHp: 17, injuries: 1 })
    expect(finalBetaSheet?.revision).toBe(1)
    expect(finalBetaSheet?.sheet.moveUsage).toEqual({
      daily: {
        'daily-spark': expect.objectContaining({ moveName: 'Daily Spark', uses: 1 }),
      },
    })

    expect(harness.acceptedOperationRevisions()).toEqual([1, 2, 3, 4, 5])
    expect(harness.publishedEvents
      .filter((event) => event.type === 'live-play-command-accepted')
      .map((event) => event.opId)
      .sort()).toEqual([
      'op_integration_hp_a',
      'op_integration_move_a',
      'op_integration_move_b',
      'op_integration_next_init',
      'op_integration_use_move_b',
    ].sort())
    expect(harness.publishedEvents.some((event) => event.type === 'updated' && event.channel === 'map:integration-arena')).toBe(false)
    expect(staleMove.result.ok).toBe(false)
    expect(harness.operationRecordCount()).toBe(6)

    expect(playerBClient.patchFailures).toEqual([])
    await playerBClient.reconnect()
    expect(playerBClient.map).toEqual(finalMap)
    expect(gmClient.patchFailures).toEqual([])
    expect(playerAClient.patchFailures).toEqual([])
    expect(gmClient.map?.revision).toBe(5)
    expect(playerAClient.map?.revision).toBe(5)
    expect(gmClient.map?.placements.find((placement) => placement.id === 'token-a')?.position).toEqual({ x: 4, y: 0, z: 1 })
    expect(playerAClient.map?.placements.find((placement) => placement.id === 'token-b')?.position).toEqual({ x: 5, y: 0, z: 2 })
    expect([moveA.result, moveB.result, initiative.result, hp.result, useMove.result]
      .every((result) => result.ok === true && !('duplicate' in result))).toBe(true)
    expect(useMoveCommand.baseRevision).toBeLessThan(assertAccepted(useMove.result).previousRevision)
    expect(staleSameResourceCommand.baseRevision).toBeLessThan(assertAccepted(moveA.result).revision)
  })
})

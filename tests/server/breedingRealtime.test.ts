import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { stableJsonStringify } from '#shared/automation/stableJson'
import type { PlayerProfile, PlayerProfileDisplayName, PlayerProfileId } from '#shared/playerProfiles'
import {
  BREEDING_REALTIME_EVENT_JSON_BYTES_MAXIMUM,
  adoptBreedingRealtimeRefreshEventV1,
  adoptBreedingRealtimeReplayControlV1,
  adoptBreedingRealtimeSnapshotV1,
  createBreedingRealtimeAdoptionStateV1,
  parseBreedingRealtimeRefreshEventV1,
  parseBreedingRealtimeSnapshotV1,
} from '#shared/breeding/realtime'
import type { RealtimeEventAccess } from '#shared/realtimeEventLog'
import { buildBreedingPublicProjectionV1 } from '../../server/domain/breeding/projections'
import {
  breedingRealtimeRefreshAppendInputs,
  buildBreedingRealtimeSnapshotV1,
} from '../../server/realtime/breedingRealtime'
import {
  evaluateRealtimeEventAccess,
  type RealtimeEventAccessDependencies,
} from '../../server/realtime/realtimeEventAccessPolicy'
import { publishPersistedRealtimeEventsAfterCommit } from '../../server/realtime/persistedBatchPublication'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteRealtimeEventRepository } from '../../server/storage/realtimeEventRepository'

const PROJECT_ID = 'breeding-project:v1:11111111111111111111111111111111'
const EGG_ID = 'pokemon-egg:v1:22222222222222222222222222222222'
const PROJECTION_KEY = '0123456789abcdef0123456789abcdef'
const SECURITY_HASH = 'b'.repeat(64)

const databases: RotomDatabase[] = []
const roots: string[] = []

afterEach(() => {
  for (const database of databases.splice(0)) database.close()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const openMemoryDatabase = (): RotomDatabase => {
  const database = openRotomDatabase({ path: ':memory:' })
  databases.push(database)
  return database
}

const publicProjection = (status: 'draft' | 'cancelled' = 'draft') => (
  buildBreedingPublicProjectionV1({
    aggregateKind: 'breeding-project',
    aggregateId: PROJECT_ID,
    status,
    accumulatedCampaignMinutes: 0,
    targetCampaignMinutes: 480,
    campaignProjectionKey: PROJECTION_KEY,
    securityPolicyDefinitionSha256: SECURITY_HASH,
  })
)

const targets = () => [
  { audience: 'public' as const, trainerSheetSlug: null },
  { audience: 'owner' as const, trainerSheetSlug: 'owner-trainer' },
  { audience: 'participating-owner' as const, trainerSheetSlug: 'participant-trainer' },
  { audience: 'gm' as const, trainerSheetSlug: null },
  { audience: 'diagnostic' as const, trainerSheetSlug: null },
]

const refreshInputs = (overrides: Partial<Parameters<typeof breedingRealtimeRefreshAppendInputs>[0]> = {}) => (
  breedingRealtimeRefreshAppendInputs({
    aggregateKind: 'breeding-project',
    aggregateId: PROJECT_ID,
    revision: 4,
    operationKind: 'grant-breeding-consent',
    audienceTargets: targets(),
    campaignProjectionKey: PROJECTION_KEY,
    timestamp: 1_700_000_000_000,
    ...overrides,
  })
)

const sequenced = (
  input: ReturnType<typeof refreshInputs>[number],
  sequence: number,
) => ({ ...input.event, sequence, timestamp: input.timestamp ?? 0 })

const profile = (trainerSheetSlug: string): PlayerProfile => ({
  schemaVersion: 1,
  id: 'profile_owner0000' as PlayerProfileId,
  displayName: 'Owner' as PlayerProfileDisplayName,
  linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: trainerSheetSlug }],
})

const dependencies = (trainerSlugs: readonly string[]): RealtimeEventAccessDependencies => ({
  getMap: vi.fn(() => null),
  getSheet: vi.fn((kind, slug) => kind === 'trainer' && trainerSlugs.includes(slug)
    ? { kind: 'trainer', slug, sheet: { slug, name: slug, folder: '' }, revision: 1, updatedAt: 1 }
    : null),
  getGroupInventory: vi.fn(() => null),
  getShop: vi.fn(() => null),
  getPendingMoveResolution: vi.fn(() => null),
  listTrainerSheets: vi.fn(() => []),
  playerVisibleMapSheetAccessKeys: vi.fn(() => new Set()),
})

const eventForAudience = (
  stored: readonly { readonly access: RealtimeEventAccess, readonly event: unknown }[],
  audience: string,
) => stored.find(row => row.access.kind === 'breeding-access' && row.access.audience === audience)!

const snapshot = (input: {
  readonly revision: number
  readonly throughSequence: number
  readonly status?: 'draft' | 'cancelled'
}) => buildBreedingRealtimeSnapshotV1({
  audience: 'public',
  throughSequence: input.throughSequence,
  campaignProjectionKey: PROJECTION_KEY,
  entries: [{
    aggregateId: PROJECT_ID,
    revision: input.revision,
    projection: publicProjection(input.status),
  }],
})

describe('breeding realtime refresh contracts', () => {
  it('keeps the reviewed contract hash-bound to runtime and privacy boundaries', () => {
    const contract = JSON.parse(readFileSync(
      'data/breeding-automation/realtime-contract.json',
      'utf8',
    )) as Record<string, any>
    const hash = createHash('sha256').update(stableJsonStringify(contract.definition)).digest('hex')

    expect(contract.definitionSha256).toBe(hash)
    expect(contract.definition.sharedEventAndAdoptionPath).toBe('shared/breeding/realtime.ts')
    expect(contract.definition.serverBuilderPath).toBe('server/realtime/breedingRealtime.ts')
    expect(contract.definition.event.maximumCanonicalJsonBytes).toBe(4096)
    expect(contract.definition.event.accessDescriptorOnWire).toBe(false)
    expect(contract.definition.forbiddenPayload).toContain('roll-check-or-adjudication')
    expect(contract.definition.adoption.replayGapOrAhead).toMatch(/discard-all-local-projections/)
  })

  it('builds one bounded, refresh-only event per exact audience descriptor', () => {
    const rows = refreshInputs()

    expect(rows).toHaveLength(5)
    expect(rows.map(row => row.access)).toEqual([
      { kind: 'breeding-access', audience: 'public', trainerSheetSlug: null },
      { kind: 'breeding-access', audience: 'owner', trainerSheetSlug: 'owner-trainer' },
      { kind: 'breeding-access', audience: 'participating-owner', trainerSheetSlug: 'participant-trainer' },
      { kind: 'breeding-access', audience: 'gm', trainerSheetSlug: null },
      { kind: 'breeding-access', audience: 'diagnostic', trainerSheetSlug: null },
    ])

    const parsed = rows.map((row, index) => parseBreedingRealtimeRefreshEventV1(
      sequenced(row, index + 1),
    ))
    expect(parsed.map(event => event.data.audienceRefreshScope)).toEqual([
      'public', 'owner', 'participating-owner', 'gm', 'diagnostic',
    ])
    expect(new Set(parsed.map(event => event.data.aggregateIdentitySha256)).size).toBe(1)
    for (const event of parsed) {
      expect(Object.keys(event.data).sort()).toEqual([
        'aggregateIdentitySha256',
        'aggregateKind',
        'audienceRefreshScope',
        'operationKind',
        'revision',
        'schemaVersion',
      ])
      expect(new TextEncoder().encode(JSON.stringify(event)).byteLength)
        .toBeLessThanOrEqual(BREEDING_REALTIME_EVENT_JSON_BYTES_MAXIMUM)
      const wire = JSON.stringify(event)
      expect(wire).not.toContain(PROJECT_ID)
      expect(wire).not.toContain('owner-trainer')
      expect(wire).not.toContain('participant-trainer')
      for (const forbiddenField of ['parents', 'consents', 'profiles', 'rolls', 'choices', 'lineage', 'sheets']) {
        expect(wire).not.toContain(`"${forbiddenField}"`)
      }
    }
  })

  it('rejects malformed, enriched, contradictory, duplicate, and unsupported targets', () => {
    const valid = sequenced(refreshInputs()[0]!, 1)
    expect(() => parseBreedingRealtimeRefreshEventV1({
      ...valid,
      data: { ...valid.data, parents: [] },
    })).toThrow(/exactly/)
    expect(() => parseBreedingRealtimeRefreshEventV1({
      ...valid,
      channel: 'breeding:owner',
    })).toThrow(/audienceRefreshScope/)
    expect(() => breedingRealtimeRefreshAppendInputs({
      aggregateKind: 'pokemon-egg',
      aggregateId: EGG_ID,
      revision: 0,
      operationKind: 'create-source-egg',
      audienceTargets: [{ audience: 'participating-owner', trainerSheetSlug: 'owner-trainer' }],
      campaignProjectionKey: PROJECTION_KEY,
      timestamp: 1,
    })).toThrow(/no participating-owner/)
    expect(() => refreshInputs({ audienceTargets: [targets()[0]!, targets()[0]!] }))
      .toThrow(/duplicate/)
    expect(() => refreshInputs({
      audienceTargets: [{ audience: 'owner', trainerSheetSlug: null } as never],
    })).toThrow(/trainerSheetSlug/)

    const accessor: Record<string, unknown> = { ...valid.data }
    Object.defineProperty(accessor, 'revision', { enumerable: true, get: () => 4 })
    expect(() => parseBreedingRealtimeRefreshEventV1({ ...valid, data: accessor }))
      .toThrow(/accessor|JSON-serializable/)
  })
})

describe('breeding realtime access policy', () => {
  it('requires exact audience-event binding and direct selected-Profile Trainer control', () => {
    const rows = refreshInputs().map((row, index) => ({
      access: row.access,
      event: sequenced(row, index + 1),
    }))
    const deps = dependencies(['owner-trainer', 'participant-trainer'])
    const owner = eventForAudience(rows, 'owner')
    const participant = eventForAudience(rows, 'participating-owner')
    const publicEvent = eventForAudience(rows, 'public')

    expect(evaluateRealtimeEventAccess({
      access: owner.access,
      event: owner.event,
      principal: { role: 'player', playerProfile: profile('owner-trainer') },
      dependencies: deps,
    })).toEqual({ allowed: true })
    expect(evaluateRealtimeEventAccess({
      access: participant.access,
      event: participant.event,
      principal: { role: 'player', playerProfile: profile('participant-trainer') },
      dependencies: deps,
    })).toEqual({ allowed: true })
    expect(evaluateRealtimeEventAccess({
      access: owner.access,
      event: owner.event,
      principal: {
        role: 'player',
        playerProfile: null,
        sessionAccess: { sheetKeys: new Set(['trainer:owner-trainer']) },
      },
      dependencies: deps,
    })).toEqual({ allowed: false, reason: 'breeding-not-accessible' })
    expect(evaluateRealtimeEventAccess({
      access: owner.access,
      event: publicEvent.event,
      principal: { role: 'player', playerProfile: profile('owner-trainer') },
      dependencies: deps,
    })).toEqual({ allowed: false, reason: 'invalid-access' })
    expect(evaluateRealtimeEventAccess({
      access: publicEvent.access,
      event: publicEvent.event,
      principal: { role: 'player', playerProfile: null },
      dependencies: deps,
    })).toEqual({ allowed: true })
  })

  it('separates GM and diagnostic delivery and denies transient breeding events', () => {
    const rows = refreshInputs().map((row, index) => ({
      access: row.access,
      event: sequenced(row, index + 1),
    }))
    const deps = dependencies([])
    const gm = eventForAudience(rows, 'gm')
    const diagnostic = eventForAudience(rows, 'diagnostic')

    expect(evaluateRealtimeEventAccess({
      access: gm.access, event: gm.event, principal: { role: 'gm' }, dependencies: deps,
    })).toEqual({ allowed: true })
    expect(evaluateRealtimeEventAccess({
      access: diagnostic.access,
      event: diagnostic.event,
      principal: { role: 'gm' },
      dependencies: deps,
    })).toEqual({ allowed: false, reason: 'breeding-not-accessible' })
    expect(evaluateRealtimeEventAccess({
      access: diagnostic.access,
      event: diagnostic.event,
      principal: { role: 'gm', breedingDiagnosticAccess: true },
      dependencies: deps,
    })).toEqual({ allowed: true })
    expect(evaluateRealtimeEventAccess({
      access: gm.access,
      event: refreshInputs({
        audienceTargets: [{ audience: 'gm', trainerSheetSlug: null }],
      })[0]!.event,
      principal: { role: 'gm' },
      dependencies: deps,
    })).toEqual({ allowed: false, reason: 'invalid-access' })
  })
})

describe('breeding realtime snapshots and replay adoption', () => {
  it('adopts monotonic refreshes, fails closed on replay gaps, and replaces from a fresh snapshot', () => {
    let state = createBreedingRealtimeAdoptionStateV1('public')
    const initial = adoptBreedingRealtimeSnapshotV1(state, snapshot({ revision: 4, throughSequence: 10 }))
    expect(initial.decision).toBe('adopted-snapshot')
    state = initial.state

    const publicRow = refreshInputs({
      revision: 5,
      audienceTargets: [{ audience: 'public', trainerSheetSlug: null }],
    })[0]!
    const refresh = adoptBreedingRealtimeRefreshEventV1(state, sequenced(publicRow, 11))
    expect(refresh.decision).toBe('adopted-event')
    expect(refresh.state.invalidatedAggregateIdentitySha256).toHaveLength(1)
    state = refresh.state

    expect(adoptBreedingRealtimeRefreshEventV1(state, sequenced(publicRow, 11)).decision)
      .toBe('ignored-stale')
    const gap = adoptBreedingRealtimeReplayControlV1(state, {
      kind: 'realtime-control',
      type: 'reconcile-required',
      reason: 'gap',
      requestedAfterSequence: 5,
      earliestAvailableSequence: 7,
      latestSequence: 20,
    })
    expect(gap.decision).toBe('snapshot-required')
    expect(gap.state.snapshot).toBeNull()
    expect(gap.state.requiresSnapshotThroughSequence).toBe(20)

    expect(adoptBreedingRealtimeSnapshotV1(
      gap.state,
      snapshot({ revision: 5, throughSequence: 19 }),
    ).decision).toBe('ignored-stale')
    const replaced = adoptBreedingRealtimeSnapshotV1(
      gap.state,
      snapshot({ revision: 5, throughSequence: 20 }),
    )
    expect(replaced.decision).toBe('adopted-snapshot')
    expect(replaced.state.requiresSnapshotThroughSequence).toBeNull()
    expect(replaced.state.snapshot?.throughSequence).toBe(20)
  })

  it('resets an impossible ahead cursor to the authoritative latest sequence', () => {
    const adopted = adoptBreedingRealtimeSnapshotV1(
      createBreedingRealtimeAdoptionStateV1('public'),
      snapshot({ revision: 1, throughSequence: 30 }),
    )
    const reconciled = adoptBreedingRealtimeReplayControlV1(adopted.state, {
      kind: 'realtime-control',
      type: 'reconcile-required',
      reason: 'ahead',
      requestedAfterSequence: 31,
      earliestAvailableSequence: 1,
      latestSequence: 20,
    })

    expect(reconciled.decision).toBe('snapshot-required')
    expect(reconciled.state.lastSequence).toBe(20)
    expect(reconciled.state.requiresSnapshotThroughSequence).toBe(20)
    expect(reconciled.state.snapshot).toBeNull()
  })

  it('rejects cross-audience adoption, malformed snapshots, and same-cursor contradictions', () => {
    const first = snapshot({ revision: 1, throughSequence: 4, status: 'draft' })
    expect(parseBreedingRealtimeSnapshotV1(first)).toEqual(first)
    expect(() => parseBreedingRealtimeSnapshotV1({ ...first, privateRolls: [] })).toThrow(/exactly/)
    expect(() => parseBreedingRealtimeSnapshotV1({
      ...first,
      entries: [first.entries[0], first.entries[0]],
    })).toThrow(/unique/)

    const adopted = adoptBreedingRealtimeSnapshotV1(
      createBreedingRealtimeAdoptionStateV1('public'),
      first,
    )
    expect(() => adoptBreedingRealtimeSnapshotV1(
      adopted.state,
      snapshot({ revision: 1, throughSequence: 4, status: 'cancelled' }),
    )).toThrow(/same replay cursor/)

    const ownerRow = refreshInputs({
      audienceTargets: [{ audience: 'owner', trainerSheetSlug: 'owner-trainer' }],
    })[0]!
    expect(() => adoptBreedingRealtimeRefreshEventV1(
      adopted.state,
      sequenced(ownerRow, 5),
    )).toThrow(/authorized projection audience/)
  })
})

describe('breeding realtime durable repository integration', () => {
  it('persists exact descriptors across restart and retains deterministic dedupe replay', () => {
    const root = mkdtempSync(join(tmpdir(), 'rotom-breeding-realtime-'))
    roots.push(root)
    const path = join(root, 'campaign.sqlite')
    const database = openRotomDatabase({ path })
    databases.push(database)
    const repository = createSqliteRealtimeEventRepository({ database })
    const inputs = refreshInputs()

    const inserted = repository.appendMany(inputs)
    const replay = repository.appendMany(inputs)
    expect(replay).toEqual(inserted)
    expect(repository.cursorState()).toEqual({ latestSequence: 5, earliestAvailableSequence: 1 })
    database.close()

    const reopened = openRotomDatabase({ path })
    databases.push(reopened)
    const restarted = createSqliteRealtimeEventRepository({ database: reopened })
    const stored = restarted.readAfter({ afterSequence: 0, limit: 10 }).events

    expect(stored.map(row => row.sequence)).toEqual([1, 2, 3, 4, 5])
    expect(stored.map(row => row.access)).toEqual(inputs.map(row => row.access))
    expect(stored.map(row => parseBreedingRealtimeRefreshEventV1(row.event).data.revision))
      .toEqual([4, 4, 4, 4, 4])
  })

  it('rolls events back with caller transactions and publishes only committed rows in sequence order', () => {
    const database = openMemoryDatabase()
    const repository = createSqliteRealtimeEventRepository({ database })
    const rows = refreshInputs({
      audienceTargets: [
        { audience: 'gm', trainerSheetSlug: null },
        { audience: 'public', trainerSheetSlug: null },
      ],
    })
    const publish = vi.fn()

    expect(() => repository.append({
      ...rows[0]!,
      access: { kind: 'breeding-access', audience: 'owner', trainerSheetSlug: 'owner-trainer' },
    })).toThrow(/audience/)
    expect(repository.cursorState()).toEqual({ latestSequence: 0, earliestAvailableSequence: 1 })

    expect(() => database.withTransaction(() => {
      repository.appendMany(rows)
      expect(publish).not.toHaveBeenCalled()
      throw new Error('aggregate settlement failed')
    })).toThrow(/settlement failed/)
    expect(repository.cursorState()).toEqual({ latestSequence: 0, earliestAvailableSequence: 1 })

    const committed = database.withTransaction(() => repository.appendMany(rows))
    expect(publish).not.toHaveBeenCalled()
    publishPersistedRealtimeEventsAfterCommit({
      events: [...committed].reverse(),
      operation: 'breeding-test',
      publish,
      reportFailure: vi.fn(),
    })
    expect(publish.mock.calls.map(call => call[0].sequence)).toEqual([1, 2])
  })
})

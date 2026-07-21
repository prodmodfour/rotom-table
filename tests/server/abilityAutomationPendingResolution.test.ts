import { describe, expect, it } from 'vitest'
import { createAbilityResolutionTrace } from '#shared/abilityAutomation/trace'
import {
  PendingAbilityResolutionValidationError,
  parsePendingAbilityResolution,
  type PendingAbilityRead,
  type PendingAbilityResolution,
} from '#shared/abilityAutomation/pendingResolution'
import {
  PendingAbilityPersistenceError,
  assertPendingAbilityResolutionReads,
  persistPendingAbilityResolution,
  type PendingAbilityResolutionStore,
} from '../../server/domain/abilityAutomation/pendingResolution'

const DEFINITION_HASH = 'b'.repeat(64)
const trace = () => createAbilityResolutionTrace({
  resolutionId: 'resolution.pending-one',
  program: {
    canonicalId: 'Healer',
    modeId: 'mode-triggered',
    runtimeKind: 'abilityspec-v1',
    runtimeVersion: 1,
    definitionHash: DEFINITION_HASH,
    sourceModule: 'server/domain/abilityAutomation/specs/healer.ts',
  },
  ruleset: { rulesetId: 'ptu-1.05-plus-errata', sourceDataSha256: 'a'.repeat(64) },
  ancestry: [],
})

const pending = () => ({
  schemaVersion: 1,
  kind: 'pending-ability-resolution',
  status: 'pending',
  resolutionId: 'resolution.pending-one',
  operationId: 'operation.pending-one',
  requestSha256: 'c'.repeat(64),
  mapSlug: 'pending-arena',
  previousRevision: 8,
  revision: 9,
  createdAt: 1_000,
  updatedAt: 1_000,
  expiresAt: 31_000,
  trigger: {
    chainId: 'chain.one',
    triggerId: 'route.healer.one',
    eventId: 'event.hp.one',
    parentEventId: 'event.strike.one',
    ownerPlacementId: 'healer-token',
    abilityInstanceId: 'base:healer-token:0',
    canonicalId: 'Healer',
    modeId: 'mode-triggered',
    subscriptionId: 'subscription-heal',
    response: 'optional',
    runtimeVersion: 1,
    definitionHash: DEFINITION_HASH,
    sourceModule: 'server/domain/abilityAutomation/specs/healer.ts',
  },
  phase: 'effect',
  readSet: [
    { kind: 'map', slug: 'pending-arena', revision: 9 },
    { kind: 'sheet', sheetKind: 'pokemon', slug: 'healer', revision: 4 },
    { kind: 'group-inventory', slug: 'party', revision: 2 },
  ],
  window: {
    windowId: 'window.healer.optional',
    kind: 'optional-trigger',
    phase: 'effect',
    promptKey: 'ability.healer.optional.prompt',
    reasonCode: 'ability.healer.optional-trigger',
    owners: [
      { kind: 'principal', id: 'player-one' },
      { kind: 'gm', id: null },
    ],
    options: [{
      id: 'option.heal-target',
      presentationKey: 'ability.healer.option.heal',
      operationIds: ['operation.heal-target'],
    }],
    allowPass: true,
    priority: 20,
  },
  trace: trace(),
  rollLedger: [],
  continuation: {
    schemaVersion: 1,
    kind: 'abilityspec-v1',
    phase: 'effect',
    phaseIndex: 5,
    operationIndex: 2,
    completedOperationIds: ['operation.reserve-frequency'],
    choiceBindings: [{ declarationId: 'target.heal', optionIds: ['option.target-one'] }],
    chainId: 'chain.one',
    triggerId: 'route.healer.one',
  },
})

const revisionKey = (read: PendingAbilityRead): string => read.kind === 'sheet'
  ? `sheet:${read.sheetKind}:${read.slug}`
  : `${read.kind}:${read.slug}`

const inMemoryStore = (revisions = new Map([
  ['map:pending-arena', 9],
  ['sheet:pokemon:healer', 4],
  ['group-inventory:party', 2],
])): PendingAbilityResolutionStore & { records: Map<string, PendingAbilityResolution> } => {
  const records = new Map<string, PendingAbilityResolution>()
  return {
    records,
    transaction: callback => callback({
      findByOperationId: operationId => [...records.values()].find(value => value.operationId === operationId) ?? null,
      findByResolutionId: resolutionId => records.get(resolutionId) ?? null,
      revisionFor: read => revisions.get(revisionKey(read)) ?? null,
      insert: resolution => { records.set(resolution.resolutionId, resolution) },
    }),
  }
}

describe('durable optional ability trigger windows', () => {
  it('retains trigger/runtime identity, owners, options, reads, trace, rolls, and cursor', () => {
    const parsed = parsePendingAbilityResolution(pending())
    expect(parsed).toMatchObject({
      resolutionId: 'resolution.pending-one',
      trigger: {
        chainId: 'chain.one', eventId: 'event.hp.one', response: 'optional',
        definitionHash: DEFINITION_HASH,
      },
      window: {
        allowPass: true,
        owners: [{ kind: 'principal', id: 'player-one' }, { kind: 'gm', id: null }],
        options: [{ id: 'option.heal-target', operationIds: ['operation.heal-target'] }],
      },
      continuation: { phaseIndex: 5, operationIndex: 2 },
    })
    expect(parsed.readSet).toHaveLength(3)
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.window.options[0]?.operationIds)).toBe(true)
  })

  it('persists atomically after revalidating every consulted resource', () => {
    const store = inMemoryStore()
    const created = persistPendingAbilityResolution(pending(), store)
    expect(created.status).toBe('created')
    expect(store.records.size).toBe(1)
    expect(persistPendingAbilityResolution(pending(), store)).toMatchObject({ status: 'duplicate' })
  })

  it('rejects changed operation retries and duplicate resolution identities', () => {
    const store = inMemoryStore()
    persistPendingAbilityResolution(pending(), store)
    const changed = pending()
    changed.requestSha256 = 'd'.repeat(64)
    expect(() => persistPendingAbilityResolution(changed, store)).toThrowError(PendingAbilityPersistenceError)
    const otherOperation = pending()
    otherOperation.operationId = 'operation.pending-two'
    expect(() => persistPendingAbilityResolution(otherOperation, store)).toThrowError(/resolution ID/)
  })

  it('fails closed when map, sheet, or inventory revisions drift', () => {
    const parsed = parsePendingAbilityResolution(pending())
    const revisions = new Map([
      ['map:pending-arena', 9], ['sheet:pokemon:healer', 5], ['group-inventory:party', 2],
    ])
    expect(() => assertPendingAbilityResolutionReads(
      parsed,
      read => revisions.get(revisionKey(read)) ?? null,
    )).toThrowError(PendingAbilityPersistenceError)
    expect(() => persistPendingAbilityResolution(parsed, inMemoryStore(revisions)))
      .toThrowError(/expected revision 4/)
  })

  it('rejects inconsistent owners, options, phases, traces, and map reads', () => {
    const owner = pending()
    owner.window.owners[0]!.id = null
    expect(() => parsePendingAbilityResolution(owner)).toThrowError(PendingAbilityResolutionValidationError)
    const overlap = pending()
    overlap.continuation.completedOperationIds = ['operation.heal-target']
    expect(() => parsePendingAbilityResolution(overlap)).toThrowError(/disagree/)
    const phase = pending()
    phase.continuation.phaseIndex = 4
    expect(() => parsePendingAbilityResolution(phase)).toThrowError(/disagree/)
    const traceMismatch = pending()
    traceMismatch.trigger.definitionHash = 'e'.repeat(64)
    expect(() => parsePendingAbilityResolution(traceMismatch)).toThrowError(/disagree/)
    const read = pending()
    read.readSet[0]!.revision = 8
    expect(() => parsePendingAbilityResolution(read)).toThrowError(/disagree/)
  })

  it('rejects callbacks and unknown private continuation state', () => {
    expect(() => parsePendingAbilityResolution({ ...pending(), callback: () => true }))
      .toThrowError(PendingAbilityResolutionValidationError)
    const unknown = pending()
    Object.assign(unknown.continuation, { arbitraryStatePatch: { hp: 0 } })
    expect(() => parsePendingAbilityResolution(unknown)).toThrowError(PendingAbilityResolutionValidationError)
  })
})

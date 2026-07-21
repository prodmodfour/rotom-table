import { describe, expect, it } from 'vitest'
import { createAbilityResolutionTrace } from '#shared/abilityAutomation/trace'
import {
  createPendingAbilitySaga,
  parsePendingAbilitySaga,
  parsePendingAbilitySagaCommand,
  type PendingAbilitySaga,
} from '#shared/abilityAutomation/pendingSaga'
import {
  PendingAbilitySagaTransitionError,
  applyPendingAbilitySagaCommand,
  transitionPendingAbilitySaga,
  type PendingAbilitySagaStore,
} from '../../server/domain/abilityAutomation/pendingSaga'
import type { PendingAbilityRead } from '#shared/abilityAutomation/pendingResolution'

const HASH = 'b'.repeat(64)
const resolution = () => ({
  schemaVersion: 1, kind: 'pending-ability-resolution', status: 'pending',
  resolutionId: 'resolution.pending-one', operationId: 'operation.pending-one',
  requestSha256: 'c'.repeat(64), mapSlug: 'pending-arena', previousRevision: 8, revision: 9,
  createdAt: 1_000, updatedAt: 1_000, expiresAt: 5_000,
  trigger: {
    chainId: 'chain.one', triggerId: 'route.one', eventId: 'event.one', parentEventId: null,
    ownerPlacementId: 'owner-token', abilityInstanceId: 'base:owner-token:0',
    canonicalId: 'Healer', modeId: 'mode-triggered', subscriptionId: 'subscription.one',
    response: 'optional', runtimeVersion: 1, definitionHash: HASH,
    sourceModule: 'server/domain/abilityAutomation/specs/healer.ts',
  },
  phase: 'effect',
  readSet: [
    { kind: 'map', slug: 'pending-arena', revision: 9 },
    { kind: 'sheet', sheetKind: 'pokemon', slug: 'owner', revision: 4 },
  ],
  window: {
    windowId: 'window.one', kind: 'optional-trigger', phase: 'effect',
    promptKey: 'ability.healer.prompt', reasonCode: 'ability.healer.optional',
    owners: [{ kind: 'principal', id: 'player-one' }, { kind: 'gm', id: null }],
    options: [{ id: 'option.heal', presentationKey: 'ability.healer.heal', operationIds: ['operation.heal'] }],
    allowPass: true, priority: 10,
  },
  trace: createAbilityResolutionTrace({
    resolutionId: 'resolution.pending-one',
    program: {
      canonicalId: 'Healer', modeId: 'mode-triggered', runtimeKind: 'abilityspec-v1',
      runtimeVersion: 1, definitionHash: HASH,
      sourceModule: 'server/domain/abilityAutomation/specs/healer.ts',
    },
    ruleset: { rulesetId: 'ptu-1.05-plus-errata', sourceDataSha256: 'a'.repeat(64) },
    ancestry: [],
  }),
  rollLedger: [],
  continuation: {
    schemaVersion: 1, kind: 'abilityspec-v1', phase: 'effect', phaseIndex: 5,
    operationIndex: 1, completedOperationIds: [], choiceBindings: [],
    chainId: 'chain.one', triggerId: 'route.one',
  },
})
const command = (action: string, overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  commandId: `command.${action}`,
  resolutionId: 'resolution.pending-one',
  windowId: 'window.one',
  expectedSagaVersion: 0,
  action,
  optionId: action === 'select' ? 'option.heal' : null,
  requestSha256: 'd'.repeat(64),
  occurredAt: 2_000,
  reasonCode: `ability.pending.${action}`,
  ...overrides,
})
const principal = { kind: 'principal', id: 'player-one' } as const
const gm = { kind: 'gm', id: 'gm-one' } as const
const system = { kind: 'system', id: null } as const
const revisions = (read: PendingAbilityRead): number | null => (
  read.kind === 'map' ? 9 : read.kind === 'sheet' ? 4 : null
)

describe('pending ability saga terminal paths', () => {
  it('selects, resumes, and commits with causal audit receipts', () => {
    const initial = createPendingAbilitySaga(resolution())
    const selected = transitionPendingAbilitySaga({
      saga: initial, command: command('select'), authorization: principal,
    })
    expect(selected).toMatchObject({
      status: 'applied',
      saga: {
        sagaVersion: 1, status: 'resuming', selectedOptionId: 'option.heal',
        receipts: [{
          action: 'select', actorKind: 'principal', chainId: 'chain.one',
          triggerId: 'route.one', eventId: 'event.one',
        }],
      },
    })
    const committed = transitionPendingAbilitySaga({
      saga: selected.saga,
      command: command('commit', { commandId: 'command.commit', expectedSagaVersion: 1, occurredAt: 2_100 }),
      authorization: system,
    })
    expect(committed.saga).toMatchObject({
      sagaVersion: 2, status: 'committed',
      terminal: { status: 'committed', commandId: 'command.commit' },
    })
    expect(Object.isFrozen(committed.saga.receipts)).toBe(true)
  })

  it('passes without spending or selecting and returns exact command retries', () => {
    const initial = createPendingAbilitySaga(resolution())
    const passed = transitionPendingAbilitySaga({ saga: initial, command: command('pass'), authorization: principal })
    expect(passed.saga).toMatchObject({ status: 'passed', selectedOptionId: null })
    const retry = transitionPendingAbilitySaga({ saga: passed.saga, command: command('pass'), authorization: principal })
    expect(retry).toMatchObject({ status: 'duplicate', saga: { sagaVersion: 1 } })
    const changed = command('pass', { requestSha256: 'e'.repeat(64) })
    expect(() => transitionPendingAbilitySaga({ saga: passed.saga, command: changed, authorization: principal }))
      .toThrowError(/reused/)
  })

  it('supports GM force-pass, cancellation, and read-validated recovery', () => {
    const initial = createPendingAbilitySaga(resolution())
    const forced = transitionPendingAbilitySaga({ saga: initial, command: command('force-pass'), authorization: gm })
    expect(forced.saga.status).toBe('force-passed')
    const cancelled = transitionPendingAbilitySaga({ saga: initial, command: command('cancel'), authorization: principal })
    expect(cancelled.saga.status).toBe('cancelled')
    const recovered = transitionPendingAbilitySaga({
      saga: initial, command: command('gm-recover'), authorization: gm,
      revisionForRecovery: revisions,
    })
    expect(recovered.saga).toMatchObject({
      status: 'recovered', terminal: { reasonCode: 'ability.pending.gm-recover' },
    })
    expect(() => transitionPendingAbilitySaga({
      saga: initial, command: command('gm-recover'), authorization: gm,
      revisionForRecovery: () => 99,
    })).toThrowError(/read set is stale/)
  })

  it('expires only after the deadline and records system conflicts explicitly', () => {
    const initial = createPendingAbilitySaga(resolution())
    expect(() => transitionPendingAbilitySaga({
      saga: initial,
      command: command('expire', { occurredAt: 4_999 }),
      authorization: system,
    })).toThrowError(/not reached expiry/)
    const expired = transitionPendingAbilitySaga({
      saga: initial,
      command: command('expire', { occurredAt: 5_000 }),
      authorization: system,
    })
    expect(expired.saga.status).toBe('expired')
    const conflicted = transitionPendingAbilitySaga({ saga: initial, command: command('conflict'), authorization: system })
    expect(conflicted.saga.status).toBe('conflicted')
  })

  it('enforces response ownership, administrative roles, version, and option legality', () => {
    const initial = createPendingAbilitySaga(resolution())
    expect(() => transitionPendingAbilitySaga({
      saga: initial, command: command('pass'),
      authorization: { kind: 'principal', id: 'intruder' },
    })).toThrowError(/eligible owner/)
    expect(() => transitionPendingAbilitySaga({ saga: initial, command: command('force-pass'), authorization: principal }))
      .toThrowError(/requires a GM/)
    expect(() => transitionPendingAbilitySaga({
      saga: initial, command: command('pass', { expectedSagaVersion: 1 }), authorization: principal,
    })).toThrowError(/changed before/)
    expect(() => transitionPendingAbilitySaga({
      saga: initial, command: command('select', { optionId: 'option.unissued' }), authorization: principal,
    })).toThrowError(/not issued/)
  })

  it('persists transitions through compare-and-set and rejects concurrent writes', () => {
    let stored: PendingAbilitySaga = createPendingAbilitySaga(resolution())
    let forceConflict = false
    const store: PendingAbilitySagaStore = {
      transaction: callback => callback({
        load: () => stored,
        compareAndSet: (_id, expected, next) => {
          if (forceConflict || stored.sagaVersion !== expected) return false
          stored = next
          return true
        },
      }),
    }
    expect(applyPendingAbilitySagaCommand({ store, command: command('pass'), authorization: principal }).status)
      .toBe('applied')
    expect(stored.status).toBe('passed')
    expect(applyPendingAbilitySagaCommand({ store, command: command('pass'), authorization: principal }).status)
      .toBe('duplicate')
    stored = createPendingAbilitySaga(resolution())
    forceConflict = true
    expect(() => applyPendingAbilitySagaCommand({ store, command: command('pass'), authorization: principal }))
      .toThrowError(PendingAbilitySagaTransitionError)
  })

  it('strictly validates commands and saga audit consistency', () => {
    expect(() => parsePendingAbilitySagaCommand(command('select', { optionId: null }))).toThrow()
    const passed = transitionPendingAbilitySaga({
      saga: createPendingAbilitySaga(resolution()), command: command('pass'), authorization: principal,
    }).saga
    const malformed = structuredClone(passed)
    ;(malformed.receipts[0] as { chainId: string }).chainId = 'chain.changed'
    expect(() => parsePendingAbilitySaga(malformed)).toThrow()
    const version = structuredClone(passed)
    ;(version.receipts[0] as { sagaVersion: number }).sagaVersion = 2
    expect(() => parsePendingAbilitySaga(version)).toThrow()
  })
})

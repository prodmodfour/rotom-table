import { describe, expect, it } from 'vitest'
import {
  AbilityResponseAuthorizationError,
  projectAbilityPublicSagaLog,
  projectAbilityPublicSagaReplay,
  projectPendingAbilityMapExistence,
  projectPendingAbilityResponseView,
  projectPendingAbilitySourceSummary,
} from '../../server/domain/abilityAutomation/responseViews'
import {
  pendingAbilitySagaFixture,
  terminalPendingAbilitySagaFixture,
} from '../fixtures/abilityAutomation/pendingSaga'

const responder = {
  principalId: 'eligible-player', isGm: false,
  controlledPlacementIds: [], profileIds: [], sideIds: [],
} as const
const serialized = (value: unknown): string => JSON.stringify(value)
const privateFragments = [
  'Hidden Ability', 'owner-secret-token', 'base:owner-secret-token:0',
  'operation.secret-effect', 'private-sheet', 'private-inventory',
  'chain.secret', 'route.secret', 'event.secret', 'subscription.secret',
  'server/domain/abilityAutomation/specs/hidden.ts', 'profile-secret', 'side-secret',
]
const expectNoPrivateFragments = (value: unknown): void => {
  const text = serialized(value)
  for (const fragment of privateFragments) expect(text, fragment).not.toContain(fragment)
}

describe('authorized ability response views and redaction', () => {
  it('projects an eligible HTTP response with opaque options and no hidden mechanics', () => {
    const view = projectPendingAbilityResponseView({
      saga: pendingAbilitySagaFixture(), authorization: responder,
    })
    expect(view).toMatchObject({
      kind: 'ability-pending-responder-view',
      resolutionId: 'resolution.secret-one',
      window: {
        windowId: 'window.secret',
        options: [{ id: 'option.opaque-one', presentationKey: 'ability.hidden.option-one' }],
        allowPass: true,
      },
    })
    expectNoPrivateFragments(view)
    expect(Object.isFrozen(view)).toBe(true)
    expect(Object.isFrozen(view.window.options)).toBe(true)
  })

  it('authorizes placement, profile, and side ownership without disclosing owner lists', () => {
    for (const authorization of [
      { ...responder, principalId: 'another', controlledPlacementIds: ['responder-token'] },
      { ...responder, principalId: 'another', profileIds: ['profile-secret'] },
      { ...responder, principalId: 'another', sideIds: ['side-secret'] },
    ]) {
      const view = projectPendingAbilityResponseView({
        saga: pendingAbilitySagaFixture(), authorization,
      })
      expect(view.kind).toBe('ability-pending-responder-view')
      expect(serialized(view)).not.toContain('owners')
    }
  })

  it('denies ineligible and malformed viewers with one generic error', () => {
    for (const authorization of [
      { ...responder, principalId: 'intruder' },
      { ...responder, principalId: null },
      { ...responder, isGm: true, principalId: null },
    ]) {
      expect(() => projectPendingAbilityResponseView({
        saga: pendingAbilitySagaFixture(), authorization,
      })).toThrowError(AbilityResponseAuthorizationError)
    }
  })

  it('requires an audited GM boundary and still withholds effect programs, reads, rolls, and causal internals', () => {
    const audits: unknown[] = []
    const gmAuthorization = {
      principalId: 'gm-one', isGm: true,
      controlledPlacementIds: [], profileIds: [], sideIds: [],
    } as const
    expect(() => projectPendingAbilityResponseView({
      saga: pendingAbilitySagaFixture(), authorization: gmAuthorization,
    })).toThrowError(AbilityResponseAuthorizationError)
    const view = projectPendingAbilityResponseView({
      saga: pendingAbilitySagaFixture(),
      authorization: gmAuthorization,
      auditGmAccess: record => { audits.push(record) },
    })
    expect(view).toMatchObject({
      kind: 'ability-pending-gm-view',
      ability: { canonicalId: 'Hidden Ability', ownerPlacementId: 'owner-secret-token' },
      owners: expect.arrayContaining([{ kind: 'principal', id: 'eligible-player' }]),
    })
    expect(audits).toEqual([expect.objectContaining({
      principalId: 'gm-one', resolutionId: 'resolution.secret-one',
    })])
    const text = serialized(view)
    for (const fragment of [
      'operation.secret-effect', 'private-sheet', 'private-inventory',
      'chain.secret', 'route.secret', 'event.secret', HASH_PLACEHOLDER,
    ]) expect(text).not.toContain(fragment)
  })

  it('projects source acknowledgement without prompt, ability, eligibility, or responder facts', () => {
    const summary = projectPendingAbilitySourceSummary({
      saga: pendingAbilitySagaFixture(),
      controlledPlacementIds: ['owner-secret-token'],
    })
    expect(summary).toEqual({
      schemaVersion: 1,
      kind: 'ability-pending-source-summary',
      resolutionId: 'resolution.secret-one',
      mapSlug: 'privacy-arena',
      revision: 9,
      status: 'pending',
      presentationKey: 'ability.resolution.pending',
    })
    expectNoPrivateFragments({ ...summary, resolutionId: '' })
    expect(() => projectPendingAbilitySourceSummary({
      saga: pendingAbilitySagaFixture(), controlledPlacementIds: ['other-token'],
    })).toThrowError(AbilityResponseAuthorizationError)
  })

  it('limits SSE/map state to aggregate existence with no response identity oracle', () => {
    const summary = projectPendingAbilityMapExistence({
      sagas: [pendingAbilitySagaFixture(), terminalPendingAbilitySagaFixture()],
      mapSlug: 'privacy-arena',
      revision: 9,
    })
    expect(summary).toEqual({
      schemaVersion: 1,
      kind: 'ability-pending-existence',
      mapSlug: 'privacy-arena',
      revision: 9,
      pendingWindowCount: 1,
    })
    expectNoPrivateFragments(summary)
    expect(serialized(summary)).not.toContain('resolution.secret-one')
  })

  it('uses a public allowlist for terminal combat logs and replay records', () => {
    const terminal = terminalPendingAbilitySagaFixture()
    const log = projectAbilityPublicSagaLog(terminal)
    const replay = projectAbilityPublicSagaReplay(terminal)
    expect(log).toEqual({
      schemaVersion: 1,
      kind: 'ability-resolution',
      outcome: 'declined',
      presentationKey: 'ability.resolution.declined',
    })
    expect(replay).toEqual({ ...log, occurredAt: 2_000 })
    expectNoPrivateFragments(log)
    expectNoPrivateFragments(replay)
    expect(() => projectAbilityPublicSagaLog(pendingAbilitySagaFixture()))
      .toThrowError(AbilityResponseAuthorizationError)
  })
})

const HASH_PLACEHOLDER = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

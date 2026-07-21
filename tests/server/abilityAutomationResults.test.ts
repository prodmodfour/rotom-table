import { describe, expect, it } from 'vitest'
import {
  AbilityResolutionResultValidationError,
  parseAbilityResolutionAuthorizedView,
  parseAbilityResolutionPublicResult,
} from '#shared/abilityAutomation/results'
import {
  AbilityResultAuthorizationError,
  projectAcceptedAbilityAuthorizedView,
  projectAcceptedAbilityPublicResult,
  projectPendingAbilityAuthorizedView,
  projectPendingAbilityPublicResult,
  type PrivateAcceptedAbilityResult,
  type PrivatePendingAbilityResult,
} from '../../server/domain/abilityAutomation/results'
import type { AbilityStatePlan } from '../../server/domain/abilityAutomation/statePlan'

const privateKeys = new Set([
  'trace',
  'rollLedger',
  'statePlan',
  'responderPrincipalIds',
  'operationIds',
  'recipientIds',
  'privateReadCount',
  'definitionHash',
  'sourceModule',
])

const allKeys = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.flatMap(allKeys)
  if (typeof value !== 'object' || value === null) return []
  return Object.entries(value).flatMap(([key, child]) => [key, ...allKeys(child)])
}

const statePlan = (): AbilityStatePlan => ({
  schemaVersion: 1,
  resolutionId: 'resolution.accepted',
  runtime: {
    canonicalId: 'Moxie',
    modeId: 'mode-triggered',
    version: 1,
    definitionHash: 'a'.repeat(64),
    sourceModule: 'server/domain/abilityAutomation/specs/moxie.ts',
  },
  stateChanges: {
    schemaVersion: 1,
    changes: [],
    groups: { map: [], encounter: [], placements: [], sheets: [], externalResources: [] },
    expectedRevisions: [],
  },
  reads: [],
  trace: {} as never,
  rollLedger: [],
})

const accepted = (): PrivateAcceptedAbilityResult => ({
  kind: 'accepted-private',
  operationId: 'operation.command',
  mapSlug: 'arena',
  previousRevision: 4,
  revision: 5,
  actorPlacementId: 'actor-token',
  outcome: 'applied',
  statePlan: statePlan(),
  trace: { private: true } as never,
  rollLedger: [{ private: true }] as never,
  operations: [{
    operationId: 'operation.raise-attack',
    operationKind: 'combat-stage',
    outcome: 'applied',
    recipientIds: ['actor-token'],
    presentationKey: 'ability.operation.combat-stage',
  }],
})

const pending = (): PrivatePendingAbilityResult => ({
  kind: 'pending-private',
  operationId: 'operation.command',
  resolutionId: 'resolution.pending',
  mapSlug: 'arena',
  previousRevision: 4,
  revision: 5,
  canonicalId: 'Cute Charm',
  modeId: 'mode-triggered',
  actorPlacementId: 'actor-token',
  phase: 'target',
  createdAt: 100,
  updatedAt: 110,
  outstandingWindowCount: 1,
  window: {
    windowId: 'window.cute-charm',
    kind: 'reaction',
    phase: 'target',
    promptKey: 'ability.cute-charm.prompt',
    options: [{
      id: 'option.use',
      presentationKey: 'ability.option.use',
      operationIds: ['operation.infatuate'],
    }],
    allowPass: true,
    responderPrincipalIds: ['player-one'],
  },
  trace: { private: true } as never,
  rollLedger: [{ private: true }] as never,
  privateReadCount: 4,
})

describe('ability accepted and pending result projections', () => {
  it('projects a generic public accepted summary with no ability or private mechanic identity', () => {
    const result = projectAcceptedAbilityPublicResult(accepted())

    expect(result).toEqual({
      schemaVersion: 1,
      kind: 'accepted',
      operationId: 'operation.command',
      resolutionId: 'resolution.accepted',
      mapSlug: 'arena',
      previousRevision: 4,
      revision: 5,
      status: 'committed',
      presentation: {
        key: 'ability.resolution.completed',
        outcome: 'applied',
      },
    })
    expect(allKeys(result).some(key => privateKeys.has(key))).toBe(false)
    expect(allKeys(result)).not.toContain('canonicalId')
    expect(allKeys(result)).not.toContain('actorPlacementId')
    expect(Object.isFrozen(result)).toBe(true)
  })

  it('projects bounded authorized accepted mechanics without recipients, rolls, reads, or traces', () => {
    const view = projectAcceptedAbilityAuthorizedView({
      result: accepted(),
      authorization: { kind: 'source-controller', principalId: 'player-one' },
    })

    expect(view).toMatchObject({
      kind: 'accepted-view',
      ability: {
        canonicalId: 'Moxie',
        modeId: 'mode-triggered',
        actorPlacementId: 'actor-token',
      },
      operations: [{
        operationId: 'operation.raise-attack',
        operationKind: 'combat-stage',
        outcome: 'applied',
        recipientCount: 1,
      }],
    })
    expect(allKeys(view).some(key => privateKeys.has(key))).toBe(false)
    expect(Object.isFrozen(view.operations)).toBe(true)
  })

  it('projects existence-only public pending state and an authorized opaque response window', () => {
    const publicResult = projectPendingAbilityPublicResult(pending())
    const authorized = projectPendingAbilityAuthorizedView({
      result: pending(),
      authorization: { kind: 'eligible-responder', principalId: 'player-one' },
    })

    expect(publicResult).toEqual({
      schemaVersion: 1,
      kind: 'pending',
      operationId: 'operation.command',
      resolutionId: 'resolution.pending',
      mapSlug: 'arena',
      previousRevision: 4,
      revision: 5,
      status: 'pending',
      phase: 'target',
      outstandingWindowCount: 1,
      createdAt: 100,
      updatedAt: 110,
      presentation: { key: 'ability.resolution.pending', outcome: null },
    })
    expect(allKeys(publicResult)).not.toContain('canonicalId')
    expect(allKeys(publicResult)).not.toContain('window')
    expect(authorized).toMatchObject({
      kind: 'pending-view',
      ability: null,
      window: {
        windowId: 'window.cute-charm',
        options: [{ id: 'option.use', presentationKey: 'ability.option.use' }],
      },
    })
    expect(allKeys(authorized).some(key => privateKeys.has(key))).toBe(false)
  })

  it('denies ineligible principals while allowing an authorized GM', () => {
    expect(() => projectPendingAbilityAuthorizedView({
      result: pending(),
      authorization: { kind: 'eligible-responder', principalId: 'other-player' },
    })).toThrowError(AbilityResultAuthorizationError)

    expect(() => projectPendingAbilityAuthorizedView({
      result: pending(),
      authorization: null as never,
    })).toThrowError(AbilityResultAuthorizationError)

    expect(projectPendingAbilityAuthorizedView({
      result: pending(),
      authorization: { kind: 'authorized-gm', principalId: 'gm-one' },
    }).kind).toBe('pending-view')
  })

  it('strictly rejects private fields, revision drift, duplicate options, and mixed view kinds', () => {
    expect(() => parseAbilityResolutionPublicResult({
      ...projectAcceptedAbilityPublicResult(accepted()),
      canonicalId: 'Moxie',
    })).toThrowError(expect.objectContaining({
      name: 'AbilityResolutionResultValidationError',
      code: 'invalid-result',
      path: 'abilityResult',
    }))

    expect(() => parseAbilityResolutionPublicResult({
      ...projectAcceptedAbilityPublicResult(accepted()),
      revision: 6,
    })).toThrowError(expect.objectContaining({ code: 'inconsistent-result' }))

    const view = projectPendingAbilityAuthorizedView({
      result: pending(),
      authorization: { kind: 'authorized-gm', principalId: 'gm' },
    })
    expect(() => parseAbilityResolutionAuthorizedView({
      ...view,
      window: {
        ...view.window,
        options: [view.window.options[0], view.window.options[0]],
      },
    })).toThrowError(expect.objectContaining({ code: 'duplicate-id' }))

    expect(() => parseAbilityResolutionAuthorizedView({
      schemaVersion: 1,
      kind: 'pending-view',
      summary: projectAcceptedAbilityPublicResult(accepted()),
      ability: { canonicalId: 'Moxie', modeId: 'mode-triggered', actorPlacementId: 'actor' },
      window: view.window,
    })).toThrowError(AbilityResolutionResultValidationError)
  })

  it('rejects callbacks and freezes detached authorized presentation', () => {
    const value = projectPendingAbilityAuthorizedView({
      result: pending(),
      authorization: { kind: 'authorized-gm', principalId: 'gm' },
    })
    const source = JSON.parse(JSON.stringify(value))
    source.window.callback = () => undefined
    expect(() => parseAbilityResolutionAuthorizedView(source)).toThrowError(expect.objectContaining({
      code: 'not-json',
    }))
  })
})

import { createAbilityResolutionTrace } from '#shared/abilityAutomation/trace'
import { createPendingAbilitySaga, type PendingAbilitySaga } from '#shared/abilityAutomation/pendingSaga'
import { transitionPendingAbilitySaga } from '../../../server/domain/abilityAutomation/pendingSaga'

const HASH = 'b'.repeat(64)
export const pendingAbilitySagaFixture = (): PendingAbilitySaga => createPendingAbilitySaga({
  schemaVersion: 1, kind: 'pending-ability-resolution', status: 'pending',
  resolutionId: 'resolution.secret-one', operationId: 'operation.secret-pending',
  requestSha256: 'c'.repeat(64), mapSlug: 'privacy-arena', previousRevision: 8, revision: 9,
  createdAt: 1_000, updatedAt: 1_000, expiresAt: 5_000,
  trigger: {
    chainId: 'chain.secret', triggerId: 'route.secret', eventId: 'event.secret', parentEventId: null,
    ownerPlacementId: 'owner-secret-token', abilityInstanceId: 'base:owner-secret-token:0',
    canonicalId: 'Hidden Ability', modeId: 'mode-triggered', subscriptionId: 'subscription.secret',
    response: 'optional', runtimeVersion: 1, definitionHash: HASH,
    sourceModule: 'server/domain/abilityAutomation/specs/hidden.ts',
  },
  phase: 'effect',
  readSet: [
    { kind: 'map', slug: 'privacy-arena', revision: 9 },
    { kind: 'sheet', sheetKind: 'pokemon', slug: 'private-sheet', revision: 4 },
    { kind: 'group-inventory', slug: 'private-inventory', revision: 2 },
  ],
  window: {
    windowId: 'window.secret', kind: 'optional-trigger', phase: 'effect',
    promptKey: 'ability.hidden.prompt', reasonCode: 'ability.hidden.optional',
    owners: [
      { kind: 'principal', id: 'eligible-player' },
      { kind: 'placement', id: 'responder-token' },
      { kind: 'profile', id: 'profile-secret' },
      { kind: 'side', id: 'side-secret' },
      { kind: 'gm', id: null },
    ],
    options: [{
      id: 'option.opaque-one', presentationKey: 'ability.hidden.option-one',
      operationIds: ['operation.secret-effect'],
    }],
    allowPass: true, priority: 10,
  },
  trace: createAbilityResolutionTrace({
    resolutionId: 'resolution.secret-one',
    program: {
      canonicalId: 'Hidden Ability', modeId: 'mode-triggered', runtimeKind: 'abilityspec-v1',
      runtimeVersion: 1, definitionHash: HASH,
      sourceModule: 'server/domain/abilityAutomation/specs/hidden.ts',
    },
    ruleset: { rulesetId: 'ptu-1.05-plus-errata', sourceDataSha256: 'a'.repeat(64) },
    ancestry: [],
  }),
  rollLedger: [],
  continuation: {
    schemaVersion: 1, kind: 'abilityspec-v1', phase: 'effect', phaseIndex: 5,
    operationIndex: 2, completedOperationIds: ['operation.secret-reserve'],
    choiceBindings: [{ declarationId: 'target.secret', optionIds: ['option.target-secret'] }],
    chainId: 'chain.secret', triggerId: 'route.secret',
  },
})

export const terminalPendingAbilitySagaFixture = (): PendingAbilitySaga => transitionPendingAbilitySaga({
  saga: pendingAbilitySagaFixture(),
  command: {
    schemaVersion: 1,
    commandId: 'command.pass-secret',
    resolutionId: 'resolution.secret-one',
    windowId: 'window.secret',
    expectedSagaVersion: 0,
    action: 'pass',
    optionId: null,
    requestSha256: 'd'.repeat(64),
    occurredAt: 2_000,
    reasonCode: 'ability.pending.pass',
  },
  authorization: { kind: 'principal', id: 'eligible-player' },
}).saga

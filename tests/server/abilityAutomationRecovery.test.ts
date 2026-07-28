import { describe, expect, it } from 'vitest'
import {
  AbilityRecoveryError,
  createAbilityMaintenanceExport,
  createAbilityRecoveryBundle,
  parseAbilityRecoveryBundle,
  recoverAbilityAutomationState,
  type AbilityRecoveryPayload,
} from '../../server/domain/abilityAutomation/recovery'
import { createAbilityResolutionTrace } from '#shared/abilityAutomation/trace'
import {
  advanceAbilityTimingWindows,
  beginAbilityTimingScene,
  createEmptyAbilityTimingLedger,
} from '#shared/abilityAutomation/timingResources'
import {
  beginAbilitySceneUsagePeriod,
  createEmptyAbilitySceneUsageLedger,
} from '#shared/abilityAutomation/resources'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createEmptyAbilityTransformationState } from '#shared/abilityAutomation/transformations'
import { reduceAbilityTransformationCommand } from '../../server/domain/abilityAutomation/transformations'

const HASH = 'a'.repeat(64)
const DEFINITION_HASH = 'b'.repeat(64)

const trace = () => createAbilityResolutionTrace({
  resolutionId: 'resolution.pending',
  program: {
    canonicalId: 'Healer',
    modeId: 'mode-activated',
    runtimeKind: 'abilityspec-v1',
    runtimeVersion: 1,
    definitionHash: DEFINITION_HASH,
    sourceModule: 'server/domain/abilityAutomation/specs/healer.ts',
  },
  ruleset: {
    rulesetId: 'ptu-1.05-plus-errata',
    sourceDataSha256: HASH,
  },
  ancestry: [],
})

const transformationCommand = () => ({
  operationId: 'operation.create-copied-form',
  kind: 'create' as const,
  snapshotId: 'snapshot.copied-form',
  expectedVersion: null,
  snapshot: {
    snapshotId: 'snapshot.copied-form',
    kind: 'transformation' as const,
    placementId: 'actor-token',
    ownerPlacementId: 'actor-token',
    sourceAbilityInstanceId: 'base:actor-token:0',
    canonicalId: 'Healer',
    sourceOperationId: 'operation.trigger-copied-form',
    duration: { kind: 'source-ability' as const },
    mechanics: {
      formId: 'form.copied',
      abilityPolicy: 'replace' as const,
      abilities: [{
        instanceId: 'copied:snapshot.copied-form:0',
        canonicalId: 'Blaze',
        definitionHash: DEFINITION_HASH,
        sourcePlacementId: 'target-token',
        parameterStatus: 'not-parameterized' as const,
        parameterData: null,
      }],
      moves: [],
      typeIds: ['fire'],
      footprint: { base: 1, clearance: 1 },
      weightClass: 2,
      capabilityTags: ['overland'],
    },
    copyBase: {
      sourcePlacementId: 'target-token',
      sourceRevision: 3,
      sourceReadSha256: HASH,
    },
    presentation: {
      public: {
        presentationId: 'presentation.copied-form',
        labelKey: 'ability.form.copied',
        formId: 'form.copied',
        assetId: 'sprite.copied-form',
      },
      private: {
        truePresentationId: 'presentation.actor',
        copiedFromPlacementId: 'target-token',
        revealPolicy: 'owner-and-gm' as const,
      },
    },
  },
})

const encounter = () => {
  const abilityUsage = beginAbilitySceneUsagePeriod(
    createEmptyAbilitySceneUsageLedger(),
    'scene.one',
  )
  const abilityTiming = advanceAbilityTimingWindows(
    beginAbilityTimingScene(createEmptyAbilityTimingLedger(), 'scene.one'),
    {
      sceneId: 'scene.one',
      roundId: 'round.one',
      roundSequence: 1,
      turnId: 'turn.actor.1',
      turnSequence: 1,
    },
  )
  return {
    ...createEmptyEncounterState(),
    abilityUsage: {
      ...abilityUsage,
      entries: [{
        ownerId: 'actor-token',
        abilityInstanceId: 'base:Healer',
        canonicalId: 'Healer',
        clauseId: 'base',
        limit: 1,
        spent: 1,
        operationIds: ['operation.scene-use'],
      }],
    },
    abilityTiming,
    abilityOwnedState: {
      schemaVersion: 1 as const,
      entries: [{
        stateId: 'state.mode',
        version: 1,
        ownerPlacementId: 'actor-token',
        sourceAbilityInstanceId: 'base:actor-token:0',
        canonicalId: 'Healer',
        targetPlacementIds: [],
        lifecycle: { kind: 'source-ability' as const, targetPolicy: null },
        payload: { kind: 'mode' as const, modeId: 'active' },
        createdOperationId: 'operation.mode-create',
        lastOperationId: 'operation.mode-create',
      }],
      receipts: [{
        operationId: 'operation.mode-create',
        stateId: 'state.mode',
        requestSha256: 'c'.repeat(64),
        outcome: 'created' as const,
        resultVersion: 1,
      }],
    },
    abilityEffectLifecycle: {
      schemaVersion: 1 as const,
      entries: [{
        effectId: 'effect.source-bound',
        sourcePlacementId: 'actor-token',
        sourceAbilityInstanceId: 'base:actor-token:0',
        targetPlacementIds: [],
        duration: { kind: 'source-ability' as const },
      }],
    },
    abilityTransformations: reduceAbilityTransformationCommand(
      createEmptyAbilityTransformationState(),
      transformationCommand(),
    ).state,
  }
}

const payload = (): AbilityRecoveryPayload => ({
  rulesetId: 'ptu-1.05-plus-errata',
  sourceDataSha256: HASH,
  exportedAt: 10_000,
  mapSlug: 'recovery-arena',
  mapRevision: 9,
  encounterState: encounter(),
  dailyUsage: [{
    sheetKind: 'pokemon',
    sheetSlug: 'actor',
    sheetRevision: 4,
    usage: {
      schemaVersion: 1,
      dayKey: 'day.one',
      entries: [{
        ownerId: 'sheet:pokemon:actor',
        abilityInstanceId: 'base:Healer',
        canonicalId: 'Healer',
        clauseId: 'base',
        limit: 1,
        spent: 1,
        operationIds: ['operation.daily-use'],
      }],
    },
  }],
  pendingResolutions: [{
    kind: 'pending-private',
    operationId: 'operation.pending',
    resolutionId: 'resolution.pending',
    mapSlug: 'recovery-arena',
    previousRevision: 8,
    revision: 9,
    canonicalId: 'Healer',
    modeId: 'mode-activated',
    actorPlacementId: 'actor-token',
    phase: 'effect',
    createdAt: 9_000,
    updatedAt: 9_500,
    outstandingWindowCount: 1,
    window: {
      windowId: 'window.healer-target',
      kind: 'choice',
      phase: 'effect',
      promptKey: 'ability.healer.choose-target',
      options: [{
        id: 'option.target-one',
        presentationKey: 'ability.healer.target-one',
        operationIds: ['operation.heal'],
      }],
      allowPass: false,
      responderPrincipalIds: ['player-one'],
    },
    trace: trace(),
    rollLedger: [],
    privateReadCount: 3,
    continuation: {
      phase: 'effect',
      operationCursor: 2,
      selectedTargetIds: ['target-token'],
    },
  }],
})

const recoveryInput = (bundle: unknown) => ({
  bundle,
  expectedRulesetId: 'ptu-1.05-plus-errata',
  expectedSourceDataSha256: HASH,
  expectedMapSlug: 'recovery-arena',
  expectedMapRevision: 9,
  timingCursor: {
    sceneId: 'scene.one',
    roundId: 'round.one',
    roundSequence: 1,
    turnId: 'turn.actor.1',
    turnSequence: 1,
  },
  effectFacts: {
    presentPlacementIds: ['actor-token', 'target-token'],
    activeAbilityInstanceIdsByPlacement: new Map([
      ['actor-token', ['base:actor-token:0']],
    ]),
    weatherIds: [],
    terrainIds: [],
  },
  runtimeIdentityFor: () => ({
    canonicalId: 'Healer',
    modeId: 'mode-activated',
    runtimeVersion: 1,
    definitionHash: DEFINITION_HASH,
    sourceModule: 'server/domain/abilityAutomation/specs/healer.ts',
  }),
})

const expectRecoveryError = (callback: () => unknown, code: string): void => {
  try {
    callback()
    expect.unreachable(`Expected ${code}`)
  }
  catch (error) {
    expect(error).toBeInstanceOf(AbilityRecoveryError)
    expect((error as AbilityRecoveryError).code).toBe(code)
  }
}

describe('ability restart, reconnect, export, and recovery', () => {
  it('round-trips hash-bound private recovery data without losing causal state', () => {
    const bundle = createAbilityRecoveryBundle(payload())
    const serialized = JSON.parse(JSON.stringify(bundle))
    const parsed = parseAbilityRecoveryBundle(serialized)

    expect(parsed.payloadSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(parsed.payload.encounterState.abilityUsage?.entries).toHaveLength(1)
    expect(parsed.payload.encounterState.abilityOwnedState?.entries[0]?.payload).toEqual({
      kind: 'mode', modeId: 'active',
    })
    expect(parsed.payload.dailyUsage[0]?.usage.entries).toHaveLength(1)
    expect(parsed.payload.encounterState.abilityTransformations?.entries[0]).toMatchObject({
      snapshotId: 'snapshot.copied-form',
      mechanics: {
        formId: 'form.copied',
        abilities: [{ canonicalId: 'Blaze', sourcePlacementId: 'target-token' }],
      },
      copyBase: { sourcePlacementId: 'target-token', sourceRevision: 3 },
    })
    expect(parsed.payload.pendingResolutions[0]).toMatchObject({
      resolutionId: 'resolution.pending',
      window: { responderPrincipalIds: ['player-one'] },
      trace: { program: { definitionHash: DEFINITION_HASH } },
      continuation: { operationCursor: 2 },
    })
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.payload.pendingResolutions[0]?.continuation)).toBe(true)
  })

  it('recovers usages, mode state, effects, pending windows, and continuation state', () => {
    const bundle = createAbilityRecoveryBundle(payload())
    const recovered = recoverAbilityAutomationState(recoveryInput(bundle))

    expect(recovered.encounterState.abilityUsage?.entries[0]?.spent).toBe(1)
    expect(recovered.encounterState.abilityTiming?.round.windowId).toBe('round.one')
    expect(recovered.encounterState.abilityOwnedState?.entries[0]?.payload).toEqual({
      kind: 'mode', modeId: 'active',
    })
    expect(recovered.encounterState.abilityEffectLifecycle?.entries).toHaveLength(1)
    expect(recovered.dailyUsage[0]?.usage.entries[0]?.spent).toBe(1)
    expect(recovered.pendingResolutions[0]?.continuation).toEqual({
      phase: 'effect', operationCursor: 2, selectedTargetIds: ['target-token'],
    })
    expect(recovered.encounterState.abilityTransformations?.entries[0]?.mechanics.abilities[0])
      .toMatchObject({ canonicalId: 'Blaze', sourcePlacementId: 'target-token' })

    const exactRetry = reduceAbilityTransformationCommand(
      recovered.encounterState.abilityTransformations,
      transformationCommand(),
    )
    expect(exactRetry.status).toBe('duplicate')
    expect(exactRetry.state).toEqual(recovered.encounterState.abilityTransformations)
  })

  it('reconciles stale source presence and source-ability state on restart', () => {
    const bundle = createAbilityRecoveryBundle(payload())
    const input = recoveryInput(bundle)
    const recovered = recoverAbilityAutomationState({
      ...input,
      effectFacts: {
        ...input.effectFacts,
        presentPlacementIds: ['actor-token'],
        activeAbilityInstanceIdsByPlacement: new Map([['actor-token', []]]),
      },
    })

    expect(recovered.encounterState.abilityOwnedState?.entries).toEqual([])
    expect(recovered.encounterState.abilityEffectLifecycle?.entries).toEqual([])
    expect(recovered.encounterState.abilityTransformations?.entries).toEqual([])
  })

  it('terminally abandons private prompts in maintenance JSON exports with identity-only audit evidence', () => {
    const exported = createAbilityMaintenanceExport(payload())
    const serialized = JSON.parse(JSON.stringify(exported))

    expect(serialized).toMatchObject({
      schemaVersion: 1,
      policy: 'terminally-abandoned-on-maintenance-export',
      abandonedPendingResolutions: [{
        resolutionId: 'resolution.pending',
        operationId: 'operation.pending',
        mapSlug: 'recovery-arena',
        previousStatus: 'pending',
      }],
      bundle: { payload: { pendingResolutions: [] } },
    })
    expect(JSON.stringify(exported.abandonedPendingResolutions)).not.toMatch(
      /responder|continuation|window|roll|trace|target-token|player-one/i,
    )
    expect(parseAbilityRecoveryBundle(exported.bundle).payload.pendingResolutions).toEqual([])
    expect(Object.isFrozen(exported)).toBe(true)
  })

  it('rejects payload tampering even when nested JSON remains valid', () => {
    const bundle = structuredClone(createAbilityRecoveryBundle(payload()))
    ;(bundle.payload as { mapRevision: number }).mapRevision = 10
    expectRecoveryError(() => parseAbilityRecoveryBundle(bundle), 'hash-mismatch')
  })

  it('fails closed on changed ruleset, map revision, or pending runtime identity', () => {
    const bundle = createAbilityRecoveryBundle(payload())
    expectRecoveryError(() => recoverAbilityAutomationState({
      ...recoveryInput(bundle),
      expectedSourceDataSha256: 'd'.repeat(64),
    }), 'ruleset-mismatch')
    expectRecoveryError(() => recoverAbilityAutomationState({
      ...recoveryInput(bundle),
      expectedMapRevision: 10,
    }), 'map-mismatch')
    expectRecoveryError(() => recoverAbilityAutomationState({
      ...recoveryInput(bundle),
      runtimeIdentityFor: () => ({
        canonicalId: 'Healer', modeId: 'mode-activated', runtimeVersion: 2,
        definitionHash: DEFINITION_HASH,
        sourceModule: 'server/domain/abilityAutomation/specs/healer.ts',
      }),
    }), 'runtime-mismatch')
  })

  it('rejects duplicate sheets/resolutions, causal drift, callbacks, and unknown fields', () => {
    const base = payload()
    const duplicateSheet = {
      ...base,
      dailyUsage: [base.dailyUsage[0]!, base.dailyUsage[0]!],
    }
    expectRecoveryError(() => createAbilityRecoveryBundle(duplicateSheet), 'invalid-bundle')

    const causal = structuredClone(payload())
    ;(causal.pendingResolutions[0] as { canonicalId: string }).canonicalId = 'Blaze'
    expectRecoveryError(() => createAbilityRecoveryBundle(causal), 'invalid-bundle')

    expectRecoveryError(() => createAbilityRecoveryBundle({
      ...payload(),
      callback: () => true,
    } as unknown as AbilityRecoveryPayload), 'not-json')

    expectRecoveryError(() => createAbilityRecoveryBundle({
      ...payload(),
      unknown: true,
    } as unknown as AbilityRecoveryPayload), 'invalid-bundle')
  })
})

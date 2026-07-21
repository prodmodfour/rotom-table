import { describe, expect, it } from 'vitest'
import type { AuthoritativeAbilityContext } from '../../server/domain/abilityAutomation/context'
import {
  AbilityTransformationCommandError,
  assertAbilityTransformationCopyBaseHashes,
  planAbilityTransformationCommand,
  reduceAbilityTransformationCommand,
  reduceAbilityTransformationLifecycle,
} from '../../server/domain/abilityAutomation/transformations'
import { projectAuthoritativeEffectiveAbilities } from '../../server/domain/abilityAutomation/effectiveAbilities'
import {
  AbilityTransformationValidationError,
  createEmptyAbilityTransformationState,
  parseAbilityTransformationState,
  projectAbilityTransformationView,
} from '#shared/abilityAutomation/transformations'
import { createEmptyEncounterState, parseEncounterState } from '#shared/moveAutomation/encounterState'

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)
const mechanics = (overrides: Record<string, unknown> = {}) => ({
  formId: 'form.copied',
  abilityPolicy: 'replace',
  abilities: [{
    instanceId: 'copied:snapshot-one:0', canonicalId: 'Blaze', definitionHash: HASH_A,
    sourcePlacementId: 'copy-source', parameterStatus: 'not-parameterized', parameterData: null,
  }],
  moves: [{ canonicalMoveId: 'Ember', runtimeVersion: 2, definitionHash: HASH_B }],
  typeIds: ['fire'],
  footprint: { base: 1, clearance: 1 },
  weightClass: 2,
  capabilityTags: ['overland'],
  ...overrides,
})
const presentation = () => ({
  public: {
    presentationId: 'presentation.masked', labelKey: 'ability.form.masked',
    formId: 'form.copied', assetId: 'sprite.masked',
  },
  private: {
    truePresentationId: 'presentation.true', copiedFromPlacementId: 'copy-source',
    revealPolicy: 'owner-and-gm',
  },
})
const draft = (overrides: Record<string, unknown> = {}) => ({
  snapshotId: 'snapshot.one',
  kind: 'transformation',
  placementId: 'actor',
  ownerPlacementId: 'actor',
  sourceAbilityInstanceId: 'base:actor:0',
  canonicalId: 'Illusion',
  sourceOperationId: 'operation.trigger-transform',
  duration: { kind: 'source-ability' },
  mechanics: mechanics(),
  copyBase: {
    sourcePlacementId: 'copy-source', sourceRevision: 1, sourceReadSha256: HASH_A,
  },
  presentation: presentation(),
  ...overrides,
})
const createCommand = (snapshot = draft(), operationId = 'operation.create-transform') => ({
  operationId,
  kind: 'create',
  snapshotId: snapshot.snapshotId,
  expectedVersion: null,
  snapshot,
})
const context = (encounterState = createEmptyEncounterState()): AuthoritativeAbilityContext => {
  const actor = { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', position: { x: 0, y: 0, z: 0 } }
  const source = { id: 'copy-source', sheetKind: 'pokemon', sheetSlug: 'copy-source', position: { x: 1, y: 0, z: 0 } }
  const byId = new Map([[actor.id, actor], [source.id, source]])
  return {
    runtime: { canonicalId: 'Illusion' },
    map: { slug: 'transform-map', revision: 5, encounterState },
    queries: {
      placements: { get: (id: string) => byId.get(id) ?? null },
      effectiveAbilities: {
        activeForPlacement: (id: string) => id === 'actor'
          ? [{ instanceId: 'base:actor:0', canonicalId: 'Illusion', effective: true }]
          : [],
      },
      sheets: {
        forPlacement: (placement: { sheetSlug: string }) => ({
          kind: 'pokemon', slug: placement.sheetSlug, revision: 1, sheet: { slug: placement.sheetSlug },
        }),
      },
    },
  } as unknown as AuthoritativeAbilityContext
}

describe('immutable ability form/copy/transformation snapshots', () => {
  it('captures and hash-binds a copy base with exact retry receipts', () => {
    const created = reduceAbilityTransformationCommand(
      createEmptyAbilityTransformationState(),
      createCommand(),
    )
    expect(created).toMatchObject({ status: 'applied', outcome: 'created' })
    expect(created.snapshot?.copyBaseSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(assertAbilityTransformationCopyBaseHashes(created.state)).toEqual(created.state)

    const retry = reduceAbilityTransformationCommand(created.state, createCommand())
    expect(retry.status).toBe('duplicate')
    expect(retry.snapshot).toEqual(created.snapshot)
    expect(() => reduceAbilityTransformationCommand(
      created.state,
      createCommand(draft({ placementId: 'copy-source' })),
    )).toThrowError(AbilityTransformationCommandError)
  })

  it('fails closed if copied mechanics are changed without recapturing their immutable base', () => {
    const state = reduceAbilityTransformationCommand(
      createEmptyAbilityTransformationState(), createCommand(),
    ).state
    const tampered = {
      ...state,
      entries: [{
        ...state.entries[0]!,
        mechanics: mechanics({ typeIds: ['water'] }),
      }],
    }
    expect(() => assertAbilityTransformationCopyBaseHashes(tampered))
      .toThrowError(/copy base changed after capture/)
  })

  it('keeps disguise and illusion presentation mechanically neutral', () => {
    const disguise = draft({
      kind: 'disguise', copyBase: null,
      mechanics: mechanics({
        formId: null, abilityPolicy: 'preserve', abilities: [], moves: [], typeIds: [],
        footprint: null, weightClass: null, capabilityTags: [],
      }),
    })
    const state = reduceAbilityTransformationCommand(
      createEmptyAbilityTransformationState(), createCommand(disguise),
    ).state
    expect(state.entries[0]).toMatchObject({ kind: 'disguise', mechanics: { abilityPolicy: 'preserve' } })
    expect(() => parseAbilityTransformationState({
      schemaVersion: 1,
      entries: [{
        ...state.entries[0]!,
        mechanics: mechanics({ abilityPolicy: 'add' }),
      }],
      receipts: [],
    })).toThrowError(AbilityTransformationValidationError)
  })

  it('projects public appearance without private truth, mechanics, source, or ability identity', () => {
    const snapshot = reduceAbilityTransformationCommand(
      createEmptyAbilityTransformationState(), createCommand(),
    ).snapshot!
    const publicView = projectAbilityTransformationView({ snapshot, authorization: 'public' })
    expect(publicView).toEqual({
      snapshotId: 'snapshot.one', placementId: 'actor',
      publicPresentation: snapshot.presentation.public,
    })
    expect(JSON.stringify(publicView)).not.toContain('Blaze')
    expect(JSON.stringify(publicView)).not.toContain('copy-source')
    expect(projectAbilityTransformationView({
      snapshot, authorization: 'owner', viewerPlacementId: 'someone-else',
    })).toEqual(publicView)
    expect(projectAbilityTransformationView({
      snapshot, authorization: 'owner', viewerPlacementId: 'actor',
    })).toMatchObject({
      kind: 'transformation', canonicalId: 'Illusion',
      privatePresentation: { truePresentationId: 'presentation.true' },
    })
  })

  it('projects copied ability instances from the frozen snapshot rather than the mutable source', () => {
    const state = reduceAbilityTransformationCommand(
      createEmptyAbilityTransformationState(), createCommand(),
    ).state
    const projected = projectAuthoritativeEffectiveAbilities({
      target: { placementId: 'actor', position: { x: 0, y: 0, z: 0 } },
      baseAbilities: [{
        instanceId: 'base:actor:0', canonicalId: 'Healer',
        parameterStatus: 'not-parameterized', parameterData: null,
      }],
      transformationSnapshots: state,
    })
    expect(projected).toEqual([
      expect.objectContaining({
        instanceId: 'base:actor:0', canonicalId: 'Healer', effective: false,
        suppressionReasonCode: 'ability.replaced.transformation',
      }),
      expect.objectContaining({
        instanceId: 'copied:snapshot-one:0', canonicalId: 'Blaze',
        sourceKind: 'transformed', sourcePlacementId: 'copy-source',
        definitionHash: HASH_A, effective: true,
      }),
    ])
  })

  it('plans only active, revision-matched source snapshots and cleans them by lifecycle', () => {
    const planned = planAbilityTransformationCommand({ context: context(), command: createCommand() })
    expect(planned.result.status).toBe('applied')
    expect(planned.plan.changes[0]).toMatchObject({
      kind: 'encounter-state', expectedRevision: 5, reasonCode: 'ability-transformation.create',
    })
    const encounter = planned.plan.changes[0]!.kind === 'encounter-state'
      ? parseEncounterState(planned.plan.changes[0]!.current)
      : createEmptyEncounterState()
    const retry = planAbilityTransformationCommand({ context: context(encounter), command: createCommand() })
    expect(retry.result.status).toBe('duplicate')
    expect(retry.plan.changes).toEqual([])
    expect(reduceAbilityTransformationLifecycle(
      planned.result.state,
      { kind: 'effective-ability-snapshot', placementId: 'actor', activeAbilityInstanceIds: [] },
    ).entries).toEqual([])

    expect(() => planAbilityTransformationCommand({
      context: context(),
      command: createCommand(draft({
        copyBase: { sourcePlacementId: 'copy-source', sourceRevision: 2, sourceReadSha256: HASH_A },
      }), 'operation.stale-copy'),
    })).toThrowError(/changed before snapshot creation/)
  })

  it('allows removal but exposes no mutation command for captured snapshots', () => {
    const state = reduceAbilityTransformationCommand(
      createEmptyAbilityTransformationState(), createCommand(),
    ).state
    const removed = reduceAbilityTransformationCommand(state, {
      operationId: 'operation.remove-transform', kind: 'remove',
      snapshotId: 'snapshot.one', expectedVersion: 1,
    })
    expect(removed).toMatchObject({ status: 'applied', outcome: 'removed', snapshot: null })
    expect(removed.state.entries).toEqual([])
    expect(() => reduceAbilityTransformationCommand(state, {
      operationId: 'operation.update-transform', kind: 'update', snapshotId: 'snapshot.one',
      expectedVersion: 1, mechanics: mechanics({ typeIds: ['water'] }),
    })).toThrowError(/unsupported/)
  })
})

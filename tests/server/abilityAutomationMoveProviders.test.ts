import { describe, expect, it } from 'vitest'
import type { AuthoritativeAbilityContext } from '../../server/domain/abilityAutomation/context'
import {
  AuthoritativeAbilityMoveProviderError,
  authorizeAbilityNestedMoveUse,
  resolveAuthoritativeAbilityMoveProviders,
} from '../../server/domain/abilityAutomation/moveProviders'
import { registeredMoveAutomationRuntimeFor } from '../../server/domain/moveAutomation/registry'
import { createAbilityExecutionBudget } from '../../server/domain/abilityAutomation/executionBudget'
import {
  AbilityMoveProviderValidationError,
  parseAbilityMoveProviders,
  parseAbilityMoveRuntimeSnapshot,
  resolveAbilityMoveProviders,
  type AbilityMoveProviderEffect,
} from '#shared/abilityAutomation/moveProviders'

const snapshot = (
  canonicalMoveId: string,
  moveInstanceId: string,
  sourceKind: 'sheet' | 'granted' | 'replacement' = 'sheet',
) => {
  const runtime = registeredMoveAutomationRuntimeFor(canonicalMoveId)
  if (!runtime || runtime.kind !== 'movespec-v2') throw new Error(`missing test runtime ${canonicalMoveId}`)
  return {
    moveInstanceId,
    canonicalMoveId,
    runtimeKind: 'movespec-v2',
    runtimeVersion: runtime.version,
    definitionHash: runtime.definitionHash,
    sourceModule: runtime.sourceModule,
    sourceKind,
    mechanics: {
      typeId: canonicalMoveId === 'Ember' ? 'fire' : canonicalMoveId === 'Toxic' ? 'poison' : 'normal',
      damageBase: canonicalMoveId === 'Toxic' ? null : 4,
      accuracyCheck: 2,
      damageClass: canonicalMoveId === 'Toxic' ? 'status' : 'physical',
      frequencyId: 'at-will',
      rangeId: 'melee',
      keywords: [],
    },
  }
}
const mutation = (overrides: Record<string, unknown> = {}) => ({
  typeId: null,
  damageBaseOperation: null,
  damageBaseValue: null,
  accuracyOperation: null,
  accuracyValue: null,
  damageClass: null,
  frequencyId: null,
  rangeId: null,
  addKeywords: [],
  removeKeywords: [],
  ...overrides,
})
const provider = (
  providerId: string,
  effect: AbilityMoveProviderEffect | Record<string, unknown>,
  overrides: Record<string, unknown> = {},
) => ({
  schemaVersion: 1,
  providerId,
  abilityInstanceId: 'base:actor:0',
  canonicalId: 'Blaze',
  sourcePlacementId: 'actor',
  ownerPlacementId: 'actor',
  effect,
  stackingGroup: `group.${providerId}`,
  stackingPolicy: 'stack',
  priority: 0,
  reasonCode: `ability.${providerId}`,
  ...overrides,
})
const effects = () => [
  provider('replace-tackle', {
    kind: 'replacement',
    removeMoveInstanceIds: ['sheet:actor:1'],
    moves: [snapshot('Ember', 'replacement:ember', 'replacement')],
  }),
  provider('grant-toxic', {
    kind: 'grant', moves: [snapshot('Toxic', 'granted:toxic', 'granted')],
  }),
  provider('mutate-scratch', {
    kind: 'mutation', moveInstanceIds: ['sheet:actor:0'],
    mutation: mutation({
      typeId: 'fire', damageBaseOperation: 'add', damageBaseValue: 2,
      accuracyOperation: 'add', accuracyValue: -1,
      addKeywords: ['boosted'],
    }),
  }),
  provider('connect-scratch', {
    kind: 'connection', moveInstanceIds: ['sheet:actor:0'],
    connectionId: 'connection.blaze', action: 'add',
  }),
  provider('disable-ember', {
    kind: 'disable', moveInstanceIds: ['replacement:ember'],
  }),
  provider('nested-toxic', {
    kind: 'nested-use', move: snapshot('Toxic', 'nested:toxic', 'granted'),
    targetPolicy: 'inherit-selected', costPolicy: 'waive-reviewed', maximumDepth: 1,
  }),
]
const context = (): AuthoritativeAbilityContext => {
  const actor = { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor' }
  return {
    queries: {
      placements: { get: (id: string) => id === 'actor' ? actor : null },
      sheets: {
        forPlacement: () => ({
          kind: 'pokemon', slug: 'actor', revision: 3,
          sheet: {
            slug: 'actor', revision: 3,
            movelist: [
              { name: 'Scratch', type: 'Normal', category: 'Physical', db: 4, ac: 2, frequency: 'At-Will', range: 'Melee' },
              { name: 'Tackle', type: 'Normal', category: 'Physical', db: 5, ac: 3, frequency: 'At-Will', range: 'Melee' },
            ],
          },
        }),
      },
      effectiveAbilities: {
        activeForPlacement: (id: string) => id === 'actor'
          ? [{ instanceId: 'base:actor:0', canonicalId: 'Blaze', effective: true }]
          : [],
      },
    },
  } as unknown as AuthoritativeAbilityContext
}

describe('ability move mutation, grant, connection, disable, replacement, and nested-use providers', () => {
  it('strictly parses hash-bound MoveSpec v2 snapshots and closed effects', () => {
    expect(parseAbilityMoveProviders(effects())).toHaveLength(6)
    expect(Object.isFrozen(parseAbilityMoveRuntimeSnapshot(snapshot('Scratch', 'sheet:actor:0')).mechanics)).toBe(true)
    expect(() => parseAbilityMoveProviders([{
      ...effects()[0], proseFallback: true,
    }])).toThrowError(AbilityMoveProviderValidationError)
    expect(() => parseAbilityMoveRuntimeSnapshot({
      ...snapshot('Scratch', 'sheet:actor:0'), runtimeKind: 'legacy-v1',
    })).toThrowError(/MoveSpec v2/)
  })

  it('applies replacement, grant, mutation, connection, disable, then nested declaration', () => {
    const result = resolveAbilityMoveProviders({
      ownerPlacementId: 'actor', parentOperationId: 'operation.ability-moves',
      baseMoves: [snapshot('Scratch', 'sheet:actor:0'), snapshot('Tackle', 'sheet:actor:1')],
      providers: effects(),
    })
    expect(result.moves.map(move => move.snapshot.moveInstanceId)).toEqual([
      'sheet:actor:0', 'replacement:ember', 'granted:toxic',
    ])
    expect(result.moves[0]).toMatchObject({
      enabled: true,
      connectionIds: ['connection.blaze'],
      mutationProviderIds: ['mutate-scratch'],
      snapshot: {
        canonicalMoveId: 'Scratch',
        mechanics: { typeId: 'fire', damageBase: 6, accuracyCheck: 1, keywords: ['boosted'] },
      },
    })
    expect(result.moves[1]).toMatchObject({
      enabled: false, disabledByProviderIds: ['disable-ember'],
      snapshot: { sourceKind: 'replacement' },
    })
    expect(result.nestedUses).toEqual([
      expect.objectContaining({
        providerId: 'nested-toxic', parentOperationId: 'operation.ability-moves',
        targetPolicy: 'inherit-selected', costPolicy: 'waive-reviewed', maximumDepth: 1,
      }),
    ])
    expect(result.trace.map(entry => entry.effectKind)).toEqual([
      'replacement', 'grant', 'mutation', 'connection', 'disable', 'nested-use',
    ])
  })

  it('reports missing move targets without inventing a projection', () => {
    const result = resolveAbilityMoveProviders({
      ownerPlacementId: 'actor', parentOperationId: 'operation.missing',
      baseMoves: [snapshot('Scratch', 'sheet:actor:0')],
      providers: [provider('disable-missing', {
        kind: 'disable', moveInstanceIds: ['sheet:actor:99'],
      })],
    })
    expect(result.moves[0]?.enabled).toBe(true)
    expect(result.trace[0]).toMatchObject({ status: 'move-missing', moveInstanceIds: [] })
  })

  it('uses priority/exclusive stacking deterministically and rejects conflicts', () => {
    const low = provider('low-disable', {
      kind: 'disable', moveInstanceIds: ['sheet:actor:0'],
    }, { stackingGroup: 'disable.shared', stackingPolicy: 'priority', priority: 1 })
    const high = provider('high-disable', {
      kind: 'disable', moveInstanceIds: ['sheet:actor:0'],
    }, { stackingGroup: 'disable.shared', stackingPolicy: 'priority', priority: 2 })
    const result = resolveAbilityMoveProviders({
      ownerPlacementId: 'actor', parentOperationId: 'operation.priority',
      baseMoves: [snapshot('Scratch', 'sheet:actor:0')], providers: [low, high],
    })
    expect(result.moves[0]?.disabledByProviderIds).toEqual(['high-disable'])
    expect(result.trace).toContainEqual(expect.objectContaining({ providerId: 'low-disable', status: 'shadowed' }))
    expect(() => resolveAbilityMoveProviders({
      ownerPlacementId: 'actor', parentOperationId: 'operation.conflict',
      baseMoves: [snapshot('Scratch', 'sheet:actor:0')],
      providers: [low, { ...high, stackingPolicy: 'exclusive' }],
    })).toThrowError(/disagree on stacking policy/)
  })

  it('validates sheet and granted snapshots against exact production runtimes', () => {
    const result = resolveAuthoritativeAbilityMoveProviders({
      context: context(), ownerPlacementId: 'actor', parentOperationId: 'operation.server',
      providers: effects(),
    })
    expect(result.moves.map(move => move.snapshot.canonicalMoveId)).toEqual(['Scratch', 'Ember', 'Toxic'])
    expect(result.moves[0]?.snapshot).toMatchObject({
      runtimeKind: 'movespec-v2', sourceKind: 'sheet', mechanics: { typeId: 'fire' },
    })
    const tampered = effects()
    const grant = tampered.find(entry => (entry.effect as { kind: string }).kind === 'grant')!
    const effect = grant.effect as { kind: 'grant'; moves: Array<ReturnType<typeof snapshot>> }
    effect.moves[0] = { ...effect.moves[0]!, definitionHash: '0'.repeat(64) }
    expect(() => resolveAuthoritativeAbilityMoveProviders({
      context: context(), ownerPlacementId: 'actor', parentOperationId: 'operation.tampered',
      providers: tampered,
    })).toThrowError(AuthoritativeAbilityMoveProviderError)
  })

  it('consumes causal child budgets and enforces provider-local nested depth', () => {
    const result = resolveAbilityMoveProviders({
      ownerPlacementId: 'actor', parentOperationId: 'operation.nested', baseMoves: [],
      providers: [effects().at(-1)!],
    })
    const nested = result.nestedUses[0]!
    const authorized = authorizeAbilityNestedMoveUse({
      nestedUse: nested,
      budget: createAbilityExecutionBudget(),
    })
    expect(authorized.runtime).toMatchObject({ canonicalId: 'Toxic', kind: 'movespec-v2' })
    expect(authorized.budget.depth).toBe(1)
    expect(() => authorizeAbilityNestedMoveUse({
      nestedUse: nested, budget: authorized.budget,
    })).toThrowError(/exceeded provider depth/)
  })
})

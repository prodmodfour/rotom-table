import { createHash } from 'node:crypto'
import { parseEncounterEffect } from '#shared/moveAutomation/encounterEffects'
import {
  parseMoveEffectOperation,
  type MoveEffectOperation,
} from '#shared/moveAutomation/effects'
import { parseEncounterState } from '#shared/moveAutomation/encounterState'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import type { EquipmentEventProviderV1, EquipmentProviderEffectV1 } from '#shared/itemAutomation/equipmentEventProviders'
import type { AuthoritativeMoveRulesContext } from './context'
import { applyEncounterEffectLifecycleEvent } from './effectLifecycle'
import type { MoveCoreTokenFaintProtectionQueries } from './reducers/coreTokenEffects'

export interface EquipmentTypeGemActivationDescriptor {
  readonly requestOperationId: string
  readonly activationOperationId: string
  readonly sourceInstanceId: string
  readonly sourceInstanceRevision: number
  readonly sourceBindingSha256: string
  readonly amount: number
  readonly operations: readonly MoveEffectOperation[]
}
const configurationString = (configuration: unknown, key: string): string | null => {
  if (!configuration || typeof configuration !== 'object' || Array.isArray(configuration)) return null
  const values = (configuration as { readonly values?: unknown }).values
  if (!values || typeof values !== 'object' || Array.isArray(values)) return null
  const value = (values as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : null
}

/** Build declaration-time owner choices only from matching, current Type Gem providers. */
export const equipmentTypeGemActivationDescriptors = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: MoveAutomationScript
  readonly moveSourceId: string
}): readonly EquipmentTypeGemActivationDescriptor[] => (
  input.context.queries.equipmentProviders?.resolve(input.context.actor.placement.id)?.active ?? []
).flatMap((source): readonly EquipmentTypeGemActivationDescriptor[] => {
  const provider = source.provider
  if (provider.predicate.kind !== 'move'
    || provider.effect.kind !== 'consume-source-and-add-damage-base'
    || !provider.predicate.timings.includes('declared')
    || provider.predicate.ownerRole !== 'user'
    || !provider.predicate.damageClasses.includes(
      input.script.damageClass?.trim().toLocaleLowerCase('en-US') as 'physical' | 'special',
    )
    || configurationString(source.configuration, 'typeId')?.trim().toLocaleLowerCase('en-US')
      !== input.script.type.trim().toLocaleLowerCase('en-US')) return []
  const identity = createHash('sha256').update([
    input.moveSourceId,
    input.context.actor.placement.id,
    source.sourceBindingSha256,
    provider.providerId,
  ].join('\u0000')).digest('hex').slice(0, 32)
  const requestOperationId = `equipment-provider-type-gem-request:v1:${identity}`
  const activationOperationId = `equipment-provider-type-gem-activation:v1:${identity}`
  const operations = [
    parseMoveEffectOperation({
      id: requestOperationId,
      kind: 'reaction-request',
      source: { kind: 'move', id: input.moveSourceId },
      recipients: { kind: 'none' },
      phase: 'declare',
      reasonCode: 'equipment.type-gem.empower-choice',
      payload: {
        requestId: `${requestOperationId}.response`,
        promptKey: 'equipment.type-gem.empower-choice',
        options: [{ id: 'activate', labelKey: 'equipment.type-gem.activate' }],
        allowPass: true,
        timing: 'declare',
        priority: provider.priority,
        ownerPlacementIds: [input.context.actor.placement.id],
      },
    }, 'equipmentTypeGem.request'),
    parseMoveEffectOperation({
      id: activationOperationId,
      kind: 'log',
      source: { kind: 'operation', id: requestOperationId },
      recipients: { kind: 'response-owner' },
      phase: 'declare',
      reasonCode: provider.effect.reasonCode,
      payload: {
        messageKey: 'equipment.type-gem.empowered',
        arguments: [],
      },
    }, 'equipmentTypeGem.activation'),
  ]
  return [Object.freeze({
    requestOperationId,
    activationOperationId,
    sourceInstanceId: source.instanceId,
    sourceInstanceRevision: source.instanceRevision,
    sourceBindingSha256: source.sourceBindingSha256,
    amount: provider.effect.amount,
    operations: Object.freeze(operations),
  })]
})

export interface ActiveEquipmentProviderEffect {
  readonly provider: EquipmentEventProviderV1
  readonly effect: EquipmentProviderEffectV1
}
export const activeEquipmentProviderEffects = (
  context: AuthoritativeMoveRulesContext | undefined,
  placementId: string,
  kind?: EquipmentProviderEffectV1['kind'],
): readonly ActiveEquipmentProviderEffect[] => (context?.queries.equipmentProviders?.resolve(placementId)?.active ?? [])
  .filter(source => kind === undefined || source.provider.effect.kind === kind)
  .map(source => ({ provider: source.provider, effect: source.provider.effect }))

const normalizedKeyword = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, '-')
const movePredicateMatches = (
  provider: EquipmentEventProviderV1,
  script: MoveAutomationScript,
): boolean => {
  if (provider.predicate.kind !== 'move') return false
  const predicate = provider.predicate
  return (!predicate.canonicalMoveIds.length || predicate.canonicalMoveIds.includes(script.moveName))
    && (!predicate.keywordsAny.length || predicate.keywordsAny.some(keyword => (
      script.keywords.some(candidate => normalizedKeyword(candidate) === keyword)
    )))
    && (!predicate.damageClasses.length || predicate.damageClasses.some(candidate => (
      candidate === script.damageClass?.trim().toLowerCase()
    )))
}

export const equipmentMoveImmunityReason = (input: {
  readonly context: AuthoritativeMoveRulesContext | undefined
  readonly placementId: string
  readonly script: MoveAutomationScript | undefined
}): string | null => {
  if (!input.script) return null
  const source = activeEquipmentProviderEffects(input.context, input.placementId, 'prevent-move')
    .find(({ provider }) => movePredicateMatches(provider, input.script!))
  return source?.effect.reasonCode ?? null
}

export const equipmentConditionImmunityReason = (input: {
  readonly context: AuthoritativeMoveRulesContext | undefined
  readonly placementId: string
  readonly conditionId: string
  readonly script: MoveAutomationScript | undefined
}): string | null => {
  if (!input.script) return null
  const source = activeEquipmentProviderEffects(input.context, input.placementId, 'prevent-condition')
    .find(({ provider, effect }) => (
      effect.kind === 'prevent-condition'
      && effect.conditionId === input.conditionId
      && provider.predicate.kind === 'condition'
      && provider.predicate.sourceMoveIds.includes(input.script!.moveName)
    ))
  return source?.effect.reasonCode ?? null
}

export const equipmentRemovesTypeImmunity = (input: {
  readonly context: AuthoritativeMoveRulesContext | undefined
  readonly placementId: string
  readonly typeId: string
}): boolean => activeEquipmentProviderEffects(input.context, input.placementId, 'remove-type-immunity')
  .some(({ effect }) => effect.kind === 'remove-type-immunity'
    && effect.typeId === input.typeId.trim().toLowerCase())

export const equipmentMoveResistanceSteps = (input: {
  readonly context: AuthoritativeMoveRulesContext | undefined
  readonly placementId: string
  readonly moveName: string
}): number => activeEquipmentProviderEffects(input.context, input.placementId, 'add-resistance-step')
  .reduce((sum, { provider, effect }) => (
    effect.kind === 'add-resistance-step'
      && provider.predicate.kind === 'strike'
      && provider.predicate.canonicalMoveIds?.includes(input.moveName)
      ? sum + effect.steps
      : sum
  ), 0)

export const equipmentHpChangePreventionReason = (input: {
  readonly context: AuthoritativeMoveRulesContext | undefined
  readonly placementId: string
  readonly reasonCode: string
}): string | null => activeEquipmentProviderEffects(input.context, input.placementId, 'prevent-hp-change')
  .find(({ provider }) => provider.predicate.kind === 'hp'
    && provider.predicate.reasonCodes.includes(input.reasonCode))?.effect.reasonCode ?? null

export const equipmentDrainHealingMultiplier = (input: {
  readonly context: AuthoritativeMoveRulesContext | undefined
  readonly placementId: string
}): number => activeEquipmentProviderEffects(input.context, input.placementId, 'multiply-hp-change')
  .reduce((value, { effect }) => effect.kind === 'multiply-hp-change'
    ? value * effect.numerator / effect.denominator
    : value, 1)

export interface EquipmentFaintProtectionSource {
  readonly providerId: string
  readonly sourceBindingSha256: string
  readonly reasonCode: string
  readonly roll: { readonly sides: 20; readonly minimum: number } | null
}
const providerFrequencyTag = (sourceBindingSha256: string): string => (
  `equipment-provider-frequency:${sourceBindingSha256}`
)
export const equipmentProviderFrequencyTag = providerFrequencyTag

/** Resolve an unused scene-bound Focus provider from current authoritative equipment. */
export const equipmentFaintProtectionSource = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly placementId: string
  readonly beforeHp: number
  readonly maximumHp: number
  readonly afterHp: number
  readonly changeKind: 'damage' | 'recoil' | 'cost' | 'set'
  readonly moveSourced: boolean
}): EquipmentFaintProtectionSource | null => {
  if (input.beforeHp <= 0 || input.afterHp > 0) return null
  const sources = input.context.queries.equipmentProviders?.resolve(input.placementId)?.active ?? []
  for (const source of sources) {
    const { provider } = source
    if (provider.effect.kind !== 'survive-at-one' || provider.predicate.kind !== 'hp') continue
    if (!provider.predicate.changeKinds.includes(input.changeKind)
      || !provider.predicate.faintTransitions.includes('fainted')
      || (provider.predicate.beforeAtMaximum !== null
        && provider.predicate.beforeAtMaximum !== (input.beforeHp === input.maximumHp))
      || (provider.predicate.moveSourced !== null
        && provider.predicate.moveSourced !== input.moveSourced)) continue
    const spent = input.context.map.encounterState?.effects.some(effect => (
      effect.tags.includes(providerFrequencyTag(source.sourceBindingSha256))
      && effect.duration.kind === 'scene'
      && effect.suppression.sources.length === 0
    )) === true
    if (spent) continue
    return {
      providerId: provider.providerId,
      sourceBindingSha256: source.sourceBindingSha256,
      reasonCode: provider.effect.reasonCode,
      roll: provider.effect.roll,
    }
  }
  return null
}

interface AcceptedEquipmentFaintProtection {
  readonly placementId: string
  readonly operationId: string
  readonly providerId: string
  readonly sourceBindingSha256: string
  readonly reasonCode: string
  readonly roll: number | null
}
const protectionDigest = (...parts: readonly string[]): string => createHash('sha256')
  .update(parts.join('\u0000')).digest('hex').slice(0, 32)
export const equipmentFaintProtectionRollId = (input: {
  readonly operationId: string
  readonly placementId: string
  readonly sourceBindingSha256: string
}): string => `equipment-provider-roll:v1:${protectionDigest(
  input.operationId,
  input.placementId,
  input.sourceBindingSha256,
)}`

/** Reserve potential post-reduction Focus Band draws before MoveSpec seals its ledger. */
export const primeEquipmentFaintProtectionRolls = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly operationId: string
  readonly placementIds: readonly string[]
}): void => {
  const existing = new Set(input.context.random.snapshot().map(entry => entry.rollId))
  for (const placementId of input.placementIds) {
    for (const source of input.context.queries.equipmentProviders?.resolve(placementId)?.active ?? []) {
      if (source.provider.effect.kind !== 'survive-at-one' || !source.provider.effect.roll) continue
      const spent = input.context.map.encounterState?.effects.some(effect => (
        effect.tags.includes(providerFrequencyTag(source.sourceBindingSha256))
        && effect.duration.kind === 'scene'
        && effect.suppression.sources.length === 0
      )) === true
      if (spent) continue
      const rollId = equipmentFaintProtectionRollId({
        operationId: input.operationId,
        placementId,
        sourceBindingSha256: source.sourceBindingSha256,
      })
      if (existing.has(rollId)) continue
      input.context.random.roll({
        rollId,
        parentEffectId: input.operationId,
        reason: source.provider.effect.reasonCode,
        formula: {
          kind: 'dice',
          count: 1,
          sides: source.provider.effect.roll.sides,
          modifier: 0,
        },
      })
      existing.add(rollId)
    }
  }
}

/**
 * Build one reducer hook that intercepts every authoritative lethal HP lane,
 * receipts its random draw in the move ledger, and finalizes opaque scene use.
 */
export const createEquipmentFaintProtectionQueries = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly skipDamageOperationIds?: ReadonlySet<string>
  readonly requirePreRolledRandom?: boolean
}): MoveCoreTokenFaintProtectionQueries => {
  const accepted: AcceptedEquipmentFaintProtection[] = []
  const acceptedBindings = new Set<string>()
  const queries: MoveCoreTokenFaintProtectionQueries = {
    resolve: ({ operation, recipient, result }) => {
      if (operation.kind === 'damage' && input.skipDamageOperationIds?.has(operation.id)) return null
      if (operation.kind === 'direct-hp'
        && (operation.payload.pool !== 'hit-points' || operation.payload.mode !== 'lose')) return null
      if (result.previous.kind !== 'hp' || result.current.kind !== 'hp') return null
      const changeKind = operation.kind === 'damage'
        ? 'damage' as const
        : operation.payload.cost !== null || operation.reasonCode.includes('.cost')
          ? 'cost' as const
          : operation.reasonCode.includes('.recoil')
            ? 'recoil' as const
            : operation.source.kind === 'lifecycle-event'
              ? 'damage' as const
              : 'set' as const
      const source = equipmentFaintProtectionSource({
        context: input.context,
        placementId: recipient.placement.id,
        beforeHp: result.previous.currentHp,
        maximumHp: result.previous.fullMaxHp,
        afterHp: result.current.currentHp,
        changeKind,
        moveSourced: operation.kind === 'damage'
          || operation.source.kind === 'move'
          || operation.source.kind === 'operation',
      })
      if (!source || acceptedBindings.has(source.sourceBindingSha256)) return null
      const rollId = equipmentFaintProtectionRollId({
        operationId: operation.id,
        placementId: recipient.placement.id,
        sourceBindingSha256: source.sourceBindingSha256,
      })
      const existingRoll = input.context.random.snapshot().find(entry => entry.rollId === rollId)
      if (source.roll && !existingRoll && input.requirePreRolledRandom) {
        throw new Error(`Equipment faint-protection roll ${rollId} was not reserved before reduction.`)
      }
      const roll = source.roll
        ? (existingRoll ?? input.context.random.roll({
            rollId,
            parentEffectId: operation.id,
            reason: source.reasonCode,
            formula: { kind: 'dice', count: 1, sides: source.roll.sides, modifier: 0 },
          })).naturalResult
        : null
      if (source.roll && (roll ?? 0) < source.roll.minimum) return null
      acceptedBindings.add(source.sourceBindingSha256)
      accepted.push({
        placementId: recipient.placement.id,
        operationId: operation.id,
        providerId: source.providerId,
        sourceBindingSha256: source.sourceBindingSha256,
        reasonCode: source.reasonCode,
        roll,
      })
      return {
        remainingHp: 1 as const,
        reasonCode: source.reasonCode,
        evidence: {
          providerId: source.providerId,
          roll,
          frequency: 'scene',
        },
      }
    },
    finalizeEncounterState: (value) => {
      let state = parseEncounterState(value)
      for (const entry of accepted) {
        const suffix = protectionDigest(
          entry.operationId,
          entry.placementId,
          entry.sourceBindingSha256,
        )
        const effect = parseEncounterEffect({
          id: `equipment-provider-frequency:v1:${suffix}`,
          kind: 'capability',
          source: {
            operationId: entry.operationId,
            moveId: 'equipment-provider-survival',
            placementId: entry.placementId,
          },
          affected: { placementIds: [entry.placementId], sideIds: [], cells: [] },
          createdRound: Math.max(1, input.context.map.initiative?.round ?? 1),
          createdTurn: input.context.map.encounterState?.history.currentTurn?.turn ?? 0,
          duration: { kind: 'scene', remaining: null },
          stacks: 1,
          charges: null,
          stackPolicy: { kind: 'replace', maxStacks: null },
          chargePolicy: { kind: 'none', amount: null },
          tags: [
            'equipment-provider-frequency',
            providerFrequencyTag(entry.sourceBindingSha256),
          ],
          payload: { capabilityId: 'equipment-provider-frequency', action: 'grant', value: 1 },
          dispel: {
            policy: 'matching-tags',
            tags: [providerFrequencyTag(entry.sourceBindingSha256)],
          },
          transferPolicy: 'retain',
          suppression: { sources: [] },
        }, `equipmentFaintProtection.${entry.providerId}`)
        const reduced = applyEncounterEffectLifecycleEvent(
          { effects: state.effects },
          { kind: 'effect-applied', effect },
        )
        state = parseEncounterState({ ...state, effects: reduced.effects })
      }
      return state
    },
  }
  return Object.freeze(queries)
}

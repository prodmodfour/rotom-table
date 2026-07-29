import { createHash } from 'node:crypto'
import type {
  MoveCombatStageEffectOperation,
  MoveConditionEffectOperation,
  MoveDirectHpEffectOperation,
  MoveEffectOperation,
  MoveReactionRequestEffectOperation,
  MoveRollEffectOperation,
  MoveTemporaryEffectOperation,
} from '#shared/moveAutomation/effects'
import {
  AA073_GULP_MISSILE_CAPABILITY,
  AA073_GULP_MISSILE_TRIGGER_MOVES,
  aa073ActiveEncounterEffect,
} from '#shared/abilityAutomation/aa073'
import type { EncounterEffect } from '#shared/moveAutomation/encounterEffects'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import { resolveMoveAutomationTargetEvasion } from '~/utils/moveAutomationAccuracy'
import { resolveMoveAutomationAccuracyRoll } from '~/utils/moveAutomationResolution'
import type { AuthoritativeMoveRulesContext } from '../../moveAutomation/context'
import { resolveAuthoritativeMoveUserAccuracy } from '../../moveAutomation/accuracy'
import { applyEncounterNumericModifiers } from '../../moveAutomation/encounterNumericModifiers'
import { aa065CovertEvasionBonus } from './aa065StaticIntegration'
import { aa066DecoyEvasionBonus } from './aa066StaticIntegration'
import { createMoveAutomationWeatherResolver } from '../../moveAutomation/weather'
import {
  harvestStoppedForSheet,
  harvestTradedForSheetThisTurn,
} from '../../moveAutomation/digestionBuffTrade'

export const AA073_GRIM_NEIGH_REASON = 'ability.grim-neigh.optional-boost' as const
export const AA073_GULP_MISSILE_ARM_REASON = 'ability.gulp-missile.optional-arm' as const
export const AA073_HEAT_MIRAGE_REASON = 'ability.heat-mirage.optional-evasion' as const
export const AA073_GULP_MISSILE_ROLL_REASON = 'ability.gulp-missile.retaliation-roll' as const
export const AA073_GULP_MISSILE_HP_REASON = 'ability.gulp-missile.retaliation-hp' as const
export const AA073_GULP_MISSILE_PARALYZE_REASON = 'ability.gulp-missile.retaliation-paralyze' as const
export const AA073_GULP_MISSILE_DEFENSE_REASON = 'ability.gulp-missile.retaliation-defense' as const
export const AA073_GULP_MISSILE_CONSUME_REASON = 'ability.gulp-missile.consume-arm' as const
export const AA073_HARVEST_ROLL_REASON = 'ability.harvest.retention-roll' as const

const shortHash = (...values: readonly string[]): string => createHash('sha256')
  .update(values.join('\u0000')).digest('hex').slice(0, 24)

const sceneUseAvailable = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly ownerId: string
  readonly abilityInstanceId: string
  readonly canonicalId: string
  readonly limit: number
}): boolean => {
  const sceneId = input.context.map.encounterState?.history.sceneId
  if (!sceneId) return false
  const ledger = input.context.map.encounterState?.abilityUsage
  if (ledger?.sceneId && ledger.sceneId !== sceneId) return true
  const spent = ledger?.entries.find(entry => (
    entry.ownerId === input.ownerId
    && entry.abilityInstanceId === input.abilityInstanceId
    && entry.canonicalId === input.canonicalId
    && entry.clauseId === 'base'
  ))?.spent ?? 0
  return spent < input.limit
}

const request = (input: {
  readonly id: string
  readonly sourceId: string
  readonly reasonCode: string
  readonly promptKey: string
  readonly optionId: string
  readonly labelKey: string
  readonly ownerId: string
  readonly phase: 'hit' | 'ko'
  readonly timing: 'post-hit' | 'ko'
  readonly priority: number
}): MoveReactionRequestEffectOperation => ({
  id: input.id,
  kind: 'reaction-request',
  source: { kind: 'lifecycle-event', id: input.sourceId },
  recipients: { kind: 'none' },
  phase: input.phase,
  reasonCode: input.reasonCode,
  payload: {
    requestId: `${input.id}.response`, promptKey: input.promptKey,
    options: [{ id: input.optionId, labelKey: input.labelKey }],
    allowPass: true, timing: input.timing, priority: input.priority,
    ownerPlacementIds: [input.ownerId],
  },
})

export const aa073GulpMissileArmedEffect = (
  context: AuthoritativeMoveRulesContext,
  ownerId: string,
): EncounterEffect | null => (context.map.encounterState?.effects ?? []).find(effect => (
  effect.kind === 'capability'
  && aa073ActiveEncounterEffect(effect)
  && effect.payload.action === 'grant'
  && effect.payload.capabilityId === AA073_GULP_MISSILE_CAPABILITY
  && effect.affected.placementIds.includes(ownerId)
  && context.queries.abilities.has(ownerId, 'Gulp Missile')
)) ?? null

const armEffect = (input: {
  readonly requestId: string
  readonly effectId: string
}): MoveTemporaryEffectOperation => ({
  id: `${input.effectId}.add`,
  kind: 'temporary-effect',
  source: { kind: 'operation', id: input.requestId },
  recipients: { kind: 'response-owner' },
  phase: 'schedule',
  reasonCode: 'ability.gulp-missile.arm-next-damage',
  payload: {
    action: 'add', effectId: input.effectId, recipientScope: 'placements',
    definition: {
      kind: 'capability', duration: { kind: 'scene', remaining: null },
      stacks: 1, charges: null,
      stackPolicy: { kind: 'replace', maxStacks: null },
      chargePolicy: { kind: 'none', amount: null },
      tags: ['ability', 'aa073', 'gulp-missile', 'armed'],
      payload: { capabilityId: AA073_GULP_MISSILE_CAPABILITY, action: 'grant' },
      dispel: { policy: 'matching-tags', tags: ['gulp-missile', 'armed'] },
      transferPolicy: 'retain',
    },
  },
})

const grimNeighOperations = (input: {
  readonly moveIdentity: string
  readonly moveSourceId: string
  readonly actorId: string
  readonly abilityInstanceId: string
}): readonly MoveEffectOperation[] => {
  const suffix = shortHash(input.moveIdentity, input.actorId, input.abilityInstanceId, 'grim-neigh')
  const requestId = `ability.grim-neigh.request.${suffix}`
  const stage: MoveCombatStageEffectOperation = {
    id: `ability.grim-neigh.special-attack.${suffix}`,
    kind: 'combat-stage', source: { kind: 'operation', id: requestId },
    recipients: { kind: 'response-owner' }, phase: 'ko',
    reasonCode: 'ability.grim-neigh.raise-special-attack',
    payload: {
      action: 'modify', stage: 'satk', selectedStage: null, value: 1,
      stageSource: null, rounding: null, applyTypeImmunity: false,
    },
  }
  const evasion: MoveTemporaryEffectOperation = {
    id: `ability.grim-neigh.accuracy.${suffix}`,
    kind: 'temporary-effect', source: { kind: 'operation', id: requestId },
    recipients: { kind: 'response-owner' }, phase: 'schedule',
    reasonCode: 'ability.grim-neigh.foe-accuracy',
    payload: {
      action: 'add', effectId: `ability.grim-neigh.accuracy.${suffix}`,
      recipientScope: 'placements',
      definition: {
        kind: 'numeric-modifier', duration: { kind: 'rounds', boundary: 'end', remaining: 1 },
        stacks: 1, charges: null,
        stackPolicy: { kind: 'refresh', maxStacks: null },
        chargePolicy: { kind: 'none', amount: null },
        tags: ['ability', 'aa073', 'grim-neigh', 'accuracy'],
        payload: { attribute: 'accuracy', operation: 'add', value: -2, rounding: 'none' },
        dispel: { policy: 'matching-tags', tags: ['grim-neigh', 'accuracy'] },
        transferPolicy: 'expire',
      },
    },
  }
  return Object.freeze([
    request({
      id: requestId, sourceId: `ability.grim-neigh.owner:${input.actorId}`,
      reasonCode: AA073_GRIM_NEIGH_REASON, promptKey: 'ability.grim-neigh.use',
      optionId: 'ability.grim-neigh.use', labelKey: 'ability.grim-neigh.boost-and-aura',
      ownerId: input.actorId, phase: 'ko', timing: 'ko', priority: 60,
    }),
    stage,
    evasion,
  ])
}

const heatMirageOperations = (input: {
  readonly moveIdentity: string
  readonly actorId: string
  readonly abilityInstanceId: string
}): readonly MoveEffectOperation[] => {
  const suffix = shortHash(input.moveIdentity, input.actorId, input.abilityInstanceId, 'heat-mirage')
  const requestId = `ability.heat-mirage.request.${suffix}`
  return Object.freeze([
    request({
      id: requestId, sourceId: `ability.heat-mirage.owner:${input.actorId}`,
      reasonCode: AA073_HEAT_MIRAGE_REASON, promptKey: 'ability.heat-mirage.use',
      optionId: 'ability.heat-mirage.use', labelKey: 'ability.heat-mirage.raise-evasion',
      ownerId: input.actorId, phase: 'hit', timing: 'post-hit', priority: 40,
    }),
    {
      id: `ability.heat-mirage.evasion.${suffix}`,
      kind: 'temporary-effect', source: { kind: 'operation', id: requestId },
      recipients: { kind: 'response-owner' }, phase: 'schedule',
      reasonCode: 'ability.heat-mirage.evasion-bonus',
      payload: {
        action: 'add', effectId: `ability.heat-mirage.evasion.${input.abilityInstanceId}`,
        recipientScope: 'placements',
        definition: {
          kind: 'numeric-modifier',
          duration: { kind: 'turns', subject: 'source', boundary: 'start', remaining: 1 },
          stacks: 1, charges: null,
          stackPolicy: { kind: 'refresh', maxStacks: null },
          chargePolicy: { kind: 'none', amount: null },
          tags: ['ability', 'aa073', 'heat-mirage', 'evasion'],
          payload: { attribute: 'evasion', operation: 'add', value: 3, rounding: 'none' },
          dispel: { policy: 'matching-tags', tags: ['heat-mirage', 'evasion'] },
          transferPolicy: 'expire',
        },
      },
    } satisfies MoveTemporaryEffectOperation,
  ])
}

const retaliationOperations = (input: {
  readonly moveIdentity: string
  readonly ownerId: string
  readonly effect: EncounterEffect
}): readonly MoveEffectOperation[] => {
  const suffix = shortHash(input.moveIdentity, input.ownerId, input.effect.id)
  const source = { kind: 'lifecycle-event' as const, id: `ability.gulp-missile.owner:${input.ownerId}` }
  const rollId = `ability.gulp-missile.roll.${suffix}`
  const roll: MoveRollEffectOperation = {
    id: rollId, kind: 'roll', source, recipients: { kind: 'actor' },
    phase: 'after-damage', reasonCode: AA073_GULP_MISSILE_ROLL_REASON,
    payload: {
      rollId: `${rollId}.d20`, formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 },
    },
  }
  const hp: MoveDirectHpEffectOperation = {
    id: `ability.gulp-missile.hp.${suffix}`, kind: 'direct-hp', source,
    recipients: { kind: 'actor' }, phase: 'after-damage', reasonCode: AA073_GULP_MISSILE_HP_REASON,
    payload: {
      mode: 'lose', pool: 'hit-points', calculation: { kind: 'percent-max', percent: 20 },
      copySource: null, bounds: { minimum: 0, maximum: null }, rounding: 'floor',
      applyTypeImmunity: false, cost: null,
      injury: { hitPointMarkers: 'apply-after-operation', massiveDamage: 'never' },
    },
  }
  const paralyze: MoveConditionEffectOperation = {
    id: `ability.gulp-missile.paralyze.${suffix}`, kind: 'condition', source,
    recipients: { kind: 'actor' }, phase: 'after-damage',
    reasonCode: AA073_GULP_MISSILE_PARALYZE_REASON,
    payload: {
      action: 'apply', conditionId: 'paralyzed', conditionSource: null,
      filter: null, randomChoice: null,
      applyMoveImmunity: false, applyTypeImmunity: false,
      duration: null, saveTiming: 'canonical', stackPolicy: { kind: 'refresh', maxStacks: null },
    },
  }
  const defense: MoveCombatStageEffectOperation = {
    id: `ability.gulp-missile.defense.${suffix}`, kind: 'combat-stage', source,
    recipients: { kind: 'actor' }, phase: 'after-damage',
    reasonCode: AA073_GULP_MISSILE_DEFENSE_REASON,
    payload: {
      action: 'modify', stage: 'def', selectedStage: null, value: -1,
      stageSource: null, rounding: null, applyTypeImmunity: false,
    },
  }
  const consume: MoveTemporaryEffectOperation = {
    id: `ability.gulp-missile.consume.${suffix}`, kind: 'temporary-effect', source,
    recipients: { kind: 'attacked-targets' }, phase: 'schedule',
    reasonCode: AA073_GULP_MISSILE_CONSUME_REASON,
    payload: { action: 'remove', effectId: input.effect.id },
  }
  return Object.freeze([roll, hp, paralyze, defense, consume])
}

export const aa073HarvestRollOperationId = (
  moveIdentity: string,
  ownerId: string,
): string => `ability.harvest.roll.${shortHash(moveIdentity, ownerId, 'harvest')}`

export const aa073HarvestOwnerId = (
  operation: Pick<MoveEffectOperation, 'source' | 'reasonCode'>,
): string | null => operation.reasonCode === AA073_HARVEST_ROLL_REASON
  && operation.source.kind === 'lifecycle-event'
  && operation.source.id.startsWith('ability.harvest.owner:')
  ? operation.source.id.slice('ability.harvest.owner:'.length) || null
  : null

export const aa073GulpMissileOwnerId = (
  operation: Pick<MoveEffectOperation, 'source' | 'reasonCode'>,
): string | null => {
  if (!operation.reasonCode.startsWith('ability.gulp-missile.')
    || operation.source.kind !== 'lifecycle-event'
    || !operation.source.id.startsWith('ability.gulp-missile.owner:')) return null
  return operation.source.id.slice('ability.gulp-missile.owner:'.length) || null
}

export const aa073GulpMissileRollIdForOperation = (
  operation: Pick<MoveEffectOperation, 'id' | 'reasonCode'>,
): string | null => {
  if (![AA073_GULP_MISSILE_HP_REASON, AA073_GULP_MISSILE_PARALYZE_REASON, AA073_GULP_MISSILE_DEFENSE_REASON]
    .includes(operation.reasonCode as typeof AA073_GULP_MISSILE_HP_REASON)) return null
  const suffix = operation.id.split('.').at(-1)
  return suffix ? `ability.gulp-missile.roll.${suffix}.d20` : null
}

export const aa073GulpMissileRollOperationIdForOperation = (
  operation: Pick<MoveEffectOperation, 'id' | 'reasonCode'>,
): string | null => {
  const referenceId = aa073GulpMissileRollIdForOperation(operation)
  return referenceId?.endsWith('.d20') ? referenceId.slice(0, -'.d20'.length) : null
}

/** Reconstruct the armed user's AC 4 Physical shot from the sealed server ledger. */
export const aa073GulpMissileAccuracyOutcome = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly operation: MoveEffectOperation
  readonly parentScript: MoveAutomationScript
}): { readonly hit: boolean; readonly naturalResult: number } | null => {
  const ownerId = aa073GulpMissileOwnerId(input.operation)
  const rollOperationId = aa073GulpMissileRollOperationIdForOperation(input.operation)
  if (!ownerId || !rollOperationId) return null
  const ledger = input.context.random.snapshot().find(roll => roll.parentEffectId === rollOperationId)
  const ownerPlacement = input.context.queries.placements.get(ownerId)
  const ownerToken = input.context.queries.tokens.get(ownerId)
  const ownerSheet = ownerPlacement ? input.context.queries.sheets.forPlacement(ownerPlacement) : null
  if (!ledger || !ownerPlacement || !ownerToken || !ownerSheet) return null
  const targetId = input.context.actor.placement.id
  const missileContext: AuthoritativeMoveRulesContext = {
    ...input.context,
    actor: { placement: ownerPlacement, token: ownerToken, sheet: ownerSheet },
  }
  const missileScript: MoveAutomationScript = {
    ...input.parentScript,
    moveName: 'Gulp Missile', type: 'Normal', damageClass: 'Physical',
    ac: 4, requiresAccuracy: true, damaging: false,
    range: '6, 1 Target', keywords: [],
  }
  const accuracy = resolveAuthoritativeMoveUserAccuracy(missileContext, {
    targetPlacementId: targetId, script: missileScript,
  })
  let evasion = resolveMoveAutomationTargetEvasion(missileScript, input.context.actor.token, {
    attacker: ownerToken,
    fieldEffects: input.context.queries.rooms.projectFieldEffects(),
    dauntlessShieldActive: input.context.queries.abilities.has(targetId, 'Dauntless Shield'),
  }).value
    + aa065CovertEvasionBonus({ context: missileContext, placementId: targetId })
    + aa066DecoyEvasionBonus({ map: input.context.map, placementId: targetId })
  evasion = applyEncounterNumericModifiers({
    map: input.context.map, placementId: targetId,
    attribute: 'evasion', baseValue: evasion, now: input.context.time,
    isCapabilityEffective: canonicalId => input.context.queries.creatureRules.hasCapability(targetId, canonicalId),
    isCapabilityInstanceEffective: (instanceId, canonicalId) => input.context.queries.creatureRules
      .hasCapabilityInstance(targetId, instanceId, canonicalId),
  }).value
  return Object.freeze({
    hit: resolveMoveAutomationAccuracyRoll(missileScript, ledger.naturalResult, {
      userAccuracy: accuracy.modifiers.reduce((total, modifier) => total + modifier.value, 0),
      targetEvasion: evasion, accuracyRule: null,
    }).hit,
    naturalResult: ledger.naturalResult,
  })
}

/** Exact AA-073 overlays reconstructed from effective runtimes on every resume. */
export const aa073MoveOverlayOperations = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: MoveAutomationScript
  readonly moveSourceId: string
  readonly authoritativeTargetIds: readonly string[]
}): readonly MoveEffectOperation[] => {
  const operations: MoveEffectOperation[] = []
  const actorId = input.context.actor.placement.id
  const moveIdentity = input.context.resolutionId ?? `${input.moveSourceId}:${input.script.moveName}`
  const actorAbilities = input.context.queries.abilities.activeForPlacement(actorId)

  const grimNeigh = actorAbilities.find(ability => ability.canonicalId === 'Grim Neigh')
  if (grimNeigh && input.script.damaging
    && input.context.queries.resources.actionAvailable(actorId, 'free')) {
    operations.push(...grimNeighOperations({
      moveIdentity, moveSourceId: input.moveSourceId, actorId,
      abilityInstanceId: grimNeigh.instanceId,
    }))
  }

  const gulpMissile = actorAbilities.find(ability => ability.canonicalId === 'Gulp Missile')
  if (gulpMissile
    && (AA073_GULP_MISSILE_TRIGGER_MOVES as readonly string[]).includes(input.script.moveName)
    && !aa073GulpMissileArmedEffect(input.context, actorId)
    && input.context.queries.resources.actionAvailable(actorId, 'free')
    && sceneUseAvailable({
      context: input.context, ownerId: actorId, abilityInstanceId: gulpMissile.instanceId,
      canonicalId: 'Gulp Missile', limit: 2,
    })) {
    const suffix = shortHash(moveIdentity, actorId, gulpMissile.instanceId, 'arm')
    const requestId = `ability.gulp-missile.request.${suffix}`
    const effectId = `ability.gulp-missile.armed.${gulpMissile.instanceId}`
    operations.push(request({
      id: requestId, sourceId: `ability.gulp-missile.arm-owner:${actorId}`,
      reasonCode: AA073_GULP_MISSILE_ARM_REASON, promptKey: 'ability.gulp-missile.use',
      optionId: 'ability.gulp-missile.use', labelKey: 'ability.gulp-missile.arm',
      ownerId: actorId, phase: 'hit', timing: 'post-hit', priority: 45,
    }), armEffect({ requestId, effectId }))
  }
  if (gulpMissile && input.script.moveName === 'Stockpile') {
    const suffix = shortHash(moveIdentity, actorId, gulpMissile.instanceId, 'stockpile-cleanup')
    operations.push({
      id: `ability.gulp-missile.stockpile-marker-cleanup.${suffix}`,
      kind: 'temporary-effect',
      source: { kind: 'lifecycle-event', id: `ability.gulp-missile.stockpile-owner:${actorId}` },
      recipients: { kind: 'actor' },
      phase: 'schedule',
      reasonCode: 'ability.gulp-missile.stockpile-marker-normalized',
      payload: { action: 'remove', effectId: 'stockpile.count' },
    } satisfies MoveTemporaryEffectOperation)
  }

  const heatMirage = actorAbilities.find(ability => ability.canonicalId === 'Heat Mirage')
  if (heatMirage && input.script.type.trim().toLowerCase() === 'fire'
    && input.context.queries.resources.actionAvailable(actorId, 'free')) {
    operations.push(...heatMirageOperations({
      moveIdentity, actorId, abilityInstanceId: heatMirage.instanceId,
    }))
  }

  for (const targetId of [...new Set(input.authoritativeTargetIds)].sort()) {
    const effect = aa073GulpMissileArmedEffect(input.context, targetId)
    if (effect) operations.push(...retaliationOperations({ moveIdentity, ownerId: targetId, effect }))
  }

  if (['Teatime', 'Bug Bite'].includes(input.script.moveName)) {
    const round = Math.max(1, input.context.map.initiative?.round ?? 1)
    const turn = Math.max(0, input.context.map.encounterState?.history.currentTurn?.turn ?? 0)
    const harvestCandidateIds = input.script.moveName === 'Bug Bite'
      ? [actorId]
      : input.authoritativeTargetIds
    for (const ownerId of [...new Set(harvestCandidateIds)].sort()) {
      if (!input.context.queries.abilities.has(ownerId, 'Harvest')) continue
      if (createMoveAutomationWeatherResolver(input.context.map, {
        subjectPlacementId: ownerId,
      }).active().some(weather => weather.kind === 'sunny')) continue
      const effects = input.context.map.encounterState?.effects ?? []
      const placement = input.context.queries.placements.get(ownerId)
      if (!placement) continue
      const stopped = harvestStoppedForSheet({ effects, placement })
      const tradedThisTurn = harvestTradedForSheetThisTurn({
        effects, placement, round, turn,
      })
      if (stopped || tradedThisTurn) continue
      const operationId = aa073HarvestRollOperationId(moveIdentity, ownerId)
      operations.push({
        id: operationId,
        kind: 'roll',
        source: { kind: 'lifecycle-event', id: `ability.harvest.owner:${ownerId}` },
        recipients: { kind: 'attacked-targets' },
        phase: 'hit',
        reasonCode: AA073_HARVEST_ROLL_REASON,
        payload: {
          rollId: `${operationId}.coin`,
          formula: { kind: 'dice', count: 1, sides: 2, modifier: 0 },
        },
      } satisfies MoveRollEffectOperation)
    }
  }
  return Object.freeze(operations)
}

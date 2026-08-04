import { createHash } from 'node:crypto'
import type {
  MoveCombatStageEffectOperation,
  MoveConditionEffectOperation,
  MoveEffectOperation,
  MoveNestedMoveEffectOperation,
  MoveReactionRequestEffectOperation,
} from '#shared/moveAutomation/effects'
import {
  createEmptyAbilityDailyUsageLedger,
  parseAbilityDailyUsageLedger,
} from '#shared/abilityAutomation/resources'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import { getVoxelMaterialDefinition } from '~/utils/mapMaterials'
import { moveUsageKey } from '~/utils/moveUsage'
import { planMoveUsageTransition } from '../../planMoveUsageTransition'
import type { AuthoritativeMoveRulesContext } from '../../moveAutomation/context'
import { resolveSheetAndEdgeAbilityInstances } from '../../edgeAutomation/permanentGrants'
import { aa067MoveIgnoresAvoidanceAbilities } from './aa067StaticIntegration'

const shortHash = (...values: readonly string[]): string => createHash('sha256')
  .update(values.join('\u0000')).digest('hex').slice(0, 24)

export const AA067_AVOIDANCE_REASONS = Object.freeze(new Set([
  'ability.dig-away.optional-avoid',
  'ability.disguise.optional-avoid',
  'ability.dodge.optional-avoid',
]))
export const AA067_DELAYED_REACTION_REASON = 'ability.delayed-reaction.optional-half' as const
export const AA067_DISGUISE_REASON = 'ability.disguise.optional-avoid' as const

const sceneUseAvailable = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly ownerId: string
  readonly abilityInstanceId: string
  readonly canonicalId: string
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
  return spent < 1
}

const dailyUseAvailable = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly ownerId: string
  readonly abilityInstanceId: string
  readonly canonicalId: 'Dig Away' | 'Disguise' | 'Dodge'
}): boolean => {
  const placement = input.context.queries.placements.get(input.ownerId)
  const resolved = placement ? input.context.queries.sheets.forPlacement(placement) : null
  if (!placement || !resolved) return false
  const instance = input.context.queries.abilities.activeForPlacement(input.ownerId).find(ability => (
    ability.instanceId === input.abilityInstanceId && ability.canonicalId === input.canonicalId
  ))
  if (!instance) return false
  const ledger = parseAbilityDailyUsageLedger(
    resolved.sheet.abilityUsage ?? createEmptyAbilityDailyUsageLedger(),
  )
  const isBase = resolveSheetAndEdgeAbilityInstances(resolved.sheet).some(ability => (
    ability.instanceId === instance.instanceId && ability.canonicalId === input.canonicalId
  ))
  const lastingId = isBase ? `base:${input.canonicalId}` : instance.instanceId
  const spent = ledger.entries.find(entry => (
    entry.ownerId === `sheet:${placement.sheetKind}:${placement.sheetSlug}`
    && entry.abilityInstanceId === lastingId
    && entry.canonicalId === input.canonicalId
    && entry.clauseId === 'base'
  ))?.spent ?? 0
  return spent < 1
}

const digTerrainAvailable = (
  context: AuthoritativeMoveRulesContext,
  placementId: string,
): boolean => {
  const token = context.queries.tokens.get(placementId)
  const state = context.queries.targetStates.resolve(placementId)
  if (!token || state?.grounding !== 'grounded') return false
  const underfoot = []
  for (let z = token.position.z; z < token.position.z + token.base; z += 1) {
    for (let x = token.position.x; x < token.position.x + token.base; x += 1) {
      const voxel = context.map.voxels.find(candidate => (
        candidate.x === x && candidate.y === token.position.y - 1 && candidate.z === z
      ))
      if (voxel) underfoot.push(voxel)
    }
  }
  if (underfoot.length === 0) return true
  return underfoot.every((voxel) => {
    const material = getVoxelMaterialDefinition(voxel)
    const tags = new Set([...(material.tags ?? []), ...(voxel.tags ?? [])].map(tag => tag.toLowerCase()))
    return tags.has('burrow') && !tags.has('water')
  })
}

const digMoveAvailable = (
  context: AuthoritativeMoveRulesContext,
  ownerId: string,
): boolean => {
  const placement = context.queries.placements.get(ownerId)
  const sheet = placement ? context.queries.sheets.forPlacement(placement) : null
  if (!placement || !sheet || !digTerrainAvailable(context, ownerId)) return false
  try {
    return planMoveUsageTransition({
      map: context.map,
      sheetMoveUsage: sheet.sheet.moveUsage,
      placementId: ownerId,
      move: { moveName: 'Dig', moveKey: moveUsageKey('Dig') || 'dig', frequency: 'EOT' },
    }).previousUsage.available
  }
  catch {
    return false
  }
}

const optionalRequest = (input: {
  readonly id: string
  readonly moveSourceId: string
  readonly reasonCode: string
  readonly promptKey: string
  readonly options: readonly { readonly id: string; readonly labelKey: string }[]
  readonly ownerId: string
  readonly priority: number
}): MoveReactionRequestEffectOperation => ({
  id: input.id,
  kind: 'reaction-request',
  source: { kind: 'move', id: input.moveSourceId },
  recipients: { kind: 'none' },
  phase: 'hit',
  reasonCode: input.reasonCode,
  payload: {
    requestId: `${input.id}.response`, promptKey: input.promptKey,
    options: input.options, allowPass: true, timing: 'post-hit', priority: input.priority,
    ownerPlacementIds: [input.ownerId],
  },
})

const digNestedMove = (
  requestId: string,
  suffix: string,
): MoveNestedMoveEffectOperation => ({
  id: `ability.dig-away.dig.${suffix}`,
  kind: 'nested-move', source: { kind: 'operation', id: requestId },
  recipients: { kind: 'response-owner' }, phase: 'cleanup', reasonCode: 'dig-away',
  payload: {
    canonicalId: 'Dig', actor: { kind: 'sole-recipient' }, source: { kind: 'registered-spec' },
    targeting: { kind: 'operation-recipients' },
  },
})

const disguiseStages = (
  requestId: string,
  suffix: string,
): readonly MoveCombatStageEffectOperation[] => ([
  ['attack', 'atk'], ['defense', 'def'], ['special-attack', 'satk'],
  ['special-defense', 'sdef'], ['speed', 'spd'],
] as const).map(([optionId, stage]) => ({
  id: `ability.disguise.stage-${stage}.${suffix}`,
  kind: 'combat-stage', source: { kind: 'operation', id: requestId },
  recipients: { kind: 'response-owner' }, phase: 'after-damage',
  reasonCode: `ability.disguise.raise-${optionId}`,
  payload: {
    action: 'modify', stage, selectedStage: null, value: 1,
    stageSource: null, rounding: null,
  },
}))

/** Exact AA-067 overlays reconstructed from effective runtimes on every resume. */
export const aa067MoveOverlayOperations = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: MoveAutomationScript
  readonly moveSourceId: string
  readonly authoritativeTargetIds: readonly string[]
}): readonly MoveEffectOperation[] => {
  const operations: MoveEffectOperation[] = []
  const damaging = input.script.damageClass === 'Physical' || input.script.damageClass === 'Special'
  const bypassesAvoidance = aa067MoveIgnoresAvoidanceAbilities(input.script)
  const moveIdentity = input.context.resolutionId ?? input.script.moveName
  const actorId = input.context.actor.placement.id

  if (input.script.moveName === 'Spore'
    && input.context.queries.abilities.has(actorId, 'Dire Spore')) {
    operations.push({
      id: `ability.dire-spore.poison.${shortHash(moveIdentity, actorId)}`,
      kind: 'condition', source: { kind: 'move', id: input.moveSourceId },
      recipients: { kind: 'hit-targets' }, phase: 'after-damage',
      reasonCode: 'ability.dire-spore.poisoned',
      payload: {
        action: 'apply', conditionId: 'poisoned', conditionSource: null,
        filter: null, randomChoice: null, duration: null,
        saveTiming: 'canonical', stackPolicy: { kind: 'refresh', maxStacks: null },
      },
    } satisfies MoveConditionEffectOperation)
  }

  for (const targetId of [...new Set(input.authoritativeTargetIds)].sort()) {
    const digAway = input.context.queries.abilities.activeForPlacement(targetId)
      .find(ability => ability.canonicalId === 'Dig Away')
    if (!bypassesAvoidance && digAway
      && input.context.queries.resources.actionAvailable(targetId, 'free')
      && input.context.queries.resources.actionAvailable(targetId, 'standard')
      && dailyUseAvailable({
        context: input.context, ownerId: targetId,
        abilityInstanceId: digAway.instanceId, canonicalId: 'Dig Away',
      }) && digMoveAvailable(input.context, targetId)) {
      const suffix = shortHash(moveIdentity, actorId, targetId, digAway.instanceId, 'Dig Away')
      const requestId = `ability.dig-away.request.${suffix}`
      operations.push(optionalRequest({
        id: requestId, moveSourceId: input.moveSourceId, reasonCode: 'ability.dig-away.optional-avoid',
        promptKey: 'ability.dig-away.use',
        options: [{ id: 'ability.dig-away.use', labelKey: 'ability.dig-away.use-dig' }],
        ownerId: targetId, priority: 120,
      }), digNestedMove(requestId, suffix))
    }
  }

  if (!damaging) return Object.freeze(operations)
  for (const targetId of [...new Set(input.authoritativeTargetIds)].sort()) {
    const abilities = input.context.queries.abilities.activeForPlacement(targetId)
    if (input.context.queries.resources.actionAvailable(targetId, 'free')) {
      const disguise = bypassesAvoidance ? null : abilities.find(ability => ability.canonicalId === 'Disguise')
      if (disguise && dailyUseAvailable({
        context: input.context, ownerId: targetId,
        abilityInstanceId: disguise.instanceId, canonicalId: 'Disguise',
      })) {
        const suffix = shortHash(moveIdentity, actorId, targetId, disguise.instanceId, 'Disguise')
        const requestId = `ability.disguise.request.${suffix}`
        operations.push(optionalRequest({
          id: requestId, moveSourceId: input.moveSourceId, reasonCode: AA067_DISGUISE_REASON,
          promptKey: 'ability.disguise.choose-stat', ownerId: targetId, priority: 140,
          options: ['attack', 'defense', 'special-attack', 'special-defense', 'speed'].map(stat => ({
            id: `ability.disguise.${stat}`, labelKey: `ability.disguise.raise-${stat}`,
          })),
        }), ...disguiseStages(requestId, suffix))
      }

      const dodge = bypassesAvoidance ? null : abilities.find(ability => ability.canonicalId === 'Dodge')
      if (dodge && dailyUseAvailable({
        context: input.context, ownerId: targetId,
        abilityInstanceId: dodge.instanceId, canonicalId: 'Dodge',
      })) {
        const suffix = shortHash(moveIdentity, actorId, targetId, dodge.instanceId, 'Dodge')
        operations.push(optionalRequest({
          id: `ability.dodge.request.${suffix}`, moveSourceId: input.moveSourceId,
          reasonCode: 'ability.dodge.optional-avoid', promptKey: 'ability.dodge.use',
          options: [{ id: 'ability.dodge.use', labelKey: 'ability.dodge.make-miss' }],
          ownerId: targetId, priority: 130,
        }))
      }

      const delayed = abilities.find(ability => ability.canonicalId === 'Delayed Reaction')
      if (delayed && sceneUseAvailable({
        context: input.context, ownerId: targetId,
        abilityInstanceId: delayed.instanceId, canonicalId: 'Delayed Reaction',
      })) {
        const suffix = shortHash(moveIdentity, actorId, targetId, delayed.instanceId, 'Delayed Reaction')
        operations.push(optionalRequest({
          id: `ability.delayed-reaction.request.${suffix}`, moveSourceId: input.moveSourceId,
          reasonCode: AA067_DELAYED_REACTION_REASON,
          promptKey: 'ability.delayed-reaction.use',
          options: [{ id: 'ability.delayed-reaction.use', labelKey: 'ability.delayed-reaction.halve-damage' }],
          ownerId: targetId, priority: 100,
        }))
      }
    }
  }

  return Object.freeze(operations)
}

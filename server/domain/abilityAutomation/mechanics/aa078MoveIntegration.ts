import { createHash } from 'node:crypto'
import {
  AA078_LIQUID_OOZE_DRAIN_MOVE_IDS,
  AA078_LUNCHBOX_TEMP_HP_REASON,
} from '#shared/abilityAutomation/aa078'
import {
  parseMoveEffectOperation,
  type MoveCombatStageEffectOperation,
  type MoveDirectHpEffectOperation,
  type MoveEffectOperation,
  type MoveHealEffectOperation,
  type MoveItemEffectOperation,
  type MoveReactionRequestEffectOperation,
} from '#shared/moveAutomation/effects'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import { ptuGridDistanceBetweenFootprints } from '~/utils/ptuGridDistance'
import type { AuthoritativeMoveRulesContext } from '../../moveAutomation/context'
import { storedDigestionBuffIds } from '../../moveAutomation/itemEffectInterpreter'
import {
  reviewedDamage,
  reviewedDirectHp,
} from '../../moveAutomation/specs/reviewedSpecBuilder'
import { aa078LiquidVoiceModeForMove } from './aa078StaticIntegration'

export const AA078_LIGHTNING_ROD_REASON = 'ability.lightning-rod.optional-redirection' as const
export const AA078_LIGHTNING_ROD_STAGE_REASON = 'ability.lightning-rod.raise-special-attack' as const
export const AA078_LULLABY_REASON = 'ability.lullaby.optional-automatic-hit' as const
export const AA078_LUNCHBOX_REASON = 'ability.lunchbox.optional-temporary-hp' as const
export { AA078_LUNCHBOX_TEMP_HP_REASON }
export const AA078_MAGIC_BOUNCE_REASON = 'ability.magic-bounce.optional-reflection' as const
export const AA078_MAGIC_BOUNCE_HAZARD_REASON = 'ability.magic-bounce.optional-hazard-control' as const
export const AA078_MAGIC_BOUNCE_HAZARD_OPERATION_REASON = 'ability.magic-bounce.reflected-hazard' as const
export const AA078_LIQUID_OOZE_RECOIL_REASON = 'ability.liquid-ooze.recoil-half' as const

export const AA078_LIGHTNING_ROD_OPTION_ID = 'ability.lightning-rod.use' as const
export const AA078_LULLABY_OPTION_PREFIX = 'ability.lullaby.target.' as const
export const AA078_LUNCHBOX_OPTION_ID = 'ability.lunchbox.use' as const
export const AA078_MAGIC_BOUNCE_OPTION_ID = 'ability.magic-bounce.use' as const
export const AA078_MAGIC_BOUNCE_HAZARD_OPTION_ID = 'ability.magic-bounce.hazard.use' as const

const DRAIN_MOVES = new Set<string>(AA078_LIQUID_OOZE_DRAIN_MOVE_IDS)
const hash = (...values: readonly string[]): string => createHash('sha256')
  .update(values.join('\u0000')).digest('hex').slice(0, 24)

const sceneUseAvailable = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly ownerId: string
  readonly abilityInstanceId: string
  readonly canonicalId: string
  readonly limit?: number
}): boolean => {
  const sceneId = input.context.map.encounterState?.history.sceneId
  if (!sceneId) return false
  const ledger = input.context.map.encounterState?.abilityUsage
  const entry = ledger && (!ledger.sceneId || ledger.sceneId === sceneId)
    ? ledger.entries.find(candidate => (
        candidate.ownerId === input.ownerId
        && candidate.abilityInstanceId === input.abilityInstanceId
        && candidate.canonicalId === input.canonicalId
        && candidate.clauseId === 'base'
      ))
    : undefined
  return (entry?.spent ?? 0) < (input.limit ?? 1)
}

const availableAbility = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly ownerId: string
  readonly canonicalId: string
  readonly limit?: number
}) => {
  const ability = input.context.queries.abilities.activeForPlacement(input.ownerId)
    .find(candidate => candidate.canonicalId === input.canonicalId)
  return ability
    && input.context.queries.resources.actionAvailable(input.ownerId, 'free')
    && sceneUseAvailable({ ...input, abilityInstanceId: ability.instanceId })
    ? ability
    : null
}

const requestOperation = (input: {
  readonly id: string
  readonly sourceId: string
  readonly reasonCode: string
  readonly promptKey: string
  readonly options: readonly { readonly id: string; readonly labelKey: string }[]
  readonly ownerId: string
  readonly timing: 'target' | 'pre-damage' | 'post-hit' | 'cleanup'
  readonly priority: number
}): MoveReactionRequestEffectOperation => parseMoveEffectOperation({
  id: input.id,
  kind: 'reaction-request',
  source: { kind: 'lifecycle-event', id: input.sourceId },
  recipients: { kind: 'none' },
  phase: input.timing === 'target'
    ? 'target'
    : input.timing === 'pre-damage'
      ? 'damage'
      : input.timing === 'cleanup'
        ? 'cleanup'
        : 'hit',
  reasonCode: input.reasonCode,
  payload: {
    requestId: `${input.id}.response`,
    promptKey: input.promptKey,
    options: input.options,
    allowPass: true,
    timing: input.timing,
    priority: input.priority,
    ownerPlacementIds: [input.ownerId],
  },
}, `aa078.request.${input.id}`) as MoveReactionRequestEffectOperation

const lightningRodOperations = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: MoveAutomationScript
  readonly moveSourceId: string
}): readonly MoveEffectOperation[] => {
  if (input.script.type.trim().toLowerCase() !== 'electric'
    || input.script.keywords.some(keyword => keyword.trim().toLowerCase() === 'melee')
    || input.context.queries.abilities.has(input.context.actor.placement.id, 'Stalwart')) return []
  const actor = input.context.actor.token
  const operations: MoveEffectOperation[] = []
  for (const placement of input.context.queries.placements.all()) {
    if (placement.id === input.context.actor.placement.id) continue
    const token = input.context.queries.tokens.get(placement.id)
    const ability = token && ptuGridDistanceBetweenFootprints(actor, token) <= 10
      ? availableAbility({ context: input.context, ownerId: placement.id, canonicalId: 'Lightning Rod' })
      : null
    if (!ability) continue
    const suffix = hash(input.context.resolutionId ?? input.moveSourceId, placement.id, ability.instanceId)
    const request = requestOperation({
      id: `ability.lightning-rod.request.${suffix}`,
      sourceId: `ability.lightning-rod.owner:${placement.id}`,
      reasonCode: AA078_LIGHTNING_ROD_REASON,
      promptKey: 'ability.lightning-rod.redirect',
      options: [{ id: AA078_LIGHTNING_ROD_OPTION_ID, labelKey: 'ability.lightning-rod.use' }],
      ownerId: placement.id,
      timing: 'target',
      priority: 154,
    })
    const stage: MoveCombatStageEffectOperation = {
      id: `ability.lightning-rod.stage.${suffix}`,
      kind: 'combat-stage',
      source: { kind: 'operation', id: request.id },
      recipients: { kind: 'response-owner' },
      phase: 'hit',
      reasonCode: AA078_LIGHTNING_ROD_STAGE_REASON,
      payload: {
        action: 'modify', stage: 'satk', selectedStage: null, value: 1,
        stageSource: null, rounding: null,
      },
    }
    operations.push(request, stage)
  }
  return operations
}

export const aa078LullabyTargetOptionId = (targetId: string): string => (
  `${AA078_LULLABY_OPTION_PREFIX}${hash(targetId)}`
)

const lullabyOperations = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: MoveAutomationScript
  readonly moveSourceId: string
  readonly authoritativeTargetIds: readonly string[]
}): readonly MoveEffectOperation[] => {
  if (input.script.moveName !== 'Sing' || input.authoritativeTargetIds.length === 0) return []
  const ownerId = input.context.actor.placement.id
  const ability = availableAbility({ context: input.context, ownerId, canonicalId: 'Lullaby' })
  if (!ability) return []
  const targetIds = [...new Set(input.authoritativeTargetIds)]
    .filter(id => input.context.queries.placements.get(id))
    .sort()
  if (targetIds.length === 0) return []
  const suffix = hash(input.context.resolutionId ?? input.moveSourceId, ownerId, ability.instanceId, ...targetIds)
  return [requestOperation({
    id: `ability.lullaby.request.${suffix}`,
    sourceId: `ability.lullaby.owner:${ownerId}`,
    reasonCode: AA078_LULLABY_REASON,
    promptKey: 'ability.lullaby.choose-automatic-hit-target',
    options: targetIds.map(targetId => ({
      id: aa078LullabyTargetOptionId(targetId),
      labelKey: `ability.lullaby.target.${hash(targetId)}`,
    })),
    ownerId,
    timing: 'target',
    priority: 152,
  })]
}

const magicBounceOperations = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: MoveAutomationScript
  readonly moveSourceId: string
  readonly authoritativeTargetIds: readonly string[]
}): readonly MoveEffectOperation[] => {
  const statusMove = input.script.damageClass === 'Status'
  if (!statusMove) return []
  const actorId = input.context.actor.placement.id
  const isHazard = input.script.targetMode === 'hazard' || input.script.hazardSuggestions.length > 0
  const candidateIds = isHazard
    ? input.context.queries.placements.all().flatMap((placement) => {
        const token = input.context.queries.tokens.get(placement.id)
        return placement.id !== actorId && token
          && ptuGridDistanceBetweenFootprints(input.context.actor.token, token) <= 10
          ? [placement.id] : []
      })
    : [...new Set(input.authoritativeTargetIds)].filter(id => id !== actorId)
  const operations: MoveEffectOperation[] = []
  for (const ownerId of candidateIds) {
    const ability = availableAbility({ context: input.context, ownerId, canonicalId: 'Magic Bounce' })
    if (!ability) continue
    const suffix = hash(input.context.resolutionId ?? input.moveSourceId, ownerId, ability.instanceId, isHazard ? 'hazard' : 'status')
    operations.push(requestOperation({
      id: `ability.magic-bounce.${isHazard ? 'hazard.' : ''}request.${suffix}`,
      sourceId: `ability.magic-bounce.${isHazard ? 'hazard-' : ''}owner:${ownerId}`,
      reasonCode: isHazard ? AA078_MAGIC_BOUNCE_HAZARD_REASON : AA078_MAGIC_BOUNCE_REASON,
      promptKey: isHazard ? 'ability.magic-bounce.control-hazard' : 'ability.magic-bounce.reflect-status-move',
      options: [{
        id: isHazard ? AA078_MAGIC_BOUNCE_HAZARD_OPTION_ID : AA078_MAGIC_BOUNCE_OPTION_ID,
        labelKey: isHazard ? 'ability.magic-bounce.hazard.use' : 'ability.magic-bounce.use',
      }],
      ownerId,
      timing: isHazard ? 'target' : 'pre-damage',
      priority: 153,
    }))
  }
  return operations
}

/** Reviewed reactions rebuilt for immediate, nested, pending, and resumed execution. */
export const aa078MoveOverlayOperations = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: MoveAutomationScript
  readonly moveSourceId: string
  readonly authoritativeTargetIds: readonly string[]
}): readonly MoveEffectOperation[] => Object.freeze([
  ...lightningRodOperations(input),
  ...lullabyOperations(input),
  ...magicBounceOperations(input),
])

const liquidVoiceOperations = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: MoveAutomationScript
  readonly operations: readonly MoveEffectOperation[]
}): readonly MoveEffectOperation[] => {
  const mode = aa078LiquidVoiceModeForMove(input)
  if (!mode.active) return input.operations
  let transformed = input.operations.map((operation): MoveEffectOperation => {
    if (operation.kind === 'damage') return {
      ...operation,
      payload: { ...operation.payload, moveType: 'water' },
    }
    if (operation.kind === 'multi-hit') return {
      ...operation,
      payload: { ...operation.payload, damage: { ...operation.payload.damage, moveType: 'water' } },
    }
    return operation
  })
  if (!mode.statusDamage || transformed.some(operation => operation.kind === 'damage' || operation.kind === 'multi-hit')) {
    return transformed
  }
  const accuracy = transformed.find(operation => operation.kind === 'roll'
    && operation.phase === 'accuracy'
    && operation.recipients.kind === 'attacked-targets')
  const suffix = hash(input.context.resolutionId ?? input.script.moveName, 'liquid-voice-db1')
  const damage = reviewedDamage({
    slug: `ability-liquid-voice-${suffix}`,
    damageBase: 1,
    damageClass: 'special',
    moveType: 'water',
    recipients: accuracy ? 'hit-targets' : 'attacked-targets',
    ...(accuracy && accuracy.kind === 'roll' ? {
      sourceOperationId: accuracy.id,
      accuracyRollId: accuracy.payload.rollId,
      criticalRollId: accuracy.payload.rollId,
    } : { accuracyRollId: null, criticalRollId: null }),
  })
  if (!accuracy) {
    transformed = [...transformed, {
      ...damage,
      source: { kind: 'move', id: `move.${input.script.moveName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` },
    }]
  }
  else transformed = [...transformed, damage]
  return transformed
}

const liquidOozeRecoilOperations = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: MoveAutomationScript
  readonly operations: readonly MoveEffectOperation[]
}): readonly MoveEffectOperation[] => {
  if (!DRAIN_MOVES.has(input.script.moveName)
    || !input.context.selectedPlacements.some(placement => (
      input.context.queries.abilities.has(placement.id, 'Liquid Ooze')
    ))
    || input.operations.some(operation => operation.reasonCode === AA078_LIQUID_OOZE_RECOIL_REASON)) return input.operations
  const damage = input.operations.find(operation => operation.kind === 'damage')
  if (!damage || damage.kind !== 'damage') return input.operations
  const recoil = reviewedDirectHp({
    slug: `ability-liquid-ooze-${hash(input.script.moveName, damage.id)}`,
    id: 'recoil-half',
    recipients: 'actor',
    calculation: {
      kind: 'damage-dealt', damageOperationId: damage.id, percent: 50,
      aggregation: 'aggregate', preventedDamage: 'zero',
    },
    sourceOperationId: damage.id,
  })
  return [...input.operations, { ...recoil, reasonCode: AA078_LIQUID_OOZE_RECOIL_REASON }]
}

const lunchboxOperations = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: MoveAutomationScript
  readonly operations: readonly MoveEffectOperation[]
}): readonly MoveEffectOperation[] => {
  const item = input.operations.find((operation): operation is MoveItemEffectOperation => (
    operation.kind === 'item' && operation.payload.action === 'digest-buff'
  ))
  if (!item) return input.operations
  const possibleOwnerIds = item.recipients.kind === 'actor'
    ? [input.context.actor.placement.id]
    : item.recipients.kind === 'all-placements'
      ? input.context.queries.placements.all().map(placement => placement.id)
      : input.context.selectedPlacements.map(placement => placement.id)
  const overlays: MoveEffectOperation[] = []
  for (const ownerId of possibleOwnerIds) {
    const ability = availableAbility({ context: input.context, ownerId, canonicalId: 'Lunchbox' })
    const placement = input.context.queries.placements.get(ownerId)
    if (!ability || !placement || storedDigestionBuffIds(input.context, placement).length === 0) continue
    const suffix = hash(input.context.resolutionId ?? input.script.moveName, ownerId, ability.instanceId, item.id)
    const request = requestOperation({
      id: `ability.lunchbox.request.${suffix}`,
      sourceId: `ability.lunchbox.item:${hash(item.id)}.owner:${ownerId}`,
      reasonCode: AA078_LUNCHBOX_REASON,
      promptKey: 'ability.lunchbox.gain-temporary-hp',
      options: [{ id: AA078_LUNCHBOX_OPTION_ID, labelKey: 'ability.lunchbox.use' }],
      ownerId,
      timing: 'cleanup',
      priority: 151,
    })
    const temporaryHp: MoveHealEffectOperation = {
      id: `ability.lunchbox.temp-hp.${suffix}`,
      kind: 'heal',
      source: { kind: 'operation', id: request.id },
      recipients: { kind: 'response-owner' },
      phase: 'cleanup',
      reasonCode: AA078_LUNCHBOX_TEMP_HP_REASON,
      payload: {
        mode: 'gain', pool: 'temporary-hit-points',
        calculation: { kind: 'percent-max', percent: 10 },
        bounds: { minimum: null, maximum: null }, rounding: 'floor',
        injury: { hitPointMarkers: 'ignore', massiveDamage: 'never' },
      },
    }
    overlays.push(request, temporaryHp)
  }
  return [...input.operations, ...overlays]
}

const deferMagicBounceHitEffects = (input: {
  readonly script: MoveAutomationScript
  readonly operations: readonly MoveEffectOperation[]
}): readonly MoveEffectOperation[] => {
  if (input.script.damageClass !== 'Status'
    || !input.operations.some(operation => operation.reasonCode === AA078_MAGIC_BOUNCE_REASON)) {
    return input.operations
  }
  return input.operations.map(operation => (
    operation.phase === 'hit' && operation.kind !== 'reaction-request'
      ? { ...operation, phase: 'damage' as const }
      : operation
  ))
}

/** Apply reviewed operation overlays that depend on dynamic handler output. */
export const applyAa078ReviewedOperations = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: MoveAutomationScript
  readonly operations: readonly MoveEffectOperation[]
}): readonly MoveEffectOperation[] => Object.freeze(lunchboxOperations({
  ...input,
  operations: liquidOozeRecoilOperations({
    context: input.context,
    script: input.script,
    operations: liquidVoiceOperations({
      ...input,
      operations: deferMagicBounceHitEffects(input),
    }),
  }),
}))

export const aa078IsDrainMove = (moveName: string): boolean => DRAIN_MOVES.has(moveName)

export const aa078HasLiquidOozeHitTarget = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly hitTargetIds: readonly string[]
}): boolean => input.hitTargetIds.some(id => input.context.queries.abilities.has(id, 'Liquid Ooze'))

import { createHash } from 'node:crypto'
import type {
  MoveChoiceRequestEffectOperation,
  MoveCombatStageEffectOperation,
  MoveConditionEffectOperation,
  MoveEffectOperation,
  MoveEffectSourceReference,
  MoveReactionRequestEffectOperation,
  MoveSwitchRequestEffectOperation,
  MoveTemporaryEffectOperation,
} from '#shared/moveAutomation/effects'
import { AA069_FADE_AWAY_SHIFT_MARK } from '#shared/abilityAutomation/aa069'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import { moveUsageKey } from '~/utils/moveUsage'
import type { AuthoritativeMoveRulesContext } from '../../moveAutomation/context'

export const AA069_ENFEEBLING_LIPS_REASON = 'ability.enfeebling-lips.choose-stat' as const
export const AA069_FIERY_CRASH_REASON = 'ability.fiery-crash.choose-mode' as const
export const AA069_EMERGENCY_EXIT_REASON = 'ability.emergency-exit.optional-switch' as const
export const AA069_FADE_AWAY_REASON = 'ability.fade-away.optional-avoid' as const

const shortHash = (...values: readonly string[]): string => createHash('sha256')
  .update(values.join('\u0000')).digest('hex').slice(0, 24)

const request = (input: {
  readonly id: string
  readonly moveSourceId: string
  readonly reasonCode: string
  readonly promptKey: string
  readonly ownerId: string
  readonly timing: 'declare' | 'post-hit' | 'pre-damage' | 'post-damage'
  readonly options: readonly { readonly id: string; readonly labelKey: string }[]
}): MoveReactionRequestEffectOperation => ({
  id: input.id,
  kind: 'reaction-request',
  source: { kind: 'move', id: input.moveSourceId },
  recipients: { kind: 'none' },
  phase: input.timing === 'declare' ? 'declare'
    : input.timing === 'post-damage' ? 'after-damage'
      : input.timing === 'pre-damage' ? 'damage'
        : 'hit',
  reasonCode: input.reasonCode,
  payload: {
    requestId: `${input.id}.response`,
    promptKey: input.promptKey,
    options: input.options,
    allowPass: true,
    timing: input.timing,
    priority: 90,
    ownerPlacementIds: [input.ownerId],
  },
})

const enfeeblingRequest = (input: {
  readonly id: string
  readonly moveSourceId: string
}): MoveChoiceRequestEffectOperation => ({
  id: input.id,
  kind: 'choice-request',
  source: { kind: 'move', id: input.moveSourceId },
  recipients: { kind: 'actor' },
  phase: 'hit',
  reasonCode: AA069_ENFEEBLING_LIPS_REASON,
  payload: {
    requestId: `${input.id}.response`,
    promptKey: 'ability.enfeebling-lips.choose-stat',
    options: ['attack', 'defense', 'special-attack', 'special-defense', 'speed'].map(stat => ({
      id: `ability.enfeebling-lips.${stat}`,
      labelKey: `ability.enfeebling-lips.lower-${stat}`,
    })),
    allowPass: false,
  },
})

const sceneUseAvailable = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly ownerId: string
  readonly abilityInstanceId: string
  readonly canonicalId: string
}): boolean => {
  const sceneId = input.context.map.encounterState?.history.sceneId
  const ledger = input.context.map.encounterState?.abilityUsage
  const existing = ledger?.sceneId === sceneId ? ledger?.entries.find(entry => (
    entry.ownerId === input.ownerId
    && entry.abilityInstanceId === input.abilityInstanceId
    && entry.canonicalId === input.canonicalId
    && entry.clauseId === 'base'
  )) : null
  return Boolean(sceneId) && (existing?.spent ?? 0) < 1
}

const enfeeblingStages = (
  requestId: string,
  suffix: string,
): readonly MoveCombatStageEffectOperation[] => ([
  ['attack', 'atk'],
  ['defense', 'def'],
  ['special-attack', 'satk'],
  ['special-defense', 'sdef'],
  ['speed', 'spd'],
] as const).map(([optionId, stage]) => ({
  id: `ability.enfeebling-lips.stage-${stage}.${suffix}`,
  kind: 'combat-stage',
  source: { kind: 'operation', id: requestId },
  recipients: { kind: 'hit-targets' },
  phase: 'after-damage',
  reasonCode: `ability.enfeebling-lips.lower-${optionId}`,
  payload: {
    action: 'modify', stage, selectedStage: null, value: -2,
    stageSource: null, rounding: null,
  },
}))

const fieryBurn = (input: {
  readonly source: MoveEffectSourceReference
  readonly suffix: string
  readonly moveKey: string
  readonly minimum: number
  readonly applyTypeImmunity: boolean
}): MoveConditionEffectOperation => ({
  id: `ability.fiery-crash.burn.${input.suffix}`,
  kind: 'condition',
  source: input.source,
  recipients: { kind: 'hit-targets' },
  phase: 'after-damage',
  reasonCode: 'ability.fiery-crash.burn',
  payload: {
    action: 'apply', conditionId: 'burned', conditionSource: null,
    filter: null, randomChoice: null,
    accuracyRollTrigger: {
      rollId: `${input.moveKey}.accuracy-roll`,
      trigger: { kind: 'range', minimum: input.minimum },
    },
    duration: null, saveTiming: 'canonical',
    stackPolicy: { kind: 'refresh', maxStacks: null },
    applyMoveImmunity: true, applyTypeImmunity: input.applyTypeImmunity,
  },
})

const fieryCrashBurnMinimum = (context: AuthoritativeMoveRulesContext, moveName: string): number | null => {
  const runtime = context.queries.rules.runtimeFor(moveName)
  if (!runtime || runtime.kind !== 'movespec-v2') return 19
  const burnOperations = runtime.definition.spec.phases.flatMap(block => block.operations)
    .filter((operation): operation is MoveConditionEffectOperation => (
      operation.kind === 'condition'
      && operation.payload.action === 'apply'
      && ['burn', 'burned'].includes(operation.payload.conditionId?.trim().toLowerCase() ?? '')
    ))
  if (burnOperations.length === 0) return 19
  if (burnOperations.some(operation => operation.payload.accuracyRollTrigger === undefined)) return null
  const minimums = burnOperations.flatMap((operation) => {
    const trigger = operation.payload.accuracyRollTrigger?.trigger
    return trigger?.kind === 'range' ? [trigger.minimum] : []
  })
  return minimums.length === burnOperations.length
    ? Math.max(1, Math.min(...minimums) - 2)
    : null
}

export const aa069MoveOverlayOperations = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: MoveAutomationScript
  readonly moveSourceId: string
  readonly authoritativeTargetIds: readonly string[]
}): readonly MoveEffectOperation[] => {
  const operations: MoveEffectOperation[] = []
  const actorId = input.context.actor.placement.id
  const moveIdentity = `${input.context.resolutionId}:${input.script.moveName}`
  const physical = input.script.damageClass === 'Physical'

  if (physical) {
    for (const targetId of [...new Set(input.authoritativeTargetIds)].sort()) {
      const targetAbility = input.context.queries.abilities.activeForPlacement(targetId)
        .find(ability => ability.canonicalId === 'Fade Away')
      if (!targetAbility
        || !input.context.queries.resources.actionAvailable(targetId, 'standard')
        || !sceneUseAvailable({
          context: input.context, ownerId: targetId,
          abilityInstanceId: targetAbility.instanceId, canonicalId: 'Fade Away',
        })) continue
      const suffix = shortHash(moveIdentity, actorId, targetId, targetAbility.instanceId, 'Fade Away')
      const requestId = `ability.fade-away.request.${suffix}`
      operations.push(request({
        id: requestId, moveSourceId: input.moveSourceId,
        reasonCode: AA069_FADE_AWAY_REASON,
        promptKey: 'ability.fade-away.use', ownerId: targetId,
        timing: 'pre-damage',
        options: [{ id: 'ability.fade-away.use', labelKey: 'ability.fade-away.avoid-and-shift' }],
      }), {
        id: `ability.fade-away.invisible.${suffix}`, kind: 'temporary-effect',
        source: { kind: 'operation', id: requestId }, recipients: { kind: 'response-owner' },
        phase: 'schedule', reasonCode: 'ability.fade-away.invisible',
        payload: {
          action: 'add', effectId: `ability.fade-away.invisible.${targetId}.${suffix}`,
          recipientScope: 'placements',
          definition: {
            kind: 'capability', duration: { kind: 'turns', subject: 'target', boundary: 'start', remaining: 1 },
            stacks: 1, charges: null,
            stackPolicy: { kind: 'replace', maxStacks: null },
            chargePolicy: { kind: 'none', amount: null },
            tags: ['ability', 'aa069', 'fade-away', 'invisibility'],
            payload: { capabilityId: 'aa069.fade-away.invisibility', action: 'grant' },
            dispel: { policy: 'matching-tags', tags: ['fade-away', 'invisibility'] },
            transferPolicy: 'expire',
          },
        },
      } satisfies MoveTemporaryEffectOperation, {
        id: `ability.fade-away.shift.${suffix}`, kind: 'temporary-effect',
        source: { kind: 'operation', id: requestId }, recipients: { kind: 'response-owner' },
        phase: 'schedule', reasonCode: 'ability.fade-away.shift-ready',
        payload: {
          action: 'add', effectId: `ability.fade-away.shift.${targetId}.${suffix}`,
          recipientScope: 'placements',
          definition: {
            kind: 'capability', duration: { kind: 'turns', subject: 'target', boundary: 'start', remaining: 1 },
            stacks: 1, charges: 1,
            stackPolicy: { kind: 'replace', maxStacks: null },
            chargePolicy: { kind: 'consume-on-trigger', amount: 1 },
            tags: ['ability', 'aa069', 'fade-away', 'free-shift'],
            payload: { capabilityId: AA069_FADE_AWAY_SHIFT_MARK, action: 'grant' },
            dispel: { policy: 'matching-tags', tags: ['fade-away', 'free-shift'] },
            transferPolicy: 'expire',
          },
        },
      } satisfies MoveTemporaryEffectOperation)
    }
  }

  for (const targetId of [...new Set([...input.authoritativeTargetIds, actorId])].sort()) {
    const target = input.context.queries.tokens.get(targetId)
    const targetAbility = input.context.queries.abilities.activeForPlacement(targetId)
      .find(ability => ability.canonicalId === 'Emergency Exit')
    const maximumHp = target ? Math.max(1, target.fullMaxHp ?? target.maxHp) : 1
    if (!target || target.currentHp * 2 < maximumHp || !targetAbility
      || !input.context.queries.resources.actionAvailable(targetId, 'free')
      || !sceneUseAvailable({
        context: input.context, ownerId: targetId,
        abilityInstanceId: targetAbility.instanceId, canonicalId: 'Emergency Exit',
      })) continue
    const suffix = shortHash(moveIdentity, actorId, targetId, targetAbility.instanceId, 'Emergency Exit')
    const requestId = `ability.emergency-exit.request.${suffix}`
    operations.push(request({
      id: requestId, moveSourceId: input.moveSourceId,
      reasonCode: AA069_EMERGENCY_EXIT_REASON,
      promptKey: 'ability.emergency-exit.use', ownerId: targetId,
      timing: 'post-damage',
      options: [{ id: 'ability.emergency-exit.use', labelKey: 'ability.emergency-exit.switch' }],
    }), {
      id: `ability.emergency-exit.switch.${suffix}`, kind: 'switch-request',
      source: { kind: 'operation', id: requestId }, recipients: { kind: 'response-owner' },
      phase: 'movement', reasonCode: 'ability.emergency-exit.switch',
      payload: {
        requestId: `ability.emergency-exit.replacement.${suffix}`,
        replacementSetId: `ability.emergency-exit.replacements.${suffix}`,
        promptKey: 'ability.emergency-exit.choose-replacement', trigger: 'always',
        required: false, passPolicy: 'recall', positionPolicy: 'recalled-position',
        initiativePolicy: 'inherit-slot', stateTransferPolicy: 'none',
      },
    } satisfies MoveSwitchRequestEffectOperation)
  }

  if (input.script.moveName === 'Lovely Kiss'
    && input.context.queries.abilities.has(actorId, 'Enfeebling Lips')) {
    const suffix = shortHash(moveIdentity, actorId, 'Enfeebling Lips')
    const requestId = `ability.enfeebling-lips.request.${suffix}`
    operations.push(enfeeblingRequest({
      id: requestId,
      moveSourceId: input.moveSourceId,
    }), ...enfeeblingStages(requestId, suffix))
  }

  const dash = input.script.keywords.some(keyword => keyword.trim().toLowerCase() === 'dash')
  const damaging = input.script.damageClass !== 'Status'
    && typeof input.script.damageBase === 'number'
    && input.script.damageBase > 0
  if (dash && damaging && input.context.queries.abilities.has(actorId, 'Fiery Crash')) {
    const suffix = shortHash(moveIdentity, actorId, 'Fiery Crash')
    const requestId = `ability.fiery-crash.request.${suffix}`
    const originallyFire = input.script.type.trim().toLowerCase() === 'fire'
    const burnMinimum = fieryCrashBurnMinimum(input.context, input.script.moveName)
    operations.push(request({
      id: requestId,
      moveSourceId: input.moveSourceId,
      reasonCode: AA069_FIERY_CRASH_REASON,
      promptKey: 'ability.fiery-crash.choose-mode',
      ownerId: actorId,
      timing: 'declare',
      options: [
        { id: 'ability.fiery-crash.damage-base-plus-2', labelKey: 'ability.fiery-crash.damage-base-plus-2' },
        ...(originallyFire ? [] : [{
          id: 'ability.fiery-crash.fire-type', labelKey: 'ability.fiery-crash.fire-type',
        }]),
      ],
    }))
    if (burnMinimum !== null) {
      operations.push(fieryBurn({
        source: originallyFire
          ? { kind: 'move', id: input.moveSourceId }
          : { kind: 'operation', id: requestId },
        suffix,
        moveKey: moveUsageKey(input.script.moveName)
          || input.script.moveName.trim().toLowerCase().replaceAll(/[^a-z0-9]+/g, '-'),
        minimum: burnMinimum,
        applyTypeImmunity: originallyFire,
      }))
    }
  }

  return Object.freeze(operations)
}

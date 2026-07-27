import { createHash } from 'node:crypto'
import type {
  MoveConditionEffectOperation,
  MoveEffectOperation,
  MoveNestedMoveEffectOperation,
  MoveReactionRequestEffectOperation,
} from '#shared/moveAutomation/effects'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import { ptuGridDistanceBetweenFootprints } from '~/utils/ptuGridDistance'
import type { AuthoritativeMoveRulesContext } from '../../moveAutomation/context'
import { aa066IsStatusDanceMove } from './aa066StaticIntegration'

const shortHash = (...values: readonly string[]): string => createHash('sha256')
  .update(values.join('\u0000')).digest('hex').slice(0, 24)

const sceneUseAvailable = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly ownerId: string
  readonly abilityInstanceId: string
  readonly canonicalId: string
  readonly limit: number
}): boolean => {
  const encounter = input.context.map.encounterState
  const sceneId = encounter?.history?.sceneId
  if (!sceneId) return false
  const usage = encounter?.abilityUsage
  if (usage?.sceneId && usage.sceneId !== sceneId) return true
  const spent = usage?.entries.find(entry => entry.ownerId === input.ownerId
    && entry.abilityInstanceId === input.abilityInstanceId
    && entry.canonicalId === input.canonicalId
    && entry.clauseId === 'base')?.spent ?? 0
  return spent < input.limit
}

const optionalRequest = (input: {
  readonly id: string
  readonly reasonCode: string
  readonly promptKey: string
  readonly optionId: string
  readonly optionLabelKey: string
  readonly ownerId: string
  readonly priority: number
  readonly phase: MoveReactionRequestEffectOperation['phase']
  readonly timing: MoveReactionRequestEffectOperation['payload']['timing']
  readonly moveSourceId: string
}): MoveReactionRequestEffectOperation => ({
  id: input.id, kind: 'reaction-request', source: { kind: 'move', id: input.moveSourceId },
  recipients: { kind: 'none' }, phase: input.phase, reasonCode: input.reasonCode,
  payload: {
    requestId: `${input.id}.response`, promptKey: input.promptKey,
    options: [{ id: input.optionId, labelKey: input.optionLabelKey }],
    allowPass: true, timing: input.timing, priority: input.priority,
    ownerPlacementIds: [input.ownerId],
  },
})

const nestedMove = (input: {
  readonly id: string
  readonly requestId: string
  readonly reasonCode: string
  readonly canonicalId: string
  readonly selfTargeting: boolean
}): MoveNestedMoveEffectOperation => ({
  id: input.id, kind: 'nested-move', source: { kind: 'operation', id: input.requestId },
  recipients: { kind: 'response-owner' }, phase: 'cleanup', reasonCode: input.reasonCode,
  payload: {
    canonicalId: input.canonicalId,
    actor: { kind: 'sole-recipient' },
    source: { kind: 'registered-spec' },
    targeting: input.selfTargeting
      ? { kind: 'operation-recipients' }
      : {
          kind: 'fresh-choice', requestId: `${input.id}.target`,
          promptKey: `ability.${input.reasonCode}.choose-target`,
          selector: { kind: 'candidate-targets' },
        },
  },
})

/** AA-066 Move hooks remain deterministic overlays reconstructed identically on resume. */
export const aa066MoveOverlayOperations = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: MoveAutomationScript
  readonly moveSourceId: string
  readonly authoritativeTargetIds: readonly string[]
}): readonly MoveEffectOperation[] => {
  const operations: MoveEffectOperation[] = []
  const actorId = input.context.actor.placement.id
  const moveIdentity = input.context.resolutionId ?? input.script.moveName

  const dancerAncestry = input.context.ancestry.some(entry => (
    entry.parentOperationId?.startsWith('ability.dancer.copy.') === true
  ))
  const dangerSyrupAncestry = input.context.ancestry.some(entry => (
    entry.parentOperationId?.startsWith('ability.danger-syrup.sweet-scent.') === true
  ))
  if (!dancerAncestry && aa066IsStatusDanceMove(input.script)) {
    for (const placement of [...input.context.queries.placements.all()].sort((a, b) => a.id.localeCompare(b.id))) {
      if (placement.id === actorId) continue
      const token = input.context.queries.tokens.get(placement.id)
      if (!token || ptuGridDistanceBetweenFootprints(input.context.actor.token, token) > 10) continue
      const dancer = input.context.queries.abilities.activeForPlacement(placement.id)
        .find(ability => ability.canonicalId === 'Dancer')
      if (!dancer
        || !input.context.queries.resources.actionAvailable(placement.id, 'free')
        || !sceneUseAvailable({
          context: input.context, ownerId: placement.id, abilityInstanceId: dancer.instanceId,
          canonicalId: 'Dancer', limit: 2,
        })) continue
      const suffix = shortHash(moveIdentity, actorId, placement.id, dancer.instanceId, input.script.moveName)
      const requestId = `ability.dancer.request.${suffix}`
      operations.push(optionalRequest({
        id: requestId, reasonCode: 'ability.dancer.optional-copy', promptKey: 'ability.dancer.use',
        optionId: 'ability.dancer.use', optionLabelKey: 'ability.dancer.copy-dance',
        ownerId: placement.id, priority: 90, phase: 'cleanup', timing: 'cleanup',
        moveSourceId: input.moveSourceId,
      }), nestedMove({
        id: `ability.dancer.copy.${suffix}`, requestId,
        reasonCode: 'dancer', canonicalId: input.script.moveName,
        selfTargeting: input.script.targetMode === 'self'
          || input.script.range.trim().toLowerCase() === 'self'
          || (input.script.areaTemplates?.length
            ? input.script.areaTemplates.every(template => (
                template.kind === 'burst' || template.kind === 'cardinally-adjacent'
              ))
            : false),
      }))
    }
  }

  for (const targetId of [...new Set(input.authoritativeTargetIds)].sort()) {
    const dangerSyrup = dangerSyrupAncestry
      ? null
      : input.context.queries.abilities.activeForPlacement(targetId)
      .find(ability => ability.canonicalId === 'Danger Syrup')
    if (!dangerSyrup
      || (!input.script.damaging && !input.script.requiresAccuracy)
      || !input.context.queries.resources.actionAvailable(targetId, 'free')
      || !sceneUseAvailable({
        context: input.context, ownerId: targetId, abilityInstanceId: dangerSyrup.instanceId,
        canonicalId: 'Danger Syrup', limit: 1,
      })) continue
    const suffix = shortHash(moveIdentity, actorId, targetId, dangerSyrup.instanceId)
    const requestId = `ability.danger-syrup.request.${suffix}`
    operations.push(optionalRequest({
      id: requestId, reasonCode: 'ability.danger-syrup.optional-sweet-scent',
      promptKey: 'ability.danger-syrup.use', optionId: 'ability.danger-syrup.use',
      optionLabelKey: 'ability.danger-syrup.use-sweet-scent', ownerId: targetId,
      priority: 85, phase: 'hit', timing: 'post-hit', moveSourceId: input.moveSourceId,
    }), nestedMove({
      id: `ability.danger-syrup.sweet-scent.${suffix}`, requestId,
      reasonCode: 'danger-syrup', canonicalId: 'Sweet Scent', selfTargeting: true,
    }))
  }

  if (input.script.moveName === 'Sweet Scent'
    && input.context.queries.abilities.has(actorId, 'Danger Syrup')) {
    const suffix = shortHash(moveIdentity, actorId, 'danger-syrup-blind')
    operations.push({
      id: `ability.danger-syrup.blind.${suffix}`, kind: 'condition',
      source: { kind: 'move', id: input.moveSourceId }, recipients: { kind: 'hit-targets' },
      phase: 'after-damage', reasonCode: 'ability.danger-syrup.blind-on-hit',
      payload: {
        action: 'apply', conditionId: 'blindness', conditionSource: null,
        filter: null, randomChoice: null,
        duration: {
          effectId: `ability.danger-syrup.blind.${suffix}`,
          duration: { kind: 'rounds', boundary: 'end', remaining: 1 },
          transferPolicy: 'expire',
        },
        saveTiming: 'canonical', stackPolicy: { kind: 'refresh', maxStacks: null },
      },
    } satisfies MoveConditionEffectOperation)
  }

  return Object.freeze(operations)
}

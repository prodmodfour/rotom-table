import { createHash } from 'node:crypto'
import type {
  MoveCombatStageEffectOperation,
  MoveDirectHpEffectOperation,
  MoveEffectOperation,
  MoveMovementRequestEffectOperation,
  MoveReactionRequestEffectOperation,
} from '#shared/moveAutomation/effects'
import type { MoveDamageModifier } from '~/utils/moveAutomationDamagePipeline'
import type { MoveDamageEffectOperation } from '#shared/moveAutomation/effects'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'
import { ptuGridDistanceBetweenFootprints } from '~/utils/ptuGridDistance'
import type { AuthoritativeMoveRulesContext } from '../../moveAutomation/context'

const BONE_MOVES = new Set(['Bone Club', 'Bone Rush', 'Bonemerang'])
const shortHash = (value: string): string => createHash('sha256').update(value).digest('hex').slice(0, 24)
export const aa062BoneLordReadyMarkId = (moveName: string): string => `aa062.bone-lord.ready:${shortHash(moveName)}`
export const aa062BoneLordUsedMarkId = (moveName: string): string => `aa062.bone-lord.used:${shortHash(moveName)}`
export const aa062BoneLordEmpowersMoveState = (input: {
  readonly map: Pick<AuthoritativeMoveRulesContext['map'], 'encounterState'>
  readonly actorPlacementId: string
  readonly activeAbilityInstanceIds: readonly string[]
  readonly moveName: string
}): boolean => (input.map.encounterState?.abilityOwnedState?.entries ?? []).some(entry => (
  entry.ownerPlacementId === input.actorPlacementId
  && entry.canonicalId === 'Bone Lord'
  && entry.payload.kind === 'mark'
  && entry.payload.markId === aa062BoneLordReadyMarkId(input.moveName)
  && input.activeAbilityInstanceIds.includes(entry.sourceAbilityInstanceId)
))
export const aa062BoneLordEmpowersMove = (
  context: AuthoritativeMoveRulesContext,
  moveName: string,
): boolean => aa062BoneLordEmpowersMoveState({
  map: context.map,
  actorPlacementId: context.actor.placement.id,
  activeAbilityInstanceIds: context.queries.abilities.activeForPlacement(context.actor.placement.id)
    .filter(ability => ability.canonicalId === 'Bone Lord').map(ability => ability.instanceId),
  moveName,
})
export const hasPendingAa062BoneLordMove = (context: AuthoritativeMoveRulesContext): boolean => (
  (context.map.encounterState?.abilityOwnedState?.entries ?? []).some(entry => (
    entry.ownerPlacementId === context.actor.placement.id
    && entry.canonicalId === 'Bone Lord'
    && entry.payload.kind === 'mark'
    && entry.payload.markId.startsWith('aa062.bone-lord.ready:')
  ))
)
export const aa062BoneLordReadyStateIds = (
  context: AuthoritativeMoveRulesContext,
  moveName: string,
): readonly string[] => Object.freeze((context.map.encounterState?.abilityOwnedState?.entries ?? []).flatMap(entry => (
  entry.ownerPlacementId === context.actor.placement.id
  && entry.canonicalId === 'Bone Lord'
  && entry.payload.kind === 'mark'
  && entry.payload.markId === aa062BoneLordReadyMarkId(moveName)
    ? [entry.stateId]
    : []
)))

export const aa062BoneLordMoveScript = (
  context: AuthoritativeMoveRulesContext,
  script: MoveAutomationScript,
): MoveAutomationScript => {
  if (script.moveName !== 'Bonemerang' || !aa062BoneLordEmpowersMove(context, 'Bonemerang')) return script
  return {
    ...script,
    targetMode: 'multi-target', targetCount: null,
    range: 'Line 6', keywords: script.keywords.filter(keyword => keyword !== 'Double Strike'),
    areaTemplates: [{ kind: 'line', size: 6, label: 'Line 6' }],
  }
}

export const aa062HasBoneWielderImmunityOverride = (
  context: AuthoritativeMoveRulesContext,
  script: Pick<MoveAutomationScript, 'moveName'>,
): boolean => BONE_MOVES.has(script.moveName)
  && context.queries.abilities.has(context.actor.placement.id, 'Bone Wielder')

/** Exact manifest-selected AA-062 damage-roll modifiers. */
export const aa062MoveDamageModifiers = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly operation: MoveDamageEffectOperation
  readonly script: MoveAutomationScript
  readonly actor: SpawnedPokemon
  readonly recipient: SpawnedPokemon
  readonly moveType: string
}): readonly MoveDamageModifier[] => {
  if (input.moveType.trim().toLowerCase() !== 'fire'
    || !input.context.queries.abilities.has(input.actor.id, 'Blaze')) return Object.freeze([])
  const maximumHp = Math.max(1, input.actor.fullMaxHp ?? input.actor.maxHp)
  const lowHp = Math.max(0, input.actor.currentHp) * 3 <= maximumHp
  return Object.freeze([{
    id: `ability.blaze.damage.${input.operation.id}.${input.recipient.id}`,
    stage: 'pre-type-modifiers', priority: 30,
    source: { kind: 'ability', id: input.actor.id },
    stackingGroup: 'aa062-blaze',
    reasonCode: lowHp ? 'ability.blaze.low-hp-damage-bonus' : 'ability.blaze.damage-bonus',
    operation: 'add', value: lowHp ? 10 : 5,
  }])
}

const bodyguardSceneUseAvailable = (
  context: AuthoritativeMoveRulesContext,
  ownerId: string,
  abilityInstanceId: string,
): boolean => {
  const sceneId = context.map.encounterState?.history.sceneId
  const usage = context.map.encounterState?.abilityUsage
  const entry = usage && usage.sceneId === sceneId ? usage.entries.find(candidate => (
    candidate.ownerId === ownerId
    && candidate.abilityInstanceId === abilityInstanceId
    && candidate.canonicalId === 'Bodyguard'
    && candidate.clauseId === 'base'
  )) : undefined
  return Boolean(sceneId) && (entry?.spent ?? 0) < 2
}

/** Move-owned overlays for AA-062 abilities whose rules modify a named move. */
export const aa062MoveOverlayOperations = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: MoveAutomationScript
  readonly moveSourceId: string
}): readonly MoveEffectOperation[] => {
  const operations: MoveEffectOperation[] = []
  const actorBlocksTargetChanges = input.context.queries.abilities.has(
    input.context.actor.placement.id,
    'Stalwart',
  )
  for (const targetId of actorBlocksTargetChanges
    ? []
    : [...new Set(input.context.selectedPlacements.map(placement => placement.id))].sort()) {
    const target = input.context.queries.tokens.get(targetId)
    if (!target) continue
    const providers = input.context.queries.placements.all().flatMap((placement) => {
      if (placement.id === targetId
        || input.context.queries.relationships.resolve(placement.id, targetId).relationship !== 'ally') return []
      const token = input.context.queries.tokens.get(placement.id)
      const providerWouldKeepAllyInArea = input.context.intent.selection.kind === 'area'
        && input.context.candidatePlacements.some(candidate => candidate.id === placement.id)
      const ability = input.context.queries.abilities.activeForPlacement(placement.id)
        .find(candidate => candidate.canonicalId === 'Bodyguard')
      return token && ability
        && !providerWouldKeepAllyInArea
        && ptuGridDistanceBetweenFootprints(token, target) <= 1
        && input.context.queries.resources.actionAvailable(placement.id, 'free')
        && bodyguardSceneUseAvailable(input.context, placement.id, ability.instanceId)
        ? [{ placement, ability }]
        : []
    })
    for (const provider of providers) {
      const suffix = shortHash(`${input.context.resolutionId ?? input.script.moveName}:${targetId}:${provider.placement.id}`)
      const requestId = `ability.bodyguard.request.${suffix}`
      const request: MoveReactionRequestEffectOperation = {
        id: requestId,
        kind: 'reaction-request',
        source: { kind: 'lifecycle-event', id: `ability.bodyguard.target:${targetId}` },
        recipients: { kind: 'none' }, phase: 'damage',
        reasonCode: 'ability.bodyguard.optional-redirection',
        payload: {
          requestId: `ability.bodyguard.response.${suffix}`,
          promptKey: 'ability.bodyguard.use',
          options: [{ id: 'ability.bodyguard.use', labelKey: 'ability.bodyguard.swap-and-guard' }],
          allowPass: true, timing: 'pre-damage', priority: 110,
          ownerPlacementIds: [provider.placement.id],
        },
      }
      operations.push(request, {
        id: `ability.bodyguard.swap.${suffix}`,
        kind: 'movement-request',
        source: { kind: 'operation', id: requestId },
        recipients: { kind: 'response-owner' }, phase: 'movement',
        reasonCode: 'ability.bodyguard.swap',
        payload: {
          requestId: `ability.bodyguard.swap.${suffix}.target.${encodeURIComponent(targetId)}`,
          mode: 'swap', distance: 1, destinationSetId: null,
        },
      })
    }
  }
  if (input.script.moveName === 'Bone Club'
    && aa062BoneLordEmpowersMove(input.context, 'Bone Club')) {
    const stages: readonly ['def', 'satk'] = ['def', 'satk']
    for (const stage of stages) {
      const operation: MoveCombatStageEffectOperation = {
        id: `ability.bone-lord.bone-club.lower-${stage}`,
        kind: 'combat-stage',
        source: { kind: 'move', id: input.moveSourceId },
        recipients: { kind: 'hit-targets' }, phase: 'after-damage',
        reasonCode: `ability.bone-lord.bone-club.lower-${stage}`,
        payload: {
          action: 'modify', stage, selectedStage: null, value: -1,
          stageSource: null, rounding: null, applyTypeImmunity: false,
        },
      }
      operations.push(operation)
    }
  }
  if (input.script.moveName !== 'Whirlwind'
    || !input.context.queries.abilities.has(input.context.actor.placement.id, 'Blow Away')) {
    return Object.freeze(operations)
  }
  const hp: MoveDirectHpEffectOperation = {
    id: 'ability.blow-away.tick-loss',
    kind: 'direct-hp',
    source: { kind: 'move', id: input.moveSourceId },
    recipients: { kind: 'hit-targets' },
    phase: 'after-damage',
    reasonCode: 'ability.blow-away.tick-loss',
    payload: {
      mode: 'lose', pool: 'hit-points',
      calculation: { kind: 'percent-max', percent: 10 },
      copySource: null, bounds: { minimum: 0, maximum: null }, rounding: 'floor',
      applyTypeImmunity: false, cost: null,
      injury: { hitPointMarkers: 'apply-after-operation', massiveDamage: 'never' },
    },
  }
  const push: MoveMovementRequestEffectOperation = {
    id: 'ability.blow-away.additional-push',
    kind: 'movement-request',
    source: { kind: 'move', id: input.moveSourceId },
    recipients: { kind: 'hit-targets' },
    phase: 'movement',
    reasonCode: 'ability.blow-away.additional-push',
    payload: {
      requestId: 'ability.blow-away.additional-push', mode: 'forced', distance: 2,
      destinationSetId: null,
      displacement: {
        vector: { kind: 'away', source: { kind: 'actor' } },
        distancePolicy: 'up-to-distance', opportunityAttacks: 'ignore',
      },
    },
  }
  operations.push(hp, push)
  return Object.freeze(operations)
}
